import { api } from '@/lib/api';
import type { Plan } from '@/lib/types';

export interface AdminOverview {
  counts: Record<string, number>;
  health: { api: string; cloud_replay: string; stripe: string; database: string; time: string };
  recent_audit: AuditEntry[];
  recent_errors: Array<{ id: string; workspace_id: string; project_id: string; status: string; strategy: string; error: string | null; created_at: string }>;
  recent_runs: Array<{ id: string; workspace_id: string; project_id: string; status: string; events_analyzed: number; opportunities_found: number; created_at: string; error: string | null }>;
}

export interface AuditEntry {
  id: string;
  admin_id: string | null;
  admin_email?: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  last_active_at: string | null;
  suspended_at: string | null;
  plan: string;
  subscription_status: string;
  stripe_managed: boolean;
  credits: { included_usd: number; used_usd: number; period_end: string | null } | null;
  admin_role: string | null;
  workspaces_owned: number;
}

export interface AdminUserDetail {
  profile: AdminUser & { suspended_reason: string | null; timezone: string | null; onboarding: Record<string, unknown> };
  auth: { created_at: string; last_sign_in_at: string | null; providers: string[]; email_confirmed_at: string | null; banned_until: string | null } | null;
  subscription: { plan: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean; stripe_managed: boolean } | null;
  credits: { included_usd: number; used_usd: number; period_start: string; period_end: string } | null;
  memberships: Array<{ role: string; joined_at: string; workspace: { id: string; name: string; slug: string; owner_id: string; plan_override: string | null } | null }>;
  projects: Array<{ id: string; name: string; workspace_id: string; created_at: string; archived_at: string | null }>;
  usage: Array<{ id: string; workspace_id: string; project_id: string | null; operation: string; credits_usd: number; provider: string | null; model: string | null; created_at: string }>;
  ledger: Array<{ id: string; kind: string; delta_usd: number; included_before: number | null; included_after: number | null; used_before: number | null; used_after: number | null; reason: string; actor_id: string | null; created_at: string }>;
  admin_role: { role: string; created_at: string } | null;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan_override: string | null;
  data_retention_days: number;
  created_at: string;
  owner: { id: string; email: string | null; display_name: string | null } | null;
  members: number;
  projects: number;
  plan: string;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  plan_overrides: Record<string, boolean>;
  workspace_overrides: Record<string, boolean>;
  updated_at: string;
}

export interface ModelPricingRow {
  model: string;
  provider: string;
  input_per_million: number;
  output_per_million: number;
  cached_input_per_million: number | null;
  tier: string;
  source: string;
  retrieved_at: string;
  active: boolean;
}

export const admin = {
  overview: () => api<AdminOverview>('/api/admin/overview'),
  users: (q = '') => api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  user: (id: string) => api<AdminUserDetail>(`/api/admin/users/${id}`),
  suspend: (id: string, reason: string) => api(`/api/admin/users/${id}/suspend`, { method: 'POST', body: { reason } }),
  unsuspend: (id: string) => api(`/api/admin/users/${id}/unsuspend`, { method: 'POST' }),
  setPlan: (id: string, plan: string) => api(`/api/admin/users/${id}/plan`, { method: 'POST', body: { plan } }),
  adjustCredits: (id: string, body: { delta_included: number; delta_used: number; reason: string }) => api(`/api/admin/users/${id}/credits`, { method: 'POST', body }),
  workspaces: (q = '') => api<{ workspaces: AdminWorkspace[] }>(`/api/admin/workspaces?q=${encodeURIComponent(q)}`),
  workspace: (id: string) => api<Record<string, unknown>>(`/api/admin/workspaces/${id}`),
  planOverride: (id: string, plan: string | null) => api(`/api/admin/workspaces/${id}/plan-override`, { method: 'POST', body: { plan } }),
  plans: () => api<{ plans: Plan[] }>('/api/admin/plans'),
  savePlan: (id: string, body: Partial<Plan>) => api<{ plan: Plan }>(`/api/admin/plans/${id}`, { method: 'PUT', body }),
  content: () => api<{ content: Array<{ key: string; value: Record<string, unknown>; updated_at: string }> }>('/api/admin/site-content'),
  saveContent: (key: string, value: Record<string, unknown>) => api(`/api/admin/site-content/${key}`, { method: 'PUT', body: { value } }),
  flags: () => api<{ flags: FeatureFlag[] }>('/api/admin/feature-flags'),
  saveFlag: (key: string, body: Partial<FeatureFlag>) => api(`/api/admin/feature-flags/${key}`, { method: 'PUT', body }),
  pricing: () => api<{ pricing: ModelPricingRow[] }>('/api/admin/model-pricing'),
  savePricing: (model: string, body: Partial<ModelPricingRow>) => api(`/api/admin/model-pricing/${encodeURIComponent(model)}`, { method: 'PUT', body }),
  audit: (limit = 100) => api<{ entries: AuditEntry[] }>(`/api/admin/audit-log?limit=${limit}`),
  admins: () => api<{ admins: Array<{ user_id: string; role: string; created_at: string; email: string | null; display_name: string | null }> }>('/api/admin/admins'),
  grantAdmin: (email: string, role: string) => api('/api/admin/admins', { method: 'POST', body: { email, role } }),
  revokeAdmin: (userId: string) => api(`/api/admin/admins/${userId}`, { method: 'DELETE' }),
};
