/**
 * ZevIR persistence. Server-only: every call here runs with the service-role
 * client after the route has authorized the caller's workspace.
 *
 * Ingestion is synchronous and bounded (no queue in Part 1, see
 * docs/zevir-rollout.md). Each run is recorded in zevir_ingest_runs under a
 * workspace-unique idempotency key, so an identical second request returns
 * the first run instead of writing again; graphs are written atomically by
 * public.zevir_persist_graphs, which no-ops on an unchanged graph hash.
 */
import { ApiError } from '../http.js';
import { ADAPTER_VERSIONS, LIMITS, SCHEMA_VERSION } from './contracts.js';
import { edgeId, evidenceId, graphId, nodeId, sha256Json } from './hash.js';
import { ENGINE_TRACE_COLUMNS, engineTracesToGraphs } from './adapters/engine.js';
import { otelGenAiToGraphs } from './adapters/otel-genai.js';
import { openInferenceToGraphs } from './adapters/openinference.js';
import { PayloadError } from './adapters/otlp.js';

export const FLAG = 'zevir_shadow';
const STALE_RUN_MS = 5 * 60_000;

/** Shadow mode is on for a workspace when the flag is on, unless a workspace override says otherwise. */
export async function zevirEnabled(admin, workspaceId) {
  const { data } = await admin.from('feature_flags').select('enabled,workspace_overrides').eq('key', FLAG).maybeSingle();
  if (!data) return false;
  const override = data.workspace_overrides?.[workspaceId];
  if (override === true || override === false) return override;
  return Boolean(data.enabled);
}

// ------------------------------------------------------------------ summary
const countBy = (items, key) => items.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] || 0) + 1), acc), {});

/**
 * Read-model summary of one graph. Unknown cost is counted as unknown: the
 * total is over known costs only and is null when no cost is known.
 */
export function summarizeGraph(graph) {
  const calls = graph.nodes.filter((n) => n.kind === 'ModelCall');
  const priced = calls.filter((n) => n.cost_usd !== null && n.cost_usd !== undefined);
  const sum = (rows, f) => (rows.length ? rows.reduce((a, n) => a + Number(n[f]), 0) : null);
  const withIn = calls.filter((n) => n.input_tokens !== null && n.input_tokens !== undefined);
  const withOut = calls.filter((n) => n.output_tokens !== null && n.output_tokens !== undefined);
  return {
    node_counts: countBy(graph.nodes, 'kind'),
    edge_counts: countBy(graph.edges, 'kind'),
    evidence_refs: graph.evidence.length,
    model_calls: calls.length,
    cost: { known: priced.length, unknown: calls.length - priced.length, known_total_usd: priced.length ? Number(sum(priced, 'cost_usd').toFixed(10)) : null, complete: calls.length > 0 && priced.length === calls.length },
    tokens: { input_known: withIn.length, input_total: sum(withIn, 'input_tokens'), output_known: withOut.length, output_total: sum(withOut, 'output_tokens') },
  };
}

/** Canonical graph → the row payload public.zevir_persist_graphs expects. */
export function graphRecord(graph, { workspaceId, productId = null, projectId = null, ingestRunId = null, requireSuperset = false }) {
  const id = graphId(workspaceId, graph.source_kind, graph.graph_key);
  return {
    id,
    workspace_id: workspaceId,
    product_id: productId,
    project_id: projectId,
    schema_version: graph.schema_version,
    adapter_version: graph.adapter_version,
    source_kind: graph.source_kind,
    source_version: graph.source_version,
    graph_key: graph.graph_key,
    source_trace_id: graph.source_trace_id,
    root_node_id: graph.root ? nodeId(id, graph.root) : null,
    status: graph.status,
    graph_hash: graph.graph_hash,
    completeness: graph.completeness,
    summary: summarizeGraph(graph),
    capture_started_at: graph.capture_started_at,
    capture_ended_at: graph.capture_ended_at,
    ingest_run_id: ingestRunId,
    require_superset: requireSuperset,
    nodes: graph.nodes.map((n) => ({ ...n, id: nodeId(id, n.stable_key) })),
    edges: graph.edges.map((e) => ({ id: edgeId(id, e), source_node_id: nodeId(id, e.source), target_node_id: nodeId(id, e.target), kind: e.kind, ordinal: e.ordinal, attributes: e.attributes })),
    evidence: graph.evidence.map((r) => {
      const { node, ...rest } = r;
      return { ...rest, id: evidenceId(id, r), node_id: node ? nodeId(id, node) : null };
    }),
  };
}

// ------------------------------------------------------------- ingest runs
function runOut(run) {
  return { id: run.id, workspace_id: run.workspace_id, product_id: run.product_id, source_kind: run.source_kind, source_version: run.source_version, adapter_version: run.adapter_version, schema_version: run.schema_version, idempotency_key: run.idempotency_key, payload_hash: run.payload_hash, status: run.status, received_count: run.received_count, accepted_count: run.accepted_count, rejected_count: run.rejected_count, error_code: run.error_code, error_detail: run.error_detail, result: run.result || {}, started_at: run.started_at, completed_at: run.completed_at };
}
export { runOut };

/**
 * Claims the idempotency key. An identical completed run is returned as-is
 * (reused); a run in flight is a 409; a failed or abandoned run is retaken.
 */
export async function claimRun(admin, row) {
  const { data, error } = await admin.from('zevir_ingest_runs').insert(row).select('*').single();
  if (!error) return { run: data, reused: false };
  if (error.code !== '23505') throw error;
  const { data: existing } = await admin.from('zevir_ingest_runs').select('*').eq('workspace_id', row.workspace_id).eq('idempotency_key', row.idempotency_key).maybeSingle();
  if (!existing) throw error;
  if (existing.payload_hash !== row.payload_hash) throw new ApiError(422, 'This idempotency key was already used for a different payload.', 'IDEMPOTENCY_KEY_REUSED');
  if (existing.status === 'succeeded' || existing.status === 'partial') return { run: existing, reused: true };
  const stale = Date.now() - Date.parse(existing.started_at) > STALE_RUN_MS;
  if (existing.status === 'running' && !stale) throw new ApiError(409, 'An identical ingestion is already running. Retry shortly.', 'INGEST_IN_PROGRESS');
  const { data: retaken } = await admin
    .from('zevir_ingest_runs')
    .update({ status: 'running', started_at: new Date().toISOString(), completed_at: null, error_code: null, error_detail: null, received_count: row.received_count, accepted_count: 0, rejected_count: 0, result: {}, created_by: row.created_by ?? null })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .select('*')
    .single();
  if (!retaken) throw new ApiError(409, 'An identical ingestion is already running. Retry shortly.', 'INGEST_IN_PROGRESS');
  return { run: retaken, reused: false };
}

async function finishRun(admin, runId, patch) {
  const { data, error } = await admin.from('zevir_ingest_runs').update({ ...patch, completed_at: new Date().toISOString() }).eq('id', runId).select('*').single();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------- persistence
function chunks(records) {
  const out = [];
  let current = [];
  let nodes = 0;
  for (const r of records) {
    if (current.length && (current.length >= LIMITS.maxGraphsPerPersistCall || nodes + r.nodes.length > LIMITS.maxNodesPerPersistCall)) {
      out.push(current);
      current = [];
      nodes = 0;
    }
    current.push(r);
    nodes += r.nodes.length;
  }
  if (current.length) out.push(current);
  return out;
}

/** Writes graph records through the atomic SQL function. Returns [{ id, graph_key, outcome }]. */
export async function persistGraphs(admin, records) {
  const outcomes = [];
  for (const batch of chunks(records)) {
    const { data, error } = await admin.rpc('zevir_persist_graphs', { p_graphs: batch });
    if (error) {
      if (/ZEVIR_[A-Z_]+/.test(error.message || '')) throw new ApiError(422, `ZevIR rejected the graph: ${error.message.match(/ZEVIR_[A-Z_]+[^\n]*/)[0].slice(0, 300)}`, 'ZEVIR_INVARIANT');
      throw error;
    }
    outcomes.push(...(data || []));
  }
  return outcomes;
}

const tally = (outcomes) => outcomes.reduce((acc, o) => ((acc[o.outcome] = (acc[o.outcome] || 0) + 1), acc), { created: 0, replaced: 0, unchanged: 0, conflict: 0 });

// --------------------------------------------------------- engine projection
/**
 * Projects a product's engine traces into ZevIR (shadow). Deterministic:
 * the same evidence yields the same idempotency key, the same graphs and the
 * same hashes, so a rebuild with nothing new writes nothing. Graphs whose
 * engine trace is gone are pruned when `prune` is set (full rebuilds only).
 */
export async function projectEngineProduct({ admin, product, userId = null, traces = null, prune = true }) {
  let rows = traces;
  if (!rows) {
    const { data, error } = await admin.from('engine_traces').select(ENGINE_TRACE_COLUMNS).eq('product_id', product.id).order('created_at', { ascending: true }).limit(LIMITS.maxEngineTraces + 1);
    if (error) throw error;
    rows = data || [];
  }
  if (rows.length > LIMITS.maxEngineTraces) throw new ApiError(413, `A product projection is bounded to ${LIMITS.maxEngineTraces} traces.`, 'PAYLOAD_TOO_LARGE');
  const { graphs, rejected } = engineTracesToGraphs(rows, { product });
  const payloadHash = sha256Json({ product_id: product.id, prune, graphs: graphs.map((g) => g.graph_hash).sort(), rejected: rejected.map((r) => r.source_trace_id).sort() });
  const { run, reused } = await claimRun(admin, {
    workspace_id: product.workspace_id,
    product_id: product.id,
    source_kind: 'zevqora_engine',
    source_version: null,
    adapter_version: ADAPTER_VERSIONS.zevqora_engine,
    schema_version: SCHEMA_VERSION,
    idempotency_key: `engine:${product.id}:${payloadHash.slice(0, 48)}`,
    payload_hash: payloadHash,
    status: 'running',
    received_count: rows.length,
    created_by: userId,
  });
  if (reused) return { run: runOut(run), reused: true };

  try {
    // Only send graphs whose hash changed; unchanged ones would no-op in SQL anyway.
    const { data: existing, error } = await admin.from('zevir_graphs').select('id,graph_hash').eq('product_id', product.id).eq('source_kind', 'zevqora_engine');
    if (error) throw error;
    const known = new Map((existing || []).map((g) => [g.id, g.graph_hash]));
    const records = graphs.map((g) => graphRecord(g, { workspaceId: product.workspace_id, productId: product.id, projectId: product.project_id || null, ingestRunId: run.id }));
    const changed = records.filter((r) => known.get(r.id) !== r.graph_hash);
    const outcomes = await persistGraphs(admin, changed);
    const written = tally(outcomes);
    const counts = { ...written, unchanged: written.unchanged + records.length - changed.length };
    let pruned = 0;
    if (prune) {
      const { data: n, error: pruneError } = await admin.rpc('zevir_prune_graphs', { p_workspace_id: product.workspace_id, p_product_id: product.id, p_source_kind: 'zevqora_engine', p_keep: records.map((r) => r.id) });
      if (pruneError) throw pruneError;
      pruned = Number(n) || 0;
    }
    const status = rejected.length ? (graphs.length ? 'partial' : 'failed') : 'succeeded';
    const done = await finishRun(admin, run.id, {
      status,
      accepted_count: graphs.length,
      rejected_count: rejected.length,
      error_code: rejected.length ? 'TRACES_REJECTED' : null,
      error_detail: rejected.length ? rejected.slice(0, 3).map((r) => `${r.source_trace_id}: ${r.reason}`).join(' | ').slice(0, 2000) : null,
      result: { counts, pruned, graphs: graphs.length, rejected: rejected.slice(0, 20) },
    });
    return { run: runOut(done), reused: false };
  } catch (error) {
    await finishRun(admin, run.id, { status: 'failed', error_code: error?.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'PERSIST_FAILED', error_detail: String(error?.message || error).slice(0, 2000) }).catch(() => undefined);
    throw error;
  }
}

// ------------------------------------------------------------ external batch
const EXTERNAL = { otel_genai: otelGenAiToGraphs, openinference: openInferenceToGraphs };

/**
 * Ingests one bounded external trace batch. A trace already stored is
 * replaced only by a graph that contains every node it had (a more complete
 * view of the same trace); anything else is reported as a conflict and the
 * stored graph is kept. Cross-batch span assembly is not supported in Part 1.
 */
export async function ingestExternal({ admin, envelope, product = null, userId = null, idempotencyKey = null }) {
  const workspaceId = envelope.workspace_id;
  const sourceKind = envelope.source_kind;
  const payloadHash = sha256Json({ source_kind: sourceKind, source_version: envelope.source_version ?? null, product_id: product?.id ?? null, payload: envelope.payload });
  const { run, reused } = await claimRun(admin, {
    workspace_id: workspaceId,
    product_id: product?.id ?? null,
    source_kind: sourceKind,
    source_version: envelope.source_version ?? null,
    adapter_version: ADAPTER_VERSIONS[sourceKind],
    schema_version: SCHEMA_VERSION,
    idempotency_key: idempotencyKey ? `client:${idempotencyKey}` : `auto:${sourceKind}:${payloadHash.slice(0, 48)}`,
    payload_hash: payloadHash,
    status: 'running',
    received_count: 0,
    created_by: userId,
  });
  if (reused) return { run: runOut(run), reused: true };

  let parsed;
  try {
    parsed = EXTERNAL[sourceKind](envelope.payload, { workspaceId, sourceVersion: envelope.source_version ?? null });
  } catch (error) {
    const bad = error instanceof PayloadError;
    await finishRun(admin, run.id, { status: 'failed', error_code: bad ? 'BAD_PAYLOAD' : 'ADAPTER_FAILED', error_detail: String(error?.message || error).slice(0, 2000) }).catch(() => undefined);
    if (bad) throw new ApiError(422, error.message, 'BAD_PAYLOAD');
    throw error;
  }

  try {
    const records = parsed.graphs.map((g) => graphRecord(g, { workspaceId, productId: product?.id ?? null, projectId: product?.project_id ?? null, ingestRunId: run.id, requireSuperset: true }));
    const outcomes = await persistGraphs(admin, records);
    const counts = tally(outcomes);
    const conflicts = outcomes.filter((o) => o.outcome === 'conflict').map((o) => ({ source_trace_id: o.graph_key.replace(/^trace:/, ''), reason: 'trace already stored with nodes this batch does not contain; send the complete trace' }));
    const rejected = [...parsed.rejected, ...conflicts];
    const accepted = outcomes.length - conflicts.length;
    const status = rejected.length ? (accepted ? 'partial' : 'failed') : 'succeeded';
    const done = await finishRun(admin, run.id, {
      status,
      received_count: parsed.received,
      accepted_count: accepted,
      rejected_count: rejected.length,
      error_code: rejected.length ? (conflicts.length ? 'TRACE_CONFLICT' : 'TRACES_REJECTED') : null,
      error_detail: rejected.length ? rejected.slice(0, 3).map((r) => `${r.source_trace_id ?? '?'}: ${r.reason}`).join(' | ').slice(0, 2000) : null,
      result: { counts, span_count: parsed.spanCount, graphs: outcomes.map((o) => ({ id: o.id, graph_key: o.graph_key, outcome: o.outcome })).slice(0, 200), rejected: rejected.slice(0, 20) },
    });
    return { run: runOut(done), reused: false };
  } catch (error) {
    await finishRun(admin, run.id, { status: 'failed', error_code: error?.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'PERSIST_FAILED', error_detail: String(error?.message || error).slice(0, 2000) }).catch(() => undefined);
    throw error;
  }
}
