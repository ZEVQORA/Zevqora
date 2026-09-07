import { useMemo, useState } from 'react'
import { Download, GitBranch, Play } from 'lucide-react'
import { useStore } from '../../lib/store'
import { Button, Card, CardHeader, Empty, Note, StatusChip, useToast } from '../ui'
import { costDeltaLabel, dateTime, money, ms, num, observedLabel, pct, relativeTime, score, shortId, STRATEGY_LABEL, titleCase, zeroCostReason } from '../../lib/format'
import type { Evaluation, Experiment } from '../../lib/types'

function Verdict({ evaluation }: { evaluation: Evaluation }) {
  const pass = evaluation.status === 'VERIFIED'
  const fail = evaluation.status === 'REJECTED'
  return (
    <div className={`rounded-xl border px-4 py-3 ${pass ? 'border-verified/30 bg-verified-bg' : fail ? 'border-rejected/30 bg-rejected-bg' : 'border-warning/30 bg-warning-bg'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Quality gate</div>
          <div className={`text-[24px] font-bold leading-none tracking-tight ${pass ? 'text-verified' : fail ? 'text-rejected' : 'text-warning'}`}>{pass ? 'PASS' : fail ? 'FAIL' : titleCase(evaluation.status)}</div>
        </div>
        <div className="text-right">
          <StatusChip status={evaluation.status} />
          <div className={`mt-1 text-[13px] font-semibold ${pass ? 'text-verified' : fail ? 'text-rejected' : 'text-warning'}`}>{pass ? 'Verified on your samples.' : fail ? 'Cheaper isn’t verified.' : evaluation.rejection_reason || 'Evidence incomplete.'}</div>
        </div>
      </div>
      {fail && evaluation.rejection_reason && <div className="mt-2 text-[12.5px] text-rejected">{evaluation.rejection_reason}</div>}
    </div>
  )
}

export function ExperimentsView({ onPrepare, onTest }: { onPrepare: (experiment: Experiment) => void; onTest: () => void }) {
  const store = useStore()
  const { selected, evaluations, executions, plans, experiments, findings, inspect, setInspect, setView } = store
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const current = useMemo(() => {
    const id = inspect?.kind === 'evaluation' ? inspect.id : selectedId
    return evaluations.find((e) => e.id === id) || evaluations[0] || null
  }, [evaluations, inspect, selectedId])

  if (!selected) return <div className="page page-narrow"><Empty title="Connect a repository first" /></div>

  const execution = current ? executions.find((e) => e.id === current.candidate_execution_id) || null : null
  const plan = current ? plans.find((p) => p.id === current.candidate_plan_id) || null : null
  const finding = current ? findings.find((f) => f.id === current.finding_id) || null : null
  const experiment = current ? experiments.find((e) => e.evaluation_run_id === current.id) || null : null
  const baselineModel = String(plan?.baseline_config?.baseline_model || plan?.baseline_config?.model || (execution?.sample_results.find((s) => s.requested_model)?.requested_model && plan?.strategy === 'exact_reuse' ? 'same as baseline' : '') || 'baseline (traces)')
  const candidateModel = execution?.resolved_model || execution?.requested_model || String(plan?.candidate_config?.model || (plan?.strategy === 'exact_reuse' ? 'deterministic reuse' : '—'))
  const succeeded = execution?.sample_results.filter((s) => s.status === 'succeeded').length ?? 0
  const baselineTokens = execution?.sample_results.reduce((a, s) => a + Number(s.baseline_input_tokens || 0) + Number(s.baseline_output_tokens || 0), 0)

  const exportEvidence = async () => {
    if (!current) return
    const payload = {
      exported_at: new Date().toISOString(),
      product: { id: selected.id, name: selected.name },
      evaluation: current,
      execution,
      plan,
      finding,
      experiment,
      claim_policy: 'Verified applies only to these samples under these gates. Not a production savings claim.',
    }
    const bridge = window.zevqoraDesktop
    if (!bridge?.saveTextFile) {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      toast({ tone: 'ok', title: 'Evidence copied to clipboard' })
      return
    }
    const path = await bridge.saveTextFile(`zevqora-evidence-${shortId(current.id, 10)}.json`, JSON.stringify(payload, null, 2))
    if (path) toast({ tone: 'ok', title: 'Evidence exported', description: path })
  }

  return (
    <div className="page page-narrow">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Experiments</div>
          <h1 className="h1">Baseline vs candidate. The gate decides.</h1>
          <p className="lede">Every candidate is replayed on your captured samples, graded deterministically and passed through cost, quality, latency and fallback gates. Cheaper alone never counts.</p>
        </div>
        <Button size="sm" onClick={onTest}><Play size={14} /> Test an opportunity</Button>
      </div>

      {!evaluations.length ? (
        <Empty title="No replays yet" description="Choose an opportunity and let Zev test it. You will see baseline vs candidate, the quality gate verdict and the full evidence trail here." action={<Button size="sm" onClick={() => setView('opportunities')}>Go to opportunities</Button>} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            {evaluations.map((e) => {
              const p = plans.find((x) => x.id === e.candidate_plan_id)
              const active = current?.id === e.id
              return (
                <button key={e.id} className={`list-row is-clickable ${active ? 'is-selected' : ''}`} onClick={() => { setSelectedId(e.id); setInspect({ kind: 'evaluation', id: e.id }) }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{STRATEGY_LABEL[p?.strategy || ''] || titleCase(p?.strategy || 'candidate')}</span>
                    <StatusChip status={e.status} />
                  </div>
                  <span className="text-[11.5px] text-subtle">{costDeltaLabel(e)} · quality {score(e.candidate_quality)} · {e.sample_count} samples</span>
                  <span className="text-[11px] text-subtle">{relativeTime(e.created_at)}</span>
                </button>
              )
            })}
          </div>

          {current && (
            <div className="grid content-start gap-4">
              <Verdict evaluation={current} />

              <Card>
                <CardHeader title="Baseline vs candidate" description={finding ? finding.title : 'Replay on captured samples'} action={<><Button size="xs" variant="secondary" onClick={() => void exportEvidence()}><Download size={12} /> Export evidence</Button>{experiment && experiment.status === 'VERIFIED' && experiment.execution_proven && <Button size="xs" onClick={() => onPrepare(experiment)}><GitBranch size={12} /> Prepare change</Button>}</>} />
                <div className="card-body overflow-x-auto p-0">
                  <table className="table">
                    <thead><tr><th /><th>Provider / model</th><th className="right">Calls</th><th className="right">Tokens</th><th className="right">Cost</th><th className="right">Latency</th><th className="right">Quality</th></tr></thead>
                    <tbody>
                      <tr>
                        <td className="font-semibold">Baseline</td>
                        <td className="mono">{baselineModel}</td>
                        <td className="right tnum">{current.sample_count}</td>
                        <td className="right tnum">{baselineTokens ? num(baselineTokens) : '—'}</td>
                        <td className="right tnum">{money(current.baseline_cost_usd, { digits: 4 })}</td>
                        <td className="right tnum">{ms(current.baseline_latency_ms)}</td>
                        <td className="right tnum">{score(current.baseline_quality)}</td>
                      </tr>
                      <tr>
                        <td className="font-semibold">Candidate</td>
                        <td className="mono">{execution?.provider ? `${execution.provider} · ` : ''}{candidateModel}</td>
                        <td className="right tnum">{execution ? `${succeeded}/${execution.sample_results.length}` : '—'}</td>
                        <td className="right tnum">{execution && (execution.input_tokens !== null || execution.output_tokens !== null) ? num((execution.input_tokens || 0) + (execution.output_tokens || 0)) : '—'}</td>
                        <td className="right tnum">{money(current.candidate_cost_usd, { digits: 4 })}</td>
                        <td className="right tnum">{ms(current.candidate_latency_ms)}</td>
                        <td className="right tnum">{score(current.candidate_quality)}</td>
                      </tr>
                      <tr>
                        <td className="font-semibold text-subtle">Delta</td>
                        <td />
                        <td />
                        <td />
                        <td className={`right tnum font-semibold ${current.raw_cost_delta_percent !== null && current.raw_cost_delta_percent > 0 ? 'text-verified' : 'text-rejected'}`}>{costDeltaLabel(current, { digits: 2, zeroReason: zeroCostReason(execution?.cost_source) })}</td>
                        <td className="right tnum">{current.baseline_latency_ms && current.candidate_latency_ms ? pct(((current.candidate_latency_ms - current.baseline_latency_ms) / current.baseline_latency_ms) * 100) : '—'}</td>
                        <td className={`right tnum font-semibold ${current.quality_delta !== null && current.quality_delta < 0 ? 'text-rejected' : 'text-verified'}`}>{current.quality_delta === null ? '—' : (current.quality_delta >= 0 ? '+' : '') + current.quality_delta.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="px-5 pb-4 text-[11.5px] text-subtle">Cost source: {execution?.cost_source || 'n/a'}{execution?.pricing_version ? ` · pricing ${execution.pricing_version}` : ''} · evidence {current.evidence_version} · {current.verification_source === 'EXECUTION_EVALUATION' ? 'execution-proven' : 'legacy evidence'}</div>
              </Card>

              <Card>
                <CardHeader title="Gates" description={`Evaluated ${dateTime(current.completed_at)}`} />
                <div className="card-body overflow-x-auto p-0">
                  <table className="table">
                    <thead><tr><th>Gate</th><th>Required</th><th>Observed</th><th>Threshold</th><th>Reason</th><th>Outcome</th></tr></thead>
                    <tbody>
                      {current.gates.map((g) => (
                        <tr key={g.name}>
                          <td className="font-medium">{titleCase(g.name)}</td>
                          <td className="text-subtle">{g.required ? 'yes' : 'info'}</td>
                          <td className="mono max-w-[220px] break-words">{observedLabel(g.observed)}</td>
                          <td className="mono max-w-[200px] break-words">{observedLabel(g.threshold)}</td>
                          <td className="max-w-[360px] text-[12px] text-muted">{g.reason}</td>
                          <td><StatusChip status={g.outcome} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {execution && (
                <Card>
                  <CardHeader title="Samples" description={`${execution.sample_results.length} baseline traces replayed · provider calls ${execution.provider_call_count}`} action={<Button size="xs" variant="ghost" onClick={() => setInspect({ kind: 'execution', id: execution.id })}>Execution details</Button>} />
                  <div className="card-body overflow-x-auto p-0">
                    <table className="table">
                      <thead><tr><th>Trace</th><th>Status</th><th>Candidate output</th><th className="right">Tokens</th><th className="right">Cost</th><th className="right">Latency</th></tr></thead>
                      <tbody>
                        {execution.sample_results.slice(0, 50).map((s) => (
                          <tr key={s.baseline_trace_id}>
                            <td className="mono">{shortId(s.baseline_trace_id, 10)}</td>
                            <td><StatusChip status={s.status === 'succeeded' ? 'ok' : s.status === 'failed' ? 'error' : 'waiting'} label={s.status.toUpperCase()} /></td>
                            <td className="max-w-[380px] truncate text-[12px] text-muted" title={s.output_text || s.error_detail || ''}>{s.output_text || s.error_detail || '—'}</td>
                            <td className="right tnum">{s.input_tokens != null || s.output_tokens != null ? `${num(s.input_tokens)} / ${num(s.output_tokens)}` : '—'}</td>
                            <td className="right tnum">{money(s.cost_usd, { digits: 5 })}</td>
                            <td className="right tnum">{ms(s.latency_ms)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {experiment && experiment.status === 'VERIFIED' && !experiment.execution_proven && <Note tone="warn">This verdict is from legacy candidate evidence and cannot unlock a code change. Re-run through replay + evaluation.</Note>}
              <Note tone="info">“Verified” means: on these {current.sample_count} samples, under these gates, the candidate was cheaper and met the quality floor. It is not a production savings claim. Measure again after rollout.</Note>
            </div>
          )}
        </div>
      )}

      {experiments.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Experiment records" description="Compatibility view of experiment rows (including legacy imported candidate evidence)." />
          <div className="card-body overflow-x-auto p-0">
            <table className="table">
              <thead><tr><th>Record</th><th>Status</th><th className="right">Samples</th><th className="right">Baseline</th><th className="right">Candidate</th><th className="right">Quality</th><th>Source</th><th /></tr></thead>
              <tbody>
                {experiments.map((e) => (
                  <tr key={e.id} className="is-clickable" onClick={() => setInspect({ kind: 'experiment', id: e.id })}>
                    <td className="mono">{shortId(e.id)}<div className="text-subtle">{relativeTime(e.created_at)}</div></td>
                    <td><StatusChip status={e.status} /></td>
                    <td className="right tnum">{e.sample_size}</td>
                    <td className="right tnum">{money(e.baseline_cost_usd, { digits: 4 })}</td>
                    <td className="right tnum">{money(e.candidate_cost_usd, { digits: 4 })}</td>
                    <td className="right tnum">{score(e.candidate_quality)}</td>
                    <td className="text-[12px] text-muted">{e.execution_proven ? 'execution-proven' : 'legacy evidence'}</td>
                    <td className="whitespace-nowrap">{e.status === 'VERIFIED' && e.execution_proven && <Button size="xs" variant="secondary" onClick={(ev) => { ev.stopPropagation(); onPrepare(e) }}><GitBranch size={12} /> Prepare change</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
