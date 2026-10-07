/**
 * Bounded reader for span payloads, shared by the OpenTelemetry GenAI and
 * OpenInference adapters. Accepts:
 *
 *   - OTLP/JSON trace export: { resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] }
 *   - a flat span list (Phoenix / OpenInference export style):
 *     { spans: [{ context: { trace_id, span_id }, parent_id, name, span_kind,
 *                 start_time, end_time, status_code, attributes, events }] }
 *
 * Produces normalized spans grouped by trace id. Attribute values are kept
 * as received here; the adapters decide what may leave (content never does).
 */
import { sha256Json } from '../hash.js';
import { isoOrNull, nanosToIso } from '../canonicalize.js';
import { LIMITS } from '../contracts.js';

export class PayloadError extends Error {}

const HEX_TRACE = /^[0-9a-f]{32}$/;
const HEX_SPAN = /^[0-9a-f]{16}$/;

/** OTLP/JSON ids are hex; protobuf-JSON exporters sometimes emit base64. */
function normalizeId(value, bytes) {
  if (typeof value !== 'string' || !value) return null;
  const lower = value.trim().toLowerCase().replace(/^0x/, '');
  if ((bytes === 16 ? HEX_TRACE : HEX_SPAN).test(lower)) return /^0+$/.test(lower) ? null : lower;
  if (/^[A-Za-z0-9+/=_-]+$/.test(value)) {
    const buf = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length === bytes) {
      const hex = buf.toString('hex');
      return /^0+$/.test(hex) ? null : hex;
    }
  }
  // Non-hex ids from other tools: keep them, bounded, as opaque strings.
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

/** OTLP AnyValue → plain JS. int64 arrives as a string in OTLP/JSON. */
function anyValue(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 4) return null;
  if ('stringValue' in v) return String(v.stringValue);
  if ('boolValue' in v) return Boolean(v.boolValue);
  if ('intValue' in v) {
    const n = Number(v.intValue);
    return Number.isSafeInteger(n) ? n : String(v.intValue);
  }
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('arrayValue' in v) return (v.arrayValue?.values || []).slice(0, 64).map((x) => anyValue(x, depth + 1));
  if ('kvlistValue' in v) return Object.fromEntries((v.kvlistValue?.values || []).slice(0, 64).map((kv) => [String(kv.key), anyValue(kv.value, depth + 1)]));
  if ('bytesValue' in v) return null;
  return null;
}

function otlpAttributes(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const kv of list.slice(0, 512)) if (kv && typeof kv.key === 'string') out[kv.key] = anyValue(kv.value);
  return out;
}

/** Nested attribute objects (Phoenix export) → dotted keys, the form both conventions specify. */
export function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || depth > 8) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) v.slice(0, 64).forEach((item, i) => flatten(item, `${key}.${i}`, out, depth + 1));
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

const OTLP_STATUS = { 0: 'unset', 1: 'ok', 2: 'error', STATUS_CODE_UNSET: 'unset', STATUS_CODE_OK: 'ok', STATUS_CODE_ERROR: 'error' };
const TEXT_STATUS = { UNSET: 'unset', OK: 'ok', ERROR: 'error' };

function durationMs(startIso, endIso, startNs, endNs) {
  if (startNs !== null && endNs !== null) {
    try {
      const d = Number(BigInt(endNs) - BigInt(startNs)) / 1e6;
      return d >= 0 ? d : null;
    } catch {
      /* fall through */
    }
  }
  if (startIso && endIso) {
    const d = Date.parse(endIso) - Date.parse(startIso);
    return d >= 0 ? d : null;
  }
  return null;
}

function semconvVersion(schemaUrl) {
  const m = typeof schemaUrl === 'string' ? schemaUrl.match(/schemas\/(\d+\.\d+(?:\.\d+)?)/) : null;
  return m ? m[1] : null;
}

function pushSpan(out, raw, ctx, rejected) {
  const traceId = normalizeId(raw.traceId ?? raw.trace_id ?? raw.context?.trace_id, 16);
  const spanId = normalizeId(raw.spanId ?? raw.span_id ?? raw.context?.span_id, 8);
  if (!traceId || !spanId) {
    rejected.push({ source_trace_id: traceId, reason: 'span without a valid trace_id/span_id' });
    return;
  }
  const parent = normalizeId(raw.parentSpanId ?? raw.parent_span_id ?? raw.parent_id ?? null, 8);
  const startNs = raw.startTimeUnixNano ?? null;
  const endNs = raw.endTimeUnixNano ?? null;
  const startIso = startNs !== null ? nanosToIso(startNs) : isoOrNull(raw.start_time);
  const endIso = endNs !== null ? nanosToIso(endNs) : isoOrNull(raw.end_time);
  const attributes = Array.isArray(raw.attributes) ? otlpAttributes(raw.attributes) : flatten(raw.attributes || {});
  const status = raw.status && typeof raw.status === 'object' ? OTLP_STATUS[raw.status.code] ?? null : TEXT_STATUS[String(raw.status_code || '').toUpperCase()] ?? null;
  const links = (Array.isArray(raw.links) ? raw.links : [])
    .slice(0, 32)
    .map((l) => ({ trace_id: normalizeId(l.traceId ?? l.trace_id ?? l.context?.trace_id, 16), span_id: normalizeId(l.spanId ?? l.span_id ?? l.context?.span_id, 8) }))
    .filter((l) => l.span_id);
  const events = (Array.isArray(raw.events) ? raw.events : []).slice(0, 64).map((e) => (typeof e?.name === 'string' ? e.name.slice(0, 80) : null)).filter(Boolean);
  out.push({
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parent && parent !== spanId ? parent : null,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 300) : null,
    otel_kind: raw.kind ?? null,
    span_kind: typeof raw.span_kind === 'string' ? raw.span_kind : null,
    start_iso: startIso,
    end_iso: endIso,
    duration_ms: durationMs(startIso, endIso, startNs, endNs),
    status,
    attributes,
    links,
    event_names: events,
    resource: ctx.resource,
    scope: ctx.scope,
    schema_url: ctx.schemaUrl,
    // Commits to the span as received (content included) without keeping it.
    // OTLP attributes are a key set sent as a list, so the list is put in key
    // order first: the same span always has the same hash.
    source_hash: sha256Json(Array.isArray(raw.attributes) ? { ...raw, attributes: [...raw.attributes].sort((x, y) => (String(x?.key) < String(y?.key) ? -1 : String(x?.key) > String(y?.key) ? 1 : 0)) } : raw),
  });
}

/**
 * Payload → { traces: Map<traceId, spans[]>, rejected, spanCount, sourceVersion }.
 * Throws PayloadError for a payload that is not a span batch or is over the limits.
 */
export function readSpans(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PayloadError('payload must be an object.');
  const spans = [];
  const rejected = [];
  const versions = new Set();
  if (Array.isArray(payload.resourceSpans)) {
    for (const rs of payload.resourceSpans) {
      const resource = otlpAttributes(rs?.resource?.attributes);
      if (semconvVersion(rs?.schemaUrl)) versions.add(semconvVersion(rs.schemaUrl));
      for (const ss of Array.isArray(rs?.scopeSpans) ? rs.scopeSpans : []) {
        if (semconvVersion(ss?.schemaUrl)) versions.add(semconvVersion(ss.schemaUrl));
        const scope = { name: typeof ss?.scope?.name === 'string' ? ss.scope.name.slice(0, 120) : null, version: typeof ss?.scope?.version === 'string' ? ss.scope.version.slice(0, 40) : null };
        for (const raw of Array.isArray(ss?.spans) ? ss.spans : []) {
          if (spans.length >= LIMITS.maxSpansPerBatch) throw new PayloadError(`A batch may hold at most ${LIMITS.maxSpansPerBatch} spans.`);
          if (raw && typeof raw === 'object') pushSpan(spans, raw, { resource, scope, schemaUrl: ss?.schemaUrl || rs?.schemaUrl || null }, rejected);
        }
      }
    }
  } else if (Array.isArray(payload.spans) || Array.isArray(payload.data)) {
    const list = payload.spans || payload.data;
    if (list.length > LIMITS.maxSpansPerBatch) throw new PayloadError(`A batch may hold at most ${LIMITS.maxSpansPerBatch} spans.`);
    for (const raw of list) if (raw && typeof raw === 'object') pushSpan(spans, raw, { resource: flatten(raw.resource?.attributes || raw.resource || {}), scope: { name: null, version: null }, schemaUrl: null }, rejected);
  } else throw new PayloadError('payload must be an OTLP/JSON trace export (resourceSpans) or a span list (spans).');

  const traces = new Map();
  for (const s of spans) {
    if (!traces.has(s.trace_id)) traces.set(s.trace_id, []);
    traces.get(s.trace_id).push(s);
  }
  if (traces.size > LIMITS.maxTracesPerBatch) throw new PayloadError(`A batch may hold at most ${LIMITS.maxTracesPerBatch} traces.`);
  return { traces, rejected, spanCount: spans.length, sourceVersion: versions.size === 1 ? [...versions][0] : versions.size ? [...versions].sort().join(',') : null };
}

/**
 * Same span id twice in one trace: an identical resend is collapsed; two
 * different spans claiming one id make the trace ambiguous, so it is rejected.
 */
export function dedupeSpans(spans) {
  const byId = new Map();
  for (const s of spans) {
    const prev = byId.get(s.span_id);
    if (!prev) byId.set(s.span_id, s);
    else if (prev.source_hash !== s.source_hash) throw new PayloadError(`span ${s.span_id} appears twice with different content`);
  }
  return [...byId.values()];
}

/**
 * A dotted attribute key that carries prompt/output/tool payload text in any
 * convention (gen_ai.input.messages, gen_ai.prompt.0.content, input.value,
 * llm.output_messages.0.message.content, tool_call.function.arguments, ...).
 */
const CONTENT_SEGMENT = /^(prompt|prompts|completion|completions|content|contents|messages|input_messages|output_messages|system_instructions|arguments|result|value|text|documents|input_documents|output_documents|query|template|variables|vector|embeddings|definitions|parameters|invocation_parameters|metadata)$/;
const SAFE_DESPITE_SEGMENTS = new Set(['gen_ai.output.type', 'input.mime_type', 'output.mime_type']);
export function isContentAttribute(key) {
  if (SAFE_DESPITE_SEGMENTS.has(key)) return false;
  const segments = key.split('.');
  if (segments.some((s) => CONTENT_SEGMENT.test(s))) return true;
  // input.* / output.* in OpenInference and the gen_ai.input / gen_ai.output groups.
  return /^(gen_ai\.)?(input|output)\./.test(key);
}

/** Hash and size of the content-bearing attributes, then nothing else of them. */
export function digestAttributes(attrs, isContentKey) {
  const keys = Object.keys(attrs).filter(isContentKey).sort();
  if (!keys.length) return null;
  const parts = keys.map((k) => [k, attrs[k]]);
  const length = parts.reduce((a, [, v]) => a + (typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length), 0);
  return { sha256: sha256Json(parts), length, keys: keys.length };
}
