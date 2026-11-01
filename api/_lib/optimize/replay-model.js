/**
 * Deterministic request-stream models shared by the passes (estimates), the
 * search (first-order effects) and the composed executor (replay). One
 * definition of "cache hit" and "validated lookup hit" everywhere, so an
 * estimate and a replay can only differ in what they measure, not in what
 * they assume.
 */
import { sha256Json, sha256Text } from '../product/hashing.js';
import { reuseIdentityHash, unsafeForReuse } from '../product/fingerprints.js';

const meta = (t) => (t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata) ? t.metadata : {});
export const timeMs = (t) => (t.timestamp ? Date.parse(t.timestamp) : null);

/** Request order: timestamp, then request id, then row id. Rows without a timestamp sort last. */
export function streamOrder(a, b) {
  const ta = timeMs(a);
  const tb = timeMs(b);
  if (ta !== tb) return ta === null ? 1 : tb === null ? -1 : ta - tb;
  return String(a.request_id || '').localeCompare(String(b.request_id || '')) || String(a.id).localeCompare(String(b.id));
}

export const STANDARD_TTLS_MS = Object.freeze([5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 3_600_000, 24 * 3_600_000]);
export const ttlLabel = (ms) => (ms === null ? 'no expiry' : ms >= 3_600_000 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`);

/** Cache key: the existing exact-reuse identity (input, prompt, model, config). */
export const cacheKey = (t) => reuseIdentityHash(t);

/** Lookup key: the task identity without the model (a lookup replaces the model). */
export function lookupKey(t) {
  const m = meta(t);
  const input = t.input_hash || sha256Text(t.input_text);
  if (!input) return null;
  return sha256Json({ symbol: t.symbol || '', workflow: t.workflow || '', input_hash: input, system_prompt_hash: t.system_prompt_hash || m.system_prompt_hash || sha256Text(m.system_prompt) || sha256Text(t.system_prompt) || null, response_format: m.response_format ?? null });
}

const norm = (v) => (v === null || v === undefined ? null : String(v).trim().toLowerCase());
export const LABEL = /^[A-Za-z0-9_\-:.]{1,40}$/;

/**
 * A cache in front of one call site. `decide(t)` → { hit, entry } before the
 * call; `write(t, value)` after a miss. An entry expires `ttlMs` after it was
 * written (a hit does not refresh it); ttlMs = null means no expiry.
 */
export function responseCache(ttlMs) {
  const entries = new Map();
  return {
    decide(t) {
      const k = cacheKey(t);
      if (!k || unsafeForReuse(t)) return { hit: false, key: k, eligible: false };
      const e = entries.get(k);
      const now = timeMs(t);
      if (e && (ttlMs === null || (now !== null && e.at !== null && now - e.at <= ttlMs))) return { hit: true, key: k, entry: e, eligible: true };
      return { hit: false, key: k, eligible: true };
    },
    write(t, value) {
      const k = cacheKey(t);
      if (!k || unsafeForReuse(t)) return;
      entries.set(k, { ...value, at: timeMs(t), source_trace_id: t.id });
    },
  };
}

/**
 * Validated exact lookup: built only from EARLIER labelled history (never from
 * the request being answered). A key answers when it has at least
 * `minValidated` earlier observations whose recorded output matched their
 * label, and every such observation agrees.
 */
export function validatedLookup(history, { minValidated = 1 } = {}) {
  const byKey = new Map();
  for (const h of [...history].sort(streamOrder)) {
    const k = lookupKey(h);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(h);
  }
  return {
    decide(t) {
      const k = lookupKey(t);
      if (!k || t.protected) return { hit: false, key: k, eligible: false };
      const now = timeMs(t);
      // Strictly earlier in time: an observation never answers itself or a request made at the same moment.
      const prior = (byKey.get(k) || []).filter((h) => h.id !== t.id && streamOrder(h, t) < 0 && now !== null && timeMs(h) !== null && timeMs(h) < now);
      const validated = prior.filter((h) => h.output_text !== null && h.output_text !== undefined && h.expected_output !== null && h.expected_output !== undefined && norm(h.output_text) === norm(h.expected_output) && LABEL.test(String(h.output_text).trim()));
      const values = new Set(validated.map((h) => norm(h.output_text)));
      if (validated.length < minValidated || values.size !== 1) return { hit: false, key: k, eligible: true, validated: validated.length, disagreement: values.size > 1 };
      return { hit: true, key: k, eligible: true, output: String(validated[validated.length - 1].output_text).trim(), source_trace_id: validated[validated.length - 1].id, validated: validated.length };
    },
  };
}

/** Repeat intervals (ms) between consecutive equal cache keys, for TTL choice. */
export function repeatIntervals(rows) {
  const last = new Map();
  const gaps = [];
  for (const t of [...rows].sort(streamOrder)) {
    const k = cacheKey(t);
    const at = timeMs(t);
    if (!k || at === null) continue;
    if (last.has(k)) gaps.push(at - last.get(k));
    last.set(k, at);
  }
  return gaps;
}

/** Simulated hits of a response cache over recorded rows (for estimates only). */
export function simulateCache(rows, ttlMs) {
  const cache = responseCache(ttlMs);
  const hits = [];
  for (const t of [...rows].sort(streamOrder)) {
    const d = cache.decide(t);
    if (d.hit) hits.push(t.id);
    else if (d.eligible) cache.write(t, { output_text: t.output_text });
  }
  return hits;
}

export function simulateLookup(rows, history) {
  const lookup = validatedLookup(history);
  return [...rows].sort(streamOrder).filter((t) => lookup.decide(t).hit).map((t) => t.id);
}
