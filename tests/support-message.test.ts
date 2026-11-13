/**
 * POST /api/support/message on the real router: FAQ mode (default), the
 * generative mode behind PUBLIC_SUPPORT_AI_ENABLED + OPENROUTER_API_KEY, the
 * fail-closed paths (no durable limiter, budget spent, provider error), input
 * bounds, and the per-visitor limits. The durable limiter is a stand-in with
 * the same contract as public_rate_limit_hit (exercised for real on PGlite in
 * support-rate-limit-db.test.ts); OpenRouter is a stubbed fetch.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
let dispatch: (r: Request) => Promise<Response>;
let setClient: (c: { rpc: Rpc } | null) => void;
let BOUNDS: Record<string, number>;

/** Same semantics as the SQL function: fixed window per bucket. */
function fakeLimiter() {
  const buckets = new Map<string, number>();
  const calls: string[] = [];
  const rpc: Rpc = async (fn, args) => {
    if (fn !== 'public_rate_limit_hit') return { data: null, error: { message: 'unknown function' } };
    const key = String(args.p_bucket);
    calls.push(key);
    const hits = (buckets.get(key) || 0) + 1;
    buckets.set(key, hits);
    return { data: hits <= Number(args.p_limit), error: null };
  };
  return { rpc, calls, buckets };
}

let ipSeq = 10;
const nextIp = () => `198.51.100.${ipSeq++}`;

async function send(body: unknown, ip = nextIp()) {
  const res = await dispatch(new Request('https://x.test/api/support/message', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

function stubOpenRouter(reply: string | { status: number }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (typeof reply === 'object') return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: reply.status });
    const payload = JSON.parse(String((init as RequestInit).body));
    return new Response(JSON.stringify({ id: 'gen-1', model: payload.model, choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 60 } }), { status: 200 });
  });
}

const ENV_KEYS = ['PUBLIC_SUPPORT_AI_ENABLED', 'OPENROUTER_API_KEY', 'PUBLIC_SUPPORT_AI_DAILY_CAP', 'PUBLIC_SUPPORT_AI_MODEL', 'SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SECURITY_HASH_SECRET'];
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/support.js');
  ({ setSupportLimiterClient: setClient } = await import('../api/_lib/support/limits.js'));
  ({ SUPPORT_BOUNDS: BOUNDS } = await import('../api/_lib/handlers/support.js'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setClient(null);
  vi.restoreAllMocks();
});

const enableAi = () => {
  process.env.PUBLIC_SUPPORT_AI_ENABLED = 'true';
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key-not-real';
};

describe('FAQ mode (default)', () => {
  it('answers each starter chip from the public knowledge, labelled faq, with internal links only', async () => {
    setClient(fakeLimiter());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const cases: [string, string][] = [
      ['What does ZEVQORA do?', 'what'],
      ['How do I connect my server?', 'connect'],
      ['Why verify before optimizing?', 'verify'],
      ['Can I talk to your team?', 'team'],
    ];
    for (const [message, topic] of cases) {
      const r = await send({ message });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ mode: 'faq', topic });
      expect(r.body.answer.length).toBeGreaterThan(40);
      expect(r.body.links.length).toBeGreaterThan(0);
      for (const l of r.body.links) expect(l.href).toMatch(/^\/[a-z-]*$/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches free text by keywords and falls back to a safe general answer', async () => {
    setClient(fakeLimiter());
    expect((await send({ message: 'does it work with opentelemetry spans?' })).body.topic).toBe('connect');
    expect((await send({ message: 'how much is the enterprise plan' })).body.topic).toBe('pricing');
    const off = await send({ message: 'write me a poem about cats' });
    expect(off.body).toMatchObject({ mode: 'faq', topic: 'fallback' });
  });

  it('stays FAQ when the flag is on but no OpenRouter key is set, and when the key is set but the flag is off', async () => {
    setClient(fakeLimiter());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.PUBLIC_SUPPORT_AI_ENABLED = 'true';
    delete process.env.OPENROUTER_API_KEY;
    expect((await send({ message: 'What does ZEVQORA do?' })).body.mode).toBe('faq');
    process.env.PUBLIC_SUPPORT_AI_ENABLED = 'false';
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key-not-real';
    expect((await send({ message: 'What does ZEVQORA do?' })).body.mode).toBe('faq');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves FAQ answers without Supabase (durable limiter unavailable)', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await send({ message: 'What does ZEVQORA do?' });
    expect(r).toMatchObject({ status: 200, body: { mode: 'faq', topic: 'what' } });
  });
});

describe('generative mode', () => {
  it('uses OpenRouter with the bounded public prompt and no tools when enabled and limits are durable', async () => {
    enableAi();
    setClient(fakeLimiter());
    const fetchSpy = stubOpenRouter('ZEVQORA replays lighter execution plans on your workload and keeps only what passes your gates.');
    const r = await send({ message: 'In one line, what is it?', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }], page: 'hero' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'ai', answer: expect.stringContaining('replays lighter execution plans') });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(payload.max_tokens).toBe(BOUNDS.maxOutputTokens);
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
    expect(payload.model).toBe('openai/gpt-4o-mini');
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[0].content).toContain('PUBLIC KNOWLEDGE');
    expect(payload.messages[0].content).toMatch(/no tools/);
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'In one line, what is it?' });
    // No workspace, trace or account data in the context.
    expect(JSON.stringify(payload)).not.toMatch(/workspace_id|trace_id|user_id|service_role/);
  });

  it('bounds the history it forwards and the answer it returns', async () => {
    enableAi();
    setClient(fakeLimiter());
    const fetchSpy = stubOpenRouter('x'.repeat(5000));
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:` + 'h'.repeat(1300) }));
    const r = await send({ message: 'What does ZEVQORA do?', history });
    expect(r.body.answer.length).toBe(BOUNDS.maxAnswerChars);
    const payload = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    const forwarded = payload.messages.slice(1, -1);
    expect(forwarded.length).toBeLessThanOrEqual(BOUNDS.maxHistoryTurns);
    expect(forwarded.reduce((n: number, m: { content: string }) => n + m.content.length, 0)).toBeLessThanOrEqual(BOUNDS.maxHistoryChars);
  });

  it('fails closed to FAQ when the durable limiter cannot answer (no OpenRouter call)', async () => {
    enableAi();
    setClient({ rpc: async () => ({ data: null, error: { message: 'function public.public_rate_limit_hit does not exist' } }) });
    const fetchSpy = stubOpenRouter('should not be used');
    const r = await send({ message: 'What does ZEVQORA do?' });
    expect(r.body.mode).toBe('faq');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to FAQ when the daily generative budget is spent or set to zero', async () => {
    enableAi();
    process.env.PUBLIC_SUPPORT_AI_DAILY_CAP = '2';
    setClient(fakeLimiter());
    const fetchSpy = stubOpenRouter('generated');
    const modes = [];
    for (let i = 0; i < 3; i += 1) modes.push((await send({ message: 'What does ZEVQORA do?' })).body.mode);
    expect(modes).toEqual(['ai', 'ai', 'faq']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    process.env.PUBLIC_SUPPORT_AI_DAILY_CAP = '0';
    expect((await send({ message: 'What does ZEVQORA do?' })).body.mode).toBe('faq');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('answers from the FAQ, not with an error, when the provider fails', async () => {
    enableAi();
    setClient(fakeLimiter());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubOpenRouter({ status: 401 });
    const r = await send({ message: 'Why verify before optimizing?' });
    expect(r).toMatchObject({ status: 200, body: { mode: 'faq', topic: 'verify', fallback: true } });
  });

  it('ignores an invalid model override', async () => {
    enableAi();
    process.env.PUBLIC_SUPPORT_AI_MODEL = 'evil model; drop table';
    setClient(fakeLimiter());
    const fetchSpy = stubOpenRouter('ok');
    await send({ message: 'What does ZEVQORA do?' });
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).model).toBe('openai/gpt-4o-mini');
  });
});

describe('input bounds and limits', () => {
  it('rejects empty, non-string, oversized and non-JSON bodies', async () => {
    setClient(fakeLimiter());
    expect((await send({ message: '   ' })).status).toBe(400);
    expect((await send({ message: 42 })).status).toBe(400);
    expect((await send({ message: 'a'.repeat(BOUNDS.maxMessageChars + 1) })).body.code).toBe('MESSAGE_TOO_LONG');
    expect((await send('{not json')).status).toBe(400);
    expect((await send({ message: 'hi', pad: 'p'.repeat(BOUNDS.maxBodyBytes) })).status).toBe(413);
    expect((await send([1, 2])).status).toBe(400);
  });

  it('limits one visitor per minute across instances (durable) and answers 429 without the message', async () => {
    const limiter = fakeLimiter();
    setClient(limiter);
    const ip = nextIp();
    const statuses = [];
    for (let i = 0; i < 9; i += 1) statuses.push((await send({ message: 'What does ZEVQORA do?' }, ip)).status);
    expect(statuses.slice(0, 8).every((s) => s === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
    // Another visitor is unaffected.
    expect((await send({ message: 'What does ZEVQORA do?' })).status).toBe(200);
  });

  it('keys durable buckets by a keyed hash, never the raw address', async () => {
    process.env.SECURITY_HASH_SECRET = 's'.repeat(40);
    const limiter = fakeLimiter();
    setClient(limiter);
    const ip = '203.0.113.99';
    await send({ message: 'What does ZEVQORA do?' }, ip);
    expect(limiter.calls.length).toBeGreaterThanOrEqual(2);
    for (const key of limiter.calls) {
      expect(key).not.toContain(ip);
      expect(key).not.toContain('203.0.113');
      expect(key.length).toBeLessThanOrEqual(128);
    }
  });

  it('still limits per instance in memory when the durable layer is down', async () => {
    setClient({ rpc: async () => { throw new Error('network'); } });
    const ip = nextIp();
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await send({ message: 'hello' }, ip)).status);
    expect(statuses.filter((s) => s === 200).length).toBe(10);
    expect(statuses[10]).toBe(429);
  });

  it('does not log or echo what the visitor typed on errors', async () => {
    setClient(fakeLimiter());
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enableAi();
    stubOpenRouter({ status: 500 });
    const secret = 'my-private-prompt-7f3a';
    const r = await send({ message: `What does ZEVQORA do? ${secret}` });
    expect(JSON.stringify(r.body)).not.toContain(secret);
    for (const spy of [log, warn, err]) expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  });
});
