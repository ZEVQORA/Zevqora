(() => {
  const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function boot() {
    const el = document.querySelector('.zqv8-boot');
    if (!el) return;
    const finish = () => {
      window.setTimeout(() => {
        el.classList.add('is-done');
        window.setTimeout(() => el.remove(), 560);
      }, reduce() ? 0 : 260);
    };
    if (document.readyState === 'complete') finish();
    else window.addEventListener('load', finish, { once:true });
    window.setTimeout(finish, 1800);
  }

  function progress() {
    const bar = document.querySelector('.zqv8-progress');
    if (!bar) return;
    let ticking = false;
    const update = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const p = Math.min(1, Math.max(0, scrollY / max));
      bar.style.setProperty('--zqv8-progress', p.toFixed(4));
      ticking = false;
    };
    addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive:true });
    update();
  }

  function pointerLight() {
    if (reduce() || matchMedia('(pointer: coarse)').matches) return;
    const light = document.createElement('div');
    light.className = 'zqv8-pointer-light';
    document.body.appendChild(light);
    let tx = innerWidth * .5, ty = innerHeight * .32, x = tx, y = ty, raf = 0;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(step); }, { passive:true });
    function step(){ x += (tx-x)*.16; y += (ty-y)*.16; light.style.setProperty('--zqv8-x', `${x}px`); light.style.setProperty('--zqv8-y', `${y}px`); if(Math.abs(tx-x)>.3||Math.abs(ty-y)>.3) raf=requestAnimationFrame(step); else raf=0; }
  }

  function productParallax() {
    if (reduce()) return;
    const stage = document.querySelector('.product-stage');
    const card = stage?.querySelector('.product-card');
    if (!stage || !card) return;
    let lastY = 0, raf = 0;
    const update = () => {
      const r = stage.getBoundingClientRect();
      const center = r.top + r.height*.5;
      const normalized = Math.max(-1,Math.min(1,(center-innerHeight*.5)/innerHeight));
      const y = normalized * -10;
      if (Math.abs(y-lastY)>.1) card.style.translate = `0 ${y.toFixed(2)}px`;
      lastY = y; raf = 0;
    };
    addEventListener('scroll',()=>{if(!raf)raf=requestAnimationFrame(update)},{passive:true});
    update();
  }

  function softStagger() {
    const groups = document.querySelectorAll('.hero-features,.system-list,.rail,.zev-proof-list');
    groups.forEach(group => {
      Array.from(group.children).forEach((child,i) => child.style.setProperty('--zqv8-i', i));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot(); progress(); pointerLight(); productParallax(); softStagger();
  });
})();
