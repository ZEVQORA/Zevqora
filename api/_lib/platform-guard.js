/**
 * Request guard for the platform completion proxy.
 *
 * ZEVQORA Desktop never holds the provider credential. The local engine sends
 * an OpenAI/OpenRouter-shaped chat completion to /api/platform/chat/completions
 * with the user's Supabase access token; this module normalizes and bounds that
 * request before it is forwarded. Everything unknown is dropped, everything
 * unbounded is capped, and streaming is refused so usage can be accounted.
 */
import { ApiError } from './http.js';

export const MAX_MESSAGES = 200;
export const MAX_TOTAL_CHARS = 400_000;
export const MAX_TOOLS = 32;
export const MAX_OUTPUT_TOKENS = 4096;
export const DEFAULT_OUTPUT_TOKENS = 1024;

const MODEL_RE = /^[a-z0-9][a-z0-9._:/-]{1,159}$/i;
const ROLES = new Set(['system', 'user', 'assistant', 'tool', 'developer']);

function fail(message) {
  throw new ApiError(400, message, 'VALIDATION');
}

function textOf(content, where) {
  if (content === null || content === undefined) return null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') fail(`${where}: content parts must be objects.`);
      if (part.type !== 'text' || typeof part.text !== 'string') fail(`${where}: only text content parts are supported.`);
      parts.push(part.text);
    }
    return parts.join('\n');
  }
  fail(`${where}: content must be a string or an array of text parts.`);
  return null;
}

function normalizeToolCalls(raw, where) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS) fail(`${where}: tool_calls must be an array of at most ${MAX_TOOLS}.`);
  return raw.map((call, i) => {
    if (!call || typeof call !== 'object') fail(`${where}: tool_calls[${i}] is invalid.`);
    const fn = call.function;
    if (!fn || typeof fn !== 'object' || typeof fn.name !== 'string' || !fn.name) fail(`${where}: tool_calls[${i}].function.name is required.`);
    const args = fn.arguments === undefined ? '{}' : typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments);
    if (args.length > 50_000) fail(`${where}: tool_calls[${i}] arguments are too large.`);
    return { id: String(call.id || `call_${i}`).slice(0, 120), type: 'function', function: { name: fn.name.slice(0, 120), arguments: args } };
  });
}

function normalizeTools(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) fail('tools must be an array.');
  if (raw.length > MAX_TOOLS) fail(`At most ${MAX_TOOLS} tools are allowed.`);
  const out = raw.map((tool, i) => {
    const fn = tool?.function;
    if (!fn || typeof fn !== 'object' || typeof fn.name !== 'string' || !fn.name) fail(`tools[${i}].function.name is required.`);
    const clean = { type: 'function', function: { name: fn.name.slice(0, 120) } };
    if (typeof fn.description === 'string') clean.function.description = fn.description.slice(0, 2000);
    if (fn.parameters && typeof fn.parameters === 'object') clean.function.parameters = fn.parameters;
    return clean;
  });
  if (JSON.stringify(out).length > 200_000) fail('Tool definitions are too large.');
  return out;
}

function normalizeToolChoice(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (raw === 'auto' || raw === 'none' || raw === 'required') return raw;
  if (raw && typeof raw === 'object' && raw.type === 'function' && typeof raw.function?.name === 'string') {
    return { type: 'function', function: { name: raw.function.name.slice(0, 120) } };
  }
  fail('tool_choice is invalid.');
  return undefined;
}

function normalizeResponseFormat(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== 'object') fail('response_format is invalid.');
  if (raw.type === 'text') return undefined;
  if (raw.type === 'json_object') return { type: 'json_object' };
  if (raw.type === 'json_schema' && raw.json_schema && typeof raw.json_schema === 'object') {
    if (JSON.stringify(raw.json_schema).length > 50_000) fail('response_format.json_schema is too large.');
    return { type: 'json_schema', json_schema: raw.json_schema };
  }
  fail('response_format.type must be text, json_object or json_schema.');
  return undefined;
}

function clampNumber(value, { name, min, max, fallback }) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${name} must be a number.`);
  return Math.min(max, Math.max(min, n));
}

/**
 * Returns a bounded OpenRouter payload. Throws ApiError(400) on anything that
 * cannot be forwarded safely.
 */
export function validateCompletionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be a JSON object.');
  if (body.stream === true) throw new ApiError(400, 'Streaming is not available through the platform proxy.', 'STREAMING_UNSUPPORTED');

  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!MODEL_RE.test(model)) fail('model is missing or malformed.');

  if (!Array.isArray(body.messages) || !body.messages.length) fail('messages must be a non-empty array.');
  if (body.messages.length > MAX_MESSAGES) fail(`At most ${MAX_MESSAGES} messages are allowed.`);

  let totalChars = 0;
  const messages = body.messages.map((m, i) => {
    const where = `messages[${i}]`;
    if (!m || typeof m !== 'object') fail(`${where} must be an object.`);
    if (!ROLES.has(m.role)) fail(`${where}.role is invalid.`);
    const role = m.role === 'developer' ? 'system' : m.role;
    const content = textOf(m.content, where);
    const out = { role, content };
    if (typeof m.name === 'string' && m.name) out.name = m.name.slice(0, 120);
    if (role === 'tool') {
      if (typeof m.tool_call_id !== 'string' || !m.tool_call_id) fail(`${where}.tool_call_id is required for tool messages.`);
      out.tool_call_id = m.tool_call_id.slice(0, 120);
    }
    if (role === 'assistant') {
      const calls = normalizeToolCalls(m.tool_calls, where);
      if (calls) out.tool_calls = calls;
    }
    if (out.content === null && !out.tool_calls) fail(`${where}.content is required.`);
    totalChars += (out.content || '').length + (out.tool_calls ? JSON.stringify(out.tool_calls).length : 0);
    return out;
  });
  if (totalChars > MAX_TOTAL_CHARS) throw new ApiError(413, `Conversation is too large (${totalChars} characters; limit ${MAX_TOTAL_CHARS}).`, 'PAYLOAD_TOO_LARGE');

  const payload = {
    model,
    messages,
    max_tokens: Math.floor(clampNumber(body.max_tokens, { name: 'max_tokens', min: 1, max: MAX_OUTPUT_TOKENS, fallback: DEFAULT_OUTPUT_TOKENS })),
    temperature: clampNumber(body.temperature, { name: 'temperature', min: 0, max: 2, fallback: 0.2 }),
    stream: false,
    usage: { include: true },
  };
  const topP = clampNumber(body.top_p, { name: 'top_p', min: 0, max: 1, fallback: null });
  if (topP !== null) payload.top_p = topP;
  if (body.seed !== undefined && body.seed !== null) {
    const seed = Number(body.seed);
    if (!Number.isInteger(seed)) fail('seed must be an integer.');
    payload.seed = seed;
  }
  const tools = normalizeTools(body.tools);
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = normalizeToolChoice(body.tool_choice) || 'auto';
  }
  const responseFormat = normalizeResponseFormat(body.response_format);
  if (responseFormat) payload.response_format = responseFormat;
  return { payload, totalChars };
}

/** Requests per minute allowed through the proxy for a plan. */
export function rpmForPlan(planId, limits = {}) {
  const configured = Number(limits?.platform_rpm);
  if (Number.isFinite(configured) && configured > 0) return Math.min(600, Math.floor(configured));
  if (planId === 'free') return 20;
  if (planId === 'starter') return 60;
  return 120;
}
