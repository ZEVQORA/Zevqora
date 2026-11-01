import type { WorkspaceRole } from '@/lib/types';

/**
 * Display mirror of the minimum workspace role each EXISTING endpoint enforces
 * (api/_lib/auth.js ROLE_RANK + requireWorkspaceRole in the handlers). The
 * server is the authority: this table only explains a disabled control, and
 * tests/unified-integration.test.ts fails if it drifts from the handler source.
 *
 * Presentation mode (CEO / CTO / Developer) is deliberately absent here.
 */
export const ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export interface ServerAction {
  key: string;
  label: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  handler: string;
  minRole: WorkspaceRole;
}

export const SERVER_ACTIONS: readonly ServerAction[] = [
  { key: 'read_command_center', label: 'Read the Command Center', method: 'GET', path: '/api/workspaces/:id/command-center', handler: 'experience.js', minRole: 'viewer' },
  { key: 'read_graphs', label: 'Read ZevIR graphs and provenance', method: 'GET', path: '/api/zevir/graphs', handler: 'zevir.js', minRole: 'viewer' },
  { key: 'read_report', label: 'Read optimization reports', method: 'GET', path: '/api/optimize/runs/:runId/report', handler: 'optimize.js', minRole: 'viewer' },
  { key: 'ingest_evidence', label: 'Ingest OTel / OpenInference evidence', method: 'POST', path: '/api/zevir/ingest', handler: 'zevir.js', minRole: 'member' },
  { key: 'start_run', label: 'Start an optimization run', method: 'POST', path: '/api/optimize/products/:id/runs', handler: 'optimize.js', minRole: 'member' },
  { key: 'replay_candidate', label: 'Replay a candidate (bounded, spends credit)', method: 'POST', path: '/api/optimize/runs/:runId/candidates/:planId/replay', handler: 'optimize.js', minRole: 'member' },
  { key: 'plan_search', label: 'Run a plan search', method: 'POST', path: '/api/optimize/runs/:runId/searches', handler: 'optimize-search.js', minRole: 'member' },
  { key: 'review_decision', label: 'Record a human review decision', method: 'POST', path: '/api/optimize/searches/:id/decision', handler: 'optimize-search.js', minRole: 'member' },
  { key: 'create_contract', label: 'Create an evaluation contract', method: 'POST', path: '/api/optimize/products/:id/contracts', handler: 'optimize.js', minRole: 'admin' },
  { key: 'freeze_contract', label: 'Freeze evaluation gates', method: 'POST', path: '/api/optimize/products/:id/contracts/:cid/freeze', handler: 'optimize.js', minRole: 'admin' },
  { key: 'invite_member', label: 'Invite members', method: 'POST', path: '/api/workspaces/:id/invites', handler: 'workspaces.js', minRole: 'admin' },
  { key: 'change_role', label: 'Change a member’s role', method: 'PATCH', path: '/api/workspaces/:id/members/:userId', handler: 'workspaces.js', minRole: 'admin' },
];

export function roleAllows(role: WorkspaceRole | null | undefined, minRole: WorkspaceRole): boolean {
  if (!role || !(role in ROLE_RANK)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
