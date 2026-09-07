import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-surface px-1 font-mono text-[10px] text-muted', className)}>{children}</kbd>;
}

export function CopyButton({ value, label = 'Copy', className, size = 'sm' }: { value: string; label?: string; className?: string; size?: 'sm' | 'xs' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className={cn('inline-flex items-center gap-1.5 rounded-sm border border-line-control bg-surface font-medium text-ink transition-control hover:bg-canvas', size === 'xs' ? 'h-7 px-2 text-technical' : 'h-8 px-2.5 text-caption', className)}
      aria-live="polite"
    >
      {done ? <Check size={13} className="text-verified" aria-hidden /> : <Copy size={13} aria-hidden />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function Code({ children, className, block = false }: { children: ReactNode; className?: string; block?: boolean }) {
  if (block) return <pre className={cn('scrollbar-thin overflow-x-auto rounded-md border border-line bg-sunken px-4 py-3 font-mono text-technical leading-relaxed text-ink', className)}>{children}</pre>;
  return <code className={cn('rounded-xs bg-sunken px-1.5 py-0.5 font-mono text-technical text-ink', className)}>{children}</code>;
}

export function Avatar({ name, src, size = 32, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  const initials = (name || '?')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  return src ? (
    <img src={src} alt="" width={size} height={size} className={cn('shrink-0 rounded-full border border-line object-cover', className)} style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-accent-subtle font-semibold text-accent-text', className)} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }} aria-hidden>
      {initials || '?'}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode; count?: number }>; className?: string }) {
  return (
    <div role="tablist" className={cn('no-scrollbar flex items-center gap-1 overflow-x-auto rounded-md border border-line bg-sunken p-1', className)}>
      {items.map((it) => (
        <button key={it.value} role="tab" type="button" aria-selected={value === it.value} onClick={() => onChange(it.value)} className={cn('text-caption inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 transition-control', value === it.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_17_21/0.08)]' : 'text-muted hover:text-ink')}>
          {it.label}
          {typeof it.count === 'number' && <span className="tnum font-mono text-technical text-subtle">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Table({ children, className, minWidth = 640 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn('scrollbar-thin -mx-1 overflow-x-auto px-1', className)}>
      <table className="w-full border-collapse" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <th className={cn('text-technical border-b border-line py-2.5 pr-4 font-medium uppercase tracking-wide text-subtle', align === 'right' ? 'text-right' : 'text-left', className)}>{children}</th>;
}

export function Td({ children, className, align = 'left', mono = false, colSpan }: { children?: ReactNode; className?: string; align?: 'left' | 'right'; mono?: boolean; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('text-caption border-b border-line py-3 pr-4 align-top text-ink', align === 'right' ? 'text-right' : 'text-left', mono && 'font-mono text-technical tnum', className)}>
      {children}
    </td>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-line', className)} />;
}
