export type ViewKey = 'overview' | 'workspace' | 'opportunities' | 'experiments' | 'changes' | 'runtime' | 'zev' | 'settings'

export type ProviderMode = 'local_key' | 'platform' | 'none'

export interface Health {
  status: string
  version: string
  openrouter_configured: boolean
  provider_mode: ProviderMode
  platform_connected: boolean
}

export interface PlatformStatus {
  mode: ProviderMode
  connected: boolean
  base_url: string | null
  user_id: string | null
  email: string | null
  workspace_id: string | null
  project_id: string | null
  plan: string | null
  token_fingerprint: string | null
  candidate_models: string[]
  pricing_version: string | null
  pricing_synced: boolean
  pricing_models: number
  note: string
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
  verification_source: string
  execution_proven: boolean
  evaluation_run_id: string | null
  candidate_execution_id: string | null
  created_at: string
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
  review_note: string | null
  reviewed_at: string | null
  pushed_at: string | null
  remote_url: string | null
  pr_url: string | null
}

export interface GitContext {
  implementation_id: string
  branch_name: string
  worktree_path: string
  worktree_exists: boolean
  remote_url: string | null
  remote_host: string | null
  default_branch: string
  compare_url: string | null
  pushed_at: string | null
  pr_url: string | null
  status: string
}

export interface PushResult {
  ok: boolean
  output: string
  compare_url: string | null
  pushed_at: string | null
}

export type StrategyName = 'exact_reuse' | 'model_substitution' | 'bounded_routing'

export interface OptimizationPlan {
  id: string
  product_id: string
  finding_id: string | null
  strategy: StrategyName | string
  status: 'DRAFT' | 'READY' | 'BLOCKED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string
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

export interface SampleResult {
  baseline_trace_id: string
  status: 'succeeded' | 'failed' | 'skipped' | string
  provider?: string | null
  requested_model?: string | null
  resolved_model?: string | null
  output_text?: string | null
  output_hash?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  cost_source?: string | null
  latency_ms?: number | null
  error_category?: string | null
  error_detail?: string | null
  [key: string]: unknown
}

export interface OptimizationExecution {
  id: string
  candidate_plan_id: string
  product_id: string
  status: 'PLANNED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'BUDGET_EXCEEDED' | string
  execution_key: string
  attempt: number
  provider: string | null
  requested_model: string | null
  resolved_model: string | null
  started_at: string | null
  completed_at: string | null
  baseline_trace_ids: string[]
  sample_results: SampleResult[]
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

export interface EvalGate {
  name: string
  required: boolean
  outcome: 'passed' | 'failed' | 'missing' | 'informational' | string
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
  status: 'PLANNED' | 'RUNNING' | 'INCOMPLETE' | 'VERIFIED' | 'REJECTED' | 'FAILED' | 'CANCELLED' | string
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
  gates: EvalGate[]
  rejection_reason: string | null
  grader_config_hash: string
  gate_config_hash: string
  created_at: string
  completed_at: string | null
  note: string
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
  model?: string
}

// ---- Platform (ZEVQORA account service) -------------------------------------

export interface CloudWorkspace {
  id: string
  name: string
  slug: string
  owner_id: string
  plan_override: string | null
  data_retention_days: number
  settings: Record<string, unknown>
  created_at: string
  role: 'owner' | 'admin' | 'member' | 'viewer' | string
  plan: string
  project_count: number
}

export interface CloudProject {
  id: string
  workspace_id: string
  name: string
  slug: string
  description: string | null
  source_kind: string
  repo_url: string | null
  settings: Record<string, unknown>
  created_at: string
  archived_at: string | null
}

export interface CloudConnection {
  id: string
  kind: string
  name: string
  status: string
  token_prefix: string | null
  token_last4: string | null
  scopes: string[]
  metadata: Record<string, unknown>
  created_at: string
  last_used_at: string | null
  last_seen_at: string | null
  revoked_at: string | null
  created_by: string
}

export interface RuntimeEvent {
  id: string
  trace_id: string
  span_id: string | null
  occurred_at: string
  provider: string
  model: string
  operation: string | null
  status: string
  input_tokens: number | null
  output_tokens: number | null
  cached_input_tokens: number | null
  latency_ms: number | null
  cost_usd: number | null
  cost_source: string | null
  attempt: number | null
  error_class: string | null
  has_sample: boolean
}

export interface RuntimeSummary {
  project: { id: string; name: string; slug: string; settings: Record<string, unknown> }
  window_hours: number
  totals: {
    requests: number
    errors: number
    cost_usd: number
    input_tokens: number
    output_tokens: number
    samples: number
    last_seen: string | null
    latency_p50_ms: number | null
    latency_p95_ms: number | null
    requests_per_min_5m: number
    errors_5m: number
  }
  providers: Array<{ provider: string; requests: number; cost_usd: number; errors: number }>
  models: Array<{ model: string; provider: string; requests: number; errors: number; cost_usd: number; input_tokens: number; output_tokens: number; latency_p50_ms: number | null; latency_p95_ms: number | null; samples: number }>
  daily: Array<{ day: string; requests: number; errors: number; cost_usd: number }>
  connections: CloudConnection[]
  recent: RuntimeEvent[]
  open_opportunities: number
}

export interface PlatformComputeStatus {
  configured: boolean
  provider: string
  plan: { id: string; name: string; limits: Record<string, unknown> }
  credits: { included_usd: number; used_usd: number; remaining_usd: number; period_end: string | null }
  rate_limit_per_minute: number
  workspace: { id: string; name: string; slug: string; role: string } | null
  project: { id: string; name: string; workspace_id: string } | null
  billing_user_id: string
  is_billing_owner: boolean
  user: { id: string; email: string | null }
  time: string
}
