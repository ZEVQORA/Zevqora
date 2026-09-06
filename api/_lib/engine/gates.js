/**
 * Verification gates. Every gate is explicit, named, and recorded on the
 * experiment so a rejection can always be traced to the exact rule.
 */
export const GATE_VERSION = 'gates_v1.0.0';

export function evaluateGates({
  sampleSize,
  minSamples,
  executionFailures,
  qualityScore,
  qualityGate,
  baselineCost,
  candidateCost,
  baselineLatency,
  candidateLatency,
  maxLatencyRegressionPct,
  evidenceComplete,
}) {
  const gates = [];
  const push = (name, passed, detail) => gates.push({ name, passed: Boolean(passed), detail });

  push('minimum_samples', sampleSize >= minSamples, `${sampleSize} samples; minimum ${minSamples}.`);
  push('evidence_completeness', evidenceComplete, evidenceComplete ? 'Baseline outputs, costs and candidate executions are all present.' : 'Some cases lack baseline output or cost evidence.');
  push('execution_success', executionFailures === 0, executionFailures === 0 ? 'Every candidate execution completed.' : `${executionFailures} candidate execution(s) failed.`);
  const qualityKnown = typeof qualityScore === 'number' && Number.isFinite(qualityScore);
  push('quality_floor', qualityKnown && qualityScore >= qualityGate, qualityKnown ? `candidate_quality=${qualityScore.toFixed(4)}; floor=${qualityGate.toFixed(2)}.` : 'Quality could not be measured.');
  const costKnown = typeof baselineCost === 'number' && typeof candidateCost === 'number' && baselineCost > 0;
  push('cost_improvement', costKnown && candidateCost < baselineCost, costKnown ? `baseline=$${baselineCost.toFixed(6)}; candidate=$${candidateCost.toFixed(6)}.` : 'Baseline or candidate cost is unavailable.');
  const latencyKnown = typeof baselineLatency === 'number' && typeof candidateLatency === 'number' && baselineLatency > 0;
  const latencyLimit = latencyKnown ? baselineLatency * (1 + maxLatencyRegressionPct / 100) : null;
  push(
    'latency_regression',
    !latencyKnown || candidateLatency <= latencyLimit,
    latencyKnown ? `candidate p50 ${candidateLatency.toFixed(0)} ms vs limit ${latencyLimit.toFixed(0)} ms (baseline ${baselineLatency.toFixed(0)} ms +${maxLatencyRegressionPct}%).` : 'Latency comparison not available; gate not applied.',
  );

  const passed = gates.every((g) => g.passed);
  const failed = gates.filter((g) => !g.passed).map((g) => g.name);
  return { gates, passed, failed, rejectionReason: passed ? null : `Failed gates: ${failed.join(', ')}` };
}
