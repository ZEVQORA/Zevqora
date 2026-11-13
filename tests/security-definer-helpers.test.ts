/**
 * The Supabase advisor flags three SECURITY DEFINER functions as callable by
 * `authenticated` through /rest/v1/rpc: is_workspace_member, has_workspace_role
 * and shares_workspace_with. RLS policies need them, so the grant stays; what
 * must hold is that a signed-in caller can only ask about itself and that
 * `anon` (where auth.uid() is null and any uid would be answered) cannot call
 * them at all.
 *
 * The helpers are created from 004 and then hardened by 011, both verbatim.
 * The same assertions were run read-only (always rolled back) against the
 * staging project; see docs/handoff/12-STAGING-E2E-SECURITY-RESULTS.md.
 */
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { migration } from './helpers/pg';

const ALICE = 'a0000000-0000-4000-8000-0000000000a1';
const BOB = 'b0000000-0000-4000-8000-0000000000b2';
const WS_A = 'a1111111-1111-4111-8111-1111111111a1';
const WS_B = 'b2222222-2222-4222-8222-2222222222b2';

const PLATFORM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create table public.workspaces (id uuid primary key, owner_id uuid not null references auth.users(id));
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role public.workspace_role not null,
  primary key (workspace_id, user_id)
);
-- Signatures 011 revokes, with 004's grants (no PUBLIC execute); their bodies are irrelevant here.
create function public.create_workspace(p_name text, p_slug text) returns void language sql as $$ select $$;
create function public.is_admin(uid uuid) returns boolean language sql as $$ select false $$;
create function public.project_workspace(pid uuid) returns uuid language sql as $$ select null::uuid $$;
create function public.workspace_plan(ws uuid) returns text language sql as $$ select 'free' $$;
revoke all on function public.create_workspace(text, text), public.is_admin(uuid), public.project_workspace(uuid), public.workspace_plan(uuid) from public, anon;
grant execute on function public.create_workspace(text, text), public.is_admin(uuid), public.project_workspace(uuid), public.workspace_plan(uuid) to authenticated, service_role;
`;

/** 004's role-helper block, verbatim, from "-- Role helpers" up to workspace creation. */
function roleHelpersFrom004() {
  const sql = migration('004_platform.sql');
  const start = sql.indexOf('-- Role helpers');
  const end = sql.indexOf('-- Workspace creation always runs');
  if (start < 0 || end < 0) throw new Error('004 role-helper block not found');
  return sql.slice(start, end);
}

let db: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'service_role', sub: string | null, sql: string, params: unknown[] = []): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
    await tx.exec(`set local role ${role}`);
    const r = await tx.query<{ v: T }>(sql, params);
    return r.rows[0].v;
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(roleHelpersFrom004());
  await db.exec(migration('011_harden_security_definer_rpc_surface.sql'));
  await db.query('insert into auth.users(id) values ($1), ($2)', [ALICE, BOB]);
  await db.query('insert into public.workspaces(id, owner_id) values ($1, $2), ($3, $4)', [WS_A, ALICE, WS_B, BOB]);
  await db.query(`insert into public.workspace_members values ($1, $2, 'owner'), ($3, $4, 'owner')`, [WS_A, ALICE, WS_B, BOB]);
}, 60_000);

describe('SECURITY DEFINER RLS helpers (advisor 0029)', () => {
  it('a signed-in user gets false when asking about another user, even for that user’s own workspace', async () => {
    expect(await as('authenticated', ALICE, 'select public.is_workspace_member($1, $2) v', [WS_B, BOB])).toBe(false);
    expect(await as('authenticated', ALICE, `select public.has_workspace_role($1, 'viewer', $2) v`, [WS_B, BOB])).toBe(false);
    expect(await as('authenticated', ALICE, `select public.has_workspace_role($1, 'owner', $2) v`, [WS_B, BOB])).toBe(false);
    expect(await as('authenticated', ALICE, 'select public.shares_workspace_with($1, $2) v', [ALICE, BOB])).toBe(false);
  });

  it('a signed-in user gets a correct answer about itself (the RLS use still works)', async () => {
    expect(await as('authenticated', ALICE, 'select public.is_workspace_member($1) v', [WS_A])).toBe(true);
    expect(await as('authenticated', ALICE, 'select public.is_workspace_member($1) v', [WS_B])).toBe(false);
    expect(await as('authenticated', ALICE, `select public.has_workspace_role($1, 'owner') v`, [WS_A])).toBe(true);
    expect(await as('authenticated', ALICE, `select public.has_workspace_role($1, 'viewer') v`, [WS_B])).toBe(false);
  });

  it('anon cannot execute any of the three helpers (auth.uid() is null there, so the identity check would not apply)', async () => {
    for (const sql of [`select public.is_workspace_member('${WS_B}', '${BOB}') v`, `select public.has_workspace_role('${WS_B}', 'viewer', '${BOB}') v`, `select public.shares_workspace_with('${ALICE}', '${BOB}') v`]) {
      await expect(as('anon', null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('the raw role lookup and the other definer functions are not callable by signed-in users', async () => {
    await expect(as('authenticated', ALICE, `select public.workspace_role_of('${WS_B}', '${BOB}')::text v`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', ALICE, `select public.is_admin('${BOB}') v`)).rejects.toThrow(/permission denied/);
  });

  it('service_role (no end-user identity) keeps administrative answers', async () => {
    expect(await as('service_role', null, 'select public.is_workspace_member($1, $2) v', [WS_B, BOB])).toBe(true);
  });

  it('catalog: definer, pinned search_path, and no PUBLIC/anon execute', async () => {
    const rows = (
      await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; anon: boolean; pub: boolean }>(
        `select p.proname, p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'execute') anon,
                coalesce(exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) pub
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('is_workspace_member', 'has_workspace_role', 'shares_workspace_with')
          order by 1`,
      )
    ).rows;
    expect(rows.map((r) => r.proname)).toEqual(['has_workspace_role', 'is_workspace_member', 'shares_workspace_with']);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig, r.proname).toEqual(['search_path=public']);
      expect(r.anon, r.proname).toBe(false);
      expect(r.pub, r.proname).toBe(false);
    }
  });
});
