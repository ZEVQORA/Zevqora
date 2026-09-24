import { describe, expect, it } from 'vitest';
import { sanitizeTrial, mergeTrial } from '../api/_lib/product/trial.js';
import { trialReportMarkdown } from '../src/product/evidence';
import { ECONOMICS_PARTIAL, INCOMPLETE, REJECTED_CHEAPER, VERIFIED } from './fixtures/product-store';

describe('trial record', () => {
  it('keeps only known, bounded fields', () => {
    const t = sanitizeTrial({ customer: ' Acme ', fixtures: 'redacted', success_criteria: ['≥20% lower cost', ''], next_decision: 'extend_evaluation', rogue: 'x' });
    expect(t).toEqual({ customer: 'Acme', fixtures: 'redacted', success_criteria: ['≥20% lower cost'], next_decision: 'extend_evaluation' });
    expect(() => sanitizeTrial({ fixtures: 'everything' })).toThrow(/fixtures/);
    expect(() => sanitizeTrial({ success_criteria: Array(11).fill('x') })).toThrow(/10 items/);
    expect(() => sanitizeTrial({ next_decision_due: 'soon' })).toThrow(/date/);
  });

  it('stamps the data-boundary confirmation on the server, never from the client', () => {
    const spoofed = mergeTrial(null, { data_boundary_confirmed: { at: '2020-01-01', by: 'someone-else' } } as never, { userId: 'u1', now: '2026-09-24T00:00:00Z' });
    expect(spoofed.data_boundary_confirmed).toBeUndefined();
    const confirmed = mergeTrial(spoofed, {}, { userId: 'u1', confirmBoundary: true, now: '2026-09-24T01:00:00Z' });
    expect(confirmed.data_boundary_confirmed).toEqual({ at: '2026-09-24T01:00:00Z', by: 'u1' });
    const later = mergeTrial(confirmed, { recommendation: 'Adopt exact reuse.' }, { userId: 'u2' });
    expect(later.data_boundary_confirmed).toEqual({ at: '2026-09-24T01:00:00Z', by: 'u1' });
    expect(later.status).toBe('active');
  });
});

describe('evaluation report', () => {
  const base = { workspaceName: 'Fixture', product: { name: 'support', root_path: 'workload://support' }, requirements: { quality_floor: 0.97 }, baseline: ECONOMICS_PARTIAL.baseline, observedCostUsd: 0.024, evaluations: [INCOMPLETE, REJECTED_CHEAPER, VERIFIED], strategyFor: () => 'Model substitution', generatedAt: '2026-09-24T00:00:00Z' };

  it('flags an unconfirmed boundary and keeps projected and realized out of the number', () => {
    const md = trialReportMarkdown({ ...base, trial: null });
    expect(md).toContain('**Data boundary:** NOT CONFIRMED');
    expect(md).toContain('≥ $0.024000 (priced 8 of 12)');
    expect(md).toContain('| REJECTED | not savings |');
    expect(md).toContain('| INCOMPLETE | not savings |');
    expect(md).toContain('Measured on evaluated cases: $0.024000 across 12 cases. Projected production impact: not modelled.');
    expect(md).toContain('No measurable success criteria recorded.');
  });

  it('carries the human decision through', () => {
    const md = trialReportMarkdown({ ...base, trial: { customer: 'Acme', data_boundary_confirmed: { at: '2026-09-20T00:00:00Z', by: 'u' }, success_criteria: ['≥20% lower cost'], next_decision: 'adopt_candidate', next_decision_owner: 'CTO' } });
    expect(md).toContain('For Acme');
    expect(md).toContain('confirmed 2026-09-20');
    expect(md).toContain('- ≥20% lower cost');
    expect(md).toContain('Adopt the verified candidate · owner CTO');
  });
});
