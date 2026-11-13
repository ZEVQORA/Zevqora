/**
 * Rate limits for the public Ask Zev route.
 *
 * Two layers:
 *  1. an in-memory counter per warm instance (cheap first line, always on);
 *  2. a durable counter in Postgres (`public_rate_limit_hit`, migration 021)
 *     shared by every serverless instance.
 *
 * Bucket keys carry a keyed hash of the client address, never the address.
 * When the durable layer is unavailable (no Supabase env, migration not
 * applied, network error) the caller learns `durable: false`; the route then
 * still serves FAQ answers but keeps generative answers off.
 */
import { createHash, createHmac } from 'node:crypto';
import { ApiError, clientIp } from '../http.js';
import { rateLimit } from '../auth.js';
import { adminClient } from '../supabase.js';

export const SUPPORT_LIMITS = {
  /** Per visitor, per instance (memory). */
  memoryPerMinute: 10,
  /** Per visitor, all instances. */
  perMinute: 8,
  perDay: 80,
  /** Generative answers for the whole deployment per UTC day unless overridden. */
  aiPerDayDefault: 300,
};

let clientForTests = null;
/** Test hook: a supabase-js-shaped client with `rpc`, or null to restore the default. */
export function setSupportLimiterClient(client) {
  clientForTests = client;
}

function limiterClient() {
  if (clientForTests) return clientForTests;
  return adminClient();
}

function hashSecret() {
  const explicit = process.env.SECURITY_HASH_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  // Stable across instances (unlike a per-process random secret) and still secret.
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (service) return createHash('sha256').update(`zevqora-public-rate-limit:${service}`).digest('hex');
  return null;
}

/** Opaque visitor id for bucket keys: HMAC of the client address, truncated. */
export function visitorKey(request) {
  const ip = clientIp(request);
  const secret = hashSecret();
  if (!secret) return createHash('sha256').update(`unkeyed:${ip}`).digest('hex').slice(0, 24);
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 24);
}

/** One durable hit. Resolves true/false, or null when the durable layer cannot answer. */
async function durableHit(bucket, limit, windowSeconds) {
  try {
    const { data, error } = await limiterClient().rpc('public_rate_limit_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
    if (error || typeof data !== 'boolean') return null;
    return data;
  } catch {
    return null;
  }
}

const tooMany = () => new ApiError(429, 'You are sending messages quickly. Wait a moment and try again.', 'RATE_LIMITED');

/**
 * Per-visitor checks for every message. Throws 429 when a limit is exceeded.
 * Returns whether the durable layer answered, which gates generative answers.
 */
export async function checkVisitorLimits(request) {
  const visitor = visitorKey(request);
  try {
    rateLimit(`support:${visitor}`, { limit: SUPPORT_LIMITS.memoryPerMinute, windowMs: 60_000 });
  } catch {
    throw tooMany();
  }
  const [minute, day] = await Promise.all([
    durableHit(`support:ip:${visitor}:m`, SUPPORT_LIMITS.perMinute, 60),
    durableHit(`support:ip:${visitor}:d`, SUPPORT_LIMITS.perDay, 86_400),
  ]);
  if (minute === false || day === false) throw tooMany();
  return { durable: minute !== null && day !== null };
}

export function aiDailyCap() {
  const raw = Number(process.env.PUBLIC_SUPPORT_AI_DAILY_CAP);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 100_000) return raw;
  return SUPPORT_LIMITS.aiPerDayDefault;
}

/** Spends one unit of the deployment-wide generative budget. False when spent or unknown. */
export async function takeAiBudget() {
  const cap = aiDailyCap();
  if (cap === 0) return false;
  const day = new Date().toISOString().slice(0, 10);
  const ok = await durableHit(`support:ai:${day}`, cap, 86_400);
  return ok === true;
}
