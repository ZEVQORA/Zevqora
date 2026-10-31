import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Pause, Play, X } from "lucide-react";
import { Link } from "react-router";
import { startEngineCanvas } from "./EngineCanvasFallback";

export const ENGINE_VISUAL = "/cinema/lighter-engine.webp";
export const ENGINE_CHAPTERS = ["Observe", "Challenge", "Verify", "Release"];

const VERTEX = `attribute vec2 a_position; varying vec2 v_uv;
void main(){ v_uv=a_position*.5+.5; gl_Position=vec4(a_position,0.,1.); }`;
const FRAGMENT = `precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_imageSize;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_phase;
float random(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 uv=v_uv;
  float screen=u_resolution.x/u_resolution.y;
  float picture=u_imageSize.x/u_imageSize.y;
  if(screen>picture) uv.y=(uv.y-.5)*picture/screen+.5;
  else uv.x=(uv.x-.5)*screen/picture+.5;
  float t=u_time;
  uv=(uv-.5)/(1.06+sin(t*.18)*.014)+.5;
  uv+=u_pointer*vec2(.014,.009);
  float center=sin(uv.y*7.2+t*.23)*.004;
  float fold=sin(uv.y*18.+uv.x*9.-t*.34)*.0012;
  uv.x+=center+fold;
  uv.y+=sin(uv.x*8.4+t*.2)*.003;
  vec3 raw=texture2D(u_image,uv).rgb;
  float material=smoothstep(.05,.55,raw.b)*smoothstep(.0,.25,raw.b-raw.r);
  float light=pow(max(0.,sin(uv.x*5.7+uv.y*3.9-t*.55)),12.);
  vec3 color=raw*(.91+light*.3*material);
  color.b+=light*.035;
  float scan=1.-smoothstep(.0,.012,abs(fract(uv.x*.6+uv.y*.35-t*.045)-.5));
  color+=vec3(.03,.09,.16)*scan*material*(u_phase>1.5?1.:.25);
  float vignette=1.-.24*pow(length((v_uv-.5)*vec2(1.,.8)),2.);
  color*=vignette;
  color+=(random(gl_FragCoord.xy+floor(t*15.))-.5)*.009;
  gl_FragColor=vec4(color,1.);
}`;

/** A photo-real key visual is lit and refracted in realtime, with a static fallback. */
export function EngineFilm({
  playing = true,
  phase = 0,
  className = "",
}: {
  playing?: boolean;
  phase?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ playing, phase });
  const invalidate = useRef<() => void>(() => {});
  useEffect(() => {
    state.current = { playing, phase };
    invalidate.current();
  }, [playing, phase]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    if (!gl)
      return startEngineCanvas(
        fallbackRef.current,
        state,
        invalidate,
        ENGINE_VISUAL,
      );
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX),
      fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT),
      program = gl.createProgram();
    if (!vertex || !fragment || !program)
      return startEngineCanvas(
        fallbackRef.current,
        state,
        invalidate,
        ENGINE_VISUAL,
      );
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      return startEngineCanvas(
        fallbackRef.current,
        state,
        invalidate,
        ENGINE_VISUAL,
      );
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const attribute = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(
      [
        "u_image",
        "u_resolution",
        "u_imageSize",
        "u_pointer",
        "u_time",
        "u_phase",
      ].map((k) => [k, gl.getUniformLocation(program, k)]),
    );
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const image = new Image();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let ready = false,
      active = true,
      frame = 0,
      elapsed = 0,
      last = 0,
      lastDraw = 0,
      disposed = false;
    const pointer = { x: 0, y: 0, currentX: 0, currentY: 0 };
    const resize = () => {
      const box = canvas.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      request();
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || !ready || !active || document.hidden) return;
      const animate = state.current.playing && !reduce.matches;
      if (animate && lastDraw && now - lastDraw < 32) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const delta = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      lastDraw = now;
      if (animate) elapsed += delta;
      pointer.currentX += (pointer.x - pointer.currentX) * 0.045;
      pointer.currentY += (pointer.y - pointer.currentY) * 0.045;
      gl.uniform1i(uniforms.u_image, 0);
      gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
      gl.uniform2f(
        uniforms.u_imageSize,
        image.naturalWidth,
        image.naturalHeight,
      );
      gl.uniform2f(
        uniforms.u_pointer,
        reduce.matches ? 0 : pointer.currentX,
        reduce.matches ? 0 : pointer.currentY,
      );
      gl.uniform1f(uniforms.u_time, reduce.matches ? 2 : elapsed);
      gl.uniform1f(uniforms.u_phase, state.current.phase);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      canvas.style.opacity = "1";
      canvas.style.pointerEvents = "auto";
      if (animate) frame = requestAnimationFrame(draw);
    };
    function request() {
      if (!disposed && !frame) {
        last = 0;
        frame = requestAnimationFrame(draw);
      }
    }
    invalidate.current = request;
    image.onload = () => {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      ready = true;
      request();
    };
    image.src = ENGINE_VISUAL;
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting;
      if (active) request();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    intersection.observe(canvas);
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else request();
    };
    const motionChange = () => request();
    const move = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = (e.clientX - box.left) / box.width - 0.5;
      pointer.y = (e.clientY - box.top) / box.height - 0.5;
      request();
    };
    const leave = () => {
      pointer.x = 0;
      pointer.y = 0;
      request();
    };
    document.addEventListener("visibilitychange", visibility);
    reduce.addEventListener("change", motionChange);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    resize();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      reduce.removeEventListener("change", motionChange);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      image.onload = null;
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      invalidate.current = () => {};
    };
  }, []);
  return (
    <div className={`engine-film ${className}`}>
      <img src={ENGINE_VISUAL} alt="" aria-hidden fetchPriority="high" />
      <canvas
        ref={fallbackRef}
        className="engine-canvas-fallback"
        aria-hidden
        style={{ opacity: 0 }}
      />
      <canvas
        ref={ref}
        aria-hidden
        style={{ opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

export function CinemaDialog({
  open,
  onClose,
  phase,
  playing,
  setPhase,
  setPlaying,
}: {
  open: boolean;
  onClose: () => void;
  phase: number;
  playing: boolean;
  setPhase: (v: number) => void;
  setPlaying: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = document.activeElement as HTMLElement | null,
      previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog
      className="engine-cinema"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label="The Lighter Engine cinematic experience"
    >
      <EngineFilm phase={phase} playing={playing} />
      <div className="engine-cinema-top">
        <span>ZEVQORA / THE LIGHTER ENGINE</span>
        <button
          autoFocus
          type="button"
          onClick={onClose}
          aria-label="Close cinematic experience"
        >
          <X size={22} />
        </button>
      </div>
      <div className="engine-cinema-copy">
        <p>CHAPTER / 0{phase + 1}</p>
        <h2>
          {
            [
              "Every call\nhas a weight.",
              "A better way\ndeserves a test.",
              "Quality makes\nthe decision.",
              "Less overhead.\nMore possibility.",
            ][phase]
          }
        </h2>
        <span>An abstract brand film about the optimization loop.</span>
      </div>
      <div className="engine-cinema-controls">
        <button
          type="button"
          className="engine-play-button"
          aria-label={
            playing ? "Pause cinematic experience" : "Play cinematic experience"
          }
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div role="group" aria-label="Film chapters">
          {ENGINE_CHAPTERS.map((chapter, i) => (
            <button
              type="button"
              key={chapter}
              aria-pressed={phase === i}
              onClick={() => setPhase(i)}
            >
              <small>0{i + 1}</small>
              {chapter}
            </button>
          ))}
        </div>
        <Link to="/demo" onClick={onClose}>
          Inside the product
          <ArrowUpRight size={15} />
        </Link>
      </div>
    </dialog>,
    document.body,
  );
}

export function FilmBadge({ children }: { children: ReactNode }) {
  return (
    <span className="engine-film-badge">
      <i />
      {children}
    </span>
  );
}
