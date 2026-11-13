import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowUpRight, UserPlus } from 'lucide-react';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { ActivityItem } from '@/components/ui/Evidence';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { FunnelChart } from '@/components/charts/Bars';
import { LineChart } from '@/components/charts/LineChart';
import { SegmentedControl } from '@/components/ui/Segmented';
import { adminV3 } from '../data-v3';
import { StatusPill } from '../shared';
import './admin-overview.css';

type Preset = '7d' | '30d';
const NOT_MEASURED = 'Not measured yet';
const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : v.toLocaleString());

/** One headline figure. Missing data reads "—" with the reason, never zero. */
function Kpi({ label, value, hint, href }: { label: string; value: string | null; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="zadm-kpi-label">{label}</span>
      <span className={`zadm-kpi-value${value === null ? ' is-missing' : ''}`}>{value ?? '—'}</span>
      <span className="zadm-kpi-hint">{value === null ? hint || NOT_MEASURED : hint || ' '}</span>
    </>
  );
  return href ? <Link to={href} className="zadm-kpi is-link">{body}</Link> : <div className="zadm-kpi">{body}</div>;
}

function Panel({ title, meta, action, children }: { title: string; meta?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="zadm-panel">
      <header>
        <div>
          <h2>{title}</h2>
          {meta && <p>{meta}</p>}
        </div>
        {action}
      </header>
      <div className="zadm-panel-body">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="zadm-empty">{children}</p>;
}

/**
 * Admin overview. Every figure comes from an admin endpoint guarded by
 * requireAdmin on the server (command-center, analytics/website|product|
 * optimization, system-health via command-center). Each panel loads on its own,
 * so one failure never blanks the page, and missing data says so.
 */
export default function AdminOverviewPage() {
  const [preset, setPreset] = useState<Preset>('7d');
  const q = `range=${preset}`;
  const cc = useAsync(() => adminV3.commandCenter(), []);
  const web = useAsync(() => adminV3.website(q), [q]);
  const prod = useAsync(() => adminV3.product(q), [q]);
  const opt = useAsync(() => adminV3.optimization(q), [q]);
  const windowLabel = `Last ${preset === '7d' ? '7' : '30'} days · UTC`;

  const w = web.data;
  const p = prod.data;
  const o = opt.data;
  const d = cc.data;
  const webOn = Boolean(w?.meta.collecting);
  const prodOn = Boolean(p?.meta.collecting);
  const verdicts = o?.evaluations.by_status || {};

  return (
    <div className="zadm">
      <header className="zadm-head">
        <div>
          <p className="zadm-eyebrow">Internal · server-enforced</p>
          <h1>Overview</h1>
          <p className="zadm-sub">Production figures only. Each panel names its source and window; a dash means the data is not recorded, not zero.</p>
        </div>
        <SegmentedControl label="Time range" value={preset} onChange={setPreset} options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} />
      </header>

      <section className="zadm-kpis" aria-label={`Key figures, ${windowLabel}`}>
        <Kpi label="Visitors" value={webOn ? num(w?.totals.visitor_days) : null} hint={w && !webOn ? 'Website analytics off' : web.error ? 'Could not load' : webOn ? 'daily visitor keys' : undefined} href="/admin/analytics" />
        <Kpi label="Signups" value={prodOn ? num(p?.funnel.signup ?? null) : preset === '7d' && d ? num(d.counts.signups_7d) : null} hint={!prodOn && preset === '7d' && d ? 'accounts created' : p && !prodOn ? 'Product analytics off' : prod.error ? 'Could not load' : undefined} href="/admin/product" />
        <Kpi label="Active users" value={prodOn ? num(p?.active.users) : null} hint={prodOn ? 'with a product event' : undefined} />
        <Kpi label="Active workspaces" value={prodOn ? num(p?.active.workspaces) : null} />
        <Kpi label="Plan searches" value={o ? num(o.searches.total) : null} hint={opt.error ? 'Could not load' : undefined} href="/admin/optimization" />
        <Kpi label="Replay verdicts" value={o ? num(o.evaluations.total) : null} hint={o ? `${verdicts.VERIFIED ?? verdicts.verified ?? 0} verified · ${verdicts.REJECTED ?? verdicts.rejected ?? 0} rejected` : undefined} />
      </section>
      <p className="zadm-window">{windowLabel}. All-time: {d ? `${num(d.counts.users) ?? '—'} users · ${num(d.counts.workspaces) ?? '—'} workspaces · ${num(d.counts.connected_workloads) ?? '—'} connected workloads` : cc.error ? 'could not load' : 'loading…'}.</p>

      <div className="zadm-grid">
        <Panel title="Website traffic" meta={`${w?.meta.source || 'site_events'} · ${windowLabel}`} action={<Link to="/admin/analytics" className="zadm-link">Details <ArrowUpRight size={13} aria-hidden /></Link>}>
          {web.loading && !w && <LoadingState label="Loading website analytics" rows={3} />}
          {web.error && <ErrorState message={web.error} onRetry={() => void web.reload()} />}
          {w && !webOn && <Empty>Not measured yet: website analytics are off. Turn on the <code>visitor_intelligence</code> flag to record cookieless pageviews.</Empty>}
          {w && webOn && (w.daily.length ? (
            <LineChart ariaLabel="Daily pageviews and sessions" height={220} labels={w.daily.map((x) => x.day.slice(5))} format={(v) => String(Math.round(v))} series={[{ key: 'pv', label: 'Pageviews', color: 'var(--zq-accent)', values: w.daily.map((x) => x.pageviews) }, { key: 's', label: 'Sessions', color: 'var(--zq-fg-muted)', values: w.daily.map((x) => x.sessions) }]} />
          ) : <Empty>No pageviews recorded in this window.</Empty>)}
        </Panel>

        <Panel title="Product activity" meta={`${p?.meta.source || 'product_events'} · ${windowLabel}`} action={<Link to="/admin/product" className="zadm-link">Details <ArrowUpRight size={13} aria-hidden /></Link>}>
          {prod.loading && !p && <LoadingState label="Loading product analytics" rows={3} />}
          {prod.error && <ErrorState message={prod.error} onRetry={() => void prod.reload()} />}
          {p && !prodOn && <Empty>Not measured yet: product analytics are off (<code>product_analytics</code> flag).</Empty>}
          {p && prodOn && (p.daily.length ? (
            <LineChart ariaLabel="Daily active users and workspaces" height={220} labels={p.daily.map((x) => x.day.slice(5))} format={(v) => String(Math.round(v))} series={[{ key: 'u', label: 'Active users', color: 'var(--zq-accent)', values: p.daily.map((x) => x.active_users) }, { key: 'w', label: 'Active workspaces', color: 'var(--zq-fg-muted)', values: p.daily.map((x) => x.active_workspaces) }]} />
          ) : <Empty>No product events recorded in this window.</Empty>)}
        </Panel>

        <Panel title="Activation funnel" meta={p ? `Signup cohort · ${windowLabel}` : windowLabel}>
          {p && prodOn && p.funnel_steps.some((s) => (p.funnel[s.key] ?? 0) > 0) ? (
            <FunnelChart ariaLabel="Activation funnel" steps={p.funnel_steps.filter((s) => p.funnel[s.key] !== null && p.funnel[s.key] !== undefined).map((s) => ({ key: s.key, label: s.label, value: p.funnel[s.key] as number }))} />
          ) : (
            <Empty>{p && !prodOn ? 'Not measured yet.' : prod.error ? 'Could not load.' : p ? 'No signups in this window yet.' : 'Loading…'}</Empty>
          )}
        </Panel>

        <Panel title="Optimization" meta={`${o?.meta.source || 'plan searches, plans, evaluations'} · ${windowLabel}`} action={<Link to="/admin/optimization" className="zadm-link">Details <ArrowUpRight size={13} aria-hidden /></Link>}>
          {opt.loading && !o && <LoadingState label="Loading optimization activity" rows={3} />}
          {opt.error && <ErrorState message={opt.error} onRetry={() => void opt.reload()} />}
          {o && (
            <dl className="zadm-facts">
              <div><dt>Plans generated</dt><dd>{num(o.plans.total) ?? '—'}</dd></div>
              <div><dt>On the frontier</dt><dd>{num(o.plans.frontier) ?? '—'}</dd></div>
              <div><dt>Decisions</dt><dd>{num(o.decisions.total) ?? '—'}</dd></div>
              <div><dt>Acceptance rate</dt><dd>{o.acceptance_rate === null ? '—' : `${Math.round(o.acceptance_rate * 100)}%`}</dd></div>
              <div><dt>Replay spend</dt><dd title={o.replay_spend_note}>{o.replay_spend_usd === null ? '—' : `$${o.replay_spend_usd.toFixed(2)}`}</dd></div>
              <div><dt>Realized savings</dt><dd className="is-muted">{NOT_MEASURED}</dd></div>
            </dl>
          )}
        </Panel>

        <Panel title="System status" meta={d ? `Checked ${relativeTime(d.generated_at)}` : 'system health'} action={<Link to="/admin/system" className="zadm-link">Details <ArrowUpRight size={13} aria-hidden /></Link>}>
          {cc.loading && !d && <LoadingState label="Loading system status" rows={3} />}
          {cc.error && <ErrorState message={cc.error} onRetry={() => void cc.reload()} />}
          {d && (
            <dl className="zadm-status">
              {Object.entries(d.system).filter(([k]) => k !== 'time').map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replace(/_/g, ' ')}</dt>
                  <dd><StatusPill value={v} /></dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <Panel title="Security signals" meta="Last 7 days · security_events" action={<Link to="/admin/security" className="zadm-link">Details <ArrowUpRight size={13} aria-hidden /></Link>}>
          {cc.error && <Empty>Could not load: {cc.error}</Empty>}
          {d && (Object.keys(d.security_7d).length ? (
            <ul className="zadm-list">
              {Object.entries(d.security_7d).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k}><span>{k.replace(/_/g, ' ')}</span><b>{v.toLocaleString()}</b></li>
              ))}
            </ul>
          ) : <Empty>No security events recorded.</Empty>)}
        </Panel>

        <Panel title="Recent signups" meta="Newest accounts">
          {cc.error && <Empty>Could not load: {cc.error}</Empty>}
          {d && (d.recent_signups.length ? (
            <ul>
              {d.recent_signups.map((u) => <ActivityItem key={u.id} icon={<UserPlus size={12} />} title={<Link to={`/admin/users/${u.id}`} className="hover:text-accent-text">{u.display_name || u.email || u.id.slice(0, 8)}</Link>} meta={u.email} at={u.created_at} />)}
            </ul>
          ) : <Empty>No accounts yet.</Empty>)}
        </Panel>

        <Panel title="Recent server errors" meta="5xx responses · route only, no payloads">
          {cc.error && <Empty>Could not load: {cc.error}</Empty>}
          {d && (d.recent_errors.length ? (
            <ul>
              {d.recent_errors.map((e) => <ActivityItem key={e.id} icon={<AlertTriangle size={12} />} title={<span className="font-mono text-[12px]">{e.method} {e.route}</span>} meta={`${e.status} · ${e.code || 'INTERNAL'}`} at={e.occurred_at} />)}
            </ul>
          ) : <Empty>No server errors recorded.</Empty>)}
        </Panel>
      </div>
      <p className="zadm-foot">Product events are recorded from migration 019 onward and are not backfilled. Realized production savings are not measured by this release.</p>
    </div>
  );
}
