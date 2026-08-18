(() => {
  try {
    const entry = sessionStorage.getItem('zq-entry-transition');
    if (entry) {
      sessionStorage.removeItem('zq-entry-transition');
      document.documentElement.dataset.zqEntry = entry;
    }
  } catch {}

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    if (!root.dataset.zqEntry) return;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('zq-enter-active')));
    window.setTimeout(() => {
      root.classList.remove('zq-enter-active');
      delete root.dataset.zqEntry;
    }, 1100);
  }, { once: true });
})();
