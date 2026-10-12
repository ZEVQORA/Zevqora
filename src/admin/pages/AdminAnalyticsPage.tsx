import { useState } from 'react';
import { useAsync } from '@/lib/useAsync';
import { dateTime } from '@/lib/format';
import { StatTile } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { SegmentedControl } from '@/components/ui/Segmented';
import { ErrorState, InlineNotice, LoadingState } from '@/components/ui/States';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { LineChart } from '@/components/charts/LineChart';
import { ColumnChart, FunnelChart, HBarChart } from '@/components/charts/Bars';
import { adminV3, type SiteSummary } from '../data-v3';
import { AdminHeader, SourceLine, useRange } from '../shared';

type Tab = 'overview' | 'traffic' | 'acquisition' | 'pages' | 'conversions' | 'geography' | 'devices' | 'campaigns' | 'signals';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'pages', label: 'Pages' },
  { value: 'conversions', label: 'Conversions' },
  { value: 'geography', label: 'Geography' },
  { value: 'devices', label: 'Devices' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'signals', label: 'Security signals' },
];

function Body({ d, tab, label }: { d: SiteSummary; tab: Tab; label: string }) {
  const common = { range: label, source: 'site_events (first-party)', updatedAt: d.meta.generated_at, claims: ['OBSERVED' as const] };
  const t = d.totals;
  const days = d.daily.map((x) => x.day.slice(5));
  switch (tab) {
    case 'overview':
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Pageviews" value={t.pageviews.toLocaleString()} />
            <StatTile label="Sessions" value={t.sessions.toLocaleString()} hint="per-tab, cookieless" />
            <StatTile label="Visitors" value={t.visitor_days.toLocaleString()} hint="daily unique, summed" />
            <StatTile label="CTA clicks" value={t.cta_clicks.toLocaleString()} />
            <StatTile label="Signups started" value={t.signups_started.toLocaleString()} tone="accent" />
            <StatTile label="Evaluation requests" value={t.evaluations_submitted.toLocaleString()} tone="verified" />
          </div>
          <ChartContainer title="Pageviews and visitors per day" unit="count per UTC day" {...common} empty={!d.daily.length} table={{ columns: ['Day', 'Pageviews', 'Visitors', 'Sessions'], rows: d.daily.map((x) => [x.day, x.pageviews, x.visitors, x.sessions]) }}>
            <LineChart ariaLabel="Daily pageviews and visitors" labels={days} format={(v) => String(Math.round(v))} series={[{ key: 'pv', label: 'Pageviews', color: 'var(--zq-accent)', values: d.daily.map((x) => x.pageviews) }, { key: 'v', label: 'Visitors', color: 'var(--zq-fg-muted)', values: d.daily.map((x) => x.visitors) }]} />
          </ChartContainer>
          <p className="text-[11.5px] text-subtle">{d.meta.visitors_definition} Days with no events are absent from the series, not zero-filled.</p>
        </div>
      );
    case 'traffic':
      return (
        <ChartContainer title="Sessions per day" unit="sessions per UTC day" {...common} empty={!d.daily.length} table={{ columns: ['Day', 'Sessions'], rows: d.daily.map((x) => [x.day, x.sessions]) }}>
          <ColumnChart ariaLabel="Daily sessions" labels={days} values={d.daily.map((x) => x.sessions)} format={(v) => String(Math.round(v))} />
        </ChartContainer>
      );
    case 'acquisition':
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartContainer title="Referrers (landing session)" unit="sessions" {...common} empty={!d.referrers.length} table={{ columns: ['Referrer', 'Sessions'], rows: d.referrers.map((r) => [r.referrer, r.sessions]) }}>
            <HBarChart ariaLabel="Sessions by referrer" rows={d.referrers.slice(0, 10).map((r) => ({ label: r.referrer, value: r.sessions }))} format={(v) => String(v)} />
          </ChartContainer>
          <ChartContainer title="Landing pages" unit="sessions" {...common} empty={!d.landing_pages.length} table={{ columns: ['Landing page', 'Sessions', 'Converted'], rows: d.landing_pages.map((r) => [r.path, r.sessions, r.converted]) }}>
            <HBarChart ariaLabel="Sessions by landing page" rows={d.landing_pages.slice(0, 10).map((r) => ({ label: r.path, value: r.sessions, sub: `${r.converted} converted (signup or evaluation)` }))} format={(v) => String(v)} />
          </ChartContainer>
        </div>
      );
    case 'pages':
      return (
        <DataTable caption={`Top pages · ${label}`} rows={d.pages} rowKey={(r) => r.path} minWidth={420} initialSort={{ key: 'pv', dir: 'desc' }} empty="No pageviews in this range." columns={[
          { key: 'path', header: 'Path', cell: (r) => <span className="font-mono text-[12.5px]">{r.path}</span>, sort: (r) => r.path },
          { key: 'pv', header: 'Pageviews', align: 'right', cell: (r) => r.pageviews, sort: (r) => r.pageviews },
          { key: 's', header: 'Sessions', align: 'right', cell: (r) => r.sessions, sort: (r) => r.sessions },
        ]} />
      );
    case 'conversions':
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartContainer title="Conversion funnel" unit="sessions" {...common} empty={!d.funnel.sessions}>
            <FunnelChart ariaLabel="Website conversion funnel" steps={[{ key: 's', label: 'Sessions', value: d.funnel.sessions }, { key: 'c', label: 'Clicked a CTA', value: d.funnel.cta }, { key: 'u', label: 'Started signup', value: d.funnel.signup_started }, { key: 'e', label: 'Requested evaluation', value: d.funnel.evaluation_submitted }]} />
          </ChartContainer>
          <ChartContainer title="CTA clicks" unit="clicks" {...common} empty={!d.ctas.length} table={{ columns: ['CTA', 'Clicks', 'Sessions'], rows: d.ctas.map((c) => [c.cta, c.clicks, c.sessions]) }}>
            <HBarChart ariaLabel="Clicks by CTA" rows={d.ctas.map((c) => ({ label: c.cta, value: c.clicks, sub: `${c.sessions} sessions` }))} format={(v) => String(v)} />
          </ChartContainer>
        </div>
      );
    case 'geography':
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartContainer title="Countries" description={d.meta.geo_note} unit="sessions" {...common} empty={!d.countries.length} table={{ columns: ['Country', 'Sessions'], rows: d.countries.map((c) => [c.country, c.sessions]) }}>
            <HBarChart ariaLabel="Sessions by country" rows={d.countries.slice(0, 12).map((c) => ({ label: c.country === '??' ? 'Unknown' : c.country, value: c.sessions }))} format={(v) => String(v)} />
          </ChartContainer>
          <ChartContainer title="Regions" description="Where the edge reported one." unit="sessions" {...common} empty={!d.regions.length} emptyText="No region was reported for sessions in this range." table={{ columns: ['Country', 'Region', 'Sessions'], rows: d.regions.map((r) => [r.country, r.region, r.sessions]) }}>
            <HBarChart ariaLabel="Sessions by region" rows={d.regions.slice(0, 12).map((r) => ({ label: `${r.region}, ${r.country}`, value: r.sessions }))} format={(v) => String(v)} />
          </ChartContainer>
        </div>
      );
    case 'devices':
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartContainer title="Device category" unit="sessions" {...common} empty={!d.devices.length}>
            <HBarChart ariaLabel="Sessions by device" rows={d.devices.map((x) => ({ label: x.device, value: x.sessions }))} format={(v) => String(v)} />
          </ChartContainer>
          <ChartContainer title="Browser family" unit="sessions" {...common} empty={!d.browsers.length}>
            <HBarChart ariaLabel="Sessions by browser" rows={d.browsers.map((x) => ({ label: x.browser, value: x.sessions }))} format={(v) => String(v)} />
          </ChartContainer>
        </div>
      );
    case 'campaigns':
      return (
        <DataTable caption={`UTM campaigns (landing session) · ${label}`} rows={d.campaigns} rowKey={(r) => `${r.source}|${r.medium}|${r.campaign}`} minWidth={640} empty="No campaign traffic in this range." columns={[
          { key: 'src', header: 'Source', cell: (r) => r.source, sort: (r) => r.source },
          { key: 'med', header: 'Medium', cell: (r) => r.medium },
          { key: 'cmp', header: 'Campaign', cell: (r) => r.campaign },
          { key: 's', header: 'Sessions', align: 'right', cell: (r) => r.sessions, sort: (r) => r.sessions },
          { key: 'c', header: 'Converted', align: 'right', cell: (r) => r.converted, sort: (r) => r.converted },
        ]} />
      );
    case 'signals':
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <StatTile label="Bot events (excluded)" value={d.signals.bot_events.toLocaleString()} />
            <StatTile label="Sessions with >200 events" value={d.signals.heavy_sessions.toLocaleString()} tone={d.signals.heavy_sessions ? 'warning' : 'default'} />
            <StatTile label="Most events in one session" value={d.signals.max_events_per_session.toLocaleString()} />
          </div>
          <DataTable caption="Recently recorded events — not live sessions" rows={d.recent} rowKey={(r) => `${r.occurred_at}-${r.path}-${r.event}`} minWidth={640} dense empty="No events recorded in this range." columns={[
            { key: 'at', header: 'Recorded', nowrap: true, cell: (r) => dateTime(r.occurred_at) },
            { key: 'ev', header: 'Event', cell: (r) => <span className="font-mono text-[12px]">{r.event}{r.cta ? ` · ${r.cta}` : ''}</span> },
            { key: 'p', header: 'Path', cell: (r) => <span className="font-mono text-[12px]">{r.path}</span> },
            { key: 'c', header: 'Country', cell: (r) => r.country || '—' },
            { key: 'd', header: 'Device', cell: (r) => r.device },
            { key: 'r', header: 'Referrer', cell: (r) => r.referrer || '(direct)' },
          ]} />
          <p className="text-[11.5px] text-subtle">Visitor analytics never store an IP address or full user agent. Source-level abuse signals (repeated failed logins, rate limits) live in Security.</p>
        </div>
      );
  }
}

export default function AdminAnalyticsPage() {
  const { range, setRange, query, label } = useRange();
  const [tab, setTab] = useState<Tab>('overview');
  const q = useAsync(() => adminV3.website(query), [query]);
  return (
    <>
      <AdminHeader title="Website analytics" description="First-party, cookieless: no cookies, no third-party scripts, no raw IP. Do Not Track and Global Privacy Control are respected, so totals undercount by design." range={range} onRange={setRange} />
      {q.data && <SourceLine source={q.data.meta.source} range={label} generatedAt={q.data.meta.generated_at} lastEventAt={q.data.meta.last_event_at} />}
      {q.data && !q.data.meta.collecting && <InlineNotice tone="warning" className="mb-4">Collection is off (<code>visitor_intelligence</code>). Figures below are only what was recorded while it was on.</InlineNotice>}
      {q.data && !q.data.meta.secret_configured && <InlineNotice tone="info" className="mb-4">ANALYTICS_SECRET is not configured: each server instance uses its own daily key, so visitor counts may be overstated.</InlineNotice>}
      <SegmentedControl label="Analytics section" value={tab} onChange={setTab} options={TABS} className="mb-4" />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !q.data && <LoadingState label="Loading website analytics" />}
      {q.data && <Body d={q.data} tab={tab} label={label} />}
    </>
  );
}
