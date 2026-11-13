/**
 * Runs the real `vite build` twice with synthetic values (no real keys):
 *   1. VERCEL_ENV=preview + production Supabase URL/anon-key ref  → must FAIL with the isolation message;
 *   2. VERCEL_ENV=preview + staging Supabase URL/anon-key ref     → must build.
 * Output goes to a temporary directory; dist/ is untouched.
 *
 *   node scripts/cto/check-build-isolation.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROD = 'czhufhufvwvgyhjuaauo';
const STAGING = 'lxbcynzgeuqzmynkuzqg';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeAnon = (ref) => [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: 'supabase', ref, role: 'anon' }), 'synthetic-signature'].join('.');

const SECRET_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY', 'VERCEL_ENV'];
function build(ref) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-build-iso-'));
  const env = { ...process.env };
  for (const k of SECRET_NAMES) delete env[k];
  Object.assign(env, { VERCEL_ENV: 'preview', PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, PUBLIC_SUPABASE_ANON_KEY: fakeAnon(ref) });
  const r = spawnSync(`npx vite build --outDir "${outDir}" --emptyOutDir`, { cwd: root, shell: true, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const built = fs.existsSync(path.join(outDir, 'index.html'));
  fs.rmSync(outDir, { recursive: true, force: true });
  return { exit: r.status, built, refused: /refusing to build: PREVIEW_USES_PRODUCTION_SUPABASE/.test(out) };
}

const unsafe = build(PROD);
console.log(`unsafe preview (production ref): exit=${unsafe.exit} built=${unsafe.built} refused=${unsafe.refused}`);
const safe = build(STAGING);
console.log(`isolated preview (staging ref):  exit=${safe.exit} built=${safe.built}`);
const ok = unsafe.exit !== 0 && !unsafe.built && unsafe.refused && safe.exit === 0 && safe.built;
console.log(ok ? 'BUILD_ISOLATION PASS — unsafe preview build refused; isolated preview build succeeds' : 'BUILD_ISOLATION FAIL');
process.exit(ok ? 0 : 1);
