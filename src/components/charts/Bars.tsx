import { Unknown } from '@/components/ui/Claim';
import { useWidth } from './ChartContainer';

/** Labelled horizontal bars. Unknown values are listed as unknown, never as an empty bar. */
export function HBarChart({ rows, format, max, color = 'var(--zq-accent)', ariaLabel }: { rows: Array<{ label: string; value: number | null; sub?: string }>; format: (v: number) => string; max?: number; color?: string; ariaLabel: string }) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <ul aria-label={ariaLabel} className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-ink" title={r.label}>{r.label}</span>
            <span className="shrink-0 font-mono text-[12px] tnum text-muted">{r.value === null ? <Unknown /> : format(r.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/70" aria-hidden>
            {r.value !== null && top > 0 && <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: color }} />}
          </div>
          {r.sub && <div className="mt-0.5 text-[11px] text-subtle">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars over time or categories, starting at zero. */
export function ColumnChart({ values, labels, format, height = 160, color = 'var(--zq-accent)', ariaLabel }: { values: Array<number | null>; labels: string[]; format: (v: number) => string; height?: number; color?: string; ariaLabel: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const pad = { l: 44, r: 8, t: 8, b: 24 };
  const n = values.length;
  const innerW = Math.max(200, width) - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(0, ...values.map((v) => v ?? 0)) || 1;
  const bw = Math.max(2, Math.min(28, innerW / Math.max(1, n) - 3));
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));
  return (
    <div ref={ref} className="min-w-0">
      <svg width={Math.max(200, width)} height={height} role="img" aria-label={ariaLabel} className="block max-w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={pad.l + innerW} y1={pad.t + innerH * (1 - f)} y2={pad.t + innerH * (1 - f)} stroke="var(--zq-border)" />
            <text x={pad.l - 6} y={pad.t + innerH * (1 - f) + 3.5} textAnchor="end" className="fill-[var(--zq-fg-subtle)] font-mono text-[10px]">{format(max * f)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = pad.l + (i + 0.5) * (innerW / Math.max(1, n));
          if (v === null) return <text key={i} x={cx} y={pad.t + innerH - 3} textAnchor="middle" className="fill-[var(--zq-fg-subtle)] text-[9px]">?</text>;
          const h = (v / max) * innerH;
          return (
            <rect key={i} x={cx - bw / 2} y={pad.t + innerH - h} width={bw} height={Math.max(v > 0 ? 1.5 : 0, h)} rx={2} fill={color}>
              <title>{`${labels[i]}: ${format(v)}`}</title>
            </rect>
          );
        })}
        {labels.map((l, i) => (i % step === 0 || i === n - 1 ? <text key={i} x={pad.l + (i + 0.5) * (innerW / Math.max(1, n))} y={height - 7} textAnchor="middle" className="fill-[var(--zq-fg-subtle)] font-mono text-[10px]">{l}</text> : null))}
      </svg>
    </div>
  );
}

/**
 * A conversion funnel: each step's count, its share of the first step and the
 * step-to-step conversion. A null step count is unknown, and conversions that
 * depend on it are unknown too.
 */
export function FunnelChart({ steps, ariaLabel }: { steps: Array<{ key: string; label: string; value: number | null; note?: string }>; ariaLabel: string }) {
  const first = steps[0]?.value ?? null;
  const top = Math.max(1, ...steps.map((s) => s.value ?? 0));
  return (
    <ol aria-label={ariaLabel} className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = i > 0 && prev !== null && s.value !== null && prev > 0 ? s.value / prev : null;
        return (
          <li key={s.key} className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 text-[12.5px] max-sm:grid-cols-[minmax(0,1fr)_auto]">
            <span className="min-w-0 truncate text-ink" title={s.note || s.label}>{s.label}</span>
            <div className="h-5 overflow-hidden rounded-sm bg-line/50 max-sm:col-span-2 max-sm:row-start-2" aria-hidden>
              {s.value !== null && <div className="h-full rounded-sm bg-accent/85" style={{ width: `${Math.max(s.value > 0 ? 1.5 : 0, (s.value / top) * 100)}%` }} />}
            </div>
            <span className="whitespace-nowrap text-right font-mono text-[12px] tnum text-muted">
              <b className="font-semibold text-ink">{s.value === null ? 'unknown' : s.value.toLocaleString()}</b>
              {i > 0 && <span className="ml-2">{conv === null ? '—' : `${(conv * 100).toFixed(conv < 0.1 ? 1 : 0)}%`}</span>}
              {i > 0 && first ? <span className="sr-only"> ({s.value === null ? 'unknown' : `${((s.value / first) * 100).toFixed(1)}% of ${steps[0].label}`})</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
