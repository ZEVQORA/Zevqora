import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Sparkles, X } from 'lucide-react';
import { Zev, ZevFace, type ZevExpression } from '@/brand/Zev';

export interface TourStep {
  title: string;
  description: string;
  eyebrow: string;
  path: string;
  action: string;
  /** CSS selector of the element the spotlight points at, when it is on screen. */
  target?: string;
  /** Zev's expression for this step. */
  face?: ZevExpression;
}

/**
 * This tour explains existing, supported product paths only. It does not
 * claim enabled ZevIR/vNext flags, ready provider connections or verified
 * savings. It is non-modal: the spotlight only dims the page, every control
 * stays usable, and Escape pauses it. New members see a short welcome first
 * (AppShell); afterwards it opens from Help.
 */
export const PRODUCT_TOUR_STEPS: readonly TourStep[] = [
  {
    eyebrow: '01 / ASK ZEV',
    title: 'Ask Zev anything.',
    description:
      'Start on the home screen: ask a question in your own words, or open the labelled sample to see how a decision looks. Nothing needs to be connected first.',
    path: '/app',
    action: 'Ask Zev',
    target: '[data-tour="composer"]',
    face: 'warm-smile',
  },
  {
    eyebrow: '02 / CONNECT WHEN READY',
    title: 'Connect one source when you are ready.',
    description:
      'Connect your AI app through a LiteLLM gateway, OpenTelemetry or a sanitized trace file. Each option says what it can and cannot show, and a source is only marked as sending data after the server has received it.',
    path: '/app/connections',
    action: 'Connect my AI app',
    target: '#app-sidebar a[href="/app/connections"]',
    face: 'curious',
  },
  {
    eyebrow: '03 / VERIFY THE OUTCOME',
    title: 'Understand every verdict.',
    description:
      'VERIFIED means the required gates passed. REJECTED means a candidate failed. INCOMPLETE means there is not enough evidence. Never treat a projected saving as realized value.',
    path: '/app/evidence',
    action: 'Explore evidence',
    target: '#app-sidebar a[href="/app/evidence"]',
    face: 'focused',
  },
  {
    eyebrow: '04 / OVERVIEW',
    title: 'See the whole picture.',
    description:
      'The Overview separates observed activity, experimental results and decisions needing your review. Empty metrics mean evidence has not been recorded yet.',
    path: '/app/command',
    action: 'Open Overview',
    target: '#app-sidebar a[href="/app/command"]',
    face: 'calm-confidence',
  },
  {
    eyebrow: '05 / ENGINEERING ZEV',
    title: 'Ask about your actual workload.',
    description:
      'Engineering Zev can explain authorized evidence and recorded decisions. Its provider may be unavailable until configured, and AI explanations never override the verification engine.',
    path: '/app/zev',
    action: 'Open Engineering Zev',
    target: '[data-tour="explain"]',
    face: 'delighted',
  },
];

/** How the tour ended: finished, skipped (not the same as done), or paused to resume later. */
export type TourOutcome = 'done' | 'skipped' | 'paused';

export const productTourStorageKey = (userId: string, workspaceId: string) =>
  `zevqora.productTour.v1:${userId}:${workspaceId}`;

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const CARD_W = 400;

/** Live position of the step's target, or null when it is not on screen. */
function useTargetRect(selector: string | undefined, active: boolean) {
  const [rect, setRect] = useState<Rect | null>(null);
  const measure = useCallback(() => {
    if (!selector || typeof document === 'undefined') return setRect(null);
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return setRect(null);
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [selector]);
  useLayoutEffect(() => {
    if (!active) return;
    measure();
    const id = window.setTimeout(measure, 120); // after route/layout settles
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, active]);
  return rect;
}

/** Where the card sits relative to the spotlight: beside a sidebar item, else above or below. */
function cardPlacement(rect: Rect | null): React.CSSProperties | undefined {
  if (!rect || typeof window === 'undefined' || window.innerWidth < 720) return undefined;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (t: number) => Math.max(16, Math.min(t, vh - 380));
  if (rect.left + rect.width < 340) return { left: rect.left + rect.width + 18, top: clampTop(rect.top - 24), right: 'auto', bottom: 'auto' };
  const left = Math.max(16, Math.min(rect.left + rect.width / 2 - CARD_W / 2, vw - CARD_W - 16));
  if (rect.top > 400) return { left, top: 'auto', right: 'auto', bottom: vh - rect.top + 16 };
  return { left, top: Math.min(rect.top + rect.height + 16, vh - 380), right: 'auto', bottom: 'auto' };
}

export function ProductTour({
  open,
  onClose,
  startAt = 0,
  intro = false,
  name,
}: {
  open: boolean;
  onClose: (outcome?: TourOutcome, step?: number) => void;
  /** Step to resume from (0-based). */
  startAt?: number;
  /** Show the one-time welcome before the steps (first visit of a new member). */
  intro?: boolean;
  /** First name for the welcome. */
  name?: string;
}) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'intro' | 'steps'>(intro ? 'intro' : 'steps');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (open) {
      setIndex(Math.min(Math.max(0, startAt), PRODUCT_TOUR_STEPS.length - 1));
      setPhase(intro ? 'intro' : 'steps');
    }
  }, [open, startAt, intro]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(phase === 'intro' ? 'skipped' : 'paused', phase === 'intro' ? undefined : index);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, index, phase]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open, index, phase]);

  const step = PRODUCT_TOUR_STEPS[index];
  const rect = useTargetRect(step?.target, open && phase === 'steps');

  if (!open) return null;
  const last = index === PRODUCT_TOUR_STEPS.length - 1;

  if (phase === 'intro') {
    return (
      <div className="ztour-scrim is-intro">
        <motion.section
          role="dialog"
          aria-modal="false"
          aria-labelledby="zevqora-tour-title"
          aria-describedby="zevqora-tour-description"
          className="ztour-welcome"
          initial={reduced ? false : { opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 22 }}
        >
          <div className="ztour-welcome-art" aria-hidden>
            <span className="ztour-welcome-ring" />
            <div className="zv-float">
              <Zev view="pose-waving" height={150} alt="" />
            </div>
          </div>
          <p className="ztour-eyebrow"><Sparkles size={12} aria-hidden /> Welcome to ZEVQORA</p>
          <h2 ref={titleRef} tabIndex={-1} id="zevqora-tour-title">{name ? `Hi ${name}, I’m Zev.` : 'Hi, I’m Zev.'}</h2>
          <p id="zevqora-tour-description">
            I’ll show you around in five short steps: where to ask me things, how to connect your AI app, and how to read a verdict. It takes about a minute.
          </p>
          <ul className="ztour-welcome-list">
            <li><Check size={13} aria-hidden /> Ask questions in plain words</li>
            <li><Check size={13} aria-hidden /> Connect a source only when you are ready</li>
            <li><Check size={13} aria-hidden /> Quality gates decide — you approve</li>
          </ul>
          <div className="ztour-welcome-actions">
            <button type="button" className="ztour-primary" onClick={() => setPhase('steps')}>
              Show me around <ArrowRight size={15} aria-hidden />
            </button>
            <button type="button" className="ztour-ghost" onClick={() => onClose('skipped')}>Not now</button>
          </div>
          <p className="ztour-foot"><CircleHelp size={13} aria-hidden /> You can start the tour any time from Help.</p>
        </motion.section>
      </div>
    );
  }

  return (
    <>
      <AnimatePresence>
        {rect && (
          <motion.div
            key="spot"
            className="ztour-spot"
            aria-hidden
            initial={reduced ? false : { opacity: 0, ...rect }}
            animate={{ opacity: 1, ...rect }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 28 }}
          >
            <span className="ztour-spot-pulse" />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.section
        role="dialog"
        aria-modal="false"
        aria-labelledby="zevqora-tour-title"
        aria-describedby="zevqora-tour-description"
        className={`ztour-card${rect ? ' is-anchored' : ''}`}
        style={cardPlacement(rect)}
        layout={!reduced}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div className="ztour-head">
          <motion.span key={step.face} initial={reduced ? false : { scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
            <ZevFace expression={step.face ?? 'warm-smile'} size={42} />
          </motion.span>
          <div className="ztour-head-text">
            <p className="ztour-eyebrow">ZEVQORA QUICK TOUR</p>
            <p className="ztour-sub">Learn the app in five steps</p>
          </div>
          <button type="button" aria-label="Close product tour" onClick={() => onClose('paused', index)} className="ztour-x">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="ztour-progress" role="progressbar" aria-valuemin={1} aria-valuemax={PRODUCT_TOUR_STEPS.length} aria-valuenow={index + 1} aria-label="Tour progress">
          {PRODUCT_TOUR_STEPS.map((item, i) => (
            <span key={item.eyebrow} aria-hidden="true">
              <motion.i initial={false} animate={{ scaleX: i <= index ? 1 : 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
            </span>
          ))}
        </div>

        {/* Keyed so each step slides in; the swap itself is immediate (no exit wait). */}
        <motion.div key={index} initial={reduced ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
          <p className="ztour-step">{step.eyebrow}</p>
          <h2 ref={titleRef} tabIndex={-1} id="zevqora-tour-title">{step.title}</h2>
          <p id="zevqora-tour-description" className="ztour-desc">{step.description}</p>
          <Link to={step.path} onClick={() => (last ? onClose('done') : onClose('paused', index + 1))} className="ztour-go">
            {step.action} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </motion.div>

        <div className="ztour-actions">
          <div className="ztour-actions-left">
            <button type="button" onClick={() => onClose('skipped')}>Skip tour</button>
            {!last && <button type="button" onClick={() => onClose('paused', index)}>Resume later</button>}
          </div>
          <div className="ztour-actions-right">
            {index > 0 && (
              <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} className="ztour-ghost">
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </button>
            )}
            <button type="button" onClick={() => (last ? onClose('done') : setIndex((i) => Math.min(PRODUCT_TOUR_STEPS.length - 1, i + 1)))} className="ztour-primary">
              {last ? <><Check size={15} aria-hidden="true" /> Finish</> : <>Next <ArrowRight size={15} aria-hidden="true" /></>}
            </button>
          </div>
        </div>
        <p className="ztour-foot">
          <CircleHelp size={13} aria-hidden="true" />
          Replay or resume this tour any time from Help.
        </p>
      </motion.section>
    </>
  );
}
