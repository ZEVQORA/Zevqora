/**
 * vNext Part 2B — Optimization Intelligence, pure logic. Numbers in test names
 * refer to the required test list (plan composition, passes, search,
 * calibration, Pareto, policy, bad-day). SYNTHETIC — NOT CUSTOMER DATA.
 */
import { describe, expect, it } from 'vitest';
import { agentGraph, context, CONTRACT_HASH, demoRows, PRICING, REQUIREMENTS, search, SNAPSHOT_HASH, type Row } from './helpers/plan-fixtures';
import { buildRuleSet, canonicalTransformation, compose, mergeTransformations, pairCompatibility, planExecutable, planHash } from '../api/_lib/optimize/transformations.js';
import { cachePass, agentWorkflowPass, deterministicReplacementPass, retrievalOptimizationPass, SEARCH_PASSES, finalRows } from '../api/_lib/optimize/passes-intelligence.js';
import { diagnose, noProgressRepeats } from '../api/_lib/optimize/diagnose.js';
import { calibrationOrder, evaluationSet, normalizeBounds, searchHash, servingSimulation } from '../api/_lib/optimize/search.js';
import { boundsAnalysis, decideCalibration, selectSample, CALIBRATION_LABEL } from '../api/_lib/optimize/calibration.js';
import { applyPolicy, compare, paretoFrontier, paretoPoint } from '../api/_lib/optimize/pareto.js';
import { badDayReplay, normalizeProfile, observedPolicy, overlay } from '../api/_lib/optimize/badday.js';
import { assertExecutable, executeComposedPlan } from '../api/_lib/optimize/composed.js';
import { performanceSnapshot } from '../api/_lib/optimize/performance.js';

const rules = buildRuleSet(SEARCH_PASSES);
const base = { pass: 'test', pass_version: '0', sources: [], risk_class: 'low', implementation_complexity: 1, rollback_complexity: 1, falsifier: 'f', rollback: 'r', executable_status: 'EXECUTABLE' };
const tx = (o: Row) => canonicalTransformation({ ...base, ...o });
const cache = (scope: string, ttl: number | null, ids: string[] = []) => tx({ kind: 'exact_response_reuse', scope, settings: { [`response_cache:${scope}`]: { ttl_ms: ttl } }, config: { ttl_ms: ttl }, affected_trace_ids: ids });
const lookup = (scope: string, ids: string[] = []) => tx({ kind: 'exact_lookup', scope, settings: { [`lookup:${scope}`]: { min_validated: 1 } }, config: { min_validated: 1 }, affected_trace_ids: ids, risk_class: 'medium', implementation_complexity: 3 });
const model = (ids: string[], o: Row = {}) => tx({ kind: 'model_substitution', scope: 'openai/gpt-4o', settings: { 'model:openai/gpt-4o': 'openai/gpt-4o-mini' }, config: { from: 'openai/gpt-4o', to: 'openai/gpt-4o-mini', temperature: 0, max_tokens: 64 }, affected_trace_ids: ids, risk_class: 'medium', ...o });
const rows = demoRows();
const plans = search(rows);
const byName = (name: RegExp) => plans.plans.filter((p: Row) => name.test(p.name));

describe('plan composition', () => {
  it('1. compatible passes compose (cache on one scope + lookup on another; cache in front of a smaller model)', () => {
    const c = compose([cache('classify_ticket', 3_600_000, ['a']), lookup('route_refund', ['b'])], rules);
    expect(c.compatibility.compatible).toBe(true);
    const m = compose([model(['a', 'b']), cache('classify_ticket', 3_600_000, ['a'])], rules);
    expect(m.compatibility).toMatchObject({ compatible: true, dependencies: [{ kinds: ['exact_response_reuse', 'model_substitution'] }] });
  });

  it('2. conflicting passes are rejected, with the reason, never resolved silently', () => {
    const ttl = compose([cache('classify_ticket', 3_600_000), cache('classify_ticket', 21_600_000)], rules);
    expect(ttl.compatibility.compatible).toBe(false);
    expect(ttl.compatibility.conflicts[0].reason).toMatch(/both set response_cache:classify_ticket to different values/);
    const inter = compose([cache('classify_ticket', 3_600_000), lookup('classify_ticket')], rules);
    expect(inter.compatibility.conflicts[0].reason).toMatch(/no precedence rule/);
    // Two changes on the same path without a declared rule conflict too.
    const undeclared = pairCompatibility(lookup('x', ['1']), tx({ kind: 'retry_policy', scope: 'x', settings: { 'retry:x': 1 }, executable_status: 'NEEDS_IMPLEMENTATION' }), rules);
    expect(undeclared.compatible).toBe(true); // declared: lookup → retry
    const none = pairCompatibility(tx({ kind: 'context_window_cap', scope: 'w', call_site: 'p', settings: { a: 1 }, executable_status: 'NEEDS_IMPLEMENTATION' }), tx({ kind: 'retrieval_top_k', scope: 'w', call_site: 'p', settings: { b: 1 }, executable_status: 'NEEDS_IMPLEMENTATION' }), rules);
    expect(none).toMatchObject({ compatible: false });
    expect(plans.plans.filter((p: Row) => p.status === 'CONFLICTED').every((p: Row) => p.conflict_reasons.length > 0)).toBe(true);
  });

  it('3. composition order is deterministic: outer layer first, interceptors before model routing', () => {
    const a = compose([model(['a']), cache('s', 3_600_000, ['a'])], rules).ordered.map((t: Row) => t.kind);
    const b = compose([cache('s', 3_600_000, ['a']), model(['a'])], rules).ordered.map((t: Row) => t.kind);
    expect(a).toEqual(['exact_response_reuse', 'model_substitution']);
    expect(b).toEqual(a);
  });

  it('4. same transformations in a different input order → same plan hash', () => {
    const x = [cache('s', 3_600_000), lookup('t'), model(['z'])];
    const h1 = planHash({ contractHash: CONTRACT_HASH, snapshotHash: SNAPSHOT_HASH, transformations: x });
    const h2 = planHash({ contractHash: CONTRACT_HASH, snapshotHash: SNAPSHOT_HASH, transformations: [...x].reverse() });
    expect(h1).toBe(h2);
    expect(planHash({ contractHash: 'e'.repeat(64), snapshotHash: SNAPSHOT_HASH, transformations: x })).not.toBe(h1);
  });

  it('5. a duplicate plan is deduplicated (same transformation from two passes merges)', () => {
    const one = cache('s', null);
    const merged = mergeTransformations([{ ...one, sources: [{ pass: 'a', diagnosis_hash: '1' }] }, { ...one, sources: [{ pass: 'b', diagnosis_hash: '2' }] }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((s: Row) => s.pass)).toEqual(['a', 'b']);
    const hashes = plans.plans.map((p: Row) => p.plan_hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('6. max transformations per plan is enforced', () => {
    expect(Math.max(...plans.plans.map((p: Row) => p.ordered.length))).toBe(3);
    const two = search(rows, { bounds: { max_transformations_per_plan: 2 } });
    expect(Math.max(...two.plans.map((p: Row) => p.ordered.length))).toBe(2);
    const one = search(rows, { bounds: { max_transformations_per_plan: 1 } });
    expect(one.plans.every((p: Row) => p.ordered.length === 1)).toBe(true);
    expect(() => normalizeBounds({ max_transformations_per_plan: 4 })).toThrow(/between 1 and 3/);
  });
});

describe('cache pass', () => {
  const { diagnoses, ctx } = context(rows);
  const classify = diagnoses.find((d: Row) => d.family === 'redundant_call' && d.scope === 'classify_ticket');

  it('7. exact repeated inputs generate a safe exact-cache candidate with full metadata', () => {
    const out = cachePass.transformations(classify, ctx);
    expect(out.length).toBeGreaterThan(0);
    for (const t of out) {
      expect(t.executable_status).toBe('EXECUTABLE');
      expect(t.metadata).toMatchObject({ cache_scope: 'classify_ticket', ttl_ms: expect.any(Number), observed_repeat_rate: expect.any(Number), expected_hit_rate: expect.any(Number), staleness_risk: expect.stringMatching(/at most/) });
      expect(t.metadata.invalidation_requirements.length).toBeGreaterThan(0);
      expect(t.metadata.data_sensitivity).toBeTruthy();
      expect(t.rollback).toMatch(/Disable the cache/);
    }
  });

  it('8. no repeated input → no cache opportunity is invented', () => {
    const unique = rows.filter((t: Row) => /-0$/.test(t.request_id) || /protected|unpriced/.test(t.request_id));
    const d2 = context(unique).diagnoses;
    expect(d2.some((d: Row) => d.family === 'redundant_call')).toBe(false);
    expect(d2.flatMap((d: Row) => cachePass.transformations(d, ctx))).toEqual([]);
  });

  it('9. no safe invalidation (prompt version not in the key) → candidate blocked', () => {
    const noPrompt = rows.map((t: Row) => ({ ...t, system_prompt: null, system_prompt_hash: null, metadata: { ...t.metadata } }));
    const c2 = context(noPrompt);
    const d = c2.diagnoses.find((x: Row) => x.family === 'redundant_call' && x.scope === 'classify_ticket');
    const out = cachePass.transformations(d, c2.ctx);
    expect(out.every((t: Row) => t.executable_status === 'NOT_EXECUTABLE' && /No safe invalidation/.test(t.not_executable_reason))).toBe(true);
    const sensitive = rows.map((t: Row) => (t.symbol === 'classify_ticket' ? { ...t, metadata: { ...t.metadata, data_sensitivity: 'pii' } } : t));
    const c3 = context(sensitive);
    const s = cachePass.transformations(c3.diagnoses.find((x: Row) => x.scope === 'classify_ticket' && x.family === 'redundant_call'), c3.ctx);
    expect(s.every((t: Row) => t.executable_status === 'NOT_EXECUTABLE' && /sensitive/.test(t.not_executable_reason))).toBe(true);
  });

  it('10. unknown hit rate stays unknown (no timestamps → no TTL, NEEDS_EVIDENCE, hit rate null)', () => {
    const untimed = rows.map((t: Row) => ({ ...t, timestamp: null }));
    const c4 = context(untimed);
    const d = c4.diagnoses.find((x: Row) => x.family === 'redundant_call' && x.scope === 'classify_ticket');
    const [t] = cachePass.transformations(d, c4.ctx);
    expect(t.metadata.expected_hit_rate).toBeNull();
    expect(t.required_evidence.find((e: Row) => e.key === 'request_timestamps').present).toBe(false);
    expect(canonicalTransformation({ ...t, sources: [] }).missing_evidence).toContain('request_timestamps');
  });
});

describe('agent workflow pass', () => {
  const run = (loop: boolean, start = 0) =>
    agentGraph([
      { kind: 'Retrieval', name: 'kb', input: 'q', output: 'd', docs: ['k1', 'k2'] },
      { kind: 'ToolCall', name: 'lookup_order', input: '1001', output: 'delivered' },
      { kind: 'ModelCall', name: 'plan', input: 'p', output: 'verify' },
      ...(loop ? [{ kind: 'ToolCall' as const, name: 'lookup_order', input: '1001', output: 'delivered' }, { kind: 'ModelCall' as const, name: 'plan', input: 'p', output: 'verify' }] : [{ kind: 'ToolCall' as const, name: 'lookup_order', input: '1001', output: 'delivered' }]),
    ], { start });
  const diag = (graphs: Row[]) => diagnose({ product: { id: 'p' }, snapshot: performanceSnapshot([], REQUIREMENTS, {}), traces: [], graphs, latency: { hotspots: [] }, requirements: REQUIREMENTS, pricing: PRICING }).filter((d: Row) => d.family === 'agent_workflow');

  it('11. a repeated tool call with unchanged arguments and result is detected', () => {
    const [d] = diag([run(false)]);
    expect(d.metrics).toMatchObject({ repeated_tool_calls: 1, patterns: expect.arrayContaining(['repeated_tool_call']) });
    expect(d.evidence_refs.length).toBeGreaterThan(0);
  });

  it('12. a no-progress loop is detected structurally', () => {
    const g = run(true);
    const agentId = g.nodes.find((n: Row) => n.kind === 'Agent').id;
    const steps = g.edges.filter((e: Row) => e.source_node_id === agentId).map((e: Row) => g.nodes.find((n: Row) => n.id === e.target_node_id));
    expect(noProgressRepeats(g, steps).map((n: Row) => n.kind)).toEqual(['ToolCall', 'ModelCall']);
    expect(diag([g])[0].metrics.no_progress_loops).toBe(1);
  });

  it('13. a repeated call whose result changed is NOT collapsed', () => {
    const g = agentGraph([
      { kind: 'ToolCall', name: 'poll_status', input: 'job', output: 'pending' },
      { kind: 'ToolCall', name: 'poll_status', input: 'job', output: 'done' },
    ]);
    const d = diag([g]);
    expect(d).toHaveLength(0); // nothing redundant: the state changed
    const g2 = agentGraph([{ kind: 'ToolCall', name: 'poll', input: 'j', output: 'a' }, { kind: 'ToolCall', name: 'poll', input: 'j', output: 'a' }, { kind: 'ToolCall', name: 'poll', input: 'j', output: 'b' }]);
    expect(diag([g2])[0].metrics).toMatchObject({ repeated_tool_calls: 1, changed_state_repeats: 1 });
  });

  it('14. a step-budget candidate is generated from observed steps', () => {
    const [d] = diag([run(true), run(false, 1), run(false, 2)]);
    const out = agentWorkflowPass.transformations(d);
    expect(out.map((t: Row) => t.kind).sort()).toEqual(['agent_loop_guard', 'agent_step_budget', 'repeated_tool_suppression']);
    expect(out.find((t: Row) => t.kind === 'agent_step_budget').config).toMatchObject({ max_steps: expect.any(Number), basis: expect.stringMatching(/observed/) });
  });

  it('15. an unsupported agent edit is never executable', () => {
    const [d] = diag([run(true)]);
    for (const t of agentWorkflowPass.transformations(d)) {
      expect(t.executable_status).toBe('NEEDS_IMPLEMENTATION');
      expect(() => canonicalTransformation({ ...t, executable_status: 'EXECUTABLE' })).toThrow(/no executor/);
    }
  });
});

describe('retrieval pass', () => {
  const rag = (repeat: boolean, count = 10) =>
    agentGraph([
      { kind: 'Retrieval', name: 'kb_search', input: 'policy', output: 'docs-a', docs: ['k1', 'k2', 'k3'], count, ms: 900 },
      { kind: 'ModelCall', name: 'answer', input: 'x', output: 'y', ms: 300 },
      ...(repeat ? [{ kind: 'Retrieval' as const, name: 'kb_search', input: 'policy', output: 'docs-b', docs: ['k2', 'k3', 'k4'], count, ms: 400 }] : []),
    ]);
  const diag = (graphs: Row[], latency: Row = { hotspots: [] }) => diagnose({ product: { id: 'p' }, snapshot: performanceSnapshot([], REQUIREMENTS, {}), traces: [], graphs, latency, requirements: REQUIREMENTS, pricing: PRICING }).filter((d: Row) => d.family === 'retrieval_redundancy');

  it('16. duplicate chunks are detected', () => {
    expect(diag([rag(true)])[0].metrics.duplicate_chunk_refs).toBe(2);
  });

  it('17. a repeated retrieval is detected', () => {
    expect(diag([rag(true)])[0].metrics).toMatchObject({ repeat_retrievals: 1, query_repeat_rate: 0.5 });
  });

  it('18. a high top-k candidate requires replay and is never executable', () => {
    const [d] = diag([rag(false, 12)]);
    const k = retrievalOptimizationPass.transformations(d).find((t: Row) => t.kind === 'retrieval_top_k');
    expect(k.config).toMatchObject({ from: 12, to: 6, requires_replay: true });
    expect(k.executable_status).toBe('NEEDS_IMPLEMENTATION');
    expect(k.expected_effects.quality.direction).toBe('unknown');
  });

  it('19. no semantic "irrelevant" claim is made from hashes', () => {
    const [d] = diag([rag(true)]);
    expect(d.root_cause).toMatch(/Whether any chunk is irrelevant is NOT established/);
    expect(d.symptom).not.toMatch(/irrelevant/i);
    expect(Object.keys(d.metrics).join(' ')).not.toMatch(/irrelevant/i);
  });

  it('20. retrieval latency evidence is retained', () => {
    const [d] = diag([rag(true)], { hotspots: [{ kind: 'Retrieval', name: 'kb_search', mean_share_of_root: 0.6, critical_path_graphs: 1 }] });
    expect(d.metrics.latency).toMatchObject({ samples: 2, p95_ms: 900, mean_share_of_root: 0.6, critical_path_graphs: 1 });
    expect(d.metrics.signals).toContain('retrieval_latency_hotspot');
  });
});

describe('deterministic replacement pass', () => {
  const { diagnoses, ctx } = context(rows);
  const classify = diagnoses.find((d: Row) => d.family === 'redundant_call' && d.scope === 'classify_ticket');

  it('21. an exact enum mapping produces a validated lookup candidate', () => {
    const [t] = deterministicReplacementPass.transformations(classify, ctx);
    expect(t).toMatchObject({ kind: 'exact_lookup', executable_status: 'EXECUTABLE' });
    expect(t.metadata.applicability_reason).toMatch(/enum outputs/);
  });

  it('22. ambiguous semantic work gets no deterministic replacement', () => {
    const prose = rows.map((t: Row) => (t.symbol === 'classify_ticket' ? { ...t, output_text: `Thanks for reaching out about ${t.input_text}. We will look into it.` } : t));
    const c2 = context(prose);
    const d = c2.diagnoses.find((x: Row) => x.family === 'redundant_call' && x.scope === 'classify_ticket');
    expect(deterministicReplacementPass.applicability(d, c2.ctx)).toMatchObject({ applicable: false, reasons: [expect.stringMatching(/semantic work/)] });
    expect(deterministicReplacementPass.transformations(d, c2.ctx)).toEqual([]);
  });

  it('23. the output contract is retained', () => {
    const [t] = deterministicReplacementPass.transformations(classify, ctx);
    expect(t.metadata.output_contract).toEqual({ type: 'enum', values: ['account', 'billing', 'technical'] });
    expect(t.metadata.input_contract.exact).toBe(true);
  });

  it('24. a fallback path and rollback are required', () => {
    const [t] = deterministicReplacementPass.transformations(classify, ctx);
    expect(t.metadata.fallback_path).toMatch(/baseline path/);
    expect(t.metadata.failure_mode).toMatch(/miss/);
    expect(t.rollback).toMatch(/Disable the lookup/);
    expect(() => canonicalTransformation({ ...t, rollback: '' })).toThrow(/rollback/);
  });
});

describe('search', () => {
  it('25. the generation bound is enforced and the truncation is reported', () => {
    const small = search(rows, { bounds: { max_generated_plans: 10 } });
    expect(small.plans).toHaveLength(10);
    expect(small.generation.truncated).toBeGreaterThan(0);
    expect(small.generation.truncation_note).toMatch(/max_generated_plans = 10/);
  });

  it('26. candidate ordering and plan hashes are deterministic and order-independent', () => {
    const again = search(rows, { diagnosesOrder: (d) => [...d].reverse() });
    const shuffled = search([...rows].reverse());
    const key = (s: Row) => s.plans.map((p: Row) => `${p.plan_hash}:${p.status}`).join('|');
    expect(key(again)).toBe(key(plans));
    expect(key(shuffled)).toBe(key(plans));
    expect(calibrationOrder(again.plans).map((p: Row) => p.plan_hash)).toEqual(calibrationOrder(plans.plans).map((p: Row) => p.plan_hash));
    expect(searchHash({ contractHash: CONTRACT_HASH, snapshotHash: SNAPSHOT_HASH, diagnoses: [...plans.diagnoses].reverse(), bounds: normalizeBounds({}), seed: 's' })).toBe(searchHash({ contractHash: CONTRACT_HASH, snapshotHash: SNAPSHOT_HASH, diagnoses: plans.diagnoses, bounds: normalizeBounds({}), seed: 's' }));
  });

  it('27. conflicts are pruned from execution (CONFLICTED, never calibrated)', () => {
    const conflicted = plans.plans.filter((p: Row) => p.status === 'CONFLICTED');
    expect(conflicted.length).toBeGreaterThan(0);
    expect(conflicted.every((p: Row) => p.estimate === null && !p.compatibility.compatible)).toBe(true);
  });

  it('28. duplicate plans are pruned (unique hashes; merged transformations)', () => {
    expect(new Set(plans.transformations.map((t: Row) => t.hash)).size).toBe(plans.transformations.length);
    const kinds = plans.transformations.filter((t: Row) => t.kind === 'provider_prompt_cache');
    expect(kinds).toHaveLength(1); // proposed by ContextMemory and Cache passes → one transformation
  });

  it('29. estimated plans are pruned as dominated only when the comparison is valid', () => {
    const pruned = plans.plans.filter((p: Row) => p.status === 'PRUNED' && p.pruned_by);
    expect(pruned.length).toBeGreaterThan(0);
    for (const p of pruned) {
      const dom = plans.plans.find((x: Row) => x.plan_hash === p.pruned_by);
      expect(dom.estimate.signature).toBe(p.estimate.signature); // identical serving → identical answers
    }
    // Plans with different answers are never pruned against each other, however their estimates compare.
    const lookupPlan = byName(/^Validated exact lookup · classify_ticket$/)[0];
    const reusePlan = byName(/^Exact reuse \(no expiry\) · classify_ticket$/)[0];
    expect(lookupPlan.estimate.signature).not.toBe(reusePlan.estimate.signature);
    expect([lookupPlan.status, reusePlan.status]).toEqual(['CALIBRATION_READY', 'CALIBRATION_READY']);
  });

  it('30. unknown values never become zero in estimates', () => {
    const p = byName(/^Validated exact lookup · classify_ticket$/)[0];
    expect(p.estimate.effects.p95_latency_ms).toMatchObject({ value: null, unknown: true, label: 'ESTIMATED' });
    expect(p.estimate.effects.cost_per_successful_outcome_usd.value).toBeNull();
    expect(p.estimate.effects.task_success.value).toBeNull();
    const ev = evaluationSet(rows, { max: 60, seed: 's' });
    expect(ev.excluded).toEqual([{ trace_id: expect.any(String), request_id: 'demo-unpriced-0', reasons: ['cost_unknown'] }]);
  });
});

describe('calibration', () => {
  const p = byName(/^Validated exact lookup · classify_ticket \+ Validated exact lookup · route_refund$/)[0];
  const ids = new Set(plans.evaluation.ids);
  const W = rows.filter((t: Row) => ids.has(t.id));
  const pick = (round = 1, seed = 'seed') => selectSample({ plan: p, rows: W, round, perPlan: 10, rounds: 2, seed, requirements: REQUIREMENTS });

  it('31. sample selection is deterministic and outcome-blind', () => {
    expect(pick()).toEqual(pick());
    expect(selectSample({ plan: p, rows: [...W].reverse(), round: 1, perPlan: 10, rounds: 2, seed: 'seed', requirements: REQUIREMENTS }).ids).toEqual(pick().ids);
    expect(pick(1, 'other').hash).not.toBe(pick().hash);
    // Round 2 extends round 1.
    expect(pick(2).ids).toEqual(expect.arrayContaining(pick(1).ids));
  });

  it('32. protected cases are preserved when the contract requires them', () => {
    const prot = W.filter((t: Row) => t.protected).map((t: Row) => t.id);
    expect(pick().ids).toEqual(expect.arrayContaining(prot));
    const loose = selectSample({ plan: p, rows: W, round: 1, perPlan: 10, rounds: 2, seed: 'seed', requirements: { ...REQUIREMENTS, protected: { require_cases: false, min_cases: 0 }, required_metrics: ['cost', 'latency', 'quality', 'task_success'] } });
    expect(loose.ids.some((id: string) => prot.includes(id))).toBe(false);
  });

  const grades = new Map(W.map((t: Row) => [t.id, { score: t.output_text === t.expected_output ? 1 : 0, passed: t.output_text === t.expected_output }]));
  const sim = p.estimate.simulation;
  const caseFor = (id: string, pass: boolean, protectedCase = false) => ({ case_id: `case:${id}`, baseline_trace_id: id, protected: protectedCase, candidate_grader: [{ passed: pass }], candidate_score: pass ? 1 : 0, baseline_cost_usd: 0.004, candidate_cost_usd: pass ? 0 : 0, baseline_latency_ms: 1000, candidate_latency_ms: 1 });
  const changed = sim.filter((s: Row) => s.served_by).map((s: Row) => s.id);

  it('33. a hard failure rejects early, and only when the full replay could not pass', () => {
    const failing = { cases: changed.slice(0, 3).map((id: string) => caseFor(id, false)), gates: [] };
    const b = boundsAnalysis({ result: failing, sampleIds: changed.slice(0, 3), rows: W, simulation: sim, baselineGrades: grades, requirements: REQUIREMENTS, composition: p.ordered });
    expect(b.certain_failures.join(' ')).toMatch(/task_success_floor: at most/);
    const d = decideCalibration({ result: failing, execution: { status: 'SUCCEEDED', sample_results: [] }, sample: { affected_in_sample: 3, units_remaining: 5 }, bounds: b, round: 1, maxRounds: 2 });
    expect(d).toMatchObject({ outcome: 'FAILED_HARD_GATE', next: 'stop' });
    // One failure is not yet certain: unsampled changed cases could still pass.
    const one = boundsAnalysis({ result: { cases: [caseFor(changed[0], false)], gates: [] }, sampleIds: [changed[0]], rows: W, simulation: sim, baselineGrades: grades, requirements: { ...REQUIREMENTS, min_task_success_rate: 0.9, task_success_tolerance: 0.1, quality_tolerance: 0.1, quality_floor: 0.9 }, composition: [] });
    expect(one.certain_failures).toEqual([]);
    // A protected failure is certain.
    const prot = W.find((t: Row) => t.protected).id;
    const pb = boundsAnalysis({ result: { cases: [caseFor(prot, false, true)], gates: [] }, sampleIds: [prot], rows: W, simulation: sim, baselineGrades: grades, requirements: REQUIREMENTS, composition: [] });
    expect(pb.certain_failures.join(' ')).toMatch(/protected_slice/);
  });

  it('34. a calibration win is never VERIFIED', () => {
    const win = { cases: changed.map((id: string) => caseFor(id, true)), gates: [] };
    const b = boundsAnalysis({ result: win, sampleIds: changed, rows: W, simulation: sim, baselineGrades: grades, requirements: REQUIREMENTS, composition: p.ordered });
    const d = decideCalibration({ result: win, execution: { status: 'SUCCEEDED', sample_results: [] }, sample: { affected_in_sample: changed.length, units_remaining: 0 }, bounds: b, round: 2, maxRounds: 2 });
    expect(d.outcome).toBe('PROMISING');
    expect(['PROMISING', 'UNPROMISING', 'INCOMPLETE', 'FAILED_HARD_GATE']).toContain(d.outcome);
    expect(JSON.stringify(d).replaceAll(CALIBRATION_LABEL, '')).not.toMatch(/VERIFIED/);
    expect(d.metrics.label).toBe('CALIBRATION — NOT VERIFIED');
  });

  it('35. a near-boundary result receives more budget; a clear one goes straight to full replay', () => {
    const tight = { ...REQUIREMENTS, task_success_tolerance: 0, min_task_success_rate: 0.95 };
    const partial = { cases: changed.slice(0, 2).map((id: string) => caseFor(id, true)), gates: [] };
    const b = boundsAnalysis({ result: partial, sampleIds: changed.slice(0, 2), rows: W, simulation: sim, baselineGrades: grades, requirements: tight, composition: [] });
    const near = decideCalibration({ result: partial, execution: { status: 'SUCCEEDED', sample_results: [] }, sample: { affected_in_sample: 2, units_remaining: 4 }, bounds: b, round: 1, maxRounds: 2 });
    expect(near).toMatchObject({ outcome: 'PROMISING', next: 'increase_sample' });
    const loose = { ...REQUIREMENTS, min_task_success_rate: 0.5, task_success_tolerance: 0.4, quality_floor: 0.5, quality_tolerance: 0.4 };
    const b2 = boundsAnalysis({ result: partial, sampleIds: changed.slice(0, 2), rows: W, simulation: sim, baselineGrades: grades, requirements: loose, composition: [] });
    expect(decideCalibration({ result: partial, execution: { status: 'SUCCEEDED', sample_results: [] }, sample: { affected_in_sample: 2, units_remaining: 4 }, bounds: b2, round: 1, maxRounds: 2 }).next).toBe('full_replay');
    // No improvement on the sample → UNPROMISING, stop.
    const flat = { cases: changed.slice(0, 2).map((id: string) => ({ ...caseFor(id, true), candidate_cost_usd: 0.004, candidate_latency_ms: 1000 })), gates: [] };
    expect(decideCalibration({ result: flat, execution: { status: 'SUCCEEDED', sample_results: [] }, sample: { affected_in_sample: 2, units_remaining: 4 }, bounds: b2, round: 1, maxRounds: 2 })).toMatchObject({ outcome: 'UNPROMISING', next: 'stop' });
  });

  it('36. the sample hash is stable', () => {
    expect(pick().hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pick().hash).toBe(pick().hash);
    expect(pick(2).hash).not.toBe(pick(1).hash);
  });
});

describe('composed execution', () => {
  const W = rows.filter((t: Row) => plans.evaluation.ids.includes(t.id));
  const classify = W.filter((t: Row) => t.symbol === 'classify_ticket' && !t.protected).map((t: Row) => t.id);
  const plan = (composition: Row[], scope = W.map((t: Row) => t.id)) => ({ id: 'p', strategy: 'execution_plan', plan_version: 'plan_v1', config_hash: 'x', max_budget_usd: 1, sample_scope: scope, candidate_config: { plan_hash: 'h', composition: composition.map((t) => ({ ...t, transformation_hash: t.hash, hash: undefined })) } });

  it('38. a composed plan executes in the declared order: the cache stores the substituted model’s answers', async () => {
    const calls: string[] = [];
    const complete = async ({ model: m, messages }: Row) => {
      calls.push(messages.at(-1).content);
      return { content: 'technical', model: m, inputTokens: 100, outputTokens: 1, cost: 0.0001, latencyMs: 5, requestId: `r${calls.length}` };
    };
    const comp = compose([model(classify), cache('classify_ticket', null, classify)], rules).ordered;
    const out = await executeComposedPlan({ plan: plan(comp), traces: rows, complete, pricing: PRICING, allowedModels: new Set(['openai/gpt-4o-mini']) });
    const byPath = (p: string) => out.sample_results.filter((s: Row) => s.path === p);
    expect(byPath('model_call')).toHaveLength(6); // first of each group
    expect(byPath('cache_hit')).toHaveLength(12);
    expect(byPath('cache_hit').every((s: Row) => s.output_text === 'technical')).toBe(true); // not the baseline's answer
    expect(out.provider_call_count).toBe(6);
    expect(byPath('baseline_passthrough').every((s: Row) => s.proof === 'recorded_baseline')).toBe(true);
  });

  it('39. a partially executable plan never runs as complete', async () => {
    const blocked = model(classify, { executable_status: 'NOT_EXECUTABLE', not_executable_reason: 'no compute' });
    const comp = compose([cache('classify_ticket', null, classify), blocked], rules).ordered;
    expect(planExecutable(comp)).toMatchObject({ status: 'NOT_EXECUTABLE', reasons: expect.arrayContaining([expect.stringMatching(/never partly executed/)]) });
    const complete = async () => {
      throw new Error('must not be called');
    };
    await expect(executeComposedPlan({ plan: plan(comp), traces: rows, complete, pricing: PRICING, allowedModels: new Set() })).rejects.toThrow(/never partly executed/);
    expect(() => assertExecutable([{ ...cache('s', null), executable_status: 'EXECUTABLE' }, { kind: 'agent_loop_guard', executable_status: 'NEEDS_IMPLEMENTATION' }])).toThrow(/not executable as a whole/);
    expect(plans.plans.filter((p: Row) => p.ordered.some((t: Row) => t.kind === 'model_substitution')).every((p: Row) => ['BLOCKED', 'CONFLICTED'].includes(p.status))).toBe(true);
  });
});

// ---- Pareto + policy ---------------------------------------------------------------------
const vplan = (name: string, m: Row, o: Row = {}) => ({ id: name, name, plan_hash: name.padEnd(64, '0'), verdict: 'VERIFIED', risk_class: 'low', implementation_complexity: 2, rollback_complexity: 1, verified_effects: { cpso_usd: 0.002, p95_ms: 1000, task_success: 0.97, quality: 0.97, failure_rate: 0, provider_concentration: 1, ...m }, ...o });

describe('Pareto frontier', () => {
  it('41. dominance is correct', () => {
    const a = paretoPoint(vplan('a', { cpso_usd: 0.001 }));
    const b = paretoPoint(vplan('b', {}));
    expect(compare(a, b)).toMatchObject({ a_dominates: true, b_dominates: false, better: ['cpso_usd'], worse: [] });
    const f = paretoFrontier([vplan('a', { cpso_usd: 0.001 }), vplan('b', {})]);
    expect(f.states.find((s: Row) => s.name === 'b')).toMatchObject({ frontier_state: 'DOMINATED', dominated_by: ['a'.padEnd(64, '0')] });
  });

  it('42. identical plans do not dominate each other', () => {
    const f = paretoFrontier([vplan('a', {}), vplan('b', {})]);
    expect(f.states.map((s: Row) => s.frontier_state)).toEqual(['FRONTIER', 'FRONTIER']);
  });

  it('43. tradeoff plans both remain on the frontier', () => {
    const f = paretoFrontier([vplan('cheap', { cpso_usd: 0.001, p95_ms: 1500 }), vplan('fast', { cpso_usd: 0.003, p95_ms: 600 })]);
    expect(f.frontier).toHaveLength(2);
  });

  it('44. an unknown required comparison dimension → comparison incomplete, not better or worse', () => {
    const f = paretoFrontier([vplan('known', { cpso_usd: 0.001 }), vplan('unknown', { cpso_usd: null, p95_ms: 100 })]);
    expect(f.states.map((s: Row) => [s.name, s.frontier_state])).toEqual([['known', 'FRONTIER'], ['unknown', 'INCOMPARABLE']]);
    expect(f.states[1].frontier_reason).toMatch(/cpso_usd unknown/);
    expect(compare(paretoPoint(vplan('x', { cpso_usd: null })), paretoPoint(vplan('y', { cpso_usd: 5 })))).toMatchObject({ incomplete: true, unknown_dimensions: ['cpso_usd'], a_dominates: false, b_dominates: false });
  });

  it('45. rejected plans never enter the frontier', () => {
    expect(() => paretoFrontier([vplan('a', {}), { ...vplan('r', { cpso_usd: 0 }), verdict: 'REJECTED' }])).toThrow(/Only VERIFIED/);
  });

  it('46. the selected plan comes from the valid frontier', () => {
    const f = paretoFrontier([vplan('a', { cpso_usd: 0.001 }), vplan('b', {}), vplan('c', { cpso_usd: null })]);
    const d = applyPolicy({ frontier: f, policy: 'MARGIN_FIRST', params: {}, baseline: {} });
    expect(f.states.find((s: Row) => s.plan_hash === d.selected).frontier_state).toBe('FRONTIER');
    expect(d.explanation.excluded.map((x: Row) => x.name).sort()).toEqual(['b', 'c']);
  });
});

describe('decision policy', () => {
  const frontier = paretoFrontier([
    vplan('cheapest', { cpso_usd: 0.001, p95_ms: 1800, task_success: 0.96 }, { risk_class: 'medium', implementation_complexity: 4 }),
    vplan('fastest', { cpso_usd: 0.003, p95_ms: 500, task_success: 0.96 }, { implementation_complexity: 3 }),
    vplan('surest', { cpso_usd: 0.004, p95_ms: 900, task_success: 0.99 }, { implementation_complexity: 2 }),
  ]);
  const pick = (policy: string, params: Row = {}, baseline: Row = { cpso_usd: 0.005, p95_ms: 2000, task_success: 0.96, quality: 0.96, failure_rate: 0 }) => applyPolicy({ frontier, policy, params, baseline });

  it('47. MARGIN_FIRST selects the verified margin winner', () => expect(pick('MARGIN_FIRST').explanation.selected.name).toBe('cheapest'));
  it('48. LATENCY_FIRST selects the verified latency winner', () => expect(pick('LATENCY_FIRST').explanation.selected.name).toBe('fastest'));
  it('49. RELIABILITY_FIRST selects the highest task success', () => expect(pick('RELIABILITY_FIRST').explanation.selected.name).toBe('surest'));

  it('50. a policy cannot bypass the frozen gates: only VERIFIED frontier plans are candidates', () => {
    const withRejected = [vplan('ok', {}), { ...vplan('cheaper-but-rejected', { cpso_usd: 0.0001 }), verdict: 'REJECTED' }];
    expect(() => paretoFrontier(withRejected)).toThrow(/Only VERIFIED/);
    const custom = pick('CUSTOM_CONSTRAINTS', { max_p95_ms: 100 });
    expect(custom).toMatchObject({ outcome: 'NO_ELIGIBLE_PLAN', selected: null });
    expect(() => pick('CUSTOM_CONSTRAINTS', { quality_floor: 0.1 })).toThrow(/Unknown constraint/);
    expect(() => pick('YOLO')).toThrow(/Unknown decision policy/);
  });

  it('51. the selection explanation is deterministic and states the rule and tradeoffs', () => {
    const a = pick('BALANCED');
    const b = applyPolicy({ frontier: paretoFrontier([...frontier.states].reverse().map((s: Row) => vplan(s.name, { cpso_usd: s.values.cpso_usd, p95_ms: s.values.p95_ms, task_success: s.values.task_success }, { risk_class: ['low', 'medium', 'high'][s.values.risk], implementation_complexity: s.values.implementation_complexity }))), policy: 'BALANCED', params: {}, baseline: { cpso_usd: 0.005, p95_ms: 2000, task_success: 0.96, quality: 0.96, failure_rate: 0 } });
    expect(a.decision_hash).toBe(b.decision_hash);
    expect(a.explanation).toEqual(b.explanation);
    expect(a.explanation.rule).toMatch(/regress nothing/);
    expect(a.explanation.selected.name).toBe('surest'); // lowest risk, then complexity
    expect(a.explanation.tradeoffs.length).toBe(2);
  });
});

// ---- bad day -------------------------------------------------------------------------------
describe('Bad-Day Replay', () => {
  const W = rows.filter((t: Row) => plans.evaluation.ids.includes(t.id));
  const evaluation = { evidence_version: 'e', cases: W.map((t: Row) => ({ baseline_trace_id: t.id, baseline_grader: [{ passed: t.output_text === t.expected_output }], candidate_grader: [{ passed: t.output_text === t.expected_output }], baseline_score: t.output_text === t.expected_output ? 1 : 0, candidate_score: t.output_text === t.expected_output ? 1 : 0 })) };
  const hits = new Set(W.filter((t: Row) => t.symbol === 'classify_ticket' && !t.protected && !/-0$/.test(t.request_id)).map((t: Row) => t.id));
  const execution = { sample_results: W.map((t: Row) => (hits.has(t.id) ? { baseline_trace_id: t.id, path: 'cache_hit', cost_usd: 0, latency_ms: 1 } : { baseline_trace_id: t.id, path: 'baseline_passthrough', cost_usd: t.cost_usd, latency_ms: t.latency_ms, provider: 'openai' })) };
  const contract = { requirements: REQUIREMENTS };

  it('52. the fault profile is deterministic', () => {
    const p1 = normalizeProfile({ scenario: 'PROVIDER_RATE_LIMIT', parameters: { rate: 0.2, retry_after_ms: 500 } });
    const p2 = normalizeProfile({ scenario: 'PROVIDER_RATE_LIMIT', parameters: { retry_after_ms: 500, rate: 0.2 } });
    expect(p1.profile_hash).toBe(p2.profile_hash);
    const a = badDayReplay({ evaluation, execution, rows: W, traces: rows, contract, profile: p1, normalVerdict: 'VERIFIED' });
    const b = badDayReplay({ evaluation, execution, rows: [...W].reverse(), traces: rows, contract, profile: p2, normalVerdict: 'VERIFIED' });
    expect(a.result_hash).toBe(b.result_hash);
    expect(() => normalizeProfile({ scenario: 'PROVIDER_RATE_LIMIT', parameters: { rate: 2 } })).toThrow(/between 0 and 1/);
  });

  it('53. the normal verdict and the bad-day verdict are separate', () => {
    const r = badDayReplay({ evaluation, execution, rows: W, traces: rows, contract, profile: normalizeProfile({ scenario: 'PROVIDER_RATE_LIMIT', parameters: { rate: 0.9, retry_after_ms: 500 } }), normalVerdict: 'VERIFIED' });
    expect(r.verdict).toBe('REJECTED');
    expect(r.metrics.statement).toMatch(/Verified for the normal evaluation workload, but not resilient/);
    expect(r.metrics.statement).toMatch(/normal verdict is unchanged/);
  });

  it('54. a 429 scenario affects retries and reliability (observed retry ceiling), cache hits are untouched', () => {
    const policy = observedPolicy(rows);
    expect(policy).toMatchObject({ max_attempts: 2, rate_limit: { observed: 2, cost_usd: 0, latency_ms: 880 } });
    const prof = normalizeProfile({ scenario: 'PROVIDER_RATE_LIMIT', parameters: { rate: 0.5, retry_after_ms: 500 } });
    const cases = execution.sample_results.map((s: Row) => ({ id: s.baseline_trace_id, path: s.path, cost_usd: s.cost_usd, latency_ms: s.latency_ms, passed: true, score: 1, fallback: null }));
    const out = overlay(cases, prof, policy);
    expect(out.filter((c: Row) => c.path === 'cache_hit').every((c: Row) => c.attempts === 0 && c.ok)).toBe(true);
    expect(out.filter((c: Row) => c.attempts === 2).length).toBeGreaterThan(0);
    expect(out.filter((c: Row) => !c.ok).every((c: Row) => c.passed === false)).toBe(true);
  });

  it('55. a timeout scenario adds the timeout to latency', () => {
    const prof = normalizeProfile({ scenario: 'PROVIDER_TIMEOUT', parameters: { rate: 1, timeout_ms: 5000 } });
    const out = overlay([{ id: 'x', path: 'baseline_passthrough', cost_usd: 0.01, latency_ms: 1000, passed: true, score: 1, fallback: null }], prof, { max_attempts: 2, rate_limit: { cost_usd: null, latency_ms: null }, timeout: { cost_usd: 0, latency_ms: null } });
    expect(out[0]).toMatchObject({ ok: false, latency_ms: 10_000, attempts: 2 });
    // Timed-out attempt cost never observed → unknown, not $0.
    const unk = overlay([{ id: 'x', path: 'baseline_passthrough', cost_usd: 0.01, latency_ms: 1000, passed: true, score: 1, fallback: null }], prof, { max_attempts: 1, rate_limit: { cost_usd: null, latency_ms: null }, timeout: { cost_usd: null, latency_ms: null } });
    expect(unk[0].cost_usd).toBeNull();
  });

  it('56. a cache-miss scenario never fabricates cost', () => {
    const prof = normalizeProfile({ scenario: 'CACHE_MISS', parameters: { rate: 1 } });
    const out = overlay([{ id: 'a', path: 'cache_hit', cost_usd: 0, latency_ms: 1, passed: true, score: 1, fallback: null }, { id: 'b', path: 'cache_hit', cost_usd: 0, latency_ms: 1, passed: true, score: 1, fallback: { cost_usd: 0.004, latency_ms: 900, passed: true, score: 1 } }], prof, observedPolicy(rows));
    expect(out[0]).toMatchObject({ fallback: true, cost_usd: null, passed: null }); // the path behind the cache never ran
    expect(out[1]).toMatchObject({ fallback: true, cost_usd: 0.004, latency_ms: 900 }); // the recorded baseline path
  });

  it('57. a bad-day result is never labelled production-realized', () => {
    const r = badDayReplay({ evaluation, execution, rows: W, traces: rows, contract, profile: normalizeProfile({ scenario: 'MODEL_LATENCY_MULTIPLIER', parameters: { multiplier: 3 } }), normalVerdict: 'VERIFIED' });
    expect(r.metrics.label).toBe('BAD-DAY REPLAY');
    expect(r.metrics.not_claimed).toMatch(/not|≠/);
    expect(JSON.stringify(r)).not.toMatch(/REALIZED|realized production/i);
    const tool = badDayReplay({ evaluation, execution, rows: W, traces: rows, contract, profile: normalizeProfile({ scenario: 'TOOL_TIMEOUT' }), normalVerdict: 'VERIFIED' });
    expect(tool.verdict).toBe('UNSUPPORTED');
  });
});

describe('regression: Part 2A candidate route', () => {
  it('Part 2A passes keep their candidate behaviour (generateCandidates unchanged)', async () => {
    const { generateCandidates } = await import('../api/_lib/optimize/passes.js');
    const { diagnoses, ctx } = context(rows);
    const out = generateCandidates(diagnoses, { ...ctx, contract: { id: 'c', hash: CONTRACT_HASH, requirements: REQUIREMENTS }, snapshot: { id: 's', snapshot_hash: SNAPSHOT_HASH } });
    expect(out.candidates.map((c: Row) => `${c.strategy}:${c.executable_status}`).sort()).toEqual(['context_window_cap:NEEDS_IMPLEMENTATION', 'exact_reuse:EXECUTABLE', 'exact_reuse:EXECUTABLE', 'model_substitution:NOT_EXECUTABLE', 'prompt_cache:NEEDS_IMPLEMENTATION', 'retry_policy:NEEDS_IMPLEMENTATION']);
    expect(finalRows(rows).length).toBe(30);
    expect(servingSimulation([], rows.slice(0, 3), rows).every((s: Row) => s.path === 'baseline_passthrough')).toBe(true);
  });
});
