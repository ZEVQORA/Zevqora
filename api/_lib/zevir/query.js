/**
 * ZevIR read model. Callers authorize the workspace first; every query here
 * is additionally scoped by graph id, and every list is paginated and capped.
 */
import { ApiError } from '../http.js';
import { LIMITS } from './contracts.js';

const GRAPH_COLUMNS = 'id,workspace_id,project_id,product_id,schema_version,adapter_version,source_kind,source_version,graph_key,source_trace_id,root_node_id,status,node_count,edge_count,graph_hash,completeness,summary,capture_started_at,capture_ended_at,ingest_run_id,created_at,updated_at';
const NODE_COLUMNS = 'id,graph_id,stable_key,kind,name,operation,started_at,ended_at,duration_ms,status,cost_usd,cost_source,latency_ms,ttft_ms,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,task_success,trust_class,data_sensitivity,action_risk,attributes';
const EDGE_COLUMNS = 'id,graph_id,source_node_id,target_node_id,kind,ordinal,attributes';
const EVIDENCE_COLUMNS = 'id,graph_id,node_id,source_kind,source_id,source_trace_id,source_span_id,source_hash,adapter_version,schema_version,locator,content_hash,redaction_state,captured_at';

export function page(query, { defaultLimit = 100 } = {}) {
  const rawLimit = query.get('limit');
  const rawOffset = query.get('offset');
  const limit = rawLimit === null ? defaultLimit : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.pageMax) throw new ApiError(400, `limit must be an integer between 1 and ${LIMITS.pageMax}.`, 'VALIDATION');
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new ApiError(400, 'offset must be a non-negative integer.', 'VALIDATION');
  return { limit, offset };
}

async function many(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** The graph row, or null. Authorization is the caller's job (it needs the workspace id from here). */
export async function findGraph(admin, graphId) {
  const { data, error } = await admin.from('zevir_graphs').select(GRAPH_COLUMNS).eq('id', graphId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function listGraphs(admin, { workspaceId, productId = null, sourceKind = null, limit, offset }) {
  let q = admin.from('zevir_graphs').select(GRAPH_COLUMNS).eq('workspace_id', workspaceId);
  if (productId) q = q.eq('product_id', productId);
  if (sourceKind) q = q.eq('source_kind', sourceKind);
  return many(q.order('updated_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + limit - 1));
}

export async function listNodes(admin, graphId, { kind = null, limit, offset }) {
  let q = admin.from('zevir_nodes').select(NODE_COLUMNS).eq('graph_id', graphId);
  if (kind) q = q.eq('kind', kind);
  return many(q.order('kind', { ascending: true }).order('stable_key', { ascending: true }).range(offset, offset + limit - 1));
}

export async function listEdges(admin, graphId, { kind = null, limit, offset }) {
  let q = admin.from('zevir_edges').select(EDGE_COLUMNS).eq('graph_id', graphId);
  if (kind) q = q.eq('kind', kind);
  return many(q.order('source_node_id', { ascending: true }).order('kind', { ascending: true }).order('target_node_id', { ascending: true }).range(offset, offset + limit - 1));
}

export async function listEvidence(admin, graphId, { nodeId = null, limit, offset }) {
  let q = admin.from('zevir_evidence_refs').select(EVIDENCE_COLUMNS).eq('graph_id', graphId);
  if (nodeId) q = q.eq('node_id', nodeId);
  return many(q.order('node_id', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1));
}

/** One node with its provenance and its immediate edges (bounded). */
export async function nodeDetail(admin, graphId, nodeId) {
  const { data: node, error } = await admin.from('zevir_nodes').select(NODE_COLUMNS).eq('graph_id', graphId).eq('id', nodeId).maybeSingle();
  if (error) throw error;
  if (!node) return null;
  const [evidence, outgoing, incoming] = await Promise.all([
    many(admin.from('zevir_evidence_refs').select(EVIDENCE_COLUMNS).eq('graph_id', graphId).eq('node_id', nodeId).order('id', { ascending: true }).limit(50)),
    many(admin.from('zevir_edges').select(EDGE_COLUMNS).eq('graph_id', graphId).eq('source_node_id', nodeId).order('kind', { ascending: true }).limit(LIMITS.pageMax)),
    many(admin.from('zevir_edges').select(EDGE_COLUMNS).eq('graph_id', graphId).eq('target_node_id', nodeId).order('kind', { ascending: true }).limit(LIMITS.pageMax)),
  ]);
  return { node, evidence, outgoing, incoming };
}

/** Bounded neighborhood (depth ≤ 6, nodes ≤ 500). An oversized neighborhood is an error, never a silent truncation. */
export async function neighborhood(admin, graphId, nodeId, { depth, maxNodes, direction }) {
  const { data, error } = await admin.rpc('zevir_neighborhood', { p_graph_id: graphId, p_node_id: nodeId, p_depth: depth, p_max_nodes: maxNodes, p_direction: direction });
  if (error) {
    if (/ZEVIR_(DEPTH|NODE)_LIMIT|ZEVIR_DIRECTION/.test(error.message || '')) throw new ApiError(400, error.message.replace(/^.*?(ZEVIR_)/, '$1').slice(0, 200), 'VALIDATION');
    throw error;
  }
  if (!data?.found) throw new ApiError(404, 'Node not found in this graph.', 'NOT_FOUND');
  if (data.overflow) {
    throw new ApiError(422, `The neighborhood reaches ${data.reached} nodes, more than max_nodes=${data.max_nodes}. Lower depth or raise max_nodes (≤ ${LIMITS.neighborhoodMaxNodes}).`, 'NEIGHBORHOOD_TOO_LARGE', { reached: data.reached, max_nodes: data.max_nodes, depth: data.depth });
  }
  const strip = ({ workspace_id: _w, created_at: _c, ...rest }) => rest;
  return { center: nodeId, depth: data.depth, direction, nodes: (data.nodes || []).map(strip), edges: (data.edges || []).map(strip) };
}

export async function latestRun(admin, { workspaceId, productId }) {
  const { data, error } = await admin.from('zevir_ingest_runs').select('*').eq('workspace_id', workspaceId).eq('product_id', productId).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function findRun(admin, runId) {
  const { data, error } = await admin.from('zevir_ingest_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw error;
  return data || null;
}
