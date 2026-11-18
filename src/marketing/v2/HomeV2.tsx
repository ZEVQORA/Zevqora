import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Eye, FlaskConical, GitBranch, KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
import { DimensionalZ } from '@/brand/DimensionalZ';
import { Zev } from '@/brand/Zev';
import { useSiteContent } from '@/lib/site';
import { AskZev } from '../askzev/AskZev';
import { Count, EASE, Magnetic, Reveal, spot, Words } from './motion';
import { PremiumCta } from './PremiumCta';
export { PremiumCta };

/* ─────────────────────────── 1. Hero ─────────────────────────── */

/**
 * The live site's introduction, calmer: a quiet ink field with a soft blue
 * glow behind the dimensional Z, the same words, two calls to action
 * (Explore, Meet Zev) and glass evidence chips. No looping film.
 */
export function HeroV2() {
  const reduced = useReducedMotion();
  const px = useSpring(useMotionValue(0), { stiffness: 50, damping: 18 });
  const py = useSpring(useMotionValue(0), { stiffness: 50, damping: 18 });
  const cx = useTransform(px, (v) => v * -22);
  const cy = useTransform(py, (v) => v * -14);
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <section className="zv-hero zev-hero is-ink" aria-labelledby="zv-hero-title" onPointerMove={onMove}>
      <div className="zv-hero-calm" aria-hidden>
        <span className="zv-hero-glow is-a" />
        <span className="zv-hero-glow is-b" />
      </div>
      <span className="zv-hero-grid-lines" aria-hidden />

      <div className="zv-wrap zv-hero-inner">
        <div className="zv-hero-copy">
          <motion.p className="zv-chip is-ink" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }}>
            <span className="zv-chip-dot" aria-hidden />
            Evidence-first AI optimization
          </motion.p>
          <h1 id="zv-hero-title" className="zv-display is-ink">
            <Words text="Make AI" delay={0.1} />
            <br />
            <span className="zv-lighter">
              <Words text="lighter." delay={0.26} />
            </span>
          </h1>
          <motion.p className="zv-lead is-ink" initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.45 }}>
            Find expensive AI work. Test a lighter alternative. Keep quality in control.
          </motion.p>
          <motion.div className="zv-hero-ctas" initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.58 }}>
            <Magnetic>
              <a href="#workbench" className="zv-btn is-white is-lg" data-cta="hero-explore">
                Explore ZEVQORA
                <ArrowUpRight size={18} className="zv-arrow" aria-hidden />
              </a>
            </Magnetic>
            <a href="#ask-zev" className="zv-btn is-glass is-lg" data-cta="hero-ask-zev">
              <span className="zv-btn-orb" aria-hidden>
                <ArrowDown size={15} />
              </span>
              Meet Zev
            </a>
          </motion.div>
        </div>

        <div className="zv-hero-art" aria-hidden>
          <motion.div className="zv-hero-mark" initial={reduced ? false : { opacity: 0, scale: 0.9, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 1.3, ease: EASE, delay: 0.2 }}>
            <DimensionalZ size={400} />
          </motion.div>
          <motion.div className="zv-glass-chip is-1" style={{ x: cx, y: cy }} initial={reduced ? false : { opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 1 }}>
            <span className="zv-mini-label">Quality floor</span>
            <b>0.95</b>
            <span className="zv-mini-note">set before any replay</span>
          </motion.div>
          <motion.div className="zv-glass-chip is-2" style={{ x: cx, y: cy }} initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 1.15 }}>
            <span className="zv-verdict is-rejected"><X size={11} /> REJECTED</span>
            <span className="zv-mini-note">42% cheaper · quality 0.87</span>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 2. Ask Zev ─────────────────────────── */

/** The only place Ask Zev is mounted on the page (it docks to the corner after this scene). */
export function AskZevV2() {
  return (
    <section className="zv-ask" id="ask-zev" aria-labelledby="zev-stage-title">
      <div className="zv-wrap zv-ask-inner">
        <Reveal className="zv-ask-avatar">
          <div className="zv-float">
            <Zev view="pose-waving" height={150} alt="" />
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <p className="zv-kicker">Talk to Zev</p>
          <h2 id="zev-stage-title" className="zv-h2">Hello, any questions?</h2>
          <p className="zv-sub">Ask Zev about ZEVQORA — no account needed.</p>
        </Reveal>
        <Reveal delay={0.12} className="zv-ask-slot">
          <AskZev />
        </Reveal>
        <a href="#workbench" className="zv-next">
          <span>See how ZEVQORA works</span>
          <ArrowDown size={16} aria-hidden />
        </a>
      </div>
    </section>
  );
}

/* ─────────────────────────── 3. The loop ─────────────────────────── */

const STEPS: Array<{ n: string; title: string; body: string; Icon: typeof Eye }> = [
  { n: '01', title: 'Observe', body: 'See the model calls, tool steps, retries and context behind one AI workflow — the real baseline.', Icon: Eye },
  { n: '02', title: 'Challenge', body: 'Propose a lighter path: a smaller model, a shorter context, a cache — each one a candidate, never a promise.', Icon: FlaskConical },
  { n: '03', title: 'Verify', body: 'Replay the candidate on recorded cases against the quality floor you set in advance. Gates decide, not opinions.', Icon: ShieldCheck },
  { n: '04', title: 'Review', body: 'Read the evidence and decide. VERIFIED does not mean deployed — shipping stays a human decision.', Icon: UserCheck },
];

/** How long each step stays on screen before the loop advances on its own. */
const STEP_MS = 6500;

/** A width that grows from zero the first time it is on screen. */
const grow = (width: string, delay = 0, duration = 0.9) => ({
  initial: { width: 0 },
  whileInView: { width },
  viewport: { once: true },
  transition: { duration, ease: EASE, delay },
});

function StepVisual({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="zv-vis">
        <p className="zv-vis-title">Support agent · one request</p>
        {[
          ['Retrieval', 18, ''],
          ['Large model call', 72, 'is-hot'],
          ['Order lookup tool', 24, ''],
          ['Retry', 46, 'is-warm'],
        ].map(([label, w, tone], k) => (
          <div className="zv-vis-row" key={label as string}>
            <span>{label}</span>
            <span className="zv-vis-track"><motion.i className={tone as string} {...grow(`${w}%`, 0.1 + k * 0.08)} /></span>
          </div>
        ))}
        <p className="zv-vis-foot">Illustrative. The highlighted call is where this example spends most.</p>
      </div>
    );
  if (i === 1)
    return (
      <div className="zv-vis">
        <p className="zv-vis-title">Candidates</p>
        {['A · smaller model on simple tickets', 'B · trim retrieved context', 'C · cache policy answers', 'D · cheapest model everywhere'].map((t, k) => (
          <motion.div className="zv-vis-cand" key={t} initial={{ opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: EASE, delay: k * 0.08 }}>
            <GitBranch size={14} aria-hidden /> {t}
          </motion.div>
        ))}
        <p className="zv-vis-foot">Illustrative. Each candidate still has to earn a verdict.</p>
      </div>
    );
  if (i === 2)
    return (
      <div className="zv-vis">
        <p className="zv-vis-title">Quality vs. the floor</p>
        <div className="zv-gauge">
          <motion.span className="zv-gauge-fill" {...grow('87%', 0, 1.1)} />
          <span className="zv-gauge-floor" style={{ left: '95%' }}><em>floor 0.95</em></span>
        </div>
        <div className="zv-gauge-legend">
          <span>Candidate D · 0.87</span>
          <span className="zv-verdict is-rejected"><X size={12} /> REJECTED</span>
        </div>
        <div className="zv-gauge is-pass">
          <motion.span className="zv-gauge-fill" {...grow('97%', 0.15, 1.1)} />
          <span className="zv-gauge-floor" style={{ left: '95%' }} />
        </div>
        <div className="zv-gauge-legend">
          <span>Candidate A · 0.97</span>
          <span className="zv-verdict is-verified"><Check size={12} /> VERIFIED</span>
        </div>
        <p className="zv-vis-foot">Internal 50-case benchmark. Not customer evidence.</p>
      </div>
    );
  return (
    <div className="zv-vis">
      <p className="zv-vis-title">Your decision</p>
      <div className="zv-review">
        <p><b>Candidate A</b> passed every gate on recorded cases.</p>
        <p className="zv-vis-foot">Review the patch and the evidence before anything ships.</p>
        <div className="zv-review-actions">
          <span className="zv-btn is-primary is-sm" role="presentation">Approve for review</span>
          <span className="zv-btn is-ghost is-sm" role="presentation">Not now</span>
        </div>
      </div>
    </div>
  );
}

/** True while the viewport matches the media query (false where matchMedia is unavailable). */
function useMedia(query: string) {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [match, setMatch] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

function LoopIntro() {
  return (
    <>
      <p className="zv-kicker">The work · measure, replay, verify, review</p>
      <h2 id="zv-loop-title" className="zv-h2">
        Cheaper AI means nothing if <span className="zv-accent">the answer gets worse.</span>
      </h2>
      <p className="zv-sub">ZEVQORA measures one workload, tests a lighter alternative against quality you set in advance, and shows whether it deserves to ship.</p>
    </>
  );
}

function CardHead({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <div className="zv-loop-card-head">
      <step.Icon size={16} aria-hidden />
      <span>{step.n} · {step.title}</span>
      <span className="zv-sample">Sample data</span>
    </div>
  );
}

/**
 * Wide screens: the four steps are tabs. The loop advances on its own while it
 * is on screen, and stops for good once the visitor picks a step. No scroll
 * hijacking: the section is as tall as its content.
 */
function LoopTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.45 });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState(false);
  const auto = inView && !picked && !reduced;
  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % STEPS.length), STEP_MS);
    return () => window.clearTimeout(t);
  }, [auto, active]);

  const choose = (i: number, focus = false) => {
    setPicked(true);
    setActive(i);
    if (focus) document.getElementById(`zv-step-tab-${i}`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (e.key === 'Home') choose(0, true);
    else if (e.key === 'End') choose(STEPS.length - 1, true);
    else if (e.key in keys) choose((active + keys[e.key] + STEPS.length) % STEPS.length, true);
    else return;
    e.preventDefault();
  };
  const step = STEPS[active];

  return (
    <div className="zv-loop-grid" ref={ref}>
      <div>
        <LoopIntro />
        <div className="zv-steps" role="tablist" aria-orientation="vertical" aria-label="The loop">
          {STEPS.map((s, i) => {
            const on = i === active;
            return (
              <div key={s.n} className={`zv-step${on ? ' is-active' : i < active ? ' is-done' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  id={`zv-step-tab-${i}`}
                  aria-selected={on}
                  aria-controls="zv-step-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => choose(i)}
                  onKeyDown={onKey}
                >
                  <span className="zv-step-n">{s.n}</span>
                  <span className="zv-step-t">{s.title}</span>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.p key="body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.45, ease: EASE }}>
                      {s.body}
                    </motion.p>
                  )}
                </AnimatePresence>
                {on && (
                  <span className="zv-step-timer" aria-hidden>
                    <i key={`${active}-${auto}`} className={auto ? 'is-running' : ''} style={{ animationDuration: `${STEP_MS}ms` }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="zv-loop-card" id="zv-step-panel" role="tabpanel" aria-labelledby={`zv-step-tab-${active}`} aria-live="polite">
        <CardHead step={step} />
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 18, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }} transition={{ duration: 0.4, ease: EASE }}>
            <StepVisual i={active} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Phones and tablets: every step is its own card, read top to bottom. */
function LoopStack() {
  return (
    <>
      <Reveal>
        <LoopIntro />
      </Reveal>
      <ol className="zv-loop-stack">
        {STEPS.map((s, i) => (
          <li key={s.n}>
            <Reveal>
              <article className="zv-loop-card is-stacked" aria-label={`${s.n} ${s.title}`}>
                <CardHead step={s} />
                <p className="zv-loop-stack-body">{s.body}</p>
                <StepVisual i={i} />
              </article>
            </Reveal>
          </li>
        ))}
      </ol>
    </>
  );
}

export function LoopV2() {
  const narrow = useMedia('(max-width: 1000px)');
  return (
    <section className="zv-loop" id="workbench" aria-labelledby="zv-loop-title">
      <div className="zv-wrap">{narrow ? <LoopStack /> : <LoopTabs />}</div>
    </section>
  );
}

/* ─────────────────────────── 4. Evidence ─────────────────────────── */

export function EvidenceV2() {
  const { proof } = useSiteContent();
  const cost = parseFloat(proof.rejected.cost_reduction);
  const quality = parseFloat(proof.rejected.quality);
  const floor = parseFloat(proof.rejected.quality_floor);
  return (
    <section className="zv-evidence" id="proof" aria-labelledby="zv-evidence-title">
      <div className="zv-wrap zv-evidence-grid">
        <Reveal>
          <p className="zv-kicker">A better standard · quality gets the final say</p>
          <h2 id="zv-evidence-title" className="zv-h2 is-xl">
            The biggest saving? <span className="zv-accent">We rejected it.</span>
          </h2>
          <p className="zv-sub">A lighter bill only matters if your product still works. Here is the decision behind the number.</p>
          <Link to="/proof" className="zv-link">Read the full evidence <ArrowUpRight size={15} aria-hidden /></Link>
        </Reveal>
        <Reveal delay={0.1}>
          <article className="zv-proof zv-spot" onPointerMove={spot} aria-label="Rejected candidate D">
            <header>
              <span className="zv-mini-label">Rejected candidate · {proof.kind.toLowerCase()} · {proof.cases} cases</span>
              <span className="zv-verdict is-rejected"><X size={12} /> REJECTED</span>
            </header>
            <p className="zv-proof-big">
              <span className="sr-only">{proof.rejected.cost_reduction}</span>
              <span aria-hidden><Count to={cost} decimals={2} suffix="%" /></span>
            </p>
            <p className="zv-proof-cap">lower measured inference cost</p>
            <div className="zv-bars">
              <div><span>Baseline</span><span className="zv-vis-track"><motion.i initial={{ width: 0 }} whileInView={{ width: '100%' }} viewport={{ once: true }} transition={{ duration: 1, ease: EASE }} /></span><b>100%</b></div>
              <div><span>Candidate</span><span className="zv-vis-track"><motion.i className="is-blue" initial={{ width: 0 }} whileInView={{ width: `${100 - cost}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: EASE, delay: 0.15 }} /></span><b>{(100 - cost).toFixed(2)}%</b></div>
            </div>
            <div className="zv-quality">
              <div className="zv-gauge">
                <motion.span className="zv-gauge-fill is-red" initial={{ width: 0 }} whileInView={{ width: `${quality * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.2, ease: EASE, delay: 0.3 }} />
                <span className="zv-gauge-floor" style={{ left: `${floor * 100}%` }}><em>required {proof.rejected.quality_floor}</em></span>
              </div>
              <p><b>Quality {proof.rejected.quality}</b> missed the {proof.rejected.quality_floor} floor. Cheaper — still rejected. It never became a recommendation.</p>
            </div>
            <motion.span className="zv-stamp" aria-hidden initial={{ opacity: 0, scale: 1.8, rotate: -24 }} whileInView={{ opacity: 1, scale: 1, rotate: -12 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.9 }}>
              REJECTED
            </motion.span>
            <footer>{proof.qualifier}</footer>
          </article>
        </Reveal>
      </div>
    </section>
  );
}

/* ─────────────────────────── 5. Boundaries + audience ─────────────────────────── */

export function BoundariesV2() {
  const items = [
    { Icon: Eye, t: 'Code stays close.', b: 'Read-only repository scans run on your machine. Secret-like files are skipped.' },
    { Icon: KeyRound, t: 'Access has a scope.', b: 'Metadata by default. Opt-in samples. Revocable, project-scoped tokens.' },
    { Icon: UserCheck, t: 'Shipping stays yours.', b: 'Review the patch and evidence. Human approval is part of the workflow.' },
  ];
  return (
    <section className="zv-bounds" aria-labelledby="zv-bounds-title">
      <div className="zv-wrap">
        <Reveal className="zv-bounds-head">
          <div>
            <p className="zv-kicker">Your boundaries · trust, engineered in</p>
            <h2 id="zv-bounds-title" className="zv-h2">Your system. Your rules. <span className="zv-accent">Built in.</span></h2>
          </div>
          <Link to="/security" className="zv-link">Explore the security model <ArrowUpRight size={15} aria-hidden /></Link>
        </Reveal>
        <div className="zv-cards3">
          {items.map(({ Icon, t, b }, i) => (
            <Reveal key={t} delay={i * 0.08}>
              <article className="zv-card zv-spot" onPointerMove={spot}>
                <span className="zv-card-icon"><Icon size={20} aria-hidden /></span>
                <span className="zv-card-n">0{i + 1}</span>
                <h3>{t}</h3>
                <p>{b}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <div className="zv-audience">
          {[
            ['AI product teams', 'Move beyond model-by-model savings.', 'Understand retries, chained calls and agent tools that can make a cheap request expensive in practice.', 'Explore a scoped evaluation', '/evaluation'],
            ['RAG and agent engineers', 'Protect the answer while changing the path.', 'Compare retrieval, context and execution choices against representative tasks rather than a single happy-path prompt.', 'See how decisions are evaluated', '/how-it-works'],
          ].map(([who, t, b, cta, to], i) => (
            <Reveal key={who} delay={i * 0.08}>
              <article className="zv-aud zv-spot" onPointerMove={spot}>
                <p className="zv-mini-label">0{i + 1} / {who}</p>
                <h3>{t}</h3>
                <p>{b}</p>
                <Link to={to} className="zv-link">{cta} <ArrowRight size={15} aria-hidden /></Link>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 6. Close ─────────────────────────── */

export function CloseV2() {
  return <PremiumCta />;
}
