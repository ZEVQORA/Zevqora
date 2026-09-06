import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'plane' | 'glass' | 'glass-strong' | 'sunken' | 'flat' | 'ink';

const tones: Record<Tone, string> = {
  plane: 'plane rounded-lg border border-line/70',
  glass: 'glass rounded-lg',
  'glass-strong': 'glass-strong rounded-lg',
  sunken: 'rounded-lg border border-line bg-sunken',
  flat: 'rounded-lg border border-line bg-surface',
  ink: 'rounded-lg bg-brand-ink text-[#F7F8FA]',
};

export function Panel({ tone = 'plane', className, children, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone; children: ReactNode }) {
  return (
    <div className={cn(tones[tone], className)} data-surface={tone === 'ink' ? 'ink' : undefined} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, description, action, eyebrow, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow mb-1 uppercase text-subtle">{eyebrow}</p>}
        <h3 className="text-h4 text-ink">{title}</h3>
        {description && <p className="text-caption mt-1 text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-eyebrow uppercase text-muted', className)}>{children}</p>;
}

export function PageHeader({ title, description, actions, eyebrow, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="text-h2 text-ink">{title}</h1>
        {description && <p className="text-body mt-2 max-w-[62ch] text-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KeyValue({ items, className, mono = true }: { items: Array<{ k: ReactNode; v: ReactNode }>; className?: string; mono?: boolean }) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(7rem,38%)_1fr] items-baseline gap-3 py-2.5">
          <dt className="text-technical uppercase tracking-wide text-subtle">{it.k}</dt>
          <dd className={cn('text-caption min-w-0 break-words text-ink', mono && 'font-mono text-technical tnum')}>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
