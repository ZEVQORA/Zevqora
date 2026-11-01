/**
 * Current ZEVQORA engine evidence → ZevIR. Reads engine_traces rows as they
 * are stored; never modifies them.
 *
 * One graph per engine trace (one recorded model request):
 *
 *   Task (request / workflow)
 *     └─CALLS→ Function (source symbol, when the trace names one)
 *                └─CALLS→ ModelCall ─SERVED_BY→ Runtime (provider/model)
 *                             └─PRODUCES→ Outcome (when an output was recorded)
 *
 * Without a symbol, Task CALLS ModelCall directly. The adapter never reads the
 * raw input/output/system-prompt/expected-output columns: it keeps the hashes
 * the engine computed at import time.
 */
import { sha256Json } from '../hash.js';
import { finalize, Gaps, isoOrNull, modelCallGaps, modelRuntime, optCount, optNonNegative, optString } from '../canonicalize.js';
import { COST_SOURCES } from '../contracts.js';

const SOURCE = 'zevqora_engine';

/** Columns this adapter reads. Explicit, and free of raw content columns, so none is pulled in by accident. */
export const ENGINE_TRACE_COLUMNS = 'id,product_id,workspace_id,request_id,timestamp,symbol,workflow,provider,model,requested_model,response_model,provider_request_id,system_prompt_hash,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,latency_ms,ttft_ms,cost_usd,cost_source,pricing_version,attempt,retry_reason,input_hash,output_hash,protected,metadata';

/** Safe identity of the source row: what it said, with content replaced by its hashes. */
function sourceHash(t) {
  return sha256Json({
    table: 'engine_traces',
    id: t.id,
    request_id: t.request_id,
    timestamp: isoOrNull(t.timestamp),
    symbol: t.symbol ?? null,
    workflow: t.workflow ?? null,
    provider: t.provider ?? null,
    model: t.model ?? null,
    requested_model: t.requested_model ?? null,
    response_model: t.response_model ?? null,
    provider_request_id: t.provider_request_id ?? null,
    input_tokens: t.input_tokens ?? null,
    output_tokens: t.output_tokens ?? null,
    cached_input_tokens: t.cached_input_tokens ?? null,
    reasoning_tokens: t.reasoning_tokens ?? null,
    latency_ms: t.latency_ms ?? null,
    ttft_ms: t.ttft_ms ?? null,
    cost_usd: t.cost_usd ?? null,
    cost_source: t.cost_source ?? null,
    pricing_version: t.pricing_version ?? null,
    attempt: t.attempt ?? null,
    retry_reason: t.retry_reason ?? null,
    input_hash: t.input_hash ?? null,
    output_hash: t.output_hash ?? null,
    system_prompt_hash: t.system_prompt_hash ?? null,
    protected: Boolean(t.protected),
  });
}

/** One engine_traces row → draft graph. */
export function engineTraceDraft(t, { product }) {
  const requestId = String(t.request_id);
  const gaps = new Gaps();
  const timestamp = isoOrNull(t.timestamp);
  const srcHash = sourceHash(t);
  const locator = { table: 'engine_traces', id: t.id, product_id: product.id, request_id: requestId };
  const evidence = (span, extra = {}) => ({ source_id: t.id, source_trace_id: requestId, source_span_id: span, source_hash: srcHash, locator, captured_at: timestamp, ...extra });
  const provider = optString(t.provider, 80);
  const model = optString(t.response_model, 160) || optString(t.model, 160);
  const nodes = [];
  const edges = [];

  nodes.push({
    ref: 'task',
    kind: 'Task',
    scope: { trace_id: requestId, span_id: 'task' },
    fields: { name: optString(t.workflow) || optString(t.symbol) || 'request', started_at: timestamp },
    attributes: { request_id: requestId, workflow: optString(t.workflow), product_id: product.id, protected: Boolean(t.protected) },
    evidence: [evidence('task')],
  });

  let caller = 'task';
  if (optString(t.symbol)) {
    // The code symbol is the same function across requests: an entity node,
    // shared by every graph of this product that calls it.
    nodes.push({ ref: 'function', kind: 'Function', scope: { entity: ['engine_symbol', product.id, t.symbol] }, fields: { name: optString(t.symbol) }, attributes: { symbol: optString(t.symbol), product_id: product.id }, evidence: [evidence('function')] });
    edges.push({ from: 'task', to: 'function', kind: 'CALLS' });
    caller = 'function';
  }

  const costUsd = optNonNegative(t.cost_usd);
  const costSource = costUsd !== null && COST_SOURCES.includes(t.cost_source) ? t.cost_source : null;
  const fields = {
    name: model,
    started_at: timestamp,
    latency_ms: optNonNegative(t.latency_ms),
    ttft_ms: optNonNegative(t.ttft_ms),
    input_tokens: optCount(t.input_tokens),
    output_tokens: optCount(t.output_tokens),
    cached_input_tokens: optCount(t.cached_input_tokens),
    reasoning_tokens: optCount(t.reasoning_tokens),
    // Unknown cost stays null. A cost without a recognised source is not trusted as known.
    cost_usd: costSource ? costUsd : null,
    cost_source: costSource,
  };
  const inputDigest = t.input_hash ? { sha256: t.input_hash } : null;
  const outputDigest = t.output_hash ? { sha256: t.output_hash } : null;
  const attrs = {
    provider,
    model,
    requested_model: optString(t.requested_model, 160),
    response_model: optString(t.response_model, 160),
    provider_request_id: optString(t.provider_request_id, 200),
    pricing_version: optString(t.pricing_version, 80),
    attempt: optCount(t.attempt),
    retry_reason: optString(t.retry_reason, 200),
    protected: Boolean(t.protected),
    input_digest: inputDigest,
    output_digest: outputDigest,
    system_prompt_sha256: t.system_prompt_hash || null,
    metadata: t.metadata && typeof t.metadata === 'object' ? t.metadata : null,
  };
  for (const code of modelCallGaps(fields, attrs)) gaps.add(code, requestId);
  if (fields.latency_ms === null) gaps.add('latency_unknown', requestId);
  if (!timestamp) gaps.add('timestamp_unknown', requestId);
  const contentHash = t.input_hash || t.output_hash || t.system_prompt_hash ? sha256Json({ input_hash: t.input_hash ?? null, output_hash: t.output_hash ?? null, system_prompt_hash: t.system_prompt_hash ?? null }) : null;
  nodes.push({ ref: 'model_call', kind: 'ModelCall', scope: { trace_id: requestId, span_id: 'model_call' }, fields, attributes: attrs, evidence: [evidence('model_call', { content_hash: contentHash, redaction_state: contentHash ? 'hashed_only' : 'not_captured' })] });
  edges.push({ from: caller, to: 'model_call', kind: 'CALLS' });

  const runtime = modelRuntime(provider, model);
  if (runtime) {
    nodes.push({ ref: 'runtime', kind: 'Runtime', scope: { entity: runtime.identity }, fields: { name: runtime.name }, attributes: runtime.attributes, evidence: [evidence('runtime')] });
    edges.push({ from: 'model_call', to: 'runtime', kind: 'SERVED_BY' });
  }

  if (t.output_hash) {
    nodes.push({
      ref: 'outcome',
      kind: 'Outcome',
      scope: { trace_id: requestId, span_id: 'outcome' },
      // task_success is an evaluation result; a projection does not compute it.
      fields: { name: 'output', started_at: timestamp },
      attributes: { output_digest: outputDigest },
      evidence: [evidence('outcome', { content_hash: t.output_hash, redaction_state: 'hashed_only' })],
    });
    edges.push({ from: 'model_call', to: 'outcome', kind: 'PRODUCES' });
  } else gaps.add('no_output_evidence', requestId);

  return {
    source_kind: SOURCE,
    source_version: null,
    graph_key: `engine:${product.id}:${requestId}`,
    source_trace_id: requestId,
    capture_started_at: timestamp,
    capture_ended_at: null,
    root: 'task',
    nodes,
    edges,
    gaps,
  };
}

/** engine_traces rows of one product → canonical graphs (one per trace). */
export function engineTracesToGraphs(traces, { product }) {
  const graphs = [];
  const rejected = [];
  for (const t of traces) {
    try {
      graphs.push(finalize(engineTraceDraft(t, { product }), { workspaceId: product.workspace_id }));
    } catch (error) {
      rejected.push({ source_trace_id: String(t.request_id), reason: String(error?.message || error).slice(0, 300), errors: error?.errors?.slice(0, 5) || [] });
    }
  }
  return { graphs, rejected };
}
