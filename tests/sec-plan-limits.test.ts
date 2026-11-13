/**
 * Pentest 2026-11-13 regression suite, on the real router, handlers and
 * migrations (PGlite); only the JWT check is mocked.
 *
 * SEC-01  The project allowance is an account entitlement: a Free owner with
 *         one project cannot get a second one by creating another workspace,
 *         by racing concurrent requests, or by archive -> create -> restore.
 * SEC-02  Telemetry retention never exceeds the plan ceiling: new workspaces
 *         start inside it, writes above it are refused, and the purge job
 *         enforces the stricter window and lowers stale settings.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, routeState } from './helpers/routes';

vi.mock('../api/_lib/auth.js', () => ({
  ...authMock,
  // Same rule as api/_lib/auth.js: the project must exist, then the caller needs a role in its workspace.
  requireProjectAccess: async (admin: { from: (t: string) => any }, projectId: string, userId: string, minRole = 'viewer') => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: project } = await admin.from('projects').select('*').eq('id', projectId).maybeSingle();
    if (!project) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'NOT_FOUND' });
    return { project, role: await authMock.requireWorkspaceRole(admin, project.workspace_id, userId, minRole) };
  },
}));
const cronState: { rest: ReturnType<typeof restClient> | null } = { rest: null };
vi.mock('../api/_lib/supabase.js', async (orig) => ({ ...(await orig<typeof import('../api/_lib/supabase.js')>()), adminClient: () => cronState.rest }));
vi.setConfig({ testTimeout: 60_000 });

const FREE = 'f0000000-0000-4000-8000-0000000000f1';
const FREE_RACE = 'f0000000-0000-4000-8000-0000000000f2';
const PRO = 'f0000000-0000-4000-8000-0000000000f3';
const STRANGER = 'f0000000-0000-4000-8000-0000000000f4';
const WS_FREE = 'f1111111-1111-4111-8111-1111111111f1';
const WS_RACE = 'f1111111-1111-4111-8111-1111111111f2';
const WS_PRO = 'f1111111-1111-4111-8111-1111111111f3';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let dispatch: (r: Request) => Promise<Response>;
const call = (m: string, p: string, b?: unknown) => rawCall(dispatch, m, p, b);
const as = (u: string) => (routeState.user = u);
const q = async <T = Row>(sql: string, params: unknown[] = []) => (await routeState.db!.query<T>(sql, params)).rows;
const activeProjects = async (owner: string) => (await q<{ n: number }>('select count(*)::int n from public.projects p join public.workspaces w on w.id = p.workspace_id where w.owner_id = $1 and p.archived_at is null', [owner]))[0].n;

// The 004_platform pieces these routes read, which the shared harness reduces:
// subscriptions, the real workspace_plan(), plan limits as seeded in 004, the
// retention column (default 90, 7..730) and project lifecycle columns.
const PLATFORM_BILLING = `
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null default 'free', status text not null default 'active', stripe_subscription_id text
);
create or replace function public.workspace_plan(ws uuid) returns text language sql stable as $$
  select coalesce(
    (select plan_override::text from public.workspaces where id = ws),
    (select s.plan::text from public.workspaces w join public.subscriptions s on s.user_id = w.owner_id where w.id = ws),
    'free');
$$;
update public.plans set limits = '{"projects": 1, "credits_usd": 5, "replay_samples": 8, "team_members": 1, "telemetry_retention_days": 7}' where id = 'free';
insert into public.plans (id, name, limits) values
  ('starter', 'Starter', '{"projects": 3, "credits_usd": 25, "team_members": 3, "telemetry_retention_days": 30}'),
  ('pro', 'Pro', '{"projects": 10, "credits_usd": 75, "team_members": 10, "telemetry_retention_days": 90}'),
  ('enterprise', 'Enterprise', '{"projects": null, "credits_usd": 300, "team_members": null, "telemetry_retention_days": 365}');
alter table public.workspaces add column if not exists data_retention_days integer not null default 90 check (data_retention_days between 7 and 730);
alter table public.workspaces add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists description text;
alter table public.projects add column if not exists source_kind text;
alter table public.projects add column if not exists repo_url text;
alter table public.projects add column if not exists created_by uuid;
alter table public.projects add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists created_at timestamptz not null default clock_timestamp();
create table if not exists public.connections (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id), status text, revoked_at timestamptz, revoked_by uuid);
create table if not exists public.connection_secrets (connection_id uuid);
create table if not exists public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  occurred_at timestamptz not null default now()
);
create table if not exists public.credit_balances (user_id uuid primary key, included_usd numeric, used_usd numeric, period_start timestamptz, period_end timestamptz);
create table if not exists public.desktop_auth_handoffs (id uuid primary key default gen_random_uuid(), expires_at timestamptz);
create table if not exists public.workspace_invites (id uuid primary key default gen_random_uuid(), workspace_id uuid, accepted_at timestamptz, expires_at timestamptz);
grant all on all tables in schema public to service_role;
`;

beforeAll(async () => {
  routeState.db = await createDb();
  await routeState.db.exec(PLATFORM_BILLING);
  routeState.rest = restClient(routeState.db);
  cronState.rest = routeState.rest;
  await seedWorkspace(routeState.db, { userId: FREE, workspaceId: WS_FREE, slug: 'free-a', role: 'owner' });
  await seedWorkspace(routeState.db, { userId: FREE_RACE, workspaceId: WS_RACE, slug: 'free-race', role: 'owner' });
  await seedWorkspace(routeState.db, { userId: PRO, workspaceId: WS_PRO, slug: 'pro-a', role: 'owner' });
  await q('insert into auth.users(id) values ($1)', [STRANGER]);
  await q(`insert into public.subscriptions(user_id, plan, status) values ($1, 'pro', 'active')`, [PRO]);
  ({ dispatch } = await import('../api/_lib/router.js'));
  (await import('../api/_lib/analytics/security.js')).setSecurityClient(routeState.rest);
  await import('../api/_lib/handlers/workspaces.js');
  await import('../api/_lib/handlers/projects.js');
  await import('../api/_lib/handlers/cron.js');
}, 120_000);

describe('SEC-01 account-level project allowance', () => {
  let wsB = '';
  it('a Free owner gets one project, and a second in the same workspace is refused', async () => {
    as(FREE);
    expect((await call('POST', `/api/workspaces/${WS_FREE}/projects`, { name: 'first project' })).status).toBe(200);
    const second = await call('POST', `/api/workspaces/${WS_FREE}/projects`, { name: 'second project' });
    expect(second.status).toBe(402);
    expect(second.body).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'projects', plan: 'free', scope: 'account' } });
  });

  it('a new workspace does not mint a fresh allowance (the reported bypass)', async () => {
    as(FREE);
    const ws = await call('POST', '/api/workspaces', { name: 'probe workspace' });
    expect(ws.status).toBe(200);
    wsB = ws.body.workspace.id;
    const r = await call('POST', `/api/workspaces/${wsB}/projects`, { name: 'bypass attempt' });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('PLAN_LIMIT');
    expect(await activeProjects(FREE)).toBe(1);
  });

  it('archive -> create -> restore cannot exceed the allowance either', async () => {
    as(FREE);
    const [{ id: first }] = await q<{ id: string }>('select id from public.projects where workspace_id = $1', [WS_FREE]);
    expect((await call('DELETE', `/api/projects/${first}`)).body).toMatchObject({ archived: true });
    const replacement = await call('POST', `/api/workspaces/${wsB}/projects`, { name: 'replacement' });
    expect(replacement.status).toBe(200);
    const restore = await call('PATCH', `/api/projects/${first}`, { archived: false });
    expect(restore.status).toBe(402);
    expect((await q('select archived_at from public.projects where id = $1', [first]))[0].archived_at).not.toBeNull();
    expect(await activeProjects(FREE)).toBe(1);
  });

  it('concurrent creates across workspaces leave exactly one project', async () => {
    as(FREE_RACE);
    const extra = await call('POST', '/api/workspaces', { name: 'race workspace' });
    const targets = [WS_RACE, extra.body.workspace.id, WS_RACE, extra.body.workspace.id];
    const results = await Promise.all(targets.map((ws, i) => call('POST', `/api/workspaces/${ws}/projects`, { name: `race ${i}` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 402).every((r) => r.body.code === 'PLAN_LIMIT')).toBe(true);
    expect(await activeProjects(FREE_RACE)).toBe(1);
  });

  it('a paid plan keeps its larger allowance across workspaces', async () => {
    as(PRO);
    for (let i = 0; i < 3; i += 1) expect((await call('POST', `/api/workspaces/${WS_PRO}/projects`, { name: `pro project ${i}` })).status).toBe(200);
    const second = await call('POST', '/api/workspaces', { name: 'pro second' });
    expect((await call('POST', `/api/workspaces/${second.body.workspace.id}/projects`, { name: 'pro project x' })).status).toBe(200);
    expect(await activeProjects(PRO)).toBe(4);
  });

  it('an admin plan override is its own entitlement, counted for that workspace alone', async () => {
    as(FREE);
    await q(`update public.workspaces set plan_override = 'pro' where id = $1`, [wsB]);
    expect((await call('POST', `/api/workspaces/${wsB}/projects`, { name: 'override project' })).status).toBe(200);
    await q('update public.workspaces set plan_override = null where id = $1', [wsB]);
  });

  it('a stranger still cannot create projects in someone else\'s workspace', async () => {
    as(STRANGER);
    expect((await call('POST', `/api/workspaces/${WS_PRO}/projects`, { name: 'cross tenant' })).status).toBe(404);
  });
});

describe('SEC-02 telemetry retention within the plan ceiling', () => {
  it('a new Free workspace starts at 7 days and a new Pro workspace at 90', async () => {
    as(FREE_RACE);
    const free = await call('POST', '/api/workspaces', { name: 'free retention' });
    expect(free.body.workspace.data_retention_days).toBe(7);
    as(PRO);
    const pro = await call('POST', '/api/workspaces', { name: 'pro retention' });
    expect(pro.body.workspace.data_retention_days).toBe(90);
  });

  it('a Free owner cannot store 365 days (the reported request); values within the plan still save', async () => {
    as(FREE);
    const r = await call('PATCH', `/api/workspaces/${WS_FREE}`, { data_retention_days: 365 });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'telemetry_retention_days', plan: 'free', max: 7 } });
    expect((await q('select data_retention_days from public.workspaces where id = $1', [WS_FREE]))[0].data_retention_days).not.toBe(365);
    expect((await call('PATCH', `/api/workspaces/${WS_FREE}`, { data_retention_days: 8 })).status).toBe(402);
    expect((await call('PATCH', `/api/workspaces/${WS_FREE}`, { data_retention_days: 0 })).status).toBe(400);
  });

  it('Pro may choose up to its 90-day ceiling, not beyond', async () => {
    as(PRO);
    expect((await call('PATCH', `/api/workspaces/${WS_PRO}`, { data_retention_days: 60 })).body.workspace.data_retention_days).toBe(60);
    expect((await call('PATCH', `/api/workspaces/${WS_PRO}`, { data_retention_days: 91 })).status).toBe(402);
  });

  it('the purge job enforces the stricter window and lowers a stale setting after a downgrade', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    // WS_FREE still carries the 90-day column default from before the fix.
    expect((await q('select data_retention_days from public.workspaces where id = $1', [WS_FREE]))[0].data_retention_days).toBe(90);
    const [{ id: project }] = await q<{ id: string }>('select id from public.projects where workspace_id = $1 limit 1', [WS_FREE]);
    for (const days of [30, 8, 6, 1]) await q('insert into public.telemetry_events(workspace_id, project_id, occurred_at) values ($1, $2, $3)', [WS_FREE, project, new Date(Date.now() - days * DAY).toISOString()]);
    process.env.CRON_SECRET = 'test-cron-secret-value';
    const res = await dispatch(new Request('https://x.test/api/cron/daily', { headers: { authorization: 'Bearer test-cron-secret-value' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retentionReconciled).toBeGreaterThanOrEqual(1);
    const left = await q<{ age: number }>(`select round(extract(epoch from now() - occurred_at) / 86400)::int age from public.telemetry_events where workspace_id = $1 order by age`, [WS_FREE]);
    expect(left.map((r) => r.age)).toEqual([1, 6]);
    expect((await q('select data_retention_days from public.workspaces where id = $1', [WS_FREE]))[0].data_retention_days).toBe(7);
  });
});

describe('plan-limit helpers', () => {
  it('fall back to the strictest window for unknown plans', async () => {
    const { retentionCeiling, effectiveRetentionDays, initialRetentionDays } = await import('../api/_lib/plan-limits.js');
    expect(retentionCeiling(undefined)).toBe(7);
    expect(retentionCeiling({ limits: { telemetry_retention_days: 365 } })).toBe(365);
    expect(retentionCeiling({ limits: { telemetry_retention_days: 5000 } })).toBe(730);
    expect(effectiveRetentionDays({ limits: { telemetry_retention_days: 7 } }, 365)).toBe(7);
    expect(effectiveRetentionDays({ limits: { telemetry_retention_days: 90 } }, 30)).toBe(30);
    expect(initialRetentionDays({ limits: { telemetry_retention_days: 365 } })).toBe(90);
  });
});
