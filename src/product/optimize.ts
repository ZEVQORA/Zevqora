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
  /** Optimization Intelligence (vNext Part 2B) is on for this workspace. */
  intelligence?: boolean;
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

// ---- Optimization Intelligence (vNext Part 2B) ----------------------------------------------
export type PlanStatus = 'PROPOSED' | 'BLOCKED' | 'NEEDS_EVIDENCE' | 'CONFLICTED' | 'PRUNED' | 'CALIBRATION_READY' | 'CALIBRATING' | 'CALIBRATION_REJECTED' | 'FULL_REPLAY_READY' | 'REPLAYING' | 'REJECTED' | 'INCOMPLETE' | 'VERIFIED' | 'PARETO_FRONTIER' | 'SELECTED';
export type Policy = 'BALANCED' | 'MARGIN_FIRST' | 'LATENCY_FIRST' | 'RELIABILITY_FIRST' | 'CUSTOM_CONSTRAINTS';

export interface Estimate {
  value: number | null;
  unknown: boolean;
  label: 'ESTIMATED';
  source: string;
  method: string;
  coverage: number | null;
  confidence: string;
  assumptions: string[];
}

export interface PlanMetrics {
  label?: string;
  cases: number;
  cpso_usd: number | null;
  cost_usd: number | null;
  p95_ms: number | null;
  task_success: number | null;
  quality: number | null;
  failure_rate: number | null;
  provider_calls: number;
  provider_concentration: number | null;
  baseline: { cpso_usd: number | null; cost_usd: number | null; p95_ms: number | null; task_success: number | null; quality: number | null };
  deltas_pct: { cost?: number | null; cost_per_successful_outcome?: number | null; p95?: number | null };
}

export interface PlanPass {
  transformation_hash: string;
  kind: string;
  label: string;
  layer: string;
  scope: string;
  pass: string;
  pass_version: string;
  executable_status: ExecutableStatus;
  not_executable_reason: string | null;
  affected_requests: number;
  affected_in_evaluation_set: number;
  settings: Record<string, unknown>;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  risk_class: string;
}

export interface BadDaySummary {
  cases: number;
  cost_usd: number | null;
  p95_ms: number | null;
  task_success: number | null;
  failure_rate: number | null;
  retry_amplification: number | null;
  fallback_used: number;
  cpso_usd: number | null;
}

export interface BadDayResult {
  id: string;
  plan_id: string;
  profile_id: string;
  label: 'BAD-DAY REPLAY';
  normal_verdict: Verdict;
  bad_day_verdict: Verdict | 'UNSUPPORTED';
  gates: Gate[];
  metrics: { scenario: string; description: string; statement: string; not_claimed: string; normal?: BadDaySummary; bad_day?: BadDaySummary; baseline_bad_day?: BadDaySummary; unsupported_capabilities?: string[] };
}

export interface PlanExplanation {
  why_generated: string[];
  supporting_diagnoses: { id: string; family: string; scope: string; diagnosis_hash: string }[];
  zevir_nodes_changed: { node_id: string; stable_key: string; kind: string; name: string | null }[];
  passes_composed: string[];
  composition_order: string[];
  conflicts_checked: string[];
  missing_evidence: string[];
  why_calibration: string | null;
  why_more_budget: string[] | null;
  calibration: { round: number; outcome: string; label: string; sample_size: number; sample_hash: string; reasons: string[] }[];
  why_rejected: (string | null)[] | null;
  why_dominated: string | null;
  why_frontier: string | null;
  why_selected: string | null;
  falsifiers: string[];
  rollback: { transformation_hash: string; label: string; rollback: string }[];
  not_proven: string[];
}

export interface ExecutionPlan {
  id: string;
  name: string;
  plan_hash: string;
  status: PlanStatus;
  stage: string;
  executable_status: ExecutableStatus;
  passes: PlanPass[];
  affected_node_count: number;
  estimated_effects: (Record<string, Estimate> & { label: string; reason?: string; paths?: Record<string, number> }) | null;
  calibrated_effects: { label: string; round: number; outcome: string; metrics: Record<string, unknown> } | null;
  evaluated_effects: PlanMetrics | null;
  verified_effects: PlanMetrics | null;
  risk_class: 'low' | 'medium' | 'high';
  implementation_complexity: number;
  rollback_complexity: number;
  compatibility: { compatible: boolean; conflicts: { reason: string }[]; dependencies: { kinds: string[]; note: string }[] };
  conflict_reasons: string[];
  missing_evidence: string[];
  evidence_completeness: 'complete' | 'incomplete';
  replay_budget: { round?: number; sample_size?: number; decision?: string; why?: string[]; full_replay_samples?: number };
  verdict: Verdict | null;
  frontier_state: 'FRONTIER' | 'DOMINATED' | 'INCOMPARABLE' | null;
  dominance_state: { dominated_by: string[]; dominates: string[]; frontier_reason: string } | null;
  materializer_hints: { transformation_hash: string; label: string; kind?: string; target?: string; notes?: string }[];
  rollback: { label: string; rollback: string }[];
  explanation: PlanExplanation;
  bad_day: BadDayResult[];
}

export interface SearchSummary {
  id: string;
  run_id: string;
  status: 'generated' | 'calibrating' | 'replaying' | 'completed' | 'budget_exhausted' | 'cancelled' | 'failed';
  search_hash: string;
  seed: string;
  bounds: Record<string, number>;
  evaluation_set: { size: number; eligible: number; final_requests: number; coverage: number | null; sampled: boolean; excluded: { request_id: string; reasons: string[] }[]; protected: number; hash: string };
  generation: { generated: number; truncation_note: string | null; counts: Record<string, number> };
  spend: { provider_usd: number; provider_calls: number; calibration_samples: number; replay_samples: number; plans_calibrated: number; plans_replayed: number };
  budget_report: { reason: string; note: string } | null;
  frontier_hash: string | null;
  created_at: string;
}

export interface Decision {
  id: string;
  policy: Policy;
  outcome: 'SELECTED' | 'NO_ELIGIBLE_PLAN';
  selected_plan_id: string | null;
  explanation: { rule: string; why: string; ranking: { position: number; name: string }[]; excluded: { name: string; reason: string }[]; tradeoffs: { versus: string; selected_better_on: string[]; selected_worse_on: string[] }[]; hard_gates: string };
}

export interface SearchReport {
  search: SearchSummary;
  counts: Record<string, number>;
  plans: ExecutionPlan[];
  decisions: Decision[];
  executive: {
    headline: string;
    what_was_wrong: { family: string; scope: string; symptom: string; severity: string }[];
    frontier: { id: string; name: string; cpso_usd: number | null; p95_ms: number | null; task_success: number | null; risk_class: string }[];
    recommendation: null | { plan_id: string; name: string; policy: Policy; policy_rule: string; label: string; evaluated_cpso_change_pct: number | null; evaluated_cost_change_pct: number | null; evaluated_p95_change_pct: number | null; task_success_change_pp: number | null; quality_change: number | null; why: string; realized_production_result: string };
    evidence: { label: string };
    budget: { reason: string; note: string } | null;
    realized_production_result: string;
    not_claimed: string[];
  };
  developer: { plans: { id: string; name: string; plan_hash: string; composition_order: { label: string; layer: string; scope: string; transformation_hash: string }[]; config_changes: { label: string; settings: Record<string, unknown> }[]; calibration: { round: number; outcome: string; sample_size: number; sample_hash: string }[]; full_replay: { status: Verdict; sample_count: number; gates: Gate[] } | null; pareto: { frontier_reason: string } | null; falsifiers: string[] }[] };
}

export interface StageResult {
  search: SearchSummary;
  done: boolean;
  continuation: boolean;
  processed: { plan_id: string; outcome?: string; verdict?: string }[];
  budget: { code: string; reason: string } | null;
}

export interface BadDayProfile {
  id: string;
  scenario: string;
  parameters: Record<string, number>;
  profile_hash: string;
}

const P = (productId: string) => `/api/optimize/products/${productId}`;
const R = (runId: string) => `/api/optimize/runs/${runId}`;
const S = (searchId: string) => `/api/optimize/searches/${searchId}`;

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
  loadDemo: (workspaceId: string, variant?: 'intelligence') => api<{ product_id: string; name: string; synthetic: true; suggested_requirements: Partial<ContractRequirements> }>('/api/optimize/demo', { method: 'POST', body: { workspace_id: workspaceId, ...(variant ? { variant } : {}) } }),
  // ---- Optimization Intelligence
  searches: (runId: string) => api<{ searches: SearchSummary[] }>(`${R(runId)}/searches`),
  startSearch: (runId: string) => api<{ search: SearchSummary; reused: boolean }>(`${R(runId)}/searches`, { method: 'POST', body: {} }),
  searchReport: (searchId: string) => api<SearchReport>(S(searchId)),
  stage: (searchId: string, stage: 'calibrate' | 'replay') => api<StageResult>(`${S(searchId)}/${stage}`, { method: 'POST', body: {} }),
  cancelSearch: (searchId: string) => api<{ search: SearchSummary }>(`${S(searchId)}/cancel`, { method: 'POST', body: {} }),
  decide: (searchId: string, policy: Policy, params: Record<string, unknown> = {}) => api<{ decision: Decision }>(`${S(searchId)}/decision`, { method: 'POST', body: { policy, params } }),
  profiles: (productId: string) => api<{ profiles: BadDayProfile[] }>(`${P(productId)}/bad-day-profiles`),
  createProfile: (productId: string, scenario: string, parameters: Record<string, number>) => api<BadDayProfile>(`${P(productId)}/bad-day-profiles`, { method: 'POST', body: { scenario, parameters } }),
  badDay: (planId: string, profileId: string) => api<{ result: BadDayResult; reused: boolean }>(`/api/optimize/plans/${planId}/bad-day`, { method: 'POST', body: { profile_id: profileId } }),
};
