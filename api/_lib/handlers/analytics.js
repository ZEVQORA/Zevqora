/**
 * First-party analytics and the public evaluation request (vNext Part 3).
 *
 *   POST /api/analytics/collect          website event (public, cookieless; DNT/GPC respected)
 *   POST /api/analytics/product-event    allow-listed product *view* events (signed in, member)
 *   POST /api/evaluation-requests        "Evaluate your AI workload" form (public)
 *
 * Website collection is off until the global `visitor_intelligence` flag is on.
 * Nothing here accepts or stores an IP address, a full user agent, a query
 * string, a prompt, an output or any trace content.
 */
import { on } from '../router.js';
import { ApiError, json, readJson, str, uuid } from '../http.js';
import { adminClient } from '../supabase.js';
import { requireUser, requireWorkspaceRole, rateLimitRequest, rateLimit } from '../auth.js';
import { globalFlag } from '../flags.js';
import { optedOut, siteEventRow, utm, referrerHost, normalizePath } from '../analytics/site.js';
import { CLIENT_EVENTS } from '../analytics/taxonomy.js';
import { emitProductEvent } from '../analytics/product-events.js';

let clientForTests = null;
/** Public routes have no user context to carry a client; tests inject theirs here. */
export function setAnalyticsClient(client) {
  clientForTests = client;
}
const db = () => clientForTests || adminClient();

on('POST', '/api/analytics/collect', async ({ request }) => {
  rateLimitRequest(request, 'analytics-collect', { limit: 120, windowMs: 60_000 });
  const body = await readJson(request, { maxBytes: 4_000 });
  if (optedOut(request)) return json({ recorded: false, reason: 'opted_out' }, 202);
  const admin = db();
  if (!(await globalFlag(admin, 'visitor_intelligence'))) return json({ recorded: false, reason: 'disabled' }, 202);
  const row = siteEventRow(request, body);
  if (!row) throw new ApiError(400, 'Invalid analytics event.', 'VALIDATION');
  const { error } = await admin.from('site_events').insert(row);
  if (error) throw error;
  return json({ recorded: true }, 202);
});

on('POST', '/api/analytics/product-event', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  rateLimit(`product-event:${user.id}`, { limit: 60, windowMs: 60_000 });
  const body = await readJson(request, { maxBytes: 4_000 });
  const event = str(body?.event, { name: 'Event', required: true, max: 40 });
  if (!CLIENT_EVENTS.includes(event)) throw new ApiError(400, 'This event can only be recorded by the server.', 'VALIDATION');
  const workspaceId = uuid(body?.workspace_id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const subjectId = body?.subject_id ? str(body.subject_id, { name: 'Subject', max: 80, pattern: /^[A-Za-z0-9_.:-]+$/ }) : null;
  const day = new Date().toISOString().slice(0, 10);
  // One view per user, subject and day: reloading a page does not inflate a funnel.
  const out = await emitProductEvent(admin, { event, workspaceId, userId: user.id, subjectType: 'view', subjectId, properties: body?.properties || {}, source: 'client', dedupeKey: `${event}:${user.id}:${subjectId || workspaceId}:${day}` });
  return { recorded: out.recorded };
});

const SPEND = ['unknown', 'under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k'];
const plain = (v) => String(v).replace(/[<>]/g, '');

on('POST', '/api/evaluation-requests', async ({ request }) => {
  rateLimitRequest(request, 'evaluation-request', { limit: 5, windowMs: 10 * 60_000 });
  const body = await readJson(request, { maxBytes: 8_000 });
  // Honeypot: a field people never see. Bots that fill it get a silent success.
  if (body?.website) return json({ ok: true }, 201);
  const name = plain(str(body?.name, { name: 'Name', required: true, min: 2, max: 120 }));
  const email = str(body?.email, { name: 'Work email', required: true, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid work email.', 'VALIDATION');
  const company = plain(str(body?.company, { name: 'Company', required: true, min: 1, max: 160 }));
  const roleTitle = plain(str(body?.role_title, { name: 'Role', max: 120 })) || null;
  const workload = plain(str(body?.workload, { name: 'Workload description', required: true, min: 10, max: 2000 }));
  const band = SPEND.includes(body?.ai_spend_band) ? body.ai_spend_band : 'unknown';
  if (body?.consent !== true) throw new ApiError(400, 'Please confirm we may contact you about this evaluation.', 'VALIDATION');
  const own = (() => {
    try {
      return new URL(request.url).hostname;
    } catch {
      return null;
    }
  })();
  const source = {
    path: normalizePath(body?.source?.path) || null,
    referrer: referrerHost(body?.source?.referrer, own),
    utm_source: utm(body?.source?.utm_source),
    utm_campaign: utm(body?.source?.utm_campaign),
  };
  const admin = db();
  // The in-memory limiter resets with each serverless instance; this one holds across them.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recent } = await admin.from('evaluation_requests').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since);
  if ((recent || 0) >= 3) throw new ApiError(429, 'We already have your recent requests. We will reply by email.', 'RATE_LIMITED');
  const { data, error } = await admin.from('evaluation_requests').insert({ name, email, company, role_title: roleTitle, workload, ai_spend_band: band, consent: true, source }).select('id').single();
  if (error) throw error;
  await emitProductEvent(admin, { event: 'evaluation_requested', subjectType: 'evaluation_request', subjectId: data.id, properties: { ai_spend_band: band }, dedupeKey: `evaluation_requested:${data.id}` });
  return json({ ok: true, id: data.id }, 201);
});
