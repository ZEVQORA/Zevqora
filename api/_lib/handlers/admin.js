/**
 * Internal admin control centre. Every route requires an admin_roles row for
 * the caller (server-enforced), and every mutation writes admin_audit_log.
 */
import { on } from '../router.js';
import { ApiError, readJson, str, num, uuid } from '../http.js';
import { requireUser, requireAdmin, auditAdmin, rateLimit } from '../auth.js';
import { invalidatePricingCache } from '../pricing.js';
import { openRouterConfigured } from '../openrouter.js';
import { stripeConfigured } from '../stripe.js';

async function adminContext(request, opts) {
  const ctx = await requireUser(request);
  const role = await requireAdmin(ctx.admin, ctx.user.id, opts);
  rateLimit(`admin:${ctx.user.id}`, { limit: 120, windowMs: 60_000 });
  return { ...ctx, adminRole: role };
}

function stripHtml(value) {
  return String(value).replace(/[<>]/g, '');
}

function safeHref(value, name = 'Link') {
  const v = str(value, { name, max: 300 });
  if (!v) return '';
  if (/^(\/[^\s]*|mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(v)) return v;
  throw new ApiError(400, `${name} must be a relative path, https URL or mailto link.`, 'VALIDATION');
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
on('GET', '/api/admin/overview', async ({ request }) => {
  const { admin } = await adminContext(request);
  const [{ data: counts }, { data: audit }, { data: errors }, { data: runs }] = await Promise.all([
    admin.rpc('admin_counts'),
    admin.from('admin_audit_log').select('id,admin_id,action,target_type,target_id,metadata,created_at').order('created_at', { ascending: false }).limit(12),
    admin.from('experiments').select('id,workspace_id,project_id,status,strategy,error,created_at').in('status', ['error', 'failed']).order('created_at', { ascending: false }).limit(10),
    admin.from('analysis_runs').select('id,workspace_id,project_id,status,events_analyzed,opportunities_found,created_at,error').order('created_at', { ascending: false }).limit(10),
  ]);
  const adminIds = [...new Set((audit || []).map((a) => a.admin_id).filter(Boolean))];
  const { data: adminProfiles } = adminIds.length ? await admin.from('profiles').select('id,email,display_name').in('id', adminIds) : { data: [] };
  const names = Object.fromEntries((adminProfiles || []).map((p) => [p.id, p.email || p.display_name]));
  return {
    counts: counts || {},
    health: { api: 'ok', cloud_replay: openRouterConfigured() ? 'configured' : 'not_configured', stripe: stripeConfigured() ? 'configured' : 'not_configured', database: 'ok', time: new Date().toISOString() },
    recent_audit: (audit || []).map((a) => ({ ...a, admin_email: names[a.admin_id] || null })),
    recent_errors: errors || [],
    recent_runs: runs || [],
  };
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
on('GET', '/api/admin/users', async ({ request, query }) => {
  const { admin } = await adminContext(request);
  const q = str(query.get('q'), { max: 100 });
  const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 50));
  let req = admin.from('profiles').select('id,email,display_name,username,avatar_url,created_at,last_active_at,suspended_at').order('created_at', { ascending: false }).limit(limit);
  if (q) req = req.or(`email.ilike.%${q.replace(/[%,]/g, '')}%,display_name.ilike.%${q.replace(/[%,]/g, '')}%,username.ilike.%${q.replace(/[%,]/g, '')}%`);
  const { data: profiles, error } = await req;
  if (error) throw error;
  const ids = (profiles || []).map((p) => p.id);
  const [{ data: subs }, { data: credits }, { data: admins }, { data: owned }] = ids.length
    ? await Promise.all([
        admin.from('subscriptions').select('user_id,plan,status,stripe_subscription_id').in('user_id', ids),
        admin.from('credit_balances').select('user_id,included_usd,used_usd,period_end').in('user_id', ids),
        admin.from('admin_roles').select('user_id,role').in('user_id', ids),
        admin.from('workspaces').select('id,owner_id').in('owner_id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const by = (rows, key = 'user_id') => Object.fromEntries((rows || []).map((r) => [r[key], r]));
  const subBy = by(subs);
  const creditBy = by(credits);
  const adminBy = by(admins);
  const ownedCount = {};
  for (const w of owned || []) ownedCount[w.owner_id] = (ownedCount[w.owner_id] || 0) + 1;
  return {
    users: (profiles || []).map((p) => ({
      ...p,
      plan: subBy[p.id]?.plan || 'free',
      subscription_status: subBy[p.id]?.status || 'active',
      stripe_managed: Boolean(subBy[p.id]?.stripe_subscription_id),
      credits: creditBy[p.id] ? { included_usd: Number(creditBy[p.id].included_usd), used_usd: Number(creditBy[p.id].used_usd), period_end: creditBy[p.id].period_end } : null,
      admin_role: adminBy[p.id]?.role || null,
      workspaces_owned: ownedCount[p.id] || 0,
    })),
  };
});

on('GET', '/api/admin/users/:id', async ({ request, params }) => {
  const { admin } = await adminContext(request);
  const userId = uuid(params.id, 'user');
  const [{ data: profile }, { data: authUser }, { data: sub }, { data: credit }, { data: memberships }, { data: usage }, { data: ledger }, { data: adminRole }] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from('subscriptions').select('plan,status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id').eq('user_id', userId).maybeSingle(),
    admin.from('credit_balances').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('workspace_members').select('role,created_at,workspace:workspaces(id,name,slug,owner_id,plan_override)').eq('user_id', userId),
    admin.from('usage_events').select('id,workspace_id,project_id,operation,credits_usd,provider,model,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    admin.from('credit_ledger').select('id,kind,delta_usd,included_before,included_after,used_before,used_after,reason,actor_id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    admin.from('admin_roles').select('role,created_at').eq('user_id', userId).maybeSingle(),
  ]);
  if (!profile) throw new ApiError(404, 'User not found.', 'NOT_FOUND');
  const u = authUser?.user;
  const wsIds = (memberships || []).map((m) => m.workspace?.id).filter(Boolean);
  const { data: projects } = wsIds.length ? await admin.from('projects').select('id,name,workspace_id,created_at,archived_at').in('workspace_id', wsIds) : { data: [] };
  return {
    profile,
    auth: u ? { created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, providers: u.app_metadata?.providers || [], email_confirmed_at: u.email_confirmed_at, banned_until: u.banned_until || null } : null,
    subscription: sub ? { ...sub, stripe_customer_id: sub.stripe_customer_id ? 'linked' : null, stripe_subscription_id: sub.stripe_subscription_id ? 'linked' : null, stripe_managed: Boolean(sub.stripe_subscription_id) } : null,
    credits: credit,
    memberships: (memberships || []).map((m) => ({ role: m.role, joined_at: m.created_at, workspace: m.workspace })),
    projects: projects || [],
    usage: usage || [],
    ledger: ledger || [],
    admin_role: adminRole || null,
  };
});

on('POST', '/api/admin/users/:id/suspend', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const userId = uuid(params.id, 'user');
  if (userId === user.id) throw new ApiError(400, 'You cannot suspend your own account.', 'VALIDATION');
  const { data: targetAdmin } = await admin.from('admin_roles').select('role').eq('user_id', userId).maybeSingle();
  if (targetAdmin) throw new ApiError(403, 'Remove the admin role before suspending this account.', 'FORBIDDEN');
  const body = await readJson(request);
  const reason = str(body?.reason, { name: 'Reason', required: true, min: 3, max: 300 });
  const { error } = await admin.from('profiles').update({ suspended_at: new Date().toISOString(), suspended_reason: reason }).eq('id', userId);
  if (error) throw error;
  await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  await auditAdmin(admin, user.id, 'user.suspend', 'user', userId, { reason });
  return { ok: true };
});

on('POST', '/api/admin/users/:id/unsuspend', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const userId = uuid(params.id, 'user');
  const { error } = await admin.from('profiles').update({ suspended_at: null, suspended_reason: null }).eq('id', userId);
  if (error) throw error;
  await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  await auditAdmin(admin, user.id, 'user.unsuspend', 'user', userId, {});
  return { ok: true };
});

on('POST', '/api/admin/users/:id/plan', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const userId = uuid(params.id, 'user');
  const body = await readJson(request);
  const planId = str(body?.plan, { name: 'Plan', required: true, max: 30 }).toLowerCase();
  const { data: plan } = await admin.from('plans').select('id,name,limits').eq('id', planId).maybeSingle();
  if (!plan) throw new ApiError(400, 'Unknown plan.', 'VALIDATION');
  const { data: sub } = await admin.from('subscriptions').select('plan,status,stripe_subscription_id').eq('user_id', userId).maybeSingle();
  if (sub?.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(sub.status)) throw new ApiError(409, 'This subscription is managed by Stripe. Change it from the Stripe dashboard so billing stays consistent.', 'STRIPE_MANAGED');
  const { error } = await admin.from('subscriptions').upsert({ user_id: userId, plan: planId, status: 'active', updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  const included = Number(plan.limits?.credits_usd ?? 5);
  const { data: before } = await admin.from('credit_balances').select('included_usd,used_usd').eq('user_id', userId).maybeSingle();
  await admin.rpc('adjust_credits', { p_user: userId, p_delta_included: included - Number(before?.included_usd ?? 0), p_delta_used: 0, p_kind: 'plan_change', p_reason: `Admin plan change ${sub?.plan || 'free'} → ${planId}`, p_actor: user.id, p_metadata: { plan: planId } });
  await auditAdmin(admin, user.id, 'user.plan_change', 'user', userId, { from: sub?.plan || 'free', to: planId, included_credit_usd: included });
  return { ok: true, plan: planId };
});

on('POST', '/api/admin/users/:id/credits', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const userId = uuid(params.id, 'user');
  const body = await readJson(request);
  const deltaIncluded = num(body?.delta_included, { name: 'Included delta', min: -10000, max: 10000 }) ?? 0;
  const deltaUsed = num(body?.delta_used, { name: 'Used delta', min: -10000, max: 10000 }) ?? 0;
  const reason = str(body?.reason, { name: 'Reason', required: true, min: 3, max: 300 });
  if (!deltaIncluded && !deltaUsed) throw new ApiError(400, 'Provide a non-zero adjustment.', 'VALIDATION');
  const kind = deltaIncluded > 0 && !deltaUsed ? 'grant' : 'correction';
  const { data, error } = await admin.rpc('adjust_credits', { p_user: userId, p_delta_included: deltaIncluded, p_delta_used: deltaUsed, p_kind: kind, p_reason: reason, p_actor: user.id, p_metadata: { source: 'admin_panel' } });
  if (error) throw error;
  await auditAdmin(admin, user.id, 'user.credits_adjust', 'user', userId, { delta_included: deltaIncluded, delta_used: deltaUsed, reason, after: data });
  return { ok: true, balance: data };
});

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------
on('GET', '/api/admin/workspaces', async ({ request, query }) => {
  const { admin } = await adminContext(request);
  const q = str(query.get('q'), { max: 100 }).replace(/[%,]/g, '');
  let req = admin.from('workspaces').select('id,name,slug,owner_id,plan_override,data_retention_days,created_at').order('created_at', { ascending: false }).limit(100);
  if (q) req = req.or(`name.ilike.%${q}%,slug.ilike.%${q}%`);
  const { data: workspaces } = await req;
  const ids = (workspaces || []).map((w) => w.id);
  const ownerIds = [...new Set((workspaces || []).map((w) => w.owner_id))];
  const [{ data: owners }, { data: members }, { data: projects }, { data: subs }] = ids.length
    ? await Promise.all([
        admin.from('profiles').select('id,email,display_name').in('id', ownerIds),
        admin.from('workspace_members').select('workspace_id').in('workspace_id', ids),
        admin.from('projects').select('workspace_id').in('workspace_id', ids).is('archived_at', null),
        admin.from('subscriptions').select('user_id,plan').in('user_id', ownerIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const count = (rows) => rows.reduce((acc, r) => ((acc[r.workspace_id] = (acc[r.workspace_id] || 0) + 1), acc), {});
  const memberCount = count(members || []);
  const projectCount = count(projects || []);
  const ownerBy = Object.fromEntries((owners || []).map((o) => [o.id, o]));
  const subBy = Object.fromEntries((subs || []).map((s) => [s.user_id, s.plan]));
  return {
    workspaces: (workspaces || []).map((w) => ({ ...w, owner: ownerBy[w.owner_id] || null, members: memberCount[w.id] || 0, projects: projectCount[w.id] || 0, plan: w.plan_override || subBy[w.owner_id] || 'free' })),
  };
});

on('GET', '/api/admin/workspaces/:id', async ({ request, params }) => {
  const { admin } = await adminContext(request);
  const workspaceId = uuid(params.id, 'workspace');
  const { data: ws } = await admin.from('workspaces').select('*').eq('id', workspaceId).maybeSingle();
  if (!ws) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
  const [{ data: planId }, { data: owner }, { data: members }, { data: projects }, { data: connections }, { data: usage }, { data: runs }, { data: experiments }, { data: sub }, { data: credit }] = await Promise.all([
    admin.rpc('workspace_plan', { ws: workspaceId }),
    admin.from('profiles').select('id,email,display_name').eq('id', ws.owner_id).maybeSingle(),
    admin.from('workspace_members').select('user_id,role,created_at,profile:profiles!workspace_members_user_id_fkey(email,display_name)').eq('workspace_id', workspaceId),
    admin.from('projects').select('id,name,slug,source_kind,created_at,archived_at').eq('workspace_id', workspaceId),
    admin.from('connections').select('id,project_id,kind,name,status,token_prefix,created_at,last_seen_at,revoked_at').eq('workspace_id', workspaceId),
    admin.rpc('usage_rollup', { p_workspace: workspaceId, p_since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }),
    admin.from('analysis_runs').select('id,project_id,status,events_analyzed,opportunities_found,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(10),
    admin.from('experiments').select('id,project_id,status,strategy,verified_savings_pct,credits_usd,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(10),
    admin.from('subscriptions').select('plan,status,stripe_subscription_id,current_period_end').eq('user_id', ws.owner_id).maybeSingle(),
    admin.from('credit_balances').select('included_usd,used_usd,period_end').eq('user_id', ws.owner_id).maybeSingle(),
  ]);
  return {
    workspace: ws,
    plan: planId || 'free',
    owner,
    members: (members || []).map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.created_at, email: m.profile?.email, display_name: m.profile?.display_name })),
    projects: projects || [],
    connections: connections || [],
    usage_30d: usage || [],
    recent_runs: runs || [],
    recent_experiments: experiments || [],
    subscription: sub ? { plan: sub.plan, status: sub.status, stripe_managed: Boolean(sub.stripe_subscription_id), current_period_end: sub.current_period_end } : null,
    credits: credit,
  };
});

on('POST', '/api/admin/workspaces/:id/plan-override', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const workspaceId = uuid(params.id, 'workspace');
  const body = await readJson(request);
  const planId = body?.plan === null || body?.plan === '' ? null : str(body?.plan, { name: 'Plan', max: 30 }).toLowerCase();
  if (planId) {
    const { data: plan } = await admin.from('plans').select('id').eq('id', planId).maybeSingle();
    if (!plan) throw new ApiError(400, 'Unknown plan.', 'VALIDATION');
  }
  const { data: before } = await admin.from('workspaces').select('plan_override').eq('id', workspaceId).maybeSingle();
  if (!before) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
  const { error } = await admin.from('workspaces').update({ plan_override: planId }).eq('id', workspaceId);
  if (error) throw error;
  await auditAdmin(admin, user.id, 'workspace.plan_override', 'workspace', workspaceId, { from: before.plan_override, to: planId });
  return { ok: true, plan_override: planId };
});

// ---------------------------------------------------------------------------
// Plans (single trusted pricing source)
// ---------------------------------------------------------------------------
on('GET', '/api/admin/plans', async ({ request }) => {
  const { admin } = await adminContext(request);
  const { data } = await admin.from('plans').select('*').order('sort_order');
  return { plans: data || [] };
});

const PLAN_LIMIT_KEYS = ['projects', 'credits_usd', 'replay_samples', 'team_members', 'telemetry_retention_days', 'github', 'pdf_export'];

on('PUT', '/api/admin/plans/:id', async ({ request, params }) => {
  const { admin, user, adminRole } = await adminContext(request);
  const planId = str(params.id, { name: 'Plan id', required: true, max: 30, pattern: /^[a-z][a-z0-9_-]{1,30}$/ });
  const body = await readJson(request);
  const { data: before } = await admin.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!before && adminRole !== 'superadmin') throw new ApiError(403, 'Only a superadmin can create a new plan.', 'FORBIDDEN');
  const row = { id: planId, updated_by: user.id, updated_at: new Date().toISOString() };
  if (body.name !== undefined) row.name = stripHtml(str(body.name, { name: 'Name', required: true, min: 2, max: 40 }));
  if (body.tagline !== undefined) row.tagline = stripHtml(str(body.tagline, { name: 'Tagline', max: 120 }));
  if (body.description !== undefined) row.description = stripHtml(str(body.description, { name: 'Description', max: 400 }));
  if (body.monthly_price_cents !== undefined) row.monthly_price_cents = num(body.monthly_price_cents, { name: 'Monthly price', min: 0, max: 10_000_000, integer: true, required: true });
  if (body.annual_discount_pct !== undefined) row.annual_discount_pct = num(body.annual_discount_pct, { name: 'Annual discount', min: 0, max: 90, integer: true, required: true });
  if (body.features !== undefined) {
    if (!Array.isArray(body.features) || body.features.length > 20) throw new ApiError(400, 'Features must be a list of up to 20 items.', 'VALIDATION');
    row.features = body.features.map((f) => stripHtml(str(f, { name: 'Feature', required: true, max: 120 })));
  }
  if (body.limits !== undefined) {
    if (!body.limits || typeof body.limits !== 'object') throw new ApiError(400, 'Limits must be an object.', 'VALIDATION');
    const limits = { ...(before?.limits || {}) };
    for (const key of PLAN_LIMIT_KEYS) {
      if (!(key in body.limits)) continue;
      const v = body.limits[key];
      if (key === 'github' || key === 'pdf_export') limits[key] = Boolean(v);
      else if (v === null || v === '') limits[key] = null;
      else limits[key] = num(v, { name: key, min: 0, max: 1_000_000, integer: key !== 'credits_usd', required: true });
    }
    row.limits = limits;
  }
  for (const flag of ['visible', 'popular', 'is_default', 'contact_sales']) if (body[flag] !== undefined) row[flag] = Boolean(body[flag]);
  if (body.cta_label !== undefined) row.cta_label = stripHtml(str(body.cta_label, { name: 'CTA label', required: true, max: 40 }));
  if (body.cta_href !== undefined) row.cta_href = safeHref(body.cta_href, 'CTA link') || '/signup';
  if (body.sort_order !== undefined) row.sort_order = num(body.sort_order, { name: 'Sort order', min: 0, max: 1000, integer: true, required: true });
  if (body.stripe_monthly_price_id !== undefined) row.stripe_monthly_price_id = str(body.stripe_monthly_price_id, { name: 'Stripe monthly price', max: 80, pattern: /^(price_[A-Za-z0-9]+)?$/ }) || null;
  if (body.stripe_annual_price_id !== undefined) row.stripe_annual_price_id = str(body.stripe_annual_price_id, { name: 'Stripe annual price', max: 80, pattern: /^(price_[A-Za-z0-9]+)?$/ }) || null;
  if (!before && !row.name) throw new ApiError(400, 'A new plan needs a name.', 'VALIDATION');
  if (row.is_default) await admin.from('plans').update({ is_default: false }).neq('id', planId);
  if (row.popular) await admin.from('plans').update({ popular: false }).neq('id', planId);
  const { data, error } = await admin.from('plans').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  const changed = Object.keys(row).filter((k) => !['id', 'updated_by', 'updated_at'].includes(k) && JSON.stringify(before?.[k]) !== JSON.stringify(data[k]));
  await auditAdmin(admin, user.id, before ? 'plan.update' : 'plan.create', 'plan', planId, { changed, before: Object.fromEntries(changed.map((k) => [k, before?.[k] ?? null])), after: Object.fromEntries(changed.map((k) => [k, data[k]])) });
  return { plan: data };
});

// ---------------------------------------------------------------------------
// Site content (structured, validated per key)
// ---------------------------------------------------------------------------
on('GET', '/api/admin/site-content', async ({ request }) => {
  const { admin } = await adminContext(request);
  const { data } = await admin.from('site_content').select('*').order('key');
  return { content: data || [] };
});

function validateContent(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Content must be an object.', 'VALIDATION');
  const s = (v, name, max, required = false) => stripHtml(str(v, { name, max, required }));
  const cta = (v, name) => ({ label: s(v?.label, `${name} label`, 40, true), href: safeHref(v?.href, `${name} link`) || '/' });
  switch (key) {
    case 'hero':
      return {
        announcement: value.announcement ? s(value.announcement, 'Announcement', 160) : null,
        announcement_href: value.announcement_href ? safeHref(value.announcement_href, 'Announcement link') : null,
        headline: s(value.headline, 'Headline', 80, true),
        subheadline: s(value.subheadline, 'Subheadline', 120, true),
        supporting: s(value.supporting, 'Supporting text', 400),
        primary_cta: cta(value.primary_cta, 'Primary CTA'),
        secondary_cta: cta(value.secondary_cta, 'Secondary CTA'),
        trust_line: s(value.trust_line, 'Trust line', 120),
      };
    case 'proof': {
      const block = (v, name) => ({ cost_reduction: s(v?.cost_reduction, `${name} cost reduction`, 20, true), quality: s(v?.quality, `${name} quality`, 20, true), quality_floor: s(v?.quality_floor, `${name} floor`, 20, true), reason: s(v?.reason, `${name} reason`, 60), ci95: s(v?.ci95, `${name} CI`, 60) });
      return { kind: s(value.kind, 'Kind', 80, true), cases: num(value.cases, { name: 'Cases', min: 1, max: 100000, integer: true, required: true }), rejected: block(value.rejected, 'Rejected'), verified: block(value.verified, 'Verified'), qualifier: s(value.qualifier, 'Qualifier', 400, true) };
    }
    case 'status':
      return { banner: value.banner ? s(value.banner, 'Banner', 200) : null, public_status: ['operational', 'degraded', 'maintenance'].includes(value.public_status) ? value.public_status : 'operational' };
    case 'contact': {
      const email = s(value.email, 'Email', 120, true);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Contact email is invalid.', 'VALIDATION');
      return { email };
    }
    default:
      throw new ApiError(400, 'Unknown content key.', 'VALIDATION');
  }
}

on('PUT', '/api/admin/site-content/:key', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const key = str(params.key, { name: 'Key', required: true, max: 40, pattern: /^[a-z][a-z0-9_]{1,40}$/ });
  const body = await readJson(request);
  const value = validateContent(key, body?.value ?? body);
  const { data: before } = await admin.from('site_content').select('value').eq('key', key).maybeSingle();
  const { data, error } = await admin.from('site_content').upsert({ key, value, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select('*').single();
  if (error) throw error;
  await auditAdmin(admin, user.id, 'site_content.update', 'site_content', key, { before: before?.value ?? null, after: value });
  return { content: data };
});

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------
on('GET', '/api/admin/feature-flags', async ({ request }) => {
  const { admin } = await adminContext(request);
  const { data } = await admin.from('feature_flags').select('*').order('key');
  return { flags: data || [] };
});

on('PUT', '/api/admin/feature-flags/:key', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const key = str(params.key, { name: 'Key', required: true, max: 40, pattern: /^[a-z][a-z0-9_]{1,40}$/ });
  const body = await readJson(request);
  const { data: before } = await admin.from('feature_flags').select('*').eq('key', key).maybeSingle();
  if (!before) throw new ApiError(404, 'Unknown flag.', 'NOT_FOUND');
  const row = { updated_by: user.id, updated_at: new Date().toISOString() };
  if (body.enabled !== undefined) row.enabled = Boolean(body.enabled);
  if (body.description !== undefined) row.description = stripHtml(str(body.description, { name: 'Description', max: 200 }));
  const cleanOverrides = (input, validate) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Overrides must be an object.', 'VALIDATION');
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (!validate(k)) throw new ApiError(400, `Invalid override key: ${k}`, 'VALIDATION');
      if (v === null) continue;
      out[k] = Boolean(v);
    }
    return out;
  };
  if (body.plan_overrides !== undefined) row.plan_overrides = cleanOverrides(body.plan_overrides, (k) => /^[a-z][a-z0-9_-]{1,30}$/.test(k));
  if (body.workspace_overrides !== undefined) row.workspace_overrides = cleanOverrides(body.workspace_overrides, (k) => /^[0-9a-f-]{36}$/i.test(k));
  const { data, error } = await admin.from('feature_flags').update(row).eq('key', key).select('*').single();
  if (error) throw error;
  await auditAdmin(admin, user.id, 'feature_flag.update', 'feature_flag', key, { before: { enabled: before.enabled, plan_overrides: before.plan_overrides }, after: { enabled: data.enabled, plan_overrides: data.plan_overrides } });
  return { flag: data };
});

// ---------------------------------------------------------------------------
// Model pricing
// ---------------------------------------------------------------------------
on('GET', '/api/admin/model-pricing', async ({ request }) => {
  const { admin } = await adminContext(request);
  const { data } = await admin.from('model_pricing').select('*').order('provider').order('model');
  return { pricing: data || [] };
});

on('PUT', '/api/admin/model-pricing/:model', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const model = str(params.model, { name: 'Model', required: true, max: 120, pattern: /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/ });
  const body = await readJson(request);
  const { data: before } = await admin.from('model_pricing').select('*').eq('model', model).maybeSingle();
  const row = { model, provider: model.split('/')[0], updated_by: user.id, updated_at: new Date().toISOString() };
  if (body.input_per_million !== undefined) row.input_per_million = num(body.input_per_million, { name: 'Input price', min: 0, max: 10000, required: true });
  if (body.output_per_million !== undefined) row.output_per_million = num(body.output_per_million, { name: 'Output price', min: 0, max: 10000, required: true });
  if (body.cached_input_per_million !== undefined) row.cached_input_per_million = body.cached_input_per_million === null ? null : num(body.cached_input_per_million, { name: 'Cached input price', min: 0, max: 10000 });
  if (body.tier !== undefined) {
    if (!['frontier', 'standard', 'small', 'embedding'].includes(body.tier)) throw new ApiError(400, 'Invalid tier.', 'VALIDATION');
    row.tier = body.tier;
  }
  if (body.source !== undefined) row.source = stripHtml(str(body.source, { name: 'Source', max: 120 })) || 'admin entry';
  if (body.active !== undefined) row.active = Boolean(body.active);
  if (!before && (row.input_per_million === undefined || row.output_per_million === undefined)) throw new ApiError(400, 'New pricing rows need input and output prices.', 'VALIDATION');
  row.retrieved_at = new Date().toISOString();
  const { data, error } = await admin.from('model_pricing').upsert(row, { onConflict: 'model' }).select('*').single();
  if (error) throw error;
  invalidatePricingCache();
  await auditAdmin(admin, user.id, before ? 'model_pricing.update' : 'model_pricing.create', 'model_pricing', model, { before: before ? { input: before.input_per_million, output: before.output_per_million } : null, after: { input: data.input_per_million, output: data.output_per_million } });
  return { pricing: data };
});

// ---------------------------------------------------------------------------
// Audit log + admin roster
// ---------------------------------------------------------------------------
on('GET', '/api/admin/audit-log', async ({ request, query }) => {
  const { admin } = await adminContext(request);
  const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 100));
  const { data } = await admin.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  const ids = [...new Set((data || []).map((a) => a.admin_id).filter(Boolean))];
  const { data: profiles } = ids.length ? await admin.from('profiles').select('id,email,display_name').in('id', ids) : { data: [] };
  const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.email || p.display_name]));
  return { entries: (data || []).map((a) => ({ ...a, admin_email: names[a.admin_id] || null })) };
});

on('GET', '/api/admin/admins', async ({ request }) => {
  const { admin } = await adminContext(request);
  const { data } = await admin.from('admin_roles').select('user_id,role,created_at,granted_by,profile:profiles!admin_roles_user_id_fkey(email,display_name)');
  return { admins: (data || []).map((a) => ({ user_id: a.user_id, role: a.role, created_at: a.created_at, email: a.profile?.email, display_name: a.profile?.display_name })) };
});

on('POST', '/api/admin/admins', async ({ request }) => {
  const { admin, user } = await adminContext(request, { superadmin: true });
  const body = await readJson(request);
  const email = str(body?.email, { name: 'Email', required: true, max: 200 }).toLowerCase();
  const role = body?.role === 'superadmin' ? 'superadmin' : 'admin';
  const { data: profile } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (!profile) throw new ApiError(404, 'No account exists for that email. The person must sign up first.', 'NOT_FOUND');
  const { error } = await admin.from('admin_roles').upsert({ user_id: profile.id, role, granted_by: user.id }, { onConflict: 'user_id' });
  if (error) throw error;
  await auditAdmin(admin, user.id, 'admin.grant', 'user', profile.id, { email, role });
  return { ok: true };
});

on('DELETE', '/api/admin/admins/:userId', async ({ request, params }) => {
  const { admin, user } = await adminContext(request, { superadmin: true });
  const target = uuid(params.userId, 'user');
  if (target === user.id) throw new ApiError(400, 'You cannot remove your own admin role.', 'VALIDATION');
  await admin.from('admin_roles').delete().eq('user_id', target);
  await auditAdmin(admin, user.id, 'admin.revoke', 'user', target, {});
  return { ok: true };
});
