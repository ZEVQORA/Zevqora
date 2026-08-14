import { BrandAsset, brandAssets } from './BrandAsset'

export type ZevState = 'idle' | 'thinking' | 'scanning' | 'experimenting' | 'verifying' | 'done'

const labels: Record<ZevState, string> = {
  idle: 'Ready when you are',
  thinking: 'Thinking with context',
  scanning: 'Mapping AI work',
  experimenting: 'Building a candidate',
  verifying: 'Checking the evidence',
  done: 'Evidence updated',
}

export function ZevPresence({ state }: { state: ZevState }) {
  return (
    <div className={`zev-presence zev-presence-${state}`} aria-live="polite">
      <div className="zev-presence-track">
        <div className="zev-presence-glow" />
        <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="zev-presence-mascot" />
        {(state !== 'idle') && <span className="zev-presence-bubble">{labels[state]}</span>}
      </div>
    </div>
  )
}
