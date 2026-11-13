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
import { SYSTEM_PROMPT, executeTool, explainInstruction } from './product/zev.js';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const MODEL_RE = /^claude-[a-z0-9.-]{1,60}$/;
export const CLAUDE_LIMITS = { maxSteps: 4, maxTokens: 8000, timeoutMs: 45_000 };

/**
 * Anthropic list prices, USD per million tokens [input, output] (first-party
 * API, checked 2026-11-13). Used for budget reservation and measured-cost
 * reconciliation. Conservative choices: cache reads are charged at the full
 * input price, cache writes at 1.25x, Haiku 5.5 at its >100K-token rate, and
 * any model not listed (e.g. one a server-side fallback chose) at CEILING.
 */
export const CLAUDE_PRICES = {
  'claude-fable-5-2': [8, 40],
  'claude-mythos-5-2': [8, 40],
  'claude-fable-5-1': [10, 50],
  'claude-mythos-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-5-5': [0.5, 2.5],
  'claude-haiku-4-5': [1, 5],
};
export const CEILING_PRICE = [10, 50];
const priceOf = (model) => CLAUDE_PRICES[model] || CEILING_PRICE;

/** Cost of one usage entry (top-level usage or one `usage.iterations` entry). */
function entryCost(u, model) {
  const [pin, pout] = priceOf(model);
  const input = Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + 1.25 * Number(u.cache_creation_input_tokens || 0);
  return (input * pin + Number(u.output_tokens || 0) * pout) / 1e6;
}

/**
 * Every billable attempt of one response. With server-side fallback the
 * top-level usage covers only the final attempt; `usage.iterations` lists each
 * sampling attempt (declined hops as `message`, the serving fallback as
 * `fallback_message`), each with its own model and tokens.
 */
export function attemptsOf(res, requestedModel) {
  const usage = res?.usage || {};
  const its = Array.isArray(usage.iterations) ? usage.iterations.filter((i) => i && (i.type === 'message' || i.type === 'fallback_message')) : [];
  if (!its.length) {
    const model = res?.model || requestedModel;
    return [{ type: 'message', model, input_tokens: Number(usage.input_tokens || 0), output_tokens: Number(usage.output_tokens || 0), cost_usd: entryCost(usage, model) }];
  }
  return its.map((i) => {
    const model = i.model || requestedModel;
    return { type: i.type, model, input_tokens: Number(i.input_tokens || 0), output_tokens: Number(i.output_tokens || 0), cost_usd: entryCost(i, model) };
  });
}

/**
 * Worst case for one call before it is sent: the request model's attempt plus
 * one fallback attempt at CEILING, each producing max_tokens. Input tokens are
 * over-estimated at one token per three characters of the request.
 */
export function reserveFor(params) {
  const inTok = Math.ceil(JSON.stringify({ s: params.system, t: params.tools, m: params.messages }).length / 3);
  const [pin, pout] = priceOf(params.model);
  return (inTok * (pin + CEILING_PRICE[0]) + params.max_tokens * (pout + CEILING_PRICE[1])) / 1e6;
}

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

const UNAVAILABLE = 'Engineering Zev spending controls are unavailable, so no request was sent to the provider.';
const roundUsage = (u) => ({ ...u, cost_usd: Number(u.cost_usd.toFixed(6)), served_by: [...new Set(u.attempts.map((a) => a.model))] });

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
/**
 * `budget` reserves before every call and reconciles after it:
 *   reserve(usd) -> true (reserved) | false (would exceed) | null (unavailable)
 *   settle(deltaUsd) -> applies measured cost minus the reservation.
 * Unavailable accounting stops before any paid call (fail closed).
 */
export async function runZevClaude({ ctx, history, productId, signal, budget, explainMode = null }) {
  const model = claudeModel();
  const base = `${SYSTEM_PROMPT}\n\n${explainInstruction(explainMode)}`;
  const system = productId ? `${base}\n\nThe selected ZEVQORA product_id is ${productId}. Tools always read that product.` : base;
  /** @type {import('@anthropic-ai/sdk').default.MessageParam[]} */
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const events = [];
  const usage = { input_tokens: 0, output_tokens: 0, model_calls: 0, attempts: [], cost_usd: 0 };
  if (!budget) throw new ApiError(503, UNAVAILABLE, 'BUDGET_UNAVAILABLE');
  const api = client();

  for (let step = 0; step < CLAUDE_LIMITS.maxSteps; step += 1) {
    const params = {
      model,
      max_tokens: CLAUDE_LIMITS.maxTokens,
      system,
      tools: CLAUDE_TOOLS,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      messages,
      // Safety declines are re-run on a fallback model chosen by the API; every attempt is accounted below.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    };
    const reserved = reserveFor(params);
    const ok = await budget.reserve(reserved);
    if (ok === null) throw new ApiError(503, UNAVAILABLE, 'BUDGET_UNAVAILABLE');
    if (ok === false) {
      if (step === 0) throw new ApiError(429, 'The Engineering Zev spending budget for today is used up. It resets within 24 hours.', 'BUDGET_EXHAUSTED');
      return { message: 'I stopped before another paid model call because the spending budget is used up. The evidence gathered so far is above.', model, provider: 'anthropic', tool_events: events, usage: roundUsage(usage), stop_reason: 'budget_exhausted' };
    }
    let res;
    try {
      res = await api.beta.messages.create(params, { signal });
    } catch (error) {
      // Whether the provider billed a failed call is unknown: the reservation is kept, not refunded.
      throw mapAnthropicError(error);
    }
    const attempts = attemptsOf(res, model);
    const measured = attempts.reduce((n, a) => n + a.cost_usd, 0);
    await budget.settle(measured - reserved);
    usage.model_calls += 1;
    usage.attempts.push(...attempts);
    usage.cost_usd += measured;
    usage.input_tokens += attempts.reduce((n, a) => n + a.input_tokens, 0);
    usage.output_tokens += attempts.reduce((n, a) => n + a.output_tokens, 0);

    if (res.stop_reason === 'refusal') {
      return { message: 'Zev declined this request. Rephrase it as a question about this workspace’s evidence.', model: res.model || model, provider: 'anthropic', tool_events: events, usage: roundUsage(usage), stop_reason: 'refusal' };
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
        usage: roundUsage(usage),
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
  return { message: 'I reached the tool-step limit. Ask me to continue from the evidence already collected.', model, provider: 'anthropic', tool_events: events, usage: roundUsage(usage), stop_reason: 'step_limit' };
}
