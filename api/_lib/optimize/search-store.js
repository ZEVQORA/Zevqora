/**
 * Plan search persistence and orchestration (vNext Part 2B). Server-only:
 * service role, after the route checked workspace membership and the flags.
 *
 * Stages are bounded synchronous calls with persisted state and an explicit
 * continuation (no queue): start → calibrate (repeat until done) → replay
 * (repeat until done) → frontier → decision. One stage runs at a time per
 * search (a database lease); executions are idempotent on their execution key,
 * so a refresh or retry never pays twice. Cancelled and budget-exhausted
 * searches stop cleanly and say what was and was not evaluated.
 */
import { randomUUID } from 'node:crypto';
import { ApiError } from '../http.js';
import { deterministicUuid } from '../product/hashing.js';
import { defaultCases, gradeOutput } from '../product/evaluator.js';
import { configHash, PLAN_VERSION } from '../product/strategies.js';
import { runPlanExecution } from '../product/run-plan.js';
import { loadPricing } from '../pricing.js';
import { allowedCandidateModels } from '../platform-compute.js';
import { normalizeRequirements } from './contract.js';
import { listDiagnoses, loadRunContext, platformCompute, runDiagnoses, verifiedEvidence, FLAG as OPTIMIZE_FLAG } from './store.js';
import { calibrationOrder, evaluationSet, generatePlans, normalizeBounds, searchHash, SearchError, SEARCH_VERSION } from './search.js';
import { finalRows } from './passes-intelligence.js';
import { COMPOSED_STRATEGY, executeComposedPlan, maxProviderCost } from './composed.js';
import { evaluatePlan, planMetrics } from './plan-verdict.js';
import { boundsAnalysis, decideCalibration, selectSample, CALIBRATION_LABEL } from './calibration.js';
import { applyPolicy, paretoFrontier, PolicyError } from './pareto.js';
import { badDayReplay, BadDayError, normalizeProfile } from './badday.js';

export const INTELLIGENCE_FLAG = 'optimization_intelligence_vnext';
export const DEFAULT_SEED = 'zevqora-search-v1';
const STAGE_SLICE_MS = 25_000;
const LOCK_TTL_S = 120;
const STALE_EXECUTION_MS = 15 * 60_000;
const TERMINAL = new Set(['completed', 'budget_exhausted', 'cancelled', 'failed']);

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

async function flagOn(admin, key, workspaceId) {
  const { data } = await admin.from('feature_flags').select('enabled,workspace_overrides').eq('key', key).maybeSingle();
  if (!data) return false;
  const o = data.workspace_overrides?.[workspaceId];
  return o === true || o === false ? o : Boolean(data.enabled);
}
/** Part 2B needs both its own flag and the Part 2A flag. */
export async function intelligenceEnabled(admin, workspaceId) {
  return (await flagOn(admin, OPTIMIZE_FLAG, workspaceId)) && (await flagOn(admin, INTELLIGENCE_FLAG, workspaceId));
}

const searchErr = (fn) => {
  try {
    return fn();
  } catch (error) {
    if (error instanceof SearchError || error instanceof PolicyError || error instanceof BadDayError) throw new ApiError(422, error.message, error.code || 'VALIDATION');
    throw error;
  }
};

// ---- shapes ------------------------------------------------------------------------
function passInstance(t, evaluationIds) {
  return {
    transformation_hash: t.hash,
    kind: t.kind,
    label: t.label,
    layer: t.layer,
    scope: t.scope,
    call_site: t.call_site,
    pass: t.pass,
    pass_version: t.pass_version,
    sources: t.sources,
    settings: t.settings,
    config: t.config,
    executable_status: t.executable_status,
    not_executable_reason: t.not_executable_reason,
    diagnosis_hashes: t.diagnosis_hashes,
    // Only the evaluation cases are needed to execute; the full affected count is kept.
    affected_trace_ids: t.affected_trace_ids.filter((id) => evaluationIds.has(id)),
    affected_trace_count: t.affected_trace_ids.length,
    affected_nodes: t.affected_nodes,
    risk_class: t.risk_class,
    implementation_complexity: t.implementation_complexity,
    rollback_complexity: t.rollback_complexity,
    required_evidence: t.required_evidence,
    missing_evidence: t.missing_evidence,
    expected_effects: t.expected_effects,
    protected_slices: t.protected_slices,
    falsifier: t.falsifier,
    rollback: t.rollback,
    materializer_hints: t.materializer_hints,
    metadata: t.metadata,
  };
}

/** The composition the executor runs: the stored pass instances, in order, with their hash. */
const compositionOf = (plan) => plan.pass_instances.map((p) => ({ ...p, hash: p.transformation_hash }));

// ---- start -------------------------------------------------------------------------
export async function startSearch(admin, { run, user, bounds: rawBounds = {}, seed = DEFAULT_SEED }) {
  const bounds = searchErr(() => normalizeBounds(rawBounds || {}));
  const cleanSeed = String(seed || DEFAULT_SEED).slice(0, 64);
  const { contract, product } = await loadRunContext(admin, run);
  const { evidence, stored } = await verifiedEvidence(admin, run, product, contract);
  let diagnoses = await listDiagnoses(admin, run);
  if (!diagnoses.length) diagnoses = await runDiagnoses(admin, { run });
  const hash = searchHash({ contractHash: contract.contract_hash, snapshotHash: stored.snapshot_hash, diagnoses, bounds, seed: cleanSeed });
  const { data: existing } = await admin.from('plan_searches').select('*').eq('run_id', run.id).eq('search_hash', hash).maybeSingle();
  if (existing) return { search: existing, reused: true };

  const [pricing, allowed, compute] = await Promise.all([loadPricing(admin), allowedCandidateModels(admin), platformCompute(admin)]);
  const requirements = normalizeRequirements(contract.requirements);
  const evaluation = evaluationSet(evidence.traces, { max: bounds.max_evaluation_set, seed: cleanSeed });
  const evalIds = new Set(evaluation.ids);
  const rows = evidence.traces.filter((t) => evalIds.has(t.id));
  const ctx = { traces: evidence.traces, history: finalRows(evidence.traces), pricing, allowedModels: new Set(allowed), platformCompute: compute, contract: { id: contract.id, hash: contract.contract_hash, requirements }, snapshot: { id: stored.id, snapshot_hash: stored.snapshot_hash } };
  const out = generatePlans({ diagnoses, ctx, bounds, contractHash: contract.contract_hash, snapshotHash: stored.snapshot_hash, evaluation, rows });

  const { data: search, error } = await admin
    .from('plan_searches')
    .insert({ workspace_id: product.workspace_id, product_id: product.id, run_id: run.id, contract_id: contract.id, contract_hash: contract.contract_hash, baseline_snapshot_id: stored.id, snapshot_hash: stored.snapshot_hash, search_version: SEARCH_VERSION, search_hash: hash, seed: cleanSeed, bounds, status: 'generated', evaluation_set: evaluation, evaluation_set_hash: evaluation.hash, generation: out.generation, spend: { provider_usd: 0, provider_spend_measurable: true, provider_calls: 0, calibration_samples: 0, replay_samples: 0, plans_calibrated: 0, plans_replayed: 0 }, created_by: user.id })
    .select('*')
    .single();
  if (error) {
    // A concurrent identical start won the unique (run, search_hash): return that search.
    const { data: raced } = await admin.from('plan_searches').select('*').eq('run_id', run.id).eq('search_hash', hash).maybeSingle();
    if (raced) return { search: raced, reused: true };
    throw error;
  }
  const diagId = new Map(diagnoses.map((d) => [d.diagnosis_hash, d.id]));
  const rowsOut = out.plans.map((p) => ({
    id: deterministicUuid(`zev.execution_plan:${search.id}:${p.plan_hash}`),
    workspace_id: product.workspace_id,
    product_id: product.id,
    search_id: search.id,
    run_id: run.id,
    contract_id: contract.id,
    contract_hash: contract.contract_hash,
    baseline_snapshot_id: stored.id,
    plan_version: 'execution_plan_v1',
    plan_hash: p.plan_hash,
    name: p.name.slice(0, 300),
    source_diagnosis_ids: p.source_diagnosis_hashes.map((h) => diagId.get(h)).filter(Boolean),
    pass_instances: p.ordered.map((t) => passInstance(t, evalIds)),
    status: p.status,
    executable_status: p.executable_status,
    priority: p.priority,
    estimated_effects: p.estimate ? { label: 'ESTIMATED — for search prioritisation only', ...p.estimate.effects, served_counts: p.estimate.served_counts, signature: p.estimate.signature, simulation: p.estimate.simulation } : { label: 'NOT ESTIMATED', reason: p.status === 'CONFLICTED' ? 'conflicting composition' : p.status === 'NEEDS_EVIDENCE' ? 'evidence missing' : 'not executable by the replay harness' },
    required_evidence: [...new Map(p.ordered.flatMap((t) => t.required_evidence).map((e) => [`${e.key}|${e.detail}`, e])).values()],
    missing_evidence: p.missing_evidence,
    risk_class: p.risk_class,
    implementation_complexity: p.implementation_complexity,
    rollback_complexity: p.rollback_complexity,
    compatibility_result: p.compatibility,
    conflict_reasons: p.conflict_reasons,
    replay_budget: {},
    replay_state: { status_reasons: p.status_reasons, blocked_reasons: p.blocked_reasons, pruned_by: p.pruned_by || null },
    materializer_hints: p.ordered.map((t) => ({ transformation_hash: t.hash, label: t.label, ...(t.materializer_hints || {}) })),
    rollback: [...p.ordered].reverse().map((t) => ({ transformation_hash: t.hash, label: t.label, rollback: t.rollback })),
    explanation: { generated_because: p.ordered.map((t) => ({ transformation: t.label, scope: t.scope, passes: t.sources.map((s) => `${s.pass}@${s.pass_version}`), diagnoses: t.sources.map((s) => `${s.diagnosis_family}`) })) },
  }));
  for (let i = 0; i < rowsOut.length; i += 50) must(await admin.from('execution_plans').insert(rowsOut.slice(i, i + 50)).select('id'));
  return { search, reused: false };
}

// ---- helpers --------------------------------------------------------------------------
async function reloadSearch(admin, id) {
  return must(await admin.from('plan_searches').select('*').eq('id', id).single());
}
async function plansOf(admin, searchId) {
  return must(await admin.from('execution_plans').select('*').eq('search_id', searchId).order('plan_hash', { ascending: true }));
}
async function updatePlan(admin, id, patch) {
  return must(await admin.from('execution_plans').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single());
}
async function updateSearch(admin, id, patch) {
  return must(await admin.from('plan_searches').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single());
}

/** Materializes an executable plan as one engine_plans row (shared by searches of the same run). */
async function materialize(admin, { search, plan, product, evaluationIds }) {
  if (plan.engine_plan_id) {
    const { data } = await admin.from('engine_plans').select('*').eq('id', plan.engine_plan_id).maybeSingle();
    if (data) return data;
  }
  const id = deterministicUuid(`zev.engine_plan:${search.run_id}:${plan.plan_hash}`);
  let { data: row } = await admin.from('engine_plans').select('*').eq('id', id).maybeSingle();
  if (!row) {
    const draft = { strategy: COMPOSED_STRATEGY, baseline_config: { evaluation_set_hash: search.evaluation_set_hash }, candidate_config: { plan_hash: plan.plan_hash, composition: plan.pass_instances }, sample_scope: evaluationIds, plan_version: PLAN_VERSION, max_budget_usd: Number(search.bounds.max_provider_spend_usd) };
    const { data, error } = await admin
      .from('engine_plans')
      .insert({ id, product_id: product.id, workspace_id: product.workspace_id, finding_id: null, ...draft, status: 'READY', reason: `Execution plan: ${plan.name}`.slice(0, 500), expected_mechanism: plan.pass_instances.map((p) => p.label).join(' → '), risk: plan.risk_class, fallback: 'retain_baseline', required_evidence: plan.missing_evidence, config_hash: configHash(draft), blocked_reason: null, run_id: search.run_id, optimization_pass: 'plan_search', pass_version: SEARCH_VERSION, contract_hash: search.contract_hash, baseline_snapshot_id: search.baseline_snapshot_id, executable_status: 'EXECUTABLE', candidate_config_hash: plan.plan_hash, lineage: { execution_plan: true, plan_hash: plan.plan_hash, label: 'EXECUTION PLAN — verdict comes only from replay under the frozen contract' } })
      .select('*')
      .single();
    if (error) {
      ({ data: row } = await admin.from('engine_plans').select('*').eq('id', id).maybeSingle());
      if (!row) throw error;
    } else row = data;
  }
  await updatePlan(admin, plan.id, { engine_plan_id: row.id });
  return row;
}

function baselineGrades(rows) {
  const byTrace = new Map(rows.map((t) => [t.id, t]));
  const cases = defaultCases(rows.map((t) => ({ baseline_trace_id: t.id })), byTrace);
  const out = new Map();
  for (const c of cases) {
    const g = gradeOutput(byTrace.get(c.baseline_trace_id).output_text, c.expected, c.graders);
    out.set(c.baseline_trace_id, { score: g.score, passed: g.passed });
  }
  return out;
}

/** Measured provider spend of an execution; null when a provider call has no known cost. */
function providerSpend(execution) {
  let usd = 0;
  let calls = 0;
  for (const s of execution.sample_results || []) {
    if (!(s.provider_call_count > 0)) continue;
    calls += s.provider_call_count;
    if (s.cost_usd === null || s.cost_usd === undefined) return { usd: null, calls };
    usd += Number(s.cost_usd);
  }
  return { usd, calls };
}

async function execute(admin, { user, product, search, enginePlan, plan, sampleIds, traces, stage, budgetUsd }) {
  const runPlan = { ...enginePlan, sample_scope: sampleIds, max_budget_usd: budgetUsd };
  const { execution, reused } = await runPlanExecution({ admin, user, product, plan: runPlan, traces, extra: { run_id: search.run_id, contract_hash: search.contract_hash, execution_plan_id: plan.id, search_id: search.id, stage }, executor: executeComposedPlan });
  if (reused && execution.status === 'RUNNING') {
    if (Date.now() - Date.parse(execution.created_at || execution.started_at || 0) < STALE_EXECUTION_MS) return { execution, inProgress: true };
    // A crashed request left it RUNNING longer than any function can live: mark it failed and run again.
    await admin.from('engine_executions').update({ status: 'FAILED', error_category: 'stale', error_detail: 'Abandoned RUNNING execution (request interrupted).', completed_at: new Date().toISOString() }).eq('id', execution.id).eq('status', 'RUNNING');
    const again = await runPlanExecution({ admin, user, product, plan: runPlan, traces, extra: { run_id: search.run_id, contract_hash: search.contract_hash, execution_plan_id: plan.id, search_id: search.id, stage }, executor: executeComposedPlan, forceRerun: true });
    return { execution: again.execution, inProgress: false, reused: false };
  }
  return { execution, inProgress: false, reused };
}

function budgetReport(plans, reason, search) {
  const by = (s) => plans.filter((p) => s.includes(p.status)).map((p) => ({ id: p.id, name: p.name, status: p.status }));
  return {
    code: 'SEARCH_BUDGET_EXHAUSTED',
    reason,
    spend: search.spend,
    bounds: search.bounds,
    evaluated: by(['VERIFIED', 'PARETO_FRONTIER', 'SELECTED', 'REJECTED', 'INCOMPLETE', 'CALIBRATION_REJECTED']),
    not_evaluated: by(['CALIBRATION_READY', 'CALIBRATING', 'FULL_REPLAY_READY', 'REPLAYING']),
    note: 'Work stopped before spending beyond the search budget. Plans listed as not evaluated have no verdict; nothing about them is claimed.',
  };
}

async function withLock(admin, search, fn) {
  const token = randomUUID();
  const { data: got, error } = await admin.rpc('plan_search_lock', { p_search_id: search.id, p_token: token, p_ttl_seconds: LOCK_TTL_S });
  if (error) throw error;
  if (!got) throw new ApiError(409, 'Another stage of this search is running. Try again when it finishes.', 'STAGE_IN_PROGRESS');
  try {
    return await fn();
  } finally {
    await admin.rpc('plan_search_unlock', { p_search_id: search.id, p_token: token });
  }
}

function guardRunnable(search) {
  if (search.status === 'cancelled') throw new ApiError(409, 'This search was cancelled; start a new one.', 'SEARCH_CANCELLED');
  if (search.status === 'failed') throw new ApiError(409, 'This search failed; start a new one.', 'SEARCH_FAILED');
}

async function exhaust(admin, search, reason) {
  const plans = await plansOf(admin, search.id);
  const fresh = await reloadSearch(admin, search.id);
  const report = budgetReport(plans, reason, fresh);
  await finalizeFrontier(admin, fresh, plans, { status: 'budget_exhausted', budget_report: report });
  return report;
}

// ---- calibration --------------------------------------------------------------------
export async function calibrateSearch(admin, { search: s0, user }) {
  guardRunnable(s0);
  if (TERMINAL.has(s0.status)) return { search: s0, done: true, continuation: false, processed: [] };
  return withLock(admin, s0, async () => {
    const started = Date.now();
    let search = await reloadSearch(admin, s0.id);
    guardRunnable(search);
    const run = must(await admin.from('optimization_runs').select('*').eq('id', search.run_id).single());
    const { contract, product } = await loadRunContext(admin, run);
    const { evidence } = await verifiedEvidence(admin, run, product, contract);
    if (Date.now() - Date.parse(search.created_at) > search.bounds.max_wall_clock_ms) {
      // Write the exhaustion first, then read the search back: the response must show the stopped state.
      const report = await exhaust(admin, search, 'max_wall_clock_ms reached');
      return { search: await reloadSearch(admin, search.id), budget: report, done: true, continuation: false, processed: [] };
    }
    if (search.status === 'generated') search = await updateSearch(admin, search.id, { status: 'calibrating' });
    const evaluation = search.evaluation_set;
    const evalIds = new Set(evaluation.ids);
    const rows = evidence.traces.filter((t) => evalIds.has(t.id));
    const grades = baselineGrades(rows);
    const pricing = await loadPricing(admin);
    const processed = [];
    const spendSkipped = [];
    let budget = null;

    for (;;) {
      if (Date.now() - started > STAGE_SLICE_MS) return { search: await reloadSearch(admin, search.id), done: false, continuation: true, processed };
      const fresh = await reloadSearch(admin, search.id);
      if (fresh.status === 'cancelled') return { search: fresh, done: true, continuation: false, processed, cancelled: true };
      const plans = await plansOf(admin, search.id);
      const ready = calibrationOrder(plans.filter((p) => p.status === 'CALIBRATION_READY' || p.status === 'CALIBRATING'));
      // Finish what is in flight first (an interrupted round, or a plan earning a larger sample).
      const plan = ready.find((p) => p.status === 'CALIBRATING' || p.replay_budget?.next_round > 1) || ready.find((p) => !p.replay_state?.not_calibrated);
      if (!plan) break;
      const spend = fresh.spend;
      const round = plan.status === 'CALIBRATING' ? plan.replay_budget.round : plan.replay_budget?.next_round || 1;
      if (round === 1 && spend.plans_calibrated >= search.bounds.max_calibration_plans) {
        budget = { code: 'SEARCH_BUDGET_EXHAUSTED', stage: 'calibration', reason: `max_calibration_plans = ${search.bounds.max_calibration_plans}`, not_calibrated: ready.filter((p) => !(p.replay_budget?.next_round > 1)).map((p) => ({ id: p.id, name: p.name })) };
        for (const p of ready) if (!(p.replay_budget?.next_round > 1)) await updatePlan(admin, p.id, { replay_state: { ...p.replay_state, not_calibrated: budget.reason } });
        break;
      }
      const sample = selectSample({ plan: { plan_hash: plan.plan_hash, ordered: compositionOf(plan), estimate: { simulation: plan.estimated_effects.simulation } }, rows, round, perPlan: search.bounds.max_calibration_samples_per_plan, rounds: search.bounds.calibration_rounds, seed: search.seed, requirements: contract.requirements });
      if (spend.calibration_samples + sample.ids.length > search.bounds.max_calibration_samples_total) {
        budget = { code: 'SEARCH_BUDGET_EXHAUSTED', stage: 'calibration', reason: `max_calibration_samples_total = ${search.bounds.max_calibration_samples_total}`, not_calibrated: ready.map((p) => ({ id: p.id, name: p.name })) };
        for (const p of ready) await updatePlan(admin, p.id, { status: 'CALIBRATION_READY', replay_state: { ...p.replay_state, not_calibrated: budget.reason } });
        break;
      }
      const composition = compositionOf(plan);
      const bound = maxProviderCost(composition, rows.filter((r) => sample.ids.includes(r.id)), pricing);
      const remaining = Number(search.bounds.max_provider_spend_usd) - Number(spend.provider_usd || 0);
      if (bound === null || bound > remaining + 1e-12 || (bound > 0 && spend.provider_spend_measurable === false)) {
        // Paid work that does not fit the spend budget is skipped and listed; free (deterministic) plans continue.
        const reason = bound === null ? 'provider cost not estimable' : spend.provider_spend_measurable === false ? 'provider spend became unmeasurable; no further paid replays' : `max_provider_spend_usd: needs up to ${bound.toFixed(6)} USD; ${remaining.toFixed(6)} USD left`;
        await updatePlan(admin, plan.id, { status: 'CALIBRATION_READY', replay_state: { ...plan.replay_state, not_calibrated: reason } });
        spendSkipped.push({ id: plan.id, name: plan.name, reason });
        continue;
      }
      await updatePlan(admin, plan.id, { status: 'CALIBRATING', replay_budget: { ...plan.replay_budget, round, sample_size: sample.ids.length, sample_hash: sample.hash } });
      const enginePlan = await materialize(admin, { search, plan, product, evaluationIds: evaluation.ids });
      const ex = await execute(admin, { user, product, search, enginePlan, plan, sampleIds: sample.ids, traces: evidence.traces, stage: 'calibration', budgetUsd: Math.max(0, remaining) });
      if (ex.inProgress) return { search: await reloadSearch(admin, search.id), done: false, continuation: true, processed, in_progress: plan.id };
      const result = evaluatePlan({ execution: ex.execution, enginePlan: { ...enginePlan, sample_scope: sample.ids }, traces: evidence.traces, contract, projectRequirements: product.evaluation_requirements || {}, evaluation, composition });
      const bounds = boundsAnalysis({ result, sampleIds: sample.ids, rows, simulation: plan.estimated_effects.simulation, baselineGrades: grades, requirements: contract.requirements, composition });
      const decision = decideCalibration({ result, execution: ex.execution, sample, bounds, round, maxRounds: search.bounds.calibration_rounds });
      const { data: prior } = await admin.from('plan_calibrations').select('id').eq('plan_id', plan.id).eq('round', round).maybeSingle();
      if (!prior) {
        must(await admin.from('plan_calibrations').insert({ workspace_id: product.workspace_id, search_id: search.id, plan_id: plan.id, round, seed: search.seed, sample_ids: sample.ids, sample_hash: sample.hash, sample_size: sample.ids.length, outcome: decision.outcome, label: CALIBRATION_LABEL, execution_id: ex.execution.id, metrics: decision.metrics, bounds_analysis: bounds, gates: result.gates.map((g) => ({ name: g.name, required: g.required, outcome: g.outcome, reason: g.reason })), reasons: decision.reasons, decision: { next: decision.next } }).select('id'));
        const paid = providerSpend(ex.execution);
        await updateSearch(admin, search.id, { spend: { ...spend, calibration_samples: spend.calibration_samples + (ex.reused ? 0 : sample.ids.length), plans_calibrated: spend.plans_calibrated + (round === 1 ? 1 : 0), provider_calls: spend.provider_calls + (ex.reused ? 0 : paid.calls), provider_usd: paid.usd === null || ex.reused ? spend.provider_usd : Number((Number(spend.provider_usd) + paid.usd).toFixed(10)), provider_spend_measurable: spend.provider_spend_measurable && paid.usd !== null } });
      }
      const status = decision.outcome === 'FAILED_HARD_GATE' ? 'CALIBRATION_REJECTED' : decision.outcome === 'UNPROMISING' ? 'PRUNED' : decision.outcome === 'INCOMPLETE' ? 'INCOMPLETE' : decision.next === 'increase_sample' ? 'CALIBRATION_READY' : 'FULL_REPLAY_READY';
      await updatePlan(admin, plan.id, {
        status,
        observed_calibration_effects: { label: CALIBRATION_LABEL, round, outcome: decision.outcome, metrics: decision.metrics, bounds },
        replay_budget: { round, next_round: decision.next === 'increase_sample' ? round + 1 : null, sample_size: sample.ids.length, sample_hash: sample.hash, decision: decision.next, why: decision.reasons },
        replay_state: { ...plan.replay_state, calibration: decision.reasons },
      });
      processed.push({ plan_id: plan.id, round, outcome: decision.outcome, next: decision.next });
    }
    if (spendSkipped.length) budget = budget ? { ...budget, spend_skipped: spendSkipped } : { code: 'SEARCH_BUDGET_EXHAUSTED', stage: 'calibration', reason: 'max_provider_spend_usd', not_calibrated: spendSkipped, spend_skipped: spendSkipped };
    const after = await reloadSearch(admin, search.id);
    return { search: after, budget, done: true, continuation: false, processed };
  });
}

// ---- full replay ------------------------------------------------------------------------
export async function replaySearch(admin, { search: s0, user }) {
  guardRunnable(s0);
  if (TERMINAL.has(s0.status)) return { search: s0, done: true, continuation: false, processed: [] };
  return withLock(admin, s0, async () => {
    const started = Date.now();
    let search = await reloadSearch(admin, s0.id);
    guardRunnable(search);
    const run = must(await admin.from('optimization_runs').select('*').eq('id', search.run_id).single());
    const { contract, product } = await loadRunContext(admin, run);
    const { evidence } = await verifiedEvidence(admin, run, product, contract);
    if (Date.now() - Date.parse(search.created_at) > search.bounds.max_wall_clock_ms) {
      // Write the exhaustion first, then read the search back: the response must show the stopped state.
      const report = await exhaust(admin, search, 'max_wall_clock_ms reached');
      return { search: await reloadSearch(admin, search.id), budget: report, done: true, continuation: false, processed: [] };
    }
    const pending = (await plansOf(admin, search.id)).filter((p) => p.status === 'CALIBRATION_READY' && !p.replay_state?.not_calibrated);
    if (pending.length) throw new ApiError(409, `Finish calibration first: ${pending.length} plan(s) are still waiting for calibration.`, 'CALIBRATION_PENDING');
    if (search.status !== 'replaying') search = await updateSearch(admin, search.id, { status: 'replaying' });
    const evaluation = search.evaluation_set;
    const rows = evidence.traces.filter((t) => evaluation.ids.includes(t.id));
    const pricing = await loadPricing(admin);
    const processed = [];
    const spendSkipped = [];
    let budget = null;
    for (;;) {
      if (Date.now() - started > STAGE_SLICE_MS) return { search: await reloadSearch(admin, search.id), done: false, continuation: true, processed };
      const fresh = await reloadSearch(admin, search.id);
      if (fresh.status === 'cancelled') return { search: fresh, done: true, continuation: false, processed, cancelled: true };
      const plans = await plansOf(admin, search.id);
      const ready = calibrationOrder(plans.filter((p) => (p.status === 'FULL_REPLAY_READY' && !p.replay_state?.not_replayed) || p.status === 'REPLAYING'));
      const plan = ready.find((p) => p.status === 'REPLAYING') || ready[0];
      if (!plan) break;
      const spend = fresh.spend;
      if (plan.status !== 'REPLAYING' && spend.plans_replayed >= search.bounds.max_full_replay_plans) {
        budget = { code: 'SEARCH_BUDGET_EXHAUSTED', stage: 'full_replay', reason: `max_full_replay_plans = ${search.bounds.max_full_replay_plans}`, not_replayed: ready.map((p) => ({ id: p.id, name: p.name })) };
        for (const p of ready) await updatePlan(admin, p.id, { replay_state: { ...p.replay_state, not_replayed: budget.reason } });
        break;
      }
      if (plan.status !== 'REPLAYING' && spend.replay_samples + evaluation.ids.length > search.bounds.max_replay_samples_total) {
        const report = await exhaust(admin, fresh, `max_replay_samples_total = ${search.bounds.max_replay_samples_total}`);
        return { search: await reloadSearch(admin, search.id), budget: report, done: true, continuation: false, processed };
      }
      const composition = compositionOf(plan);
      const bound = maxProviderCost(composition, rows, pricing);
      const remaining = Number(search.bounds.max_provider_spend_usd) - Number(spend.provider_usd || 0);
      if (bound === null || bound > remaining + 1e-12 || (bound > 0 && spend.provider_spend_measurable === false)) {
        const reason = bound === null ? 'provider cost not estimable' : spend.provider_spend_measurable === false ? 'provider spend became unmeasurable; no further paid replays' : `max_provider_spend_usd: needs up to ${bound.toFixed(6)} USD; ${remaining.toFixed(6)} USD left`;
        await updatePlan(admin, plan.id, { status: 'FULL_REPLAY_READY', replay_state: { ...plan.replay_state, not_replayed: reason } });
        spendSkipped.push({ id: plan.id, name: plan.name, reason });
        continue;
      }
      if (plan.status !== 'REPLAYING') await updatePlan(admin, plan.id, { status: 'REPLAYING', replay_budget: { ...plan.replay_budget, full_replay_samples: evaluation.ids.length } });
      const enginePlan = await materialize(admin, { search, plan, product, evaluationIds: evaluation.ids });
      const ex = await execute(admin, { user, product, search, enginePlan, plan, sampleIds: evaluation.ids, traces: evidence.traces, stage: 'full_replay', budgetUsd: Math.max(0, remaining) });
      if (ex.inProgress) return { search: await reloadSearch(admin, search.id), done: false, continuation: true, processed, in_progress: plan.id };
      let { data: evaluationRow } = await admin.from('engine_evaluations').select('*').eq('candidate_execution_id', ex.execution.id).eq('execution_plan_id', plan.id).limit(1).maybeSingle();
      let metrics;
      if (!evaluationRow) {
        const result = evaluatePlan({ execution: ex.execution, enginePlan: { ...enginePlan, sample_scope: evaluation.ids }, traces: evidence.traces, contract, projectRequirements: product.evaluation_requirements || {}, evaluation, composition });
        const { plan_metrics: m, ...fields } = result;
        metrics = m;
        evaluationRow = must(await admin.from('engine_evaluations').insert({ product_id: product.id, workspace_id: product.workspace_id, candidate_plan_id: enginePlan.id, candidate_execution_id: ex.execution.id, finding_id: null, ...fields, run_id: run.id, execution_plan_id: plan.id, search_id: search.id }).select('*').single());
        const paid = providerSpend(ex.execution);
        await updateSearch(admin, search.id, { spend: { ...spend, replay_samples: spend.replay_samples + (ex.reused ? 0 : evaluation.ids.length), plans_replayed: spend.plans_replayed + 1, provider_calls: spend.provider_calls + (ex.reused ? 0 : paid.calls), provider_usd: paid.usd === null || ex.reused ? spend.provider_usd : Number((Number(spend.provider_usd) + paid.usd).toFixed(10)), provider_spend_measurable: spend.provider_spend_measurable && paid.usd !== null } });
      } else {
        metrics = planMetrics(evaluationRow, ex.execution);
      }
      const verdict = evaluationRow.status;
      await updatePlan(admin, plan.id, {
        status: verdict,
        verdict,
        evaluation_id: evaluationRow.id,
        verified_effects: verdict === 'VERIFIED' ? { label: 'VERIFIED — evaluated on the replayed evaluation set under the frozen contract; realized production result NOT YET MEASURED', ...metrics } : null,
        replay_state: { ...plan.replay_state, metrics: { label: verdict === 'VERIFIED' ? 'VERIFIED' : 'EVALUATED', ...metrics }, rejection_reason: evaluationRow.rejection_reason, execution_id: ex.execution.id },
      });
      processed.push({ plan_id: plan.id, verdict });
    }
    if (spendSkipped.length) budget = budget ? { ...budget, spend_skipped: spendSkipped } : { code: 'SEARCH_BUDGET_EXHAUSTED', stage: 'full_replay', reason: 'max_provider_spend_usd', not_replayed: spendSkipped, spend_skipped: spendSkipped };
    const plans = await plansOf(admin, search.id);
    const after = await finalizeFrontier(admin, await reloadSearch(admin, search.id), plans, { status: 'completed', budget_report: budget });
    return { search: after, budget, done: true, continuation: false, processed };
  });
}

/** Frontier over the search's VERIFIED plans, stored on the search and on every verified plan. */
async function finalizeFrontier(admin, search, plans, { status, budget_report }) {
  const verified = plans.filter((p) => p.verdict === 'VERIFIED');
  const frontier = paretoFrontier(verified);
  for (const st of frontier.states) {
    const p = verified.find((x) => x.plan_hash === st.plan_hash);
    const next = st.frontier_state === 'FRONTIER' ? (p.status === 'SELECTED' ? 'SELECTED' : 'PARETO_FRONTIER') : 'VERIFIED';
    await updatePlan(admin, p.id, { frontier_state: st.frontier_state, status: next, dominance_state: { dominated_by: st.dominated_by, dominates: st.dominates, incomplete_comparisons: st.incomplete_comparisons, frontier_reason: st.frontier_reason } });
  }
  const patch = { frontier: { states: frontier.states, frontier: frontier.frontier, partial: status === 'budget_exhausted' }, frontier_hash: frontier.hash, budget_report: budget_report || search.budget_report || null, completed_at: new Date().toISOString() };
  if (!TERMINAL.has(search.status)) patch.status = status;
  return updateSearch(admin, search.id, patch);
}

// ---- cancel ------------------------------------------------------------------------------
export async function cancelSearch(admin, { search, user }) {
  if (search.status === 'cancelled') return search;
  if (TERMINAL.has(search.status)) throw new ApiError(409, `Search is already ${search.status}.`, 'SEARCH_TERMINAL');
  const out = await updateSearch(admin, search.id, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: user.id, lock_token: null, locked_until: null });
  for (const p of await plansOf(admin, search.id)) {
    if (p.status === 'CALIBRATING') await updatePlan(admin, p.id, { status: 'CALIBRATION_READY', replay_state: { ...p.replay_state, cancelled: true } });
    if (p.status === 'REPLAYING') await updatePlan(admin, p.id, { status: 'FULL_REPLAY_READY', replay_state: { ...p.replay_state, cancelled: true } });
  }
  return out;
}

// ---- decision ----------------------------------------------------------------------------
export async function decide(admin, { search, user, policy, params }) {
  if (!search.frontier || !search.frontier_hash) throw new ApiError(409, 'Complete the full replay first: there is no Pareto frontier yet.', 'FRONTIER_REQUIRED');
  const plans = await plansOf(admin, search.id);
  const verified = plans.filter((p) => p.verdict === 'VERIFIED');
  const frontier = paretoFrontier(verified);
  if (frontier.hash !== search.frontier_hash) throw new ApiError(409, 'The stored frontier no longer matches its plans.', 'FRONTIER_CHANGED');
  const anyMetrics = verified[0]?.verified_effects?.baseline || {};
  const baseline = { cpso_usd: anyMetrics.cpso_usd ?? null, p95_ms: anyMetrics.p95_ms ?? null, task_success: anyMetrics.task_success ?? null, quality: anyMetrics.quality ?? null, failure_rate: 0 };
  const d = searchErr(() => applyPolicy({ frontier, policy, params, baseline }));
  const selected = d.selected ? verified.find((p) => p.plan_hash === d.selected) : null;
  let { data: row } = await admin.from('plan_decisions').select('*').eq('search_id', search.id).eq('decision_hash', d.decision_hash).maybeSingle();
  if (!row) {
    const { data, error } = await admin.from('plan_decisions').insert({ workspace_id: search.workspace_id, search_id: search.id, policy: d.explanation.policy, policy_params: d.explanation.params, frontier_hash: frontier.hash, outcome: d.outcome, selected_plan_id: selected ? selected.id : null, explanation: { ...d.explanation, baseline }, decision_hash: d.decision_hash, created_by: user.id }).select('*').single();
    if (error) throw error;
    row = data;
  }
  for (const p of plans.filter((x) => x.status === 'SELECTED' && x.id !== selected?.id)) await updatePlan(admin, p.id, { status: 'PARETO_FRONTIER' });
  if (selected && selected.status !== 'SELECTED') await updatePlan(admin, selected.id, { status: 'SELECTED' });
  return row;
}

// ---- bad-day replay ------------------------------------------------------------------------
export async function createProfile(admin, { product, user, scenario, parameters, seed }) {
  const profile = searchErr(() => normalizeProfile({ scenario, parameters, seed }));
  const { data: existing } = await admin.from('bad_day_profiles').select('*').eq('product_id', product.id).eq('profile_hash', profile.profile_hash).maybeSingle();
  if (existing) return existing;
  return must(await admin.from('bad_day_profiles').insert({ workspace_id: product.workspace_id, product_id: product.id, version: profile.version, scenario: profile.scenario, parameters: profile.parameters, scope: profile.scope, seed: profile.seed, profile_hash: profile.profile_hash, required_capabilities: profile.required_capabilities, created_by: user.id }).select('*').single());
}

export async function runBadDay(admin, { plan, profileRow, user }) {
  if (plan.verdict !== 'VERIFIED' || !plan.evaluation_id) throw new ApiError(409, 'Bad-Day Replay tests a plan that is VERIFIED on the normal evaluation workload.', 'PLAN_NOT_VERIFIED');
  if (profileRow.product_id !== plan.product_id) throw new ApiError(404, 'Profile not found.', 'NOT_FOUND');
  const { data: existing } = await admin.from('bad_day_results').select('*').eq('plan_id', plan.id).eq('profile_hash', profileRow.profile_hash).maybeSingle();
  if (existing) return { result: existing, reused: true };
  const search = await reloadSearch(admin, plan.search_id);
  const run = must(await admin.from('optimization_runs').select('*').eq('id', search.run_id).single());
  const { contract, product } = await loadRunContext(admin, run);
  const { evidence } = await verifiedEvidence(admin, run, product, contract);
  const evaluation = must(await admin.from('engine_evaluations').select('*').eq('id', plan.evaluation_id).single());
  const execution = must(await admin.from('engine_executions').select('*').eq('id', evaluation.candidate_execution_id).single());
  const profile = normalizeProfile({ scenario: profileRow.scenario, parameters: profileRow.parameters, seed: profileRow.seed });
  const rows = evidence.traces.filter((t) => search.evaluation_set.ids.includes(t.id));
  const out = badDayReplay({ evaluation, execution, rows, traces: evidence.traces, contract, profile, normalVerdict: plan.verdict });
  const { data, error } = await admin.from('bad_day_results').insert({ workspace_id: plan.workspace_id, search_id: plan.search_id, plan_id: plan.id, profile_id: profileRow.id, profile_hash: profileRow.profile_hash, normal_verdict: plan.verdict, bad_day_verdict: out.verdict, source_execution_id: execution.id, metrics: out.metrics, gates: out.gates, result_hash: out.result_hash, created_by: user.id }).select('*').single();
  if (error) {
    const { data: raced } = await admin.from('bad_day_results').select('*').eq('plan_id', plan.id).eq('profile_hash', profileRow.profile_hash).maybeSingle();
    if (raced) return { result: raced, reused: true };
    throw error;
  }
  return { result: data, reused: false };
}

export { plansOf };
