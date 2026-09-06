import { describe, expect, it } from 'vitest';
import { analyzeEvents } from '../api/_lib/engine/analysis.js';
import { normalizeEvent } from '../api/_lib/handlers/telemetry.js';

function pricing() {
  const rows = [
    { model: 'openai/gpt-4o', provider: 'openai', input_per_million: 2.5, output_per_million: 10, cached_input_per_million: 1.25, tier: 'frontier', retrieved_at: '2026-09-01T00:00:00Z' },
    { model: 'openai/gpt-4o-mini', provider: 'openai', input_per_million: 0.15, output_per_million: 0.6, cached_input_per_million: 0.075, tier: 'small', retrieved_at: '2026-09-01T00:00:00Z' },
  ];
  return new Map(rows.map((r) => [r.model, r]));
}

function event(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `e${i}`,
    occurred_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    provider_key: 'openai',
    model_key: 'openai/gpt-4o',
    status: 'ok',
    input_tokens: 800,
    output_tokens: 20,
    latency_ms: 900,
    cost_usd: 0.0022,
    prompt_hash: `h${i}`,
    output_hash: `o${i}`,
    attempt: 1,
    error_class: null,
    has_sample: true,
    ...overrides,
  };
}

describe('analysis engine', () => {
  it('finds repeated prompts and bounded frontier usage', () => {
    const events = [] as ReturnType<typeof event>[];
    for (let i = 0; i < 40; i += 1) events.push(event(i, { prompt_hash: i < 12 ? 'same' : `h${i}`, output_hash: i < 12 ? 'same-out' : `o${i}` }));
    const result = analyzeEvents(events, pricing(), { windowDays: 30 });
    const strategies = result.opportunities.map((o) => o.candidate_strategy);
    expect(strategies).toContain('exact_reuse');
    expect(strategies).toContain('model_substitution');
    const reuse = result.opportunities.find((o) => o.candidate_strategy === 'exact_reuse')!;
    expect(reuse.evidence.duplicate_calls).toBe(11);
    expect(reuse.confidence).toBe(0.9);
    const sub = result.opportunities.find((o) => o.candidate_strategy === 'model_substitution')!;
    expect(sub.candidate_config.candidate_model).toBe('openai/gpt-4o-mini');
    expect(sub.estimated_savings_pct).toBeGreaterThan(80);
    expect(sub.evidence_completeness).toBe('complete');
    expect(result.summary.models[0].model).toBe('openai/gpt-4o');
  });

  it('reports nothing when the workload is already lean', () => {
    const events = Array.from({ length: 30 }, (_, i) => event(i, { model_key: 'openai/gpt-4o-mini', cost_usd: 0.0001 }));
    const result = analyzeEvents(events, pricing(), { windowDays: 30 });
    expect(result.opportunities).toHaveLength(0);
    expect(result.summary.events).toBe(30);
  });

  it('flags retry and failure waste', () => {
    const events = Array.from({ length: 60 }, (_, i) => event(i, { model_key: 'openai/gpt-4o-mini', status: i % 10 === 0 ? 'error' : 'ok', attempt: i % 10 === 1 ? 2 : 1 }));
    const result = analyzeEvents(events, pricing(), { windowDays: 30 });
    expect(result.opportunities.some((o) => o.candidate_strategy === 'retry_policy')).toBe(true);
  });
});

describe('telemetry normalization', () => {
  const connection = { id: 'c1', workspace_id: 'w1', project_id: 'p1' };

  it('estimates cost, hashes prompts and only stores samples when capture is on', () => {
    const raw = { model: 'gpt-4o-2024-08-06', provider: 'openai', occurred_at: '2026-09-01T00:00:00Z', usage: { prompt_tokens: 1000, completion_tokens: 100 }, latency_ms: 500, sample: { messages: [{ role: 'user', content: 'hi' }], output: 'hello' }, metadata: { route: '/x', api_key: 'no' } };
    const off = normalizeEvent(raw, { connection, pricing: pricing(), captureSamples: false });
    expect(off.row.model).toBe('openai/gpt-4o');
    expect(off.row.cost_source).toBe('pricing_snapshot_estimate');
    expect(off.row.cost_usd).toBeCloseTo(0.0035, 6);
    expect(off.row.sample).toBeNull();
    expect(off.row.prompt_hash).toHaveLength(64);
    expect(off.row.metadata).toEqual({ route: '/x' });
    expect(off.row.event_key).toBeTruthy();
    const on = normalizeEvent(raw, { connection, pricing: pricing(), captureSamples: true });
    expect(on.row.sample?.output).toBe('hello');
    expect(on.row.output_hash).toHaveLength(64);
  });

  it('rejects unusable events and respects provider-reported cost', () => {
    expect(normalizeEvent({ provider: 'openai' }, { connection, pricing: pricing(), captureSamples: false }).error).toBeTruthy();
    expect(normalizeEvent({ model: 'x', occurred_at: 'garbage' }, { connection, pricing: pricing(), captureSamples: false }).error).toBeTruthy();
    const reported = normalizeEvent({ model: 'gpt-4o', cost_usd: 0.01, cost_source: 'provider_reported', status: 'timeout', span_id: 's1' }, { connection, pricing: pricing(), captureSamples: false });
    expect(reported.row.cost_source).toBe('provider_reported');
    expect(reported.row.status).toBe('timeout');
    expect(reported.row.event_key).toBe('s1');
  });
});
