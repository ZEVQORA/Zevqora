import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const failures = []

const assets = {
  'assets/zevqora-mark.png': 'b535eb194e1684806685c3cd230ea1e10ae54927b5d5cc2428a2d87762c81781',
  'assets/zevqora-wordmark.png': '9314b68910ef47a7f0d50534ae5c6bfc5bcb5d31990334970e5cb826cfd0c8c6',
  'assets/zevqora-lockup.png': 'e668dee37d9389224a76a5417dcd2477f701efe6477083c358f0248edb9773da',
  'assets/zev-mascot.png': '8b537f8d4bdb3544df03c90afbcca36ca2436b113a3c821fe4752f0c5441268a',
  'assets/zev-avatar.png': 'bb31717e1ae3dcf0177663e210fb3d6fa17fc507dc0da329c47f50f3cf1907c1',
  'assets/living-workspace-light.png': '73b38bfc68c2c5b9e6e15cde1775bbc4c0947fa612db9f55377abc7665da6201',
  'desktop-app/desktop/public/brand/zevqora-mark.png': 'b535eb194e1684806685c3cd230ea1e10ae54927b5d5cc2428a2d87762c81781',
  'desktop-app/desktop/public/brand/zevqora-wordmark.png': '9314b68910ef47a7f0d50534ae5c6bfc5bcb5d31990334970e5cb826cfd0c8c6',
  'desktop-app/desktop/public/brand/zevqora-lockup-light.png': 'e668dee37d9389224a76a5417dcd2477f701efe6477083c358f0248edb9773da',
  'desktop-app/desktop/public/brand/zev-mascot.png': '8b537f8d4bdb3544df03c90afbcca36ca2436b113a3c821fe4752f0c5441268a',
  'desktop-app/desktop/public/brand/zev-avatar.png': 'bb31717e1ae3dcf0177663e210fb3d6fa17fc507dc0da329c47f50f3cf1907c1',
  'desktop-app/desktop/public/brand/living-workspace-light.png': '73b38bfc68c2c5b9e6e15cde1775bbc4c0947fa612db9f55377abc7665da6201',
  'desktop-app/desktop/build/icon.ico': 'cd385cfba8cb1cc782bd6b5aa37e07c5c9b7f86865ba970b935010393e2d0bd8',
}

for (const [rel, expected] of Object.entries(assets)) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) {
    failures.push(`${rel}: missing`)
    continue
  }
  const actual = sha256(file)
  if (actual !== expected) failures.push(`${rel}: approved asset checksum changed`)
}

const requiredText = {
  'desktop-app/desktop/src/components/Views.tsx': [
    'export function ExperimentDialog',
    'export function ImplementationDialog',
    'export function WorkspaceControl',
    'export function SettingsView',
  ],
  'desktop-app/desktop/src/components/BrandAsset.tsx': [
    'import.meta.env.BASE_URL',
    "brandPath('zevqora-mark.png')",
    "brandPath('zevqora-wordmark.png')",
    "brandPath('zev-mascot.png')",
  ],
  'desktop-app/desktop/src/components/WelcomeScreen.tsx': [
    'onDirectLogin',
    'No browser handoff',
    'welcome-direct-form',
  ],
  'desktop-app/desktop/src/App.tsx': [
    'signInWithPassword(email, password)',
    'if (!auth?.signedIn)',
  ],
  'desktop-app/desktop/electron/main.cjs': [
    "zevqora:save-openrouter-key",
    "zevqora:sign-in-password",
    "/auth/v1/token?grant_type=password",
    "zevqora:clear-openrouter-key",
    'safeStorage.encryptString',
    'OPENROUTER_API_KEY: openRouterKey()',
    'app.setAsDefaultProtocolClient(PROTOCOL)',
  ],
  'desktop-app/desktop/electron/preload.cjs': [
    'getProviderConfig',
    'signInWithPassword',
    'openSignup',
    'saveOpenRouterKey',
    'clearOpenRouterKey',
  ],
  'desktop-app/backend/app/agent/openrouter.py': [
    'settings.openrouter_base_url',
    '/chat/completions',
  ],
  'desktop-app/backend/app/config.py': [
    'https://openrouter.ai/api/v1',
    'OPENROUTER_API_KEY',
  ],
  'login.html': [
    '/assets/zevqora-mark.png',
    '/assets/zevqora-wordmark.png',
    '/assets/google.svg',
    '/assets/github.svg',
  ],
  'desktop-auth.html': [
    'data-desktop-auth-form',
    'data-desktop-invalid',
    'data-desktop-signup',
    '/assets/google.svg',
    '/assets/github.svg',
  ],
  'desktop-auth.js': [
    'getFreshSession',
    'client.auth.refreshSession',
    'MISSING_REFRESH_TOKEN',
    'INVALID_DESKTOP_STATE',
    'state=${encodeURIComponent(state)}',
  ],
  'api/desktop/create-handoff.js': [
    'INVALID_DESKTOP_STATE',
    'MISSING_REFRESH_TOKEN',
    'STATE_PATTERN',
  ],
}

for (const [rel, needles] of Object.entries(requiredText)) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) {
    failures.push(`${rel}: missing`)
    continue
  }
  const text = read(rel)
  for (const needle of needles) if (!text.includes(needle)) failures.push(`${rel}: missing required contract: ${needle}`)
}

const desktopPackage = JSON.parse(read('desktop-app/desktop/package.json'))
if (desktopPackage.version !== '1.0.5') failures.push('desktop package version must be 1.0.5')
const resources = JSON.stringify(desktopPackage.build?.extraResources || [])
if (!resources.includes('public/brand')) failures.push('desktop package must include public/brand as extraResources')
if (desktopPackage.build?.win?.icon !== 'build/icon.ico') failures.push('Windows installer must use build/icon.ico')

if (failures.length) {
  console.error('\nZEVQORA production release preflight FAILED:\n')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

console.log('ZEVQORA release preflight passed.')
console.log(' - exact approved mark / wordmark / Zev / workspace assets verified')
console.log(' - Windows installer icon verified')
console.log(' - required desktop dialogs and workspace controls exported')
console.log(' - OpenRouter secure BYOK bridge present')
console.log(' - direct desktop email/password auth present; legacy browser auth retained only for compatibility')
