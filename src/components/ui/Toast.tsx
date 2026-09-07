import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

const Ctx = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
          <AnimatePresence>
            {items.map((t) => (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="glass-pop pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3">
                <span className={cn('mt-0.5 shrink-0', t.tone === 'success' ? 'text-verified' : t.tone === 'error' ? 'text-rejected' : 'text-accent-text')}>
                  {t.tone === 'success' ? <Check size={16} /> : t.tone === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-caption font-medium text-ink">{t.title}</p>
                  {t.description && <p className="text-technical mt-0.5 text-muted">{t.description}</p>}
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-subtle hover:text-ink">
                  <X size={14} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.push;
}
