import { describe, expect, it } from 'vitest';
import { normalizeModel, estimateCost, cheaperCandidateFor, tierOf, priceRatio } from '../api/_lib/pricing.js';

function pricing() {
  const rows = [
    { model: 'openai/gpt-4o', provider: 'openai', input_per_million: 2.5, output_per_million: 10, cached_input_per_million: 1.25, tier: 'frontier', retrieved_at: '2026-09-01T00:00:00Z' },
    { model: 'openai/gpt-4o-mini', provider: 'openai', input_per_million: 0.15, output_per_million: 0.6, cached_input_per_million: 0.075, tier: 'small', retrieved_at: '2026-09-01T00:00:00Z' },
    { model: 'anthropic/claude-sonnet-4', provider: 'anthropic', input_per_million: 3, output_per_million: 15, cached_input_per_million: 0.3, tier: 'frontier', retrieved_at: '2026-09-01T00:00:00Z' },
    { model: 'anthropic/claude-3.5-haiku', provider: 'anthropic', input_per_million: 0.8, output_per_million: 4, cached_input_per_million: 0.08, tier: 'small', retrieved_at: '2026-09-01T00:00:00Z' },
  ];
  return new Map(rows.map((r) => [r.model, r]));
}

describe('pricing', () => {
  it('normalizes provider/model variants to canonical keys', () => {
    expect(normalizeModel('openai', 'gpt-4o-2024-08-06').key).toBe('openai/gpt-4o');
    expect(normalizeModel('', 'gpt-4o-mini').key).toBe('openai/gpt-4o-mini');
    expect(normalizeModel('anthropic', 'claude-3-5-haiku-20241022').key).toBe('anthropic/claude-3.5-haiku');
    expect(normalizeModel('openrouter', 'google/gemini-2.5-flash-preview').key).toBe('google/gemini-2.5-flash');
    expect(normalizeModel('azure', 'gpt-4.1-mini').key).toBe('openai/gpt-4.1-mini');
    expect(normalizeModel(null, 'claude-sonnet-4-20250514').key).toBe('anthropic/claude-sonnet-4');
  });

  it('estimates cost from the snapshot and labels the source', () => {
    const est = estimateCost(pricing(), 'openai/gpt-4o', { input: 1000, output: 100, cached: 200 });
    expect(est?.source).toBe('pricing_snapshot_estimate');
    // 800 * 2.5 + 200 * 1.25 + 100 * 10 = 2000 + 250 + 1000 = 3250 / 1e6
    expect(est?.cost).toBeCloseTo(0.00325, 8);
    expect(estimateCost(pricing(), 'unknown/model', { input: 10 })).toBeNull();
  });

  it('picks a cheaper candidate in the same family', () => {
    const p = pricing();
    expect(cheaperCandidateFor(p, 'openai/gpt-4o')).toBe('openai/gpt-4o-mini');
    expect(cheaperCandidateFor(p, 'anthropic/claude-sonnet-4')).toBe('anthropic/claude-3.5-haiku');
    expect(cheaperCandidateFor(p, 'openai/gpt-4o-mini')).toBeNull();
    expect(tierOf(p, 'openai/gpt-4o')).toBe('frontier');
    expect(tierOf(p, 'mystery/gpt-4o')).toBe('frontier');
    const ratio = priceRatio(p, 'openai/gpt-4o', 'openai/gpt-4o-mini', { input: 1000, output: 100 });
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.1);
  });
});
