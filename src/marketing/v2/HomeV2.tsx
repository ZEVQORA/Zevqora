import { useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, useMotionValueEvent } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Eye, FlaskConical, GitBranch, KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
import { DimensionalZ } from '@/brand/DimensionalZ';
import { Zev, type ZevView } from '@/brand/Zev';
import { useSiteContent } from '@/lib/site';
import { AskZev } from '../askzev/AskZev';
import { PricingGrid } from '../Pricing';
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

      <div className="zv-wrap zv-hero-foot">
        <ol className="zv-hero-chapters" aria-label="The loop">
          {['Observe', 'Challenge', 'Verify', 'Review'].map((w, i) => (
            <li key={w}>
              <b>0{i + 1}</b>
              {w}
            </li>
          ))}
        </ol>
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

const STEPS: Array<{ n: string; title: string; body: string; pose: ZevView; Icon: typeof Eye }> = [
  { n: '01', title: 'Observe', body: 'See the model calls, tool steps, retries and context behind one AI workflow — the real baseline.', pose: 'pose-sitting', Icon: Eye },
  { n: '02', title: 'Challenge', body: 'Propose a lighter path: a smaller model, a shorter context, a cache — each one a candidate, never a promise.', pose: 'pose-playful', Icon: FlaskConical },
  { n: '03', title: 'Verify', body: 'Replay the candidate on recorded cases against the quality floor you set in advance. Gates decide, not opinions.', pose: 'pose-thinking', Icon: ShieldCheck },
  { n: '04', title: 'Review', body: 'Read the evidence and decide. VERIFIED does not mean deployed — shipping stays a human decision.', pose: 'pose-waving', Icon: UserCheck },
];

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
            <span className="zv-vis-track"><motion.i className={tone as string} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.9, ease: EASE, delay: 0.1 + k * 0.08 }} /></span>
          </div>
        ))}
        <p className="zv-vis-foot">Illustrative. The highlighted call is where this example spends most.</p>
      </div>
    );
  if (i === 1)
    return (
      <div className="zv-vis">
        <p className="zv-vis-title">Candidates</p>
        {[
          ['A · smaller model on simple tickets', 'candidate'],
          ['B · trim retrieved context', 'candidate'],
          ['C · cache policy answers', 'candidate'],
          ['D · cheapest model everywhere', 'candidate'],
        ].map(([t], k) => (
          <motion.div className="zv-vis-cand" key={t} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease: EASE, delay: k * 0.08 }}>
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
          <motion.span className="zv-gauge-fill" initial={{ width: 0 }} animate={{ width: '87%' }} transition={{ duration: 1.1, ease: EASE }} />
          <span className="zv-gauge-floor" style={{ left: '95%' }}><em>floor 0.95</em></span>
        </div>
        <div className="zv-gauge-legend">
          <span>Candidate D · 0.87</span>
          <span className="zv-verdict is-rejected"><X size={12} /> REJECTED</span>
        </div>
        <div className="zv-gauge is-pass">
          <motion.span className="zv-gauge-fill" initial={{ width: 0 }} animate={{ width: '97%' }} transition={{ duration: 1.1, ease: EASE, delay: 0.15 }} />
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

export function LoopV2() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  const step = STEPS[active];
  return (
    <section className="zv-loop" id="workbench" aria-labelledby="zv-loop-title" ref={ref}>
      <div className="zv-loop-sticky">
        <div className="zv-wrap zv-loop-grid">
          <div>
            <p className="zv-kicker">The work · measure, replay, verify, review</p>
            <h2 id="zv-loop-title" className="zv-h2">
              Cheaper AI means nothing if <span className="zv-accent">the answer gets worse.</span>
            </h2>
            <p className="zv-sub">ZEVQORA measures one workload, tests a lighter alternative against quality you set in advance, and shows whether it deserves to ship.</p>
            <ol className="zv-steps">
              {STEPS.map((s, i) => (
                <li key={s.n} className={i === active ? 'is-active' : i < active ? 'is-done' : ''}>
                  <button
                    type="button"
                    aria-current={i === active ? 'step' : undefined}
                    onClick={() => {
                      const el = ref.current;
                      if (!el) return;
                      const top = el.getBoundingClientRect().top + window.scrollY;
                      window.scrollTo({ top: top + ((el.offsetHeight - window.innerHeight) * (i + 0.5)) / STEPS.length, behavior: 'smooth' });
                    }}
                  >
                    <span className="zv-step-n">{s.n}</span>
                    <span className="zv-step-t">{s.title}</span>
                  </button>
                  {i === active && (
                    <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.5, ease: EASE }}>
                      {s.body}
                    </motion.p>
                  )}
                </li>
              ))}
            </ol>
            <div className="zv-loop-bar" aria-hidden><motion.span style={{ scaleX: progress }} /></div>
          </div>
          <div className="zv-loop-card" aria-live="polite">
            <div className="zv-loop-card-head">
              <step.Icon size={16} aria-hidden />
              <span>{step.n} · {step.title}</span>
              <span className="zv-sample">Sample data</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 18, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }} transition={{ duration: 0.45, ease: EASE }}>
                <StepVisual i={active} />
              </motion.div>
            </AnimatePresence>
          </div>
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

/* ─────────────────────────── 5. ZevIR ─────────────────────────── */

/** Graph in one coordinate system (1000 × 360): node boxes and edges share it, so lines always meet the nodes. */
const GW = 1000;
const GH = 360;
const NW = 164;
const NH = 66;
const NODES = [
  { k: 'Task', t: 'Answer a support ticket', x: 92, y: 180 },
  { k: 'Agent', t: 'Support agent', x: 290, y: 180 },
  { k: 'Retrieval', t: 'Policy search', x: 500, y: 74 },
  { k: 'ModelCall', t: 'Large model · 3.1k tokens', x: 500, y: 286, hot: true },
  { k: 'ToolCall', t: 'Order lookup', x: 710, y: 180 },
  { k: 'Outcome', t: 'Resolved · quality 0.96', x: 908, y: 180 },
];
const EDGES: Array<[number, number]> = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5]];
const edgePath = (a: (typeof NODES)[number], b: (typeof NODES)[number]) => {
  const x1 = a.x + NW / 2;
  const x2 = b.x - NW / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${x2} ${b.y}`;
};
// The retry: from the tool call back to the expensive model call.
const RETRY = `M ${NODES[4].x} ${NODES[4].y + NH / 2} C ${NODES[4].x} ${GH - 8}, ${NODES[3].x + 120} ${GH - 4}, ${NODES[3].x + NW / 2} ${NODES[3].y + 10}`;

export function ZevIRV2() {
  return (
    <section className="zv-zevir" aria-labelledby="zv-zevir-title">
      <div className="zv-wrap">
        <Reveal className="zv-center">
          <p className="zv-kicker">Under the hood · ZevIR execution graph</p>
          <h2 id="zv-zevir-title" className="zv-h2">One map of how your AI actually runs.</h2>
          <p className="zv-sub">ZevIR turns each request into a graph of the steps behind the answer. Optimization starts from that map, not from a price list.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <figure className="zv-graph" aria-label="Illustrative execution graph">
            <div className="zv-graph-head" aria-hidden>
              <span><i /> zevir.v0.1 · support-ticket</span>
              <span className="zv-sample">Illustrative</span>
            </div>
            <div className="zv-graph-canvas">
              <svg viewBox={`0 0 ${GW} ${GH}`} aria-hidden>
                <defs>
                  <linearGradient id="zv-edge" x1="0" x2="1">
                    <stop offset="0" stopColor="#9cc0ff" />
                    <stop offset="1" stopColor="#468bff" />
                  </linearGradient>
                </defs>
                {EDGES.map(([a, b]) => (
                  <g key={`${a}-${b}`}>
                    <path d={edgePath(NODES[a], NODES[b])} className="zv-edge-base" />
                    <path d={edgePath(NODES[a], NODES[b])} className="zv-edge-flow" />
                  </g>
                ))}
                <path d={RETRY} className="zv-edge-retry" />
                <text x={NODES[4].x - 40} y={GH - 14} className="zv-edge-label">retry</text>
                <circle r="4.5" className="zv-pulse-dot">
                  <animateMotion dur="3.2s" repeatCount="indefinite" path={`${edgePath(NODES[0], NODES[1])} ${edgePath(NODES[1], NODES[3]).replace('M', 'L')} ${edgePath(NODES[3], NODES[4]).replace('M', 'L')} ${edgePath(NODES[4], NODES[5]).replace('M', 'L')}`} />
                </circle>
              </svg>
              {NODES.map((n, i) => (
                <motion.div
                  key={n.k}
                  className={`zv-node${n.hot ? ' is-hot' : ''}`}
                  style={{ left: `${((n.x - NW / 2) / GW) * 100}%`, top: `${((n.y - NH / 2) / GH) * 100}%`, width: `${(NW / GW) * 100}%`, height: `${(NH / GH) * 100}%` }}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.08 }}
                >
                  <small>{n.k}</small>
                  <span>{n.t}</span>
                </motion.div>
              ))}
            </div>
            <figcaption>Illustrative graph. The highlighted model call is where this example spends most; the dashed amber loop is a retry.</figcaption>
          </figure>
        </Reveal>
        <div className="zv-principles">
          {[
            ['Unknown stays unknown.', 'A missing cost or latency is shown as missing — never as zero.'],
            ['Structure, not secrets.', 'Prompt and output content are not captured by default; the graph keeps hashes, sizes and timings.'],
            ['Real paths, including loops.', 'Retries and back-edges are kept, because that is often where the cost hides.'],
          ].map(([t, b], i) => (
            <Reveal key={t} delay={i * 0.08}>
              <h3>{t}</h3>
              <p>{b}</p>
            </Reveal>
          ))}
        </div>
        <p className="zv-status-note">In controlled preview behind a per-workspace feature flag. It informs analysis; it never changes a verdict.</p>
      </div>
    </section>
  );
}

/* ─────────────────────────── 6. Boundaries + audience ─────────────────────────── */

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

/* ─────────────────────────── 7. Pricing + close ─────────────────────────── */

export function PricingV2() {
  return (
    <section className="zv-pricing" id="pricing">
      <PricingGrid />
    </section>
  );
}

export function CloseV2() {
  return <PremiumCta />;
}
