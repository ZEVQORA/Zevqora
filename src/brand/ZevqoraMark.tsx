import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { MARK_ASPECT, MARK_PATH, MARK_VIEWBOX, SOFT_BLUE } from './marks';

interface Props {
  /** Rendered height in px. Width follows the locked aspect ratio. */
  height?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

/**
 * The official ZEVQORA Z mark. Exactly one canonical standalone mark exists
 * and it is Soft Blue on every surface; the component exposes no colour prop.
 */
export function ZevqoraMark({ height = 28, className, title, style }: Props) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      height={height}
      width={height * MARK_ASPECT}
      fill={SOFT_BLUE}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn('shrink-0', className)}
      style={style}
    >
      <path d={MARK_PATH} />
    </svg>
  );
}
