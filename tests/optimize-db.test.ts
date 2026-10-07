/**
 * Migration 017 on a disposable Postgres (PGlite): server-only privileges,
 * hostile Supabase default grants revoked, contract immutability and run
 * binding enforced by the database itself, tenancy foreign keys, the
 * not-executable-is-blocked rule, the bounded graph-set read, and rollback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asUser, createDb, migration, seedWorkspace } from './helpers/pg';

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const P_A = 'a3333333-3333-4333-8333-333333333333';
const P_B = 'b4444444-4444-4444-8444-444444444444';
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);
const TABLES = ['evaluation_contracts', 'optimization_runs', 'performance_snapshots', 'optimization_diagnoses'];

let db: PGlite;
const svc = (sql: string, params: unknown[] = []) => db.transaction(async (tx) => {
  await tx.exec('set local role service_role');
  return tx.query<Record<string, unknown>>(sql, params);
});
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code || (e as Error).message;
  }
};
const message = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as Error).message;
  }
};

async function contract(product: string, ws: string, version: number, status = 'draft', hash = HASH) {
  const r = await svc(`insert into public.evaluation_contracts(workspace_id, product_id, version, status, requirements, contract_hash, frozen_at) values ($1, $2, $3, 'draft', '{"quality_floor":0.95}', $4, null) returning id`, [ws, product, version, hash]);
  const id = r.rows[0].id as string;
  if (status === 'frozen') await svc(`select public.evaluation_contract_freeze($1, $2, $3)`, [id, USER_A, hash]);
  return id;
}

beforeAll(async () => {
  db = await createDb();
  await seedWorkspace(db, { userId: USER_A, workspaceId: WS_A, slug: 'alpha' });
  await seedWorkspace(db, { userId: USER_B, workspaceId: WS_B, slug: 'bravo' });
  await db.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'a', 'workload://a'), ($3, $4, 'b', 'workload://b')`, [P_A, WS_A, P_B, WS_B]);
}, 120_000);

describe('privileges', () => {
  it.each(TABLES)('browser roles can neither read nor write %s (server-only)', async (t) => {
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`select 1 from public.${t}`)))).toBe('42501');
    expect(await code(asUser(db, null, (tx) => tx.query(`select 1 from public.${t}`)))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`delete from public.${t}`)))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`insert into public.${t}(id) values (gen_random_uuid())`)))).toBe('42501');
  });

  it('browser roles cannot call the 017 functions', async () => {
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`select public.zevir_product_graph_set($1, $2, 10)`, [WS_A, P_A])))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`select public.evaluation_contract_freeze(gen_random_uuid(), $1, $2)`, [USER_A, HASH])))).toBe('42501');
  });

  it('39. hostile Supabase default grants stay revoked', async () => {
    const fresh = await createDb({ optimize: false });
    await fresh.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;`);
    await fresh.exec(migration('017_verified_optimization.sql'));
    const r = await fresh.query<{ n: number }>(`select count(*)::int n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1)
      and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`, [TABLES]);
    expect(r.rows[0].n).toBe(0);
    const f = await fresh.query<{ n: number }>(`select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('zevir_product_graph_set', 'evaluation_contract_freeze', 'evaluation_contracts_guard', 'optimization_runs_bind_contract')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    expect(f.rows[0].n).toBe(0);
  }, 60_000);
});

describe('Evaluation Contract in the database', () => {
  it('a draft changes; a frozen contract never does', async () => {
    const id = await contract(P_A, WS_A, 1);
    expect(await code(svc(`update public.evaluation_contracts set requirements = '{"quality_floor":0.9}', contract_hash = $2 where id = $1`, [id, HASH2]))).toBe('ok');
    await svc(`update public.evaluation_contracts set contract_hash = $2 where id = $1`, [id, HASH]);
    await svc(`select public.evaluation_contract_freeze($1, $2, $3)`, [id, USER_A, HASH]);
    expect(await message(svc(`update public.evaluation_contracts set requirements = '{"quality_floor":0.5}' where id = $1`, [id]))).toMatch(/CONTRACT_IMMUTABLE/);
    expect(await message(svc(`update public.evaluation_contracts set contract_hash = $2 where id = $1`, [id, HASH2]))).toMatch(/CONTRACT_IMMUTABLE/);
    expect(await message(svc(`update public.evaluation_contracts set status = 'draft' where id = $1`, [id]))).toMatch(/CONTRACT_IMMUTABLE/);
    expect(await message(svc(`delete from public.evaluation_contracts where id = $1`, [id]))).toMatch(/CONTRACT_IMMUTABLE/);
    expect(await message(svc(`update public.evaluation_contracts set status = 'superseded', requirements = '{"quality_floor":0.5}' where id = $1`, [id]))).toMatch(/CONTRACT_IMMUTABLE/);
  });

  it('3. a new frozen version supersedes the old one atomically; one draft and one frozen per product', async () => {
    const v1 = (await svc(`select id from public.evaluation_contracts where product_id = $1 and status = 'frozen'`, [P_A])).rows[0].id as string;
    const v2 = await contract(P_A, WS_A, 2, 'draft', HASH2);
    expect(await code(contract(P_A, WS_A, 3))).toBe('23505');
    expect(await message(svc(`select public.evaluation_contract_freeze($1, $2, $3)`, [v2, USER_A, HASH]))).toMatch(/CONTRACT_HASH_MISMATCH/);
    await svc(`select public.evaluation_contract_freeze($1, $2, $3)`, [v2, USER_A, HASH2]);
    const rows = await svc(`select id, status, superseded_by from public.evaluation_contracts where product_id = $1 order by version`, [P_A]);
    expect(rows.rows).toEqual([{ id: v1, status: 'superseded', superseded_by: v2 }, { id: v2, status: 'frozen', superseded_by: null }]);
  });

  it('5. a run binds a frozen contract of its product by hash, and keeps it', async () => {
    const frozen = (await svc(`select id, contract_hash from public.evaluation_contracts where product_id = $1 and status = 'frozen'`, [P_A])).rows[0];
    const draft = await contract(P_A, WS_A, 3, 'draft', HASH);
    expect(await message(svc(`insert into public.optimization_runs(workspace_id, product_id, contract_id, contract_hash) values ($1, $2, $3, $4)`, [WS_A, P_A, draft, HASH]))).toMatch(/RUN_CONTRACT_NOT_FROZEN/);
    expect(await message(svc(`insert into public.optimization_runs(workspace_id, product_id, contract_id, contract_hash) values ($1, $2, $3, $4)`, [WS_A, P_A, frozen.id, HASH]))).toMatch(/RUN_CONTRACT_HASH/);
    const run = (await svc(`insert into public.optimization_runs(workspace_id, product_id, contract_id, contract_hash) values ($1, $2, $3, $4) returning id`, [WS_A, P_A, frozen.id, frozen.contract_hash])).rows[0].id;
    expect(await message(svc(`update public.optimization_runs set contract_id = $2, contract_hash = $3 where id = $1`, [run, draft, HASH]))).toMatch(/RUN_CONTRACT/);
  });
});

describe('tenancy', () => {
  it('36. cross-workspace rows are impossible by foreign key', async () => {
    expect(await code(contract(P_B, WS_A, 1))).toBe('23503');
    const run = (await svc(`select id from public.optimization_runs where workspace_id = $1 limit 1`, [WS_A])).rows[0].id;
    const snap = (await svc(`insert into public.performance_snapshots(workspace_id, product_id, run_id, contract_hash, version, metrics, completeness, trace_count, snapshot_hash) values ($1, $2, $3, $4, 'perf_v0.1', '{}', 'complete', 0, $4) returning id`, [WS_A, P_A, run, HASH2])).rows[0].id;
    const diag = (ws: string) => svc(`insert into public.optimization_diagnoses(id, workspace_id, product_id, run_id, snapshot_id, family, version, scope, symptom, root_cause, evidence_refs, confidence, severity, falsifier, risk_class, diagnosis_hash) values (gen_random_uuid(), $1, $2, $3, $4, 'redundant_call', 'diag_v0.1', 's', 's', 'r', '[{"type":"engine_trace"}]', 0.9, 'low', 'f', 'low', $5)`, [ws, P_A, run, snap, HASH]);
    expect(await code(diag(WS_B))).toBe('23503');
    expect(await code(diag(WS_A))).toBe('ok');
    expect(await code(svc(`insert into public.optimization_diagnoses(id, workspace_id, product_id, run_id, snapshot_id, family, version, scope, symptom, root_cause, evidence_refs, confidence, severity, falsifier, risk_class, diagnosis_hash) values (gen_random_uuid(), $1, $2, $3, $4, 'redundant_call', 'diag_v0.1', 's', 's', 'r', '[]', 0.9, 'low', 'f', 'low', $5)`, [WS_A, P_A, run, snap, HASH2]))).toBe('23514');
  });

  it('a candidate that is not executable can never be READY', async () => {
    const plan = (status: string, exec: string) => svc(`insert into public.engine_plans(product_id, workspace_id, strategy, status, executable_status) values ($1, $2, 'retry_policy', $3, $4)`, [P_A, WS_A, status, exec]);
    expect(await code(plan('READY', 'NEEDS_IMPLEMENTATION'))).toBe('23514');
    expect(await code(plan('READY', 'NOT_EXECUTABLE'))).toBe('23514');
    expect(await code(plan('BLOCKED', 'NEEDS_IMPLEMENTATION'))).toBe('ok');
    expect(await code(svc(`insert into public.engine_plans(product_id, workspace_id, strategy, status) values ($1, $2, 'exact_reuse', 'READY')`, [P_A, WS_A]))).toBe('ok');
  });

  it('a product (and its frozen contracts) can still be deleted with its workspace', async () => {
    await db.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ('c5555555-5555-4555-8555-555555555555', $1, 'gone', 'workload://gone')`, [WS_B]);
    await contract('c5555555-5555-4555-8555-555555555555', WS_B, 1, 'frozen');
    expect(await code(svc(`delete from public.engine_products where id = 'c5555555-5555-4555-8555-555555555555'`))).toBe('ok');
    expect((await svc(`select count(*)::int n from public.evaluation_contracts where product_id = 'c5555555-5555-4555-8555-555555555555'`)).rows[0].n).toBe(0);
  });
});

describe('bounded ZevIR read', () => {
  it('refuses an unbounded request and reports totals', async () => {
    expect(await message(svc(`select public.zevir_product_graph_set($1, $2, 501)`, [WS_A, P_A]))).toMatch(/ZEVIR_GRAPH_LIMIT/);
    const r = await svc(`select public.zevir_product_graph_set($1, $2, 5) as s`, [WS_A, P_A]);
    expect(r.rows[0].s).toMatchObject({ total: 0, truncated: false, graphs: [] });
  });
});

describe('rollback', () => {
  it('removes everything 017 added and leaves 016 and existing engine rows intact', async () => {
    // A database at 017 (018 is rolled back first in production; see 018's own rollback test).
    const fresh = await createDb({ intelligence: false });
    await fresh.query(`insert into auth.users(id) values ($1)`, [USER_A]);
    await fresh.query(`insert into public.workspaces(id, name, slug, owner_id) values ($1, 'w', 'w', $2)`, [WS_A, USER_A]);
    await fresh.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'p', 'workload://p')`, [P_A, WS_A]);
    await fresh.query(`insert into public.engine_plans(product_id, workspace_id, strategy, status, executable_status, optimization_pass) values ($1, $2, 'exact_reuse', 'READY', 'EXECUTABLE', 'redundant_call')`, [P_A, WS_A]);
    await fresh.exec(readFileSync(join(__dirname, '..', 'supabase', 'rollback', '017_verified_optimization.rollback.sql'), 'utf8'));
    const tables = await fresh.query<{ t: string }>(`select table_name t from information_schema.tables where table_schema = 'public' and (table_name = any($1) or table_name like 'zevir_%') order by 1`, [TABLES]);
    expect(tables.rows.map((r) => r.t)).toEqual(['zevir_edges', 'zevir_evidence_refs', 'zevir_graphs', 'zevir_ingest_runs', 'zevir_nodes']);
    const cols = await fresh.query<{ c: string }>(`select column_name c from information_schema.columns where table_name = 'engine_plans' and column_name in ('run_id', 'executable_status', 'lineage')`);
    expect(cols.rows).toEqual([]);
    const plans = await fresh.query<{ strategy: string; status: string }>('select strategy, status from public.engine_plans');
    expect(plans.rows).toEqual([{ strategy: 'exact_reuse', status: 'READY' }]);
    expect((await fresh.query<{ n: number }>(`select count(*)::int n from public.feature_flags where key = 'verified_optimization_vnext'`)).rows[0].n).toBe(0);
    // And it can be applied again afterwards.
    await fresh.exec(migration('017_verified_optimization.sql'));
    expect((await fresh.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_name = any($1)`, [TABLES])).rows[0].n).toBe(4);
  }, 60_000);

  it('passes the production dry-run wrapper and leaves nothing behind', async () => {
    const fresh = await createDb({ optimize: false });
    const wrapped = `do $dry$\nbegin\n${migration('017_verified_optimization.sql')}\nraise exception 'OPT_DRY_RUN_OK';\nend\n$dry$;`;
    await expect(fresh.exec(wrapped)).rejects.toThrow('OPT_DRY_RUN_OK');
    expect((await fresh.query<{ t: string | null }>(`select to_regclass('public.evaluation_contracts')::text t`)).rows[0].t).toBeNull();
  }, 60_000);
});
