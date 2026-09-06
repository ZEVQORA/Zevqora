/**
 * HTTP helpers shared by every API route.
 *
 * Every response is JSON, never cached, and every error passes through
 * ApiError so provider/database internals are never echoed to the client.
 */
export class ApiError extends Error {
  constructor(status, message, code = undefined, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function noContent(extraHeaders = {}) {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...extraHeaders } });
}

export function methodNotAllowed(allow = 'POST') {
  return json({ error: 'Method not allowed' }, 405, { allow });
}

const DEFAULT_MAX_BYTES = 1_000_000;

export async function readJson(request, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw new ApiError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE');
  let text;
  try {
    text = await request.text();
  } catch {
    throw new ApiError(400, 'Could not read request body.', 'BAD_BODY');
  }
  if (text.length > maxBytes) throw new ApiError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.', 'BAD_JSON');
  }
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function clientIp(request) {
  return (
    request.headers.get('x-real-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

export function str(value, { max = 200, min = 0, name = 'value', required = false, pattern = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `${name} is required.`, 'VALIDATION');
    return '';
  }
  if (typeof value !== 'string') throw new ApiError(400, `${name} must be a string.`, 'VALIDATION');
  const out = value.trim();
  if (out.length < min) throw new ApiError(400, `${name} must be at least ${min} characters.`, 'VALIDATION');
  if (out.length > max) throw new ApiError(400, `${name} must be at most ${max} characters.`, 'VALIDATION');
  if (pattern && !pattern.test(out)) throw new ApiError(400, `${name} has an invalid format.`, 'VALIDATION');
  return out;
}

export function num(value, { min = -Infinity, max = Infinity, name = 'value', required = false, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `${name} is required.`, 'VALIDATION');
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new ApiError(400, `${name} must be a number.`, 'VALIDATION');
  if (integer && !Number.isInteger(n)) throw new ApiError(400, `${name} must be an integer.`, 'VALIDATION');
  if (n < min || n > max) throw new ApiError(400, `${name} must be between ${min} and ${max}.`, 'VALIDATION');
  return n;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Boolean(value);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(value, name = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ApiError(400, `${name} is not a valid identifier.`, 'VALIDATION');
  return value.toLowerCase();
}

export function slugify(input, fallback = 'workspace') {
  const base = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : fallback;
}
