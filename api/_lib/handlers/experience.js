/**
 * Product experience read models (vNext Part 3).
 *
 *   GET /api/workspaces/:id/command-center?days=30   one decision surface for CEO / CTO / Developer
 *
 * Read-only. It aggregates existing evidence and keeps the claim classes apart:
 *   OBSERVED   recorded traces and the Verified Performance baseline snapshot
 *   EVALUATED  replay results under a frozen contract (VERIFIED / REJECTED / INCOMPLETE)
 *   PROJECTED  an evaluated per-request change applied to observed volume, with its formula
 *   REALIZED   production results after a change ships — not measured by ZEVQORA yet
 * Unknown stays null (never 0). Presentation modes never change what is returned:
 * the caller's workspace role is the only authority.
 */
import { on } from '../router.js';
import { uuid } from '../http.js';
import { requireUser, requireWorkspaceRole } from '../auth.js';

const TRACE_LIMIT = 5000;
const DAY = 24 * 60 * 60 * 1000;
/** Both demo workloads are named as synthetic; anything so named is labelled in every view. */
const SYNTHETIC = /SYNTHETIC|NOT CUSTOMER DATA/i;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
const sortNums = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
const must = ({ data, error }) => {
  if (error) throw error;
  return data || [];
};
const round = (v, d = 6) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Observed traffic from recorded traces in the window (bounded; truncation is reported, never hidden). */
function observed(traces, { from, to, truncated }) {
  const known = traces.filter((t) => typeof t.cost_usd === 'number');
  const lat = sortNums(traces.map((t) => t.latency_ms));
  const ttft = sortNums(traces.map((t) => t.ttft_ms));
  const days = new Map();
  const models = new Map();
  const workflows = new Map();
  for (const t of traces) {
    const day = (t.timestamp || t.created_at || '').slice(0, 10) || 'unknown';
    const d = days.get(day) || { day, requests: 0, spend_usd: 0, cost_known: 0, latencies: [] };
    d.requests += 1;
    if (typeof t.cost_usd === 'number') {
      d.spend_usd += t.cost_usd;
      d.cost_known += 1;
    }
    if (typeof t.latency_ms === 'number') d.latencies.push(t.latency_ms);
    days.set(day, d);
    const mk = `${t.provider || 'unknown'}|${t.model || 'unknown'}`;
    const m = models.get(mk) || { provider: t.provider || 'unknown', model: t.model || 'unknown', requests: 0, spend_usd: 0, cost_known: 0, latencies: [] };
    m.requests += 1;
    if (typeof t.cost_usd === 'number') {
      m.spend_usd += t.cost_usd;
      m.cost_known += 1;
    }
    if (typeof t.latency_ms === 'number') m.latencies.push(t.latency_ms);
    models.set(mk, m);
    const wk = t.workflow || t.symbol || '(unattributed)';
    const w = workflows.get(wk) || { workflow: wk, requests: 0, spend_usd: 0, cost_known: 0 };
    w.requests += 1;
    if (typeof t.cost_usd === 'number') {
      w.spend_usd += t.cost_usd;
      w.cost_known += 1;
    }
    workflows.set(wk, w);
  }
  const spend = known.reduce((a, t) => a + t.cost_usd, 0);
  const latencyOf = (xs) => {
    const s = sortNums(xs);
    return { p50_ms: percentile(s, 0.5), p95_ms: percentile(s, 0.95), samples: s.length };
  };
  const totalKnownSpend = spend || 0;
  return {
    claim: 'OBSERVED',
    source: 'engine_traces',
    window: { from, to },
    truncated,
    trace_limit: TRACE_LIMIT,
    requests: traces.length,
    spend_usd: known.length ? round(spend) : null,
    cost_known: known.length,
    cost_coverage: traces.length ? round(known.length / traces.length, 4) : null,
    latency: { p50_ms: percentile(lat, 0.5), p95_ms: percentile(lat, 0.95), p99_ms: lat.length >= 100 ? percentile(lat, 0.99) : null, samples: lat.length, p99_note: lat.length && lat.length < 100 ? 'p99 needs at least 100 timed requests' : null },
    ttft: { p50_ms: percentile(ttft, 0.5), p95_ms: percentile(ttft, 0.95), samples: ttft.length },
    retries: traces.filter((t) => Number(t.attempt) > 1).length,
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(({ latencies, ...d }) => ({ ...d, spend_usd: d.cost_known ? round(d.spend_usd) : null, ...latencyOf(latencies) })),
    by_model: [...models.values()].sort((a, b) => b.spend_usd - a.spend_usd || b.requests - a.requests).slice(0, 12).map(({ latencies, ...m }) => ({ ...m, spend_usd: m.cost_known ? round(m.spend_usd) : null, ...latencyOf(latencies) })),
    by_workflow: [...workflows.values()]
      .sort((a, b) => b.spend_usd - a.spend_usd || b.requests - a.requests)
      .slice(0, 12)
      .map((w) => ({ ...w, spend_usd: w.cost_known ? round(w.spend_usd) : null, share: totalKnownSpend > 0 && w.cost_known ? round(w.spend_usd / totalKnownSpend, 4) : null })),
  };
}

/** Baseline snapshot metrics, flattened for display. Every value keeps its own null. */
function baselineOut(s) {
  if (!s) return null;
  const m = s.metrics || {};
  return {
    claim: 'OBSERVED',
    snapshot_id: s.id,
    snapshot_hash: s.snapshot_hash,
    contract_hash: s.contract_hash,
    created_at: s.created_at,
    trace_count: s.trace_count,
    completeness: s.completeness,
    window_truncated: s.window_truncated,
    spend_usd: m.economics?.total_known_cost_usd ?? null,
    cost_coverage: m.economics?.cost_coverage ?? null,
    cpso_usd: m.economics?.cpso?.value_usd ?? null,
    cpso_unavailable: m.economics?.cpso?.unavailable_reasons || [],
    p50_ms: m.latency?.request?.p50_ms ?? null,
    p95_ms: m.latency?.request?.p95_ms ?? null,
    p99_ms: m.latency?.request?.p99_ms ?? null,
    ttft_p95_ms: m.latency?.ttft?.p95_ms ?? null,
    task_success: m.quality?.task_success?.rate ?? null,
    task_success_known: m.quality?.task_success?.known ?? 0,
    quality: m.quality?.score ?? null,
    failure_rate: m.reliability?.failure_rate ?? null,
    retry_rate: m.reliability?.retry_rate ?? null,
    retry_amplification: m.reliability?.retry_amplification ?? null,
    retry_latency_ms: m.reliability?.retry_latency_ms ?? null,
    protected: m.quality?.protected || null,
    logical_requests: m.samples?.logical_requests ?? null,
    missing_evidence: m.evidence?.missing || [],
    hotspots: (s.latency_analysis?.hotspots || []).slice(0, 5),
    critical_path: { status: s.latency_analysis?.status || 'unavailable', complete_graphs: s.latency_analysis?.complete ?? 0, graphs: s.latency_analysis?.graphs ?? 0, incomplete_reasons: s.latency_analysis?.incomplete_reasons || [] },
  };
}

function selectedPlanOut(plan) {
  if (!plan) return null;
  const v = plan.verified_effects || {};
  return {
    id: plan.id,
    name: plan.name,
    plan_hash: plan.plan_hash,
    risk_class: plan.risk_class,
    implementation_complexity: plan.implementation_complexity,
    rollback_complexity: plan.rollback_complexity,
    claim: 'EVALUATED',
    verdict: plan.verdict,
    cases: v.cases ?? null,
    cpso_usd: v.cpso_usd ?? null,
    cost_usd: v.cost_usd ?? null,
    p95_ms: v.p95_ms ?? null,
    task_success: v.task_success ?? null,
    quality: v.quality ?? null,
    baseline: v.baseline || null,
    deltas_pct: v.deltas_pct || {},
  };
}

/**
 * PROJECTED: evaluated per-request cost change × observed 30-day request volume.
 * Null with a reason whenever a term is unknown.
 */
function projection(plan, volume30d) {
  const basis = { formula: '(candidate cost − baseline cost) ÷ evaluated cases × observed requests in the last 30 days', assumptions: ['The evaluation set represents production traffic for these call sites.', 'Prices and traffic mix stay as observed.', 'Not a realized saving: nothing has shipped or been measured in production.'] };
  if (!plan) return { claim: 'PROJECTED', monthly_cost_change_usd: null, unavailable_reason: 'No VERIFIED plan has been selected yet.', basis };
  const c = plan.cost_usd;
  const b = plan.baseline?.cost_usd;
  if (typeof c !== 'number' || typeof b !== 'number' || !plan.cases) return { claim: 'PROJECTED', monthly_cost_change_usd: null, unavailable_reason: 'Evaluated cost is unknown for the selected plan.', basis };
  if (!volume30d) return { claim: 'PROJECTED', monthly_cost_change_usd: null, unavailable_reason: 'No requests were observed in the last 30 days to project onto.', basis };
  return { claim: 'PROJECTED', monthly_cost_change_usd: round(((c - b) / plan.cases) * volume30d, 4), per_request_change_usd: round((c - b) / plan.cases, 8), observed_requests_30d: volume30d, evaluated_cases: plan.cases, basis };
}

on('GET', '/api/workspaces/:id/command-center', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  const role = await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const days = Math.min(90, Math.max(1, Number(query.get('days')) || 30));
  const now = Date.now();
  const to = new Date(now).toISOString();
  const from = new Date(now - days * DAY).toISOString();
  const since30 = new Date(now - 30 * DAY).toISOString();

  const products = must(await admin.from('engine_products').select('id,name,created_at,archived_at').eq('workspace_id', workspaceId).is('archived_at', null).order('created_at', { ascending: true }));
  const ids = products.map((p) => p.id);
  const none = { data: [] };
  const [traces, runs, contracts, snapshots, searches, plans, decisions, diagnoses, evaluations] = await Promise.all([
    ids.length ? admin.from('engine_traces').select('product_id,timestamp,created_at,provider,model,workflow,symbol,latency_ms,ttft_ms,cost_usd,attempt').eq('workspace_id', workspaceId).gte('created_at', from).order('created_at', { ascending: false }).limit(TRACE_LIMIT) : none,
    ids.length ? admin.from('optimization_runs').select('id,product_id,status,contract_id,baseline_snapshot_id,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(200) : none,
    ids.length ? admin.from('evaluation_contracts').select('id,product_id,status,version,frozen_at,contract_hash').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(200) : none,
    ids.length ? admin.from('performance_snapshots').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(50) : none,
    ids.length ? admin.from('plan_searches').select('id,product_id,run_id,status,generation,frontier,created_at,completed_at,contract_hash').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(50) : none,
    ids.length ? admin.from('execution_plans').select('id,product_id,search_id,name,plan_hash,status,verdict,frontier_state,executable_status,risk_class,implementation_complexity,rollback_complexity,verified_effects,missing_evidence').eq('workspace_id', workspaceId).limit(2000) : none,
    ids.length ? admin.from('plan_decisions').select('id,search_id,policy,outcome,selected_plan_id,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100) : none,
    ids.length ? admin.from('optimization_diagnoses').select('id,product_id,run_id,family,severity,symptom,scope,confidence,risk_class,affected_nodes').eq('workspace_id', workspaceId).limit(500) : none,
    ids.length ? admin.from('engine_evaluations').select('id,product_id,status,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(1000) : none,
  ]);
  const T = must(traces);
  const R = must(runs);
  const C = must(contracts);
  const S = must(snapshots);
  const PS = must(searches);
  const P = must(plans);
  const D = must(decisions);
  const DG = must(diagnoses);
  const E = must(evaluations);

  const volume30 = new Map();
  for (const t of T) if ((t.created_at || '') >= since30) volume30.set(t.product_id, (volume30.get(t.product_id) || 0) + 1);

  const perProduct = products.map((p) => {
    const run = R.find((r) => r.product_id === p.id) || null;
    const contract = C.find((c) => c.product_id === p.id && c.status === 'frozen') || null;
    const snapshot = (run?.baseline_snapshot_id && S.find((s) => s.id === run.baseline_snapshot_id)) || S.find((s) => s.product_id === p.id) || null;
    const search = PS.find((s) => s.product_id === p.id) || null;
    const searchPlans = search ? P.filter((x) => x.search_id === search.id) : [];
    const decision = search ? D.find((d) => d.search_id === search.id) || null : null;
    const selected = decision?.selected_plan_id ? P.find((x) => x.id === decision.selected_plan_id) || null : null;
    const productTraces = T.filter((t) => t.product_id === p.id);
    const diag = DG.filter((d) => d.product_id === p.id && (!run || d.run_id === run.id));
    const sel = selectedPlanOut(selected);
    return {
      id: p.id,
      name: p.name,
      synthetic: SYNTHETIC.test(p.name),
      traces_in_window: productTraces.length,
      last_trace_at: productTraces[0]?.created_at || null,
      contract: contract ? { id: contract.id, version: contract.version, frozen_at: contract.frozen_at, contract_hash: contract.contract_hash } : null,
      run: run ? { id: run.id, status: run.status, created_at: run.created_at } : null,
      baseline: baselineOut(snapshot),
      diagnoses: { count: diag.length, top: diag.sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity)).slice(0, 5).map((d) => ({ id: d.id, family: d.family, severity: d.severity, symptom: d.symptom, scope: d.scope, confidence: d.confidence, affected_nodes: Array.isArray(d.affected_nodes) ? d.affected_nodes.length : 0 })) },
      search: search
        ? {
            id: search.id,
            status: search.status,
            created_at: search.created_at,
            completed_at: search.completed_at,
            generated: searchPlans.length,
            blocked: searchPlans.filter((x) => ['BLOCKED', 'NEEDS_EVIDENCE', 'CONFLICTED', 'PRUNED'].includes(x.status)).length,
            verified: searchPlans.filter((x) => x.verdict === 'VERIFIED').length,
            rejected: searchPlans.filter((x) => x.verdict === 'REJECTED' || x.status === 'CALIBRATION_REJECTED').length,
            incomplete: searchPlans.filter((x) => x.verdict === 'INCOMPLETE').length,
            frontier: searchPlans.filter((x) => x.frontier_state === 'FRONTIER').length,
          }
        : null,
      decision: decision ? { id: decision.id, policy: decision.policy, outcome: decision.outcome, created_at: decision.created_at, selected_plan: sel } : null,
      projected: projection(sel, volume30.get(p.id) || 0),
    };
  });

  // The decision queue: what a person should look at next, most important first.
  const queue = [];
  for (const p of perProduct) {
    const base = { product_id: p.id, product: p.name };
    if (!p.traces_in_window && !p.baseline) queue.push({ ...base, kind: 'connect_evidence', priority: 3, title: 'Import execution evidence', detail: 'No traces in this window. Import an OpenTelemetry / OpenInference export or a trace file.', href: '/app/connections' });
    else if (!p.contract) queue.push({ ...base, kind: 'freeze_contract', priority: 2, title: 'Freeze an Evaluation Contract', detail: 'Verdicts need frozen quality, latency and cost rules before any replay.', href: '/app/optimize' });
    else if (!p.baseline) queue.push({ ...base, kind: 'build_baseline', priority: 2, title: 'Build the Verified Performance baseline', detail: 'Measure cost per successful outcome, p95 and task success under the frozen contract.', href: '/app/optimize' });
    else if (!p.search && p.diagnoses.count) queue.push({ ...base, kind: 'start_search', priority: 2, title: `Search plans for ${p.diagnoses.count} diagnosis${p.diagnoses.count === 1 ? '' : 'es'}`, detail: 'Generate, calibrate and replay compatible execution plans.', href: '/app/optimize' });
    else if (p.search && !['completed', 'cancelled', 'failed', 'budget_exhausted'].includes(p.search.status)) queue.push({ ...base, kind: 'continue_search', priority: 2, title: 'Finish the plan search', detail: `Search is ${p.search.status}. Continue calibration and replay.`, href: '/app/optimize' });
    else if (p.search && p.search.frontier && !p.decision) queue.push({ ...base, kind: 'choose_plan', priority: 1, title: `Choose among ${p.search.frontier} VERIFIED plan${p.search.frontier === 1 ? '' : 's'}`, detail: 'Pick a decision policy; selection is only from the Pareto frontier.', href: '/app/optimize' });
    else if (p.decision?.selected_plan) queue.push({ ...base, kind: 'review_selected', priority: 1, title: `Review "${p.decision.selected_plan.name}" for shipping`, detail: 'VERIFIED on replay. Not deployed: shipping and production measurement are a human decision.', href: '/app/optimize' });
    if (p.baseline?.missing_evidence?.length) queue.push({ ...base, kind: 'missing_evidence', priority: 3, title: 'Close evidence gaps', detail: `Missing: ${p.baseline.missing_evidence.slice(0, 3).join(', ')}`, href: '/app/evidence' });
  }
  queue.sort((a, b) => a.priority - b.priority);

  // Technical risks surfaced to the CTO, each tied to its evidence.
  const risks = [];
  for (const p of perProduct) {
    const b = p.baseline;
    if (!b) continue;
    if (b.protected?.failed) risks.push({ product_id: p.id, kind: 'protected_failures', severity: 'high', title: `${b.protected.failed} protected case${b.protected.failed === 1 ? '' : 's'} failing in the baseline`, evidence: { snapshot_id: b.snapshot_id } });
    if (typeof b.retry_amplification === 'number' && b.retry_amplification > 1.2) risks.push({ product_id: p.id, kind: 'retry_amplification', severity: 'medium', title: `Retries multiply attempts by ${b.retry_amplification.toFixed(2)}×`, evidence: { snapshot_id: b.snapshot_id } });
    if (typeof b.failure_rate === 'number' && b.failure_rate > 0.05) risks.push({ product_id: p.id, kind: 'failure_rate', severity: 'medium', title: `${(b.failure_rate * 100).toFixed(1)}% of requests fail`, evidence: { snapshot_id: b.snapshot_id } });
    if (b.completeness !== 'complete') risks.push({ product_id: p.id, kind: 'incomplete_evidence', severity: 'medium', title: 'Baseline evidence is incomplete', evidence: { snapshot_id: b.snapshot_id, missing: b.missing_evidence } });
    if (typeof b.cost_coverage === 'number' && b.cost_coverage < 0.9) risks.push({ product_id: p.id, kind: 'cost_coverage', severity: 'low', title: `Cost known for only ${(b.cost_coverage * 100).toFixed(0)}% of requests`, evidence: { snapshot_id: b.snapshot_id } });
  }

  const evaluated = E.reduce((acc, e) => ((acc[e.status] = (acc[e.status] || 0) + 1), acc), {});
  const allPlans = P;
  const selectedPlans = perProduct.filter((p) => p.decision?.selected_plan).map((p) => ({ product_id: p.id, product: p.name, policy: p.decision.policy, ...p.decision.selected_plan, projected: p.projected }));

  return {
    workspace_id: workspaceId,
    role,
    generated_at: to,
    range: { from, to, days },
    synthetic: perProduct.some((p) => p.synthetic),
    observed: observed(T, { from, to, truncated: T.length >= TRACE_LIMIT }),
    products: perProduct,
    pipeline: {
      workloads: perProduct.length,
      with_traces: perProduct.filter((p) => p.traces_in_window).length,
      frozen_contracts: perProduct.filter((p) => p.contract).length,
      baselines: perProduct.filter((p) => p.baseline).length,
      diagnoses: DG.length,
      searches: PS.length,
      plans_generated: allPlans.length,
      calibrated: allPlans.filter((x) => x.status !== 'PROPOSED' && !['BLOCKED', 'NEEDS_EVIDENCE', 'CONFLICTED', 'PRUNED', 'CALIBRATION_READY'].includes(x.status)).length,
      replayed: allPlans.filter((x) => x.verdict).length,
      verified: allPlans.filter((x) => x.verdict === 'VERIFIED').length,
      rejected: allPlans.filter((x) => x.verdict === 'REJECTED' || x.status === 'CALIBRATION_REJECTED').length,
      incomplete: allPlans.filter((x) => x.verdict === 'INCOMPLETE').length,
      frontier: allPlans.filter((x) => x.frontier_state === 'FRONTIER').length,
      selected: allPlans.filter((x) => x.status === 'SELECTED').length,
      blocked: allPlans.filter((x) => ['BLOCKED', 'NEEDS_EVIDENCE'].includes(x.status)).length,
    },
    verdicts: { claim: 'EVALUATED', VERIFIED: evaluated.VERIFIED || 0, REJECTED: evaluated.REJECTED || 0, INCOMPLETE: evaluated.INCOMPLETE || 0, total: E.length },
    value: {
      evaluated: selectedPlans,
      projected: { claim: 'PROJECTED', monthly_cost_change_usd: selectedPlans.length && selectedPlans.every((s) => typeof s.projected.monthly_cost_change_usd === 'number') ? round(selectedPlans.reduce((a, s) => a + s.projected.monthly_cost_change_usd, 0), 4) : null, plans: selectedPlans.length },
      realized: { claim: 'REALIZED', status: 'NOT_YET_MEASURED', reason: 'ZEVQORA does not measure production after a change ships yet. Evaluated and projected figures are never shown as realized savings.' },
    },
    decision_queue: queue.slice(0, 12),
    risks: risks.slice(0, 12),
  };
});
