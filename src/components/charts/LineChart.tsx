import { useMemo, useState, type KeyboardEvent } from 'react';
import { useWidth, Legend } from './ChartContainer';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** null = no data for that point; drawn as a gap, never interpolated. */
  values: Array<number | null>;
  style?: 'solid' | 'dashed' | 'dotted';
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Multi-series line chart. The y axis starts at zero (no truncated axes);
 * missing points split the line; pointer and arrow keys move a readout that
 * names every series' value (or "unknown").
 */
export function LineChart({ series, labels, format, height = 200, ariaLabel }: { series: LineSeries[]; labels: string[]; format: (v: number) => string; height?: number; ariaLabel: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 12, t: 10, b: 26 };
  const w = Math.max(240, width);
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number')))), [series]);
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));

  const paths = series.map((s) => {
    const segs: string[] = [];
    let cur = '';
    s.values.forEach((v, i) => {
      if (v === null || v === undefined || !Number.isFinite(v)) {
        if (cur) segs.push(cur);
        cur = '';
        return;
      }
      cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (cur) segs.push(cur);
    return { s, d: segs.join(' '), singles: s.values.map((v, i) => (typeof v === 'number' && (i === 0 || s.values[i - 1] === null) && (i === n - 1 || s.values[i + 1] === null) ? i : -1)).filter((i) => i >= 0) };
  });

  const onMove = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * w - pad.l;
    const i = n <= 1 ? 0 : Math.round((rel / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, style: s.style }))} />
      <svg width={w} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} className="block max-w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--zq-border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" className="fill-[var(--zq-fg-subtle)] font-mono text-[10px]">{format(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % step === 0 || i === n - 1 ? <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-[var(--zq-fg-subtle)] font-mono text-[10px]">{l}</text> : null))}
        {paths.map(({ s, d, singles }) => (
          <g key={s.key}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.style === 'dashed' ? '6 4' : s.style === 'dotted' ? '1.5 3.5' : undefined} />
            {singles.map((i) => <circle key={i} cx={x(i)} cy={y(s.values[i] as number)} r={2.5} fill={s.color} />)}
          </g>
        ))}
        {hover !== null && (
          <g aria-hidden>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke="var(--zq-border-strong)" strokeDasharray="3 3" />
            {series.map((s) => (typeof s.values[hover] === 'number' ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={3.5} fill="var(--zq-surface)" stroke={s.color} strokeWidth={2} /> : null))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div role="status" aria-live="polite" className="pointer-events-none absolute top-6 z-10 min-w-[140px] rounded-md border border-line bg-surface px-2.5 py-2 text-[11.5px] shadow-lg" style={{ left: Math.min(Math.max(0, x(hover) - 70), w - 160) }}>
          <div className="mb-1 font-medium text-ink">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </span>
              <span className="font-mono tnum text-ink">{typeof s.values[hover] === 'number' ? format(s.values[hover] as number) : 'unknown'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
