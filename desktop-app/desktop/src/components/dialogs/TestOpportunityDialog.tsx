import { useEffect, useMemo, useState } from 'react'
import { Check, LoaderCircle, Play } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useStore } from '../../lib/store'
import { creditSummary } from '../../lib/auth'
import { Button, Field, Modal, Note, StatusChip } from '../ui'
import { costDeltaLabel, money, STRATEGY_HINT, STRATEGY_LABEL } from '../../lib/format'
import type { Evaluation, Finding, OptimizationExecution, OptimizationPlan } from '../../lib/types'

type Phase = 'configure' | 'plan' | 'replay' | 'evaluate' | 'done' | 'error'

const CATEGORY_DEFAULT: Record<string, 'exact_reuse' | 'model_substitution'> = {
  duplicate_work: 'exact_reuse',
  cache_candidate: 'exact_reuse',
}

export function TestOpportunityDialog({ finding, onClose, onComplete }: { finding: Finding | null; onClose: () => void; onComplete: (evaluation: Evaluation) => Promise<void> | void }) {
  const { selected, platformStatus, health, economics, auth, setZevState } = useStore()
  const [strategy, setStrategy] = useState<'exact_reuse' | 'model_substitution'>('model_substitution')
  const [candidate, setCandidate] = useState('')
  const [budget, setBudget] = useState('0.50')
  const [quality, setQuality] = useState('0.95')
  const [minSamples, setMinSamples] = useState('5')
  const [latency, setLatency] = useState('20')
  const [fallback, setFallback] = useState(false)
  const [protect, setProtect] = useState(false)
  const [phase, setPhase] = useState<Phase>('configure')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<OptimizationPlan | null>(null)
  const [execution, setExecution] = useState<OptimizationExecution | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)

  const models = platformStatus?.candidate_models || []
  const credit = creditSummary(auth?.account)
  const providerReady = Boolean(health?.openrouter_configured)

  useEffect(() => {
    if (!finding) return
    setStrategy(CATEGORY_DEFAULT[finding.category] || 'model_substitution')
    setPhase('configure')
    setError('')
    setPlan(null)
    setExecution(null)
    setEvaluation(null)
  }, [finding])

  useEffect(() => {
    if (!candidate && models.length) setCandidate(models.find((m) => !m.startsWith('mock/')) || models[0])
  }, [models, candidate])

  const traces = economics?.trace_count || 0
  const blockers = useMemo(() => {
    const out: string[] = []
    if (!traces) out.push('No execution traces imported for this product.')
    if (strategy === 'model_substitution' && !providerReady) out.push('No model provider: sign in for platform compute or add a local key.')
    if (strategy === 'model_substitution' && health?.provider_mode === 'platform' && credit.included > 0 && credit.remaining <= 0) out.push('Zev credit for this period is used up.')
    return out
  }, [traces, strategy, providerReady, health?.provider_mode, credit])

  if (!finding || !selected) return null

  const run = async () => {
    setError('')
    setZevState('experimenting')
    try {
      setPhase('plan')
      const plans = await api.createPlans(selected.id, {
        finding_id: finding.id,
        strategy,
        candidate_model: strategy === 'model_substitution' ? candidate.trim() : null,
        max_budget_usd: Number(budget) || 0,
      })
      const created = plans[0]
      setPlan(created)
      if (!created || created.status !== 'READY') {
        setPhase('error')
        setError(created?.blocked_reason ? `Plan blocked: ${created.reason}` : 'The planner produced no runnable plan.')
        setZevState('idle')
        return
      }
      setPhase('replay')
      const exec = await api.executePlan(selected.id, created.id)
      setExecution(exec)
      if (exec.status !== 'SUCCEEDED') {
        setPhase('error')
        setError(exec.error_detail || `Replay ended with status ${exec.status}.`)
        setZevState('idle')
        return
      }
      setPhase('evaluate')
      setZevState('verifying')
      const result = await api.evaluate(selected.id, {
        candidate_execution_id: exec.id,
        finding_id: finding.id,
        gate_config: {
          min_samples: Math.max(1, Number(minSamples) || 5),
          quality_floor: Math.min(1, Math.max(0.01, Number(quality) || 0.95)),
          max_latency_regression_pct: Math.max(0, Number(latency) || 20),
          require_fallback: fallback,
          require_protected_cases: protect,
        },
        project_experiment: true,
      })
      setEvaluation(result)
      setPhase('done')
      setZevState('done')
      window.setTimeout(() => setZevState('idle'), 1200)
      await onComplete(result)
    } catch (err) {
      setPhase('error')
      setError(errorMessage(err))
      setZevState('idle')
    }
  }

  const steps: Array<[Phase, string, string]> = [
    ['plan', 'Plan', 'Deterministic eligibility, sample scope and budget'],
    ['replay', 'Replay', strategy === 'exact_reuse' ? 'Deterministic reuse on captured samples' : `Candidate ${candidate || 'model'} on captured samples`],
    ['evaluate', 'Grade + gates', 'Deterministic graders, then the quality gate'],
  ]
  const order: Phase[] = ['configure', 'plan', 'replay', 'evaluate', 'done']
  const idx = order.indexOf(phase === 'error' ? (execution ? 'evaluate' : plan ? 'replay' : 'plan') : phase)
  const running = phase === 'plan' || phase === 'replay' || phase === 'evaluate'

  return (
    <Modal
      open={Boolean(finding)}
      onClose={running ? () => undefined : onClose}
      size="lg"
      eyebrow="Controlled experiment"
      title="Let Zev test it"
      description={finding.title}
      footer={
        phase === 'configure' || phase === 'error' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void run()} disabled={blockers.length > 0 || (strategy === 'model_substitution' && !candidate.trim())}><Play size={14} /> {phase === 'error' ? 'Try again' : 'Run replay + evaluation'}</Button>
          </>
        ) : phase === 'done' ? (
          <Button onClick={onClose}>View evidence</Button>
        ) : (
          <span className="text-[12.5px] text-muted">Running… this window stays open until the gate decides.</span>
        )
      }
    >
      {phase === 'configure' || phase === 'error' ? (
        <div className="grid gap-4">
          {error && <Note tone="error">{error}</Note>}
          {blockers.map((b) => <Note key={b} tone="warn">{b}</Note>)}
          <div className="grid gap-2 sm:grid-cols-2">
            {(['exact_reuse', 'model_substitution'] as const).map((s) => (
              <button key={s} onClick={() => setStrategy(s)} className={`list-row is-clickable text-left ${strategy === s ? 'is-selected' : ''}`}>
                <span className="text-[13px] font-semibold text-ink">{STRATEGY_LABEL[s]}</span>
                <span className="text-[12px] text-muted">{STRATEGY_HINT[s]}</span>
              </button>
            ))}
          </div>
          {strategy === 'model_substitution' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Candidate model" hint={models.length ? 'From the allowlist for your compute path.' : 'No allowlist available; the engine will refuse unknown models.'}>
                {models.length ? (
                  <select className="select" value={candidate} onChange={(e) => setCandidate(e.target.value)}>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input className="input mono" value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="openai/gpt-4o-mini" />
                )}
              </Field>
              <Field label="Spend cap for this replay (USD)" hint={health?.provider_mode === 'platform' ? `Charged to Zev credit · ${money(credit.remaining)} remaining` : 'Bounded by the pricing snapshot before any call is made.'}>
                <input className="input mono" type="number" min="0" step="0.05" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Quality floor" hint="Candidate quality must reach this (0–1)."><input className="input mono" type="number" min="0.01" max="1" step="0.01" value={quality} onChange={(e) => setQuality(e.target.value)} /></Field>
            <Field label="Minimum samples"><input className="input mono" type="number" min="1" value={minSamples} onChange={(e) => setMinSamples(e.target.value)} /></Field>
            <Field label="Max latency regression %"><input className="input mono" type="number" min="0" value={latency} onChange={(e) => setLatency(e.target.value)} /></Field>
          </div>
          <label className="checkbox"><input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /><span><b>Require a safe fallback.</b><br />Verification fails unless the candidate can fall back to the current execution path.</span></label>
          <label className="checkbox"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /><span><b>Require protected cases.</b><br />Runs without protected samples come back INCOMPLETE instead of VERIFIED.</span></label>
          <Note tone="info">{traces} execution traces available. The candidate runs only on captured samples, within the spend cap. Missing evidence returns INCOMPLETE rather than a made-up saving.</Note>
        </div>
      ) : (
        <div className="grid gap-3">
          {steps.map(([key, title, desc], i) => {
            const stepIndex = i + 1
            const done = idx > stepIndex || phase === 'done'
            const active = phase === key
            return (
              <div key={key} className={`step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                <div className="flex items-center gap-2">
                  {done ? <Check size={14} className="text-verified" /> : active ? <LoaderCircle size={14} className="animate-spin text-blue-700" /> : <span className="n">0{stepIndex}</span>}
                  <b>{title}</b>
                  {key === 'plan' && plan && <StatusChip status={plan.status} />}
                  {key === 'replay' && execution && <StatusChip status={execution.status} />}
                  {key === 'evaluate' && evaluation && <StatusChip status={evaluation.status} />}
                </div>
                <small>{desc}</small>
                {key === 'plan' && plan && <small className="text-muted">{plan.reason}</small>}
                {key === 'replay' && execution && <small className="text-muted">{execution.sample_results.filter((s) => s.status === 'succeeded').length}/{execution.sample_results.length} samples · {money(execution.cost_usd, { digits: 4 })} · {execution.cost_source || 'cost n/a'}</small>}
              </div>
            )
          })}
          {phase === 'done' && evaluation && (
            <div className={`rounded-xl border px-4 py-3 ${evaluation.status === 'VERIFIED' ? 'border-verified/30 bg-verified-bg' : 'border-rejected/30 bg-rejected-bg'}`}>
              <div className={`text-[20px] font-bold tracking-tight ${evaluation.status === 'VERIFIED' ? 'text-verified' : 'text-rejected'}`}>{evaluation.status === 'VERIFIED' ? 'QUALITY GATE · PASS' : evaluation.status === 'REJECTED' ? 'QUALITY GATE · FAIL' : evaluation.status}</div>
              <div className="mt-1 text-[12.5px] text-muted">{evaluation.status === 'VERIFIED' ? `Verified on ${evaluation.sample_count} samples. ${costDeltaLabel(evaluation.raw_cost_delta_percent)}, quality ${evaluation.candidate_quality?.toFixed(2)}.` : evaluation.status === 'REJECTED' ? `Cheaper isn’t verified. ${evaluation.rejection_reason || ''}` : evaluation.rejection_reason || 'Evidence incomplete.'}</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
