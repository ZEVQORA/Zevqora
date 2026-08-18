export type DesktopAccountState = {
  plan: 'free' | 'pro' | 'team' | 'enterprise' | string
  status: string
  currentPeriodEnd?: string | null
  cancelAtPeriodEnd?: boolean
  hasStripeCustomer?: boolean
  credit?: {
    includedUsd?: number
    usedUsd?: number
    periodStart?: string | null
    periodEnd?: string | null
  }
}

export type DesktopAuthState = {
  signedIn: boolean
  user?: { id?: string; email?: string | null; displayName?: string; username?: string }
  account?: DesktopAccountState
  error?: string
}
