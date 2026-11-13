import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, Check, CircleHelp, X } from 'lucide-react';
import { ZevFace } from '@/brand/Zev';

export interface TourStep {
  title: string;
  description: string;
  eyebrow: string;
  path: string;
  action: string;
}

/**
 * This tour explains existing, supported product paths only. It does not
 * claim enabled ZevIR/vNext flags, ready provider connections or verified
 * savings. The first-evidence setup wizard remains available separately.
 */
export const PRODUCT_TOUR_STEPS: readonly TourStep[] = [
  {
    eyebrow: '01 / YOUR COMMAND CENTER',
    title: 'Start with the whole picture.',
    description:
      'Your Command Center separates observed activity, experimental results and decisions needing your review. Empty metrics mean evidence has not been recorded yet.',
    path: '/app',
    action: 'Open Command Center',
  },
  {
    eyebrow: '02 / FIRST WORKLOAD',
    title: 'Choose one task to improve.',
    description:
      'A workload is one application, repository or recorded AI workflow. New here? Guided setup helps choose a workspace and define an evaluation boundary.',
    path: '/app/onboarding',
    action: 'Start guided setup',
  },
  {
    eyebrow: '03 / EVIDENCE',
    title: 'Connect evidence you are allowed to share.',
    description:
      'Scan a repository locally or import a sanitized JSON/JSONL trace. Review what leaves your device first. A connector card is not proof of an active integration.',
    path: '/app/connections',
    action: 'See evidence sources',
  },
  {
    eyebrow: '04 / VERIFY THE OUTCOME',
    title: 'Understand every verdict.',
    description:
      'VERIFIED means the required gates passed. REJECTED means a candidate failed. INCOMPLETE means there is not enough evidence. Never treat a projected saving as realized value.',
    path: '/app/evidence',
    action: 'Explore evidence',
  },
  {
    eyebrow: '05 / ENGINEERING ZEV',
    title: 'Ask about your actual workload.',
    description:
      'Engineering Zev can explain authorized evidence and recorded decisions. Its provider may be unavailable until configured, and AI explanations never override the verification engine.',
    path: '/app/zev',
    action: 'Open Engineering Zev',
  },
];

export const productTourStorageKey = (userId: string, workspaceId: string) =>
  `zevqora.productTour.v1:${userId}:${workspaceId}`;

export function ProductTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open, index]);

  if (!open) return null;
  const step = PRODUCT_TOUR_STEPS[index];
  const last = index === PRODUCT_TOUR_STEPS.length - 1;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="zevqora-tour-title"
      aria-describedby="zevqora-tour-description"
      className="fixed right-3 z-[85] max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[430px] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-[0_20px_70px_rgba(15,17,21,.22)] sm:right-5 sm:p-6"
      style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ZevFace expression="warm-smile" size={40} />
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[.11em] text-accent-text">ZEVQORA QUICK TOUR</p>
            <p className="mt-1 text-[12px] text-muted">Learn the app in five steps</p>
          </div>
        </div>
        <button type="button" aria-label="Close product tour" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-5 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={PRODUCT_TOUR_STEPS.length} aria-valuenow={index + 1} aria-label="Tour progress">
        {PRODUCT_TOUR_STEPS.map((item, i) => (
          <span key={item.eyebrow} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-accent' : 'bg-sunken'}`} aria-hidden="true" />
        ))}
      </div>

      <div className="mt-6">
        <p className="font-mono text-[10px] font-semibold tracking-[.1em] text-accent-text">{step.eyebrow}</p>
        <h2 ref={titleRef} tabIndex={-1} id="zevqora-tour-title" className="mt-2 text-[26px] font-semibold leading-[1.18] tracking-[-.035em] outline-none">{step.title}</h2>
        <p id="zevqora-tour-description" className="mt-3 text-[13px] leading-[1.7] text-muted">{step.description}</p>
        <Link
          to={step.path}
          onClick={onClose}
          className="mt-5 inline-flex min-h-10 items-center gap-2 text-[13px] font-semibold text-accent-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {step.action} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <button type="button" onClick={onClose} className="min-h-10 px-1 text-[12px] font-medium text-muted hover:text-ink">Skip tour</button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-line px-3 text-[12px] font-semibold hover:bg-sunken">
              <ArrowLeft size={14} aria-hidden="true" /> Back
            </button>
          )}
          <button
            type="button"
            onClick={() => last ? onClose() : setIndex((i) => Math.min(PRODUCT_TOUR_STEPS.length - 1, i + 1))}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-4 text-[12px] font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {last ? <><Check size={15} aria-hidden="true" /> Finish</> : <>Next <ArrowRight size={15} aria-hidden="true" /></>}
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-subtle">
        <CircleHelp size={13} aria-hidden="true" />
        You can replay this tour from the Help button.
      </div>
    </section>
  );
}
