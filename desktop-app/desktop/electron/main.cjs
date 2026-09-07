const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')

const PROTOCOL = 'zevqora'
const DEFAULT_WEB_APP_URL = 'https://zevqora.vercel.app'
const LOCAL_API = 'http://127.0.0.1:8000'

let mainWindow = null
let tray = null
let backendProcess = null
let pendingAuthState = null
let memorySession = null
let lastAuthState = null
let platformSyncTimer = null

// Shared secret for the local API on 127.0.0.1. The packaged renderer loads from
// file:// and so sends `Origin: null`, which any web page can also obtain — this
// token, not CORS, is what stops a drive-by page driving the local engine.
// Packaged: we mint it and hand it to the backend via the spawn environment.
// Dev: the backend is started by a script, so it mints one and writes it to a
// file in the user's home that we read here.
let apiToken = app.isPackaged ? crypto.randomBytes(32).toString('hex') : null

function apiTokenFilePath() {
  return path.join(app.getPath('home'), '.zevqora', 'api-token')
}

function resolveApiToken() {
  if (apiToken) return apiToken
  try {
    const raw = fs.readFileSync(apiTokenFilePath(), 'utf8').trim()
    if (raw) return raw
  } catch (_) {
    // Backend not started yet, or running with ZEVQORA_API_REQUIRE_TOKEN=0.
  }
  return ''
}

function appConfig() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'config', 'app-config.json')]
    : [path.join(__dirname, '..', 'config', 'app-config.json')]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'))
    } catch (error) {
      console.error('[ZEVQORA] Could not read app config:', error)
    }
  }
  return {}
}

function webAppUrl() {
  const configured = process.env.ZEVQORA_WEB_APP_URL || appConfig().webAppUrl || DEFAULT_WEB_APP_URL
  return String(configured).replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// Preferences (non-secret): active workspace/project, remembered per device.
// ---------------------------------------------------------------------------
function preferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

function readPreferences() {
  try {
    if (fs.existsSync(preferencesPath())) return JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')) || {}
  } catch (error) {
    console.error('[ZEVQORA] Could not read preferences:', error)
  }
  return {}
}

function writePreferences(next) {
  try {
    fs.writeFileSync(preferencesPath(), JSON.stringify(next, null, 2))
  } catch (error) {
    console.error('[ZEVQORA] Could not write preferences:', error)
  }
}

function activeContext() {
  const prefs = readPreferences()
  return { workspaceId: prefs.activeWorkspaceId || null, projectId: prefs.activeProjectId || null }
}

function setActiveContext(workspaceId, projectId) {
  const prefs = readPreferences()
  prefs.activeWorkspaceId = workspaceId || null
  prefs.activeProjectId = projectId || null
  writePreferences(prefs)
  return activeContext()
}

// ---------------------------------------------------------------------------
// Secrets (OS-encrypted): account session, optional device-local provider key.
// ---------------------------------------------------------------------------
function sessionPath() {
  return path.join(app.getPath('userData'), 'auth-session.bin')
}

function secretPath(name) {
  return path.join(app.getPath('userData'), `${name}.bin`)
}

function readEncryptedSecret(name) {
  try {
    const file = secretPath(name)
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(fs.readFileSync(file))
  } catch (error) {
    console.error(`[ZEVQORA] Could not decrypt ${name}:`, error)
    return ''
  }
}

function writeEncryptedSecret(name, value) {
  const file = secretPath(name)
  const cleaned = String(value || '').trim()
  if (!cleaned) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable on this device.')
  fs.writeFileSync(file, safeStorage.encryptString(cleaned))
}

function openRouterKey() {
  return readEncryptedSecret('openrouter-api-key') || process.env.OPENROUTER_API_KEY || ''
}

function providerConfig() {
  return {
    openrouterConfigured: Boolean(openRouterKey()),
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    source: readEncryptedSecret('openrouter-api-key') ? 'encrypted-local' : (process.env.OPENROUTER_API_KEY ? 'environment' : 'none'),
    platformUrl: webAppUrl(),
  }
}

function saveSession(session) {
  memorySession = session || null
  try {
    const file = sessionPath()
    if (!session) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      return
    }
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[ZEVQORA] OS encryption is unavailable. Session will remain memory-only.')
      return
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    fs.writeFileSync(file, encrypted)
  } catch (error) {
    console.error('[ZEVQORA] Could not persist encrypted session:', error)
  }
}

function loadSession() {
  if (memorySession) return memorySession
  try {
    const file = sessionPath()
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
    const encrypted = fs.readFileSync(file)
    memorySession = JSON.parse(safeStorage.decryptString(encrypted))
    return memorySession
  } catch (error) {
    console.error('[ZEVQORA] Stored session could not be decrypted. Clearing it.', error)
    saveSession(null)
    return null
  }
}

async function requestJson(url, init) {
  const response = await fetch(url, init)
  let body = null
  try { body = await response.json() } catch { /* no-op */ }
  if (!response.ok) {
    const error = new Error(body?.error || `${response.status} ${response.statusText}`)
    error.status = response.status
    error.code = body?.code || null
    throw error
  }
  return body
}

async function publicAuthConfig() {
  const config = await requestJson(`${webAppUrl()}/api/public-config`, { cache: 'no-store' })
  const supabaseUrl = String(config?.supabaseUrl || '').replace(/\/$/, '')
  const supabaseAnonKey = String(config?.supabaseAnonKey || '')
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('ZEVQORA account login is not configured yet.')
  }
  let parsed
  try { parsed = new URL(supabaseUrl) } catch { throw new Error('ZEVQORA account service URL is invalid.') }
  if (parsed.protocol !== 'https:') throw new Error('ZEVQORA account service must use HTTPS.')
  return { supabaseUrl, supabaseAnonKey }
}

async function signInWithPassword(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanPassword = String(password || '')
  if (!cleanEmail || !/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Enter a valid email address.')
  if (cleanPassword.length < 8) throw new Error('Password must be at least 8 characters.')

  const { supabaseUrl, supabaseAnonKey } = await publicAuthConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: cleanEmail, password: cleanPassword }),
  })
  let body = null
  try { body = await response.json() } catch { /* no-op */ }
  if (!response.ok) {
    const detail = body?.error_description || body?.msg || body?.message || body?.error
    throw new Error(detail || 'Email or password is incorrect.')
  }
  if (!body?.access_token || !body?.refresh_token) {
    throw new Error('The account service returned an incomplete session. Try signing in again.')
  }

  saveSession({ accessToken: body.access_token, refreshToken: body.refresh_token })
  try {
    const state = await publicAuthState()
    if (!state.signedIn) throw new Error(state.error || 'Could not verify the signed-in session.')
    return state
  } catch (error) {
    saveSession(null)
    throw error
  }
}

/** Maps /api/me into the renderer-facing auth state. Tokens never cross this boundary. */
function authStateFromMe(me) {
  const profile = me?.profile || {}
  return {
    signedIn: true,
    user: {
      id: me?.user?.id,
      email: me?.user?.email || null,
      displayName: profile.display_name || '',
      username: profile.username || '',
      createdAt: me?.user?.created_at || null,
    },
    account: me?.account || null,
    workspaces: Array.isArray(me?.workspaces) ? me.workspaces : [],
    isAdmin: Boolean(me?.isAdmin),
    flags: me?.flags || {},
    platformUrl: webAppUrl(),
    context: activeContext(),
  }
}

async function refreshSessionTokens(session) {
  const refreshed = await requestJson(`${webAppUrl()}/api/desktop/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
  saveSession(refreshed.session)
  return refreshed.session
}

async function publicAuthState() {
  let session = loadSession()
  if (!session?.accessToken || !session?.refreshToken) {
    lastAuthState = { signedIn: false }
    return lastAuthState
  }

  const load = async (accessToken) => requestJson(`${webAppUrl()}/api/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  try {
    const me = await load(session.accessToken)
    lastAuthState = authStateFromMe(me)
  } catch (error) {
    if (error?.status && error.status !== 401 && error.status !== 403) {
      // Network or server trouble: keep the last known good state instead of signing out.
      if (lastAuthState?.signedIn) return { ...lastAuthState, degraded: true, error: 'ZEVQORA account service is unreachable right now.' }
      return { signedIn: false, error: 'ZEVQORA account service is unreachable right now.' }
    }
    if (error?.code === 'ACCOUNT_SUSPENDED') {
      saveSession(null)
      lastAuthState = { signedIn: false, error: 'This account is suspended. Contact support.' }
      return lastAuthState
    }
    try {
      session = await refreshSessionTokens(session)
      const me = await load(session.accessToken)
      lastAuthState = authStateFromMe(me)
    } catch (refreshError) {
      console.warn('[ZEVQORA] Desktop session expired:', refreshError?.message || refreshError)
      saveSession(null)
      lastAuthState = { signedIn: false, error: 'Your session expired. Sign in again.' }
      return lastAuthState
    }
  }
  schedulePlatformSync()
  return lastAuthState
}

async function updateAccountProfile(displayName, username) {
  const state = await publicAuthState()
  if (!state.signedIn) throw new Error(state.error || 'Sign in again.')
  const session = loadSession()
  if (!session?.accessToken) throw new Error('Sign in again.')
  await requestJson(`${webAppUrl()}/api/desktop/update-profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ displayName, username }),
  })
  const next = await publicAuthState()
  emitAuthState(next)
  return next
}

function emitAuthState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('zevqora:auth-changed', state)
  }
}

async function exchangeDesktopHandoff(code, state) {
  const body = await requestJson(`${webAppUrl()}/api/desktop/exchange-handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state }),
  })
  saveSession(body.session)
  return publicAuthState()
}

async function handleDeepLink(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${PROTOCOL}:` || url.hostname !== 'auth' || url.pathname !== '/callback') return
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    if (!pendingAuthState || state !== pendingAuthState || code.length < 20) {
      throw new Error('Desktop sign-in state did not match. Start sign-in again from the app.')
    }
    const result = await exchangeDesktopHandoff(code, state)
    pendingAuthState = null
    emitAuthState(result)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  } catch (error) {
    console.error('[ZEVQORA] Deep-link sign-in failed:', error)
    emitAuthState({ signedIn: false, error: error?.message || 'Browser sign-in failed.' })
  }
}

function registerProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}

function findDeepLink(argv) {
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${PROTOCOL}://`)) || null
}

// ---------------------------------------------------------------------------
// Platform requests on behalf of the renderer. The access token stays here.
// Only account/workspace/project routes on the configured ZEVQORA origin are
// reachable, so the renderer cannot turn this into a general HTTP client.
// ---------------------------------------------------------------------------
const PLATFORM_PATH_RE = /^\/api\/(me|platform|workspaces|projects|connections|opportunities|experiments|invites)(\/[A-Za-z0-9_.\-]+)*(\?[A-Za-z0-9_.\-=&%]*)?$/
const PLATFORM_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE'])

async function platformRequest(method, requestPath, body) {
  const verb = String(method || 'GET').toUpperCase()
  const target = String(requestPath || '')
  if (!PLATFORM_METHODS.has(verb)) return { status: 405, body: { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' } }
  if (!PLATFORM_PATH_RE.test(target)) return { status: 400, body: { error: 'That platform route is not available from Desktop.', code: 'ROUTE_NOT_ALLOWED' } }
  let session = loadSession()
  if (!session?.accessToken) return { status: 401, body: { error: 'Sign in first.', code: 'AUTH_REQUIRED' } }

  const send = async (accessToken) => {
    const response = await fetch(`${webAppUrl()}${target}`, {
      method: verb,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}),
        Accept: 'application/json',
      },
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
    let parsed = null
    const text = await response.text()
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text.slice(0, 2000) } }
    return { status: response.status, body: parsed }
  }

  try {
    let result = await send(session.accessToken)
    if (result.status === 401 && session.refreshToken) {
      try {
        session = await refreshSessionTokens(session)
        result = await send(session.accessToken)
        schedulePlatformSync()
      } catch (_) {
        saveSession(null)
        emitAuthState({ signedIn: false, error: 'Your session expired. Sign in again.' })
        return { status: 401, body: { error: 'Your session expired. Sign in again.', code: 'SESSION_EXPIRED' } }
      }
    }
    return result
  } catch (error) {
    return { status: 0, body: { error: 'ZEVQORA account service is unreachable.', code: 'NETWORK', detail: error?.message || String(error) } }
  }
}

// ---------------------------------------------------------------------------
// Local engine: platform session hand-off. The engine calls OpenRouter only
// through the platform proxy with this access token; the provider credential
// never reaches the device.
// ---------------------------------------------------------------------------
async function localApi(method, requestPath, body) {
  const token = resolveApiToken()
  const response = await fetch(`${LOCAL_API}${requestPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Zevqora-Token': token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let parsed = null
  try { parsed = await response.json() } catch { /* no-op */ }
  if (!response.ok) throw new Error(parsed?.detail || `${response.status} ${response.statusText}`)
  return parsed
}

async function syncPlatformSession() {
  const session = loadSession()
  const state = lastAuthState
  try {
    if (!session?.accessToken || !state?.signedIn) {
      await localApi('DELETE', '/api/v1/platform/session')
      return { synced: true, connected: false }
    }
    const context = activeContext()
    const result = await localApi('POST', '/api/v1/platform/session', {
      base_url: webAppUrl(),
      access_token: session.accessToken,
      user_id: state.user?.id || null,
      email: state.user?.email || null,
      workspace_id: context.workspaceId,
      project_id: context.projectId,
      plan: state.account?.plan || null,
    })
    return { synced: true, connected: Boolean(result?.connected), status: result }
  } catch (error) {
    // The engine may still be starting; the scheduler retries.
    return { synced: false, error: error?.message || String(error) }
  }
}

function schedulePlatformSync(attempt = 0) {
  if (platformSyncTimer) clearTimeout(platformSyncTimer)
  platformSyncTimer = setTimeout(async () => {
    platformSyncTimer = null
    const result = await syncPlatformSession()
    if (!result.synced && attempt < 12) schedulePlatformSync(attempt + 1)
    else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zevqora:platform-synced', result)
  }, attempt === 0 ? 150 : Math.min(1500 * attempt, 8000))
}

// ---------------------------------------------------------------------------
// Backend process
// ---------------------------------------------------------------------------
function startPackagedBackend() {
  if (!app.isPackaged || backendProcess) return
  const exe = path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'zevqora-backend.exe' : 'zevqora-backend')
  if (!fs.existsSync(exe)) {
    console.error(`[ZEVQORA] Packaged backend not found at ${exe}`)
    return
  }
  const userData = app.getPath('userData').replace(/\\/g, '/')
  const localKey = openRouterKey()
  backendProcess = spawn(exe, [], {
    cwd: app.getPath('userData'),
    windowsHide: true,
    env: {
      ...process.env,
      ZEVQORA_API_HOST: '127.0.0.1',
      ZEVQORA_API_PORT: '8000',
      ZEVQORA_API_TOKEN: apiToken,
      DATABASE_URL: `sqlite:///${userData}/zevqora.db`,
      // Optional device-local BYOK only. Platform compute needs no key here.
      ...(localKey ? { OPENROUTER_API_KEY: localKey } : {}),
      OPENROUTER_SITE_URL: webAppUrl(),
    },
  })
  backendProcess.on('exit', () => { backendProcess = null })
  schedulePlatformSync()
}

function stopBackend() {
  if (!backendProcess) return
  try { backendProcess.kill() } catch (_) { /* no-op */ }
  backendProcess = null
}

async function restartBackend() {
  if (!app.isPackaged) return false
  stopBackend()
  await new Promise((resolve) => setTimeout(resolve, 700))
  startPackagedBackend()
  return true
}

// ---------------------------------------------------------------------------
// Window + tray
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1580,
    height: 1000,
    minWidth: 1160,
    minHeight: 740,
    show: false,
    frame: false,
    roundedCorners: true,
    thickFrame: true,
    backgroundColor: '#F7F8FA',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' } : {}),
    ...(process.platform === 'darwin' ? { vibrancy: 'sidebar', visualEffectState: 'active' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  // External links never open inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (isAllowedExternal(url)) shell.openExternal(url)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })
  mainWindow.on('maximize', () => mainWindow?.webContents.send('zevqora:window-state', { maximized: true }))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('zevqora:window-state', { maximized: false }))
  mainWindow.on('closed', () => { mainWindow = null })
}

function findExactTrayAsset() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'brand', 'zevqora-mark.png'),
    path.join(process.resourcesPath || '', 'brand', 'zevqora-mark.png'),
    path.join(process.resourcesPath || '', 'brand', 'zevqora-mark.ico'),
  ]
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null
}

function createTrayIfExactAssetExists() {
  const iconPath = findExactTrayAsset()
  if (!iconPath) return
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image)
  tray.setToolTip('ZEVQORA — Cut AI COGS without cutting product quality.')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ZEVQORA', click: () => { if (mainWindow) mainWindow.show(); else createWindow() } },
    { label: 'Account', click: () => shell.openExternal(`${webAppUrl()}/app/settings`) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.on('double-click', () => { if (mainWindow) mainWindow.show() })
}

// ---------------------------------------------------------------------------
// External URL policy: the ZEVQORA site, plus the code forges a pull request
// can live on. Nothing else opens from the app.
// ---------------------------------------------------------------------------
function isAllowedExternal(rawUrl) {
  try {
    const url = new URL(String(rawUrl))
    if (url.protocol !== 'https:') return false
    const site = new URL(webAppUrl())
    if (url.host === site.host) return true
    return ['github.com', 'gitlab.com', 'bitbucket.org', 'www.github.com'].includes(url.host)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('zevqora:get-api-token', async () => resolveApiToken())

ipcMain.handle('zevqora:window-action', (_event, action) => {
  if (!mainWindow) return false
  if (action === 'minimize') mainWindow.minimize()
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  else if (action === 'close') mainWindow.close()
  return true
})

ipcMain.handle('zevqora:window-state', () => ({ maximized: Boolean(mainWindow?.isMaximized()), platform: process.platform, packaged: app.isPackaged, version: app.getVersion() }))

ipcMain.handle('zevqora:select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('zevqora:select-trace-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Execution traces', extensions: ['jsonl', 'json'] }],
  })
  if (result.canceled || !result.filePaths.length) return null
  const selected = result.filePaths[0]
  const lowered = path.basename(selected).toLowerCase()
  if (lowered.includes('.env') || /secret|credential|private|token|key|production|backup|dump/.test(lowered)) {
    throw new Error('Refusing to import a secret-bearing file name. Choose an explicit JSON/JSONL trace export.')
  }
  const stat = fs.statSync(selected)
  if (stat.size > 50 * 1024 * 1024) throw new Error('Trace files over 50 MB are not imported through the desktop picker.')
  return { path: selected, content: fs.readFileSync(selected, 'utf8') }
})

ipcMain.handle('zevqora:save-text-file', async (_event, payload) => {
  const suggested = String(payload?.suggestedName || 'zevqora-export.json').replace(/[^A-Za-z0-9_.\-]/g, '_')
  const result = await dialog.showSaveDialog({ defaultPath: suggested, filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }] })
  if (result.canceled || !result.filePath) return null
  fs.writeFileSync(result.filePath, String(payload?.content || ''), 'utf8')
  return result.filePath
})

ipcMain.handle('zevqora:open-path', async (_event, target) => {
  const resolved = path.resolve(String(target || ''))
  if (!fs.existsSync(resolved)) throw new Error('That folder no longer exists.')
  const error = await shell.openPath(resolved)
  if (error) throw new Error(error)
  return true
})

ipcMain.handle('zevqora:open-external', async (_event, url) => {
  if (!isAllowedExternal(url)) throw new Error('Only ZEVQORA and code-hosting links open from Desktop.')
  await shell.openExternal(String(url))
  return true
})

ipcMain.handle('zevqora:start-browser-auth', async () => {
  pendingAuthState = crypto.randomBytes(32).toString('base64url')
  const url = `${webAppUrl()}/desktop-auth?state=${encodeURIComponent(pendingAuthState)}`
  await shell.openExternal(url)
  return true
})

ipcMain.handle('zevqora:sign-in-password', async (_event, credentials) => {
  const result = await signInWithPassword(credentials?.email, credentials?.password)
  emitAuthState(result)
  return result
})

ipcMain.handle('zevqora:open-signup', async () => {
  await shell.openExternal(`${webAppUrl()}/signup`)
  return true
})

ipcMain.handle('zevqora:get-auth-state', async () => publicAuthState())

ipcMain.handle('zevqora:sign-out', async () => {
  pendingAuthState = null
  saveSession(null)
  lastAuthState = { signedIn: false }
  const state = { signedIn: false }
  emitAuthState(state)
  schedulePlatformSync()
  return state
})

ipcMain.handle('zevqora:update-profile', async (_event, profile) => {
  return updateAccountProfile(profile?.displayName, profile?.username)
})

ipcMain.handle('zevqora:open-account', async () => {
  await shell.openExternal(`${webAppUrl()}/app/settings`)
  return true
})

ipcMain.handle('zevqora:open-pricing', async () => {
  await shell.openExternal(`${webAppUrl()}/pricing`)
  return true
})

ipcMain.handle('zevqora:open-web', async (_event, route) => {
  const clean = String(route || '/').startsWith('/') ? String(route) : '/'
  await shell.openExternal(`${webAppUrl()}${clean}`)
  return true
})

ipcMain.handle('zevqora:get-provider-config', async () => providerConfig())

ipcMain.handle('zevqora:save-openrouter-key', async (_event, key) => {
  const cleaned = String(key || '').trim()
  if (cleaned && !cleaned.startsWith('sk-or-')) throw new Error('That does not look like an OpenRouter API key.')
  writeEncryptedSecret('openrouter-api-key', cleaned)
  await restartBackend()
  return providerConfig()
})

ipcMain.handle('zevqora:clear-openrouter-key', async () => {
  writeEncryptedSecret('openrouter-api-key', '')
  await restartBackend()
  return providerConfig()
})

ipcMain.handle('zevqora:platform-request', async (_event, payload) => platformRequest(payload?.method, payload?.path, payload?.body))

ipcMain.handle('zevqora:get-context', async () => activeContext())

ipcMain.handle('zevqora:set-context', async (_event, payload) => {
  const next = setActiveContext(payload?.workspaceId, payload?.projectId)
  schedulePlatformSync()
  return next
})

ipcMain.handle('zevqora:sync-platform', async () => syncPlatformSession())

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = findDeepLink(commandLine)
    if (deepLink) void handleDeepLink(deepLink)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    void handleDeepLink(url)
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('ai.zevqora.desktop')
    registerProtocolClient()
    startPackagedBackend()
    createWindow()
    createTrayIfExactAssetExists()
    const initialDeepLink = findDeepLink(process.argv)
    if (initialDeepLink) void handleDeepLink(initialDeepLink)
    // Restore the account session and hand it to the engine as soon as both are up.
    void publicAuthState().then(() => schedulePlatformSync())
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => stopBackend())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
