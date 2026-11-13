import { useEffect, useId, useRef } from 'react';
import { MARK_ASPECT, MARK_PATH, MARK_VIEWBOX } from './marks';

/**
 * The canonical Z mark as a dimensional object, in CSS 3D + SVG.
 *
 * Geometry is the locked MARK_PATH, unchanged: depth is the same path stacked
 * along Z (an extrusion) under a lit front face. No WebGL — a few composited
 * layers are enough for one object and keep the first paint cheap.
 *
 * Motion rules
 *  - Fine pointer: the object leans toward the cursor, at most MAX_Y / MAX_X
 *    degrees, through a damped spring. It returns to rest when the pointer
 *    leaves the window, the window blurs, or the pointer is idle.
 *  - Touch: only a drag that starts on the mark tilts it, and only until the
 *    browser takes the gesture for scrolling (pointercancel). `touch-action:
 *    pan-y` keeps vertical scroll native; nothing calls preventDefault.
 *  - The loop runs only while the object is on screen, the tab is visible and
 *    the spring has not settled. Offscreen or hidden, nothing ticks.
 *  - prefers-reduced-motion: a still, lit object at a fixed three-quarter
 *    angle, and no listeners at all.
 */
const LAYERS = 18;
const STEP = 1.6; // px between extrusion layers at size 100
const MAX_Y = 16;
const MAX_X = 11;
const REST = { x: 7, y: -14 }; // a resting three-quarter view that shows the depth
const IDLE_MS = 2600;

type Vec = { x: number; y: number };

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function finePointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

export function DimensionalZ({ size = 320, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const glow = useRef<SVGRadialGradientElement>(null);
  const shadow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const obj = body.current;
    if (!el || !obj) return;

    const apply = (r: Vec) => {
      obj.style.transform = `rotateX(${r.x.toFixed(2)}deg) rotateY(${r.y.toFixed(2)}deg)`;
      // The highlight slides with the light; the shadow moves against it.
      const nx = (r.y - REST.y) / MAX_Y;
      const ny = (r.x - REST.x) / MAX_X;
      glow.current?.setAttribute('cx', `${(36 + nx * 20).toFixed(1)}%`);
      glow.current?.setAttribute('cy', `${(24 - ny * 16).toFixed(1)}%`);
      if (shadow.current) shadow.current.style.transform = `translate(${(-nx * 18).toFixed(1)}px, ${(ny * 10).toFixed(1)}px)`;
    };

    if (prefersReducedMotion()) {
      el.dataset.motion = 'static';
      apply(REST);
      return;
    }
    el.dataset.motion = 'live';

    const current: Vec = { ...REST };
    const velocity: Vec = { x: 0, y: 0 };
    const target: Vec = { ...REST };
    let frame = 0;
    let last = 0;
    let onScreen = true;
    let visible = !document.hidden;
    let idleTimer = 0;

    const settled = () =>
      Math.abs(target.x - current.x) < 0.02 && Math.abs(target.y - current.y) < 0.02 && Math.abs(velocity.x) < 0.02 && Math.abs(velocity.y) < 0.02;

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      // Critically-damped-ish spring: stiff enough to feel attached, never overshoots far.
      const k = 70;
      const c = 15;
      velocity.x += (k * (target.x - current.x) - c * velocity.x) * dt;
      velocity.y += (k * (target.y - current.y) - c * velocity.y) * dt;
      current.x += velocity.x * dt;
      current.y += velocity.y * dt;
      apply(current);
      if (settled()) {
        Object.assign(current, target);
        velocity.x = velocity.y = 0;
        apply(current);
        last = 0;
        return;
      }
      schedule();
    };
    const schedule = () => {
      if (!frame && onScreen && visible) frame = requestAnimationFrame(tick);
    };
    const aim = (x: number, y: number) => {
      target.x = REST.x + Math.max(-1, Math.min(1, y)) * -MAX_X;
      target.y = REST.y + Math.max(-1, Math.min(1, x)) * MAX_Y;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(rest, IDLE_MS);
      schedule();
    };
    const rest = () => {
      target.x = REST.x;
      target.y = REST.y;
      schedule();
    };

    // Fine pointer: lean toward the cursor anywhere in the window, bounded.
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      if (!onScreen) return;
      const b = el.getBoundingClientRect();
      const dx = (e.clientX - (b.left + b.width / 2)) / Math.max(360, window.innerWidth * 0.5);
      const dy = (e.clientY - (b.top + b.height / 2)) / Math.max(320, window.innerHeight * 0.55);
      aim(dx, dy);
    };

    // Touch: a drag that starts on the mark tilts it gently until scroll takes over.
    let touchStart: Vec | null = null;
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchStart = { x: e.clientX, y: e.clientY };
    };
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touchStart) return;
      aim(((e.clientX - touchStart.x) / 160) * 0.6, ((e.clientY - touchStart.y) / 160) * 0.6);
    };
    const onTouchEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchStart = null;
      rest();
    };

    const onVisibility = () => {
      visible = !document.hidden;
      if (!visible) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
      } else schedule();
    };

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        if (!onScreen) {
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          last = 0;
          // Snap back to rest while nobody can see it, so it returns composed.
          Object.assign(current, REST);
          Object.assign(target, REST);
          velocity.x = velocity.y = 0;
          apply(current);
        }
      });
      io.observe(el);
    }

    apply(current);
    if (finePointer()) window.addEventListener('pointermove', onPointerMove, { passive: true });
    el.addEventListener('pointerdown', onTouchDown, { passive: true });
    el.addEventListener('pointermove', onTouchMove, { passive: true });
    el.addEventListener('pointerup', onTouchEnd, { passive: true });
    el.addEventListener('pointercancel', onTouchEnd, { passive: true });
    document.documentElement.addEventListener('pointerleave', rest);
    window.addEventListener('blur', rest);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer);
      io?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerdown', onTouchDown);
      el.removeEventListener('pointermove', onTouchMove);
      el.removeEventListener('pointerup', onTouchEnd);
      el.removeEventListener('pointercancel', onTouchEnd);
      document.documentElement.removeEventListener('pointerleave', rest);
      window.removeEventListener('blur', rest);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const width = size * MARK_ASPECT;
  const step = (STEP * size) / 100;
  return (
    <div
      ref={root}
      className={['zev-dimensional', className].filter(Boolean).join(' ')}
      style={{ width, height: size, perspective: size * 4.2 }}
      aria-hidden
      data-motion="pending"
    >
      <div ref={shadow} className="zev-dimensional-shadow">
        <svg viewBox={MARK_VIEWBOX} width="100%" height="100%" focusable="false">
          <path d={MARK_PATH} fill="#1b4fae" />
        </svg>
      </div>
      <div
        ref={body}
        className="zev-dimensional-body"
        style={{ transform: `rotateX(${REST.x}deg) rotateY(${REST.y}deg)` }}
      >
        {Array.from({ length: LAYERS }, (_, i) => (
          <svg
            key={i}
            viewBox={MARK_VIEWBOX}
            width="100%"
            height="100%"
            focusable="false"
            className="zev-dimensional-layer"
            style={{ transform: `translateZ(${(-(i + 1) * step).toFixed(2)}px)` }}
          >
            <path d={MARK_PATH} fill={i === LAYERS - 1 ? '#173f8f' : `url(#${id}-side)`} />
          </svg>
        ))}
        <svg viewBox={MARK_VIEWBOX} width="100%" height="100%" focusable="false" className="zev-dimensional-layer zev-dimensional-face">
          <defs>
            <linearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#3b78e6" />
              <stop offset="1" stopColor="#1f4fae" />
            </linearGradient>
            <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#82b4ff" />
              <stop offset="0.42" stopColor="#468BFF" />
              <stop offset="1" stopColor="#3a7bf0" />
            </linearGradient>
            <radialGradient id={`${id}-glow`} ref={glow} cx="36%" cy="24%" r="58%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.6" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-rim`} x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="0.4" stopColor="#ffffff" stopOpacity="0.12" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={MARK_PATH} fill={`url(#${id}-face)`} />
          <path d={MARK_PATH} fill={`url(#${id}-glow)`} />
          <path d={MARK_PATH} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
}
