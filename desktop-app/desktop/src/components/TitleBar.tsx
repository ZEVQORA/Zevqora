import { useEffect, useState } from 'react'
import { Bell, Command, LogOut, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { DesktopAuthState } from '../lib/auth'

function readProfileName() {
  return localStorage.getItem('zevqora.profile.displayName') || localStorage.getItem('zevqora.profile.username') || ''
}

export function TitleBar({
  inspectorOpen,
  onToggleInspector,
  onOpenCommand,
  productName,
  auth,
  onOpenAccount,
  onSignOut,
}: {
  inspectorOpen: boolean
  onToggleInspector: () => void
  onOpenCommand: () => void
  productName?: string | null
  auth: DesktopAuthState | null
  onOpenAccount: () => void
  onSignOut: () => void
}) {
  const action = (name: 'minimize' | 'maximize' | 'close') => void window.zevqoraDesktop?.windowAction?.(name)
  const plan = String(auth?.account?.plan || 'free').toUpperCase()
  const included = Number(auth?.account?.credit?.includedUsd || 0)
  const used = Number(auth?.account?.credit?.usedUsd || 0)
  const remaining = Math.max(included - used, 0)
  const [profileName, setProfileName] = useState(readProfileName)

  useEffect(() => {
    const refresh = () => setProfileName(readProfileName())
    window.addEventListener('zevqora:profile-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('zevqora:profile-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const identity = auth?.user?.displayName || auth?.user?.username || profileName || auth?.user?.email || 'Z'
  const initial = identity.charAt(0).toUpperCase()

  return (
    <header className="titlebar">
      <div className="titlebar-drag absolute inset-0" />
      <div className="titlebar-no-drag titlebar-traffic">
        <button onClick={() => action('close')} className="traffic traffic-close" aria-label="Close window" />
        <button onClick={() => action('minimize')} className="traffic traffic-min" aria-label="Minimize window" />
        <button onClick={() => action('maximize')} className="traffic traffic-max" aria-label="Maximize window" />
      </div>
      <div className="titlebar-context">
        <span>{productName || 'ZEVQORA'}</span><i />
        <span className="muted">AI optimization workspace</span>
      </div>
      <div className="titlebar-no-drag titlebar-actions">
        <button onClick={onOpenCommand} className="titlebar-chip"><Command size={13} /><span>Command</span><kbd>Ctrl K</kbd></button>
        <button onClick={onOpenAccount} className="titlebar-chip" aria-label="Open account in browser"><span>{plan}</span><kbd>${remaining.toFixed(2)}</kbd></button>
        <button className="titlebar-icon" aria-label="Notifications"><Bell size={15} /></button>
        <button onClick={onToggleInspector} className="titlebar-icon" aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>
          {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button onClick={onOpenAccount} className="titlebar-profile" title={auth?.user?.displayName || auth?.user?.username || profileName || auth?.user?.email || 'ZEVQORA account'} aria-label="Open ZEVQORA account">{initial}</button>
        <button onClick={onSignOut} className="titlebar-icon" aria-label="Sign out"><LogOut size={14} /></button>
      </div>
    </header>
  )
}
