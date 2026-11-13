/**
 * Migration 022 on PGlite: usage_budget_reserve adds a positive amount only
 * within the limit (nothing is added on refusal), refunds floor at zero, the
 * window resets, concurrent reservations cannot overspend, only service_role
 * can call it, and the rollback removes it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(`../supabase/${p}`, import.meta.url), 'utf8');
let db: PGlite;
const as = (role: string, sql: string, params: unknown[] = []) =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return tx.query<Record<string, unknown>>(sql, params);
  });
const reserve = (bucket: string, amount: number, limit = 1_000_000, windowSeconds = 86_400) =>
  as('service_role', 'select public.usage_budget_reserve($1, $2, $3, $4) as ok', [bucket, amount, limit, windowSeconds]).then((r) => r.rows[0].ok);
const spent = async (bucket: string) => Number((await db.query<{ s: string }>('select spent_micro_usd::text s from public.usage_budget_counters where bucket = $1', [bucket])).rows[0]?.s ?? 0);
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return `${(e as { code?: string }).code || ''} ${(e as Error).message}`;
  }
};

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(file('migrations/022_usage_budget_counters.sql'));
}, 60_000);

describe('022 usage_budget_reserve', () => {
  it('reserves within the limit and refuses beyond it without adding anything', async () => {
    expect(await reserve('b', 600_000)).toBe(true);
    expect(await reserve('b', 300_000)).toBe(true);
    expect(await reserve('b', 200_000)).toBe(false);
    expect(await spent('b')).toBe(900_000);
  });

  it('reconciliation refunds apply and floor at zero', async () => {
    await reserve('b', 500_000);
    expect(await reserve('b', -450_000)).toBe(true);
    expect(await spent('b')).toBe(50_000);
    expect(await reserve('b', -999_999)).toBe(true);
    expect(await spent('b')).toBe(0);
  });

  it('starts a new window after it expires', async () => {
    await reserve('w', 1_000_000, 1_000_000, 60);
    expect(await reserve('w', 1, 1_000_000, 60)).toBe(false);
    await db.query(`update public.usage_budget_counters set window_start = now() - interval '61 seconds' where bucket = 'w'`);
    expect(await reserve('w', 1, 1_000_000, 60)).toBe(true);
    expect(await spent('w')).toBe(1);
  });

  it('concurrent reservations never exceed the limit', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve('c', 300_000)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await spent('c')).toBe(900_000);
  });

  it('rejects invalid arguments and is closed to anon / authenticated', async () => {
    expect(await fail(reserve('', 1))).toMatch(/22023/);
    expect(await fail(reserve('x', 1, -1))).toMatch(/22023/);
    expect(await fail(reserve('x', 1, 1, 0))).toMatch(/22023/);
    for (const role of ['anon', 'authenticated']) {
      expect(await fail(as(role, `select public.usage_budget_reserve('z', 1, 10, 60)`))).toMatch(/permission denied/);
      expect(await fail(as(role, 'select * from public.usage_budget_counters'))).toMatch(/permission denied/);
    }
  });

  it('is idempotent and the rollback removes it', async () => {
    await db.exec(file('migrations/022_usage_budget_counters.sql'));
    expect(await reserve('again', 1)).toBe(true);
    await db.exec(file('rollback/022_usage_budget_counters.rollback.sql'));
    const left = await db.query(`select 1 from pg_proc where proname = 'usage_budget_reserve' union all select 1 from pg_class where relname = 'usage_budget_counters'`);
    expect(left.rows.length).toBe(0);
  });
});
