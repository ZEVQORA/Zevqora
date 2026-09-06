import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const failures = [];
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const required = [
  'index.html',
  'vite.config.ts',
  'vercel.json',
  'api/index.js',
  'api/_lib/router.js',
  'api/_lib/handlers/telemetry.js',
  'api/_lib/handlers/experiments.js',
  'api/_lib/handlers/admin.js',
  'src/main.tsx',
  'src/brand/marks.ts',
  'src/brand/HeroMark3D.tsx',
  'public/fonts/Satoshi-Variable.woff2',
  'public/assets/zev/zev-three-quarter-front.webp',
  'public/favicon.png',
  'supabase/migrations/004_platform.sql',
  'supabase/migrations/006_rollups.sql',
  'desktop-app/desktop/build/icon.ico',
  'desktop-app/backend/run_backend.py',
  '.github/workflows/windows-release.yml',
];
for (const rel of required) if (!exists(rel)) failures.push(`${rel}: missing`);

// The Z mark must be the locked geometry, never a typed letter.
if (exists('src/brand/marks.ts')) {
  const marks = read('src/brand/marks.ts');
  if (!marks.includes("MARK_VIEWBOX = '0 0 87.05 100'")) failures.push('marks.ts: mark viewBox changed');
  if (!marks.includes('M 25.3 0.06')) failures.push('marks.ts: mark path changed');
}

// No secrets may be inlined for the browser.
for (const rel of ['vite.config.ts', 'src/lib/config.ts']) {
  if (!exists(rel)) continue;
  const src = read(rel);
  if (/OPENROUTER_API_KEY|SERVICE_ROLE|STRIPE_SECRET/.test(src)) failures.push(`${rel}: server secret referenced in browser code`);
}

// Retired claims must never reappear.
const retired = /(45%\s+(internal|measured)|independent third-party validation)/i;
for (const dir of ['src']) {
  const stack = [path.join(root, dir)];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(tsx?|css)$/.test(entry.name) && retired.test(fs.readFileSync(full, 'utf8'))) failures.push(`${path.relative(root, full)}: retired claim present`);
    }
  }
}

if (failures.length) {
  console.error('\nZEVQORA release preflight FAILED:\n');
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('ZEVQORA release preflight passed.');
