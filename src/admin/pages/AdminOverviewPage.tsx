import { Link } from 'react-router';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader, KeyValue } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import { StatusChip } from '@/components/ui/StatusChip';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { money, dateTime, shortId, relativeTime } from '@/lib/format';

export default function AdminOverviewPage() {
  const q = useAsync(() => admin.overview(), []);
  const o = q.data;
  if (q.error && !o) return <ErrorState message={q.error} onRetry={() => q.reload()} />;
  const c = o?.counts || {};
  const cards: Array<[string, number | null, ((v: number) => string) | undefined, string | undefined]> = [
    ['Total users', c.users ?? null, undefined, `${c.new_users_30d ?? 0} new in 30d · ${c.suspended_users ?? 0} suspended`],
    ['Active users (7d)', c.active_users_7d ?? null, undefined, 'signed in within 7 days'],
    ['Workspaces', c.workspaces ?? null, undefined, `${c.projects ?? 0} active projects`],
    ['Connected runtimes', c.connections_live ?? null, undefined, `${c.connections_active ?? 0} active tokens · live = seen in 24h`],
    ['Paid subscriptions', c.subscriptions_paid ?? null, undefined, `${c.subscriptions_stripe ?? 0} managed by Stripe`],
    ['MRR (Stripe only)', c.mrr_cents !== undefined ? Number(c.mrr_cents) / 100 : null, (v) => money(v), 'from active Stripe subscriptions; admin-assigned plans excluded'],
    ['Credit used / included', c.credits_used ?? null, (v) => `${money(v)} / ${money(Number(c.credits_included || 0))}`, `${money(Number(c.usage_30d || 0))} consumed in 30d`],
    ['Provider cost (30d)', c.provider_cost_30d !== undefined ? Number(c.provider_cost_30d) : null, (v) => money(v, { digits: 4 }), 'OpenRouter spend on replays'],
    ['Analysis runs', c.analysis_runs ?? null, undefined, `${c.analysis_runs_30d ?? 0} in 30d`],
    ['Experiments', c.experiments ?? null, undefined, `${c.experiments_passed ?? 0} passed · ${c.experiments_failed ?? 0} failed · ${c.experiments_error ?? 0} errors`],
    ['Telemetry (24h)', c.telemetry_events_24h ?? null, undefined, 'events received'],
    ['Open opportunities', c.opportunities_open ?? null, undefined, 'across all workspaces'],
  ];
  return (
    <>
      <PageHeader eyebrow="Internal" title="Control centre" description="Company-wide state. Financial figures come only from Stripe; nothing is estimated." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, fmt, hint]) => (
          <Panel key={label} className="p-5">{!o ? <Skeleton className="h-16" /> : <Metric label={label} value={value} format={fmt || ((v) => String(Math.round(v)))} hint={hint} />}</Panel>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader title="Health" />
          <div className="px-5 pb-5">
            {o ? <KeyValue items={[{ k: 'API', v: <StatusChip status="active" label={o.health.api.toUpperCase()} /> }, { k: 'Database', v: <StatusChip status="active" label="OK" /> }, { k: 'Cloud replay', v: <StatusChip status={o.health.cloud_replay === 'configured' ? 'active' : 'not_configured'} label={o.health.cloud_replay.replace('_', ' ').toUpperCase()} /> }, { k: 'Stripe', v: <StatusChip status={o.health.stripe === 'configured' ? 'active' : 'not_configured'} label={o.health.stripe.replace('_', ' ').toUpperCase()} /> }, { k: 'Checked', v: dateTime(o.health.time) }]} /> : <Skeleton className="h-32" />}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Recent admin actions" action={<Link to="/admin/audit" className="text-caption text-accent-text underline-offset-4 hover:underline">Audit log</Link>} />
          <ul className="divide-y divide-line px-5">
            {(o?.recent_audit || []).map((a) => (
              <li key={a.id} className="py-2.5"><p className="font-mono text-technical text-ink">{a.action}</p><p className="text-technical text-subtle">{a.admin_email || 'system'} · {a.target_type} {a.target_id ? shortId(a.target_id) : ''} · {relativeTime(a.created_at)}</p></li>
            ))}
            {o && !o.recent_audit.length && <li className="py-3 text-technical text-subtle">No admin actions yet.</li>}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Recent errors & runs" />
          <ul className="divide-y divide-line px-5">
            {(o?.recent_errors || []).map((e) => (
              <li key={e.id} className="py-2.5"><div className="flex items-center justify-between gap-2"><span className="font-mono text-technical text-ink">experiment {shortId(e.id)}</span><StatusChip status={e.status} /></div><p className="text-technical mt-0.5 truncate text-subtle">{e.error || e.strategy} · {relativeTime(e.created_at)}</p></li>
            ))}
            {(o?.recent_runs || []).slice(0, 5).map((r) => (
              <li key={r.id} className="py-2.5"><div className="flex items-center justify-between gap-2"><span className="font-mono text-technical text-ink">analysis {shortId(r.id)}</span><StatusChip status={r.status} /></div><p className="text-technical mt-0.5 text-subtle">{r.events_analyzed} events · {r.opportunities_found} found · {relativeTime(r.created_at)}</p></li>
            ))}
            {o && !o.recent_errors.length && !o.recent_runs.length && <li className="py-3 text-technical text-subtle">Nothing yet.</li>}
          </ul>
        </Panel>
      </div>
    </>
  );
}
