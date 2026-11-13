/**
 * Unknown is not failure. A workload without recorded outcomes (no expected
 * output / label) cannot show that a candidate is worse any more than it can
 * show it is better: quality and task success are UNKNOWN, so the verdict is
 * INCOMPLETE — never REJECTED on an invented quality of 0, and never VERIFIED.
 *
 * Found by the CTO proof-loop run (2026-11-04): on the candidate-replay path
 * the classification grader scored every unlabelled case 0, so quality_floor
 * and task_success_floor "failed" and minimum_samples counted cases nobody can
 * judge. With a contract that does not require protected cases, that produced
 * REJECTED. SYNTHETIC FIXTURE — NOT CUSTOMER DATA.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, routeState } from './helpers/routes';
import { DEMO_REQUIREMENTS, demoTraces } from '../api/_lib/optimize/demo.js';
import { gradeOutput } from '../api/_lib/product/evaluator.js';

vi.mock('../api/_lib/auth.js', () => authMock);
vi.setConfig({ testTimeout: 120_000 });

const USER = 'a0000000-0000-4000-8000-0000000000e1';
const WS = 'a1111111-1111-4111-8111-1111111111e1';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let dispatch: (r: Request) => Promise<Response>;
const call = (m: string, p: string, b?: unknown) => rawCall(dispatch, m, p, b);
const unlabelled = () =>
  demoTraces().map((t: Row) => {
    const { expected_output, ...rest } = t;
    void expected_output;
    return rest;
  });

beforeAll(async () => {
  routeState.db = await createDb();
  routeState.rest = restClient(routeState.db);
  await seedWorkspace(routeState.db, { userId: USER, workspaceId: WS, slug: 'unlabelled', role: 'owner' });
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
  await import('../api/_lib/handlers/zevir.js');
  await import('../api/_lib/handlers/optimize.js');
  routeState.user = USER;
  await routeState.db.query(`update public.feature_flags set workspace_overrides = $1 where key = 'verified_optimization_vnext'`, [JSON.stringify({ [WS]: true })]);
}, 120_000);

describe('grading without a recorded outcome', () => {
  it('returns an unknown score, not 0, when a classification case has no expected label', () => {
    const g = gradeOutput('billing', null, [{ name: 'classification', version: null, config: { labels: ['billing', 'technical'], strict: true } }]);
    expect(g.score).toBeNull();
    expect(g.passed).toBe(false);
    expect(g.results[0]).toMatchObject({ unknown: true, details: { error: 'labels_or_expected_missing' } });
  });

  it('still fails a wrong answer when the label is known', () => {
    const g = gradeOutput('technical', 'billing', [{ name: 'classification', version: null, config: { labels: ['billing', 'technical'], strict: true } }]);
    expect(g).toMatchObject({ score: 0, passed: false });
  });
});

describe('candidate replay on an unlabelled workload', () => {
  it('is INCOMPLETE with quality and task success unknown — not REJECTED, not VERIFIED', async () => {
    const product = await call('POST', '/api/engine/products', { workspace_id: WS, root_path: 'workload://fixture-unlabelled', name: 'Unlabelled fixture (SYNTHETIC — NOT CUSTOMER DATA)' });
    expect(product.status).toBe(200);
    const imp = await call('POST', `/api/engine/products/${product.body.id}/traces/import`, { traces: unlabelled() });
    expect(imp.body).toMatchObject({ imported: 32, rejected: 0 });
    // Protected cases are not required here, so nothing else can mask the quality gates.
    const draft = await call('POST', `/api/optimize/products/${product.body.id}/contracts`, { requirements: DEMO_REQUIREMENTS });
    const frozen = await call('POST', `/api/optimize/products/${product.body.id}/contracts/${draft.body.id}/freeze`);
    expect(frozen.body.status).toBe('frozen');
    const run = await call('POST', `/api/optimize/products/${product.body.id}/runs`, { contract_id: frozen.body.id });
    const base = await call('POST', `/api/optimize/runs/${run.body.id}/baseline`);
    expect(base.body.snapshot.completeness).toBe('incomplete');
    expect(base.body.snapshot.metrics.quality.task_success.rate).toBeNull();
    expect((await call('POST', `/api/optimize/runs/${run.body.id}/diagnoses`)).status).toBe(200);
    const cands = await call('POST', `/api/optimize/runs/${run.body.id}/candidates`);
    const exec = cands.body.candidates.find((c: Row) => c.executable_status === 'EXECUTABLE');
    expect(exec).toBeTruthy();
    const replay = await call('POST', `/api/optimize/runs/${run.body.id}/candidates/${exec.id}/replay`, {});
    expect(replay.status).toBe(200);
    const ev = replay.body.evaluation;
    const gate = (name: string) => ev.gates.find((g: Row) => g.name === name);
    expect(ev.status).toBe('INCOMPLETE');
    expect(gate('quality_floor').outcome).toBe('missing');
    expect(gate('minimum_samples').outcome).toBe('missing');
    expect(gate('task_success_floor').outcome).toBe('missing');
    expect(ev.gates.filter((g: Row) => g.required && g.outcome === 'failed').map((g: Row) => g.name)).toEqual([]);
    expect(ev.performance_comparison.candidate.quality).toBeNull();
    expect(ev.performance_comparison.candidate.task_success_rate).toBeNull();
  });
});
