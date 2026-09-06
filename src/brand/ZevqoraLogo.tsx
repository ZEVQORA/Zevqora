import { cn } from '@/lib/cn';
import { LOCKUP } from './marks';
import { ZevqoraMark } from './ZevqoraMark';
import { ZevqoraWordmark } from './ZevqoraWordmark';

interface Props {
  /** `default` for light surfaces, `inverse` for ink surfaces. */
  variant?: 'default' | 'inverse';
  /** Mark height in px; the lockup derives from the locked ratios. */
  size?: number;
  className?: string;
}

/** The official lockup: Soft Blue mark plus wordmark at measured proportions. */
export function ZevqoraLogo({ variant = 'default', size = 28, className }: Props) {
  const wordHeight = size / LOCKUP.markToWordCapHeight;
  const gap = size * LOCKUP.gapToMarkHeight;
  return (
    <span className={cn('inline-flex items-center', className)}>
      <span className="sr-only">ZEVQORA</span>
      <ZevqoraMark height={size} />
      <span style={{ marginLeft: gap }} className={cn('inline-flex', variant === 'inverse' ? 'text-[#F7F8FA]' : 'text-[#0F1115]')}>
        <ZevqoraWordmark height={wordHeight} />
      </span>
    </span>
  );
}
