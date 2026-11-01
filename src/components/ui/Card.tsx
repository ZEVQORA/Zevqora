import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ClaimBadge, Unknown, type Claim } from './Claim';

/** The brand card: white on Cloud, Stone border, 16 px radius, soft lift. */
export function Card({ className, children, as: As = 'section', ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'aside' }) {
  return (
    <As className={cn('rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgb(15_17_21/0.04),0_8px_24px_-18px_rgb(15_17_21/0.18)]', className)} {...props}>
      {children}
    </As>
  );
}

export function CardHeader({ title, description, action, eyebrow, className, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode; className?: string; id?: string }) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-eyebrow mb-1 uppercase text-subtle">{eyebrow}</div>}
        <h2 id={id} className="text-h4 text-ink">{title}</h2>
        {description && <p className="text-caption mt-1 max-w-[70ch] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export interface MetricProps {
  label: string;
  /** Formatted value; `null` renders an honest "unknown" (never 0). */
  value: ReactNode | null;
  claim: Claim;
  /** Unit shown under the value (e.g. "USD per successful outcome"). */
  unit?: string;
  source?: string;
  coverage?: string | null;
  asOf?: string | null;
  note?: ReactNode;
  unknownReason?: string;
  /** Drill-down to the supporting evidence. */
  href?: string;
  delta?: { text: string; direction: 'better' | 'worse' | 'flat' | 'unknown' } | null;
  className?: string;
  emphasis?: boolean;
}

/**
 * A KPI that carries its own provenance: claim class, unit, source, coverage
 * and timestamp, with a link to the evidence behind it.
 */
export function MetricCard({ label, value, claim, unit, source, coverage, asOf, note, unknownReason, href, delta, className, emphasis }: MetricProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium tracking-[0.01em] text-muted">{label}</h3>
        <ClaimBadge claim={claim} size="xs" />
      </div>
      <div className={cn('mt-2.5 min-w-0 break-words font-semibold leading-none tracking-[-0.03em] text-ink tnum', emphasis ? 'text-[2rem]' : 'text-[1.6rem]')}>
        {value === null || value === undefined ? <Unknown reason={unknownReason} className="text-[1rem] not-italic" /> : value}
      </div>
      {delta && (
        <p className={cn('mt-2 font-mono text-[11.5px] tnum', delta.direction === 'better' ? 'text-verified' : delta.direction === 'worse' ? 'text-rejected' : 'text-muted')}>
          {delta.direction === 'better' ? '▼ ' : delta.direction === 'worse' ? '▲ ' : ''}
          {delta.text}
        </p>
      )}
      {unit && <p className="mt-1.5 text-[11.5px] text-subtle">{unit}</p>}
      {(source || coverage || asOf || note) && (
        <dl className="mt-3 grid gap-0.5 border-t border-line pt-2.5 text-[11px] leading-snug text-subtle">
          {source && (
            <div className="flex gap-1.5">
              <dt className="sr-only">Source</dt>
              <dd className="min-w-0 break-words">{source}</dd>
            </div>
          )}
          {coverage && (
            <div className="flex gap-1.5">
              <dt>Coverage</dt>
              <dd className="min-w-0 break-words tnum">{coverage}</dd>
            </div>
          )}
          {asOf && (
            <div className="flex gap-1.5">
              <dt>As of</dt>
              <dd className="tnum">{asOf}</dd>
            </div>
          )}
          {note && <div className="min-w-0 break-words text-muted">{note}</div>}
        </dl>
      )}
    </>
  );
  const cls = cn('group relative flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(15_17_21/0.04)]', className);
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link to={href} className={cn(cls, 'transition-control hover:border-line-strong hover:shadow-[0_1px_2px_rgb(15_17_21/0.05),0_10px_28px_-18px_rgb(15_17_21/0.25)]')} aria-label={`${label}: open the supporting evidence`}>
      {body}
      <ArrowUpRight size={13} aria-hidden className="absolute bottom-3 right-3 text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </Link>
  );
}

/** A small number + label, for dense rows (pipelines, counts). */
export function StatTile({ label, value, hint, tone = 'default', className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'verified' | 'rejected' | 'warning' | 'accent'; className?: string }) {
  const color = tone === 'verified' ? 'text-verified' : tone === 'rejected' ? 'text-rejected' : tone === 'warning' ? 'text-warning' : tone === 'accent' ? 'text-accent-text' : 'text-ink';
  return (
    <div className={cn('min-w-0 rounded-md border border-line bg-surface px-3 py-2.5', className)}>
      <div className="text-[11px] font-medium text-subtle">{label}</div>
      <div className={cn('mt-1 text-[1.25rem] font-semibold leading-none tracking-[-0.02em] tnum', color)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-subtle">{hint}</div>}
    </div>
  );
}
