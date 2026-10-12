import { useState } from 'react';
import { useAsync } from '@/lib/useAsync';
import { dateTime } from '@/lib/format';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { AuditEvent } from '@/components/ui/Evidence';
import { Select } from '@/components/ui/Field';
import { ErrorState, InlineNotice, LoadingState } from '@/components/ui/States';
import { adminV3 } from '../data-v3';
import { AdminHeader, SourceLine, useRange } from '../shared';

const KINDS = ['auth_failed', 'account_suspended', 'authz_denied', 'cross_workspace_denied', 'admin_denied', 'rate_limited', 'unexpected_error', 'connection_revoked'];
const SEVERITY: Record<string, string> = { high: 'bg-rejected-bg text-rejected', medium: 'bg-warning-bg text-warning', low: 'bg-sunken text-muted', info: 'bg-sunken text-subtle' };

/**
 * Security operations. Rows come from the server-only security_events table;
 * there are no alerts invented in the browser. Opening this page is audited.
 */
export default function AdminSecurityPage() {
  const { range, setRange, query, label } = useRange({ preset: '7d' });
  const [kind, setKind] = useState('');
  const q = useAsync(() => adminV3.security(query, kind || undefined), [query, kind]);
  const d = q.data;
  return (
    <>
      <AdminHeader title="Security" description="Failed logins, authorization and cross-workspace denials, admin-route probes, rate limits and server errors, plus every administrative change." range={range} onRange={setRange} />
      {d && <SourceLine source={d.meta.source} range={label} generatedAt={d.meta.generated_at} lastEventAt={d.events[0]?.occurred_at ?? null} />}
      {d && <InlineNotice tone="info" className="mb-4">{d.meta.ip_note} Rows older than {d.meta.retention_days} days are purged daily. This read was recorded in the audit log.</InlineNotice>}
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !d && <LoadingState label="Loading security events" />}
      {d && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
            {KINDS.map((k) => <StatTile key={k} label={k.replace(/_/g, ' ')} value={(d.by_kind[k] || 0).toLocaleString()} tone={d.by_kind[k] ? (k === 'cross_workspace_denied' || k === 'unexpected_error' ? 'warning' : 'default') : 'default'} />)}
          </div>
          <p className="text-[12px] text-muted">Suspended accounts right now: <b className="text-ink">{d.suspended_accounts ?? 'unknown'}</b></p>
          <Card>
            <CardHeader title="Events" action={
              <label className="flex items-center gap-2 text-[12px] text-muted">Kind
                <Select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-52 py-0 text-[12.5px]">
                  <option value="">All kinds</option>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </Select>
              </label>
            } />
            <div className="px-5 pb-4">
              <DataTable caption={`Security events · ${label}`} captionHidden rows={d.events} rowKey={(e) => e.id} minWidth={900} dense empty="No security events in this range." columns={[
                { key: 'at', header: 'When', nowrap: true, cell: (e) => dateTime(e.occurred_at), sort: (e) => e.occurred_at },
                { key: 'k', header: 'Kind', cell: (e) => <span className="font-mono text-[12px]">{e.kind}</span>, sort: (e) => e.kind },
                { key: 's', header: 'Severity', cell: (e) => <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] uppercase ${SEVERITY[e.severity] || ''}`}>{e.severity}</span> },
                { key: 'r', header: 'Route', cell: (e) => <span className="font-mono text-[12px]">{e.method} {e.route}</span> },
                { key: 'st', header: 'Status', align: 'right', cell: (e) => `${e.status ?? '—'} ${e.code ?? ''}` },
                { key: 'a', header: 'Actor', cell: (e) => (e.actor_id ? <span className="font-mono text-[11.5px]">{e.actor_id.slice(0, 8)}</span> : 'anonymous') },
                { key: 'ip', header: 'Source prefix', cell: (e) => <span className="font-mono text-[11.5px]">{e.ip_prefix || '—'}</span> },
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Administrative changes" description="Content publishing, flag changes, roles, credits, lead updates and security reads — from the append-only audit log." />
            <ul className="divide-y divide-line px-5 pb-3">
              {d.admin_changes.map((a) => <AuditEvent key={a.id} entry={a} />)}
              {!d.admin_changes.length && <li className="py-3 text-[12.5px] text-muted">No administrative changes in this range.</li>}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
