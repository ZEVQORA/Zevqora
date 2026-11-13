/**
 * Safe handling of SHARED staging state for the staging E2E suite.
 *
 * The suite must leave the staging project exactly as it found it, even when an
 * assertion fails midway or the run is aborted:
 *  - every restore is registered BEFORE the mutation it undoes, and journaled to
 *    disk (.staging-journal/<run>.json) so an aborted run can be recovered with
 *    scripts/staging/recover-shared-state.mjs;
 *  - every restore checks the response status and re-reads the value it restored;
 *  - cleanup never stops at the first failure: problems are accumulated, user /
 *    workspace teardown still runs, and the run fails when anything is left over.
 *
 * Mutated shared state and how it is handled:
 *  - site_content `hero` (CMS publish): snapshot first; restore by republishing the
 *    original revision through the admin API, falling back to a direct service-role
 *    write (reported as a problem, because revision history then lags the live value);
 *    verified by deep comparison.
 *  - feature_flags workspace_overrides of the optimize flags: only the test workspaces'
 *    own keys are added and removed (other keys are left as they are, so a concurrent
 *    edit is not clobbered); verified absent afterwards.
 *  - Flag targeting is exercised on a DISPOSABLE flag row (`<run>_flag`), never on a
 *    real flag; it is deleted and verified gone.
 *
 * Irreversible by design (append-only audit/history, labelled synthetic by the run id):
 * site_content_revisions rows (draft, published, superseded, restore), admin_audit_log,
 * security_events and product_events rows written during the run.
 *
 * Transport (`io`): { svc(method, restPath, body) → {status, body, text},
 *                     admin(method, apiPath, body) → Promise<{...}> | null when no admin session }.
 */
import fs from 'node:fs';
import path from 'node:path';

const ok = (r) => r.status >= 200 && r.status < 300;
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
export const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fail = (what, r) => new Error(`${what}: HTTP ${r.status} ${String(r.text || '').slice(0, 160)}`);

// ------------------------------------------------------------------ cleanup registry
/**
 * Restores run last-registered-first (undo order), then teardown steps in order.
 * A step reports a problem by throwing; a returned string is a warning that also
 * counts as a problem (e.g. a fallback restore that succeeded but is not clean).
 */
export class CleanupRegistry {
  constructor() {
    this.restores = [];
    this.teardowns = [];
    this.log = [];
  }

  restore(name, run) {
    this.restores.push({ name, run });
  }

  teardown(name, run) {
    this.teardowns.push({ name, run });
  }

  async runAll() {
    const problems = [];
    for (const step of [...[...this.restores].reverse(), ...this.teardowns]) {
      try {
        const warning = await step.run();
        if (warning) problems.push(`${step.name}: ${warning}`);
        this.log.push(`${step.name}: ${warning ? `WARN ${warning}` : 'ok'}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        problems.push(`${step.name}: ${msg}`);
        this.log.push(`${step.name}: FAIL ${msg}`);
      }
    }
    this.restores = [];
    this.teardowns = [];
    return problems;
  }
}

// ------------------------------------------------------------------ journal (aborted runs)
export class Journal {
  /** `dir` null disables the journal (unit tests). */
  constructor(dir, run) {
    this.file = dir ? path.join(dir, `${run}.json`) : null;
    this.data = { run, started_at: new Date().toISOString(), hero: null, flag_overrides: [], workspaces: [], disposable_flags: [] };
  }

  update(patch) {
    Object.assign(this.data, typeof patch === 'function' ? patch(this.data) : patch);
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  clear() {
    if (this.file && fs.existsSync(this.file)) fs.rmSync(this.file);
  }
}

// ------------------------------------------------------------------ CMS hero
export async function snapshotHero(io) {
  const live = await io.svc('GET', 'site_content?key=eq.hero&select=value');
  if (!ok(live) || !Array.isArray(live.body) || !live.body.length) throw fail('read live hero', live);
  const revs = await io.svc('GET', 'site_content_revisions?key=eq.hero&status=in.(published,draft)&select=id,status');
  if (!ok(revs)) throw fail('read hero revisions', revs);
  const rows = revs.body || [];
  return { value: live.body[0].value, publishedRevisionId: rows.find((r) => r.status === 'published')?.id ?? null, openDraftId: rows.find((r) => r.status === 'draft')?.id ?? null };
}

/**
 * Brings the live hero back to `snap.value` and leaves no open draft behind.
 * Returns a warning when only the direct-write fallback worked.
 */
export async function restoreHero(io, snap) {
  const now = await snapshotHero(io);
  // 1. Discard any draft the run left open (a pre-existing draft makes the suite refuse to start the CMS test).
  if (now.openDraftId && now.openDraftId !== snap.openDraftId) {
    const viaApi = io.admin('DELETE', '/api/admin/cms/hero/draft');
    const r = viaApi ? await viaApi : await io.svc('PATCH', `site_content_revisions?id=eq.${now.openDraftId}&status=eq.draft`, { status: 'discarded' });
    if (!ok(r) && r.status !== 404) throw fail('discard open hero draft', r);
    const again = await snapshotHero(io);
    if (again.openDraftId && again.openDraftId !== snap.openDraftId) throw new Error('open hero draft still present after discard');
  }
  if (sameJson((await snapshotHero(io)).value, snap.value)) return undefined;

  // 2. Republish the original revision (keeps revision history truthful).
  let apiError = snap.publishedRevisionId ? 'no admin session' : 'no original published revision';
  const viaApi = snap.publishedRevisionId ? io.admin('POST', '/api/admin/cms/hero/rollback', { revision_id: snap.publishedRevisionId }) : null;
  if (viaApi) {
    const r = await viaApi;
    if (ok(r) && sameJson((await snapshotHero(io)).value, snap.value)) return undefined;
    apiError = ok(r) ? 'rollback returned success but the live value differs' : `rollback HTTP ${r.status}`;
  }

  // 3. Last resort: write the original value directly, then verify.
  const w = await io.svc('PATCH', 'site_content?key=eq.hero', { value: snap.value });
  if (!ok(w)) throw new Error(`hero NOT restored (${apiError}; direct write HTTP ${w.status})`);
  if (!sameJson((await snapshotHero(io)).value, snap.value)) throw new Error(`hero NOT restored (${apiError}; direct write did not take effect)`);
  return `hero restored only by direct service-role write (${apiError}); revision history no longer matches the live value`;
}

// ------------------------------------------------------------------ feature flags
async function flagRow(io, key) {
  const r = await io.svc('GET', `feature_flags?key=eq.${key}&select=*`);
  if (!ok(r)) throw fail(`read flag ${key}`, r);
  return (r.body || [])[0] ?? null;
}

/** Adds `workspaceId: true` to one flag's overrides, leaving every other key as it is. Verified. */
export async function addWorkspaceOverride(io, key, workspaceId) {
  const row = await flagRow(io, key);
  if (!row) throw new Error(`flag ${key} does not exist`);
  const r = await io.svc('PATCH', `feature_flags?key=eq.${key}`, { workspace_overrides: { ...(row.workspace_overrides || {}), [workspaceId]: true } });
  if (!ok(r)) throw fail(`set override on ${key}`, r);
  if ((await flagRow(io, key))?.workspace_overrides?.[workspaceId] !== true) throw new Error(`override on ${key} not applied`);
}

/** Removes only the given workspaces' keys from a flag's overrides. Verified. */
export async function removeWorkspaceOverrides(io, key, workspaceIds) {
  const row = await flagRow(io, key);
  if (!row) return;
  const current = { ...(row.workspace_overrides || {}) };
  if (!workspaceIds.some((id) => id in current)) return;
  for (const id of workspaceIds) delete current[id];
  const r = await io.svc('PATCH', `feature_flags?key=eq.${key}`, { workspace_overrides: current });
  if (!ok(r)) throw fail(`remove test overrides from ${key}`, r);
  const after = (await flagRow(io, key))?.workspace_overrides || {};
  const left = workspaceIds.filter((id) => id in after);
  if (left.length) throw new Error(`test overrides still on ${key}: ${left.join(', ')}`);
}

/** Disposable flag row for exercising targeting without touching any real flag. */
export async function createDisposableFlag(io, key) {
  const r = await io.svc('POST', 'feature_flags', { key, description: 'STAGING E2E disposable flag — safe to delete', enabled: false, targeting: 'off', workspace_overrides: {} });
  if (!ok(r)) throw fail(`create disposable flag ${key}`, r);
}

export async function deleteDisposableFlag(io, key) {
  const r = await io.svc('DELETE', `feature_flags?key=eq.${key}`);
  if (!ok(r)) throw fail(`delete disposable flag ${key}`, r);
  if (await flagRow(io, key)) throw new Error(`disposable flag ${key} still present`);
}

// ------------------------------------------------------------------ recovery of an aborted run
/**
 * Replays every restore recorded in a journal, then `deleteRunUsers(run)` (which must
 * delete and verify the run's auth users; workspaces cascade). Returns the problems.
 */
export async function recoverFromJournal(io, journal, { deleteRunUsers }) {
  const reg = new CleanupRegistry();
  if (journal.hero) reg.restore('CMS hero', () => restoreHero(io, journal.hero));
  for (const key of journal.flag_overrides || []) reg.restore(`flag override ${key}`, () => removeWorkspaceOverrides(io, key, journal.workspaces || []));
  for (const key of journal.disposable_flags || []) reg.restore(`disposable flag ${key}`, () => deleteDisposableFlag(io, key));
  reg.teardown('run users', () => deleteRunUsers(journal.run));
  const problems = await reg.runAll();
  return { problems, log: reg.log };
}
