export type ViewKey =
  | 'products'
  | 'zev'
  | 'spend'
  | 'waste'
  | 'experiments'
  | 'savings'
  | 'implementations'
  | 'settings'

export interface Health {
  status: string
  version: string
  openrouter_configured: boolean
}

export interface Product {
  id: string
  name: string
  root_path: string
  monitoring_enabled: boolean
  created_at: string
  last_scan_at: string | null
}

export interface AICall {
  id: string
  file_path: string
  line: number
  provider: string
  symbol: string | null
  excerpt: string
}

export interface Finding {
  id: string
  origin: string
  category: string
  title: string
  root_cause: string
  file_path: string
  line: number
  symbol: string | null
  confidence: number
  risk: string
  evidence_status: string
}

export interface ScanResult {
  product: Product
  files_scanned: number
  ai_calls: AICall[]
  findings: Finding[]
  detected_stack: string[]
  skipped_sensitive_paths: number
}

export interface Economics {
  trace_count: number
  observed_cost_usd: number | null
  avg_cost_per_trace_usd: number | null
  avg_latency_ms: number | null
  first_evidence_at: string | null
  latest_evidence_at: string | null
  providers: Record<string, number>
  verified_savings_usd: number
  verified_experiments: number
  note: string
}

export interface Gate {
  name: string
  passed: boolean
  detail: string
}

export interface Experiment {
  id: string
  product_id: string
  finding_id: string | null
  status: 'VERIFIED' | 'REJECTED' | 'NEEDS_EVIDENCE'
  sample_size: number
  baseline_cost_usd: number | null
  candidate_cost_usd: number | null
  verified_savings_usd: number | null
  baseline_quality: number | null
  candidate_quality: number | null
  baseline_latency_ms: number | null
  candidate_latency_ms: number | null
  gates: Gate[]
  evidence_version: string
  verification_source?: string
  execution_proven?: boolean
  evaluation_run_id?: string | null
  candidate_execution_id?: string | null
  created_at: string
}


export type OptimizationStrategy =
  | 'exact_reuse'
  | 'model_substitution'
  | 'bounded_routing'

export interface OptimizationPlanCreatePayload {
  finding_id?: string | null
  strategy?: OptimizationStrategy | null
  candidate_model?: string | null
  max_budget_usd?: number | null
}

export interface OptimizationExecutePayload {
  force_rerun?: boolean
  project_to_legacy_traces?: boolean
}

export interface OptimizationPlan {
  id: string
  product_id: string
  finding_id: string | null
  strategy: string
  status: string
  reason: string
  expected_mechanism: string
  risk: string
  fallback: string
  max_budget_usd: number
  sample_scope: string[]
  baseline_config: Record<string, unknown>
  candidate_config: Record<string, unknown>
  required_evidence: string[]
  plan_version: string
  config_hash: string
  blocked_reason: string | null
  created_at: string
}

export interface OptimizationExecution {
  id: string
  candidate_plan_id: string
  product_id: string
  status: string
  execution_key: string
  attempt: number
  parent_execution_id: string | null
  provider: string | null
  requested_model: string | null
  resolved_model: string | null
  started_at: string | null
  completed_at: string | null
  baseline_trace_ids: string[]
  sample_results: Array<Record<string, unknown>>
  input_tokens: number | null
  output_tokens: number | null
  cached_input_tokens: number | null
  cost_usd: number | null
  cost_source: string | null
  pricing_version: string | null
  latency_ms: number | null
  provider_request_id: string | null
  provider_call_count: number
  candidate_cost_delta_usd: number | null
  error_category: string | null
  error_detail: string | null
  fallback_used: boolean
  provenance_hash: string
  created_at: string
  note: string
}

export interface EvaluationGraderInput {
  name: string
  version?: string | null
  config?: Record<string, unknown>
}

export interface EvaluationCaseInput {
  case_id: string
  baseline_trace_id: string
  candidate_sample_baseline_trace_id?: string | null
  protected?: boolean
  graders?: EvaluationGraderInput[]
  expected?: unknown
  reference?: Record<string, unknown>
  required_tools?: string[]
  allowed_tools?: string[] | null
  forbidden_tools?: string[]
  weight?: number
  metadata?: Record<string, unknown>
}

export interface EvaluationGateConfig {
  min_samples?: number
  quality_floor?: number
  non_inferiority_tolerance?: number
  require_cost_improvement?: boolean
  min_cost_improvement_pct?: number
  require_latency?: boolean
  max_latency_regression_pct?: number
  require_fallback?: boolean
  require_protected_cases?: boolean
  latency_informational?: boolean
  aggregation?: 'mean'
}

export interface EvaluationCreatePayload {
  candidate_execution_id: string
  finding_id?: string | null
  cases?: EvaluationCaseInput[] | null
  gate_config?: EvaluationGateConfig | null
  project_experiment?: boolean
}

export type EvaluationStatus =
  | 'PLANNED'
  | 'RUNNING'
  | 'INCOMPLETE'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'

export type EvaluationGateOutcome =
  | 'passed'
  | 'failed'
  | 'missing'
  | 'informational'

export interface EvaluationGate {
  name: string
  required: boolean
  outcome: EvaluationGateOutcome
  observed: unknown
  threshold: unknown
  reason: string
}

export interface Evaluation {
  id: string
  product_id: string
  candidate_plan_id: string | null
  candidate_execution_id: string
  finding_id: string | null
  status: EvaluationStatus
  evaluation_version: string
  sample_count: number
  protected_sample_count: number
  baseline_quality: number | null
  candidate_quality: number | null
  quality_delta: number | null
  baseline_cost_usd: number | null
  candidate_cost_usd: number | null
  raw_cost_delta_usd: number | null
  raw_cost_delta_percent: number | null
  baseline_latency_ms: number | null
  candidate_latency_ms: number | null
  evidence_completeness: boolean
  verification_source: string
  execution_proven: boolean
  evidence_version: string
  gates: EvaluationGate[]
  rejection_reason: string | null
  grader_config_hash: string
  gate_config_hash: string
  created_at: string
  completed_at: string | null
  note: string
}


export interface Implementation {
  id: string
  product_id: string
  experiment_id: string
  finding_id: string | null
  status: string
  branch_name: string
  worktree_path: string
  target_file: string
  summary: string
  diff_text: string
  test_command: string | null
  test_exit_code: number | null
  test_output: string | null
  model: string
  created_at: string
}


export interface ToolEvent {
  name: string
  status: string
  summary: string
}

export interface AgentResponse {
  message: string
  model: string
  provider: string
  tool_events: ToolEvent[]
  openrouter_configured: boolean
}

export interface ChatLine {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolEvents?: ToolEvent[]
}
