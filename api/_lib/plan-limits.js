/**
 * Plan entitlements, enforced over the billing account rather than one
 * workspace (pentest 2026-11-13, SEC-01 and SEC-02).
 *
 * Billing scope: a workspace's plan is its admin `plan_override`, else its
 * owner's subscription (public.workspace_plan). Workspaces that inherit the
 * owner's subscription therefore share ONE allowance: every workspace that
 * owner owns without an override. A workspace with an override carries its
 * own admin-granted entitlement and is counted alone.
 *
 * Project creation is check -> insert -> confirm. The confirm step keeps only
 * the first `limit` active projects of the scope (created_at, id), so two
 * concurrent requests cannot both pass a check that ran before either insert.
 */
import { ApiError } from './http.js';
import { loadPlan } from './supabase.js';

/** Strictest published retention, used whenever a plan does not state one. */
export const FALLBACK_RETENTION_DAYS = 7;
/** Workspace default before the plan ceiling (column default in 004_platform.sql). */
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 730;

export async function workspacePlan(admin, workspaceId) {
  const { data: planId } = await admin.rpc('workspace_plan', { ws: workspaceId });
  const plan = await loadPlan(admin, planId || 'free');
  return { planId: planId || 'free', plan };
}

/** Telemetry retention ceiling (days) of a plan, never above the schema maximum. */
export function retentionCeiling(plan) {
  const days = Number(plan?.limits?.telemetry_retention_days);
  if (!Number.isFinite(days) || days <= 0) return FALLBACK_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.floor(days)));
}

/** Retention a new workspace starts with: the default, capped by the plan. */
export function initialRetentionDays(plan) {
  return Math.min(DEFAULT_RETENTION_DAYS, retentionCeiling(plan));
}

/** Retention actually enforced for a workspace: the stricter of setting and plan. */
export function effectiveRetentionDays(plan, storedDays) {
  const stored = Number(storedDays);
  const ceiling = retentionCeiling(plan);
  return Number.isFinite(stored) && stored > 0 ? Math.min(ceiling, stored) : ceiling;
}

/** The workspaces whose active projects count against the same allowance as `workspaceId`. */
export async function billingScope(admin, workspaceId) {
  const { data: ws, error } = await admin.from('workspaces').select('id,owner_id,plan_override').eq('id', workspaceId).single();
  if (error || !ws) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
  const { plan, planId } = await workspacePlan(admin, workspaceId);
  let workspaceIds = [ws.id];
  if (!ws.plan_override) {
    const { data: owned, error: ownedError } = await admin.from('workspaces').select('id,plan_override').eq('owner_id', ws.owner_id);
    if (ownedError) throw ownedError;
    workspaceIds = (owned || []).filter((w) => !w.plan_override).map((w) => w.id);
    if (!workspaceIds.includes(ws.id)) workspaceIds.push(ws.id);
  }
  return { workspace: ws, plan, planId, workspaceIds };
}

const projectLimit = (plan) => {
  const limit = plan?.limits?.projects;
  return limit === null || limit === undefined ? null : Number(limit);
};

const planLimitError = (plan, limit) =>
  new ApiError(402, `The ${plan.name} plan includes ${limit} project${limit === 1 ? '' : 's'} across your workspaces. Upgrade or archive a project to add more.`, 'PLAN_LIMIT', { limit: 'projects', plan: plan.id, scope: 'account' });

async function activeProjectCount(admin, workspaceIds) {
  const { count, error } = await admin.from('projects').select('id', { count: 'exact', head: true }).in('workspace_id', workspaceIds).is('archived_at', null);
  if (error) throw error;
  return count || 0;
}

/** Early refusal before any write. */
export async function assertProjectAllowance(admin, scope) {
  const limit = projectLimit(scope.plan);
  if (limit === null) return;
  if ((await activeProjectCount(admin, scope.workspaceIds)) >= limit) throw planLimitError(scope.plan, limit);
}

/**
 * After the insert: the project survives only if it is among the first
 * `limit` active projects of the scope. Otherwise it is removed again (it was
 * created moments ago and nothing references it) and the request fails.
 */
export async function confirmProjectAllowance(admin, scope, projectId) {
  const limit = projectLimit(scope.plan);
  if (limit === null) return;
  const { data, error } = await admin.from('projects').select('id').in('workspace_id', scope.workspaceIds).is('archived_at', null).order('created_at').order('id').limit(limit);
  if (error) throw error;
  if ((data || []).some((p) => p.id === projectId)) return;
  await admin.from('projects').delete().eq('id', projectId);
  throw planLimitError(scope.plan, limit);
}

/**
 * Restoring an archived project re-enters the allowance: refuse when full,
 * and after the update re-archive it if a concurrent write filled the scope.
 */
export async function assertUnarchiveAllowance(admin, scope) {
  return assertProjectAllowance(admin, scope);
}

export async function confirmUnarchiveAllowance(admin, scope, projectId) {
  const limit = projectLimit(scope.plan);
  if (limit === null) return;
  if ((await activeProjectCount(admin, scope.workspaceIds)) <= limit) return;
  await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId);
  throw planLimitError(scope.plan, limit);
}
