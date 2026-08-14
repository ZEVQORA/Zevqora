(() => {
  const fallback = window.ZEVQORA_CONFIG || {};
  let runtimeConfig = fallback;

  async function loadConfig() {
    try {
      const res = await fetch('/api/public-config', { cache: 'no-store' });
      if (!res.ok) throw new Error('config unavailable');
      const remote = await res.json();
      runtimeConfig = { ...fallback, ...remote };
    } catch {
      runtimeConfig = fallback;
    }
    window.ZEVQORA_RUNTIME_CONFIG = runtimeConfig;
    applyConfig(runtimeConfig);
    window.dispatchEvent(new CustomEvent('zevqora:config-ready', { detail: runtimeConfig }));
  }

  function applyConfig(config) {
    document.querySelectorAll('[data-download-link]').forEach((node) => {
      if (config.desktopDownloadUrl) {
        node.href = config.desktopDownloadUrl;
        node.removeAttribute('aria-disabled');
        node.classList.remove('is-disabled');
        if (node.dataset.downloadLabel) node.textContent = node.dataset.downloadLabel;
      } else {
        node.href = '/download';
      }
    });

    document.querySelectorAll('[data-contact-email]').forEach((node) => {
      const email = config.contactEmail || 'zevqora.ai@gmail.com';
      node.href = `mailto:${email}`;
      if (node.dataset.showEmail === 'true') node.textContent = email;
    });

  }

  function initIntro() {
    const intro = document.querySelector('.brand-intro');
    if (!intro) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try { seen = sessionStorage.getItem('zevqora-brand-intro') === '1'; } catch {}
    if (reduce || seen) {
      intro.remove();
      return;
    }
    document.body.classList.add('no-scroll');
    try { sessionStorage.setItem('zevqora-brand-intro', '1'); } catch {}
    setTimeout(() => {
      intro.classList.add('is-hidden');
      document.body.classList.remove('no-scroll');
      setTimeout(() => intro.remove(), 520);
    }, 1780);
  }

  function initReveals() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((el) => observer.observe(el));
  }

  function initProductParallax() {
    const wrap = document.querySelector('[data-parallax-wrap]');
    const card = document.querySelector('[data-parallax-card]');
    if (!wrap || !card) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(pointer: coarse)').matches) return;

    let raf = 0;
    const reset = () => { card.style.transform = 'rotateX(0deg) rotateY(0deg) translateZ(0)'; };
    wrap.addEventListener('pointermove', (event) => {
      const rect = wrap.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.transform = `rotateX(${(-y * 4.2).toFixed(2)}deg) rotateY(${(x * 5.2).toFixed(2)}deg) translateZ(0)`;
      });
    });
    wrap.addEventListener('pointerleave', reset);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initIntro();
    initReveals();
    initProductParallax();
    loadConfig();
  });
})();
