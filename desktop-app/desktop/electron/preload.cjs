const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zevqoraDesktop', {
  selectFolder: () => ipcRenderer.invoke('zevqora:select-folder'),
  selectTraceFile: () => ipcRenderer.invoke('zevqora:select-trace-file'),
  windowAction: (action) => ipcRenderer.invoke('zevqora:window-action', action),
  startBrowserAuth: () => ipcRenderer.invoke('zevqora:start-browser-auth'),
  getAuthState: () => ipcRenderer.invoke('zevqora:get-auth-state'),
  signOut: () => ipcRenderer.invoke('zevqora:sign-out'),
  openAccount: () => ipcRenderer.invoke('zevqora:open-account'),
  openPricing: () => ipcRenderer.invoke('zevqora:open-pricing'),
  onAuthChanged: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('zevqora:auth-changed', listener)
    return () => ipcRenderer.removeListener('zevqora:auth-changed', listener)
  },
})
