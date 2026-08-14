/// <reference types="vite/client" />

import type { DesktopAuthState } from './lib/auth'

declare global {
  interface Window {
    zevqoraDesktop?: {
      selectFolder: () => Promise<string | null>
      selectTraceFile: () => Promise<{ path: string; content: string } | null>
      windowAction?: (action: 'minimize' | 'maximize' | 'close') => Promise<boolean>
      startBrowserAuth: () => Promise<boolean>
      getAuthState: () => Promise<DesktopAuthState>
      signOut: () => Promise<DesktopAuthState>
      openAccount: () => Promise<boolean>
      openPricing: () => Promise<boolean>
      getProviderConfig: () => Promise<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: 'encrypted-local' | 'environment' | 'none' }>
      saveOpenRouterKey: (key: string) => Promise<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string }>
      clearOpenRouterKey: () => Promise<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string }>
      onAuthChanged: (callback: (state: DesktopAuthState) => void) => () => void
    }
  }
}

export {}
