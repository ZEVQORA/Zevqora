import { ArrowRight, FolderGit2, Lightbulb, Radio, ScanSearch, Upload } from 'lucide-react'
import { Zev } from '../../brand/Zev'
import { useStore } from '../../lib/store'
import { Button, Card, CardHeader, Empty, Metric, StatusChip } from '../ui'
import { costDeltaLabel, dateTime, money, pct, relativeTime, score, zeroCostReason } from '../../lib/format'

export function OverviewView({ onAddProduct }: { onAddProduct: () => void }) {
  const store = useStore()
  const { selected, scan, aiCalls, findings, economics, evaluations, executions, implementations, experiments, setView, runScan, importTraceFile, setInspect, health, activeWorkspace, auth } = store

  if (!selected) {
    return (
      <div className="page page-narrow">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="eyebrow">AI Cost Optimization Engineer</div>
            <h1 className="h1 mt-2">Cut AI COGS without cutting product quality.</h1>
            <p className="lede">Connect the repository you actually develop in. ZEVQORA finds where your product calls models, diagnoses spend, tests cheaper candidates on your own traces, and only calls a saving verified when every gate passes.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={onAddProduct}>
                <FolderGit2 size={15} /> Connect a repository
              </Button>
              <Button variant="secondary" onClick={() => setView('runtime')}>
                <Radio size={15} /> Live runtime
              </Button>
            </div>
            <div className="mt-8 grid gap-2 sm:grid-cols-3">
              {[
                ['01', 'Measure', 'Read-only scan + imported execution traces.'],
                ['02', 'Replay', 'Bounded candidate on your real samples.'],
                ['03', 'Verify', 'Quality gate decides. Then a reviewed patch.'],
              ].map(([n, t, d]) => (
                <div key={n} className="step">
                  <span className="n">{n}</span>
                  <b>{t}</b>
                  <small>{d}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <Zev view="pose-waving" height={240} alt="Zev" />
          </div>
        </div>
      </div>
    )
  }

  const verified = evaluations.filter((e) => e.status === 'VERIFIED')
  const rejected = evaluations.filter((e) => e.status === 'REJECTED')
  const latest = evaluations[0] || null
  const verifiedSavingPct = verified.length ? Math.max(...verified.map((e) => e.raw_cost_delta_percent || 0)) : null
  const providers = Array.from(new Set(aiCalls.map((c) => c.provider)))
  const openChanges = implementations.filter((i) => i.status !== 'REJECTED').length
  const steps = [
    { n: '01', t: 'Connect', d: selected.name, done: true },
    { n: '02', t: 'Detect', d: aiCalls.length ? `${aiCalls.length} call sites` : 'Scan the repository', done: aiCalls.length > 0 },
    { n: '03', t: 'Diagnose', d: findings.length ? `${findings.length} opportunities` : 'No signals yet', done: findings.length > 0 },
    { n: '04', t: 'Evidence', d: economics?.trace_count ? `${economics.trace_count} traces` : 'Import execution traces', done: (economics?.trace_count || 0) > 0 },
    { n: '05', t: 'Replay + eval', d: evaluations.length ? `${evaluations.length} evaluations` : 'Test a candidate', done: evaluations.length > 0 },
    { n: '06', t: 'Verified', d: verified.length ? `${verified.length} passed` : 'Nothing verified yet', done: verified.length > 0 },
    { n: '07', t: 'Review', d: openChanges ? `${openChanges} change candidates` : 'Human review', done: openChanges > 0 },
  ]
  const activeIndex = steps.findIndex((s) => !s.done)

  return (
    <div className="page page-narrow">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{activeWorkspace?.name || 'Local workspace'}</div>
          <h1 className="h1">{selected.name}</h1>
          <p className="lede">Measure. Replay. Verify. Then optimize. Every number below comes from your repository, your traces or a replay you ran.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void importTraceFile()}>
            <Upload size={14} /> Import traces
          </Button>
          <Button size="sm" onClick={() => void runScan()} loading={store.zevState === 'scanning'}>
            <ScanSearch size={14} /> Scan repository
          </Button>
        </div>
      </div>

      <div className="steps mb-6">
        {steps.map((s, i) => (
          <div key={s.n} className={`step ${s.done ? 'is-done' : ''} ${i === activeIndex ? 'is-active' : ''}`}>
            <span className="n">{s.n}</span>
            <b>{s.t}</b>
            <small className="truncate">{s.d}</small>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <Metric label="Observed cost" value={money(economics?.observed_cost_usd, { digits: 4 })} hint={economics?.trace_count ? `${economics.trace_count} execution traces · ${economics.avg_cost_per_trace_usd != null ? money(economics.avg_cost_per_trace_usd, { digits: 5 }) + ' per trace' : ''}` : 'Import traces to measure spend'} />
        </Card>
        <Card className="p-5">
          <Metric label="AI call sites" value={String(aiCalls.length)} hint={providers.length ? providers.join(' · ') : scan ? 'None detected in scanned files' : 'Run a scan'} />
        </Card>
        <Card className="p-5">
          <Metric label="Potential opportunities" value={String(findings.length)} hint="Signals, not savings, until replayed and graded" tone="accent" />
        </Card>
        <Card className="p-5">
          <Metric label="Verified cost reduction" value={verifiedSavingPct === null ? '—' : pct(verifiedSavingPct)} hint={verified.length ? `best verified replay · ${verified.length} verified · ${rejected.length} rejected · ${money(economics?.verified_savings_usd, { digits: 4 })} saved on samples` : `${rejected.length ? rejected.length + ' rejected · ' : ''}nothing verified yet`} tone={verified.length ? 'verified' : undefined} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Latest verdict" description="Quality gate output for the most recent replay." action={latest && <Button size="xs" variant="secondary" onClick={() => { setInspect({ kind: 'evaluation', id: latest.id }); setView('experiments') }}>Open evidence</Button>} />
          <div className="card-body">
            {!latest ? (
              <Empty
                icon={<Zev view="pose-thinking" height={96} />}
                title="No candidate tested yet"
                description={findings.length ? 'Pick an opportunity and let Zev test it. The gate, not the price list, decides.' : 'Scan the repository and import execution traces first.'}
                action={<Button size="sm" onClick={() => setView('opportunities')}><Lightbulb size={14} /> Go to opportunities</Button>}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-2">
                  <div className="proof-row"><span>Cost delta</span><b className={latest.raw_cost_delta_percent && latest.raw_cost_delta_percent > 0 ? 'text-verified' : ''}>{costDeltaLabel(latest, { digits: 2, zeroReason: zeroCostReason(executions.find((x) => x.id === latest.candidate_execution_id)?.cost_source) })}</b></div>
                  <div className="proof-row"><span>Quality</span><b>{score(latest.candidate_quality)}</b></div>
                  <div className="proof-row"><span>Required</span><b>{score((latest.gates.find((g) => g.name === 'quality_floor' || g.name === 'quality')?.threshold as number | undefined) ?? null)}</b></div>
                  <div className="proof-row"><span>Samples</span><b>{latest.sample_count}</b></div>
                  <div className="proof-row"><span>Completed</span><b>{dateTime(latest.completed_at)}</b></div>
                </div>
                <div className="flex flex-col items-end justify-between gap-2">
                  <StatusChip status={latest.status} />
                  <div className={`text-right text-[14px] font-semibold ${latest.status === 'VERIFIED' ? 'text-verified' : 'text-rejected'}`}>{latest.status === 'VERIFIED' ? 'Quality gate passed.' : latest.status === 'REJECTED' ? 'Cheaper isn’t verified.' : latest.rejection_reason || 'Evidence incomplete.'}</div>
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Where to look next" description="Highest-confidence opportunities from the last scan." action={<Button size="xs" variant="secondary" onClick={() => setView('opportunities')}>All <ArrowRight size={12} /></Button>} />
          <div className="card-body grid gap-2">
            {!findings.length && <p className="text-caption text-muted">{scan || selected.last_scan_at ? 'No cost signals in scanned files. Import runtime traces to diagnose spend from evidence.' : 'Run a scan to detect AI usage locations.'}</p>}
            {findings.slice(0, 4).map((f) => (
              <button key={f.id} className="list-row is-clickable" onClick={() => { setInspect({ kind: 'finding', id: f.id }); setView('opportunities') }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">{f.title}</span>
                  <StatusChip status={f.evidence_status} />
                </div>
                <span className="mono truncate text-[11px] text-subtle">{f.file_path === 'runtime evidence' ? 'Runtime evidence' : `${f.file_path}:${f.line}`}{f.symbol ? ` · ${f.symbol}` : ''} · confidence {Math.round(f.confidence * 100)}%</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="metric-label">Engine</div>
          <div className="mt-2 flex items-center gap-2 text-[13px] text-ink"><span className={`conn-dot ${health?.status === 'ok' ? 'is-live' : 'is-off'}`} /> {health?.status === 'ok' ? `Local engine ${health.version}` : 'Local engine offline'}</div>
          <div className="mt-1 text-[12px] text-subtle">{health?.provider_mode === 'platform' ? 'Model calls go through your ZEVQORA account (platform compute).' : health?.provider_mode === 'local_key' ? 'Model calls use the device-local OpenRouter key.' : 'No model provider: deterministic strategies only.'}</div>
        </Card>
        <Card className="p-5">
          <div className="metric-label">Account</div>
          <div className="mt-2 text-[13px] text-ink">{auth?.user?.email || '—'}</div>
          <div className="mt-1 text-[12px] text-subtle">{activeWorkspace ? `${activeWorkspace.name} · ${activeWorkspace.role} · ${activeWorkspace.plan} plan` : 'No workspace selected'}</div>
        </Card>
        <Card className="p-5">
          <div className="metric-label">Legacy experiments</div>
          <div className="mt-2 text-[13px] text-ink">{experiments.length} record{experiments.length === 1 ? '' : 's'}</div>
          <div className="mt-1 text-[12px] text-subtle">Last scan {selected.last_scan_at ? relativeTime(selected.last_scan_at) : 'never'} · monitoring {selected.monitoring_enabled ? 'on' : 'off'}</div>
        </Card>
      </div>
    </div>
  )
}
