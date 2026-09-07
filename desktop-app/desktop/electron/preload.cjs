const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('zevqoraDesktop', {
  // Local engine + window
  getApiToken: () => ipcRenderer.invoke('zevqora:get-api-token'),
  windowAction: (action) => ipcRenderer.invoke('zevqora:window-action', action),
  getWindowState: () => ipcRenderer.invoke('zevqora:window-state'),
  onWindowState: (callback) => subscribe('zevqora:window-state', callback),

  // Files and folders (explicit user action only)
  selectFolder: () => ipcRenderer.invoke('zevqora:select-folder'),
  selectTraceFile: () => ipcRenderer.invoke('zevqora:select-trace-file'),
  saveTextFile: (suggestedName, content) => ipcRenderer.invoke('zevqora:save-text-file', { suggestedName, content }),
  openPath: (target) => ipcRenderer.invoke('zevqora:open-path', target),
  openExternal: (url) => ipcRenderer.invoke('zevqora:open-external', url),

  // Account (tokens never reach the renderer)
  startBrowserAuth: () => ipcRenderer.invoke('zevqora:start-browser-auth'),
  signInWithPassword: (email, password) => ipcRenderer.invoke('zevqora:sign-in-password', { email, password }),
  openSignup: () => ipcRenderer.invoke('zevqora:open-signup'),
  getAuthState: () => ipcRenderer.invoke('zevqora:get-auth-state'),
  signOut: () => ipcRenderer.invoke('zevqora:sign-out'),
  openAccount: () => ipcRenderer.invoke('zevqora:open-account'),
  openPricing: () => ipcRenderer.invoke('zevqora:open-pricing'),
  openWeb: (route) => ipcRenderer.invoke('zevqora:open-web', route),
  updateProfile: (displayName, username) => ipcRenderer.invoke('zevqora:update-profile', { displayName, username }),
  onAuthChanged: (callback) => subscribe('zevqora:auth-changed', callback),

  // Platform (account service) — allowlisted routes, Bearer attached in main
  platformRequest: (method, path, body) => ipcRenderer.invoke('zevqora:platform-request', { method, path, body }),
  getContext: () => ipcRenderer.invoke('zevqora:get-context'),
  setContext: (workspaceId, projectId) => ipcRenderer.invoke('zevqora:set-context', { workspaceId, projectId }),
  syncPlatform: () => ipcRenderer.invoke('zevqora:sync-platform'),
  onPlatformSynced: (callback) => subscribe('zevqora:platform-synced', callback),

  // Optional device-local provider key (BYOK)
  getProviderConfig: () => ipcRenderer.invoke('zevqora:get-provider-config'),
  saveOpenRouterKey: (key) => ipcRenderer.invoke('zevqora:save-openrouter-key', key),
  clearOpenRouterKey: () => ipcRenderer.invoke('zevqora:clear-openrouter-key'),
})
