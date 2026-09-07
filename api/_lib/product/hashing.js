import { createHash } from 'node:crypto';

/** Stable SHA-256 of UTF-8 text. Empty/whitespace-only → null. */
export function sha256Text(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text.trim()) return null;
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  return JSON.stringify(value);
}

/** Stable SHA-256 of canonical JSON (sorted keys, compact separators). */
export function sha256Json(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

/** Deterministic UUID-shaped id derived from a name (version 5 style layout). */
export function deterministicUuid(name) {
  const hex = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
