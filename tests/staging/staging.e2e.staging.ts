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
 * Every identity and row it creates is tagged with a run id and deleted in afterAll;
 * cleanup is verified (deletion statuses and no remaining rows) and fails the run
 * when anything is left behind.
 *
 * Shared staging state (see scripts/staging/shared-state.mjs): the CMS test publishes to the
 * global `hero` and the product tests add the test workspace to three flags'
 * overrides. Each restore is registered BEFORE its mutation, checks statuses,
 * re-reads what it restored, and runs even when an assertion failed midway;
 * teardown of users/workspaces runs even if a restore fails. Flag targeting is
 * exercised on a disposable flag row, never on a real flag. Append-only history
 * (CMS revisions, admin audit log, security/product events) is not removable.
 * Each mutation is journaled first (.staging-journal/<run>.json); if the run is
 * aborted before afterAll, recover with scripts/staging/recover-shared-state.mjs.
 * Negative tests assert the server's actual refusal (status codes and PostgREST
 * errors), never a hidden UI element.
 *
 * Fails closed: without a passing guard the suite FAILS (it is never silently
 * skipped), and before any write the deployed app must report, through
 * /api/health and /api/public-config, that it is a preview using the staging
 * project.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appHeaders, checkStaging, preflightDeployment } from '../../scripts/staging/guard.mjs';
import { addWorkspaceOverride, CleanupRegistry, createDisposableFlag, deleteDisposableFlag, Journal, removeWorkspaceOverrides, restoreHero, snapshotHero } from '../../scripts/staging/shared-state.mjs';

const guard = checkStaging();
const enabled = guard.ok;
const env = (guard as { env: { supabaseUrl: string; supabaseRef: string; appUrl: string; mode: 'local' | 'preview'; anonKey: string; serviceKey: string; bypass: string | null } }).env;

describe('staging: guard', () => {
  it('is configured for the isolated staging project (otherwise this run fails, it is not skipped)', () => {
    if (!enabled) throw new Error(`STAGING_GUARD REFUSED — ${(guard as { reason: string }).reason}`);
  });
});

beforeAll(async () => {
  if (!enabled) return;
  const p = await preflightDeployment(env);
  if (!p.ok) throw new Error(`STAGING_GUARD REFUSED (deployment preflight) — ${(p as { reason: string }).reason}`);
}, 60_000);

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
const app = (path: string, token?: string, init: { method?: string; body?: unknown } = {}) => http(`${env.appUrl}${path}`, { method: init.method, headers: { ...appHeaders(env), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: init.body });

const created: string[] = [];
async function makeUser(label: string): Promise<Who> {
  const email = `${RUN}-${label}@${DOMAIN}`;
  const c = await http(`${env.supabaseUrl}/auth/v1/admin/users`, { method: 'POST', headers: svc(), body: { email, password: PASSWORD, email_confirm: true } });
  expect(c.status, c.text).toBeLessThan(300);
  created.push(c.body!.id);
  journal.update({}); // an aborted run is recoverable from the first user on (users are found by run id)
  const t = await http(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.anonKey }, body: { email, password: PASSWORD } });
  expect(t.status, t.text).toBe(200);
  return { id: c.body!.id, email, token: t.body!.access_token };
}

const ids: J = {};
const OPTIMIZE_FLAGS = ['verified_optimization_vnext', 'optimization_intelligence_vnext', 'zevir_shadow'];
const DISPOSABLE_FLAG = `${RUN}_flag`;

const io = {
  svc: (method: string, path: string, body?: unknown) => rest(path, svc(), { method, body }),
  admin: (method: string, path: string, body?: unknown) => (ids.admin?.token ? app(path, ids.admin.token, { method, body }) : null),
};
const cleanup = new CleanupRegistry();
const journal = new Journal(join(process.cwd(), '.staging-journal'), RUN);

// Teardown (after every restore, in this order). Registered up front so it always runs.
cleanup.teardown('evaluation request', async () => {
  if (!ids.lead) return;
  const r = await rest(`evaluation_requests?id=eq.${ids.lead}`, svc(), { method: 'DELETE' });
  if (r.status >= 300) throw new Error(`delete HTTP ${r.status}`);
  if (((await rest(`evaluation_requests?id=eq.${ids.lead}&select=id`, svc())).body as J[] | null)?.length) throw new Error('still present');
});
cleanup.teardown('admin role', async () => {
  if (!ids.admin) return;
  const r = await rest(`admin_roles?user_id=eq.${ids.admin.id}`, svc(), { method: 'DELETE' });
  if (r.status >= 300) throw new Error(`delete HTTP ${r.status}`);
  if (((await rest(`admin_roles?user_id=eq.${ids.admin.id}&select=user_id`, svc())).body as J[] | null)?.length) throw new Error('still present');
});
// Workspaces and everything under them cascade from their owners (020 lets an
// owner with frozen contracts and decisions be deleted). Verify, don't assume.
cleanup.teardown('test users', async () => {
  const problems: string[] = [];
  for (const id of created) {
    const del = await http(`${env.supabaseUrl}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc() });
    if (del.status >= 300) problems.push(`user ${id}: delete returned ${del.status} ${del.text.slice(0, 200)}`);
    const gone = await http(`${env.supabaseUrl}/auth/v1/admin/users/${id}`, { headers: svc() });
    if (gone.status !== 404) problems.push(`user ${id}: still present (GET ${gone.status})`);
  }
  if (problems.length) throw new Error(problems.join(' | '));
});
cleanup.teardown('leftover rows', async () => {
  const problems: string[] = [];
  const wsIds = [ids.wsA, ids.wsB].filter(Boolean);
  if (wsIds.length) {
    const left = await rest(`workspaces?id=in.(${wsIds.join(',')})&select=id`, svc());
    if ((left.body as J[] | null)?.length) problems.push(`workspaces left behind: ${JSON.stringify(left.body)}`);
  }
  const leftProducts = await rest(`engine_products?root_path=like.${RUN}*&select=id`, svc());
  if ((leftProducts.body as J[] | null)?.length) problems.push(`engine_products left behind: ${(leftProducts.body as J[]).length}`);
  for (const key of OPTIMIZE_FLAGS) {
    const f = await rest(`feature_flags?key=eq.${key}&select=workspace_overrides`, svc());
    const o = (f.body as J[] | null)?.[0]?.workspace_overrides || {};
    if (wsIds.some((w) => w in o)) problems.push(`${key} still has a test workspace override`);
  }
  if (problems.length) throw new Error(problems.join(' | '));
});

describe.skipIf(!enabled)('staging: identity, session and isolation', () => {
  let owner: Who;
  let outsider: Who;
  let viewer: Who;
  let editor: Who;
  let adminUser: Who;

  beforeAll(async () => {
    [owner, outsider, viewer, editor, adminUser] = await Promise.all(['owner', 'outsider', 'viewer', 'editor', 'admin'].map(makeUser));
    ids.owner = owner;
    ids.outsider = outsider;
    ids.viewer = viewer;
    ids.editor = editor;
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

  it('an editor (member) can write but is refused admin-only actions, enforced by the server', async () => {
    const add = await rest('workspace_members', svc(), { method: 'POST', body: { workspace_id: ids.wsA, user_id: editor.id, role: 'member' } });
    expect(add.status, add.text).toBeLessThan(300);
    const prod = await app('/api/engine/products', editor.token, { method: 'POST', body: { workspace_id: ids.wsA, root_path: `${RUN}://editor`, name: `${RUN} editor (synthetic)` } });
    expect(prod.status, prod.text).toBe(200);
    const contract = await app(`/api/optimize/products/${prod.body!.id}/contracts`, editor.token, { method: 'POST', body: {} });
    expect(contract.status, contract.text).toBe(403);
    expect(contract.body!.code).toBe('FORBIDDEN');
    expect((await app(`/api/workspaces/${ids.wsA}`, editor.token, { method: 'PATCH', body: { name: `${RUN} renamed by editor` } })).status).toBe(403);
  });

  it('cross-tenant writes are refused through the API (404) and through PostgREST/RLS, and nothing changes', async () => {
    const before = await rest(`workspaces?id=eq.${ids.wsA}&select=name`, svc());
    expect((await app('/api/engine/products', outsider.token, { method: 'POST', body: { workspace_id: ids.wsA, root_path: `${RUN}://outsider` } })).status).toBe(404);
    expect((await app(`/api/workspaces/${ids.wsA}`, outsider.token, { method: 'PATCH', body: { name: `${RUN} hijacked` } })).status).toBe(404);
    const join = await rest('workspace_members', userH(outsider.token), { method: 'POST', body: { workspace_id: ids.wsA, user_id: outsider.id, role: 'owner' } });
    expect(join.status, join.text).toBeGreaterThanOrEqual(400);
    // Whatever status PostgREST returns (no UPDATE grant, or RLS filtering every row), the row must not change.
    await rest(`workspaces?id=eq.${ids.wsA}`, userH(outsider.token), { method: 'PATCH', body: { name: `${RUN} hijacked` } });
    const after = await rest(`workspaces?id=eq.${ids.wsA}&select=name`, svc());
    expect(after.body).toEqual(before.body);
    const members = await rest(`workspace_members?workspace_id=eq.${ids.wsA}&user_id=eq.${outsider.id}&select=role`, svc());
    expect(members.body).toEqual([]);
  });

  it('invalid input is rejected with 400 before any work is done', async () => {
    expect((await app('/api/workspaces', owner.token, { method: 'POST', body: { name: '' } })).status).toBe(400);
    expect((await app('/api/workspaces', owner.token, { method: 'POST', body: { name: 'x'.repeat(81) } })).status).toBe(400);
    const badId = await app('/api/engine/products', owner.token, { method: 'POST', body: { workspace_id: 'not-a-uuid', root_path: 'x' } });
    expect(badId.status).toBe(400);
    expect(badId.body!.code).toBe('VALIDATION');
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
    // A loopback API (scripts/dev-api.mjs) serves no site: check the local production build instead.
    const read = async (p: string) => (env.mode === 'local' ? readFileSync(join('dist', p === '/' ? 'index.html' : p), 'utf8') : (await http(`${env.appUrl}${p}`, { headers: appHeaders(env) })).text);
    const html = await read('/');
    const assets = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      const js = await read(a);
      expect(js.includes(env.serviceKey), a).toBe(false);
      expect(/SUPABASE_SERVICE_ROLE_KEY|service_role"\s*:/.test(js), a).toBe(false);
    }
  });
});

describe.skipIf(!enabled)('staging: admin control plane with real permissions', () => {
  beforeAll(async () => {
    const g = await rest('admin_roles', svc(), { method: 'POST', body: { user_id: ids.admin.id, role: 'admin' } });
    expect(g.status, g.text).toBeLessThan(300);
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
    // Shared, public content: snapshot it and register the restore before touching it.
    const snap = await snapshotHero(io);
    if (snap.openDraftId) throw new Error('A hero draft already exists on staging (someone else is editing); refusing to touch shared CMS content.');
    journal.update({ hero: snap });
    cleanup.restore('CMS hero', () => restoreHero(io, snap));
    const original = { hero: snap.value };
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

  it('flags (disposable flag, no real flag touched): selected targeting + an override reaches one workspace only; a non-admin cannot change it', async () => {
    journal.update((j: { disposable_flags: string[] }) => ({ disposable_flags: [...j.disposable_flags, DISPOSABLE_FLAG] }));
    cleanup.restore('disposable flag', () => deleteDisposableFlag(io, DISPOSABLE_FLAG));
    await createDisposableFlag(io, DISPOSABLE_FLAG);
    const path = `/api/admin/feature-flags/${DISPOSABLE_FLAG}`;
    expect((await app(path, ids.owner.token, { method: 'PUT', body: { targeting: 'on' } })).status).toBe(404);
    expect((await app(path, ids.admin.token, { method: 'PUT', body: { targeting: 'selected' } })).status).toBe(200);
    expect((await app(path, ids.admin.token, { method: 'PUT', body: { workspace_overrides: { [ids.wsA]: true } } })).status).toBe(200);
    const row = ((await rest(`feature_flags?key=eq.${DISPOSABLE_FLAG}&select=targeting,workspace_overrides`, svc())).body as J[])[0];
    expect(row).toEqual({ targeting: 'selected', workspace_overrides: { [ids.wsA]: true } });
    // The server's own resolution across every staging workspace: exactly one (wsA) is on.
    const reach = await app('/api/admin/flags/reach', ids.admin.token);
    expect(reach.status, reach.text).toBe(200);
    expect(reach.body!.reach[DISPOSABLE_FLAG].workspaces_on).toBe(1);
  });
});

describe.skipIf(!enabled)('staging: authenticated product workflow', () => {
  beforeAll(async () => {
    // Only the test workspace's own override key is added (and later removed); other keys are never rewritten.
    for (const key of OPTIMIZE_FLAGS) {
      journal.update((j: { flag_overrides: string[] }) => ({ workspaces: [ids.wsA, ids.wsB].filter(Boolean), flag_overrides: [...new Set([...j.flag_overrides, key])] }));
      cleanup.restore(`flag override ${key}`, () => removeWorkspaceOverrides(io, key, [ids.wsA, ids.wsB].filter(Boolean)));
      await addWorkspaceOverride(io, key, ids.wsA);
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
    expect(frozen.status, frozen.text).toBe(200);
    // A frozen contract is immutable in the database itself, even for the service role.
    const tamper = await rest(`evaluation_contracts?id=eq.${frozen.body!.id}`, svc(), { method: 'PATCH', body: { requirements: { quality_floor: 0 } } });
    expect(tamper.status, tamper.text).toBeGreaterThanOrEqual(400);
    expect(tamper.text).toMatch(/CONTRACT_IMMUTABLE/);
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
  const problems = await cleanup.runAll();
  for (const line of cleanup.log) console.log(`[staging] cleanup ${line}`);
  console.log(`[staging] cleanup: ${created.length} users, ${problems.length} problem(s)`);
  if (problems.length) throw new Error(`STAGING CLEANUP INCOMPLETE — ${problems.join(' | ')} — journal kept: ${journal.file} (scripts/staging/recover-shared-state.mjs)`);
  journal.clear();
}, 180_000);
