import { describe, expect, it } from 'vitest';
import { chooseGrader, grade, diceCoefficient } from '../api/_lib/engine/graders.js';
import { evaluateGates } from '../api/_lib/engine/gates.js';

describe('graders', () => {
  it('chooses the grader from the baseline shape', () => {
    expect(chooseGrader('{"intent":"refund"}')).toBe('json_equivalence');
    expect(chooseGrader('refund')).toBe('classification');
    expect(chooseGrader('The customer asked for a refund because the item arrived damaged and late.')).toBe('token_similarity');
  });

  it('grades JSON by canonical equality then field overlap', () => {
    expect(grade('json_equivalence', '{"a":1,"b":[1,2]}', '{"b":[1,2],"a":1}').score).toBe(1);
    expect(grade('json_equivalence', '{"a":1,"b":2}', '```json\n{"a":1,"b":3}\n```').score).toBe(0.5);
    expect(grade('json_equivalence', '{"a":1}', 'not json').score).toBe(0);
  });

  it('grades classification with normalization', () => {
    expect(grade('classification', 'Refund', 'refund.').score).toBe(1);
    expect(grade('classification', 'refund', 'Label: refund').score).toBe(1);
    expect(grade('classification', 'refund', 'exchange').score).toBe(0);
    expect(grade('classification', 'refund', '').score).toBe(0);
  });

  it('grades free text with a length-guarded Dice score', () => {
    expect(diceCoefficient('a b c', 'a b c')).toBe(1);
    const same = grade('token_similarity', 'The quick brown fox jumps over the lazy dog', 'The quick brown fox jumps over the lazy dog');
    expect(same.score).toBe(1);
    const truncated = grade('token_similarity', 'one two three four five six seven eight nine ten', 'one two');
    expect(truncated.score).toBeLessThan(0.3);
  });
});

describe('gates', () => {
  const base = { sampleSize: 50, minSamples: 5, executionFailures: 0, baselineCost: 1, candidateCost: 0.58, baselineLatency: 1000, candidateLatency: 900, maxLatencyRegressionPct: 50, evidenceComplete: true };

  it('rejects a 42% cheaper candidate when quality misses the frozen floor', () => {
    const v = evaluateGates({ ...base, qualityScore: 0.87, qualityGate: 0.95 });
    expect(v.passed).toBe(false);
    expect(v.failed).toEqual(['quality_floor']);
    expect(v.rejectionReason).toBe('Failed gates: quality_floor');
  });

  it('verifies when every gate passes', () => {
    const v = evaluateGates({ ...base, qualityScore: 0.97, qualityGate: 0.95 });
    expect(v.passed).toBe(true);
    expect(v.gates.every((g) => g.passed)).toBe(true);
  });

  it('fails on missing evidence, execution errors, cost regressions and latency', () => {
    expect(evaluateGates({ ...base, qualityScore: 1, qualityGate: 0.95, evidenceComplete: false }).failed).toContain('evidence_completeness');
    expect(evaluateGates({ ...base, qualityScore: 1, qualityGate: 0.95, executionFailures: 1 }).failed).toContain('execution_success');
    expect(evaluateGates({ ...base, qualityScore: 1, qualityGate: 0.95, candidateCost: 1.2 }).failed).toContain('cost_improvement');
    expect(evaluateGates({ ...base, qualityScore: 1, qualityGate: 0.95, candidateLatency: 1600 }).failed).toContain('latency_regression');
    expect(evaluateGates({ ...base, qualityScore: null, qualityGate: 0.95 }).failed).toContain('quality_floor');
    expect(evaluateGates({ ...base, sampleSize: 3, qualityScore: 1, qualityGate: 0.95 }).failed).toContain('minimum_samples');
  });
});
