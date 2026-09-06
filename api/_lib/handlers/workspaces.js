import { on } from '../router.js';
import { ApiError, readJson, str, num, uuid, slugify } from '../http.js';
import { loadPlan } from '../supabase.js';
import { requireUser, requireWorkspaceRole, roleRank, rateLimit } from '../auth.js';
import { generateInviteToken } from '../tokens.js';
import { appUrl } from '../stripe.js';

const MAX_OWNED_WORKSPACES = 5;

async function uniqueSlug(admin, table, base, scope = null) {
  let slug = base;
  for (let i = 0; i < 8; i += 1) {
    let q = admin.from(table).select('id').eq('slug', slug).limit(1);
    if (scope) q = q.eq('workspace_id', scope);
    const { data } = await q;
    if (!data?.length) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function workspacePlan(admin, workspaceId) {
  const { data: planId } = await admin.rpc('workspace_plan', { ws: workspaceId });
  const plan = await loadPlan(admin, planId || 'free');
  return { planId: planId || 'free', plan };
}

on('POST', '/api/workspaces', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  rateLimit(`ws-create:${user.id}`, { limit: 5, windowMs: 60_000 });
  const body = await readJson(request);
  const name = str(body?.name, { name: 'Workspace name', required: true, min: 2, max: 80 });
  const { count } = await admin.from('workspaces').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
  if ((count || 0) >= MAX_OWNED_WORKSPACES) throw new ApiError(409, `You can own up to ${MAX_OWNED_WORKSPACES} workspaces.`, 'LIMIT_REACHED');
  const slug = await uniqueSlug(admin, 'workspaces', slugify(name));
  const { data: ws, error } = await admin.from('workspaces').insert({ name, slug, owner_id: user.id }).select('*').single();
  if (error) throw error;
  const { error: memberError } = await admin.from('workspace_members').insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' });
  if (memberError) throw memberError;
  return { workspace: { ...ws, role: 'owner', plan: (await workspacePlan(admin, ws.id)).planId, project_count: 0 } };
});

on('PATCH', '/api/workspaces/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'admin');
  const body = await readJson(request);
  const update = {};
  if (body.name !== undefined) update.name = str(body.name, { name: 'Workspace name', required: true, min: 2, max: 80 });
  if (body.data_retention_days !== undefined) update.data_retention_days = num(body.data_retention_days, { name: 'Retention', min: 7, max: 730, integer: true, required: true });
  if (body.settings !== undefined) {
    const s = body.settings && typeof body.settings === 'object' ? body.settings : {};
    const clean = {};
    if (s.quality_gate !== undefined) clean.quality_gate = num(s.quality_gate, { name: 'Quality gate', min: 0.5, max: 1 });
    if (s.max_latency_regression_pct !== undefined) clean.max_latency_regression_pct = num(s.max_latency_regression_pct, { name: 'Latency regression', min: 0, max: 500 });
    if (s.capture_samples_default !== undefined) clean.capture_samples_default = Boolean(s.capture_samples_default);
    const { data: current } = await admin.from('workspaces').select('settings').eq('id', workspaceId).single();
    update.settings = { ...(current?.settings || {}), ...clean };
  }
  if (!Object.keys(update).length) throw new ApiError(400, 'Nothing to update.', 'VALIDATION');
  const { data, error } = await admin.from('workspaces').update(update).eq('id', workspaceId).select('*').single();
  if (error) throw error;
  return { workspace: data };
});

function liveStatus(lastSeen) {
  if (!lastSeen) return 'waiting';
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < 5 * 60_000) return 'live';
  if (age < 24 * 60 * 60_000) return 'idle';
  return 'stale';
}

on('GET', '/api/workspaces/:id/overview', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const days = Math.min(90, Math.max(1, Number(query.get('days')) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: projects } = await admin.from('projects').select('id,name,slug,source_kind,created_at').eq('workspace_id', workspaceId).is('archived_at', null);
  const projectIds = (projects || []).map((p) => p.id);

  const [rollup, daily, rate, { data: connections }, { data: experiments }, { data: opportunities }, plan] = await Promise.all([
    projectIds.length ? admin.rpc('telemetry_rollup', { p_projects: projectIds, p_since: since }) : { data: [] },
    projectIds.length ? admin.rpc('telemetry_daily', { p_projects: projectIds, p_since: since }) : { data: [] },
    projectIds.length ? admin.rpc('telemetry_recent_rate', { p_projects: projectIds, p_window: '5 minutes' }) : { data: [] },
    admin.from('connections').select('id,project_id,kind,name,status,last_seen_at').eq('workspace_id', workspaceId).eq('status', 'active'),
    admin.from('experiments').select('id,project_id,status,strategy,verified_savings_usd,verified_savings_pct,projected_monthly_savings_usd,quality_score,quality_gate,created_at,completed_at,candidate,baseline,opportunity_id').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(200),
    admin.from('opportunities').select('id,project_id,status,title,candidate_strategy,estimated_savings_usd,estimated_savings_pct,confidence,risk,evidence_completeness,current_model,created_at').eq('workspace_id', workspaceId).order('estimated_savings_usd', { ascending: false, nullsFirst: false }).limit(100),
    workspacePlan(admin, workspaceId),
  ]);

  const rows = rollup.data || [];
  const byProvider = new Map();
  const byModel = new Map();
  let requests = 0;
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let errors = 0;
  let costKnown = 0;
  let lastSeen = null;
  for (const r of rows) {
    requests += Number(r.requests);
    cost += Number(r.cost_usd);
    inputTokens += Number(r.input_tokens);
    outputTokens += Number(r.output_tokens);
    errors += Number(r.errors);
    costKnown += Number(r.cost_known);
    if (r.last_seen && (!lastSeen || r.last_seen > lastSeen)) lastSeen = r.last_seen;
    const p = byProvider.get(r.provider) || { provider: r.provider, requests: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, latency_p50_ms: null, weight: 0 };
    p.requests += Number(r.requests);
    p.cost_usd += Number(r.cost_usd);
    p.input_tokens += Number(r.input_tokens);
    p.output_tokens += Number(r.output_tokens);
    if (r.latency_p50_ms !== null) {
      p.latency_p50_ms = ((p.latency_p50_ms || 0) * p.weight + Number(r.latency_p50_ms) * Number(r.requests)) / (p.weight + Number(r.requests));
      p.weight += Number(r.requests);
    }
    byProvider.set(r.provider, p);
    const m = byModel.get(r.model) || { model: r.model, provider: r.provider, requests: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, latency_p50_ms: null, samples: 0 };
    m.requests += Number(r.requests);
    m.cost_usd += Number(r.cost_usd);
    m.input_tokens += Number(r.input_tokens);
    m.output_tokens += Number(r.output_tokens);
    m.samples += Number(r.samples);
    m.latency_p50_ms = r.latency_p50_ms !== null ? Number(r.latency_p50_ms) : m.latency_p50_ms;
    byModel.set(r.model, m);
  }

  const passed = (experiments || []).filter((e) => e.status === 'passed');
  const failed = (experiments || []).filter((e) => e.status === 'failed');
  const verifiedSavings = passed.reduce((acc, e) => acc + Number(e.verified_savings_usd || 0), 0);
  const projectedMonthly = passed.reduce((acc, e) => acc + Number(e.projected_monthly_savings_usd || 0), 0);
  const potential = (opportunities || []).filter((o) => ['open', 'testing', 'needs_evidence'].includes(o.status)).reduce((acc, o) => acc + Number(o.estimated_savings_usd || 0), 0);
  const runtime = {
    status: liveStatus(lastSeen),
    last_seen: lastSeen,
    requests_5m: Number(rate.data?.[0]?.requests || 0),
    errors_5m: Number(rate.data?.[0]?.errors || 0),
    connections: (connections || []).map((c) => ({ ...c, live: liveStatus(c.last_seen_at) })),
  };

  return {
    window_days: days,
    plan,
    projects: projects || [],
    metrics: {
      verified_savings_usd: verifiedSavings,
      projected_monthly_savings_usd: projectedMonthly,
      potential_savings_usd: potential,
      ai_spend_usd: cost,
      cost_coverage: requests ? costKnown / requests : 0,
      requests,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      errors,
      quality_pass_rate: passed.length + failed.length ? passed.length / (passed.length + failed.length) : null,
      experiments_total: (experiments || []).length,
      experiments_passed: passed.length,
      experiments_failed: failed.length,
      opportunities_open: (opportunities || []).filter((o) => o.status === 'open').length,
      connected_projects: (projects || []).length,
    },
    providers: [...byProvider.values()].map(({ weight: _w, ...p }) => p).sort((a, b) => b.cost_usd - a.cost_usd),
    models: [...byModel.values()].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 12),
    daily: (daily.data || []).map((d) => ({ day: d.day, requests: Number(d.requests), errors: Number(d.errors), cost_usd: Number(d.cost_usd) })),
    runtime,
    recent_experiments: (experiments || []).slice(0, 8),
    top_opportunities: (opportunities || []).filter((o) => o.status !== 'dismissed').slice(0, 6),
  };
});

on('GET', '/api/workspaces/:id/members', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  const role = await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const { data: members } = await admin
    .from('workspace_members')
    .select('user_id,role,created_at,last_active_at,invited_by,profile:profiles!workspace_members_user_id_fkey(email,display_name,username,avatar_url,last_active_at)')
    .eq('workspace_id', workspaceId);
  let invites = [];
  if (roleRank(role) >= roleRank('admin')) {
    const { data } = await admin.from('workspace_invites').select('id,email,role,expires_at,created_at,invited_by').eq('workspace_id', workspaceId).is('accepted_at', null).gt('expires_at', new Date().toISOString());
    invites = data || [];
  }
  const { plan } = await workspacePlan(admin, workspaceId);
  return {
    role,
    members: (members || []).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.created_at,
      last_active_at: m.profile?.last_active_at || m.last_active_at,
      email: m.profile?.email || null,
      display_name: m.profile?.display_name || null,
      username: m.profile?.username || null,
      avatar_url: m.profile?.avatar_url || null,
      status: 'active',
    })).sort((a, b) => roleRank(b.role) - roleRank(a.role)),
    invites,
    seat_limit: plan.limits?.team_members ?? null,
  };
});

const ROLES = ['admin', 'member', 'viewer'];

on('POST', '/api/workspaces/:id/invites', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  const callerRole = await requireWorkspaceRole(admin, workspaceId, user.id, 'admin');
  rateLimit(`invite:${workspaceId}`, { limit: 20, windowMs: 60 * 60_000 });
  const body = await readJson(request);
  const email = str(body?.email, { name: 'Email', required: true, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address.', 'VALIDATION');
  const role = ROLES.includes(body?.role) ? body.role : 'member';
  if (role === 'admin' && callerRole !== 'owner') throw new ApiError(403, 'Only the workspace owner can grant the admin role.', 'FORBIDDEN');

  const { plan } = await workspacePlan(admin, workspaceId);
  const seatLimit = plan.limits?.team_members;
  const { count: memberCount } = await admin.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  const { count: inviteCount } = await admin.from('workspace_invites').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).is('accepted_at', null);
  if (seatLimit !== null && seatLimit !== undefined && (memberCount || 0) + (inviteCount || 0) >= seatLimit) {
    throw new ApiError(402, `The ${plan.name} plan includes ${seatLimit} seat${seatLimit === 1 ? '' : 's'}. Upgrade to invite more people.`, 'PLAN_LIMIT', { limit: 'team_members', plan: plan.id });
  }

  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing) {
    const { data: already } = await admin.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', existing.id).maybeSingle();
    if (already) throw new ApiError(409, 'That person is already a member of this workspace.', 'ALREADY_MEMBER');
    const { error } = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: existing.id, role, invited_by: user.id });
    if (error) throw error;
    return { added: true, email, role };
  }

  const { token, hash } = generateInviteToken();
  const { data: invite, error } = await admin
    .from('workspace_invites')
    .upsert({ workspace_id: workspaceId, email, role, token_hash: hash, invited_by: user.id, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }, { onConflict: 'token_hash' })
    .select('id,email,role,expires_at,created_at')
    .single();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, 'An invite for that email is already pending.', 'INVITE_PENDING');
    throw error;
  }
  // No transactional email provider is configured on this deployment; the
  // inviter shares the link. The invitee is also added automatically when
  // they sign in with the invited address.
  return { added: false, invite, invite_url: `${appUrl()}/invite/${token}`, delivery: 'share_link' };
});

on('DELETE', '/api/workspaces/:id/invites/:inviteId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'admin');
  await admin.from('workspace_invites').delete().eq('id', uuid(params.inviteId, 'invite')).eq('workspace_id', workspaceId);
  return { ok: true };
});

on('PATCH', '/api/workspaces/:id/members/:userId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  const targetId = uuid(params.userId, 'user');
  const callerRole = await requireWorkspaceRole(admin, workspaceId, user.id, 'admin');
  const body = await readJson(request);
  const role = ROLES.includes(body?.role) ? body.role : null;
  if (!role) throw new ApiError(400, 'Role must be admin, member or viewer.', 'VALIDATION');
  const { data: target } = await admin.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', targetId).maybeSingle();
  if (!target) throw new ApiError(404, 'Member not found.', 'NOT_FOUND');
  if (target.role === 'owner') throw new ApiError(403, 'The owner role cannot be changed here.', 'FORBIDDEN');
  if ((role === 'admin' || target.role === 'admin') && callerRole !== 'owner') throw new ApiError(403, 'Only the workspace owner can grant or revoke the admin role.', 'FORBIDDEN');
  const { error } = await admin.from('workspace_members').update({ role }).eq('workspace_id', workspaceId).eq('user_id', targetId);
  if (error) throw error;
  return { ok: true, role };
});

on('DELETE', '/api/workspaces/:id/members/:userId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  const targetId = uuid(params.userId, 'user');
  const callerRole = await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const self = targetId === user.id;
  if (!self && roleRank(callerRole) < roleRank('admin')) throw new ApiError(403, 'This action requires the admin role.', 'FORBIDDEN');
  const { data: target } = await admin.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', targetId).maybeSingle();
  if (!target) throw new ApiError(404, 'Member not found.', 'NOT_FOUND');
  if (target.role === 'owner') throw new ApiError(403, 'The workspace owner cannot be removed.', 'FORBIDDEN');
  if (!self && target.role === 'admin' && callerRole !== 'owner') throw new ApiError(403, 'Only the workspace owner can remove an admin.', 'FORBIDDEN');
  const { error } = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', targetId);
  if (error) throw error;
  return { ok: true };
});

on('GET', '/api/workspaces/:id/usage', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const { data: ws } = await admin.from('workspaces').select('owner_id,plan_override').eq('id', workspaceId).single();
  const { planId, plan } = await workspacePlan(admin, workspaceId);
  const [{ data: credit }, { data: sub }, rollup, { data: recent }, { data: projects }, { data: allPlans }] = await Promise.all([
    admin.from('credit_balances').select('included_usd,used_usd,period_start,period_end').eq('user_id', ws.owner_id).maybeSingle(),
    admin.from('subscriptions').select('plan,status,current_period_end,cancel_at_period_end,stripe_subscription_id').eq('user_id', ws.owner_id).maybeSingle(),
    admin.rpc('usage_rollup', { p_workspace: workspaceId, p_since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }),
    admin.from('usage_events').select('id,project_id,user_id,operation,credits_usd,provider,model,created_at,metadata').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(40),
    admin.from('projects').select('id,name').eq('workspace_id', workspaceId),
    admin.from('plans').select('id,name,monthly_price_cents,visible,contact_sales,sort_order,limits').eq('visible', true).order('sort_order'),
  ]);
  const projectNames = Object.fromEntries((projects || []).map((p) => [p.id, p.name]));
  const byProject = {};
  const byOperation = {};
  const byProvider = {};
  for (const r of rollup.data || []) {
    const c = Number(r.credits_usd);
    const pn = projectNames[r.project_id] || 'Workspace';
    byProject[pn] = (byProject[pn] || 0) + c;
    byOperation[r.operation] = (byOperation[r.operation] || 0) + c;
    if (r.provider) byProvider[r.provider] = (byProvider[r.provider] || 0) + c;
  }
  const included = Number(credit?.included_usd ?? plan.limits?.credits_usd ?? 5);
  const used = Number(credit?.used_usd ?? 0);
  const upgrade = (allPlans || []).filter((p) => !p.contact_sales && p.sort_order > (allPlans || []).find((x) => x.id === planId)?.sort_order);
  return {
    plan: { id: planId, name: plan.name, limits: plan.limits, override: ws.plan_override || null },
    subscription: sub ? { status: sub.status, current_period_end: sub.current_period_end, cancel_at_period_end: sub.cancel_at_period_end, stripe_managed: Boolean(sub.stripe_subscription_id) } : null,
    credits: { included_usd: included, used_usd: used, remaining_usd: Math.max(0, included - used), period_start: credit?.period_start || null, period_end: credit?.period_end || null },
    breakdown: { by_project: byProject, by_operation: byOperation, by_provider: byProvider },
    recent: (recent || []).map((r) => ({ ...r, project_name: projectNames[r.project_id] || null })),
    upgrade_options: upgrade.map((p) => ({ id: p.id, name: p.name, monthly_price_cents: p.monthly_price_cents })),
    billing_owner_id: ws.owner_id,
    is_billing_owner: ws.owner_id === user.id,
  };
});
