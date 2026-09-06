import crypto from 'node:crypto';

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk-or-[A-Za-z0-9_-]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gh[oprsu]_[A-Za-z0-9]{20,}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /zqt_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{40,60}/g,
];

const SENSITIVE_KEY = /(api[_-]?key|secret|password|passwd|token|authorization|cookie|private[_-]?key|credential)/i;

export function redactSecrets(text) {
  let out = String(text);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

const MAX_SAMPLE_CHARS = 16_000;
const MAX_MESSAGES = 40;
const MAX_OUTPUT_CHARS = 8_000;

function cleanContent(content, budget) {
  if (typeof content === 'string') {
    const redacted = redactSecrets(content);
    return redacted.length > budget ? redacted.slice(0, budget) + '…[truncated]' : redacted;
  }
  if (Array.isArray(content)) {
    // Multimodal content: keep text parts only. Images and files are never stored.
    const text = content
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    return cleanContent(text, budget);
  }
  return '';
}

/**
 * A telemetry sample is optional, opt-in, and always sanitized:
 * - only role/content text survive; tool payloads, images and files are dropped;
 * - known secret shapes are redacted; sensitive keys are removed;
 * - total size is capped so a single event can never become bulk storage.
 * Returns null when nothing usable remains.
 */
export function sanitizeSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const messages = Array.isArray(sample.messages) ? sample.messages.slice(-MAX_MESSAGES) : [];
  let budget = MAX_SAMPLE_CHARS;
  const cleanMessages = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = ['system', 'user', 'assistant', 'developer'].includes(m.role) ? m.role : null;
    if (!role) continue;
    const content = cleanContent(m.content, Math.max(0, budget));
    budget -= content.length;
    if (content) cleanMessages.push({ role, content });
    if (budget <= 0) break;
  }
  const output = typeof sample.output === 'string' ? cleanContent(sample.output, MAX_OUTPUT_CHARS) : '';
  if (!cleanMessages.length && !output) return null;
  const out = { messages: cleanMessages };
  if (output) out.output = output;
  if (sample.response_format && typeof sample.response_format === 'object' && typeof sample.response_format.type === 'string') {
    out.response_format = { type: sample.response_format.type.slice(0, 40) };
  }
  return out;
}

const MAX_META_BYTES = 2_048;

export function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === 'string') out[key.slice(0, 60)] = redactSecrets(value).slice(0, 300);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key.slice(0, 60)] = value;
    if (JSON.stringify(out).length > MAX_META_BYTES) {
      delete out[key.slice(0, 60)];
      break;
    }
  }
  return out;
}

export function promptHashFromMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  const canonical = canonicalJson(messages.map((m) => ({ role: m.role, content: m.content })));
  return sha256(canonical);
}

export function outputHash(output) {
  if (typeof output !== 'string' || !output.length) return null;
  return sha256(output.trim());
}
