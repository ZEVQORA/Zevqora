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

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');
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
  created_at timestamptz not null default now()
);
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

export async function createDb({ zevir = true }: { zevir?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(migration('009_product_engine.sql'));
  await db.exec(migration('010_trace_prompt_evidence.sql'));
  await db.exec(migration('014_engine_evaluation_requirements.sql'));
  await db.exec(migration('015_engine_evaluation_trial.sql'));
  await db.exec(LEAST_PRIVILEGE);
  if (zevir) await db.exec(migration('016_zevir_part1.sql'));
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
      return `insert into ${t} (${keys.map(ident).join(', ')}) values ${values}${this.returning ? ` returning ${columns(this.returning)}` : ''}`;
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
