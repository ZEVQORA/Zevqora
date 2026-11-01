/**
 * Verdict under a frozen Evaluation Contract.
 *
 * The existing evaluator (runEvaluation → evaluateGates → decideStatus) runs
 * unchanged, under the gate config the contract maps to, floored by the
 * project's own requirements. Contract gates are then APPENDED and the status
 * is re-decided with the same rule (any required missing → INCOMPLETE, else
 * any required failed → REJECTED, else VERIFIED). Appending required gates can
 * only make a verdict stricter, so the meaning of VERIFIED is unchanged.
 *
 * Nothing in a request can lower a threshold: the caller passes the contract,
 * never a gate config.
 */
import { decideStatus, enforceRequirements, runEvaluation } from '../product/evaluator.js';
import { contractGateConfig, normalizeRequirements } from './contract.js';
import { percentile } from './performance.js';

const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const rate = (a, b) => (b > 0 ? a / b : null);
const casePassed = (results) => Array.isArray(results) && results.length > 0 && results.every((r) => r.passed);

/** Side metrics from the graded cases of one evaluation. */
function sideMetrics(cases, side) {
  const graded = cases.filter((c) => Array.isArray(c[`${side}_grader`]) && c[`${side}_grader`].length);
  const passed = graded.filter((c) => casePassed(c[`${side}_grader`]));
  const costs = cases.map((c) => c[`${side}_cost_usd`]);
  const priced = costs.filter(known).map(Number);
  const lats = cases.map((c) => c[`${side}_latency_ms`]).filter(known).map(Number);
  const totalCost = priced.length ? priced.reduce((a, b) => a + b, 0) : null;
  const costCoverage = rate(priced.length, cases.length);
  return {
    cases: cases.length,
    task_success: { graded: graded.length, passed: passed.length, rate: rate(passed.length, graded.length) },
    cost: { total_usd: totalCost, coverage: costCoverage },
    // Cost per successful outcome on the replayed cases: only with full cost coverage and ≥1 success.
    cost_per_successful_outcome_usd: costCoverage === 1 && passed.length ? totalCost / passed.length : null,
    latency: { samples: lats.length, p50_ms: percentile(lats, 50), p95_ms: percentile(lats, 95) },
  };
}

function contractGates(req, base, execution, plan) {
  const cases = base.cases || [];
  const b = sideMetrics(cases, 'baseline');
  const c = sideMetrics(cases, 'candidate');
  const need = new Set(req.required_metrics);
  const gates = [];
  const gate = (name, required, outcome, observed, threshold, reason) => gates.push({ name, required, outcome, observed, threshold, reason, source: 'evaluation_contract' });

  // Task success: floor and non-regression against the same cases' baseline.
  if (req.min_task_success_rate !== null || need.has('task_success')) {
    if (c.task_success.rate === null) gate('task_success_floor', true, 'missing', c.task_success, req.min_task_success_rate, 'No graded cases: candidate task success is unknown (unknown is not success).');
    else gate('task_success_floor', true, c.task_success.rate >= (req.min_task_success_rate ?? 0) ? 'passed' : 'failed', c.task_success, req.min_task_success_rate, `candidate task success ${c.task_success.passed}/${c.task_success.graded}; floor ${req.min_task_success_rate}.`);
    if (b.task_success.rate === null || c.task_success.rate === null) gate('task_success_non_regression', true, 'missing', { baseline: b.task_success.rate, candidate: c.task_success.rate }, req.task_success_tolerance, 'Baseline or candidate task success unknown on the replayed cases.');
    else gate('task_success_non_regression', true, c.task_success.rate >= b.task_success.rate - req.task_success_tolerance ? 'passed' : 'failed', { baseline: b.task_success.rate, candidate: c.task_success.rate }, b.task_success.rate - req.task_success_tolerance, 'Candidate task success must not fall below baseline minus tolerance.');
  }

  // Latency p95: absolute budget and/or regression vs the same cases' baseline p95.
  if (req.latency.require) {
    if (c.latency.p95_ms === null) gate('latency_p95', true, 'missing', c.latency, req.latency.max_p95_ms, 'Candidate latency missing (unknown is not 0 ms).');
    else {
      if (req.latency.max_p95_ms !== null) gate('latency_p95', true, c.latency.p95_ms <= req.latency.max_p95_ms ? 'passed' : 'failed', { candidate_p95_ms: c.latency.p95_ms, samples: c.latency.samples, low_evidence: c.latency.samples < req.evidence.min_latency_samples }, req.latency.max_p95_ms, `candidate p95 ${c.latency.p95_ms} ms vs budget ${req.latency.max_p95_ms} ms.`);
      if (req.latency.max_regression_pct !== null) {
        if (b.latency.p95_ms === null) gate('latency_p95_regression', true, 'missing', { baseline_p95_ms: null, candidate_p95_ms: c.latency.p95_ms }, req.latency.max_regression_pct, 'Baseline latency missing on the replayed cases.');
        else {
          const limit = b.latency.p95_ms * (1 + req.latency.max_regression_pct / 100);
          gate('latency_p95_regression', true, c.latency.p95_ms <= limit ? 'passed' : 'failed', { baseline_p95_ms: b.latency.p95_ms, candidate_p95_ms: c.latency.p95_ms, samples: c.latency.samples, low_evidence: c.latency.samples < req.evidence.min_latency_samples }, limit, `candidate p95 ≤ baseline p95 × (1 + ${req.latency.max_regression_pct}%).`);
        }
      }
    }
  }

  // Cost evidence coverage: a cheaper-looking total over partly-priced cases proves nothing.
  if (req.cost.require_evidence) {
    const covered = (v) => v !== null && v >= req.cost.min_coverage;
    gate('cost_coverage', true, covered(b.cost.coverage) && covered(c.cost.coverage) ? 'passed' : 'missing', { baseline: b.cost.coverage, candidate: c.cost.coverage }, req.cost.min_coverage, `cost known for baseline ${b.cost.coverage ?? 'n/a'} / candidate ${c.cost.coverage ?? 'n/a'} of cases; contract requires ${req.cost.min_coverage}.`);
  }

  // Reliability on the replay itself.
  const samples = Array.isArray(execution.sample_results) ? execution.sample_results : [];
  const failed = samples.filter((s) => s.status !== 'succeeded').length;
  if (req.reliability.max_failure_rate !== null) {
    if (!samples.length) gate('reliability_failure_rate', true, 'missing', { samples: 0 }, req.reliability.max_failure_rate, 'No replay samples.');
    else gate('reliability_failure_rate', true, failed / samples.length <= req.reliability.max_failure_rate ? 'passed' : 'failed', { failed, samples: samples.length }, req.reliability.max_failure_rate, 'Candidate replay failure rate must stay within the contract.');
  }

  // Protected coverage beyond "at least one".
  if (req.protected.min_cases > 0) gate('protected_minimum', true, base.protected_sample_count >= req.protected.min_cases ? 'passed' : 'missing', base.protected_sample_count, req.protected.min_cases, `${base.protected_sample_count} protected case(s) evaluated; contract requires ${req.protected.min_cases}.`);

  // Provider/model restrictions.
  const model = plan?.candidate_config?.model || null;
  if (model && (req.allowed_models || req.allowed_providers)) {
    const allowed = (!req.allowed_models || req.allowed_models.includes(model)) && (!req.allowed_providers || req.allowed_providers.includes(model.split('/')[0]));
    gate('model_allowlist', true, allowed ? 'passed' : 'failed', model, { models: req.allowed_models, providers: req.allowed_providers }, allowed ? 'Candidate model allowed by the contract.' : 'Candidate model is not allowed by the frozen contract.');
  }

  // Cost per successful outcome: reported, never a substitute for the cost gate.
  gate('cost_per_successful_outcome', false, 'informational', { baseline: b.cost_per_successful_outcome_usd, candidate: c.cost_per_successful_outcome_usd }, null, b.cost_per_successful_outcome_usd === null || c.cost_per_successful_outcome_usd === null ? 'Unavailable on one side (needs full cost coverage and at least one success).' : 'Evaluated on the replayed cases.');

  return { gates, baseline: b, candidate: c };
}

/**
 * evaluation under contract. contract = { id, contract_hash, requirements };
 * projectRequirements = engine_products.evaluation_requirements (the floor).
 */
export function evaluateUnderContract({ execution, plan, traces, contract, projectRequirements = {}, cases = null }) {
  const req = normalizeRequirements(contract.requirements);
  const gateConfig = enforceRequirements(contractGateConfig(req), projectRequirements || {});
  const base = runEvaluation({ execution, plan, traces, gateConfig, cases });
  const extra = contractGates(req, base, execution, plan);
  const gates = [...base.gates, ...extra.gates];
  const status = decideStatus(gates);
  const missing = gates.filter((g) => g.required && g.outcome === 'missing').map((g) => (g.name === 'evidence_completeness' ? g.reason : `${g.name}: ${g.reason}`));
  let rejection = null;
  if (status === 'INCOMPLETE') rejection = missing.join('; ') || 'Incomplete required evidence.';
  else if (status === 'REJECTED') rejection = 'Failed gates: ' + gates.filter((g) => g.required && g.outcome === 'failed').map((g) => g.name).join(', ');
  const delta = (a, b) => (a !== null && b !== null && a !== 0 ? ((b - a) / a) * 100 : null);
  const comparison = {
    basis: 'evaluated on replayed cases (not realized production results)',
    baseline: { cost_usd: base.baseline_cost_usd, cost_per_successful_outcome_usd: extra.baseline.cost_per_successful_outcome_usd, quality: base.baseline_quality, task_success_rate: extra.baseline.task_success.rate, p50_ms: extra.baseline.latency.p50_ms, p95_ms: extra.baseline.latency.p95_ms, cost_coverage: extra.baseline.cost.coverage },
    candidate: { cost_usd: base.candidate_cost_usd, cost_per_successful_outcome_usd: extra.candidate.cost_per_successful_outcome_usd, quality: base.candidate_quality, task_success_rate: extra.candidate.task_success.rate, p50_ms: extra.candidate.latency.p50_ms, p95_ms: extra.candidate.latency.p95_ms, cost_coverage: extra.candidate.cost.coverage, replay_failures: (execution.sample_results || []).filter((s) => s.status !== 'succeeded').length },
    deltas_pct: { cost: delta(base.baseline_cost_usd, base.candidate_cost_usd), cost_per_successful_outcome: delta(extra.baseline.cost_per_successful_outcome_usd, extra.candidate.cost_per_successful_outcome_usd), p95: delta(extra.baseline.latency.p95_ms, extra.candidate.latency.p95_ms) },
    protected: { evaluated: base.protected_sample_count, failures: base.gates.find((g) => g.name === 'protected_slice')?.observed?.failures ?? null },
    realized_production_result: 'NOT YET MEASURED',
  };
  return { ...base, status, gates, rejection_reason: rejection, gate_config: gateConfig, contract_id: contract.id, contract_hash: contract.contract_hash, performance_comparison: comparison };
}
