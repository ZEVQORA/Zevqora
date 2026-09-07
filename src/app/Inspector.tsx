import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { StatusChip } from '@/components/ui/StatusChip';
import { KeyValue } from '@/components/ui/Panel';
import { useAsync } from '@/lib/useAsync';
import { getExperiment, getOpportunity } from './data';
import { SkeletonRows, ErrorState } from '@/components/ui/States';
import { money, ms, ratio, dateTime, shortId, STRATEGY_LABEL, titleCase, pct } from '@/lib/format';
import type { Experiment, Opportunity, EvaluationCase } from '@/lib/types';
import { useProjects } from './AppShell';

type Target = { kind: 'opportunity'; id: string } | { kind: 'experiment'; id: string } | null;

const Ctx = createContext<{ target: Target; open: (t: NonNullable<Target>) => void; close: () => void } | null>(null);

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target>(null);
  const open = useCallback((t: NonNullable<Target>) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ target, open, close }), [target, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInspector() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useInspector outside provider');
  return ctx;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="text-eyebrow uppercase text-subtle">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="text-technical text-subtle">No {what} recorded. Nothing is implied where evidence is absent.</p>;
}

export function OpportunityEvidence({ opportunity }: { opportunity: Opportunity }) {
  const { projects } = useProjects();
  const project = projects.find((p) => p.id === opportunity.project_id);
  const ev = opportunity.evidence || {};
  const evidenceItems = Object.entries(ev).filter(([k]) => k !== 'note' && k !== 'assumption').map(([k, v]) => ({ k: titleCase(k), v: typeof v === 'number' ? (k.includes('usd') ? money(v) : k.includes('share') || k.includes('ratio') ? ratio(v, 3) : String(v)) : Array.isArray(v) ? v.join(', ') || '—' : String(v) }));
  return (
    <div className="flex flex-col gap-5">
      <Section title="Source">
        <KeyValue items={[{ k: 'Origin', v: titleCase(opportunity.origin) }, { k: 'Trace / ref', v: opportunity.source_ref || '—' }, { k: 'Project', v: project?.name || shortId(opportunity.project_id) }, { k: 'Analysis run', v: opportunity.analysis_run_id ? shortId(opportunity.analysis_run_id) : '—' }]} />
      </Section>
      <Section title="Runtime">
        <KeyValue items={[{ k: 'Provider', v: opportunity.current_provider || '—' }, { k: 'Model', v: opportunity.current_model || '—' }, { k: 'Cost driver', v: opportunity.cost_driver || '—' }, { k: 'Prompt class', v: titleCase(opportunity.category) }]} />
      </Section>
      <Section title="Candidate">
        <KeyValue items={[{ k: 'Strategy', v: STRATEGY_LABEL[opportunity.candidate_strategy] || opportunity.candidate_strategy }, ...Object.entries(opportunity.candidate_config || {}).map(([k, v]) => ({ k: titleCase(k), v: String(v) }))]} />
      </Section>
      <Section title="Baseline evidence">{evidenceItems.length ? <KeyValue items={evidenceItems} /> : <Missing what="baseline evidence" />}</Section>
      {Boolean(ev.note || ev.assumption) && (
        <Section title="Notes">
          <p className="text-caption text-muted">{String(ev.note || ev.assumption)}</p>
        </Section>
      )}
      <Section title="Pricing evidence">
        <KeyValue items={[{ k: 'Baseline cost', v: money(opportunity.baseline_cost_usd) }, { k: 'Estimated savings', v: `${money(opportunity.estimated_savings_usd)} · ${pct(opportunity.estimated_savings_pct)}` }, { k: 'Basis', v: 'Public list prices (pricing snapshot) unless provider-reported cost was received' }]} />
      </Section>
      <Section title="Provenance">
        <KeyValue items={[{ k: 'Fingerprint', v: opportunity.fingerprint }, { k: 'Confidence', v: ratio(opportunity.confidence, 2) }, { k: 'Risk', v: titleCase(opportunity.risk) }, { k: 'Evidence', v: titleCase(opportunity.evidence_completeness) }, { k: 'First seen', v: dateTime(opportunity.created_at) }, { k: 'Updated', v: dateTime(opportunity.updated_at) }]} />
      </Section>
    </div>
  );
}

export function ExperimentEvidence({ experiment, cases }: { experiment: Experiment; cases: EvaluationCase[] }) {
  const ev = experiment.evidence || {};
  return (
    <div className="flex flex-col gap-5">
      <Section title="Evaluation">
        <KeyValue items={[{ k: 'Status', v: <StatusChip status={experiment.status} /> }, { k: 'Strategy', v: STRATEGY_LABEL[experiment.strategy] || experiment.strategy }, { k: 'Samples', v: String(experiment.sample_size) }, { k: 'Quality', v: `${ratio(experiment.quality_score, 4)} vs floor ${ratio(experiment.quality_gate, 2)}` }, { k: 'Graders', v: (ev.graders || []).join(', ') || '—' }, { k: 'Provider', v: String(ev.provider || '—') }]} />
      </Section>
      <Section title="Baseline evidence">
        <KeyValue items={[{ k: 'Model', v: String(experiment.baseline.model || '—') }, { k: 'Cost (sample)', v: money(experiment.baseline.cost_usd as number | null, { digits: 6 }) }, { k: 'Latency p50', v: ms(experiment.baseline.latency_p50_ms as number | null) }]} />
      </Section>
      <Section title="Candidate evidence">
        <KeyValue items={[{ k: 'Model', v: String(experiment.candidate.model || '—') }, { k: 'Cost (sample)', v: money(experiment.candidate.cost_usd as number | null, { digits: 6 }) }, { k: 'Latency p50', v: ms(experiment.candidate.latency_p50_ms as number | null) }, { k: 'Provider cost', v: money(experiment.provider_cost_usd, { digits: 6 }) }]} />
      </Section>
      <Section title="Quality gates">
        {experiment.gates?.length ? (
          <ul className="flex flex-col gap-2">
            {experiment.gates.map((g) => (
              <li key={g.name} className="flex items-start justify-between gap-3">
                <span className="font-mono text-technical text-ink">{g.name}</span>
                <span className={g.passed ? 'text-technical text-verified' : 'text-technical text-rejected'}>{g.passed ? 'PASS' : 'FAIL'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Missing what="gate results" />
        )}
      </Section>
      <Section title="Evaluation cases">
        {cases.length ? (
          <p className="text-technical text-muted">{cases.length} cases · {cases.filter((c) => c.passed).length} passed · hashes recorded for every case</p>
        ) : (
          <Missing what="evaluation cases" />
        )}
      </Section>
      <Section title="Provenance">
        <KeyValue items={[{ k: 'Evidence hash', v: experiment.evidence_hash || '—' }, { k: 'Gate version', v: String(ev.gate_version || '—') }, { k: 'Grader version', v: String(ev.grader_version || '—') }, { k: 'Started', v: dateTime(experiment.started_at) }, { k: 'Completed', v: dateTime(experiment.completed_at) }]} />
      </Section>
      {ev.limitations?.length ? (
        <Section title="Limitations">
          <ul className="list-disc space-y-1 pl-4">
            {ev.limitations.map((l) => (
              <li key={l} className="text-technical text-muted">
                {l}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function InspectorBody({ target }: { target: NonNullable<Target> }) {
  const q = useAsync(async () => (target.kind === 'opportunity' ? { opportunity: await getOpportunity(target.id) } : await getExperiment(target.id)), [target.kind, target.id]);
  if (q.loading) return <SkeletonRows rows={6} />;
  if (q.error) return <ErrorState message={q.error} onRetry={() => q.reload()} compact />;
  if (target.kind === 'opportunity') {
    const opp = (q.data as { opportunity: Opportunity | null }).opportunity;
    if (!opp) return <ErrorState message="Opportunity not found." compact />;
    return (
      <>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-h4 text-ink">{opp.title}</h2>
            <p className="text-technical mt-1 font-mono text-subtle">{shortId(opp.id)}</p>
          </div>
          <StatusChip status={opp.status} />
        </div>
        <OpportunityEvidence opportunity={opp} />
        <Link to={`/app/opportunities/${opp.id}`} className="text-caption mt-6 inline-flex items-center gap-1.5 text-accent-text underline-offset-4 hover:underline">
          Open opportunity <ExternalLink size={13} />
        </Link>
      </>
    );
  }
  const { experiment, cases } = q.data as { experiment: Experiment | null; cases: EvaluationCase[] };
  if (!experiment) return <ErrorState message="Experiment not found." compact />;
  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h4 text-ink">Experiment {shortId(experiment.id)}</h2>
          <p className="text-technical mt-1 font-mono text-subtle">{dateTime(experiment.created_at)}</p>
        </div>
        <StatusChip status={experiment.status} />
      </div>
      <ExperimentEvidence experiment={experiment} cases={cases} />
      <Link to={`/app/experiments/${experiment.id}`} className="text-caption mt-6 inline-flex items-center gap-1.5 text-accent-text underline-offset-4 hover:underline">
        Open experiment <ExternalLink size={13} />
      </Link>
    </>
  );
}

export function InspectorPanel() {
  const { target, close } = useInspector();
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, close]);
  return createPortal(
    <AnimatePresence>
      {target && (
        <motion.aside role="complementary" aria-label="Evidence inspector" className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[440px] flex-col" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
          <div className="glass-pop m-3 flex min-h-0 flex-1 flex-col rounded-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="text-eyebrow uppercase text-subtle">Evidence inspector</p>
              <button type="button" onClick={close} aria-label="Close inspector" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-control hover:bg-ink/5 hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <InspectorBody target={target} />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}
