import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Zev, type ZevView } from '@/brand/Zev';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" style-width={`${90 - i * 7}%`} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  zev = 'pose-thinking',
  className,
  compact = false,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  zev?: ZevView | null;
  className?: string;
  compact?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface/60 text-center', compact ? 'px-5 py-8' : 'px-6 py-14', className)}>
      {icon ? <div className="mb-4 text-subtle">{icon}</div> : zev ? <Zev view={zev} height={compact ? 88 : 128} className="mb-4 opacity-95" /> : null}
      <h3 className="text-h4 text-ink">{title}</h3>
      {description && <p className="text-caption mt-2 max-w-[46ch] text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className, compact = false }: { message: string; onRetry?: () => void; className?: string; compact?: boolean }) {
  const offline = /offline/i.test(message);
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center rounded-lg border border-rejected/25 bg-rejected-bg/50 text-center', compact ? 'px-5 py-6' : 'px-6 py-12', className)}>
      {offline ? <WifiOff className="text-rejected" size={22} aria-hidden /> : <AlertTriangle className="text-rejected" size={22} aria-hidden />}
      <p className="text-caption mt-3 max-w-[50ch] text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

export function InlineNotice({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'success' | 'danger'; children: ReactNode; className?: string }) {
  const cls = tone === 'warning' ? 'border-warning/30 bg-warning-bg text-warning' : tone === 'success' ? 'border-verified/30 bg-verified-bg text-verified' : tone === 'danger' ? 'border-rejected/30 bg-rejected-bg text-rejected' : 'border-accent/25 bg-accent-subtle text-accent-text';
  return <div className={cn('text-caption rounded-md border px-3.5 py-2.5', cls, className)}>{children}</div>;
}
