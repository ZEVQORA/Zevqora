import { useEffect, useRef, useState } from 'react';
import { useReducedMotion, type MotionValue } from 'motion/react';
import { ZevqoraMark } from './ZevqoraMark';
import { MARK_PATH } from './marks';

/** Bake the approved vector into a distance field; the logo geometry stays canonical. */
function brandDistanceField() {
  const size = 1024;
  const source = document.createElement('canvas');
  source.width = source.height = size;
  const context = source.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.translate((size - 87.05 * 8.4) / 2, 92);
  context.scale(8.4, 8.4);
  context.fill(new Path2D(MARK_PATH));
  const pixels = context.getImageData(0, 0, size, size).data;
  const inside = new Uint8Array(size * size);
  const distance = new Float32Array(size * size).fill(1e8);
  for (let i = 0; i < inside.length; i++) inside[i] = pixels[i * 4 + 3] > 127 ? 1 : 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    if (inside[i] !== inside[i - 1] || inside[i] !== inside[i + 1] || inside[i] !== inside[i - size] || inside[i] !== inside[i + size]) distance[i] = 0;
  }
  // Exact separable Euclidean distance avoids facets along the curved vector edges.
  const input = new Float64Array(size), output = new Float64Array(size);
  const sites = new Int32Array(size), bounds = new Float64Array(size + 1);
  const transform = () => {
    let k = 0; sites[0] = 0; bounds[0] = -Infinity; bounds[1] = Infinity;
    for (let q = 1; q < size; q++) {
      let crossing = ((input[q] + q * q) - (input[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
      while (crossing <= bounds[k]) { k--; crossing = ((input[q] + q * q) - (input[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k])); }
      sites[++k] = q; bounds[k] = crossing; bounds[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < size; q++) { while (bounds[k + 1] < q) k++; output[q] = (q - sites[k]) ** 2 + input[sites[k]]; }
  };
  for (let x = 0; x < size; x++) { for (let y = 0; y < size; y++) input[y] = distance[y * size + x]; transform(); for (let y = 0; y < size; y++) distance[y * size + x] = output[y]; }
  for (let y = 0; y < size; y++) { for (let x = 0; x < size; x++) input[x] = distance[y * size + x]; transform(); for (let x = 0; x < size; x++) distance[y * size + x] = Math.sqrt(output[x]); }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < distance.length; i++) {
    const encoded = Math.round(Math.max(0, Math.min(1, .5 + distance[i] * (inside[i] ? -1 : 1) / (size * 2))) * 65535);
    data[i * 4] = encoded >> 8; data[i * 4 + 1] = encoded & 255; data[i * 4 + 3] = 255;
  }
  return { data, size };
}

const VERTEX = `attribute vec2 a_position;
varying vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;

const FRAGMENT = `precision highp float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_time;
uniform float u_progress;
uniform float u_centered;
uniform sampler2D u_mark;
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,-s,0.,s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.,s,0.,1.,0.,-s,0.,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,-s,0.,s,c,0.,0.,0.,1.);}
float mark(vec2 p){
 vec2 uv=clamp(p/3.6+.5,0.,1.);uv.y=1.-uv.y;
 vec4 field=texture2D(u_mark,uv);
 float d=((field.r*65280.+field.g*255.)/65535.-.5)*7.2;
 return d+length(max(abs(p)-1.79,0.));
}
vec2 scene(vec3 p){
 float phase=u_progress;
 float x=mix(1.45,-1.55,smoothstep(.18,.35,phase));
 x=mix(x,1.45,smoothstep(.58,.82,phase));
 p.x-=mix(x,0.,u_centered);
 p.y-=sin(u_time*.3)*.025;
 p=ry(.16+sin(phase*3.14159265)*.12+sin(u_time*.16)*.015)*rx(-.025)*p;
 p/=.82;
 vec2 d=vec2(mark(p.xy)+.035,abs(p.z)-.13);
 return vec2((min(max(d.x,d.y),0.)+length(max(d,0.))-.035)*.82,0.);
}
vec3 normalAt(vec3 p){vec2 e=vec2(.006,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
vec3 environment(vec3 r){
 vec3 c=vec3(.025,.032,.045);
 float key=pow(max(0.,dot(r,normalize(vec3(-.65,.8,1.)))),9.);
 float top=pow(max(0.,dot(r,normalize(vec3(.5,1.,.25)))),24.);
 float strip=exp(-pow((r.x-.48)*8.,2.))*pow(max(0.,r.z),3.);
 float blue=pow(max(0.,dot(r,normalize(vec3(1.,-.1,-.7)))),8.);
 c+=key*vec3(3.6,3.8,4.0)+top*vec3(5.2,5.2,5.0)+strip*vec3(1.1,1.3,1.7);
 c+=blue*vec3(.12,.3,.75);
 return c;
}
void main(){
 vec2 uv=(v_uv-.5)*2.;uv.x*=u_size.x/u_size.y;
 vec3 ro=vec3(0.,.05,5.35);
 vec3 rd=normalize(vec3(uv*1.8,-4.8));
 float dist=0.;vec2 hit=vec2(0.);vec3 p=ro;
 for(int i=0;i<84;i++){p=ro+rd*dist;hit=scene(p);if(hit.x<.0015||dist>12.)break;dist+=hit.x*.78;}
 vec3 col=vec3(.021,.025,.033);
 col+=vec3(.009,.011,.015)*pow(max(0.,1.-length(uv-vec2(.3,0.))*.4),3.);
 if(dist<12. && hit.x<.012){
   vec3 n=normalAt(p);
   vec3 refl=reflect(rd,n);
   float facing=max(0.,dot(n,-rd));
   float fresnel=.52+.48*pow(1.-facing,4.);
   vec3 blue=vec3(.08,.35,1.25);
   col=blue*(.72+max(0.,dot(n,normalize(vec3(-.5,1.,1.))))*.65);
   col*=.82+.18*smoothstep(-1.2,1.2,p.y);
   col+=environment(refl)*vec3(.11,.21,.42)*fresnel*.52;
   col+=pow(max(0.,dot(refl,normalize(vec3(-.7,.9,1.)))),65.)*vec3(.6,.72,1.);
   col+=pow(1.-facing,3.)*vec3(.08,.17,.32);
   col=col/(1.+col*.62);
 }
 col=pow(col,vec3(.83));
 float vignette=1.-smoothstep(.5,1.8,length((v_uv-.5)*vec2(1.3,1.)))*.38;
 gl_FragColor=vec4(col*vignette,1.);
}`;

/** The official ZEVQORA mark, given depth and restrained studio lighting. */
export function WeightlessEngine({ progress, paused = false, centered = false, className = '' }: {
  progress?: MotionValue<number>; paused?: boolean; centered?: boolean; className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  const state = useRef({ paused, reduced, progress, centered });
  state.current = { paused, reduced, progress, centered };

  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof WebGLRenderingContext === 'undefined') return;
    const gl = element.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    function compile(type: number, source: string) {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error('Shader compilation failed');
      return shader;
    }
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;
    try {
      program = gl.createProgram();
      if (!program) throw new Error('WebGL program unavailable');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL linking failed');
      gl.useProgram(program);
      const field = brandDistanceField();
      texture = gl.createTexture();
      if (!texture) throw new Error('Texture unavailable');
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.size, field.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, field.data);
      gl.uniform1i(gl.getUniformLocation(program, 'u_mark'), 0);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    } catch {
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
      return;
    }
    const uniforms = {
      size: gl.getUniformLocation(program, 'u_size'), time: gl.getUniformLocation(program, 'u_time'),
      progress: gl.getUniformLocation(program, 'u_progress'), centered: gl.getUniformLocation(program, 'u_centered'),
    };
    let frame = 0, visible = true, previous = 0, time = 0, lost = false;
    const draw = (now: number) => {
      frame = 0;
      if (lost || !visible || document.hidden) return;
      if (now - previous > 31) {
        if (!state.current.paused && !state.current.reduced) time += Math.min(64, now - previous) / 1000;
        previous = now;
        gl.uniform2f(uniforms.size, element.width, element.height);
        gl.uniform1f(uniforms.time, time);
        gl.uniform1f(uniforms.progress, state.current.progress?.get() ?? 0);
        gl.uniform1f(uniforms.centered, state.current.centered || element.clientWidth < 700 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (!state.current.paused && !state.current.reduced) frame = requestAnimationFrame(draw);
    };
    const schedule = () => { if (!frame && !lost && visible && !document.hidden) frame = requestAnimationFrame(draw); };
    const resize = () => {
      const box = element.getBoundingClientRect();
      const budget = box.width < 700 ? 900_000 : 1_600_000;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(budget / Math.max(1, box.width * box.height)));
      element.width = Math.max(1, Math.round(box.width * ratio));
      element.height = Math.max(1, Math.round(box.height * ratio));
      gl.viewport(0, 0, element.width, element.height); previous = 0; schedule();
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule(); else { cancelAnimationFrame(frame); frame = 0; }
    });
    intersection.observe(element);
    const unsubscribe = progress?.on('change', schedule);
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); setReady(false); };
    element.addEventListener('webglcontextlost', contextLost);
    document.addEventListener('visibilitychange', schedule);
    element.addEventListener('engine-playback', schedule);
    resize(); setReady(true);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); unsubscribe?.();
      element.removeEventListener('webglcontextlost', contextLost);
      element.removeEventListener('engine-playback', schedule);
      document.removeEventListener('visibilitychange', schedule);
      if (buffer) gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
    };
  }, [progress]);
  useEffect(() => { canvas.current?.dispatchEvent(new Event('engine-playback')); }, [paused, reduced]);

  return <div className={`weightless-engine ${className}`} data-ready={ready} aria-hidden="true">
    <div className="weightless-fallback"><ZevqoraMark height={400} /></div>
    <canvas ref={canvas} />
  </div>;
}
