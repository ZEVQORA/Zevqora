import { FormEvent, useMemo, useState } from 'react'
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  CircleAlert,
  CircleDollarSign,
  FlaskConical,
  Gauge,
  GitBranch,
  LoaderCircle,
  Network,
  PawPrint,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Economics, Experiment, Finding, Health, Product } from '../lib/types'
import { BrandAsset, brandAssets } from './BrandAsset'
import type { ZevState } from './ZevPresence'

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}K`
  if (value >= 100) return `$${value.toFixed(0)}`
  return `$${value.toFixed(2)}`
}

function percent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function activeStep(state: ZevState) {
  if (state === 'scanning') return 1
  if (state === 'thinking') return 2
  if (state === 'experimenting') return 3
  if (state === 'verifying') return 4
  if (state === 'done') return 5
  return 2
}

function StepRail({ state }: { state: ZevState }) {
  const current = activeStep(state)
  const steps = [
    { n: 1, title: 'Observe', subtitle: 'Collect signals', icon: Gauge },
    { n: 2, title: 'Understand', subtitle: 'Find cost drivers', icon: Sparkles },
    { n: 3, title: 'Experiment', subtitle: 'Test alternatives', icon: FlaskConical },
    { n: 4, title: 'Verify', subtitle: 'Validate impact', icon: ShieldCheck },
    { n: 5, title: 'Ship', subtitle: 'Human review', icon: GitBranch },
  ]
  return (
    <div className="stage-rail" aria-label="Optimization stages">
      {steps.map((step, index) => {
        const Icon = step.icon
        const active = step.n === current
        const complete = step.n < current
        return (
          <div key={step.n} className="contents">
            <div className={`stage-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`}>
              <div className="stage-icon">{complete ? <Check size={14} /> : <Icon size={14} />}</div>
              <div>
                <div className="stage-title"><span>{step.n}</span> {step.title}</div>
                <div className="stage-subtitle">{step.subtitle}</div>
              </div>
            </div>
            {index < steps.length - 1 && <ArrowRight size={13} className="stage-arrow" />}
          </div>
        )
      })}
    </div>
  )
}

function WorkspaceNode({
  className = '',
  eyebrow,
  title,
  subtitle,
  value,
  detail,
  tone = 'neutral',
}: {
  className?: string
  eyebrow?: string
  title: string
  subtitle?: string
  value?: string
  detail?: string
  tone?: 'neutral' | 'danger' | 'candidate' | 'verified'
}) {
  return (
    <div className={`map-node map-node-${tone} ${className}`}>
      {eyebrow && <div className="map-node-eyebrow">{eyebrow}</div>}
      <div className="map-node-title">{title}</div>
      {subtitle && <div className="map-node-subtitle">{subtitle}</div>}
      {value && <div className="map-node-value">{value}</div>}
      {detail && <div className="map-node-detail">{detail}</div>}
    </div>
  )
}

function ZevOnMap({ state }: { state: ZevState }) {
  const labels: Record<ZevState, string> = {
    idle: 'I found a path worth a closer look.',
    thinking: 'Reading the system as a whole.',
    scanning: 'Mapping AI work and spend.',
    experimenting: 'Building a cheaper candidate.',
    verifying: 'Checking quality and evidence.',
    done: 'The evidence is updated.',
  }
  return (
    <div className={`workspace-zev workspace-zev-${state}`}>
      <div className="zev-map-speech">
        <span className="zev-speech-dot" />
        {labels[state]}
      </div>
      <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="workspace-zev-image" />
      <div className="zev-shadow" />
    </div>
  )
}

export function LivingWorkspace({
  product,
  health,
  economics,
  findings,
  experiments,
  aiCallCount,
  agentState,
  onAgentState,
  onDataChanged,
  onScan,
}: {
  product: Product | null
  health: Health | null
  economics: Economics | null
  findings: Finding[]
  experiments: Experiment[]
  aiCallCount: number
  agentState: ZevState
  onAgentState: (state: ZevState) => void
  onDataChanged: () => Promise<void>
  onScan: () => Promise<void>
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastReply, setLastReply] = useState('')
  const [error, setError] = useState('')

  const primaryFinding = findings[0] || null
  const latestExperiment = useMemo(
    () => [...experiments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null,
    [experiments],
  )
  const verified = useMemo(
    () => [...experiments]
      .filter((item) => item.status === 'VERIFIED')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null,
    [experiments],
  )

  const baseline = verified?.baseline_cost_usd ?? latestExperiment?.baseline_cost_usd ?? economics?.observed_cost_usd ?? null
  const candidate = verified?.candidate_cost_usd ?? latestExperiment?.candidate_cost_usd ?? null
  const savingRatio = baseline != null && candidate != null && baseline > 0 ? Math.max(0, (baseline - candidate) / baseline) : null
  const traceCount = economics?.trace_count ?? 0
  const provider = Object.keys(economics?.providers || {})[0] || 'Frontier model'
  const quality = verified?.candidate_quality ?? latestExperiment?.candidate_quality ?? null

  const submit = async (value: string) => {
    const prompt = value.trim()
    if (!prompt || busy) return
    setError('')
    setBusy(true)
    const lower = prompt.toLowerCase()
    if (/scan|analy|map|spend|cost|expensive/.test(lower)) onAgentState('scanning')
    else if (/test|candidate|experiment|try|cheaper/.test(lower)) onAgentState('experimenting')
    else if (/verify|quality|evidence|proof/.test(lower)) onAgentState('verifying')
    else onAgentState('thinking')
    try {
      if (/scan|analy[sz]e this product/.test(lower) && product) await onScan()
      const response = await api.chat(product?.id || null, [{ role: 'user', content: prompt }])
      setLastReply(response.message)
      await onDataChanged()
      onAgentState('done')
      window.setTimeout(() => onAgentState('idle'), 1400)
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      onAgentState('idle')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(input)
  }

  const quick = product
    ? ['Why is this expensive?', 'Find a cheaper path', 'What evidence is missing?', 'Verify this change']
    : ['What does ZEVQORA do?', 'How does verification work?']

  return (
    <section className="living-workspace min-w-0 flex-1">
      <header className="workspace-header">
        <div className="min-w-0">
          <div className="workspace-kicker">AI SPEND MAP</div>
          <div className="flex items-center gap-2">
            <h1>{product?.name || 'Connect your AI product'}</h1>
            <span className={`workspace-live-dot ${health?.status === 'ok' ? 'is-live' : ''}`} />
            <span className="workspace-status">{product ? 'Investigation workspace' : 'Local workspace'}</span>
          </div>
        </div>
        <div className="workspace-header-meta">
          <span>{traceCount.toLocaleString()} traces</span>
          <span>{aiCallCount} AI calls</span>
          <span>{findings.length} opportunities</span>
        </div>
      </header>

      <div className="workspace-stage-wrap"><StepRail state={agentState} /></div>

      <div className="workspace-canvas-wrap">
        <div className="workspace-canvas">
          <div className="canvas-grid" />
          <svg className="map-lines" viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true">
            <path className="line-neutral" d="M165 205 C250 205 250 320 350 320" />
            <path className="line-neutral" d="M465 320 C535 320 525 230 610 230" />
            <path className="line-candidate" d="M700 300 C700 385 640 410 585 445" />
            <path className="line-candidate dashed" d="M700 300 C790 330 800 395 855 410" />
            <path className="line-candidate" d="M585 515 C585 570 590 575 590 600" />
          </svg>

          <WorkspaceNode className="node-request" eyebrow="INPUT" title="User request" subtitle={traceCount ? `${traceCount.toLocaleString()} observed traces` : 'Runtime evidence'} />
          <WorkspaceNode className="node-router" eyebrow="PATH" title="Execution route" subtitle={`${aiCallCount || '—'} detected AI call sites`} />
          <WorkspaceNode
            className="node-cost"
            eyebrow="HIGH COST DRIVER"
            title={primaryFinding?.title || provider}
            subtitle={primaryFinding ? `${primaryFinding.file_path}:${primaryFinding.line}` : 'Waiting for source + runtime evidence'}
            value={money(baseline)}
            detail={primaryFinding?.root_cause || 'Zev will connect code evidence to runtime cost.'}
            tone="danger"
          />
          <WorkspaceNode
            className="node-candidate"
            eyebrow={verified ? 'VERIFIED PATH' : 'CANDIDATE PATH'}
            title={verified ? 'Cheaper verified execution' : 'Optimization candidate'}
            subtitle={verified ? `${verified.sample_size.toLocaleString()} samples replayed` : 'Run an experiment to create proof'}
            value={money(candidate)}
            detail={savingRatio == null ? 'Evidence required' : `${(savingRatio * 100).toFixed(1)}% lower cost`}
            tone={verified ? 'verified' : 'candidate'}
          />
          <WorkspaceNode className="node-cache" eyebrow="LEVER" title="Reuse / cache" subtitle="Only when equivalence is safe" tone="candidate" />
          <WorkspaceNode className="node-eval" eyebrow="PROOF" title="Replay + evaluation" subtitle={quality == null ? 'Quality gate pending' : `${percent(quality)} candidate quality`} tone={verified ? 'verified' : 'neutral'} />

          <div className="paw-trail" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => <PawPrint key={index} size={18 - index * .8} />)}
          </div>
          <ZevOnMap state={agentState} />

          <div className="canvas-legend">
            <div className="legend-title">Live map</div>
            <span><i className="legend-dot danger" /> cost pressure</span>
            <span><i className="legend-dot candidate" /> candidate path</span>
            <span><i className="legend-dot verified" /> verified</span>
          </div>

          <div className="canvas-tools">
            <button title="Focus Zev"><Search size={14} /></button>
            <button title="Optimization map"><Network size={14} /></button>
            <button title="Verified savings"><CircleDollarSign size={14} /></button>
          </div>
        </div>
      </div>

      <div className="zev-command-dock">
        {lastReply && (
          <div className="zev-response-float">
            <BrandAsset src={brandAssets.avatar} alt="Zev" className="h-9 w-9 shrink-0 rounded-[12px] object-contain" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold">Zev</div>
              <div className="mt-0.5 max-h-[72px] overflow-hidden text-[10.5px] leading-[1.55] opacity-70">{lastReply}</div>
            </div>
          </div>
        )}
        {error && <div className="zev-command-error">{error}</div>}
        <form onSubmit={onSubmit} className="zev-command-shell">
          <BrandAsset src={brandAssets.avatar} alt="Zev" className="command-mascot" />
          <div className="min-w-0 flex-1">
            <div className="command-input-row">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={product ? 'Ask Zev to explore, explain, or optimize…' : 'Ask Zev how to start…'}
              />
              <button className="command-send" disabled={!input.trim() || busy} aria-label="Send to Zev">
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
            <div className="command-quick-row">
              {quick.map((item) => (
                <button key={item} type="button" onClick={() => void submit(item)}>{item}</button>
              ))}
            </div>
          </div>
          <div className="command-proof"><ShieldCheck size={13} /> Human review</div>
        </form>
      </div>
    </section>
  )
}
