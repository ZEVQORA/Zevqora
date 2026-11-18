import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
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
  { n: '01', title: 'Observe', body: 'See the model calls, tool steps, retries and context behind one AI workflow.', Icon: Eye },
  { n: '02', title: 'Challenge', body: 'Propose lighter paths: a smaller model, a shorter context, a cache.', Icon: FlaskConical },
  { n: '03', title: 'Verify', body: 'Replay each candidate on recorded cases against the quality floor you set first.', Icon: ShieldCheck },
  { n: '04', title: 'Review', body: 'Read the evidence and decide. VERIFIED does not mean deployed.', Icon: UserCheck },
];

/** A width that grows from zero the first time it is on screen. */
const grow = (width: string, delay = 0) => ({
  initial: { width: 0 },
  whileInView: { width },
  viewport: { once: true },
  transition: { duration: 1, ease: EASE, delay },
});

/** One small, honest illustration per step (sample data, labelled under the section). */
function FlowVisual({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="zv-fv-bars">
        {[
          ['Retrieval', 22, ''],
          ['Large model', 78, 'is-hot'],
          ['Tool call', 30, ''],
          ['Retry', 52, 'is-warm'],
        ].map(([label, w, tone], k) => (
          <div key={label as string}>
            <span>{label}</span>
            <span className="zv-fv-track"><motion.i className={tone as string} {...grow(`${w}%`, 0.3 + k * 0.08)} /></span>
          </div>
        ))}
      </div>
    );
  if (i === 1)
    return (
      <ul className="zv-fv-cands">
        {['Smaller model', 'Trim context', 'Cache answers', 'Cheapest model'].map((t, k) => (
          <li key={t}>
            <GitBranch size={12} aria-hidden />
            <b>{String.fromCharCode(65 + k)}</b> {t}
          </li>
        ))}
      </ul>
    );
  if (i === 2)
    return (
      <div className="zv-fv-gates">
        {[
          ['D', 0.87, false],
          ['A', 0.97, true],
        ].map(([name, q, ok], k) => (
          <div key={name as string} className={ok ? 'is-pass' : 'is-fail'}>
            <div className="zv-fv-gate-row">
              <span>Candidate {name as string} · {(q as number).toFixed(2)}</span>
              <span className={`zv-verdict ${ok ? 'is-verified' : 'is-rejected'}`}>{ok ? <Check size={11} /> : <X size={11} />} {ok ? 'VERIFIED' : 'REJECTED'}</span>
            </div>
            <span className="zv-fv-gauge">
              <motion.i {...grow(`${(q as number) * 100}%`, 0.3 + k * 0.15)} />
              <em style={{ left: '95%' }} />
            </span>
          </div>
        ))}
        <small>floor 0.95</small>
      </div>
    );
  return (
    <div className="zv-fv-decision">
      <p><b>Candidate A</b> passed every gate.</p>
      <div>
        <span className="zv-fv-btn is-primary">Approve</span>
        <span className="zv-fv-btn">Not now</span>
      </div>
    </div>
  );
}

/**
 * The loop as one pipeline: four connected steps, all visible at once. The rail
 * fills and the step nodes light up in order the first time the section is on
 * screen. A row on wide screens, a vertical timeline on phones.
 */
export function LoopV2() {
  const ref = useRef<HTMLOListElement>(null);
  const seen = useInView(ref, { once: true, margin: '0px 0px -20% 0px' });
  return (
    <section className="zv-loop" id="workbench" aria-labelledby="zv-loop-title">
      <div className="zv-wrap">
        <Reveal className="zv-loop-head">
          <div>
            <p className="zv-kicker">The work · measure, replay, verify, review</p>
            <h2 id="zv-loop-title" className="zv-h2">
              Cheaper AI means nothing if <span className="zv-accent">the answer gets worse.</span>
            </h2>
          </div>
          <p className="zv-sub">ZEVQORA measures one workload, tests a lighter alternative against quality you set in advance, and shows whether it deserves to ship.</p>
        </Reveal>

        <ol ref={ref} className={`zv-flow${seen ? ' is-in' : ''}`}>
          <li className="zv-flow-rail" aria-hidden>
            <i />
          </li>
          {STEPS.map((s, i) => (
            <li key={s.n} className="zv-flow-step" style={{ '--i': i } as CSSProperties}>
              <span className="zv-flow-node" aria-hidden>
                {s.n}
              </span>
              <article className="zv-flow-card zv-spot" onPointerMove={spot} aria-label={`Step ${s.n}: ${s.title}`}>
                <header>
                  <span className="zv-flow-icon"><s.Icon size={17} aria-hidden /></span>
                  <h3>{s.title}</h3>
                </header>
                <p>{s.body}</p>
                <div className="zv-flow-vis">
                  <FlowVisual i={i} />
                </div>
              </article>
            </li>
          ))}
        </ol>
        <p className="zv-flow-note">Sample data. Verify uses an internal 50-case benchmark, not customer evidence.</p>
      </div>
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
