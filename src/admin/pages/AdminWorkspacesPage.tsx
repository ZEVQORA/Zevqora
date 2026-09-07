import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Search } from 'lucide-react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { usePlans } from '@/lib/site';
import { PageHeader, Panel, PanelHeader, KeyValue } from '@/components/ui/Panel';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Table, Th, Td } from '@/components/ui/Misc';
import { StatusChip } from '@/components/ui/StatusChip';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { money, dateOnly, dateTime, relativeTime, shortId } from '@/lib/format';

type Detail = {
  workspace: { id: string; name: string; slug: string; owner_id: string; plan_override: string | null; data_retention_days: number; created_at: string; settings: Record<string, unknown> };
  plan: string;
  owner: { id: string; email: string | null; display_name: string | null } | null;
  members: Array<{ user_id: string; role: string; joined_at: string; email: string | null; display_name: string | null }>;
  projects: Array<{ id: string; name: string; slug: string; source_kind: string; created_at: string; archived_at: string | null }>;
  connections: Array<{ id: string; project_id: string; kind: string; name: string; status: string; token_prefix: string | null; created_at: string; last_seen_at: string | null }>;
  usage_30d: Array<{ project_id: string | null; operation: string; provider: string | null; credits_usd: number; events: number }>;
  recent_runs: Array<{ id: string; status: string; events_analyzed: number; opportunities_found: number; created_at: string }>;
  recent_experiments: Array<{ id: string; status: string; strategy: string; verified_savings_pct: number | null; credits_usd: number; created_at: string }>;
  subscription: { plan: string; status: string; stripe_managed: boolean; current_period_end: string | null } | null;
  credits: { included_usd: number; used_usd: number; period_end: string } | null;
};

function WorkspaceDetail({ id }: { id: string }) {
  const q = useAsync(() => admin.workspace(id) as Promise<Detail>, [id]);
  const { plans } = usePlans();
  const toast = useToast();
  const [override, setOverride] = useState<string>('');
  const [pending, setPending] = useState(false);
  const d = q.data;
  if (q.error && !d) return <ErrorState message={q.error} onRetry={() => q.reload()} />;
  if (!d) return <Skeleton className="h-96 rounded-lg" />;
  const usage = d.usage_30d.reduce((a, r) => a + Number(r.credits_usd), 0);
  const save = async () => {
    setPending(true);
    try {
      await admin.planOverride(id, override || null);
      await q.reload(true);
      toast({ tone: 'success', title: override ? `Plan override set to ${override}` : 'Plan override cleared' });
    } catch (e) {
      toast({ tone: 'error', title: 'Failed', description: errorMessage(e) });
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <PageHeader eyebrow={<Link to="/admin/workspaces" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft size={12} /> Workspaces</Link> as unknown as string} title={d.workspace.name} description={`${d.workspace.slug} · effective plan ${d.plan}`} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader title="Workspace" />
          <div className="px-5 pb-5"><KeyValue items={[{ k: 'Id', v: d.workspace.id }, { k: 'Owner', v: d.owner ? <Link to={`/admin/users/${d.owner.id}`} className="underline underline-offset-4">{d.owner.email}</Link> : '—' }, { k: 'Owner plan', v: `${d.subscription?.plan || 'free'} (${d.subscription?.status || 'active'}${d.subscription?.stripe_managed ? ', Stripe' : ''})` }, { k: 'Override', v: d.workspace.plan_override || 'none' }, { k: 'Retention', v: `${d.workspace.data_retention_days} days` }, { k: 'Created', v: dateOnly(d.workspace.created_at) }]} /></div>
          <div className="flex items-center gap-2 border-t border-line px-5 py-4">
            <Select value={override} onChange={(e) => setOverride(e.target.value)} className="h-9" aria-label="Plan override"><option value="">No override</option>{(plans || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Button size="sm" onClick={save} loading={pending}>Apply</Button>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Credit & usage (30d)" />
          <div className="px-5 pb-5"><KeyValue items={[{ k: 'Included', v: money(d.credits?.included_usd) }, { k: 'Used', v: money(d.credits?.used_usd) }, { k: 'Resets', v: dateOnly(d.credits?.period_end) }, { k: 'Workspace usage 30d', v: money(usage, { digits: 4 }) }, { k: 'Members', v: String(d.members.length) }, { k: 'Projects', v: `${d.projects.filter((p) => !p.archived_at).length} active` }]} /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Members" />
          <ul className="divide-y divide-line px-5">{d.members.map((m) => <li key={m.user_id} className="py-2"><Link to={`/admin/users/${m.user_id}`} className="text-caption text-ink hover:underline">{m.display_name || m.email}</Link><p className="font-mono text-technical text-subtle">{m.role} · {dateOnly(m.joined_at)}</p></li>)}</ul>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel className="p-2">
          <PanelHeader title="Connections" className="px-3" />
          <Table minWidth={520}><thead><tr><Th>Name</Th><Th>Kind</Th><Th>Token</Th><Th>Status</Th><Th>Last seen</Th></tr></thead><tbody>{d.connections.map((c) => <tr key={c.id}><Td>{c.name}</Td><Td mono>{c.kind}</Td><Td mono>{c.token_prefix ? `zqt_${c.token_prefix}_…` : '—'}</Td><Td><StatusChip status={c.status} /></Td><Td mono>{c.last_seen_at ? relativeTime(c.last_seen_at) : '—'}</Td></tr>)}{!d.connections.length && <tr><Td colSpan={5} className="text-subtle">No connections.</Td></tr>}</tbody></Table>
        </Panel>
        <Panel className="p-2">
          <PanelHeader title="Recent analysis & experiments" className="px-3" />
          <Table minWidth={520}><thead><tr><Th>Item</Th><Th>Status</Th><Th align="right">Result</Th><Th>When</Th></tr></thead><tbody>
            {d.recent_experiments.map((e) => <tr key={e.id}><Td mono>experiment {shortId(e.id)} · {e.strategy}</Td><Td><StatusChip status={e.status} /></Td><Td align="right" mono>{e.verified_savings_pct !== null ? `−${e.verified_savings_pct}%` : '—'} · {money(e.credits_usd, { digits: 4 })}</Td><Td mono>{dateTime(e.created_at)}</Td></tr>)}
            {d.recent_runs.map((r) => <tr key={r.id}><Td mono>analysis {shortId(r.id)}</Td><Td><StatusChip status={r.status} label={r.status === 'failed' ? 'FAILED' : undefined} /></Td><Td align="right" mono>{r.events_analyzed} ev · {r.opportunities_found} opp</Td><Td mono>{dateTime(r.created_at)}</Td></tr>)}
            {!d.recent_runs.length && !d.recent_experiments.length && <tr><Td colSpan={4} className="text-subtle">Nothing yet.</Td></tr>}
          </tbody></Table>
        </Panel>
      </div>
    </>
  );
}

export default function AdminWorkspacesPage() {
  const { id } = useParams();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const q = useAsync(() => admin.workspaces(debounced), [debounced], { enabled: !id });
  if (id) return <WorkspaceDetail id={id} />;
  return (
    <>
      <PageHeader eyebrow="Internal" title="Workspaces" />
      <div className="relative mb-4 max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <Input value={query} onChange={(e) => { setQuery(e.target.value); clearTimeout((window as unknown as { _w?: number })._w); (window as unknown as { _w?: number })._w = window.setTimeout(() => setDebounced(e.target.value), 300); }} placeholder="Search workspaces" className="pl-9" aria-label="Search workspaces" />
      </div>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-64 rounded-lg" /> : (
        <Panel className="p-2">
          <Table minWidth={800}>
            <thead><tr><Th>Workspace</Th><Th>Owner</Th><Th>Plan</Th><Th align="right">Members</Th><Th align="right">Projects</Th><Th>Retention</Th><Th>Created</Th></tr></thead>
            <tbody>
              {q.data.workspaces.map((w) => (
                <tr key={w.id} className="hover:bg-ink/[0.02]">
                  <Td><Link to={`/admin/workspaces/${w.id}`} className="font-medium text-ink hover:underline">{w.name}</Link><div className="font-mono text-technical text-subtle">{w.slug}</div></Td>
                  <Td mono>{w.owner?.email || shortId(w.owner_id)}</Td>
                  <Td mono>{w.plan}{w.plan_override ? ' (override)' : ''}</Td>
                  <Td align="right" mono>{w.members}</Td>
                  <Td align="right" mono>{w.projects}</Td>
                  <Td mono>{w.data_retention_days}d</Td>
                  <Td mono>{dateOnly(w.created_at)}</Td>
                </tr>
              ))}
              {!q.data.workspaces.length && <tr><Td colSpan={7} className="text-subtle">No workspaces.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
