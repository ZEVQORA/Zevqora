import { Activity, ChevronRight, FlaskConical, FolderGit2, GitPullRequest, Home, Lightbulb, Plus, Radio, Settings, Sparkles } from 'lucide-react'
import { ZevqoraLogo } from '../../brand/Logo'
import { ZevFace } from '../../brand/Zev'
import { useStore } from '../../lib/store'
import { creditSummary, displayIdentity } from '../../lib/auth'
import { money } from '../../lib/format'
import type { ViewKey } from '../../lib/types'

const NAV: Array<{ key: ViewKey; label: string; icon: typeof Home; badge?: (s: ReturnType<typeof useStore>) => number | null }> = [
  { key: 'overview', label: 'Overview', icon: Home },
  { key: 'workspace', label: 'Project', icon: FolderGit2 },
  { key: 'opportunities', label: 'Opportunities', icon: Lightbulb, badge: (s) => (s.findings.length ? s.findings.length : null) },
  { key: 'experiments', label: 'Experiments', icon: FlaskConical, badge: (s) => (s.evaluations.length ? s.evaluations.length : null) },
  { key: 'changes', label: 'Patch & review', icon: GitPullRequest, badge: (s) => (s.implementations.filter((i) => !['REJECTED'].includes(i.status)).length || null) },
  { key: 'runtime', label: 'Live runtime', icon: Radio },
  { key: 'zev', label: 'Zev', icon: Sparkles },
]

export function Sidebar({ onAddProduct }: { onAddProduct: () => void }) {
  const store = useStore()
  const { view, setView, products, selected, selectProduct, auth, workspaces, activeWorkspace, setContext, health, backendError } = store
  const credit = creditSummary(auth?.account)
  const plan = String(auth?.account?.planName || auth?.account?.plan || 'free')
  const engineOk = health?.status === 'ok'
  const mode = health?.provider_mode || 'none'
  const serverLabel = !engineOk ? 'Engine offline' : mode === 'platform' ? 'Platform compute' : mode === 'local_key' ? 'Local provider key' : 'No provider connected'
  const serverTone = !engineOk ? 'is-off' : mode === 'none' ? 'is-warn' : 'is-live'
  const fillClass = credit.included > 0 && credit.remaining <= 0 ? 'is-empty' : credit.ratio > 0.8 ? 'is-low' : ''

  return (
    <aside className="sidebar-glass">
      <div className="flex h-[46px] items-center px-2">
        <ZevqoraLogo size={20} />
      </div>

      <div className="account-card">
        <div className="flex items-center gap-2.5">
          <ZevFace expression={engineOk ? 'friendly-idle' : 'curious'} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">{displayIdentity(auth)}</div>
            <div className="truncate text-[11.5px] text-subtle">{auth?.user?.email || ''}</div>
          </div>
        </div>
        <select className="context-select" aria-label="Workspace" value={activeWorkspace?.id || ''} onChange={(e) => void setContext(e.target.value || null, null)}>
          {!workspaces.length && <option value="">No workspace yet</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.role}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="font-semibold uppercase tracking-[0.08em] text-subtle">{plan}</span>
          <span className="tnum text-muted">
            <b className="text-ink">{money(credit.remaining)}</b> / {money(credit.included)} credit
          </span>
        </div>
        <div className="credit-track" aria-hidden>
          <div className={`credit-fill ${fillClass}`} style={{ width: `${Math.round(credit.ratio * 100)}%` }} />
        </div>
        <button className="flex items-center gap-2 text-[11.5px] text-muted hover:text-ink" onClick={() => setView('settings')} title={backendError || serverLabel}>
          <span className={`conn-dot ${serverTone}`} aria-hidden />
          <span className="truncate">{serverLabel}</span>
          <ChevronRight size={12} className="ml-auto text-subtle" />
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-label">Product</div>
        <nav className="grid gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon
            const badge = item.badge?.(store) ?? null
            return (
              <button key={item.key} onClick={() => setView(item.key)} className={`nav-item ${view === item.key ? 'is-active' : ''}`}>
                <Icon size={16} />
                <span className="truncate">{item.label}</span>
                {badge !== null && <span className="nav-badge tnum">{badge}</span>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-label">Local repositories</div>
        <div className="grid gap-0.5">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => {
                selectProduct(product.id)
                if (view === 'settings') setView('overview')
              }}
              className={`nav-item ${selected?.id === product.id ? 'is-active' : ''}`}
              title={product.root_path}
            >
              <span className={`conn-dot ${product.monitoring_enabled ? 'is-live' : ''}`} aria-hidden />
              <span className="truncate">{product.name}</span>
              {product.monitoring_enabled && <Activity size={12} className="ml-auto text-verified" />}
            </button>
          ))}
          <button onClick={onAddProduct} className="nav-item text-blue-700">
            <Plus size={15} />
            <span>Connect repository</span>
          </button>
        </div>
      </div>

      <button onClick={() => setView('settings')} className={`nav-item ${view === 'settings' ? 'is-active' : ''}`}>
        <Settings size={16} />
        <span>Settings</span>
      </button>
    </aside>
  )
}
