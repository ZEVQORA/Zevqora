import { useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical, FolderGit2, GitPullRequest, Home, Lightbulb, Plus, Radio, ScanSearch, Search, Settings, Sparkles, Upload } from 'lucide-react'
import { useStore } from '../../lib/store'

type Action = { id: string; label: string; hint: string; icon: typeof Home; run: () => void }

export function CommandPalette({ open, onClose, onAddProduct }: { open: boolean; onClose: () => void; onAddProduct: () => void }) {
  const { setView, runScan, importTraceFile, selected } = useStore()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const actions = useMemo<Action[]>(
    () => [
      { id: 'overview', label: 'Overview', hint: 'Where this product stands', icon: Home, run: () => setView('overview') },
      { id: 'workspace', label: 'Project', hint: 'Repository, AI usage locations, trust boundary', icon: FolderGit2, run: () => setView('workspace') },
      { id: 'opportunities', label: 'Opportunities', hint: 'Signals waiting for evidence', icon: Lightbulb, run: () => setView('opportunities') },
      { id: 'experiments', label: 'Experiments', hint: 'Baseline vs candidate and the gate', icon: FlaskConical, run: () => setView('experiments') },
      { id: 'changes', label: 'Patch & review', hint: 'Diffs, branches, pull requests', icon: GitPullRequest, run: () => setView('changes') },
      { id: 'runtime', label: 'Live runtime', hint: 'Telemetry from your servers', icon: Radio, run: () => setView('runtime') },
      { id: 'zev', label: 'Zev', hint: 'Ask your AI cost engineer', icon: Sparkles, run: () => setView('zev') },
      { id: 'settings', label: 'Settings', hint: 'Account, compute, privacy', icon: Settings, run: () => setView('settings') },
      { id: 'scan', label: 'Scan repository', hint: selected ? `Re-scan ${selected.name}` : 'Connect a repository first', icon: ScanSearch, run: () => void runScan() },
      { id: 'import', label: 'Import execution traces', hint: 'JSONL from your runtime', icon: Upload, run: () => void importTraceFile() },
      { id: 'add', label: 'Connect repository', hint: 'Add a local product', icon: Plus, run: onAddProduct },
    ],
    [setView, runScan, importTraceFile, selected, onAddProduct],
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }, [open])

  if (!open) return null
  const visible = actions.filter((a) => `${a.label} ${a.hint}`.toLowerCase().includes(query.trim().toLowerCase()))
  const choose = (a: Action) => {
    a.run()
    onClose()
  }

  return (
    <div className="modal-backdrop !items-start !pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal glass-pop max-w-[600px] overflow-hidden !rounded-2xl">
        <div className="flex h-[54px] items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(visible.length - 1, i + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
              if (e.key === 'Enter' && visible[index]) choose(visible[index])
            }}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-subtle"
            placeholder="Jump to a view or run an action…"
          />
          <kbd className="kbd">ESC</kbd>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {!visible.length ? <div className="px-4 py-10 text-center text-caption text-subtle">No matching action.</div> : visible.map((a, i) => {
            const Icon = a.icon
            return (
              <button key={a.id} onMouseEnter={() => setIndex(i)} onClick={() => choose(a)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${i === index ? 'bg-blue-50' : 'hover:bg-cloud'}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-blue-700"><Icon size={14} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-ink">{a.label}</span><span className="block truncate text-[11.5px] text-subtle">{a.hint}</span></span>
                {i === index && <span className="kbd">Enter</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-line bg-cloud/60 px-4 py-2 text-[11px] text-subtle"><span>Navigation only. Verification authority is unchanged.</span><span>Ctrl / ⌘ K</span></div>
      </div>
    </div>
  )
}
