import { FormEvent, useState } from 'react'
import { ArrowRight, Globe, UserPlus } from 'lucide-react'
import { ZevqoraLogo } from '../brand/Logo'
import { Zev } from '../brand/Zev'
import type { DesktopAuthState } from '../lib/auth'

export function WelcomeScreen({ auth, loading, error, onDirectLogin, onBrowserLogin, onCreateAccount }: { auth: DesktopAuthState | null; loading: boolean; error: string; onDirectLogin: (email: string, password: string) => Promise<void>; onBrowserLogin: () => void; onCreateAccount: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || loading) return
    setSubmitting(true)
    try {
      await onDirectLogin(email, password)
    } catch {
      // surfaced through `error`
    } finally {
      setSubmitting(false)
    }
  }

  const message = error || auth?.error || ''

  return (
    <div className="welcome">
      <div className="titlebar-drag absolute inset-x-0 top-0 z-10 h-10" aria-hidden />
      <section className="welcome-panel">
        <ZevqoraLogo size={26} />
        <div className="mt-10">
          <div className="eyebrow">AI Cost Optimization Engineer</div>
          <h1 className="h1 mt-2">Sign in to ZEVQORA Desktop.</h1>
          <p className="lede">Same account as the website. Your workspace, plan and Zev credit follow you here. Model calls run through your account; no provider key on this device.</p>
        </div>
        <form onSubmit={submit} className="mt-8 grid gap-3">
          <label className="field"><span>Email</span><input className="welcome-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" required /></label>
          <label className="field"><span>Password</span><input className="welcome-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={8} placeholder="Your password" required /></label>
          <button className="btn btn-primary mt-1 h-[42px]" type="submit" disabled={loading || submitting}>
            {loading ? 'Checking account…' : submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={15} />
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <button type="button" className="flex items-center gap-1.5 text-muted hover:text-ink" onClick={onBrowserLogin}><Globe size={13} /> Sign in with the browser (Google / GitHub)</button>
            <button type="button" className="flex items-center gap-1.5 text-blue-700 hover:underline" onClick={onCreateAccount}><UserPlus size={13} /> Create an account</button>
          </div>
          {message && <div className="note note-error">{message}</div>}
        </form>
        <p className="mt-6 text-[11.5px] leading-relaxed text-subtle">Your password goes only to Supabase Auth over HTTPS. Only the returned session is kept, encrypted by the operating system. The app never sees a provider secret.</p>
      </section>

      <section className="welcome-stage">
        <div className="absolute inset-0 dotgrid opacity-60" aria-hidden />
        <div className="relative flex flex-col items-center gap-8">
          <Zev view="three-quarter-front" height={260} alt="Zev" />
          <div className="proof-card glass-strong">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Replay result</span>
              <span className="chip chip-rejected">REJECTED</span>
            </div>
            <div className="text-[28px] font-bold leading-none tracking-tight text-ink">42.01% <span className="text-[14px] font-medium text-muted">cheaper</span></div>
            <div className="grid gap-1.5">
              <div className="proof-row"><span>Quality</span><b>0.87</b></div>
              <div className="proof-row"><span>Required</span><b>0.95</b></div>
              <div className="proof-row"><span>Quality gate</span><b className="text-rejected">FAIL</b></div>
            </div>
            <div className="text-[13px] font-semibold text-rejected">Cheaper isn’t verified.</div>
            <div className="text-[11px] text-subtle">Illustrative example from a replay. Never a production claim.</div>
          </div>
        </div>
      </section>
    </div>
  )
}
