import { json, methodNotAllowed, readJson } from '../_lib/http.js';
import { adminClient } from '../_lib/supabase.js';

const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

export async function POST(request) {
  try {
    const body = await readJson(request);
    const username = String(body?.username || '').trim().toLowerCase();
    if (!USERNAME.test(username)) return json({ available: false, error: 'Invalid username.' }, 400);
    const admin = adminClient();
    const { data, error } = await admin.from('profiles').select('id').eq('username', username).limit(1);
    if (error) throw error;
    return json({ available: !data?.length });
  } catch (error) {
    console.error('[auth/username-available]', error);
    return json({ error: 'Could not validate username.' }, 500);
  }
}

export function GET() { return methodNotAllowed(); }
