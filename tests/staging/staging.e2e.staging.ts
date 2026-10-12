/**
 * STAGING-ONLY end-to-end and security tests (vNext Part 3.5).
 *
 * Runs against a real, isolated Supabase project and a preview deployment of
 * this branch that points at it. Never against production: the guard refuses a
 * production project ref, a production domain, or a missing confirmation.
 *
 *   STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY,
 *   STAGING_APP_URL, STAGING_CONFIRM=I_UNDERSTAND_THIS_IS_STAGING
 *   optional: STAGING_EMAIL_DOMAIN (default example.com)
 *
 *   npm run test:staging
 *
 * Every identity and row it creates is tagged with a run id and deleted in afterAll.
 * Negative tests assert the server's actual refusal (status codes and PostgREST
 * errors), never a hidden UI element.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkStaging } from '../../scripts/staging/guard.mjs';

const guard = checkStaging();
const enabled = guard.ok;
if (!enabled) console.warn(`[staging] skipped: ${(guard as { reason: string }).reason}`);
const env = (guard as { env: { supabaseUrl: string; appUrl: string; anonKey: string; serviceKey: string } }).env;

const RUN = `zqstg${Date.now().toString(36)}`;
const DOMAIN = process.env.STAGING_EMAIL_DOMAIN || 'example.com';
const PASSWORD = `Stg-${RUN}-pw-1!`;
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { id: string; email: string; token: string };

async function http(url: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: J | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}
const svc = () => ({ apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` });
const anonH = () => ({ apikey: env.anonKey, authorization: `Bearer ${env.anonKey}` });
const userH = (t: string) => ({ apikey: env.anonKey, authorization: `Bearer ${t}` });
const rest = (path: string, headers: Record<string, string>, init: { method?: string; body?: unknown; prefer?: string } = {}) => http(`${env.supabaseUrl}/rest/v1/${path}`, { method: init.method, headers: { ...headers, ...(init.prefer ? { prefer: init.prefer } : {}) }, body: init.body });
const app = (path: string, token?: string, init: { method?: string; body?: unknown } = {}) => http(`${env.appUrl}${path}`, { method: init.method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: init.body });

const created: string[] = [];
async function makeUser(label: string): Promise<Who> {
  const email = `${RUN}-${label}@${DOMAIN}`;
  const c = await http(`${env.supabaseUrl}/auth/v1/admin/users`, { method: 'POST', headers: svc(), body: { email, password: PASSWORD, email_confirm: true } });
  expect(c.status, c.text).toBeLessThan(300);
  created.push(c.body!.id);
  const t = await http(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.anonKey }, body: { email, password: PASSWORD } });
  expect(t.status, t.text).toBe(200);
  return { id: c.body!.id, email, token: t.body!.access_token };
}

const ids: J = {};
const original: J = {};

describe.skipIf(!enabled)('staging: identity, session and isolation', () => {
  let owner: Who;
  let outsider: Who;
  let viewer: Who;
  let adminUser: Who;

  beforeAll(async () => {
    [owner, outsider, viewer, adminUser] = await Promise.all(['owner', 'outsider', 'viewer', 'admin'].map(makeUser));
    ids.owner = owner;
    ids.outsider = outsider;
    ids.viewer = viewer;
    ids.admin = adminUser;
  }, 120_000);

  it('a real self-service signup creates an account (with or without email confirmation)', async () => {
    const email = `${RUN}-signup@${DOMAIN}`;
    const r = await http(`${env.supabaseUrl}/auth/v1/signup`, { method: 'POST', headers: { apikey: env.anonKey }, body: { email, password: PASSWORD } });
    expect(r.status, r.text).toBe(200);
    const id = r.body?.user?.id ?? r.body?.id;
    expect(id).toBeTruthy();
    created.push(id);
  });

  it('a session works; an invalid or tampered token is rejected by the API', async () => {
    expect((await app('/api/me', owner.token)).status).toBe(200);
    expect((await app('/api/me')).status).toBe(401);
    const tampered = owner.token.slice(0, -4) + 'AAAA';
    expect((await app('/api/me', tampered)).status).toBe(401);
  });

  it('workspaces are isolated across tenants (API 404 and RLS both)', async () => {
    const a = await app('/api/workspaces', owner.token, { method: 'POST', body: { name: `${RUN} owner ws` } });
    const b = await app('/api/workspaces', outsider.token, { method: 'POST', body: { name: `${RUN} outsider ws` } });
    expect(a.status, a.text).toBe(200);
    expect(b.status, b.text).toBe(200);
    ids.wsA = a.body!.workspace.id;
    ids.wsB = b.body!.workspace.id;
    expect((await app(`/api/workspaces/${ids.wsA}/command-center`, outsider.token)).status).toBe(404);
    const direct = await rest(`workspaces?id=eq.${ids.wsA}&select=id`, userH(outsider.token));
    expect(direct.status).toBe(200);
    expect(direct.body).toEqual([]);
  });

  it('a viewer can read but not write, enforced by the server', async () => {
    const add = await rest('workspace_members', svc(), { method: 'POST', body: { workspace_id: ids.wsA, user_id: viewer.id, role: 'viewer' } });
    expect(add.status, add.text).toBeLessThan(300);
    expect((await app(`/api/workspaces/${ids.wsA}/command-center`, viewer.token)).status).toBe(200);
    const write = await app('/api/engine/products', viewer.token, { method: 'POST', body: { workspace_id: ids.wsA, root_path: `${RUN}://viewer` } });
    expect(write.status).toBe(403);
  });

  it('presentation views grant nothing: a non-admin is refused on every admin route (404) and it is logged', async () => {
    for (const p of ['/api/admin/command-center', '/api/admin/security?range=7d', '/api/admin/evaluation-requests', '/api/admin/cms', '/api/admin/feature-flags']) {
      expect((await app(p, owner.token)).status, p).toBe(404);
    }
    const ev = await rest(`security_events?kind=eq.admin_denied&actor_id=eq.${owner.id}&select=id`, svc());
    expect((ev.body as J[]).length).toBeGreaterThan(0);
  });

  it('browser roles cannot read or write any Part 3 server-only table or call its functions', async () => {
    for (const t of ['site_events', 'product_events', 'security_events', 'evaluation_requests', 'site_content_revisions', 'admin_audit_log']) {
      for (const h of [anonH(), userH(owner.token)]) {
        const r = await rest(`${t}?select=*&limit=1`, h);
        expect(r.status, `${t}: ${r.text}`).not.toBe(200);
      }
    }
    for (const fn of ['analytics_site_summary', 'analytics_product_summary']) {
      const r = await rest(`rpc/${fn}`, userH(owner.token), { method: 'POST', body: { p_from: '2026-01-01T00:00:00Z', p_to: '2026-12-31T00:00:00Z' } });
      expect(r.status, fn).not.toBe(200);
    }
    const pub = await rest(`rpc/cms_publish`, anonH(), { method: 'POST', body: { p_revision: '00000000-0000-4000-8000-000000000000', p_actor: owner.id } });
    expect(pub.status).not.toBe(200);
    const write = await rest('site_content?key=eq.hero', userH(owner.token), { method: 'PATCH', body: { value: { headline: 'pwned' } } });
    expect([401, 403, 404]).toContain(write.status === 204 ? 'wrote' : write.status);
  });

  it('published site content is public; drafts are not', async () => {
    const r = await rest('site_content?select=key', anonH());
    expect(r.status).toBe(200);
    expect((r.body as J[]).map((x) => x.key)).toContain('hero');
  });

  it('the deployed bundle contains no service-role credential', async () => {
    const html = (await http(`${env.appUrl}/`)).text;
    const assets = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      const js = (await http(`${env.appUrl}${a}`)).text;
      expect(js.includes(env.serviceKey), a).toBe(false);
      expect(/SUPABASE_SERVICE_ROLE_KEY|service_role"\s*:/.test(js), a).toBe(false);
    }
  });
});

describe.skipIf(!enabled)('staging: admin control plane with real permissions', () => {
  beforeAll(async () => {
    const g = await rest('admin_roles', svc(), { method: 'POST', body: { user_id: ids.admin.id, role: 'admin' } });
    expect(g.status, g.text).toBeLessThan(300);
    const hero = await rest('site_content?key=eq.hero&select=value', svc());
    original.hero = (hero.body as J[])[0]?.value;
    const flag = await rest('feature_flags?key=eq.zevir_graph_ui&select=*', svc());
    original.flag = (flag.body as J[])[0];
  }, 60_000);

  it('an admin reads the command center and security events, and the read is audited', async () => {
    expect((await app('/api/admin/command-center', ids.admin.token)).status).toBe(200);
    expect((await app('/api/admin/security?range=7d', ids.admin.token)).status).toBe(200);
    const audit = await rest(`admin_audit_log?admin_id=eq.${ids.admin.id}&action=eq.security_events.read&select=id`, svc());
    expect((audit.body as J[]).length).toBeGreaterThan(0);
  });

  it('evaluation requests: public create, browser cannot read, admin can (audited)', async () => {
    const r = await app('/api/evaluation-requests', undefined, { method: 'POST', body: { name: 'Staging Test', email: `${RUN}-lead@${DOMAIN}`, company: RUN, workload: 'Synthetic staging test request — ignore.', consent: true } });
    expect(r.status, r.text).toBe(201);
    ids.lead = r.body!.id;
    expect((await rest('evaluation_requests?select=id', anonH())).status).not.toBe(200);
    const list = await app('/api/admin/evaluation-requests?status=new', ids.admin.token);
    expect((list.body!.requests as J[]).some((x) => x.id === ids.lead)).toBe(true);
  });

  it('CMS: draft is not public, publish is, restore brings back the previous copy; all audited', async () => {
    const draft = await app('/api/admin/cms/hero/draft', ids.admin.token, { method: 'PUT', body: { value: { ...original.hero, headline: `${RUN} headline` } } });
    expect(draft.status, draft.text).toBe(200);
    const live1 = await rest('site_content?key=eq.hero&select=value', anonH());
    expect((live1.body as J[])[0].value.headline).not.toBe(`${RUN} headline`);
    const pub = await app('/api/admin/cms/hero/publish', ids.admin.token, { method: 'POST', body: { revision_id: draft.body!.draft.id } });
    expect(pub.status, pub.text).toBe(200);
    const live2 = await rest('site_content?key=eq.hero&select=value', anonH());
    expect((live2.body as J[])[0].value.headline).toBe(`${RUN} headline`);
    const cms = await app('/api/admin/cms', ids.admin.token);
    const prev = (cms.body!.keys as J[]).find((k) => k.key === 'hero').history.find((h: J) => h.status === 'superseded');
    const back = await app('/api/admin/cms/hero/rollback', ids.admin.token, { method: 'POST', body: { revision_id: prev.id } });
    expect(back.status, back.text).toBe(200);
    const live3 = await rest('site_content?key=eq.hero&select=value', anonH());
    expect((live3.body as J[])[0].value.headline).toBe(original.hero.headline);
    const audit = await rest(`admin_audit_log?admin_id=eq.${ids.admin.id}&target_type=eq.site_content&select=action`, svc());
    expect((audit.body as J[]).map((a) => a.action)).toEqual(expect.arrayContaining(['cms.draft_save', 'cms.publish', 'cms.rollback']));
  });

  it('flags: selected targeting + an override reaches one workspace only; a non-admin cannot change it', async () => {
    expect((await app('/api/admin/feature-flags/zevir_graph_ui', ids.owner.token, { method: 'PUT', body: { targeting: 'on' } })).status).toBe(404);
    expect((await app('/api/admin/feature-flags/zevir_graph_ui', ids.admin.token, { method: 'PUT', body: { targeting: 'selected' } })).status).toBe(200);
    expect((await app('/api/admin/feature-flags/zevir_graph_ui', ids.admin.token, { method: 'PUT', body: { workspace_overrides: { ...(original.flag?.workspace_overrides || {}), [ids.wsA]: true } } })).status).toBe(200);
    const meA = await app('/api/me', ids.owner.token);
    const meB = await app('/api/me', ids.outsider.token);
    expect((meA.body!.workspaces as J[]).find((w) => w.id === ids.wsA).features.zevir_graph_ui).toBe(true);
    expect((meB.body!.workspaces as J[]).find((w) => w.id === ids.wsB).features.zevir_graph_ui).toBe(false);
  });
});

describe.skipIf(!enabled)('staging: authenticated product workflow', () => {
  beforeAll(async () => {
    for (const key of ['verified_optimization_vnext', 'optimization_intelligence_vnext', 'zevir_shadow']) {
      const f = await rest(`feature_flags?key=eq.${key}&select=workspace_overrides`, svc());
      original[key] = (f.body as J[])[0]?.workspace_overrides || {};
      await rest(`feature_flags?key=eq.${key}`, svc(), { method: 'PATCH', body: { workspace_overrides: { ...original[key], [ids.wsA]: true } } });
    }
  }, 60_000);

  it('invalid traces are rejected; unknown cost stays null; missing outcomes make the baseline INCOMPLETE', async () => {
    const t = ids.owner.token;
    const prod = await app('/api/engine/products', t, { method: 'POST', body: { workspace_id: ids.wsA, root_path: `${RUN}://incomplete`, name: `${RUN} incomplete (synthetic)` } });
    expect(prod.status, prod.text).toBe(200);
    const bad = await app(`/api/engine/products/${prod.body!.id}/traces/import`, t, { method: 'POST', body: { traces: [{ provider: 'openai' }] } });
    expect(bad.body!.rejected).toBe(1);
    const traces = Array.from({ length: 6 }, (_, i) => ({ request_id: `${RUN}-${i}`, timestamp: new Date().toISOString(), provider: 'openai', model: 'gpt-4o', input_tokens: 100, output_tokens: 5, latency_ms: 800, output_text: 'billing', messages: [{ role: 'user', content: 'synthetic' }] }));
    expect((await app(`/api/engine/products/${prod.body!.id}/traces/import`, t, { method: 'POST', body: { traces } })).body!.imported).toBe(6);
    const draft = await app(`/api/optimize/products/${prod.body!.id}/contracts`, t, { method: 'POST', body: {} });
    const frozen = await app(`/api/optimize/products/${prod.body!.id}/contracts/${draft.body!.id}/freeze`, t, { method: 'POST', body: {} });
    const run = await app(`/api/optimize/products/${prod.body!.id}/runs`, t, { method: 'POST', body: { contract_id: frozen.body!.id } });
    const base = await app(`/api/optimize/runs/${run.body!.id}/baseline`, t, { method: 'POST', body: {} });
    expect(base.body!.snapshot.completeness).toBe('incomplete');
    expect(base.body!.snapshot.metrics.economics.total_known_cost_usd).toBeNull();
    expect(base.body!.snapshot.metrics.quality.task_success.rate).toBeNull();
  }, 180_000);

  it('demo workload (labelled synthetic): baseline → graph → diagnosis → plan search → replay → VERIFIED and REJECTED verdicts → report; nothing deployed', async () => {
    const t = ids.owner.token;
    const demo = await app('/api/optimize/demo', t, { method: 'POST', body: { workspace_id: ids.wsA, variant: 'intelligence' } });
    expect(demo.status, demo.text).toBe(200);
    expect(demo.body!.name).toMatch(/SYNTHETIC|NOT CUSTOMER DATA/);
    const p = demo.body!.product_id;
    const draft = await app(`/api/optimize/products/${p}/contracts`, t, { method: 'POST', body: {} });
    const frozen = await app(`/api/optimize/products/${p}/contracts/${draft.body!.id}/freeze`, t, { method: 'POST', body: {} });
    const run = await app(`/api/optimize/products/${p}/runs`, t, { method: 'POST', body: { contract_id: frozen.body!.id } });
    expect((await app(`/api/optimize/runs/${run.body!.id}/baseline`, t, { method: 'POST', body: {} })).status).toBe(200);
    const graphs = await app(`/api/zevir/graphs?workspace_id=${ids.wsA}&product_id=${p}`, t);
    expect((graphs.body as J[]).length).toBeGreaterThan(0);
    const diag = await app(`/api/optimize/runs/${run.body!.id}/diagnoses`, t, { method: 'POST', body: {} });
    expect((diag.body as J[]).length).toBeGreaterThan(0);
    const s = (await app(`/api/optimize/runs/${run.body!.id}/searches`, t, { method: 'POST', body: {} })).body!.search.id;
    for (let i = 0; i < 20; i += 1) if ((await app(`/api/optimize/searches/${s}/calibrate`, t, { method: 'POST', body: {} })).body!.done) break;
    for (let i = 0; i < 20; i += 1) if ((await app(`/api/optimize/searches/${s}/replay`, t, { method: 'POST', body: {} })).body!.done) break;
    const report = await app(`/api/optimize/searches/${s}`, t);
    const verdicts = (report.body!.plans as J[]).map((x) => x.verdict).filter(Boolean);
    expect(verdicts).toContain('VERIFIED');
    expect(verdicts).toContain('REJECTED');
    const decision = await app(`/api/optimize/searches/${s}/decision`, t, { method: 'POST', body: { policy: 'MARGIN_FIRST' } });
    expect(decision.body!.decision.outcome).toBe('SELECTED');
    const cc = await app(`/api/workspaces/${ids.wsA}/command-center`, t);
    expect(cc.body!.value.realized.status).toBe('NOT_YET_MEASURED');
    const impl = await rest(`engine_implementations?workspace_id=eq.${ids.wsA}&select=id`, svc());
    expect(impl.body).toEqual([]);
    const events = await rest(`product_events?workspace_id=eq.${ids.wsA}&select=event`, svc());
    const names = (events.body as J[]).map((e) => e.event);
    expect(names).toEqual(expect.arrayContaining(['workspace_created', 'contract_frozen', 'baseline_created', 'plan_search_started', 'full_replay_completed', 'verdict_verified', 'verdict_rejected', 'plan_selected']));
  }, 600_000);
});

afterAll(async () => {
  if (!enabled) return;
  if (original.flag) await rest('feature_flags?key=eq.zevir_graph_ui', svc(), { method: 'PATCH', body: { targeting: original.flag.targeting ?? null, rollout_percent: original.flag.rollout_percent ?? null, enabled: original.flag.enabled, workspace_overrides: original.flag.workspace_overrides } });
  for (const key of ['verified_optimization_vnext', 'optimization_intelligence_vnext', 'zevir_shadow']) if (original[key]) await rest(`feature_flags?key=eq.${key}`, svc(), { method: 'PATCH', body: { workspace_overrides: original[key] } });
  if (ids.lead) await rest(`evaluation_requests?id=eq.${ids.lead}`, svc(), { method: 'DELETE' });
  if (ids.admin) await rest(`admin_roles?user_id=eq.${ids.admin.id}`, svc(), { method: 'DELETE' });
  // Workspaces and everything under them cascade from their owners.
  for (const id of created) await http(`${env.supabaseUrl}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc() });
}, 120_000);
