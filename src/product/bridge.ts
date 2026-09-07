/**
 * The desktop bridge. When ZEVQORA runs inside the Electron shell the preload
 * exposes `window.zevqoraDesktop`; in a browser it is absent and the product
 * uses the platform engine plus browser file APIs instead.
 */
export interface DesktopBridge {
  getApiToken: () => Promise<string>;
  selectFolder: () => Promise<string | null>;
  selectTraceFile: () => Promise<{ path: string; content: string } | null>;
  saveTextFile?: (suggestedName: string, content: string) => Promise<string | null>;
  openPath?: (target: string) => Promise<boolean>;
  openExternal?: (url: string) => Promise<boolean>;
  windowAction?: (action: 'minimize' | 'maximize' | 'close') => Promise<boolean>;
  getWindowState?: () => Promise<{ maximized: boolean; platform: string; packaged: boolean; version: string }>;
  onWindowState?: (callback: (state: { maximized: boolean }) => void) => () => void;
  engineBaseUrl?: () => Promise<string>;
  getProviderConfig?: () => Promise<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string }>;
  saveOpenRouterKey?: (key: string) => Promise<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string }>;
  clearOpenRouterKey?: () => Promise<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string }>;
}

declare global {
  interface Window {
    zevqoraDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | null {
  return typeof window !== 'undefined' && window.zevqoraDesktop ? window.zevqoraDesktop : null;
}

export function isDesktop() {
  return Boolean(desktopBridge());
}

export const LOCAL_ENGINE_BASE = 'http://127.0.0.1:8000';
