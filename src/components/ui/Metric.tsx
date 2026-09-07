import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

/** A number that eases from its previous value to the next. Formatting stays external. */
export function NumberTicker({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.7,
      ease: [0.2, 0, 0, 1],
      onUpdate: (v) => setDisplay(v),
      onComplete: () => {
        prev.current = value;
      },
    });
    return () => controls.stop();
  }, [value, reduced]);
  return <span className={cn('tnum', className)}>{format(display)}</span>;
}

export function Metric({
  label,
  value,
  format,
  hint,
  tone = 'default',
  icon,
  className,
  size = 'md',
  children,
  raw,
}: {
  label: ReactNode;
  value?: number | null;
  raw?: ReactNode;
  format?: (v: number) => string;
  hint?: ReactNode;
  tone?: 'default' | 'verified' | 'accent' | 'warning' | 'muted';
  icon?: ReactNode;
  className?: string;
  size?: 'md' | 'lg';
  children?: ReactNode;
}) {
  const color = tone === 'verified' ? 'text-verified' : tone === 'accent' ? 'text-accent-text' : tone === 'warning' ? 'text-warning' : tone === 'muted' ? 'text-muted' : 'text-ink';
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-eyebrow uppercase text-subtle">{label}</span>
        {icon && <span className="text-subtle">{icon}</span>}
      </div>
      <div className={cn(size === 'lg' ? 'text-[2.5rem] leading-none tracking-[-0.035em] font-semibold' : 'text-metric', color)}>
        {raw !== undefined ? raw : value === null || value === undefined ? <span className="text-muted">—</span> : <NumberTicker value={value} format={format || ((v) => String(Math.round(v)))} />}
      </div>
      {hint && <div className="text-technical text-subtle">{hint}</div>}
      {children}
    </div>
  );
}
