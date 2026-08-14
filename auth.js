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
    const value = params.get('redirect') || '/account';
    return value.startsWith('/') && !value.startsWith('//') ? value : '/account';
  }

  async function initForm() {
    config = await getConfig();
    client = makeClient();
    const form = document.querySelector('[data-auth-form]');
    if (!form) return;

    const mode = form.dataset.mode || 'login';
    if (!client) {
      note('Supabase is not configured yet. Add the public Supabase values in Vercel.', 'error');
      form.querySelectorAll('button').forEach((b) => { b.disabled = true; b.style.opacity = '.48'; });
      return;
    }

    const { data: existing } = await client.auth.getSession();
    if (existing.session && new URLSearchParams(location.search).get('oauth') === '1') {
      location.replace(safeNext());
      return;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      note('Working…');
      const email = form.querySelector('[name="email"]').value.trim();
      const password = form.querySelector('[name="password"]').value;
      try {
        if (mode === 'signup') {
          const { data, error } = await client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${location.origin}/login?confirmed=1` },
          });
          if (error) throw error;
          if (data.session) location.href = safeNext();
          else note('Account created. Check your email, confirm it, then sign in.', 'success');
        } else {
          const { error } = await client.auth.signInWithPassword({ email, password });
          if (error) throw error;
          location.href = safeNext();
        }
      } catch (error) {
        note(error?.message || 'Authentication failed.', 'error');
      }
    });

    document.querySelectorAll('[data-oauth]').forEach((button) => {
      button.addEventListener('click', async () => {
        const provider = button.dataset.oauth;
        note(`Opening ${provider}…`);
        const next = encodeURIComponent(safeNext());
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${location.origin}/login?oauth=1&redirect=${next}` },
        });
        if (error) note(`${provider} sign-in is not enabled: ${error.message}`, 'error');
      });
    });
  }

  async function initAccount() {
    const root = document.querySelector('[data-account-root]');
    if (!root) return;
    config = await getConfig();
    client = makeClient();
    if (!client) {
      root.innerHTML = '<p class="small-copy">Supabase is not configured. See PRODUCTION_SETUP.md.</p>';
      return;
    }

    const { data } = await client.auth.getSession();
    if (!data.session) {
      location.replace('/login?redirect=/account');
      return;
    }

    const user = data.session.user;
    document.querySelectorAll('[data-account-email]').forEach((el) => {
      el.textContent = user.email || 'Signed-in user';
    });
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
        const remaining = Math.max(
          Number(account.credit?.includedUsd || 0) - Number(account.credit?.usedUsd || 0),
          0,
        );
        document.querySelectorAll('[data-account-plan]').forEach((el) => {
          el.textContent = String(account.plan || 'free').toUpperCase();
        });
        document.querySelectorAll('[data-account-status]').forEach((el) => {
          el.textContent = account.status || 'active';
        });
        document.querySelectorAll('[data-account-credit]').forEach((el) => {
          el.textContent = `$${remaining.toFixed(2)} / $${Number(account.credit?.includedUsd || 0).toFixed(2)}`;
        });
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
        const res = await fetch('/api/stripe/create-portal', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
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

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-auth-form]')) initForm();
    if (document.querySelector('[data-account-root]')) initAccount();
  });
})();
