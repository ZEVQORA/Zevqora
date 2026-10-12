import { lazy, Suspense } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { ClaimBadge, type Claim } from '@/components/ui/Claim';
import { useSiteContent } from '@/lib/site';
import { useSeo } from '@/lib/seo';
import { Section, Reveal } from './Sections';
import { PageHero } from './PageHero';
import { BeforeAfter, ParetoViz, SearchViz } from './graphics/EngineViz';

const ExecGraph = lazy(() => import('./graphics/ExecGraph').then((m) => ({ default: m.ExecGraph })));

const PIPELINE = [
  ['Observe', 'OTel GenAI / OpenInference spans, trace files, repository scans'],
  ['ZevIR', 'One canonical execution graph per request, hashes not content'],
  ['Diagnose', 'Deterministic findings with evidence and a falsifier'],
  ['Optimization passes', 'Proposed changes: reuse, lookup, smaller model, retry policy, context, agent and retrieval'],
  ['Multi-plan search', 'Compatible changes composed; conflicts and dominated plans pruned'],
  ['Calibration', 'Small, seeded, outcome-blind samples — never called verified'],
  ['Replay / proof', 'Full evaluation set under the frozen Evaluation Contract'],
  ['Pareto frontier', 'Only VERIFIED plans compared across nine dimensions'],
  ['Selected verified plan', 'Chosen by a stated policy, with every tradeoff written down'],
];

const CLAIMS: Array<[Claim, string]> = [
  ['OBSERVED', 'Measured from recorded evidence.'],
  ['ESTIMATED', 'A model used only to decide what to test first.'],
  ['CALIBRATED', 'Measured on a small sample; never a verdict.'],
  ['EVALUATED', 'Replayed on the evaluation set under the frozen contract.'],
  ['VERIFIED', 'Evaluated and every required gate passed.'],
  ['PROJECTED', 'An evaluated change applied to observed volume.'],
  ['REALIZED', 'Measured in production after shipping.'],
  ['SIMULATED', 'Produced by a simulation such as Bad-Day Replay.'],
];

const NODE_KINDS = ['Task', 'Agent', 'ModelCall', 'ToolCall', 'Retrieval', 'Function', 'Runtime', 'Outcome'];
const GATES = ['Evidence completeness', 'Minimum samples', 'Quality floor', 'Non-inferiority', 'Protected cases', 'Task success', 'Cost improvement', 'Latency regression limit', 'Evaluation-set coverage'];

export default function TechnologyPage() {
  const { hero } = useSiteContent();
  useSeo({ title: 'Technology — ZEVQORA', description: 'From recorded evidence to a selected verified plan: ZevIR execution graphs, deterministic diagnoses, bounded plan search, calibration, replay under a frozen contract and a Pareto frontier.', path: '/technology' });
  return (
    <>
      <PageHero eyebrow="Technology" title="From recorded evidence to a verified decision." intro="ZEVQORA is a pipeline with a rule at every step: unknown is not zero, an estimate is not a result, and a plan becomes VERIFIED only by passing gates that were frozen before it ran." actions={<ButtonLink to="/evaluation" size="lg" data-cta="technology.evaluate">{hero.primary_cta.label}</ButtonLink>} />
      <Section rule={false}>
        <div className="container-page grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <h2 className="text-h2 max-w-[18ch] text-ink">The pipeline</h2>
            <p className="text-body mt-4 max-w-[48ch] text-muted">Each stage writes what it did and why, with hashes that tie a verdict to the exact contract, baseline and evaluation set it used.</p>
          </Reveal>
          <ol className="flex flex-col">
            {PIPELINE.map(([k, v], i) => (
              <li key={k} className="relative">
                <div className="flex items-start gap-4 rounded-[16px] border border-line bg-surface px-4 py-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-subtle font-mono text-[11px] text-accent-text tnum">{i + 1}</span>
                  <div>
                    <p className="text-[14.5px] font-semibold text-ink">{k}</p>
                    <p className="text-[13px] text-muted">{v}</p>
                  </div>
                </div>
                {i < PIPELINE.length - 1 && <ArrowDown size={14} className="mx-auto my-1 text-subtle" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page">
          <Reveal>
            <p className="text-eyebrow uppercase text-accent-text">ZevIR</p>
            <h2 className="text-h2 mt-4 max-w-[26ch] text-ink">A canonical execution representation.</h2>
            <p className="text-body mt-4 max-w-[64ch] text-muted">External standards are input adapters; their field names never leak into the model. Graphs are not assumed to be acyclic — agent loops are first-class.</p>
          </Reveal>
          <div className="mt-6 flex flex-wrap gap-2">
            {NODE_KINDS.map((k) => <span key={k} className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[12px] text-ink">{k}</span>)}
          </div>
          <div className="mt-8"><Suspense fallback={<div className="h-[320px] rounded-[18px] border border-line bg-surface" aria-hidden />}><ExecGraph /></Suspense></div>
        </div>
      </Section>
      <Section>
        <div className="container-page grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-h2 max-w-[20ch] text-ink">The Evaluation Contract</h2>
            <p className="text-body mt-4 max-w-[52ch] text-muted">Frozen before any result exists, versioned, hashed and never edited. A plan cannot become VERIFIED by weakening it, and one failing protected case rejects it.</p>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {GATES.map((g) => <li key={g} className="rounded-[12px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink">{g}</li>)}
            </ul>
          </div>
          <BeforeAfter />
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page grid gap-6 lg:grid-cols-2">
          <SearchViz />
          <ParetoViz />
        </div>
      </Section>
      <Section>
        <div className="container-page">
          <h2 className="text-h2 max-w-[24ch] text-ink">Every number says what kind of claim it is.</h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CLAIMS.map(([c, d]) => (
              <li key={c} className="rounded-[16px] border border-line bg-surface p-4">
                <ClaimBadge claim={c} />
                <p className="mt-2 text-[13px] text-muted">{d}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-[70ch] text-[13.5px] text-muted">Bad-Day Replay reapplies simulated provider failures — rate limits, timeouts, slow models, cache misses — to a plan’s own replay. Its verdict is stored separately and labelled SIMULATED: it is not a production guarantee.</p>
          <ButtonLink to="/security" variant="secondary" className="mt-8">Security model <ArrowRight size={14} aria-hidden /></ButtonLink>
        </div>
      </Section>
    </>
  );
}
