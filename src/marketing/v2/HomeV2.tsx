import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight, Eye, FlaskConical, KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
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

/*
 * A scroll-driven story. While the section is pinned, scroll progress p (0..1)
 * plays one workload through the four phases on a single SVG stage:
 *   0.00–0.25 Observe   · the trace draws in, the expensive call glows
 *   0.25–0.50 Challenge · four candidates branch out of the hot spot
 *   0.50–0.75 Verify    · a quality gate draws; A passes, D bounces off
 *   0.75–1.00 Review    · A lands in a review request and gets approved
 * Sample data only (labelled under the stage).
 */
type Progress = MotionValue<number>;

const PHASES = [
  { n: '01', label: 'Observe', title: 'See where the money goes.', body: 'ZEVQORA reads one real workflow — model calls, tool steps, retries — and finds the expensive part.', Icon: Eye },
  { n: '02', label: 'Challenge', title: 'Propose lighter paths.', body: 'From the hot spot it branches candidates: a smaller model, a trimmed context, a cache. Each one is only a candidate.', Icon: FlaskConical },
  { n: '03', label: 'Verify', title: 'Let the gate decide.', body: 'Every candidate replays on recorded cases against the quality floor you set first. Below the floor is rejected, however cheap.', Icon: ShieldCheck },
  { n: '04', label: 'Review', title: 'You decide what ships.', body: 'The verified candidate lands on your desk with its evidence. VERIFIED does not mean deployed.', Icon: UserCheck },
];
/** Where each phase looks settled, used by the step buttons. */
const PHASE_AT = [0.18, 0.44, 0.71, 0.985];

const TRACE: Array<[string, number, number, string]> = [
  ['Request', 0, 1, 'is-total'],
  ['Retrieval', 0.03, 0.14, ''],
  ['Large model', 0.17, 0.44, 'is-hot'],
  ['Order lookup', 0.62, 0.11, ''],
  ['Retry', 0.74, 0.24, 'is-warm'],
];
const LANE_X = 128;
const LANE_W = 200;
const ROW0 = 150;
const ROW_H = 36;
const HOT_Y = ROW0 + 2 * ROW_H;
const ORIGIN_X = 344;
const PILL_X = 420;
const PILL_W = 200;
const PILL_H = 40;
const PILL_Y = [96, 166, 236, 306];
const CANDS = ['Smaller model', 'Trim context', 'Cache answers', 'Cheapest model'];
const GATE_X = 660;

function TraceRow({ p, k }: { p: Progress; k: number }) {
  const [label, x, w, tone] = TRACE[k];
  const y = ROW0 + k * ROW_H;
  const show = useTransform(p, [0.01 + k * 0.025, 0.06 + k * 0.025], [0, 1]);
  const grow = useTransform(p, [0.03 + k * 0.025, 0.11 + k * 0.025], [0, 1]);
  return (
    <motion.g style={{ opacity: show }}>
      <text x={24} y={y + 4} className="zs-label">{label}</text>
      <rect x={LANE_X} y={y - 11} width={LANE_W} height={22} rx={7} className="zs-lane" />
      <motion.rect x={LANE_X + x * LANE_W} y={y - 6} width={w * LANE_W} height={12} rx={5} className={`zs-bar ${tone}`} style={{ scaleX: grow, originX: 0 }} />
    </motion.g>
  );
}

function Trace({ p }: { p: Progress }) {
  const dim = useTransform(p, [0, 0.5, 0.55, 0.76, 0.81], [1, 1, 0.5, 0.5, 0.06]);
  const tag = useTransform(p, [0.15, 0.19], [0, 1]);
  const tagX = useTransform(p, [0.15, 0.19], [-8, 0]);
  return (
    <motion.g style={{ opacity: dim }}>
      <text x={24} y={112} className="zs-kicker">ONE REQUEST · SUPPORT AGENT</text>
      {TRACE.map((_, k) => (
        <TraceRow key={k} p={p} k={k} />
      ))}
      <motion.g style={{ opacity: tag, x: tagX }}>
        <rect x={LANE_X + 0.61 * LANE_W + 6} y={HOT_Y - 9} width={66} height={18} rx={9} className="zs-tag" />
        <text x={LANE_X + 0.61 * LANE_W + 39} y={HOT_Y + 4} textAnchor="middle" className="zs-tag-t">most spend</text>
      </motion.g>
      <text x={LANE_X} y={ROW0 + 5 * ROW_H} className="zs-axis">request</text>
      <text x={LANE_X + LANE_W} y={ROW0 + 5 * ROW_H} textAnchor="end" className="zs-axis">answer</text>
    </motion.g>
  );
}

function Branch({ p, k }: { p: Progress; k: number }) {
  const cy = PILL_Y[k] + PILL_H / 2;
  const d = `M ${ORIGIN_X} ${HOT_Y} C ${ORIGIN_X + 44} ${HOT_Y}, ${PILL_X - 44} ${cy}, ${PILL_X} ${cy}`;
  const len = useTransform(p, [0.27 + k * 0.03, 0.36 + k * 0.03], [0, 1]);
  const flow = useTransform(p, [0.36 + k * 0.03, 0.4 + k * 0.03], [0, 1]);
  return (
    <g>
      <motion.path d={d} className="zs-branch" style={{ pathLength: len }} />
      <motion.path d={d} className="zs-branch-flow" style={{ opacity: flow }} />
    </g>
  );
}

function Branches({ p }: { p: Progress }) {
  const fade = useTransform(p, [0.5, 0.55, 0.76, 0.8], [1, 0.45, 0.45, 0]);
  const origin = useTransform(p, [0.25, 0.28], [0, 1]);
  return (
    <motion.g style={{ opacity: fade }}>
      {CANDS.map((_, k) => (
        <Branch key={k} p={p} k={k} />
      ))}
      <motion.g style={{ opacity: origin }}>
        <circle cx={ORIGIN_X} cy={HOT_Y} r={5} className="zs-origin" />
        <circle cx={ORIGIN_X} cy={HOT_Y} r={5} className="zs-origin-ping" />
      </motion.g>
    </motion.g>
  );
}

function Gate({ p }: { p: Progress }) {
  const len = useTransform(p, [0.5, 0.57], [0, 1]);
  const show = useTransform(p, [0.5, 0.53, 0.76, 0.8], [0, 1, 1, 0]);
  const d = `M ${GATE_X} 74 L ${GATE_X} 396`;
  return (
    <motion.g style={{ opacity: show }}>
      <motion.path d={d} className="zs-gate" style={{ pathLength: len }} />
      <path d={d} className="zs-gate-flow" />
      <rect x={GATE_X - 70} y={44} width={140} height={22} rx={11} className="zs-gate-chip" />
      <text x={GATE_X} y={59} textAnchor="middle" className="zs-gate-t">quality floor 0.95</text>
    </motion.g>
  );
}

function Candidate({ p, k }: { p: Progress; k: number }) {
  const isA = k === 0;
  const isD = k === 3;
  const tested = isA || isD;
  const y0 = PILL_Y[k];
  const appear = useTransform(p, [0.3 + k * 0.03, 0.36 + k * 0.03], [0, 1]);
  const enterX = useTransform(p, [0.3 + k * 0.03, 0.37 + k * 0.03], [-18, 0]);
  const moveX = useTransform(p, isA ? [0.56, 0.66, 0.76, 0.84] : isD ? [0.56, 0.63, 0.67] : [0, 1], isA ? [0, 170, 170, -210] : isD ? [0, 50, 22] : [0, 0]);
  const x = useTransform([enterX, moveX], ([a, b]: number[]) => a + b);
  const y = useTransform(p, isA ? [0.76, 0.84] : isD ? [0.64, 0.7] : [0, 1], isA ? [0, 180 - y0] : isD ? [0, 16] : [0, 0]);
  const fade = useTransform(p, isA ? [0, 1] : isD ? [0.76, 0.8] : [0.52, 0.56, 0.76, 0.8], isA ? [1, 1] : isD ? [1, 0] : [1, 0.28, 0.28, 0]);
  const opacity = useTransform([appear, fade], ([a, f]: number[]) => a * f);
  const tint = useTransform(p, isA ? [0.64, 0.67] : [0.62, 0.65], [0, 1]);
  const score = useTransform(p, [0.58, isA ? 0.66 : 0.64], [0, isA ? 0.97 : 0.87]);
  const scoreText = useTransform(score, (v) => v.toFixed(2));
  const scoreOn = useTransform(p, [0.56, 0.58], [0, 1]);
  const verdict = useTransform(p, isA ? [0.66, 0.69] : [0.65, 0.68], [0, 1]);
  const verdictY = useTransform(p, isA ? [0.66, 0.69] : [0.65, 0.68], [6, 0]);
  return (
    <motion.g style={{ x, y, opacity }}>
      <rect x={PILL_X} y={y0} width={PILL_W} height={PILL_H} rx={12} className="zs-pill" />
      {tested && <motion.rect x={PILL_X} y={y0} width={PILL_W} height={PILL_H} rx={12} className={isA ? 'zs-pill-ok' : 'zs-pill-bad'} style={{ opacity: tint }} />}
      <rect x={PILL_X + 10} y={y0 + 9} width={22} height={22} rx={7} className="zs-key" />
      <text x={PILL_X + 21} y={y0 + 24} textAnchor="middle" className="zs-key-t">{'ABCD'[k]}</text>
      <text x={PILL_X + 42} y={y0 + 25} className="zs-pill-t">{CANDS[k]}</text>
      {tested && (
        <motion.text x={PILL_X + PILL_W - 12} y={y0 + 25} textAnchor="end" className="zs-score" style={{ opacity: scoreOn }}>
          {scoreText}
        </motion.text>
      )}
      {tested && (
        <motion.g style={{ opacity: verdict, y: verdictY }}>
          <rect x={PILL_X} y={y0 + 48} width={isA ? 88 : 92} height={22} rx={11} className={isA ? 'zs-v-ok' : 'zs-v-bad'} />
          <text x={PILL_X + (isA ? 44 : 46)} y={y0 + 63} textAnchor="middle" className={isA ? 'zs-v-ok-t' : 'zs-v-bad-t'}>
            {isA ? '✓ VERIFIED' : '✕ REJECTED'}
          </text>
        </motion.g>
      )}
    </motion.g>
  );
}

function ReviewCard({ p }: { p: Progress }) {
  const show = useTransform(p, [0.8, 0.85], [0, 1]);
  const lift = useTransform(p, [0.8, 0.86], [24, 0]);
  const rows = [useTransform(p, [0.85, 0.87], [0, 1]), useTransform(p, [0.87, 0.89], [0, 1]), useTransform(p, [0.89, 0.91], [0, 1])];
  const sent = useTransform(p, [0.935, 0.95], [0, 1]);
  const unsent = useTransform(sent, (v) => 1 - v);
  const cursorOn = useTransform(p, [0.86, 0.88, 0.97, 1], [0, 1, 1, 0.9]);
  const cursorX = useTransform(p, [0.86, 0.92], [150, 0]);
  const cursorY = useTransform(p, [0.86, 0.92], [90, 0]);
  const press = useTransform(p, [0.92, 0.93, 0.945], [1, 0.78, 1]);
  const checks = ['Quality 0.97 · above the 0.95 floor', 'Patch and evidence attached', 'Waiting for your decision'];
  return (
    <motion.g style={{ opacity: show, y: lift }}>
      <rect x={180} y={160} width={440} height={250} rx={22} className="zs-card" />
      <text x={596} y={205} textAnchor="end" className="zs-kicker">REVIEW REQUEST</text>
      {checks.map((t, i) => (
        <motion.g key={t} style={{ opacity: rows[i] }}>
          <circle cx={219} cy={282 + i * 26} r={8} className={i < 2 ? 'zs-check' : 'zs-wait'} />
          <text x={219} y={286 + i * 26} textAnchor="middle" className="zs-check-t">{i < 2 ? '✓' : '…'}</text>
          <text x={236} y={286 + i * 26} className="zs-row-t">{t}</text>
        </motion.g>
      ))}
      <rect x={210} y={356} width={176} height={36} rx={18} className="zs-btn" />
      <motion.rect x={210} y={356} width={176} height={36} rx={18} className="zs-btn-ok" style={{ opacity: sent }} />
      <motion.text x={298} y={379} textAnchor="middle" className="zs-btn-t" style={{ opacity: unsent }}>Approve for review</motion.text>
      <motion.text x={298} y={379} textAnchor="middle" className="zs-btn-t" style={{ opacity: sent }}>✓ Sent to review</motion.text>
      <rect x={398} y={356} width={92} height={36} rx={18} className="zs-btn-ghost" />
      <text x={444} y={379} textAnchor="middle" className="zs-btn-ghost-t">Not now</text>
      <text x={400} y={432} textAnchor="middle" className="zs-foot">VERIFIED does not mean deployed — nothing ships on its own.</text>
      <motion.g style={{ x: cursorX, y: cursorY, scale: press, opacity: cursorOn }}>
        <path transform="translate(300 368)" d="M0 0 L0 19 L5 14.5 L8.6 22.6 L12 21 L8.4 13 L15 13 Z" className="zs-cursor" />
      </motion.g>
    </motion.g>
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

/*
 * On phones the whole 800-wide scene would shrink until its text is unreadable,
 * so a camera (an animated viewBox, 450 × 380) zooms in and pans to the action
 * of each phase instead: the trace, the branches, the gate, the review card.
 */
const CAM_AT = [0, 0.22, 0.28, 0.48, 0.54, 0.74, 0.8, 1];
const CAM_X = [0, 0, 210, 210, 350, 350, 175, 175];
const CAM_Y = [80, 80, 40, 40, 30, 30, 120, 120];

function Stage({ p }: { p: Progress }) {
  const narrow = useMedia('(max-width: 900px)');
  const camX = useTransform(p, CAM_AT, CAM_X);
  const camY = useTransform(p, CAM_AT, CAM_Y);
  const camera = useTransform([camX, camY], ([x, y]: number[]) => `${x} ${y} 450 380`);
  return (
    <motion.svg
      viewBox={narrow ? camera : '0 0 800 444'}
      className={narrow ? 'is-camera' : undefined}
      role="img"
      aria-label="Illustrative: one request is traced, four lighter candidates are proposed, a quality gate rejects candidate D at 0.87 and verifies candidate A at 0.97, and candidate A goes to a person for review."
    >
      <defs>
        <pattern id="zs-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" className="zs-dot" />
        </pattern>
      </defs>
      <rect width="800" height="520" fill="url(#zs-dots)" />
      <Trace p={p} />
      <Branches p={p} />
      <Gate p={p} />
      <ReviewCard p={p} />
      {CANDS.map((_, k) => (
        <Candidate key={k} p={p} k={k} />
      ))}
    </motion.svg>
  );
}

function PhaseText({ p, i }: { p: Progress; i: number }) {
  const s = i * 0.25;
  const e = s + 0.25;
  // Out before in: each text leaves over the last 3% of its phase and the next arrives over the first 3% of its own, so two never overlap.
  const input = i === 0 ? [0, e - 0.03, e] : i === 3 ? [s, s + 0.03, 1] : [s, s + 0.03, e - 0.03, e];
  const opacity = useTransform(p, input, i === 0 ? [1, 1, 0] : i === 3 ? [0, 1, 1] : [0, 1, 1, 0]);
  const y = useTransform(p, input, i === 0 ? [0, 0, -14] : i === 3 ? [14, 0, 0] : [14, 0, 0, -14]);
  const ph = PHASES[i];
  return (
    <motion.div className="zv-story-text" style={{ opacity, y }}>
      <p className="zv-story-k">
        <ph.Icon size={15} aria-hidden /> {ph.n} · {ph.label}
      </p>
      <h3>{ph.title}</h3>
      <p className="zv-story-b">{ph.body}</p>
    </motion.div>
  );
}

/**
 * The loop as a pinned, scroll-driven story (light). The page stays light from
 * Ask Zev through the evidence, so the chat is no longer squeezed between two
 * dark sections.
 */
export function LoopV2() {
  const story = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: story, offset: ['start start', 'end end'] });
  const smooth = useSpring(scrollYProgress, { stiffness: 220, damping: 40, restDelta: 0.0005 });
  const p = reduced ? scrollYProgress : smooth;
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(3, Math.max(0, Math.floor(v * 4 - 1e-6)))));
  const bar = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const goTo = (i: number) => {
    const el = story.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const target = top + (el.offsetHeight - window.innerHeight) * PHASE_AT[i];
    if (reduced) window.scrollTo(0, target);
    else animate(window.scrollY, target, { duration: 1.1, ease: EASE, onUpdate: (v) => window.scrollTo(0, v) });
  };

  return (
    <section className="zv-loop" id="workbench" aria-labelledby="zv-loop-title">
      <div className="zv-wrap zv-loop-head">
        <div>
          <Reveal>
            <p className="zv-kicker">The work · measure, replay, verify, review</p>
          </Reveal>
          <h2 id="zv-loop-title" className="zv-h2">
            <Words text="Cheaper AI means nothing if" inView />{' '}
            <span className="zv-accent">
              <Words text="the answer gets worse." inView delay={0.35} />
            </span>
          </h2>
        </div>
        <Reveal delay={0.2}>
          <p className="zv-sub">Scroll to watch one workload go through ZEVQORA: measured, challenged, verified against your quality floor, and handed to a person.</p>
        </Reveal>
      </div>

      <div ref={story} className="zv-story">
        <div className="zv-story-pin">
          <span className="zv-story-blob is-a" aria-hidden />
          <span className="zv-story-blob is-b" aria-hidden />
          <div className="zv-wrap zv-story-grid">
            <div className="zv-story-copy">
              <ol className="zv-story-rail" aria-label="Phases">
                {PHASES.map((ph, i) => (
                  <li key={ph.n} className={i === active ? 'is-active' : i < active ? 'is-done' : ''}>
                    <button type="button" onClick={() => goTo(i)} aria-current={i === active ? 'step' : undefined}>
                      <span>{ph.n}</span>
                      <em>{ph.label}</em>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="zv-story-texts">
                {PHASES.map((ph, i) => (
                  <PhaseText key={ph.n} p={p} i={i} />
                ))}
              </div>
              <div className="zv-story-progress" aria-hidden>
                <motion.i style={{ scaleX: bar }} />
              </div>
            </div>
            <div className="zv-story-stage">
              <div className="zv-story-bar" aria-hidden>
                <span className="zv-story-dots"><i /><i /><i /></span>
                <span>zevqora · support-agent</span>
                <span className="zv-sample">Sample data</span>
              </div>
              <Stage p={p} />
            </div>
          </div>
        </div>
      </div>
      <p className="zv-wrap zv-story-note">Illustrative sample data. The quality figures come from an internal 50-case benchmark, not customer evidence.</p>
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
