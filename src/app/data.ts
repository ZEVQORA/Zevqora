import { getSupabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { AnalysisRun, Connection, EvaluationCase, Experiment, Member, Invite, Opportunity, Overview, Project, RuntimeSummary, UsageSummary, Workspace } from '@/lib/types';

async function sb() {
  const client = await getSupabase();
  if (!client) throw new Error('Not connected.');
  return client;
}

export async function listProjects(workspaceId: string) {
  const { data, error } = await (await sb()).from('projects').select('*').eq('workspace_id', workspaceId).is('archived_at', null).order('created_at');
  if (error) throw error;
  return (data || []) as Project[];
}

export async function listOpportunities(workspaceId: string, projectId?: string | null) {
  let q = (await sb()).from('opportunities').select('*').eq('workspace_id', workspaceId).order('estimated_savings_usd', { ascending: false, nullsFirst: false });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Opportunity[];
}

export async function getOpportunity(id: string) {
  const { data, error } = await (await sb()).from('opportunities').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data || null) as Opportunity | null;
}

export async function listExperiments(workspaceId: string, projectId?: string | null, limit = 100) {
  let q = (await sb()).from('experiments').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(limit);
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Experiment[];
}

export async function getExperiment(id: string) {
  const client = await sb();
  const [{ data: experiment, error }, { data: cases }] = await Promise.all([client.from('experiments').select('*').eq('id', id).maybeSingle(), client.from('evaluation_cases').select('*').eq('experiment_id', id).order('case_index')]);
  if (error) throw error;
  return { experiment: (experiment || null) as Experiment | null, cases: (cases || []) as EvaluationCase[] };
}

export async function listRuns(workspaceId: string, projectId?: string | null) {
  let q = (await sb()).from('analysis_runs').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(50);
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as AnalysisRun[];
}

export async function listConnections(workspaceId: string) {
  const { data, error } = await (await sb()).from('connections').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Connection[];
}

export const app = {
  overview: (workspaceId: string, days = 30) => api<Overview>(`/api/workspaces/${workspaceId}/overview?days=${days}`),
  runtime: (projectId: string, window = '24h') => api<RuntimeSummary>(`/api/projects/${projectId}/runtime?window=${window}`),
  analyze: (projectId: string) => api<{ run: AnalysisRun; opportunities: Opportunity[]; events_analyzed: number }>(`/api/projects/${projectId}/analyze`, { method: 'POST' }),
  runExperiment: (opportunityId: string, body: { sample_size?: number; quality_gate?: number } = {}) => api<{ experiment: Experiment; cases: EvaluationCase[] }>(`/api/opportunities/${opportunityId}/experiments`, { method: 'POST', body }),
  setOpportunityStatus: (id: string, status: 'open' | 'dismissed') => api<{ opportunity: Opportunity }>(`/api/opportunities/${id}`, { method: 'PATCH', body: { status } }),
  createWorkspace: (name: string) => api<{ workspace: Workspace }>('/api/workspaces', { method: 'POST', body: { name } }),
  updateWorkspace: (id: string, body: Record<string, unknown>) => api<{ workspace: Workspace }>(`/api/workspaces/${id}`, { method: 'PATCH', body }),
  createProject: (workspaceId: string, body: { name: string; description?: string; source_kind?: string; repo_url?: string }) => api<{ project: Project }>(`/api/workspaces/${workspaceId}/projects`, { method: 'POST', body }),
  updateProject: (id: string, body: Record<string, unknown>) => api<{ project: Project }>(`/api/projects/${id}`, { method: 'PATCH', body }),
  archiveProject: (id: string) => api(`/api/projects/${id}`, { method: 'DELETE' }),
  createConnection: (projectId: string, body: { kind: string; name: string; capture_samples?: boolean }) => api<{ connection: Connection; token: string | null }>(`/api/projects/${projectId}/connections`, { method: 'POST', body }),
  updateConnection: (id: string, body: { name?: string; capture_samples?: boolean }) => api<{ connection: Connection }>(`/api/connections/${id}`, { method: 'PATCH', body }),
  revokeConnection: (id: string) => api(`/api/connections/${id}`, { method: 'DELETE' }),
  rotateConnection: (id: string) => api<{ connection: Connection; token: string }>(`/api/connections/${id}/rotate`, { method: 'POST' }),
  members: (workspaceId: string) => api<{ role: string; members: Member[]; invites: Invite[]; seat_limit: number | null }>(`/api/workspaces/${workspaceId}/members`),
  invite: (workspaceId: string, body: { email: string; role: string }) => api<{ added: boolean; invite?: Invite; invite_url?: string; email?: string }>(`/api/workspaces/${workspaceId}/invites`, { method: 'POST', body }),
  cancelInvite: (workspaceId: string, inviteId: string) => api(`/api/workspaces/${workspaceId}/invites/${inviteId}`, { method: 'DELETE' }),
  setRole: (workspaceId: string, userId: string, role: string) => api(`/api/workspaces/${workspaceId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (workspaceId: string, userId: string) => api(`/api/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
  usage: (workspaceId: string) => api<UsageSummary>(`/api/workspaces/${workspaceId}/usage`),
  updateMe: (body: Record<string, unknown>) => api('/api/me', { method: 'PATCH', body }),
  checkout: (plan: string, interval: 'monthly' | 'annual') => api<{ url: string; portal?: boolean }>('/api/stripe/create-checkout', { method: 'POST', body: { plan, interval } }),
  portal: () => api<{ url: string }>('/api/stripe/create-portal', { method: 'POST' }),
  report: (experimentId: string) => api<Record<string, unknown>>(`/api/experiments/${experimentId}/report`),
};
