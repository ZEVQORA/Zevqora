import { on } from '../router.js';
import { ApiError, json, readJson, str } from '../http.js';
import { adminClient, publicServerClient } from '../supabase.js';
import { rateLimitRequest } from '../auth.js';
import { openRouterConfigured } from '../openrouter.js';

const VERSION = '2.0.0';

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

on('GET', '/api/public-config', async () => {
  return json(
    {
      appUrl: process.env.PUBLIC_APP_URL || 'https://zevqora.vercel.app',
      desktopDownloadUrl: process.env.PUBLIC_DESKTOP_DOWNLOAD_URL || 'https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe',
      supabaseUrl: process.env.PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.PUBLIC_SUPABASE_ANON_KEY || '',
      stripeConfigured: stripeConfigured(),
      contactEmail: process.env.PUBLIC_CONTACT_EMAIL || 'zevqora.ai@gmail.com',
      features: { cloudReplay: openRouterConfigured(), telemetry: true },
      version: VERSION,
    },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
});

on('GET', '/api/health', async () => ({
  ok: true,
  version: VERSION,
  cloudReplayConfigured: openRouterConfigured(),
  stripeConfigured: stripeConfigured(),
  time: new Date().toISOString(),
}));

const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

on('POST', '/api/auth/password-login', async ({ request }) => {
  rateLimitRequest(request, 'password-login', { limit: 12, windowMs: 60_000 });
  const body = await readJson(request);
  const identifier = str(body?.identifier, { name: 'identifier', max: 200 });
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!identifier || password.length < 8) throw new ApiError(400, 'Invalid username/email or password.', 'INVALID_CREDENTIALS');

  let email = identifier;
  const admin = adminClient();
  if (!identifier.includes('@')) {
    const { data: profile } = await admin.from('profiles').select('email').eq('username', identifier.toLowerCase()).maybeSingle();
    if (!profile?.email) throw new ApiError(401, 'Invalid username/email or password.', 'INVALID_CREDENTIALS');
    email = profile.email;
  }

  const client = publicServerClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw new ApiError(401, 'Invalid username/email or password.', 'INVALID_CREDENTIALS');

  const { data: profile } = await admin.from('profiles').select('suspended_at').eq('id', data.user.id).maybeSingle();
  if (profile?.suspended_at) throw new ApiError(403, 'This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');

  return {
    session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
    user: { id: data.user.id, email: data.user.email || null },
  };
});

on('POST', '/api/auth/username-available', async ({ request }) => {
  rateLimitRequest(request, 'username-available', { limit: 60, windowMs: 60_000 });
  const body = await readJson(request);
  const username = String(body?.username || '').trim().toLowerCase();
  if (!USERNAME.test(username)) return json({ available: false, error: 'Invalid username.' }, 400);
  const admin = adminClient();
  const { data, error } = await admin.from('profiles').select('id').eq('username', username).limit(1);
  if (error) throw error;
  return { available: !data?.length };
});
