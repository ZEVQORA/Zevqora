/**
 * Disposable Postgres for database tests: PGlite (Postgres 17 in WASM) with
 * just enough of the Supabase platform to run the real engine and ZevIR
 * migrations verbatim — the anon / authenticated / service_role roles, an
 * `auth` schema whose uid() reads the JWT claims, and the workspace tables and
 * membership function the policies depend on (copied from 004 / 011).
 *
 * `restClient` is a small stand-in for the supabase-js query builder that runs
 * every statement as service_role, so route tests exercise real constraints,
 * grants and SQL functions instead of an in-memory fake.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
export const migration = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');

const PLATFORM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_override text,
  created_at timestamptz not null default now()
);
-- Billing lookups used by resolveBilling (platform-compute.js), as in 004.
create table public.plans (id text primary key, name text not null, limits jsonb not null default '{}'::jsonb, features jsonb not null default '[]'::jsonb, is_default boolean not null default false);
insert into public.plans (id, name, limits, is_default) values ('free', 'Free', '{"credits_usd": 5}', true);
create function public.workspace_plan(ws uuid) returns text language sql stable as $$ select coalesce((select plan_override from public.workspaces where id = ws), 'free') $$;
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null
);
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  description text not null default '',
  enabled boolean not null default false,
  plan_overrides jsonb not null default '{}'::jsonb,
  workspace_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.model_pricing (
  model text primary key, provider text not null, input_per_million numeric(12,4) not null, output_per_million numeric(12,4) not null,
  cached_input_per_million numeric(12,4), tier text not null default 'standard', source text not null default 'public list price',
  retrieved_at timestamptz not null default now(), active boolean not null default true
);
insert into public.model_pricing (model, provider, input_per_million, output_per_million, cached_input_per_million, tier, retrieved_at) values
  ('openai/gpt-4o', 'openai', 2.50, 10.00, 1.25, 'frontier', '2026-09-01'),
  ('openai/gpt-4o-mini', 'openai', 0.15, 0.60, 0.075, 'small', '2026-09-01');

create function public.is_workspace_member(ws uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is not null and uid is distinct from auth.uid() then false
    else exists (select 1 from public.workspace_members where workspace_id = ws and user_id = uid)
  end;
$$;
revoke all on function public.is_workspace_member(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated, service_role;
`;

// The parts of 012 that shape privileges: browser roles hold nothing unless a
// migration grants it; service_role holds everything.
const LEAST_PRIVILEGE = `
revoke all on all tables in schema public from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.projects to authenticated;
grant all on all tables in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
`;

// The 004 tables Part 3 (019) builds on, reduced to the columns the routes use.
export const PLATFORM_V3 = `
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, display_name text, username text, avatar_url text,
  created_at timestamptz not null default now(), last_active_at timestamptz,
  suspended_at timestamptz, suspended_reason text
);
create table public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'superadmin')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null, target_type text, target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.site_content (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.site_content (key, value) values
  ('hero', '{"announcement": null, "headline": "Make AI cheaper without guessing.", "subheadline": null, "supporting": "Seeded.", "primary_cta": {"label": "Run an evaluation", "href": "/evaluation"}, "secondary_cta": {"label": "See how it works", "href": "/product"}, "trust_line": "Measure. Replay. Verify. Then optimize."}'::jsonb),
  ('status', '{"banner": null, "public_status": "operational"}'::jsonb),
  ('contact', '{"email": "hello@example.invalid"}'::jsonb);
alter table public.feature_flags add column updated_by uuid references auth.users(id) on delete set null;
revoke all on public.profiles, public.admin_roles, public.admin_audit_log, public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant all on public.profiles, public.admin_roles, public.admin_audit_log, public.site_content to service_role;
`;

export async function createDb({ zevir = true, optimize = true, intelligence = true, experience = true }: { zevir?: boolean; optimize?: boolean; intelligence?: boolean; experience?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(migration('009_product_engine.sql'));
  await db.exec(migration('010_trace_prompt_evidence.sql'));
  await db.exec(migration('014_engine_evaluation_requirements.sql'));
  await db.exec(migration('015_engine_evaluation_trial.sql'));
  await db.exec(LEAST_PRIVILEGE);
  if (zevir) await db.exec(migration('016_zevir_part1.sql'));
  if (zevir && optimize) await db.exec(migration('017_verified_optimization.sql'));
  if (zevir && optimize && intelligence) await db.exec(migration('018_optimization_intelligence.sql'));
  if (experience) {
    await db.exec(PLATFORM_V3);
    await db.exec(migration('019_product_experience.sql'));
  }
  return db;
}

export async function seedWorkspace(db: PGlite, { userId, workspaceId, role = 'member', slug }: { userId: string; workspaceId: string; role?: string; slug: string }) {
  await db.query('insert into auth.users(id, email) values ($1, $2) on conflict do nothing', [userId, `${slug}@example.invalid`]);
  await db.query('insert into public.workspaces(id, name, slug, owner_id) values ($1, $2, $3, $4)', [workspaceId, slug, slug, userId]);
  await db.query('insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, $3)', [workspaceId, userId, role]);
}

/** Runs `fn` inside a transaction as an authenticated browser user (the JWT `sub` claim). */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' })]);
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}

// ------------------------------------------------------------------ rest shim
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  return value;
}
const plainRow = (row: Row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]));
const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier ${name}`);
  return `"${name}"`;
};
const columns = (cols: string) => (cols.trim() === '*' ? '*' : cols.split(',').map((c) => ident(c.trim())).join(', '));
const param = (v: unknown) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object') ? JSON.stringify(v) : v);

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private cols = '*';
  private returning: string | null = null;
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private lim: number | null = null;
  private off: number | null = null;
  private rows: Row[] = [];
  private patch: Row = {};
  private countExact = false;
  private head = false;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private conflict: { cols: string; ignore: boolean } | null = null;

  constructor(private table: string, private exec: (sql: string, params: unknown[]) => Promise<{ rows: Row[]; affectedRows?: number }>) {}

  private p(v: unknown) {
    this.params.push(param(v));
    return `$${this.params.length}`;
  }
  select(cols = '*', opts: { count?: 'exact'; head?: boolean } = {}) {
    if (this.op === 'select') {
      this.cols = cols;
      this.countExact = opts.count === 'exact';
      this.head = Boolean(opts.head);
    } else this.returning = cols;
    return this;
  }
  insert(value: Row | Row[]) {
    this.op = 'insert';
    this.rows = Array.isArray(value) ? value : [value];
    return this;
  }
  update(value: Row) {
    this.op = 'update';
    this.patch = value;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(c: string, v: unknown) {
    this.where.push(`${ident(c)} = ${this.p(v)}`);
    return this;
  }
  neq(c: string, v: unknown) {
    this.where.push(`${ident(c)} is distinct from ${this.p(v)}`);
    return this;
  }
  in(c: string, values: unknown[]) {
    this.where.push(`${ident(c)}::text = any(${this.p(values.map(String))}::text[])`);
    return this;
  }
  gte(c: string, v: unknown) {
    this.where.push(`${ident(c)} >= ${this.p(v)}`);
    return this;
  }
  lte(c: string, v: unknown) {
    this.where.push(`${ident(c)} <= ${this.p(v)}`);
    return this;
  }
  gt(c: string, v: unknown) {
    this.where.push(`${ident(c)} > ${this.p(v)}`);
    return this;
  }
  lt(c: string, v: unknown) {
    this.where.push(`${ident(c)} < ${this.p(v)}`);
    return this;
  }
  upsert(value: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'insert';
    this.rows = Array.isArray(value) ? value : [value];
    this.conflict = { cols: opts.onConflict || 'id', ignore: Boolean(opts.ignoreDuplicates) };
    return this;
  }
  is(c: string, v: null) {
    if (v !== null) throw new Error('only is(null) is supported');
    this.where.push(`${ident(c)} is null`);
    return this;
  }
  order(c: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push(`${ident(c)} ${opts.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.off = from;
    this.lim = to - from + 1;
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  private sql() {
    const where = this.where.length ? ` where ${this.where.join(' and ')}` : '';
    const t = `public.${ident(this.table)}`;
    if (this.op === 'insert') {
      const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const values = this.rows.map((r) => `(${keys.map((k) => (k in r ? this.p(r[k]) : 'default')).join(', ')})`).join(', ');
      let onConflict = '';
      if (this.conflict) {
        const target = this.conflict.cols.split(',').map((c) => ident(c.trim())).join(', ');
        const sets = keys.filter((k) => !this.conflict!.cols.split(',').map((c) => c.trim()).includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`);
        onConflict = this.conflict.ignore || !sets.length ? ` on conflict (${target}) do nothing` : ` on conflict (${target}) do update set ${sets.join(', ')}`;
      }
      return `insert into ${t} (${keys.map(ident).join(', ')}) values ${values}${onConflict}${this.returning ? ` returning ${columns(this.returning)}` : ''}`;
    }
    if (this.op === 'update') {
      const sets = Object.entries(this.patch).map(([k, v]) => `${ident(k)} = ${this.p(v)}`).join(', ');
      return `update ${t} set ${sets}${where}${this.returning ? ` returning ${columns(this.returning)}` : ''}`;
    }
    if (this.op === 'delete') return `delete from ${t}${where}${this.returning ? ` returning ${columns(this.returning)}` : ''}`;
    const order = this.orderBy.length ? ` order by ${this.orderBy.join(', ')}` : '';
    const page = `${this.lim !== null ? ` limit ${Number(this.lim)}` : ''}${this.off !== null ? ` offset ${Number(this.off)}` : ''}`;
    return `select ${columns(this.cols)} from ${t}${where}${order}${page}`;
  }

  private async run(): Promise<Result> {
    try {
      if (this.op === 'select' && this.countExact) {
        const where = this.where.length ? ` where ${this.where.join(' and ')}` : '';
        const counted = await this.exec(`select count(*)::int as n from public.${ident(this.table)}${where}`, this.params);
        const n = Number(counted.rows[0].n);
        if (this.head) return { data: null, error: null, count: n };
        const res = await this.exec(this.sql(), this.params);
        return { data: res.rows.map(plainRow), error: null, count: n };
      }
      const res = await this.exec(this.sql(), this.params);
      const rows = res.rows.map(plainRow);
      if (this.mode === 'single') {
        if (rows.length !== 1) return { data: null, error: { message: `expected one row, got ${rows.length}`, code: 'PGRST116' } };
        return { data: rows[0], error: null };
      }
      if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null };
      return { data: this.op === 'select' || this.returning ? rows : null, error: null, count: null };
    } catch (error) {
      const e = error as { message: string; code?: string };
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }

  then<A = Result, B = never>(resolve?: ((v: Result) => A | PromiseLike<A>) | null, reject?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(resolve, reject);
  }
}

/** supabase-js-shaped client over PGlite; every statement runs as service_role. */
export function restClient(db: PGlite) {
  const exec = (sql: string, params: unknown[]) =>
    db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      return tx.query<Row>(sql, params);
    });
  return {
    from: (table: string) => new Query(table, exec),
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
      const names = Object.keys(args);
      const list = names.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ');
      try {
        const res = await exec(`select public.${ident(fn)}(${list}) as result`, names.map((k) => param(args[k])));
        return { data: plain(res.rows[0].result), error: null };
      } catch (error) {
        const e = error as { message: string; code?: string };
        return { data: null, error: { message: e.message, code: e.code } };
      }
    },
  };
}
