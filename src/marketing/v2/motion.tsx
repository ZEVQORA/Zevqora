import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';

/** House easing: fast out, long soft landing. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Fade, rise and un-blur once, when the element scrolls into view. */
export function Reveal({ children, delay = 0, y = 26, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Headline words that slide up out of a mask, one after another. */
export function Words({ text, delay = 0, stagger = 0.07, inView = false, className }: { text: string; delay?: number; stagger?: number; inView?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const words = text.split(' ');
  const trigger = inView ? { whileInView: 'show' as const, viewport: { once: true, margin: '-8% 0px' } } : { animate: 'show' as const };
  return (
    <span className={className}>
    <span className="sr-only">{text}</span>
    <motion.span initial={reduced ? false : 'hide'} {...trigger} aria-hidden>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="zv-mask">
          <motion.span
            className="zv-mask-in"
            variants={{
              hide: { y: '108%', rotate: 3 },
              show: { y: '0%', rotate: 0, transition: { duration: 1, ease: EASE, delay: delay + i * stagger } },
            }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </motion.span>
    </span>
  );
}

/** A number that counts up the first time it becomes visible. */
export function Count({ to, decimals = 0, suffix = '', prefix = '', duration = 1.6 }: { to: number; decimals?: number; suffix?: string; prefix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const fmt = (v: number) => `${prefix}${v.toFixed(decimals)}${suffix}`;
  useEffect(() => {
    if (!seen || !ref.current) return;
    if (reduced) {
      ref.current.textContent = fmt(to);
      return;
    }
    const c = animate(0, to, { duration, ease: EASE, onUpdate: (v) => ref.current && (ref.current.textContent = fmt(v)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, to, reduced]);
  return (
    <span ref={ref} className="tabular-nums">
      {fmt(reduced ? to : 0)}
    </span>
  );
}

/** Drifts its child toward the pointer — used on primary calls to action. */
export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 240, damping: 16, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 240, damping: 16, mass: 0.4 });
  const move = (e: PointerEvent) => {
    if (reduced || e.pointerType !== 'mouse' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  return (
    <motion.span ref={ref} className="zv-magnetic" style={{ x, y }} onPointerMove={move} onPointerLeave={() => (x.set(0), y.set(0))}>
      {children}
    </motion.span>
  );
}

/** Pointer-tracked light for `.zv-spot` cards. */
export function spot(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/** Cycles short lines with a typing caret — Zev's speech bubble. */
export function TypeLines({ lines, className }: { lines: string[]; className?: string }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [txt, setTxt] = useState(reduced ? lines[0] : '');
  const [del, setDel] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const full = lines[i % lines.length];
    const t = window.setTimeout(
      () => {
        if (!del) {
          const n = full.slice(0, txt.length + 1);
          setTxt(n);
          if (n === full) window.setTimeout(() => setDel(true), 2200);
        } else {
          const n = full.slice(0, Math.max(0, txt.length - 2));
          setTxt(n);
          if (!n) {
            setDel(false);
            setI((v) => v + 1);
          }
        }
      },
      del ? 18 : 46,
    );
    return () => window.clearTimeout(t);
  }, [txt, del, i, lines, reduced]);
  return (
    <span className={className} aria-hidden>
      {txt}
      <i className="zv-caret" />
    </span>
  );
}
