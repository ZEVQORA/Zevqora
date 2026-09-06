import crypto from 'node:crypto';

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Connection tokens: `zqt_<prefix>_<secret>`.
 * - 8-char prefix is stored in clear for lookup and display.
 * - 32 random bytes of secret, base64url. Only the SHA-256 hash is stored.
 * - The full token is shown exactly once, at creation.
 */
export function generateConnectionToken() {
  const prefix = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);
  const secret = crypto.randomBytes(32).toString('base64url');
  const token = `zqt_${prefix}_${secret}`;
  return { token, prefix, last4: secret.slice(-4), hash: sha256(token) };
}

export function parseConnectionToken(raw) {
  const match = /^zqt_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{40,60})$/.exec(String(raw || '').trim());
  if (!match) return null;
  return { prefix: match[1], hash: sha256(raw.trim()) };
}

export function generateInviteToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, hash: sha256(token) };
}

export function newRequestId() {
  return crypto.randomUUID();
}
