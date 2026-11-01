import { Fragment, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SegmentedControl } from './Segmented';

export function Breadcrumbs({ items, className }: { items: Array<{ label: ReactNode; to?: string }>; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              <li className={cn('min-w-0 truncate', last && 'font-medium text-ink')} aria-current={last ? 'page' : undefined}>
                {it.to && !last ? (
                  <Link to={it.to} className="rounded-sm transition-control hover:text-ink">
                    {it.label}
                  </Link>
                ) : (
                  it.label
                )}
              </li>
              {!last && (
                <li aria-hidden className="shrink-0 text-subtle">
                  <ChevronRight size={12} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** Page title block used by every product and admin view. */
export function ViewHeader({ title, description, eyebrow, actions, children, className }: { title: ReactNode; description?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-eyebrow mb-1.5 uppercase text-subtle">{eyebrow}</div>}
        <h1 className="text-[1.6rem] font-bold leading-tight tracking-[-0.03em] text-ink md:text-[1.85rem]">{title}</h1>
        {description && <p className="text-body mt-1.5 max-w-[72ch] text-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Filters that collapse behind one button on narrow screens instead of
 * wrapping into a wall of controls.
 */
export function FilterBar({ children, summary, className }: { children: ReactNode; summary?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={cn('mb-4', className)}>
      <div className="flex items-center justify-between gap-2 md:hidden">
        <span className="text-[12.5px] text-muted">{summary}</span>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-ink">
          <SlidersHorizontal size={13} aria-hidden /> Filters
        </button>
      </div>
      <div id={id} className={cn('mt-2 flex-wrap items-center gap-2 md:mt-0 md:flex', open ? 'flex' : 'hidden')}>
        {children}
      </div>
    </div>
  );
}

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
export interface RangeValue {
  preset: RangePreset;
  from?: string;
  to?: string;
}

export function rangeQuery(r: RangeValue) {
  return r.preset === 'custom' && r.from && r.to ? `range=custom&from=${r.from}&to=${r.to}` : `range=${r.preset === 'custom' ? '30d' : r.preset}`;
}

export function rangeLabel(r: RangeValue) {
  return r.preset === 'today' ? 'Today (UTC)' : r.preset === 'custom' ? `${r.from} → ${r.to} (UTC)` : `Last ${r.preset.replace('d', ' days')}`;
}

/** Presets plus a validated custom range (whole UTC days; end on or after start). */
export function DateRangePicker({ value, onChange, presets = ['today', '7d', '30d', '90d'], className }: { value: RangeValue; onChange: (v: RangeValue) => void; presets?: RangePreset[]; className?: string }) {
  const [from, setFrom] = useState(value.from || '');
  const [to, setTo] = useState(value.to || '');
  const invalid = Boolean(from && to && to < from);
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <SegmentedControl
        label="Time range"
        size="sm"
        value={value.preset}
        onChange={(preset) => onChange(preset === 'custom' ? { preset, from: from || undefined, to: to || undefined } : { preset })}
        options={[...presets.map((p) => ({ value: p, label: p === 'today' ? 'Today' : p.replace('d', ' days') })), { value: 'custom' as RangePreset, label: 'Custom' }]}
      />
      {value.preset === 'custom' && (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
          <label className="sr-only" htmlFor="range-from">From</label>
          <input id="range-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-sm border border-line-control bg-surface px-2 text-[12px] text-ink" />
          <span aria-hidden className="text-subtle">→</span>
          <label className="sr-only" htmlFor="range-to">To</label>
          <input id="range-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={invalid} className="h-8 rounded-sm border border-line-control bg-surface px-2 text-[12px] text-ink" />
          <button type="button" disabled={!from || !to || invalid} onClick={() => onChange({ preset: 'custom', from, to })} className="h-8 rounded-sm bg-cta px-2.5 text-[12px] font-medium text-cta-fg disabled:opacity-40">
            Apply
          </button>
          {invalid && <span role="alert" className="text-rejected">End is before start.</span>}
        </span>
      )}
    </div>
  );
}

/** A labelled region with an id so pages can deep-link to it. */
export function Region({ id, title, description, action, children, className }: { id?: string; title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={hid} className={cn('scroll-mt-20', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={hid} className="text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 max-w-[72ch] text-[12.5px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
