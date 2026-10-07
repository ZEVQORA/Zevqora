/**
 * Verified Optimization Run (vNext Part 2A), behind `verified_optimization_vnext`.
 *
 *   GET  /api/optimize/products/:id                       status: flag, contracts, runs
 *   POST /api/optimize/products/:id/contracts             create/update the draft contract
 *   POST /api/optimize/products/:id/contracts/:cid/freeze freeze it (supersedes the previous frozen one)
 *   POST /api/optimize/products/:id/runs                  start a run on a frozen contract
 *   POST /api/optimize/runs/:runId/baseline               build the Verified Performance baseline
 *   POST /api/optimize/runs/:runId/diagnoses              deterministic diagnoses
 *   POST /api/optimize/runs/:runId/candidates             candidates from the diagnoses
 *   POST /api/optimize/runs/:runId/candidates/:planId/replay   replay + verdict under the contract
 *   GET  /api/optimize/runs/:runId/report                 executive + developer report
 *   POST /api/optimize/demo                               load the synthetic demo workload
 *
 * Every write is server-side with the service role after a membership check.
 * The client never sends gate thresholds: verdicts use the frozen contract.
 */
import { on } from '../router.js';
import { ApiError, readJson, uuid } from '../http.js';
import { requireUser, requireWorkspaceRole, rateLimit } from '../auth.js';
import { parseTraces } from '../product/traces.js';
import { buildBaseline, createRun, freezeContract, generateRunCandidates, listCandidates, listContracts, listDiagnoses, optimizeEnabled, replayCandidate, runDiagnoses, saveDraft, contractOut } from '../optimize/store.js';
import { buildReport, candidateOut, diagnosisOut, evaluationOut, snapshotOut } from '../optimize/report.js';
import { DEMO_NAME, DEMO_REQUIREMENTS, DEMO_ROOT, demoTraces } from '../optimize/demo.js';
import { DEFAULT_REQUIREMENTS } from '../optimize/contract.js';

async function requireEnabled(admin, workspaceId) {
  if (!(await optimizeEnabled(admin, workspaceId))) throw new ApiError(403, 'Verified Optimization is not enabled for this workspace.', 'OPTIMIZE_DISABLED');
}

async function loadProduct(admin, user, productId, minRole) {
  const { data: product } = await admin.from('engine_products').select('*').eq('id', uuid(productId, 'product')).maybeSingle();
  if (!product || product.archived_at) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
  await requireWorkspaceRole(admin, product.workspace_id, user.id, minRole);
  await requireEnabled(admin, product.workspace_id);
  return product;
}

/** 404 (not 403) for a run in another workspace, so run ids cannot be probed. */
async function loadRun(admin, user, runId, minRole) {
  const { data: run } = await admin.from('optimization_runs').select('*').eq('id', uuid(runId, 'run')).maybeSingle();
  if (!run) throw new ApiError(404, 'Run not found.', 'NOT_FOUND');
  try {
    await requireWorkspaceRole(admin, run.workspace_id, user.id, minRole);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, 'Run not found.', 'NOT_FOUND');
    throw error;
  }
  await requireEnabled(admin, run.workspace_id);
  return run;
}

async function runs(admin, productId) {
  const { data, error } = await admin.from('optimization_runs').select('*').eq('product_id', productId).order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}

on('GET', '/api/optimize/products/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { data: product } = await admin.from('engine_products').select('*').eq('id', uuid(params.id, 'product')).maybeSingle();
  if (!product || product.archived_at) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
  await requireWorkspaceRole(admin, product.workspace_id, user.id, 'viewer');
  const enabled = await optimizeEnabled(admin, product.workspace_id);
  if (!enabled) return { enabled: false, product_id: product.id, contracts: [], runs: [], defaults: DEFAULT_REQUIREMENTS };
  const [contracts, runList] = await Promise.all([listContracts(admin, product), runs(admin, product.id)]);
  return { enabled: true, product_id: product.id, contracts: contracts.map(contractOut), runs: runList, defaults: DEFAULT_REQUIREMENTS };
});

on('POST', '/api/optimize/products/:id/contracts', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'admin');
  const body = await readJson(request);
  return contractOut(await saveDraft(admin, { product, user, requirements: body?.requirements ?? null }));
});

on('POST', '/api/optimize/products/:id/contracts/:cid/freeze', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'admin');
  return contractOut(await freezeContract(admin, { product, contractId: uuid(params.cid, 'contract'), user }));
});

on('POST', '/api/optimize/products/:id/runs', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  return createRun(admin, { product, user, contractId: uuid(body?.contract_id, 'contract') });
});

on('POST', '/api/optimize/runs/:runId/baseline', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'member');
  rateLimit(`optimize-baseline:${user.id}`, { limit: 10, windowMs: 60_000 });
  const out = await buildBaseline(admin, { run, user });
  return { snapshot: snapshotOut(out.snapshot), reused: out.reused };
});

on('POST', '/api/optimize/runs/:runId/diagnoses', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'member');
  return (await runDiagnoses(admin, { run })).map(diagnosisOut);
});

on('GET', '/api/optimize/runs/:runId/diagnoses', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'viewer');
  return (await listDiagnoses(admin, run)).map(diagnosisOut);
});

on('POST', '/api/optimize/runs/:runId/candidates', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'member');
  const out = await generateRunCandidates(admin, { run });
  return { candidates: out.candidates.map(candidateOut), skipped: out.skipped, note: out.note || null };
});

on('GET', '/api/optimize/runs/:runId/candidates', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'viewer');
  return (await listCandidates(admin, run)).map(candidateOut);
});

on('POST', '/api/optimize/runs/:runId/candidates/:planId/replay', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'member');
  rateLimit(`optimize-replay:${user.id}`, { limit: 6, windowMs: 60_000 });
  // The body is read and deliberately ignored: no request can supply or loosen a gate.
  await readJson(request);
  const out = await replayCandidate(admin, { run, planId: uuid(params.planId, 'candidate'), user });
  return { evaluation: evaluationOut(out.evaluation), reused: out.reused };
});

on('GET', '/api/optimize/runs/:runId/report', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'viewer');
  const [{ data: contract }, { data: snapshot }, diagnoses, candidates, { data: evaluations }] = await Promise.all([
    admin.from('evaluation_contracts').select('*').eq('id', run.contract_id).maybeSingle(),
    run.baseline_snapshot_id ? admin.from('performance_snapshots').select('*').eq('id', run.baseline_snapshot_id).maybeSingle() : Promise.resolve({ data: null }),
    listDiagnoses(admin, run),
    listCandidates(admin, run),
    admin.from('engine_evaluations').select('*').eq('run_id', run.id).order('created_at', { ascending: true }),
  ]);
  return buildReport({ run, contract, snapshot, diagnoses, candidates, evaluations: evaluations || [] });
});

/** Loads the synthetic demo workload into a workspace (idempotent). Never customer data. */
on('POST', '/api/optimize/demo', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const body = await readJson(request);
  const workspaceId = uuid(body?.workspace_id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'admin');
  await requireEnabled(admin, workspaceId);
  let { data: product } = await admin.from('engine_products').select('*').eq('workspace_id', workspaceId).eq('root_path', DEMO_ROOT).is('archived_at', null).maybeSingle();
  if (!product) {
    const { data, error } = await admin.from('engine_products').insert({ workspace_id: workspaceId, name: DEMO_NAME, root_path: DEMO_ROOT, source: 'browser', created_by: user.id }).select('*').single();
    if (error) throw error;
    product = data;
    const { rows } = parseTraces({ traces: demoTraces() });
    const { error: tErr } = await admin.from('engine_traces').insert(rows.map((t) => ({ ...t, product_id: product.id, workspace_id: workspaceId })));
    if (tErr) throw tErr;
  }
  return { product_id: product.id, name: product.name, synthetic: true, suggested_requirements: DEMO_REQUIREMENTS };
});
