import type {
  AgentResponse,
  AICall,
  Economics,
  Experiment,
  Finding,
  Health,
  Implementation,
  Product,
  ScanResult,
} from './types'

export const API_BASE = import.meta.env.VITE_ZEVQORA_API_BASE || 'http://127.0.0.1:8000/api/v1'
const HEALTH_URL = API_BASE.replace(/\/api\/v1\/?$/, '/api/health')

// Shared secret for the local engine, minted per backend launch. The packaged
// renderer loads from file:// and so sends `Origin: null` — an origin any web
// page can also obtain — so this token, not CORS, is what separates us from a
// drive-by page. Resolved once and cached; re-resolved if the backend restarts
// with a new token (a 401 clears the cache).
let apiTokenPromise: Promise<string> | null = null

function resolveApiToken(): Promise<string> {
  if (!apiTokenPromise) {
    apiTokenPromise = Promise.resolve(window.zevqoraDesktop?.getApiToken?.() ?? '').catch(() => '')
  }
  return apiTokenPromise
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await resolveApiToken()
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Zevqora-Token': token } : {}),
      ...(init?.headers || {}),
    },
  })
  if (response.status === 401) {
    // The backend may have restarted with a fresh token; drop the cached one so
    // the next call re-reads it rather than failing forever.
    apiTokenPromise = null
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      detail = body.detail || detail
    } catch {
      // keep status text
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const api = {
  health: async (): Promise<Health> => {
    const response = await fetch(HEALTH_URL)
    if (!response.ok) throw new Error('Backend offline')
    return response.json()
  },
  products: () => request<Product[]>('/products'),
  connectLocal: (path: string, name?: string) =>
    request<ScanResult>('/products/connect-local', {
      method: 'POST',
      body: JSON.stringify({ path, name: name || null }),
    }),
  scan: (productId: string) => request<ScanResult>(`/products/${productId}/scan`, { method: 'POST' }),
  aiCalls: (productId: string) => request<AICall[]>(`/products/${productId}/ai-calls`),
  findings: (productId: string) => request<Finding[]>(`/products/${productId}/findings`),
  economics: (productId: string) => request<Economics>(`/products/${productId}/economics`),
  experiments: (productId: string) => request<Experiment[]>(`/products/${productId}/experiments`),
  implementations: (productId: string) => request<Implementation[]>(`/products/${productId}/implementations`),
  prepareImplementation: (productId: string, payload: { experiment_id: string; instructions?: string; model?: string; run_tests: boolean; test_command?: string }) =>
    request<Implementation>(`/products/${productId}/implementations/prepare`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  monitoring: (productId: string, enabled: boolean) =>
    request<Product>(`/products/${productId}/monitoring`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  importTraces: (productId: string, jsonl: string) =>
    request<{ imported: number; rejected: number; errors: string[] }>(`/products/${productId}/traces/import`, {
      method: 'POST',
      body: JSON.stringify({ traces: [], jsonl }),
    }),
  runExperiment: (
    productId: string,
    payload: { finding_id: string; quality_gate: number; min_samples: number; fallback_exists: boolean },
  ) =>
    request<Experiment>(`/products/${productId}/experiments/run`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  chat: (
    productId: string | null,
    messages: { role: 'user' | 'assistant'; content: string }[],
    model?: string,
  ) =>
    request<AgentResponse>('/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, messages, model: model || null }),
    }),
}
