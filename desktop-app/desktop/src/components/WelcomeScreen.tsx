import { FormEvent, useState } from 'react'
import { ArrowRight, CheckCircle2, CircleDollarSign, KeyRound, ShieldCheck, UserPlus } from 'lucide-react'
import { BrandAsset, brandAssets } from './BrandAsset'
import type { DesktopAuthState } from '../lib/auth'

export function WelcomeScreen({
  auth,
  loading,
  error,
  onDirectLogin,
  onCreateAccount,
}: {
  auth: DesktopAuthState | null
  loading: boolean
  error: string
  onDirectLogin: (email: string, password: string) => Promise<void>
  onCreateAccount: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const signedIn = Boolean(auth?.signedIn)
  const included = Number(auth?.account?.credit?.includedUsd || 0)
  const used = Number(auth?.account?.credit?.usedUsd || 0)
  const remaining = Math.max(included - used, 0)
  const plan = String(auth?.account?.plan || 'free').toUpperCase()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || loading) return
    setSubmitting(true)
    try {
      await onDirectLogin(email, password)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="welcome-screen welcome-premium-v2 welcome-direct-auth">
      <div className="welcome-traffic" aria-hidden="true"><i /><i /><i /></div>

      <div className="welcome-brand welcome-brand-v2">
        <BrandAsset src={brandAssets.mark} alt="ZEVQORA mark" className="welcome-brand-mark" compact />
        <BrandAsset src={brandAssets.wordmark} alt="ZEVQORA" className="welcome-brand-word" />
      </div>

      <div className="welcome-orbit-card orbit-map orbit-map-v2" aria-hidden="true">
        <div className="orbit-title">AI Spend Map</div>
        <div className="orbit-sub">Workspace ready <i /></div>
        <div className="mini-map"><b /><b /><b className="hot" /><span /></div>
      </div>

      <div className="welcome-orbit-card orbit-savings orbit-savings-v2" aria-hidden="true">
        <div className="orbit-title">Verified Savings</div>
        <strong>Proof, not projections.</strong>
        <div className="mini-bars"><i /><i /><i /><i /><i /></div>
      </div>

      <div className="welcome-orbit-card orbit-evidence orbit-evidence-v2" aria-hidden="true">
        <div className="orbit-title">Evidence Inspector</div>
        <div className="mini-evidence danger"><span>High cost driver</span><strong>Needs evidence</strong></div>
        <div className="mini-evidence good"><span>Candidate path</span><strong>Replay + eval</strong></div>
      </div>

      <main className="welcome-panel welcome-panel-v2">
        <section className="welcome-copy welcome-copy-v2">
          <div className="welcome-eyebrow">MAKE AI LIGHTER.</div>
          <h1>{signedIn ? 'Welcome back.' : 'Welcome.'}<br />I’m <span>Zev.</span></h1>
          <p>
            {signedIn
              ? `Signed in as ${auth?.user?.email || 'your ZEVQORA account'}. Opening your workspace…`
              : 'Sign in with the same ZEVQORA account you use on the website. No browser handoff.'}
          </p>

          <div className="welcome-browser-auth welcome-browser-auth-v2">
            {signedIn ? (
              <div className="welcome-account-summary">
                <span><b>{plan}</b><small>Current plan</small></span>
                <span><b>${remaining.toFixed(2)}</b><small>Zev credit left</small></span>
              </div>
            ) : (
              <form className="welcome-direct-form" onSubmit={submit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    minLength={8}
                    required
                  />
                </label>
                <button className="welcome-primary welcome-primary-v2" type="submit" disabled={loading || submitting}>
                  {loading ? 'Checking account…' : submitting ? 'Signing in…' : 'Sign in to ZEVQORA'} <ArrowRight size={14} />
                </button>
                <button className="welcome-create-account" type="button" onClick={onCreateAccount}>
                  <UserPlus size={12} /> Create an account
                </button>
              </form>
            )}
            <div className="welcome-local-note">ZEVQORA Desktop sends your password only to Supabase Auth over HTTPS. Only the returned session tokens are persisted, using OS encryption when available.</div>
            {(error || auth?.error) && <div className="welcome-auth-error">{error || auth?.error}</div>}
          </div>
        </section>

        <section className="welcome-product-preview" aria-hidden="true">
          <div className="welcome-preview-chip"><i /> Living AI Spend Map</div>
          <div className="welcome-workspace-frame">
            <BrandAsset src={brandAssets.workspace} alt="ZEVQORA Living Workspace" className="welcome-workspace-image" />
          </div>
          <div className="welcome-preview-proof">
            <small>VERIFICATION</small>
            <b>Proof before change</b>
            <span>Replay + eval → verified</span>
          </div>
          <div className="welcome-zev welcome-zev-v2">
            <div className="welcome-speech">
              {signedIn ? 'Connected. Opening your workspace.' : 'Sign in here. I’ll keep the browser out of the way.'}
            </div>
            <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="welcome-zev-img welcome-zev-img-v2" />
          </div>
        </section>
      </main>

      <footer className="welcome-trust welcome-trust-v2">
        <div><KeyRound size={19} /><span><b>Direct account login</b><small>No browser handoff</small></span></div>
        <div><CircleDollarSign size={19} /><span><b>Plan aware</b><small>Subscription + Zev credit</small></span></div>
        <div><ShieldCheck size={19} /><span><b>OS encrypted</b><small>Session tokens stay local</small></span></div>
      </footer>
    </div>
  )
}
