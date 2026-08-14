import { ArrowRight, CheckCircle2, CircleDollarSign, ExternalLink, ShieldCheck } from 'lucide-react'
import { BrandAsset, brandAssets } from './BrandAsset'
import type { DesktopAuthState } from '../lib/auth'

export function WelcomeScreen({
  auth,
  loading,
  error,
  onBrowserLogin,
  onContinue,
}: {
  auth: DesktopAuthState | null
  loading: boolean
  error: string
  onBrowserLogin: () => void
  onContinue: () => void
}) {
  const signedIn = Boolean(auth?.signedIn)
  const included = Number(auth?.account?.credit?.includedUsd || 0)
  const used = Number(auth?.account?.credit?.usedUsd || 0)
  const remaining = Math.max(included - used, 0)
  const plan = String(auth?.account?.plan || 'free').toUpperCase()

  return (
    <div className="welcome-screen welcome-premium-v2">
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
              ? `Signed in as ${auth?.user?.email || 'your ZEVQORA account'}. Your workspace is ready.`
              : 'Sign in securely in your browser. Your password never enters the desktop app.'}
          </p>

          <div className="welcome-browser-auth welcome-browser-auth-v2">
            {signedIn ? (
              <>
                <div className="welcome-account-summary">
                  <span><b>{plan}</b><small>Current plan</small></span>
                  <span><b>${remaining.toFixed(2)}</b><small>Zev credit left</small></span>
                </div>
                <button className="welcome-primary welcome-primary-v2" onClick={onContinue}>
                  Enter workspace <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <button className="welcome-primary welcome-primary-v2" onClick={onBrowserLogin} disabled={loading}>
                {loading ? 'Checking account…' : 'Continue in browser'} <ExternalLink size={14} />
              </button>
            )}
            <div className="welcome-local-note">Browser auth returns through a short-lived ZEVQORA desktop handoff.</div>
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
              {signedIn ? 'Connected. Ready to investigate what is making your AI heavy?' : 'I’ll wait here while your browser handles sign-in.'}
            </div>
            <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="welcome-zev-img welcome-zev-img-v2" />
          </div>
        </section>
      </main>

      <footer className="welcome-trust welcome-trust-v2">
        <div><ShieldCheck size={19} /><span><b>Browser auth</b><small>Credentials stay out of desktop</small></span></div>
        <div><CircleDollarSign size={19} /><span><b>Plan aware</b><small>Subscription + Zev credit</small></span></div>
        <div><CheckCircle2 size={19} /><span><b>One-time handoff</b><small>Short-lived desktop callback</small></span></div>
      </footer>
    </div>
  )
}
