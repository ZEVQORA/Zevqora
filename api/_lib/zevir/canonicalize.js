/**
 * Adapter drafts → canonical ZevIR graphs.
 *
 * Adapters describe what they saw as a draft: nodes with a local `ref` and a
 * source identity (`scope`), edges between refs, evidence per node, and the
 * gaps they could not fill. `finalize` assigns stable keys, merges repeated
 * entity nodes, sanitizes attributes, sorts, hashes and validates. Nothing
 * here invents a value: a field the source did not carry stays null.
 */
import { redactSecrets } from '../sanitize.js';
import { sha256Text } from '../product/hashing.js';
import { ADAPTER_VERSIONS, SCHEMA_VERSION } from './contracts.js';
import { entityStableKey, graphHash, sha256Json, sortGraph, spanStableKey } from './hash.js';
import { validateGraph } from './validate.js';

export class ZevirContractError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.errors = errors;
  }
}

// ---------------------------------------------------------------- privacy
/**
 * Keys that carry prompt/output text (or other free-form payloads) in any of
 * the supported conventions. Values under these keys are never stored; an
 * adapter that needs to prove what the content was keeps a hash and a length.
 */
const CONTENT_KEY = /^(prompt|prompts|completion|completions|content|contents|message|messages|input_text|output_text|expected_output|candidate_output|system_prompt|system_instructions|instructions|text|value|values|body|arguments|result|results|document|documents|query|template|variables|input|output|inputs|outputs|raw_.*)$/i;
// Credential-bearing keys. Narrower than sanitize.js's SENSITIVE_KEY on purpose:
// that one matches every key containing "token", which would drop token counts.
const CREDENTIAL_KEY = /(api[_-]?key|secret|password|passwd|(^|[_.-])token$|access[_-]?token|refresh[_-]?token|bearer|authorization|cookie|private[_-]?key|credential|signature)/i;
const MAX_STRING = 512;
const MAX_KEYS = 64;
const MAX_ARRAY = 32;
const MAX_DEPTH = 4;

/**
 * The single exit gate for attribute values: drops content and credential
 * keys, redacts secret-shaped strings, bounds size and depth, and produces
 * key-sorted plain JSON. Anything it cannot represent safely is dropped.
 */
export function sanitizeAttributes(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return redactSecrets(value).slice(0, MAX_STRING);
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => sanitizeAttributes(v, depth + 1)).filter((v) => v !== null);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (Object.keys(out).length >= MAX_KEYS) break;
      if (CONTENT_KEY.test(key) || CREDENTIAL_KEY.test(key)) continue;
      const clean = sanitizeAttributes(value[key], depth + 1);
      if (clean === null || (typeof clean === 'object' && !Array.isArray(clean) && !Object.keys(clean).length)) continue;
      out[key.slice(0, 80)] = clean;
    }
    return out;
  }
  return null;
}

/** What may be kept about a piece of content: its hash and size, never the text. */
export function contentDigest(text, mimeType = null) {
  if (typeof text !== 'string' || !text.length) return null;
  const out = { sha256: sha256Text(text) || sha256Json(text), length: text.length };
  if (mimeType) out.mime_type = String(mimeType).slice(0, 80);
  return out;
}

// ----------------------------------------------------------------- numbers
export const optCount = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
};
export const optNonNegative = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const optString = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Nanoseconds since epoch (string/number/bigint) → ISO timestamp with microseconds. */
export function nanosToIso(value) {
  if (value === null || value === undefined || value === '' || value === '0' || value === 0) return null;
  let ns;
  try {
    ns = BigInt(String(value).split('.')[0]);
  } catch {
    return null;
  }
  if (ns <= 0n) return null;
  const ms = Number(ns / 1_000_000n);
  const micros = Number((ns / 1000n) % 1000n);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.(\d{3})Z$/, (_m, msPart) => `.${msPart}${String(micros).padStart(3, '0')}Z`);
}

export function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------- finalize
const NODE_FIELDS = ['name', 'operation', 'started_at', 'ended_at', 'duration_ms', 'status', 'cost_usd', 'cost_source', 'latency_ms', 'ttft_ms', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_tokens', 'task_success', 'trust_class', 'data_sensitivity', 'action_risk'];

function canonicalNode(stableKey, kind, fields, attributes) {
  const node = { stable_key: stableKey, kind };
  for (const f of NODE_FIELDS) node[f] = fields[f] === undefined ? null : fields[f];
  // A cost without provenance is not a known cost.
  if (node.cost_usd === null) node.cost_source = null;
  else if (!node.cost_source) node.cost_usd = null;
  node.attributes = sanitizeAttributes(attributes || {}) || {};
  return node;
}

/** A draft collects gaps as it goes; the graph reports them sorted and bounded. */
export class Gaps {
  constructor() {
    this.map = new Map();
  }
  add(code, sample = null) {
    const g = this.map.get(code) || { code, count: 0, sample: new Set() };
    g.count += 1;
    // Every sample is kept and the smallest five reported, so the result does not depend on input order.
    if (sample) g.sample.add(String(sample).slice(0, 200));
    this.map.set(code, g);
  }
  toJSON() {
    return [...this.map.values()]
      .sort((a, b) => (a.code < b.code ? -1 : 1))
      .slice(0, 32)
      .map((g) => (g.sample.size ? { code: g.code, count: g.count, sample: [...g.sample].sort().slice(0, 5) } : { code: g.code, count: g.count }));
  }
}

/**
 * draft = { source_kind, source_version, graph_key, source_trace_id,
 *           capture_started_at, capture_ended_at, root, nodes, edges, gaps }
 * node  = { ref, kind, scope: { trace_id, span_id } | { entity: [...] },
 *           fields, attributes, evidence: [ref-without-node] }
 * edge  = { from, to, kind, ordinal?, attributes? }
 */
export function finalize(draft, { workspaceId }) {
  const sourceKind = draft.source_kind;
  const adapterVersion = ADAPTER_VERSIONS[sourceKind];
  const keyOf = new Map();
  const nodes = new Map();
  const evidence = new Map();

  for (const n of draft.nodes) {
    const key = n.scope.entity ? entityStableKey(workspaceId, n.kind, n.scope.entity) : spanStableKey(workspaceId, sourceKind, n.scope.trace_id, n.scope.span_id, n.kind);
    keyOf.set(n.ref, key);
    if (!nodes.has(key)) nodes.set(key, canonicalNode(key, n.kind, n.fields || {}, n.attributes));
    for (const r of n.evidence || []) {
      const ref = {
        node: key,
        source_kind: sourceKind,
        source_id: r.source_id ?? null,
        source_trace_id: r.source_trace_id ?? null,
        source_span_id: r.source_span_id ?? null,
        source_hash: r.source_hash,
        adapter_version: adapterVersion,
        schema_version: SCHEMA_VERSION,
        locator: sanitizeAttributes(r.locator || {}) || {},
        content_hash: r.content_hash ?? null,
        redaction_state: r.redaction_state || 'not_captured',
        captured_at: r.captured_at ?? null,
      };
      evidence.set(`${key}|${ref.source_id}|${ref.source_span_id}|${ref.source_hash}`, ref);
    }
  }

  const edges = new Map();
  for (const e of draft.edges) {
    const source = keyOf.get(e.from);
    const target = keyOf.get(e.to);
    if (!source || !target) throw new ZevirContractError(`edge ${e.kind} references an unknown node (${source ? e.to : e.from})`);
    const id = `${source}|${e.kind}|${target}`;
    if (!edges.has(id)) edges.set(id, { source, target, kind: e.kind, ordinal: Number.isInteger(e.ordinal) ? e.ordinal : null, attributes: sanitizeAttributes(e.attributes || {}) || {} });
  }

  const gaps = draft.gaps instanceof Gaps ? draft.gaps.toJSON() : draft.gaps || [];
  const graph = sortGraph({
    schema_version: SCHEMA_VERSION,
    adapter_version: adapterVersion,
    source_kind: sourceKind,
    source_version: draft.source_version ?? null,
    graph_key: draft.graph_key,
    source_trace_id: draft.source_trace_id ?? null,
    root: draft.root ? keyOf.get(draft.root) ?? null : null,
    status: gaps.length ? 'incomplete' : 'complete',
    graph_hash: '',
    capture_started_at: draft.capture_started_at ?? null,
    capture_ended_at: draft.capture_ended_at ?? null,
    completeness: { gaps },
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    evidence: [...evidence.values()],
  });
  graph.graph_hash = graphHash(graph);
  const result = validateGraph(graph);
  if (!result.ok) throw new ZevirContractError(`ZevIR contract violation in ${draft.graph_key}`, result.errors);
  return graph;
}

// ------------------------------------------------------------- span traces
const ACCEPTED_CHILD_EDGE = { Retrieval: 'RETRIEVES' };

/**
 * Shared structure for span-based sources (OpenTelemetry GenAI, OpenInference).
 * `mapSpan(span)` returns { kind, fields, attributes, gaps, runtime, outcome }
 * for one normalized span; this function adds the trace's Task, parent→child
 * edges in start order, link edges, and the gaps for parents or links that are
 * not in the batch. A missing parent is reported, never guessed.
 */
export function spanTraceDraft({ sourceKind, sourceVersion, traceId, spans, mapSpan, taskName }) {
  const gaps = new Gaps();
  const nodes = [];
  const edges = [];
  const byId = new Map();
  for (const s of spans) byId.set(s.span_id, s);
  const mapped = new Map();

  for (const s of spans) {
    const m = mapSpan(s);
    mapped.set(s.span_id, m);
    for (const code of m.gaps || []) gaps.add(code, s.span_id);
    const ref = `span:${s.span_id}`;
    const evidence = { source_id: s.span_id, source_trace_id: traceId, source_span_id: s.span_id, source_hash: s.source_hash, locator: { trace_id: traceId, span_id: s.span_id, span_name: s.name, ...(s.scope?.name ? { scope: s.scope.name } : {}) }, content_hash: m.content_hash ?? null, redaction_state: m.content_hash ? 'hashed_only' : 'not_captured', captured_at: s.start_iso };
    nodes.push({ ref, kind: m.kind, scope: { trace_id: traceId, span_id: s.span_id }, fields: m.fields, attributes: m.attributes, evidence: [evidence] });
    if (m.runtime) {
      const rref = `entity:Runtime:${JSON.stringify(m.runtime.identity)}`;
      nodes.push({ ref: rref, kind: 'Runtime', scope: { entity: m.runtime.identity }, fields: { name: m.runtime.name }, attributes: m.runtime.attributes, evidence: [{ ...evidence, content_hash: null, redaction_state: 'not_captured', locator: { ...evidence.locator, derived: 'runtime' } }] });
      edges.push({ from: ref, to: rref, kind: 'SERVED_BY' });
    }
    if (m.outcome) {
      const oref = `span:${s.span_id}#outcome`;
      nodes.push({ ref: oref, kind: 'Outcome', scope: { trace_id: traceId, span_id: `${s.span_id}#outcome` }, fields: m.outcome.fields || {}, attributes: m.outcome.attributes, evidence: [{ ...evidence, content_hash: m.outcome.content_hash ?? null, redaction_state: m.outcome.content_hash ? 'hashed_only' : 'not_captured', locator: { ...evidence.locator, derived: 'outcome' } }] });
      edges.push({ from: ref, to: oref, kind: 'PRODUCES' });
    }
  }

  const startOrder = (a, b) => (a.start_iso || '') < (b.start_iso || '') ? -1 : (a.start_iso || '') > (b.start_iso || '') ? 1 : a.span_id < b.span_id ? -1 : 1;
  const roots = [];
  const children = new Map();
  for (const s of spans) {
    if (!s.parent_span_id) roots.push(s);
    else if (byId.has(s.parent_span_id)) {
      if (!children.has(s.parent_span_id)) children.set(s.parent_span_id, []);
      children.get(s.parent_span_id).push(s);
    } else gaps.add('missing_parent', s.span_id);
  }
  for (const [parent, list] of children) {
    list.sort(startOrder).forEach((child, i) => {
      edges.push({ from: `span:${parent}`, to: `span:${child.span_id}`, kind: ACCEPTED_CHILD_EDGE[mapped.get(child.span_id).kind] || 'CALLS', ordinal: i });
    });
  }

  for (const s of spans) {
    for (const link of s.links || []) {
      if (link.trace_id && link.trace_id !== traceId) {
        gaps.add('external_link', s.span_id);
        continue;
      }
      if (!byId.has(link.span_id)) {
        gaps.add('unresolved_link', s.span_id);
        continue;
      }
      // An evaluator span linking to what it judged: target EVALUATED_BY evaluator.
      if (mapped.get(s.span_id).attributes?.semantic_role === 'evaluator') edges.push({ from: `span:${link.span_id}`, to: `span:${s.span_id}`, kind: 'EVALUATED_BY' });
      else edges.push({ from: `span:${s.span_id}`, to: `span:${link.span_id}`, kind: 'DEPENDS_ON' });
    }
  }

  // The traced request itself. Every trace graph has exactly one Task, which
  // calls the root spans; it is derived from the spans, so its evidence is the
  // set of span hashes.
  roots.sort(startOrder);
  if (!roots.length) gaps.add('missing_root');
  const starts = roots.map((r) => r.start_iso).filter(Boolean).sort();
  const ends = roots.map((r) => r.end_iso).filter(Boolean).sort();
  const started = starts[0] || null;
  const ended = ends.length === roots.length && ends.length ? ends[ends.length - 1] : null;
  const duration = started && ended ? Math.max(0, Date.parse(ended) - Date.parse(started)) : null;
  nodes.push({
    ref: 'task',
    kind: 'Task',
    scope: { trace_id: traceId, span_id: null },
    fields: { name: roots.length === 1 ? roots[0].name : taskName || null, started_at: started, ended_at: ended, duration_ms: duration, status: roots.some((r) => r.status === 'error') ? 'error' : null },
    attributes: { derived_from: 'spans', span_count: spans.length, root_span_count: roots.length },
    evidence: [{ source_id: null, source_trace_id: traceId, source_span_id: null, source_hash: sha256Json(spans.map((s) => s.source_hash).sort()), locator: { trace_id: traceId, span_count: spans.length, root_span_ids: roots.slice(0, 10).map((r) => r.span_id) }, captured_at: started }],
  });
  roots.forEach((r, i) => edges.push({ from: 'task', to: `span:${r.span_id}`, kind: ACCEPTED_CHILD_EDGE[mapped.get(r.span_id).kind] || 'CALLS', ordinal: i }));

  const allStarts = spans.map((s) => s.start_iso).filter(Boolean).sort();
  const allEnds = spans.map((s) => s.end_iso).filter(Boolean).sort();
  return {
    source_kind: sourceKind,
    source_version: sourceVersion ?? null,
    graph_key: `trace:${traceId}`,
    source_trace_id: traceId,
    capture_started_at: allStarts[0] || null,
    capture_ended_at: allEnds[allEnds.length - 1] || null,
    root: 'task',
    nodes,
    edges,
    gaps,
  };
}

/** Gaps every model call is checked for, whatever the source. Missing stays missing. */
export function modelCallGaps(fields, attrs) {
  const out = [];
  if (fields.cost_usd === null || fields.cost_usd === undefined) out.push('cost_unknown');
  const missing = (v) => v === null || v === undefined;
  // Embeddings produce no completion tokens and rerankers often report none; only ask for what the operation has.
  if (fields.operation === 'embedding') {
    if (missing(fields.input_tokens)) out.push('tokens_unknown');
  } else if (fields.operation !== 'rerank' && (missing(fields.input_tokens) || missing(fields.output_tokens))) out.push('tokens_unknown');
  if (!attrs.provider) out.push('provider_unknown');
  if (!attrs.model) out.push('model_unknown');
  return out;
}

/** Runtime entity for a model call, only from what the source reported. */
export function modelRuntime(provider, model) {
  if (!provider && !model) return null;
  const name = provider && model && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model || provider;
  return { identity: ['model_endpoint', provider || null, model || null], name, attributes: { runtime_kind: 'model_endpoint', provider: provider || null, model: model || null } };
}
