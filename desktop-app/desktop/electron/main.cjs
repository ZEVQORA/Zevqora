const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')

const PROTOCOL = 'zevqora'
const DEFAULT_WEB_APP_URL = 'https://zevqora.vercel.app'

let mainWindow = null
let tray = null
let backendProcess = null
let pendingAuthState = null
let memorySession = null

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

function sessionPath() {
  return path.join(app.getPath('userData'), 'auth-session.bin')
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
  if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`)
  return body
}

async function publicAuthState() {
  let session = loadSession()
  if (!session?.accessToken || !session?.refreshToken) return { signedIn: false }

  try {
    const body = await requestJson(`${webAppUrl()}/api/desktop/session`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    return { signedIn: true, user: body.user, account: body.account }
  } catch (error) {
    try {
      const refreshed = await requestJson(`${webAppUrl()}/api/desktop/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
      session = refreshed.session
      saveSession(session)
      return { signedIn: true, user: refreshed.user, account: refreshed.account }
    } catch (refreshError) {
      console.warn('[ZEVQORA] Desktop session expired:', refreshError)
      saveSession(null)
      return { signedIn: false, error: 'Your session expired. Sign in again.' }
    }
  }
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
  return { signedIn: true, user: body.user, account: body.account }
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

function startPackagedBackend() {
  if (!app.isPackaged || backendProcess) return
  const exe = path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'zevqora-backend.exe' : 'zevqora-backend')
  if (!fs.existsSync(exe)) {
    console.error(`[ZEVQORA] Packaged backend not found at ${exe}`)
    return
  }
  const userData = app.getPath('userData').replace(/\\/g, '/')
  backendProcess = spawn(exe, [], {
    cwd: app.getPath('userData'),
    windowsHide: true,
    env: {
      ...process.env,
      ZEVQORA_API_HOST: '127.0.0.1',
      ZEVQORA_API_PORT: '8000',
      DATABASE_URL: `sqlite:///${userData}/zevqora.db`,
    },
  })
  backendProcess.on('exit', () => { backendProcess = null })
}

function stopBackend() {
  if (!backendProcess) return
  try { backendProcess.kill() } catch (_) { /* no-op */ }
  backendProcess = null
}

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

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })

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
  tray.setToolTip('ZEVQORA — Make AI lighter.')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ZEVQORA', click: () => { if (mainWindow) mainWindow.show(); else createWindow() } },
    { label: 'Account', click: () => shell.openExternal(`${webAppUrl()}/account`) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.on('double-click', () => { if (mainWindow) mainWindow.show() })
}

ipcMain.handle('zevqora:window-action', (_event, action) => {
  if (!mainWindow) return false
  if (action === 'minimize') mainWindow.minimize()
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  else if (action === 'close') mainWindow.close()
  return true
})

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
  return { path: selected, content: fs.readFileSync(selected, 'utf8') }
})

ipcMain.handle('zevqora:start-browser-auth', async () => {
  pendingAuthState = crypto.randomBytes(32).toString('base64url')
  const url = `${webAppUrl()}/desktop-auth?state=${encodeURIComponent(pendingAuthState)}`
  await shell.openExternal(url)
  return true
})

ipcMain.handle('zevqora:get-auth-state', async () => publicAuthState())

ipcMain.handle('zevqora:sign-out', async () => {
  pendingAuthState = null
  saveSession(null)
  const state = { signedIn: false }
  emitAuthState(state)
  return state
})

ipcMain.handle('zevqora:open-account', async () => {
  await shell.openExternal(`${webAppUrl()}/account`)
  return true
})

ipcMain.handle('zevqora:open-pricing', async () => {
  await shell.openExternal(`${webAppUrl()}/pricing`)
  return true
})

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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => stopBackend())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
