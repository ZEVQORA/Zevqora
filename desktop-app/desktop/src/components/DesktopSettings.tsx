import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Check, CreditCard, ExternalLink, KeyRound, Save, ShieldCheck, UserRound } from 'lucide-react'
import { API_BASE } from '../lib/api'
import type { DesktopAuthState } from '../lib/auth'
import type { Health } from '../lib/types'

const PROFILE_NAME_KEY = 'zevqora.profile.displayName'
const PROFILE_USERNAME_KEY = 'zevqora.profile.username'

export function desktopProfile() {
  return {
    displayName: localStorage.getItem(PROFILE_NAME_KEY) || '',
    username: localStorage.getItem(PROFILE_USERNAME_KEY) || '',
  }
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="desktop-settings-card">
      <div className="desktop-settings-card-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="desktop-settings-card-body">{children}</div>
    </section>
  )
}

export function DesktopSettings({
  health,
  model,
  onModel,
  auth,
}: {
  health: Health | null
  model: string
  onModel: (value: string) => void
  auth: DesktopAuthState | null
}) {
  const initialProfile = useMemo(() => desktopProfile(), [])
  const [displayName, setDisplayName] = useState(auth?.user?.displayName || initialProfile.displayName)
  const [username, setUsername] = useState(auth?.user?.username || initialProfile.username)
  const [profileMessage, setProfileMessage] = useState('')
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refreshProvider = async () => {
    try {
      const next = await window.zevqoraDesktop?.getProviderConfig()
      if (next) setProvider(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => { void refreshProvider() }, [])

  useEffect(() => {
    if (auth?.user?.displayName != null) setDisplayName(auth.user.displayName)
    if (auth?.user?.username != null) setUsername(auth.user.username)
  }, [auth?.user?.displayName, auth?.user?.username])

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = displayName.trim().slice(0, 60)
    const cleanUsername = username.trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32)
    setProfileMessage('Saving…')
    try {
      if (window.zevqoraDesktop?.updateProfile) {
        const next = await window.zevqoraDesktop.updateProfile(cleanName, cleanUsername)
        setDisplayName(next.user?.displayName || cleanName)
        setUsername(next.user?.username || cleanUsername)
      } else {
        localStorage.setItem(PROFILE_NAME_KEY, cleanName)
        localStorage.setItem(PROFILE_USERNAME_KEY, cleanUsername)
        setDisplayName(cleanName)
        setUsername(cleanUsername)
      }
      localStorage.setItem(PROFILE_NAME_KEY, cleanName)
      localStorage.setItem(PROFILE_USERNAME_KEY, cleanUsername)
      setProfileMessage('Saved to your ZEVQORA account.')
      window.dispatchEvent(new CustomEvent('zevqora:profile-changed'))
      window.setTimeout(() => setProfileMessage(''), 2200)
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const saveKey = async () => {
    if (!window.zevqoraDesktop) return setMessage('Secure provider settings are available in the installed desktop app.')
    setBusy(true)
    setMessage('')
    try {
      const next = await window.zevqoraDesktop.saveOpenRouterKey(key)
      setProvider(next)
      setKey('')
      setMessage('OpenRouter key encrypted locally. The packaged agent backend is restarting with the new key.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    if (!window.zevqoraDesktop) return
    setBusy(true)
    setMessage('')
    try {
      const next = await window.zevqoraDesktop.clearOpenRouterKey()
      setProvider(next)
      setKey('')
      setMessage('Stored OpenRouter key removed from this device.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const configured = provider?.openrouterConfigured ?? health?.openrouter_configured ?? false
  const plan = String(auth?.account?.plan || 'free').toUpperCase()
  const included = Number(auth?.account?.credit?.includedUsd || 0)
  const used = Number(auth?.account?.credit?.usedUsd || 0)
  const remaining = Math.max(included - used, 0)
  const email = auth?.user?.email || 'Signed-in account'

  return (
    <div className="desktop-settings-scroll">
      <div className="desktop-settings-inner">
        <div className="desktop-settings-title">
          <div className="eyebrow-premium">SETTINGS</div>
          <h1>Account, Zev and this device.</h1>
          <p>Keep the engineering workspace calm. Account identity and plan are separate from device-local provider credentials.</p>
        </div>

        <Section title="Profile" description="Customize the account identity shown across ZEVQORA web and desktop.">
          <form onSubmit={saveProfile} className="desktop-profile-grid">
            <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" maxLength={60} /></label>
            <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_handle" maxLength={32} /></label>
            <div className="desktop-settings-inline-note"><UserRound size={13} /> Sign-in account: {email}</div>
            <button className="desktop-settings-primary" type="submit"><Save size={13} /> Save profile</button>
            {profileMessage && <span className="desktop-settings-success"><Check size={12} /> {profileMessage}</span>}
          </form>
        </Section>

        <Section title="Plan & Zev credit" description="Your browser account owns subscription and included Zev compute. The desktop reflects that state without storing billing secrets.">
          <div className="desktop-account-grid">
            <div><span>Plan</span><strong>{plan}</strong></div>
            <div><span>Remaining credit</span><strong>${remaining.toFixed(2)}</strong></div>
            <div><span>Used this period</span><strong>${used.toFixed(2)}</strong></div>
          </div>
          <div className="desktop-settings-actions">
            <button onClick={() => void window.zevqoraDesktop?.openAccount()} className="desktop-settings-secondary"><CreditCard size={13} /> Account & billing <ExternalLink size={11} /></button>
            <button onClick={() => void window.zevqoraDesktop?.openPricing()} className="desktop-settings-secondary">View plans <ExternalLink size={11} /></button>
          </div>
        </Section>

        <Section title="Zev · OpenRouter" description="OpenRouter BYOK is encrypted with the operating system secure storage and remains device-local.">
          <div className="desktop-provider-head">
            <div className="desktop-provider-state"><span className={configured ? 'is-ready' : ''} /><b>{configured ? 'Connected' : 'Not connected'}</b></div>
            <div className="desktop-settings-inline-note"><KeyRound size={13} /> {provider?.source === 'encrypted-local' ? 'OS-encrypted local secret' : provider?.source === 'environment' ? 'Backend environment' : 'No key stored'}</div>
          </div>
          <div className="desktop-provider-grid">
            <label>OpenRouter API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" /></label>
            <label>Model ID<input value={model} onChange={(e) => onModel(e.target.value)} placeholder="openrouter/auto" /></label>
          </div>
          <div className="desktop-settings-actions">
            <button disabled={busy || !key.trim()} onClick={() => void saveKey()} className="desktop-settings-primary">{busy ? 'Saving…' : 'Save securely'}</button>
            <button disabled={busy || !configured} onClick={() => void clearKey()} className="desktop-settings-secondary">Remove key</button>
          </div>
          {message && <div className="desktop-settings-message">{message}</div>}
        </Section>

        <Section title="Local engine" description="ZEVQORA keeps source scanning and controlled execution on the local desktop boundary.">
          <div className="desktop-stack-list">
            <div><span>Backend</span><strong>{health?.status === 'ok' ? `${health.version} · online` : 'offline'}</strong></div>
            <div><span>Local API</span><strong className="font-mono">{API_BASE}</strong></div>
            <div><span>Human review</span><strong>Required</strong></div>
          </div>
        </Section>

        <Section title="Privacy boundary" description="The desktop should never become a hidden production deployment agent.">
          <div className="desktop-privacy-note"><ShieldCheck size={17} /><p>Workspace scans exclude secret-like files by default. Runtime traces are imported only through explicit action. Generated changes stay isolated for review; ZEVQORA does not auto-merge or auto-deploy them.</p></div>
        </Section>
      </div>
    </div>
  )
}
