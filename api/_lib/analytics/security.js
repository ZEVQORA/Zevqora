/**
 * Security operations boundary. Separate from analytics: it may correlate
 * repeat sources, so it keeps a truncated IP prefix and a keyed hash (never the
 * address), is readable only through admin routes whose reads are audited, and
 * is purged after 90 days by the daily cron.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { clientIp } from '../http.js';
import { adminClient } from '../supabase.js';

export const SECURITY_RETENTION_DAYS = 90;
const PROCESS_SECRET = randomBytes(32).toString('hex');

let clientOverride = null;
/** Tests point the recorder at their database; production uses the service-role client. */
export function setSecurityClient(client) {
  clientOverride = client;
}
function client() {
  return clientOverride || adminClient();
}

export function ipPrefix(ip) {
  if (!ip || ip === 'unknown') return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) {
    const parts = ip.split(':').filter((p, i, a) => p !== '' || i === 0 || i === a.length - 1);
    return parts.slice(0, 3).join(':') + '::/48';
  }
  return null;
}

export function ipHash(ip) {
  if (!ip || ip === 'unknown') return null;
  const key = process.env.SECURITY_HASH_SECRET && process.env.SECURITY_HASH_SECRET.length >= 32 ? process.env.SECURITY_HASH_SECRET : PROCESS_SECRET;
  return createHmac('sha256', key).update(ip).digest('hex');
}

const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Route without ids, tokens or query strings. */
export function routeTemplate(pathname) {
  return String(pathname || '')
    .split('?')[0]
    .replace(UUIDISH, ':id')
    .split('/')
    .map((s) => (/^[A-Za-z0-9_-]{24,}$/.test(s) ? ':token' : s))
    .join('/')
    .slice(0, 200);
}

/** The kind an API error maps to, or null when it is not a security signal. */
export function classify(error, status) {
  if (error?.security) return { kind: error.security, severity: error.security === 'cross_workspace_denied' ? 'medium' : 'low' };
  if (status >= 500) return { kind: 'unexpected_error', severity: 'medium' };
  switch (error?.code) {
    case 'INVALID_CREDENTIALS':
      return { kind: 'auth_failed', severity: 'low' };
    case 'ACCOUNT_SUSPENDED':
      return { kind: 'account_suspended', severity: 'medium' };
    case 'FORBIDDEN':
      return { kind: 'authz_denied', severity: 'low' };
    case 'RATE_LIMITED':
      return { kind: 'rate_limited', severity: 'low' };
    default:
      return null;
  }
}

// At most a handful of identical signals per source per minute: a flood is one signal, not a write storm.
const throttle = new Map();
function allowed(key) {
  const now = Date.now();
  const b = throttle.get(key) || { n: 0, reset: now + 60_000 };
  if (now > b.reset) {
    b.n = 0;
    b.reset = now + 60_000;
  }
  b.n += 1;
  throttle.set(key, b);
  if (throttle.size > 5000) for (const [k, v] of throttle) if (v.reset < now) throttle.delete(k);
  return b.n <= 5;
}
export function resetSecurityThrottle() {
  throttle.clear();
}

/** Writes one event; never throws. Metadata keys that look like secrets are redacted. */
export async function recordSecurityEvent(request, { kind, severity = 'info', status = null, code = null, actorId = null, workspaceId = null, metadata = {} }) {
  try {
    // Tests never reach a real project: without an explicit test client nothing is written.
    if (!clientOverride && process.env.VITEST) return false;
    const url = new URL(request.url);
    const ip = clientIp(request);
    const hash = ipHash(ip);
    if (!allowed(`${kind}:${hash || 'none'}:${routeTemplate(url.pathname)}`)) return false;
    const safe = JSON.parse(JSON.stringify(metadata || {}, (k, v) => (/(secret|token|password|key|authorization|cookie)/i.test(k) ? '[redacted]' : v)));
    const { error } = await client().from('security_events').insert({
      kind,
      severity,
      method: request.method.toUpperCase(),
      route: routeTemplate(url.pathname),
      status,
      code: code ? String(code).slice(0, 60) : null,
      actor_id: actorId,
      workspace_id: workspaceId,
      ip_prefix: ipPrefix(ip),
      ip_hash: hash,
      metadata: safe,
    });
    return !error;
  } catch {
    return false;
  }
}
