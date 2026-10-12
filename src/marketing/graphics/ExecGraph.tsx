import { useState } from 'react';
import { cn } from '@/lib/cn';
import { SegmentedControl } from '@/components/ui/Segmented';

type Mode = 'structure' | 'cost' | 'latency';

interface N {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  cost: number | null;
  ms: number | null;
}

// Synthetic illustration: one support-agent request as a ZevIR graph.
const NODES: N[] = [
  { id: 't', kind: 'Task', name: 'resolve_ticket', x: 20, y: 120, cost: null, ms: 3420 },
  { id: 'a', kind: 'Agent', name: 'support_agent', x: 170, y: 120, cost: null, ms: 3380 },
  { id: 'r', kind: 'Retrieval', name: 'kb_search', x: 330, y: 30, cost: null, ms: 980 },
  { id: 'm1', kind: 'ModelCall', name: 'classify', x: 330, y: 120, cost: 0.0019, ms: 610 },
  { id: 'tc', kind: 'ToolCall', name: 'lookup_order', x: 330, y: 210, cost: null, ms: 420 },
  { id: 'm2', kind: 'ModelCall', name: 'draft_reply', x: 490, y: 120, cost: 0.0124, ms: 1720 },
  { id: 'rt', kind: 'Runtime', name: 'provider', x: 640, y: 50, cost: null, ms: null },
  { id: 'o', kind: 'Outcome', name: 'answer', x: 640, y: 190, cost: null, ms: null },
];
const EDGES: Array<[string, string, string]> = [
  ['t', 'a', 'CALLS'],
  ['a', 'r', 'CALLS'],
  ['a', 'm1', 'CALLS'],
  ['a', 'tc', 'CALLS'],
  ['r', 'm2', 'PROVIDES_CONTEXT'],
  ['m1', 'm2', 'DEPENDS_ON'],
  ['m2', 'rt', 'SERVED_BY'],
  ['m2', 'o', 'PRODUCES'],
];
const CRITICAL = new Set(['t', 'a', 'r', 'm2', 'o']);
const W = 130;
const H = 46;

/** Animated ZevIR graph (SVG + CSS, paused under reduced motion). */
export function ExecGraph({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>('structure');
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const maxCost = Math.max(...NODES.map((n) => n.cost ?? 0));
  const fill = (n: N) => {
    if (mode === 'cost') return n.cost === null ? (n.kind === 'ModelCall' ? 'url(#zq-hatch)' : 'var(--zq-surface)') : `rgb(70 139 255 / ${0.12 + (n.cost / maxCost) * 0.45})`;
    if (mode === 'latency') return CRITICAL.has(n.id) ? 'var(--zq-accent-subtle)' : 'var(--zq-surface)';
    return 'var(--zq-surface)';
  };
  const label = (n: N) => (mode === 'cost' ? (n.cost === null ? (n.kind === 'ModelCall' ? 'cost unknown' : '—') : `$${n.cost.toFixed(4)}`) : mode === 'latency' ? (n.ms === null ? '—' : n.ms >= 1000 ? `${(n.ms / 1000).toFixed(2)} s` : `${n.ms} ms`) : n.kind);
  return (
    <figure className={cn('min-w-0', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl label="Graph overlay" size="sm" value={mode} onChange={setMode} options={[{ value: 'structure', label: 'Structure' }, { value: 'cost', label: 'Cost' }, { value: 'latency', label: 'Critical path' }]} />
        <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-warning">Synthetic illustration</span>
      </div>
      <div className="overflow-x-auto rounded-[18px] border border-line bg-surface p-3 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
        <svg viewBox="0 0 790 270" className="block h-auto w-full min-w-[620px]" role="img" aria-label={`Execution graph of one support request: task, agent, retrieval, two model calls, a tool call, runtime and outcome. Overlay: ${mode}.`}>
          <defs>
            <pattern id="zq-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" fill="var(--zq-surface)" />
              <line x1="0" y1="0" x2="0" y2="8" stroke="var(--zq-border-strong)" strokeWidth="3" />
            </pattern>
            <marker id="zq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--zq-border-strong)" />
            </marker>
          </defs>
          {EDGES.map(([s, t, kind]) => {
            const a = byId[s];
            const b = byId[t];
            const crit = mode === 'latency' && CRITICAL.has(s) && CRITICAL.has(t);
            const x1 = a.x + W;
            const y1 = a.y + H / 2;
            const x2 = b.x;
            const y2 = b.y + H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <g key={`${s}-${t}`}>
                <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 4},${y2}`} fill="none" stroke={crit ? 'var(--zq-accent)' : 'var(--zq-border-strong)'} strokeWidth={crit ? 2.6 : 1.4} markerEnd="url(#zq-arrow)" className={crit || mode === 'structure' ? 'zq-flow' : undefined} />
                {mode === 'structure' && <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" className="fill-[var(--zq-fg-subtle)] font-mono text-[8.5px]">{kind}</text>}
              </g>
            );
          })}
          {NODES.map((n) => (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              <rect width={W} height={H} rx="11" fill={fill(n)} stroke={mode === 'latency' && CRITICAL.has(n.id) ? 'var(--zq-accent)' : 'var(--zq-border)'} strokeWidth={mode === 'latency' && CRITICAL.has(n.id) ? 1.8 : 1} />
              <text x="10" y="17" className="fill-[var(--zq-accent-text)] font-mono text-[8.5px] uppercase">{n.kind}</text>
              <text x="10" y="31" className="fill-[var(--zq-fg)] text-[11px] font-medium">{n.name}</text>
              <text x={W - 8} y="17" textAnchor="end" className="fill-[var(--zq-fg-muted)] font-mono text-[8.5px]">{mode === 'structure' ? '' : label(n)}</text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-2 text-[12px] text-muted">
        {mode === 'cost' && 'Cost overlay: priced model calls are shaded by cost; an unpriced model call is hatched as unknown — never drawn as $0.'}
        {mode === 'latency' && 'Critical path: each step follows the child that finished last. With missing timestamps ZEVQORA shows the reason instead of a path.'}
        {mode === 'structure' && 'Every node keeps its source span, evidence hash and adapter version, so any number can be traced back.'}
      </figcaption>
    </figure>
  );
}
