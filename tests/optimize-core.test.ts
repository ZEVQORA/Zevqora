/**
 * Deterministic core of the Verified Optimization Run: Evaluation Contract,
 * Verified Performance, latency/critical path, Zev Diagnose v0.1,
 * OptimizationPass v0.1 and the verdict under contract. Numbers in comments
 * refer to the Part 2A test list.
 */
import { describe, expect, it } from 'vitest';
import { contractGateConfig, contractHash, normalizeRequirements, requirementsFromProjectFloor, assertDraft } from '../api/_lib/optimize/contract.js';
import { latencySummary, percentile, performanceSnapshot } from '../api/_lib/optimize/performance.js';
import { criticalPath, latencyAnalysis } from '../api/_lib/optimize/latency.js';
import { diagnose } from '../api/_lib/optimize/diagnose.js';
import { generateCandidates, PASSES, redundantCallPass, modelProviderPass, EXECUTABLE, NEEDS_IMPLEMENTATION, NOT_EXECUTABLE } from '../api/_lib/optimize/passes.js';
import { evaluateUnderContract } from '../api/_lib/optimize/verdict.js';
import { planExactReuse, planModelSubstitution } from '../api/_lib/product/strategies.js';
import { executePlan } from '../api/_lib/product/executor.js';
import { sha256Text } from '../api/_lib/product/hashing.js';
import { demoTraces, DEMO_REQUIREMENTS } from '../api/_lib/optimize/demo.js';
import { parseTraces } from '../api/_lib/product/traces.js';

type Row = Record<string, unknown>;
const PRODUCT = { id: '33333333-3333-4333-8333-333333333333', workspace_id: '11111111-1111-4111-8111-111111111111' };
const PRICING = new Map([
  ['openai/gpt-4o', { model: 'openai/gpt-4o', provider: 'openai', tier: 'frontier', input_per_million: 2.5, output_per_million: 10, cached_input_per_million: 1.25, retrieved_at: '2026-09-01' }],
  ['openai/gpt-4o-mini', { model: 'openai/gpt-4o-mini', provider: 'openai', tier: 'small', input_per_million: 0.15, output_per_million: 0.6, cached_input_per_million: 0.075, retrieved_at: '2026-09-01' }],
]);

function trace(i: number, over: Row = {}): Row {
  const input = (over.input_text as string) ?? `message ${i}`;
  const output = (over.output_text as string | null) ?? 'billing';
  return { id: `t${String(i).padStart(3, '0')}`, request_id: `r${i}`, timestamp: `2026-09-01T00:${String(i % 60).padStart(2, '0')}:00Z`, symbol: 'classify', workflow: 'support', provider: 'openai', model: 'gpt-4o', input_text: input, output_text: output, expected_output: (over.expected_output as string) ?? output, input_hash: sha256Text(input), output_hash: sha256Text(output), system_prompt_hash: 'a'.repeat(64), input_tokens: 40, output_tokens: 1, latency_ms: 1000 + i, cost_usd: 0.003, cost_source: 'provider_reported', attempt: 1, protected: false, metadata: {}, ...over };
}
const demo = () => parseTraces({ traces: demoTraces() }).rows.map((t: Row, i: number) => ({ ...t, id: `d${String(i).padStart(3, '0')}` }));

// ---------------------------------------------------------------- contract
describe('Evaluation Contract', () => {
  it('1. a draft can change; its hash follows every decision field', () => {
    const a = normalizeRequirements({});
    const b = normalizeRequirements({ quality_floor: 0.97 });
    expect(contractHash(PRODUCT.id, a)).not.toBe(contractHash(PRODUCT.id, b));
    expect(() => assertDraft({ status: 'draft', version: 1 })).not.toThrow();
  });

  it('2. a frozen or superseded contract cannot change', () => {
    expect(() => assertDraft({ status: 'frozen', version: 1 })).toThrow(/cannot change/);
    expect(() => assertDraft({ status: 'superseded', version: 1 })).toThrow(/cannot change/);
  });

  it('4. the hash changes when any decision-relevant field changes, and only then', () => {
    const base = normalizeRequirements(DEMO_REQUIREMENTS);
    const h = contractHash(PRODUCT.id, base);
    const variants: Row[] = [
      { quality_floor: 0.96 },
      { min_task_success_rate: 0.9 },
      { latency: { ...base.latency, max_p95_ms: 2500 } },
      { protected: { require_cases: true, min_cases: 2 } },
      { cost: { ...base.cost, min_coverage: 0.95 } },
      { evidence: { ...base.evidence, min_samples: 6 } },
      { required_metrics: ['cost', 'latency'] },
      { reliability: { max_failure_rate: 0.05, max_retry_rate: null } },
      { allowed_models: ['openai/gpt-4o-mini'] },
      { allowed_providers: ['openai'] },
      { policy: { no_protected_regression: false, require_data_boundary: false } },
      { dataset_version: 'v2' },
    ];
    for (const v of variants) expect(contractHash(PRODUCT.id, { ...base, ...v })).not.toBe(h);
    // Same decisions in a different key / list order → same hash.
    expect(contractHash(PRODUCT.id, { ...base, required_metrics: [...base.required_metrics].reverse() })).toBe(h);
    expect(contractHash('44444444-4444-4444-8444-444444444444', base)).not.toBe(h);
  });

  it('refuses unknown fields and incoherent requirements', () => {
    expect(() => normalizeRequirements({ qualty_floor: 0.9 })).toThrow(/Unknown contract field/);
    expect(() => normalizeRequirements({ latency: { require: true, max_p95_ms: null, max_regression_pct: null } })).toThrow(/latency requirement/);
    expect(() => normalizeRequirements({ required_metrics: ['task_success'] })).toThrow(/min_task_success_rate/);
    expect(() => normalizeRequirements({ quality_floor: 0.2 })).toThrow(/between 0.5 and 1/);
  });

  it('seeds a draft from the project floor without going below it', () => {
    const r = requirementsFromProjectFloor({ quality_floor: 0.98, min_samples: 12, require_protected_cases: true });
    expect(r).toMatchObject({ quality_floor: 0.98, evidence: { min_samples: 12 }, protected: { require_cases: true } });
    expect(contractGateConfig(r)).toMatchObject({ quality_floor: 0.98, min_samples: 12, require_protected_cases: true });
  });
});

// ------------------------------------------------------- verified performance
describe('Verified Performance', () => {
  it('6. nearest-rank percentiles are deterministic and order-independent', () => {
    const xs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect([percentile(xs, 50), percentile(xs, 95), percentile(xs, 99)]).toEqual([500, 1000, 1000]);
    expect(percentile([...xs].reverse(), 95)).toBe(1000);
    expect(percentile([5], 50)).toBe(5);
    const big = Array.from({ length: 200 }, (_, i) => i + 1);
    expect([percentile(big, 50), percentile(big, 95), percentile(big, 99)]).toEqual([100, 190, 198]);
  });

  it('7/10. unknown latency stays null; few samples are flagged low evidence', () => {
    expect(latencySummary([null, undefined], 20)).toMatchObject({ samples: 0, p50_ms: null, p95_ms: null, low_evidence: true });
    const s = performanceSnapshot([trace(1, { latency_ms: null }), trace(2, { latency_ms: 300 })], {});
    expect(s.latency.attempt).toMatchObject({ samples: 1, p95_ms: 300, low_evidence: true });
    expect(s.latency.request.samples).toBe(1);
  });

  it('8/9. unknown cost stays null; a known $0 is a known cost', () => {
    const unknown = performanceSnapshot([trace(1, { cost_usd: null, cost_source: null })], {});
    expect(unknown.economics).toMatchObject({ total_known_cost_usd: null, known_cost_count: 0, cost_coverage: 0, cost_per_logical_request_usd: null, cost_per_successful_outcome_usd: null });
    const zero = performanceSnapshot([trace(1, { cost_usd: 0 })], { evidence: { min_samples: 5, min_latency_samples: 1, min_outcome_coverage: 0.8 } });
    expect(zero.economics).toMatchObject({ total_known_cost_usd: 0, known_cost_count: 1, cost_coverage: 1, cost_per_successful_outcome_usd: 0 });
  });

  it('11. missing task success stays unknown — neither success nor failure', () => {
    const s = performanceSnapshot([trace(1, { expected_output: null }), trace(2, { expected_output: null, metadata: { task_success: false } })], {});
    expect(s.quality.task_success).toMatchObject({ known: 1, succeeded: 0, unknown: 1, rate: 0, sources: ['reported'] });
  });

  it('12. CPSO is unavailable (null + reasons) when cost or outcome coverage is insufficient', () => {
    const rows = Array.from({ length: 10 }, (_, i) => trace(i, i < 4 ? { cost_usd: null } : {}));
    const s = performanceSnapshot(rows, {});
    expect(s.economics.cost_per_successful_outcome_usd).toBeNull();
    expect(s.economics.cpso.unavailable_reasons.join(' ')).toMatch(/cost fully known for 6 of 10/);
    const noOutcome = performanceSnapshot(Array.from({ length: 10 }, (_, i) => trace(i, { expected_output: null })), {});
    expect(noOutcome.economics.cpso.unavailable_reasons.join(' ')).toMatch(/task outcome known for 0 of 10/);
    const allFailed = performanceSnapshot(Array.from({ length: 5 }, (_, i) => trace(i, { metadata: { task_success: false } })), {});
    expect(allFailed.economics.cpso.unavailable_reasons.join(' ')).toMatch(/zero successful outcomes/);
  });

  it('13. CPSO = all attributable cost / successful outcomes when evidence suffices', () => {
    const rows = Array.from({ length: 10 }, (_, i) => trace(i, { cost_usd: 0.01, metadata: { task_success: i < 8 } }));
    const s = performanceSnapshot(rows, {});
    expect(s.economics.cost_per_successful_outcome_usd).toBeCloseTo(0.1 / 8, 10);
    expect(s.economics.cpso).toMatchObject({ population: 10, successful_outcomes: 8, numerator_coverage: 1, denominator_coverage: 1 });
  });

  it('14. retry cost and amplification follow logical requests', () => {
    const rows = [
      trace(1, { request_id: 'a1', attempt: 1, cost_usd: 0.002, output_text: null, output_hash: null, metadata: { logical_request_id: 'A', status: 'error', error_type: 'timeout' } }),
      trace(2, { request_id: 'a2', attempt: 2, cost_usd: 0.003, metadata: { logical_request_id: 'A' }, retry_reason: 'timeout' }),
      trace(3, { request_id: 'b1', attempt: 3, cost_usd: 0.003, metadata: { logical_request_id: 'B' }, retry_reason: 'rate_limited' }),
      trace(4, { request_id: 'c1', cost_usd: 0.003 }),
    ];
    const s = performanceSnapshot(rows, {});
    expect(s.samples).toMatchObject({ logical_requests: 3, recorded_attempts: 4, executed_attempts: 6 });
    expect(s.reliability).toMatchObject({ retry_count: 3, retried_requests: 2, retry_amplification: 2, timeout_count: 1, rate_limit_count: 1 });
    expect(s.economics.wasted_attempt_known_cost_usd).toBeCloseTo(0.002, 10);
    // B's two earlier attempts were never recorded: their cost is unknown, so coverage is 4/6.
    expect(s.economics.cost_coverage).toBeCloseTo(4 / 6, 5);
  });

  it('15. evidence completeness names the exact missing metrics', () => {
    const s = performanceSnapshot([trace(1, { cost_usd: null })], { required_metrics: ['cost', 'latency', 'quality', 'task_success', 'protected'], min_task_success_rate: 0.9 });
    expect(s.evidence.completeness).toBe('incomplete');
    expect(s.evidence.missing).toEqual(['cost: coverage 0% < required 90%', 'latency: 1 samples < required 20', 'protected: 0 protected requests < required 1']);
  });

  it('is deterministic for the same evidence', () => {
    const rows = demo();
    expect(performanceSnapshot(rows, DEMO_REQUIREMENTS).snapshot_hash).toBe(performanceSnapshot([...rows].reverse(), DEMO_REQUIREMENTS).snapshot_hash);
  });
});

// --------------------------------------------------------------- latency
const at = (s: number) => new Date(Date.UTC(2026, 9, 1) + s).toISOString();
const node = (id: string, kind: string, name: string, start: number | null, end: number | null, extra: Row = {}) => ({ id, stable_key: id.padEnd(64, '0'), kind, name, operation: null, started_at: start === null ? null : at(start), ended_at: end === null ? null : at(end), duration_ms: start !== null && end !== null ? end - start : null, latency_ms: null, ...extra });
const edge = (a: string, b: string, kind = 'CALLS') => ({ source_node_id: a, target_node_id: b, kind });
function agentGraph(withTimes = true) {
  const t = (n: number | null) => (withTimes ? n : null);
  return {
    id: 'g1',
    graph_hash: 'h1',
    root_node_id: 'task',
    nodes: [node('task', 'Task', 'req', t(0), t(3000)), node('agent', 'Agent', 'planner', t(100), t(2900)), node('m1', 'ModelCall', 'gpt-4o', t(200), t(1400)), node('ret', 'Retrieval', 'kb', t(300), t(600)), node('tool', 'ToolCall', 'lookup', t(1500), t(2200)), node('m2', 'ModelCall', 'gpt-4o', t(2300), t(2800))],
    edges: [edge('task', 'agent'), edge('agent', 'm1'), edge('agent', 'ret', 'RETRIEVES'), edge('agent', 'tool'), edge('agent', 'm2')],
  };
}

describe('latency / critical path', () => {
  it('walks the sequential chain and keeps parallel work off the path', () => {
    const cp = criticalPath(agentGraph());
    expect(cp.status).toBe('complete');
    expect(cp.root_duration_ms).toBe(3000);
    const self = Object.fromEntries(cp.path.map((p: { node_id: string; self_ms: number }) => [p.node_id, p.self_ms]));
    // Agent: 100 after m2, 100 between tool and m2, 100 between m1 and tool, 100 before m1; the retrieval overlaps m1 (parallel).
    expect(self).toEqual({ task: 200, agent: 400, m2: 500, tool: 700, m1: 1200 });
    expect(cp.path.some((p: { node_id: string }) => p.node_id === 'ret')).toBe(false);
    expect(Object.values(self).reduce((a, b) => a + b, 0)).toBe(3000);
  });

  it('23. missing timestamps or a cycle → INCOMPLETE, no invented path', () => {
    const untimed = criticalPath(agentGraph(false));
    expect(untimed).toMatchObject({ status: 'incomplete', path: [] });
    const cyclic = agentGraph();
    cyclic.edges.push(edge('m2', 'agent'));
    expect(criticalPath(cyclic)).toMatchObject({ status: 'incomplete', missing: ['call structure contains a cycle (or exceeds depth 64)'], path: [] });
    const a = latencyAnalysis([agentGraph(false)]);
    expect(a).toMatchObject({ status: 'incomplete', complete: 0, sample_paths: [] });
  });

  it('ranks hotspots with their share of observed root latency', () => {
    const a = latencyAnalysis([agentGraph()]);
    const model = a.hotspots.find((h: { class: string }) => h.class === 'ModelCall:gpt-4o');
    expect(model).toMatchObject({ samples: 2, critical_path_graphs: 2 });
    expect(model.mean_share_of_root).toBeCloseTo((1200 / 3000 + 500 / 3000) / 2, 6);
  });
});

// ----------------------------------------------------------------- diagnoses
function demoCtx(over: Row = {}) {
  const rows = demo();
  const snapshot = performanceSnapshot(rows, DEMO_REQUIREMENTS);
  return { product: PRODUCT, snapshot, traces: rows, graphs: [], latency: latencyAnalysis([], {}), requirements: DEMO_REQUIREMENTS, pricing: PRICING, ...over };
}

describe('Zev Diagnose v0.1', () => {
  it('16. repeated equivalent calls produce redundant_call diagnoses per scope', () => {
    const ds = diagnose(demoCtx());
    const reuse = ds.filter((d: { family: string }) => d.family === 'redundant_call');
    expect(reuse.map((d: { scope: string; metrics: { duplicate_calls: number } }) => [d.scope, d.metrics.duplicate_calls])).toEqual([['classify_ticket', 12], ['route_refund', 6]]);
  });

  it('17. no duplicates → no fake diagnosis', () => {
    const rows = Array.from({ length: 8 }, (_, i) => trace(i, { output_tokens: 300, input_tokens: 40 }));
    const ds = diagnose({ product: PRODUCT, snapshot: performanceSnapshot(rows, {}), traces: rows, graphs: [], latency: latencyAnalysis([]), requirements: {}, pricing: PRICING });
    expect(ds).toEqual([]);
  });

  it('18. retries produce retry_amplification with cost, latency and factor', () => {
    const d = diagnose(demoCtx()).find((x: { family: string }) => x.family === 'retry_amplification');
    expect(d.metrics).toMatchObject({ logical_requests: 30, executed_attempts: 32, retried_requests: 2, retry_reasons: { rate_limited: 2 }, failure_classes: { rate_limit: 2 }, retry_known_cost_usd: 0, retry_latency_ms: 1760 });
    expect(d.metrics.amplification).toBeCloseTo(32 / 30, 5);
  });

  it('19. context evidence produces context_amplification without claiming irrelevance', () => {
    const d = diagnose(demoCtx()).find((x: { family: string }) => x.family === 'context_amplification');
    expect(d.metrics.signals).toEqual(['oversized_input', 'uncached_stable_prefix', 'uncached_stable_prefix']);
    expect(d.root_cause).toMatch(/NOT established/);
  });

  it('20/21. frontier model on bounded work → overprovisioning, never a "safe" claim', () => {
    const d = diagnose(demoCtx()).find((x: { family: string }) => x.family === 'model_overprovisioning');
    expect(d.metrics).toMatchObject({ model: 'openai/gpt-4o', candidate_model: 'openai/gpt-4o-mini' });
    expect(d.root_cause).toMatch(/NOT known until a replay/);
    expect(`${d.symptom} ${d.root_cause}`).not.toMatch(/\bis safe\b|\bsafely\b/i);
    expect(d.required_additional_evidence[0]).toMatch(/replay/);
    // With every trace protected there is nothing to replay: the pass must not propose.
    const prot = demo().map((t: Row) => ({ ...t, protected: true }));
    const dp = diagnose({ ...demoCtx(), traces: prot }).find((x: { family: string }) => x.family === 'model_overprovisioning');
    expect(dp.metrics.replayable_samples).toBe(0);
    const { candidates, skipped } = generateCandidates([dp], { traces: prot, contract: { id: 'c', hash: 'h'.repeat(64), requirements: normalizeRequirements({}) }, snapshot: { id: 's', snapshot_hash: 'x' }, pricing: PRICING, allowedModels: new Set(['openai/gpt-4o-mini']), platformCompute: true });
    expect(candidates).toEqual([]);
    expect(skipped[0].reasons[0]).toMatch(/missing evidence: replayable_baseline_samples/);
  });

  it('22. latency over the contract budget produces latency_critical_path; share unknown without request timing', () => {
    const d = diagnose(demoCtx({ latency: latencyAnalysis([agentGraph(false), { ...agentGraph(false), id: 'g2', nodes: agentGraph(false).nodes.map((n) => ({ ...n, latency_ms: 2100 })) }]) })).find((x: { family: string }) => x.family === 'latency_critical_path');
    expect(d.symptom).toMatch(/exceeds the contract budget of 2000 ms/);
    expect(d.metrics.hotspot.mean_share_of_root).toBeNull();
    expect(d.required_additional_evidence[0]).toMatch(/timestamps/);
    const ok = diagnose(demoCtx({ latency: latencyAnalysis([agentGraph()]) })).find((x: { family: string }) => x.family === 'latency_critical_path');
    expect(ok.causal_path.length).toBeGreaterThan(1);
  });

  it('23. no timed evidence → no latency diagnosis', () => {
    const rows = demo().map((t: Row) => ({ ...t, latency_ms: null }));
    const ds = diagnose({ ...demoCtx(), traces: rows, snapshot: performanceSnapshot(rows, DEMO_REQUIREMENTS), latency: latencyAnalysis([agentGraph(false)]) });
    expect(ds.some((d: { family: string }) => d.family === 'latency_critical_path')).toBe(false);
  });

  it('24/25. every diagnosis has evidence refs and a falsifier; hashes are deterministic', () => {
    const a = diagnose(demoCtx());
    const b = diagnose({ ...demoCtx(), traces: [...demo()].reverse() });
    expect(a.length).toBeGreaterThanOrEqual(5);
    for (const d of a) {
      expect(d.evidence_refs.length).toBeGreaterThan(0);
      expect(d.falsifier.length).toBeGreaterThan(10);
      expect(d.version).toBe('diag_v0.1');
    }
    expect(a.map((d: { diagnosis_hash: string }) => d.diagnosis_hash)).toEqual(b.map((d: { diagnosis_hash: string }) => d.diagnosis_hash));
  });
});

// ---------------------------------------------------------- optimization passes
function passCtx(over: Row = {}) {
  return { traces: demo(), contract: { id: 'c1', hash: 'c'.repeat(64), requirements: normalizeRequirements(DEMO_REQUIREMENTS) }, snapshot: { id: 's1', snapshot_hash: 's'.repeat(64) }, pricing: PRICING, allowedModels: new Set(['openai/gpt-4o-mini', 'openai/gpt-4o']), platformCompute: false, ...over };
}

describe('OptimizationPass v0.1', () => {
  it('declares the full interface', () => {
    for (const p of PASSES) for (const k of ['id', 'version', 'applicability', 'requiredEvidence', 'propose', 'expectedEffects', 'riskClass', 'protectedSlices', 'falsifier', 'rollback', 'materializerHints']) expect(p).toHaveProperty(k);
  });

  it('26. applicability is deterministic and family-scoped', () => {
    const ds = diagnose(demoCtx());
    const reuse = ds.find((d: { family: string }) => d.family === 'redundant_call');
    expect(redundantCallPass.applicability(reuse, passCtx())).toEqual({ applicable: true, reasons: [] });
    expect(modelProviderPass.applicability(reuse, passCtx()).applicable).toBe(false);
    const blocked = { ...reuse, metrics: { ...reuse.metrics, reusable_groups: 0 } };
    expect(redundantCallPass.applicability(blocked, passCtx()).applicable).toBe(false);
  });

  it('27. required evidence is enforced (contract forbids the candidate model)', () => {
    const d = diagnose(demoCtx()).find((x: { family: string }) => x.family === 'model_overprovisioning');
    const ctx = passCtx({ contract: { id: 'c1', hash: 'c'.repeat(64), requirements: normalizeRequirements({ ...DEMO_REQUIREMENTS, allowed_models: ['openai/gpt-4o'] }) } });
    const { candidates, skipped } = generateCandidates([d], ctx);
    expect(candidates).toEqual([]);
    expect(skipped[0].reasons[0]).toMatch(/does not allow openai\/gpt-4o-mini/);
  });

  it('28/29. candidates keep lineage; unsupported ones are NOT_EXECUTABLE / NEEDS_IMPLEMENTATION and BLOCKED', () => {
    const { candidates } = generateCandidates(diagnose(demoCtx()), passCtx());
    for (const c of candidates) {
      expect(c).toMatchObject({ contract_hash: 'c'.repeat(64), baseline_snapshot_id: 's1' });
      expect(c.diagnosis_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.lineage.falsifier).toBeTruthy();
      expect(c.lineage.rollback).toBeTruthy();
      if (c.executable_status !== EXECUTABLE) expect(c.status).toBe('BLOCKED');
    }
    const by = (s: string) => candidates.filter((c: { strategy: string }) => c.strategy === s).map((c: { executable_status: string }) => c.executable_status);
    expect(by('exact_reuse')).toEqual([EXECUTABLE, EXECUTABLE]);
    expect(by('model_substitution')).toEqual([NOT_EXECUTABLE]);
    expect(by('retry_policy')).toEqual([NEEDS_IMPLEMENTATION]);
    const withCompute = generateCandidates(diagnose(demoCtx()), passCtx({ platformCompute: true })).candidates.filter((c: { strategy: string }) => c.strategy === 'model_substitution');
    expect(withCompute[0].executable_status).toBe(EXECUTABLE);
  });

  it('30. same evidence → same candidate config hash; a different contract → a different one', () => {
    const a = generateCandidates(diagnose(demoCtx()), passCtx()).candidates.map((c: { candidate_config_hash: string }) => c.candidate_config_hash);
    const b = generateCandidates(diagnose(demoCtx()), passCtx()).candidates.map((c: { candidate_config_hash: string }) => c.candidate_config_hash);
    expect(a).toEqual(b);
    const c = generateCandidates(diagnose(demoCtx()), passCtx({ contract: { id: 'c2', hash: 'd'.repeat(64), requirements: normalizeRequirements(DEMO_REQUIREMENTS) } })).candidates.map((x: { candidate_config_hash: string }) => x.candidate_config_hash);
    expect(c.some((h: string, i: number) => h === a[i])).toBe(false);
  });
});

// ------------------------------------------------------------------- verdict
const LABELS = ['billing', 'technical', 'account'];
function substitutionFixture(answer: (i: number) => string, { cost = 0.0005, latency = 300 }: { cost?: number | null; latency?: number } = {}) {
  const traces = Array.from({ length: 10 }, (_, i) => trace(i, { input_text: `case ${i}`, output_text: LABELS[i % 3], expected_output: LABELS[i % 3], latency_ms: 1000 + i * 10 }));
  const plan = { ...planModelSubstitution(traces, null, { candidateModel: 'openai/gpt-4o-mini', allowedModels: new Set(['openai/gpt-4o-mini']), maxBudgetUsd: 1, pricing: PRICING }), id: 'plan-1' };
  const byInput = new Map(traces.map((t, i) => [t.input_text, i]));
  const complete = async (payload: { messages: { role: string; content: string }[] }) => {
    const i = byInput.get(payload.messages[payload.messages.length - 1].content) ?? 0;
    return { content: answer(i), cost, latencyMs: latency, inputTokens: cost === null ? null : 40, outputTokens: cost === null ? null : 1, model: 'openai/gpt-4o-mini', requestId: `gen-${i}` };
  };
  return { traces, plan, complete };
}
async function verdict(fx: ReturnType<typeof substitutionFixture>, requirements: Row, projectRequirements: Row = {}) {
  const execution = await executePlan({ plan: fx.plan, traces: fx.traces as never, complete: fx.complete, pricing: PRICING, allowedModels: new Set(['openai/gpt-4o-mini']) });
  return evaluateUnderContract({ execution, plan: fx.plan, traces: fx.traces, contract: { id: 'c1', contract_hash: 'c'.repeat(64), requirements }, projectRequirements });
}
const STRICT = { ...DEMO_REQUIREMENTS, latency: { require: true, max_p95_ms: 2000, max_regression_pct: 20 }, evidence: { min_samples: 5, min_latency_samples: 5, min_outcome_coverage: 0.8 } };

describe('verdict under the frozen contract', () => {
  it('34. every required gate passes → VERIFIED, bound to the contract hash', async () => {
    const r = await verdict(substitutionFixture((i) => LABELS[i % 3]), STRICT);
    expect(r.status).toBe('VERIFIED');
    expect(r.contract_hash).toBe('c'.repeat(64));
    expect(r.performance_comparison.realized_production_result).toBe('NOT YET MEASURED');
    expect(r.performance_comparison.deltas_pct.p95).toBeLessThan(0);
  });

  it('31. cheaper but quality floor failed → REJECTED', async () => {
    const r = await verdict(substitutionFixture((i) => (i < 3 ? 'technical' : LABELS[i % 3])), STRICT);
    expect(r.status).toBe('REJECTED');
    expect(r.rejection_reason).toMatch(/quality_floor/);
    expect(r.performance_comparison.deltas_pct.cost).toBeLessThan(0);
  });

  it('32. faster but task-success floor failed → REJECTED (even with a lax quality floor)', async () => {
    const lax = { ...STRICT, quality_floor: 0.5, quality_tolerance: 0.5, min_task_success_rate: 0.95 };
    const r = await verdict(substitutionFixture((i) => (i < 3 ? 'technical' : LABELS[i % 3])), lax);
    expect(r.gates.find((g: { name: string }) => g.name === 'quality_floor').outcome).toBe('passed');
    expect(r.status).toBe('REJECTED');
    expect(r.rejection_reason).toMatch(/task_success_floor/);
  });

  it('33. cheaper and faster but cost evidence incomplete → INCOMPLETE', async () => {
    const r = await verdict(substitutionFixture((i) => LABELS[i % 3], { cost: null }), STRICT);
    expect(r.status).toBe('INCOMPLETE');
    expect(r.gates.find((g: { name: string }) => g.name === 'cost_coverage').outcome).toBe('missing');
  });

  it('35. the project floor still applies and nothing lowers a frozen threshold', async () => {
    const r = await verdict(substitutionFixture((i) => (i === 0 ? 'technical' : LABELS[i % 3])), { ...STRICT, quality_floor: 0.85 }, { quality_floor: 0.95 });
    expect(r.gates.find((g: { name: string }) => g.name === 'quality_floor').threshold).toBe(0.95);
    expect(r.status).toBe('REJECTED');
  });

  it('protected cases that fail reject a candidate that is cheaper and faster', async () => {
    const fx = substitutionFixture((i) => LABELS[i % 3]);
    const prot = fx.traces.map((t, i) => (i === 1 ? { ...t, protected: true } : t));
    const plan = { ...fx.plan, sample_scope: prot.map((t) => t.id) };
    const execution = await executePlan({ plan, traces: prot as never, complete: async () => ({ content: 'billing', cost: 0.0005, latencyMs: 300, inputTokens: 40, outputTokens: 1, model: 'openai/gpt-4o-mini', requestId: 'g' }), pricing: PRICING, allowedModels: new Set(['openai/gpt-4o-mini']) });
    const r = evaluateUnderContract({ execution, plan, traces: prot, contract: { id: 'c1', contract_hash: 'c'.repeat(64), requirements: { ...STRICT, quality_floor: 0.5, quality_tolerance: 0.5, min_task_success_rate: 0.3, task_success_tolerance: 0.5 } } });
    expect(r.gates.find((g: { name: string }) => g.name === 'protected_slice').outcome).toBe('failed');
    expect(r.status).toBe('REJECTED');
  });

  it('exact reuse verdicts match the engine’s own evaluator when the contract adds nothing', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => trace(i, { input_text: 'same', output_text: 'billing', expected_output: 'billing' }));
    const plan = { ...planExactReuse(rows as never, null), id: 'p' };
    const execution = await executePlan({ plan, traces: rows as never, complete: async () => { throw new Error('no provider'); }, pricing: PRICING, allowedModels: new Set() });
    const r = evaluateUnderContract({ execution, plan, traces: rows, contract: { id: 'c', contract_hash: 'c'.repeat(64), requirements: { required_metrics: ['cost', 'quality'], latency: { require: false, max_p95_ms: null, max_regression_pct: 20 } } } });
    expect(r.status).toBe('VERIFIED');
  });
});
