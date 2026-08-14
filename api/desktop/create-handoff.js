import { json, methodNotAllowed, readJson, bearerToken } from '../_lib/http.js';
import { adminClient, verifyAccessToken } from '../_lib/supabase.js';
import { encryptSession, randomCode, sha256 } from '../_lib/handoff-crypto.js';

const STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;

export async function POST(request) {
  try {
    const accessToken = bearerToken(request);
    if (!accessToken) return json({ error: 'Missing access token.', code: 'MISSING_ACCESS_TOKEN' }, 401);

    const user = await verifyAccessToken(accessToken);
    if (!user) return json({ error: 'Invalid or expired session.', code: 'INVALID_ACCESS_TOKEN' }, 401);

    const body = await readJson(request);
    const state = typeof body?.state === 'string' ? body.state.trim() : '';
    const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';

    if (!STATE_PATTERN.test(state)) {
      return json({
        error: 'Desktop sign-in state is missing or expired. Start sign-in again from ZEVQORA Desktop.',
        code: 'INVALID_DESKTOP_STATE',
      }, 400);
    }

    if (refreshToken.length < 20) {
      return json({
        error: 'Browser session refresh token is missing. Sign in again and retry the desktop connection.',
        code: 'MISSING_REFRESH_TOKEN',
      }, 400);
    }

    const code = randomCode(32);
    const encrypted = encryptSession({
      accessToken,
      refreshToken,
      userId: user.id,
      expiresAt: Date.now() + 90_000,
    });
    const admin = adminClient();
    const expiresAt = new Date(Date.now() + 90_000).toISOString();

    // Opportunistic cleanup in addition to the daily cron.
    await admin
      .from('desktop_auth_handoffs')
      .delete()
      .lt('expires_at', new Date(Date.now() - 10 * 60_000).toISOString());

    const { error } = await admin.from('desktop_auth_handoffs').insert({
      code_hash: sha256(code),
      state_hash: sha256(state),
      user_id: user.id,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      expires_at: expiresAt,
    });
    if (error) throw error;

    return json({ code, expiresAt });
  } catch (error) {
    console.error('[desktop/create-handoff]', error);
    return json({ error: 'Could not create desktop sign-in handoff.', code: 'HANDOFF_CREATE_FAILED' }, 500);
  }
}

export function GET() {
  return methodNotAllowed();
}
