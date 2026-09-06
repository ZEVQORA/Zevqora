import { cn } from '@/lib/cn';
import { ZevqoraMark } from './ZevqoraMark';

/** The branded wait state: the mark breathing (opacity only). No spinner. */
export function BrandLoader({ delayMs = 240, label = 'Loading', className, size = 30 }: { delayMs?: number; label?: string; className?: string; size?: number }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center', className)} style={{ animation: `zq-loader-in 240ms cubic-bezier(0.2,0,0,1) ${delayMs}ms both` }}>
      <ZevqoraMark height={size} style={{ animation: 'zq-loader-pulse 1600ms ease-in-out infinite' }} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <BrandLoader label={label} />
    </div>
  );
}
