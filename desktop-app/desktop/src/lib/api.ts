import type {
  AgentResponse,
  AICall,
  Economics,
  Evaluation,
  EvaluationCreatePayload,
  Experiment,
  Finding,
  Health,
  Implementation,
  OptimizationExecutePayload,
  OptimizationExecution,
  OptimizationPlan,
  OptimizationPlanCreatePayload,
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

async function requestOnce(
  path: string,
  init: RequestInit | undefined,
  token: string,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Zevqora-Token': token } : {}),
      ...(init?.headers || {}),
    },
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = await resolveApiToken()
  let response = await requestOnce(path, init, token)

  if (response.status === 401) {
    // Local backend may have restarted and rotated its API token.
    // Re-read the token and retry this request exactly once.
    apiTokenPromise = null
    token = await resolveApiToken()
    response = await requestOnce(path, init, token)
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
  optimizationPlans: (productId: string) =>
    request<OptimizationPlan[]>(`/products/${productId}/optimization/plans`),

  createOptimizationPlans: (
    productId: string,
    payload: OptimizationPlanCreatePayload,
  ) =>
    request<OptimizationPlan[]>(`/products/${productId}/optimization/plans`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  optimizationExecutions: (productId: string) =>
    request<OptimizationExecution[]>(`/products/${productId}/optimization/executions`),

  optimizationExecution: (productId: string, executionId: string) =>
    request<OptimizationExecution>(
      `/products/${productId}/optimization/executions/${executionId}`,
    ),

  executeOptimizationPlan: (
    productId: string,
    planId: string,
    payload: OptimizationExecutePayload = {},
  ) =>
    request<OptimizationExecution>(
      `/products/${productId}/optimization/plans/${planId}/execute`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  evaluations: (productId: string) =>
    request<Evaluation[]>(`/products/${productId}/evaluations`),

  evaluation: (productId: string, evaluationId: string) =>
    request<Evaluation>(`/products/${productId}/evaluations/${evaluationId}`),

  createEvaluation: (
    productId: string,
    payload: EvaluationCreatePayload,
  ) =>
    request<Evaluation>(`/products/${productId}/evaluations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runAuthoritativeVerification: async (
    productId: string,
    payload: {
      finding_id: string
      quality_floor: number
      min_samples: number
      fallback_confirmed: boolean
    },
  ): Promise<Evaluation> => {
    if (!payload.fallback_confirmed) {
      throw new Error('Confirm the baseline fallback before running verification.')
    }

    // Start with the safest deterministic discovery path. The backend planner
    // may return BLOCKED when the evidence cannot support an executable plan.
    const plans = await request<OptimizationPlan[]>(
      `/products/${productId}/optimization/plans`,
      {
        method: 'POST',
        body: JSON.stringify({
          finding_id: payload.finding_id,
        }),
      },
    )

    const plan = plans.find((item) => item.status === 'READY')
    if (!plan) {
      const reason = plans
        .map((item) => item.blocked_reason || item.reason)
        .filter(Boolean)
        .join('; ')
      throw new Error(reason || 'No evidence-backed optimization plan is ready to execute.')
    }

    const execution = await request<OptimizationExecution>(
      `/products/${productId}/optimization/plans/${plan.id}/execute`,
      {
        method: 'POST',
        body: JSON.stringify({
          force_rerun: false,
          project_to_legacy_traces: false,
        }),
      },
    )

    if (execution.status !== 'SUCCEEDED') {
      throw new Error(
        execution.error_detail ||
        `Candidate execution finished with status ${execution.status}.`,
      )
    }

    return request<Evaluation>(`/products/${productId}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({
        candidate_execution_id: execution.id,
        finding_id: payload.finding_id,
        gate_config: {
          min_samples: payload.min_samples,
          quality_floor: payload.quality_floor,
          require_cost_improvement: true,
          require_latency: true,
          max_latency_regression_pct: 20,
          require_fallback: true,
        },
        project_experiment: true,
      }),
    })
  },

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
