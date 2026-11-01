/**
 * vNext Part 3 API on the real router, handlers and migrations (PGlite):
 * cookieless website analytics, typed product events, the evaluation request
 * form, the Command Center read model, and the admin control plane (CMS draft /
 * publish / rollback, flag targeting, security events, audit). Only the JWT
 * check is mocked; admin checks and audit writes are real SQL.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';
import { authMock, call as rawCall, callWith, routeState } from './helpers/routes';

vi.mock('../api/_lib/auth.js', () => authMock);
vi.setConfig({ testTimeout: 60_000 });

const ADMIN = 'ad000000-0000-4000-8000-0000000000ad';
const OWNER = 'a0000000-0000-4000-8000-00000000000a';
const OTHER = 'b0000000-0000-4000-8000-00000000000b';
const VIEWER = 'c0000000-0000-4000-8000-00000000000c';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const WS_ADMIN = 'ad111111-1111-4111-8111-1111111111ad';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let dispatch: (r: Request) => Promise<Response>;
const call = (m: string, p: string, b?: unknown) => rawCall(dispatch, m, p, b);
const as = (u: string) => (routeState.user = u);
const q = async <T = Row>(sql: string, params: unknown[] = []) => (await routeState.db!.query<T>(sql, params)).rows;
const BROWSER = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'x-real-ip': '203.0.113.77', 'x-vercel-ip-country': 'mn', 'x-vercel-ip-country-region': 'UB' };
const collect = (body: unknown, headers: Record<string, string> = {}) => callWith(dispatch, 'POST', '/api/analytics/collect', body, { ...BROWSER, ...headers });

beforeAll(async () => {
  routeState.db = await createDb();
  routeState.rest = restClient(routeState.db);
  await seedWorkspace(routeState.db, { userId: OWNER, workspaceId: WS_A, slug: 'alpha', role: 'owner' });
  await seedWorkspace(routeState.db, { userId: OTHER, workspaceId: WS_B, slug: 'bravo', role: 'owner' });
  await seedWorkspace(routeState.db, { userId: ADMIN, workspaceId: WS_ADMIN, slug: 'zevqora-internal', role: 'owner' });
  await q('insert into auth.users(id) values ($1)', [VIEWER]);
  await q(`insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, 'viewer')`, [WS_A, VIEWER]);
  for (const [id, email] of [[ADMIN, 'admin@example.invalid'], [OWNER, 'owner@example.invalid'], [OTHER, 'other@example.invalid'], [VIEWER, 'viewer@example.invalid']]) await q('insert into public.profiles(id, email) values ($1, $2)', [id, email]);
  await q(`insert into public.admin_roles(user_id, role) values ($1, 'superadmin')`, [ADMIN]);
  ({ dispatch } = await import('../api/_lib/router.js'));
  const analytics = await import('../api/_lib/handlers/analytics.js');
  analytics.setAnalyticsClient(routeState.rest);
  (await import('../api/_lib/analytics/security.js')).setSecurityClient(routeState.rest);
  await import('../api/_lib/handlers/engine.js');
  await import('../api/_lib/handlers/optimize.js');
  await import('../api/_lib/handlers/admin.js');
  await import('../api/_lib/handlers/admin-v3.js');
  await import('../api/_lib/handlers/experience.js');
}, 120_000);

const flag = async (key: string, enabled: boolean) => {
  await q('update public.feature_flags set enabled = $2 where key = $1', [key, enabled]);
  (await import('../api/_lib/flags.js')).resetFlagCache();
};

describe('website analytics (cookieless, first-party)', () => {
  it('records nothing until visitor intelligence is switched on', async () => {
    const r = await collect({ event: 'pageview', path: '/', session_id: 'sessionAAAA1' });
    expect(r).toMatchObject({ status: 202, body: { recorded: false, reason: 'disabled' } });
    expect((await q('select count(*)::int n from public.site_events'))[0].n).toBe(0);
    await flag('visitor_intelligence', true);
  });

  it('stores a normalized path, the referrer host, UTM tags and approximate geography — never an IP, query string or token', async () => {
    const r = await collect({ event: 'pageview', path: '/invite/9f8e7d6c5b4a39281706f5e4d3c2b1a0?email=a@b.co#x', session_id: 'sessionAAAA1', referrer: 'https://news.example.com/item?id=1', utm: { source: 'Launch', campaign: 'Q4' } });
    expect(r).toMatchObject({ status: 202, body: { recorded: true } });
    await collect({ event: 'pageview', path: '/app/workloads/0a1b2c3d-1111-4222-8333-444455556666?tab=1', session_id: 'sessionAAAA1' });
    const rows = await q('select * from public.site_events order by occurred_at');
    expect(rows.map((x) => x.path)).toEqual(['/invite/:token', '/app/workloads/:id']);
    expect(rows[0]).toMatchObject({ referrer_host: 'news.example.com', utm_source: 'launch', utm_campaign: 'q4', country: 'MN', region: 'UB', device: 'desktop', browser: 'safari', is_bot: false });
    expect(rows[0].visitor_key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toMatch(/203\.0\.113|email=|a@b\.co|Macintosh/);
  });

  it('respects Do Not Track and Global Privacy Control', async () => {
    expect((await collect({ event: 'pageview', path: '/', session_id: 'sessionDNT01' }, { dnt: '1' })).body.reason).toBe('opted_out');
    expect((await collect({ event: 'pageview', path: '/', session_id: 'sessionGPC01' }, { 'sec-gpc': '1' })).body.reason).toBe('opted_out');
    expect((await q(`select count(*)::int n from public.site_events where session_id in ('sessionDNT01', 'sessionGPC01')`))[0].n).toBe(0);
  });

  it('refuses malformed events and marks bots so they never count as visitors', async () => {
    expect((await collect({ event: 'purchase', path: '/', session_id: 'sessionAAAA1' })).status).toBe(400);
    expect((await collect({ event: 'pageview', path: 'https://evil.example', session_id: 'sessionAAAA1' })).status).toBe(400);
    expect((await collect({ event: 'pageview', path: '/', session_id: 'x' })).status).toBe(400);
    await collect({ event: 'pageview', path: '/', session_id: 'botSession01' }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
    const [bot] = await q(`select is_bot, device from public.site_events where session_id = 'botSession01'`);
    expect(bot).toEqual({ is_bot: true, device: 'bot' });
  });

  it('gives a visitor the same key all day and a different one the next day', async () => {
    const { visitorKey } = await import('../api/_lib/analytics/site.js');
    expect(visitorKey('203.0.113.1', 'UA', '2026-10-01')).toBe(visitorKey('203.0.113.1', 'UA', '2026-10-01'));
    expect(visitorKey('203.0.113.1', 'UA', '2026-10-01')).not.toBe(visitorKey('203.0.113.1', 'UA', '2026-10-02'));
  });
});

describe('product events', () => {
  it('accepts allow-listed view events from members only, once per user, subject and day', async () => {
    as(OWNER);
    const ok = await call('POST', '/api/analytics/product-event', { event: 'pareto_viewed', workspace_id: WS_A, subject_id: 'search-1', properties: { frontier: 2, prompt: 'never stored' } });
    expect(ok.body).toEqual({ recorded: true });
    const again = await call('POST', '/api/analytics/product-event', { event: 'pareto_viewed', workspace_id: WS_A, subject_id: 'search-1' });
    expect(again.body).toEqual({ recorded: false });
    const rows = await q(`select * from public.product_events where event = 'pareto_viewed'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ frontier: 2 });
    expect(rows[0].source).toBe('client');
  });

  it('refuses server-only events from the browser', async () => {
    as(OWNER);
    const r = await call('POST', '/api/analytics/product-event', { event: 'verdict_verified', workspace_id: WS_A });
    expect(r.status).toBe(400);
  });

  it('a non-member gets a plain 404, and the denial is recorded as a security event without the full IP', async () => {
    as(OTHER);
    const r = await callWith(dispatch, 'POST', '/api/analytics/product-event', { event: 'report_opened', workspace_id: WS_A }, { 'x-real-ip': '198.51.100.23' });
    expect(r).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    const [ev] = await q(`select * from public.security_events where kind = 'cross_workspace_denied' order by occurred_at desc limit 1`);
    expect(ev).toMatchObject({ actor_id: OTHER, ip_prefix: '198.51.100.0/24', status: 404 });
    expect(ev.metadata).toEqual({ workspace_id: WS_A });
    expect(JSON.stringify(ev)).not.toContain('198.51.100.23');
  });

  it('the optimization flow records each step once, even when a step is retried', async () => {
    as(OWNER);
    await q(`update public.feature_flags set workspace_overrides = $1 where key = 'verified_optimization_vnext'`, [JSON.stringify({ [WS_A]: true })]);
    const demo = await call('POST', '/api/optimize/demo', { workspace_id: WS_A });
    expect(demo.status).toBe(200);
    const product = demo.body.product_id;
    const draft = await call('POST', `/api/optimize/products/${product}/contracts`, { requirements: demo.body.suggested_requirements });
    await call('POST', `/api/optimize/products/${product}/contracts/${draft.body.id}/freeze`);
    const run = await call('POST', `/api/optimize/products/${product}/runs`, { contract_id: draft.body.id });
    await call('POST', `/api/optimize/runs/${run.body.id}/baseline`);
    await call('POST', `/api/optimize/runs/${run.body.id}/baseline`);
    const events = await q<{ event: string; n: number }>(`select event, count(*)::int n from public.product_events where workspace_id = $1 group by event order by event`, [WS_A]);
    expect(events).toEqual(expect.arrayContaining([{ event: 'contract_frozen', n: 1 }, { event: 'baseline_created', n: 1 }]));
    const [b] = await q(`select properties from public.product_events where event = 'baseline_created'`);
    expect(Object.keys(b.properties).sort()).toEqual(['completeness', 'reused', 'trace_count']);
  });
});

describe('evaluation requests', () => {
  it('stores a valid request as plain text and records the conversion', async () => {
    const r = await callWith(dispatch, 'POST', '/api/evaluation-requests', { name: 'Ada <script>alert(1)</script>', email: 'Ada@Example.com', company: 'Example AI', role_title: 'CTO', workload: 'Support triage agent with retries, ~2M calls a month.', ai_spend_band: '10k_50k', consent: true, source: { path: '/evaluation?utm_source=x', referrer: 'https://search.example/q?x=1', utm_source: 'Newsletter' } }, BROWSER);
    expect(r.status).toBe(201);
    const [row] = await q('select * from public.evaluation_requests where id = $1', [r.body.id]);
    expect(row).toMatchObject({ name: 'Ada scriptalert(1)/script', email: 'ada@example.com', ai_spend_band: '10k_50k', status: 'new' });
    expect(row.source).toEqual({ path: '/evaluation', referrer: 'search.example', utm_source: 'newsletter', utm_campaign: null });
    const [ev] = await q(`select * from public.product_events where event = 'evaluation_requested'`);
    expect(ev).toMatchObject({ user_id: null, subject_id: r.body.id, properties: { ai_spend_band: '10k_50k' } });
  });

  it('limits one email to three requests a day, across server instances (database-backed)', async () => {
    const base = { name: 'Rate Test', email: 'rate@example.com', company: 'R', workload: 'A long enough workload description.', consent: true };
    for (let i = 0; i < 3; i += 1) expect((await call('POST', '/api/evaluation-requests', base)).status).toBe(201);
    const fourth = await call('POST', '/api/evaluation-requests', base);
    expect(fourth).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } });
    expect((await q(`select count(*)::int n from public.evaluation_requests where email = 'rate@example.com'`))[0].n).toBe(3);
    await q(`delete from public.evaluation_requests where email = 'rate@example.com'`);
    await q(`delete from public.product_events where event = 'evaluation_requested' and properties->>'ai_spend_band' = 'unknown'`);
  });

  it('requires consent and a valid email; bots filling the honeypot get a silent success and nothing is stored', async () => {
    const base = { name: 'Bo Example', email: 'bo@example.com', company: 'B', workload: 'A long enough workload description.', consent: true };
    expect((await call('POST', '/api/evaluation-requests', { ...base, consent: false })).status).toBe(400);
    expect((await call('POST', '/api/evaluation-requests', { ...base, email: 'not-an-email' })).status).toBe(400);
    const before = (await q('select count(*)::int n from public.evaluation_requests'))[0].n;
    expect((await call('POST', '/api/evaluation-requests', { ...base, website: 'http://spam' })).status).toBe(201);
    expect((await q('select count(*)::int n from public.evaluation_requests'))[0].n).toBe(before);
  });
});

describe('Command Center read model', () => {
  it('keeps observed, evaluated, projected and realized apart, and never invents realized value', async () => {
    as(OWNER);
    const r = await call('GET', `/api/workspaces/${WS_A}/command-center?days=30`);
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.observed.claim).toBe('OBSERVED');
    expect(b.observed.requests).toBeGreaterThan(0);
    expect(b.value.realized).toMatchObject({ claim: 'REALIZED', status: 'NOT_YET_MEASURED' });
    expect(b.value.projected.claim).toBe('PROJECTED');
    // No plan selected yet: projection is unavailable, not zero.
    expect(b.value.projected.monthly_cost_change_usd).toBeNull();
    const p = b.products[0];
    expect(p.synthetic).toBe(true);
    expect(p.baseline.claim).toBe('OBSERVED');
    expect(p.projected).toMatchObject({ monthly_cost_change_usd: null, unavailable_reason: expect.any(String) });
    expect(b.synthetic).toBe(true);
  });

  it('an empty workspace gets nulls and a next step, not zeros', async () => {
    as(OTHER);
    const b = (await call('GET', `/api/workspaces/${WS_B}/command-center`)).body;
    expect(b.products).toEqual([]);
    expect(b.observed).toMatchObject({ requests: 0, spend_usd: null, cost_coverage: null });
    expect(b.observed.latency.p95_ms).toBeNull();
  });

  it('viewers can read it; other workspaces cannot (404, not 403)', async () => {
    as(VIEWER);
    expect((await call('GET', `/api/workspaces/${WS_A}/command-center`)).status).toBe(200);
    as(OTHER);
    expect((await call('GET', `/api/workspaces/${WS_A}/command-center`)).status).toBe(404);
  });
});

describe('admin control plane', () => {
  const ROUTES: Array<[string, string, unknown?]> = [
    ['GET', '/api/admin/command-center'],
    ['GET', '/api/admin/analytics/website'],
    ['GET', '/api/admin/analytics/product'],
    ['GET', '/api/admin/analytics/optimization'],
    ['GET', '/api/admin/security'],
    ['GET', '/api/admin/evaluation-requests'],
    ['GET', '/api/admin/cms'],
    ['PUT', '/api/admin/cms/hero/draft', { value: { headline: 'x' } }],
    ['POST', '/api/admin/cms/hero/publish', { revision_id: OWNER }],
    ['GET', '/api/admin/flags/reach'],
    ['PUT', '/api/admin/feature-flags/zevir_graph_ui', { targeting: 'on' }],
    ['GET', '/api/admin/system-health'],
  ];

  it('every admin route is a 404 for a workspace owner who is not a ZEVQORA admin, and nothing changes', async () => {
    as(OWNER);
    for (const [m, path, body] of ROUTES) expect((await call(m, path, body)).status, `${m} ${path}`).toBe(404);
    const [flagRow] = await q(`select targeting from public.feature_flags where key = 'zevir_graph_ui'`);
    expect(flagRow.targeting).toBeNull();
    expect((await q(`select count(*)::int n from public.security_events where kind = 'admin_denied'`))[0].n).toBeGreaterThan(0);
  });

  it('CMS: draft → publish → rollback, sanitized, audited, and only published content reaches the public table', async () => {
    as(ADMIN);
    const hero = (await q(`select value from public.site_content where key = 'hero'`))[0].value;
    const draft = await call('PUT', '/api/admin/cms/hero/draft', { value: { ...hero, headline: 'Make AI <b>cheaper</b> without guessing.' }, note: 'copy test' });
    expect(draft.status).toBe(200);
    expect(draft.body.draft).toMatchObject({ status: 'draft', version: 2 });
    expect(draft.body.draft.value.headline).toBe('Make AI bcheaper/b without guessing.');
    // The draft is not live.
    expect((await q(`select value->>'headline' h from public.site_content where key = 'hero'`))[0].h).toBe(hero.headline);
    const pub = await call('POST', '/api/admin/cms/hero/publish', { revision_id: draft.body.draft.id });
    expect(pub.body.published).toMatchObject({ key: 'hero', version: 2 });
    expect((await q(`select value->>'headline' h from public.site_content where key = 'hero'`))[0].h).toBe('Make AI bcheaper/b without guessing.');
    const v1 = (await q(`select id, status from public.site_content_revisions where key = 'hero' and version = 1`))[0];
    expect(v1.status).toBe('superseded');
    const back = await call('POST', '/api/admin/cms/hero/rollback', { revision_id: v1.id });
    expect(back.body.published).toMatchObject({ version: 3, restored_version: 1 });
    expect((await q(`select value->>'headline' h from public.site_content where key = 'hero'`))[0].h).toBe(hero.headline);
    const audit = (await q<{ action: string }>(`select action from public.admin_audit_log where target_type = 'site_content' order by created_at`)).map((a) => a.action);
    expect(audit).toEqual(['cms.draft_save', 'cms.publish', 'cms.rollback']);
  });

  it('CMS refuses script links, protocol-relative links and unknown fields', async () => {
    as(ADMIN);
    const hero = (await q(`select value from public.site_content where key = 'hero'`))[0].value;
    expect((await call('PUT', '/api/admin/cms/hero/draft', { value: { ...hero, primary_cta: { label: 'Go', href: 'javascript:alert(1)' } } })).status).toBe(400);
    expect((await call('PUT', '/api/admin/cms/hero/draft', { value: { ...hero, primary_cta: { label: 'Go', href: '//evil.example' } } })).status).toBe(400);
    expect((await call('PUT', '/api/admin/cms/hero/draft', { value: { ...hero, onload: 'x' } })).status).toBe(400);
    expect((await call('PUT', '/api/admin/cms/nope/draft', { value: {} })).status).toBe(400);
  });

  it('a restore is refused while a draft is open; publishing a draft that does not exist is a 404', async () => {
    as(ADMIN);
    const footer = await call('PUT', '/api/admin/cms/footer/draft', { value: { tagline: 'Make AI lighter.', note: 'Synthetic illustrations are labelled.' } });
    expect(footer.status).toBe(200);
    const hist = (await q(`select id from public.site_content_revisions where key = 'hero' and status = 'superseded' limit 1`))[0];
    await call('PUT', '/api/admin/cms/hero/draft', { value: (await q(`select value from public.site_content where key = 'hero'`))[0].value });
    expect((await call('POST', '/api/admin/cms/hero/rollback', { revision_id: hist.id })).body.code).toBe('DRAFT_OPEN');
    expect((await call('DELETE', '/api/admin/cms/hero/draft')).status).toBe(200);
    expect((await call('POST', '/api/admin/cms/footer/publish', { revision_id: 'f0000000-0000-4000-8000-00000000000f' })).status).toBe(404);
  });

  it('the legacy direct save still works and now leaves a revision behind', async () => {
    as(ADMIN);
    const before = (await q(`select count(*)::int n from public.site_content_revisions where key = 'status'`))[0].n;
    const r = await call('PUT', '/api/admin/site-content/status', { value: { banner: 'Scheduled maintenance', public_status: 'maintenance' } });
    expect(r.status).toBe(200);
    expect((await q(`select count(*)::int n from public.site_content_revisions where key = 'status'`))[0].n).toBe(before + 1);
    expect((await q(`select value->>'banner' b from public.site_content where key = 'status'`))[0].b).toBe('Scheduled maintenance');
  });

  it('flag targeting: deterministic limited rollout, internal = admin-owned workspaces, global flags only on/off — all audited', async () => {
    as(ADMIN);
    expect((await call('PUT', '/api/admin/feature-flags/visitor_intelligence', { targeting: 'internal' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/feature-flags/zevir_graph_ui', { targeting: 'limited' })).status).toBe(400);
    const internal = await call('PUT', '/api/admin/feature-flags/zevir_graph_ui', { targeting: 'internal' });
    expect(internal.body.flag).toMatchObject({ targeting: 'internal', rollout_percent: null });
    const { workspaceFlags, bucket } = await import('../api/_lib/flags.js');
    expect((await workspaceFlags(routeState.rest, WS_ADMIN, ['zevir_graph_ui'])).zevir_graph_ui).toBe(true);
    expect((await workspaceFlags(routeState.rest, WS_A, ['zevir_graph_ui'])).zevir_graph_ui).toBe(false);
    const pct = bucket('zevir_graph_ui', WS_A) + 1;
    await call('PUT', '/api/admin/feature-flags/zevir_graph_ui', { targeting: 'limited', rollout_percent: pct });
    expect((await workspaceFlags(routeState.rest, WS_A, ['zevir_graph_ui'])).zevir_graph_ui).toBe(true);
    await call('PUT', '/api/admin/feature-flags/zevir_graph_ui', { targeting: 'limited', rollout_percent: pct - 1 });
    expect((await workspaceFlags(routeState.rest, WS_A, ['zevir_graph_ui'])).zevir_graph_ui).toBe(false);
    // An explicit workspace override beats targeting.
    await call('PUT', '/api/admin/feature-flags/zevir_graph_ui', { workspace_overrides: { [WS_A]: true } });
    expect((await workspaceFlags(routeState.rest, WS_A, ['zevir_graph_ui'])).zevir_graph_ui).toBe(true);
    const reach = await call('GET', '/api/admin/flags/reach');
    expect(reach.body.reach.zevir_graph_ui.workspaces_total).toBe(3);
    const audit = await q(`select metadata from public.admin_audit_log where action = 'feature_flag.update' and target_id = 'zevir_graph_ui' order by created_at`);
    expect(audit.length).toBe(4);
    expect(audit[0].metadata.after).toMatchObject({ targeting: 'internal' });
    expect(audit[1].metadata.after).toMatchObject({ targeting: 'limited', rollout_percent: pct });
  });

  it('website, product and optimization analytics come from real rows, with their source, range and definitions', async () => {
    as(ADMIN);
    const web = (await call('GET', '/api/admin/analytics/website?range=7d')).body;
    expect(web.meta).toMatchObject({ collecting: true, range: { preset: '7d' } });
    expect(web.meta.source).toMatch(/First-party/);
    expect(web.totals.pageviews).toBe(2);
    expect(web.totals.sessions).toBe(1);
    expect(web.countries).toEqual([{ country: 'MN', sessions: 1 }]);
    expect(web.signals.bot_events).toBe(1);
    const prod = (await call('GET', '/api/admin/analytics/product?range=30d')).body;
    expect(prod.funnel_steps.map((s: Row) => s.key)).toEqual(['visitor', 'signup', 'workspace', 'evidence', 'baseline', 'search', 'replay', 'verdict', 'evidence_viewed']);
    expect(prod.counts.baseline_created).toBe(1);
    expect(prod.meta.backfill_note).toMatch(/not backfilled/);
    const opt = (await call('GET', '/api/admin/analytics/optimization?range=30d')).body;
    expect(opt.realized_savings.status).toBe('NOT_YET_MEASURED');
  });

  it('validates date ranges', async () => {
    as(ADMIN);
    expect((await call('GET', '/api/admin/analytics/website?range=custom&from=2026-09-01&to=2026-08-01')).status).toBe(400);
    expect((await call('GET', '/api/admin/analytics/website?range=custom&from=2024-01-01&to=2026-01-01')).status).toBe(400);
    expect((await call('GET', '/api/admin/analytics/website?range=forever')).status).toBe(400);
    const ok = await call('GET', '/api/admin/analytics/website?range=custom&from=2026-09-01&to=2026-09-01');
    expect(ok.body.meta.range).toMatchObject({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' });
  });

  it('security events are admin-only, never hold a full IP, and every read is audited', async () => {
    as(ADMIN);
    const r = await call('GET', '/api/admin/security?range=7d');
    expect(r.status).toBe(200);
    expect(r.body.by_kind.cross_workspace_denied).toBeGreaterThan(0);
    expect(JSON.stringify(r.body.events)).not.toMatch(/198\.51\.100\.23|203\.0\.113\.77/);
    expect(r.body.events[0]).not.toHaveProperty('ip_hash');
    expect((await q(`select count(*)::int n from public.admin_audit_log where action = 'security_events.read'`))[0].n).toBe(1);
  });

  it('lead details are admin-only and their reads and status changes are audited', async () => {
    as(ADMIN);
    const list = await call('GET', '/api/admin/evaluation-requests');
    expect(list.body.requests.length).toBe(1);
    const id = list.body.requests[0].id;
    expect((await call('PATCH', `/api/admin/evaluation-requests/${id}`, { status: 'contacted' })).body.request.status).toBe('contacted');
    expect((await call('PATCH', `/api/admin/evaluation-requests/${id}`, { status: 'spam' })).status).toBe(400);
    const actions = (await q<{ action: string }>(`select action from public.admin_audit_log where target_type in ('evaluation_requests', 'evaluation_request') order by created_at`)).map((a) => a.action);
    expect(actions).toEqual(['evaluation_requests.read', 'evaluation_request.status']);
  });

  it('the admin command center reports real counts and configuration state', async () => {
    as(ADMIN);
    const b = (await call('GET', '/api/admin/command-center')).body;
    expect(b.counts).toMatchObject({ users: 4, workspaces: 3, evaluation_requests_new: 0 });
    expect(b.website.collecting).toBe(true);
    expect(b.system.posthog).toBe('not_integrated');
    expect(['configured', 'not_configured']).toContain(b.system.analytics_secret);
  });
});
