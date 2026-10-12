import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

export function Section({ id, children, className, surface, rule = true }: { id?: string; children: ReactNode; className?: string; surface?: 'ink' | 'sunken'; rule?: boolean }) {
  return (
    <section id={id} data-surface={surface === 'ink' ? 'ink' : undefined} className={cn('py-20 lg:py-28', surface === 'ink' && 'bg-canvas', surface === 'sunken' && 'border-y border-line bg-sunken', rule && !surface && 'border-t border-line', className)}>
      {children}
    </section>
  );
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.56, ease: [0.2, 0, 0, 1], delay }}>
      {children}
    </motion.div>
  );
}
