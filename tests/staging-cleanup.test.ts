/**
 * Injected-failure regression for the staging suite's shared-state cleanup
 * (tests/staging/shared-state.ts). An in-memory stand-in for the staging
 * PostgREST + admin CMS API (same semantics as api/_lib/cms-store.js: one open
 * draft, publish supersedes, rollback republishes a copy and refuses while a
 * draft is open) lets each scenario fail midway and prove that cleanup restores
 * and verifies shared state, keeps going after a failed step, and still tears
 * down test users.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addWorkspaceOverride, CleanupRegistry, createDisposableFlag, deleteDisposableFlag, Journal, recoverFromJournal, removeWorkspaceOverrides, restoreHero, sameJson, snapshotHero } from '../scripts/staging/shared-state.mjs';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Res = { status: number; body: J | null; text: string };
interface StagingIO {
  svc(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: J): Promise<Res>;
  admin(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: J): Promise<Res> | null;
}
const HERO = { headline: 'Make AI cheaper without guessing.', supporting: 'Seeded.' };
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const FOREIGN_WS = 'f3333333-3333-4333-8333-333333333333';

class FakeStaging implements StagingIO {
  live: J = { hero: structuredClone(HERO) };
  revisions: J[] = [{ id: 'rev-1', key: 'hero', version: 1, status: 'published', value: structuredClone(HERO) }];
  flags = new Map<string, J>([
    ['verified_optimization_vnext', { key: 'verified_optimization_vnext', targeting: null, workspace_overrides: { [FOREIGN_WS]: true } }],
    ['optimization_intelligence_vnext', { key: 'optimization_intelligence_vnext', targeting: null, workspace_overrides: {} }],
  ]);
  users = new Set(['u-owner', 'u-admin']);
  adminSession = true;
  /** `${method} ${pathPrefix}` → HTTP status to return instead of performing the call. */
  failures = new Map<string, number>();
  /** Writes that report success without changing anything. */
  silentNoop = new Set<string>();
  calls: string[] = [];
  private seq = 1;

  private res(status: number, body: unknown = null): Res {
    return { status, body, text: body === null ? '' : JSON.stringify(body) };
  }
  private injected(sig: string): Res | null {
    for (const [prefix, status] of this.failures) if (sig.startsWith(prefix)) return this.res(status, { message: 'injected failure' });
    return null;
  }

  async svc(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: J): Promise<Res> {
    const sig = `svc ${method} ${path}`;
    this.calls.push(sig);
    const inj = this.injected(sig);
    if (inj) return inj;
    const noop = [...this.silentNoop].some((p) => sig.startsWith(p));
    if (path.startsWith('site_content?key=eq.hero')) {
      if (method === 'GET') return this.res(200, [{ value: structuredClone(this.live.hero) }]);
      if (method === 'PATCH' && !noop) this.live.hero = structuredClone(body!.value);
      return this.res(204);
    }
    if (path.startsWith('site_content_revisions?key=eq.hero')) return this.res(200, this.revisions.filter((r) => ['published', 'draft'].includes(r.status)).map(({ id, status }) => ({ id, status })));
    if (path.startsWith('site_content_revisions?id=eq.')) {
      const id = path.slice('site_content_revisions?id=eq.'.length).split('&')[0];
      const r = this.revisions.find((x) => x.id === id && x.status === 'draft');
      if (r && !noop) r.status = body!.status;
      return this.res(204);
    }
    const key = /feature_flags\?key=eq\.([a-z0-9_]+)/.exec(path)?.[1];
    if (path === 'feature_flags' && method === 'POST') {
      this.flags.set(body!.key, structuredClone(body!));
      return this.res(201);
    }
    if (key && method === 'GET') return this.res(200, this.flags.has(key) ? [structuredClone(this.flags.get(key))] : []);
    if (key && method === 'PATCH') {
      if (!noop && this.flags.has(key)) Object.assign(this.flags.get(key)!, structuredClone(body!));
      return this.res(204);
    }
    if (key && method === 'DELETE') {
      if (!noop) this.flags.delete(key);
      return this.res(204);
    }
    return this.res(404, { message: `fake: unhandled ${sig}` });
  }

  admin(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: J): Promise<Res> | null {
    if (!this.adminSession) return null;
    const sig = `admin ${method} ${path}`;
    this.calls.push(sig);
    const inj = this.injected(sig);
    if (inj) return Promise.resolve(inj);
    const open = () => this.revisions.find((r) => r.status === 'draft');
    if (method === 'PUT' && path === '/api/admin/cms/hero/draft') {
      const d = open();
      if (d) d.value = structuredClone(body!.value);
      else this.revisions.push({ id: `rev-${++this.seq}`, key: 'hero', version: this.revisions.length + 1, status: 'draft', value: structuredClone(body!.value) });
      return Promise.resolve(this.res(200, { draft: { id: open()!.id } }));
    }
    if (method === 'DELETE' && path === '/api/admin/cms/hero/draft') {
      const d = open();
      if (!d) return Promise.resolve(this.res(404));
      d.status = 'discarded';
      return Promise.resolve(this.res(200));
    }
    if (method === 'POST' && path === '/api/admin/cms/hero/publish') return Promise.resolve(this.publish(body!.revision_id));
    if (method === 'POST' && path === '/api/admin/cms/hero/rollback') {
      const target = this.revisions.find((r) => r.id === body!.revision_id);
      if (!target || !['published', 'superseded'].includes(target.status)) return Promise.resolve(this.res(409, { code: 'NOT_PUBLISHED' }));
      if (target.status === 'published') return Promise.resolve(this.res(409, { code: 'ALREADY_LIVE' }));
      if (open()) return Promise.resolve(this.res(409, { code: 'DRAFT_OPEN' }));
      const copy = { id: `rev-${++this.seq}`, key: 'hero', version: this.revisions.length + 1, status: 'draft', value: structuredClone(target.value) };
      this.revisions.push(copy);
      return Promise.resolve(this.publish(copy.id));
    }
    return Promise.resolve(this.res(404));
  }

  private publish(id: string): Res {
    const d = this.revisions.find((r) => r.id === id && r.status === 'draft');
    if (!d) return this.res(409, { code: 'NOT_A_DRAFT' });
    for (const r of this.revisions) if (r.status === 'published') r.status = 'superseded';
    d.status = 'published';
    this.live.hero = structuredClone(d.value);
    return this.res(200);
  }
}

/** The suite's shape: restores registered before each mutation, user teardown registered up front. */
function suite(fake: FakeStaging) {
  const cleanup = new CleanupRegistry();
  cleanup.teardown('test users', async () => {
    for (const u of ['u-owner', 'u-admin']) fake.users.delete(u);
    if (fake.users.size) throw new Error('users left');
  });
  const cms = async (failAt: 'after_draft' | 'after_publish' | 'none') => {
    const snap = await snapshotHero(fake);
    if (snap.openDraftId) throw new Error('refusing: existing draft');
    cleanup.restore('CMS hero', () => restoreHero(fake, snap));
    const draft = await fake.admin('PUT', '/api/admin/cms/hero/draft', { value: { ...snap.value, headline: 'zqstg headline' } })!;
    if (failAt === 'after_draft') throw new Error('injected assertion failure after draft');
    await fake.admin('POST', '/api/admin/cms/hero/publish', { revision_id: draft.body!.draft.id });
    if (failAt === 'after_publish') throw new Error('injected assertion failure after publish');
  };
  const flags = async (failAt: 'after_first_override' | 'none') => {
    for (const key of ['verified_optimization_vnext', 'optimization_intelligence_vnext']) {
      cleanup.restore(`flag override ${key}`, () => removeWorkspaceOverrides(fake, key, [WS_A, WS_B]));
      await addWorkspaceOverride(fake, key, WS_A);
      if (failAt === 'after_first_override') throw new Error('injected failure after first override');
    }
  };
  const disposable = async () => {
    cleanup.restore('disposable flag', () => deleteDisposableFlag(fake, 'zqstgtest_flag'));
    await createDisposableFlag(fake, 'zqstgtest_flag');
    throw new Error('injected failure after creating the disposable flag');
  };
  return { cleanup, cms, flags, disposable };
}

const flagOverrides = (fake: FakeStaging, key: string) => fake.flags.get(key)!.workspace_overrides;

describe('staging shared-state cleanup — injected failures', () => {
  it('assertion fails AFTER publishing the hero: cleanup republishes the original, verifies it and leaves no draft', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.cms('after_publish')).rejects.toThrow('injected');
    expect(fake.live.hero.headline).toBe('zqstg headline'); // shared state really was modified
    expect(await s.cleanup.runAll()).toEqual([]);
    expect(sameJson(fake.live.hero, HERO)).toBe(true);
    expect(fake.revisions.filter((r) => r.status === 'draft')).toEqual([]);
    expect(fake.calls).toContain('admin POST /api/admin/cms/hero/rollback');
    expect(fake.users.size).toBe(0);
  });

  it('assertion fails AFTER saving a draft: cleanup discards the draft; the live hero was never changed', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.cms('after_draft')).rejects.toThrow('injected');
    expect(fake.revisions.some((r) => r.status === 'draft')).toBe(true);
    expect(await s.cleanup.runAll()).toEqual([]);
    expect(fake.revisions.filter((r) => r.status === 'draft')).toEqual([]);
    expect(sameJson(fake.live.hero, HERO)).toBe(true);
    expect(fake.calls).not.toContain('admin POST /api/admin/cms/hero/rollback');
  });

  it('the rollback API fails: the direct write restores the hero, the run is still FAILED (reported), and users are still deleted', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.cms('after_publish')).rejects.toThrow('injected');
    fake.failures.set('admin POST /api/admin/cms/hero/rollback', 500);
    const problems = await s.cleanup.runAll();
    expect(sameJson(fake.live.hero, HERO)).toBe(true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/CMS hero: hero restored only by direct service-role write \(rollback HTTP 500\)/);
    expect(fake.users.size).toBe(0);
  });

  it('every restore path fails: the hero is reported NOT restored, and teardown still runs', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.cms('after_publish')).rejects.toThrow('injected');
    fake.failures.set('admin POST /api/admin/cms/hero/rollback', 500);
    fake.failures.set('svc PATCH site_content?key=eq.hero', 503);
    const problems = await s.cleanup.runAll();
    expect(problems.join(' | ')).toMatch(/CMS hero: hero NOT restored \(rollback HTTP 500; direct write HTTP 503\)/);
    expect(fake.users.size).toBe(0);
  });

  it('a write that reports success but changes nothing is caught by re-reading (no false "restored")', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.cms('after_publish')).rejects.toThrow('injected');
    fake.adminSession = false; // admin already gone → direct write path
    fake.silentNoop.add('svc PATCH site_content?key=eq.hero');
    const problems = await s.cleanup.runAll();
    expect(problems.join(' | ')).toMatch(/hero NOT restored \(no admin session; direct write did not take effect\)/);
  });

  it('failure after the first flag override: every registered override is removed, foreign overrides are preserved', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.flags('after_first_override')).rejects.toThrow('injected');
    expect(flagOverrides(fake, 'verified_optimization_vnext')).toEqual({ [FOREIGN_WS]: true, [WS_A]: true });
    // Someone else edits the shared row while the suite runs.
    flagOverrides(fake, 'verified_optimization_vnext')['c4444444-4444-4444-8444-444444444444'] = false;
    expect(await s.cleanup.runAll()).toEqual([]);
    expect(flagOverrides(fake, 'verified_optimization_vnext')).toEqual({ [FOREIGN_WS]: true, 'c4444444-4444-4444-8444-444444444444': false });
    expect(flagOverrides(fake, 'optimization_intelligence_vnext')).toEqual({});
  });

  it('a flag restore PATCH that fails is reported with its status, the next restores and teardown still run', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await expect(s.flags('none')).resolves.toBeUndefined();
    fake.failures.set('svc PATCH feature_flags?key=eq.verified_optimization_vnext', 500);
    const problems = await s.cleanup.runAll();
    expect(problems).toEqual([expect.stringMatching(/^flag override verified_optimization_vnext: remove test overrides from verified_optimization_vnext: HTTP 500/)]);
    expect(flagOverrides(fake, 'optimization_intelligence_vnext')).toEqual({});
    expect(fake.users.size).toBe(0);
  });

  it('a flag restore whose PATCH silently does nothing is caught by verification', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    await s.flags('none');
    fake.silentNoop.add('svc PATCH feature_flags?key=eq.optimization_intelligence_vnext');
    const problems = await s.cleanup.runAll();
    expect(problems).toEqual([expect.stringMatching(/test overrides still on optimization_intelligence_vnext: a1111111/)]);
  });

  it('failure right after creating the disposable flag: the flag is deleted and verified gone; real flags untouched', async () => {
    const fake = new FakeStaging();
    const s = suite(fake);
    const before = structuredClone([...fake.flags.entries()]);
    await expect(s.disposable()).rejects.toThrow('injected');
    expect(fake.flags.has('zqstgtest_flag')).toBe(true);
    expect(await s.cleanup.runAll()).toEqual([]);
    expect([...fake.flags.entries()]).toEqual(before);
  });

  it('restores run in undo order (last mutation first), then teardown; the registry is empty afterwards', async () => {
    const order: string[] = [];
    const reg = new CleanupRegistry();
    reg.teardown('users', async () => void order.push('users'));
    reg.restore('first', async () => void order.push('first'));
    reg.restore('second', async () => {
      order.push('second');
      throw new Error('boom');
    });
    expect(await reg.runAll()).toEqual(['second: boom']);
    expect(order).toEqual(['second', 'first', 'users']);
    expect(await reg.runAll()).toEqual([]);
  });

  it('ABORTED run (afterAll never ran): the journal written before each mutation is enough to recover everything', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-journal-'));
    try {
      const fake = new FakeStaging();
      const journal = new Journal(dir, 'zqstgabort1');
      // The suite's sequence, then the process dies: no cleanup.runAll().
      journal.update({});
      const snap = await snapshotHero(fake);
      journal.update({ hero: snap });
      const draft = await fake.admin('PUT', '/api/admin/cms/hero/draft', { value: { ...snap.value, headline: 'zqstg headline' } })!;
      await fake.admin('POST', '/api/admin/cms/hero/publish', { revision_id: draft.body!.draft.id });
      journal.update({ workspaces: [WS_A, WS_B], flag_overrides: ['verified_optimization_vnext'] });
      await addWorkspaceOverride(fake, 'verified_optimization_vnext', WS_A);
      journal.update({ disposable_flags: ['zqstgabort1_flag'] });
      await createDisposableFlag(fake, 'zqstgabort1_flag');

      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'zqstgabort1.json'), 'utf8'));
      expect(onDisk).toMatchObject({ run: 'zqstgabort1', hero: { value: HERO }, flag_overrides: ['verified_optimization_vnext'], disposable_flags: ['zqstgabort1_flag'] });

      fake.adminSession = false; // the run's admin token died with the process
      const deleted: string[] = [];
      const { problems, log } = await recoverFromJournal(fake, onDisk, { deleteRunUsers: async (run: string) => void deleted.push(run) });
      expect(sameJson(fake.live.hero, HERO)).toBe(true);
      expect(flagOverrides(fake, 'verified_optimization_vnext')).toEqual({ [FOREIGN_WS]: true });
      expect(fake.flags.has('zqstgabort1_flag')).toBe(false);
      expect(deleted).toEqual(['zqstgabort1']);
      // Restored, but only by direct write: reported, so recovery is not silently "clean".
      expect(problems).toEqual([expect.stringMatching(/^CMS hero: hero restored only by direct service-role write \(no admin session\)/)]);
      expect(log).toEqual(expect.arrayContaining(['disposable flag zqstgabort1_flag: ok', 'flag override verified_optimization_vnext: ok', 'run users: ok']));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to touch the hero when someone else already has a draft open', async () => {
    const fake = new FakeStaging();
    fake.revisions.push({ id: 'rev-x', key: 'hero', version: 2, status: 'draft', value: { headline: 'someone else' } });
    const s = suite(fake);
    await expect(s.cms('none')).rejects.toThrow('refusing: existing draft');
    expect(await s.cleanup.runAll()).toEqual([]);
    expect(fake.revisions.find((r) => r.id === 'rev-x')!.status).toBe('draft');
  });
});
