/**
 * Scans the built browser bundle (dist/) for privileged credentials.
 *
 *   npm run build && node scripts/cto/scan-bundle.mjs [distDir]
 *
 * Fails on: any JWT whose role claim is service_role (anon keys are public by
 * design and allowed), secret-key shapes, the service-role variable name, and
 * — when present in this process environment — the literal value of any
 * server-only variable. Other server variable names are reported as INFO: the
 * admin pages label them and the browser repo scanner matches them in user
 * code; a name is not a credential. Prints file names and finding kinds only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.resolve(process.argv[2] || path.join(root, 'dist'));

export const SERVER_ONLY = ['SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CRON_SECRET', 'DESKTOP_HANDOFF_SECRET', 'ANALYTICS_SECRET', 'SECURITY_HASH_SECRET', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SHAPES = [
  ['openrouter_key', /sk-or-[A-Za-z0-9]{10,}/],
  ['secret_key', /\bsk-[A-Za-z0-9]{24,}/],
  ['stripe_live_secret', /\bsk_live_[A-Za-z0-9]{10,}/],
  ['supabase_secret_key', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY/],
  ['service_role_claim', /service_role"\s*:/],
];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(js|mjs|css|html|map|json|txt)$/.test(e.name) ? [p] : [];
  });
}

const FAIL_NAMES = new Set(['SUPABASE_SERVICE_ROLE_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY']);
export const isInfo = (finding) => finding.startsWith('name:') && !FAIL_NAMES.has(finding.slice(5));

export function scanText(text, env = process.env) {
  const found = [];
  for (const name of SERVER_ONLY) if (new RegExp(`(^|[^A-Z_])${name}([^A-Z_]|$)`).test(text)) found.push(`name:${name}`);
  for (const [kind, re] of SHAPES) if (re.test(text)) found.push(kind);
  for (const token of text.match(JWT) || []) {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (claims.role === 'service_role') found.push('jwt:service_role');
    } catch {
      /* not a JWT */
    }
  }
  for (const name of SERVER_ONLY) {
    const v = env[name];
    if (v && v.length >= 12 && text.includes(v)) found.push(`value:${name}`);
  }
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(dist)) {
    console.error(`BUNDLE_SCAN ERROR — ${dist} does not exist; run npm run build first`);
    process.exit(2);
  }
  const list = files(dist);
  const all = list.flatMap((f) => scanText(fs.readFileSync(f, 'utf8')).map((k) => ({ file: path.relative(dist, f), kind: k })));
  const info = all.filter((x) => isInfo(x.kind));
  const fail = all.filter((x) => !isInfo(x.kind));
  for (const x of info) console.log(`  INFO ${x.file}: ${x.kind} (variable name only)`);
  if (fail.length) {
    console.log(`BUNDLE_SCAN FAIL — ${fail.length} finding(s) in ${list.length} files`);
    for (const x of fail) console.log(`  FAIL ${x.file}: ${x.kind}`);
    process.exit(1);
  }
  console.log(`BUNDLE_SCAN PASS — ${list.length} files scanned; no service-role JWT, secret-key shape, service-role variable name or server secret value; ${info.length} informational name reference(s)`);
}
