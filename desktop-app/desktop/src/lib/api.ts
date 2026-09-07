import type {
  AgentResponse,
  AICall,
  Economics,
  Evaluation,
  Experiment,
  Finding,
  GitContext,
  Health,
  Implementation,
  OptimizationExecution,
  OptimizationPlan,
  PlatformStatus,
  Product,
  PushResult,
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

export class LocalApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function requestOnce(path: string, init: RequestInit | undefined, token: string): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Zevqora-Token': token } : {}),
        ...(init?.headers || {}),
      },
    })
  } catch {
    throw new LocalApiError(0, 'The local engine is not reachable on 127.0.0.1:8000.')
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = await resolveApiToken()
  let response = await requestOnce(path, init, token)
  if (response.status === 401) {
    // The local engine may have restarted and rotated its per-launch token.
    // Re-read it from the bridge and retry this request exactly once.
    apiTokenPromise = null
    token = await resolveApiToken()
    response = await requestOnce(path, init, token)
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ') || detail
    } catch {
      // keep status text
    }
    throw new LocalApiError(response.status, detail)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  health: async (): Promise<Health> => {
    let response: Response
    try {
      response = await fetch(HEALTH_URL)
    } catch {
      throw new LocalApiError(0, 'Local engine offline')
    }
    if (!response.ok) throw new LocalApiError(response.status, 'Local engine offline')
    return response.json()
  },
  platformStatus: () => request<PlatformStatus>('/platform/status'),

  products: () => request<Product[]>('/products'),
  connectLocal: (path: string, name?: string) =>
    request<ScanResult>('/products/connect-local', { method: 'POST', body: JSON.stringify({ path, name: name || null }) }),
  archiveProduct: (productId: string) => request<unknown>(`/products/${productId}`, { method: 'DELETE' }),
  scan: (productId: string) => request<ScanResult>(`/products/${productId}/scan`, { method: 'POST' }),
  aiCalls: (productId: string) => request<AICall[]>(`/products/${productId}/ai-calls`),
  findings: (productId: string) => request<Finding[]>(`/products/${productId}/findings`),
  economics: (productId: string) => request<Economics>(`/products/${productId}/economics`),
  experiments: (productId: string) => request<Experiment[]>(`/products/${productId}/experiments`),
  implementations: (productId: string) => request<Implementation[]>(`/products/${productId}/implementations`),
  monitoring: (productId: string, enabled: boolean) =>
    request<Product>(`/products/${productId}/monitoring`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  importTraces: (productId: string, jsonl: string) =>
    request<{ imported: number; rejected: number; errors: string[] }>(`/products/${productId}/traces/import`, {
      method: 'POST',
      body: JSON.stringify({ traces: [], jsonl }),
    }),

  // Replay + evaluation (execution-proven path)
  plans: (productId: string) => request<OptimizationPlan[]>(`/products/${productId}/optimization/plans`),
  createPlans: (productId: string, body: { finding_id?: string | null; strategy?: string | null; candidate_model?: string | null; max_budget_usd?: number | null }) =>
    request<OptimizationPlan[]>(`/products/${productId}/optimization/plans`, { method: 'POST', body: JSON.stringify(body) }),
  executePlan: (productId: string, planId: string, body: { force_rerun?: boolean; project_to_legacy_traces?: boolean } = {}) =>
    request<OptimizationExecution>(`/products/${productId}/optimization/plans/${planId}/execute`, { method: 'POST', body: JSON.stringify({ force_rerun: false, project_to_legacy_traces: false, ...body }) }),
  executions: (productId: string) => request<OptimizationExecution[]>(`/products/${productId}/optimization/executions`),
  execution: (productId: string, executionId: string) => request<OptimizationExecution>(`/products/${productId}/optimization/executions/${executionId}`),
  evaluations: (productId: string) => request<Evaluation[]>(`/products/${productId}/evaluations`),
  evaluation: (productId: string, evaluationId: string) => request<Evaluation>(`/products/${productId}/evaluations/${evaluationId}`),
  evaluate: (productId: string, body: { candidate_execution_id: string; finding_id?: string | null; gate_config?: Record<string, unknown>; project_experiment?: boolean }) =>
    request<Evaluation>(`/products/${productId}/evaluations`, { method: 'POST', body: JSON.stringify({ project_experiment: true, ...body }) }),

  // Patch / review
  prepareImplementation: (productId: string, payload: { experiment_id: string; instructions?: string; model?: string; run_tests: boolean; test_command?: string }) =>
    request<Implementation>(`/products/${productId}/implementations/prepare`, { method: 'POST', body: JSON.stringify(payload) }),
  implementationGit: (productId: string, implementationId: string) => request<GitContext>(`/products/${productId}/implementations/${implementationId}/git-context`),
  decideImplementation: (productId: string, implementationId: string, decision: 'approve' | 'reject', note?: string) =>
    request<Implementation>(`/products/${productId}/implementations/${implementationId}/decision`, { method: 'POST', body: JSON.stringify({ decision, note: note || null }) }),
  pushImplementation: (productId: string, implementationId: string) =>
    request<PushResult>(`/products/${productId}/implementations/${implementationId}/push`, { method: 'POST', body: JSON.stringify({}) }),
  recordPrLink: (productId: string, implementationId: string, prUrl: string) =>
    request<Implementation>(`/products/${productId}/implementations/${implementationId}/pr-link`, { method: 'POST', body: JSON.stringify({ pr_url: prUrl }) }),

  chat: (productId: string | null, messages: { role: 'user' | 'assistant'; content: string }[], model?: string) =>
    request<AgentResponse>('/agent/chat', { method: 'POST', body: JSON.stringify({ product_id: productId, messages, model: model || null }) }),
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
