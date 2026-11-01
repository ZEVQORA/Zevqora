import { useNavigate } from 'react-router';
import { useCallback, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { ClaimBadge, Unknown } from '@/components/ui/Claim';
import { StatTile } from '@/components/ui/Card';
import { useProduct } from '../store';
import { fmt, type CommandCenter, type ProductCard, type Projection, type SelectedPlan } from '../experience';

/** Selects a workload in the product store, then opens a view for it. */
export function useOpenWorkload() {
  const { selectProduct } = useProduct();
  const navigate = useNavigate();
  return useCallback(
    (productId: string | null, href: string) => {
      if (productId) selectProduct(productId);
      navigate(href);
    },
    [selectProduct, navigate],
  );
}

export const orUnknown = (v: string | null, reason?: string): ReactNode => (v === null ? <Unknown reason={reason} /> : v);

/** Signed percentage change where lower is better (cost, latency). */
export function lowerIsBetter(pct: number | null | undefined) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return { text: `${fmt.signedPct(pct)} vs baseline`, direction: pct < 0 ? ('better' as const) : pct > 0 ? ('worse' as const) : ('flat' as const) };
}

/** The primary workload: the one with a baseline and the most recent traffic. */
export function primaryWorkload(cc: CommandCenter): ProductCard | null {
  const withBase = cc.products.filter((p) => p.baseline);
  const pool = withBase.length ? withBase : cc.products;
  return [...pool].sort((a, b) => b.traces_in_window - a.traces_in_window)[0] || null;
}

/** Herfindahl index of spend across models (1 = all spend on one model). Null when no cost is known. */
export function spendConcentration(cc: CommandCenter) {
  const known = cc.observed.by_model.filter((m) => typeof m.spend_usd === 'number');
  const total = known.reduce((a, m) => a + (m.spend_usd as number), 0);
  if (!known.length || total <= 0) return null;
  return known.reduce((a, m) => a + ((m.spend_usd as number) / total) ** 2, 0);
}

export function DecisionQueue({ items, onOpen }: { items: CommandCenter['decision_queue']; onOpen: (productId: string, href: string) => void }) {
  if (!items.length) return <p className="rounded-md border border-dashed border-line-strong bg-sunken/50 px-4 py-5 text-center text-[12.5px] text-muted">Nothing is waiting for a decision.</p>;
  return (
    <ol className="divide-y divide-line">
      {items.map((it, i) => (
        <li key={`${it.kind}-${it.product_id}-${i}`}>
          <button type="button" onClick={() => onOpen(it.product_id, it.href)} className="group flex w-full items-start gap-3 py-3 text-left">
            <span aria-hidden className={cn('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px]', it.priority === 1 ? 'bg-accent text-white' : 'bg-sunken text-muted')}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-ink group-hover:text-accent-text">{it.title}</span>
              <span className="mt-0.5 block text-[12px] text-muted">{it.product} · {it.detail}</span>
            </span>
            <ArrowRight size={14} aria-hidden className="mt-1 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" />
          </button>
        </li>
      ))}
    </ol>
  );
}

export function RiskList({ risks, products }: { risks: CommandCenter['risks']; products: ProductCard[] }) {
  if (!risks.length) return <p className="text-[12.5px] text-muted">No technical risks flagged by the current baselines.</p>;
  const name = (id: string) => products.find((p) => p.id === id)?.name || 'Workload';
  return (
    <ul className="divide-y divide-line">
      {risks.map((r, i) => (
        <li key={i} className="flex items-start gap-2.5 py-2.5">
          {r.severity === 'high' ? <ShieldAlert size={15} className="mt-0.5 shrink-0 text-rejected" aria-hidden /> : <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', r.severity === 'medium' ? 'text-warning' : 'text-subtle')} aria-hidden />}
          <div className="min-w-0">
            <p className="text-[13px] text-ink">
              <span className="sr-only">{r.severity} severity: </span>
              {r.title}
            </p>
            <p className="text-[11.5px] text-subtle">{name(r.product_id)} · {r.kind.replace(/_/g, ' ')}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Workloads → baseline → diagnoses → plans → calibrated → replayed → verified → frontier → selected. */
export function Pipeline({ p }: { p: CommandCenter['pipeline'] }) {
  const steps: Array<[string, number, 'default' | 'verified' | 'rejected' | 'accent' | 'warning']> = [
    ['Workloads', p.workloads, 'default'],
    ['Baselines', p.baselines, 'default'],
    ['Diagnoses', p.diagnoses, 'default'],
    ['Plans generated', p.plans_generated, 'default'],
    ['Calibrated', p.calibrated, 'accent'],
    ['Fully replayed', p.replayed, 'accent'],
    ['VERIFIED', p.verified, 'verified'],
    ['On frontier', p.frontier, 'verified'],
    ['Selected', p.selected, 'verified'],
  ];
  return (
    <div>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {steps.map(([label, value, tone]) => (
          <li key={label}>
            <StatTile label={label} value={value.toLocaleString()} tone={tone} />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11.5px] text-subtle">
        Also: {p.rejected} REJECTED · {p.incomplete} INCOMPLETE · {p.blocked} blocked (not replayable yet or missing evidence). VERIFIED means verified on replay under a frozen contract — not deployed.
      </p>
    </div>
  );
}

export function EvaluatedPlanLine({ plan, compact = false }: { plan: SelectedPlan & { product?: string; policy?: string }; compact?: boolean }) {
  const d = plan.deltas_pct || {};
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <ClaimBadge claim="VERIFIED" size="xs" />
        <span className="min-w-0 break-words text-[13px] font-medium text-ink">{plan.name}</span>
      </div>
      {!compact && plan.product && <p className="mt-0.5 text-[11.5px] text-subtle">{plan.product}{plan.policy ? ` · selected by ${plan.policy.replace(/_/g, ' ').toLowerCase()}` : ''} · risk {plan.risk_class}</p>}
      <dl className="mt-1.5 grid grid-cols-3 gap-2 text-[11.5px]">
        <div><dt className="text-subtle">Cost / success</dt><dd className="font-mono tnum text-ink">{orUnknown(fmt.signedPct(d.cost_per_successful_outcome ?? null))}</dd></div>
        <div><dt className="text-subtle">Total cost</dt><dd className="font-mono tnum text-ink">{orUnknown(fmt.signedPct(d.cost ?? null))}</dd></div>
        <div><dt className="text-subtle">p95</dt><dd className="font-mono tnum text-ink">{orUnknown(fmt.signedPct(d.p95 ?? null))}</dd></div>
      </dl>
      <p className="mt-1 text-[11px] text-subtle">Evaluated on {plan.cases ?? 'unknown'} replayed cases under the frozen contract.</p>
    </div>
  );
}

export function ProjectionNote({ projection }: { projection: Projection }) {
  return (
    <details className="mt-2 text-[11.5px] text-muted">
      <summary className="cursor-pointer font-medium text-accent-text">How this is projected</summary>
      <p className="mt-1">{projection.basis.formula}.</p>
      <ul className="mt-1 list-disc pl-4">
        {projection.basis.assumptions.map((a) => <li key={a}>{a}</li>)}
      </ul>
    </details>
  );
}

export function freshness(cc: CommandCenter) {
  return `Generated ${relativeTime(cc.generated_at)} · last ${cc.range.days} days`;
}
