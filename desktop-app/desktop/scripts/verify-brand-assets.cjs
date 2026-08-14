const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.resolve(__dirname, '..')
const expected = {
  'public/brand/zevqora-mark.png': 'b535eb194e1684806685c3cd230ea1e10ae54927b5d5cc2428a2d87762c81781',
  'public/brand/zevqora-wordmark.png': '9314b68910ef47a7f0d50534ae5c6bfc5bcb5d31990334970e5cb826cfd0c8c6',
  'public/brand/zevqora-lockup-light.png': 'e668dee37d9389224a76a5417dcd2477f701efe6477083c358f0248edb9773da',
  'public/brand/zev-mascot.png': '8b537f8d4bdb3544df03c90afbcca36ca2436b113a3c821fe4752f0c5441268a',
  'public/brand/zev-avatar.png': 'bb31717e1ae3dcf0177663e210fb3d6fa17fc507dc0da329c47f50f3cf1907c1',
  'public/brand/living-workspace-light.png': '73b38bfc68c2c5b9e6e15cde1775bbc4c0947fa612db9f55377abc7665da6201',
  'build/icon.ico': 'cd385cfba8cb1cc782bd6b5aa37e07c5c9b7f86865ba970b935010393e2d0bd8',
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const failures = []
for (const [relative, digest] of Object.entries(expected)) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) {
    failures.push(`${relative}: missing`)
    continue
  }
  const actual = sha256(file)
  if (actual !== digest) failures.push(`${relative}: expected ${digest}, got ${actual}`)
}

if (failures.length) {
  console.error('\nZEVQORA brand preflight FAILED. The installer must ship the exact approved assets:\n')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

console.log('ZEVQORA brand preflight passed: exact mark, wordmark, lockup, Zev, workspace asset and installer icon are present.')
