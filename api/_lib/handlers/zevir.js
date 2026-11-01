/**
 * ZevIR Part 1 — canonical execution graphs, shadow mode.
 *
 *   POST /api/engine/products/:id/zevir/build      project the product's engine traces
 *   GET  /api/engine/products/:id/zevir            graphs + latest run for a product
 *   POST /api/zevir/ingest                         bounded OTel GenAI / OpenInference batch
 *   GET  /api/zevir/graphs                         list (workspace, optional product)
 *   GET  /api/zevir/graphs/:graphId                graph + summary
 *   GET  /api/zevir/graphs/:graphId/nodes          page of nodes
 *   GET  /api/zevir/graphs/:graphId/edges          page of edges
 *   GET  /api/zevir/graphs/:graphId/evidence       provenance (optionally per node)
 *   GET  /api/zevir/graphs/:graphId/nodes/:nodeId  one node, its evidence and edges
 *   GET  /api/zevir/graphs/:graphId/nodes/:nodeId/neighborhood   bounded BFS
 *   GET  /api/zevir/ingest-runs/:runId             one ingestion run
 *
 * The client never writes ZevIR rows: builds and ingests are server code with
 * the service role, after workspace membership is checked here. Nothing in
 * the proof loop reads ZevIR, so these routes cannot change a verdict.
 */
import { on } from '../router.js';
import { ApiError, readJson, str, uuid } from '../http.js';
import { requireUser, requireWorkspaceRole, rateLimit } from '../auth.js';
import { LIMITS, NODE_KINDS, EDGE_KINDS, SOURCE_KINDS } from '../zevir/contracts.js';
import { validateEnvelope } from '../zevir/validate.js';
import { ingestExternal, projectEngineProduct, runOut, zevirEnabled } from '../zevir/store.js';
import { emitProductEvent } from '../analytics/product-events.js';
import { findGraph, findRun, latestRun, listEdges, listEvidence, listGraphs, listNodes, neighborhood, nodeDetail, page } from '../zevir/query.js';

async function loadProduct(admin, user, productId, minRole) {
  const id = uuid(productId, 'product');
  const { data: product } = await admin.from('engine_products').select('id,workspace_id,project_id,name,archived_at').eq('id', id).maybeSingle();
  if (!product || product.archived_at) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
  await requireWorkspaceRole(admin, product.workspace_id, user.id, minRole);
  return product;
}

/** 404 for a graph in a workspace the caller is not a member of, so graph ids cannot be probed. */
async function loadGraph(admin, user, graphId) {
  const graph = await findGraph(admin, uuid(graphId, 'graph'));
  if (!graph) throw new ApiError(404, 'Graph not found.', 'NOT_FOUND');
  try {
    await requireWorkspaceRole(admin, graph.workspace_id, user.id, 'viewer');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, 'Graph not found.', 'NOT_FOUND');
    throw error;
  }
  return graph;
}

async function requireEnabled(admin, workspaceId) {
  if (!(await zevirEnabled(admin, workspaceId))) throw new ApiError(403, 'ZevIR shadow mode is not enabled for this workspace.', 'ZEVIR_DISABLED');
}

const enumParam = (query, name, allowed) => {
  const v = query.get(name);
  if (v === null || v === '') return null;
  if (!allowed.includes(v)) throw new ApiError(400, `${name} must be one of ${allowed.join(', ')}.`, 'VALIDATION');
  return v;
};

function intParam(query, name, { min, max, fallback }) {
  const raw = query.get(name);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, `${name} must be an integer between ${min} and ${max}.`, 'VALIDATION');
  return n;
}

// ---- engine projection -------------------------------------------------------------
on('POST', '/api/engine/products/:id/zevir/build', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'member');
  await requireEnabled(admin, product.workspace_id);
  rateLimit(`zevir-build:${user.id}`, { limit: 10, windowMs: 60_000 });
  const out = await projectEngineProduct({ admin, product, userId: user.id, prune: true });
  return { ...out, shadow: true };
});

on('GET', '/api/engine/products/:id/zevir', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'viewer');
  const { limit, offset } = page(query, { defaultLimit: 50 });
  const [enabled, graphs, run] = await Promise.all([zevirEnabled(admin, product.workspace_id), listGraphs(admin, { workspaceId: product.workspace_id, productId: product.id, limit, offset }), latestRun(admin, { workspaceId: product.workspace_id, productId: product.id })]);
  return { enabled, shadow: true, product_id: product.id, graphs, latest_run: run ? runOut(run) : null };
});

// ---- external ingestion --------------------------------------------------------------
on('POST', '/api/zevir/ingest', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const body = await readJson(request, { maxBytes: LIMITS.maxIngestBytes });
  if (body?.capture_content === true) throw new ApiError(422, 'Raw content capture is not available: ZevIR stores hashes and sizes only.', 'CONTENT_CAPTURE_UNSUPPORTED');
  const check = validateEnvelope(body);
  if (!check.ok) throw new ApiError(400, 'Invalid ZevIR ingestion envelope.', 'VALIDATION', { errors: check.errors });
  // The browser-supplied workspace is only a claim until membership is checked here.
  const workspaceId = uuid(body.workspace_id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'member');
  await requireEnabled(admin, workspaceId);
  rateLimit(`zevir-ingest:${user.id}`, { limit: 20, windowMs: 60_000 });
  let product = null;
  if (body.product_id) {
    const { data } = await admin.from('engine_products').select('id,workspace_id,project_id,archived_at').eq('id', uuid(body.product_id, 'product')).maybeSingle();
    if (!data || data.archived_at || data.workspace_id !== workspaceId) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
    product = data;
  }
  const header = request.headers.get('idempotency-key');
  const idempotencyKey = header ? str(header, { name: 'Idempotency-Key', min: 8, max: 120, pattern: /^[A-Za-z0-9._:-]+$/ }) : null;
  const out = await ingestExternal({ admin, envelope: { ...body, workspace_id: workspaceId }, product, userId: user.id, idempotencyKey });
  const runId = out?.run?.id || out?.id;
  if (runId) {
    const sourceKind = String(body.source_kind || 'otel').replace(/[^a-z_]/g, '').slice(0, 40) || 'otel';
    await emitProductEvent(admin, { event: 'trace_imported', workspaceId, userId: user.id, subjectType: 'zevir_ingest_run', subjectId: runId, properties: { source_kind: sourceKind }, dedupeKey: `trace_imported:zevir:${runId}` });
    await emitProductEvent(admin, { event: 'evidence_connected', workspaceId, userId: user.id, subjectType: 'workspace', subjectId: workspaceId, properties: { source_kind: sourceKind }, dedupeKey: `evidence_connected:${workspaceId}:${sourceKind}` });
  }
  return out;
});

on('GET', '/api/zevir/ingest-runs/:runId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await findRun(admin, uuid(params.runId, 'run'));
  if (!run) throw new ApiError(404, 'Run not found.', 'NOT_FOUND');
  try {
    await requireWorkspaceRole(admin, run.workspace_id, user.id, 'viewer');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, 'Run not found.', 'NOT_FOUND');
    throw error;
  }
  return runOut(run);
});

// ---- reads ----------------------------------------------------------------------------
on('GET', '/api/zevir/graphs', async ({ request, query }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(query.get('workspace_id'), 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const productId = query.get('product_id') ? uuid(query.get('product_id'), 'product') : null;
  const { limit, offset } = page(query, { defaultLimit: 50 });
  return listGraphs(admin, { workspaceId, productId, sourceKind: enumParam(query, 'source_kind', SOURCE_KINDS), limit, offset });
});

on('GET', '/api/zevir/graphs/:graphId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  return loadGraph(admin, user, params.graphId);
});

on('GET', '/api/zevir/graphs/:graphId/nodes', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const graph = await loadGraph(admin, user, params.graphId);
  return listNodes(admin, graph.id, { kind: enumParam(query, 'kind', NODE_KINDS), ...page(query) });
});

on('GET', '/api/zevir/graphs/:graphId/edges', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const graph = await loadGraph(admin, user, params.graphId);
  return listEdges(admin, graph.id, { kind: enumParam(query, 'kind', EDGE_KINDS), ...page(query) });
});

on('GET', '/api/zevir/graphs/:graphId/evidence', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const graph = await loadGraph(admin, user, params.graphId);
  const nodeId = query.get('node_id') ? uuid(query.get('node_id'), 'node') : null;
  return listEvidence(admin, graph.id, { nodeId, ...page(query) });
});

on('GET', '/api/zevir/graphs/:graphId/nodes/:nodeId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const graph = await loadGraph(admin, user, params.graphId);
  const detail = await nodeDetail(admin, graph.id, uuid(params.nodeId, 'node'));
  if (!detail) throw new ApiError(404, 'Node not found in this graph.', 'NOT_FOUND');
  return detail;
});

on('GET', '/api/zevir/graphs/:graphId/nodes/:nodeId/neighborhood', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const graph = await loadGraph(admin, user, params.graphId);
  const depth = intParam(query, 'depth', { min: 0, max: LIMITS.neighborhoodMaxDepth, fallback: 2 });
  const maxNodes = intParam(query, 'max_nodes', { min: 1, max: LIMITS.neighborhoodMaxNodes, fallback: 200 });
  const direction = enumParam(query, 'direction', ['in', 'out', 'both']) || 'both';
  return neighborhood(admin, graph.id, uuid(params.nodeId, 'node'), { depth, maxNodes, direction });
});
