import {
  CircleDollarSign,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  Home,
  Lightbulb,
  Plus,
  Settings,
  Waypoints,
} from 'lucide-react'
import { BrandAsset, brandAssets } from './BrandAsset'
import type { Product, ViewKey } from '../lib/types'

const nav: { key: ViewKey; label: string; icon: typeof Home }[] = [
  { key: 'zev', label: 'Home', icon: Home },
  { key: 'spend', label: 'AI Spend Map', icon: Waypoints },
  { key: 'waste', label: 'Opportunities', icon: Lightbulb },
  { key: 'experiments', label: 'Experiments', icon: FlaskConical },
  { key: 'savings', label: 'Verified Savings', icon: CircleDollarSign },
  { key: 'implementations', label: 'Changes', icon: GitPullRequest },
]

export function Sidebar({
  view,
  onView,
  products,
  selectedId,
  onSelectProduct,
  onAddProduct,
}: {
  view: ViewKey
  onView: (view: ViewKey) => void
  products: Product[]
  selectedId: string | null
  onSelectProduct: (id: string) => void
  onAddProduct: () => void
}) {
  const selected = products.find((item) => item.id === selectedId) || null
  return (
    <aside className="sidebar-glass">
      <div className="sidebar-brand">
        <BrandAsset src={brandAssets.mark} alt="ZEVQORA mark" className="sidebar-mark" />
        <BrandAsset src={brandAssets.wordmark} alt="ZEVQORA" className="sidebar-wordmark" />
      </div>

      <nav className="sidebar-primary-nav">
        {nav.map((item) => {
          const Icon = item.icon
          const active = view === item.key
          return (
            <button key={item.key} onClick={() => onView(item.key)} className={`sidebar-nav-item ${active ? 'is-active' : ''}`}>
              <span className="sidebar-icon-wrap"><Icon size={16} /></span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-zev-card">
        <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="sidebar-zev-img" />
        <div>
          <b>Zev is on it</b>
          <p>{selected ? 'Mapping cost paths and looking for a lighter verified route.' : 'Connect a product and I’ll map where intelligence is being spent.'}</p>
          <button onClick={() => onView('zev')}>View activity <span>→</span></button>
        </div>
      </div>

      <div className="sidebar-spacer" />

      <button onClick={() => onView('products')} className={`sidebar-product ${view === 'products' ? 'is-active' : ''}`}>
        <span className="sidebar-company-icon"><FolderGit2 size={15} /></span>
        <span className="min-w-0 flex-1 text-left">
          <b>{selected?.name || 'No product connected'}</b>
          <small>{selected ? (selected.monitoring_enabled ? 'Monitoring active' : 'Monitoring paused') : 'Local workspace'}</small>
        </span>
      </button>

      {!!products.length && (
        <select className="sidebar-select" value={selectedId || ''} onChange={(event) => event.target.value && onSelectProduct(event.target.value)}>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
      )}

      <button className="sidebar-add" onClick={onAddProduct}><Plus size={14} /> Add product</button>
      <button onClick={() => onView('settings')} className={`sidebar-nav-item sidebar-settings ${view === 'settings' ? 'is-active' : ''}`}>
        <span className="sidebar-icon-wrap"><Settings size={16} /></span><span>Settings</span>
      </button>
    </aside>
  )
}
