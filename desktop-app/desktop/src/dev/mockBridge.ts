/**
 * DEV ONLY. Installs a fake `window.zevqoraDesktop` so the renderer can be
 * exercised in a plain browser against a local engine started with
 * `ZEVQORA_API_REQUIRE_TOKEN=0`. Loaded only when `import.meta.env.DEV` and the
 * page URL carries `?bridge=mock`; Vite drops this module from production
 * bundles. No real account, no tokens, no network to the account service.
 */
import type { DesktopAuthState } from '../lib/auth'

const FIXTURE_TRACES = [
  { request_id: 'mock-1', symbol: 'classify', workflow: 'support', provider: 'mock', model: 'mock/test-model', input_text: 'Customer says: my invoice is wrong', output_text: 'billing', expected_output: 'billing', input_tokens: 42, output_tokens: 3, latency_ms: 610, cost_usd: 0.0031 },
  { request_id: 'mock-2', symbol: 'classify', workflow: 'support', provider: 'mock', model: 'mock/test-model', input_text: 'The app crashes on login', output_text: 'technical', expected_output: 'technical', input_tokens: 39, output_tokens: 3, latency_ms: 580, cost_usd: 0.0029 },
  { request_id: 'mock-3', symbol: 'classify', workflow: 'support', provider: 'mock', model: 'mock/test-model', input_text: 'Please change my email address', output_text: 'account', expected_output: 'account', input_tokens: 40, output_tokens: 3, latency_ms: 640, cost_usd: 0.003 },
  { request_id: 'mock-4', symbol: 'classify', workflow: 'support', provider: 'mock', model: 'mock/test-model', input_text: 'Customer says: my invoice is wrong', output_text: 'billing', expected_output: 'billing', input_tokens: 42, output_tokens: 3, latency_ms: 600, cost_usd: 0.0031 },
  { request_id: 'mock-5', symbol: 'classify', workflow: 'support', provider: 'mock', model: 'mock/test-model', input_text: 'The app crashes on login', output_text: 'technical', expected_output: 'technical', input_tokens: 39, output_tokens: 3, latency_ms: 575, cost_usd: 0.0029 },
  { request_id: 'mock-6', symbol: 'classify', workflow: 'support', provider: 'mock', model: 'mock/test-model', input_text: 'Please change my email address', output_text: 'account', expected_output: 'account', input_tokens: 40, output_tokens: 3, latency_ms: 630, cost_usd: 0.003 },
]

const state: DesktopAuthState = {
  signedIn: true,
  user: { id: 'mock-user', email: 'engineer@example.com', displayName: 'Design partner', username: 'partner' },
  account: { plan: 'starter', planName: 'Starter', status: 'active', credit: { includedUsd: 25, usedUsd: 3.4, periodEnd: new Date(Date.now() + 12 * 86400e3).toISOString() } },
  workspaces: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Mock Labs', slug: 'mock-labs', owner_id: 'mock-user', plan_override: null, data_retention_days: 30, settings: {}, created_at: new Date().toISOString(), role: 'owner', plan: 'starter', project_count: 0 },
  ],
  isAdmin: false,
  flags: {},
  platformUrl: 'https://zevqora.vercel.app',
  context: { workspaceId: '11111111-1111-4111-8111-111111111111', projectId: null },
}

const listeners = new Set<(s: DesktopAuthState) => void>()

window.zevqoraDesktop = {
  getApiToken: async () => '',
  windowAction: async () => true,
  getWindowState: async () => ({ maximized: false, platform: 'win32', packaged: false, version: 'dev' }),
  onWindowState: () => () => undefined,
  selectFolder: async () => window.prompt('Mock bridge: enter a local folder path') || null,
  selectTraceFile: async () => ({ path: 'fixture.jsonl', content: FIXTURE_TRACES.map((t) => JSON.stringify(t)).join('\n') }),
  saveTextFile: async (name, content) => {
    console.log('[mock bridge] would save', name, content.length, 'chars')
    return `mock://${name}`
  },
  openPath: async () => true,
  openExternal: async (url) => {
    console.log('[mock bridge] would open', url)
    return true
  },
  startBrowserAuth: async () => true,
  signInWithPassword: async () => state,
  openSignup: async () => true,
  getAuthState: async () => state,
  signOut: async () => ({ signedIn: false }),
  openAccount: async () => true,
  openPricing: async () => true,
  openWeb: async () => true,
  updateProfile: async (displayName, username) => {
    state.user = { ...state.user, displayName, username }
    return state
  },
  onAuthChanged: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  platformRequest: async () => ({ status: 0, body: { error: 'Mock bridge: the account service is not connected in browser dev mode.', code: 'NETWORK' } }),
  getContext: async () => state.context!,
  setContext: async (workspaceId, projectId) => {
    state.context = { workspaceId, projectId }
    return state.context
  },
  syncPlatform: async () => ({ synced: false, error: 'Mock bridge cannot hand a session to the engine.' }),
  onPlatformSynced: () => () => undefined,
  getProviderConfig: async () => ({ openrouterConfigured: false, secureStorageAvailable: false, source: 'none' }),
  saveOpenRouterKey: async () => ({ openrouterConfigured: false, secureStorageAvailable: false, source: 'none' }),
  clearOpenRouterKey: async () => ({ openrouterConfigured: false, secureStorageAvailable: false, source: 'none' }),
}

console.info('[ZEVQORA] Mock desktop bridge installed (dev only).')
