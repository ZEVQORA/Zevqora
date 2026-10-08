import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A single-choice control (radiogroup). Arrow keys move and select, Home/End
 * jump, and only the selected option is in the tab order.
 */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>; label: string; className?: string; size?: 'sm' | 'md' }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.filter((o) => !o.disabled);
  const move = (e: KeyboardEvent, index: number) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: (typeof options)[number] | undefined;
    if (e.key in keys) {
      const pos = enabled.findIndex((o) => o.value === options[index].value);
      next = enabled[(pos + keys[e.key] + enabled.length) % enabled.length];
    } else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-sunken p-0.5 no-scrollbar', className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.title}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => move(e, i)}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-control disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-caption',
              active ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_17_21/0.08),inset_0_0_0_1px_rgb(15_17_21/0.04)]' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
