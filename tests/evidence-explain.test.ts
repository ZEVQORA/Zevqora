import { describe, expect, it } from 'vitest';
import { explainEvaluation, ledgerSummary, orderedGates, countsAsMeasuredSaving } from '../src/product/evidence';
import type { EvalGate, Evaluation } from '../src/product/types';

const gate = (name: string, outcome: string, extra: Partial<EvalGate> = {}): EvalGate => ({ name, required: true, outcome, observed: null, threshold: null, reason: '', ...extra });

function evaluation(over: Partial<Evaluation>): Evaluation {
  return {
    id: 'e1', product_id: 'p', candidate_plan_id: 'pl', candidate_execution_id: 'x1', finding_id: null, status: 'VERIFIED', evaluation_version: 'v', sample_count: 10, protected_sample_count: 0,
    baseline_quality: 1, candidate_quality: 1, quality_delta: 0, baseline_cost_usd: 1, candidate_cost_usd: 0.4, raw_cost_delta_usd: -0.6, raw_cost_delta_percent: 60,
    baseline_latency_ms: 100, candidate_latency_ms: 90, evidence_completeness: true, verification_source: 'EXECUTION_EVALUATION', execution_proven: true, evidence_version: 'v',
    gates: [], rejection_reason: null, grader_config_hash: '', gate_config_hash: '', created_at: '2026-09-20T00:00:00Z', completed_at: null, note: '', ...over,
  };
}

describe('verdict explanation', () => {
  it('VERIFIED lists every passed gate', () => {
    const x = explainEvaluation(evaluation({ gates: [gate('quality_floor', 'passed'), gate('cost_improvement', 'passed'), gate('fallback', 'informational', { required: false })] }));
    expect(x.headline).toBe('All 2 required gates passed.');
    expect(x.passed.map((g) => g.name)).toEqual(['quality_floor', 'cost_improvement']);
    expect(x.nextEvidence).toEqual([]);
  });

  it('REJECTED names the failed gate and orders it first', () => {
    const e = evaluation({ status: 'REJECTED', gates: [gate('cost_improvement', 'passed'), gate('quality_floor', 'failed')] });
    expect(explainEvaluation(e).headline).toBe('Rejected by Quality floor.');
    expect(orderedGates(e)[0].name).toBe('quality_floor');
  });

  it('INCOMPLETE says exactly which evidence to add next', () => {
    const e = evaluation({
      status: 'INCOMPLETE',
      rejection_reason: 'baseline_cost_unknown:2_of_10_cases',
      gates: [gate('minimum_samples', 'missing', { observed: 3, threshold: 5 }), gate('cost_improvement', 'missing'), gate('protected_slice', 'missing')],
    });
    const x = explainEvaluation(e);
    expect(x.headline).toContain('Minimum samples, Cost improvement, Protected cases');
    expect(x.nextEvidence[0]).toBe('Baseline cost is unknown on 2 of 10 cases. Re-import those traces with cost_usd.');
    expect(x.nextEvidence).toContain('Add 2 more comparable cases (have 3, need 5) and re-run the replay.');
    expect(x.nextEvidence.some((s) => s.includes('"protected": true'))).toBe(true);
  });
});

describe('savings ledger', () => {
  it('counts only VERIFIED, execution-proven, known savings; one line per execution', () => {
    const rows = [
      evaluation({ id: 'a', candidate_execution_id: 'x1', created_at: '2026-09-20T00:00:00Z' }),
      evaluation({ id: 'a2', candidate_execution_id: 'x1', created_at: '2026-09-21T00:00:00Z', raw_cost_delta_usd: -0.5 }),
      evaluation({ id: 'b', candidate_execution_id: 'x2', status: 'REJECTED', raw_cost_delta_usd: -5 }),
      evaluation({ id: 'c', candidate_execution_id: 'x3', status: 'INCOMPLETE', raw_cost_delta_usd: null }),
      evaluation({ id: 'd', candidate_execution_id: 'x4', execution_proven: false }),
      evaluation({ id: 'e', candidate_execution_id: 'x5', raw_cost_delta_usd: null }),
    ];
    const s = ledgerSummary(rows);
    expect(s.measured.count).toBe(1);
    expect(s.measured.savedUsd).toBeCloseTo(0.5, 9);
    expect(s.excluded).toEqual({ rejected: 1, incomplete: 1, unproven: 1 });
    expect(countsAsMeasuredSaving(rows[2])).toBe(false);
  });

  it('reports no measured saving as unknown, not zero', () => {
    expect(ledgerSummary([]).measured.savedUsd).toBeNull();
  });
});
