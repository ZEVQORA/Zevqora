import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, GitBranch, Plug, RefreshCw } from 'lucide-react';
import { useSession } from '@/lib/session';
import { usePresentationMode, MODES } from '@/lib/mode';
import { useAsync } from '@/lib/useAsync';
import { cn } from '@/lib/cn';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader, MetricCard } from '@/components/ui/Card';
import { ClaimBadge, Unknown } from '@/components/ui/Claim';
import { CopyableHash, EvidenceLink } from '@/components/ui/Evidence';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ViewHeader } from '@/components/ui/Layout';
import { SegmentedControl } from '@/components/ui/Segmented';
import { EmptyState, ErrorState, LoadingState, InlineNotice } from '@/components/ui/States';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { LineChart } from '@/components/charts/LineChart';
import { HBarChart } from '@/components/charts/Bars';
import { ZevFace } from '@/brand/Zev';
import { experienceApi, fmt, type CommandCenter, type ProductCard } from '../experience';
import { DecisionQueue, EvaluatedPlanLine, Pipeline, ProjectionNote, RiskList, freshness, lowerIsBetter, orUnknown, primaryWorkload, spendConcentration, useOpenWorkload } from './parts';

const DAY_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

function coverage(n: number, of: number) {
  return of ? `${n.toLocaleString()} of ${of.toLocaleString()} requests` : null;
}

/** The three financial concepts, side by side and never merged. */
function ValueStrip({ cc }: { cc: CommandCenter }) {
  const evaluated = cc.value.evaluated;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Evaluated improvement</h3>
          <ClaimBadge claim="EVALUATED" size="xs" />
        </div>
        <p className="mt-1 text-[11.5px] text-muted">Replayed under a frozen Evaluation Contract. Not deployed.</p>
        <div className="mt-3 space-y-3">
          {evaluated.length ? evaluated.map((p) => <EvaluatedPlanLine key={p.id} plan={p} />) : <p className="text-[12.5px] text-muted">No VERIFIED plan has been selected yet.</p>}
        </div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Projected impact</h3>
          <ClaimBadge claim="PROJECTED" size="xs" />
        </div>
        <p className="mt-1 text-[11.5px] text-muted">The evaluated change applied to observed volume. A projection, not a saving.</p>
        <p className="mt-3 text-[1.6rem] font-semibold tracking-[-0.03em] text-ink tnum">{cc.value.projected.monthly_cost_change_usd === null ? <Unknown reason="Needs a selected VERIFIED plan with known cost and observed volume." className="text-[1rem]" /> : `${fmt.usd(cc.value.projected.monthly_cost_change_usd)} / month`}</p>
        <p className="mt-1 text-[11.5px] text-subtle">{cc.value.projected.monthly_cost_change_usd === null ? evaluated[0]?.projected.unavailable_reason || 'No VERIFIED plan selected yet.' : `Across ${cc.value.projected.plans} selected plan${cc.value.projected.plans === 1 ? '' : 's'}. Negative means lower cost.`}</p>
        {evaluated[0] && <ProjectionNote projection={evaluated[0].projected} />}
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Realized production value</h3>
          <ClaimBadge claim="NOT_YET_MEASURED" size="xs" />
        </div>
        <p className="mt-3 text-[1.25rem] font-semibold tracking-[-0.02em] text-muted">NOT YET MEASURED</p>
        <p className="mt-1 text-[11.5px] text-subtle">{cc.value.realized.reason}</p>
      </Card>
    </div>
  );
}

function SpendChart({ cc, title = 'AI spend over time' }: { cc: CommandCenter; title?: string }) {
  const d = cc.observed.daily;
  return (
    <ChartContainer
      title={title}
      description="Known cost per day from recorded requests. Days with no known cost are gaps, not zero."
      unit="USD per day"
      range={`Last ${cc.range.days} days`}
      source={`engine traces${cc.observed.truncated ? ` (latest ${cc.observed.trace_limit.toLocaleString()} only)` : ''}`}
      updatedAt={cc.generated_at}
      claims={['OBSERVED']}
      empty={!d.length}
      emptyText="No recorded requests in this range."
      summary={`Spend over ${d.length} days, total ${fmt.usd(cc.observed.spend_usd) ?? 'unknown'}.`}
      table={{ columns: ['Day', 'Requests', 'Known spend (USD)', 'Cost known for'], rows: d.map((x) => [x.day, x.requests, x.spend_usd, x.cost_known]) }}
    >
      <LineChart ariaLabel="Daily AI spend" labels={d.map((x) => x.day.slice(5))} format={(v) => fmt.usd(v, v < 1 ? 3 : 2) || ''} series={[{ key: 'spend', label: 'Known spend', color: 'var(--zq-accent)', values: d.map((x) => x.spend_usd) }]} />
    </ChartContainer>
  );
}

function LatencyChart({ cc }: { cc: CommandCenter }) {
  const d = cc.observed.daily;
  return (
    <ChartContainer
      title="Latency per day (p50 / p95)"
      description="Request latency from recorded traces. Requests without timing are left out; days without timing are gaps."
      unit="milliseconds"
      range={`Last ${cc.range.days} days`}
      source="engine traces"
      updatedAt={cc.generated_at}
      claims={['OBSERVED']}
      empty={!d.some((x) => x.samples)}
      emptyText="No timed requests in this range."
      table={{ columns: ['Day', 'p50 (ms)', 'p95 (ms)', 'Timed requests'], rows: d.map((x) => [x.day, x.p50_ms, x.p95_ms, x.samples]) }}
    >
      <LineChart
        ariaLabel="Daily p50 and p95 latency"
        labels={d.map((x) => x.day.slice(5))}
        format={(v) => fmt.ms(v) || ''}
        series={[
          { key: 'p50', label: 'p50', color: 'var(--zq-fg-muted)', values: d.map((x) => x.p50_ms) },
          { key: 'p95', label: 'p95', color: 'var(--zq-accent)', values: d.map((x) => x.p95_ms) },
        ]}
      />
    </ChartContainer>
  );
}

function ExpensiveWorkflows({ cc }: { cc: CommandCenter }) {
  const rows = cc.observed.by_workflow;
  return (
    <ChartContainer title="Where the money goes" description="Known spend by workflow (or call site when no workflow is recorded)." unit="USD" range={`Last ${cc.range.days} days`} source="engine traces" claims={['OBSERVED']} empty={!rows.length} table={{ columns: ['Workflow', 'Requests', 'Known spend', 'Share of known spend'], rows: rows.map((r) => [r.workflow, r.requests, r.spend_usd, r.share]) }}>
      <HBarChart ariaLabel="Known spend by workflow" rows={rows.slice(0, 8).map((r) => ({ label: r.workflow, value: r.spend_usd, sub: `${r.requests.toLocaleString()} requests${r.share !== null ? ` · ${fmt.pct(r.share, 0)} of known spend` : ''}` }))} format={(v) => fmt.usd(v) || ''} />
    </ChartContainer>
  );
}

function ModelMix({ cc }: { cc: CommandCenter }) {
  const rows = cc.observed.by_model;
  const hhi = spendConcentration(cc);
  return (
    <ChartContainer title="Model and provider concentration" description={hhi === null ? 'Spend share per model. Concentration is unknown until cost is known.' : `Spend concentration (HHI) ${hhi.toFixed(2)} — 1.00 means every dollar goes to one model.`} unit="USD" range={`Last ${cc.range.days} days`} source="engine traces" claims={['OBSERVED']} empty={!rows.length} table={{ columns: ['Provider', 'Model', 'Requests', 'Known spend', 'p50 ms', 'p95 ms'], rows: rows.map((r) => [r.provider, r.model, r.requests, r.spend_usd, r.p50_ms, r.p95_ms]) }}>
      <HBarChart ariaLabel="Known spend by model" rows={rows.slice(0, 8).map((r) => ({ label: `${r.provider} / ${r.model}`, value: r.spend_usd, sub: `${r.requests.toLocaleString()} requests · p95 ${fmt.ms(r.p95_ms) ?? 'unknown'}` }))} format={(v) => fmt.usd(v) || ''} />
    </ChartContainer>
  );
}

function workloadColumns(open: (id: string, href: string) => void, mode: 'cto' | 'developer'): Array<Column<ProductCard>> {
  const cols: Array<Column<ProductCard>> = [
    {
      key: 'name',
      header: 'Workload',
      sort: (p) => p.name,
      className: 'min-w-[180px]',
      cell: (p) => (
        <button type="button" className="text-left font-medium text-ink hover:text-accent-text" onClick={() => open(p.id, '/app/optimize')}>
          <span className="block max-w-[260px] break-words">{p.name}</span>
          {p.synthetic && <ClaimBadge claim="SYNTHETIC" size="xs" className="mt-1" />}
        </button>
      ),
    },
    { key: 'cpso', header: 'Cost / success', align: 'right', nowrap: true, sort: (p) => p.baseline?.cpso_usd, cell: (p) => (p.baseline ? orUnknown(fmt.usd(p.baseline.cpso_usd), p.baseline.cpso_unavailable.join('; ')) : <span className="text-subtle">no baseline</span>) },
    { key: 'p95', header: 'p95', align: 'right', nowrap: true, sort: (p) => p.baseline?.p95_ms, cell: (p) => (p.baseline ? orUnknown(fmt.ms(p.baseline.p95_ms)) : '—') },
    { key: 'success', header: 'Task success', align: 'right', nowrap: true, sort: (p) => p.baseline?.task_success, cell: (p) => (p.baseline ? orUnknown(fmt.pct(p.baseline.task_success)) : '—') },
    { key: 'failure', header: 'Failures', align: 'right', nowrap: true, sort: (p) => p.baseline?.failure_rate, cell: (p) => (p.baseline ? orUnknown(fmt.pct(p.baseline.failure_rate)) : '—') },
    { key: 'evidence', header: 'Evidence', nowrap: true, cell: (p) => (p.baseline ? <ClaimBadge claim={p.baseline.completeness === 'complete' ? 'OBSERVED' : 'INCOMPLETE'} label={p.baseline.completeness === 'complete' ? 'COMPLETE' : 'INCOMPLETE'} size="xs" /> : <span className="text-subtle">—</span>) },
    { key: 'search', header: 'Plans', nowrap: true, cell: (p) => (p.search ? <span className="font-mono text-[12px]">{p.search.verified} verified · {p.search.frontier} frontier</span> : <span className="text-subtle">no search</span>) },
  ];
  if (mode === 'developer') {
    cols.push({ key: 'hash', header: 'Contract / snapshot', cell: (p) => (p.baseline ? <span className="flex flex-col gap-1"><CopyableHash value={p.baseline.contract_hash} label="contract hash" chars={8} /><CopyableHash value={p.baseline.snapshot_hash} label="snapshot hash" chars={8} /></span> : '—') });
  }
  return cols;
}

function Kpis({ cc, mode }: { cc: CommandCenter; mode: 'ceo' | 'cto' | 'developer' }) {
  const o = cc.observed;
  const main = primaryWorkload(cc);
  const b = main?.baseline || null;
  const sel = main?.decision?.selected_plan || null;
  const range = `last ${cc.range.days} days`;
  const asOf = b ? new Date(b.created_at).toISOString().slice(0, 10) : null;
  const baselineSource = main ? `Baseline · ${main.name}` : 'No workload';
  const spend = <MetricCard key="spend" label="AI spend" claim="OBSERVED" value={fmt.usd(o.spend_usd)} unit={`USD, known cost, ${range}`} source="Recorded requests" coverage={coverage(o.cost_known, o.requests)} unknownReason="No request in this range has a known cost." href="/app/workloads" emphasis={mode === 'ceo'} />;
  const cpso = <MetricCard key="cpso" label="Cost per successful outcome" claim={b ? 'OBSERVED' : 'UNKNOWN'} value={b ? fmt.usd(b.cpso_usd) : null} unit="USD per successful outcome" source={baselineSource} asOf={asOf} unknownReason={b?.cpso_unavailable.join('; ') || 'Needs a Verified Performance baseline.'} delta={sel ? lowerIsBetter(sel.deltas_pct.cost_per_successful_outcome) : null} note={sel ? 'Change shown is EVALUATED for the selected plan, not realized.' : undefined} href="/app/optimize" emphasis={mode === 'ceo'} />;
  const p95 = <MetricCard key="p95" label="p95 latency" claim={o.latency.samples ? 'OBSERVED' : 'UNKNOWN'} value={fmt.ms(o.latency.p95_ms)} unit={`per request, ${range}`} source="Recorded requests" coverage={coverage(o.latency.samples, o.requests)} unknownReason="No timed requests in this range." href="/app/graph" />;
  const success = <MetricCard key="success" label="Task success" claim={b ? 'OBSERVED' : 'UNKNOWN'} value={b ? fmt.pct(b.task_success) : null} unit="share of requests with a known outcome" source={baselineSource} coverage={b ? `${b.task_success_known} outcomes known` : null} unknownReason="Success is unknown without labelled outcomes — never assumed." href="/app/evidence" />;
  const reliability = <MetricCard key="rel" label="Failure rate" claim={b ? 'OBSERVED' : 'UNKNOWN'} value={b ? fmt.pct(b.failure_rate) : null} unit="failed requests" source={baselineSource} note={b && b.retry_amplification !== null ? `Retry amplification ${b.retry_amplification.toFixed(2)}×` : undefined} href="/app/diagnoses" />;
  const coverageCard = <MetricCard key="cov" label="Evaluation coverage" claim="EVALUATED" value={`${cc.pipeline.baselines} of ${cc.pipeline.workloads}`} unit="workloads with a baseline under a frozen contract" note={`${cc.verdicts.total} verdicts so far: ${cc.verdicts.VERIFIED} VERIFIED · ${cc.verdicts.REJECTED} REJECTED · ${cc.verdicts.INCOMPLETE} INCOMPLETE`} href="/app/evidence" />;
  const verified = <MetricCard key="ver" label="VERIFIED plans" claim="VERIFIED" value={cc.pipeline.verified.toLocaleString()} unit="passed every gate on replay (not deployed)" note={`${cc.pipeline.frontier} on a Pareto frontier · ${cc.pipeline.selected} selected`} href="/app/optimize" />;
  const p50 = <MetricCard key="p50" label="p50 latency" claim={o.latency.samples ? 'OBSERVED' : 'UNKNOWN'} value={fmt.ms(o.latency.p50_ms)} unit={`per request, ${range}`} source="Recorded requests" href="/app/graph" />;
  const p99 = <MetricCard key="p99" label="p99 latency" claim={o.latency.p99_ms !== null ? 'OBSERVED' : 'UNKNOWN'} value={fmt.ms(o.latency.p99_ms)} unit={`per request, ${range}`} unknownReason={o.latency.p99_note || 'No timed requests.'} source="Recorded requests" />;
  const ttft = <MetricCard key="ttft" label="Time to first token (p95)" claim={o.ttft.samples ? 'OBSERVED' : 'UNKNOWN'} value={fmt.ms(o.ttft.p95_ms)} unit="streaming requests" coverage={coverage(o.ttft.samples, o.requests)} unknownReason="No request recorded a first-token time." />;
  const hhi = spendConcentration(cc);
  const conc = <MetricCard key="hhi" label="Spend concentration" claim={hhi === null ? 'UNKNOWN' : 'OBSERVED'} value={hhi === null ? null : hhi.toFixed(2)} unit="HHI across models (1.00 = one model)" unknownReason="Needs known cost per model." source={`${o.by_model.length} model${o.by_model.length === 1 ? '' : 's'} seen`} />;
  const protectedCard = <MetricCard key="prot" label="Protected cases" claim={b?.protected ? 'OBSERVED' : 'UNKNOWN'} value={b?.protected ? `${b.protected.failed} failing` : null} unit={b?.protected ? `of ${b.protected.requests} protected requests (${b.protected.outcome_known} with known outcome)` : 'requests that must never regress'} unknownReason="No protected cases recorded." href="/app/evidence" />;

  const set = mode === 'ceo' ? [spend, cpso, p95, success, coverageCard, verified] : mode === 'cto' ? [p50, p95, p99, reliability, conc, protectedCard, ttft, coverageCard] : [p95, p99, ttft, reliability, cpso, verified];
  return <div className={cn('grid gap-3', mode === 'ceo' ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4')}>{set}</div>;
}

function DeveloperDetail({ cc, open }: { cc: CommandCenter; open: (id: string, href: string) => void }) {
  const hotspots = cc.products.flatMap((p) => (p.baseline?.hotspots || []).map((h) => ({ ...h, product: p })));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Diagnoses" description="Highest severity first. Open one to see the affected nodes, source evidence and candidate plans." action={<EvidenceLink to="/app/diagnoses">All diagnoses</EvidenceLink>} />
        <ul className="divide-y divide-line px-5 pb-3">
          {cc.products.flatMap((p) => p.diagnoses.top.map((d) => ({ d, p }))).slice(0, 8).map(({ d, p }) => (
            <li key={d.id} className="py-2.5">
              <button type="button" onClick={() => open(p.id, `/app/diagnoses?diagnosis=${d.id}`)} className="w-full text-left">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase', d.severity === 'high' ? 'bg-rejected-bg text-rejected' : d.severity === 'medium' ? 'bg-warning-bg text-warning' : 'bg-sunken text-muted')}>{d.severity}</span>
                  <span className="font-mono text-[11.5px] text-muted">{d.family}</span>
                  <span className="font-mono text-[11px] text-subtle">· {d.affected_nodes} node{d.affected_nodes === 1 ? '' : 's'}</span>
                </span>
                <span className="mt-1 block text-[13px] text-ink">{d.symptom}</span>
              </button>
            </li>
          ))}
          {!cc.products.some((p) => p.diagnoses.count) && <li className="py-4 text-[12.5px] text-muted">No diagnoses yet. Build a baseline, then run diagnoses from Optimization.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Latency hotspots" description="Where request time is spent, from the baseline's critical-path analysis." action={<EvidenceLink to="/app/graph">Open the graph</EvidenceLink>} />
        <div className="px-5 pb-4">
          {hotspots.length ? (
            <DataTable
              caption="Latency hotspots"
              captionHidden
              rowKey={(h) => `${h.product.id}-${h.kind}-${h.name}`}
              rows={hotspots.slice(0, 8)}
              columns={[
                { key: 'node', header: 'Node', cell: (h) => <span className="font-mono text-[12px]">{h.kind}{h.name ? ` · ${h.name}` : ''}</span> },
                { key: 'p95', header: 'p95', align: 'right', nowrap: true, cell: (h) => orUnknown(fmt.ms(h.p95_ms)) },
                { key: 'share', header: 'Share of request', align: 'right', nowrap: true, cell: (h) => orUnknown(fmt.pct(h.mean_share_of_root, 0)) },
                { key: 'cp', header: 'On critical path', align: 'right', nowrap: true, cell: (h) => `${h.critical_path_graphs} graph${h.critical_path_graphs === 1 ? '' : 's'}` },
              ]}
            />
          ) : (
            <p className="text-[12.5px] text-muted">
              {cc.products.find((p) => p.baseline?.critical_path.incomplete_reasons.length)?.baseline?.critical_path.incomplete_reasons.join('; ') || 'No critical path yet: it needs a baseline with complete start and end times on every node. ZEVQORA never invents one from partial timing.'}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function ModeIntro({ mode }: { mode: 'ceo' | 'cto' | 'developer' }) {
  const m = MODES.find((x) => x.value === mode)!;
  return (
    <p className="mt-1 text-[12.5px] text-muted">
      <b className="font-medium text-ink">{m.label} view</b> — {m.description}. Views change emphasis only; your workspace role decides what you can see and do.
    </p>
  );
}

export default function CommandCenterView() {
  const { activeWorkspace } = useSession();
  const { mode, setMode } = usePresentationMode();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const open = useOpenWorkload();
  const wsId = activeWorkspace?.id || '';
  const { data: cc, error, loading, reload } = useAsync(() => experienceApi.commandCenter(wsId, Number(days)), [wsId, days], { enabled: Boolean(wsId) });
  useEffect(() => {
    document.title = 'Command Center — ZEVQORA';
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-6 lg:px-8 lg:py-8">
      <ViewHeader
        eyebrow={activeWorkspace?.name}
        title="Command Center"
        actions={
          <>
            <SegmentedControl label="Presentation view" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: m.label, title: m.description }))} />
            <SegmentedControl label="Range" value={days} onChange={setDays} options={DAY_OPTIONS.map((d) => ({ ...d }))} />
            <Button variant="ghost" size="sm" onClick={() => void reload()} aria-label="Refresh">
              <RefreshCw size={14} aria-hidden />
            </Button>
          </>
        }
      >
        <ModeIntro mode={mode} />
      </ViewHeader>

      {loading && !cc && <LoadingState label="Loading the Command Center" rows={5} />}
      {error && <ErrorState message={error} onRetry={() => void reload()} />}

      {cc && cc.products.length === 0 && (
        <EmptyState
          zev="pose-waving"
          title="Connect your first AI workload"
          description="ZEVQORA needs recorded execution evidence before it can measure anything. Import an OpenTelemetry or OpenInference export, a trace file, or load the clearly labelled synthetic demo."
          action={
            <>
              <ButtonLink to="/app/connections"><Plug size={14} aria-hidden /> Connect evidence</ButtonLink>
              <ButtonLink to="/app/onboarding" variant="secondary">Guided setup</ButtonLink>
            </>
          }
        />
      )}

      {cc && cc.products.length > 0 && (
        <div className="flex flex-col gap-6">
          {cc.synthetic && <InlineNotice tone="warning"><b>SYNTHETIC DEMO — NOT CUSTOMER DATA.</b> At least one workload here is the labelled demo. Its numbers illustrate the product; they are not results.</InlineNotice>}
          {cc.observed.truncated && <InlineNotice tone="info">This window holds more than {cc.observed.trace_limit.toLocaleString()} requests; observed figures use the most recent {cc.observed.trace_limit.toLocaleString()}.</InlineNotice>}

          <Kpis cc={cc} mode={mode} />

          {mode === 'ceo' && (
            <>
              <section aria-labelledby="value-h">
                <h2 id="value-h" className="mb-3 text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">Value — evaluated, projected, realized</h2>
                <ValueStrip cc={cc} />
              </section>
              <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
                <Card>
                  <CardHeader title="What to approve next" description="Ordered by what unblocks a decision soonest." />
                  <div className="px-5 pb-3"><DecisionQueue items={cc.decision_queue} onOpen={open} /></div>
                </Card>
                <ExpensiveWorkflows cc={cc} />
              </div>
              <SpendChart cc={cc} />
              <Card>
                <CardHeader title="Optimization pipeline" description="From recorded evidence to a selected VERIFIED plan." />
                <div className="px-5 pb-4"><Pipeline p={cc.pipeline} /></div>
              </Card>
            </>
          )}

          {mode === 'cto' && (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <LatencyChart cc={cc} />
                <ModelMix cc={cc} />
              </div>
              <Card>
                <CardHeader title="Workloads" description="Baseline health per workload under its frozen contract. Sort any column; unknown sorts last." />
                <div className="px-5 pb-4"><DataTable caption="Workload comparison" captionHidden rows={cc.products} rowKey={(p) => p.id} columns={workloadColumns(open, 'cto')} minWidth={860} /></div>
              </Card>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader title="Top technical risks" description="Each one comes from a baseline snapshot you can open." />
                  <div className="px-5 pb-3"><RiskList risks={cc.risks} products={cc.products} /></div>
                </Card>
                <Card>
                  <CardHeader title="Why these plans" description="Selected plans, the policy that chose them, and the alternatives that also passed." />
                  <div className="space-y-4 px-5 pb-4">
                    {cc.products.filter((p) => p.search).map((p) => (
                      <div key={p.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                        {p.decision?.selected_plan ? <EvaluatedPlanLine plan={{ ...p.decision.selected_plan, product: p.name, policy: p.decision.policy }} /> : <p className="text-[12.5px] text-muted">{p.name}: no plan selected yet.</p>}
                        <p className="mt-1 text-[11.5px] text-subtle">{p.search!.verified} VERIFIED · {p.search!.frontier} on the frontier · {p.search!.rejected} REJECTED · {p.search!.blocked} blocked or not replayable</p>
                        <button type="button" onClick={() => open(p.id, '/app/optimize#step-frontier')} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent-text">Compare plans <ArrowRight size={12} aria-hidden /></button>
                      </div>
                    ))}
                    {!cc.products.some((p) => p.search) && <p className="text-[12.5px] text-muted">No plan search has run yet.</p>}
                  </div>
                </Card>
              </div>
              <Card>
                <CardHeader title="Optimization pipeline" />
                <div className="px-5 pb-4"><Pipeline p={cc.pipeline} /></div>
              </Card>
            </>
          )}

          {mode === 'developer' && (
            <>
              <DeveloperDetail cc={cc} open={open} />
              <Card>
                <CardHeader title="Workloads and provenance" description="Contract and snapshot hashes identify exactly what every verdict was measured against." />
                <div className="px-5 pb-4"><DataTable caption="Workloads with provenance" captionHidden rows={cc.products} rowKey={(p) => p.id} columns={workloadColumns(open, 'developer')} minWidth={1000} /></div>
              </Card>
              <div className="grid gap-4 xl:grid-cols-2">
                <LatencyChart cc={cc} />
                <ModelMix cc={cc} />
              </div>
              <Card>
                <CardHeader title="Jump to evidence" />
                <div className="flex flex-wrap gap-2 px-5 pb-4">
                  <ButtonLink to="/app/graph" variant="secondary" size="sm"><GitBranch size={13} aria-hidden /> Execution graph</ButtonLink>
                  <ButtonLink to="/app/diagnoses" variant="secondary" size="sm">Diagnoses</ButtonLink>
                  <ButtonLink to="/app/optimize" variant="secondary" size="sm">Plan search & replay</ButtonLink>
                  <ButtonLink to="/app/evidence" variant="secondary" size="sm">Evidence ledger</ButtonLink>
                  <Link to="/app/optimize#step-report" className="inline-flex h-8 items-center px-2 text-[12.5px] font-medium text-accent-text">Developer report →</Link>
                </div>
              </Card>
            </>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[11.5px] text-subtle">
            <span className="inline-flex items-center gap-2"><ZevFace expression="calm-confidence" size={24} /> Zev only reports what the evidence supports. Unknown stays unknown.</span>
            <span>{freshness(cc)}</span>
          </footer>
        </div>
      )}
    </div>
  );
}
