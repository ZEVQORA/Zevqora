import { cn } from '@/lib/cn';
import { WORDMARK_ASPECT, WORDMARK_PATH, WORDMARK_VIEWBOX } from './marks';

interface Props {
  /** Cap height in px. Width follows the locked aspect ratio. */
  height?: number;
  className?: string;
  title?: string;
}

/** The ZEVQORA wordmark — fixed geometry, never typeset. `evenodd` is load-bearing. */
export function ZevqoraWordmark({ height = 14, className, title }: Props) {
  return (
    <svg
      viewBox={WORDMARK_VIEWBOX}
      height={height}
      width={height * WORDMARK_ASPECT}
      fill="currentColor"
      fillRule="evenodd"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn('shrink-0', className)}
    >
      <path d={WORDMARK_PATH} />
    </svg>
  );
}
