import { useEffect, useState } from 'react'
import { Command, Copy, ExternalLink, LogOut, Maximize2, Minus, PanelRightClose, PanelRightOpen, Square, X } from 'lucide-react'
import { ZevqoraLogo } from '../../brand/Logo'
import { useStore } from '../../lib/store'
import { creditSummary, displayIdentity } from '../../lib/auth'
import { money } from '../../lib/format'

const VIEW_TITLE: Record<string, string> = {
  overview: 'Overview',
  workspace: 'Project',
  opportunities: 'Opportunities',
  experiments: 'Experiments',
  changes: 'Patch & review',
  runtime: 'Live runtime',
  zev: 'Zev',
  settings: 'Settings',
}

export function TitleBar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const { view, selected, auth, inspectorOpen, setInspectorOpen, signOut, health, platformStatus } = useStore()
  const [isMac, setIsMac] = useState(false)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const bridge = window.zevqoraDesktop
    void bridge?.getWindowState?.().then((state) => {
      setIsMac(state.platform === 'darwin')
      setMaximized(state.maximized)
    })
    return bridge?.onWindowState?.((state) => setMaximized(state.maximized))
  }, [])

  const action = (name: 'minimize' | 'maximize' | 'close') => void window.zevqoraDesktop?.windowAction?.(name)
  const credit = creditSummary(auth?.account)
  const plan = String(auth?.account?.planName || auth?.account?.plan || 'free')
  const identity = displayIdentity(auth)
  const initial = identity.charAt(0).toUpperCase()
  const engineOk = health?.status === 'ok'
  const compute = health?.provider_mode === 'local_key' ? 'Local key' : health?.provider_mode === 'platform' ? 'Platform compute' : 'No provider'
  const computeTone = !engineOk ? 'is-off' : health?.provider_mode === 'none' ? 'is-warn' : 'is-live'

  return (
    <header className="titlebar">
      <div className="titlebar-drag absolute inset-0" />
      {isMac ? (
        <div className="titlebar-no-drag relative z-10 flex items-center gap-2">
          <button onClick={() => action('close')} className="traffic traffic-close" aria-label="Close window" />
          <button onClick={() => action('minimize')} className="traffic traffic-min" aria-label="Minimize window" />
          <button onClick={() => action('maximize')} className="traffic traffic-max" aria-label="Maximize window" />
        </div>
      ) : (
        <div className="relative z-10 flex items-center pl-1">
          <ZevqoraLogo size={18} />
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-[12.5px] font-medium text-muted">
        <span className="text-ink">{selected?.name || 'ZEVQORA'}</span>
        <span className="h-1 w-1 rounded-full bg-blue" aria-hidden />
        <span>{VIEW_TITLE[view] || 'Workspace'}</span>
      </div>

      <div className="titlebar-no-drag relative z-10 ml-auto flex items-center gap-1.5">
        <button onClick={onOpenCommand} className="titlebar-chip" title="Command palette">
          <Command size={13} />
          <span>Jump</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button onClick={() => void window.zevqoraDesktop?.openAccount()} className="titlebar-chip" title={`${plan} plan · ${money(credit.remaining)} Zev credit left · open billing in the browser`}>
          <span className={`conn-dot ${computeTone}`} aria-hidden />
          <span>{compute}</span>
          <kbd className="tnum">{money(credit.remaining)}</kbd>
          <ExternalLink size={11} className="text-subtle" />
        </button>
        {platformStatus?.pricing_synced && <span className="sr-only">Pricing synced</span>}
        <button onClick={() => setInspectorOpen((current) => !current)} className={`titlebar-icon ${inspectorOpen ? 'is-active' : ''}`} aria-label={inspectorOpen ? 'Hide evidence inspector' : 'Show evidence inspector'} title="Evidence inspector">
          {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button
          onClick={() => void window.zevqoraDesktop?.openAccount()}
          className="ml-1 inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gradient-to-br from-blue to-blue-100 text-[12px] font-bold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)]"
          title={identity}
          aria-label="Open ZEVQORA account"
        >
          {initial}
        </button>
        <button onClick={() => void signOut()} className="titlebar-icon" aria-label="Sign out" title="Sign out">
          <LogOut size={14} />
        </button>
        {!isMac && (
          <div className="ml-2 flex items-center">
            <button onClick={() => action('minimize')} className="win-control" aria-label="Minimize window"><Minus size={15} /></button>
            <button onClick={() => action('maximize')} className="win-control" aria-label={maximized ? 'Restore window' : 'Maximize window'}>{maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}</button>
            <button onClick={() => action('close')} className="win-control is-close" aria-label="Close window"><X size={16} /></button>
          </div>
        )}
        <span className="sr-only"><Maximize2 size={1} /></span>
      </div>
    </header>
  )
}
