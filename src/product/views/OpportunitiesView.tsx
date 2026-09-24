import { useMemo, useState } from 'react';
import { Play, ScanSearch, Upload } from 'lucide-react';
import { NoProject, ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { useProductDialogs } from '../dialogs/context';
import { Button, Empty, StatusChip } from '../ui';
import { sourceLabel, titleCase } from '../format';
import { candidateFor } from '../evidence';

export default function OpportunitiesView() {
  const { selected, findings, evaluations, economics, aiCalls, setInspect, inspect, runScan, importTraceFile, health, zevState, runtime } = useProduct();
  const dialogs = useProductDialogs();
  const [filter, setFilter] = useState<'all' | 'open' | 'verified' | 'rejected'>('all');

  const rows = useMemo(() => {
    const withEval = findings.map((f) => ({ finding: f, evaluations: evaluations.filter((e) => e.finding_id === f.id) }));
    return withEval.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'verified') return r.finding.evidence_status === 'verified';
      if (filter === 'rejected') return r.finding.evidence_status === 'rejected';
      return !['verified', 'rejected'].includes(r.finding.evidence_status);
    });
  }, [findings, evaluations, filter]);

  if (!selected) {
    return (
      <NoProject>
        <Empty title="Connect a repository first" description="Opportunities are detected from your source and your execution traces." action={<Button onClick={dialogs.openConnect}>Connect repository</Button>} />
      </NoProject>
    );
  }

  const traces = economics?.trace_count || 0;
  const canTest = health?.status === 'ok';

  return (
    <ProductFrame>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="peyebrow">Opportunities</div>
          <h1 className="ph1">Potential savings that still have to earn trust.</h1>
          <p className="plede">Each row is a signal from static analysis or runtime evidence. Nothing here is a saving until a replay passes the quality gate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void importTraceFile()}><Upload size={14} /> Import traces</Button>
          <Button variant="secondary" size="sm" onClick={() => void runScan().catch(() => undefined)} loading={zevState === 'scanning'}><ScanSearch size={14} /> Rescan</Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'open', 'verified', 'rejected'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`psuggestion ${filter === f ? 'is-on' : ''}`}>{titleCase(f)}</button>
        ))}
        <span className="ml-auto text-[12px] text-subtle">{findings.length} signals · {traces} execution traces · {aiCalls.length} call sites</span>
      </div>

      {findings.length > 0 && !findings.some((f) => candidateFor(f, traces).strategy) && (
        <div className="pnote pnote-warn mb-4"><b>No supported opportunity found.</b> These are signals ZEVQORA cannot test yet (supported today: model substitution and exact reuse). They are shown so nothing is hidden; none of them is savings.</div>
      )}

      {!traces && findings.length > 0 && (
        <div className="pnote pnote-warn mb-4">Replays need baseline execution traces. Import a JSONL export from your runtime (request_id, input_text, output_text, expected_output, cost_usd, model) before testing a candidate.</div>
      )}

      {!rows.length ? (
        <Empty title={findings.length ? 'No opportunities match this filter' : 'No opportunities yet'} description={findings.length ? 'Try another filter.' : 'Scan the repository to detect AI usage, then import execution traces so ZEVQORA can diagnose spend from evidence rather than guesses.'} />
      ) : (
        <div className="grid gap-2">
          <div className="popp-grid hidden py-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle xl:grid">
            <span>Issue · source</span>
            <span>Why it looks expensive</span>
            <span>Strategy · tradeoff</span>
            <span className="text-right">Evidence</span>
          </div>
          {rows.map(({ finding, evaluations: evals }) => {
            const selectedRow = inspect?.kind === 'finding' && inspect.id === finding.id;
            const candidate = candidateFor(finding, traces);
            return (
              <div key={finding.id} role="button" tabIndex={0} onClick={() => setInspect({ kind: 'finding', id: finding.id })} onKeyDown={(e) => { if (e.key === 'Enter') setInspect({ kind: 'finding', id: finding.id }); }} className={`plist-row is-clickable popp-grid ${selectedRow ? 'is-selected' : ''}`}>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold leading-snug text-ink">{finding.title}</div>
                  <div className="mono mt-1 truncate text-[11px] text-subtle" title={sourceLabel(finding)}>{sourceLabel(finding)}</div>
                  <div className="mt-1 text-[11.5px] text-subtle">{titleCase(finding.category)} · {titleCase(finding.origin)}{evals.length ? ` · ${evals.length} replay${evals.length === 1 ? '' : 's'}` : ''}</div>
                </div>
                <div className="text-[12.5px] leading-relaxed text-muted">{finding.root_cause}</div>
                <div className="grid content-start gap-1.5 text-[12px]">
                  <span className="font-medium text-ink">{candidate.family}</span>
                  <span className="text-[11.5px] leading-snug text-subtle">{candidate.tradeoff}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`pchip ${candidate.executable ? 'pchip-verified' : 'pchip-neutral'}`}>{candidate.executable ? 'candidate executable' : candidate.blocker}</span>
                    <span className="pchip pchip-neutral tnum">{Math.round(finding.confidence * 100)}% conf</span>
                    <span className={`pchip ${finding.risk === 'high' ? 'pchip-rejected' : finding.risk === 'low' ? 'pchip-verified' : 'pchip-warning'}`}>{finding.risk} risk</span>
                  </span>
                </div>
                <div className="flex flex-row items-center justify-between gap-2 xl:flex-col xl:items-end">
                  <StatusChip status={finding.evidence_status} />
                  <Button size="xs" variant={finding.evidence_status === 'verified' ? 'secondary' : 'accent'} disabled={!canTest || !candidate.strategy} title={!candidate.strategy ? 'Signal only: no supported strategy to test' : canTest ? 'Replay a bounded candidate on your traces' : runtime === 'desktop' ? 'Local engine offline' : 'Engine unavailable'} onClick={(e) => { e.stopPropagation(); dialogs.openTest(finding); }}>
                    <Play size={12} /> Let Zev test it
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[12px] text-subtle">Estimated savings are shown only after a replay measures the candidate on your samples. ZEVQORA does not project monthly savings from list prices.</p>
    </ProductFrame>
  );
}
