/**
 * Security regressions for connection tokens and workspace membership: the real
 * router and handlers over the real migrations (PGlite), with only the JWT check
 * mocked. Covers sample-capture rights, membership-before-state on rotation,
 * idempotent revocation, cross-workspace denial and the audit trail of
 * connection and role changes in security_events.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ApiError } from '../api/_lib/http.js';
import { createDb, restClient, seedWorkspace } from './helpers/pg';

const OWNER = 'a0000000-0000-4000-8000-00000000000a';
const CREATOR = 'a0000000-0000-4000-8000-0000000000c1';
const MEMBER = 'a0000000-0000-4000-8000-0000000000c2';
const VIEWER = 'a0000000-0000-4000-8000-0000000000c3';
const OUTSIDER = 'b0000000-0000-4000-8000-00000000000b';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const PROJECT_A = 'a4444444-4444-4444-8444-444444444444';

const RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
const state: { db: PGlite | null; rest: ReturnType<typeof restClient> | null; user: string } = { db: null, rest: null, user: OWNER };

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({ user: { id: state.user, email: null }, admin: state.rest }),
  requireWorkspaceRole: async (_admin: unknown, ws: string, uid: string, min = 'viewer') => {
    const r = await state.db!.query<{ role: string }>('select role::text from public.workspace_members where workspace_id = $1 and user_id = $2', [ws, uid]);
    const role = r.rows[0]?.role;
    if (!role) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
    if (RANK[role] < RANK[min]) throw new ApiError(403, `This action requires the ${min} role.`, 'FORBIDDEN');
    return role;
  },
  requireProjectAccess: async () => {
    throw new Error('not used here');
  },
  rateLimit: () => undefined,
  rateLimitRequest: () => undefined,
  roleRank: (r: string) => RANK[r] || 0,
}));

// The connection tables, exactly as migration 004 defines the columns these handlers use.
const CONNECTIONS = `
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null check (kind in ('server_telemetry', 'runtime_api', 'repository', 'github')),
  name text not null check (char_length(name) between 2 and 80),
  status text not null default 'active' check (status in ('active', 'revoked', 'pending')),
  token_prefix text,
  token_last4 text,
  scopes text[] not null default array['telemetry:write']::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);
create table public.connection_secrets (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  token_hash text not null unique,
  rotated_at timestamptz not null default now()
);
alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;
grant all on public.connections, public.connection_secrets to service_role;`;

let dispatch: (req: Request) => Promise<Response>;
async function call(method: string, path: string, body?: unknown) {
  const res = await dispatch(new Request(`https://x.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const as = (user: string) => {
  state.user = user;
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await state.db!.query<T>(sql, params)).rows;
const events = (action: string) => q<{ kind: string; actor_id: string; workspace_id: string; metadata: Record<string, unknown> }>(`select kind, actor_id, workspace_id, metadata from public.security_events where metadata->>'action' = $1 order by occurred_at`, [action]);

async function connection(over: { status?: string; kind?: string; capture?: boolean } = {}) {
  const [row] = await q<{ id: string }>(
    `insert into public.connections(workspace_id, project_id, kind, name, status, token_prefix, token_last4, metadata, created_by)
     values ($1, $2, $3, 'Runtime', $4, 'abcdefgh', 'wxyz', $5, $6) returning id`,
    [WS_A, PROJECT_A, over.kind || 'server_telemetry', over.status || 'active', JSON.stringify({ capture_samples: Boolean(over.capture) }), CREATOR],
  );
  await q('insert into public.connection_secrets(connection_id, token_hash) values ($1, $2)', [row.id, `hash-${row.id}`]);
  return row.id;
}

beforeAll(async () => {
  state.db = await createDb();
  state.rest = restClient(state.db);
  await state.db.exec(CONNECTIONS);
  await seedWorkspace(state.db, { userId: OWNER, workspaceId: WS_A, slug: 'alpha', role: 'owner' });
  await seedWorkspace(state.db, { userId: OUTSIDER, workspaceId: WS_B, slug: 'bravo', role: 'owner' });
  for (const [id, role] of [[CREATOR, 'member'], [MEMBER, 'member'], [VIEWER, 'viewer']]) {
    await q('insert into auth.users(id, email) values ($1, $2)', [id, `${role}-${id.slice(-2)}@example.invalid`]);
    await q('insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, $3)', [WS_A, id, role]);
  }
  await q(`insert into public.projects(id, workspace_id, name) values ($1, $2, 'Synthetic')`, [PROJECT_A, WS_A]);
  const security = await import('../api/_lib/analytics/security.js');
  security.setSecurityClient(state.rest);
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/projects.js');
  await import('../api/_lib/handlers/workspaces.js');
}, 60_000);

beforeEach(async () => {
  const { resetSecurityThrottle } = await import('../api/_lib/analytics/security.js');
  resetSecurityThrottle();
});

describe('sample capture', () => {
  it('only the creator or an admin can turn it on; a plain member still renames', async () => {
    const id = await connection();
    as(MEMBER);
    const denied = await call('PATCH', `/api/connections/${id}`, { capture_samples: true });
    expect(denied.status).toBe(403);
    expect((await q<{ c: boolean }>(`select (metadata->>'capture_samples')::boolean c from public.connections where id = $1`, [id]))[0].c).toBe(false);
    const renamed = await call('PATCH', `/api/connections/${id}`, { name: 'Renamed by member' });
    expect(renamed.status).toBe(200);
    // Sending the unchanged value is not a capture change and needs no extra right.
    expect((await call('PATCH', `/api/connections/${id}`, { name: 'Again', capture_samples: false })).status).toBe(200);

    as(CREATOR);
    const allowed = await call('PATCH', `/api/connections/${id}`, { capture_samples: true });
    expect(allowed.status).toBe(200);
    expect(allowed.body.connection.metadata.capture_samples).toBe(true);
    const audit = (await events('connection_capture_samples')).filter((e) => e.metadata.connection_id === id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'config_change', actor_id: CREATOR, workspace_id: WS_A, metadata: { from: false, to: true } });

    as(OWNER);
    expect((await call('PATCH', `/api/connections/${id}`, { capture_samples: false })).status).toBe(200);
  });

  it('a user from another workspace gets a plain 404 and changes nothing', async () => {
    const id = await connection();
    as(OUTSIDER);
    expect((await call('PATCH', `/api/connections/${id}`, { capture_samples: true })).status).toBe(404);
    expect((await q<{ c: boolean }>(`select (metadata->>'capture_samples')::boolean c from public.connections where id = $1`, [id]))[0].c).toBe(false);
  });
});

describe('token rotation', () => {
  it('checks membership before revealing the connection state', async () => {
    const revoked = await connection({ status: 'revoked' });
    as(OUTSIDER);
    const outsider = await call('POST', `/api/connections/${revoked}/rotate`);
    expect(outsider.status).toBe(404);
    expect(outsider.body.error?.code ?? outsider.body.code).not.toBe('INVALID_STATE');
    as(CREATOR);
    expect((await call('POST', `/api/connections/${revoked}/rotate`)).status).toBe(409);
  });

  it('a non-creator member cannot rotate; the creator gets a new token once and it is audited', async () => {
    const id = await connection();
    as(MEMBER);
    expect((await call('POST', `/api/connections/${id}/rotate`)).status).toBe(403);
    as(CREATOR);
    const before = (await q<{ token_hash: string }>('select token_hash from public.connection_secrets where connection_id = $1', [id]))[0].token_hash;
    const rotated = await call('POST', `/api/connections/${id}/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).toMatch(/^zqt_[A-Za-z0-9]{8}_/);
    const after = (await q<{ token_hash: string }>('select token_hash from public.connection_secrets where connection_id = $1', [id]))[0].token_hash;
    expect(after).not.toBe(before);
    const audit = (await events('connection_rotated')).filter((e) => e.metadata.connection_id === id);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(rotated.body.token);
  });
});

describe('revocation', () => {
  it('denies a non-creator member, lets an admin revoke once, and repeats as a no-op', async () => {
    const id = await connection();
    as(MEMBER);
    expect((await call('DELETE', `/api/connections/${id}`)).status).toBe(403);
    as(OWNER);
    const first = await call('DELETE', `/api/connections/${id}`);
    expect(first.status).toBe(200);
    const row = (await q<{ status: string; revoked_by: string; revoked_at: string }>('select status, revoked_by, revoked_at::text from public.connections where id = $1', [id]))[0];
    expect(row).toMatchObject({ status: 'revoked', revoked_by: OWNER });
    expect(await q('select 1 from public.connection_secrets where connection_id = $1', [id])).toHaveLength(0);

    as(CREATOR);
    const again = await call('DELETE', `/api/connections/${id}`);
    expect(again.body).toMatchObject({ ok: true, already_revoked: true });
    const unchanged = (await q<{ revoked_by: string; revoked_at: string }>('select revoked_by, revoked_at::text from public.connections where id = $1', [id]))[0];
    expect(unchanged).toEqual({ revoked_by: OWNER, revoked_at: row.revoked_at });
    const audit = (await events('connection_revoked')).filter((e) => e.metadata.connection_id === id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'connection_revoked', actor_id: OWNER, workspace_id: WS_A });
  });

  it('a user from another workspace cannot revoke', async () => {
    const id = await connection();
    as(OUTSIDER);
    expect((await call('DELETE', `/api/connections/${id}`)).status).toBe(404);
    expect((await q<{ status: string }>('select status from public.connections where id = $1', [id]))[0].status).toBe('active');
  });
});

describe('membership audit', () => {
  it('records role changes with the old and new role, and only real changes', async () => {
    as(OWNER);
    expect((await call('PATCH', `/api/workspaces/${WS_A}/members/${MEMBER}`, { role: 'viewer' })).status).toBe(200);
    expect((await call('PATCH', `/api/workspaces/${WS_A}/members/${MEMBER}`, { role: 'viewer' })).status).toBe(200);
    const audit = (await events('member_role_changed')).filter((e) => e.metadata.target_user === MEMBER);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'admin_action', actor_id: OWNER, workspace_id: WS_A, metadata: { from: 'member', to: 'viewer' } });
    expect((await call('PATCH', `/api/workspaces/${WS_A}/members/${MEMBER}`, { role: 'member' })).status).toBe(200);
  });

  it('a viewer cannot change roles and leaves no audit record', async () => {
    as(VIEWER);
    const before = (await events('member_role_changed')).length;
    expect((await call('PATCH', `/api/workspaces/${WS_A}/members/${MEMBER}`, { role: 'viewer' })).status).toBe(403);
    expect((await events('member_role_changed')).length).toBe(before);
  });

  it('records a removal by an admin', async () => {
    as(OWNER);
    expect((await call('DELETE', `/api/workspaces/${WS_A}/members/${VIEWER}`)).status).toBe(200);
    const audit = (await events('member_removed')).filter((e) => e.metadata.target_user === VIEWER);
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ role: 'viewer' });
  });

  it('presentation mode is not an input: a viewer stays a viewer whatever view it claims', async () => {
    as(MEMBER);
    await q('update public.workspace_members set role = $3 where workspace_id = $1 and user_id = $2', [WS_A, MEMBER, 'viewer']);
    const res = await dispatch(new Request(`https://x.test/api/workspaces/${WS_A}/members/${CREATOR}?mode=ceo&view=cto`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-zevqora-mode': 'ceo' }, body: JSON.stringify({ role: 'admin', mode: 'ceo' }) }));
    expect(res.status).toBe(403);
    await q('update public.workspace_members set role = $3 where workspace_id = $1 and user_id = $2', [WS_A, MEMBER, 'member']);
  });
});
