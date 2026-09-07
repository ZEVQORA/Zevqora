import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Check, X, Shield, Lock, EyeOff, KeyRound, ArrowRight, Radio, Map, Stethoscope, FlaskConical, RotateCcw, ShieldCheck, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ButtonLink, ButtonAnchor } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { Zev } from '@/brand/Zev';
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

const STEPS = [
  { n: '01', title: 'Connect', Icon: Radio, lead: 'Code, runtime, GitHub, server telemetry.', body: 'A scoped, revocable token streams AI call metadata from your runtime: provider, model, tokens, latency, cost. Source code stays where it is. Samples are opt-in and sanitized.' },
  { n: '02', title: 'Map', Icon: Map, lead: 'Models, providers, calls, tokens, cost drivers, latency.', body: 'Every call lands on one spend map. You see which model does which work, how often, and what each unit of work actually costs.' },
  { n: '03', title: 'Diagnose', Icon: Stethoscope, lead: 'Expensive model use, repeated requests, cache and deterministic opportunities, prompt and retrieval waste, fallback issues.', body: 'Deterministic analysis names the waste and attaches the evidence it was derived from. No model guesses at your architecture.' },
  { n: '04', title: 'Experiment', Icon: FlaskConical, lead: 'Generate candidate optimizations.', body: 'Each opportunity carries a candidate: a cheaper model, a bounded routing policy, a response cache, a smaller context. Candidates are proposals, not changes.' },
  { n: '05', title: 'Replay', Icon: RotateCcw, lead: 'Run the representative workload again.', body: 'The candidate is executed on captured samples of your real requests, measured the same way as the baseline, on ZEVQORA&rsquo;s platform credential.' },
  { n: '06', title: 'Verify', Icon: ShieldCheck, lead: 'Compare cost, quality, latency, behaviour.', body: 'Named gates decide: minimum samples, evidence completeness, execution success, quality floor, cost improvement, latency regression. All must pass.' },
  { n: '07', title: 'Review', Icon: GitPullRequest, lead: 'A reviewable change. Human approval required.', body: 'A verified result becomes a report with its evidence attached. A person decides whether it ships. ZEVQORA never merges or deploys.' },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <div className="container-page">
        <Reveal>
          <p className="text-eyebrow uppercase text-muted">How it works</p>
          <h2 className="text-h1 mt-5 max-w-[18ch] text-ink">Find the waste. Test the fix. Verify the savings.</h2>
          <p className="text-body-lg mt-6 max-w-[52ch] text-muted">One loop, in order. Nothing is recommended until it has survived the same workload it is meant to replace.</p>
        </Reveal>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.n} className={cn('bg-surface p-6 lg:p-8', i === STEPS.length - 1 && 'lg:col-span-2')}>
              <Reveal delay={Math.min(i * 0.04, 0.2)}>
                <div className="flex items-start gap-4">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text">
                    <s.Icon size={18} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-technical text-subtle tnum">{s.n}</span>
                      <h3 className="text-h3 text-ink">{s.title}</h3>
                    </div>
                    <p className="text-caption mt-2 font-medium text-ink" dangerouslySetInnerHTML={{ __html: s.lead }} />
                    <p className="text-caption mt-2 max-w-[60ch] text-muted" dangerouslySetInnerHTML={{ __html: s.body }} />
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

export function VerifiedSavings() {
  return (
    <Section surface="sunken">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Verified Savings</p>
            <h2 className="text-h1 mt-5 max-w-[14ch] text-ink">Potential is a guess. Verified is a fact.</h2>
            <p className="text-body-lg mt-6 max-w-[46ch] text-muted">ZEVQORA keeps the two apart on every screen. Nothing moves from one column to the other without a replay and a passed gate.</p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-6">
                <StatusChip status="candidate" label="POTENTIAL SAVINGS" />
                <p className="text-h3 mt-5 text-ink">A theoretical estimate.</p>
                <p className="text-caption mt-3 text-muted">Derived from observed spend and public price lists. Useful for deciding what to test first. Never reported as a result.</p>
                <ul className="text-technical mt-5 space-y-2 font-mono text-subtle">
                  <li>estimate · from telemetry</li>
                  <li>confidence · labelled</li>
                  <li>evidence · partial or complete</li>
                </ul>
              </div>
              <div className="rounded-xl border border-verified/30 bg-verified-bg/40 p-6">
                <StatusChip status="verified" label="VERIFIED SAVINGS" />
                <p className="text-h3 mt-5 text-ink">A replayed, gated result.</p>
                <p className="text-caption mt-3 text-muted">The candidate ran on your real samples, measured against the baseline, and passed every configured quality constraint.</p>
                <ul className="text-technical mt-5 space-y-2 font-mono text-verified">
                  <li>replay · same workload</li>
                  <li>quality gate · passed</li>
                  <li>evidence hash · attached</li>
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

function ProofPanel({ kind }: { kind: 'rejected' | 'verified' }) {
  const { proof } = useSiteContent();
  const rejected = kind === 'rejected';
  const c: { cost_reduction: string; quality: string; quality_floor: string; reason?: string; ci95?: string } = rejected ? proof.rejected : proof.verified;
  const gates = rejected
    ? [
        { label: 'Cost reduction', value: c.cost_reduction, status: 'pass' },
        { label: 'Quality', value: c.quality, floor: c.quality_floor, status: 'fail' },
      ]
    : [
        { label: 'Cost reduction', value: c.cost_reduction, status: 'pass' },
        { label: 'Quality', value: c.quality, floor: c.quality_floor, status: 'pass' },
        { label: 'Protected behaviour', value: 'held', status: 'pass' },
        { label: 'Evidence completeness', value: 'complete', status: 'pass' },
      ];
  return (
    <div className={cn('rounded-xl border bg-surface p-7', rejected ? 'border-rejected/25' : 'border-verified/30')}>
      <div className="flex items-center justify-between gap-4">
        <StatusChip status={rejected ? 'rejected' : 'verified'} size="md" />
        <span className="font-mono text-technical text-subtle">{rejected ? c.reason || 'quality_floor' : 'all_gates_pass'}</span>
      </div>
      <p className="text-eyebrow mt-8 uppercase text-muted">{rejected ? 'Measured cost reduction' : 'Measured point estimate'}</p>
      <p className="mt-2 text-[3rem] font-semibold leading-none tracking-[-0.04em] text-ink tnum">{c.cost_reduction}</p>
      <p className="text-caption mt-2 text-muted">lower raw measured inference cost</p>
      <dl className="mt-8 border-t border-line">
        {gates.map((g) => (
          <div key={g.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
            <dt className="text-caption text-muted">{g.label}</dt>
            <dd className="flex items-baseline gap-3 font-mono text-technical tnum">
              {g.floor && <span className="text-subtle">floor {g.floor}</span>}
              <span className={g.status === 'fail' ? 'text-rejected' : 'text-ink'}>{g.value}</span>
              <span className={cn('inline-flex items-center gap-1 uppercase', g.status === 'fail' ? 'text-rejected' : 'text-verified')}>
                {g.status === 'fail' ? <X size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}
                {g.status}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-caption mt-5 text-muted">{rejected ? `Cheaper by ${c.cost_reduction}, and thrown away. Quality scored ${c.quality} against a frozen ${c.quality_floor} floor.` : `Smaller saving, every gate passed. 95% CI ${c.ci95 || 'crosses zero'}: a point estimate, not a conclusive result.`}</p>
    </div>
  );
}

export function Proof() {
  const { proof } = useSiteContent();
  return (
    <Section id="proof" className="studio">
      <div className="container-page">
        <Reveal>
          <p className="text-eyebrow uppercase text-muted">Proof</p>
          <h2 className="text-h1 mt-5 max-w-[14ch] text-ink">Cheaper isn&rsquo;t verified.</h2>
          <p className="text-body-lg mt-6 max-w-[52ch] text-muted">Two candidates from our own {proof.kind.toLowerCase()}. The one that saved more money is the one ZEVQORA rejected.</p>
        </Reveal>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <Reveal>
            <ProofPanel kind="rejected" />
          </Reveal>
          <Reveal delay={0.08}>
            <ProofPanel kind="verified" />
          </Reveal>
        </div>
        <Reveal>
          <div className="mt-10 grid gap-6 rounded-xl border border-warning/30 bg-warning-bg/50 p-6 lg:grid-cols-[auto_1fr] lg:gap-10">
            <p className="text-eyebrow uppercase text-warning">Read this with the numbers</p>
            <ul className="space-y-2">
              <li className="text-caption text-ink">{proof.qualifier}</li>
              <li className="text-caption text-muted">{proof.cases} cases. Internal benchmark produced before the 2026-08-28 engine hardening pass; a hardened-engine rerun is pending.</li>
              <li className="text-caption text-muted">Our first real-workload evaluation is an affiliated design-partner pilot (the founder built the partner system). It is not independent customer validation and it is labelled that way everywhere it appears.</li>
            </ul>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function ProductSurface() {
  const rows = [
    { id: 'req_8f2c41', model: 'gpt-4o-mini', work: 'classify.intent', cost: '$0.0004', latency: '310 ms', state: 'observed' },
    { id: 'req_8f2c43', model: 'gpt-4o', work: 'summarize.thread', cost: '$0.0192', latency: '2 140 ms', state: 'observed' },
    { id: 'req_8f2c44', model: 'gpt-4o', work: 'classify.intent', cost: '$0.0188', latency: '1 980 ms', state: 'diagnosed', focus: true },
    { id: 'req_8f2c45', model: 'gpt-4o', work: 'classify.intent', cost: '$0.0191', latency: '2 050 ms', state: 'diagnosed' },
    { id: 'req_8f2c46', model: 'gpt-4o-mini', work: 'classify.intent', cost: '$0.0004', latency: '290 ms', state: 'candidate' },
    { id: 'req_8f2c47', model: 'cache', work: 'classify.intent', cost: '$0.0000', latency: '3 ms', state: 'verifying' },
  ];
  return (
    <Section id="product" surface="ink" rule={false}>
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:gap-16">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">The product</p>
            <h2 className="text-h1 mt-5 max-w-[16ch] text-ink">Your AI bill is a system problem, not a model picker problem.</h2>
            <p className="text-body-lg mt-6 max-w-[44ch] text-muted">Cost leaks hide across repeated work, oversized models, retries, context and routing. ZEVQORA follows the full execution path instead of stopping at the provider invoice.</p>
            <ul className="mt-8 space-y-3">
              {['Evidence, not assumptions: every conclusion traces back to real execution.', 'Candidates are replayed on your own samples before they earn a number.', 'Verified Savings is a gated result, never a projection dressed up as one.', 'A human approves every change. ZEVQORA never merges or deploys.'].map((t) => (
                <li key={t} className="flex items-start gap-3 text-caption text-muted">
                  <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <ButtonLink to="/signup" variant="primary" size="lg">
                Start optimizing <ArrowRight size={16} aria-hidden />
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="relative">
              <div className="rounded-xl border border-line bg-surface p-1 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]" data-surface="light">
                <div className="rounded-lg bg-canvas">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="text-eyebrow uppercase text-subtle">Observed execution</span>
                    <span className="font-mono text-technical text-subtle">support.thread · last 7 days</span>
                  </div>
                  <div className="px-2 py-1.5">
                    {rows.map((r, i) => (
                      <div key={r.id} className={cn('grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-3 py-2.5 sm:grid-cols-[5.5rem_1fr_5rem_5rem_6.5rem]', r.focus && 'bg-accent-subtle/70')} style={{ animation: `zq-row-in 460ms cubic-bezier(0.2,0,0,1) ${120 + i * 90}ms both` }}>
                        <span className="hidden font-mono text-technical text-subtle tnum sm:block">{r.id}</span>
                        <span className="min-w-0">
                          <span className="text-caption block truncate text-ink">{r.work}</span>
                          <span className="block truncate font-mono text-technical text-subtle">{r.model}</span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5 sm:contents">
                          <span className="text-right font-mono text-technical text-ink tnum">{r.cost}</span>
                          <span className="text-right font-mono text-technical text-muted tnum">{r.latency}</span>
                          <span className="sm:pl-2">
                            <StatusChip status={r.state} />
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-line px-4 py-2.5 text-right font-mono text-technical text-subtle">Illustrative values. Not measured results.</div>
                </div>
              </div>
              <div className="pointer-events-none absolute -bottom-10 -left-6 hidden lg:block">
                <Zev view="pose-sitting" height={150} />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

export function SecurityTeaser() {
  const items = [
    { Icon: Shield, title: 'Workspace isolation', body: 'Row-level security on every table. Server-side role checks on every write.' },
    { Icon: KeyRound, title: 'Scoped, revocable tokens', body: 'Telemetry tokens are hashed at rest, shown once, scoped to one project, rotatable.' },
    { Icon: EyeOff, title: 'No source code, no secrets', body: 'The platform reads call metadata. Samples are opt-in and sanitized before storage.' },
    { Icon: Lock, title: 'Platform credential stays server-side', body: 'Replays run on ZEVQORA&rsquo;s provider key. It never reaches a browser, log or bundle.' },
  ];
  return (
    <Section>
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Security</p>
            <h2 className="text-h1 mt-5 max-w-[14ch] text-ink">Built to be trusted with a real workload.</h2>
            <p className="text-body-lg mt-6 max-w-[44ch] text-muted">Every connection tells you what it reads, what it never touches, when it was last used, and how to revoke it.</p>
            <div className="mt-8">
              <ButtonLink to="/security" variant="secondary">
                Read the security overview
              </ButtonLink>
            </div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((it, i) => (
              <Reveal key={it.title} delay={i * 0.05}>
                <div className="h-full rounded-xl border border-line bg-surface p-5">
                  <it.Icon size={18} className="text-accent-text" aria-hidden />
                  <h3 className="text-h4 mt-4 text-ink">{it.title}</h3>
                  <p className="text-caption mt-2 text-muted" dangerouslySetInnerHTML={{ __html: it.body }} />
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
  return (
    <Section surface="ink" rule={false}>
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Design partners</p>
            <h2 className="text-h1 mt-5 max-w-[15ch] text-ink">Bring one expensive AI workflow.</h2>
            <p className="text-body-lg mt-6 max-w-[46ch] text-muted">We measure the baseline, test alternatives, replay the workload, and keep the change only if verification passes. If nothing passes, you keep the measurements and we keep the lesson.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/signup" size="lg">
                Become a design partner
              </ButtonLink>
              <ButtonAnchor href={`mailto:${contact.email}`} size="lg" variant="secondary">
                Talk to the founders
              </ButtonAnchor>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="border-t border-line pt-8 lg:border-l lg:border-t-0 lg:pl-14 lg:pt-0">
              <p className="text-eyebrow uppercase text-subtle">Where we are</p>
              <ul className="mt-6 space-y-4">
                <li className="text-body text-muted">A working platform and desktop engine, in private beta.</li>
                <li className="text-body text-muted">Internal proof on our own dogfooding benchmark, published with its qualifiers.</li>
                <li className="text-body text-muted">An affiliated real-workload evaluation prepared and preregistered. Independent validation is the next step, and it has not happened yet.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

export function FinalCta() {
  const { hero } = useSiteContent();
  return (
    <Section className="studio">
      <div className="container-page">
        <div className="grid items-end gap-12 lg:grid-cols-[1.3fr_auto]">
          <Reveal>
            <h2 className="text-display max-w-[12ch] text-ink">Make AI lighter.</h2>
            <p className="text-body-lg mt-7 max-w-[40ch] text-muted">Connect the evidence. Find the waste. Test the fix. Verify the savings.</p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <ButtonLink to={hero.primary_cta.href} size="lg">
                {hero.primary_cta.label}
              </ButtonLink>
              <Link to="/pricing" className="text-button text-muted underline-offset-4 transition-control hover:text-ink hover:underline">
                See pricing
              </Link>
            </div>
          </Reveal>
          <div className="hidden justify-end lg:flex">
            <Zev view="pose-waving" height={190} />
          </div>
        </div>
      </div>
    </Section>
  );
}
