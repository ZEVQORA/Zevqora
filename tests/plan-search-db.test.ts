/**
 * Migration 018 on a disposable Postgres (PGlite): server-only privileges,
 * hostile Supabase default grants revoked, the plan/decision/search rules the
 * database enforces itself, tenancy keys, the bounded v2 graph read, rollback
 * and the production dry-run wrapper.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { asUser, createDb, migration, seedWorkspace } from './helpers/pg';

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const P_A = 'a3333333-3333-4333-8333-333333333333';
const H = (c: string) => c.repeat(64);
const TABLES = ['plan_searches', 'execution_plans', 'plan_calibrations', 'plan_decisions', 'bad_day_profiles', 'bad_day_results'];
const FUNCTIONS = ['plan_search_lock', 'plan_search_unlock', 'zevir_product_graph_set_v2', 'plan_searches_guard', 'plan_decisions_guard'];
const rollback = () => readFileSync(new URL('../supabase/rollback/018_optimization_intelligence.rollback.sql', import.meta.url), 'utf8');

let db: PGlite;
const svc = (sql: string, params: unknown[] = []) => db.transaction(async (tx) => {
  await tx.exec('set local role service_role');
  return tx.query<Record<string, unknown>>(sql, params);
});
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return `${(e as { code?: string }).code || ''} ${(e as Error).message}`;
  }
};
const ids: Record<string, string> = {};

async function plan(hash: string, extra: Record<string, unknown> = {}) {
  const cols = { id: crypto.randomUUID(), workspace_id: WS_A, product_id: P_A, search_id: ids.search, run_id: ids.run, contract_id: ids.contract, contract_hash: H('c'), baseline_snapshot_id: ids.snapshot, plan_version: 'execution_plan_v1', plan_hash: hash, name: 'p', pass_instances: JSON.stringify([{ kind: 'exact_lookup' }]), status: 'CALIBRATION_READY', executable_status: 'EXECUTABLE', risk_class: 'low', implementation_complexity: 1, rollback_complexity: 1, compatibility_result: JSON.stringify({ compatible: true }), ...extra };
  const keys = Object.keys(cols);
  await svc(`insert into public.execution_plans(${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
  return cols.id as string;
}

beforeAll(async () => {
  db = await createDb();
  await seedWorkspace(db, { userId: USER_A, workspaceId: WS_A, slug: 'alpha' });
  await seedWorkspace(db, { userId: USER_B, workspaceId: WS_B, slug: 'bravo' });
  await db.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'a', 'workload://a')`, [P_A, WS_A]);
  ids.contract = (await svc(`insert into public.evaluation_contracts(workspace_id, product_id, version, status, requirements, contract_hash) values ($1, $2, 1, 'draft', '{}', $3) returning id`, [WS_A, P_A, H('c')])).rows[0].id as string;
  await svc(`select public.evaluation_contract_freeze($1, $2, $3)`, [ids.contract, USER_A, H('c')]);
  ids.run = (await svc(`insert into public.optimization_runs(workspace_id, product_id, contract_id, contract_hash) values ($1, $2, $3, $4) returning id`, [WS_A, P_A, ids.contract, H('c')])).rows[0].id as string;
  ids.snapshot = (await svc(`insert into public.performance_snapshots(workspace_id, product_id, run_id, contract_hash, version, metrics, completeness, trace_count, snapshot_hash) values ($1, $2, $3, $4, 'v', '{}', 'complete', 1, $5) returning id`, [WS_A, P_A, ids.run, H('c'), H('5')])).rows[0].id as string;
  await svc(`update public.optimization_runs set baseline_snapshot_id = $2 where id = $1`, [ids.run, ids.snapshot]);
  ids.search = (await svc(`insert into public.plan_searches(workspace_id, product_id, run_id, contract_id, contract_hash, baseline_snapshot_id, snapshot_hash, search_version, search_hash, seed, bounds, evaluation_set, evaluation_set_hash) values ($1, $2, $3, $4, $5, $6, $7, 'search_v1', $8, 'seed', '{"max_generated_plans":64}', '{"ids":[]}', $9) returning id`, [WS_A, P_A, ids.run, ids.contract, H('c'), ids.snapshot, H('5'), H('1'), H('e')])).rows[0].id as string;
}, 120_000);

describe('privileges', () => {
  it.each(TABLES)('66. browser roles can neither read nor write %s (server-only)', async (t) => {
    expect(await fail(asUser(db, USER_A, (tx) => tx.query(`select 1 from public.${t}`)))).toMatch(/^42501/);
    expect(await fail(asUser(db, null, (tx) => tx.query(`select 1 from public.${t}`)))).toMatch(/^42501/);
    expect(await fail(asUser(db, USER_A, (tx) => tx.query(`delete from public.${t}`)))).toMatch(/^42501/);
    expect(await fail(asUser(db, USER_A, (tx) => tx.query(`insert into public.${t}(id) values (gen_random_uuid())`)))).toMatch(/^42501/);
  });

  it('66. browser roles cannot call the 018 functions', async () => {
    expect(await fail(asUser(db, USER_A, (tx) => tx.query(`select public.plan_search_lock($1, gen_random_uuid(), 10)`, [ids.search])))).toMatch(/^42501/);
    expect(await fail(asUser(db, USER_A, (tx) => tx.query(`select public.zevir_product_graph_set_v2($1, $2, 10)`, [WS_A, P_A])))).toMatch(/^42501/);
  });

  it('68. hostile Supabase default grants stay revoked', async () => {
    const fresh = await createDb({ intelligence: false });
    await fresh.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;`);
    await fresh.exec(migration('018_optimization_intelligence.sql'));
    const t = await fresh.query<{ n: number }>(`select count(*)::int n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1)
      and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`, [TABLES]);
    expect(t.rows[0].n).toBe(0);
    const f = await fresh.query<{ n: number }>(`select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, [FUNCTIONS]);
    expect(f.rows[0].n).toBe(0);
  }, 60_000);
});

describe('rules the database enforces', () => {
  it('a plan that cannot execute never enters calibration, replay or the frontier', async () => {
    expect(await fail(plan(H('2'), { executable_status: 'NOT_EXECUTABLE', status: 'CALIBRATION_READY' }))).toMatch(/execution_plans_executable_stages/);
    expect(await fail(plan(H('3'), { executable_status: 'NEEDS_IMPLEMENTATION', status: 'BLOCKED' }))).toBe('ok');
  });

  it('VERIFIED (and frontier / selected) needs a VERIFIED evaluation', async () => {
    expect(await fail(plan(H('4'), { status: 'VERIFIED', verdict: 'VERIFIED' }))).toMatch(/execution_plans_verified_evidence/);
    expect(await fail(plan(H('5'), { status: 'PARETO_FRONTIER', verdict: 'REJECTED' }))).toMatch(/execution_plans_verified_evidence/);
    expect(await fail(plan(H('6'), { status: 'REJECTED', verdict: 'REJECTED', frontier_state: 'FRONTIER' }))).toMatch(/execution_plans_frontier_verified/);
  });

  it('a CONFLICTED plan must carry an incompatible result', async () => {
    expect(await fail(plan(H('7'), { status: 'CONFLICTED' }))).toMatch(/execution_plans_conflicted/);
  });

  it('a calibration row is always labelled NOT VERIFIED and has no VERIFIED outcome', async () => {
    const p = await plan(H('8'));
    const ins = (o: string, label = 'CALIBRATION — NOT VERIFIED') => svc(`insert into public.plan_calibrations(workspace_id, search_id, plan_id, round, seed, sample_ids, sample_hash, sample_size, outcome, label) values ($1, $2, $3, 1, 's', '[]', $4, 0, $5, $6)`, [WS_A, ids.search, p, H('9'), o, label]);
    expect(await fail(ins('VERIFIED'))).toMatch(/outcome_check/);
    expect(await fail(ins('PROMISING', 'VERIFIED'))).toMatch(/label_check/);
    expect(await fail(ins('PROMISING'))).toBe('ok');
  });

  it('46/50. a decision can select only a VERIFIED frontier plan of the same search; decisions are append-only', async () => {
    const rejected = await plan(H('a'), { status: 'REJECTED', verdict: 'REJECTED' });
    const d = (planId: string | null, outcome = 'SELECTED') => svc(`insert into public.plan_decisions(workspace_id, search_id, policy, frontier_hash, outcome, selected_plan_id, decision_hash) values ($1, $2, 'MARGIN_FIRST', $3, $4, $5, $6) returning id`, [WS_A, ids.search, H('f'), outcome, planId, crypto.randomUUID().replace(/-/g, '').padEnd(64, '0')]);
    expect(await fail(d(rejected))).toMatch(/DECISION_NOT_ON_FRONTIER/);
    expect(await fail(d(null, 'NO_ELIGIBLE_PLAN'))).toBe('ok');
    expect(await fail(d(null, 'SELECTED'))).toMatch(/plan_decisions_outcome/);
    expect(await fail(svc(`update public.plan_decisions set policy = 'LATENCY_FIRST'`))).toMatch(/DECISION_IMMUTABLE/);
  });

  it('72. a cancelled search stays cancelled; a search keeps its contract, baseline, bounds and seed', async () => {
    expect(await fail(svc(`update public.plan_searches set bounds = '{"max_generated_plans":96}' where id = $1`, [ids.search]))).toMatch(/SEARCH_IMMUTABLE/);
    expect(await fail(svc(`update public.plan_searches set status = 'cancelled' where id = $1`, [ids.search]))).toMatch(/plan_searches_cancel_stamp/);
    await svc(`update public.plan_searches set status = 'cancelled', cancelled_at = now() where id = $1`, [ids.search]);
    expect(await fail(svc(`update public.plan_searches set status = 'calibrating' where id = $1`, [ids.search]))).toMatch(/SEARCH_TERMINAL/);
    await svc(`update public.plan_searches set status = 'cancelled' where id = $1`, [ids.search]); // no-op stays allowed
  });

  it('a search must use its run’s frozen contract and baseline', async () => {
    const other = (await svc(`insert into public.evaluation_contracts(workspace_id, product_id, version, status, requirements, contract_hash) values ($1, $2, 2, 'draft', '{}', $3) returning id`, [WS_A, P_A, H('9')])).rows[0].id;
    const ins = (contract: unknown, hash: string, snapshot: unknown) => svc(`insert into public.plan_searches(workspace_id, product_id, run_id, contract_id, contract_hash, baseline_snapshot_id, snapshot_hash, search_version, search_hash, seed, bounds, evaluation_set, evaluation_set_hash) values ($1, $2, $3, $4, $5, $6, $7, 'v', $8, 's', '{}', '{}', $9)`, [WS_A, P_A, ids.run, contract, hash, snapshot, H('5'), H('2'), H('e')]);
    expect(await fail(ins(other, H('9'), ids.snapshot))).toMatch(/SEARCH_CONTRACT_MISMATCH/);
    expect(await fail(ins(ids.contract, H('c'), ids.snapshot))).toBe('ok');
  });

  it('the stage lease is exclusive until it expires or is released', async () => {
    const t1 = crypto.randomUUID();
    const t2 = crypto.randomUUID();
    const lock = async (t: string) => (await svc(`select public.plan_search_lock($1, $2, 60) as ok`, [ids.search, t])).rows[0].ok;
    expect(await lock(t1)).toBe(true);
    expect(await lock(t2)).toBe(false);
    await svc(`select public.plan_search_unlock($1, $2)`, [ids.search, t1]);
    expect(await lock(t2)).toBe(true);
    expect(await fail(svc(`select public.plan_search_lock($1, $2, 5000)`, [ids.search, t1]))).toMatch(/SEARCH_LOCK_TTL/);
  });
});

describe('tenancy', () => {
  it('a plan cannot point into another workspace’s search, and a profile into another workspace’s product', async () => {
    expect(await fail(plan(H('b'), { workspace_id: WS_B }))).toMatch(/execution_plans_search_fk/);
    expect(await fail(svc(`insert into public.bad_day_profiles(workspace_id, product_id, version, scenario, parameters, seed, profile_hash) values ($1, $2, 'v', 'CACHE_MISS', '{}', 's', $3)`, [WS_B, P_A, H('d')]))).toMatch(/bad_day_profiles_product_fk/);
  });

  it('the v2 graph read is bounded', async () => {
    expect(await fail(svc(`select public.zevir_product_graph_set_v2($1, $2, 501)`, [WS_A, P_A]))).toMatch(/ZEVIR_GRAPH_LIMIT/);
    expect((await svc(`select public.zevir_product_graph_set_v2($1, $2, 5) as s`, [WS_A, P_A])).rows[0].s).toMatchObject({ total: 0, truncated: false, graphs: [] });
  });
});

describe('rollback and dry run', () => {
  it('018 rolls back cleanly (then 017 can roll back), keeps engine rows, and re-applies', async () => {
    const fresh = await createDb();
    await fresh.query(`insert into auth.users(id) values ($1)`, [USER_A]);
    await fresh.query(`insert into public.workspaces(id, name, slug, owner_id) values ($1, 'w', 'w', $2)`, [WS_A, USER_A]);
    await fresh.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'p', 'workload://p')`, [P_A, WS_A]);
    await fresh.query(`insert into public.engine_plans(product_id, workspace_id, strategy, status) values ($1, $2, 'exact_reuse', 'READY'), ($1, $2, 'execution_plan', 'READY')`, [P_A, WS_A]);
    await fresh.exec(rollback());
    const t = await fresh.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = any($1)`, [TABLES]);
    expect(t.rows[0].n).toBe(0);
    expect((await fresh.query<{ s: string }>('select strategy s from public.engine_plans')).rows).toEqual([{ s: 'exact_reuse' }]);
    expect((await fresh.query(`select 1 from information_schema.columns where table_name = 'engine_executions' and column_name in ('execution_plan_id', 'stage')`)).rows).toEqual([]);
    expect((await fresh.query<{ n: number }>(`select count(*)::int n from public.feature_flags where key = 'optimization_intelligence_vnext'`)).rows[0].n).toBe(0);
    expect(await fail(fresh.query(`insert into public.optimization_diagnoses(id, workspace_id, product_id, run_id, snapshot_id, family, version, scope, symptom, root_cause, evidence_refs, confidence, severity, falsifier, risk_class, diagnosis_hash) values (gen_random_uuid(), $1, $2, gen_random_uuid(), gen_random_uuid(), 'agent_workflow', 'v', 's', 's', 'r', '[{}]', 0.5, 'low', 'f', 'low', $3)`, [WS_A, P_A, H('a')]))).toMatch(/family_check/);
    await fresh.exec(readFileSync(new URL('../supabase/rollback/017_verified_optimization.rollback.sql', import.meta.url), 'utf8'));
    await fresh.exec(migration('017_verified_optimization.sql'));
    await fresh.exec(migration('018_optimization_intelligence.sql'));
    expect((await fresh.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = any($1)`, [TABLES])).rows[0].n).toBe(6);
  }, 90_000);

  it('passes the production dry-run wrapper and leaves nothing behind', async () => {
    const fresh = await createDb({ intelligence: false });
    const wrapped = `do $dry$\nbegin\n${migration('018_optimization_intelligence.sql')}\nraise exception 'OPT18_DRY_RUN_OK';\nend\n$dry$;`;
    await expect(fresh.exec(wrapped)).rejects.toThrow('OPT18_DRY_RUN_OK');
    expect((await fresh.query<{ t: string | null }>(`select to_regclass('public.execution_plans')::text t`)).rows[0].t).toBeNull();
  }, 60_000);
});
