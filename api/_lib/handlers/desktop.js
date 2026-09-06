/**
 * ZEVQORA Desktop browser-auth handoff. Preserved contract from v1: the
 * installed app opens /desktop-auth?state=..., the browser creates a one-time
 * encrypted handoff, and the app exchanges it exactly once.
 */
import { on } from '../router.js';
import { ApiError, readJson, bearerToken } from '../http.js';
import { adminClient, verifyAccessToken, accountStateForUser, publicServerClient } from '../supabase.js';
import { encryptSession, randomCode, sha256 } from '../handoff-crypto.js';
import { decryptSession } from '../handoff-crypto.js';
import { requireUser, rateLimitRequest } from '../auth.js';

const STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;

on('GET', '/api/desktop/session', async ({ request }) => {
  const { user } = await requireUser(request);
  const account = await accountStateForUser(user.id);
  return { user: { id: user.id, email: user.email || null }, account };
});

on('POST', '/api/desktop/create-handoff', async ({ request }) => {
  const accessToken = bearerToken(request);
  if (!accessToken) throw new ApiError(401, 'Missing access token.', 'MISSING_ACCESS_TOKEN');
  const user = await verifyAccessToken(accessToken);
  if (!user) throw new ApiError(401, 'Invalid or expired session.', 'INVALID_ACCESS_TOKEN');
  const body = await readJson(request);
  const state = typeof body?.state === 'string' ? body.state.trim() : '';
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
  if (!STATE_PATTERN.test(state)) throw new ApiError(400, 'Desktop sign-in state is missing or expired. Start sign-in again from ZEVQORA Desktop.', 'INVALID_DESKTOP_STATE');
  if (refreshToken.length < 20) throw new ApiError(400, 'Browser session refresh token is missing. Sign in again and retry the desktop connection.', 'MISSING_REFRESH_TOKEN');

  const code = randomCode(32);
  const encrypted = encryptSession({ accessToken, refreshToken, userId: user.id, expiresAt: Date.now() + 90_000 });
  const admin = adminClient();
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  await admin.from('desktop_auth_handoffs').delete().lt('expires_at', new Date(Date.now() - 10 * 60_000).toISOString());
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
  return { code, expiresAt };
});

on('POST', '/api/desktop/exchange-handoff', async ({ request }) => {
  rateLimitRequest(request, 'desktop-exchange', { limit: 20, windowMs: 60_000 });
  const body = await readJson(request);
  const code = typeof body?.code === 'string' ? body.code : '';
  const state = typeof body?.state === 'string' ? body.state : '';
  if (code.length < 20 || state.length < 32) throw new ApiError(400, 'Invalid handoff.', 'INVALID_HANDOFF');
  const admin = adminClient();
  const { data: row, error } = await admin.from('desktop_auth_handoffs').select('*').eq('code_hash', sha256(code)).maybeSingle();
  if (error) throw error;
  if (!row) throw new ApiError(404, 'Handoff not found.', 'HANDOFF_NOT_FOUND');
  if (row.used_at) throw new ApiError(409, 'Handoff already used.', 'HANDOFF_USED');
  if (row.state_hash !== sha256(state)) throw new ApiError(403, 'State mismatch.', 'STATE_MISMATCH');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new ApiError(410, 'Handoff expired.', 'HANDOFF_EXPIRED');
  const payload = decryptSession(row);
  if (payload.expiresAt < Date.now() || payload.userId !== row.user_id) throw new ApiError(410, 'Handoff expired.', 'HANDOFF_EXPIRED');
  const { data: userResult, error: userError } = await admin.auth.getUser(payload.accessToken);
  if (userError || !userResult?.user) throw new ApiError(401, 'Session expired.', 'SESSION_EXPIRED');
  const mark = await admin.from('desktop_auth_handoffs').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id').maybeSingle();
  if (mark.error || !mark.data) throw new ApiError(409, 'Handoff already used.', 'HANDOFF_USED');
  const account = await accountStateForUser(row.user_id);
  return {
    session: { accessToken: payload.accessToken, refreshToken: payload.refreshToken },
    user: { id: userResult.user.id, email: userResult.user.email || null },
    account,
  };
});

on('POST', '/api/desktop/refresh', async ({ request }) => {
  rateLimitRequest(request, 'desktop-refresh', { limit: 60, windowMs: 60_000 });
  const body = await readJson(request);
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
  if (!refreshToken) throw new ApiError(400, 'Missing refresh token.', 'MISSING_REFRESH_TOKEN');
  const client = publicServerClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) throw new ApiError(401, 'Session could not be refreshed.', 'SESSION_EXPIRED');
  const account = await accountStateForUser(data.user.id);
  return {
    session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
    user: { id: data.user.id, email: data.user.email || null },
    account,
  };
});

on('POST', '/api/desktop/update-profile', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const body = await readJson(request);
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 60) : '';
  const username = typeof body?.username === 'string' ? body.username.trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32) : '';
  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata || {}), display_name: displayName, username },
  });
  if (error) throw error;
  await admin.from('profiles').update({ display_name: displayName || null }).eq('id', user.id);
  return {
    user: {
      id: data.user.id,
      email: data.user.email || null,
      displayName: data.user.user_metadata?.display_name || '',
      username: data.user.user_metadata?.username || '',
    },
  };
});
