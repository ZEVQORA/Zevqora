import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const failures = []
const exists = (rel) => fs.existsSync(path.join(root, rel))
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const required = [
  'index.html',
  'styles.css',
  'super-refresh.css',
  'super-motion.js',
  'assets/zevqora-mark.png',
  'assets/zevqora-wordmark.png',
  'assets/zev-mascot.png',
  'desktop-app/desktop/build/icon.ico',
  'desktop-app/desktop/public/brand/zevqora-mark.png',
  'desktop-app/desktop/public/brand/zevqora-wordmark.png',
  'desktop-app/desktop/public/brand/zev-mascot.png',
  'desktop-app/desktop/src/App.tsx',
  'desktop-app/desktop/src/components/LivingWorkspace.tsx',
  'desktop-app/desktop/src/components/ZevChat.tsx',
  'desktop-app/desktop/src/brand-unification.css',
  'desktop-app/backend/app/agent/openrouter.py',
  'desktop-app/backend/run_backend.py',
  '.github/workflows/windows-release.yml',
]
for (const rel of required) if (!exists(rel)) failures.push(`${rel}: missing`)

if (exists('index.html')) {
  const index = read('index.html')
  if (!index.includes('/super-refresh.css')) failures.push('index.html: super-refresh.css not loaded')
  if (!index.includes('/super-motion.js')) failures.push('index.html: super-motion.js not loaded')
  if (!index.includes('ZEVQORA-Setup.exe')) failures.push('index.html: stable Windows download URL missing')
}

if (exists('desktop-app/desktop/package.json')) {
  const pkg = JSON.parse(read('desktop-app/desktop/package.json'))
  if (pkg.version !== '1.0.7') failures.push('desktop package version must be 1.0.7')
  if (pkg.build?.win?.icon !== 'build/icon.ico') failures.push('Windows icon must be build/icon.ico')
  if (pkg.build?.artifactName !== 'ZEVQORA-Setup-${version}.${ext}') failures.push('installer artifactName contract changed')
}

const cssFiles = [
  'desktop-app/desktop/src/styles.css',
  'desktop-app/desktop/src/premium-overrides.css',
  'desktop-app/desktop/src/brand-unification.css',
].filter(exists)
for (const rel of cssFiles) {
  const css = read(rel)
  if (/font-family\s*:[^;]*(Times New Roman|Times|Georgia)/i.test(css)) failures.push(`${rel}: Roman/Times/Georgia font found`)
  if (/font-style\s*:\s*italic/i.test(css)) failures.push(`${rel}: italic UI style found`)
}

if (failures.length) {
  console.error('\nZEVQORA v1.0.7 release preflight FAILED:\n')
  for (const f of failures) console.error(` - ${f}`)
  process.exit(1)
}
console.log('ZEVQORA v1.0.7 release preflight passed.')
console.log(' - Huslen v8 web design + premium motion layer present')
console.log(' - desktop brand assets and unified sans typography present')
console.log(' - Windows release workflow and installer contract present')
