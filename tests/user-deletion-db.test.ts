/**
 * Migration 020 on a disposable Postgres (PGlite): a user who froze a contract,
 * started a run or made a decision can still be deleted (the `on delete set
 * null` references are cleared and the evidence stays), a workspace owner's
 * deletion removes the workspace, a direct edit of the same columns is still
 * refused, and the rollback restores the 017/018 guards. Found on staging,
 * where deleting such a test user through the Supabase admin API failed.
 */
import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createDb, seedWorkspace } from './helpers/pg';

const OWNER = 'a0000000-0000-4000-8000-00000000000a';
const MEMBER = 'c0000000-0000-4000-8000-00000000000c';
const WS = 'a1111111-1111-4111-8111-111111111111';
const P = 'a3333333-3333-4333-8333-333333333333';
const H = (c: string) => c.repeat(64);
const rollback = () => readFileSync(new URL('../supabase/rollback/020_user_deletion_guards.rollback.sql', import.meta.url), 'utf8');

const svc = (db: PGlite, sql: string, params: unknown[] = []) => db.transaction(async (tx) => {
  await tx.exec('set local role service_role');
  return tx.query<Record<string, unknown>>(sql, params);
});
// The Supabase Auth service deletes users as a privileged role, not service_role.
const removeUser = (db: PGlite, sql: string, params: unknown[]) => db.query(sql, params);
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return `${(e as { code?: string }).code || ''} ${(e as Error).message}`;
  }
};
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await svc(db, `select count(*)::int n from ${sql}`, params)).rows[0].n;

/** A workspace where MEMBER froze v1, froze v2 (v1 superseded), started a run and a search, and recorded a decision. */
async function seed(options: { userDeletion?: boolean; actor?: string } = {}) {
  const { actor = MEMBER, ...dbOptions } = options;
  const db = await createDb(dbOptions);
  await seedWorkspace(db, { userId: OWNER, workspaceId: WS, role: 'owner', slug: 'alpha' });
  await db.query(`insert into auth.users(id, email) values ($1, 'member@example.invalid')`, [MEMBER]);
  await db.query(`insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, 'admin')`, [WS, MEMBER]);
  await db.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'a', 'workload://a')`, [P, WS]);
  const contract = async (version: number, hash: string) => {
    const id = (await svc(db, `insert into public.evaluation_contracts(workspace_id, product_id, version, status, requirements, contract_hash, created_by) values ($1, $2, $3, 'draft', '{}', $4, $5) returning id`, [WS, P, version, hash, actor])).rows[0].id as string;
    await svc(db, `select public.evaluation_contract_freeze($1, $2, $3)`, [id, actor, hash]);
    return id;
  };
  const v1 = await contract(1, H('1'));
  const v2 = await contract(2, H('2'));
  const run = (await svc(db, `insert into public.optimization_runs(workspace_id, product_id, contract_id, contract_hash, created_by) values ($1, $2, $3, $4, $5) returning id`, [WS, P, v2, H('2'), actor])).rows[0].id as string;
  const snapshot = (await svc(db, `insert into public.performance_snapshots(workspace_id, product_id, run_id, contract_hash, version, metrics, completeness, trace_count, snapshot_hash) values ($1, $2, $3, $4, 'v', '{}', 'complete', 1, $5) returning id`, [WS, P, run, H('2'), H('5')])).rows[0].id as string;
  await svc(db, `update public.optimization_runs set baseline_snapshot_id = $2 where id = $1`, [run, snapshot]);
  const search = (await svc(db, `insert into public.plan_searches(workspace_id, product_id, run_id, contract_id, contract_hash, baseline_snapshot_id, snapshot_hash, search_version, search_hash, seed, bounds, evaluation_set, evaluation_set_hash, created_by) values ($1, $2, $3, $4, $5, $6, $7, 'search_v1', $8, 'seed', '{"max_generated_plans":64}', '{"ids":[]}', $9, $10) returning id`, [WS, P, run, v2, H('2'), snapshot, H('5'), H('6'), H('e'), actor])).rows[0].id as string;
  // A VERIFIED plan with its evidence chain: engine plan → execution → evaluation.
  const enginePlan = (await svc(db, `insert into public.engine_plans(product_id, workspace_id, strategy, status) values ($1, $2, 'exact_reuse', 'READY') returning id`, [P, WS])).rows[0].id as string;
  const execution = (await svc(db, `insert into public.engine_executions(candidate_plan_id, product_id, workspace_id, status, execution_key) values ($1, $2, $3, 'completed', 'k') returning id`, [enginePlan, P, WS])).rows[0].id as string;
  const evaluation = (await svc(db, `insert into public.engine_evaluations(product_id, workspace_id, candidate_execution_id, status) values ($1, $2, $3, 'completed') returning id`, [P, WS, execution])).rows[0].id as string;
  const plan = { id: crypto.randomUUID(), workspace_id: WS, product_id: P, search_id: search, run_id: run, contract_id: v2, contract_hash: H('2'), baseline_snapshot_id: snapshot, plan_version: 'execution_plan_v1', plan_hash: H('7'), name: 'p', pass_instances: JSON.stringify([{ kind: 'exact_lookup' }]), status: 'VERIFIED', verdict: 'VERIFIED', evaluation_id: evaluation, engine_plan_id: enginePlan, executable_status: 'EXECUTABLE', risk_class: 'low', implementation_complexity: 1, rollback_complexity: 1, compatibility_result: JSON.stringify({ compatible: true }) };
  await svc(db, `insert into public.execution_plans(${Object.keys(plan).join(',')}) values (${Object.keys(plan).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(plan));
  const decision = (await svc(db, `insert into public.plan_decisions(workspace_id, search_id, policy, frontier_hash, outcome, decision_hash, created_by) values ($1, $2, 'MARGIN_FIRST', $3, 'NO_ELIGIBLE_PLAN', $4, $5) returning id`, [WS, search, H('f'), H('d'), actor])).rows[0].id as string;
  return { db, v1, v2, run, search, decision, plan: plan.id };
}

describe('020: deleting a user who left optimization evidence', () => {
  it('fails on the 017/018 guards (the staging defect)', async () => {
    const { db } = await seed({ userDeletion: false });
    expect(await fail(removeUser(db, `delete from auth.users where id = $1`, [MEMBER]))).toMatch(/CONTRACT_IMMUTABLE|DECISION_IMMUTABLE|execution_plans_verified_evidence/);
  }, 60_000);

  it('a member is deleted; the evidence stays, unchanged except the cleared references', async () => {
    const { db, v1, v2, run, decision } = await seed();
    const before = (await svc(db, `select id, status, contract_hash, requirements, frozen_at from public.evaluation_contracts order by version`)).rows;
    expect(await fail(removeUser(db, `delete from auth.users where id = $1`, [MEMBER]))).toBe('ok');
    const after = await svc(db, `select id, status, contract_hash, requirements, frozen_at, created_by, frozen_by from public.evaluation_contracts order by version`);
    expect(after.rows.map(({ created_by: _c, frozen_by: _f, ...rest }) => rest)).toEqual(before);
    expect(after.rows.map((r) => [r.id, r.status, r.created_by, r.frozen_by])).toEqual([[v1, 'superseded', null, null], [v2, 'frozen', null, null]]);
    expect((await svc(db, `select created_by, contract_id from public.optimization_runs where id = $1`, [run])).rows[0]).toEqual({ created_by: null, contract_id: v2 });
    expect((await svc(db, `select created_by, outcome from public.plan_decisions where id = $1`, [decision])).rows[0]).toEqual({ created_by: null, outcome: 'NO_ELIGIBLE_PLAN' });
    expect(await count(db, `public.workspaces where id = $1`, [WS])).toBe(1);
  }, 60_000);

  it.each([['someone else', MEMBER], ['the owner themself', OWNER]])('the owner is deleted after %s froze, ran, cancelled and decided; the workspace and everything under it go', async (_label, actor) => {
    const { db, search } = await seed({ actor });
    await svc(db, `update public.plan_searches set status = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1`, [search, actor]);
    expect(await fail(removeUser(db, `delete from auth.users where id = $1`, [OWNER]))).toBe('ok');
    for (const t of ['workspaces', 'evaluation_contracts', 'optimization_runs', 'plan_searches', 'execution_plans', 'engine_evaluations', 'plan_decisions']) expect(await count(db, `public.${t}`), t).toBe(0);
  }, 60_000);

  it('a product with a VERIFIED plan can be deleted; the plan goes with its evidence (it failed on 018)', async () => {
    const before = await seed({ userDeletion: false });
    expect(await fail(svc(before.db, `delete from public.engine_products where id = $1`, [P]))).toMatch(/execution_plans_verified_evidence/);
    const { db, plan } = await seed();
    expect(await fail(svc(db, `delete from public.engine_products where id = $1`, [P]))).toBe('ok');
    expect(await count(db, `public.execution_plans where id = $1`, [plan])).toBe(0);
    expect(await count(db, `public.workspaces where id = $1`, [WS])).toBe(1);
  }, 60_000);

  it('a direct edit of the same columns is still refused', async () => {
    const { db, v1, v2, run, decision } = await seed();
    expect(await fail(svc(db, `update public.evaluation_contracts set frozen_by = null where id = $1`, [v2]))).toMatch(/CONTRACT_IMMUTABLE/);
    expect(await fail(svc(db, `update public.evaluation_contracts set created_by = null where id = $1`, [v1]))).toMatch(/CONTRACT_IMMUTABLE/);
    expect(await fail(svc(db, `update public.plan_decisions set created_by = null where id = $1`, [decision]))).toMatch(/DECISION_IMMUTABLE/);
    expect(await fail(svc(db, `update public.optimization_runs set contract_id = $2, contract_hash = $3 where id = $1`, [run, v1, H('1')]))).toMatch(/RUN_CONTRACT_IMMUTABLE/);
    expect(await fail(svc(db, `update public.optimization_runs set status = 'evaluated' where id = $1`, [run]))).toBe('ok');
  }, 60_000);

  it('the rollback restores the 017/018 guards', async () => {
    const { db } = await seed();
    await db.exec(rollback());
    expect(await fail(removeUser(db, `delete from auth.users where id = $1`, [MEMBER]))).toMatch(/CONTRACT_IMMUTABLE|DECISION_IMMUTABLE|execution_plans_verified_evidence/);
  }, 60_000);
});
