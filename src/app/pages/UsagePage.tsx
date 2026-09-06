import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CreditCard, ExternalLink } from 'lucide-react';
import { useSession } from '@/lib/session';
import { app } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader, KeyValue } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import { ProgressBar, ShareBars } from '@/components/ui/Charts';
import { Table, Th, Td } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { BillingToggle, PlanCard } from '@/marketing/Pricing';
import { usePlans } from '@/lib/site';
import { useToast } from '@/components/ui/Toast';
import { ApiClientError, errorMessage } from '@/lib/api';
import { money, dateOnly, dateTime, titleCase } from '@/lib/format';

export default function UsagePage() {
  const { activeWorkspace, me } = useSession();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const q = useAsync(() => app.usage(activeWorkspace!.id), [activeWorkspace?.id], { enabled: Boolean(activeWorkspace) });
  const { plans } = usePlans();
  const [annual, setAnnual] = useState(params.get('interval') !== 'monthly');
  const [billingNote, setBillingNote] = useState<string | null>(null);
  const u = q.data;

  useEffect(() => {
    const plan = params.get('plan');
    if (!plan) return;
    params.delete('plan');
    params.delete('interval');
    setParams(params, { replace: true });
    void choose(plan, annual ? 'annual' : 'monthly');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (params.get('checkout') === 'success') toast({ tone: 'success', title: 'Subscription active', description: 'Credits update as soon as Stripe confirms the invoice.' });
  }, [params, toast]);

  async function choose(plan: string, interval: 'monthly' | 'annual') {
    try {
      const res = await app.checkout(plan, interval);
      window.location.href = res.url;
    } catch (e) {
      if (e instanceof ApiClientError && (e.code === 'BILLING_NOT_CONFIGURED' || e.code === 'PRICE_NOT_CONFIGURED')) setBillingNote(`${e.message} Email ${me ? 'zevqora.ai@gmail.com' : 'us'} and we will set the plan up for your workspace.`);
      else toast({ tone: 'error', title: 'Checkout unavailable', description: errorMessage(e) });
    }
  }

  async function portal() {
    try {
      const res = await app.portal();
      window.location.href = res.url;
    } catch (e) {
      toast({ tone: 'error', title: 'Billing portal unavailable', description: errorMessage(e) });
    }
  }

  if (q.error && !u) return <ErrorState message={q.error} onRetry={() => q.reload()} />;

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Usage & credits" description="Zev credit pays for provider cost during replay. Analysis, telemetry and reports are free. All accounting happens on the server." actions={u?.subscription?.stripe_managed && u.is_billing_owner && <Button variant="secondary" size="sm" onClick={portal}><CreditCard size={14} /> Manage billing</Button>} />
      {billingNote && <InlineNotice tone="warning" className="mb-4">{billingNote}</InlineNotice>}
      {!u ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Panel tone="glass-strong" className="p-5">
              <Metric label="Current plan" raw={<span className="text-h2">{u.plan.name}</span>} hint={u.plan.override ? 'Set by ZEVQORA for this workspace' : u.subscription ? `${titleCase(u.subscription.status)}${u.subscription.stripe_managed ? ' · Stripe' : ''}` : 'Free tier'} />
              <KeyValue className="mt-4" items={[{ k: 'Projects', v: u.plan.limits.projects === null ? 'Unlimited' : String(u.plan.limits.projects) }, { k: 'Replay samples', v: String(u.plan.limits.replay_samples) }, { k: 'Team seats', v: u.plan.limits.team_members === null ? 'Unlimited' : String(u.plan.limits.team_members) }, { k: 'Retention', v: `${u.plan.limits.telemetry_retention_days} days` }]} />
            </Panel>
            <Panel className="p-5 md:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Metric label="Credits remaining" value={u.credits.remaining_usd} format={(v) => money(v)} tone={u.credits.remaining_usd < u.credits.included_usd * 0.15 ? 'warning' : 'default'} size="lg" hint={`${money(u.credits.used_usd)} used of ${money(u.credits.included_usd)} this period`} />
                <div className="text-right">
                  <p className="text-eyebrow uppercase text-subtle">Resets</p>
                  <p className="text-caption mt-1 text-ink">{u.credits.period_end ? dateOnly(u.credits.period_end) : '—'}</p>
                  <p className="text-technical text-subtle">period started {u.credits.period_start ? dateOnly(u.credits.period_start) : '—'}</p>
                </div>
              </div>
              <ProgressBar value={u.credits.used_usd} max={u.credits.included_usd} className="mt-4" tone={u.credits.remaining_usd < u.credits.included_usd * 0.15 ? 'warning' : 'accent'} />
              {!u.is_billing_owner && <p className="text-technical mt-3 text-subtle">Credit is held by the workspace owner. Ask them to upgrade if you need more.</p>}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Panel>
              <PanelHeader title="By project" description="Last 30 days" />
              <div className="p-5"><ShareBars rows={Object.entries(u.breakdown.by_project).map(([label, value]) => ({ label, value }))} format={(v) => money(v, { digits: 4 })} /></div>
            </Panel>
            <Panel>
              <PanelHeader title="By operation" description="Last 30 days" />
              <div className="p-5"><ShareBars rows={Object.entries(u.breakdown.by_operation).map(([label, value]) => ({ label: titleCase(label), value }))} format={(v) => money(v, { digits: 4 })} /></div>
            </Panel>
            <Panel>
              <PanelHeader title="By provider" description="Last 30 days" />
              <div className="p-5"><ShareBars rows={Object.entries(u.breakdown.by_provider).map(([label, value]) => ({ label, value }))} format={(v) => money(v, { digits: 4 })} /></div>
            </Panel>
          </div>

          <Panel className="mt-4 p-2">
            <PanelHeader title="Recent usage" description="Every charge carries a request id so retries never double-charge." className="px-3" />
            {!u.recent.length ? (
              <div className="p-3"><EmptyState compact zev={null} title="No usage yet" description="Credit is consumed only when a replay calls a provider." /></div>
            ) : (
              <Table minWidth={640}>
                <thead><tr><Th>When</Th><Th>Operation</Th><Th>Project</Th><Th>Provider / model</Th><Th align="right">Credit</Th></tr></thead>
                <tbody>
                  {u.recent.map((r) => (
                    <tr key={r.id}>
                      <Td mono>{dateTime(r.created_at)}</Td>
                      <Td>{titleCase(r.operation)}</Td>
                      <Td>{r.project_name || '—'}</Td>
                      <Td mono>{r.provider || '—'}{r.model ? ` · ${r.model}` : ''}</Td>
                      <Td align="right" mono>{money(r.credits_usd, { digits: 5 })}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          {u.is_billing_owner && (
            <div className="mt-8">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-eyebrow uppercase text-muted">Plans</p>
                  <h2 className="text-h3 mt-1 text-ink">Upgrade when Zev earns it.</h2>
                </div>
                <BillingToggle annual={annual} onChange={setAnnual} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {(plans || []).filter((p) => p.visible).map((p) => (
                  <PlanCard key={p.id} plan={p} annual={annual} currentPlanId={u.plan.id} />
                ))}
              </div>
              <p className="text-technical mt-4 font-mono text-subtle">Pricing is read from the same configuration as the public site. <a href="/pricing" className="inline-flex items-center gap-1 underline underline-offset-4">Public pricing <ExternalLink size={11} /></a></p>
            </div>
          )}
        </>
      )}
    </>
  );
}
