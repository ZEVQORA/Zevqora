import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CircleDollarSign, FlaskConical, GitBranch, Lightbulb, Plus, Search, Settings, ShieldCheck } from 'lucide-react'
import type { ViewKey } from '../lib/types'

type Action = {
  id: string
  label: string
  hint: string
  icon: any
  run: () => void
}

export function CommandPalette({
  open,
  onClose,
  onView,
  onAddProduct,
}: {
  open: boolean
  onClose: () => void
  onView: (view: ViewKey) => void
  onAddProduct: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const actions = useMemo<Action[]>(() => [
    { id: 'zev', label: 'Open Zev', hint: 'Chat with your AI cost engineer', icon: Bot, run: () => onView('zev') },
    { id: 'spend', label: 'Open Spend', hint: 'Inspect measured runtime economics', icon: CircleDollarSign, run: () => onView('spend') },
    { id: 'waste', label: 'Open Opportunities', hint: 'Review root-cause waste signals', icon: Lightbulb, run: () => onView('waste') },
    { id: 'experiments', label: 'Open Experiments', hint: 'Review replay and quality gates', icon: FlaskConical, run: () => onView('experiments') },
    { id: 'savings', label: 'Open Verified Savings', hint: 'Only evidence-passed savings', icon: ShieldCheck, run: () => onView('savings') },
    { id: 'ship', label: 'Open Ship', hint: 'Review isolated implementation candidates', icon: GitBranch, run: () => onView('implementations') },
    { id: 'settings', label: 'Open Settings', hint: 'Local agent and privacy controls', icon: Settings, run: () => onView('settings') },
    { id: 'add', label: 'Add Product', hint: 'Connect a local AI workspace', icon: Plus, run: onAddProduct },
  ], [onAddProduct, onView])

  useEffect(() => {
    if (!open) return
    setQuery('')
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }, [open])

  if (!open) return null

  const visible = actions.filter((action) => `${action.label} ${action.hint}`.toLowerCase().includes(query.trim().toLowerCase()))
  const choose = (action: Action) => {
    action.run()
    onClose()
  }

  return (
    <div className="premium-modal-backdrop fixed inset-0 z-[80] flex items-start justify-center px-6 pt-[12vh]" onMouseDown={onClose}>
      <div className="premium-modal w-full max-w-[600px] overflow-hidden rounded-[24px] border border-white/80 bg-white/94 shadow-[0_34px_110px_rgba(15,17,21,.20)] backdrop-blur-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-[58px] items-center gap-3 border-b border-stone/75 px-4">
          <Search size={16} className="text-ink/28" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'Enter' && visible[0]) choose(visible[0])
            }}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink/80 outline-none placeholder:text-ink/27"
            placeholder="Go to a ZEVQORA action..."
          />
          <kbd className="rounded-[8px] bg-cloud px-2 py-1 text-[9px] font-semibold text-ink/30">ESC</kbd>
        </div>
        <div className="max-h-[430px] overflow-y-auto p-2">
          {!visible.length ? <div className="px-4 py-10 text-center text-xs text-ink/35">No matching action.</div> : visible.map((action, index) => {
            const Icon = action.icon
            return (
              <button key={action.id} onClick={() => choose(action)} className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition hover:bg-cloud ${index === 0 ? 'bg-cloud/65' : ''}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border border-stone/75 bg-white text-softblue shadow-[0_5px_15px_rgba(15,17,21,.035)]"><Icon size={14} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-ink/72">{action.label}</span><span className="mt-0.5 block truncate text-[10px] text-ink/34">{action.hint}</span></span>
                {index === 0 && <span className="text-[9px] font-medium text-ink/25">ENTER</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-stone/75 bg-cloud/55 px-4 py-2.5 text-[9px] text-ink/28"><span>Navigation only — verification authority is unchanged.</span><span>Ctrl / ⌘ K</span></div>
      </div>
    </div>
  )
}
