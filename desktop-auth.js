(() => {
  const STATE_KEY = 'zevqora.desktopAuthState';
  const MIN_REFRESH_TOKEN_LENGTH = 20;
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

  function showAuthForm() {
    const form = document.querySelector('[data-desktop-auth-form]');
    const invalid = document.querySelector('[data-desktop-invalid]');
    form?.classList.remove('is-hidden');
    invalid?.classList.remove('is-visible');
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

  function validSession(session) {
    return Boolean(
      session &&
      typeof session.access_token === 'string' &&
      session.access_token.length > 20 &&
      typeof session.refresh_token === 'string' &&
      session.refresh_token.length >= MIN_REFRESH_TOKEN_LENGTH
    );
  }

  async function getFreshSession(preferredSession = null) {
    if (validSession(preferredSession)) return preferredSession;

    const { data: currentData, error: currentError } = await client.auth.getSession();
    if (currentError) throw currentError;
    if (validSession(currentData?.session)) return currentData.session;

    // A newly restored/OAuth browser session can briefly have an incomplete token
    // snapshot. Ask Supabase for a refreshed session before failing the handoff.
    if (currentData?.session) {
      const { data: refreshedData, error: refreshError } = await client.auth.refreshSession(currentData.session);
      if (!refreshError && validSession(refreshedData?.session)) return refreshedData.session;
    }

    throw new Error('Your browser session is incomplete. Sign in again, then retry the desktop connection.');
  }

  function updateStatefulLinks(state) {
    const returnPath = `/desktop-auth?resume=1&state=${encodeURIComponent(state)}`;
    const signup = document.querySelector('[data-desktop-signup]');
    if (signup) signup.href = `/signup?redirect=${encodeURIComponent(returnPath)}`;
  }

  async function complete(preferredSession = null) {
    note('Connecting your browser session to ZEVQORA Desktop…');
    const state = sessionStorage.getItem(STATE_KEY) || '';
    if (!validState(state)) {
      showInvalidState();
      throw new Error('Desktop sign-in session expired. Start sign-in from the desktop app again.');
    }

    const session = await getFreshSession(preferredSession);

    const res = await fetch('/api/desktop/create-handoff', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        state,
        refreshToken: session.refresh_token,
      }),
      cache: 'no-store',
    });

    let body = {};
    try { body = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 400 && body.code === 'MISSING_REFRESH_TOKEN') {
        throw new Error('Your browser session could not be refreshed. Sign in again, then retry the desktop connection.');
      }
      if (res.status === 400 && body.code === 'INVALID_DESKTOP_STATE') {
        sessionStorage.removeItem(STATE_KEY);
        showInvalidState();
      }
      throw new Error(body.error || 'Could not connect the desktop app.');
    }

    if (!body.code || typeof body.code !== 'string') {
      throw new Error('Desktop handoff did not return a one-time code. Please retry.');
    }

    const deepLink = `zevqora://auth/callback?code=${encodeURIComponent(body.code)}&state=${encodeURIComponent(state)}`;
    const open = document.querySelector('[data-open-desktop]');
    if (open) {
      open.href = deepLink;
      open.hidden = false;
      open.style.display = 'flex';
    }
    note('Connected. Opening ZEVQORA Desktop…', 'success');
    sessionStorage.removeItem(STATE_KEY);
    window.location.assign(deepLink);
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const incomingState = params.get('state');
    if (validState(incomingState)) sessionStorage.setItem(STATE_KEY, incomingState);

    const state = sessionStorage.getItem(STATE_KEY) || '';
    if (!validState(state)) {
      showInvalidState();
      return;
    }

    showAuthForm();
    updateStatefulLinks(state);

    config = await loadConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      note('Authentication is not configured for this deployment yet.', 'error');
      document.querySelectorAll('[data-desktop-auth-form] button').forEach((button) => { button.disabled = true; });
      return;
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    const { data: existing, error: existingError } = await client.auth.getSession();
    if (existingError) note(existingError.message, 'error');

    if ((params.get('resume') === '1' || incomingState) && existing?.session) {
      try {
        await complete(existing.session);
        return;
      } catch (error) {
        // Keep the form usable. A stale browser session should never brick desktop auth.
        note(error?.message || 'Desktop connection failed. Sign in again.', 'error');
      }
    }

    const form = document.querySelector('[data-desktop-auth-form]');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.querySelector('[name="email"]').value.trim();
      const password = form.querySelector('[name="password"]').value;
      note('Signing in…');

      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return note(error.message, 'error');
      if (!data?.session) return note('Sign-in completed without a browser session. Please try again.', 'error');

      try {
        await complete(data.session);
      } catch (err) {
        note(err?.message || 'Desktop connection failed.', 'error');
      }
    });

    document.querySelectorAll('[data-desktop-oauth]').forEach((button) => {
      button.addEventListener('click', async () => {
        const provider = button.dataset.desktopOauth;
        note(`Opening ${provider}…`);
        const redirectTo = `${location.origin}/desktop-auth?resume=1&state=${encodeURIComponent(state)}`;
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo },
        });
        if (error) note(`${provider} sign-in is not enabled: ${error.message}`, 'error');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
