(() => {
  const STATE_KEY = 'zevqora.desktopAuthState';
  let client;
  let config;

  function note(text, kind = '') {
    const el = document.querySelector('[data-desktop-auth-note]');
    if (!el) return;
    el.textContent = text;
    el.className = `zq-auth-note ${kind}`.trim();
  }

  function showInvalidState() {
    const form = document.querySelector('[data-desktop-auth-form]');
    const invalid = document.querySelector('[data-desktop-invalid]');
    form?.classList.add('is-hidden');
    invalid?.classList.add('is-visible');
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/public-config', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
    return window.ZEVQORA_CONFIG || {};
  }

  function validState(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{32,200}$/.test(value);
  }

  async function complete() {
    note('Connecting your browser session to ZEVQORA Desktop…');
    const state = sessionStorage.getItem(STATE_KEY) || '';
    if (!validState(state)) {
      showInvalidState();
      throw new Error('Desktop sign-in session expired. Start sign-in from the desktop app again.');
    }

    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new Error('No signed-in browser session was found.');

    const res = await fetch('/api/desktop/create-handoff', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({
        state,
        refreshToken: data.session.refresh_token,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not connect the desktop app.');

    const deepLink = `zevqora://auth/callback?code=${encodeURIComponent(body.code)}&state=${encodeURIComponent(state)}`;
    const open = document.querySelector('[data-open-desktop]');
    if (open) {
      open.href = deepLink;
      open.hidden = false;
      open.style.display = 'flex';
    }
    note('Connected. Opening ZEVQORA Desktop…', 'success');
    sessionStorage.removeItem(STATE_KEY);
    window.location.href = deepLink;
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const incomingState = params.get('state');
    if (validState(incomingState)) sessionStorage.setItem(STATE_KEY, incomingState);

    const state = sessionStorage.getItem(STATE_KEY);
    if (!validState(state)) {
      showInvalidState();
      return;
    }

    config = await loadConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      note('Authentication is not configured for this deployment yet.', 'error');
      document.querySelectorAll('[data-desktop-auth-form] button').forEach((b) => { b.disabled = true; });
      return;
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    const { data: existing } = await client.auth.getSession();
    if ((params.get('resume') === '1' || incomingState) && existing.session) {
      try { await complete(); } catch (error) { note(error.message, 'error'); }
      return;
    }

    const form = document.querySelector('[data-desktop-auth-form]');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.querySelector('[name="email"]').value.trim();
      const password = form.querySelector('[name="password"]').value;
      note('Signing in…');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) return note(error.message, 'error');
      try { await complete(); } catch (err) { note(err.message, 'error'); }
    });

    document.querySelectorAll('[data-desktop-oauth]').forEach((button) => {
      button.addEventListener('click', async () => {
        const provider = button.dataset.desktopOauth;
        note(`Opening ${provider}…`);
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${location.origin}/desktop-auth?resume=1` },
        });
        if (error) note(`${provider} sign-in is not enabled: ${error.message}`, 'error');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
