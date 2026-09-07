import { ApiError } from './http.js';

/**
 * OpenRouter access. The platform credential lives only in OPENROUTER_API_KEY
 * on the server; it is never returned, logged, or embedded anywhere else.
 */
export function openRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function baseUrl() {
  return (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
}

function siteUrl() {
  return process.env.PUBLIC_APP_URL || 'https://zevqora.vercel.app';
}

function sanitizeProviderError(status, body) {
  const message = typeof body?.error?.message === 'string' ? body.error.message : '';
  const short = message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]').slice(0, 160);
  if (status === 401 || status === 403) return 'The platform provider credential was rejected.';
  if (status === 402) return 'The platform provider account has insufficient credit.';
  if (status === 404) return `Model unavailable at the provider.${short ? ' ' + short : ''}`;
  if (status === 429) return 'Provider rate limit reached. Retry shortly.';
  return `Provider error (${status}).${short ? ' ' + short : ''}`;
}

/**
 * Forwards one bounded, non-streaming chat completion and returns the raw
 * provider body. Retries once on 429/5xx/timeouts only, never after a 2xx body
 * was received. The credential is attached here and nowhere else.
 */
export async function forwardChatCompletion(payload, { timeoutMs = 60_000 } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ApiError(503, 'Cloud replay is not configured on this deployment yet.', 'PROVIDER_NOT_CONFIGURED');
  const body = { ...payload, stream: false, usage: { include: true } };

  let attempt = 0;
  let lastError = null;
  while (attempt < 2) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': siteUrl(),
          'X-Title': 'ZEVQORA',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      let parsed = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new ApiError(502, sanitizeProviderError(res.status, parsed), 'PROVIDER_ERROR', { status: res.status });
        if (retryable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
          continue;
        }
        throw lastError;
      }
      if (!parsed || typeof parsed !== 'object') throw new ApiError(502, 'The provider returned an unreadable response.', 'PROVIDER_ERROR');
      return { body: parsed, latencyMs, attempt };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = new ApiError(504, 'The provider did not respond in time.', 'PROVIDER_TIMEOUT');
      if (attempt >= 2) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new ApiError(502, 'Provider request failed.', 'PROVIDER_ERROR');
}

/**
 * One chat completion with usage accounting, flattened for the replay engine.
 */
export async function chatCompletion({ model, messages, maxTokens = 512, temperature = 0, responseFormat = null, timeoutMs = 30_000 }) {
  const payload = {
    model,
    messages,
    max_tokens: Math.max(1, Math.min(4096, Math.floor(maxTokens))),
    temperature,
  };
  if (responseFormat?.type === 'json_object') payload.response_format = { type: 'json_object' };
  const { body, latencyMs, attempt } = await forwardChatCompletion(payload, { timeoutMs });
  const choice = body?.choices?.[0];
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const usage = body?.usage || {};
  const inputTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const outputTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens || 0);
  const cost = Number.isFinite(usage.cost) ? Number(usage.cost) : null;
  return {
    content,
    finishReason: choice?.finish_reason || null,
    model: body?.model || model,
    requestId: body?.id || null,
    latencyMs,
    inputTokens,
    outputTokens,
    cachedInputTokens: cached,
    cost,
    costSource: cost === null ? 'unavailable' : 'provider_reported',
    attempt,
  };
}
