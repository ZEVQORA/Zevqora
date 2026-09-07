export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan_override: string | null;
  data_retention_days: number;
  settings: Record<string, unknown>;
  created_at: string;
  role: WorkspaceRole;
  plan: string;
  project_count: number;
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  timezone: string | null;
  notification_prefs: Record<string, boolean>;
  onboarding: Record<string, unknown>;
  created_at?: string;
}

export interface Account {
  plan: string;
  planName: string;
  planLimits: PlanLimits;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  stripeManaged: boolean;
  credit: { includedUsd: number; usedUsd: number; periodStart: string | null; periodEnd: string | null };
}

export interface PlanLimits {
  projects?: number | null;
  credits_usd?: number;
  replay_samples?: number;
  team_members?: number | null;
  telemetry_retention_days?: number;
  github?: boolean;
  pdf_export?: boolean;
}

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  description: string;
  monthly_price_cents: number;
  annual_discount_pct: number;
  features: string[];
  limits: PlanLimits;
  visible: boolean;
  popular: boolean;
  is_default: boolean;
  contact_sales: boolean;
  cta_label: string;
  cta_href: string;
  sort_order: number;
  stripe_monthly_price_id?: string | null;
  stripe_annual_price_id?: string | null;
}

export interface Me {
  user: { id: string; email: string | null; created_at: string; providers: string[]; last_sign_in_at: string | null };
  profile: Profile;
  isAdmin: boolean;
  adminRole: string | null;
  account: Account;
  workspaces: Workspace[];
  flags: Record<string, boolean>;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  source_kind: string;
  repo_url: string | null;
  settings: { quality_gate?: number; max_latency_regression_pct?: number };
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Connection {
  id: string;
  workspace_id: string;
  project_id: string | null;
  kind: 'server_telemetry' | 'runtime_api' | 'repository' | 'github';
  name: string;
  status: 'active' | 'revoked' | 'pending';
  token_prefix: string | null;
  token_last4: string | null;
  scopes: string[];
  permissions: { reads?: string[]; never?: string[]; samples?: string };
  metadata: { capture_samples?: boolean; instructions?: string; sdk?: string };
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface Opportunity {
  id: string;
  workspace_id: string;
  project_id: string;
  analysis_run_id: string | null;
  origin: string;
  category: string;
  title: string;
  issue: string;
  root_cause: string;
  source_ref: string | null;
  current_provider: string | null;
  current_model: string | null;
  cost_driver: string | null;
  candidate_strategy: string;
  candidate_config: Record<string, unknown>;
  baseline_cost_usd: number | null;
  estimated_savings_usd: number | null;
  estimated_savings_pct: number | null;
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  evidence_completeness: 'complete' | 'partial' | 'missing';
  evidence: Record<string, unknown>;
  status: 'open' | 'testing' | 'verified' | 'rejected' | 'dismissed' | 'needs_evidence';
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface Gate {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Experiment {
  id: string;
  workspace_id: string;
  project_id: string;
  opportunity_id: string | null;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'needs_evidence';
  strategy: string;
  baseline: Record<string, unknown> & { model?: string; provider?: string; cost_usd?: number | null; latency_p50_ms?: number | null; quality?: number | null; samples?: number };
  candidate: Record<string, unknown> & { model?: string; cost_usd?: number | null; latency_p50_ms?: number | null; quality?: number | null; samples?: number; strategy?: string };
  quality_gate: number;
  quality_score: number | null;
  gates: Gate[];
  sample_size: number;
  verified_savings_usd: number | null;
  verified_savings_pct: number | null;
  projected_monthly_savings_usd: number | null;
  provider_cost_usd: number;
  credits_usd: number;
  error: string | null;
  evidence: Record<string, unknown> & { limitations?: string[]; graders?: string[]; provider?: string; baseline_model?: string; candidate_model?: string; sample_ids?: string[]; gate_version?: string; grader_version?: string; rejection_reason?: string | null };
  evidence_hash: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface EvaluationCase {
  id: string;
  experiment_id: string;
  case_index: number;
  telemetry_event_id: string | null;
  grader: string;
  score: number | null;
  passed: boolean;
  baseline_model: string | null;
  candidate_model: string | null;
  baseline_output_hash: string | null;
  candidate_output_hash: string | null;
  baseline_cost_usd: number | null;
  candidate_cost_usd: number | null;
  baseline_latency_ms: number | null;
  candidate_latency_ms: number | null;
  details: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

export interface AnalysisRun {
  id: string;
  workspace_id: string;
  project_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  trigger: string;
  window_start: string | null;
  window_end: string | null;
  events_analyzed: number;
  opportunities_found: number;
  summary: Record<string, unknown>;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TelemetryEvent {
  id: string;
  trace_id: string | null;
  span_id: string | null;
  occurred_at: string;
  provider: string;
  model: string;
  operation: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  cost_source: string;
  attempt: number | null;
  error_class: string | null;
  has_sample: boolean;
}

export interface Overview {
  window_days: number;
  plan: { planId: string; plan: Plan };
  projects: Array<{ id: string; name: string; slug: string; source_kind: string; created_at: string }>;
  metrics: {
    verified_savings_usd: number;
    projected_monthly_savings_usd: number;
    potential_savings_usd: number;
    ai_spend_usd: number;
    cost_coverage: number;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    errors: number;
    quality_pass_rate: number | null;
    experiments_total: number;
    experiments_passed: number;
    experiments_failed: number;
    opportunities_open: number;
    connected_projects: number;
  };
  providers: Array<{ provider: string; requests: number; cost_usd: number; input_tokens: number; output_tokens: number; latency_p50_ms: number | null }>;
  models: Array<{ model: string; provider: string; requests: number; cost_usd: number; input_tokens: number; output_tokens: number; latency_p50_ms: number | null; samples: number }>;
  daily: Array<{ day: string; requests: number; errors: number; cost_usd: number }>;
  runtime: { status: 'live' | 'idle' | 'stale' | 'waiting'; last_seen: string | null; requests_5m: number; errors_5m: number; connections: Array<{ id: string; project_id: string; kind: string; name: string; status: string; last_seen_at: string | null; live: string }> };
  recent_experiments: Experiment[];
  top_opportunities: Opportunity[];
}

export interface RuntimeSummary {
  project: { id: string; name: string; slug: string; settings: Project['settings'] };
  window_hours: number;
  totals: { requests: number; errors: number; cost_usd: number; input_tokens: number; output_tokens: number; samples: number; last_seen: string | null; latency_p50_ms: number | null; latency_p95_ms: number | null; requests_per_min_5m: number; errors_5m: number };
  providers: Array<{ provider: string; requests: number; cost_usd: number; errors: number }>;
  models: Array<{ model: string; provider: string; requests: number; errors: number; cost_usd: number; input_tokens: number; output_tokens: number; latency_p50_ms: number | null; latency_p95_ms: number | null; samples: number }>;
  daily: Array<{ day: string; requests: number; errors: number; cost_usd: number }>;
  connections: Connection[];
  recent: TelemetryEvent[];
  open_opportunities: number;
}

export interface Member {
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  last_active_at: string | null;
  email: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  status: string;
}

export interface Invite {
  id: string;
  email: string;
  role: WorkspaceRole;
  expires_at: string;
  created_at: string;
}

export interface UsageSummary {
  plan: { id: string; name: string; limits: PlanLimits; override: string | null };
  subscription: { status: string; current_period_end: string | null; cancel_at_period_end: boolean; stripe_managed: boolean } | null;
  credits: { included_usd: number; used_usd: number; remaining_usd: number; period_start: string | null; period_end: string | null };
  breakdown: { by_project: Record<string, number>; by_operation: Record<string, number>; by_provider: Record<string, number> };
  recent: Array<{ id: string; project_id: string | null; project_name: string | null; user_id: string | null; operation: string; credits_usd: number; provider: string | null; model: string | null; created_at: string; metadata: Record<string, unknown> }>;
  upgrade_options: Array<{ id: string; name: string; monthly_price_cents: number }>;
  billing_owner_id: string;
  is_billing_owner: boolean;
}

export interface SiteContent {
  hero?: { announcement: string | null; announcement_href?: string | null; headline: string; subheadline: string; supporting: string; primary_cta: { label: string; href: string }; secondary_cta: { label: string; href: string }; trust_line: string };
  proof?: { kind: string; cases: number; rejected: { cost_reduction: string; quality: string; quality_floor: string; reason: string }; verified: { cost_reduction: string; quality: string; quality_floor: string; ci95?: string }; qualifier: string };
  status?: { banner: string | null; public_status: string };
  contact?: { email: string };
}
