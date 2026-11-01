/**
 * Product acceptance for Optimization Intelligence (vNext Part 2B): the
 * synthetic v2 demo workload through plan search, calibration, full replay,
 * Pareto frontier, decision policies and Bad-Day Replay — on the real router,
 * handlers, executors, evaluator and migrations (PGlite). No provider is called.
 *
 * SYNTHETIC DEMO — NOT CUSTOMER DATA.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, routeState } from './helpers/routes';

vi.mock('../api/_lib/auth.js', () => authMock);
// Whole-workload replays on an in-process Postgres: allow for a loaded CI machine.
vi.setConfig({ testTimeout: 120_000 });

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const VIEWER = 'c0000000-0000-4000-8000-00000000000c';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let dispatch: (r: Request) => Promise<Response>;
const call = (m: string, p: string, b?: unknown) => rawCall(dispatch, m, p, b);
const as = (u: string) => (routeState.user = u);
const q = async <T>(sql: string, params: unknown[] = []) => (await routeState.db!.query<T>(sql, params)).rows;
const s: Row = {};

async function drive(searchId: string, stage: 'calibrate' | 'replay') {
  const out: Row[] = [];
  for (let i = 0; i < 20; i += 1) {
    const r = await call('POST', `/api/optimize/searches/${searchId}/${stage}`);
    out.push(r);
    if (r.status !== 200 || r.body.done) break;
  }
  return out;
}

beforeAll(async () => {
  routeState.db = await createDb();
  routeState.rest = restClient(routeState.db);
  await seedWorkspace(routeState.db, {
    userId: USER_A,
    workspaceId: WS_A,
    slug: 'alpha',
    role: 'owner',
  });
  await seedWorkspace(routeState.db, {
    userId: USER_B,
    workspaceId: WS_B,
    slug: 'bravo',
    role: 'owner',
  });
  await routeState.db.query('insert into auth.users(id) values ($1)', [VIEWER]);
  await routeState.db.query(`insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, 'viewer')`, [WS_A, VIEWER]);
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
  await import('../api/_lib/handlers/zevir.js');
  await import('../api/_lib/handlers/optimize.js');
  await import('../api/_lib/handlers/optimize-search.js');
  as(USER_A);
  await q(`update public.feature_flags set workspace_overrides = $1 where key = 'verified_optimization_vnext'`, [JSON.stringify({ [WS_A]: true, [WS_B]: true })]);
}, 120_000);

describe('flag', () => {
  it('Optimization Intelligence is off unless both flags are on', async () => {
    expect(
      (
        await call('POST', '/api/optimize/demo', {
          workspace_id: WS_A,
          variant: 'intelligence',
        })
      ).body.code,
    ).toBe('INTELLIGENCE_DISABLED');
    await q(`update public.feature_flags set workspace_overrides = $1 where key = 'optimization_intelligence_vnext'`, [JSON.stringify({ [WS_A]: true, [WS_B]: true })]);
  });
});

describe('Optimization Intelligence — synthetic demo', () => {
  it('loads the labelled demo, freezes the contract, builds the baseline and diagnoses (incl. agent + retrieval)', async () => {
    const demo = await call('POST', '/api/optimize/demo', {
      workspace_id: WS_A,
      variant: 'intelligence',
    });
    expect(demo.body.name).toContain('SYNTHETIC DEMO — NOT CUSTOMER DATA');
    s.product = demo.body.product_id;
    const status = await call('GET', `/api/optimize/products/${s.product}`);
    expect(status.body).toMatchObject({ enabled: true, intelligence: true });
    const draft = await call('POST', `/api/optimize/products/${s.product}/contracts`, {});
    const frozen = await call('POST', `/api/optimize/products/${s.product}/contracts/${draft.body.id}/freeze`);
    s.contractHash = frozen.body.contract_hash;
    s.run = (
      await call('POST', `/api/optimize/products/${s.product}/runs`, {
        contract_id: frozen.body.id,
      })
    ).body.id;
    expect((await call('POST', `/api/optimize/runs/${s.run}/baseline`)).body.snapshot.completeness).toBe('complete');
    const d = await call('POST', `/api/optimize/runs/${s.run}/diagnoses`);
    expect(d.body.map((x: Row) => x.family).sort()).toEqual(['agent_workflow', 'context_amplification', 'model_overprovisioning', 'redundant_call', 'redundant_call', 'retrieval_redundancy', 'retry_amplification']);
  });

  it('69. starts a plan search; a repeated start returns the same search and never duplicates plans', async () => {
    const a = await call('POST', `/api/optimize/runs/${s.run}/searches`, {});
    expect(a.status).toBe(200);
    s.search = a.body.search.id;
    const b = await call('POST', `/api/optimize/runs/${s.run}/searches`, {});
    expect(b.body).toMatchObject({ reused: true, search: { id: s.search } });
    const n = (await q<{ n: number }>('select count(*)::int n from public.execution_plans where search_id = $1', [s.search]))[0].n;
    expect(n).toBe(a.body.search.generation.generated);
    expect(n).toBeGreaterThanOrEqual(10);
    const g = a.body.search.generation.counts;
    expect(g.CONFLICTED).toBeGreaterThan(0);
    expect(g.BLOCKED).toBeGreaterThan(0);
    expect(g.CALIBRATION_READY).toBeGreaterThan(3);
    expect(a.body.search.evaluation_set).toMatchObject({
      size: 29,
      excluded: [{ reasons: ['cost_unknown'] }],
    });
  });

  it('63–65. another workspace cannot see or drive the search, its plans or its calibration (404)', async () => {
    const plan = (await q<{ id: string }>('select id from public.execution_plans where search_id = $1 limit 1', [s.search]))[0].id;
    as(USER_B);
    try {
      for (const [m, p] of [
        ['GET', `/api/optimize/searches/${s.search}`],
        ['POST', `/api/optimize/searches/${s.search}/calibrate`],
        ['POST', `/api/optimize/searches/${s.search}/replay`],
        ['POST', `/api/optimize/searches/${s.search}/decision`],
        ['POST', `/api/optimize/searches/${s.search}/cancel`],
        ['GET', `/api/optimize/plans/${plan}`],
        ['POST', `/api/optimize/plans/${plan}/bad-day`],
        ['POST', `/api/optimize/runs/${s.run}/searches`],
        ['GET', `/api/optimize/products/${s.product}/bad-day-profiles`],
      ]) {
        const r = await call(m, p, m === 'GET' ? undefined : {});
        expect([p, r.status]).toEqual([p, 404]);
      }
      as(VIEWER);
      expect((await call('GET', `/api/optimize/searches/${s.search}`)).status).toBe(200);
      expect((await call('POST', `/api/optimize/searches/${s.search}/calibrate`)).status).toBe(403);
    } finally {
      as(USER_A);
    }
  });

  it('calibrates within budget; 70. a repeated calibration request is idempotent', async () => {
    const runs = await drive(s.search, 'calibrate');
    expect(runs.at(-1)!.body.done).toBe(true);
    const outcomes = runs.flatMap((r) => r.body.processed).map((p: Row) => p.outcome);
    s.calibrationRejected = outcomes.includes('FAILED_HARD_GATE');
    expect(outcomes).toContain('PROMISING');
    const before = (await q<{ c: number; e: number }>(`select (select count(*)::int from public.plan_calibrations where search_id = $1) c, (select count(*)::int from public.engine_executions where search_id = $1) e`, [s.search]))[0];
    const again = await call('POST', `/api/optimize/searches/${s.search}/calibrate`);
    expect(again.body.processed).toEqual([]);
    const after = (await q<{ c: number; e: number }>(`select (select count(*)::int from public.plan_calibrations where search_id = $1) c, (select count(*)::int from public.engine_executions where search_id = $1) e`, [s.search]))[0];
    expect(after).toEqual(before);
    // 34. no calibration result is ever a verdict
    expect((await q<{ n: number }>(`select count(*)::int n from public.engine_evaluations where search_id = $1`, [s.search]))[0].n).toBe(0);
    expect((await q<{ l: string }>(`select distinct label l from public.plan_calibrations where search_id = $1`, [s.search])).map((r) => r.l)).toEqual(['CALIBRATION — NOT VERIFIED']);
  });

  it('37/40. full replay under the SAME frozen contract; hard-gate failures are REJECTED; 71. a refresh never duplicates a replay', async () => {
    const runs = await drive(s.search, 'replay');
    expect(runs.at(-1)!.body).toMatchObject({ done: true });
    const evals = await q<Row>(`select status, contract_hash, gates, run_id from public.engine_evaluations where search_id = $1`, [s.search]);
    expect(evals.length).toBeGreaterThanOrEqual(3);
    expect(evals.every((e) => e.contract_hash === s.contractHash && e.run_id === s.run)).toBe(true);
    expect(evals.some((e) => e.status === 'VERIFIED')).toBe(true);
    const rejected = evals.find((e) => e.status === 'REJECTED');
    expect(rejected.gates.filter((g: Row) => g.required && g.outcome === 'failed').length).toBeGreaterThan(0);
    expect(rejected.gates.find((g: Row) => g.name === 'quality_floor').threshold).toBe(0.95);
    const execs = (await q<{ n: number }>(`select count(*)::int n from public.engine_executions where search_id = $1`, [s.search]))[0].n;
    const again = await call('POST', `/api/optimize/searches/${s.search}/replay`, { gate_config: { quality_floor: 0.1 } });
    expect(again.body.done).toBe(true);
    expect((await q<{ n: number }>(`select count(*)::int n from public.engine_executions where search_id = $1`, [s.search]))[0].n).toBe(execs);
    // Deterministic plans never call or bill a provider.
    expect((await q<{ n: number }>(`select coalesce(sum(provider_call_count), 0)::int n from public.engine_executions where search_id = $1`, [s.search]))[0].n).toBe(0);
  });

  it('computes a Pareto frontier of VERIFIED tradeoff plans; rejected plans are never on it', async () => {
    const r = (await call('GET', `/api/optimize/searches/${s.search}`)).body;
    s.report = r;
    expect(r.search.status).toBe('completed');
    expect(r.counts.frontier).toBeGreaterThanOrEqual(2);
    const front = r.plans.filter((p: Row) => p.frontier_state === 'FRONTIER');
    expect(front.every((p: Row) => p.verdict === 'VERIFIED' && p.status === 'PARETO_FRONTIER')).toBe(true);
    expect(r.plans.filter((p: Row) => p.verdict === 'REJECTED').every((p: Row) => p.frontier_state === null)).toBe(true);
    for (const p of front) expect(p.dominance_state.frontier_reason).toMatch(/No VERIFIED plan is at least as good/);
  });

  it('applies decision policies from the frontier and explains the choice', async () => {
    const m = await call('POST', `/api/optimize/searches/${s.search}/decision`, { policy: 'MARGIN_FIRST' });
    const b = await call('POST', `/api/optimize/searches/${s.search}/decision`, { policy: 'BALANCED' });
    expect(m.body.decision).toMatchObject({
      outcome: 'SELECTED',
      policy: 'MARGIN_FIRST',
    });
    expect(b.body.decision.selected_plan_id).not.toBe(m.body.decision.selected_plan_id);
    expect(b.body.decision.explanation.rule).toMatch(/regress nothing/);
    const again = await call('POST', `/api/optimize/searches/${s.search}/decision`, { policy: 'MARGIN_FIRST' });
    expect(again.body.decision.id).toBe(m.body.decision.id);
    const plans = (await call('GET', `/api/optimize/searches/${s.search}`)).body.plans;
    expect(plans.filter((p: Row) => p.status === 'SELECTED').map((p: Row) => p.id)).toEqual([m.body.decision.selected_plan_id]);
    expect(
      (
        await call('POST', `/api/optimize/searches/${s.search}/decision`, {
          policy: 'CUSTOM_CONSTRAINTS',
          params: { quality_floor: 0.1 },
        })
      ).status,
    ).toBe(422);
    s.selected = m.body.decision.selected_plan_id;
  });

  it('every plan explains itself; the executive report says what is not yet measured', async () => {
    const plan = (await call('GET', `/api/optimize/plans/${s.selected}`)).body;
    for (const k of ['why_generated', 'supporting_diagnoses', 'zevir_nodes_changed', 'passes_composed', 'conflicts_checked', 'why_calibration', 'calibration', 'why_frontier', 'why_selected', 'falsifiers', 'rollback', 'not_proven']) expect(plan.explanation).toHaveProperty(k);
    expect(plan.explanation.why_selected).toMatch(/ranks first under MARGIN_FIRST/);
    const r = (await call('GET', `/api/optimize/searches/${s.search}`)).body;
    expect(r.executive.headline).toMatch(/plans generated · \d+ calibrated · \d+ fully replayed · \d+ verified · \d+ non-dominated · 1 selected for MARGIN_FIRST/);
    expect(r.executive.recommendation).toMatchObject({
      plan_id: s.selected,
      label: 'VERIFIED on the evaluation set',
      realized_production_result: 'NOT YET MEASURED',
    });
    expect(r.executive.recommendation.evaluated_cpso_change_pct).toBeLessThan(0);
  });

  it('53/57. Bad-Day Replay keeps a separate verdict and never claims production', async () => {
    const prof = await call('POST', `/api/optimize/products/${s.product}/bad-day-profiles`, {
      scenario: 'PROVIDER_RATE_LIMIT',
      parameters: { rate: 0.2, retry_after_ms: 500 },
    });
    expect(
      (
        await call('POST', `/api/optimize/products/${s.product}/bad-day-profiles`, {
          scenario: 'PROVIDER_RATE_LIMIT',
          parameters: { retry_after_ms: 500, rate: 0.2 },
        })
      ).body.id,
    ).toBe(prof.body.id);
    const r = await call('POST', `/api/optimize/plans/${s.selected}/bad-day`, {
      profile_id: prof.body.id,
    });
    expect(r.body.result).toMatchObject({
      label: 'BAD-DAY REPLAY',
      normal_verdict: 'VERIFIED',
    });
    expect(['VERIFIED', 'REJECTED', 'INCOMPLETE']).toContain(r.body.result.bad_day_verdict);
    expect(r.body.result.metrics.not_claimed).toMatch(/≠ production guarantee/);
    expect(
      (
        await call('POST', `/api/optimize/plans/${s.selected}/bad-day`, {
          profile_id: prof.body.id,
        })
      ).body,
    ).toMatchObject({ reused: true, result: { id: r.body.result.id } });
    const plan = (await q<{ verdict: string; status: string }>('select verdict, status from public.execution_plans where id = $1', [s.selected]))[0];
    expect(plan).toEqual({ verdict: 'VERIFIED', status: 'SELECTED' });
    const rejected = s.report.plans.find((p: Row) => p.verdict === 'REJECTED');
    expect(
      (
        await call('POST', `/api/optimize/plans/${rejected.id}/bad-day`, {
          profile_id: prof.body.id,
        })
      ).body.code,
    ).toBe('PLAN_NOT_VERIFIED');
  });

  it('67. no raw prompt or output anywhere in the report', async () => {
    const text = JSON.stringify((await call('GET', `/api/optimize/searches/${s.search}`)).body) + JSON.stringify((await call('GET', `/api/optimize/plans/${s.selected}`)).body);
    for (const raw of ['charged twice', 'arrived broken', 'DEMO SYNTHETIC. Classify', 'logged into my account', 'refund request for', 'DEMO SYNTHETIC chunk', 'order ORDER-']) expect(text).not.toContain(raw);
    const zev = await q<{ n: number }>(`select count(*)::int n from public.zevir_nodes n join public.zevir_graphs g on g.id = n.graph_id where g.product_id = $1 and n.attributes::text like '%DEMO SYNTHETIC%'`, [s.product]);
    expect(zev[0].n).toBe(0);
  });

  it('77/78. the engine’s own execute route refuses a composed plan; Part 2A routes keep working', async () => {
    const ep = (await q<{ id: string }>(`select id from public.engine_plans where strategy = 'execution_plan' and product_id = $1 limit 1`, [s.product]))[0].id;
    expect((await call('POST', `/api/engine/products/${s.product}/optimization/plans/${ep}/execute`, {})).body.code).toBe('PLAN_REQUIRES_PLAN_SEARCH');
    const c = await call('POST', `/api/optimize/runs/${s.run}/candidates`);
    expect(c.body.candidates.filter((x: Row) => x.strategy === 'exact_reuse' && x.executable_status === 'EXECUTABLE')).toHaveLength(2);
  });
});

describe('budgets', () => {
  const tight = async (bounds: Row, seed: string) =>
    (
      await call('POST', `/api/optimize/runs/${s.run}/searches`, {
        bounds,
        seed,
      })
    ).body.search;

  it('58. the plan-generation limit is enforced and reported', async () => {
    const x = await tight({ max_generated_plans: 10 }, 'b58');
    expect(x.generation).toMatchObject({
      generated: 10,
      truncation_note: expect.stringMatching(/max_generated_plans = 10/),
    });
    expect(
      (
        await call('POST', `/api/optimize/runs/${s.run}/searches`, {
          bounds: { max_generated_plans: 1000 },
        })
      ).status,
    ).toBe(422);
  });

  it('59/62. the calibration budget is enforced and exhaustion is explicit', async () => {
    const x = await tight({ max_calibration_plans: 2 }, 'b59');
    const runs = await drive(x.id, 'calibrate');
    const last = runs.at(-1)!.body;
    expect(last.budget).toMatchObject({
      code: 'SEARCH_BUDGET_EXHAUSTED',
      stage: 'calibration',
      reason: 'max_calibration_plans = 2',
    });
    expect(last.budget.not_calibrated.length).toBeGreaterThan(0);
    expect(new Set((await q<{ p: string }>('select plan_id p from public.plan_calibrations where search_id = $1', [x.id])).map((r) => r.p)).size).toBe(2);
    s.b59 = x.id;
  });

  it('60. the full-replay budget is enforced', async () => {
    const runs = await drive(s.b59, 'replay');
    const r = (await call('GET', `/api/optimize/searches/${s.b59}`)).body;
    expect(r.counts.fully_replayed).toBeLessThanOrEqual(5);
    const x = await tight({ max_full_replay_plans: 1 }, 'b60');
    await drive(x.id, 'calibrate');
    const rr = await drive(x.id, 'replay');
    expect(rr.at(-1)!.body.budget).toMatchObject({
      code: 'SEARCH_BUDGET_EXHAUSTED',
      stage: 'full_replay',
      reason: 'max_full_replay_plans = 1',
    });
    expect((await call('GET', `/api/optimize/searches/${x.id}`)).body.counts.fully_replayed).toBe(1);
    void runs;
  });

  it('61. a replay-sample budget stops work cleanly with what was and was not evaluated', async () => {
    const x = await tight({ max_replay_samples_total: 20 }, 'b61');
    await drive(x.id, 'calibrate');
    const rr = await drive(x.id, 'replay');
    const last = rr.at(-1)!.body;
    expect(last.search.status).toBe('budget_exhausted');
    expect(last.budget).toMatchObject({
      code: 'SEARCH_BUDGET_EXHAUSTED',
      reason: 'max_replay_samples_total = 20',
    });
    expect(last.budget.not_evaluated.length).toBeGreaterThan(0);
    expect((await call('POST', `/api/optimize/searches/${x.id}/replay`)).body.done).toBe(true);
  });
});

describe('cancellation', () => {
  it('72. a cancelled search stays cancelled and refuses further stages', async () => {
    const x = (
      await call('POST', `/api/optimize/runs/${s.run}/searches`, {
        seed: 'cancel-me',
      })
    ).body.search;
    expect((await call('POST', `/api/optimize/searches/${x.id}/cancel`)).body.search.status).toBe('cancelled');
    expect((await call('POST', `/api/optimize/searches/${x.id}/calibrate`)).body.code).toBe('SEARCH_CANCELLED');
    expect((await call('POST', `/api/optimize/searches/${x.id}/replay`)).body.code).toBe('SEARCH_CANCELLED');
    expect((await call('POST', `/api/optimize/searches/${x.id}/cancel`)).body.search.status).toBe('cancelled');
    expect((await q<{ n: number }>('select count(*)::int n from public.engine_executions where search_id = $1', [x.id]))[0].n).toBe(0);
  });

  it('refuses diagnoses-to-search on evidence that changed after the baseline', async () => {
    await q(`insert into public.engine_traces(product_id, workspace_id, request_id, input_text, output_text, input_hash, output_hash, latency_ms) values ($1, $2, 'late', 'x', 'billing', $3, $4, 100)`, [s.product, WS_A, 'e'.repeat(64), 'f'.repeat(64)]);
    expect(
      (
        await call('POST', `/api/optimize/runs/${s.run}/searches`, {
          seed: 'late',
        })
      ).body.code,
    ).toBe('EVIDENCE_CHANGED');
    expect((await call('POST', `/api/optimize/searches/${s.b59}/calibrate`)).body.done).toBe(true); // terminal or done: no new work on changed evidence
  });
});
