import { api } from '@/lib/api';
import type { AuditEntry, FeatureFlag } from './data';

/** vNext Part 3 admin control plane — see api/_lib/handlers/admin-v3.js. */
export interface RangeMeta {
  source: string;
  range: { preset: string; from: string; to: string };
  generated_at: string;
  last_event_at?: string | null;
  collecting?: boolean;
  [k: string]: unknown;
}

export interface SiteSummary {
  meta: RangeMeta & { secret_configured: boolean; visitors_definition: string; geo_note: string };
  totals: { pageviews: number; visitor_days: number; sessions: number; cta_clicks: number; signups_started: number; evaluations_submitted: number; last_event_at: string | null };
  daily: Array<{ day: string; pageviews: number; visitors: number; sessions: number; cta_clicks: number; evaluations: number }>;
  pages: Array<{ path: string; pageviews: number; sessions: number }>;
  landing_pages: Array<{ path: string; sessions: number; converted: number }>;
  referrers: Array<{ referrer: string; sessions: number }>;
  campaigns: Array<{ source: string; medium: string; campaign: string; sessions: number; converted: number }>;
  countries: Array<{ country: string; sessions: number }>;
  regions: Array<{ country: string; region: string; sessions: number }>;
  devices: Array<{ device: string; sessions: number }>;
  browsers: Array<{ browser: string; sessions: number }>;
  ctas: Array<{ cta: string; clicks: number; sessions: number }>;
  funnel: { sessions: number; cta: number; signup_started: number; evaluation_submitted: number };
  signals: { bot_events: number; heavy_sessions: number; max_events_per_session: number };
  recent: Array<{ occurred_at: string; event: string; path: string; cta: string | null; country: string | null; device: string; referrer: string | null }>;
}

export interface ProductSummary {
  meta: RangeMeta & { funnel_definition: string; backfill_note: string };
  funnel_steps: Array<{ key: string; label: string }>;
  funnel: Record<string, number | null>;
  counts: Record<string, number>;
  daily: Array<{ day: string; events: number; active_users: number; active_workspaces: number }>;
  active: { users: number; workspaces: number };
  retention: Array<{ week: string; size: number; retained: number[] | null }>;
  time_to_first: { baseline_hours_median: number | null; baseline_users: number } | null;
  time_to_verified: { hours_median: number | null; users: number } | null;
}

export interface OptimizationSummary {
  meta: RangeMeta & { truncated: boolean };
  searches: { total: number; by_status: Record<string, number>; workspaces: number; per_workspace: number | null };
  plans: { total: number; by_verdict: Record<string, number>; by_status: Record<string, number>; frontier: number };
  decisions: { total: number; by_policy: Record<string, number>; selected: number };
  acceptance_rate: number | null;
  evaluations: { total: number; by_status: Record<string, number>; rejection_reasons: Array<{ reason: string; n: number }> };
  replay_spend_usd: number | null;
  replay_spend_note: string;
  time_to_first: { baseline: ProductSummary['time_to_first']; verified_decision: ProductSummary['time_to_verified'] };
  realized_savings: { status: 'NOT_YET_MEASURED'; reason: string };
}

export interface SecurityEvent {
  id: string;
  occurred_at: string;
  kind: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  method: string | null;
  route: string | null;
  status: number | null;
  code: string | null;
  actor_id: string | null;
  workspace_id: string | null;
  ip_prefix: string | null;
  metadata: Record<string, unknown>;
}

export interface CommandCenterAdmin {
  generated_at: string;
  window: { from: string; to: string; label: string };
  counts: Record<string, number | null>;
  website: { collecting: boolean; pageviews?: number; visitor_days?: number; sessions?: number; cta_clicks?: number; signups_started?: number; evaluations_submitted?: number; funnel?: SiteSummary['funnel'] | null };
  product: { collecting: boolean; counts: Record<string, number>; funnel: Record<string, number> | null };
  recent_signups: Array<{ id: string; email: string | null; display_name: string | null; created_at: string }>;
  recent_errors: Array<{ id: string; occurred_at: string; route: string | null; status: number | null; code: string | null; method: string | null }>;
  security_7d: Record<string, number>;
  system: Record<string, string>;
}

export interface EvaluationRequest {
  id: string;
  created_at: string;
  name: string;
  email: string;
  company: string;
  role_title: string | null;
  workload: string;
  ai_spend_band: string;
  source: Record<string, string | null>;
  status: 'new' | 'contacted' | 'qualified' | 'closed';
  updated_at: string;
}

export interface CmsField {
  type: 'text' | 'longtext' | 'href' | 'email' | 'int' | 'enum' | 'cta' | 'object' | 'items' | 'strings';
  max?: number;
  min?: number;
  required?: boolean;
  label?: string;
  values?: string[];
  fields?: Record<string, CmsField>;
  itemMax?: number;
}

export interface CmsRevision {
  id: string;
  key: string;
  version: number;
  status: 'draft' | 'published' | 'superseded' | 'discarded';
  value?: Record<string, unknown>;
  note: string | null;
  source_revision_id: string | null;
  created_by: string | null;
  created_at: string;
  published_by: string | null;
  published_at: string | null;
}

export interface CmsKeyState {
  key: string;
  live: { key: string; value: Record<string, unknown>; updated_at: string } | null;
  live_revision: CmsRevision | null;
  draft: CmsRevision | null;
  history: CmsRevision[];
}

export type FlagTargeting = 'off' | 'internal' | 'selected' | 'limited' | 'on';

export interface OptimizationAdmin {
  runs: number | null;
  zevir: { graphs: number | null; ingest_runs: Array<{ id: string; workspace: string | null; source_kind: string; status: string; created_at: string }>; ingest_error: string | null };
  searches: Array<{ id: string; workspace: string | null; status: string; created_at: string; completed_at: string | null; plans: number; verified: number; rejected: number; frontier: number; selected: number }>;
}

export const adminV3 = {
  commandCenter: () => api<CommandCenterAdmin>('/api/admin/command-center'),
  systemHealth: () => api<Record<string, string | number>>('/api/admin/system-health'),
  website: (q: string) => api<SiteSummary>(`/api/admin/analytics/website?${q}`),
  product: (q: string) => api<ProductSummary>(`/api/admin/analytics/product?${q}`),
  optimization: (q: string) => api<OptimizationSummary>(`/api/admin/analytics/optimization?${q}`),
  security: (q: string, kind?: string) => api<{ meta: RangeMeta & { retention_days: number; ip_note: string }; by_kind: Record<string, number>; events: SecurityEvent[]; admin_changes: AuditEntry[]; suspended_accounts: number | null }>(`/api/admin/security?${q}${kind ? `&kind=${kind}` : ''}`),
  evaluationRequests: (status?: string) => api<{ requests: EvaluationRequest[] }>(`/api/admin/evaluation-requests${status ? `?status=${status}` : ''}`),
  setEvaluationStatus: (id: string, status: EvaluationRequest['status']) => api(`/api/admin/evaluation-requests/${id}`, { method: 'PATCH', body: { status } }),
  cms: () => api<{ schemas: Array<{ key: string; label: string; fields: Record<string, CmsField> }>; keys: CmsKeyState[] }>('/api/admin/cms'),
  revision: (id: string) => api<{ revision: CmsRevision }>(`/api/admin/cms/revisions/${id}`),
  saveDraft: (key: string, value: Record<string, unknown>, note?: string) => api<{ draft: CmsRevision }>(`/api/admin/cms/${key}/draft`, { method: 'PUT', body: { value, note } }),
  discardDraft: (key: string) => api(`/api/admin/cms/${key}/draft`, { method: 'DELETE' }),
  publish: (key: string, revisionId: string) => api<{ published: { key: string; version: number } }>(`/api/admin/cms/${key}/publish`, { method: 'POST', body: { revision_id: revisionId } }),
  rollback: (key: string, revisionId: string) => api<{ published: { key: string; version: number; restored_version: number } }>(`/api/admin/cms/${key}/rollback`, { method: 'POST', body: { revision_id: revisionId } }),
  flagReach: () => api<{ reach: Record<string, { workspaces_on: number; workspaces_total: number; internal_workspaces: number }> }>('/api/admin/flags/reach'),
  setTargeting: (key: string, targeting: FlagTargeting | null, rolloutPercent?: number) => api<{ flag: FeatureFlag }>(`/api/admin/feature-flags/${key}`, { method: 'PUT', body: { targeting, ...(targeting === 'limited' ? { rollout_percent: rolloutPercent } : {}) } }),
  optimizationAdmin: () => api<OptimizationAdmin>('/api/admin/optimization'),
};
