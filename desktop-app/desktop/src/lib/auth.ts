import type { CloudWorkspace } from './types'

export type DesktopAccountState = {
  plan: string
  planName?: string
  planLimits?: Record<string, unknown>
  status: string
  currentPeriodEnd?: string | null
  cancelAtPeriodEnd?: boolean
  hasStripeCustomer?: boolean
  stripeManaged?: boolean
  credit?: {
    includedUsd?: number
    usedUsd?: number
    periodStart?: string | null
    periodEnd?: string | null
  }
}

export type DesktopAuthState = {
  signedIn: boolean
  user?: { id?: string; email?: string | null; displayName?: string; username?: string; createdAt?: string | null }
  account?: DesktopAccountState | null
  workspaces?: CloudWorkspace[]
  isAdmin?: boolean
  flags?: Record<string, boolean>
  platformUrl?: string
  context?: { workspaceId: string | null; projectId: string | null }
  degraded?: boolean
  error?: string
}

export function creditSummary(account: DesktopAccountState | null | undefined) {
  const included = Number(account?.credit?.includedUsd ?? 0)
  const used = Number(account?.credit?.usedUsd ?? 0)
  const remaining = Math.max(0, included - used)
  const ratio = included > 0 ? Math.min(1, used / included) : 0
  return { included, used, remaining, ratio }
}

export function displayIdentity(auth: DesktopAuthState | null | undefined) {
  return auth?.user?.displayName || auth?.user?.username || auth?.user?.email || 'ZEVQORA account'
}
