(() => {
  const STATE_KEY = 'zevqora.desktopAuthState';
  let client;
  let config;

  function note(text, kind = '') {
    const el = document.querySelector('[data-desktop-auth-note]');
    if (!el) return;
    el.textContent = text;
    el.className = `auth-note ${kind}`.trim();
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
    if (!validState(state)) throw new Error('Desktop sign-in state expired. Return to the app and start again.');

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
    }
    note('Signed in. Opening ZEVQORA Desktop…', 'success');
    sessionStorage.removeItem(STATE_KEY);
    window.location.href = deepLink;
  }

  async function init() {
    config = await loadConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      note('Supabase is not configured for this deployment.', 'error');
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    const params = new URLSearchParams(location.search);
    const incomingState = params.get('state');
    if (validState(incomingState)) sessionStorage.setItem(STATE_KEY, incomingState);

    const state = sessionStorage.getItem(STATE_KEY);
    if (!validState(state)) {
      note('This sign-in link was not opened by ZEVQORA Desktop. Return to the app and click Continue in browser.', 'error');
      document.querySelectorAll('[data-desktop-auth-form] button').forEach((b) => { b.disabled = true; });
      return;
    }

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
