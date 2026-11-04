/**
 * FIXTURE PROOF — the Observe → Baseline → Diagnose → Plan → Replay → Verify →
 * Human Review loop on the real router, handlers, executors, evaluator and SQL
 * migrations (PGlite, Postgres 17). Only the JWT check is mocked. No provider
 * is called and nothing is deployed.
 *
 * The workload is the labelled synthetic demo (api/_lib/optimize/demo.js):
 * SYNTHETIC DEMO — NOT CUSTOMER DATA. This proves the decision machinery, not
 * savings on any real system.
 *
 * It proves three outcomes from real execution:
 *   VERIFIED    every required gate of the frozen contract passes;
 *   REJECTED    a cheaper candidate fails the quality floor and is not offered;
 *   INCOMPLETE  the same traces without recorded outcomes: no PASS, no savings.
 * The whole loop runs twice on independent databases. Identical across runs:
 * the observed workload, frozen contract, baseline, diagnoses, generated plans,
 * evaluation set, replay budget use, the human-review outcome and the
 * INCOMPLETE path; and every plan fully replayed in both runs gets the same
 * verdict and metrics. NOT identical, and recorded as a known limitation:
 * WHICH plans are calibrated and promoted to full replay, because calibration
 * sampling ranks by sha256(seed, plan_hash, unit) and plan hashes / units carry
 * database-generated ids (stable within one search, not across re-imports).
 *
 * With PROOF_LOOP_OUT=<file> the record is written there with its hashes:
 *   PROOF_LOOP_OUT=../cto-evidence/proof-loop.json npx vitest run tests/proof-loop-fixture.test.ts
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, routeState } from './helpers/routes';
import { DEMO_V2_REQUIREMENTS, demoTraces } from '../api/_lib/optimize/demo.js';

vi.mock('../api/_lib/auth.js', () => authMock);
vi.setConfig({ testTimeout: 300_000 });

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OWNER = 'a0000000-0000-4000-8000-0000000000f1';
const WS = 'a1111111-1111-4111-8111-1111111111f1';
const PROOF_LABEL = 'FIXTURE PROOF — SYNTHETIC DEMO WORKLOAD — NOT CUSTOMER DATA — NOT REAL-CUSTOMER VALIDATION';

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Row).sort().map((k) => [k, canonical((v as Row)[k])]));
  return v;
}
const sha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const round = (n: unknown) => (typeof n === 'number' ? Number(n.toFixed(6)) : n);

let dispatch: (r: Request) => Promise<Response>;
const call = (m: string, p: string, b?: unknown) => rawCall(dispatch, m, p, b);
const q = async <T = Row>(sql: string, params: unknown[] = []) => (await routeState.db!.query<T>(sql, params)).rows;

async function drive(searchId: string, stage: 'calibrate' | 'replay') {
  let last: Row = {};
  for (let i = 0; i < 25; i += 1) {
    const r = await call('POST', `/api/optimize/searches/${searchId}/${stage}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    last = r.body;
    if (r.body.done) break;
  }
  return last;
}

async function freshDb() {
  routeState.db = await createDb();
  routeState.rest = restClient(routeState.db);
  routeState.user = OWNER;
  await seedWorkspace(routeState.db, { userId: OWNER, workspaceId: WS, slug: 'proof', role: 'owner' });
  if (!dispatch) {
    ({ dispatch } = await import('../api/_lib/router.js'));
    await import('../api/_lib/handlers/engine.js');
    await import('../api/_lib/handlers/zevir.js');
    await import('../api/_lib/handlers/optimize.js');
    await import('../api/_lib/handlers/optimize-search.js');
  }
  for (const k of ['verified_optimization_vnext', 'optimization_intelligence_vnext']) await q(`update public.feature_flags set workspace_overrides = $1 where key = $2`, [JSON.stringify({ [WS]: true }), k]);
}

/** Freeze → run → baseline → diagnose for one product; returns the ids and the frozen evidence. */
async function frozenRun(productId: string, requirements: unknown) {
  const draft = await call('POST', `/api/optimize/products/${productId}/contracts`, { requirements });
  expect(draft.status, JSON.stringify(draft.body)).toBe(200);
  const frozen = await call('POST', `/api/optimize/products/${productId}/contracts/${draft.body.id}/freeze`);
  expect(frozen.body.status).toBe('frozen');
  const run = await call('POST', `/api/optimize/products/${productId}/runs`, { contract_id: frozen.body.id });
  expect(run.status).toBe(200);
  const baseline = (await call('POST', `/api/optimize/runs/${run.body.id}/baseline`)).body.snapshot;
  const diagnoses = (await call('POST', `/api/optimize/runs/${run.body.id}/diagnoses`)).body as Row[];
  return { frozen: frozen.body, runId: run.body.id, baseline, diagnoses };
}

async function proofLoop() {
  await freshDb();

  // OBSERVE — load the labelled synthetic workload (LLM traces + agent spans → ZevIR graphs).
  const demo = await call('POST', '/api/optimize/demo', { workspace_id: WS, variant: 'intelligence' });
  expect(demo.status).toBe(200);
  expect(demo.body.name).toContain('SYNTHETIC DEMO — NOT CUSTOMER DATA');
  const productId = demo.body.product_id;
  const observed = (await q<{ traces: number; graphs: number }>(`select (select count(*)::int from public.engine_traces where product_id = $1) traces, (select count(*)::int from public.zevir_graphs where product_id = $1) graphs`, [productId]))[0];

  // BASELINE — freeze the contract, then measure the baseline under it. DIAGNOSE.
  const main = await frozenRun(productId, demo.body.suggested_requirements);
  expect(main.frozen.requirements.quality_floor).toBe(DEMO_V2_REQUIREMENTS.quality_floor);
  expect(main.baseline.completeness).toBe('complete');
  expect(main.baseline.contract_hash).toBe(main.frozen.contract_hash);

  // PLAN — bounded plan search over the frozen evaluation set. REPLAY — calibrate, then full replay.
  const started = await call('POST', `/api/optimize/runs/${main.runId}/searches`, {});
  expect(started.status).toBe(200);
  const search = started.body.search;
  expect(search.contract_hash).toBe(main.frozen.contract_hash);
  expect(search.snapshot_hash).toBe(main.baseline.snapshot_hash);
  const calibrated = await drive(search.id, 'calibrate');
  const replayed = await drive(search.id, 'replay');

  // VERIFY — verdicts come only from replay under the same frozen contract.
  const report = (await call('GET', `/api/optimize/searches/${search.id}`)).body;
  const evals = await q(`select status, contract_hash, run_id, gates from public.engine_evaluations where search_id = $1`, [search.id]);
  expect(evals.length).toBe(report.counts.fully_replayed);
  expect(evals.every((e) => e.contract_hash === main.frozen.contract_hash && e.run_id === main.runId)).toBe(true);
  const plans = (report.plans as Row[]).filter((p) => p.verdict).sort((a, b) => a.name.localeCompare(b.name));
  const failedRequired = (gates: Row[]) => gates.filter((g) => g.required && g.outcome !== 'passed').map((g) => `${g.name}:${g.outcome}`);
  const evalByStatus = (s: string) => evals.filter((e) => e.status === s);
  for (const e of evalByStatus('VERIFIED')) expect(failedRequired(e.gates)).toEqual([]);
  for (const e of evalByStatus('REJECTED')) expect(e.gates.some((g: Row) => g.required && g.outcome === 'failed')).toBe(true);
  expect(plans.filter((p) => p.verdict === 'REJECTED').every((p) => p.frontier_state === null)).toBe(true);
  const providerCalls = (await q<{ n: number }>(`select coalesce(sum(provider_call_count), 0)::int n from public.engine_executions where search_id = $1`, [search.id]))[0].n;

  // HUMAN REVIEW — a policy selects among VERIFIED frontier plans; nothing is implemented or deployed.
  const decision = (await call('POST', `/api/optimize/searches/${search.id}/decision`, { policy: 'MARGIN_FIRST' })).body.decision;
  const after = (await call('GET', `/api/optimize/searches/${search.id}`)).body;
  const selected = (after.plans as Row[]).find((p) => p.id === decision.selected_plan_id);
  const implementations = (await q<{ n: number }>(`select count(*)::int n from public.engine_implementations where product_id = $1`, [productId]))[0].n;

  // INCOMPLETE — the same synthetic traces with every recorded outcome removed.
  const p2 = await call('POST', '/api/engine/products', { workspace_id: WS, root_path: 'workload://fixture-unlabelled', name: 'Unlabelled fixture (SYNTHETIC — NOT CUSTOMER DATA)' });
  const unlabelled = demoTraces().map((t: Row) => {
    const { expected_output, ...rest } = t;
    void expected_output;
    return rest;
  });
  const imported = (await call('POST', `/api/engine/products/${p2.body.id}/traces/import`, { traces: unlabelled })).body;
  const inc = await frozenRun(p2.body.id, demo.body.suggested_requirements);
  const incSearch = (await call('POST', `/api/optimize/runs/${inc.runId}/searches`, {})).body.search;
  await drive(incSearch.id, 'calibrate');
  await drive(incSearch.id, 'replay');
  const incReport = (await call('GET', `/api/optimize/searches/${incSearch.id}`)).body;
  const incCandidates = (await call('POST', `/api/optimize/runs/${inc.runId}/candidates`)).body.candidates as Row[];
  const executable = incCandidates.find((c) => c.executable_status === 'EXECUTABLE');
  const incReplay = executable ? (await call('POST', `/api/optimize/runs/${inc.runId}/candidates/${executable.id}/replay`, {})).body.evaluation : null;

  const planOut = (p: Row) => ({
    name: p.name,
    verdict: p.verdict,
    status: p.status,
    frontier: p.frontier_state,
    evaluated: p.evaluated_effects ? { cases: p.evaluated_effects.cases, quality: round(p.evaluated_effects.quality), task_success: round(p.evaluated_effects.task_success), cost_usd: round(p.evaluated_effects.cost_usd), cpso_usd: round(p.evaluated_effects.cpso_usd), p95_ms: p.evaluated_effects.p95_ms, cost_delta_pct: round(p.evaluated_effects.deltas_pct?.cost), cpso_delta_pct: round(p.evaluated_effects.deltas_pct?.cost_per_successful_outcome) } : null,
  });

  const record = {
    label: PROOF_LABEL,
    observe: { traces: observed.traces, zevir_graphs: observed.graphs, demo_name: demo.body.name },
    frozen_contract: { requirements: main.frozen.requirements, version: main.frozen.version },
    baseline: { completeness: main.baseline.completeness, trace_count: main.baseline.trace_count, quality: main.baseline.metrics?.quality?.score ?? null, task_success_rate: main.baseline.metrics?.quality?.task_success?.rate ?? null },
    diagnose: main.diagnoses.map((d) => `${d.family}:${d.scope ?? ''}`).sort(),
    plan: { bounds: search.bounds, evaluation_set: { size: search.evaluation_set.size, coverage: search.evaluation_set.coverage, excluded: search.evaluation_set.excluded.map((x: Row) => x.reasons.join('+')).sort() }, generation: search.generation.counts },
    replay: { calibration_stop: calibrated.budget?.reason ?? 'completed', full_replay_stop: replayed.budget?.reason ?? 'completed', calibrated: report.counts.calibrated, fully_replayed: report.counts.fully_replayed, provider_calls: providerCalls },
    verify: {
      counts: { calibration_rejected: report.counts.calibration_rejected, verified: report.counts.verified, rejected: report.counts.rejected, incomplete: report.counts.incomplete, frontier: report.counts.frontier },
      plans: plans.map(planOut),
      gate_outcomes: evals.map((e) => ({ status: e.status, not_passed: failedRequired(e.gates) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    },
    human_review: { policy: decision.policy, outcome: decision.outcome, selected_plan: selected?.name, selected_verdict: selected?.verdict, selected_status: selected?.status, realized_production_result: after.executive.recommendation?.realized_production_result ?? null, evaluated_cpso_change_pct: round(after.executive.recommendation?.evaluated_cpso_change_pct), implementations_created: implementations, deployed: false },
    incomplete: {
      imported: imported.imported,
      baseline_completeness: inc.baseline.completeness,
      baseline_task_success_rate: inc.baseline.metrics?.quality?.task_success?.rate ?? null,
      plan_search: { evaluation_set_size: incSearch.evaluation_set.size, excluded_reasons: [...new Set(incSearch.evaluation_set.excluded.flatMap((x: Row) => x.reasons))].sort(), verified: incReport.counts.verified, rejected: incReport.counts.rejected, fully_replayed: incReport.counts.fully_replayed, recommendation: incReport.executive.recommendation ?? null },
      candidate_replay: incReplay ? { status: incReplay.status, missing_required: incReplay.gates.filter((g: Row) => g.required && g.outcome === 'missing').map((g: Row) => g.name).sort(), failed_required: incReplay.gates.filter((g: Row) => g.required && g.outcome === 'failed').map((g: Row) => g.name).sort(), candidate_quality: incReplay.performance_comparison.candidate.quality, candidate_task_success: incReplay.performance_comparison.candidate.task_success_rate } : null,
    },
  };
  const runBound = { contract_hash: main.frozen.contract_hash, baseline_snapshot_hash: main.baseline.snapshot_hash, search_hash: search.search_hash, evaluation_set_hash: search.evaluation_set.hash, frontier_hash: after.search.frontier_hash, selected_plan_hash: selected?.plan_hash, replayed_plan_hashes: Object.fromEntries(plans.map((p) => [p.name, p.plan_hash])), incomplete_contract_hash: inc.frozen.contract_hash };
  return { record, runBound, report };
}

/** The part of the record that must not depend on database-generated ids. */
function invariant(record: Row) {
  const { verify, ...rest } = record;
  void verify;
  return { ...rest, replay: { ...rest.replay } };
}

describe('FIXTURE PROOF — real proof loop on the labelled synthetic workload', () => {
  it('produces VERIFIED, REJECTED and INCOMPLETE from real execution, reproducibly, with nothing deployed', async () => {
    const a = await proofLoop();
    const b = await proofLoop();
    const r = a.record;

    expect(r.observe.traces).toBeGreaterThan(0);
    expect(r.observe.zevir_graphs).toBeGreaterThan(0);
    for (const run of [a.record, b.record]) {
      expect(run.verify.counts.verified).toBeGreaterThanOrEqual(1);
      expect(run.verify.counts.rejected).toBeGreaterThanOrEqual(1);
      // REJECTED: cheaper on cost, but below the frozen quality floor — not offered, not counted as savings.
      const rejected = run.verify.plans.filter((p) => p.verdict === 'REJECTED');
      expect(rejected.every((p) => p.evaluated!.cost_delta_pct! < 0 && p.evaluated!.quality! < DEMO_V2_REQUIREMENTS.quality_floor)).toBe(true);
      expect(run.verify.gate_outcomes.filter((g) => g.status === 'REJECTED').every((g) => g.not_passed.includes('quality_floor:failed'))).toBe(true);
      // VERIFIED: every required gate passed; quality held at the baseline.
      expect(run.verify.gate_outcomes.filter((g) => g.status === 'VERIFIED').every((g) => g.not_passed.length === 0)).toBe(true);
      expect(run.verify.plans.filter((p) => p.verdict === 'VERIFIED').every((p) => p.evaluated!.quality! >= DEMO_V2_REQUIREMENTS.quality_floor)).toBe(true);
    }
    // HUMAN REVIEW: a VERIFIED frontier plan is selected for review; nothing is implemented; production is not measured.
    expect(r.human_review).toMatchObject({ outcome: 'SELECTED', selected_verdict: 'VERIFIED', selected_status: 'SELECTED', realized_production_result: 'NOT YET MEASURED', implementations_created: 0, deployed: false });
    expect(r.replay.provider_calls).toBe(0);
    // INCOMPLETE: without recorded outcomes there is no PASS and no savings claim.
    expect(r.incomplete.baseline_completeness).toBe('incomplete');
    expect(r.incomplete.plan_search).toMatchObject({ evaluation_set_size: 0, verified: 0, rejected: 0, recommendation: null });
    expect(r.incomplete.plan_search.excluded_reasons).toContain('outcome_unknown');
    expect(r.incomplete.candidate_replay).toMatchObject({ status: 'INCOMPLETE', failed_required: [], candidate_quality: null, candidate_task_success: null });
    expect(r.incomplete.candidate_replay!.missing_required).toEqual(expect.arrayContaining(['quality_floor', 'minimum_samples', 'task_success_floor']));

    // Reproducible: everything that does not depend on database-generated ids is identical,
    // and a plan fully replayed in both runs gets the same verdict and the same metrics.
    expect(invariant(b.record)).toEqual(invariant(a.record));
    expect(sha256(invariant(b.record))).toBe(sha256(invariant(a.record)));
    const byName = (run: Row) => new Map<string, Row>(run.verify.plans.map((p: Row) => [p.name, p]));
    const [pa, pb] = [byName(a.record), byName(b.record)];
    const common = [...pa.keys()].filter((n) => pb.has(n));
    expect(common.length).toBeGreaterThanOrEqual(2);
    for (const n of common) expect(pb.get(n), n).toEqual(pa.get(n));
    const promotion = { run_1: [...pa.keys()].sort(), run_2: [...pb.keys()].sort(), identical: JSON.stringify([...pa.keys()].sort()) === JSON.stringify([...pb.keys()].sort()) };

    if (process.env.PROOF_LOOP_OUT) {
      let gitSha: string | null = null;
      try {
        gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        gitSha = null;
      }
      const sections = Object.fromEntries(Object.entries(invariant(r)).map(([k, v]) => [k, sha256(v)]));
      writeFileSync(
        process.env.PROOF_LOOP_OUT,
        JSON.stringify(
          {
            schema: 'zevqora.proof-loop.v1',
            label: PROOF_LABEL,
            generated_at: new Date().toISOString(),
            source: { git_sha: gitSha, node: process.version, engine: 'real router/handlers/evaluator + supabase/migrations on PGlite (Postgres 17); JWT check mocked; no provider calls' },
            command: 'PROOF_LOOP_OUT=<file> npx vitest run tests/proof-loop-fixture.test.ts',
            reproducibility: {
              runs: 2,
              independent_databases: true,
              invariant_identical: true,
              invariant_sha256: sha256(invariant(r)),
              plans_replayed_in_both_runs: common.length,
              verdicts_and_metrics_identical_on_common_plans: true,
              promoted_plan_sets: promotion,
              limitation: 'Which plans are calibrated and promoted to full replay depends on database-generated ids (calibration sampling ranks by sha256(seed, plan_hash, unit)); stable within one search, not across re-imports of the same workload.',
            },
            invariant_section_sha256: sections,
            run_bound_hashes: { run_1: a.runBound, run_2: b.runBound },
            record_run_1: r,
            verify_run_2: b.record.verify,
          },
          null,
          2,
        ),
      );
    }
  });
});
