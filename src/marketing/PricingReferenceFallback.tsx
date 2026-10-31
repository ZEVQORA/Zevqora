import { useSiteContent } from '@/lib/site';
/** Reference prices from the 2026-10-31 redesign — NEVER substitute for live checkout. */
const REFERENCE_PLANS = [
  { name: 'Starter', usd: 49, note: 'For teams evaluating their first AI workloads.' },
  { name: 'Pro', usd: 99, note: 'For teams with recurring optimization experiments.' },
  { name: 'Enterprise', usd: 299, note: 'From this reference level; quote and setup required.' },
] as const;
export function PricingReferenceFallback({ annual }: { annual: boolean }) {
  const { contact } = useSiteContent();
  return (
    <div className="mt-8">
      <p role="status" className="rounded-lg border border-line bg-sunken p-4 text-[14px] leading-relaxed text-muted">Live plan data is unavailable. These are the redesign's <strong>reference prices</strong>, not a verified current offer, checkout or enterprise entitlement. Contact the team to confirm pricing and access.</p>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {REFERENCE_PLANS.map((plan) => <article key={plan.name} className="flex flex-col rounded-xl border border-line bg-surface p-7">
          <h3 className="text-[20px] font-semibold text-ink">{plan.name}</h3>
          <p className="mt-3 flex items-end gap-2"><span className="text-[40px] font-semibold leading-none text-ink">${Math.round(plan.usd * (annual ? 0.8 : 1))}</span><span className="text-[13px] text-muted">/ month (reference)</span></p>
          <p className="mt-2 text-[12px] text-muted">{annual ? '20% annual reference discount · unconfirmed' : 'Monthly reference rate · unconfirmed'}</p>
          <p className="mt-5 flex-1 text-[14px] leading-relaxed text-muted">{plan.note}</p>
          <a className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 text-[14px] font-semibold text-ink hover:bg-sunken" href={`mailto:${contact.email}?subject=${encodeURIComponent(`ZEVQORA ${plan.name} plan inquiry`)}`}>{plan.name === 'Enterprise' ? 'Contact sales' : 'Request access'}</a>
        </article>)}
      </div>
    </div>
  );
}
