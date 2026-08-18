(() => {
  async function getConfig() {
    if (window.ZEVQORA_RUNTIME_CONFIG) return window.ZEVQORA_RUNTIME_CONFIG;
    const fallback = window.ZEVQORA_CONFIG || {};
    try {
      const res = await fetch('/api/public-config', { cache: 'no-store' });
      if (res.ok) return { ...fallback, ...(await res.json()) };
    } catch {}
    return fallback;
  }

  function setAll(selector, value) {
    document.querySelectorAll(selector).forEach((el) => { el.textContent = value; });
  }

  async function init() {
    if (!document.querySelector('[data-account-root]')) return;
    const config = await getConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) return;

    const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (!session) return;

    const user = session.user;
    const profileForm = document.querySelector('[data-profile-form]');
    const profileNote = document.querySelector('[data-profile-note]');
    if (profileForm) {
      profileForm.elements.display_name.value = user.user_metadata?.display_name || '';
      profileForm.elements.username.value = user.user_metadata?.username || '';
      profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = profileForm.querySelector('button[type="submit"]');
        const displayName = profileForm.elements.display_name.value.trim();
        const username = profileForm.elements.username.value.trim();
        if (button) button.disabled = true;
        if (profileNote) profileNote.textContent = 'Saving profile…';
        try {
          const { error } = await client.auth.updateUser({ data: { display_name: displayName, username } });
          if (error) throw error;
          if (profileNote) profileNote.textContent = 'Saved. ZEVQORA Desktop will pick up the updated account metadata after its next session refresh.';
        } catch (error) {
          if (profileNote) profileNote.textContent = error?.message || 'Could not save profile.';
        } finally {
          if (button) button.disabled = false;
        }
      });
    }

    let account = null;
    try {
      const res = await fetch('/api/desktop/session', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      const body = await res.json();
      if (res.ok) account = body.account || null;
    } catch {}

    const included = Number(account?.credit?.includedUsd || 0);
    const used = Number(account?.credit?.usedUsd || 0);
    const remaining = Math.max(included - used, 0);
    const ratio = included > 0 ? Math.min(Math.max(used / included, 0), 1) : 0;
    setAll('[data-account-included]', `$${included.toFixed(2)}`);
    setAll('[data-account-used]', `$${used.toFixed(2)}`);
    document.querySelectorAll('[data-account-meter]').forEach((el) => { el.style.width = `${Math.round(ratio * 100)}%`; });
    setAll('[data-account-usage-note]', included > 0 ? `${Math.round(ratio * 100)}% of current Zev credit used.` : 'No included credit is available on this account yet.');

    const creditNote = document.querySelector('[data-credit-note]');
    const packs = [...document.querySelectorAll('[data-credit-pack]')];
    if (!config.creditCheckoutConfigured) {
      packs.forEach((button) => { button.disabled = true; button.classList.add('is-disabled'); });
      if (creditNote) creditNote.textContent = 'Credit top-ups are not enabled on this deployment yet. Your included plan credit still works normally.';
    } else {
      if (creditNote) creditNote.textContent = 'Top-ups use Stripe-hosted checkout and add credit to the current billing period after payment confirmation.';
      packs.forEach((button) => {
        button.addEventListener('click', async () => {
          const pack = button.dataset.creditPack;
          const old = button.innerHTML;
          button.disabled = true;
          button.textContent = 'Opening checkout…';
          try {
            const res = await fetch('/api/stripe/create-checkout', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ pack }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Credit checkout is unavailable.');
            location.href = body.url;
          } catch (error) {
            alert(error?.message || 'Credit checkout is unavailable.');
            button.disabled = false;
            button.innerHTML = old;
          }
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => { void init(); });
})();
