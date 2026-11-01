import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Tooltip on hover and keyboard focus. Supplementary only: anything a
 * tooltip says must also be reachable without it.
 */
export function Tooltip({ content, children, className, side = 'top' }: { content: ReactNode; children: ReactNode; className?: string; side?: 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={cn('relative inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} aria-describedby={open ? id : undefined}>
      {children}
      {open && (
        <span role="tooltip" id={id} className={cn('pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-md bg-brand-ink px-2.5 py-1.5 text-[11.5px] leading-snug text-[#F7F8FA] shadow-lg', side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]')}>
          {content}
        </span>
      )}
    </span>
  );
}

function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, ref]);
}

/** Click-to-open panel anchored to its trigger; Escape and outside clicks close it. */
export function Popover({ trigger, children, className, align = 'end', label }: { trigger: (props: { open: boolean; toggle: () => void; 'aria-expanded': boolean; 'aria-controls': string }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); className?: string; align?: 'start' | 'end'; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-controls': id })}
      {open && (
        <div id={id} role="dialog" aria-label={label} className={cn('glass-pop absolute top-[calc(100%+6px)] z-50 min-w-[220px] rounded-lg p-1.5', align === 'end' ? 'right-0' : 'left-0', className)}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Side sheet (right on desktop, bottom on phones). Focus moves in and is
 * trapped while open, Escape closes, and focus returns to the trigger.
 */
export function Drawer({ open, onClose, title, description, children, footer, width = 440, className }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => (panel.current?.querySelector<HTMLElement>(FOCUSABLE) || panel.current)?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div className="absolute inset-0 bg-ink/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn('absolute bottom-0 right-0 flex max-h-[88dvh] w-full flex-col rounded-t-xl border border-line bg-surface shadow-[var(--shadow-pop)] outline-none sm:inset-y-0 sm:max-h-none sm:rounded-none sm:rounded-l-xl', className)}
            style={{ maxWidth: width }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-h4 text-ink">{title}</h2>
                {description && <p className="text-caption mt-1 text-muted">{description}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-control hover:bg-ink/5 hover:text-ink">
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
