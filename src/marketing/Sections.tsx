import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertTriangle, Check, X, Shield, Lock, EyeOff, UserCheck, FolderSearch, Gauge, Crosshair, FlaskConical, RotateCcw, ShieldCheck, Scale, GitPullRequest, Code2, LineChart } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ButtonLink, ButtonAnchor } from '@/components/ui/Button';
import { useSiteContent } from '@/lib/site';

export function Section({ id, children, className, surface, rule = true }: { id?: string; children: ReactNode; className?: string; surface?: 'ink' | 'sunken'; rule?: boolean }) {
  return (
    <section id={id} data-surface={surface === 'ink' ? 'ink' : undefined} className={cn('py-20 lg:py-28', surface === 'ink' && 'bg-canvas', surface === 'sunken' && 'border-y border-line bg-sunken', rule && !surface && 'border-t border-line', className)}>
      {children}
    </section>
  );
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.56, ease: [0.2, 0, 0, 1], delay }}>
      {children}
    </motion.div>
  );
}

export function Problem() {
  const levers = ['Switch to a cheaper model', 'Shorten the prompt', 'Add a cache', 'Ask a coding agent to rewrite the call'];
  return (
    <Section id="problem" rule={false}>
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">The problem</p>
            <h2 className="text-h1 mt-5 max-w-[20ch] text-ink">Your AI bill is easy to cut. Your product quality is easy to break.</h2>
            <p className="text-body-lg mt-6 max-w-[50ch] text-muted">Teams can already switch models, shorten prompts, add caching or ask a coding agent to change code. The hard part is knowing whether a cheaper change still works on the workload users actually depend on.</p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="rounded-xl border border-line bg-surface p-6">
              <p className="text-eyebrow uppercase text-subtle">Easy to do</p>
              <ul className="mt-4 space-y-3">
                {levers.map((l) => (
                  <li key={l} className="flex items-center justify-between gap-4 text-caption text-ink">
                    <span>{l}</span>
                    <span className="font-mono text-technical text-subtle">cost ↓</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 border-t border-line pt-4">
                <p className="text-eyebrow uppercase text-subtle">Hard to know</p>
                <p className="text-caption mt-2 text-muted">Did quality hold on the cases your users actually send, including the ones that must never regress?</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

// Every step describes what the product does today. Strategies not implemented
// in the engine are not named here.
const STEPS = [
  { n: '01', title: 'Connect evidence', Icon: FolderSearch, body: 'Point ZEVQORA at a repository or import execution traces from your runtime. Repository scans run on your machine; only AI call locations and findings are sent.' },
  { n: '02', title: 'Establish a baseline', Icon: Gauge, body: 'Cost, tokens, latency and outputs from your recorded traces, each with its source. Unknown cost stays unknown, never zero.' },
  { n: '03', title: 'Detect an opportunity', Icon: Crosshair, body: 'Supported today: substituting a cheaper model, and reusing exact or deterministic results. Other patterns are reported as signals, not as savings.' },
  { n: '04', title: 'Create a candidate', Icon: FlaskConical, body: 'A concrete, bounded change with its scope, budget and fallback written down before anything runs.' },
  { n: '05', title: 'Replay the workload', Icon: RotateCcw, body: 'The candidate answers the same representative cases the baseline answered, with the same recorded prompt.' },
  { n: '06', title: 'Apply frozen gates', Icon: ShieldCheck, body: 'Evidence completeness, minimum samples, quality floor, non-inferiority, protected cases, cost and latency. Deterministic graders, no model judging a model.' },
  { n: '07', title: 'Return a verdict', Icon: Scale, body: 'VERIFIED when every required gate passes. REJECTED when one fails. INCOMPLETE when evidence is missing, with the exact evidence still needed.' },
  { n: '08', title: 'Human decision', Icon: GitPullRequest, body: 'An evidence report and a reviewable change. A person decides whether it ships. ZEVQORA never merges or deploys.' },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <div className="container-page">
        <Reveal>
          <p className="text-eyebrow uppercase text-muted">How it works</p>
          <h2 className="text-h1 mt-5 max-w-[20ch] text-ink">One loop. Evidence in, a decision out.</h2>
          <p className="text-body-lg mt-6 max-w-[54ch] text-muted">Nothing is recommended until it has been tested on the same workload it is meant to replace.</p>
        </Reveal>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.n} className="bg-surface p-6 lg:p-7">
              <Reveal delay={Math.min(i * 0.03, 0.18)}>
                <div className="flex items-start gap-4">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text">
                    <s.Icon size={18} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-technical text-subtle tnum">{s.n}</span>
                      <h3 className="text-h4 text-ink">{s.title}</h3>
                    </div>
                    <p className="text-caption mt-2 max-w-[56ch] text-muted">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

function VerdictCard({ status, title, body, children }: { status: 'VERIFIED' | 'REJECTED' | 'INCOMPLETE'; title: string; body: string; children?: ReactNode }) {
  const tone = status === 'VERIFIED' ? 'border-verified/30' : status === 'REJECTED' ? 'border-rejected/25' : 'border-warning/30';
  const Icon = status === 'VERIFIED' ? Check : status === 'REJECTED' ? X : AlertTriangle;
  const color = status === 'VERIFIED' ? 'text-verified bg-verified-bg' : status === 'REJECTED' ? 'text-rejected bg-rejected-bg' : 'text-warning bg-warning-bg';
  return (
    <div className={cn('flex h-full flex-col rounded-xl border bg-surface p-6', tone)}>
      <span className={cn('inline-flex w-fit items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-technical', color)}>
        <Icon size={11} strokeWidth={2.5} aria-hidden /> {status}
      </span>
      <h3 className="text-h4 mt-5 text-ink">{title}</h3>
      <p className="text-caption mt-2 text-muted">{body}</p>
      {children && <div className="mt-auto pt-5">{children}</div>}
    </div>
  );
}

export function Proof() {
  const { proof } = useSiteContent();
  return (
    <Section id="proof" className="studio">
      <div className="container-page">
        <Reveal>
          <p className="text-eyebrow uppercase text-muted">Proof philosophy</p>
          <h2 className="text-h1 mt-5 max-w-[18ch] text-ink">Cheaper is not the same as better.</h2>
          <p className="text-body-lg mt-6 max-w-[54ch] text-muted">If a candidate saves money but fails the team&rsquo;s quality floor, ZEVQORA rejects it. If evidence is missing, it returns INCOMPLETE instead of manufacturing a win.</p>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          <Reveal>
            <VerdictCard status="VERIFIED" title="Every required gate passed." body="The report lists each gate with its threshold and observed value, the cases it ran on, and where every cost figure came from." />
          </Reveal>
          <Reveal delay={0.05}>
            <VerdictCard status="REJECTED" title="Cheaper, and thrown away." body="The failed gate is named. A rejected candidate is never counted as savings, however much cheaper it was.">
              <dl className="border-t border-line pt-4 font-mono text-technical tnum">
                <div className="flex justify-between gap-3"><dt className="text-subtle">cost</dt><dd className="text-verified">{proof.rejected.cost_reduction} lower</dd></div>
                <div className="mt-1.5 flex justify-between gap-3"><dt className="text-subtle">quality</dt><dd className="text-rejected">{proof.rejected.quality} &lt; floor {proof.rejected.quality_floor}</dd></div>
                <p className="mt-3 font-sans text-[12px] text-subtle">From our internal {proof.cases}-case benchmark.</p>
              </dl>
            </VerdictCard>
          </Reveal>
          <Reveal delay={0.1}>
            <VerdictCard status="INCOMPLETE" title="Missing evidence is not a result." body="Unknown cost, missing latency or too few cases stop the run. The report says exactly what evidence is still needed." />
          </Reveal>
        </div>
        <Reveal>
          <div className="mt-8 grid gap-4 rounded-xl border border-line bg-surface p-6 md:grid-cols-3">
            {[
              ['Measured', 'Improvement on the evaluated cases. The only number a verdict produces.'],
              ['Projected', 'Production impact, shown only when explicitly modelled, and labelled as a projection.'],
              ['Realized', 'The outcome after the change ships, from real post-change evidence.'],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-caption font-semibold text-ink">{k}</p>
                <p className="text-caption mt-1 text-muted">{v}</p>
              </div>
            ))}
            <p className="text-technical text-subtle md:col-span-3">These three are always reported separately. They are never added into one savings number.</p>
          </div>
        </Reveal>
        <Reveal>
          <p className="text-technical mt-6 max-w-[80ch] text-subtle">{proof.qualifier} We have no production customer results to publish yet.</p>
        </Reveal>
      </div>
    </Section>
  );
}

export function Surfaces() {
  const surfaces = [
    {
      Icon: Code2,
      name: 'ZEVQORA Dev',
      lead: 'For the repository and the developer workflow.',
      now: ['Finds AI call sites in a repository without uploading source', 'Turns a verified result into a reviewable change', 'Desktop engine: prepares a branch in a separate Git worktree'],
      next: ['GitHub app and CI checks are not available yet'],
    },
    {
      Icon: LineChart,
      name: 'ZEVQORA Optimize',
      lead: 'For a workload’s cost, quality and history.',
      now: ['Baseline from imported execution traces', 'Experiments with frozen gates and verdicts', 'Evidence reports you can export and share'],
      next: ['Continuous production monitoring is not available yet'],
    },
  ];
  return (
    <Section id="product" surface="sunken">
      <div className="container-page">
        <Reveal>
          <p className="text-eyebrow uppercase text-muted">One proof engine, two surfaces</p>
          <h2 className="text-h1 mt-5 max-w-[20ch] text-ink">Same evidence. Same verdicts.</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {surfaces.map((s, i) => (
            <Reveal key={s.name} delay={i * 0.06}>
              <div className="h-full rounded-xl border border-line bg-surface p-7">
                <s.Icon size={20} className="text-accent-text" aria-hidden />
                <h3 className="text-h3 mt-4 text-ink">{s.name}</h3>
                <p className="text-caption mt-1 text-muted">{s.lead}</p>
                <ul className="mt-5 space-y-2.5">
                  {s.now.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-caption text-ink">
                      <Check size={14} className="mt-0.5 shrink-0 text-verified" aria-hidden /> {t}
                    </li>
                  ))}
                  {s.next.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-caption text-subtle">
                      <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full border border-subtle" /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function SecurityTeaser() {
  const items = [
    { Icon: Shield, title: 'Workspace isolation', body: 'Row-level security on every table. The browser can only read; every write goes through the server with a role check.' },
    { Icon: EyeOff, title: 'Source stays on your machine', body: 'Repository scans run locally. Only AI call locations and findings are sent. Preparing a change sends the one file being changed, when you ask.' },
    { Icon: Lock, title: 'Credentials stay server-side', body: 'Replays run on the ZEVQORA platform key. It never reaches a browser, a log or a bundle.' },
    { Icon: UserCheck, title: 'A person decides', body: 'ZEVQORA prepares a reviewable change. It never merges, deploys or changes production on its own.' },
  ];
  return (
    <Section id="security">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Security and data boundary</p>
            <h2 className="text-h1 mt-5 max-w-[16ch] text-ink">You decide what evidence it sees.</h2>
            <p className="text-body-lg mt-6 max-w-[44ch] text-muted">An evaluation needs one authorized workload, not unrestricted production access. Representative or redacted cases are enough to start.</p>
            <div className="mt-8">
              <ButtonLink to="/security" variant="secondary">Read the security overview</ButtonLink>
            </div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((it, i) => (
              <Reveal key={it.title} delay={i * 0.05}>
                <div className="h-full rounded-xl border border-line bg-surface p-5">
                  <it.Icon size={18} className="text-accent-text" aria-hidden />
                  <h3 className="text-h4 mt-4 text-ink">{it.title}</h3>
                  <p className="text-caption mt-2 text-muted">{it.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

export function DesignPartnerCta() {
  const { contact } = useSiteContent();
  const subject = encodeURIComponent('Design-partner evaluation');
  const body = encodeURIComponent('Workflow we would like evaluated:\nRough monthly volume / spend:\nWhat must never regress:\nData we can share (representative / redacted):\n');
  return (
    <Section id="design-partners" surface="ink" rule={false}>
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Design-partner evaluation</p>
            <h2 className="text-h1 mt-5 max-w-[16ch] text-ink">Bring one expensive AI workflow.</h2>
            <p className="text-body-lg mt-6 max-w-[48ch] text-muted">We agree the data boundary and success criteria first, establish the baseline, test candidates on representative cases and give you the evidence report. If nothing passes, you keep the measurements.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonAnchor href={`mailto:${contact.email}?subject=${subject}&body=${body}`} size="lg">Apply for a design-partner evaluation</ButtonAnchor>
              <ButtonLink to="/signup?intent=evaluation" size="lg" variant="secondary">Run an evaluation yourself</ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="border-t border-line pt-8 lg:border-l lg:border-t-0 lg:pl-14 lg:pt-0">
              <p className="text-eyebrow uppercase text-subtle">What an evaluation covers</p>
              <ul className="mt-6 space-y-3">
                {['One authorized workload and its data boundary', 'Baseline with quality and protected-case requirements', 'Measurable success criteria, agreed up front', 'Experiments, verdicts and the evidence report', 'A recommendation, its limitations, and the next decision'].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-body text-muted">
                    <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
