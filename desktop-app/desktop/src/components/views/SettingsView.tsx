import { FormEvent, useEffect, useState } from 'react'
import { CreditCard, ExternalLink, KeyRound, RefreshCw, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useStore } from '../../lib/store'
import { API_BASE, errorMessage } from '../../lib/api'
import { creditSummary } from '../../lib/auth'
import { Button, Card, CardHeader, Field, KeyValue, Note, StatusChip, useToast } from '../ui'
import { dateTime, money } from '../../lib/format'
import type { ProviderConfig } from '../../vite-env'

export function SettingsView() {
  const { auth, refreshAuth, health, platformStatus, refreshHealth, model, setModel, activeWorkspace, workspaces, backendError } = useStore()
  const toast = useToast()
  const [displayName, setDisplayName] = useState(auth?.user?.displayName || '')
  const [username, setUsername] = useState(auth?.user?.username || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<ProviderConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    setDisplayName(auth?.user?.displayName || '')
    setUsername(auth?.user?.username || '')
  }, [auth?.user?.displayName, auth?.user?.username])

  useEffect(() => {
    void window.zevqoraDesktop?.getProviderConfig().then(setProvider).catch(() => undefined)
  }, [])

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    setSavingProfile(true)
    try {
      await window.zevqoraDesktop?.updateProfile(displayName.trim().slice(0, 60), username.trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32))
      await refreshAuth()
      toast({ tone: 'ok', title: 'Profile saved to your ZEVQORA account' })
    } catch (error) {
      toast({ tone: 'err', title: 'Could not save profile', description: errorMessage(error) })
    } finally {
      setSavingProfile(false)
    }
  }

  const saveKey = async () => {
    if (!window.zevqoraDesktop) return
    setBusy(true)
    try {
      setProvider(await window.zevqoraDesktop.saveOpenRouterKey(key))
      setKey('')
      toast({ tone: 'ok', title: 'Local key stored with OS encryption', description: 'The local engine restarts with the key. Platform compute is used again when you remove it.' })
      window.setTimeout(() => void refreshHealth(), 1500)
    } catch (error) {
      toast({ tone: 'err', title: 'Could not store key', description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    if (!window.zevqoraDesktop) return
    setBusy(true)
    try {
      setProvider(await window.zevqoraDesktop.clearOpenRouterKey())
      toast({ tone: 'ok', title: 'Local key removed from this device' })
      window.setTimeout(() => void refreshHealth(), 1500)
    } catch (error) {
      toast({ tone: 'err', title: 'Could not remove key', description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const resync = async () => {
    setSyncing(true)
    try {
      const result = await window.zevqoraDesktop?.syncPlatform?.()
      await refreshHealth()
      if (result?.synced) toast({ tone: 'ok', title: result.connected ? 'Platform session connected to the local engine' : 'Local engine has no platform session' })
      else toast({ tone: 'err', title: 'Sync failed', description: result?.error })
    } finally {
      setSyncing(false)
    }
  }

  const credit = creditSummary(auth?.account)
  const mode = health?.provider_mode || 'none'

  return (
    <div className="page page-narrow">
      <div className="mb-6">
        <div className="eyebrow">Settings</div>
        <h1 className="h1">Account, compute and this device.</h1>
        <p className="lede">Your ZEVQORA account owns identity, workspace, plan and Zev credit. This device holds only an encrypted session and, optionally, your own provider key.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profile" description="Shown across ZEVQORA web and desktop." />
          <form onSubmit={saveProfile} className="card-body grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="Your name" /></Field>
              <Field label="Username"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} placeholder="your_handle" /></Field>
            </div>
            <div className="flex items-center gap-2 text-[12.5px] text-muted"><UserRound size={14} /> {auth?.user?.email || '—'}{auth?.isAdmin ? ' · admin (web only)' : ''}</div>
            <div><Button type="submit" size="sm" loading={savingProfile}><Save size={14} /> Save profile</Button></div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Plan & Zev credit" description="Billing lives in the browser. Desktop reflects it without storing billing secrets." />
          <div className="card-body grid gap-3">
            <KeyValue
              items={[
                ['Plan', `${auth?.account?.planName || auth?.account?.plan || 'free'} (${auth?.account?.status || 'active'})`],
                ['Credit remaining', `${money(credit.remaining)} of ${money(credit.included)}`],
                ['Used this period', money(credit.used)],
                ['Period ends', dateTime(auth?.account?.credit?.periodEnd)],
                ['Workspace', activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.role} · ${activeWorkspace.plan}` : '—'],
                ['Workspaces', String(workspaces.length)],
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void window.zevqoraDesktop?.openAccount()}><CreditCard size={14} /> Account & billing <ExternalLink size={12} /></Button>
              <Button size="sm" variant="secondary" onClick={() => void window.zevqoraDesktop?.openPricing()}>View plans <ExternalLink size={12} /></Button>
              <Button size="sm" variant="ghost" onClick={() => void window.zevqoraDesktop?.openWeb?.('/app/team')}>Team <ExternalLink size={12} /></Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Model compute" description="How replays and Zev reach a model provider." action={<StatusChip status={mode === 'none' ? 'waiting' : 'live'} label={mode === 'platform' ? 'PLATFORM' : mode === 'local_key' ? 'LOCAL KEY' : 'NONE'} />} />
          <div className="card-body grid gap-3">
            <KeyValue
              items={[
                ['Local engine', health?.status === 'ok' ? `${health.version} · ${API_BASE}` : backendError || 'offline'],
                ['Mode', mode === 'platform' ? 'ZEVQORA platform proxy (your account)' : mode === 'local_key' ? 'Device-local OpenRouter key' : 'No provider — deterministic strategies only'],
                ['Platform session', platformStatus?.connected ? `${platformStatus.email || 'signed in'} · token ${platformStatus.token_fingerprint}` : 'not connected'],
                ['Context', platformStatus?.workspace_id ? `workspace ${platformStatus.workspace_id.slice(0, 8)}…${platformStatus.project_id ? ` · project ${platformStatus.project_id.slice(0, 8)}…` : ''}` : '—'],
                ['Pricing snapshot', platformStatus ? `${platformStatus.pricing_version} · ${platformStatus.pricing_models} models${platformStatus.pricing_synced ? ' · synced' : ''}` : '—'],
                ['Candidate models', platformStatus?.candidate_models.length ? String(platformStatus.candidate_models.length) : '—'],
              ]}
            />
            <Note tone="info">The provider credential stays on the ZEVQORA server. The desktop sends model calls with your account session; the server checks plan and credit, applies rate limits, then calls OpenRouter and charges the provider-reported cost to your credit.</Note>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void resync()} loading={syncing}><RefreshCw size={14} /> Re-sync session</Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Bring your own key (optional)" description="A device-local OpenRouter key bypasses platform credit. Encrypted with OS secure storage; never leaves this machine." />
          <div className="card-body grid gap-3">
            <div className="flex items-center gap-2 text-[12.5px] text-muted"><KeyRound size={14} /> {provider?.openrouterConfigured ? (provider.source === 'environment' ? 'Key from the backend environment' : 'OS-encrypted local key stored') : 'No local key stored'}{provider && !provider.secureStorageAvailable ? ' · OS secure storage unavailable' : ''}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="OpenRouter API key"><input className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" /></Field>
              <Field label="Zev model id" hint="Any OpenRouter slug. Replays choose candidates separately."><input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="openrouter/auto" /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void saveKey()} loading={busy} disabled={!key.trim()}>Save securely</Button>
              <Button size="sm" variant="secondary" onClick={() => void clearKey()} disabled={busy || !provider?.openrouterConfigured}>Remove key</Button>
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Privacy & safety boundary" description="What this app will and will not do." />
          <div className="card-body grid gap-2 text-[12.5px] text-muted sm:grid-cols-2">
            <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span>Source scanning is read-only and skips secret-like files. Runtime traces are imported only through explicit action.</span></div>
            <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span>Replays send only the sampled task text to the model through your account, bounded by budget and plan credit.</span></div>
            <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span>Generated changes live in an isolated worktree on a new branch. Push and pull requests happen only on your click. No auto-merge, no auto-deploy.</span></div>
            <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span>Telemetry uses scoped, hashed, revocable tokens over HTTPS. ZEVQORA never opens SSH or shell access to your servers.</span></div>
          </div>
        </Card>
      </div>
    </div>
  )
}
