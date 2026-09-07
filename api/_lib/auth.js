import { ApiError, bearerToken, clientIp } from './http.js';
import { adminClient, verifyAccessToken } from './supabase.js';

const ROLE_RANK = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

/**
 * Resolves the calling user from the Supabase access token.
 * Suspended accounts are rejected here, before any handler runs.
 */
export async function requireUser(request) {
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, 'Sign in first.', 'AUTH_REQUIRED');
  const user = await verifyAccessToken(token);
  if (!user) throw new ApiError(401, 'Your session expired. Sign in again.', 'SESSION_EXPIRED');
  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id,email,display_name,username,avatar_url,timezone,notification_prefs,onboarding,suspended_at,suspended_reason,created_at')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.suspended_at) throw new ApiError(403, 'This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  // Fire-and-forget activity stamp; a failure here must never block the request.
  admin
    .from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id)
    .then(() => undefined, () => undefined);
  return { user, profile: profile || { id: user.id, email: user.email || null }, admin };
}

export async function workspaceRoleOf(admin, workspaceId, userId) {
  const { data } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role || null;
}

/** Throws 404 (not 403) for non-members so workspace ids cannot be enumerated. */
export async function requireWorkspaceRole(admin, workspaceId, userId, minRole = 'viewer') {
  const role = await workspaceRoleOf(admin, workspaceId, userId);
  if (!role) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
  if (roleRank(role) < roleRank(minRole)) throw new ApiError(403, `This action requires the ${minRole} role.`, 'FORBIDDEN');
  return role;
}

export async function requireProjectAccess(admin, projectId, userId, minRole = 'viewer') {
  const { data: project } = await admin.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (!project) throw new ApiError(404, 'Project not found.', 'NOT_FOUND');
  const role = await requireWorkspaceRole(admin, project.workspace_id, userId, minRole);
  return { project, role };
}

export async function requireAdmin(admin, userId, { superadmin = false } = {}) {
  const { data } = await admin.from('admin_roles').select('role').eq('user_id', userId).maybeSingle();
  if (!data) throw new ApiError(404, 'Not found.', 'NOT_FOUND');
  if (superadmin && data.role !== 'superadmin') throw new ApiError(403, 'Superadmin role required.', 'FORBIDDEN');
  return data.role;
}

export async function auditAdmin(admin, adminId, action, targetType, targetId, metadata = {}) {
  const safe = JSON.parse(JSON.stringify(metadata, (key, value) => (/(secret|token|password|key)/i.test(key) ? '[redacted]' : value)));
  await admin.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    target_type: targetType || null,
    target_id: targetId ? String(targetId) : null,
    metadata: safe,
  });
}

/**
 * Best-effort in-memory limiter. Serverless instances are ephemeral, so this
 * is a first line of defence; expensive operations also carry database-level
 * guards (running-experiment caps, analysis cooldowns, credit checks).
 */
const buckets = new Map();
export function rateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  if (bucket.count > limit) throw new ApiError(429, 'Too many requests. Slow down and retry shortly.', 'RATE_LIMITED');
}

export function rateLimitRequest(request, scope, opts) {
  rateLimit(`${scope}:${clientIp(request)}`, opts);
}
