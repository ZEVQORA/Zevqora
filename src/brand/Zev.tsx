import { cn } from '@/lib/cn';

export type ZevView =
  | 'front'
  | 'three-quarter-front'
  | 'side'
  | 'three-quarter-back'
  | 'back'
  | 'pose-sitting'
  | 'pose-playful'
  | 'pose-thinking'
  | 'pose-waving';

export type ZevExpression = 'warm-smile' | 'delighted' | 'calm-confidence' | 'curious' | 'focused' | 'friendly-idle';

const SPRITES: Record<ZevView, { w: number; h: number }> = {
  front: { w: 245, h: 306 },
  'three-quarter-front': { w: 260, h: 304 },
  side: { w: 270, h: 302 },
  'three-quarter-back': { w: 233, h: 303 },
  back: { w: 230, h: 304 },
  'pose-sitting': { w: 140, h: 167 },
  'pose-playful': { w: 168, h: 145 },
  'pose-thinking': { w: 141, h: 167 },
  'pose-waving': { w: 144, h: 170 },
};

const FACES: Record<ZevExpression, { w: number; h: number }> = {
  'warm-smile': { w: 132, h: 128 },
  delighted: { w: 131, h: 128 },
  'calm-confidence': { w: 131, h: 128 },
  curious: { w: 139, h: 128 },
  focused: { w: 138, h: 128 },
  'friendly-idle': { w: 139, h: 128 },
};

const MAX_RENDER_HEIGHT = 320;

/** A canonical Zev sprite extracted from the brand turnaround — never redrawn, never upscaled past source. */
export function Zev({ view = 'three-quarter-front', height = 240, className, alt }: { view?: ZevView; height?: number; className?: string; alt?: string }) {
  const s = SPRITES[view];
  const h = Math.min(height, MAX_RENDER_HEIGHT);
  const w = Math.round((s.w / s.h) * h);
  return (
    <img
      src={`/assets/zev/zev-${view}.webp`}
      width={w}
      height={h}
      alt={alt ?? ''}
      aria-hidden={alt ? undefined : true}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn('select-none', className)}
    />
  );
}

/** A framed Zev expression plate. */
export function ZevFace({ expression = 'friendly-idle', size = 56, className, alt }: { expression?: ZevExpression; size?: number; className?: string; alt?: string }) {
  const f = FACES[expression];
  return (
    <span className={cn('inline-flex shrink-0 overflow-hidden rounded-full border border-line bg-surface', className)} style={{ width: size, height: size }}>
      <img src={`/assets/zev/zev-face-${expression}.webp`} width={f.w} height={f.h} alt={alt ?? ''} aria-hidden={alt ? undefined : true} className="h-full w-full object-cover" style={{ objectPosition: '50% 38%' }} draggable={false} />
    </span>
  );
}
