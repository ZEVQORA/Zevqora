import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { MARK_PATH, MARK_VIEWBOX } from './marks';

/**
 * The official Z mark as a dimensional object.
 *
 * The geometry is the locked MARK_PATH, unchanged. Depth comes from stacking
 * the same path along Z (an extrusion), a lit top face whose highlight follows
 * the pointer, a rim of light along the upper edge, and a contact shadow that
 * moves against the light. Pointer influence is spring-damped and capped at
 * about 8 degrees; when the pointer leaves, the object settles.
 *
 * Reduced motion and coarse pointers get the same lit object, still.
 */
const DEPTH_LAYERS = 16;
const LAYER_STEP = 1.35;
const MAX_TILT = 8;

export function HeroMark3D({ size = 300, interactive = true }: { size?: number; interactive?: boolean }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const spring = { stiffness: 110, damping: 16, mass: 0.7 };
  const sx = useSpring(px, spring);
  const sy = useSpring(py, spring);

  const rotateY = useTransform(sx, (v) => v * MAX_TILT);
  const rotateX = useTransform(sy, (v) => -v * (MAX_TILT - 1));
  const shadowX = useTransform(sx, (v) => -v * 18);
  const shadowY = useTransform(sy, (v) => 14 - v * 10);
  const shadowOpacity = useTransform(sy, (v) => 0.28 + v * 0.06);

  useEffect(() => {
    if (!interactive || reduced) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    setEnabled(true);
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = ref.current;
        if (!el) return;
        const b = el.getBoundingClientRect();
        const dx = (e.clientX - (b.left + b.width / 2)) / Math.max(320, window.innerWidth * 0.55);
        const dy = (e.clientY - (b.top + b.height / 2)) / Math.max(320, window.innerHeight * 0.6);
        px.set(Math.max(-1, Math.min(1, dx)));
        py.set(Math.max(-1, Math.min(1, dy)));
      });
    };
    const onLeave = () => {
      px.set(0);
      py.set(0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [interactive, reduced, px, py]);

  // The highlight is an SVG gradient; its centre is updated directly, no re-render.
  const glowRef = useRef<SVGRadialGradientElement>(null);
  const rimRef = useRef<SVGLinearGradientElement>(null);
  useMotionValueEvent(sx, 'change', (v) => {
    glowRef.current?.setAttribute('cx', `${38 + v * 22}%`);
    rimRef.current?.setAttribute('x1', `${30 + v * 30}%`);
  });
  useMotionValueEvent(sy, 'change', (v) => {
    glowRef.current?.setAttribute('cy', `${26 + v * 20}%`);
    rimRef.current?.setAttribute('y1', `${-10 + v * 30}%`);
  });

  const layers = useMemo(() => Array.from({ length: DEPTH_LAYERS }, (_, i) => i + 1), []);
  const width = size * (87.05 / 100);

  return (
    <div ref={ref} className="relative isolate" style={{ width, height: size, perspective: 1200 }} aria-hidden data-interactive={enabled ? 'true' : 'false'}>
      {/* Contact shadow moves against the light. */}
      <motion.div
        className="absolute left-1/2 top-1/2 -z-10"
        style={{ width: width * 1.05, height: size * 1.05, x: '-50%', y: '-50%', translateX: shadowX, translateY: shadowY, opacity: shadowOpacity, filter: 'blur(22px)' }}
      >
        <svg viewBox={MARK_VIEWBOX} width="100%" height="100%">
          <path d={MARK_PATH} fill="#1f3f7a" />
        </svg>
      </motion.div>

      <motion.div className="preserve-3d relative h-full w-full" style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}>
        {/* Extrusion: the same path stacked along Z. */}
        {layers.map((i) => (
          <svg key={i} viewBox={MARK_VIEWBOX} className="absolute inset-0 backface-hidden" width="100%" height="100%" style={{ transform: `translateZ(${-i * LAYER_STEP}px)` }}>
            <path d={MARK_PATH} fill={`url(#${id}-side)`} />
          </svg>
        ))}

        {/* Top face: base material, frosted highlight, inner shading and rim light. */}
        <svg viewBox={MARK_VIEWBOX} className="absolute inset-0" width="100%" height="100%" style={{ transform: 'translateZ(0.6px)' }}>
          <defs>
            <linearGradient id={`${id}-side`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3673e0" />
              <stop offset="1" stopColor="#1e4aa0" />
            </linearGradient>
            <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7cb0ff" />
              <stop offset="0.45" stopColor="#468BFF" />
              <stop offset="1" stopColor="#3a7bf0" />
            </linearGradient>
            <radialGradient id={`${id}-glow`} ref={glowRef} cx="38%" cy="26%" r="55%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.72" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.14" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-rim`} ref={rimRef} x1="30%" y1="-10%" x2="70%" y2="110%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.15" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0f1115" stopOpacity="0" />
              <stop offset="1" stopColor="#0f1115" stopOpacity="0.16" />
            </linearGradient>
            <clipPath id={`${id}-clip`}>
              <path d={MARK_PATH} />
            </clipPath>
            <filter id={`${id}-frost`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="0.9" />
            </filter>
          </defs>
          <path d={MARK_PATH} fill={`url(#${id}-face)`} />
          <path d={MARK_PATH} fill={`url(#${id}-shade)`} />
          <g clipPath={`url(#${id}-clip)`}>
            <path d={MARK_PATH} fill={`url(#${id}-glow)`} filter={`url(#${id}-frost)`} />
          </g>
          <path d={MARK_PATH} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
        </svg>
      </motion.div>
    </div>
  );
}

/** Small static dimensional mark for cards and mobile fallbacks. */
export function StaticMark3D({ size = 96 }: { size?: number }) {
  return <HeroMark3D size={size} interactive={false} />;
}
