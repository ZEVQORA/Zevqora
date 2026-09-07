export type ProductViewKey = 'overview' | 'project' | 'opportunities' | 'experiments' | 'changes' | 'zev';

export type ProviderMode = 'local_key' | 'platform' | 'none';

export interface EngineHealth {
  status: string;
  version: string;
  openrouter_configured: boolean;
  provider_mode: ProviderMode;
  platform_connected: boolean;
}

export interface EnginePlatformStatus {
  mode: ProviderMode;
  connected: boolean;
  base_url: string | null;
  user_id: string | null;
  email: string | null;
  workspace_id: string | null;
  project_id: string | null;
  plan: string | null;
  token_fingerprint: string | null;
  candidate_models: string[];
  pricing_version: string | null;
  pricing_synced: boolean;
  pricing_models: number;
  note: string;
}

export interface Product {
  id: string;
  name: string;
  root_path: string;
  monitoring_enabled: boolean;
  created_at: string;
  last_scan_at: string | null;
  source?: 'browser' | 'desktop';
  files_scanned?: number;
  skipped_sensitive_paths?: number;
  detected_stack?: string[];
}

export interface AICall {
  id: string;
  file_path: string;
  line: number;
  provider: string;
  symbol: string | null;
  excerpt: string;
}

export interface Finding {
  id: string;
  origin: string;
  category: string;
  title: string;
  root_cause: string;
  file_path: string;
  line: number;
  symbol: string | null;
  confidence: number;
  risk: string;
  evidence_status: string;
}

export interface ScanResult {
  product: Product;
  files_scanned: number;
  ai_calls: AICall[];
  findings: Finding[];
  detected_stack: string[];
  skipped_sensitive_paths: number;
}

export interface Economics {
  trace_count: number;
  observed_cost_usd: number | null;
  avg_cost_per_trace_usd: number | null;
  avg_latency_ms: number | null;
  first_evidence_at: string | null;
  latest_evidence_at: string | null;
  providers: Record<string, number>;
  verified_savings_usd: number;
  verified_experiments: number;
  note: string;
}

export interface Gate {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Experiment {
  id: string;
  product_id: string;
  finding_id: string | null;
  status: 'VERIFIED' | 'REJECTED' | 'NEEDS_EVIDENCE';
  sample_size: number;
  baseline_cost_usd: number | null;
  candidate_cost_usd: number | null;
  verified_savings_usd: number | null;
  baseline_quality: number | null;
  candidate_quality: number | null;
  baseline_latency_ms: number | null;
  candidate_latency_ms: number | null;
  gates: Gate[];
  evidence_version: string;
  verification_source: string;
  execution_proven: boolean;
  evaluation_run_id: string | null;
  candidate_execution_id: string | null;
  created_at: string;
}

export interface Implementation {
  id: string;
  product_id: string;
  experiment_id: string;
  finding_id: string | null;
  status: string;
  branch_name: string;
  worktree_path: string;
  target_file: string;
  summary: string;
  diff_text: string;
  test_command: string | null;
  test_exit_code: number | null;
  test_output: string | null;
  model: string;
  created_at: string;
  review_note: string | null;
  reviewed_at: string | null;
  pushed_at: string | null;
  remote_url: string | null;
  pr_url: string | null;
}

export interface GitContext {
  implementation_id: string;
  branch_name: string;
  worktree_path: string;
  worktree_exists: boolean;
  remote_url: string | null;
  remote_host: string | null;
  default_branch: string;
  compare_url: string | null;
  pushed_at: string | null;
  pr_url: string | null;
  status: string;
  mode?: 'browser' | 'desktop';
}

export interface PushResult {
  ok: boolean;
  output: string;
  compare_url: string | null;
  pushed_at: string | null;
}

export interface OptimizationPlan {
  id: string;
  product_id: string;
  finding_id: string | null;
  strategy: string;
  status: string;
  reason: string;
  expected_mechanism: string;
  risk: string;
  fallback: string;
  max_budget_usd: number;
  sample_scope: string[];
  baseline_config: Record<string, unknown>;
  candidate_config: Record<string, unknown>;
  required_evidence: string[];
  plan_version: string;
  config_hash: string;
  blocked_reason: string | null;
  created_at: string;
}

export interface SampleResult {
  baseline_trace_id: string;
  status: string;
  provider?: string | null;
  requested_model?: string | null;
  resolved_model?: string | null;
  output_text?: string | null;
  output_hash?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  cost_source?: string | null;
  latency_ms?: number | null;
  error_category?: string | null;
  error_detail?: string | null;
  [key: string]: unknown;
}

export interface OptimizationExecution {
  id: string;
  candidate_plan_id: string;
  product_id: string;
  status: string;
  execution_key: string;
  attempt: number;
  provider: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  started_at: string | null;
  completed_at: string | null;
  baseline_trace_ids: string[];
  sample_results: SampleResult[];
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  cost_usd: number | null;
  cost_source: string | null;
  pricing_version: string | null;
  latency_ms: number | null;
  provider_request_id: string | null;
  provider_call_count: number;
  candidate_cost_delta_usd: number | null;
  error_category: string | null;
  error_detail: string | null;
  fallback_used: boolean;
  provenance_hash: string;
  created_at: string;
  note: string;
}

export interface EvalGate {
  name: string;
  required: boolean;
  outcome: string;
  observed: unknown;
  threshold: unknown;
  reason: string;
}

export interface Evaluation {
  id: string;
  product_id: string;
  candidate_plan_id: string | null;
  candidate_execution_id: string;
  finding_id: string | null;
  status: string;
  evaluation_version: string;
  sample_count: number;
  protected_sample_count: number;
  baseline_quality: number | null;
  candidate_quality: number | null;
  quality_delta: number | null;
  baseline_cost_usd: number | null;
  candidate_cost_usd: number | null;
  raw_cost_delta_usd: number | null;
  raw_cost_delta_percent: number | null;
  baseline_latency_ms: number | null;
  candidate_latency_ms: number | null;
  evidence_completeness: boolean;
  verification_source: string;
  execution_proven: boolean;
  evidence_version: string;
  gates: EvalGate[];
  rejection_reason: string | null;
  grader_config_hash: string;
  gate_config_hash: string;
  created_at: string;
  completed_at: string | null;
  note: string;
}

export interface ToolEvent {
  name: string;
  status: string;
  summary: string;
}

export interface AgentResponse {
  message: string;
  model: string;
  provider: string;
  tool_events: ToolEvent[];
  openrouter_configured: boolean;
}

export interface ChatLine {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
  model?: string;
}

/** Payload the browser scanner produces locally; only this leaves the machine. */
export interface ScanUpload {
  files_scanned: number;
  skipped_sensitive_paths: number;
  detected_stack: string[];
  ai_calls: Array<Omit<AICall, 'id'>>;
  findings: Array<Omit<Finding, 'id' | 'evidence_status'>>;
}
