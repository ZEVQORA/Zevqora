/**
 * Local API + isolated staging Supabase E2E harness. No Vercel deployment.
 *
 *   node scripts/staging/local-e2e.mjs --env-file .env.staging.local            # DRY RUN: read-only preflight, no writes
 *   node scripts/staging/local-e2e.mjs --env-file .env.staging.local --execute  # runs npm run test:staging (writes; needs approval)
 *
 * The env file holds STAGING_* values only (template: scripts/staging/staging.env.example;
 * `.env.*` is git-ignored). The API child process gets a clean environment: every
 * inherited Supabase / OpenRouter / Stripe / Vercel variable is removed, then the
 * server variables are set from the STAGING_* values, so a production value in the
 * operator's shell can never reach it. No secret value is printed.
 *
 * --execute additionally requires STAGING_WRITES_APPROVED=<approver>@<today UTC>.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging, preflightDeployment } from './guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const execute = args.includes('--execute');
const port = Number(arg('--port', '3000'));
const envFile = path.resolve(root, arg('--env-file', '.env.staging.local'));

const STRIP = /^(SUPABASE_|PUBLIC_SUPABASE_|STAGING_|OPENROUTER_|STRIPE_|VERCEL|CRON_SECRET$|DESKTOP_HANDOFF_SECRET$|ANALYTICS_SECRET$|SECURITY_HASH_SECRET$)/;

export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export function cleanBase(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !STRIP.test(k)));
}

/** Server environment for the local API, derived only from STAGING_* values. */
export function serverEnv(base, staging, port) {
  return { ...cleanBase(base), PORT: String(port), SUPABASE_URL: staging.STAGING_SUPABASE_URL, PUBLIC_SUPABASE_URL: staging.STAGING_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY: staging.STAGING_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: staging.STAGING_SUPABASE_SERVICE_ROLE_KEY };
}

async function waitForHealth(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!fs.existsSync(envFile)) {
    console.log(`LOCAL_E2E REFUSED — env file not found: ${path.relative(root, envFile)} (copy scripts/staging/staging.env.example)`);
    return 1;
  }
  const staging = Object.fromEntries(Object.entries(parseEnvFile(fs.readFileSync(envFile, 'utf8'))).filter(([k]) => k.startsWith('STAGING_')));
  const appUrl = `http://127.0.0.1:${port}`;
  const testEnv = { ...cleanBase(process.env), ...staging, STAGING_APP_URL: appUrl };
  const guard = checkStaging(testEnv, { requireWriteApproval: execute });
  if (!guard.ok) {
    console.log(`LOCAL_E2E REFUSED — ${guard.reason}`);
    return 1;
  }

  const api = spawn(process.execPath, ['scripts/dev-api.mjs'], { cwd: root, env: serverEnv(process.env, staging, port), stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', () => undefined);
  api.stderr.on('data', () => undefined);
  try {
    if (!(await waitForHealth(appUrl))) {
      console.log('LOCAL_E2E REFUSED — local API did not answer /api/health');
      return 1;
    }
    const pre = await preflightDeployment(guard.env);
    if (!pre.ok) {
      console.log(`LOCAL_E2E REFUSED (preflight) — ${pre.reason}`);
      return 1;
    }
    console.log(`LOCAL_E2E PREFLIGHT PASS — local API ${appUrl} reports environment=${pre.report.environment}, project ${pre.report.supabase_ref}, service key ${pre.report.service_key_project}`);
    if (!execute) {
      console.log('LOCAL_E2E DRY RUN COMPLETE — no staging writes were made. Re-run with --execute and STAGING_WRITES_APPROVED=<approver>@<today> after approval.');
      return 0;
    }
    const build = spawnSync('npx vite build', { cwd: root, shell: true, stdio: 'inherit', env: cleanBase(process.env) });
    if (build.status !== 0) return build.status ?? 1;
    const run = spawnSync('npx vitest run --config vitest.staging.config.ts', { cwd: root, shell: true, stdio: 'inherit', env: testEnv });
    return run.status ?? 1;
  } finally {
    const exited = new Promise((resolve) => api.once('exit', resolve));
    api.kill();
    await exited;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
