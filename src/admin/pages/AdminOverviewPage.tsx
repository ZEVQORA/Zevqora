import { Link } from 'react-router';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { ActivityItem } from '@/components/ui/Evidence';
import { ErrorState, LoadingState, InlineNotice } from '@/components/ui/States';
import { FunnelChart } from '@/components/charts/Bars';
import { adminV3 } from '../data-v3';
import { AdminHeader, StatusPill } from '../shared';

const n = (v: number | null | undefined) => (v === null || v === undefined ? 'unknown' : v.toLocaleString());

/** Admin command center: real counts only; every figure says its window. */
export default function AdminOverviewPage() {
  const q = useAsync(() => adminV3.commandCenter(), []);
  const d = q.data;
  return (
    <>
      <AdminHeader title="Command center" description="Accounts, workspaces, optimization activity, leads, errors and security signals from the production database. Counts are exact; the window is the last 7 days unless stated." />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !d && <LoadingState label="Loading the admin command center" rows={5} />}
      {d && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Users (all time)" value={n(d.counts.users)} />
            <StatTile label="Signups, 7 days" value={n(d.counts.signups_7d)} tone="accent" />
            <StatTile label="Active users, 7 days" value={n(d.counts.active_users_7d)} hint="last API activity" />
            <StatTile label="Workspaces" value={n(d.counts.workspaces)} />
            <StatTile label="Active workspaces, 7 days" value={n(d.counts.active_workspaces_7d)} hint="with a product event" />
            <StatTile label="Connected workloads" value={n(d.counts.connected_workloads)} />
            <StatTile label="Plan searches, 7 days" value={n(d.counts.searches_7d)} />
            <StatTile label="Evaluations, 7 days" value={n(d.counts.evaluations_7d)} hint="replay verdicts" />
            <StatTile label="New evaluation requests" value={n(d.counts.evaluation_requests_new)} tone={d.counts.evaluation_requests_new ? 'warning' : 'default'} />
            <StatTile label="Security events, 7 days" value={Object.values(d.security_7d).reduce((a, b) => a + b, 0).toLocaleString()} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Website conversion, 7 days" description="Sessions → CTA → signup started → evaluation submitted (first-party, cookieless)." action={<Link to="/admin/analytics" className="text-[12.5px] font-medium text-accent-text">Website analytics</Link>} />
              <div className="px-5 pb-4">
                {d.website.collecting ? (
                  d.website.funnel?.sessions ? (
                    <FunnelChart ariaLabel="Website conversion funnel" steps={[
                      { key: 's', label: 'Sessions', value: d.website.funnel.sessions },
                      { key: 'c', label: 'Clicked a CTA', value: d.website.funnel.cta },
                      { key: 'u', label: 'Started signup', value: d.website.funnel.signup_started },
                      { key: 'e', label: 'Requested evaluation', value: d.website.funnel.evaluation_submitted },
                    ]} />
                  ) : <p className="text-[12.5px] text-muted">No website sessions recorded in the last 7 days.</p>
                ) : (
                  <InlineNotice tone="info">Website analytics are off. Turn on the <code>visitor_intelligence</code> flag to record cookieless pageviews.</InlineNotice>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="System status" action={<Link to="/admin/system" className="text-[12.5px] font-medium text-accent-text">Details</Link>} />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 pb-4 sm:grid-cols-2">
                {Object.entries(d.system).filter(([k]) => k !== 'time').map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[12.5px]">
                    <dt className="text-muted">{k.replace(/_/g, ' ')}</dt>
                    <dd><StatusPill value={v} /></dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader title="Recent signups" />
              <ul className="px-5 pb-3">
                {d.recent_signups.map((u) => <ActivityItem key={u.id} icon={<UserPlus size={12} />} title={<Link to={`/admin/users/${u.id}`} className="hover:text-accent-text">{u.display_name || u.email || u.id.slice(0, 8)}</Link>} meta={u.email} at={u.created_at} />)}
                {!d.recent_signups.length && <li className="py-3 text-[12.5px] text-muted">No accounts yet.</li>}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Recent server errors" description="5xx responses recorded as security events (route only, no payloads)." />
              <ul className="px-5 pb-3">
                {d.recent_errors.map((e) => <ActivityItem key={e.id} icon={<AlertTriangle size={12} />} title={<span className="font-mono text-[12px]">{e.method} {e.route}</span>} meta={`${e.status} · ${e.code || 'INTERNAL'}`} at={e.occurred_at} />)}
                {!d.recent_errors.length && <li className="py-3 text-[12.5px] text-muted">No server errors recorded.</li>}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Security signals, 7 days" action={<Link to="/admin/security" className="text-[12.5px] font-medium text-accent-text">Security</Link>} />
              <ul className="px-5 pb-4 text-[12.5px]">
                {Object.entries(d.security_7d).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <li key={k} className="flex justify-between border-b border-line py-1.5"><span className="text-muted">{k.replace(/_/g, ' ')}</span><span className="font-mono tnum text-ink">{v}</span></li>
                ))}
                {!Object.keys(d.security_7d).length && <li className="py-2 text-muted">No security events recorded.</li>}
              </ul>
            </Card>
          </div>
          <p className="text-[11.5px] text-subtle">Generated {relativeTime(d.generated_at)}. Product events are recorded from migration 019 onward and are not backfilled.</p>
        </div>
      )}
    </>
  );
}
