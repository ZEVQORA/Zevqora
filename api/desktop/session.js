import { json, bearerToken } from '../_lib/http.js';
import { verifyAccessToken, accountStateForUser } from '../_lib/supabase.js';
export async function GET(request) {
  try {
    const token = bearerToken(request); if (!token) return json({ error: 'Missing access token.' }, 401);
    const user = await verifyAccessToken(token); if (!user) return json({ error: 'Session expired.' }, 401);
    const account = await accountStateForUser(user.id);
    return json({ user: { id: user.id, email: user.email || null }, account });
  } catch (error) { console.error('[desktop/session]', error); return json({ error: 'Could not load desktop session.' }, 500); }
}
