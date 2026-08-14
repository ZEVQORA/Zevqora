import { json, methodNotAllowed, readJson } from '../_lib/http.js';
import { adminClient, accountStateForUser } from '../_lib/supabase.js';
import { decryptSession, sha256 } from '../_lib/handoff-crypto.js';

export async function POST(request) {
  try {
    const body = await readJson(request);
    const code = typeof body?.code === 'string' ? body.code : '';
    const state = typeof body?.state === 'string' ? body.state : '';
    if (code.length < 20 || state.length < 32) {
      return json({ error: 'Invalid handoff.' }, 400);
    }

    const admin = adminClient();
    const { data: row, error } = await admin
      .from('desktop_auth_handoffs')
      .select('*')
      .eq('code_hash', sha256(code))
      .maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: 'Handoff not found.' }, 404);
    if (row.used_at) return json({ error: 'Handoff already used.' }, 409);
    if (row.state_hash !== sha256(state)) return json({ error: 'State mismatch.' }, 403);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: 'Handoff expired.' }, 410);
    }

    const payload = decryptSession(row);
    if (payload.expiresAt < Date.now() || payload.userId !== row.user_id) {
      return json({ error: 'Handoff expired.' }, 410);
    }

    const { data: userResult, error: userError } = await admin.auth.getUser(payload.accessToken);
    if (userError || !userResult?.user) return json({ error: 'Session expired.' }, 401);

    const mark = await admin
      .from('desktop_auth_handoffs')
      .update({ used_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle();
    if (mark.error || !mark.data) return json({ error: 'Handoff already used.' }, 409);

    const account = await accountStateForUser(row.user_id);
    return json({
      session: {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      },
      user: {
        id: userResult.user.id,
        email: userResult.user.email || null,
      },
      account,
    });
  } catch (error) {
    console.error('[desktop/exchange-handoff]', error);
    return json({ error: 'Could not exchange desktop sign-in handoff.' }, 500);
  }
}

export function GET() {
  return methodNotAllowed();
}
