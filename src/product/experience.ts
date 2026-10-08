import { api } from '@/lib/api';

/** GET /api/workspaces/:id/command-center — see api/_lib/handlers/experience.js. */
export interface LatencyBlock {
  p50_ms: number | null;
  p95_ms: number | null;
  samples: number;
}

export interface ObservedBlock {
  claim: 'OBSERVED';
  source: string;
  window: { from: string; to: string };
  truncated: boolean;
  trace_limit: number;
  requests: number;
  spend_usd: number | null;
  cost_known: number;
  cost_coverage: number | null;
  latency: LatencyBlock & { p99_ms: number | null; p99_note: string | null };
  ttft: LatencyBlock;
  retries: number;
  daily: Array<LatencyBlock & { day: string; requests: number; spend_usd: number | null; cost_known: number }>;
  by_model: Array<LatencyBlock & { provider: string; model: string; requests: number; spend_usd: number | null; cost_known: number }>;
  by_workflow: Array<{ workflow: string; requests: number; spend_usd: number | null; cost_known: number; share: number | null }>;
}

export interface BaselineBlock {
  claim: 'OBSERVED';
  snapshot_id: string;
  snapshot_hash: string;
  contract_hash: string;
  created_at: string;
  trace_count: number;
  completeness: 'complete' | 'incomplete';
  window_truncated: boolean;
  spend_usd: number | null;
  cost_coverage: number | null;
  cpso_usd: number | null;
  cpso_unavailable: string[];
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  ttft_p95_ms: number | null;
  task_success: number | null;
  task_success_known: number;
  quality: number | null;
  failure_rate: number | null;
  retry_rate: number | null;
  retry_amplification: number | null;
  retry_latency_ms: number | null;
  protected: { requests: number; outcome_known: number; failed: number } | null;
  logical_requests: number | null;
  missing_evidence: string[];
  hotspots: Array<{ class: string; kind: string; name: string | null; samples: number; p50_ms: number | null; p95_ms: number | null; critical_path_graphs: number; mean_share_of_root: number | null }>;
  critical_path: { status: string; complete_graphs: number; graphs: number; incomplete_reasons: string[] };
}

export interface SelectedPlan {
  id: string;
  name: string;
  plan_hash: string;
  risk_class: 'low' | 'medium' | 'high';
  implementation_complexity: number;
  rollback_complexity: number;
  claim: 'EVALUATED';
  verdict: string | null;
  cases: number | null;
  cpso_usd: number | null;
  cost_usd: number | null;
  p95_ms: number | null;
  task_success: number | null;
  quality: number | null;
  baseline: { cpso_usd: number | null; cost_usd: number | null; p95_ms: number | null; task_success: number | null; quality: number | null } | null;
  deltas_pct: { cost?: number | null; cost_per_successful_outcome?: number | null; p95?: number | null };
}

export interface Projection {
  claim: 'PROJECTED';
  monthly_cost_change_usd: number | null;
  per_request_change_usd?: number | null;
  observed_requests_30d?: number;
  evaluated_cases?: number;
  unavailable_reason?: string;
  basis: { formula: string; assumptions: string[] };
}

export interface ProductCard {
  id: string;
  name: string;
  synthetic: boolean;
  traces_in_window: number;
  last_trace_at: string | null;
  contract: { id: string; version: number; frozen_at: string; contract_hash: string } | null;
  run: { id: string; status: string; created_at: string } | null;
  baseline: BaselineBlock | null;
  diagnoses: { count: number; top: Array<{ id: string; family: string; severity: 'low' | 'medium' | 'high'; symptom: string; scope: string; confidence: number; affected_nodes: number }> };
  search: { id: string; status: string; created_at: string; completed_at: string | null; generated: number; blocked: number; verified: number; rejected: number; incomplete: number; frontier: number } | null;
  decision: { id: string; policy: string; outcome: string; created_at: string; selected_plan: SelectedPlan | null } | null;
  projected: Projection;
}

export interface CommandCenter {
  workspace_id: string;
  role: string;
  generated_at: string;
  range: { from: string; to: string; days: number };
  synthetic: boolean;
  observed: ObservedBlock;
  products: ProductCard[];
  pipeline: Record<'workloads' | 'with_traces' | 'frozen_contracts' | 'baselines' | 'diagnoses' | 'searches' | 'plans_generated' | 'calibrated' | 'replayed' | 'verified' | 'rejected' | 'incomplete' | 'frontier' | 'selected' | 'blocked', number>;
  verdicts: { claim: 'EVALUATED'; VERIFIED: number; REJECTED: number; INCOMPLETE: number; total: number };
  value: {
    evaluated: Array<SelectedPlan & { product_id: string; product: string; policy: string; projected: Projection }>;
    projected: { claim: 'PROJECTED'; monthly_cost_change_usd: number | null; plans: number };
    realized: { claim: 'REALIZED'; status: 'NOT_YET_MEASURED'; reason: string };
  };
  decision_queue: Array<{ kind: string; product_id: string; product: string; priority: number; title: string; detail: string; href: string }>;
  risks: Array<{ product_id: string; kind: string; severity: 'low' | 'medium' | 'high'; title: string; evidence: Record<string, unknown> }>;
}

export const experienceApi = {
  commandCenter: (workspaceId: string, days = 30) => api<CommandCenter>(`/api/workspaces/${workspaceId}/command-center?days=${days}`),
};

/** Formatting that never turns unknown into zero. */
export const fmt = {
  usd(v: number | null | undefined, digits?: number) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const a = Math.abs(v);
    const d = digits ?? (a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6);
    return `${v < 0 ? '−' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  },
  ms(v: number | null | undefined) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
  },
  pct(v: number | null | undefined, digits = 1) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    return `${(v * 100).toFixed(digits)}%`;
  },
  signedPct(v: number | null | undefined, digits = 1) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
  },
  int(v: number | null | undefined) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    return v.toLocaleString('en-US');
  },
};
