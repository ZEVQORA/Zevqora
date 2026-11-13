/**
 * Recovers staging after an ABORTED staging E2E run (afterAll never ran), from the
 * journal the suite writes before every shared-state mutation.
 *
 *   node scripts/staging/recover-shared-state.mjs --env-file .env.staging.local [--journal .staging-journal/<run>.json]
 *
 * Writes to staging, so it needs the same guard as the suite, including
 * STAGING_WRITES_APPROVED=<approver>@<today UTC>. It restores the hero (direct
 * write: the run's admin session is gone, reported as a warning), removes the
 * run's workspace overrides, deletes disposable flags, deletes the run's users
 * (`<run>-*` emails; workspaces cascade) and its evaluation requests, and verifies
 * each step. The journal is deleted only when every step succeeded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging } from './guard.mjs';
import { cleanBase, parseEnvFile } from './local-e2e.mjs';
import { recoverFromJournal } from './shared-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

function newestJournal() {
  const dir = path.join(root, '.staging-journal');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

async function main() {
  const envFile = path.resolve(root, arg('--env-file') || '.env.staging.local');
  const journalFile = arg('--journal') ? path.resolve(root, arg('--journal')) : newestJournal();
  if (!journalFile || !fs.existsSync(journalFile)) {
    console.log('RECOVERY: no journal found — nothing to recover.');
    return 0;
  }
  if (!fs.existsSync(envFile)) {
    console.log(`RECOVERY REFUSED — env file not found: ${path.relative(root, envFile)}`);
    return 1;
  }
  const staging = Object.fromEntries(Object.entries(parseEnvFile(fs.readFileSync(envFile, 'utf8'))).filter(([k]) => k.startsWith('STAGING_')));
  // No app is contacted; the loopback URL only satisfies the guard's shape check.
  const guard = checkStaging({ ...cleanBase(process.env), ...staging, STAGING_APP_URL: 'http://127.0.0.1:9' });
  if (!guard.ok) {
    console.log(`RECOVERY REFUSED — ${guard.reason}`);
    return 1;
  }
  const { supabaseUrl, serviceKey } = guard.env;
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
  const call = async (url, method = 'GET', body) => {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text };
  };
  const io = { svc: (method, p, body) => call(`${supabaseUrl}/rest/v1/${p}`, method, body), admin: () => null };

  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  if (!/^zqstg[a-z0-9]+$/.test(journal.run || '')) {
    console.log('RECOVERY REFUSED — journal run id is not a staging test run id');
    return 1;
  }
  const deleteRunUsers = async (run) => {
    const problems = [];
    const lead = await io.svc('DELETE', `evaluation_requests?company=eq.${run}`);
    if (lead.status >= 300) problems.push(`evaluation_requests delete HTTP ${lead.status}`);
    const list = await call(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`);
    if (list.status !== 200) throw new Error(`list users HTTP ${list.status}`);
    const mine = (list.body?.users || []).filter((u) => String(u.email || '').startsWith(`${run}-`));
    for (const u of mine) {
      const del = await call(`${supabaseUrl}/auth/v1/admin/users/${u.id}`, 'DELETE');
      if (del.status >= 300) problems.push(`user ${u.id}: delete HTTP ${del.status}`);
      const gone = await call(`${supabaseUrl}/auth/v1/admin/users/${u.id}`);
      if (gone.status !== 404) problems.push(`user ${u.id}: still present`);
    }
    console.log(`RECOVERY: ${mine.length} run user(s) processed`);
    if (problems.length) throw new Error(problems.join(' | '));
  };

  const { problems, log } = await recoverFromJournal(io, journal, { deleteRunUsers });
  for (const line of log) console.log(`RECOVERY ${line}`);
  if (problems.length) {
    console.log(`RECOVERY INCOMPLETE — ${problems.length} problem(s); journal kept at ${path.relative(root, journalFile)}`);
    return 1;
  }
  fs.rmSync(journalFile);
  console.log('RECOVERY COMPLETE — journal removed');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
