// Input checks for privileged desktop bridge calls (security review 2026-11-18).
//
// The shell renders the hosted product, so a script running on that origin can
// call these bridges. They must stay narrow even if that page is ever
// compromised: open only folders, and reach only the allowlisted platform
// routes.
const fs = require('fs')
const path = require('path')

// Account, workspace and project routes the renderer may reach through main.
const PLATFORM_PATH_RE = /^\/api\/(me|platform|workspaces|projects|connections|opportunities|experiments|invites)(\/[A-Za-z0-9_.\-]+)*(\?[A-Za-z0-9_.\-=&%]*)?$/

/**
 * True when `target` is an allowlisted platform route. Dot segments are
 * refused: `new URL('/api/me/../admin/users', base)` would otherwise resolve
 * outside the allowlist (SEC-09).
 */
function isAllowedPlatformPath(target) {
  const value = String(target || '')
  if (!PLATFORM_PATH_RE.test(value)) return false
  const pathname = value.split('?')[0]
  return !pathname.split('/').some((segment) => segment === '.' || segment === '..')
}

/**
 * Resolves a path the renderer asks the OS to open. Only an existing local
 * folder is accepted: `shell.openPath` on a file runs it with its default
 * handler, which for an .exe or a script on a network share means code
 * execution (SEC-06). UNC and device paths are refused before touching disk.
 */
function resolveOpenablePath(target, { platform = process.platform, fsImpl = fs } = {}) {
  const raw = String(target || '')
  if (!raw.trim()) throw new Error('No folder was given.')
  const winish = platform === 'win32'
  if (/^[\\/]{2}/.test(raw) || (winish && /^[\\/]{2}[?.][\\/]/.test(raw))) throw new Error('Network and device paths are not opened from Desktop.')
  const resolved = (winish ? path.win32 : path).resolve(raw)
  if (/^[\\/]{2}/.test(resolved)) throw new Error('Network and device paths are not opened from Desktop.')
  let stat
  try {
    stat = fsImpl.statSync(resolved)
  } catch {
    throw new Error('That folder no longer exists.')
  }
  if (!stat.isDirectory()) throw new Error('Only folders can be opened from Desktop.')
  return resolved
}

module.exports = { PLATFORM_PATH_RE, isAllowedPlatformPath, resolveOpenablePath }
