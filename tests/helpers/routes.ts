/**
 * Route-test harness: the real router and handlers over PGlite, with only the
 * JWT check mocked. Import this module from a test file that also calls
 * `mockAuth()` at top level (vi.mock is hoisted per file).
 */
import type { PGlite } from '@electric-sql/pglite';
import { ApiError } from '../../api/_lib/http.js';
import { restClient } from './pg';

export const RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
export const routeState: { db: PGlite | null; rest: ReturnType<typeof restClient> | null; user: string } = { db: null, rest: null, user: '' };

function tag(e: ApiError, kind: string, ctx: Record<string, unknown>) {
  Object.assign(e, { security: kind, securityContext: ctx });
  return e;
}

export const authMock = {
  requireUser: async () => ({ user: { id: routeState.user, email: null }, admin: routeState.rest }),
  requireWorkspaceRole: async (_admin: unknown, ws: string, uid: string, min = 'viewer') => {
    const r = await routeState.db!.query<{ role: string }>('select role::text from public.workspace_members where workspace_id = $1 and user_id = $2', [ws, uid]);
    const role = r.rows[0]?.role;
    if (!role) throw tag(new ApiError(404, 'Workspace not found.', 'NOT_FOUND'), 'cross_workspace_denied', { actorId: uid, target: { workspace_id: ws } });
    if (RANK[role] < RANK[min]) throw tag(new ApiError(403, `This action requires the ${min} role.`, 'FORBIDDEN'), 'authz_denied', { actorId: uid, workspaceId: ws });
    return role;
  },
  // The admin checks are the real ones (admin_roles), so admin route tests exercise the same rule.
  requireAdmin: async (_admin: unknown, uid: string, { superadmin = false }: { superadmin?: boolean } = {}) => {
    const r = await routeState.db!.query<{ role: string }>('select role from public.admin_roles where user_id = $1', [uid]);
    const role = r.rows[0]?.role;
    if (!role) throw tag(new ApiError(404, 'Not found.', 'NOT_FOUND'), 'admin_denied', { actorId: uid });
    if (superadmin && role !== 'superadmin') throw tag(new ApiError(403, 'Superadmin role required.', 'FORBIDDEN'), 'admin_denied', { actorId: uid });
    return role;
  },
  auditAdmin: async (_admin: unknown, adminId: string, action: string, targetType: string | null, targetId: string | null, metadata: Record<string, unknown> = {}) => {
    await routeState.db!.query('insert into public.admin_audit_log(admin_id, action, target_type, target_id, metadata) values ($1,$2,$3,$4,$5)', [adminId, action, targetType, targetId, JSON.stringify(metadata)]);
  },
  securityError: (e: ApiError, kind: string, ctx: Record<string, unknown> = {}) => tag(e, kind, ctx),
  rateLimit: () => undefined,
  rateLimitRequest: () => undefined,
  roleRank: (r: string) => RANK[r] || 0,
};

export async function call(dispatch: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) {
  const res = await dispatch(new Request(`https://x.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

/** Like `call`, with extra request headers (user agent, DNT, edge geography). */
export async function callWith(dispatch: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, headers: Record<string, string>) {
  const res = await dispatch(new Request(`https://x.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
