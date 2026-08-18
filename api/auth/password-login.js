import { json, methodNotAllowed, readJson } from '../_lib/http.js';
import { adminClient, publicServerClient } from '../_lib/supabase.js';

export async function POST(request) {
  try {
    const body = await readJson(request);
    const identifier = String(body?.identifier || '').trim();
    const password = String(body?.password || '');
    if (!identifier || password.length < 8) return json({ error: 'Invalid username/email or password.' }, 400);

    let email = identifier;
    if (!identifier.includes('@')) {
      const admin = adminClient();
      const { data: profile, error } = await admin.from('profiles').select('email').eq('username', identifier.toLowerCase()).maybeSingle();
      if (error || !profile?.email) return json({ error: 'Invalid username/email or password.' }, 401);
      email = profile.email;
    }

    const client = publicServerClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return json({ error: 'Invalid username/email or password.' }, 401);
    return json({
      session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
      user: { id: data.user.id, email: data.user.email || null },
    });
  } catch (error) {
    console.error('[auth/password-login]', error);
    return json({ error: 'Authentication is temporarily unavailable.' }, 500);
  }
}
export function GET() { return methodNotAllowed(); }
