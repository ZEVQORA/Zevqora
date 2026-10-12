import { AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';

const Synthetic = () => <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-warning">Synthetic illustration</span>;

/** VERIFIED / REJECTED / INCOMPLETE, using the approved internal example for REJECTED. */
export function VerdictDemo({ proof }: { proof: { kind: string; cases: number; rejected: { cost_reduction: string; quality: string; quality_floor: string }; qualifier: string } }) {
  const cards = [
    { status: 'REJECTED', Icon: X, tone: 'border-rejected/30', chip: 'bg-rejected-bg text-rejected', title: `${proof.rejected.cost_reduction} cheaper — and rejected`, body: `Quality ${proof.rejected.quality} fell below the frozen floor of ${proof.rejected.quality_floor}. A cheaper candidate that breaks quality is not a saving.`, foot: `${proof.kind}, ${proof.cases} cases. Not customer data.` },
    { status: 'VERIFIED', Icon: Check, tone: 'border-verified/30', chip: 'bg-verified-bg text-verified', title: 'Every gate passed on replay', body: 'Quality floor, non-inferiority, protected cases, task success, cost and latency all held under the frozen Evaluation Contract. Still not deployed: a person decides.', foot: 'What VERIFIED means — not a result.' },
    { status: 'INCOMPLETE', Icon: AlertTriangle, tone: 'border-warning/30', chip: 'bg-warning-bg text-warning', title: 'Evidence was missing', body: 'Cost was unknown on some cases, so the verdict is neither yes nor no. ZEVQORA lists exactly what evidence is still needed.', foot: 'Unknown is never treated as zero.' },
  ] as const;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((c) => (
        <article key={c.status} className={cn('flex flex-col rounded-[20px] border bg-surface p-6 shadow-[0_1px_2px_rgb(15_17_21/0.04)]', c.tone)}>
          <span className={cn('inline-flex w-fit items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[11px] tracking-wide', c.chip)}>
            <c.Icon size={11} strokeWidth={2.75} aria-hidden /> {c.status}
          </span>
          <h3 className="mt-4 text-[1.1rem] font-semibold tracking-[-0.015em] text-ink">{c.title}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{c.body}</p>
          <p className="mt-auto pt-5 font-mono text-[11px] text-subtle">{c.foot}</p>
        </article>
      ))}
    </div>
  );
}

/** Baseline vs candidate on the metrics a verdict uses. Synthetic values, labelled. */
export function BeforeAfter() {
  const rows = [
    { k: 'Cost per successful outcome', a: 0.0040, b: 0.0016, fmt: (v: number) => `$${v.toFixed(4)}`, lower: true },
    { k: 'p95 latency', a: 2124, b: 2124, fmt: (v: number) => `${(v / 1000).toFixed(2)} s`, lower: true },
    { k: 'Task success', a: 0.966, b: 0.966, fmt: (v: number) => `${(v * 100).toFixed(1)}%`, lower: false },
    { k: 'Protected cases failing', a: 0, b: 0, fmt: (v: number) => String(v), lower: true },
  ];
  return (
    <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-ink">Baseline vs evaluated plan</p>
        <Synthetic />
      </div>
      <ul className="flex flex-col gap-4">
        {rows.map((r) => {
          const max = Math.max(r.a, r.b) || 1;
          return (
            <li key={r.k}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink">{r.k}</span>
                <span className="font-mono text-[12px] text-muted tnum">{r.fmt(r.a)} → <b className="font-semibold text-ink">{r.fmt(r.b)}</b></span>
              </div>
              <div className="mt-1.5 grid gap-1" aria-hidden>
                <div className="h-1.5 rounded-full bg-[var(--zq-fg-subtle)]/40" style={{ width: `${Math.max(2, (r.a / max) * 100)}%` }} />
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(2, (r.b / max) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[12px] text-subtle">EVALUATED on replayed cases under a frozen contract. Production results: NOT YET MEASURED.</p>
    </div>
  );
}

/** The bounded search, as counts shrinking from generated to selected. */
export function SearchViz() {
  const steps = [
    ['Generated', 58, 'compatible compositions of the passes’ changes'],
    ['Runnable', 21, 'conflicting, impossible or not-yet-replayable plans set aside'],
    ['Calibrated', 12, 'small, seeded, outcome-blind samples'],
    ['Fully replayed', 5, 'the whole evaluation set, same cases for every plan'],
    ['VERIFIED', 2, 'every gate of the frozen contract passed'],
    ['Selected', 1, 'by a stated policy, from the Pareto frontier'],
  ] as const;
  return (
    <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-ink">One plan search</p>
        <Synthetic />
      </div>
      <ol className="flex flex-col gap-2.5">
        {steps.map(([label, n, note]) => (
          <li key={label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 max-sm:grid-cols-[1fr_auto]">
            <span className="text-[13px] font-medium text-ink">{label}</span>
            <span className="h-3 overflow-hidden rounded-sm bg-line/60 max-sm:col-span-2 max-sm:row-start-2" aria-hidden>
              <span className={cn('block h-full rounded-sm', label === 'VERIFIED' || label === 'Selected' ? 'bg-verified' : 'bg-accent')} style={{ width: `${(n / 58) * 100}%` }} />
            </span>
            <span className="font-mono text-[12.5px] text-ink tnum">{n}</span>
            <span className="col-span-3 -mt-1.5 text-[11.5px] text-subtle max-sm:col-span-2">{note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Pareto frontier among VERIFIED plans (cost per success vs p95). */
export function ParetoViz() {
  const pts = [
    { x: 0.0016, y: 2.12, f: true, l: 'Lookup + reuse' },
    { x: 0.0021, y: 1.62, f: true, l: 'Lookup + cache' },
    { x: 0.0031, y: 1.41, f: true, l: 'Context trim' },
    { x: 0.0028, y: 2.3, f: false, l: 'Dominated' },
    { x: 0.0036, y: 1.9, f: false, l: 'Dominated' },
  ];
  const W = 420;
  const H = 230;
  const sx = (v: number) => 48 + (v / 0.004) * (W - 64);
  const sy = (v: number) => H - 34 - (v / 2.6) * (H - 50);
  const frontier = pts.filter((p) => p.f).sort((a, b) => a.x - b.x);
  return (
    <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-ink">Pareto frontier of VERIFIED plans</p>
        <Synthetic />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Scatter of verified plans by cost per successful outcome and p95 latency; three plans form the frontier, two are dominated.">
        <line x1="48" y1={H - 34} x2={W - 12} y2={H - 34} stroke="var(--zq-border-strong)" />
        <line x1="48" y1="12" x2="48" y2={H - 34} stroke="var(--zq-border-strong)" />
        <text x={(W + 48) / 2} y={H - 8} textAnchor="middle" className="fill-[var(--zq-fg-muted)] text-[11px]">cost per successful outcome →</text>
        <text transform={`translate(14 ${(H - 34) / 2}) rotate(-90)`} textAnchor="middle" className="fill-[var(--zq-fg-muted)] text-[11px]">p95 latency →</text>
        <path d={frontier.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="var(--zq-accent)" strokeWidth="1.6" strokeDasharray="5 4" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={p.f ? 7 : 6} fill={p.f ? 'var(--zq-accent)' : 'var(--zq-surface)'} stroke={p.f ? 'var(--zq-accent-hover)' : 'var(--zq-fg-subtle)'} strokeWidth="1.5" />
            {p.f && <text x={sx(p.x) + 10} y={sy(p.y) - 8} className="fill-[var(--zq-fg)] text-[10.5px]">{p.l}</text>}
          </g>
        ))}
      </svg>
      <p className="mt-2 text-[12px] text-subtle">Filled points: no other VERIFIED plan is better on every dimension. Hollow: dominated. A plan with an unknown metric is shown as incomparable, never placed at zero.</p>
    </div>
  );
}

/** Cost per successful outcome explained: the numerator and denominator both have to be known. */
export function CostOutcome() {
  return (
    <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-ink">Cost per successful outcome</p>
        <Synthetic />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
        <div className="rounded-[14px] border border-line bg-canvas p-3">
          <p className="text-[11px] text-subtle">Known cost of every attempt</p>
          <p className="mt-1 font-mono text-[18px] font-semibold text-ink">$0.1111</p>
          <p className="mt-1 text-[11px] text-subtle">retries and failures included</p>
        </div>
        <span className="text-[20px] text-subtle" aria-hidden>÷</span>
        <div className="rounded-[14px] border border-line bg-canvas p-3">
          <p className="text-[11px] text-subtle">Requests that succeeded</p>
          <p className="mt-1 font-mono text-[18px] font-semibold text-ink">28</p>
          <p className="mt-1 text-[11px] text-subtle">labelled outcomes only</p>
        </div>
      </div>
      <p className="mt-4 rounded-[12px] bg-accent-subtle px-3 py-2.5 text-center font-mono text-[15px] font-semibold text-accent-text">= $0.0040 per successful outcome</p>
      <p className="mt-3 text-[12px] text-muted">If cost or outcomes are missing for part of the workload, ZEVQORA reports the coverage — or says the number is unavailable — instead of guessing.</p>
    </div>
  );
}
