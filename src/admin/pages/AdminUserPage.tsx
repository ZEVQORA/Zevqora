import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { usePlans } from '@/lib/site';
import { PageHeader, Panel, PanelHeader, KeyValue } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Table, Th, Td, Avatar } from '@/components/ui/Misc';
import { StatusChip } from '@/components/ui/StatusChip';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { money, dateTime, dateOnly, titleCase, shortId } from '@/lib/format';

export default function AdminUserPage() {
  const { id = '' } = useParams();
  const q = useAsync(() => admin.user(id), [id]);
  const { plans } = usePlans();
  const toast = useToast();
  const [dialog, setDialog] = useState<'suspend' | 'plan' | 'credits' | null>(null);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState('');
  const [deltaIncluded, setDeltaIncluded] = useState('0');
  const [deltaUsed, setDeltaUsed] = useState('0');
  const d = q.data;

  const act = async (fn: () => Promise<unknown>, title: string) => {
    setPending(true);
    try {
      await fn();
      await q.reload(true);
      setDialog(null);
      setReason('');
      toast({ tone: 'success', title });
    } catch (e) {
      toast({ tone: 'error', title: 'Action failed', description: errorMessage(e) });
    } finally {
      setPending(false);
    }
  };

  if (q.error && !d) return <ErrorState message={q.error} onRetry={() => q.reload()} />;
  if (!d) return <Skeleton className="h-96 rounded-lg" />;
  const p = d.profile;
  const suspended = Boolean(p.suspended_at);
  const bigCredit = Math.abs(Number(deltaIncluded) || 0) + Math.abs(Number(deltaUsed) || 0) >= 100;

  return (
    <>
      <PageHeader eyebrow={<Link to="/admin/users" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft size={12} /> Users</Link> as unknown as string} title={<span className="inline-flex items-center gap-3"><Avatar name={p.display_name || p.email} src={p.avatar_url} size={36} /> {p.display_name || p.username || p.email}</span>} description={p.email || ''}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => { setPlan(d.subscription?.plan || 'free'); setDialog('plan'); }}>Change plan</Button>
            <Button variant="secondary" size="sm" onClick={() => setDialog('credits')}>Adjust credits</Button>
            {suspended ? <Button variant="secondary" size="sm" onClick={() => act(() => admin.unsuspend(id), 'Account reinstated')}>Unsuspend</Button> : <Button variant="danger" size="sm" onClick={() => setDialog('suspend')}>Suspend</Button>}
          </>
        }
      />
      {suspended && <InlineNotice tone="danger" className="mb-4">Suspended {dateTime(p.suspended_at)} · {p.suspended_reason}</InlineNotice>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader title="Account" />
          <div className="px-5 pb-5"><KeyValue items={[{ k: 'User id', v: p.id }, { k: 'Username', v: p.username || '—' }, { k: 'Providers', v: (d.auth?.providers || []).join(', ') || 'email' }, { k: 'Email confirmed', v: d.auth?.email_confirmed_at ? 'yes' : 'no' }, { k: 'Created', v: dateTime(d.auth?.created_at || p.created_at) }, { k: 'Last sign-in', v: dateTime(d.auth?.last_sign_in_at) }, { k: 'Last active', v: dateTime(p.last_active_at) }, { k: 'Admin role', v: d.admin_role?.role || '—' }, { k: 'Timezone', v: p.timezone || '—' }]} /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Plan & credits" />
          <div className="px-5 pb-5"><KeyValue items={[{ k: 'Plan', v: d.subscription?.plan || 'free' }, { k: 'Status', v: d.subscription?.status || 'active' }, { k: 'Billing', v: d.subscription?.stripe_managed ? 'Stripe managed' : 'self-managed' }, { k: 'Period end', v: dateOnly(d.subscription?.current_period_end) }, { k: 'Included', v: money(d.credits?.included_usd) }, { k: 'Used', v: money(d.credits?.used_usd) }, { k: 'Credit resets', v: dateOnly(d.credits?.period_end) }]} /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Workspaces" />
          <ul className="divide-y divide-line px-5">
            {d.memberships.map((m) => (
              <li key={m.workspace?.id || m.joined_at} className="py-2.5"><Link to={`/admin/workspaces/${m.workspace?.id}`} className="text-caption font-medium text-ink hover:underline">{m.workspace?.name}</Link><p className="font-mono text-technical text-subtle">{m.role} · {m.workspace?.owner_id === p.id ? 'owner' : 'member'} · joined {dateOnly(m.joined_at)}</p></li>
            ))}
            {!d.memberships.length && <li className="py-3 text-technical text-subtle">No workspaces.</li>}
          </ul>
          <div className="px-5 pb-4 pt-2"><p className="text-technical text-subtle">{d.projects.length} project{d.projects.length === 1 ? '' : 's'} across memberships</p></div>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel className="p-2">
          <PanelHeader title="Credit history" className="px-3" />
          <Table minWidth={600}>
            <thead><tr><Th>When</Th><Th>Kind</Th><Th align="right">Delta</Th><Th align="right">Included</Th><Th align="right">Used</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {d.ledger.map((l) => (
                <tr key={l.id}><Td mono>{dateTime(l.created_at)}</Td><Td mono>{l.kind}</Td><Td align="right" mono>{money(l.delta_usd, { digits: 4 })}</Td><Td align="right" mono>{l.included_before ?? '—'} → {l.included_after ?? '—'}</Td><Td align="right" mono>{l.used_before ?? '—'} → {l.used_after ?? '—'}</Td><Td className="text-muted">{l.reason}</Td></tr>
              ))}
              {!d.ledger.length && <tr><Td className="text-subtle" colSpan={6}>No ledger entries.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
        <Panel className="p-2">
          <PanelHeader title="Recent usage" className="px-3" />
          <Table minWidth={560}>
            <thead><tr><Th>When</Th><Th>Operation</Th><Th>Provider / model</Th><Th align="right">Credit</Th></tr></thead>
            <tbody>
              {d.usage.map((u) => (
                <tr key={u.id}><Td mono>{dateTime(u.created_at)}</Td><Td>{titleCase(u.operation)}</Td><Td mono>{u.provider || '—'} {u.model || ''}</Td><Td align="right" mono>{money(u.credits_usd, { digits: 5 })}</Td></tr>
              ))}
              {!d.usage.length && <tr><Td className="text-subtle" colSpan={4}>No usage.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
      </div>
      <p className="text-technical mt-4 font-mono text-subtle">Every action on this page is written to the audit log with your identity. <StatusChip status="active" label={shortId(id)} /></p>

      <Dialog open={dialog === 'suspend'} onClose={() => setDialog(null)} title="Suspend this account?" description="The user is signed out everywhere and cannot sign in until reinstated." size="sm" footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger" loading={pending} disabled={reason.trim().length < 3} onClick={() => act(() => admin.suspend(id, reason), 'Account suspended')}>Suspend</Button></>}>
        <Field id="reason" label="Reason" hint="Stored in the audit log."><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>

      <Dialog open={dialog === 'plan'} onClose={() => setDialog(null)} title="Change plan" description="Included credit is set to the plan allowance. Stripe-managed subscriptions must be changed in Stripe." size="sm" footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button loading={pending} onClick={() => act(() => admin.setPlan(id, plan), `Plan set to ${plan}`)}>Confirm change</Button></>}>
        <Field id="plan" label="Plan"><Select id="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>{(plans || []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name} ({pl.id})</option>)}</Select></Field>
        {d.subscription?.stripe_managed && <InlineNotice tone="warning" className="mt-3">This subscription is managed by Stripe; the server will refuse this change.</InlineNotice>}
      </Dialog>

      <ConfirmDialog open={dialog === 'credits'} onClose={() => setDialog(null)} onConfirm={() => act(() => admin.adjustCredits(id, { delta_included: Number(deltaIncluded) || 0, delta_used: Number(deltaUsed) || 0, reason }), 'Credits adjusted')} title="Adjust credits" description="Before and after values are recorded with your identity and reason." confirmLabel={bigCredit ? 'Confirm large adjustment' : 'Apply'} tone={bigCredit ? 'danger' : 'primary'} loading={pending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="di" label="Included Δ (USD)" hint="Positive grants promotional credit."><Input id="di" type="number" step="0.01" value={deltaIncluded} onChange={(e) => setDeltaIncluded(e.target.value)} /></Field>
          <Field id="du" label="Used Δ (USD)" hint="Negative refunds consumed credit."><Input id="du" type="number" step="0.01" value={deltaUsed} onChange={(e) => setDeltaUsed(e.target.value)} /></Field>
        </div>
        <Field id="cr" label="Reason" className="mt-3"><Input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Design-partner credit, incident refund, correction…" /></Field>
        {bigCredit && <InlineNotice tone="warning" className="mt-3">Adjustment of $100 or more. Double-check the sign and the reason.</InlineNotice>}
      </ConfirmDialog>
    </>
  );
}
