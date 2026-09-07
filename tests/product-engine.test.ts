import { describe, expect, it } from 'vitest';
import { scanText, scanFiles, classifyPath, redactSecretLikeValues } from '../api/_lib/product/scanner.js';
import { parseTraces, diagnoseRuntimeEvidence, economics } from '../api/_lib/product/traces.js';
import { planExactReuse, planModelSubstitution, executionKeyFor } from '../api/_lib/product/strategies.js';
import { executePlan } from '../api/_lib/product/executor.js';
import { runEvaluation, gradeClassification, decideStatus } from '../api/_lib/product/evaluator.js';
import { unifiedDiff } from '../api/_lib/product/diff.js';

const PY = `from openai import OpenAI
client = OpenAI()

def classify(message):
    response = client.responses.create(model="gpt-4o", input=f"Classify: {message}")
    return response.output_text

def summarize(thread):
    return client.responses.create(model="gpt-4o", input=thread)
`;

function traceRow(i: number, input: string, output: string, extra: Record<string, unknown> = {}) {
  return { request_id: `r${i}`, symbol: 'classify', workflow: 'support', provider: 'openai', model: 'openai/gpt-4o', input_text: input, output_text: output, expected_output: output, input_tokens: 40, output_tokens: 2, latency_ms: 600, cost_usd: 0.003, ...extra };
}

function pricingMap() {
  return new Map([
    ['openai/gpt-4o-mini', { model: 'openai/gpt-4o-mini', provider: 'openai', tier: 'small', input_per_million: 0.15, output_per_million: 0.6, cached_input_per_million: 0.075, retrieved_at: '2026-09-01' }],
    ['openai/gpt-4o', { model: 'openai/gpt-4o', provider: 'openai', tier: 'frontier', input_per_million: 2.5, output_per_million: 10, cached_input_per_million: 1.25, retrieved_at: '2026-09-01' }],
  ]);
}

describe('scanner', () => {
  it('detects call sites, symbols and findings without touching secrets', () => {
    const r = scanText('app/support.py', PY);
    expect(r.stack).toEqual(['openai']);
    expect(r.calls.map((c) => [c.line, c.symbol])).toEqual([[5, 'classify'], [9, 'summarize']]);
    expect(r.findings[0].category).toBe('structured_task_candidate');
    expect(classifyPath('node_modules/x/index.js')).toBe('skipped_sensitive');
    expect(classifyPath('config/secret_keys.py')).toBe('skipped_sensitive');
    expect(classifyPath('README.md')).toBe('ignore');
    expect(redactSecretLikeValues('api_key = "sk-abcdefghijklmnop1234"')).not.toContain('abcdefghijklmnop');
    const all = scanFiles([{ path: 'app/support.py', text: PY }, { path: 'node_modules/a.js', text: 'OpenAI' }]);
    expect(all.files_scanned).toBe(1);
  });
});

describe('traces', () => {
  it('parses JSONL, rejects bad rows, derives runtime signals and economics', () => {
    const good = [1, 2, 3].map((i) => JSON.stringify(traceRow(i, 'same input', 'billing')));
    const { rows, errors } = parseTraces({ jsonl: [...good, '{"no_request_id":true}', 'not json'].join('\n') });
    expect(rows).toHaveLength(3);
    expect(errors).toHaveLength(2);
    expect(rows[0].cost_source).toBe('imported_external');
    const withIds = rows.map((r, i) => ({ ...r, id: `t${i}` }));
    const signals = diagnoseRuntimeEvidence(withIds);
    expect(signals.some((f) => f.category === 'repeated_execution')).toBe(true);
    const e = economics(withIds, []);
    expect(e.trace_count).toBe(3);
    expect(e.observed_cost_usd).toBeCloseTo(0.009, 6);
  });
});

describe('exact reuse end to end', () => {
  it('plans, executes deterministically and VERIFIES on repeated evidence', async () => {
    const inputs = ['a', 'b', 'c'];
    const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ ...traceRow(i, `msg ${inputs[i % 3]}`, ['billing', 'technical', 'account'][i % 3]), id: `t${i}`, metadata: {}, protected: false, input_hash: null, output_hash: null, cost_source: 'imported_external', timestamp: `2026-09-0${(i % 6) + 1}T00:00:00Z` }));
    const plan = planExactReuse(rows, { id: 'f1', symbol: 'classify' });
    expect(plan.status).toBe('READY');
    expect(plan.sample_scope).toHaveLength(3);
    const withId = { ...plan, id: 'p1' };
    const key1 = executionKeyFor(withId, rows);
    expect(executionKeyFor(withId, rows)).toBe(key1);
    const execution = await executePlan({ plan: withId, traces: rows, complete: async () => { throw new Error('no provider expected'); }, pricing: pricingMap(), allowedModels: new Set() });
    expect(execution.status).toBe('SUCCEEDED');
    expect(execution.cost_usd).toBe(0);
    expect(execution.cost_source).toBe('deterministic_reuse');
    const evaluation = runEvaluation({ execution, plan: withId, traces: rows, gateConfig: { min_samples: 3, quality_floor: 0.95, require_fallback: false } });
    expect(evaluation.status).toBe('VERIFIED');
    expect(evaluation.candidate_quality).toBe(1);
    expect(evaluation.raw_cost_delta_percent).toBeCloseTo(100, 6);
    expect(evaluation.gates.find((g) => g.name === 'quality_floor')?.outcome).toBe('passed');
  });

  it('is BLOCKED without repeated evidence', () => {
    const rows = [0, 1].map((i) => ({ ...traceRow(i, `unique ${i}`, 'billing'), id: `t${i}`, metadata: {} }));
    expect(planExactReuse(rows, null).status).toBe('BLOCKED');
  });
});

describe('model substitution', () => {
  it('replays on the injected provider and rejects when quality drops', async () => {
    const rows = [0, 1, 2, 3, 4].map((i) => ({ ...traceRow(i, `Classify: message ${i}`, ['billing', 'technical', 'account', 'billing', 'account'][i]), id: `t${i}`, metadata: {}, protected: false }));
    const pricing = pricingMap();
    const plan = planModelSubstitution(rows, { id: 'f1', symbol: 'classify' }, { candidateModel: 'openai/gpt-4o-mini', allowedModels: new Set(['openai/gpt-4o-mini']), maxBudgetUsd: 0.5, pricing });
    expect(plan.status).toBe('READY');
    const withId = { ...plan, id: 'p2' };
    let calls = 0;
    const execution = await executePlan({ plan: withId, traces: rows, complete: async () => { calls += 1; return { content: 'billing', model: 'openai/gpt-4o-mini', requestId: `gen-${calls}`, latencyMs: 300, inputTokens: 40, outputTokens: 1, cachedInputTokens: 0, cost: 0.00001 }; }, pricing, allowedModels: new Set(['openai/gpt-4o-mini']) });
    expect(calls).toBe(5);
    expect(execution.status).toBe('SUCCEEDED');
    expect(execution.cost_source).toBe('provider_reported');
    const evaluation = runEvaluation({ execution, plan: withId, traces: rows, gateConfig: { min_samples: 5, quality_floor: 0.95, require_fallback: false } });
    expect(evaluation.status).toBe('REJECTED');
    expect(evaluation.candidate_quality).toBeCloseTo(0.4, 6);
    expect(evaluation.rejection_reason).toContain('quality_floor');
    expect(evaluation.raw_cost_delta_percent).toBeGreaterThan(90);
  });

  it('refuses unknown models and over-budget plans', () => {
    const rows = [0, 1].map((i) => ({ ...traceRow(i, `x ${i}`, 'billing'), id: `t${i}`, metadata: {} }));
    expect(planModelSubstitution(rows, null, { candidateModel: 'evil/model', allowedModels: new Set(['openai/gpt-4o-mini']), maxBudgetUsd: 0.5, pricing: pricingMap() }).status).toBe('BLOCKED');
    expect(planModelSubstitution(rows, null, { candidateModel: 'openai/gpt-4o-mini', allowedModels: new Set(['openai/gpt-4o-mini']), maxBudgetUsd: 0.5, pricing: new Map() }).blocked_reason).toBe('unknown_pricing_under_strict_budget');
  });
});

describe('graders and gates', () => {
  it('does not treat a duplicated label as ambiguous', () => {
    expect(gradeClassification('billing', 'billing', { labels: ['billing', 'technical', 'billing'], strict: true }).passed).toBe(true);
    expect(gradeClassification('billing or technical', 'billing', { labels: ['billing', 'technical'], strict: true }).passed).toBe(false);
  });
  it('decides INCOMPLETE before REJECTED', () => {
    expect(decideStatus([{ required: true, outcome: 'missing' }, { required: true, outcome: 'failed' }])).toBe('INCOMPLETE');
    expect(decideStatus([{ required: true, outcome: 'failed' }])).toBe('REJECTED');
    expect(decideStatus([{ required: true, outcome: 'passed' }, { required: false, outcome: 'informational' }])).toBe('VERIFIED');
  });
});

describe('diff', () => {
  it('renders a readable unified diff', () => {
    const d = unifiedDiff('a.py', 'a\nb\nc\nd\n', 'a\nB\nc\nd\ne\n');
    expect(d).toContain('--- a/a.py');
    expect(d).toContain('-b');
    expect(d).toContain('+B');
    expect(d).toContain('+e');
    expect(unifiedDiff('a.py', 'same', 'same')).toBe('');
  });
});
