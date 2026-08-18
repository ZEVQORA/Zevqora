(() => {
  let client = null;
  let config = null;

  function note(text, kind = '') {
    const el = document.querySelector('[data-auth-note]');
    if (!el) return;
    el.textContent = text;
    el.className = `auth-note ${kind}`.trim();
  }

  async function getConfig() {
    if (window.ZEVQORA_RUNTIME_CONFIG) return window.ZEVQORA_RUNTIME_CONFIG;
    const fallback = window.ZEVQORA_CONFIG || {};
    try {
      const res = await fetch('/api/public-config', { cache: 'no-store' });
      if (res.ok) return { ...fallback, ...(await res.json()) };
    } catch {}
    return fallback;
  }

  function makeClient() {
    if (!config?.supabaseUrl || !config?.supabaseAnonKey) return null;
    if (!window.supabase?.createClient) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  function safeNext() {
    const params = new URLSearchParams(location.search);
    const value = params.get('redirect') || '/';
    return value.startsWith('/') && !value.startsWith('//') ? value : '/';
  }

  async function passwordLogin(identifier, password) {
    const res = await fetch('/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Authentication failed.');
    const access_token = body.session?.accessToken;
    const refresh_token = body.session?.refreshToken;
    if (!access_token || !refresh_token) throw new Error('Authentication session is incomplete.');
    const { error } = await client.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
  }

  async function ensureUsernameAvailable(username) {
    const res = await fetch('/api/auth/username-available', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not validate username.');
    if (!body.available) throw new Error('That username is already taken.');
  }

  async function initForm() {
    config = await getConfig();
    client = makeClient();
    const form = document.querySelector('[data-auth-form]');
    if (!form) return;
    if (form.dataset.zqAuthInit === '1') return;
    form.dataset.zqAuthInit = '1';
    const mode = form.dataset.mode || 'login';

    if (!client) {
      const localPreview = location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
      note(
        localPreview
          ? 'Preview mode — connect Supabase in Vercel to enable sign in.'
          : 'Supabase is not configured yet. Add the public Supabase values in Vercel.',
        localPreview ? 'preview' : 'error',
      );
      form.querySelectorAll('button[type="submit"], [data-oauth]').forEach((b) => { b.disabled = true; });
      return;
    }

    const query = new URLSearchParams(location.search);
    if (query.get('created') === '1') note('Account created. Sign in with your username or email.', 'success');
    if (query.get('confirmed') === '1') note('Email confirmed. You can sign in now.', 'success');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const oldText = submit?.textContent;
      if (submit) { submit.disabled = true; submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…'; }
      note('Working…');

      try {
        if (mode === 'reset-request') {
          const email = form.querySelector('[name="email"]').value.trim();
          const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: `${location.origin}/reset-password`,
          });
          if (error) throw error;
          note('Password reset link sent. Check your email.', 'success');
          if (submit) { submit.disabled = false; submit.textContent = oldText; }
          return;
        }

        if (mode === 'reset-password') {
          const password = form.querySelector('[name="password"]').value;
          const confirm = form.querySelector('[name="confirm_password"]').value;
          if (password.length < 8) throw new Error('Password must be at least 8 characters.');
          if (password !== confirm) throw new Error('Passwords do not match.');
          const { error } = await client.auth.updateUser({ password });
          if (error) throw error;
          note('Password updated. Returning to sign in…', 'success');
          setTimeout(() => { location.href = '/login'; }, 700);
          return;
        }

        if (mode === 'signup') {
          const username = form.querySelector('[name="username"]').value.trim();
          const email = form.querySelector('[name="email"]').value.trim();
          const password = form.querySelector('[name="password"]').value;
          const confirm = form.querySelector('[name="confirm_password"]').value;
          if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) throw new Error('Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.');
          await ensureUsernameAvailable(username);
          if (password.length < 8) throw new Error('Password must be at least 8 characters.');
          if (password !== confirm) throw new Error('Passwords do not match.');
          const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
              data: { username, full_name: username },
              emailRedirectTo: `${location.origin}/login?confirmed=1`,
            },
          });
          if (error) throw error;
          if (data.session) await client.auth.signOut();
          note('Account created. Returning to sign in…', 'success');
          setTimeout(() => { location.href = '/login?created=1'; }, 650);
          return;
        }

        const identifier = form.querySelector('[name="identifier"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        if (!identifier || !password) throw new Error('Enter your username or email and password.');
        await passwordLogin(identifier, password);
        location.href = safeNext();
      } catch (error) {
        note(error?.message || 'Authentication failed.', 'error');
        if (submit) { submit.disabled = false; submit.textContent = oldText; }
      }
    });

    document.querySelectorAll('[data-oauth]').forEach((button) => {
      button.addEventListener('click', async () => {
        const provider = button.dataset.oauth;
        note(`Opening ${provider === 'github' ? 'GitHub' : 'Google'}…`);
        button.disabled = true;
        try {
          const { error } = await client.auth.signInWithOAuth({
            provider,
            options: { redirectTo: `${location.origin}/?oauth=1` },
          });
          if (error) throw error;
        } catch (error) {
          note(`${provider} sign-in is not enabled: ${error.message}`, 'error');
          button.disabled = false;
        }
      });
    });
  }

  async function initAccount() {
    const root = document.querySelector('[data-account-root]');
    if (!root) return;
    config = await getConfig();
    client = makeClient();
    if (!client) {
      root.innerHTML = '<p class="simple-lead">Supabase is not configured. See SETUP.md.</p>';
      return;
    }

    const { data } = await client.auth.getSession();
    if (!data.session) {
      location.replace('/login?redirect=/account');
      return;
    }

    const user = data.session.user;
    const friendly = (user.email || '').split('@')[0] || user.user_metadata?.username || 'user';
    document.querySelectorAll('[data-account-email]').forEach((el) => { el.textContent = user.email || 'Signed-in user'; });
    document.querySelectorAll('[data-account-name]').forEach((el) => { el.textContent = friendly; });
    const created = document.querySelector('[data-account-created]');
    if (created && user.created_at) created.textContent = new Date(user.created_at).toLocaleDateString();

    try {
      const res = await fetch('/api/desktop/session', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: 'no-store',
      });
      const body = await res.json();
      if (res.ok) {
        const account = body.account || {};
        const remaining = Math.max(Number(account.credit?.includedUsd || 0) - Number(account.credit?.usedUsd || 0), 0);
        document.querySelectorAll('[data-account-plan]').forEach((el) => { el.textContent = String(account.plan || 'free').toUpperCase(); });
        document.querySelectorAll('[data-account-status]').forEach((el) => { el.textContent = account.status || 'active'; });
        document.querySelectorAll('[data-account-credit]').forEach((el) => { el.textContent = `$${remaining.toFixed(2)} / $${Number(account.credit?.includedUsd || 0).toFixed(2)}`; });
        const billing = document.querySelector('[data-manage-billing]');
        if (billing) billing.hidden = !account.hasStripeCustomer;
      }
    } catch {}

    document.querySelector('[data-signout]')?.addEventListener('click', async () => {
      await client.auth.signOut();
      location.href = '/';
    });

    document.querySelector('[data-manage-billing]')?.addEventListener('click', async () => {
      const button = document.querySelector('[data-manage-billing]');
      if (button) button.disabled = true;
      try {
        const { data: current } = await client.auth.getSession();
        const token = current.session?.access_token;
        if (!token) throw new Error('Sign in again.');
        const res = await fetch('/api/stripe/create-portal', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Billing portal failed.');
        location.href = body.url;
      } catch (error) {
        alert(error?.message || 'Billing portal failed.');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  window.ZEVQORA_AUTH = { initForm, initAccount };

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-auth-form]')) initForm();
    if (document.querySelector('[data-account-root]')) initAccount();
  });
})();
