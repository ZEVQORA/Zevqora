import { Activity, CheckCircle2, CircleAlert, FileSearch2, Gauge, ShieldCheck } from 'lucide-react'
import type { Economics, Experiment, Finding, Health, Product, ScanResult } from '../lib/types'

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

export function EvidenceRail({
  health,
  product,
  scan,
  aiCallCount,
  detectedStack,
  findings,
  economics,
  experiments = [],
}: {
  health: Health | null
  product: Product | null
  scan: ScanResult | null
  aiCallCount: number
  detectedStack: string[]
  findings: Finding[]
  economics: Economics | null
  experiments?: Experiment[]
}) {
  const finding = findings[0] || null
  const verified = [...experiments].filter((item) => item.status === 'VERIFIED').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null
  const latest = [...experiments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null
  const baseline = verified?.baseline_cost_usd ?? latest?.baseline_cost_usd ?? economics?.observed_cost_usd ?? null
  const candidate = verified?.candidate_cost_usd ?? latest?.candidate_cost_usd ?? null
  const saving = baseline != null && candidate != null ? Math.max(0, baseline - candidate) : economics?.verified_savings_usd ?? null
  const savingPct = baseline && saving != null ? saving / baseline : null
  const quality = verified?.candidate_quality ?? latest?.candidate_quality ?? null

  return (
    <aside className="evidence-inspector">
      <header><div><b>Evidence Inspector</b><span>Zev explains. Verification decides.</span></div><Activity size={15} /></header>

      <section className="evidence-block">
        <div className="evidence-label">High cost driver</div>
        <div className="evidence-card danger">
          <div className="evidence-card-head">
            <span className="evidence-icon danger"><CircleAlert size={15} /></span>
            <div className="min-w-0 flex-1"><b>{finding?.title || detectedStack[0] || 'Waiting for evidence'}</b><small>{finding ? `${finding.file_path}:${finding.line}` : 'Connect code + runtime traces'}</small></div>
            <span className="evidence-pill danger">{finding?.evidence_status || 'OBSERVE'}</span>
          </div>
          <div className="evidence-metrics">
            <div><small>Observed cost</small><b>{money(baseline)}</b></div>
            <div><small>Traces</small><b>{(economics?.trace_count || 0).toLocaleString()}</b></div>
            <div><small>AI call sites</small><b>{scan?.ai_calls.length ?? aiCallCount}</b></div>
            <div><small>Risk</small><b>{finding?.risk || '—'}</b></div>
          </div>
          <p>{finding?.root_cause || 'ZEVQORA will connect source locations, runtime spend, and quality evidence before recommending a change.'}</p>
        </div>
      </section>

      <section className="evidence-block">
        <div className="evidence-label">Recommended path</div>
        <div className={`evidence-card ${verified ? 'good' : 'candidate'}`}>
          <div className="evidence-card-head">
            <span className={`evidence-icon ${verified ? 'good' : 'candidate'}`}>{verified ? <CheckCircle2 size={15} /> : <ShieldCheck size={15} />}</span>
            <div className="min-w-0 flex-1"><b>{verified ? 'Verified candidate' : 'Candidate needs proof'}</b><small>{verified ? `${verified.sample_size.toLocaleString()} samples replayed` : 'Replay + eval required'}</small></div>
            <span className={`evidence-pill ${verified ? 'good' : 'candidate'}`}>{verified ? 'VERIFIED' : 'PENDING'}</span>
          </div>
          <div className="evidence-metrics">
            <div><small>Candidate cost</small><b>{money(candidate)}</b></div>
            <div><small>Quality</small><b>{quality == null ? '—' : `${(quality * 100).toFixed(1)}%`}</b></div>
            <div><small>Verified saving</small><b>{money(saving)}</b></div>
            <div><small>Reduction</small><b>{savingPct == null ? '—' : `${(savingPct * 100).toFixed(1)}%`}</b></div>
          </div>
          <p>{verified ? 'Passed the configured evidence gates. Human review is still required before shipping.' : 'Potential savings never count as Verified Savings until all verification gates pass.'}</p>
        </div>
      </section>

      <section className="evidence-block evidence-list">
        <div className="flex items-center justify-between"><div className="evidence-label">Evidence</div><span className="text-[9px] opacity-45">{health?.status === 'ok' ? 'Local engine connected' : 'Offline'}</span></div>
        <div><span><FileSearch2 size={13} /> Source analysis</span><b>{scan?.files_scanned ?? '—'} files</b></div>
        <div><span><Gauge size={13} /> Runtime evidence</span><b>{economics?.trace_count ?? 0} traces</b></div>
        <div><span><ShieldCheck size={13} /> Verification</span><b>{experiments.length} runs</b></div>
      </section>

      <section className="evidence-footer-note">
        <ShieldCheck size={14} />
        <span><b>ADVISE mode</b><small>No auto-merge. No auto-deploy. Zev cannot overrule the gates.</small></span>
      </section>
    </aside>
  )
}
