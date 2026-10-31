import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { MessageCircle, X } from 'lucide-react';
import { Zev } from '@/brand/Zev';
import { useSiteContent } from '@/lib/site';
import { PUBLIC_SUPPORT_MODE } from '@/lib/contracts/support';

const FAQ = [
  { title: 'What does ZEVQORA do?', answer: 'ZEVQORA helps teams measure AI execution, inspect expensive paths and replay supported changes against quality gates before a person reviews them.', to: '/product', link: 'Explore the product' },
  { title: 'How does verification work?', answer: 'A candidate is VERIFIED only when all required frozen evaluation gates pass on available evidence. VERIFIED is not deployed, and incomplete coverage is not zero.', to: '/evaluation', link: 'Read the evidence method' },
  { title: 'How do I connect my stack?', answer: 'Start with a supported scoped telemetry, OpenTelemetry, OpenInference or sanitized trace import path. Direct vendor OAuth cannot be assumed.', to: '/technology', link: 'See the technology' },
  { title: 'Pricing and enterprise', answer: 'The pricing page shows published plan information. Enterprise identity, deployment and compliance require a separate discussion and verification.', to: '/pricing', link: 'See pricing' },
  { title: 'Contact the team', answer: 'Use the official contact address below. This help panel is a public FAQ, not a live human or a signed-in workspace agent.', to: '/team', link: 'Meet the team' },
] as const;

/** No network requests, no private data, no impersonation of authenticated Ask Zev. */
export function SupportZevLauncher() {
  const { contact } = useSiteContent();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  // The trigger is unmounted while the panel is open, so focus returns once it has re-rendered.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    trigger.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        returnFocus.current = true;
        setOpen(false);
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const dismiss = () => { returnFocus.current = true; setOpen(false); };
  const entry = selected === null ? null : FAQ[selected];

  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-50 sm:bottom-6 sm:right-6">
      {!open && (
        <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={false} aria-label="Open Ask Zev public support" onClick={() => setOpen(true)}
          className="group relative flex h-16 w-16 items-center justify-center rounded-full border border-[#468BFF]/30 bg-white shadow-[0_12px_40px_rgba(15,17,21,0.2)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#468BFF] motion-reduce:transform-none">
          <Zev view="pose-waving" height={52} alt="" />
          <span className="sr-only">Ask Zev support</span>
          <MessageCircle aria-hidden size={16} className="absolute -right-1 -top-1 rounded-full bg-[#468BFF] p-0.5 text-white" />
        </button>
      )}
      {open && (
        <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-scope`}
          className="flex max-h-[min(610px,calc(100dvh-2rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] border border-[#E6E9EE] bg-white text-[#0F1115] shadow-[0_24px_80px_rgba(15,17,21,0.26)]">
          <header className="flex items-center gap-3 bg-[#0F1115] p-4 text-white">
            <Zev view="pose-waving" height={53} alt="" />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] font-semibold">Ask Zev — ZEVQORA Support</h2>
              <p className="text-[12px] text-white/65">Public FAQ · Not a live agent</p>
            </div>
            <button ref={close} type="button" onClick={dismiss} aria-label="Close support" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#468BFF]"><X size={20} aria-hidden /></button>
          </header>
          <p id={`${titleId}-scope`} className="border-b border-[#E6E9EE] bg-[#F7F8FA] px-5 py-3 text-[13px] leading-relaxed text-[#515761]">Answers public product and setup questions only. No private workspace, billing, traces or account data are accessible here.</p>
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            {entry ? (
              <div className="space-y-4" aria-live="polite">
                <button type="button" className="text-[13px] font-medium text-[#2468dc] underline underline-offset-4" onClick={() => setSelected(null)}>← All questions</button>
                <h3 className="text-[17px] font-semibold leading-snug">{entry.title}</h3>
                <p className="text-[14px] leading-relaxed text-[#515761]">{entry.answer}</p>
                <Link to={entry.to} onClick={dismiss} className="inline-flex min-h-11 items-center rounded-lg font-medium text-[#2468dc] underline underline-offset-4">{entry.link}</Link>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.13em] text-[#7b8390]">How can Zev help?</p>
                <div className="space-y-2">
                  {FAQ.map((f, i) => <button key={f.title} type="button" onClick={() => setSelected(i)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[#E6E9EE] bg-white px-4 py-3 text-left text-[14px] font-medium hover:bg-[#F7F8FA] focus-visible:outline-2 focus-visible:outline-[#468BFF]"><span>{f.title}</span><span aria-hidden className="text-[#468BFF]">↗</span></button>)}
                </div>
              </div>
            )}
          </div>
          <footer className="border-t border-[#E6E9EE] bg-[#F7F8FA] px-5 py-3 text-[12px] leading-relaxed text-[#515761]">
            <span className="font-semibold">{PUBLIC_SUPPORT_MODE === 'public_faq' ? 'FAQ mode' : 'Support'}</span> · Need more help? <a href={`mailto:${contact.email}`} className="font-medium text-[#2468dc] underline underline-offset-4">Contact the team</a>.
          </footer>
        </section>
      )}
    </div>
  );
}
