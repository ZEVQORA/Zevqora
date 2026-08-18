import { json, methodNotAllowed, readJson, bearerToken } from '../_lib/http.js';
import { adminClient, verifyAccessToken } from '../_lib/supabase.js';

function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 60) : '';
}

function cleanUsername(value) {
  return typeof value === 'string'
    ? value.trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32)
    : '';
}

export async function POST(request) {
  try {
    const token = bearerToken(request);
    if (!token) return json({ error: 'Sign in first.' }, 401);
    const user = await verifyAccessToken(token);
    if (!user) return json({ error: 'Your session expired. Sign in again.' }, 401);

    const body = await readJson(request);
    const displayName = cleanName(body?.displayName);
    const username = cleanUsername(body?.username);
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...(user.user_metadata || {}),
        display_name: displayName,
        username,
      },
    });
    if (error) throw error;

    return json({
      user: {
        id: data.user.id,
        email: data.user.email || null,
        displayName: data.user.user_metadata?.display_name || '',
        username: data.user.user_metadata?.username || '',
      },
    });
  } catch (error) {
    console.error('[desktop/update-profile]', error);
    return json({ error: error?.message || 'Could not update profile.' }, 500);
  }
}

export function GET() {
  return methodNotAllowed();
}
