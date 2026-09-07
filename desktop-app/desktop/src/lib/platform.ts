import type { CloudConnection, CloudProject, PlatformComputeStatus, RuntimeSummary } from './types'

/**
 * Calls to the ZEVQORA account service. The Electron main process owns the
 * session tokens and only forwards allowlisted account/workspace/project
 * routes, so nothing here ever sees a bearer token.
 */
export class PlatformError extends Error {
  status: number
  code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const bridge = window.zevqoraDesktop
  if (!bridge?.platformRequest) throw new PlatformError(0, 'The ZEVQORA account bridge is only available inside the desktop app.', 'NO_BRIDGE')
  const result = await bridge.platformRequest(method, path, body)
  if (result.status >= 200 && result.status < 300) return result.body as T
  const message = (result.body as { error?: string } | null)?.error || (result.status === 0 ? 'ZEVQORA account service is unreachable.' : `Request failed (${result.status}).`)
  const code = (result.body as { code?: string } | null)?.code || null
  throw new PlatformError(result.status, message, code)
}

export const platform = {
  computeStatus: () => call<PlatformComputeStatus>('GET', '/api/platform/status'),
  projects: (workspaceId: string) => call<{ projects: CloudProject[] }>('GET', `/api/workspaces/${workspaceId}/projects`),
  createProject: (workspaceId: string, body: { name: string; description?: string; source_kind?: string; repo_url?: string }) =>
    call<{ project: CloudProject }>('POST', `/api/workspaces/${workspaceId}/projects`, body),
  runtime: (projectId: string, window: '1h' | '24h' | '7d' | '30d' = '24h') => call<RuntimeSummary>('GET', `/api/projects/${projectId}/runtime?window=${window}`),
  createConnection: (projectId: string, body: { kind: string; name: string; capture_samples?: boolean }) =>
    call<{ connection: CloudConnection; token: string | null }>('POST', `/api/projects/${projectId}/connections`, body),
  revokeConnection: (connectionId: string) => call<{ ok: boolean }>('DELETE', `/api/connections/${connectionId}`),
  rotateConnection: (connectionId: string) => call<{ connection: CloudConnection; token: string }>('POST', `/api/connections/${connectionId}/rotate`),
  createWorkspace: (name: string) => call<{ workspace: { id: string; name: string; slug: string } }>('POST', '/api/workspaces', { name }),
}

export function platformErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
