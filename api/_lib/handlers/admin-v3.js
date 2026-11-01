/**
 * Admin control plane (vNext Part 3). Same rules as admin.js: every route
 * needs an admin_roles row (server-checked; non-admins get 404), every
 * mutation writes admin_audit_log, and reads of security events and lead
 * contact details are themselves audited.
 *
 *   GET   /api/admin/command-center
 *   GET   /api/admin/analytics/website?range=7d|30d|today|90d|custom&from&to
 *   GET   /api/admin/analytics/product?range…
 *   GET   /api/admin/analytics/optimization?range…
 *   GET   /api/admin/security?range…&kind=
 *   GET   /api/admin/evaluation-requests?status=
 *   PATCH /api/admin/evaluation-requests/:id
 *   GET   /api/admin/cms
 *   GET   /api/admin/cms/revisions/:id
 *   PUT   /api/admin/cms/:key/draft
 *   DELETE /api/admin/cms/:key/draft
 *   POST  /api/admin/cms/:key/publish
 *   POST  /api/admin/cms/:key/rollback
 *   GET   /api/admin/flags/reach
 *   GET   /api/admin/optimization
 *   GET   /api/admin/system-health
 */
import { on } from '../router.js';
import { ApiError, readJson, str, uuid } from '../http.js';
import { requireUser, requireAdmin, auditAdmin, rateLimit } from '../auth.js';
import { openRouterConfigured } from '../openrouter.js';
import { stripeConfigured } from '../stripe.js';
import { validateContent, schemaOut } from '../cms.js';
import { cmsState, discardDraft, publishRevision, revision, rollbackTo, saveDraft } from '../cms-store.js';
import { decideFlag, globalFlag } from '../flags.js';
import { analyticsSecretConfigured } from '../analytics/site.js';
import { FUNNEL, TAXONOMY_NAME } from '../analytics/taxonomy.js';
import { SECURITY_RETENTION_DAYS } from '../analytics/security.js';
import { fetchPaged } from '../paging.js';

const SECURITY_KINDS = ['auth_failed', 'account_suspended', 'authz_denied', 'cross_workspace_denied', 'admin_denied', 'rate_limited', 'unexpected_error', 'admin_action', 'config_change', 'flag_change', 'cms_publish', 'connection_revoked'];

/** Exact per-kind counts (head requests), never a row fetch that the API row cap could truncate. */
async function securityCounts(admin, from, to) {
  const out = {};
  await Promise.all(SECURITY_KINDS.map(async (kind) => {
    let q = admin.from('security_events').select('id', { count: 'exact', head: true }).eq('kind', kind).gte('occurred_at', from);
    if (to) q = q.lt('occurred_at', to);
    const { count: n, error } = await q;
    if (!error && n) out[kind] = n;
  }));
  return out;
}

const DAY = 24 * 60 * 60 * 1000;

async function adminContext(request, opts) {
  const ctx = await requireUser(request);
  const role = await requireAdmin(ctx.admin, ctx.user.id, opts);
  rateLimit(`admin:${ctx.user.id}`, { limit: 120, windowMs: 60_000 });
  return { ...ctx, adminRole: role };
}

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Range presets in UTC. `to` is exclusive. Custom ranges are whole days, at most 400. */
export function parseRange(query, now = new Date()) {
  const preset = query.get('range') || '30d';
  const startOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const to = now;
  if (preset === 'today') return { preset, from: startOfDay(now).toISOString(), to: to.toISOString() };
  if (['7d', '30d', '90d'].includes(preset)) return { preset, from: new Date(now.getTime() - Number(preset.slice(0, -1)) * DAY).toISOString(), to: to.toISOString() };
  if (preset === 'custom') {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const f = query.get('from');
    const t = query.get('to');
    if (!re.test(f || '') || !re.test(t || '')) throw new ApiError(400, 'A custom range needs from and to as YYYY-MM-DD.', 'VALIDATION');
    const from = new Date(`${f}T00:00:00Z`);
    const toDay = new Date(new Date(`${t}T00:00:00Z`).getTime() + DAY);
    if (Number.isNaN(from.getTime()) || Number.isNaN(toDay.getTime()) || toDay <= from) throw new ApiError(400, 'The range end must be on or after its start.', 'VALIDATION');
    if (toDay.getTime() - from.getTime() > 400 * DAY) throw new ApiError(400, 'A range can cover at most 400 days.', 'VALIDATION');
    return { preset, from: from.toISOString(), to: toDay.toISOString() };
  }
  throw new ApiError(400, 'range must be today, 7d, 30d, 90d or custom.', 'VALIDATION');
}

const count = async (q) => {
  const { count: n, error } = await q;
  return error ? null : n || 0;
};

function meta(source, range, extra = {}) {
  return { source, range, generated_at: new Date().toISOString(), ...extra };
}

// ------------------------------------------------------------ command centre
on('GET', '/api/admin/command-center', async ({ request }) => {
  const { admin } = await adminContext(request);
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();
  const now = new Date().toISOString();
  const [users, signups7, active7, workspaces, projects, searches7, evals7, requestsNew, siteOn, productOn] = await Promise.all([
    count(admin.from('profiles').select('id', { count: 'exact', head: true })),
    count(admin.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since7)),
    count(admin.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', since7)),
    count(admin.from('workspaces').select('id', { count: 'exact', head: true })),
    count(admin.from('engine_products').select('id', { count: 'exact', head: true }).is('archived_at', null)),
    count(admin.from('plan_searches').select('id', { count: 'exact', head: true }).gte('created_at', since7)),
    count(admin.from('engine_evaluations').select('id', { count: 'exact', head: true }).gte('created_at', since7)),
    count(admin.from('evaluation_requests').select('id', { count: 'exact', head: true }).eq('status', 'new')),
    globalFlag(admin, 'visitor_intelligence', { fresh: true }),
    globalFlag(admin, 'product_analytics', { fresh: true }),
  ]);
  const [site, product, errors, security, signups] = await Promise.all([
    siteOn ? admin.rpc('analytics_site_summary', { p_from: since7, p_to: now }) : { data: null },
    admin.rpc('analytics_product_summary', { p_from: since7, p_to: now }),
    admin.from('security_events').select('id,occurred_at,route,status,code,method').eq('kind', 'unexpected_error').order('occurred_at', { ascending: false }).limit(8),
    securityCounts(admin, since7, null),
    admin.from('profiles').select('id,email,display_name,created_at').order('created_at', { ascending: false }).limit(6),
  ]);
  const byKind = security;
  return {
    generated_at: now,
    window: { from: since7, to: now, label: 'Last 7 days' },
    counts: { users, signups_7d: signups7, active_users_7d: active7, workspaces, active_workspaces_7d: product.data?.active?.workspaces ?? null, connected_workloads: projects, searches_7d: searches7, evaluations_7d: evals7, evaluation_requests_new: requestsNew },
    website: siteOn ? { collecting: true, ...(site.data?.totals || {}), funnel: site.data?.funnel || null } : { collecting: false },
    product: { collecting: productOn, counts: product.data?.counts || {}, funnel: product.data?.funnel || null },
    recent_signups: (signups.data || []).map((p) => ({ id: p.id, email: p.email, display_name: p.display_name, created_at: p.created_at })),
    recent_errors: errors.data || [],
    security_7d: byKind,
    system: systemHealth(),
  };
});

function systemHealth() {
  return {
    api: 'ok',
    time: new Date().toISOString(),
    database: 'ok',
    cloud_replay: openRouterConfigured() ? 'configured' : 'not_configured',
    stripe: stripeConfigured() ? 'configured' : 'not_configured',
    analytics_secret: analyticsSecretConfigured() ? 'configured' : 'not_configured',
    security_hash_secret: process.env.SECURITY_HASH_SECRET && process.env.SECURITY_HASH_SECRET.length >= 32 ? 'configured' : 'not_configured',
    cron: process.env.CRON_SECRET ? 'configured' : 'not_configured',
    vercel_web_analytics: process.env.VERCEL_WEB_ANALYTICS === '1' ? 'configured' : 'not_configured',
    posthog: 'not_integrated',
  };
}

on('GET', '/api/admin/system-health', async ({ request }) => {
  const { admin } = await adminContext(request);
  const started = Date.now();
  const { error } = await admin.from('feature_flags').select('key').limit(1);
  return { ...systemHealth(), database: error ? 'error' : 'ok', database_ms: Date.now() - started };
});

// -------------------------------------------------------------- analytics
on('GET', '/api/admin/analytics/website', async ({ request, query }) => {
  const { admin } = await adminContext(request);
  const range = parseRange(query);
  const collecting = await globalFlag(admin, 'visitor_intelligence', { fresh: true });
  const summary = must(await admin.rpc('analytics_site_summary', { p_from: range.from, p_to: range.to }));
  return {
    meta: meta('First-party site_events (cookieless; no raw IP)', range, { collecting, secret_configured: analyticsSecretConfigured(), visitors_definition: 'Visitors = distinct daily visitor keys; the key rotates every UTC day, so a person returning on two days counts twice.', geo_note: 'Country and region come from the hosting edge and are approximate.', last_event_at: summary?.totals?.last_event_at || null }),
    ...summary,
  };
});

on('GET', '/api/admin/analytics/product', async ({ request, query }) => {
  const { admin } = await adminContext(request);
  const range = parseRange(query);
  const [product, site] = await Promise.all([admin.rpc('analytics_product_summary', { p_from: range.from, p_to: range.to }), admin.rpc('analytics_site_summary', { p_from: range.from, p_to: range.to })]);
  const p = must(product);
  const visitors = site.data?.totals?.visitor_days ?? null;
  return {
    meta: meta(`First-party product_events (${TAXONOMY_NAME})`, range, { collecting: await globalFlag(admin, 'product_analytics', { fresh: true }), funnel_definition: 'Users who completed signup in the range; a step counts a user only if every earlier step was also reached. Visitors (from website analytics) are daily visitor keys, not people, so the first conversion is indicative.', backfill_note: 'Events are recorded from migration 019 onward; earlier activity is not backfilled.', last_event_at: p?.last_event_at || null }),
    funnel_steps: FUNNEL.map((s) => ({ key: s.key, label: s.label })),
    funnel: { visitor: visitors, ...(p?.funnel || {}) },
    ...p,
  };
});

on('GET', '/api/admin/analytics/optimization', async ({ request, query }) => {
  const { admin } = await adminContext(request);
  const range = parseRange(query);
  const within = (q) => q.gte('created_at', range.from).lt('created_at', range.to);
  const [searches, plans, decisions, evaluations, product] = await Promise.all([
    fetchPaged((a, b) => within(admin.from('plan_searches').select('id,workspace_id,status,created_at,completed_at,spend', { count: 'exact' })).order('created_at', { ascending: false }).order('id').range(a, b), { max: 2000 }),
    fetchPaged((a, b) => within(admin.from('execution_plans').select('id,verdict,status,frontier_state,executable_status,risk_class', { count: 'exact' })).order('id').range(a, b), { max: 20000 }),
    fetchPaged((a, b) => within(admin.from('plan_decisions').select('id,policy,outcome,created_at', { count: 'exact' })).order('id').range(a, b), { max: 5000 }),
    fetchPaged((a, b) => within(admin.from('engine_evaluations').select('id,status,rejection_reason,created_at', { count: 'exact' })).order('id').range(a, b), { max: 10000 }),
    admin.rpc('analytics_product_summary', { p_from: range.from, p_to: range.to }),
  ]);
  const S = searches.rows;
  const P = plans.rows;
  const D = decisions.rows;
  const E = evaluations.rows;
  const tally = (rows, key) => rows.reduce((acc, r) => ((acc[r[key] ?? 'none'] = (acc[r[key] ?? 'none'] || 0) + 1), acc), {});
  const reasons = {};
  for (const e of E) if (e.status === 'REJECTED' && e.rejection_reason) {
    const k = String(e.rejection_reason).split(/[:.;]/)[0].slice(0, 80);
    reasons[k] = (reasons[k] || 0) + 1;
  }
  const spend = S.map((s) => Number(s.spend?.provider_usd ?? s.spend?.total_usd ?? NaN)).filter(Number.isFinite);
  const workspacesWithSearch = new Set(S.map((s) => s.workspace_id)).size;
  const verified = P.filter((p) => p.verdict === 'VERIFIED').length;
  return {
    meta: meta('Engine tables (plan_searches, execution_plans, plan_decisions, engine_evaluations)', range, { truncated: searches.truncated || plans.truncated || decisions.truncated || evaluations.truncated }),
    searches: { total: S.length, by_status: tally(S, 'status'), workspaces: workspacesWithSearch, per_workspace: workspacesWithSearch ? Math.round((S.length / workspacesWithSearch) * 100) / 100 : null },
    plans: { total: P.length, by_verdict: tally(P.filter((p) => p.verdict), 'verdict'), by_status: tally(P, 'status'), frontier: P.filter((p) => p.frontier_state === 'FRONTIER').length },
    decisions: { total: D.length, by_policy: tally(D, 'policy'), selected: D.filter((d) => d.outcome === 'SELECTED').length },
    acceptance_rate: verified ? Math.round((D.filter((d) => d.outcome === 'SELECTED').length / verified) * 10000) / 10000 : null,
    evaluations: { total: E.length, by_status: tally(E, 'status'), rejection_reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, n]) => ({ reason, n })) },
    replay_spend_usd: spend.length ? Math.round(spend.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null,
    replay_spend_note: spend.length ? `Provider spend recorded on ${spend.length} of ${S.length} searches.` : 'No provider spend recorded on searches in this range (deterministic plans cost nothing to replay).',
    time_to_first: { baseline: must(product)?.time_to_first || null, verified_decision: must(product)?.time_to_verified || null },
    realized_savings: { status: 'NOT_YET_MEASURED', reason: 'Realized production savings are not derived from replay data and are not measured yet.' },
  };
});

// --------------------------------------------------------------- security
on('GET', '/api/admin/security', async ({ request, query }) => {
  const { admin, user } = await adminContext(request);
  const range = parseRange(query);
  const kind = query.get('kind');
  let q = admin.from('security_events').select('id,occurred_at,kind,severity,method,route,status,code,actor_id,workspace_id,ip_prefix,metadata').gte('occurred_at', range.from).lt('occurred_at', range.to);
  if (kind) {
    if (!/^[a-z_]{3,40}$/.test(kind)) throw new ApiError(400, 'Invalid kind.', 'VALIDATION');
    q = q.eq('kind', kind);
  }
  const events = must(await q.order('occurred_at', { ascending: false }).limit(300)) || [];
  const byKind = await securityCounts(admin, range.from, range.to);
  const changes = must(await admin.from('admin_audit_log').select('id,admin_id,action,target_type,target_id,created_at').gte('created_at', range.from).lt('created_at', range.to).order('created_at', { ascending: false }).limit(100)) || [];
  await auditAdmin(admin, user.id, 'security_events.read', 'security_events', null, { range: range.preset, kind: kind || null, rows: events.length });
  return {
    meta: meta('security_events (server boundary) + admin_audit_log', range, { retention_days: SECURITY_RETENTION_DAYS, ip_note: 'Only a truncated prefix (IPv4 /24, IPv6 /48) is stored; never a full address.', read_audited: true }),
    by_kind: byKind,
    events,
    admin_changes: changes,
    // gte on a timestamp skips nulls, so this counts accounts that are currently suspended.
    suspended_accounts: await count(admin.from('profiles').select('id', { count: 'exact', head: true }).gte('suspended_at', '1970-01-01T00:00:00Z')),
  };
});

// ------------------------------------------------------ evaluation requests
on('GET', '/api/admin/evaluation-requests', async ({ request, query }) => {
  const { admin, user } = await adminContext(request);
  const status = query.get('status');
  let q = admin.from('evaluation_requests').select('*');
  if (status) {
    if (!['new', 'contacted', 'qualified', 'closed'].includes(status)) throw new ApiError(400, 'Invalid status.', 'VALIDATION');
    q = q.eq('status', status);
  }
  const rows = must(await q.order('created_at', { ascending: false }).limit(200)) || [];
  await auditAdmin(admin, user.id, 'evaluation_requests.read', 'evaluation_requests', null, { status: status || null, rows: rows.length });
  return { requests: rows };
});

on('PATCH', '/api/admin/evaluation-requests/:id', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const id = uuid(params.id, 'request');
  const body = await readJson(request);
  if (!['new', 'contacted', 'qualified', 'closed'].includes(body?.status)) throw new ApiError(400, 'Invalid status.', 'VALIDATION');
  const before = must(await admin.from('evaluation_requests').select('status').eq('id', id).maybeSingle());
  if (!before) throw new ApiError(404, 'Request not found.', 'NOT_FOUND');
  const row = must(await admin.from('evaluation_requests').update({ status: body.status, updated_at: new Date().toISOString(), updated_by: user.id }).eq('id', id).select('id,status,updated_at').single());
  await auditAdmin(admin, user.id, 'evaluation_request.status', 'evaluation_request', id, { from: before.status, to: body.status });
  return { request: row };
});

// --------------------------------------------------------------------- CMS
const contentKey = (v) => str(v, { name: 'Key', required: true, max: 40, pattern: /^[a-z][a-z0-9_]{1,40}$/ });

on('GET', '/api/admin/cms', async ({ request }) => {
  const { admin } = await adminContext(request);
  return { schemas: schemaOut(), keys: await cmsState(admin) };
});

on('GET', '/api/admin/cms/revisions/:id', async ({ request, params }) => {
  const { admin } = await adminContext(request);
  const r = await revision(admin, uuid(params.id, 'revision'));
  if (!r) throw new ApiError(404, 'Revision not found.', 'NOT_FOUND');
  return { revision: r };
});

on('PUT', '/api/admin/cms/:key/draft', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const key = contentKey(params.key);
  const body = await readJson(request, { maxBytes: 64_000 });
  const value = validateContent(key, body?.value);
  const note = body?.note ? str(body.note, { name: 'Note', max: 300 }).replace(/[<>]/g, '') : null;
  const draft = await saveDraft(admin, { key, value, userId: user.id, note });
  await auditAdmin(admin, user.id, 'cms.draft_save', 'site_content', key, { version: draft.version });
  return { draft };
});

on('DELETE', '/api/admin/cms/:key/draft', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const key = contentKey(params.key);
  const out = await discardDraft(admin, { key });
  await auditAdmin(admin, user.id, 'cms.draft_discard', 'site_content', key, { version: out.version });
  return { ok: true };
});

on('POST', '/api/admin/cms/:key/publish', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const key = contentKey(params.key);
  const body = await readJson(request);
  const revisionId = uuid(body?.revision_id, 'revision');
  const { data: before } = await admin.from('site_content').select('value').eq('key', key).maybeSingle();
  const out = await publishRevision(admin, { revisionId, userId: user.id, key });
  await auditAdmin(admin, user.id, 'cms.publish', 'site_content', key, { version: out.version, revision_id: revisionId, before: before?.value ?? null });
  return { published: out };
});

on('POST', '/api/admin/cms/:key/rollback', async ({ request, params }) => {
  const { admin, user } = await adminContext(request);
  const key = contentKey(params.key);
  const body = await readJson(request);
  const out = await rollbackTo(admin, { key, revisionId: uuid(body?.revision_id, 'revision'), userId: user.id });
  await auditAdmin(admin, user.id, 'cms.rollback', 'site_content', key, { restored_version: out.restored_version, new_version: out.version });
  return { published: out };
});

// ------------------------------------------------------------- flag reach
on('GET', '/api/admin/flags/reach', async ({ request }) => {
  const { admin } = await adminContext(request);
  let flags = (await admin.from('feature_flags').select('key,enabled,workspace_overrides,targeting,rollout_percent')).data;
  if (!flags) flags = must(await admin.from('feature_flags').select('key,enabled,workspace_overrides')) || [];
  const { rows: workspaces, truncated: workspacesTruncated } = await fetchPaged((a, b) => admin.from('workspaces').select('id,owner_id', { count: 'exact' }).order('id').range(a, b), { max: 20000 });
  const admins = new Set((must(await admin.from('admin_roles').select('user_id')) || []).map((a) => a.user_id));
  const reach = {};
  for (const f of flags) {
    let on = 0;
    for (const w of workspaces) if (decideFlag(f, { workspaceId: w.id, internal: admins.has(w.owner_id) })) on += 1;
    reach[f.key] = { workspaces_on: on, workspaces_total: workspaces.length, internal_workspaces: workspaces.filter((w) => admins.has(w.owner_id)).length };
  }
  return { reach, truncated: workspacesTruncated };
});

// ------------------------------------------------------ optimization + ZevIR
on('GET', '/api/admin/optimization', async ({ request }) => {
  const { admin } = await adminContext(request);
  const [searches, graphs, ingest, runs] = await Promise.all([
    admin.from('plan_searches').select('id,workspace_id,product_id,status,created_at,completed_at,search_version').order('created_at', { ascending: false }).limit(40),
    count(admin.from('zevir_graphs').select('id', { count: 'exact', head: true })),
    admin.from('zevir_ingest_runs').select('id,workspace_id,source_kind,status,created_at,stats').order('created_at', { ascending: false }).limit(20),
    count(admin.from('optimization_runs').select('id', { count: 'exact', head: true })),
  ]);
  const S = searches.data || [];
  const wsIds = [...new Set(S.map((s) => s.workspace_id).concat((ingest.data || []).map((r) => r.workspace_id)))];
  const names = wsIds.length ? Object.fromEntries((must(await admin.from('workspaces').select('id,name').in('id', wsIds)) || []).map((w) => [w.id, w.name])) : {};
  const plans = S.length ? (await fetchPaged((a, b) => admin.from('execution_plans').select('id,search_id,verdict,frontier_state,status', { count: 'exact' }).in('search_id', S.map((s) => s.id)).order('id').range(a, b), { max: 20000 })).rows : [];
  return {
    runs,
    zevir: { graphs, ingest_runs: (ingest.data || []).map((r) => ({ ...r, workspace: names[r.workspace_id] || null })), ingest_error: ingest.error ? 'unavailable' : null },
    searches: S.map((s) => {
      const mine = plans.filter((p) => p.search_id === s.id);
      return { ...s, workspace: names[s.workspace_id] || null, plans: mine.length, verified: mine.filter((p) => p.verdict === 'VERIFIED').length, rejected: mine.filter((p) => p.verdict === 'REJECTED').length, frontier: mine.filter((p) => p.frontier_state === 'FRONTIER').length, selected: mine.filter((p) => p.status === 'SELECTED').length };
    }),
  };
});
