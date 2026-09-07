export function money(value: number | null | undefined, { digits, compact = false }: { digits?: number; compact?: boolean } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const v = Number(value)
  if (compact && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`
  const d = digits ?? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 3 : Math.abs(v) === 0 ? 2 : 4)
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export function num(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function compactNum(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const v = Number(value)
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return v.toLocaleString('en-US')
}

export function pct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}

/** 0..1 quality score rendered as a ratio, the way the gate compares it. */
export function score(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(digits)
}

export function ms(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const v = Number(value)
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`
  return `${Math.round(v)} ms`
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const diff = Date.now() - then
  const s = Math.round(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(iso).toLocaleDateString()
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function shortId(id: string | null | undefined, n = 8) {
  return id ? id.replace(/-/g, '').slice(0, n) : '—'
}

export function titleCase(value: string | null | undefined) {
  return (value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const STRATEGY_LABEL: Record<string, string> = {
  exact_reuse: 'Exact reuse (cache)',
  model_substitution: 'Model substitution',
  bounded_routing: 'Bounded routing',
  context_reduction: 'Context reduction',
  retry_policy: 'Retry policy',
}

export const STRATEGY_HINT: Record<string, string> = {
  exact_reuse: 'Identical requests are answered from the first response. Deterministic; no model call.',
  model_substitution: 'The same task is replayed on a cheaper candidate model and graded against expected outputs.',
  bounded_routing: 'Easy cases go to a cheaper model behind a guard; hard cases keep the baseline.',
}

/**
 * The engine reports raw_cost_delta_percent as a reduction: positive means the
 * candidate was cheaper. Render it as prose without letting the sign flip.
 */
export function costDeltaLabel(reductionPct: number | null | undefined, digits = 1) {
  if (reductionPct === null || reductionPct === undefined || !Number.isFinite(Number(reductionPct))) return '—'
  const v = Number(reductionPct)
  if (v >= 0) return `${pct(v, digits)} cheaper`
  return `${pct(-v, digits)} more expensive`
}

export function observedLabel(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return Number(value).toFixed(4).replace(/\.?0+$/, '')
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function basename(path: string | null | undefined) {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}
