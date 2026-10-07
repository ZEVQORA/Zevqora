/**
 * Verdict of an execution plan under the run's frozen Evaluation Contract.
 *
 * evaluateUnderContract (Part 2A: existing evaluator + contract gates) runs
 * unchanged on the plan's replay over the search's evaluation set. Plan gates
 * are then APPENDED and the status re-decided with the same rule, so a plan
 * verdict is only ever stricter than the evaluator's:
 *
 *   evaluation_set_coverage            the evaluation set covers enough of the
 *                                      workload (exclusions are listed)
 *   transformation_slice:<kind>:<scope> per transformation, on the cases it
 *                                      served: quality must not fall below the
 *                                      same cases' baseline − tolerance, and it
 *                                      may never serve a protected case.
 *
 * The slice gates are why a composed plan cannot hide a failing
 * transformation behind cases another transformation improved.
 */
import { decideStatus } from '../product/evaluator.js';
import { normalizeRequirements } from './contract.js';
import { evaluateUnderContract } from './verdict.js';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const passed = (g) => Array.isArray(g) && g.length > 0 && g.every((r) => r.passed);

export function planMetrics(result, execution) {
  const comparison = result.performance_comparison || {};
  const samples = Array.isArray(execution.sample_results) ? execution.sample_results : [];
  const failures = samples.filter((s) => s.status !== 'succeeded').length;
  const providerCalls = new Map();
  for (const s of samples) {
    if (s.status !== 'succeeded') continue;
    if (s.path === 'model_call' || s.path === 'baseline_passthrough') {
      const p = String(s.provider || 'unknown').toLowerCase();
      providerCalls.set(p, (providerCalls.get(p) || 0) + 1);
    }
  }
  const calls = [...providerCalls.values()].reduce((a, b) => a + b, 0);
  return {
    cases: samples.length,
    cpso_usd: comparison.candidate?.cost_per_successful_outcome_usd ?? null,
    cost_usd: comparison.candidate?.cost_usd ?? null,
    p95_ms: comparison.candidate?.p95_ms ?? null,
    task_success: comparison.candidate?.task_success_rate ?? null,
    quality: comparison.candidate?.quality ?? null,
    failure_rate: samples.length ? failures / samples.length : null,
    provider_calls: calls,
    provider_concentration: calls ? Number([...providerCalls.values()].reduce((a, n) => a + (n / calls) ** 2, 0).toFixed(10)) : 0,
    baseline: { cpso_usd: comparison.baseline?.cost_per_successful_outcome_usd ?? null, cost_usd: comparison.baseline?.cost_usd ?? null, p95_ms: comparison.baseline?.p95_ms ?? null, task_success: comparison.baseline?.task_success_rate ?? null, quality: comparison.baseline?.quality ?? null },
    deltas_pct: comparison.deltas_pct || {},
  };
}

/**
 * evaluatePlan({ execution, enginePlan, traces, contract, projectRequirements, evaluation, composition })
 * evaluation = the search's evaluation set ({ coverage, excluded, ... }).
 */
export function evaluatePlan({ execution, enginePlan, traces, contract, projectRequirements, evaluation, composition }) {
  const req = normalizeRequirements(contract.requirements);
  const base = evaluateUnderContract({ execution, plan: enginePlan, traces, contract, projectRequirements });
  const gates = [...base.gates];
  const gate = (name, required, outcome, observed, threshold, reason) => gates.push({ name, required, outcome, observed, threshold, reason, source: 'execution_plan' });

  const minCoverage = Math.max(req.evidence.min_outcome_coverage, req.cost.min_coverage);
  if (evaluation.coverage === null) gate('evaluation_set_coverage', true, 'missing', null, minCoverage, 'No final requests in the evidence window.');
  else gate('evaluation_set_coverage', true, evaluation.coverage >= minCoverage ? 'passed' : 'missing', { coverage: evaluation.coverage, excluded: evaluation.excluded.length, sampled: evaluation.sampled }, minCoverage, `${evaluation.eligible} of ${evaluation.final_requests} final requests can be judged (recorded output, label, cost and latency); contract requires ${minCoverage}.${evaluation.sampled ? ` A seeded selection of ${evaluation.ids.length} was replayed.` : ''}`);

  const cases = new Map((base.cases || []).map((c) => [c.baseline_trace_id, c]));
  const samples = Array.isArray(execution.sample_results) ? execution.sample_results : [];
  for (const tx of composition) {
    const served = samples.filter((s) => s.served_by === tx.hash);
    const name = `transformation_slice:${tx.kind}:${tx.scope}`;
    if (!served.length) {
      gate(name, false, 'informational', { served: 0 }, null, `${tx.label} served no case of this replay.`);
      continue;
    }
    const rows = served.map((s) => cases.get(s.baseline_trace_id)).filter(Boolean);
    const protectedServed = rows.filter((c) => c.protected).length;
    const b = mean(rows.map((c) => c.baseline_score).filter((v) => v !== null));
    const c = mean(rows.map((c2) => c2.candidate_score).filter((v) => v !== null));
    const regressions = rows.filter((x) => passed(x.baseline_grader) && !passed(x.candidate_grader)).length;
    if (protectedServed) gate(name, true, 'failed', { served: rows.length, protected_served: protectedServed }, 0, `${tx.label} answered ${protectedServed} protected case(s); protected cases must keep the baseline path.`);
    else if (b === null || c === null) gate(name, true, 'missing', { served: rows.length, baseline_quality: b, candidate_quality: c }, req.quality_tolerance, `Quality unknown on the ${rows.length} case(s) ${tx.label} served.`);
    else gate(name, true, c >= b - req.quality_tolerance ? 'passed' : 'failed', { served: rows.length, baseline_quality: b, candidate_quality: c, regressions }, b - req.quality_tolerance, `On the ${rows.length} case(s) ${tx.label} served: quality ${c.toFixed(3)} vs baseline ${b.toFixed(3)} (tolerance ${req.quality_tolerance}); ${regressions} regression(s).`);
  }

  const status = decideStatus(gates);
  let rejection = null;
  if (status === 'INCOMPLETE') rejection = gates.filter((g) => g.required && g.outcome === 'missing').map((g) => `${g.name}: ${g.reason}`).join('; ');
  else if (status === 'REJECTED') rejection = 'Failed gates: ' + gates.filter((g) => g.required && g.outcome === 'failed').map((g) => g.name).join(', ');
  const result = { ...base, status, gates, rejection_reason: rejection };
  return { ...result, plan_metrics: planMetrics(result, execution) };
}
