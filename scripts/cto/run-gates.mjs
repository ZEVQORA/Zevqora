/**
 * Release-gate runner: executes the CI-equivalent commands locally and writes a
 * sanitized, machine-readable record of what actually ran.
 *
 *   node scripts/cto/run-gates.mjs --out ../cto-evidence/run-1 [--only web.test,backend.pytest]
 *
 * For every step it records the timestamp, command, working directory, exit
 * code, parsed test counts and the Git SHA. Full output goes to <out>/<id>.log
 * after redaction; the summary goes to <out>/summary.json. A step that is not
 * executed is recorded as NOT_RUN with the reason, never as passed.
 *
 * Environment: CTO_PYTHON overrides the Python interpreter (default `python`).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = path.resolve(arg('--out', path.join(root, '..', 'cto-evidence', `run-${Date.now()}`)));
const only = arg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const py = process.env.CTO_PYTHON || 'python';

const BACKEND = 'desktop-app/backend';
const DESKTOP = 'desktop-app/desktop';

/** Staging variables are stripped so the staging step can only ever exercise the guard's refusal path here. */
const STAGING_KEYS = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_REF', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY', 'STAGING_APP_URL', 'STAGING_CONFIRM', 'STAGING_WRITES_APPROVED'];

export const STEPS = [
  { id: 'web.typecheck', cwd: '.', cmd: 'npm run typecheck', kind: 'plain' },
  { id: 'web.lint', cwd: '.', cmd: 'npm run lint', kind: 'plain' },
  { id: 'web.test', cwd: '.', cmd: 'npm run test', kind: 'vitest' },
  { id: 'web.verify_release', cwd: '.', cmd: 'npm run verify:release', kind: 'plain' },
  { id: 'web.build', cwd: '.', cmd: 'npm run build', kind: 'plain' },
  { id: 'web.bundle_scan', cwd: '.', cmd: 'node scripts/cto/scan-bundle.mjs dist', kind: 'plain' },
  { id: 'web.api_load', cwd: '.', cmd: `node --input-type=module -e "await import('./api/index.js'); console.log('api ok')"`, kind: 'plain' },
  { id: 'web.secret_scan', cwd: '.', cmd: `git grep -nIE "sk-or-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}" -- . ":!docs" ":!tests" ":!api/_lib/sanitize.js" ":!desktop-app/backend/artifacts"`, kind: 'secret_scan' },
  { id: 'backend.ruff_check', cwd: BACKEND, cmd: `${py} -m ruff check .`, kind: 'plain' },
  { id: 'backend.ruff_format', cwd: BACKEND, cmd: `${py} -m ruff format --check .`, kind: 'plain' },
  { id: 'backend.pytest', cwd: BACKEND, cmd: `${py} -m pytest -q`, kind: 'pytest' },
  { id: 'desktop.typecheck', cwd: DESKTOP, cmd: 'npm run typecheck', kind: 'plain' },
  { id: 'desktop.build', cwd: DESKTOP, cmd: 'npx vite build', kind: 'plain' },
  { id: 'desktop.electron_parse', cwd: DESKTOP, cmd: 'node --check electron/main.cjs && node --check electron/preload.cjs', kind: 'plain' },
  { id: 'evidence.verify', cwd: '.', cmd: `${py} scripts/verify_evidence.py`, kind: 'plain' },
  { id: 'staging.guard_refusal', cwd: '.', cmd: 'npm run test:staging', kind: 'staging_refusal', stripStaging: true },
];

const REDACTIONS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/g, '[REDACTED_SUPABASE_KEY]'],
  [/sk-(or-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]'],
  [/(service_role|SERVICE_ROLE_KEY|password|secret|token)(["'\s:=]+)([^\s"',]{12,})/gi, '$1$2[REDACTED]'],
  [/C:\\Users\\[^\\]+/gi, 'C:\\Users\\<user>'],
];
export function sanitize(text) {
  return REDACTIONS.reduce((t, [re, rep]) => t.replace(re, rep), text);
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s) => s.replace(ANSI, '');
export function parseCounts(kind, text) {
  const t = strip(text);
  if (kind === 'vitest') {
    const line = t.split(/\r?\n/).find((l) => /^\s*Tests\s+/.test(l)) || '';
    const files = t.split(/\r?\n/).find((l) => /^\s*Test Files\s+/.test(l)) || '';
    const n = (re, s) => Number((s.match(re) || [])[1] || 0);
    return { passed: n(/(\d+) passed/, line), failed: n(/(\d+) failed/, line), skipped: n(/(\d+) skipped/, line), todo: n(/(\d+) todo/, line), files_passed: n(/(\d+) passed/, files), files_failed: n(/(\d+) failed/, files), files_skipped: n(/(\d+) skipped/, files), raw: line.trim() || null };
  }
  if (kind === 'pytest') {
    const line = [...t.split(/\r?\n/)].reverse().find((l) => /\d+ (passed|failed|error)/.test(l)) || '';
    const n = (re) => Number((line.match(re) || [])[1] || 0);
    return { passed: n(/(\d+) passed/), failed: n(/(\d+) failed/), skipped: n(/(\d+) skipped/), errors: n(/(\d+) errors?/), raw: line.trim() || null };
  }
  return null;
}

function git(cmd) {
  const r = spawnSync(`git ${cmd}`, { cwd: root, shell: true, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runStep(step) {
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0' };
  if (step.stripStaging) for (const k of STAGING_KEYS) delete env[k];
  const started = new Date();
  const r = spawnSync(step.cmd, { cwd: path.join(root, step.cwd), shell: true, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60_000 });
  const ended = new Date();
  const output = sanitize(`${r.stdout || ''}${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''}`);
  fs.writeFileSync(path.join(out, `${step.id}.log`), output);
  const exit = r.status ?? (r.error ? -1 : null);
  let status = exit === 0 ? 'PASS' : 'FAIL';
  let note = null;
  if (step.kind === 'secret_scan') {
    // git grep exits 1 when nothing matches: that is the passing outcome.
    status = exit === 1 && !output.trim() ? 'PASS' : exit === 0 ? 'FAIL' : 'ERROR';
    note = status === 'PASS' ? 'no secret-shaped strings found' : 'secret-shaped string matched or git grep error';
  }
  if (step.kind === 'staging_refusal') {
    const refused = /STAGING_GUARD REFUSED/.test(output);
    status = exit !== 0 && refused ? 'BLOCKED' : exit === 0 ? 'UNEXPECTED_RUN' : 'ERROR';
    note = refused ? 'guard refused (no verified isolated staging configured); 0 staging tests executed' : 'guard did not refuse as expected';
  }
  const counts = parseCounts(step.kind, output);
  if (counts && status === 'PASS' && (counts.failed || counts.errors)) status = 'FAIL';
  return { id: step.id, cwd: step.cwd, command: step.cmd, started_at: started.toISOString(), ended_at: ended.toISOString(), duration_ms: ended - started, exit_code: exit, status, counts, note, log: `${step.id}.log`, tail: output.split(/\r?\n/).filter(Boolean).slice(-6).join('\n') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, { recursive: true });
  const selected = STEPS.filter((s) => !only.length || only.includes(s.id));
  const summary = {
    schema: 'zevqora.release-gates.v1',
    generated_at: new Date().toISOString(),
    git: { sha: git('rev-parse HEAD'), branch: git('rev-parse --abbrev-ref HEAD'), dirty: Boolean(git('status --porcelain')) },
    host: { platform: process.platform, node: process.version, python: (spawnSync(`${py} --version`, { shell: true, encoding: 'utf8' }).stdout || '').trim() || null },
    steps: [],
    not_run: STEPS.filter((s) => !selected.includes(s)).map((s) => ({ id: s.id, command: s.cmd, status: 'NOT_RUN', reason: 'not selected for this invocation' })),
  };
  for (const step of selected) {
    process.stdout.write(`[gates] ${step.id} … `);
    const res = runStep(step);
    summary.steps.push(res);
    process.stdout.write(`${res.status} (exit ${res.exit_code}, ${Math.round(res.duration_ms / 1000)}s)${res.counts?.raw ? ` — ${res.counts.raw}` : ''}\n`);
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  }
  const bad = summary.steps.filter((s) => !['PASS', 'BLOCKED'].includes(s.status));
  console.log(`[gates] wrote ${path.join(out, 'summary.json')} — ${summary.steps.length} run, ${bad.length} not passing`);
  process.exit(bad.length ? 1 : 0);
}
