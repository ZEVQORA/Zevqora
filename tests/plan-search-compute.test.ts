/**
 * Optimization Intelligence with platform compute configured (provider
 * mocked at the platform boundary: no network). Covers composed plans that
 * call a substituted model: declared composition order end to end, spend
 * budgets, and billing through the existing platform path.
 *
 * SYNTHETIC DEMO — NOT CUSTOMER DATA.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, routeState } from './helpers/routes';

const provider = vi.hoisted(() => ({ calls: [] as Array<{ operation: string; billing: unknown; model: string }>, answers: new Map<string, string>() }));
vi.mock('../api/_lib/auth.js', () => authMock);
// Whole-workload replays on an in-process Postgres: allow for a loaded CI machine.
vi.setConfig({ testTimeout: 120_000 });
vi.mock('../api/_lib/openrouter.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), openRouterConfigured: () => true }));
vi.mock('../api/_lib/platform-compute.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // The platform boundary: same arguments the real completeText receives; a deterministic answer back.
  completeText: async ({ operation, billing, payload }: { operation: string; billing: unknown; payload: { model: string; messages: { role: string; content: string }[] } }) => {
    provider.calls.push({ operation, billing, model: payload.model });
    const user = payload.messages.filter((m) => m.role === 'user').at(-1)?.content || '';
    return { content: provider.answers.get(user) ?? 'billing', model: payload.model, requestId: `req-${provider.calls.length}`, latencyMs: 40, inputTokens: 900, outputTokens: 1, cachedInputTokens: 0, cost: 0.0002 };
  },
}));

const USER = 'a0000000-0000-4000-8000-00000000000a';
const WS = 'a1111111-1111-4111-8111-111111111111';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let dispatch: (r: Request) => Promise<Response>;
const call = (m: string, p: string, b?: unknown) => rawCall(dispatch, m, p, b);
const q = async <T,>(sql: string, params: unknown[] = []) => (await routeState.db!.query<T>(sql, params)).rows;
const s: Row = {};
async function drive(id: string, stage: string) {
  let r: Row = {};
  for (let i = 0; i < 20; i += 1) {
    r = await call('POST', `/api/optimize/searches/${id}/${stage}`);
    if (r.status !== 200 || r.body.done) break;
  }
  return r;
}

beforeAll(async () => {
  routeState.db = await createDb();
  routeState.rest = restClient(routeState.db);
  await seedWorkspace(routeState.db, { userId: USER, workspaceId: WS, slug: 'alpha', role: 'owner' });
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
  await import('../api/_lib/handlers/zevir.js');
  await import('../api/_lib/handlers/optimize.js');
  await import('../api/_lib/handlers/optimize-search.js');
  routeState.user = USER;
  await q(`update public.feature_flags set workspace_overrides = $1 where key in ('verified_optimization_vnext', 'optimization_intelligence_vnext')`, [JSON.stringify({ [WS]: true })]);
  const { demoTraces } = await import('../api/_lib/optimize/demo.js');
  for (const t of demoTraces()) if (t.expected_output) provider.answers.set(t.input_text, t.expected_output);
  const demo = await call('POST', '/api/optimize/demo', { workspace_id: WS, variant: 'intelligence' });
  s.product = demo.body.product_id;
  const draft = await call('POST', `/api/optimize/products/${s.product}/contracts`, {});
  const frozen = await call('POST', `/api/optimize/products/${s.product}/contracts/${draft.body.id}/freeze`);
  s.run = (await call('POST', `/api/optimize/products/${s.product}/runs`, { contract_id: frozen.body.id })).body.id;
  await call('POST', `/api/optimize/runs/${s.run}/baseline`);
  await call('POST', `/api/optimize/runs/${s.run}/diagnoses`);
}, 120_000);

describe('with platform compute', () => {
  it('model-substitution plans become executable and compose with caches and lookups', async () => {
    const r = await call('POST', `/api/optimize/runs/${s.run}/searches`, { seed: 'compute' });
    s.search = r.body.search.id;
    const plans = (await call('GET', `/api/optimize/searches/${s.search}`)).body.plans;
    const sub = plans.filter((p: Row) => p.passes.some((x: Row) => x.kind === 'model_substitution'));
    expect(sub.length).toBeGreaterThan(1);
    expect(sub.filter((p: Row) => p.status !== 'CONFLICTED').every((p: Row) => p.executable_status === 'EXECUTABLE')).toBe(true);
  });

  it('61. a provider-spend budget stops paid work before it is spent, and says so; free plans continue', async () => {
    const x = (await call('POST', `/api/optimize/runs/${s.run}/searches`, { seed: 'no-spend', bounds: { max_provider_spend_usd: 0 } })).body.search;
    const before = provider.calls.length;
    const cal = await drive(x.id, 'calibrate');
    expect(provider.calls.length).toBe(before);
    expect(cal.body.budget.code).toBe('SEARCH_BUDGET_EXHAUSTED');
    expect(cal.body.budget.spend_skipped.length).toBeGreaterThan(0);
    expect(cal.body.budget.spend_skipped.every((p: Row) => /Smaller model/.test(p.name) && /max_provider_spend_usd/.test(p.reason))).toBe(true);
    expect((await q<{ n: number }>(`select count(*)::int n from public.plan_calibrations where search_id = $1`, [x.id]))[0].n).toBeGreaterThan(0); // deterministic plans still calibrated
    expect(cal.body.search.spend.provider_usd).toBe(0);
  });

  it('38 (route). a cache in front of the substituted model serves the model’s answers; 76. billing goes through the platform path', async () => {
    const plan = (await call('GET', `/api/optimize/searches/${s.search}`)).body.plans.find((p: Row) => p.passes.map((x: Row) => x.kind).join('+') === 'exact_response_reuse+model_substitution' && p.passes[0].scope === 'classify_ticket' && p.passes[0].config.ttl_ms === null);
    expect(plan).toBeTruthy();
    await q(`update public.execution_plans set status = 'FULL_REPLAY_READY' where search_id = $1 and status in ('CALIBRATION_READY')`, [s.search]);
    await q(`update public.execution_plans set status = 'PRUNED' where search_id = $1 and status = 'FULL_REPLAY_READY' and id <> $2`, [s.search, plan.id]);
    const before = provider.calls.length;
    const r = await drive(s.search, 'replay');
    expect(r.status).toBe(200);
    const ex = (await q<Row>(`select sample_results, provider_call_count, cost_usd from public.engine_executions where execution_plan_id = $1 and stage = 'full_replay'`, [plan.id]))[0];
    const paths = ex.sample_results.reduce((a: Row, x: Row) => ({ ...a, [x.path]: (a[x.path] || 0) + 1 }), {});
    expect(paths).toMatchObject({ model_call: expect.any(Number), cache_hit: 12 });
    expect(ex.sample_results.filter((x: Row) => x.path === 'cache_hit').every((x: Row) => typeof x.reused_from_trace_id === 'string')).toBe(true);
    // Every substituted call went through the platform completion with the resolved billing, as a replay.
    const made = provider.calls.slice(before);
    expect(made.length).toBe(ex.provider_call_count);
    expect(made.every((c) => c.operation === 'replay' && c.model === 'openai/gpt-4o-mini' && c.billing)).toBe(true);
    const search = (await call('GET', `/api/optimize/searches/${s.search}`)).body.search;
    expect(search.spend.provider_calls).toBe(ex.provider_call_count);
    expect(search.spend.provider_usd).toBeCloseTo(ex.provider_call_count * 0.0002, 8);
    const ev = (await q<{ status: string }>(`select status from public.engine_evaluations where execution_plan_id = $1`, [plan.id]))[0];
    expect(['VERIFIED', 'REJECTED', 'INCOMPLETE']).toContain(ev.status);
  });
});
