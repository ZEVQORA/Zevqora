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
