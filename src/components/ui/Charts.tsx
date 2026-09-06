import { useId, useMemo } from 'react';
import { cn } from '@/lib/cn';

/** Sparkline with a soft area. Pure SVG; no chart library. */
export function Sparkline({ values, className, height = 56, stroke = '#2f6fdc', fill = 'rgba(70,139,255,0.14)' }: { values: number[]; className?: string; height?: number; stroke?: string; fill?: string }) {
  const id = useId().replace(/:/g, '');
  const width = 240;
  const path = useMemo(() => {
    if (values.length < 2) return { line: '', area: '' };
    const max = Math.max(...values, 0.000001);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 4 - ((v - min) / span) * (height - 10)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [values, height]);
  if (values.length < 2) return <div className={cn('flex items-center text-technical text-subtle', className)} style={{ height }}>Not enough data yet.</div>;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn('block w-full', className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={fill} />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={path.area} fill={`url(#${id}-a)`} />
      <path d={path.line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Horizontal share bars for provider/model breakdowns. */
export function ShareBars({ rows, format, className, max }: { rows: Array<{ label: string; value: number; sub?: string }>; format: (v: number) => string; className?: string; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0.000001);
  if (!rows.length) return <p className={cn('text-technical text-subtle', className)}>No data in this window.</p>;
  return (
    <ul className={cn('flex flex-col gap-3', className)}>
      {rows.map((r) => (
        <li key={r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-caption truncate text-ink">{r.label}</span>
            <span className="text-technical tnum shrink-0 font-mono text-muted">{format(r.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/70">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[cubic-bezier(0.2,0,0,1)]" style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} />
          </div>
          {r.sub && <div className="text-technical mt-1 text-subtle">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Daily bars. */
export function Bars({ values, labels, className, height = 96, format }: { values: number[]; labels?: string[]; className?: string; height?: number; format?: (v: number) => string }) {
  const max = Math.max(...values, 0.000001);
  if (!values.length) return <p className={cn('text-technical text-subtle', className)}>No data in this window.</p>;
  return (
    <div className={cn('flex items-end gap-[3px]', className)} style={{ height }} role="img" aria-label="Daily values">
      {values.map((v, i) => (
        <div key={i} className="group relative flex-1" style={{ height: '100%' }} title={`${labels?.[i] ?? ''} ${format ? format(v) : v}`}>
          <div className="absolute bottom-0 w-full rounded-t-[3px] bg-accent/80 transition-[height] duration-500 ease-[cubic-bezier(0.2,0,0,1)] group-hover:bg-accent" style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, className, tone = 'accent' }: { value: number; max: number; className?: string; tone?: 'accent' | 'warning' | 'rejected' | 'verified' }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const color = tone === 'warning' ? 'bg-warning' : tone === 'rejected' ? 'bg-rejected' : tone === 'verified' ? 'bg-verified' : 'bg-accent';
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-line/70', className)} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.2,0,0,1)]', color)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
