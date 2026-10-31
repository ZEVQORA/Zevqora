import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { Activity, ArrowRight, Boxes, Check, CircleDollarSign, FileSearch, Fingerprint, GitBranch, Lock, Repeat, ShieldCheck, Timer, UserCheck, Users, Workflow } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { useSiteContent } from '@/lib/site';
import { useSeo, SITE_URL } from '@/lib/seo';
import { Zev } from '@/brand/Zev';
import { HeroMark3D } from '@/brand/HeroMark3D';
import { SupportZevLauncher } from './SupportZevLauncher';
import { Section, Reveal } from './Sections';
import { ProductPreview } from './graphics/ProductPreview';
import { LoopViz } from './graphics/LoopViz';
import { VerdictDemo, CostOutcome, BeforeAfter } from './graphics/EngineViz';

const ExecGraph = lazy(() => import('./graphics/ExecGraph').then((m) => ({ default: m.ExecGraph })));

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: 'ZEVQORA', url: SITE_URL, logo: `${SITE_URL}/favicon.png`, slogan: 'Make AI lighter.' },
    { '@type': 'SoftwareApplication', name: 'ZEVQORA', applicationCategory: 'DeveloperApplication', operatingSystem: 'Web, Windows', url: SITE_URL, description: 'Verified AI optimization: understand how an AI system executes, find expensive or unreliable paths, and prove which changes are worth shipping.' },
  ],
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-eyebrow uppercase text-accent-text">{children}</p>;
}

function Hero() {
  const { hero } = useSiteContent();
  const words = hero.headline.replace(/\.$/, '').split(' ');
  const lead = words.slice(0, -2).join(' ');
  const accent = words.slice(-2).join(' ');
  return (
    <section className="relative isolate overflow-hidden border-b border-[#202833] bg-[#0F1115] text-[#F7F8FA]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_78%_35%,rgba(70,139,255,0.2),transparent_48%)]" />
      <div className="container-wide relative grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.06fr_0.94fr] lg:gap-14 lg:py-24">
        <div>
          {hero.announcement && <Link to={hero.announcement_href || '/product'} className="mb-6 inline-flex min-h-10 items-center rounded-full border border-white/20 px-4 text-[13px] text-white/80">{hero.announcement}</Link>}
          <p className="inline-flex items-center gap-2 rounded-full border border-[#468BFF]/40 bg-[#468BFF]/10 px-3 py-2 font-mono text-[12px] text-[#9ac3ff]">ZEVQORA / VERIFIED AI ENGINEERING</p>
          <h1 className="font-display mt-7 max-w-[13ch] text-[clamp(2.5rem,5.8vw,5.75rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-white">{lead} <span className="text-[#7fb0ff]">{accent}.</span></h1>
          {hero.subheadline && <p className="mt-7 max-w-[53ch] text-[clamp(1rem,1.35vw,1.125rem)] leading-relaxed text-[#bdc6d4]">{hero.subheadline}</p>}
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to={hero.primary_cta.href} data-cta="hero.primary" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-6 text-[16px] font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#90bdff]">{hero.primary_cta.label} <ArrowRight size={16} className="ml-2" aria-hidden /></Link>
            <Link to={hero.secondary_cta.href} data-cta="hero.secondary" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/25 px-6 text-[16px] font-medium text-white/85 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#90bdff]">{hero.secondary_cta.label}</Link>
          </div>
          <p className="mt-7 max-w-[60ch] font-mono text-[12px] leading-relaxed text-[#8995a6]">{hero.trust_line}</p>
          <p className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-6 text-[12px] uppercase tracking-wider text-[#9fb3cc]"><span>01 / Observe</span><span aria-hidden className="text-[#468BFF]">→</span><span>02 / Replay</span><span aria-hidden className="text-[#468BFF]">→</span><span>03 / Verify</span></p>
        </div>
        <div className="relative mx-auto w-full max-w-[550px]">
          <div aria-hidden className="relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-[30px] border border-[#4b81c9]/25 bg-[radial-gradient(circle_at_45%_35%,#163762,#0c182a_62%,#0a0d14)] sm:min-h-[400px]">
            <div aria-hidden className="pointer-events-none absolute inset-[10%] rounded-full border border-[#468BFF]/10" />
            <div className="relative scale-[0.8] sm:scale-100"><HeroMark3D size={300} /></div>
            <span className="absolute bottom-5 left-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#91b9ed]">The ZEVQORA mark</span>
          </div>
          <div className="mt-4 hidden overflow-hidden rounded-[18px] border border-white/10 bg-white p-3 lg:block"><ProductPreview className="mx-auto" /></div>
        </div>
      </div>
    </section>
  );
}

const PROBLEMS = [
  { Icon: CircleDollarSign, title: 'AI cost scales unpredictably', body: 'Every new user, longer prompt and bigger model multiplies spend — and the bill arrives after the fact.' },
  { Icon: Repeat, title: 'Agents retry and loop', body: 'Repeated tool calls, no-progress steps and retries quietly double the work behind one answer.' },
  { Icon: Timer, title: 'Slow chains hurt the product', body: 'A slow retrieval or model step on the critical path sets the latency your users feel.' },
  { Icon: ShieldCheck, title: 'Cheaper models can break quality', body: 'A swap that saves money on average can fail exactly the cases that matter most.' },
  { Icon: Activity, title: 'Observability shows symptoms', body: 'Dashboards tell you where time and money went. They do not tell you which fix is safe to ship.' },
];

function Problem() {
  const { home } = useSiteContent();
  return (
    <Section id="problem" rule={false}>
      <div className="container-page">
        <Reveal>
          <Eyebrow>The problem</Eyebrow>
          <h2 className="text-h1 mt-4 max-w-[22ch] text-ink">{home.problem_title}</h2>
          <p className="text-body-lg mt-5 max-w-[60ch] text-muted">{home.problem_body}</p>
        </Reveal>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PROBLEMS.map((p, i) => (
            <li key={p.title} className="h-full">
              <Reveal delay={Math.min(i * 0.04, 0.16)} className="flex h-full flex-col rounded-[18px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] bg-accent-subtle text-accent-text"><p.Icon size={17} aria-hidden /></span>
                <h3 className="mt-4 text-[15px] font-semibold leading-snug text-ink">{p.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{p.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Loop() {
  const { home } = useSiteContent();
  return (
    <Section id="how-it-works" surface="sunken">
      <div className="container-page">
        <Reveal>
          <Eyebrow>The product loop</Eyebrow>
          <h2 className="text-h1 mt-4 max-w-[22ch] text-ink">{home.loop_title}</h2>
          <p className="text-body-lg mt-5 max-w-[60ch] text-muted">{home.loop_body}</p>
        </Reveal>
        <div className="mt-12">
          <LoopViz />
        </div>
      </div>
    </Section>
  );
}

function GraphPreview() {
  return (
    <Section id="execution-graph">
      <div className="container-page grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <Reveal>
          <Eyebrow>Execution graph</Eyebrow>
          <h2 className="text-h2 mt-4 max-w-[18ch] text-ink">See how your AI system actually runs.</h2>
          <p className="text-body mt-4 max-w-[48ch] text-muted">ZevIR turns each request into one graph — task, agent, retrieval, model calls, tool calls, runtime, outcome. Loops and retries are drawn as loops. Missing cost and missing timing are marked, not filled in.</p>
          <ul className="mt-6 space-y-2 text-[14px] text-ink">
            {['Cost, latency and token overlays', 'Critical path only from complete timing', 'Exact source span and hash on every node'].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check size={15} className="text-verified" aria-hidden /> {t}</li>
            ))}
          </ul>
        </Reveal>
        <Suspense fallback={<div className="h-[320px] rounded-[18px] border border-line bg-surface" aria-hidden />}>
          <ExecGraph />
        </Suspense>
      </div>
    </Section>
  );
}

const METRICS = [
  ['Cost per successful outcome', 'What one good answer really costs, retries and failures included.'],
  ['p95 latency', 'The slow tail users feel — p50, p95 and p99 where enough requests are timed.'],
  ['Quality', 'Deterministic graders against your labelled expectations, never a model judging a model.'],
  ['Reliability', 'Failures, retries and how much they amplify cost and latency.'],
  ['Protected cases', 'Requests that must never regress. One failure rejects a plan.'],
];

function CostLatency() {
  return (
    <Section id="metrics" surface="sunken">
      <div className="container-page">
        <Reveal>
          <Eyebrow>Cost and latency</Eyebrow>
          <h2 className="text-h2 mt-4 max-w-[24ch] text-ink">Five numbers decide whether a change is better.</h2>
        </Reveal>
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr_1fr]">
          <dl className="grid content-start gap-4">
            {METRICS.map(([k, v]) => (
              <div key={k} className="rounded-[16px] border border-line bg-surface p-4">
                <dt className="text-[14px] font-semibold text-ink">{k}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-muted">{v}</dd>
              </div>
            ))}
          </dl>
          <CostOutcome />
          <BeforeAfter />
        </div>
      </div>
    </Section>
  );
}

function Proof() {
  const { proof } = useSiteContent();
  return (
    <Section id="proof">
      <div className="container-page">
        <Reveal>
          <Eyebrow>Proof, not promises</Eyebrow>
          <h2 className="text-h1 mt-4 max-w-[22ch] text-ink">Rejecting unsafe savings is the product working.</h2>
          <p className="text-body-lg mt-5 max-w-[62ch] text-muted">In our own internal benchmark a candidate was {proof.rejected.cost_reduction} cheaper. ZEVQORA rejected it, because quality fell to {proof.rejected.quality} against a frozen floor of {proof.rejected.quality_floor}. Shipping it would have cut cost and broken the product.</p>
        </Reveal>
        <div className="mt-10">
          <VerdictDemo proof={proof} />
        </div>
        <p className="mt-6 max-w-[80ch] font-mono text-[12px] text-subtle">{proof.qualifier}</p>
      </div>
    </Section>
  );
}

const AUDIENCE_ICONS = [UserCheck, GitBranch, Workflow];

function Audiences() {
  const { home } = useSiteContent();
  return (
    <Section id="who" surface="sunken">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <Eyebrow>Who it is for</Eyebrow>
            <h2 className="text-h2 mt-4 max-w-[22ch] text-ink">One engine. A view for each person who decides.</h2>
          </Reveal>
          <Zev view="pose-waving" height={120} className="hidden md:block" alt="" />
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {home.audiences.map((a, i) => {
            const Icon = AUDIENCE_ICONS[i % AUDIENCE_ICONS.length];
            return (
              <li key={a.title} className="rounded-[20px] border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(15_17_21/0.04)]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] bg-accent-subtle text-accent-text"><Icon size={18} aria-hidden /></span>
                <h3 className="mt-4 text-[1.1rem] font-semibold text-ink">{a.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{a.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

const INTEGRATIONS = [
  { name: 'OpenTelemetry GenAI', note: 'Span ingestion (gen_ai.* semantic conventions)', status: 'Supported' },
  { name: 'OpenInference', note: 'Agent, tool, retrieval and LLM spans', status: 'Supported' },
  { name: 'Trace file import', note: 'JSONL of recorded requests, for replay', status: 'Supported' },
  { name: 'Repository scan', note: 'Finds AI call sites; runs on your machine', status: 'Supported' },
];

function Integrations() {
  const { home } = useSiteContent();
  return (
    <Section id="integrations">
      <div className="container-page grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <Reveal>
          <Eyebrow>Integration</Eyebrow>
          <h2 className="text-h2 mt-4 max-w-[20ch] text-ink">Start from the evidence you already have.</h2>
          <p className="text-body mt-4 max-w-[52ch] text-muted">{home.integration_note}</p>
        </Reveal>
        <ul className="grid gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map((it) => (
            <li key={it.name} className="flex items-start justify-between gap-3 rounded-[16px] border border-line bg-surface p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><Boxes size={15} className="text-accent-text" aria-hidden /> {it.name}</p>
                <p className="mt-1 text-[13px] text-muted">{it.note}</p>
              </div>
              <span className="shrink-0 rounded-sm bg-verified-bg px-1.5 py-0.5 font-mono text-[10.5px] text-verified">{it.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const SECURITY_ICONS = [Fingerprint, FileSearch, Users, UserCheck, ShieldCheck, Lock];

function SecurityTeaser() {
  const { security_page } = useSiteContent();
  return (
    <Section id="security" surface="ink">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <p className="text-eyebrow uppercase text-accent-text">Security</p>
            <h2 className="text-h2 mt-4 max-w-[22ch] text-ink">Built to be handed a real production workload.</h2>
          </Reveal>
          <Link to="/security" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-text">Read the security model <ArrowRight size={14} aria-hidden /></Link>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {security_page.points.slice(0, 5).map((p, i) => {
            const Icon = SECURITY_ICONS[i % SECURITY_ICONS.length];
            return (
              <li key={p.title} className="rounded-[18px] border border-line bg-surface p-5">
                <Icon size={18} className="text-accent-text" aria-hidden />
                <h3 className="mt-3 text-[14.5px] font-semibold text-ink">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{p.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

function EvaluationCta() {
  const { home, hero } = useSiteContent();
  return (
    <Section id="evaluate">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-[28px] border border-line bg-surface px-6 py-12 shadow-[0_2px_4px_rgb(15_17_21/0.04),0_30px_70px_-40px_rgb(15_17_21/0.35)] sm:px-12">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(70,139,255,0.18),transparent)]" />
          <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-h2 max-w-[22ch] text-ink">{home.cta_title}</h2>
              <p className="text-body-lg mt-4 max-w-[56ch] text-muted">{home.cta_body}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink to="/evaluation" size="lg" data-cta="cta.evaluate">{hero.primary_cta.label}</ButtonLink>
                <ButtonLink to="/technology" size="lg" variant="secondary" data-cta="cta.technology">How the engine works</ButtonLink>
              </div>
            </div>
            <Zev view="pose-sitting" height={170} className="mx-auto hidden md:block" alt="" />
          </div>
        </div>
      </div>
    </Section>
  );
}

export default function HomePage() {
  const { hero } = useSiteContent();
  useSeo({ title: 'ZEVQORA — Make AI cheaper without guessing.', description: hero.subheadline || 'Verified AI optimization: understand how an AI system executes, find expensive or unreliable paths, and prove which changes are worth shipping.', path: '/', jsonLd: JSON_LD });
  return (
    <>
      <Hero />
      <Problem />
      <Loop />
      <GraphPreview />
      <CostLatency />
      <Proof />
      <Audiences />
      <Integrations />
      <SecurityTeaser />
      <EvaluationCta />
      <SupportZevLauncher />
    </>
  );
}
