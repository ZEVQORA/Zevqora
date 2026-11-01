import { useMemo, useState } from 'react';
import { useWidth } from './ChartContainer';

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Highlighted points (e.g. the Pareto frontier) are filled; others are outlined. */
  emphasis?: boolean;
  selected?: boolean;
}

/**
 * Two-metric tradeoff scatter (e.g. cost per successful outcome vs p95).
 * Axes start at zero; points with an unknown metric are listed separately by
 * the caller, never plotted at zero.
 */
export function ScatterChart({ points, xLabel, yLabel, formatX, formatY, height = 240, ariaLabel, onSelect }: { points: ScatterPoint[]; xLabel: string; yLabel: string; formatX: (v: number) => string; formatY: (v: number) => string; height?: number; ariaLabel: string; onSelect?: (id: string) => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const pad = { l: 58, r: 16, t: 12, b: 38 };
  const w = Math.max(260, width);
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const { maxX, maxY } = useMemo(() => ({ maxX: Math.max(...points.map((p) => p.x), 0) * 1.12 || 1, maxY: Math.max(...points.map((p) => p.y), 0) * 1.12 || 1 }), [points]);
  const sx = (v: number) => pad.l + (v / maxX) * innerW;
  const sy = (v: number) => pad.t + innerH - (v / maxY) * innerH;
  // Points with identical coordinates fan out slightly so each stays clickable.
  const offsets = useMemo(() => {
    const seen = new Map<string, number>();
    return points.map((p) => {
      const k = `${p.x}|${p.y}`;
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      return n * 7;
    });
  }, [points]);
  const active = points.find((p) => p.id === hover);
  return (
    <div ref={ref} className="relative min-w-0">
      <svg width={w} height={height} role="img" aria-label={ariaLabel} className="block max-w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={pad.l + innerW} y1={pad.t + innerH * (1 - f)} y2={pad.t + innerH * (1 - f)} stroke="var(--zq-border)" />
            <text x={pad.l - 6} y={pad.t + innerH * (1 - f) + 3.5} textAnchor="end" className="fill-[var(--zq-fg-subtle)] font-mono text-[10px]">{formatY(maxY * f)}</text>
            <text x={pad.l + innerW * f} y={pad.t + innerH + 14} textAnchor="middle" className="fill-[var(--zq-fg-subtle)] font-mono text-[10px]">{formatX(maxX * f)}</text>
          </g>
        ))}
        <text x={pad.l + innerW / 2} y={height - 4} textAnchor="middle" className="fill-[var(--zq-fg-muted)] text-[11px]">{xLabel} →</text>
        <text transform={`translate(12 ${pad.t + innerH / 2}) rotate(-90)`} textAnchor="middle" className="fill-[var(--zq-fg-muted)] text-[11px]">{yLabel} →</text>
        {points.map((p, i) => (
          <g key={p.id} transform={`translate(${sx(p.x) + offsets[i]} ${sy(p.y)})`}>
            <circle
              r={p.selected ? 8 : 6}
              fill={p.emphasis ? 'var(--zq-accent)' : 'var(--zq-surface)'}
              stroke={p.emphasis ? 'var(--zq-accent-hover)' : 'var(--zq-fg-subtle)'}
              strokeWidth={p.selected ? 3 : 1.5}
              tabIndex={0}
              role="button"
              aria-label={`${p.label}: ${xLabel} ${formatX(p.x)}, ${yLabel} ${formatY(p.y)}${p.emphasis ? ', on the frontier' : ''}`}
              onPointerEnter={() => setHover(p.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(p.id)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(p.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(p.id)}
              className="cursor-pointer outline-none focus-visible:stroke-[var(--zq-focus)]"
            />
          </g>
        ))}
      </svg>
      {active && (
        <div role="status" className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-line bg-surface px-2.5 py-2 text-[11.5px] shadow-lg" style={{ left: Math.min(sx(active.x) + 12, w - 250), top: Math.max(0, sy(active.y) - 50) }}>
          <div className="font-medium text-ink">{active.label}</div>
          <div className="font-mono text-muted tnum">{xLabel}: {formatX(active.x)}</div>
          <div className="font-mono text-muted tnum">{yLabel}: {formatY(active.y)}</div>
        </div>
      )}
    </div>
  );
}
