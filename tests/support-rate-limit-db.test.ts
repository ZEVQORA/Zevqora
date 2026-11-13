/**
 * Migration 021 on a disposable Postgres (PGlite): the durable public rate
 * limiter counts hits per bucket in a fixed window, resets after the window,
 * rejects bad arguments, is callable only by service_role, and its table is
 * closed to anon/authenticated. The rollback removes both objects.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(`../supabase/${p}`, import.meta.url), 'utf8');

let db: PGlite;
const as = async (role: string, sql: string, params: unknown[] = []) =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return tx.query<Record<string, unknown>>(sql, params);
  });
const hit = (bucket: string, limit = 3, windowSeconds = 60) => as('service_role', 'select public.public_rate_limit_hit($1, $2, $3) as ok', [bucket, limit, windowSeconds]).then((r) => r.rows[0].ok);
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
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(file('migrations/021_public_support_rate_limits.sql'));
}, 60_000);

describe('021 public_rate_limit_hit', () => {
  it('allows up to the limit per bucket, then refuses; buckets are independent', async () => {
    expect([await hit('a'), await hit('a'), await hit('a'), await hit('a')]).toEqual([true, true, true, false]);
    expect(await hit('b')).toBe(true);
    const rows = (await db.query<{ bucket: string; hits: number }>('select bucket, hits from public.public_rate_limits order by bucket')).rows;
    expect(rows).toEqual([{ bucket: 'a', hits: 4 }, { bucket: 'b', hits: 1 }]);
  });

  it('starts a new window once the old one has expired', async () => {
    for (let i = 0; i < 4; i += 1) await hit('w', 3, 60);
    expect(await hit('w', 3, 60)).toBe(false);
    await db.query(`update public.public_rate_limits set window_start = now() - interval '61 seconds' where bucket = 'w'`);
    expect(await hit('w', 3, 60)).toBe(true);
    expect((await db.query<{ hits: number }>(`select hits from public.public_rate_limits where bucket = 'w'`)).rows[0].hits).toBe(1);
  });

  it('rejects invalid arguments', async () => {
    expect(await fail(hit('', 3, 60))).toMatch(/22023/);
    expect(await fail(hit('x'.repeat(129), 3, 60))).toMatch(/22023/);
    expect(await fail(hit('k', 0, 60))).toMatch(/22023/);
    expect(await fail(hit('k', 3, 0))).toMatch(/22023/);
    expect(await fail(hit('k', 3, 700_000))).toMatch(/22023/);
  });

  it('is closed to anon and authenticated (function and table)', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await fail(as(role, `select public.public_rate_limit_hit('z', 3, 60)`))).toMatch(/permission denied/);
      expect(await fail(as(role, 'select * from public.public_rate_limits'))).toMatch(/permission denied/);
      expect(await fail(as(role, `insert into public.public_rate_limits(bucket) values ('z')`))).toMatch(/permission denied/);
    }
    expect(await hit('z')).toBe(true);
  });

  it('is idempotent and the rollback removes it', async () => {
    await db.exec(file('migrations/021_public_support_rate_limits.sql'));
    expect(await hit('again')).toBe(true);
    await db.exec(file('rollback/021_public_support_rate_limits.rollback.sql'));
    const left = await db.query(`select 1 from pg_proc where proname = 'public_rate_limit_hit' union all select 1 from pg_class where relname = 'public_rate_limits'`);
    expect(left.rows.length).toBe(0);
  });
});
