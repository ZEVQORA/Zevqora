/**
 * Feature flag resolution (server-authoritative).
 *
 * A flag can be targeted (019): off | internal | selected | limited | on.
 * An explicit per-workspace override always wins. Limited rollout is a
 * deterministic bucket, sha256(flag:workspace) mod 100, so the same workspace
 * always gets the same answer. A flag with no targeting keeps the pre-019
 * meaning: `enabled`, with workspace overrides.
 *
 * Client-side flags only decide what to show; every API checks again here.
 */
import { createHash } from 'node:crypto';

export const TARGETING = Object.freeze(['off', 'internal', 'selected', 'limited', 'on']);

/** Flags read per workspace. */
export const WORKSPACE_FLAGS = Object.freeze(['verified_optimization_vnext', 'optimization_intelligence_vnext', 'zevir_shadow', 'zevir_graph_ui', 'experimental_graph_overlays']);

/** Flags with no workspace (platform-wide switches): only off/on make sense. */
export const GLOBAL_FLAGS = Object.freeze(['visitor_intelligence', 'product_analytics']);

export function bucket(flagKey, workspaceId) {
  return parseInt(createHash('sha256').update(`${flagKey}:${workspaceId}`).digest('hex').slice(0, 8), 16) % 100;
}

/**
 * Pure decision. `ctx.internal` says whether the workspace is internal (owned
 * by a ZEVQORA admin); it is only consulted for internal targeting.
 */
export function decideFlag(flag, { workspaceId = null, internal = false } = {}) {
  if (!flag) return false;
  if (workspaceId) {
    const o = flag.workspace_overrides?.[workspaceId];
    if (o === true || o === false) return o;
  }
  switch (flag.targeting) {
    case 'off':
      return false;
    case 'on':
      return true;
    case 'internal':
      return Boolean(workspaceId && internal);
    case 'selected':
      return false;
    case 'limited':
      return Boolean(workspaceId) && Number.isInteger(flag.rollout_percent) && bucket(flag.key, workspaceId) < flag.rollout_percent;
    default:
      return Boolean(flag.enabled);
  }
}

/** Internal = the workspace owner holds an admin role. */
export async function isInternalWorkspace(admin, workspaceId) {
  const { data: ws } = await admin.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
  if (!ws?.owner_id) return false;
  const { data: role } = await admin.from('admin_roles').select('role').eq('user_id', ws.owner_id).maybeSingle();
  return Boolean(role);
}

async function flagRows(admin, keys) {
  // Pre-019 databases have no targeting columns; fall back to the old shape.
  let res = await admin.from('feature_flags').select('key,enabled,workspace_overrides,targeting,rollout_percent').in('key', keys);
  if (res.error) res = await admin.from('feature_flags').select('key,enabled,workspace_overrides').in('key', keys);
  return res.data || [];
}

export async function flagEnabledForWorkspace(admin, key, workspaceId) {
  const [flag] = await flagRows(admin, [key]);
  if (!flag) return false;
  const internal = flag.targeting === 'internal' ? await isInternalWorkspace(admin, workspaceId) : false;
  return decideFlag(flag, { workspaceId, internal });
}

export async function workspaceFlags(admin, workspaceId, keys = WORKSPACE_FLAGS) {
  const rows = await flagRows(admin, [...keys]);
  const needsInternal = rows.some((f) => f.targeting === 'internal');
  const internal = needsInternal ? await isInternalWorkspace(admin, workspaceId) : false;
  const out = {};
  for (const key of keys) out[key] = decideFlag(rows.find((f) => f.key === key), { workspaceId, internal });
  return out;
}

const globalCache = new Map();
/** Platform-wide switch, cached for 30 s per instance so hot paths stay cheap. */
export async function globalFlag(admin, key, { fresh = false } = {}) {
  const hit = globalCache.get(key);
  if (!fresh && hit && hit.until > Date.now()) return hit.value;
  const [flag] = await flagRows(admin, [key]);
  const value = decideFlag(flag, {});
  globalCache.set(key, { value, until: Date.now() + 30_000 });
  return value;
}

export function resetFlagCache() {
  globalCache.clear();
}
