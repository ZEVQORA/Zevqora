import { lazy, Suspense } from 'react';
import { Check, LayoutDashboard, ListChecks, Network, Scale, Stethoscope, Workflow, X } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { useSiteContent } from '@/lib/site';
import { useSeo } from '@/lib/seo';
import { Zev } from '@/brand/Zev';
import { Section, Reveal } from './Sections';
import { PageHero } from './PageHero';
import { ProductPreview } from './graphics/ProductPreview';
import { ParetoViz, SearchViz } from './graphics/EngineViz';

const ExecGraph = lazy(() => import('./graphics/ExecGraph').then((m) => ({ default: m.ExecGraph })));
const FEATURE_ICONS = [LayoutDashboard, Network, Stethoscope, Workflow, ListChecks, Scale];

const VIEWS = [
  { who: 'CEO view', points: ['AI spend and cost per successful outcome', 'Evaluated, projected and realized value — never merged', 'What to approve next'] },
  { who: 'CTO view', points: ['p50 / p95 / p99, reliability and retries', 'Model and provider concentration', 'Why a plan was chosen over its alternatives'] },
  { who: 'Developer view', points: ['Diagnosis → graph node → source span → plan → replay → verdict', 'Plan hashes, gates and replay cases', 'Rollback notes for every change'] },
];

const NOT = ['Deploy, merge or roll back on its own', 'Call a cheaper change “savings” before it is verified', 'Turn projected impact into realized value', 'Replay a change it cannot execute honestly', 'Use a model to judge another model’s quality'];

export default function ProductPage() {
  const { product, hero } = useSiteContent();
  useSeo({ title: 'Product — ZEVQORA', description: product.intro || 'Command Center, execution graph, diagnoses, plan search, verified verdicts and Pareto decisions.', path: '/product' });
  return (
    <>
      <PageHero eyebrow="Product" title={product.title} intro={product.intro} actions={<><ButtonLink to="/evaluation" size="lg" data-cta="product.evaluate">{hero.primary_cta.label}</ButtonLink><ButtonLink to="/technology" size="lg" variant="secondary">How it works</ButtonLink></>} art={<ProductPreview />} />
      <Section rule={false}>
        <div className="container-page">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {product.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              return (
                <li key={f.title} className="h-full">
                  <Reveal delay={Math.min(i * 0.04, 0.2)} className="h-full rounded-[20px] border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] bg-accent-subtle text-accent-text"><Icon size={18} aria-hidden /></span>
                    <h2 className="mt-4 text-[1.1rem] font-semibold text-ink">{f.title}</h2>
                    <p className="mt-2 text-[14px] leading-relaxed text-muted">{f.body}</p>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page">
          <Reveal>
            <p className="text-eyebrow uppercase text-accent-text">Execution graph</p>
            <h2 className="text-h2 mt-4 max-w-[24ch] text-ink">The same graph your engineers debug with.</h2>
          </Reveal>
          <div className="mt-8">
            <Suspense fallback={<div className="h-[320px] rounded-[18px] border border-line bg-surface" aria-hidden />}><ExecGraph /></Suspense>
          </div>
        </div>
      </Section>
      <Section>
        <div className="container-page grid gap-6 lg:grid-cols-2">
          <SearchViz />
          <ParetoViz />
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page">
          <Reveal>
            <p className="text-eyebrow uppercase text-accent-text">One engine, three views</p>
            <h2 className="text-h2 mt-4 max-w-[26ch] text-ink">CEO, CTO and Developer see the same evidence, told their way.</h2>
            <p className="text-body mt-4 max-w-[60ch] text-muted">Views change emphasis, never permissions. Workspace roles decide what each person can see and do.</p>
          </Reveal>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {VIEWS.map((v) => (
              <li key={v.who} className="rounded-[20px] border border-line bg-surface p-6">
                <h3 className="text-[1.05rem] font-semibold text-ink">{v.who}</h3>
                <ul className="mt-3 space-y-2">
                  {v.points.map((p) => <li key={p} className="flex items-start gap-2 text-[14px] text-muted"><Check size={14} className="mt-1 shrink-0 text-verified" aria-hidden /> {p}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </Section>
      <Section>
        <div className="container-page grid items-center gap-10 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-h2 max-w-[24ch] text-ink">What ZEVQORA will not do.</h2>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {NOT.map((n) => <li key={n} className="flex items-start gap-2 text-[14.5px] text-ink"><X size={15} className="mt-1 shrink-0 text-rejected" aria-hidden /> {n}</li>)}
            </ul>
          </div>
          <Zev view="pose-thinking" height={160} className="mx-auto hidden md:block" alt="" />
        </div>
      </Section>
    </>
  );
}
