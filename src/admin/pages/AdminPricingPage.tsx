import { useEffect, useState } from 'react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { invalidateSiteCaches } from '@/lib/site';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea, Checkbox, Select } from '@/components/ui/Field';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import type { Plan } from '@/lib/types';
import { cn } from '@/lib/cn';

function PlanEditor({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(plan);
  const [features, setFeatures] = useState(plan.features.join('\n'));
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setForm(plan);
    setFeatures(plan.features.join('\n'));
  }, [plan]);
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLimit = (k: string, v: unknown) => setForm((f) => ({ ...f, limits: { ...f.limits, [k]: v } }));
  const priceChanged = form.monthly_price_cents !== plan.monthly_price_cents || form.annual_discount_pct !== plan.annual_discount_pct;

  const save = async () => {
    setPending(true);
    try {
      await admin.savePlan(plan.id, { ...form, features: features.split('\n').map((s) => s.trim()).filter(Boolean) });
      invalidateSiteCaches();
      toast({ tone: 'success', title: `${plan.name} saved`, description: 'Public pricing and app plan views read the same row.' });
      setConfirm(false);
      onSaved();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel className={cn(form.popular && 'border-accent/40')}>
      <PanelHeader title={<span>{form.name} <span className="font-mono text-technical text-subtle">{plan.id}</span></span>} description={form.visible ? 'Visible on the public pricing page' : 'Hidden from pricing'} action={<Button size="sm" onClick={() => (priceChanged ? setConfirm(true) : save())} loading={pending}>Save</Button>} />
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        <Field id={`${plan.id}-name`} label="Name"><Input id={`${plan.id}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field id={`${plan.id}-tag`} label="Tagline"><Input id={`${plan.id}-tag`} value={form.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field id={`${plan.id}-desc`} label="Description" className="lg:col-span-2"><Textarea id={`${plan.id}-desc`} value={form.description} onChange={(e) => set('description', e.target.value)} className="min-h-[64px]" /></Field>
        <Field id={`${plan.id}-price`} label="Monthly price (USD)"><Input id={`${plan.id}-price`} type="number" min={0} step="1" value={form.monthly_price_cents / 100} onChange={(e) => set('monthly_price_cents', Math.round(Number(e.target.value) * 100))} /></Field>
        <Field id={`${plan.id}-disc`} label="Annual discount %"><Input id={`${plan.id}-disc`} type="number" min={0} max={90} value={form.annual_discount_pct} onChange={(e) => set('annual_discount_pct', Number(e.target.value))} /></Field>
        <Field id={`${plan.id}-feat`} label="Features (one per line)" className="lg:col-span-2"><Textarea id={`${plan.id}-feat`} value={features} onChange={(e) => setFeatures(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-5">
          {[['projects', 'Projects (blank = ∞)'], ['credits_usd', 'Credit USD / mo'], ['replay_samples', 'Replay samples'], ['team_members', 'Seats (blank = ∞)'], ['telemetry_retention_days', 'Retention days']].map(([k, label]) => (
            <Field key={k} id={`${plan.id}-${k}`} label={label}><Input id={`${plan.id}-${k}`} type="number" value={form.limits[k as keyof Plan['limits']] === null || form.limits[k as keyof Plan['limits']] === undefined ? '' : String(form.limits[k as keyof Plan['limits']])} onChange={(e) => setLimit(k, e.target.value === '' ? null : Number(e.target.value))} /></Field>
          ))}
        </div>
        <div className="flex flex-wrap gap-5 lg:col-span-2">
          <Checkbox id={`${plan.id}-vis`} label="Visible" checked={form.visible} onChange={(e) => set('visible', e.target.checked)} />
          <Checkbox id={`${plan.id}-pop`} label="Popular" checked={form.popular} onChange={(e) => set('popular', e.target.checked)} />
          <Checkbox id={`${plan.id}-def`} label="Default for new accounts" checked={form.is_default} onChange={(e) => set('is_default', e.target.checked)} />
          <Checkbox id={`${plan.id}-cs`} label="Contact sales" checked={form.contact_sales} onChange={(e) => set('contact_sales', e.target.checked)} />
          <Checkbox id={`${plan.id}-gh`} label="GitHub" checked={Boolean(form.limits.github)} onChange={(e) => setLimit('github', e.target.checked)} />
          <Checkbox id={`${plan.id}-pdf`} label="PDF export" checked={Boolean(form.limits.pdf_export)} onChange={(e) => setLimit('pdf_export', e.target.checked)} />
        </div>
        <Field id={`${plan.id}-cta`} label="CTA label"><Input id={`${plan.id}-cta`} value={form.cta_label} onChange={(e) => set('cta_label', e.target.value)} /></Field>
        <Field id={`${plan.id}-href`} label="CTA destination" hint="Relative path, https or mailto."><Input id={`${plan.id}-href`} value={form.cta_href} onChange={(e) => set('cta_href', e.target.value)} /></Field>
        <Field id={`${plan.id}-sm`} label="Stripe monthly price id"><Input id={`${plan.id}-sm`} value={form.stripe_monthly_price_id || ''} onChange={(e) => set('stripe_monthly_price_id', e.target.value)} placeholder="price_…" /></Field>
        <Field id={`${plan.id}-sa`} label="Stripe annual price id"><Input id={`${plan.id}-sa`} value={form.stripe_annual_price_id || ''} onChange={(e) => set('stripe_annual_price_id', e.target.value)} placeholder="price_…" /></Field>
        <Field id={`${plan.id}-sort`} label="Sort order"><Input id={`${plan.id}-sort`} type="number" value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} /></Field>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={save} title={`Change ${plan.name} pricing?`} description={`Monthly $${(plan.monthly_price_cents / 100).toFixed(0)} → $${(form.monthly_price_cents / 100).toFixed(0)}, annual discount ${plan.annual_discount_pct}% → ${form.annual_discount_pct}%. The public pricing page updates immediately. Existing Stripe subscriptions are not repriced.`} confirmLabel="Change pricing" tone="danger" loading={pending} />
    </Panel>
  );
}

export default function AdminPricingPage() {
  const q = useAsync(() => admin.plans(), []);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const toast = useToast();
  const create = async () => {
    try {
      await admin.savePlan(newId, { name: newName, visible: false, monthly_price_cents: 0 });
      setCreating(false);
      setNewId('');
      setNewName('');
      invalidateSiteCaches();
      await q.reload(true);
      toast({ tone: 'success', title: 'Plan created (hidden)' });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create plan', description: errorMessage(e) });
    }
  };
  return (
    <>
      <PageHeader eyebrow="Internal" title="Pricing & plans" description="Single trusted source. The public pricing page, the app plan views and server-side limits all read this table." actions={<Button variant="secondary" size="sm" onClick={() => setCreating(true)}>New plan</Button>} />
      <InlineNotice tone="info" className="mb-4">Changes take effect immediately for new checkouts and limit checks. Stripe subscriptions already in place keep their price until changed in Stripe.</InlineNotice>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-96 rounded-lg" /> : <div className="flex flex-col gap-4">{q.data.plans.map((p) => <PlanEditor key={p.id} plan={p} onSaved={() => q.reload(true)} />)}</div>}
      {creating && (
        <Panel className="mt-4 p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <Field id="new-id" label="Plan id" hint="lowercase, e.g. scale"><Input id="new-id" value={newId} onChange={(e) => setNewId(e.target.value)} /></Field>
            <Field id="new-name" label="Name"><Input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            <Button onClick={create} disabled={!/^[a-z][a-z0-9_-]{1,30}$/.test(newId) || newName.length < 2}>Create</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
          <p className="text-technical mt-2 text-subtle">Requires superadmin. Tier select for models: <Select className="hidden" aria-hidden><option>—</option></Select> new plans start hidden.</p>
        </Panel>
      )}
    </>
  );
}
