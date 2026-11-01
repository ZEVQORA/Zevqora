/**
 * Optimization Intelligence (vNext Part 2B), behind `optimization_intelligence_vnext`
 * (and `verified_optimization_vnext`).
 *
 *   POST /api/optimize/runs/:runId/searches            start a plan search (idempotent on its inputs)
 *   GET  /api/optimize/runs/:runId/searches            searches of a run
 *   GET  /api/optimize/searches/:id                    search report (plans, calibration, frontier, decisions)
 *   POST /api/optimize/searches/:id/calibrate          next bounded calibration batch (continuation flag)
 *   POST /api/optimize/searches/:id/replay             next bounded full-replay batch; computes the frontier
 *   POST /api/optimize/searches/:id/cancel             cancel (terminal)
 *   POST /api/optimize/searches/:id/decision           apply a decision policy to the frontier
 *   GET  /api/optimize/plans/:planId                   one plan with its full explanation
 *   POST /api/optimize/plans/:planId/promote           send an executable, uncalibrated or unpromising plan to full replay
 *   GET  /api/optimize/products/:id/bad-day-profiles   profiles
 *   POST /api/optimize/products/:id/bad-day-profiles   create a profile (idempotent on its hash)
 *   POST /api/optimize/plans/:planId/bad-day           Bad-Day Replay of a VERIFIED plan
 *
 * Every write is server-side with the service role after a membership check;
 * other workspaces get 404. Requests never carry gate thresholds.
 */
import { emitProductEvent, emitVerdicts } from '../analytics/product-events.js';
import { on } from '../router.js';
import { ApiError, readJson, uuid } from '../http.js';
import { requireUser, requireWorkspaceRole, rateLimit } from '../auth.js';
import { listDiagnoses } from '../optimize/store.js';
import { caseOut } from '../optimize/report.js';
import { calibrateSearch, cancelSearch, createProfile, decide, intelligenceEnabled, replaySearch, runBadDay, startSearch, plansOf } from '../optimize/search-store.js';
import { badDayOut, currentDecision, planOut, searchOut, searchReport } from '../optimize/intelligence.js';
import { SCENARIOS } from '../optimize/badday.js';
import { DEFAULT_BOUNDS, HARD_BOUNDS } from '../optimize/search.js';
import { POLICIES } from '../optimize/pareto.js';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

async function member(admin, user, workspaceId, minRole, what) {
  try {
    await requireWorkspaceRole(admin, workspaceId, user.id, minRole);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, `${what} not found.`, 'NOT_FOUND');
    throw error;
  }
  if (!(await intelligenceEnabled(admin, workspaceId))) throw new ApiError(403, 'Optimization Intelligence is not enabled for this workspace.', 'INTELLIGENCE_DISABLED');
}

async function loadRun(admin, user, id, minRole) {
  const { data } = await admin.from('optimization_runs').select('*').eq('id', uuid(id, 'run')).maybeSingle();
  if (!data) throw new ApiError(404, 'Run not found.', 'NOT_FOUND');
  await member(admin, user, data.workspace_id, minRole, 'Run');
  return data;
}
async function loadSearch(admin, user, id, minRole) {
  const { data } = await admin.from('plan_searches').select('*').eq('id', uuid(id, 'search')).maybeSingle();
  if (!data) throw new ApiError(404, 'Search not found.', 'NOT_FOUND');
  await member(admin, user, data.workspace_id, minRole, 'Search');
  return data;
}
async function loadPlan(admin, user, id, minRole) {
  const { data } = await admin.from('execution_plans').select('*').eq('id', uuid(id, 'plan')).maybeSingle();
  if (!data) throw new ApiError(404, 'Plan not found.', 'NOT_FOUND');
  await member(admin, user, data.workspace_id, minRole, 'Plan');
  return data;
}
async function loadProduct(admin, user, id, minRole) {
  const { data } = await admin.from('engine_products').select('*').eq('id', uuid(id, 'product')).maybeSingle();
  if (!data || data.archived_at) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
  await member(admin, user, data.workspace_id, minRole, 'Product');
  return data;
}

async function report(admin, search) {
  const run = must(await admin.from('optimization_runs').select('*').eq('id', search.run_id).single());
  const [plans, calibrations, decisions, badDays, evaluations, diagnoses] = await Promise.all([
    plansOf(admin, search.id),
    admin.from('plan_calibrations').select('*').eq('search_id', search.id).order('round', { ascending: true }).then(must),
    admin.from('plan_decisions').select('*').eq('search_id', search.id).order('created_at', { ascending: false }).then(must),
    admin.from('bad_day_results').select('*').eq('search_id', search.id).order('created_at', { ascending: true }).then(must),
    admin.from('engine_evaluations').select('*').eq('search_id', search.id).then(must),
    listDiagnoses(admin, run),
  ]);
  return searchReport({ search, plans, calibrations, decisions, badDays, evaluations, diagnoses });
}

/** Stage-completion product events; every plan's verdict is recorded once, keyed by plan id. */
async function stageEvents(admin, { stage, search, user }) {
  const plans = must(await admin.from('execution_plans').select('id,status,verdict').eq('search_id', search.id));
  if (stage === 'calibrate') {
    const rejected = plans.filter((p) => p.status === 'CALIBRATION_REJECTED').length;
    const calibrated = new Set(must(await admin.from('plan_calibrations').select('plan_id').eq('search_id', search.id)).map((c) => c.plan_id)).size;
    await emitProductEvent(admin, { event: 'calibration_completed', workspaceId: search.workspace_id, userId: user.id, subjectType: 'plan_search', subjectId: search.id, properties: { calibrated, rejected }, dedupeKey: `calibration_completed:${search.id}` });
    return;
  }
  const judged = plans.filter((p) => p.verdict);
  await emitProductEvent(admin, { event: 'full_replay_completed', workspaceId: search.workspace_id, userId: user.id, subjectType: 'plan_search', subjectId: search.id, properties: { replayed: judged.length, verified: judged.filter((p) => p.verdict === 'VERIFIED').length, rejected: judged.filter((p) => p.verdict === 'REJECTED').length, incomplete: judged.filter((p) => p.verdict === 'INCOMPLETE').length }, dedupeKey: `full_replay_completed:${search.id}` });
  await emitVerdicts(admin, { workspaceId: search.workspace_id, userId: user.id, stage: 'full_replay', items: judged.map((p) => ({ subjectType: 'execution_plan', id: p.id, verdict: p.verdict })) });
}

on('POST', '/api/optimize/runs/:runId/searches', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'member');
  rateLimit(`optimize-search:${user.id}`, { limit: 6, windowMs: 60_000 });
  const body = await readJson(request);
  const out = await startSearch(admin, { run, user, bounds: body?.bounds || {}, seed: body?.seed || undefined });
  await emitProductEvent(admin, { event: 'plan_search_started', workspaceId: run.workspace_id, userId: user.id, subjectType: 'plan_search', subjectId: out.search.id, properties: { generated: out.search.generation?.generated ?? undefined, reused: Boolean(out.reused) }, dedupeKey: `plan_search_started:${out.search.id}` });
  return { search: searchOut(out.search), reused: out.reused };
});

on('GET', '/api/optimize/runs/:runId/searches', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const run = await loadRun(admin, user, params.runId, 'viewer');
  const rows = must(await admin.from('plan_searches').select('*').eq('run_id', run.id).order('created_at', { ascending: false }).limit(20));
  return { searches: rows.map(searchOut), defaults: { bounds: DEFAULT_BOUNDS, hard_bounds: HARD_BOUNDS, policies: Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, v.rule])) } };
});

on('GET', '/api/optimize/searches/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  return report(admin, await loadSearch(admin, user, params.id, 'viewer'));
});

for (const [stage, fn] of [['calibrate', calibrateSearch], ['replay', replaySearch]]) {
  on('POST', `/api/optimize/searches/:id/${stage}`, async ({ request, params }) => {
    const { user, admin } = await requireUser(request);
    const search = await loadSearch(admin, user, params.id, 'member');
    rateLimit(`optimize-search-stage:${user.id}`, { limit: 20, windowMs: 60_000 });
    // The body is read and ignored: no request can choose samples, gates or budgets mid-search.
    await readJson(request);
    const out = await fn(admin, { search, user });
    if (out.done && !out.cancelled) await stageEvents(admin, { stage, search, user });
    return { search: searchOut(out.search), done: out.done, continuation: out.continuation, processed: out.processed, budget: out.budget || null, cancelled: Boolean(out.cancelled), in_progress: out.in_progress || null };
  });
}

on('POST', '/api/optimize/searches/:id/cancel', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const search = await loadSearch(admin, user, params.id, 'member');
  return { search: searchOut(await cancelSearch(admin, { search, user })) };
});

on('POST', '/api/optimize/searches/:id/decision', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const search = await loadSearch(admin, user, params.id, 'member');
  const body = await readJson(request);
  const row = await decide(admin, { search, user, policy: String(body?.policy || ''), params: body?.params || {} });
  if (row.outcome === 'SELECTED') await emitProductEvent(admin, { event: 'plan_selected', workspaceId: search.workspace_id, userId: user.id, subjectType: 'plan_decision', subjectId: row.id, properties: { policy: row.policy, outcome: row.outcome }, dedupeKey: `plan_selected:${row.id}` });
  return { decision: { id: row.id, policy: row.policy, params: row.policy_params, outcome: row.outcome, selected_plan_id: row.selected_plan_id, explanation: row.explanation, decision_hash: row.decision_hash, frontier_hash: row.frontier_hash } };
});

on('GET', '/api/optimize/plans/:planId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const plan = await loadPlan(admin, user, params.planId, 'viewer');
  const search = must(await admin.from('plan_searches').select('*').eq('id', plan.search_id).single());
  const run = must(await admin.from('optimization_runs').select('*').eq('id', plan.run_id).single());
  const [calibrations, badDays, decisions, selected, diagnoses] = await Promise.all([
    admin.from('plan_calibrations').select('*').eq('plan_id', plan.id).order('round', { ascending: true }).then(must),
    admin.from('bad_day_results').select('*').eq('plan_id', plan.id).then(must),
    admin.from('plan_decisions').select('*').eq('search_id', plan.search_id).order('created_at', { ascending: false }).limit(50).then(must),
    admin.from('execution_plans').select('id').eq('search_id', plan.search_id).eq('status', 'SELECTED').then(must),
    listDiagnoses(admin, run),
  ]);
  const out = planOut(plan, { diagnoses, calibrations, badDays, decision: currentDecision(decisions, selected[0]?.id), search });
  const { data: ev } = plan.evaluation_id ? await admin.from('engine_evaluations').select('id,status,gates,cases,evidence_version').eq('id', plan.evaluation_id).maybeSingle() : { data: null };
  return { ...out, full_replay: ev ? { evaluation_id: ev.id, status: ev.status, gates: ev.gates, cases: (ev.cases || []).map(caseOut), evidence_version: ev.evidence_version } : null };
});

on('POST', '/api/optimize/plans/:planId/promote', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const plan = await loadPlan(admin, user, params.planId, 'member');
  const search = must(await admin.from('plan_searches').select('*').eq('id', plan.search_id).single());
  if (['completed', 'budget_exhausted', 'cancelled', 'failed'].includes(search.status)) throw new ApiError(409, `Search is ${search.status}; start a new search.`, 'SEARCH_TERMINAL');
  if (plan.executable_status !== 'EXECUTABLE') throw new ApiError(422, 'Only an executable plan can be replayed.', 'PLAN_NOT_EXECUTABLE');
  const calibrated = must(await admin.from('plan_calibrations').select('outcome').eq('plan_id', plan.id));
  // A plan that failed a hard gate in calibration cannot be revived: the full replay could not pass.
  if (plan.status === 'CALIBRATION_REJECTED' || calibrated.some((c) => c.outcome === 'FAILED_HARD_GATE')) throw new ApiError(409, 'This plan failed a hard gate in calibration; the full replay could not pass it.', 'PLAN_REJECTED');
  if (!['PRUNED', 'CALIBRATION_READY'].includes(plan.status) || (plan.status === 'PRUNED' && !calibrated.length)) throw new ApiError(409, `A ${plan.status} plan cannot be promoted.`, 'PLAN_NOT_PROMOTABLE');
  const out = must(await admin.from('execution_plans').update({ status: 'FULL_REPLAY_READY', replay_state: { ...plan.replay_state, promoted_by_user: user.id, not_calibrated: null }, updated_at: new Date().toISOString() }).eq('id', plan.id).select('*').single());
  return { plan: { id: out.id, status: out.status } };
});

on('GET', '/api/optimize/products/:id/bad-day-profiles', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'viewer');
  const rows = must(await admin.from('bad_day_profiles').select('*').eq('product_id', product.id).order('created_at', { ascending: true }));
  return { profiles: rows, scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, { parameters: Object.fromEntries(Object.entries(v.params).map(([p, [def, min, max]]) => [p, { default: def, min, max }])), requires: v.requires }])) };
});

on('POST', '/api/optimize/products/:id/bad-day-profiles', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const product = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  return createProfile(admin, { product, user, scenario: String(body?.scenario || ''), parameters: body?.parameters || {}, seed: body?.seed || undefined });
});

on('POST', '/api/optimize/plans/:planId/bad-day', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const plan = await loadPlan(admin, user, params.planId, 'member');
  const body = await readJson(request);
  const { data: profile } = await admin.from('bad_day_profiles').select('*').eq('id', uuid(body?.profile_id, 'profile')).maybeSingle();
  if (!profile || profile.workspace_id !== plan.workspace_id) throw new ApiError(404, 'Profile not found.', 'NOT_FOUND');
  const out = await runBadDay(admin, { plan, profileRow: profile, user });
  return { result: badDayOut(out.result), reused: out.reused };
});
