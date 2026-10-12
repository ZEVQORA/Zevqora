import { useRef, useState, type KeyboardEvent } from 'react';
import { Eye, GitBranch, ListChecks, RotateCcw, ShieldCheck, Target } from 'lucide-react';
import { cn } from '@/lib/cn';

const STEPS = [
  { key: 'observe', label: 'Observe', Icon: Eye, title: 'Recorded evidence becomes an execution graph', body: 'OpenTelemetry GenAI or OpenInference spans, trace files and repository scans become one ZevIR graph per request: tasks, agents, model calls, tool calls, retrieval, runtime and outcome — with cost, tokens and timing where they were recorded.', facts: ['Hashes and sizes, not content', 'Unknown cost stays unknown', 'Every node keeps its source span'] },
  { key: 'diagnose', label: 'Diagnose', Icon: Target, title: 'Deterministic diagnoses, each with evidence', body: 'Redundant calls, retry amplification, context bloat, over-provisioned models, agent loops, duplicate retrieval and latency on the critical path — each with affected nodes, evidence references and what would prove it wrong.', facts: ['No LLM decides a diagnosis', 'Every diagnosis has a falsifier', 'A diagnosis is not a saving'] },
  { key: 'plans', label: 'Generate plans', Icon: GitBranch, title: 'Compatible changes, composed into execution plans', body: 'Optimization passes propose changes; compatible ones are combined into bounded plans. Conflicts, impossible plans and dominated plans are pruned before anything runs. Changes ZEVQORA cannot replay yet are marked, never executed.', facts: ['Bounded search, seeded', 'Conflicts are explicit', 'Not replayable ≠ silently skipped'] },
  { key: 'replay', label: 'Replay', Icon: RotateCcw, title: 'Calibrate cheaply, then replay in full', body: 'Promising plans run on a small, outcome-blind sample first; the best are replayed on the full evaluation set — the same recorded requests the baseline answered.', facts: ['Calibration is never “verified”', 'Same evaluation set for every plan', 'Spend and wall-clock budgets'] },
  { key: 'verify', label: 'Verify', Icon: ShieldCheck, title: 'Gates frozen before results exist', body: 'Quality floor, non-inferiority, protected cases, task success, cost and latency limits — frozen in an Evaluation Contract before replay. VERIFIED only if every required gate passes.', facts: ['Cheaper but worse → REJECTED', 'Missing evidence → INCOMPLETE', 'Gates cannot be loosened after the fact'] },
  { key: 'select', label: 'Select', Icon: ListChecks, title: 'A stated policy picks from the verified frontier', body: 'Only VERIFIED plans compete. ZEVQORA computes the Pareto frontier across cost, latency, success, quality, reliability and risk; a policy you choose selects one and explains the tradeoffs.', facts: ['Selection only from the frontier', 'Every tradeoff is written down', 'A person decides what ships'] },
];

/** Interactive product loop (accessible tabs: arrow keys, Home/End). */
export function LoopViz() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % STEPS.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + STEPS.length) % STEPS.length : e.key === 'Home' ? 0 : e.key === 'End' ? STEPS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };
  const s = STEPS[active];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr] lg:gap-10">
      <div role="tablist" aria-label="Product loop" aria-orientation="vertical" className="relative flex gap-2 overflow-x-auto pb-1 no-scrollbar lg:flex-col lg:overflow-visible">
        <span aria-hidden className="absolute bottom-3 left-[23px] top-3 hidden w-px bg-line lg:block" />
        {STEPS.map((step, i) => (
          <button
            key={step.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`loop-tab-${step.key}`}
            aria-selected={i === active}
            aria-controls="loop-panel"
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn('relative flex shrink-0 items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-control', i === active ? 'bg-surface shadow-[0_1px_2px_rgb(15_17_21/0.06),0_10px_24px_-18px_rgb(15_17_21/0.3)] ring-1 ring-line' : 'hover:bg-surface/70')}
          >
            <span className={cn('relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tnum', i === active ? 'border-accent bg-accent text-white' : i < active ? 'border-accent/40 bg-accent-subtle text-accent-text' : 'border-line bg-surface text-subtle')}>{i + 1}</span>
            <span className="flex items-center gap-2 whitespace-nowrap text-[14px] font-medium text-ink">
              <step.Icon size={15} aria-hidden className={i === active ? 'text-accent-text' : 'text-subtle'} /> {step.label}
            </span>
          </button>
        ))}
      </div>
      <div id="loop-panel" role="tabpanel" aria-labelledby={`loop-tab-${s.key}`} className="rounded-[22px] border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(15_17_21/0.04)] lg:p-8">
        <p className="text-eyebrow uppercase text-accent-text">Step {active + 1} · {s.label}</p>
        <h3 className="mt-3 text-[1.45rem] font-bold leading-tight tracking-[-0.025em] text-ink">{s.title}</h3>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">{s.body}</p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-3">
          {s.facts.map((f) => (
            <li key={f} className="rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-[12.5px] text-ink">{f}</li>
          ))}
        </ul>
        <div className="mt-6 flex items-center gap-1.5" aria-hidden>
          {STEPS.map((step, i) => <span key={step.key} className={cn('h-1 rounded-full transition-all duration-300', i === active ? 'w-8 bg-accent' : 'w-3 bg-line-strong')} />)}
        </div>
      </div>
    </div>
  );
}
