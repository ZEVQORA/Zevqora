/// <reference types="vite/client" />

import type { DesktopAuthState } from './lib/auth'

export type ProviderConfig = { openrouterConfigured: boolean; secureStorageAvailable: boolean; source: 'encrypted-local' | 'environment' | 'none' | string; platformUrl?: string }

declare global {
  interface Window {
    zevqoraDesktop?: {
      getApiToken: () => Promise<string>
      windowAction?: (action: 'minimize' | 'maximize' | 'close') => Promise<boolean>
      getWindowState?: () => Promise<{ maximized: boolean; platform: string; packaged: boolean; version: string }>
      onWindowState?: (callback: (state: { maximized: boolean }) => void) => () => void

      selectFolder: () => Promise<string | null>
      selectTraceFile: () => Promise<{ path: string; content: string } | null>
      saveTextFile?: (suggestedName: string, content: string) => Promise<string | null>
      openPath?: (target: string) => Promise<boolean>
      openExternal?: (url: string) => Promise<boolean>

      startBrowserAuth: () => Promise<boolean>
      signInWithPassword: (email: string, password: string) => Promise<DesktopAuthState>
      openSignup: () => Promise<boolean>
      getAuthState: () => Promise<DesktopAuthState>
      signOut: () => Promise<DesktopAuthState>
      openAccount: () => Promise<boolean>
      openPricing: () => Promise<boolean>
      openWeb?: (route: string) => Promise<boolean>
      updateProfile: (displayName: string, username: string) => Promise<DesktopAuthState>
      onAuthChanged: (callback: (state: DesktopAuthState) => void) => () => void

      platformRequest?: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>
      getContext?: () => Promise<{ workspaceId: string | null; projectId: string | null }>
      setContext?: (workspaceId: string | null, projectId: string | null) => Promise<{ workspaceId: string | null; projectId: string | null }>
      syncPlatform?: () => Promise<{ synced: boolean; connected?: boolean; error?: string }>
      onPlatformSynced?: (callback: (result: { synced: boolean; connected?: boolean; error?: string }) => void) => () => void

      getProviderConfig: () => Promise<ProviderConfig>
      saveOpenRouterKey: (key: string) => Promise<ProviderConfig>
      clearOpenRouterKey: () => Promise<ProviderConfig>
    }
  }
}

export {}
