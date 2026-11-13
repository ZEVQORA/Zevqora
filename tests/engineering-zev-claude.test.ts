/**
 * Engineering Zev on the Claude API, through the real router and engine
 * handler with an injected Anthropic client (no network, no key):
 * provider selection, authorization before any model call, read-only scoped
 * tools, the durable daily budget (fail closed), sanitized provider errors,
 * cancellation, refusal and step limits, and no key material in responses.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '../api/_lib/http.js';

type Row = Record<string, unknown>;
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const P_A = 'a3333333-3333-4333-8333-333333333333';
const P_B = 'b4444444-4444-4444-8444-444444444444';
const USER = { id: 'user-1', email: 'fixture@example.invalid' };
const db: Record<string, Row[]> = {};
const limiter = { mode: 'ok' as 'ok' | 'spent' | 'down', calls: [] as string[], usdMode: 'ok' as 'ok' | 'down', usd: new Map<string, number>(), positives: 0, maxPositives: Infinity };

function from(table: string) {
  db[table] ||= [];
  const filters: Array<(r: Row) => boolean> = [];
  const rows = () => db[table].filter((r) => filters.every((f) => f(r)));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    order: () => q,
    limit: () => q,
    range: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null; count: number }) => unknown) => Promise.resolve(resolve({ data: rows(), error: null, count: rows().length })),
  };
  return q;
}
const admin = {
  from,
  rpc: async (fn: string, args: Record<string, unknown>) => {
    limiter.calls.push(String(args.p_bucket));
    if (fn === 'usage_budget_reserve') {
      // Same contract as migration 022: positive amounts only within the limit; refunds floor at 0.
      if (limiter.usdMode === 'down') return { data: null, error: { message: 'function does not exist' } };
      const key = String(args.p_bucket);
      const amount = Number(args.p_amount_micro_usd);
      const spent = limiter.usd.get(key) || 0;
      if (amount > 0 && (spent + amount > Number(args.p_limit_micro_usd) || limiter.positives >= limiter.maxPositives)) return { data: false, error: null };
      if (amount > 0) limiter.positives += 1;
      limiter.usd.set(key, Math.max(0, spent + amount));
      return { data: true, error: null };
    }
    if (fn !== 'public_rate_limit_hit' || limiter.mode === 'down') return { data: null, error: { message: 'function does not exist' } };
    return { data: limiter.mode === 'ok', error: null };
  },
};

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({ user: USER, admin }),
  // The user is a member of WS_A only; anything else is invisible (404).
  requireWorkspaceRole: async (_a: unknown, ws: string) => {
    if (ws !== WS_A) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
    return 'viewer';
  },
  rateLimit: () => undefined,
  rateLimitRequest: () => undefined,
  roleRank: () => 1,
}));

let dispatch: (req: Request) => Promise<Response>;
let setClient: (c: unknown) => void;
const create = vi.fn();
const ENV = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'ENGINEERING_ZEV_PROVIDER', 'ENGINEERING_ZEV_MODEL', 'ENGINEERING_ZEV_DAILY_CAP', 'ENGINEERING_ZEV_DAILY_USD_WORKSPACE', 'ENGINEERING_ZEV_DAILY_USD_PLATFORM'];
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
  ({ setAnthropicClientForTests: setClient } = await import('../api/_lib/anthropic.js'));
});

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  for (const k of Object.keys(db)) delete db[k];
  db.engine_products = [
    { id: P_A, workspace_id: WS_A, name: 'support', root_path: 'workload://a', source: 'browser', archived_at: null },
    { id: P_B, workspace_id: WS_B, name: 'other tenant', root_path: 'workload://b', source: 'browser', archived_at: null },
  ];
  db.engine_evaluations = [
    { id: 'eval-a', product_id: P_A, status: 'REJECTED', sample_count: 50, candidate_quality: 0.87, baseline_quality: 0.95, raw_cost_delta_percent: -42.01, rejection_reason: 'quality below floor', gates: [{ name: 'quality_floor', outcome: 'fail', required: true }] },
    { id: 'eval-b', product_id: P_B, status: 'VERIFIED', sample_count: 9, gates: [] },
  ];
  limiter.mode = 'ok';
  limiter.calls = [];
  limiter.usdMode = 'ok';
  limiter.usd = new Map();
  limiter.positives = 0;
  limiter.maxPositives = Infinity;
  create.mockReset();
  setClient({ beta: { messages: { create } } });
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const chat = (body: unknown) => dispatch(new Request('https://x.test/api/engine/agent/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const ask = (text = 'Why was this rejected?', product_id: string | null = P_A) => chat({ product_id, messages: [{ role: 'user', content: text }] });
const toolUse = (name: string, input: Row = {}) => ({ id: 'msg_1', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 900, output_tokens: 40 }, content: [{ type: 'text', text: 'Reading the runs.' }, { type: 'tool_use', id: `tu_${name}`, name, input }] });
const final = (text: string) => ({ id: 'msg_2', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1400, output_tokens: 120 }, content: [{ type: 'text', text }] });

describe('provider selection', () => {
  it('says plainly that Engineering Zev is not configured, with zero model calls', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ provider: 'none', provider_configured: false });
    expect(body.message).toMatch(/not configured for this environment/);
    expect(create).not.toHaveBeenCalled();
  });

  it('health reports the provider by name and model only, never key material', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real-0000';
    const res = await dispatch(new Request('https://x.test/api/engine/health'));
    const body = await res.json();
    expect(body).toMatchObject({ engineering_zev_provider: 'anthropic', engineering_zev_model: 'claude-opus-5-5' });
    expect(JSON.stringify(body)).not.toContain('sk-ant');
  });

  it('an explicit openrouter pin keeps the platform path even with a Claude key', async () => {
    const { engineeringZevProvider } = await import('../api/_lib/anthropic.js');
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real-0000';
    process.env.ENGINEERING_ZEV_PROVIDER = 'openrouter';
    expect(engineeringZevProvider({ openRouterConfigured: true })).toBe('openrouter');
    process.env.ENGINEERING_ZEV_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    expect(engineeringZevProvider({ openRouterConfigured: true })).toBe('none');
  });
});

describe('Claude path', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real-0000';
  });

  it('runs bounded read-only tools scoped to the authorized product and returns usage', async () => {
    create.mockResolvedValueOnce(toolUse('list_experiments', { product_id: P_B })).mockResolvedValueOnce(final('The quality_floor gate failed: 0.87 < 0.95.'));
    const res = await ask();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', provider_configured: true, stop_reason: 'end_turn' });
    expect(body.usage).toMatchObject({ input_tokens: 2300, output_tokens: 160, model_calls: 2, served_by: ['claude-opus-5-5'] });
    // Opus 5.5 at $4 / $20 per MTok: (2300 * 4 + 160 * 20) / 1e6.
    expect(body.usage.cost_usd).toBeCloseTo((2300 * 4 + 160 * 20) / 1e6, 9);
    expect(body.tool_events).toEqual([{ name: 'list_experiments', status: 'done', summary: '1 evaluations returned.' }]);
    expect(JSON.stringify(body)).not.toContain('sk-ant');

    const [params] = create.mock.calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBeLessThanOrEqual(8000);
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.tools.map((t: { name: string }) => t.name)).toEqual(['workspace_summary', 'list_ai_calls', 'list_findings', 'economics_summary', 'list_experiments']);
    expect(params.fallbacks).toBe('default');
    expect(params.system).toContain(P_A);

    // The model asked for the other tenant's product; the tool still read only the authorized one.
    const second = create.mock.calls[1][0];
    const toolResult = second.messages.at(-1);
    expect(toolResult.role).toBe('user');
    expect(toolResult.content).toHaveLength(1);
    expect(toolResult.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_list_experiments' });
    expect(toolResult.content[0].content).toContain('eval-a');
    expect(toolResult.content[0].content).not.toContain('eval-b');
    // The assistant turn is passed back unchanged.
    expect(second.messages.at(-2)).toEqual({ role: 'assistant', content: toolUse('list_experiments', { product_id: P_B }).content });
  });

  it('another workspace’s product is 404 and no model call is made', async () => {
    const res = await ask('Explain', P_B);
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
    expect(limiter.calls).toHaveLength(0);
  });

  it('stops at the step limit even if the model keeps calling tools', async () => {
    create.mockResolvedValue(toolUse('list_findings'));
    const body = await (await ask()).json();
    expect(create).toHaveBeenCalledTimes(4);
    expect(body.stop_reason).toBe('step_limit');
  });

  it('a refusal returns a safe message, not an error', async () => {
    create.mockResolvedValueOnce({ id: 'm', model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 }, content: [] });
    const body = await (await ask()).json();
    expect(body.stop_reason).toBe('refusal');
    expect(body.message).toMatch(/declined/);
  });

  it('ignores an invalid model override', async () => {
    process.env.ENGINEERING_ZEV_MODEL = 'gpt-4o; drop';
    create.mockResolvedValueOnce(final('ok'));
    await ask();
    expect(create.mock.calls[0][0].model).toBe('claude-opus-5-5');
  });
});

describe('spending controls and failures', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real-0000';
  });

  it('enforces the per-workspace daily cap in the durable limiter', async () => {
    limiter.mode = 'spent';
    const res = await ask();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('BUDGET_EXHAUSTED');
    expect(limiter.calls[0]).toMatch(new RegExp(`^engzev:req:ws:${WS_A}:\\d{4}-\\d{2}-\\d{2}$`));
    expect(create).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is unavailable', async () => {
    limiter.mode = 'down';
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('BUDGET_UNAVAILABLE');
    expect(create).not.toHaveBeenCalled();
  });

  it('a cap of 0 pauses Claude without a call', async () => {
    process.env.ENGINEERING_ZEV_DAILY_CAP = '0';
    expect((await ask()).status).toBe(429);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [429, 429, 'PROVIDER_RATE_LIMITED'],
    [401, 502, 'PROVIDER_AUTH'],
    [400, 502, 'PROVIDER_CONFIG'],
    [529, 503, 'PROVIDER_UNAVAILABLE'],
    [500, 503, 'PROVIDER_UNAVAILABLE'],
  ])('maps provider status %i to %i %s without leaking provider text', async (status, expected, code) => {
    create.mockRejectedValueOnce(Anthropic.APIError.generate(status, { error: { message: 'secret detail sk-ant-leak' } }, 'secret detail sk-ant-leak', new Headers()));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await ask();
    expect(res.status).toBe(expected);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toMatch(/sk-ant|secret detail/);
  });

  it('a cancelled request ends as CANCELLED, not as an answer', async () => {
    create.mockRejectedValueOnce(new Anthropic.APIUserAbortError());
    const res = await ask();
    expect(res.status).toBe(499);
    expect((await res.json()).code).toBe('CANCELLED');
  });

  it('timeouts are reported as such', async () => {
    create.mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError());
    const res = await ask();
    expect(res.status).toBe(504);
  });
});

describe('security review: workspace scope, money budget, fallback accounting', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real-0000';
  });
  const day = () => new Date().toISOString().slice(0, 10);
  const asOnly = (workspace_id?: string) => chat({ ...(workspace_id ? { workspace_id } : {}), messages: [{ role: 'user', content: 'hello' }] });

  it('A. another workspace id without a product is 404: no quota, no budget, no model call', async () => {
    const res = await asOnly(WS_B);
    expect(res.status).toBe(404);
    expect(limiter.calls).toHaveLength(0);
    expect(limiter.usd.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('A. a member’s own workspace id is used only after membership is confirmed', async () => {
    create.mockResolvedValueOnce(final('ok'));
    expect((await asOnly(WS_A)).status).toBe(200);
    expect(limiter.calls.some((b) => b.startsWith(`engzev:req:ws:${WS_A}:`))).toBe(true);
    expect([...limiter.usd.keys()]).toContain(`engzev:usd:ws:${WS_A}:${day()}`);
  });

  it('A. with no workspace at all, quota and budget are scoped to the user', async () => {
    create.mockResolvedValueOnce(final('ok'));
    expect((await asOnly()).status).toBe(200);
    expect(limiter.calls.some((b) => b.startsWith('engzev:req:user:user-1:'))).toBe(true);
    expect([...limiter.usd.keys()]).toContain(`engzev:usd:user:user-1:${day()}`);
  });

  it('B. reserves the worst case before the call and reconciles both counters to the measured cost', async () => {
    create.mockResolvedValueOnce(final('ok'));
    const body = await (await ask()).json();
    const measured = Math.round(body.usage.cost_usd * 1e6);
    expect(measured).toBe(Math.round(((1400 * 4 + 120 * 20) / 1e6) * 1e6));
    expect(limiter.usd.get(`engzev:usd:ws:${WS_A}:${day()}`)).toBe(measured);
    expect(limiter.usd.get(`engzev:usd:platform:${day()}`)).toBe(measured);
  });

  it('B. a workspace dollar budget too small for one call refuses before any call; the platform counter is not left charged', async () => {
    process.env.ENGINEERING_ZEV_DAILY_USD_WORKSPACE = '0.01';
    const res = await ask();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('BUDGET_EXHAUSTED');
    expect(create).not.toHaveBeenCalled();
    expect(limiter.usd.get(`engzev:usd:platform:${day()}`) || 0).toBe(0);
  });

  it('B. the platform-wide dollar budget also binds', async () => {
    process.env.ENGINEERING_ZEV_DAILY_USD_PLATFORM = '0.01';
    expect((await ask()).status).toBe(429);
    expect(create).not.toHaveBeenCalled();
    expect(limiter.usd.get(`engzev:usd:ws:${WS_A}:${day()}`) || 0).toBe(0);
  });

  it('B. budget accounting unavailable (022 not applied) → 503 and no call', async () => {
    limiter.usdMode = 'down';
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('BUDGET_UNAVAILABLE');
    expect(create).not.toHaveBeenCalled();
  });

  it('B. running out mid-loop stops before the next paid call and says so', async () => {
    create.mockResolvedValueOnce(toolUse('list_experiments'));
    limiter.maxPositives = 2; // the first call's workspace + platform reservations, then the budget is spent
    const body = await (await ask()).json();
    expect(create).toHaveBeenCalledTimes(1);
    expect(body.stop_reason).toBe('budget_exhausted');
    expect(body.tool_events).toHaveLength(1);
  });

  it('B. a failed call keeps its reservation (billing unknown), never a refund to zero', async () => {
    create.mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError());
    expect((await ask()).status).toBe(504);
    expect(limiter.usd.get(`engzev:usd:ws:${WS_A}:${day()}`)).toBeGreaterThan(0);
  });

  it('C. a server-side fallback bills every attempt: the declined hop and the serving fallback model', async () => {
    create.mockResolvedValueOnce({
      id: 'm', model: 'claude-opus-4-8', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Answered by the fallback.' }],
      usage: {
        input_tokens: 1000, output_tokens: 50,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        ],
      },
    });
    const body = await (await ask()).json();
    const expected = (1000 * 4 + 10 * 20) / 1e6 + (1000 * 5 + 50 * 25) / 1e6;
    expect(body.usage.cost_usd).toBeCloseTo(expected, 9);
    expect(body.usage.served_by).toEqual(['claude-opus-5-5', 'claude-opus-4-8']);
    expect(body.usage.attempts.map((a: Row) => a.type)).toEqual(['message', 'fallback_message']);
    expect(body.usage.input_tokens).toBe(2000);
    expect(limiter.usd.get(`engzev:usd:platform:${day()}`)).toBe(Math.round(expected * 1e6));
  });

  it('C. an unknown fallback model is charged at the ceiling price, never as free', async () => {
    create.mockResolvedValueOnce({
      id: 'm', model: 'claude-future-x', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 10, iterations: [{ type: 'fallback_message', model: 'claude-future-x', input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] },
    });
    const body = await (await ask()).json();
    expect(body.usage.cost_usd).toBeCloseTo((100 * 10 + 10 * 50) / 1e6, 9);
  });

  it('C. a refusal is still billed and accounted', async () => {
    create.mockResolvedValueOnce({ id: 'm', model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 500, output_tokens: 0 }, content: [] });
    const body = await (await ask()).json();
    expect(body.stop_reason).toBe('refusal');
    expect(body.usage.cost_usd).toBeCloseTo((500 * 4) / 1e6, 9);
    expect(limiter.usd.get(`engzev:usd:platform:${day()}`)).toBe(Math.round(((500 * 4) / 1e6) * 1e6));
  });
});
