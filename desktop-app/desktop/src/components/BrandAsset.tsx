import { useEffect, useState } from 'react'

export const brandAssets = {
  mark: ['/brand/zevqora-mark.png'],
  wordmark: ['/brand/zevqora-wordmark.png'],
  lockup: ['/brand/zevqora-lockup-light.png'],
  mascot: ['/brand/zev-mascot.png'],
  avatar: ['/brand/zev-avatar.png', '/brand/zev-mascot.png'],
} as const

export function BrandAsset({
  src,
  alt,
  className = '',
  compact = false,
}: {
  src: readonly string[] | string
  alt: string
  className?: string
  compact?: boolean
}) {
  const sources = Array.isArray(src) ? src : [src]
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setIndex(0); setFailed(false) }, [sources.join('|')])
  if (failed || !sources[index]) {
    return <div className={`brand-asset-missing ${className}`} aria-label={`${alt} missing`}>{compact ? 'Z' : 'ZEVQORA'}</div>
  }
  return <img src={sources[index]} alt={alt} className={className} onError={() => index < sources.length - 1 ? setIndex((current) => current + 1) : setFailed(true)} draggable={false} />
}
