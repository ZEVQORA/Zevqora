import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dateTime } from '@/lib/format';
import { ClaimBadge, type Claim } from '@/components/ui/Claim';
import { ErrorState, LoadingState } from '@/components/ui/States';

/** Container width via ResizeObserver, so charts redraw instead of stretching text. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width) || fallback));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}

export interface DataTableSpec {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

/**
 * Every chart says what it measures, in what unit, over what range, from which
 * source and when it was produced — and handles loading, error and empty
 * states itself. "View data" opens the numbers as a real table.
 */
export function ChartContainer({ title, description, unit, source, range, updatedAt, claims, loading, error, empty, emptyText, summary, table, children, className, action, onRetry }: {
  title: string;
  description?: ReactNode;
  unit?: string;
  source?: string;
  range?: string;
  updatedAt?: string | null;
  claims?: Claim[];
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: ReactNode;
  /** One-sentence plain-language summary for screen readers. */
  summary?: string;
  table?: DataTableSpec;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
  onRetry?: () => void;
}) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  return (
    <figure aria-labelledby={titleId} className={cn('min-w-0 rounded-lg border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(15_17_21/0.04)]', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {claims?.map((c) => <ClaimBadge key={c} claim={c} size="xs" />)}
          {action}
        </div>
      </div>
      <div className="mt-3 min-w-0">
        {loading ? (
          <LoadingState label={`Loading ${title}`} rows={3} />
        ) : error ? (
          <ErrorState compact message={error} onRetry={onRetry} />
        ) : empty ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-line-strong bg-sunken/50 px-4 py-6 text-center text-[12.5px] text-muted">{emptyText || 'No data in this range.'}</div>
        ) : (
          <>
            {summary && <p className="sr-only">{summary}</p>}
            {children}
          </>
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[11px] text-subtle">
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {unit && <span>Unit: {unit}</span>}
          {range && <span>Range: {range}</span>}
          {source && <span>Source: {source}</span>}
          {updatedAt && <span>Updated {dateTime(updatedAt)}</span>}
        </span>
        {table && !loading && !error && !empty && (
          <button type="button" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)} className="inline-flex items-center gap-1 font-medium text-accent-text">
            <Table2 size={11} aria-hidden /> {showTable ? 'Hide data' : 'View data'}
          </button>
        )}
      </figcaption>
      {showTable && table && (
        <div className="scrollbar-thin relative mt-2 max-h-64 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <caption className="sr-only">{title} — data</caption>
            <thead>
              <tr>{table.columns.map((c) => <th key={c} scope="col" className="border-b border-line py-1.5 pr-3 text-left font-medium text-subtle">{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} className="border-b border-line py-1.5 pr-3 font-mono tnum text-ink">{v === null || v === undefined ? 'unknown' : String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/** Legend entries that encode the claim class in the line style, not only the colour. */
export function Legend({ items }: { items: Array<{ label: string; color: string; style?: 'solid' | 'dashed' | 'dotted' }> }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line x1="1" y1="4" x2="17" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.style === 'dashed' ? '4 3' : it.style === 'dotted' ? '1.5 2.5' : undefined} strokeLinecap="round" />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
