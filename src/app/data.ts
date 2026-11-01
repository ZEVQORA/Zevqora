import { api } from '@/lib/api';
import type { Connection, Member, Invite, Project, UsageSummary, Workspace } from '@/lib/types';

export const app = {
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
};
