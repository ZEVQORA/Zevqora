import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, Ban, Check, CircleDashed, Loader2, Minus, X } from 'lucide-react'

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'danger' | 'accent'
type Size = 'xs' | 'sm' | 'md'

export function Button({ variant = 'primary', size = 'md', className, children, loading, disabled, type = 'button', ...props }: { variant?: Variant; size?: Size; loading?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', size === 'xs' && 'btn-xs', className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Status chips — the vocabulary of verification. No invented states.
// ---------------------------------------------------------------------------
type Tone = 'neutral' | 'accent' | 'verified' | 'rejected' | 'warning' | 'ink'
const STATUS: Record<string, { label: string; tone: Tone; Icon: typeof Check; spin?: boolean }> = {
  VERIFIED: { label: 'VERIFIED', tone: 'verified', Icon: Check },
  REJECTED: { label: 'REJECTED', tone: 'rejected', Icon: X },
  NEEDS_EVIDENCE: { label: 'NEEDS EVIDENCE', tone: 'warning', Icon: AlertTriangle },
  INCOMPLETE: { label: 'INCOMPLETE', tone: 'warning', Icon: AlertTriangle },
  FAILED: { label: 'FAILED', tone: 'rejected', Icon: X },
  CANCELLED: { label: 'CANCELLED', tone: 'neutral', Icon: Ban },
  PLANNED: { label: 'PLANNED', tone: 'neutral', Icon: CircleDashed },
  RUNNING: { label: 'RUNNING', tone: 'accent', Icon: Loader2, spin: true },
  EXECUTING: { label: 'EXECUTING', tone: 'accent', Icon: Loader2, spin: true },
  SUCCEEDED: { label: 'EXECUTED', tone: 'accent', Icon: Check },
  BUDGET_EXCEEDED: { label: 'BUDGET EXCEEDED', tone: 'rejected', Icon: X },
  READY: { label: 'READY', tone: 'accent', Icon: Check },
  BLOCKED: { label: 'BLOCKED', tone: 'warning', Icon: Ban },
  DRAFT: { label: 'DRAFT', tone: 'neutral', Icon: CircleDashed },
  COMPLETED: { label: 'COMPLETED', tone: 'verified', Icon: Check },
  PREPARED_NO_TESTS: { label: 'PREPARED · NO TESTS', tone: 'accent', Icon: CircleDashed },
  READY_FOR_REVIEW: { label: 'READY FOR REVIEW', tone: 'accent', Icon: Check },
  TESTS_FAILED: { label: 'TESTS FAILED', tone: 'rejected', Icon: X },
  APPROVED_FOR_REVIEW: { label: 'APPROVED · PR REVIEW', tone: 'verified', Icon: Check },
  needs_evidence: { label: 'NEEDS EVIDENCE', tone: 'warning', Icon: AlertTriangle },
  verified: { label: 'VERIFIED', tone: 'verified', Icon: Check },
  rejected: { label: 'REJECTED', tone: 'rejected', Icon: X },
  potential: { label: 'POTENTIAL', tone: 'accent', Icon: CircleDashed },
  active: { label: 'ACTIVE', tone: 'verified', Icon: Check },
  revoked: { label: 'REVOKED', tone: 'neutral', Icon: Ban },
  pending: { label: 'PENDING', tone: 'warning', Icon: CircleDashed },
  live: { label: 'CONNECTED', tone: 'verified', Icon: Check },
  waiting: { label: 'WAITING', tone: 'warning', Icon: CircleDashed },
  disconnected: { label: 'DISCONNECTED', tone: 'neutral', Icon: Minus },
  error: { label: 'ERROR', tone: 'rejected', Icon: AlertTriangle },
  ok: { label: 'OK', tone: 'verified', Icon: Check },
  passed: { label: 'PASS', tone: 'verified', Icon: Check },
  failed: { label: 'FAIL', tone: 'rejected', Icon: X },
  missing: { label: 'MISSING', tone: 'warning', Icon: AlertTriangle },
  informational: { label: 'INFO', tone: 'neutral', Icon: Minus },
}

export function StatusChip({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s = STATUS[status] || { label: status.replace(/_/g, ' ').toUpperCase(), tone: 'neutral' as Tone, Icon: CircleDashed }
  const Icon = s.Icon
  return (
    <span className={cn('chip', `chip-${s.tone}`, className)}>
      <Icon size={11} strokeWidth={2.5} aria-hidden className={s.spin ? 'animate-spin' : undefined} />
      {label ?? s.label}
    </span>
  )
}

export function Chip({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('chip', `chip-${tone}`, className)}>{children}</span>
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h1">{title}</h1>
        {description && <p className="lede">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className, glass = false }: { children: ReactNode; className?: string; glass?: boolean }) {
  return <section className={cn(glass ? 'card-glass' : 'card', className)}>{children}</section>
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('card-head', className)}>
      <div className="min-w-0">
        <div className="card-title">{title}</div>
        {description && <div className="card-desc">{description}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function Metric({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'verified' | 'rejected' | 'accent' }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className={cn('metric-value', tone === 'verified' && 'text-verified', tone === 'rejected' && 'text-rejected', tone === 'accent' && 'text-blue-700')}>{value}</div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  )
}

export function Empty({ title, description, action, icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('empty', className)}>
      {icon}
      <div className="empty-title">{title}</div>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Note({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; className?: string }) {
  return <div className={cn('note', `note-${tone}`, className)}>{children}</div>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('field', className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function KeyValue({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  return (
    <dl className={cn('inspector-kv', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, description, children, footer, size = 'md', eyebrow }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; eyebrow?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([aria-label="Close"])')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose])
  if (!open) return null
  const width = size === 'sm' ? 440 : size === 'lg' ? 820 : size === 'xl' ? 1040 : 600
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" className="modal glass-pop" style={{ maxWidth: width }}>
        <div className="modal-head">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 className="mt-1 text-h3 text-ink">{title}</h2>
            {description && <p className="mt-1 text-caption text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-ink/5 hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type Toast = { id: number; tone: 'ok' | 'err' | 'info'; title: string; description?: string }
const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setItems((current) => [...current.slice(-3), { ...t, id }])
    window.setTimeout(() => setItems((current) => current.filter((x) => x.id !== id)), t.tone === 'err' ? 7000 : 4200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn('toast glass-pop', `toast-${t.tone}`)}>
            <b>{t.title}</b>
            {t.description && <span className="text-muted">{t.description}</span>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ---------------------------------------------------------------------------
// Async helper
// ---------------------------------------------------------------------------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], { enabled = true }: { enabled?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    fnRef
      .current()
      .then((value) => {
        if (!active) return
        setData(value)
        setError(null)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return useMemo(() => ({ data, error, loading, reload, setData }), [data, error, loading, reload])
}

// ---------------------------------------------------------------------------
// Diff viewer
// ---------------------------------------------------------------------------
export function DiffView({ diff, file }: { diff: string; file?: string }) {
  const lines = useMemo(() => diff.replace(/\r\n/g, '\n').split('\n'), [diff])
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) added += 1
    if (l.startsWith('-') && !l.startsWith('---')) removed += 1
  }
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="truncate">{file || 'diff'}</span>
        <span>
          <span className="text-verified">+{added}</span> <span className="text-rejected">−{removed}</span>
        </span>
      </div>
      <div className="diff-body">
        {lines.map((line, i) => {
          const kind = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') ? 'is-meta' : line.startsWith('@@') ? 'is-hunk' : line.startsWith('+') ? 'is-add' : line.startsWith('-') ? 'is-del' : ''
          return (
            <div key={i} className={cn('diff-line', kind)}>
              <span>{i + 1}</span>
              <span>{line || ' '}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Bars({ values, height = 44, tone = 'accent' }: { values: number[]; height?: number; tone?: 'accent' | 'verified' }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={cn('flex-1 rounded-[2px]', tone === 'verified' ? 'bg-verified/70' : 'bg-blue/70')} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
      ))}
    </div>
  )
}
