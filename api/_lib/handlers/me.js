import { on } from '../router.js';
import { ApiError, readJson, str } from '../http.js';
import { accountStateForUser } from '../supabase.js';
import { requireUser } from '../auth.js';
import { sha256 } from '../tokens.js';

const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

/** Pending invites addressed to the user's email are accepted automatically on sign-in. */
async function acceptPendingInvites(admin, user) {
  if (!user.email) return 0;
  const { data: invites } = await admin
    .from('workspace_invites')
    .select('id,workspace_id,role,invited_by')
    .ilike('email', user.email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());
  let accepted = 0;
  for (const invite of invites || []) {
    const { error } = await admin
      .from('workspace_members')
      .upsert({ workspace_id: invite.workspace_id, user_id: user.id, role: invite.role, invited_by: invite.invited_by }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
    if (!error) {
      await admin.from('workspace_invites').update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq('id', invite.id);
      accepted += 1;
    }
  }
  return accepted;
}

async function resolveFlags(admin, planId) {
  const { data: flags } = await admin.from('feature_flags').select('key,enabled,plan_overrides');
  const out = {};
  for (const f of flags || []) {
    const override = f.plan_overrides?.[planId];
    out[f.key] = typeof override === 'boolean' ? override : Boolean(f.enabled);
  }
  return out;
}

on('GET', '/api/me', async ({ request }) => {
  const { user, profile, admin } = await requireUser(request);
  await acceptPendingInvites(admin, user);
  const [{ data: memberships }, { data: adminRole }, account] = await Promise.all([
    admin.from('workspace_members').select('role,workspace:workspaces(id,name,slug,owner_id,plan_override,data_retention_days,settings,created_at)').eq('user_id', user.id),
    admin.from('admin_roles').select('role').eq('user_id', user.id).maybeSingle(),
    accountStateForUser(user.id),
  ]);
  const workspaces = [];
  for (const m of memberships || []) {
    if (!m.workspace) continue;
    const { data: planId } = await admin.rpc('workspace_plan', { ws: m.workspace.id });
    const { count: projectCount } = await admin.from('projects').select('id', { count: 'exact', head: true }).eq('workspace_id', m.workspace.id).is('archived_at', null);
    workspaces.push({ ...m.workspace, role: m.role, plan: planId || 'free', project_count: projectCount || 0 });
  }
  workspaces.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const flags = await resolveFlags(admin, account.plan);
  return {
    user: { id: user.id, email: user.email || null, created_at: user.created_at, providers: user.app_metadata?.providers || [user.app_metadata?.provider].filter(Boolean), last_sign_in_at: user.last_sign_in_at },
    profile,
    isAdmin: Boolean(adminRole),
    adminRole: adminRole?.role || null,
    account,
    workspaces,
    flags,
  };
});

on('PATCH', '/api/me', async ({ request }) => {
  const { user, profile, admin } = await requireUser(request);
  const body = await readJson(request);
  const update = {};
  if (body.display_name !== undefined) update.display_name = str(body.display_name, { name: 'Name', max: 60 }) || null;
  if (body.timezone !== undefined) update.timezone = str(body.timezone, { name: 'Timezone', max: 64, pattern: /^[A-Za-z_+\-/0-9]*$/ }) || null;
  if (body.avatar_url !== undefined) {
    const url = str(body.avatar_url, { name: 'Avatar URL', max: 500 });
    if (url && !/^https:\/\//.test(url)) throw new ApiError(400, 'Avatar URL must use https.', 'VALIDATION');
    update.avatar_url = url || null;
  }
  if (body.username !== undefined) {
    const username = str(body.username, { name: 'Username', max: 30 }).toLowerCase();
    if (username && !USERNAME.test(username)) throw new ApiError(400, 'Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.', 'VALIDATION');
    if (username && username !== (profile.username || '').toLowerCase()) {
      const { data: taken } = await admin.from('profiles').select('id').eq('username', username).neq('id', user.id).limit(1);
      if (taken?.length) throw new ApiError(409, 'That username is already taken.', 'USERNAME_TAKEN');
    }
    update.username = username || null;
  }
  if (body.notification_prefs !== undefined) {
    const prefs = body.notification_prefs;
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new ApiError(400, 'Invalid notification preferences.', 'VALIDATION');
    const clean = {};
    for (const key of ['experiment_completed', 'weekly_summary', 'telemetry_alerts', 'product_updates']) if (key in prefs) clean[key] = Boolean(prefs[key]);
    update.notification_prefs = { ...(profile.notification_prefs || {}), ...clean };
  }
  if (body.onboarding !== undefined) {
    const ob = body.onboarding;
    if (!ob || typeof ob !== 'object' || Array.isArray(ob) || JSON.stringify(ob).length > 2000) throw new ApiError(400, 'Invalid onboarding state.', 'VALIDATION');
    update.onboarding = { ...(profile.onboarding || {}), ...ob };
  }
  if (!Object.keys(update).length) throw new ApiError(400, 'Nothing to update.', 'VALIDATION');
  const { data, error } = await admin.from('profiles').update(update).eq('id', user.id).select('*').single();
  if (error) throw error;
  if (update.display_name !== undefined || update.username !== undefined) {
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata || {}), ...(update.display_name !== undefined ? { display_name: update.display_name || '' } : {}), ...(update.username !== undefined ? { username: update.username || '' } : {}) },
    });
  }
  return { profile: data };
});

on('POST', '/api/invites/accept', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const body = await readJson(request);
  const token = str(body?.token, { name: 'Invite token', required: true, max: 200 });
  const { data: invite } = await admin.from('workspace_invites').select('*').eq('token_hash', sha256(token)).maybeSingle();
  if (!invite) throw new ApiError(404, 'This invite link is not valid.', 'INVITE_NOT_FOUND');
  if (invite.accepted_at) throw new ApiError(409, 'This invite was already used.', 'INVITE_USED');
  if (new Date(invite.expires_at) < new Date()) throw new ApiError(410, 'This invite has expired. Ask for a new one.', 'INVITE_EXPIRED');
  if (!user.email || user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new ApiError(403, `This invite was sent to ${invite.email}. Sign in with that address to accept it.`, 'INVITE_EMAIL_MISMATCH');
  }
  const { error } = await admin
    .from('workspace_members')
    .upsert({ workspace_id: invite.workspace_id, user_id: user.id, role: invite.role, invited_by: invite.invited_by }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
  await admin.from('workspace_invites').update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq('id', invite.id);
  const { data: workspace } = await admin.from('workspaces').select('id,name,slug').eq('id', invite.workspace_id).single();
  return { workspace };
});
