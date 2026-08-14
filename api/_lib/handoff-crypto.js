import crypto from 'node:crypto';

function key() {
  const raw = process.env.DESKTOP_HANDOFF_SECRET || '';
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('DESKTOP_HANDOFF_SECRET must be a 32-byte base64 value.');
  }
  return buf;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomCode(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function encryptSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

export function decryptSession(record) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(record.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(clear.toString('utf8'));
}
