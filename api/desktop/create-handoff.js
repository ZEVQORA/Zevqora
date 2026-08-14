import { json, methodNotAllowed, readJson, bearerToken } from '../_lib/http.js';
import { adminClient, verifyAccessToken } from '../_lib/supabase.js';
import { encryptSession, randomCode, sha256 } from '../_lib/handoff-crypto.js';

export async function POST(request) {
  try {
    const accessToken = bearerToken(request);
    if (!accessToken) return json({ error: 'Missing access token.' }, 401);
    const user = await verifyAccessToken(accessToken);
    if (!user) return json({ error: 'Invalid or expired session.' }, 401);

    const body = await readJson(request);
    const state = typeof body?.state === 'string' ? body.state : '';
    const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
    if (state.length < 32 || refreshToken.length < 20) {
      return json({ error: 'Invalid desktop handoff request.' }, 400);
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
    return json({ error: 'Could not create desktop sign-in handoff.' }, 500);
  }
}

export function GET() {
  return methodNotAllowed();
}
