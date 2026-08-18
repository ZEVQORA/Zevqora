(() => {
  let config;
  let client;

  async function getConfig() {
    if (window.ZEVQORA_RUNTIME_CONFIG) return window.ZEVQORA_RUNTIME_CONFIG;
    try {
      const res = await fetch('/api/public-config', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
    return window.ZEVQORA_CONFIG || {};
  }

  async function checkout(plan) {
    if (!client) {
      location.href = `/login?redirect=${encodeURIComponent('/pricing')}`;
      return;
    }
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      location.href = `/login?redirect=${encodeURIComponent('/pricing')}`;
      return;
    }

    const button = document.querySelector(`[data-checkout-plan="${plan}"]`);
    const old = button?.textContent;
    if (button) { button.textContent = 'Opening secure checkout…'; button.setAttribute('aria-disabled', 'true'); }
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Checkout is unavailable.');
      location.href = body.url;
    } catch (error) {
      alert(error?.message || 'Checkout is unavailable.');
      if (button) { button.textContent = old; button.removeAttribute('aria-disabled'); }
    }
  }

  async function init() {
    config = await getConfig();
    if (config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient) {
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    document.querySelectorAll('[data-checkout-plan]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (!config.stripeConfigured) {
          alert('Stripe is not configured on this deployment yet.');
          return;
        }
        checkout(button.dataset.checkoutPlan);
      });
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
