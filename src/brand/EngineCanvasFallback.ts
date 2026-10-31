/** Realtime optical displacement for browsers without a WebGL context. */
export function startEngineCanvas(
  canvas: HTMLCanvasElement | null,
  state: { current: { playing: boolean; phase: number } },
  invalidate: { current: () => void },
  visual: string,
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  const image = new Image(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 1,
    height = 1,
    frame = 0,
    last = 0,
    lastDraw = 0,
    time = 0,
    visible = true,
    ready = false,
    disposed = false;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  function request() {
    if (!disposed && !frame) {
      last = 0;
      frame = requestAnimationFrame(draw);
    }
  }
  function resize() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 1.35);
    width = r.width;
    height = r.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    request();
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || !ready || !visible || document.hidden || !canvas || !ctx)
      return;
    const animated = state.current.playing && !reduced.matches;
    if (animated && lastDraw && now - lastDraw < 39) {
      frame = requestAnimationFrame(draw);
      return;
    }
    const dt = last ? Math.min((now - last) / 1000, 0.06) : 0;
    last = now;
    lastDraw = now;
    if (animated) time += dt;
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    const t = reduced.matches ? 2 : time,
      zoom = 1.075 + Math.sin(t * 0.13) * 0.012;
    let sw = image.naturalWidth / zoom,
      sh = image.naturalHeight / zoom;
    if (sw / sh > width / height) sw = (sh * width) / height;
    else sh = (sw * height) / width;
    const left =
        (image.naturalWidth - sw) / 2 +
        pointer.sx * sw * 0.025 +
        Math.sin(t * 0.14) * sw * 0.005,
      top = (image.naturalHeight - sh) / 2 + pointer.sy * sh * 0.018;
    ctx.globalCompositeOperation = "source-over";
    const strips = reduced.matches ? 1 : 64;
    for (let row = 0; row < strips; row++) {
      const v = row / strips,
        shift = reduced.matches
          ? 0
          : (Math.sin(v * 8.4 + t * 0.37) * 0.006 +
              Math.sin(v * 21 - t * 0.22) * 0.0015) *
            sw;
      const sourceY =
        top +
        v * sh +
        (reduced.matches ? 0 : Math.sin(v * 6.2 + t * 0.21) * sh * 0.002);
      ctx.drawImage(
        image,
        left + shift,
        sourceY,
        sw,
        sh / strips + 1,
        0,
        (row * height) / strips,
        width,
        height / strips + 1.5,
      );
    }
    // A moving, restrained optical highlight. The original silhouette stays intact.
    if (!reduced.matches) {
      const x = (((t * 0.035) % 1.6) - 0.3) * width,
        gradient = ctx.createLinearGradient(x - 80, 0, x + 80, height);
      gradient.addColorStop(0, "rgba(38,101,255,0)");
      gradient.addColorStop(0.5, "rgba(77,148,255,.04)");
      gradient.addColorStop(1, "rgba(38,101,255,0)");
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
    }
    canvas.style.opacity = "1";
    if (animated) frame = requestAnimationFrame(draw);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) request();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });
  io.observe(canvas);
  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else request();
  };
  const move = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left) / r.width - 0.5;
    pointer.y = (e.clientY - r.top) / r.height - 0.5;
    request();
  };
  const leave = () => {
    pointer.x = 0;
    pointer.y = 0;
    request();
  };
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  reduced.addEventListener("change", request);
  image.onload = () => {
    ready = true;
    request();
  };
  image.src = visual;
  invalidate.current = request;
  resize();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
    reduced.removeEventListener("change", request);
    image.onload = null;
    invalidate.current = () => {};
  };
}
