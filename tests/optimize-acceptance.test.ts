/**
 * Product acceptance: the synthetic demo workload through the whole
 * Verified Optimization Run, end to end, on the real router, handlers,
 * executor, evaluator and migrations (PGlite). No provider is called.
 *
 * DEMO / SYNTHETIC — NOT CUSTOMER DATA.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, routeState } from './helpers/routes';

vi.mock('../api/_lib/auth.js', () => authMock);

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const VIEWER = 'c0000000-0000-4000-8000-00000000000c';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';

type Candidate = { id: string; strategy: string; executable_status: string; status: string; sample_count: number; optimization_pass: string; contract_hash: string; diagnosis_id: string; baseline_snapshot_id: string; candidate_config_hash: string; lineage: Record<string, unknown> };
let dispatch: (r: Request) => Promise<Response>;
const call = (method: string, path: string, body?: unknown) => rawCall(dispatch, method, path, body);
const as = (u: string) => (routeState.user = u);
const q = async <T,>(sql: string, params: unknown[] = []) => (await routeState.db!.query<T>(sql, params)).rows;

const s: { product: string; contract: string; contractHash: string; run: string; candidates: Candidate[]; suggested: Record<string, unknown> } = { product: '', contract: '', contractHash: '', run: '', candidates: [], suggested: {} };

beforeAll(async () => {
  routeState.db = await createDb();
  routeState.rest = restClient(routeState.db);
  await seedWorkspace(routeState.db, { userId: USER_A, workspaceId: WS_A, slug: 'alpha', role: 'owner' });
  await seedWorkspace(routeState.db, { userId: USER_B, workspaceId: WS_B, slug: 'bravo', role: 'owner' });
  await routeState.db.query('insert into auth.users(id) values ($1)', [VIEWER]);
  await routeState.db.query(`insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, 'viewer')`, [WS_A, VIEWER]);
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
  await import('../api/_lib/handlers/optimize.js');
}, 120_000);

describe('flag', () => {
  it('is off by default for every workspace', async () => {
    as(USER_A);
    const res = await call('POST', '/api/optimize/demo', { workspace_id: WS_A });
    expect(res).toMatchObject({ status: 403, body: { code: 'OPTIMIZE_DISABLED' } });
    await q(`update public.feature_flags set workspace_overrides = $1 where key = 'verified_optimization_vnext'`, [JSON.stringify({ [WS_A]: true })]);
  });
});

describe('Verified Optimization Run — demo workload', () => {
  it('1. loads the labelled synthetic workload', async () => {
    const res = await call('POST', '/api/optimize/demo', { workspace_id: WS_A });
    expect(res.status).toBe(200);
    expect(res.body.name).toContain('DEMO / SYNTHETIC — NOT CUSTOMER DATA');
    s.product = res.body.product_id;
    s.suggested = res.body.suggested_requirements;
    const again = await call('POST', '/api/optimize/demo', { workspace_id: WS_A });
    expect(again.body.product_id).toBe(s.product);
    expect((await q<{ n: number }>('select count(*)::int n from public.engine_traces where product_id = $1', [s.product]))[0].n).toBe(32);
  });

  it('2. freezes an Evaluation Contract (draft → frozen; new version supersedes)', async () => {
    const draft = await call('POST', `/api/optimize/products/${s.product}/contracts`, { requirements: { ...s.suggested, quality_floor: 0.9 } });
    expect(draft.body).toMatchObject({ status: 'draft', version: 1 });
    const edited = await call('POST', `/api/optimize/products/${s.product}/contracts`, { requirements: s.suggested });
    expect(edited.body.id).toBe(draft.body.id);
    expect(edited.body.contract_hash).not.toBe(draft.body.contract_hash);
    const frozen = await call('POST', `/api/optimize/products/${s.product}/contracts/${draft.body.id}/freeze`);
    expect(frozen.body).toMatchObject({ status: 'frozen', version: 1, contract_hash: edited.body.contract_hash });
    expect((await call('POST', `/api/optimize/products/${s.product}/contracts/${draft.body.id}/freeze`)).body.code).toBe('CONTRACT_IMMUTABLE');
    // A change after freezing is a NEW version; v1 is untouched until v2 is frozen.
    const v2 = await call('POST', `/api/optimize/products/${s.product}/contracts`, { requirements: { ...s.suggested, quality_floor: 0.97 } });
    expect(v2.body).toMatchObject({ status: 'draft', version: 2 });
    const v1 = await q<{ requirements: { quality_floor: number }; status: string }>('select requirements, status from public.evaluation_contracts where id = $1', [draft.body.id]);
    expect(v1[0]).toMatchObject({ status: 'frozen', requirements: { quality_floor: 0.95 } });
    await call('POST', `/api/optimize/products/${s.product}/contracts`, { requirements: s.suggested });
    const v2frozen = await call('POST', `/api/optimize/products/${s.product}/contracts/${v2.body.id}/freeze`);
    expect(v2frozen.body.status).toBe('frozen');
    expect((await q<{ status: string; superseded_by: string }>('select status, superseded_by from public.evaluation_contracts where id = $1', [draft.body.id]))[0]).toEqual({ status: 'superseded', superseded_by: v2.body.id });
    s.contract = v2.body.id;
    s.contractHash = v2frozen.body.contract_hash;
  });

  it('refuses a run on a draft or superseded contract', async () => {
    const old = (await q<{ id: string }>(`select id from public.evaluation_contracts where product_id = $1 and status = 'superseded'`, [s.product]))[0].id;
    expect((await call('POST', `/api/optimize/products/${s.product}/runs`, { contract_id: old })).body.code).toBe('RUN_CONTRACT_NOT_FROZEN');
  });

  it('3–6. builds the Verified Performance baseline (cost, CPSO, p95, reliability)', async () => {
    const run = await call('POST', `/api/optimize/products/${s.product}/runs`, { contract_id: s.contract });
    expect(run.body).toMatchObject({ contract_hash: s.contractHash, status: 'open' });
    s.run = run.body.id;
    const base = await call('POST', `/api/optimize/runs/${s.run}/baseline`);
    expect(base.status).toBe(200);
    const m = base.body.snapshot.metrics;
    expect(m.samples).toEqual({ logical_requests: 30, recorded_attempts: 32, executed_attempts: 32, protected_samples: 2 });
    expect(m.economics.known_cost_count).toBe(31);
    expect(m.economics.cost_coverage).toBeCloseTo(31 / 32, 5);
    expect(m.economics.cost_per_successful_outcome_usd).toBeGreaterThan(0);
    expect(m.economics.cpso).toMatchObject({ population: 29, successful_outcomes: 28, unavailable_reasons: [] });
    expect(m.economics.wasted_attempt_known_cost_usd).toBe(0); // rate-limited attempts: a known $0, not unknown
    expect(m.latency.request).toMatchObject({ samples: 30, low_evidence: false });
    expect(m.latency.request.p95_ms).toBeGreaterThan(2000);
    expect(m.latency.ttft.low_evidence).toBe(true);
    expect(m.quality.task_success).toMatchObject({ known: 30, succeeded: 29 });
    expect(m.reliability).toMatchObject({ retry_count: 2, retried_requests: 2, failure_count: 0, rate_limit_count: 2, timeout_count: 0, fallback_count: null });
    expect(base.body.snapshot.completeness).toBe('complete');
    expect(m.evidence.graph_count).toBe(32);
    expect((await call('POST', `/api/optimize/runs/${s.run}/baseline`)).body.reused).toBe(true);
  });

  it('7. produces ZevIR-backed deterministic diagnoses', async () => {
    const res = await call('POST', `/api/optimize/runs/${s.run}/diagnoses`);
    const fam = res.body.map((d: { family: string; scope: string }) => `${d.family}:${d.scope}`).sort();
    expect(fam).toEqual(['context_amplification:workload', 'latency_critical_path:ModelCall:gpt-4o', 'model_overprovisioning:openai/gpt-4o', 'redundant_call:classify_ticket', 'redundant_call:route_refund', 'retry_amplification:workload']);
    for (const d of res.body) {
      expect(d.evidence_refs.length).toBeGreaterThan(0);
      expect(d.falsifier.length).toBeGreaterThan(10);
      expect(d.diagnosis_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const reuse = res.body.find((d: { family: string; scope: string }) => d.scope === 'classify_ticket');
    expect(reuse.evidence_refs.some((r: { type: string }) => r.type === 'zevir_node')).toBe(true);
    expect(reuse.affected_nodes.length).toBe(18);
    const again = await call('POST', `/api/optimize/runs/${s.run}/diagnoses`);
    expect(again.body.map((d: { id: string }) => d.id).sort()).toEqual(res.body.map((d: { id: string }) => d.id).sort());
  });

  it('8. creates candidates with lineage; only supported ones are executable', async () => {
    const res = await call('POST', `/api/optimize/runs/${s.run}/candidates`);
    s.candidates = res.body.candidates;
    const kinds = s.candidates.map((c) => `${c.strategy}:${c.executable_status}`).sort();
    expect(kinds).toEqual(['context_window_cap:NEEDS_IMPLEMENTATION', 'exact_reuse:EXECUTABLE', 'exact_reuse:EXECUTABLE', 'model_substitution:NOT_EXECUTABLE', 'prompt_cache:NEEDS_IMPLEMENTATION', 'retry_policy:NEEDS_IMPLEMENTATION']);
    for (const c of s.candidates) {
      expect(c).toMatchObject({ contract_hash: s.contractHash });
      expect(c.diagnosis_id).toBeTruthy();
      expect(c.baseline_snapshot_id).toBeTruthy();
      expect(c.lineage).toMatchObject({ label: 'NOT VERIFIED — candidate only' });
      expect(c.lineage.falsifier).toBeTruthy();
      expect(c.lineage.rollback).toBeTruthy();
      if (c.executable_status !== 'EXECUTABLE') expect(c.status).toBe('BLOCKED');
    }
    const again = await call('POST', `/api/optimize/runs/${s.run}/candidates`);
    expect(again.body.candidates.map((c: Candidate) => c.candidate_config_hash).sort()).toEqual(s.candidates.map((c) => c.candidate_config_hash).sort());
    expect((await q<{ n: number }>('select count(*)::int n from public.engine_plans where run_id = $1', [s.run]))[0].n).toBe(6);
  });

  it('never runs a NOT_EXECUTABLE or NEEDS_IMPLEMENTATION candidate', async () => {
    for (const c of s.candidates.filter((x) => x.executable_status !== 'EXECUTABLE')) {
      const res = await call('POST', `/api/optimize/runs/${s.run}/candidates/${c.id}/replay`);
      expect(res).toMatchObject({ status: 422, body: { code: 'CANDIDATE_NOT_EXECUTABLE' } });
      // The engine's own execute route refuses them too (stored BLOCKED).
      const direct = await call('POST', `/api/engine/products/${s.product}/optimization/plans/${c.id}/execute`, {});
      expect(direct.body.code).toBe('PLAN_BLOCKED');
    }
    expect((await q<{ n: number }>('select count(*)::int n from public.engine_executions where run_id = $1', [s.run]))[0].n).toBe(0);
  });

  it('9–10. replays supported candidates and decides under the frozen contract', async () => {
    const reuse = s.candidates.filter((c) => c.strategy === 'exact_reuse');
    const bySize = Object.fromEntries(reuse.map((c) => [c.sample_count, c]));
    // route_refund: reusing the first (wrong) answer is cheaper and faster, and worse → REJECTED,
    // even though the request body tries to lower the quality floor.
    const refund = await call('POST', `/api/optimize/runs/${s.run}/candidates/${bySize[6].id}/replay`, { gate_config: { quality_floor: 0.1, min_samples: 1 } });
    expect(refund.body.evaluation.status).toBe('REJECTED');
    expect(refund.body.evaluation.rejection_reason).toMatch(/quality_floor/);
    expect(refund.body.evaluation.rejection_reason).toMatch(/task_success_floor/);
    const qf = refund.body.evaluation.gates.find((g: { name: string }) => g.name === 'quality_floor');
    expect(qf.threshold).toBe(0.95);
    // classify_ticket: correct reuse → VERIFIED.
    const classify = await call('POST', `/api/optimize/runs/${s.run}/candidates/${bySize[12].id}/replay`);
    expect(classify.body.evaluation.status).toBe('VERIFIED');
    expect(classify.body.evaluation.contract_hash).toBe(s.contractHash);
    const required = classify.body.evaluation.gates.filter((g: { required: boolean }) => g.required);
    expect(required.every((g: { outcome: string }) => g.outcome === 'passed')).toBe(true);
    expect(classify.body.evaluation.gates.map((g: { name: string }) => g.name)).toEqual(expect.arrayContaining(['task_success_floor', 'latency_p95', 'latency_p95_regression', 'cost_coverage']));
    const rows = await q<{ run_id: string; contract_id: string; contract_hash: string }>('select run_id, contract_id, contract_hash from public.engine_evaluations where id = $1', [classify.body.evaluation.id]);
    expect(rows[0]).toEqual({ run_id: s.run, contract_id: s.contract, contract_hash: s.contractHash });
    const again = await call('POST', `/api/optimize/runs/${s.run}/candidates/${bySize[12].id}/replay`);
    expect(again.body).toMatchObject({ reused: true, evaluation: { id: classify.body.evaluation.id } });
    // 41. Billing unchanged: deterministic reuse never calls (or bills) a provider.
    const calls = await q<{ n: number; c: number }>('select coalesce(sum(provider_call_count), 0)::int n, count(*)::int c from public.engine_executions where run_id = $1', [s.run]);
    expect(calls[0]).toEqual({ n: 0, c: 2 });
  });

  it('11–12. reports executive and developer views with exact claim labels and no raw content', async () => {
    const res = await call('GET', `/api/optimize/runs/${s.run}/report`);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.executive.results.map((x: { verdict: string }) => x.verdict).sort()).toEqual(['REJECTED', 'VERIFIED']);
    for (const x of r.executive.results) {
      expect(x.production_realized_result).toBe('NOT YET MEASURED');
      expect(x.scope).toMatch(/replayed case\(s\) of 30 logical requests/);
    }
    expect(r.executive.not_claimed).toContain('Diagnoses are not savings.');
    expect(r.developer.lineage).toHaveLength(6);
    expect(r.evaluations[0].cases[0]).not.toHaveProperty('candidate_output');
    const text = JSON.stringify(r);
    for (const raw of ['charged twice', 'arrived broken', 'DEMO SYNTHETIC. Classify', 'logged into my account']) expect(text).not.toContain(raw);
  });
});

describe('security', () => {
  it('denies another workspace every run read and write with a 404', async () => {
    as(USER_B);
    await q(`update public.feature_flags set workspace_overrides = $1 where key = 'verified_optimization_vnext'`, [JSON.stringify({ [WS_A]: true, [WS_B]: true })]);
    for (const [m, p] of [['GET', `/api/optimize/runs/${s.run}/report`], ['GET', `/api/optimize/runs/${s.run}/diagnoses`], ['GET', `/api/optimize/runs/${s.run}/candidates`], ['POST', `/api/optimize/runs/${s.run}/diagnoses`], ['POST', `/api/optimize/runs/${s.run}/baseline`], ['POST', `/api/optimize/runs/${s.run}/candidates/${s.candidates[0].id}/replay`], ['GET', `/api/optimize/products/${s.product}`], ['POST', `/api/optimize/products/${s.product}/contracts`]]) {
      const res = await call(m, p);
      expect([p, res.status]).toEqual([p, 404]);
    }
    as(USER_A);
  });

  it('a viewer reads the report but cannot freeze, start or replay', async () => {
    as(VIEWER);
    expect((await call('GET', `/api/optimize/runs/${s.run}/report`)).status).toBe(200);
    expect((await call('POST', `/api/optimize/products/${s.product}/contracts`)).status).toBe(403);
    expect((await call('POST', `/api/optimize/products/${s.product}/runs`, { contract_id: s.contract })).status).toBe(403);
    expect((await call('POST', `/api/optimize/runs/${s.run}/candidates/${s.candidates[0].id}/replay`)).status).toBe(403);
    as(USER_A);
  });

  it('refuses to diagnose evidence that changed after the baseline', async () => {
    await q(`insert into public.engine_traces(product_id, workspace_id, request_id, input_text, output_text, input_hash, output_hash, latency_ms) values ($1, $2, 'late-arrival', 'x', 'billing', $3, $4, 100)`, [s.product, WS_A, 'e'.repeat(64), 'f'.repeat(64)]);
    const res = await call('POST', `/api/optimize/runs/${s.run}/diagnoses`);
    expect(res).toMatchObject({ status: 409, body: { code: 'EVIDENCE_CHANGED' } });
  });
});
