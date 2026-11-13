/**
 * Engineering Zev on the Anthropic Claude API (server only).
 *
 * - The credential lives only in ANTHROPIC_API_KEY on the server. It is never
 *   returned, logged, or sent to the browser; errors are mapped to sanitized
 *   messages before they leave this module.
 * - Tools are the same read-only, server-scoped loaders as the OpenRouter path
 *   (product/zev.js executeTool). The model chooses which tool to call, but
 *   every loader is already bound to the product the server authorized; ids in
 *   model output are ignored.
 * - Bounded: at most MAX_STEPS model calls per request, a per-call timeout, one
 *   SDK retry, and a capped output size. Requests are non-streaming (the API
 *   router returns JSON); the caller's AbortSignal cancels the provider call.
 * - The model never sets a verdict: tools only read recorded evaluations.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from './http.js';
import { SYSTEM_PROMPT, executeTool } from './product/zev.js';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const MODEL_RE = /^claude-[a-z0-9.-]{1,60}$/;
export const CLAUDE_LIMITS = { maxSteps: 4, maxTokens: 8000, timeoutMs: 45_000 };

export function anthropicConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function claudeModel() {
  const m = process.env.ENGINEERING_ZEV_MODEL;
  return m && MODEL_RE.test(m) ? m : DEFAULT_CLAUDE_MODEL;
}

/**
 * Which provider serves Engineering Zev: ENGINEERING_ZEV_PROVIDER pins it
 * ('anthropic' | 'openrouter'); otherwise Claude when its key is set, then the
 * OpenRouter platform path, else none.
 */
export function engineeringZevProvider({ openRouterConfigured }) {
  const pinned = process.env.ENGINEERING_ZEV_PROVIDER;
  if (pinned === 'anthropic') return anthropicConfigured() ? 'anthropic' : 'none';
  if (pinned === 'openrouter') return openRouterConfigured ? 'openrouter' : 'none';
  if (anthropicConfigured()) return 'anthropic';
  return openRouterConfigured ? 'openrouter' : 'none';
}

const productInput = { type: 'object', properties: { product_id: { type: 'string', description: 'Ignored by the server; the selected product is used.' } }, additionalProperties: false };

/** Read-only tools, Anthropic format. Mirrors product/zev.js TOOL_DEFINITIONS. */
export const CLAUDE_TOOLS = [
  { name: 'workspace_summary', description: 'Get the selected product (workload) and its scan status.', input_schema: productInput },
  { name: 'list_ai_calls', description: 'List detected AI call sites from the latest scan.', input_schema: productInput },
  { name: 'list_findings', description: 'List potential waste or optimization findings. Static findings are never verified savings.', input_schema: productInput },
  { name: 'economics_summary', description: 'Get observed cost and verified savings from imported evidence. Missing values are null, not zero.', input_schema: productInput },
  { name: 'list_experiments', description: 'List recorded replay/evaluation runs with their deterministic gate verdicts and rejection reasons.', input_schema: productInput },
];

let clientForTests = null;
/** Test hook: inject an object with `messages.create(params, options)`. */
export function setAnthropicClientForTests(client) {
  clientForTests = client;
}

function client() {
  if (clientForTests) return clientForTests;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: CLAUDE_LIMITS.timeoutMs, maxRetries: 1 });
}

/** Maps SDK errors to sanitized API errors (no provider body, no key material). */
export function mapAnthropicError(error) {
  if (error instanceof ApiError) return error;
  if (error?.name === 'AbortError' || error instanceof Anthropic.APIUserAbortError) return new ApiError(499, 'The request was cancelled.', 'CANCELLED');
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new ApiError(502, 'The Claude provider rejected the server credential.', 'PROVIDER_AUTH');
  if (error instanceof Anthropic.RateLimitError) return new ApiError(429, 'The Claude provider is rate limiting this deployment. Retry shortly.', 'PROVIDER_RATE_LIMITED');
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return new ApiError(502, 'The Claude provider refused the request configuration.', 'PROVIDER_CONFIG');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ApiError(504, 'The Claude provider did not respond in time.', 'PROVIDER_TIMEOUT');
  if (error instanceof Anthropic.InternalServerError || (error instanceof Anthropic.APIError && Number(error.status) >= 500)) return new ApiError(503, 'The Claude provider is temporarily unavailable.', 'PROVIDER_UNAVAILABLE');
  if (error instanceof Anthropic.APIConnectionError) return new ApiError(503, 'Could not reach the Claude provider.', 'PROVIDER_UNAVAILABLE');
  return new ApiError(502, 'The Claude provider returned an unexpected error.', 'PROVIDER_ERROR');
}

const textOf = (content) =>
  content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/**
 * Tool loop on Claude. `ctx` holds loaders bound to the authorized product.
 * Returns { message, model, provider, tool_events, usage, stop_reason }.
 */
export async function runZevClaude({ ctx, history, productId, signal }) {
  const model = claudeModel();
  const system = productId ? `${SYSTEM_PROMPT}\n\nThe selected ZEVQORA product_id is ${productId}. Tools always read that product.` : SYSTEM_PROMPT;
  /** @type {import('@anthropic-ai/sdk').default.MessageParam[]} */
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const events = [];
  const usage = { input_tokens: 0, output_tokens: 0, model_calls: 0 };
  const api = client();

  for (let step = 0; step < CLAUDE_LIMITS.maxSteps; step += 1) {
    let res;
    try {
      res = await api.beta.messages.create(
        {
          model,
          max_tokens: CLAUDE_LIMITS.maxTokens,
          system,
          tools: CLAUDE_TOOLS,
          tool_choice: { type: 'auto' },
          output_config: { effort: 'medium' },
          messages,
          // Safety declines are re-run on a fallback model chosen by the API.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }
    usage.model_calls += 1;
    usage.input_tokens += Number(res.usage?.input_tokens || 0);
    usage.output_tokens += Number(res.usage?.output_tokens || 0);

    if (res.stop_reason === 'refusal') {
      return { message: 'Zev declined this request. Rephrase it as a question about this workspace’s evidence.', model: res.model || model, provider: 'anthropic', tool_events: events, usage, stop_reason: 'refusal' };
    }
    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = textOf(res.content);
      const truncated = res.stop_reason === 'max_tokens';
      return {
        message: (text || 'I finished without a text answer.') + (truncated ? '\n\n(Answer cut at the length limit.)' : ''),
        model: res.model || model,
        provider: 'anthropic',
        tool_events: events,
        usage,
        stop_reason: res.stop_reason,
      };
    }
    // Keep every block (including thinking) exactly as returned.
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const call of toolUses) {
      try {
        const [payload, summary] = await executeTool(ctx, call.name);
        events.push({ name: call.name, status: 'done', summary });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: payload });
      } catch (error) {
        const reason = String(error?.message || error).slice(0, 200);
        events.push({ name: call.name, status: 'error', summary: reason });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ error: reason }), is_error: true });
      }
    }
    // All results for one assistant turn go back in a single user message.
    messages.push({ role: 'user', content: results });
  }
  return { message: 'I reached the tool-step limit. Ask me to continue from the evidence already collected.', model, provider: 'anthropic', tool_events: events, usage, stop_reason: 'step_limit' };
}
