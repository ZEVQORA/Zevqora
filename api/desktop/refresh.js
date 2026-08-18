import { json, methodNotAllowed, readJson } from '../_lib/http.js';
import { publicServerClient, accountStateForUser } from '../_lib/supabase.js';
export async function POST(request) {
  try {
    const body = await readJson(request); const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
    if (!refreshToken) return json({ error: 'Missing refresh token.' }, 400);
    const client = publicServerClient(); const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) return json({ error: 'Session could not be refreshed.' }, 401);
    const account = await accountStateForUser(data.user.id);
    return json({ session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token }, user: { id: data.user.id, email: data.user.email || null }, account });
  } catch (error) { console.error('[desktop/refresh]', error); return json({ error: 'Could not refresh desktop session.' }, 500); }
}
export function GET() { return methodNotAllowed(); }
