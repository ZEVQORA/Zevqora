import { type PointerEvent } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
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

const LOOP: Array<{ n: string; label: string; title: string; body: string; Icon: typeof Eye; wide?: boolean }> = [
  { n: '01', label: 'Observe', title: 'See where the money goes.', body: 'The model calls, tool steps, retries and context behind one AI workflow — the real baseline.', Icon: Eye, wide: true },
  { n: '02', label: 'Challenge', title: 'Propose a lighter path.', body: 'A smaller model, a shorter context, a cache. Each one is a candidate, never a promise.', Icon: FlaskConical },
  { n: '03', label: 'Verify', title: 'Let the gates decide.', body: 'Replay every candidate on recorded cases against the quality floor you set in advance.', Icon: ShieldCheck },
  { n: '04', label: 'Review', title: 'You decide what ships.', body: 'Read the patch and the evidence. VERIFIED does not mean deployed.', Icon: UserCheck, wide: true },
];

const once = { once: true, margin: '-10% 0px' } as const;

/** Observe: one request as a trace waterfall; the hot span is where this example spends most. */
function Waterfall() {
  const spans: Array<[string, number, number, string]> = [
    ['Request', 0, 100, 'is-total'],
    ['Retrieval', 3, 14, ''],
    ['Large model call', 17, 44, 'is-hot'],
    ['Order lookup', 62, 11, ''],
    ['Retry', 74, 24, 'is-warm'],
  ];
  return (
    <div className="zv-bv-water">
      {spans.map(([label, x, w, tone], k) => (
        <div className="zv-bv-wrow" key={label}>
          <span>{label}</span>
          <span className="zv-bv-lane">
            <motion.i className={tone} style={{ left: `${x}%` }} initial={{ width: 0 }} whileInView={{ width: `${w}%` }} viewport={once} transition={{ duration: 0.9, ease: EASE, delay: 0.25 + k * 0.12 }} />
            {tone === 'is-hot' && <b className="zv-bv-tag">most spend</b>}
          </span>
        </div>
      ))}
      <div className="zv-bv-axis" aria-hidden>
        <span>request</span>
        <span>answer</span>
      </div>
    </div>
  );
}

/** Challenge: candidates branch off the baseline. */
function CandidateTree() {
  return (
    <ul className="zv-bv-tree">
      {['Smaller model on simple tickets', 'Trim retrieved context', 'Cache policy answers', 'Cheapest model everywhere'].map((t, k) => (
        <motion.li key={t} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={once} transition={{ duration: 0.6, ease: EASE, delay: 0.25 + k * 0.1 }}>
          <b>{'ABCD'[k]}</b>
          <span>{t}</span>
        </motion.li>
      ))}
    </ul>
  );
}

/** Verify: quality as a ring, with the floor marked at 0.95. */
function QualityRing({ name, q, ok, delay }: { name: string; q: number; ok: boolean; delay: number }) {
  const r = 34;
  const a = 0.95 * 2 * Math.PI - Math.PI / 2;
  const tick = (d: number) => [42 + d * Math.cos(a), 42 + d * Math.sin(a)];
  const [x1, y1] = tick(26);
  const [x2, y2] = tick(42);
  return (
    <div className={`zv-bv-ring ${ok ? 'is-pass' : 'is-fail'}`}>
      <div className="zv-bv-dial">
        <svg viewBox="0 0 84 84" aria-hidden>
          <circle cx="42" cy="42" r={r} className="zv-bv-ring-track" />
          <motion.circle cx="42" cy="42" r={r} className="zv-bv-ring-fill" transform="rotate(-90 42 42)" initial={{ pathLength: 0 }} whileInView={{ pathLength: q }} viewport={once} transition={{ duration: 1.3, ease: EASE, delay }} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} className="zv-bv-floor" />
        </svg>
        <strong>{q.toFixed(2)}</strong>
      </div>
      <p>Candidate {name}</p>
      <span className={`zv-verdict ${ok ? 'is-verified' : 'is-rejected'}`}>
        {ok ? <Check size={11} /> : <X size={11} />} {ok ? 'VERIFIED' : 'REJECTED'}
      </span>
    </div>
  );
}

function Gates() {
  return (
    <div>
      <div className="zv-bv-rings">
        <QualityRing name="D" q={0.87} ok={false} delay={0.2} />
        <QualityRing name="A" q={0.97} ok delay={0.4} />
      </div>
      <p className="zv-bv-floor-note">White tick = the 0.95 quality floor</p>
    </div>
  );
}

/** Review: what lands on a person's desk. */
function ReviewRequest() {
  return (
    <div className="zv-bv-review">
      <div className="zv-bv-review-head">
        <span><GitBranch size={14} aria-hidden /> Candidate A · smaller model on simple tickets</span>
        <span className="zv-verdict is-verified"><Check size={11} /> VERIFIED</span>
      </div>
      <ul>
        <li><Check size={14} aria-hidden /> Quality 0.97, above the 0.95 floor</li>
        <li><Check size={14} aria-hidden /> Patch and evidence ready to read</li>
        <li className="is-wait"><UserCheck size={14} aria-hidden /> Waiting for your decision</li>
      </ul>
      <div className="zv-bv-actions">
        <span className="zv-bv-btn is-primary">Approve for review</span>
        <span className="zv-bv-btn">Not now</span>
        <em>Nothing deploys on its own.</em>
      </div>
    </div>
  );
}

const VISUALS = [Waterfall, CandidateTree, Gates, ReviewRequest];

/**
 * The loop as a dark bento: four cards of alternating width inside a rounded
 * ink panel that echoes the hero. Everything is visible at once; on phones
 * the cards simply stack.
 */
export function LoopV2() {
  return (
    <section className="zv-loop" id="workbench" aria-labelledby="zv-loop-title">
      <div className="zv-loop-panel">
        <span className="zv-loop-grid-lines" aria-hidden />
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

          <ol className="zv-bento">
            {LOOP.map((s, i) => {
              const Visual = VISUALS[i];
              return (
                <li key={s.n} className={`zv-bento-cell${s.wide ? ' is-wide' : ''}`}>
                  <Reveal delay={0.06 * i} className="zv-bento-reveal">
                    <article className="zv-bento-card zv-spot" onPointerMove={spot} aria-labelledby={`zv-bento-${s.n}`}>
                      <span className="zv-bento-n" aria-hidden>{s.n}</span>
                      <p className="zv-bento-label">
                        <s.Icon size={14} aria-hidden /> {s.n} · {s.label}
                      </p>
                      <h3 id={`zv-bento-${s.n}`}>{s.title}</h3>
                      <p className="zv-bento-body">{s.body}</p>
                      <div className="zv-bento-vis">
                        <Visual />
                      </div>
                    </article>
                  </Reveal>
                </li>
              );
            })}
          </ol>
          <p className="zv-bento-note">Illustrative sample data. The quality figures come from an internal 50-case benchmark, not customer evidence.</p>
        </div>
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
