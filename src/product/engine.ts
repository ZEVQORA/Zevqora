/**
 * One engine contract, two runtimes.
 *
 * - Cloud engine: /api/engine/* on the ZEVQORA platform (browser and desktop).
 * - Local engine: the desktop's FastAPI process on 127.0.0.1 (Electron only),
 *   which scans the real repository and prepares Git worktrees.
 *
 * The product UI only ever talks to `Engine`; which one is chosen is a runtime
 * decision, so the app is identical on the web and in the desktop shell.
 */
import { api, ApiClientError, errorMessage } from '@/lib/api';
import { accessToken } from '@/lib/supabase';
import { desktopBridge, LOCAL_ENGINE_BASE } from './bridge';
import type {
  AgentResponse,
  AICall,
  Economics,
  EngineHealth,
  EnginePlatformStatus,
  Evaluation,
  Experiment,
  Finding,
  GitContext,
  Implementation,
  OptimizationExecution,
  OptimizationPlan,
  Product,
  PushResult,
  ScanResult,
  ScanUpload,
} from './types';

export type EngineKind = 'cloud' | 'local';

export interface Engine {
  kind: EngineKind;
  health(): Promise<EngineHealth>;
  platformStatus(): Promise<EnginePlatformStatus>;
  products(): Promise<Product[]>;
  /** Cloud: register a repository whose scan the browser performed locally. Local: the engine scans the folder itself. */
  connect(input: { rootPath: string; name?: string; upload?: ScanUpload }): Promise<ScanResult>;
  scan(productId: string, upload?: ScanUpload): Promise<ScanResult>;
  archiveProduct(productId: string): Promise<void>;
  monitoring(productId: string, enabled: boolean): Promise<Product>;
  aiCalls(productId: string): Promise<AICall[]>;
  findings(productId: string): Promise<Finding[]>;
  economics(productId: string): Promise<Economics>;
  experiments(productId: string): Promise<Experiment[]>;
  implementations(productId: string): Promise<Implementation[]>;
  importTraces(productId: string, jsonl: string): Promise<{ imported: number; rejected: number; errors: string[] }>;
  plans(productId: string): Promise<OptimizationPlan[]>;
  createPlans(productId: string, body: { finding_id?: string | null; strategy?: string | null; candidate_model?: string | null; max_budget_usd?: number | null }): Promise<OptimizationPlan[]>;
  executePlan(productId: string, planId: string, body?: { force_rerun?: boolean }): Promise<OptimizationExecution>;
  executions(productId: string): Promise<OptimizationExecution[]>;
  evaluations(productId: string): Promise<Evaluation[]>;
  evaluate(productId: string, body: { candidate_execution_id: string; finding_id?: string | null; gate_config?: Record<string, unknown>; project_experiment?: boolean }): Promise<Evaluation>;
  prepareImplementation(productId: string, body: { experiment_id: string; instructions?: string; model?: string; run_tests: boolean; test_command?: string; target_file?: string; source_text?: string }): Promise<Implementation>;
  implementationGit(productId: string, implementationId: string): Promise<GitContext>;
  decideImplementation(productId: string, implementationId: string, decision: 'approve' | 'reject', note?: string): Promise<Implementation>;
  pushImplementation(productId: string, implementationId: string): Promise<PushResult>;
  recordPrLink(productId: string, implementationId: string, prUrl: string): Promise<Implementation>;
  patch(productId: string, implementationId: string): Promise<{ diff: string; replacement: string | null; target_file: string; branch_name: string }>;
  chat(productId: string | null, messages: { role: 'user' | 'assistant'; content: string }[], model?: string): Promise<AgentResponse>;
}

export class EngineError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---- cloud ---------------------------------------------------------------------
export function cloudEngine(workspaceId: string): Engine {
  const base = '/api/engine';
  const p = (productId: string) => `${base}/products/${productId}`;
  return {
    kind: 'cloud',
    health: () => api<EngineHealth>(`${base}/health`),
    platformStatus: () => api<EnginePlatformStatus>(`${base}/platform/status?workspace_id=${workspaceId}`),
    products: () => api<Product[]>(`${base}/products?workspace_id=${workspaceId}`),
    connect: async ({ rootPath, name, upload }) => {
      const product = await api<Product>(`${base}/products`, { method: 'POST', body: { workspace_id: workspaceId, root_path: rootPath, name: name || null, source: 'browser' } });
      if (!upload) return { product, files_scanned: product.files_scanned || 0, ai_calls: [], findings: [], detected_stack: product.detected_stack || [], skipped_sensitive_paths: product.skipped_sensitive_paths || 0 };
      return api<ScanResult>(`${p(product.id)}/scan`, { method: 'POST', body: upload });
    },
    scan: (productId, upload) => {
      if (!upload) throw new EngineError(400, 'Pick the repository folder again so the browser can rescan it.');
      return api<ScanResult>(`${p(productId)}/scan`, { method: 'POST', body: upload });
    },
    archiveProduct: async (productId) => {
      await api(`${p(productId)}`, { method: 'DELETE' });
    },
    monitoring: (productId, enabled) => api<Product>(`${p(productId)}/monitoring`, { method: 'POST', body: { enabled } }),
    aiCalls: (productId) => api<AICall[]>(`${p(productId)}/ai-calls`),
    findings: (productId) => api<Finding[]>(`${p(productId)}/findings`),
    economics: (productId) => api<Economics>(`${p(productId)}/economics`),
    experiments: (productId) => api<Experiment[]>(`${p(productId)}/experiments`),
    implementations: (productId) => api<Implementation[]>(`${p(productId)}/implementations`),
    importTraces: (productId, jsonl) => api(`${p(productId)}/traces/import`, { method: 'POST', body: { traces: [], jsonl } }),
    plans: (productId) => api<OptimizationPlan[]>(`${p(productId)}/optimization/plans`),
    createPlans: (productId, body) => api<OptimizationPlan[]>(`${p(productId)}/optimization/plans`, { method: 'POST', body }),
    executePlan: (productId, planId, body = {}) => api<OptimizationExecution>(`${p(productId)}/optimization/plans/${planId}/execute`, { method: 'POST', body: { force_rerun: false, ...body } }),
    executions: (productId) => api<OptimizationExecution[]>(`${p(productId)}/optimization/executions`),
    evaluations: (productId) => api<Evaluation[]>(`${p(productId)}/evaluations`),
    evaluate: (productId, body) => api<Evaluation>(`${p(productId)}/evaluations`, { method: 'POST', body: { project_experiment: true, ...body } }),
    prepareImplementation: (productId, body) => api<Implementation>(`${p(productId)}/implementations/prepare`, { method: 'POST', body }),
    implementationGit: (productId, implementationId) => api<GitContext>(`${p(productId)}/implementations/${implementationId}/git-context`),
    decideImplementation: (productId, implementationId, decision, note) => api<Implementation>(`${p(productId)}/implementations/${implementationId}/decision`, { method: 'POST', body: { decision, note: note || null } }),
    pushImplementation: (productId, implementationId) => api<PushResult>(`${p(productId)}/implementations/${implementationId}/push`, { method: 'POST', body: {} }),
    recordPrLink: (productId, implementationId, prUrl) => api<Implementation>(`${p(productId)}/implementations/${implementationId}/pr-link`, { method: 'POST', body: { pr_url: prUrl } }),
    patch: (productId, implementationId) => api(`${p(productId)}/implementations/${implementationId}/patch`),
    chat: (productId, messages, model) => api<AgentResponse>(`${base}/agent/chat`, { method: 'POST', body: { product_id: productId, workspace_id: workspaceId, messages, model: model || null } }),
  };
}

// ---- local (Electron) -----------------------------------------------------------
let localTokenPromise: Promise<string> | null = null;
function localToken() {
  if (!localTokenPromise) localTokenPromise = Promise.resolve(desktopBridge()?.getApiToken() ?? '').catch(() => '');
  return localTokenPromise;
}

async function localRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const send = async (token: string) => {
    try {
      return await fetch(`${LOCAL_ENGINE_BASE}/api/v1${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Zevqora-Token': token } : {}), ...(init?.headers || {}) } });
    } catch {
      throw new EngineError(0, 'The local engine is not reachable on 127.0.0.1:8000.');
    }
  };
  let response = await send(await localToken());
  if (response.status === 401) {
    localTokenPromise = null;
    response = await send(await localToken());
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ') || detail;
    } catch {
      /* keep status text */
    }
    throw new EngineError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Hands the account session to the local engine so it can use platform compute. */
export async function syncLocalEngineSession(workspaceId: string | null, user: { id: string; email: string | null } | null, plan: string | null) {
  if (!desktopBridge()) return false;
  const token = await accessToken();
  if (!token) {
    await localRequest('/platform/session', { method: 'DELETE' }).catch(() => undefined);
    return false;
  }
  await localRequest('/platform/session', { method: 'POST', body: JSON.stringify({ base_url: window.location.origin, access_token: token, user_id: user?.id || null, email: user?.email || null, workspace_id: workspaceId, project_id: null, plan }) });
  return true;
}

export function localEngine(): Engine {
  const p = (productId: string) => `/products/${productId}`;
  return {
    kind: 'local',
    health: async () => {
      let res: Response;
      try {
        res = await fetch(`${LOCAL_ENGINE_BASE}/api/health`);
      } catch {
        throw new EngineError(0, 'Local engine offline');
      }
      if (!res.ok) throw new EngineError(res.status, 'Local engine offline');
      return res.json();
    },
    platformStatus: () => localRequest<EnginePlatformStatus>('/platform/status'),
    products: () => localRequest<Product[]>('/products'),
    connect: ({ rootPath, name }) => localRequest<ScanResult>('/products/connect-local', { method: 'POST', body: JSON.stringify({ path: rootPath, name: name || null }) }),
    scan: (productId) => localRequest<ScanResult>(`${p(productId)}/scan`, { method: 'POST' }),
    archiveProduct: async (productId) => {
      await localRequest(`${p(productId)}`, { method: 'DELETE' });
    },
    monitoring: (productId, enabled) => localRequest<Product>(`${p(productId)}/monitoring`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    aiCalls: (productId) => localRequest<AICall[]>(`${p(productId)}/ai-calls`),
    findings: (productId) => localRequest<Finding[]>(`${p(productId)}/findings`),
    economics: (productId) => localRequest<Economics>(`${p(productId)}/economics`),
    experiments: (productId) => localRequest<Experiment[]>(`${p(productId)}/experiments`),
    implementations: (productId) => localRequest<Implementation[]>(`${p(productId)}/implementations`),
    importTraces: (productId, jsonl) => localRequest(`${p(productId)}/traces/import`, { method: 'POST', body: JSON.stringify({ traces: [], jsonl }) }),
    plans: (productId) => localRequest<OptimizationPlan[]>(`${p(productId)}/optimization/plans`),
    createPlans: (productId, body) => localRequest<OptimizationPlan[]>(`${p(productId)}/optimization/plans`, { method: 'POST', body: JSON.stringify(body) }),
    executePlan: (productId, planId, body = {}) => localRequest<OptimizationExecution>(`${p(productId)}/optimization/plans/${planId}/execute`, { method: 'POST', body: JSON.stringify({ force_rerun: false, project_to_legacy_traces: false, ...body }) }),
    executions: (productId) => localRequest<OptimizationExecution[]>(`${p(productId)}/optimization/executions`),
    evaluations: (productId) => localRequest<Evaluation[]>(`${p(productId)}/evaluations`),
    evaluate: (productId, body) => localRequest<Evaluation>(`${p(productId)}/evaluations`, { method: 'POST', body: JSON.stringify({ project_experiment: true, ...body }) }),
    prepareImplementation: (productId, body) => localRequest<Implementation>(`${p(productId)}/implementations/prepare`, { method: 'POST', body: JSON.stringify({ experiment_id: body.experiment_id, instructions: body.instructions, model: body.model, run_tests: body.run_tests, test_command: body.test_command }) }),
    implementationGit: (productId, implementationId) => localRequest<GitContext>(`${p(productId)}/implementations/${implementationId}/git-context`),
    decideImplementation: (productId, implementationId, decision, note) => localRequest<Implementation>(`${p(productId)}/implementations/${implementationId}/decision`, { method: 'POST', body: JSON.stringify({ decision, note: note || null }) }),
    pushImplementation: (productId, implementationId) => localRequest<PushResult>(`${p(productId)}/implementations/${implementationId}/push`, { method: 'POST', body: JSON.stringify({}) }),
    recordPrLink: (productId, implementationId, prUrl) => localRequest<Implementation>(`${p(productId)}/implementations/${implementationId}/pr-link`, { method: 'POST', body: JSON.stringify({ pr_url: prUrl }) }),
    patch: async (productId, implementationId) => {
      const rows = await localRequest<Implementation[]>(`${p(productId)}/implementations`);
      const impl = rows.find((r) => r.id === implementationId);
      if (!impl) throw new EngineError(404, 'Implementation not found.');
      return { diff: impl.diff_text, replacement: null, target_file: impl.target_file, branch_name: impl.branch_name };
    },
    chat: (productId, messages, model) => localRequest<AgentResponse>('/agent/chat', { method: 'POST', body: JSON.stringify({ product_id: productId, messages, model: model || null }) }),
  };
}

export function engineErrorMessage(error: unknown) {
  if (error instanceof EngineError || error instanceof ApiClientError) return error.message;
  return errorMessage(error);
}
