import { useEffect, useRef } from "react";
import { MARK_PATH } from "./marks";

/** Canvas-native film using the unmodified canonical mark. */
export function CinematicField({
  stage = 0,
  playing = true,
  onStage,
  className = "",
}: {
  stage?: number;
  playing?: boolean;
  onStage?: (stage: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ stage, playing, onStage });
  useEffect(() => {
    stateRef.current = { stage, playing, onStage };
  }, [stage, playing, onStage]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const path = new Path2D(MARK_PATH);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1,
      height = 1,
      frame = 0,
      visible = true,
      elapsed = 0,
      last = 0,
      drawn = -1,
      lastStage = -1,
      wasPlaying = stateRef.current.playing;
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 1.75);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawn = -1;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { rootMargin: "100px" },
    );
    io.observe(canvas);
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / width - 0.5;
      pointer.y = (event.clientY - rect.top) / height - 0.5;
    };
    const reset = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", reset);
    function render(now: number) {
      frame = requestAnimationFrame(render);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible || document.hidden) return;
      const current = stateRef.current,
        animated = current.playing && !reduced.matches;
      if (current.playing && !wasPlaying)
        elapsed = Math.floor(elapsed / 20) * 20 + current.stage * 5;
      wasPlaying = current.playing;
      if (animated) elapsed += dt;
      const filmStage = animated ? Math.floor(elapsed / 5) % 4 : current.stage;
      if (filmStage !== lastStage) {
        lastStage = filmStage;
        if (animated) current.onStage?.(filmStage);
      }
      if (
        !animated &&
        drawn === current.stage &&
        Math.abs(pointer.sx - pointer.x) < 0.002 &&
        Math.abs(pointer.sy - pointer.y) < 0.002
      )
        return;
      if (animated && Math.round(now / 33) === drawn) return;
      drawn = animated ? Math.round(now / 33) : current.stage;
      pointer.sx += (pointer.x - pointer.sx) * 0.04;
      pointer.sy += (pointer.y - pointer.sy) * 0.04;
      const w = width,
        h = height,
        t = reduced.matches ? 2.5 : elapsed;
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = "#0f1115";
      ctx!.fillRect(0, 0, w, h);
      const cx = w * (w < 700 ? 0.56 : 0.745) + pointer.sx * 22,
        cy = h * (w < 700 ? 0.74 : 0.46) + pointer.sy * 16;
      const glow = ctx!.createRadialGradient(cx, cy, 0, cx, cy, h * 0.9);
      glow.addColorStop(0, "#17386b");
      glow.addColorStop(0.43, "#11223e");
      glow.addColorStop(1, "#0f1115");
      ctx!.fillStyle = glow;
      ctx!.fillRect(0, 0, w, h);
      const strands = filmStage === 3 ? 36 : filmStage === 1 ? 80 : 64;
      for (let row = 0; row < strands; row++) {
        const v = row / strands;
        ctx!.beginPath();
        for (let col = 0; col <= 72; col++) {
          const u = col / 72,
            x = w * (-0.05 + u * 1.18),
            envelope = Math.sin(u * Math.PI) ** 2;
          const wave =
            Math.sin(u * 5.1 + v * 4.2 + t * 0.22) * h * 0.14 +
            Math.cos(u * 8 - v * 2.2 + t * 0.14) * h * 0.06;
          const y =
            h * (0.54 + v * 0.6) +
            wave * envelope -
            Math.sin(u * Math.PI * 0.8) * h * 0.22;
          if (col === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.strokeStyle = `rgba(70,139,255,${0.035 + 0.12 * Math.sin(v * Math.PI)})`;
        ctx!.lineWidth = row % 9 === 0 ? 1 : 0.55;
        ctx!.stroke();
      }
      const size = Math.min(
          w * (w < 700 ? 0.55 : 0.29),
          h * (w < 700 ? 0.33 : 0.59),
        ),
        scale = size / 100;
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.transform(0.98, -0.13, 0.15, 1, 0, 0);
      ctx!.scale(scale, scale);
      ctx!.translate(-43.5, -50);
      ctx!.shadowColor = "rgba(70,139,255,.22)";
      ctx!.shadowBlur = 24;
      for (let layer = 38; layer >= 0; layer--) {
        ctx!.save();
        ctx!.translate(layer * 0.43, layer * 0.46);
        ctx!.fillStyle = `hsl(218 78% ${16 + (38 - layer) * 0.65}%)`;
        ctx!.fill(path);
        if (layer % 3 === 0) {
          ctx!.strokeStyle = "rgba(118,174,255,.19)";
          ctx!.lineWidth = 0.13;
          ctx!.stroke(path);
        }
        ctx!.restore();
        ctx!.shadowBlur = 0;
      }
      ctx!.shadowBlur = 0;
      const face = ctx!.createLinearGradient(0, 0, 85, 100);
      face.addColorStop(0, "#a2c9ff");
      face.addColorStop(0.22, "#468bff");
      face.addColorStop(0.57, "#367be9");
      face.addColorStop(1, "#6caaff");
      ctx!.fillStyle = face;
      ctx!.fill(path);
      ctx!.strokeStyle = "rgba(195,222,255,.74)";
      ctx!.lineWidth = 0.27;
      ctx!.stroke(path);
      ctx!.save();
      ctx!.clip(path);
      const beamY = ((t * 12) % 180) - 40,
        beam = ctx!.createLinearGradient(0, beamY - 20, 0, beamY + 20);
      beam.addColorStop(0, "rgba(230,245,255,0)");
      beam.addColorStop(0.5, "rgba(230,245,255,.32)");
      beam.addColorStop(1, "rgba(230,245,255,0)");
      ctx!.fillStyle = beam;
      ctx!.fillRect(0, 0, 90, 100);
      if (filmStage === 2) {
        ctx!.fillStyle = "rgba(218,236,255,.22)";
        ctx!.fillRect(((t * 8) % 110) - 10, 0, 0.6, 100);
      }
      for (let y = 0; y < 100; y += 0.8) {
        ctx!.fillStyle = "rgba(6,37,85,.1)";
        ctx!.fillRect(0, y, 90, 0.1);
      }
      ctx!.restore();
      ctx!.restore();
      for (let i = 0; i < 22; i++) {
        const p = (i / 22 + t * 0.027) % 1,
          x = w * (0.36 + p * 0.7),
          y = h * (0.58 + (i % 7) * 0.054) - Math.sin(p * Math.PI) * h * 0.17;
        ctx!.fillStyle = `rgba(126,180,255,${0.12 + Math.sin(p * Math.PI) * 0.4})`;
        ctx!.fillRect(x, y, filmStage > 1 ? 2 : 7, 1);
      }
      const fade =
        w < 700
          ? ctx!.createLinearGradient(0, 0, 0, h)
          : ctx!.createLinearGradient(0, 0, w, 0);
      fade.addColorStop(0, "#0f1115");
      fade.addColorStop(w < 700 ? 0.34 : 0.32, "rgba(15,17,21,.88)");
      fade.addColorStop(w < 700 ? 0.66 : 0.58, "rgba(15,17,21,0)");
      ctx!.fillStyle = fade;
      ctx!.fillRect(0, 0, w, h);
    }
    resize();
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", reset);
    };
  }, []);
  return (
    <canvas
      className={`cinematic-field ${className}`}
      ref={canvasRef}
      aria-hidden="true"
    />
  );
}
