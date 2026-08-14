import { useEffect, useMemo, useState } from 'react'

const brandPath = (file: string) => `${import.meta.env.BASE_URL || './'}brand/${file}`

export const brandAssets = {
  mark: [brandPath('zevqora-mark.png')],
  wordmark: [brandPath('zevqora-wordmark.png')],
  lockup: [brandPath('zevqora-lockup-light.png')],
  mascot: [brandPath('zev-mascot.png')],
  avatar: [brandPath('zev-avatar.png'), brandPath('zev-mascot.png')],
  workspace: [brandPath('living-workspace-light.png')],
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
  const sources = useMemo(() => (Array.isArray(src) ? [...src] : [src]), [src])
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setIndex(0)
    setFailed(false)
  }, [sources.join('|')])

  if (failed || !sources[index]) {
    return (
      <div className={`brand-asset-missing ${className}`} aria-label={`${alt} unavailable`}>
        {compact ? 'Z' : 'ZEVQORA'}
      </div>
    )
  }

  return (
    <img
      src={sources[index]}
      alt={alt}
      className={className}
      onError={() => {
        if (index < sources.length - 1) setIndex((current) => current + 1)
        else setFailed(true)
      }}
      draggable={false}
    />
  )
}
