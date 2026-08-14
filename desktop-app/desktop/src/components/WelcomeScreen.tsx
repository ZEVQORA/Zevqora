import { ArrowRight, CheckCircle2, CircleDollarSign, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react'
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
    <div className="welcome-screen">
      <div className="welcome-traffic" aria-hidden="true"><i /><i /><i /></div>
      <div className="welcome-brand">
        <BrandAsset src={brandAssets.mark} alt="ZEVQORA mark" className="h-11 w-11 object-contain" />
        <BrandAsset src={brandAssets.wordmark} alt="ZEVQORA" className="h-9 w-[220px] object-contain object-left" />
      </div>

      <div className="welcome-orbit-card orbit-map">
        <div className="orbit-title">AI Spend Map</div>
        <div className="orbit-sub">Workspace ready <i /></div>
        <div className="mini-map"><b /><b /><b className="hot" /><span /></div>
      </div>
      <div className="welcome-orbit-card orbit-savings">
        <div className="orbit-title">Verified Savings</div>
        <strong>Proof, not projections.</strong>
        <div className="mini-bars"><i /><i /><i /><i /><i /></div>
      </div>
      <div className="welcome-orbit-card orbit-evidence">
        <div className="orbit-title">Evidence Inspector</div>
        <div className="mini-evidence danger"><span>High cost driver</span><strong>Needs evidence</strong></div>
        <div className="mini-evidence good"><span>Candidate path</span><strong>Replay + eval</strong></div>
      </div>

      <main className="welcome-panel">
        <div className="welcome-copy">
          <div className="welcome-eyebrow">MAKE AI LIGHTER.</div>
          <h1>{signedIn ? 'Welcome back.' : 'Welcome.'}<br />I’m <span>Zev.</span></h1>
          <p>
            {signedIn
              ? `Signed in as ${auth?.user?.email || 'your ZEVQORA account'}. Your workspace is ready.`
              : 'Sign in securely in your browser. Your password never enters the desktop app.'}
          </p>

          <div className="welcome-browser-auth">
            {signedIn ? (
              <>
                <div className="welcome-account-summary">
                  <span><b>{plan}</b><small>Current plan</small></span>
                  <span><b>${remaining.toFixed(2)}</b><small>Zev credit left</small></span>
                </div>
                <button className="welcome-primary" onClick={onContinue}>
                  Enter workspace <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <button className="welcome-primary" onClick={onBrowserLogin} disabled={loading}>
                {loading ? 'Checking account…' : 'Continue in browser'} <ExternalLink size={14} />
              </button>
            )}
            <div className="welcome-local-note">
              Browser authentication returns through the secure ZEVQORA desktop link.
            </div>
            {(error || auth?.error) && <div className="welcome-auth-error">{error || auth?.error}</div>}
          </div>
        </div>
        <div className="welcome-zev">
          <div className="welcome-speech">
            {signedIn ? 'You’re connected. Ready to find what is making your AI heavy?' : 'I’ll wait here while your browser handles sign-in.'}
          </div>
          <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="welcome-zev-img" />
          <div className="welcome-paws">{Array.from({ length: 7 }).map((_, index) => <span key={index}>•</span>)}</div>
        </div>
      </main>

      <footer className="welcome-trust">
        <div><ShieldCheck size={20} /><span><b>Browser auth</b><small>Credentials stay out of desktop</small></span></div>
        <div><CircleDollarSign size={20} /><span><b>Plan aware</b><small>Subscription + Zev credit</small></span></div>
        <div><CheckCircle2 size={20} /><span><b>One-time handoff</b><small>Short-lived desktop callback</small></span></div>
        <div><Sparkles size={20} /><span><b>White workspace</b><small>Same ZEVQORA product language</small></span></div>
      </footer>
    </div>
  )
}
