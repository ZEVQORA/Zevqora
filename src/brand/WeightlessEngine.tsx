import { useEffect, useRef, useState } from 'react';
import { useReducedMotion, type MotionValue } from 'motion/react';

const VERTEX = `attribute vec2 a_position;
varying vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;

const FRAGMENT = `precision highp float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_time;
uniform float u_progress;
uniform float u_centered;
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,-s,0.,s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.,s,0.,1.,0.,-s,0.,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,-s,0.,s,c,0.,0.,0.,1.);}
float band(vec3 p,float r){vec2 q=vec2(length(p.xz)-r,p.y);vec2 b=abs(q)-vec2(.145,.285);return length(max(b,0.))+min(max(b.x,b.y),0.)-.085;}
vec2 scene(vec3 p){
 float phase=u_progress;
 float x=mix(1.65,-1.40,smoothstep(.22,.55,phase));
 x=mix(x,1.65,smoothstep(.62,.96,phase));
 p.x-=mix(x,0.,u_centered);
 p.y+=mix(.04,.4,smoothstep(.68,1.,phase));
 p.y-=sin(u_time*.35)*.045;
 float turn=.30+phase*2.1+sin(u_time*.12)*.08;
 p=rz(-.38+phase*.46)*ry(turn)*rx(.95+phase*.28)*p;
 float spread=sin(phase*3.14159265)*.52;
 vec2 result=vec2(band(p,1.24),0.);
 vec3 a=ry(spread*.95)*rz(spread)*p-vec3(spread,0.,0.);
 vec3 b=ry(-spread*.95)*rz(-spread)*p+vec3(spread,0.,0.);
 float d1=band(a,1.24)-.008;
 float d2=band(b,1.24)-.012;
 if(d1<result.x)result=vec2(d1,1.);
 if(d2<result.x)result=vec2(d2,2.);
 return result;
}
vec3 normalAt(vec3 p){vec2 e=vec2(.0016,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
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
   vec3 silver=vec3(.78,.83,.89);
   vec3 tint=mix(silver,vec3(.40,.59,.86),smoothstep(.62,.96,u_progress)*.38);
   if(hit.y>1.5)tint=mix(tint,vec3(.40,.57,.80),.26);
   col=environment(refl)*tint*fresnel;
   col+=max(0.,dot(n,normalize(vec3(-.5,1.,1.))))*vec3(.12,.14,.17);
   col+=pow(1.-facing,3.)*vec3(.035,.065,.12);
   float brushing=sin((p.x+p.z)*1150.)*.5+.5;
   col*=.975+brushing*.025;
   col=col/(1.+col*.62);
 }
 col=pow(col,vec3(.83));
 float vignette=1.-smoothstep(.5,1.8,length((v_uv-.5)*vec2(1.3,1.)))*.38;
 gl_FragColor=vec4(col*vignette,1.);
}`;

/** A real-time metal sculpture. No image textures, downloaded renders or video. */
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
    try {
      program = gl.createProgram();
      if (!program) throw new Error('WebGL program unavailable');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL linking failed');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    } catch {
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
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(900_000 / Math.max(1, box.width * box.height)));
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
      if (program) gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
    };
  }, [progress]);
  useEffect(() => { canvas.current?.dispatchEvent(new Event('engine-playback')); }, [paused, reduced]);

  return <div className={`weightless-engine ${className}`} data-ready={ready} aria-hidden="true">
    <div className="weightless-fallback"><div /><div /><div /></div>
    <canvas ref={canvas} />
  </div>;
}
