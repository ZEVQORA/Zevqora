import { useMemo, useState } from 'react'
import { Play, ScanSearch, Upload } from 'lucide-react'
import { useStore } from '../../lib/store'
import { Button, Empty, StatusChip } from '../ui'
import { titleCase } from '../../lib/format'
import type { Finding } from '../../lib/types'

const CATEGORY_STRATEGY: Record<string, string> = {
  structured_task_candidate: 'Model substitution',
  duplicate_work: 'Exact reuse (cache)',
  cache_candidate: 'Exact reuse (cache)',
  retry_storm: 'Retry policy',
  context_bloat: 'Context reduction',
  expensive_model_simple_task: 'Model substitution',
  routing_candidate: 'Bounded routing',
  cost_concentration: 'Model substitution or reuse',
}

function strategyFor(finding: Finding) {
  return CATEGORY_STRATEGY[finding.category] || (finding.origin === 'runtime_evidence' ? 'Runtime candidate' : 'Model substitution')
}

export function sourceLabel(finding: Finding) {
  if (finding.file_path === 'runtime evidence') return finding.symbol ? `Runtime evidence · ${finding.symbol}` : 'Runtime evidence'
  return `${finding.file_path}:${finding.line}${finding.symbol ? ` · ${finding.symbol}` : ''}`
}

export function OpportunitiesView({ onTest }: { onTest: (finding: Finding) => void }) {
  const store = useStore()
  const { selected, findings, evaluations, economics, aiCalls, setInspect, inspect, runScan, importTraceFile, health } = store
  const [filter, setFilter] = useState<'all' | 'open' | 'verified' | 'rejected'>('all')

  const rows = useMemo(() => {
    const withEval = findings.map((f) => ({ finding: f, evaluations: evaluations.filter((e) => e.finding_id === f.id) }))
    return withEval.filter((r) => {
      if (filter === 'all') return true
      if (filter === 'verified') return r.finding.evidence_status === 'verified'
      if (filter === 'rejected') return r.finding.evidence_status === 'rejected'
      return !['verified', 'rejected'].includes(r.finding.evidence_status)
    })
  }, [findings, evaluations, filter])

  if (!selected) {
    return <div className="page page-narrow"><Empty title="Connect a repository first" description="Opportunities are detected from your source and your execution traces." /></div>
  }

  const traces = economics?.trace_count || 0
  const canTest = health?.status === 'ok'

  return (
    <div className="page page-narrow">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Opportunities</div>
          <h1 className="h1">Potential savings that still have to earn trust.</h1>
          <p className="lede">Each row is a signal from static analysis or runtime evidence. Nothing here is a saving until a replay passes the quality gate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void importTraceFile()}><Upload size={14} /> Import traces</Button>
          <Button variant="secondary" size="sm" onClick={() => void runScan()} loading={store.zevState === 'scanning'}><ScanSearch size={14} /> Rescan</Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'open', 'verified', 'rejected'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`suggestion ${filter === f ? '!border-blue !text-ink' : ''}`}>{titleCase(f)}</button>
        ))}
        <span className="ml-auto text-[12px] text-subtle">{findings.length} signals · {traces} execution traces · {aiCalls.length} call sites</span>
      </div>

      {!traces && findings.length > 0 && (
        <div className="note note-warn mb-4">Replays need baseline execution traces. Import a JSONL export from your runtime (request_id, input_text, output_text, expected_output, cost_usd, model) before testing a candidate.</div>
      )}

      {!rows.length ? (
        <Empty title={findings.length ? 'No opportunities match this filter' : 'No opportunities yet'} description={findings.length ? 'Try another filter.' : 'Scan the repository to detect AI usage, then import execution traces so ZEVQORA can diagnose spend from evidence rather than guesses.'} />
      ) : (
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.6fr)_180px_170px] gap-4 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
            <span>Issue · source</span>
            <span>Why it looks expensive</span>
            <span>Strategy · confidence · risk</span>
            <span className="text-right">Evidence</span>
          </div>
          {rows.map(({ finding, evaluations: evals }) => {
            const selectedRow = inspect?.kind === 'finding' && inspect.id === finding.id
            return (
              <div key={finding.id} role="button" tabIndex={0} onClick={() => setInspect({ kind: 'finding', id: finding.id })} onKeyDown={(e) => { if (e.key === 'Enter') setInspect({ kind: 'finding', id: finding.id }) }} className={`list-row is-clickable !grid-cols-[minmax(0,1.5fr)_minmax(0,1.6fr)_180px_170px] !gap-4 !px-4 !py-3.5 row-in md:grid ${selectedRow ? 'is-selected' : ''}`}>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold leading-snug text-ink">{finding.title}</div>
                  <div className="mono mt-1 truncate text-[11px] text-subtle" title={sourceLabel(finding)}>{sourceLabel(finding)}</div>
                  <div className="mt-1 text-[11.5px] text-subtle">{titleCase(finding.category)} · {titleCase(finding.origin)}{evals.length ? ` · ${evals.length} replay${evals.length === 1 ? '' : 's'}` : ''}</div>
                </div>
                <div className="text-[12.5px] leading-relaxed text-muted">{finding.root_cause}</div>
                <div className="grid content-start gap-1.5 text-[12px]">
                  <span className="font-medium text-ink">{strategyFor(finding)}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="chip chip-neutral tnum">{Math.round(finding.confidence * 100)}% conf</span>
                    <span className={`chip ${finding.risk === 'high' ? 'chip-rejected' : finding.risk === 'low' ? 'chip-verified' : 'chip-warning'}`}>{finding.risk} risk</span>
                  </span>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusChip status={finding.evidence_status} />
                  <Button size="xs" variant={finding.evidence_status === 'verified' ? 'secondary' : 'accent'} disabled={!canTest} title={canTest ? 'Replay a bounded candidate on your traces' : 'Local engine offline'} onClick={(e) => { e.stopPropagation(); onTest(finding) }}>
                    <Play size={12} /> Let Zev test it
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-4 text-[12px] text-subtle">Estimated savings are shown only after a replay measures the candidate on your samples. ZEVQORA does not project monthly savings from list prices.</p>
    </div>
  )
}
