import { on } from '../router.js';
import { ApiError, json, readJson, bearerToken } from '../http.js';
import { adminClient } from '../supabase.js';
import { rateLimit } from '../auth.js';
import { parseConnectionToken } from '../tokens.js';
import { sanitizeSample, sanitizeMetadata, promptHashFromMessages, outputHash, sha256 } from '../sanitize.js';
import { loadPricing, normalizeModel, estimateCost } from '../pricing.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

const MAX_EVENTS = 500;
const STATUSES = new Set(['ok', 'error', 'timeout', 'cancelled']);

function intOrNull(value, max = 50_000_000) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), max);
}

function numOrNull(value, max = 1e9) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

function timestamp(value) {
  if (!value) return new Date();
  const d = typeof value === 'number' ? new Date(value > 1e12 ? value : value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 5 * 60_000) return new Date(now);
  if (d.getTime() < now - 400 * 24 * 60 * 60_000) return null;
  return d;
}

function shortText(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

/**
 * Normalizes one raw event into a telemetry_events row. Returns { row } or { error }.
 */
export function normalizeEvent(raw, { connection, pricing, captureSamples }) {
  if (!raw || typeof raw !== 'object') return { error: 'event must be an object' };
  const occurred = timestamp(raw.occurred_at ?? raw.timestamp ?? raw.ts);
  if (!occurred) return { error: 'occurred_at is not a valid timestamp' };
  const { provider, model, key } = normalizeModel(raw.provider, raw.model);
  if (!model) return { error: 'model is required' };
  const status = STATUSES.has(raw.status) ? raw.status : raw.error ? 'error' : 'ok';
  const inputTokens = intOrNull(raw.input_tokens ?? raw.prompt_tokens ?? raw.usage?.prompt_tokens ?? raw.usage?.input_tokens);
  const outputTokens = intOrNull(raw.output_tokens ?? raw.completion_tokens ?? raw.usage?.completion_tokens ?? raw.usage?.output_tokens);
  const cached = intOrNull(raw.cached_input_tokens ?? raw.usage?.prompt_tokens_details?.cached_tokens ?? raw.usage?.cached_tokens);
  const reasoning = intOrNull(raw.reasoning_tokens ?? raw.usage?.completion_tokens_details?.reasoning_tokens);
  const latency = numOrNull(raw.latency_ms ?? raw.duration_ms);
  let cost = numOrNull(raw.cost_usd ?? raw.usage?.cost, 10_000);
  let costSource = cost !== null ? (raw.cost_source === 'provider_reported' ? 'provider_reported' : 'imported_external') : 'unavailable';
  let pricingVersion = null;
  if (cost === null && (inputTokens !== null || outputTokens !== null)) {
    const est = estimateCost(pricing, key, { input: inputTokens || 0, output: outputTokens || 0, cached: cached || 0 });
    if (est) {
      cost = est.cost;
      costSource = est.source;
      pricingVersion = est.version;
    }
  }
  // Hashes are always derived so repeated-request detection works even when
  // the connection does not store samples. Only the stored sample is gated.
  const cleaned = sanitizeSample(raw.sample) || (Array.isArray(raw.messages) ? sanitizeSample({ messages: raw.messages, output: raw.output }) : null);
  const sample = captureSamples ? cleaned : null;
  const promptHash = shortText(raw.prompt_hash, 64) || (cleaned ? promptHashFromMessages(cleaned.messages) : null);
  const outHash = shortText(raw.output_hash, 64) || (cleaned?.output ? outputHash(cleaned.output) : null) || (typeof raw.output === 'string' ? outputHash(raw.output) : null);
  const traceId = shortText(raw.trace_id ?? raw.request_id, 200);
  const spanId = shortText(raw.span_id, 200);
  const eventKey = spanId || traceId || sha256(`${connection.id}|${occurred.toISOString()}|${key}|${promptHash || ''}|${inputTokens}|${outputTokens}`).slice(0, 48);
  return {
    row: {
      workspace_id: connection.workspace_id,
      project_id: connection.project_id,
      connection_id: connection.id,
      event_key: eventKey,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: shortText(raw.parent_span_id, 200),
      occurred_at: occurred.toISOString(),
      provider,
      model: key,
      operation: shortText(raw.operation, 80) || 'chat.completion',
      status,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cached,
      reasoning_tokens: reasoning,
      latency_ms: latency,
      cost_usd: cost,
      cost_source: costSource,
      pricing_version: pricingVersion,
      prompt_hash: promptHash,
      output_hash: outHash,
      attempt: intOrNull(raw.attempt, 100),
      error_class: status === 'ok' ? null : shortText(raw.error_class ?? raw.error?.type ?? raw.error, 80),
      sample,
      metadata: sanitizeMetadata(raw.metadata),
    },
  };
}

on('OPTIONS', '/api/telemetry/ingest', async () => new Response(null, { status: 204, headers: CORS }));

on('POST', '/api/telemetry/ingest', async ({ request }) => {
  const raw = bearerToken(request);
  const parsed = parseConnectionToken(raw);
  if (!parsed) throw new ApiError(401, 'A valid connection token is required.', 'INVALID_TOKEN');
  const admin = adminClient();
  const { data: secret } = await admin.from('connection_secrets').select('connection_id').eq('token_hash', parsed.hash).maybeSingle();
  if (!secret) throw new ApiError(401, 'A valid connection token is required.', 'INVALID_TOKEN');
  const { data: connection } = await admin.from('connections').select('*').eq('id', secret.connection_id).maybeSingle();
  if (!connection || connection.status !== 'active' || !connection.project_id) throw new ApiError(401, 'This connection is revoked or inactive.', 'CONNECTION_INACTIVE');
  if (!['server_telemetry', 'runtime_api'].includes(connection.kind) || !connection.scopes?.includes('telemetry:write')) throw new ApiError(403, 'This connection is not scoped for telemetry.', 'SCOPE_MISMATCH');
  rateLimit(`ingest:${connection.id}`, { limit: 120, windowMs: 60_000 });

  const { data: flag } = await admin.from('feature_flags').select('enabled').eq('key', 'runtime_telemetry').maybeSingle();
  if (flag && !flag.enabled) throw new ApiError(503, 'Telemetry ingestion is temporarily paused.', 'FEATURE_DISABLED');

  const body = await readJson(request, { maxBytes: 2_500_000 });
  const events = Array.isArray(body?.events) ? body.events : body && typeof body === 'object' && body.model ? [body] : [];
  if (!events.length) throw new ApiError(400, 'Send { "events": [ ... ] } with at least one event.', 'VALIDATION');
  if (events.length > MAX_EVENTS) throw new ApiError(413, `Send at most ${MAX_EVENTS} events per request.`, 'PAYLOAD_TOO_LARGE');

  const pricing = await loadPricing(admin);
  const captureSamples = Boolean(connection.metadata?.capture_samples);
  const rows = [];
  const errors = [];
  events.forEach((e, i) => {
    const out = normalizeEvent(e, { connection, pricing, captureSamples });
    if (out.error) errors.push({ index: i, error: out.error });
    else rows.push(out.row);
  });
  let accepted = 0;
  if (rows.length) {
    const { data, error } = await admin.from('telemetry_events').upsert(rows, { onConflict: 'project_id,event_key', ignoreDuplicates: true }).select('id');
    if (error) throw error;
    accepted = data?.length || 0;
  }
  const now = new Date().toISOString();
  await admin.from('connections').update({ last_used_at: now, last_seen_at: now }).eq('id', connection.id);
  return json({ accepted, duplicates: rows.length - accepted, rejected: errors.length, errors: errors.slice(0, 5), samples_captured: captureSamples }, 200, CORS);
});
