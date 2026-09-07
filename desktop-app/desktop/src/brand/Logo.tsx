import type { CSSProperties } from 'react'
import { LOCKUP, MARK_ASPECT, MARK_PATH, MARK_VIEWBOX, SOFT_BLUE, WORDMARK_ASPECT, WORDMARK_PATH, WORDMARK_VIEWBOX } from './marks'

/**
 * The official ZEVQORA Z mark. Exactly one canonical standalone mark exists and
 * it is Soft Blue on every surface; the component exposes no colour prop.
 */
export function ZevqoraMark({ height = 28, className, title, style }: { height?: number; className?: string; title?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      height={height}
      width={height * MARK_ASPECT}
      fill={SOFT_BLUE}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      <path d={MARK_PATH} />
    </svg>
  )
}

/** The ZEVQORA wordmark — fixed geometry, never typeset. `evenodd` is load-bearing. */
export function ZevqoraWordmark({ height = 14, className, title }: { height?: number; className?: string; title?: string }) {
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
      className={className}
      style={{ flexShrink: 0 }}
    >
      <path d={WORDMARK_PATH} />
    </svg>
  )
}

/** The official lockup: Soft Blue mark plus wordmark at measured proportions. */
export function ZevqoraLogo({ size = 24, inverse = false, className }: { size?: number; inverse?: boolean; className?: string }) {
  const wordHeight = size / LOCKUP.markToWordCapHeight
  const gap = size * LOCKUP.gapToMarkHeight
  return (
    <span className={`inline-flex items-center ${className || ''}`} aria-label="ZEVQORA" role="img">
      <ZevqoraMark height={size} />
      <span style={{ marginLeft: gap, color: inverse ? '#F7F8FA' : '#0F1115', display: 'inline-flex' }}>
        <ZevqoraWordmark height={wordHeight} />
      </span>
    </span>
  )
}

/** The branded wait state: the mark breathing (opacity only). No spinner. */
export function BrandLoader({ label = 'Loading', size = 28, className }: { label?: string; size?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center ${className || ''}`}>
      <ZevqoraMark height={size} className="mark-pulse" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
