import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, ButtonAnchor } from '@/components/ui/Button';
import { NumberTicker } from '@/components/ui/Metric';
import { Skeleton } from '@/components/ui/States';
import { planPrice, usePlans } from '@/lib/site';
import { useSession } from '@/lib/session';
import type { Plan } from '@/lib/types';

export function BillingToggle({ annual, onChange }: { annual: boolean; onChange: (v: boolean) => void }) {
  return (
    <div role="group" aria-label="Billing period" className="inline-flex items-center rounded-full border border-line bg-sunken p-1">
      {[
        { v: false, label: 'Monthly' },
        { v: true, label: 'Annual' },
      ].map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={annual === o.v} onClick={() => onChange(o.v)} className={cn('text-caption relative h-9 rounded-full px-4 transition-control', annual === o.v ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_17_21/0.1)]' : 'text-muted hover:text-ink')}>
          {o.label}
          {o.v && <span className="ml-2 rounded-full bg-verified-bg px-1.5 py-0.5 font-mono text-[10px] text-verified">−20%</span>}
        </button>
      ))}
    </div>
  );
}

export function PlanCard({ plan, annual, currentPlanId }: { plan: Plan; annual: boolean; currentPlanId?: string | null }) {
  const { status } = useSession();
  const navigate = useNavigate();
  const price = planPrice(plan, annual);
  const current = currentPlanId === plan.id;
  const onChoose = () => {
    if (plan.contact_sales) return;
    if (status === 'signed_in') navigate(`/app/usage?plan=${plan.id}&interval=${annual ? 'annual' : 'monthly'}`);
    else navigate(`/signup?plan=${plan.id}`);
  };
  return (
    <div className={cn('relative flex flex-col rounded-xl border bg-surface p-7', plan.popular ? 'border-accent/50 shadow-[0_24px_60px_-30px_rgba(47,111,220,0.45)]' : 'border-line')}>
      {plan.popular && (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-cta px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white">
          <Star size={10} fill="currentColor" aria-hidden /> Popular
        </span>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-h3 text-ink">{plan.name}</h3>
        {current && <span className="font-mono text-technical uppercase text-verified">Current</span>}
      </div>
      <p className="text-caption mt-2 min-h-[2.6em] text-muted">{plan.tagline}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        {plan.contact_sales && <span className="text-caption text-muted">from</span>}
        <span className="text-[2.5rem] font-semibold leading-none tracking-[-0.035em] text-ink">
          <NumberTicker value={price} format={(v) => `$${Math.round(v)}`} />
        </span>
        <span className="text-caption text-subtle">/ month</span>
      </div>
      <p className="text-technical mt-2 font-mono text-subtle">{annual ? `Billed annually · $${Math.round(price * 12)} / year` : 'Billed monthly'}</p>
      <ul className="mt-7 flex flex-1 flex-col gap-2.5 border-t border-line pt-6">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-caption text-muted">
            <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        {plan.contact_sales ? (
          <ButtonAnchor href={plan.cta_href} variant="secondary" className="w-full">
            {plan.cta_label}
          </ButtonAnchor>
        ) : (
          <Button variant={plan.popular ? 'primary' : 'secondary'} className="w-full" onClick={onChoose} disabled={current}>
            {current ? 'Your current plan' : plan.cta_label}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PricingGrid({ heading = true, currentPlanId }: { heading?: boolean; currentPlanId?: string | null }) {
  const [annual, setAnnual] = useState(true);
  const { plans, error } = usePlans();
  const visible = (plans || []).filter((p) => p.visible);
  return (
    <div className="container-page">
      {heading && (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-eyebrow uppercase text-muted">Pricing</p>
            <h2 className="text-h1 mt-5 max-w-[16ch] text-ink">Start light. Scale when Zev earns it.</h2>
            <p className="text-body mt-5 max-w-[48ch] text-muted">Every plan includes Zev credit for analysis and replay. Verified Savings is based on your own replay evidence; ZEVQORA never promises a savings percentage.</p>
          </div>
          <BillingToggle annual={annual} onChange={setAnnual} />
        </div>
      )}
      {!heading && (
        <div className="mb-6 flex justify-end">
          <BillingToggle annual={annual} onChange={setAnnual} />
        </div>
      )}
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {!plans && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[440px] rounded-xl" />)}
        {error && <p className="text-caption text-muted">{error}</p>}
        {visible.map((p) => (
          <PlanCard key={p.id} plan={p} annual={annual} currentPlanId={currentPlanId} />
        ))}
      </div>
      <p className="text-technical mt-8 font-mono text-subtle">
        Subscriptions renew until cancelled. Zev credit resets each billing period and is consumed only by provider cost during replay. <Link to="/security" className="underline underline-offset-4 hover:text-ink">Security overview</Link>.
      </p>
    </div>
  );
}
