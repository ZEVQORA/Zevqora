(() => {
  const FALLBACK_DOWNLOAD = 'https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe';
  const fallback = window.ZEVQORA_CONFIG || {};
  let runtimeConfig = fallback;
  let authClient = null;

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

  async function loadConfig() {
    try {
      const res = await fetch('/api/public-config', { cache: 'no-store' });
      if (!res.ok) throw new Error('config unavailable');
      const remote = await res.json();
      runtimeConfig = { ...fallback, ...remote };
    } catch {
      runtimeConfig = fallback;
    }
    if (!runtimeConfig.desktopDownloadUrl) runtimeConfig.desktopDownloadUrl = FALLBACK_DOWNLOAD;
    window.ZEVQORA_RUNTIME_CONFIG = runtimeConfig;
    applyConfig(runtimeConfig);
    initSessionUI(runtimeConfig);
    window.dispatchEvent(new CustomEvent('zevqora:config-ready', { detail: runtimeConfig }));
  }

  function applyConfig(config) {
    document.querySelectorAll('[data-download-link]').forEach((node) => {
      node.href = config.desktopDownloadUrl || FALLBACK_DOWNLOAD;
      node.removeAttribute('aria-disabled');
      node.classList.remove('is-disabled');
    });

    document.querySelectorAll('[data-contact-email]').forEach((node) => {
      const email = config.contactEmail || 'zevqora.ai@gmail.com';
      node.href = `mailto:${email}`;
      if (node.dataset.showEmail === 'true') node.textContent = email;
    });
  }

  function initReveals() {
    const items = [...document.querySelectorAll('.reveal')];
    if (!items.length) return;
    if (!('IntersectionObserver' in window) || reduceMotion()) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((el) => observer.observe(el));
  }

  function initStaggeredMotion() {
    const groups = [
      ['.system-row', 48],
      ['.zev-proof-item', 72],
      ['.gate', 72],
      ['.price-card', 66],
      ['.feature-card', 58],
    ];

    groups.forEach(([selector, step]) => {
      const nodes = [...document.querySelectorAll(selector)];
      nodes.forEach((node, index) => {
        node.style.setProperty('--motion-delay', `${Math.min(index, 8) * step}ms`);
        node.classList.add('motion-item');
      });
      if (!nodes.length) return;
      if (!('IntersectionObserver' in window) || reduceMotion()) {
        nodes.forEach((node) => node.classList.add('motion-visible'));
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('motion-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: .12, rootMargin: '0px 0px -4% 0px' });
      nodes.forEach((node) => observer.observe(node));
    });
  }

  function initProductTilt() {
    document.querySelectorAll('[data-tilt]').forEach((stage) => {
      const card = stage.querySelector('[data-tilt-card]');
      if (!card || reduceMotion() || coarsePointer()) return;

      let tx = 0, ty = 0, cx = 0, cy = 0, mx = 50, my = 50;
      let running = false;
      let hovering = false;

      const animate = () => {
        cx += (tx - cx) * .105;
        cy += (ty - cy) * .105;
        card.style.transform = `rotateX(${cy.toFixed(3)}deg) rotateY(${cx.toFixed(3)}deg) translate3d(0,${hovering ? '-3px' : '0'},0)`;
        card.style.setProperty('--mx', `${mx.toFixed(1)}%`);
        card.style.setProperty('--my', `${my.toFixed(1)}%`);
        const settled = Math.abs(tx - cx) < .015 && Math.abs(ty - cy) < .015;
        if (!settled || hovering) requestAnimationFrame(animate);
        else running = false;
      };

      const kick = () => {
        if (running) return;
        running = true;
        requestAnimationFrame(animate);
      };

      stage.addEventListener('pointerenter', () => { hovering = true; kick(); });
      stage.addEventListener('pointermove', (event) => {
        const rect = stage.getBoundingClientRect();
        const px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        mx = px * 100;
        my = py * 100;
        tx = (px - .5) * 6.2;
        ty = (py - .5) * -5.1;
        kick();
      });
      stage.addEventListener('pointerleave', () => {
        hovering = false;
        tx = 0; ty = 0; mx = 50; my = 50;
        kick();
      });
    });
  }

  function initPointerGlow() {
    if (reduceMotion() || coarsePointer()) return;
    const selectors = '.feature-card,.price-card,.gate,.login-card,.signup-form-wrap,.zev-info-card';
    document.querySelectorAll(selectors).forEach((node) => {
      if (node.dataset.zqPointerInit === '1') return;
      node.dataset.zqPointerInit = '1';
      node.classList.add('pointer-reactive');
      node.addEventListener('pointermove', (event) => {
        const r = node.getBoundingClientRect();
        node.style.setProperty('--px', `${((event.clientX - r.left) / r.width * 100).toFixed(1)}%`);
        node.style.setProperty('--py', `${((event.clientY - r.top) / r.height * 100).toFixed(1)}%`);
      });
      node.addEventListener('pointerleave', () => {
        node.style.setProperty('--px', '50%');
        node.style.setProperty('--py', '50%');
      });
    });
  }

  function initAuthMicroInteractions() {
    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
      if (button.dataset.zqPasswordInit === '1') return;
      const target = document.getElementById(button.dataset.passwordToggle);
      if (!target) return;
      button.dataset.zqPasswordInit = '1';

      // Password visibility is persistent until the user explicitly presses the eye again.
      // Typing, Backspace, Delete and focus changes never alter this state.
      const syncPasswordVisibility = (visible) => {
        target.type = visible ? 'text' : 'password';
        button.classList.toggle('is-visible', visible);
        button.dataset.visible = visible ? 'true' : 'false';
        button.setAttribute('aria-pressed', visible ? 'true' : 'false');
        button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      };

      syncPasswordVisibility(false);
      button.addEventListener('click', () => {
        const visible = button.dataset.visible !== 'true';
        const start = target.selectionStart;
        const end = target.selectionEnd;
        syncPasswordVisibility(visible);
        target.focus({ preventScroll: true });
        try {
          if (start !== null && end !== null) target.setSelectionRange(start, end);
        } catch {}
      });
    });

    const art = document.querySelector('[data-auth-art]');
    if (art && art.dataset.zqArtInit !== '1' && !coarsePointer() && !reduceMotion()) {
      art.dataset.zqArtInit = '1';
      const frameNode = art.querySelector('[data-auth-mascot-frame]') || art.querySelector('img');
      let tx = 0, ty = 0, cx = 0, cy = 0, hovering = false, running = false;
      const frame = () => {
        cx += (tx - cx) * .085;
        cy += (ty - cy) * .085;
        if (frameNode) frameNode.style.transform = `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0) rotateX(${(-cy*.055).toFixed(2)}deg) rotateY(${(cx*.055).toFixed(2)}deg)`;
        art.style.setProperty('--art-x', `${50 + cx * .45}%`);
        art.style.setProperty('--art-y', `${46 + cy * .45}%`);
        const settled = Math.abs(tx-cx) < .03 && Math.abs(ty-cy) < .03;
        if (!settled || hovering) requestAnimationFrame(frame); else running = false;
      };
      const kick = () => { if (!running) { running = true; requestAnimationFrame(frame); } };
      art.addEventListener('pointerenter', () => { hovering = true; kick(); });
      art.addEventListener('pointermove', (e) => {
        const r = art.getBoundingClientRect();
        tx = (((e.clientX-r.left)/r.width)-.5) * 11;
        ty = (((e.clientY-r.top)/r.height)-.5) * 8;
        kick();
      });
      art.addEventListener('pointerleave', () => { hovering = false; tx = 0; ty = 0; kick(); });
    }

    document.querySelectorAll('.auth-form .field input').forEach((input) => {
      if (input.dataset.zqFocusInit === '1') return;
      input.dataset.zqFocusInit = '1';
      input.addEventListener('focus', () => input.closest('.input-wrap')?.classList.add('is-focused'));
      input.addEventListener('blur', () => input.closest('.input-wrap')?.classList.remove('is-focused'));
    });
  }

  function initRipples() {
    if (reduceMotion()) return;
    document.querySelectorAll('[data-ripple], .button, .price-card .button').forEach((button) => {
      if (button.dataset.zqRippleInit === '1') return;
      button.dataset.zqRippleInit = '1';
      button.addEventListener('pointerdown', (event) => {
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        const r = button.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'micro-ripple';
        const size = Math.max(r.width, r.height) * 1.35;
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${event.clientX - r.left - size/2}px`;
        ripple.style.top = `${event.clientY - r.top - size/2}px`;
        button.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once:true });
      });
    });
  }

  function initZevParallax() {
    const card = document.querySelector('.zev-info-card');
    if (!card || coarsePointer() || reduceMotion()) return;
    let tx=0, ty=0, cx=0, cy=0, running=false, hovering=false;
    const frame=()=>{
      cx += (tx-cx)*.095;
      cy += (ty-cy)*.095;
      card.style.setProperty('--zev-x', `${cx.toFixed(2)}px`);
      card.style.setProperty('--zev-y', `${cy.toFixed(2)}px`);
      const settled=Math.abs(tx-cx)<.02 && Math.abs(ty-cy)<.02;
      if (!settled || hovering) requestAnimationFrame(frame); else running=false;
    };
    const kick=()=>{ if (!running) { running=true; requestAnimationFrame(frame); } };
    card.addEventListener('pointerenter',()=>{ hovering=true; kick(); });
    card.addEventListener('pointermove',(event)=>{
      const r=card.getBoundingClientRect();
      tx=(((event.clientX-r.left)/r.width)-.5)*7.2;
      ty=(((event.clientY-r.top)/r.height)-.5)*5.2;
      kick();
    });
    card.addEventListener('pointerleave',()=>{ hovering=false; tx=0; ty=0; kick(); });
  }

  function initMagneticControls() {
    if (reduceMotion() || coarsePointer()) return;
    document.querySelectorAll('.button, .auth-submit, .oauth-button').forEach((node) => {
      if (node.dataset.zqMagneticInit === '1') return;
      node.dataset.zqMagneticInit = '1';
      node.classList.add('is-magnetic');
      let raf=0;
      const reset=()=>{
        cancelAnimationFrame(raf);
        node.style.setProperty('--mag-x','0px');
        node.style.setProperty('--mag-y','0px');
      };
      node.addEventListener('pointermove',(event)=>{
        const r=node.getBoundingClientRect();
        const x=((event.clientX-r.left)/r.width-.5);
        const y=((event.clientY-r.top)/r.height-.5);
        cancelAnimationFrame(raf);
        raf=requestAnimationFrame(()=>{
          node.style.setProperty('--mag-x',`${(x*4.2).toFixed(2)}px`);
          node.style.setProperty('--mag-y',`${(y*3.2).toFixed(2)}px`);
        });
      });
      node.addEventListener('pointerleave',reset);
      node.addEventListener('blur',reset);
    });
  }


  function createTransitionCurtain() {
    let curtain = document.querySelector('.zq-transition-curtain');
    if (curtain) return curtain;
    curtain = document.createElement('div');
    curtain.className = 'zq-transition-curtain';
    curtain.setAttribute('aria-hidden', 'true');
    document.body.appendChild(curtain);
    return curtain;
  }

  function authTransitionKind(destinationPath) {
    const current = location.pathname.replace(/\.html$/i, '').replace(/\/$/, '') || '/';
    const dest = destinationPath.replace(/\.html$/i, '').replace(/\/$/, '') || '/';
    if (current === '/login' && dest === '/signup') return 'auth-forward';
    if (current === '/signup' && dest === '/login') return 'auth-back';
    return null;
  }

  function storeEntryTransition(kind) {
    try { sessionStorage.setItem('zq-entry-transition', kind); } catch {}
  }

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  let authSceneBusy = false;

  function refreshAuthUI() {
    initPointerGlow();
    initAuthMicroInteractions();
    initRipples();
    initMagneticControls();
    applyConfig(runtimeConfig);
  }

  async function performAuthSceneTransition(url, kind) {
    if (authSceneBusy) return;
    authSceneBusy = true;
    const direction = kind === 'auth-forward' ? 'forward' : 'back';
    document.documentElement.dataset.authDirection = direction;
    document.body.classList.add('zq-auth-scene-running');

    try {
      const response = await fetch(url.href, { headers: { 'X-ZEVQORA-Navigation': 'auth-scene' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`Auth scene request failed: ${response.status}`);
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const nextShell = parsed.querySelector('.auth-shell');
      const nextFooter = parsed.querySelector('.auth-footer');
      if (!nextShell || !nextFooter) throw new Error('Auth scene is incomplete.');

      const swap = () => {
        const currentPage = document.querySelector('.auth-page');
        const nextPage = parsed.querySelector('.auth-page');
        document.querySelector('.auth-shell')?.replaceWith(nextShell);
        document.querySelector('.auth-footer')?.replaceWith(nextFooter);
        if (currentPage && nextPage) currentPage.className = nextPage.className;
        document.body.className = parsed.body.className;
        document.title = parsed.title || document.title;
        history.pushState({ zqAuthScene: true }, '', url.href);
      };

      if (document.startViewTransition && !reduceMotion()) {
        const transition = document.startViewTransition(swap);
        await transition.updateCallbackDone;
        refreshAuthUI();
        await window.ZEVQORA_AUTH?.initForm?.();
        await transition.finished;
      } else {
        const shell = document.querySelector('.auth-shell');
        shell?.classList.add(direction === 'forward' ? 'zq-auth-fallback-out-forward' : 'zq-auth-fallback-out-back');
        await sleep(reduceMotion() ? 0 : 360);
        swap();
        const next = document.querySelector('.auth-shell');
        next?.classList.add(direction === 'forward' ? 'zq-auth-fallback-in-forward' : 'zq-auth-fallback-in-back');
        refreshAuthUI();
        await window.ZEVQORA_AUTH?.initForm?.();
        await sleep(reduceMotion() ? 0 : 760);
        next?.classList.remove('zq-auth-fallback-in-forward', 'zq-auth-fallback-in-back');
      }
    } catch (error) {
      console.warn('[ZEVQORA auth scene]', error);
      storeEntryTransition(kind);
      location.href = url.href;
      return;
    } finally {
      document.body.classList.remove('zq-auth-scene-running');
      delete document.documentElement.dataset.authDirection;
      authSceneBusy = false;
    }
  }

  function navigateWithTransition(anchor, url) {
    const authKind = authTransitionKind(url.pathname);
    if (authKind) {
      performAuthSceneTransition(url, authKind);
      return;
    }

    const curtain = createTransitionCurtain();
    document.body.classList.add('zq-page-leaving');
    storeEntryTransition('page');
    requestAnimationFrame(() => curtain.classList.add('is-active'));
    window.setTimeout(() => { location.href = url.href; }, reduceMotion() ? 0 : 620);
  }

  function createScrollCue() {
    let cue = document.querySelector('.zq-scroll-cue');
    if (cue) cue.remove();
    cue = document.createElement('div');
    cue.className = 'zq-scroll-cue';
    cue.setAttribute('aria-hidden', 'true');
    cue.innerHTML = `
      <div class="zq-scroll-cue-mark"><img src="/assets/zevqora-mark.png" alt=""></div>
      <div class="zq-scroll-cue-copy"><span>HOW IT WORKS</span><strong>Following the evidence</strong></div>
      <div class="zq-scroll-cue-track"><i></i></div>`;
    document.body.appendChild(cue);
    requestAnimationFrame(() => cue.classList.add('is-visible'));
    return cue;
  }

  let cinematicScrollFrame = 0;
  function cinematicScrollTo(target, hash) {
    cancelAnimationFrame(cinematicScrollFrame);
    const start = window.scrollY;
    const targetY = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 12);
    const distance = targetY - start;
    const isHowItWorks = hash === '#how-it-works';
    const cue = isHowItWorks && !reduceMotion() ? createScrollCue() : null;

    if (Math.abs(distance) < 3 || reduceMotion()) {
      window.scrollTo(0, targetY);
      target.classList.add('section-arriving');
      window.setTimeout(() => target.classList.remove('section-arriving'), 1100);
      cue?.remove();
      return;
    }

    document.body.classList.add('zq-scroll-travel');
    target.classList.add('section-travel-target');
    const duration = Math.min(1420, Math.max(900, 760 + Math.abs(distance) * .13));
    const startedAt = performance.now();
    let cancelled = false;
    const cleanup = () => {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('pointerdown', cancel);
      document.body.classList.remove('zq-scroll-travel');
      target.classList.remove('section-travel-target');
    };
    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(cinematicScrollFrame);
      cleanup();
      cue?.classList.add('is-done');
      window.setTimeout(() => cue?.remove(), 280);
    };
    window.addEventListener('wheel', cancel, { passive:true, once:true });
    window.addEventListener('touchstart', cancel, { passive:true, once:true });
    window.addEventListener('pointerdown', cancel, { passive:true, once:true });

    const ease = (t) => 1 - Math.pow(1 - t, 4);
    const step = (now) => {
      if (cancelled) return;
      const t = Math.min(1, (now - startedAt) / duration);
      window.scrollTo(0, start + distance * ease(t));
      cue?.style.setProperty('--zq-scroll-progress', t.toFixed(4));
      if (t < 1) {
        cinematicScrollFrame = requestAnimationFrame(step);
      } else {
        cleanup();
        target.classList.add('section-arriving');
        window.setTimeout(() => target.classList.remove('section-arriving'), 1400);
        if (hash) history.pushState(null, '', hash);
        if (cue) {
          cue.classList.add('is-done');
          window.setTimeout(() => cue.remove(), 480);
        }
      }
    };
    cinematicScrollFrame = requestAnimationFrame(step);
  }

  function initCinematicNavigation() {
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.getAttribute('aria-disabled') === 'true') return;
      const raw = anchor.getAttribute('href') || '';
      if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) return;

      let url;
      try { url = new URL(anchor.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;

      const samePath = url.pathname.replace(/\.html$/i,'') === location.pathname.replace(/\.html$/i,'');
      if (url.hash && samePath) {
        const target = document.querySelector(url.hash);
        if (!target) return;
        event.preventDefault();
        cinematicScrollTo(target, url.hash);
        return;
      }

      if (url.href === location.href || url.pathname === location.pathname && !url.search && !url.hash) return;
      event.preventDefault();
      navigateWithTransition(anchor, url);
    });
  }

  function makeAuthClient(config) {
    if (!config?.supabaseUrl || !config?.supabaseAnonKey || !window.supabase?.createClient) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  function displayNameFromUser(user) {
    const email = user?.email || '';
    if (email.includes('@')) return email.split('@')[0];
    return user?.user_metadata?.username || user?.user_metadata?.preferred_username || 'user';
  }

  async function initSessionUI(config) {
    const sessionNodes = document.querySelectorAll('[data-session-user]');
    const signedOutNodes = document.querySelectorAll('[data-session-signed-out]');
    const logoutButtons = document.querySelectorAll('[data-session-logout]');
    if (!sessionNodes.length && !signedOutNodes.length && !logoutButtons.length) return;

    authClient = makeAuthClient(config);
    if (!authClient) {
      sessionNodes.forEach((node) => node.hidden = true);
      signedOutNodes.forEach((node) => node.hidden = false);
      return;
    }

    const render = (session) => {
      if (session?.user) {
        const name = displayNameFromUser(session.user);
        sessionNodes.forEach((node) => {
          node.hidden = false;
          const target = node.querySelector('[data-session-name]');
          if (target) target.textContent = name;
        });
        signedOutNodes.forEach((node) => node.hidden = true);
        logoutButtons.forEach((node) => node.hidden = false);
      } else {
        sessionNodes.forEach((node) => node.hidden = true);
        signedOutNodes.forEach((node) => node.hidden = false);
        logoutButtons.forEach((node) => node.hidden = true);
      }
    };

    const { data } = await authClient.auth.getSession();
    render(data.session);
    authClient.auth.onAuthStateChange((_event, session) => render(session));

    logoutButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        await authClient.auth.signOut();
        location.href = '/';
      });
    });

    if (new URLSearchParams(location.search).get('oauth') === '1' && data.session) {
      history.replaceState({}, '', location.pathname);
    }
  }

  window.ZEVQORA_UI = { refreshAuth: refreshAuthUI };
  window.addEventListener('popstate', () => {
    if (document.querySelector('.auth-shell')) location.reload();
  });

  document.addEventListener('DOMContentLoaded', () => {
    initReveals();
    initStaggeredMotion();
    initProductTilt();
    initPointerGlow();
    initAuthMicroInteractions();
    initRipples();
    initZevParallax();
    initMagneticControls();
    initCinematicNavigation();
    loadConfig();
  });
})();
