/**
 * Verified Optimization Run client (platform engine only). Every write goes
 * to the server; the browser never sends a gate threshold for a verdict.
 */
import { api } from '@/lib/api';

export type Verdict = 'VERIFIED' | 'REJECTED' | 'INCOMPLETE';
export type ExecutableStatus = 'EXECUTABLE' | 'NOT_EXECUTABLE' | 'NEEDS_IMPLEMENTATION';

export interface ContractRequirements {
  quality_floor: number;
  quality_tolerance: number;
  min_task_success_rate: number | null;
  task_success_tolerance: number;
  latency: { require: boolean; max_p95_ms: number | null; max_regression_pct: number | null };
  protected: { require_cases: boolean; min_cases: number };
  cost: { require_evidence: boolean; min_coverage: number; require_improvement: boolean; min_improvement_pct: number };
  evidence: { min_samples: number; min_latency_samples: number; min_outcome_coverage: number };
  required_metrics: string[];
  reliability: { max_failure_rate: number | null; max_retry_rate: number | null };
  allowed_providers: string[] | null;
  allowed_models: string[] | null;
  policy: { no_protected_regression: boolean; require_data_boundary: boolean };
  dataset_version: string | null;
}

export interface EvaluationContract {
  id: string;
  product_id: string;
  version: number;
  status: 'draft' | 'frozen' | 'superseded';
  requirements: ContractRequirements;
  contract_hash: string;
  created_at: string;
  frozen_at: string | null;
  superseded_by: string | null;
}

export interface OptimizationRun {
  id: string;
  product_id: string;
  contract_id: string;
  contract_hash: string;
  baseline_snapshot_id: string | null;
  status: 'open' | 'evaluated' | 'closed';
  created_at: string;
}

export interface OptimizeStatus {
  enabled: boolean;
  product_id: string;
  contracts: EvaluationContract[];
  runs: OptimizationRun[];
  defaults: ContractRequirements;
}

interface LatencySummary {
  samples: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  low_evidence: boolean;
}

export interface SnapshotMetrics {
  samples: { logical_requests: number; recorded_attempts: number; executed_attempts: number; protected_samples: number };
  economics: {
    total_known_cost_usd: number | null;
    known_cost_count: number;
    cost_coverage: number | null;
    cost_basis: 'observed' | 'estimated' | 'mixed' | null;
    wasted_attempt_known_cost_usd: number | null;
    cost_per_logical_request_usd: number | null;
    cost_per_successful_outcome_usd: number | null;
    cpso: { value_usd: number | null; numerator_coverage: number | null; denominator_coverage: number | null; successful_outcomes: number; population: number; unavailable_reasons: string[] };
  };
  latency: { request: LatencySummary; attempt: LatencySummary; ttft: LatencySummary };
  quality: { score: number | null; samples: number; source: string | null; task_success: { known: number; succeeded: number; rate: number | null; unknown: number; sources: string[] }; protected: { requests: number; outcome_known: number; failed: number } };
  reliability: { failure_count: number; failure_rate: number | null; retry_count: number; retry_rate: number | null; retry_amplification: number | null; retried_requests: number; retry_latency_ms: number | null; timeout_count: number | null; rate_limit_count: number | null; fallback_count: number | null };
  bad_day: { p99_request_latency_ms: number | null; max_request_latency_ms: number | null; worst_retry_amplification: number | null; costliest_requests: { logical_request: string; cost_usd: number; attempts: number }[]; note: string };
  evidence: { coverage: Record<string, number | null>; required_metrics: string[]; completeness: 'complete' | 'incomplete'; missing: string[]; graph_count: number; graph_set_hash: string | null; graphs_truncated: boolean; window_truncated: boolean };
}

export interface Hotspot {
  class: string;
  kind: string;
  name: string | null;
  samples: number;
  p50_ms: number | null;
  p95_ms: number | null;
  critical_path_graphs: number;
  mean_share_of_root: number | null;
}

export interface Snapshot {
  id: string;
  contract_hash: string;
  metrics: SnapshotMetrics;
  latency_analysis: { status: string; graphs: number; complete: number; incomplete_reasons: string[]; hotspots: Hotspot[]; retry: { retried_requests: number; added_latency_ms: number | null; mean_added_ms: number | null } | null };
  completeness: 'complete' | 'incomplete';
  trace_count: number;
  window_truncated: boolean;
  snapshot_hash: string;
  created_at: string;
}

export interface Diagnosis {
  id: string;
  family: string;
  scope: string;
  symptom: string;
  root_cause: string;
  causal_path: string[];
  affected_nodes: { graph_id: string; node_id: string; stable_key: string; kind: string; name: string | null }[];
  evidence_refs: { type: string; id?: string; request_id?: string; node_id?: string; stable_key?: string }[];
  metrics: Record<string, unknown>;
  confidence: number;
  severity: 'low' | 'medium' | 'high';
  required_additional_evidence: string[];
  falsifier: string;
  suggested_optimization_passes: string[];
  risk_class: string;
  diagnosis_hash: string;
}

export interface Candidate {
  id: string;
  strategy: string;
  status: string;
  executable_status: ExecutableStatus;
  optimization_pass: string;
  pass_version: string;
  diagnosis_id: string | null;
  contract_hash: string;
  candidate_config_hash: string;
  reason: string;
  expected_mechanism: string;
  risk: string;
  sample_count: number;
  candidate_config: Record<string, unknown>;
  lineage: { expected_effects?: Record<string, { direction: string; basis: string; note?: string }>; falsifier?: string; rollback?: string; protected_slices?: string[]; materializer_hints?: { kind: string; target: string; notes: string }; not_executable_reason?: string | null; label?: string };
}

export interface Gate {
  name: string;
  required: boolean;
  outcome: 'passed' | 'failed' | 'missing' | 'informational';
  reason: string;
  source?: string;
}

export interface Comparison {
  baseline: { cost_usd: number | null; cost_per_successful_outcome_usd: number | null; quality: number | null; task_success_rate: number | null; p50_ms: number | null; p95_ms: number | null };
  candidate: { cost_usd: number | null; cost_per_successful_outcome_usd: number | null; quality: number | null; task_success_rate: number | null; p50_ms: number | null; p95_ms: number | null; replay_failures: number };
  deltas_pct: { cost: number | null; cost_per_successful_outcome: number | null; p95: number | null };
  protected: { evaluated: number; failures: number | null };
  realized_production_result: string;
}

export interface RunEvaluation {
  id: string;
  candidate_plan_id: string;
  status: Verdict;
  rejection_reason: string | null;
  contract_hash: string;
  sample_count: number;
  gates: Gate[];
  performance_comparison: Comparison | null;
  cases: { case_id: string; protected: boolean; baseline_passed: boolean; candidate_passed: boolean; baseline_latency_ms: number | null; candidate_latency_ms: number | null; candidate_cost_usd: number | null }[];
}

export interface RunReport {
  run: OptimizationRun;
  contract: EvaluationContract;
  baseline: Snapshot | null;
  diagnoses: Diagnosis[];
  candidates: Candidate[];
  evaluations: RunEvaluation[];
  executive: { headline: string; not_claimed: string[]; results: { evaluation_id: string; strategy: string | null; verdict: Verdict; label: string; scope: string; evaluated_cost_change: string | null; evaluated_cpso_change: string | null; evaluated_p95_change: string | null; reason: string | null; production_realized_result: string }[] };
  developer: { zevir: { graph_count: number; graph_set_hash: string | null; latency_status: string | null } | null; lineage: { candidate_id: string; pass: string; candidate_config_hash: string; executable_status: string; rollback: string | null }[] };
}

const P = (productId: string) => `/api/optimize/products/${productId}`;
const R = (runId: string) => `/api/optimize/runs/${runId}`;

export const optimizeApi = {
  status: (productId: string) => api<OptimizeStatus>(P(productId)),
  saveDraft: (productId: string, requirements: ContractRequirements | null) => api<EvaluationContract>(`${P(productId)}/contracts`, { method: 'POST', body: { requirements } }),
  freeze: (productId: string, contractId: string) => api<EvaluationContract>(`${P(productId)}/contracts/${contractId}/freeze`, { method: 'POST', body: {} }),
  startRun: (productId: string, contractId: string) => api<OptimizationRun>(`${P(productId)}/runs`, { method: 'POST', body: { contract_id: contractId } }),
  baseline: (runId: string) => api<{ snapshot: Snapshot; reused: boolean }>(`${R(runId)}/baseline`, { method: 'POST', body: {} }),
  diagnose: (runId: string) => api<Diagnosis[]>(`${R(runId)}/diagnoses`, { method: 'POST', body: {} }),
  candidates: (runId: string) => api<{ candidates: Candidate[]; skipped: { pass: string; reasons: string[] }[] }>(`${R(runId)}/candidates`, { method: 'POST', body: {} }),
  replay: (runId: string, candidateId: string) => api<{ evaluation: RunEvaluation; reused: boolean }>(`${R(runId)}/candidates/${candidateId}/replay`, { method: 'POST', body: {} }),
  report: (runId: string) => api<RunReport>(`${R(runId)}/report`),
  loadDemo: (workspaceId: string) => api<{ product_id: string; name: string; synthetic: true; suggested_requirements: Partial<ContractRequirements> }>('/api/optimize/demo', { method: 'POST', body: { workspace_id: workspaceId } }),
};
