import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Plug } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { app } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import { Bars, ShareBars } from '@/components/ui/Charts';
import { StatusChip, LiveDot } from '@/components/ui/StatusChip';
import { Tabs, Table, Th, Td } from '@/components/ui/Misc';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Button, ButtonLink } from '@/components/ui/Button';
import { money, compactNum, ms, relativeTime, dateTime } from '@/lib/format';

function liveStatus(lastSeen: string | null): 'live' | 'idle' | 'stale' | 'waiting' {
  if (!lastSeen) return 'waiting';
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < 5 * 60_000) return 'live';
  if (age < 24 * 60 * 60_000) return 'idle';
  return 'stale';
}

export default function RuntimePage() {
  const { activeWorkspace } = useSession();
  const { projects, activeProject, loading } = useProjects();
  const project = activeProject || projects[0] || null;
  const [window, setWindow] = useState<'1h' | '24h' | '7d' | '30d'>('24h');
  const q = useAsync(() => app.runtime(project!.id, window), [project?.id, window], { enabled: Boolean(project) });
  const r = q.data;

  // Gentle polling while the page is open: reasonable, not aggressive.
  useEffect(() => {
    if (!project) return;
    const id = setInterval(() => void q.reload(true), 30_000);
    return () => clearInterval(id);
  }, [project, q]);

  if (!loading && !project) {
    return (
      <>
        <PageHeader eyebrow={activeWorkspace?.name} title="Live Runtime" />
        <EmptyState title="No project selected" description="Create a project, then connect a runtime to see live telemetry." action={<ButtonLink to="/app/projects?new=1">Add a project</ButtonLink>} />
      </>
    );
  }

  const status = liveStatus(r?.totals.last_seen || null);
  return (
    <>
      <PageHeader
        eyebrow={project?.name}
        title={<span className="inline-flex items-center gap-3">Live Runtime {r && <LiveDot status={status} />}</span>}
        description={r ? (r.totals.last_seen ? `Last trace ${relativeTime(r.totals.last_seen)} · ${r.totals.requests_per_min_5m.toFixed(1)} req/min over the last 5 minutes` : 'Waiting for telemetry.') : 'Loading…'}
        actions={
          <>
            <Tabs value={window} onChange={setWindow} items={[{ value: '1h', label: '1h' }, { value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }]} />
            <Button variant="secondary" size="sm" onClick={() => q.reload(true)}><RefreshCw size={14} /></Button>
          </>
        }
      />
      {q.error && !r && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!r ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
      ) : !r.connections.some((c) => c.status === 'active') ? (
        <EmptyState title="No runtime connected" description="Create a telemetry connection for this project. The token is scoped, hashed at rest and revocable." zev="pose-thinking" action={<ButtonLink to="/app/connections?new=1"><Plug size={14} /> Connect runtime</ButtonLink>} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Panel tone="glass-strong" className="p-5"><Metric label="Status" raw={<span className="inline-flex items-center gap-2"><LiveDot status={status} /><span className="text-h3 capitalize">{status === 'waiting' ? 'Waiting' : status}</span></span>} hint={r.totals.last_seen ? `last seen ${dateTime(r.totals.last_seen)}` : 'Waiting for telemetry.'} /></Panel>
            <Panel className="p-5"><Metric label="Requests" value={r.totals.requests} format={(v) => compactNum(Math.round(v))} hint={`${r.totals.errors} errors · ${r.totals.errors_5m} in last 5 min`} /></Panel>
            <Panel className="p-5"><Metric label="Cost" value={r.totals.cost_usd} format={(v) => money(v)} hint={`${compactNum(r.totals.input_tokens)} in · ${compactNum(r.totals.output_tokens)} out tokens`} /></Panel>
            <Panel className="p-5"><Metric label="Latency" raw={<span className="text-metric tnum">{ms(r.totals.latency_p50_ms)}</span>} hint={`p95 ${ms(r.totals.latency_p95_ms)} · ${r.totals.samples} samples captured`} /></Panel>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Panel>
              <PanelHeader title="Requests per day" description={`${r.window_hours}h window`} />
              <div className="p-5">{r.daily.length ? <Bars values={r.daily.map((d) => d.requests)} labels={r.daily.map((d) => d.day)} format={(v) => `${v} requests`} /> : <p className="text-technical text-subtle">Waiting for telemetry.</p>}</div>
            </Panel>
            <Panel>
              <PanelHeader title="Providers" />
              <div className="p-5"><ShareBars rows={r.providers.map((p) => ({ label: p.provider, value: p.cost_usd, sub: `${compactNum(p.requests)} requests · ${p.errors} errors` }))} format={(v) => money(v)} /></div>
            </Panel>
          </div>
          <Panel className="mt-4 p-2">
            <PanelHeader title="Models" description="Cost, tokens and latency per model in the window." className="px-3" action={r.open_opportunities ? <Link to="/app/opportunities" className="text-caption text-accent-text underline-offset-4 hover:underline">{r.open_opportunities} open opportunities</Link> : undefined} />
            <Table minWidth={760}>
              <thead><tr><Th>Model</Th><Th align="right">Requests</Th><Th align="right">Errors</Th><Th align="right">Cost</Th><Th align="right">In / out tokens</Th><Th align="right">p50 / p95</Th><Th align="right">Samples</Th></tr></thead>
              <tbody>
                {r.models.map((m) => (
                  <tr key={m.model}>
                    <Td mono>{m.model}<div className="text-subtle">{m.provider}</div></Td>
                    <Td align="right" mono>{compactNum(m.requests)}</Td>
                    <Td align="right" mono>{m.errors}</Td>
                    <Td align="right" mono>{money(m.cost_usd)}</Td>
                    <Td align="right" mono>{compactNum(m.input_tokens)} / {compactNum(m.output_tokens)}</Td>
                    <Td align="right" mono>{ms(m.latency_p50_ms)} / {ms(m.latency_p95_ms)}</Td>
                    <Td align="right" mono>{m.samples}</Td>
                  </tr>
                ))}
                {!r.models.length && <tr><Td className="text-subtle" colSpan={7}>Waiting for telemetry.</Td></tr>}
              </tbody>
            </Table>
          </Panel>
          <Panel className="mt-4 p-2">
            <PanelHeader title="Recent traces" description="Metadata only. Samples, when captured, stay in the evidence store." className="px-3" />
            <Table minWidth={860}>
              <thead><tr><Th>Trace</Th><Th>Model</Th><Th>Operation</Th><Th>Status</Th><Th align="right">Tokens</Th><Th align="right">Latency</Th><Th align="right">Cost</Th><Th>Sample</Th></tr></thead>
              <tbody>
                {r.recent.map((t) => (
                  <tr key={t.id}>
                    <Td mono><span className="text-ink">{t.trace_id || t.span_id || t.id.slice(0, 8)}</span><div className="text-subtle">{dateTime(t.occurred_at)}</div></Td>
                    <Td mono>{t.model}</Td>
                    <Td mono>{t.operation}</Td>
                    <Td><StatusChip status={t.status === 'ok' ? 'completed' : 'error'} label={t.status.toUpperCase()} />{t.error_class && <div className="text-technical mt-1 text-subtle">{t.error_class}</div>}</Td>
                    <Td align="right" mono>{t.input_tokens ?? '—'} / {t.output_tokens ?? '—'}</Td>
                    <Td align="right" mono>{ms(t.latency_ms)}</Td>
                    <Td align="right" mono>{money(t.cost_usd, { digits: 6 })}<div className="text-subtle">{t.cost_source === 'pricing_snapshot_estimate' ? 'estimate' : t.cost_source === 'provider_reported' ? 'reported' : t.cost_source}</div></Td>
                    <Td mono>{t.has_sample ? 'captured' : '—'}</Td>
                  </tr>
                ))}
                {!r.recent.length && <tr><Td className="text-subtle" colSpan={8}>Waiting for your first trace.</Td></tr>}
              </tbody>
            </Table>
          </Panel>
        </>
      )}
    </>
  );
}
