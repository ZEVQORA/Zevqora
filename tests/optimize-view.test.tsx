// @vitest-environment jsdom
/**
 * The Optimization Run view keeps the claim rules visible: unknown is never
 * shown as $0, an unavailable CPSO says why, only executable candidates can
 * be replayed, candidates are labelled NOT VERIFIED, and production results
 * are NOT YET MEASURED. The nav item appears only where the flag is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';
import { fixtureStore, FIXTURE_PRODUCT } from './fixtures/product-store';

let store: ReturnType<typeof fixtureStore>;
let role = 'owner';
vi.mock('@/product/store', () => ({ useProduct: () => store }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ me: { user: { id: 'u', email: 'fixture@example.invalid' }, workspaces: [] }, activeWorkspace: { id: 'w', name: 'W', role, plan: 'free', features: { verified_optimization_vnext: true } } }) }));

const RUN = { id: 'run-1', product_id: 'prod-1', contract_id: 'c1', contract_hash: 'c'.repeat(64), baseline_snapshot_id: 's1', status: 'evaluated', created_at: '2026-10-01T00:00:00Z' };
const CONTRACT = { id: 'c1', product_id: 'prod-1', version: 1, status: 'frozen', contract_hash: 'c'.repeat(64), created_at: '2026-10-01T00:00:00Z', frozen_at: '2026-10-01T00:00:00Z', superseded_by: null, requirements: { quality_floor: 0.95, quality_tolerance: 0, min_task_success_rate: 0.95, task_success_tolerance: 0, latency: { require: true, max_p95_ms: 2000, max_regression_pct: 20 }, protected: { require_cases: false, min_cases: 0 }, cost: { require_evidence: true, min_coverage: 0.9, require_improvement: true, min_improvement_pct: 0 }, evidence: { min_samples: 5, min_latency_samples: 20, min_outcome_coverage: 0.8 }, required_metrics: ['cost', 'latency', 'quality', 'task_success'], reliability: { max_failure_rate: null, max_retry_rate: null }, allowed_providers: null, allowed_models: null, policy: { no_protected_regression: true, require_data_boundary: false }, dataset_version: null } };
const lat = (p95: number | null, samples: number) => ({ samples, p50_ms: p95, p95_ms: p95, p99_ms: p95, max_ms: p95, low_evidence: samples < 20 });
const SNAPSHOT = {
  id: 's1', contract_hash: 'c'.repeat(64), completeness: 'incomplete', trace_count: 10, window_truncated: false, snapshot_hash: 'e'.repeat(64), created_at: '2026-10-01T00:00:00Z',
  metrics: {
    samples: { logical_requests: 10, recorded_attempts: 10, executed_attempts: 10, protected_samples: 0 },
    economics: { total_known_cost_usd: null, known_cost_count: 0, cost_coverage: 0, cost_basis: null, wasted_attempt_known_cost_usd: null, cost_per_logical_request_usd: null, cost_per_successful_outcome_usd: null, cpso: { value_usd: null, numerator_coverage: 0, denominator_coverage: 1, successful_outcomes: 9, population: 0, unavailable_reasons: ['cost fully known for 0 of 10 requests with a known outcome (0%); contract requires 90%'] } },
    latency: { request: lat(1800, 10), attempt: lat(1800, 10), ttft: lat(null, 0) },
    quality: { score: 0.9, samples: 10, source: 'graded_against_expected_output', task_success: { known: 10, succeeded: 9, rate: 0.9, unknown: 0, sources: ['graded_against_expected_output'] }, protected: { requests: 0, outcome_known: 0, failed: 0 } },
    reliability: { failure_count: 0, failure_rate: 0, retry_count: 0, retry_rate: 0, retry_amplification: 1, retried_requests: 0, retry_latency_ms: null, timeout_count: 0, rate_limit_count: 0, fallback_count: null },
    bad_day: { p99_request_latency_ms: 1800, max_request_latency_ms: 1800, worst_retry_amplification: 1, costliest_requests: [], note: 'Observed history only. Not a simulation or fault-injection result.' },
    evidence: { coverage: { cost: 0 }, required_metrics: ['cost'], completeness: 'incomplete', missing: ['cost: coverage 0% < required 90%'], graph_count: 10, graph_set_hash: 'f'.repeat(64), graphs_truncated: false, window_truncated: false },
  },
  latency_analysis: { status: 'incomplete', graphs: 10, complete: 0, incomplete_reasons: ['root Task has no start/end timestamps'], hotspots: [{ class: 'ModelCall:gpt-4o', kind: 'ModelCall', name: 'gpt-4o', samples: 10, p50_ms: 1500, p95_ms: 1800, critical_path_graphs: 0, mean_share_of_root: null }], retry: null },
};
const candidate = (id: string, strategy: string, executable_status: string) => ({ id, strategy, status: executable_status === 'EXECUTABLE' ? 'READY' : 'BLOCKED', executable_status, optimization_pass: 'redundant_call', pass_version: '0.1.0', diagnosis_id: 'd1', contract_hash: 'c'.repeat(64), candidate_config_hash: id.repeat(16).slice(0, 64), reason: '', expected_mechanism: `mechanism ${id}`, risk: 'low', sample_count: 6, candidate_config: {}, lineage: { expected_effects: { cost: { direction: 'decrease', basis: 'projected' } }, falsifier: 'f', rollback: 'r', not_executable_reason: executable_status === 'EXECUTABLE' ? null : 'cannot run' } });
const REPORT = {
  run: RUN, contract: CONTRACT, baseline: SNAPSHOT,
  diagnoses: [{ id: 'd1', family: 'redundant_call', scope: 'classify', symptom: 'repeats', root_cause: 'rc', causal_path: ['a', 'b'], affected_nodes: [], evidence_refs: [{ type: 'engine_trace', id: 't1' }], metrics: {}, confidence: 0.9, severity: 'high', required_additional_evidence: [], falsifier: 'falsified if…', suggested_optimization_passes: ['redundant_call'], risk_class: 'low', diagnosis_hash: 'd'.repeat(64) }],
  candidates: [candidate('a1', 'exact_reuse', 'EXECUTABLE'), candidate('b2', 'retry_policy', 'NEEDS_IMPLEMENTATION'), candidate('c3', 'model_substitution', 'NOT_EXECUTABLE')],
  evaluations: [],
  executive: { headline: 'No candidate has been replayed yet.', not_claimed: ['Diagnoses are not savings.'], results: [] },
  developer: { zevir: null, lineage: [] },
};

const status = vi.fn();
const report = vi.fn();
vi.mock('@/product/optimize', () => ({ optimizeApi: { status: (...a: unknown[]) => status(...a), report: (...a: unknown[]) => report(...a) } }));
const { default: OptimizeView } = await import('@/product/views/OptimizeView');
const { navVisible } = await import('@/app/AppShell');

const show = () => render(<ToastProvider><MemoryRouter><OptimizeView /></MemoryRouter></ToastProvider>);

beforeEach(() => {
  role = 'owner';
  store = fixtureStore({ engine: { kind: 'cloud' }, selected: { ...FIXTURE_PRODUCT, name: 'Support triage (DEMO / SYNTHETIC — NOT CUSTOMER DATA)' } });
  status.mockResolvedValue({ enabled: true, product_id: 'prod-1', contracts: [CONTRACT], runs: [RUN], defaults: CONTRACT.requirements });
  report.mockResolvedValue(REPORT);
});
afterEach(() => cleanup());

describe('Optimization Run view', () => {
  it('shows unknown cost as unknown and an unavailable CPSO with its reason — never $0', async () => {
    show();
    const tile = (await screen.findByText('Cost / successful outcome')).closest('div.rounded-xl') as HTMLElement;
    expect(within(tile).getByText('Unavailable')).toBeTruthy();
    expect(within(tile).getByText(/cost fully known for 0 of 10/)).toBeTruthy();
    const cost = screen.getByText('AI cost').closest('div.rounded-xl') as HTMLElement;
    expect(within(cost).getByText('unknown')).toBeTruthy();
    expect(within(cost).queryByText(/\$0\.0000/)).toBeNull();
    expect(screen.getByText(/DEMO \/ SYNTHETIC — NOT CUSTOMER DATA\. Every number/)).toBeTruthy();
  });

  it('offers replay only for executable candidates, all labelled NOT VERIFIED', async () => {
    show();
    await screen.findByText('Reuse identical answers');
    expect(screen.getAllByRole('button', { name: /Run replay/ })).toHaveLength(1);
    expect(screen.getAllByText('NOT VERIFIED')).toHaveLength(3);
    expect(screen.getByText('NEEDS IMPLEMENTATION')).toBeTruthy();
    expect(screen.getAllByText('cannot run').length).toBe(2);
  });

  it('reports critical-path limits instead of inventing a share', async () => {
    show();
    expect(await screen.findByText(/share of request latency: unknown/)).toBeTruthy();
    expect(screen.getByText(/No path is inferred without timestamps/)).toBeTruthy();
  });

  it('shows the verdict with NOT YET MEASURED production results', async () => {
    const ev = { id: 'e1', candidate_plan_id: 'a1', status: 'REJECTED', rejection_reason: 'Failed gates: quality_floor', contract_hash: 'c'.repeat(64), sample_count: 6, gates: [], cases: [], performance_comparison: { baseline: { cost_usd: 0.02, cost_per_successful_outcome_usd: 0.004, quality: 1, task_success_rate: 1, p50_ms: 1500, p95_ms: 1900 }, candidate: { cost_usd: 0, cost_per_successful_outcome_usd: 0, quality: 0.667, task_success_rate: 0.667, p50_ms: 1, p95_ms: 1, replay_failures: 0 }, deltas_pct: { cost: -100, cost_per_successful_outcome: -100, p95: -99.9 }, protected: { evaluated: 0, failures: 0 }, realized_production_result: 'NOT YET MEASURED' } };
    report.mockResolvedValue({ ...REPORT, evaluations: [ev], executive: { headline: 'No candidate is verified yet.', not_claimed: [], results: [{ evaluation_id: 'e1', strategy: 'exact_reuse', verdict: 'REJECTED', label: 'Evaluated — not verified', scope: '6 replayed case(s)', evaluated_cost_change: '-100.0%', evaluated_cpso_change: '-100.0%', evaluated_p95_change: '-99.9%', reason: 'Failed gates: quality_floor', production_realized_result: 'NOT YET MEASURED' }] } });
    show();
    expect(await screen.findByText('NOT YET MEASURED')).toBeTruthy();
    expect(screen.getAllByText('REJECTED').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Run replay/ })).toBeNull();
  });

  it('hides contract editing from non-admins and says when the flag is off', async () => {
    role = 'member';
    status.mockResolvedValue({ enabled: true, product_id: 'prod-1', contracts: [{ ...CONTRACT, id: 'd', status: 'draft' }], runs: [], defaults: CONTRACT.requirements });
    show();
    expect(await screen.findByText('An admin freezes the contract.')).toBeTruthy();
    cleanup();
    status.mockResolvedValue({ enabled: false, product_id: 'prod-1', contracts: [], runs: [], defaults: CONTRACT.requirements });
    show();
    expect(await screen.findByText('Not enabled for this workspace')).toBeTruthy();
  });

  it('nav item is visible only where the workspace flag is on', () => {
    expect(navVisible({ flag: 'verified_optimization_vnext' }, { verified_optimization_vnext: true })).toBe(true);
    expect(navVisible({ flag: 'verified_optimization_vnext' }, {})).toBe(false);
    expect(navVisible({ flag: 'verified_optimization_vnext' }, undefined)).toBe(false);
    expect(navVisible({}, undefined)).toBe(true);
  });
});
