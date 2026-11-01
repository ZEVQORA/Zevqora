import { useAsync } from '@/lib/useAsync';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { ErrorState, InlineNotice, LoadingState } from '@/components/ui/States';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { LineChart } from '@/components/charts/LineChart';
import { FunnelChart } from '@/components/charts/Bars';
import { adminV3 } from '../data-v3';
import { AdminHeader, SourceLine, useRange } from '../shared';

const hours = (h: number | null | undefined) => (h === null || h === undefined ? null : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

/** Product usage and the optimization business metrics, from first-party events and engine tables. */
export default function AdminProductAnalyticsPage() {
  const { range, setRange, query, label } = useRange();
  const p = useAsync(() => adminV3.product(query), [query]);
  const o = useAsync(() => adminV3.optimization(query), [query]);
  const d = p.data;
  const opt = o.data;
  return (
    <>
      <AdminHeader title="Product analytics" description="Typed product events (zevqora.product_event.v1) and engine tables. Optimization value stays EVALUATED; realized production savings are not measured." range={range} onRange={setRange} />
      {d && <SourceLine source={d.meta.source} range={label} generatedAt={d.meta.generated_at} lastEventAt={d.meta.last_event_at} />}
      {d && <InlineNotice tone="info" className="mb-4">{d.meta.backfill_note}</InlineNotice>}
      {p.error && <ErrorState message={p.error} onRetry={() => void p.reload()} />}
      {p.loading && !d && <LoadingState label="Loading product analytics" />}
      {d && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile label="Active users" value={d.active.users.toLocaleString()} hint={label} />
            <StatTile label="Active workspaces" value={d.active.workspaces.toLocaleString()} hint={label} />
            <StatTile label="Median time to first baseline" value={hours(d.time_to_first?.baseline_hours_median) ?? '—'} hint={`${d.time_to_first?.baseline_users ?? 0} users reached it`} />
            <StatTile label="Median time to first verified decision" value={hours(d.time_to_verified?.hours_median) ?? '—'} hint={`${d.time_to_verified?.users ?? 0} users reached it`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartContainer title="Activation funnel" description={d.meta.funnel_definition} unit="users (visitors for the first step)" range={label} source="site_events + product_events" claims={['OBSERVED']} empty={!d.funnel.signup && !d.funnel.visitor}>
              <FunnelChart ariaLabel="Product activation funnel" steps={d.funnel_steps.map((s) => ({ key: s.key, label: s.label, value: d.funnel[s.key] ?? null }))} />
            </ChartContainer>
            <ChartContainer title="Daily activity" unit="count per UTC day" range={label} source="product_events" claims={['OBSERVED']} empty={!d.daily.length} table={{ columns: ['Day', 'Events', 'Active users', 'Active workspaces'], rows: d.daily.map((x) => [x.day, x.events, x.active_users, x.active_workspaces]) }}>
              <LineChart ariaLabel="Daily active users and workspaces" labels={d.daily.map((x) => x.day.slice(5))} format={(v) => String(Math.round(v))} series={[{ key: 'u', label: 'Active users', color: 'var(--zq-accent)', values: d.daily.map((x) => x.active_users) }, { key: 'w', label: 'Active workspaces', color: 'var(--zq-fg-muted)', values: d.daily.map((x) => x.active_workspaces) }]} />
            </ChartContainer>
          </div>
          <Card>
            <CardHeader title="Weekly retention" description="Cohort = week of signup (UTC). A user is retained in week N if they recorded any product event other than signup that week. Future weeks are blank, not zero." />
            <div className="px-5 pb-4">
              <DataTable caption="Weekly retention cohorts" captionHidden rows={d.retention} rowKey={(r) => r.week} minWidth={720} empty="No signups in this range." columns={[
                { key: 'w', header: 'Cohort week', cell: (r) => r.week, nowrap: true },
                { key: 's', header: 'Users', align: 'right', cell: (r) => r.size },
                ...Array.from({ length: 8 }, (_, k) => ({ key: `w${k}`, header: `W${k}`, align: 'right' as const, cell: (r: { size: number; retained: number[] | null }) => (r.retained && r.retained[k] !== undefined ? `${Math.round((r.retained[k] / Math.max(1, r.size)) * 100)}%` : '') })),
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Event counts" description="Every event in the taxonomy, counted once per dedupe key." />
            <div className="px-5 pb-4">
              <DataTable caption="Product event counts" captionHidden rows={Object.entries(d.counts).map(([event, n]) => ({ event, n }))} rowKey={(r) => r.event} minWidth={360} initialSort={{ key: 'n', dir: 'desc' }} empty="No product events in this range." columns={[
                { key: 'e', header: 'Event', cell: (r) => <span className="font-mono text-[12.5px]">{r.event}</span>, sort: (r) => r.event },
                { key: 'n', header: 'Count', align: 'right', cell: (r) => r.n.toLocaleString(), sort: (r) => r.n },
              ]} />
            </div>
          </Card>
        </div>
      )}
      <h2 className="mb-3 mt-8 text-[1.05rem] font-semibold text-ink">Optimization metrics</h2>
      {o.error && <ErrorState message={o.error} onRetry={() => void o.reload()} />}
      {o.loading && !opt && <LoadingState label="Loading optimization metrics" />}
      {opt && (
        <div className="flex flex-col gap-4">
          {opt.meta.truncated && <InlineNotice tone="warning">Large range: plan or evaluation rows were capped; counts may be incomplete.</InlineNotice>}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Plan searches" value={opt.searches.total.toLocaleString()} hint={opt.searches.per_workspace === null ? 'no workspace searched' : `${opt.searches.per_workspace} per searching workspace`} />
            <StatTile label="Plans generated" value={opt.plans.total.toLocaleString()} />
            <StatTile label="VERIFIED plans" value={(opt.plans.by_verdict.VERIFIED || 0).toLocaleString()} tone="verified" />
            <StatTile label="REJECTED plans" value={(opt.plans.by_verdict.REJECTED || 0).toLocaleString()} tone="rejected" />
            <StatTile label="Acceptance rate" value={opt.acceptance_rate === null ? '—' : `${(opt.acceptance_rate * 100).toFixed(0)}%`} hint="selected ÷ VERIFIED plans" />
            <StatTile label="Replay provider spend" value={opt.replay_spend_usd === null ? '—' : `$${opt.replay_spend_usd.toFixed(4)}`} hint="from search spend records" />
          </div>
          <p className="text-[11.5px] text-subtle">{opt.replay_spend_note} Realized production savings: <b>NOT YET MEASURED</b> — {opt.realized_savings.reason}</p>
          <Card>
            <CardHeader title="Why candidates were rejected" description="First clause of each REJECTED evaluation's rejection reason." />
            <div className="px-5 pb-4">
              <DataTable caption="Rejection reasons" captionHidden rows={opt.evaluations.rejection_reasons} rowKey={(r) => r.reason} minWidth={360} empty="No rejections in this range." columns={[
                { key: 'r', header: 'Reason', cell: (r) => <span className="font-mono text-[12.5px]">{r.reason}</span> },
                { key: 'n', header: 'Evaluations', align: 'right', cell: (r) => r.n },
              ]} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
