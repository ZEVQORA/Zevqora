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

export const authMock = {
  requireUser: async () => ({ user: { id: routeState.user, email: null }, admin: routeState.rest }),
  requireWorkspaceRole: async (_admin: unknown, ws: string, uid: string, min = 'viewer') => {
    const r = await routeState.db!.query<{ role: string }>('select role::text from public.workspace_members where workspace_id = $1 and user_id = $2', [ws, uid]);
    const role = r.rows[0]?.role;
    if (!role) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
    if (RANK[role] < RANK[min]) throw new ApiError(403, `This action requires the ${min} role.`, 'FORBIDDEN');
    return role;
  },
  rateLimit: () => undefined,
  rateLimitRequest: () => undefined,
  roleRank: (r: string) => RANK[r] || 0,
};

export async function call(dispatch: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) {
  const res = await dispatch(new Request(`https://x.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
