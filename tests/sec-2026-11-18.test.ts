/**
 * Security review 2026-11-18 regression suite (docs/security/2026-11-18-security-review.md).
 *
 * SEC-04  Platform compute forwards only priced models, never `openrouter/auto`,
 *         charges an estimate when the provider reports no cost, and holds the
 *         worst case while a call is in flight so concurrent calls cannot all
 *         pass the same balance check.
 * SEC-05  Invite and admin email lookups match the address literally: `_` and
 *         `%` are not wildcards, and only confirmed addresses auto-accept.
 * SEC-06  Desktop `open-path` opens existing local folders only.
 * SEC-07  CSV exports neutralise spreadsheet formulas.
 * SEC-08  A malformed percent escape in a route parameter is a 400, not a crash.
 * SEC-09  The desktop platform bridge refuses dot segments.
 * SEC-10  The cron secret is compared in constant time and still refuses bad values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const provider = vi.hoisted(() => ({
  calls: [] as Array<{ model: string }>,
  delayMs: 0,
  cost: 0.001 as number | null,
}));

vi.mock('../api/_lib/openrouter.js', async (orig) => ({
  ...(await orig<typeof import('../api/_lib/openrouter.js')>()),
  openRouterConfigured: () => true,
  forwardChatCompletion: async (payload: { model: string }) => {
    provider.calls.push({ model: payload.model });
    if (provider.delayMs) await new Promise((r) => setTimeout(r, provider.delayMs));
    return {
      body: { id: `gen-${provider.calls.length}`, model: payload.model, choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, ...(provider.cost === null ? {} : { cost: provider.cost }) } },
      latencyMs: 5,
      attempt: 1,
    };
  },
}));

const signIns = vi.hoisted(() => ({ count: 0 }));
vi.mock('../api/_lib/supabase.js', async (orig) => ({
  ...(await orig<typeof import('../api/_lib/supabase.js')>()),
  adminClient: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'insert', 'update', 'gte', 'lt']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
    return chain;
  },
  publicServerClient: () => ({ auth: { signInWithPassword: async () => ((signIns.count += 1), { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } }) } }),
}));

const { completeForUser, pricedModelKey } = await import('../api/_lib/platform-compute.js');
const { invalidatePricingCache } = await import('../api/_lib/pricing.js');
const { likeLiteral, csvCell } = await import('../api/_lib/http.js');
const { acceptPendingInvites } = await import('../api/_lib/handlers/me.js');
const router = await import('../api/_lib/router.js');

const PRICING = [
  { model: 'openai/gpt-4o', provider: 'openai', input_per_million: 2.5, output_per_million: 10, cached_input_per_million: 1.25, tier: 'frontier', active: true },
  { model: 'openai/gpt-4o-mini', provider: 'openai', input_per_million: 0.15, output_per_million: 0.6, cached_input_per_million: 0.075, tier: 'small', active: true },
  { model: 'openai/text-embedding-3-small', provider: 'openai', input_per_million: 0.02, output_per_million: 0, cached_input_per_million: null, tier: 'embedding', active: true },
  { model: 'deepseek/deepseek-chat-v3', provider: 'deepseek', input_per_million: 0.27, output_per_million: 1.1, cached_input_per_million: 0.07, tier: 'standard', active: true },
];

/** LIKE with Postgres semantics: `%`, `_`, backslash escape, case-insensitive. */
function ilike(value: string, pattern: string) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is').test(value);
}

/** Minimal PostgREST-shaped client over in-memory tables, plus the RPCs these paths call. */
function fakeAdmin(tables: Record<string, Row[]>, { reserveFails = false } = {}) {
  const counters = new Map<string, number>();
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const from = (table: string) => {
    let rows = [...(tables[table] || [])];
    let pending: Row | null = null;
    const q: Row = {
      select: () => q,
      eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), q),
      is: (col: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), q),
      gt: (col: string, v: string) => ((rows = rows.filter((r) => r[col] > v)), q),
      ilike: (col: string, p: string) => ((rows = rows.filter((r) => ilike(String(r[col] ?? ''), p))), q),
      upsert: (row: Row) => {
        (tables[table] ||= []).push(row);
        return Promise.resolve({ error: null });
      },
      update: (patch: Row) => ((pending = patch), q),
      insert: (row: Row) => {
        (tables[table] ||= []).push(row);
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        if (pending) for (const r of rows) Object.assign(r, pending);
        return Promise.resolve({ data: rows, error: null }).then(ok, bad);
      },
    };
    return q;
  };
  const rpc = async (name: string, args: Row) => {
    rpcCalls.push({ name, args });
    if (name === 'usage_budget_reserve') {
      if (reserveFails) return { data: null, error: { message: 'counter down' } };
      const spent = counters.get(args.p_bucket) || 0;
      if (args.p_amount_micro_usd > 0 && spent + args.p_amount_micro_usd > args.p_limit_micro_usd) return { data: false, error: null };
      counters.set(args.p_bucket, Math.max(0, spent + args.p_amount_micro_usd));
      return { data: true, error: null };
    }
    if (name === 'consume_credits') return { data: 1, error: null };
    return { data: null, error: null };
  };
  return { from, rpc, counters, rpcCalls };
}

const billing = (userId: string, included = 5) => ({ billingUserId: userId, planId: 'free', plan: { id: 'free', name: 'Free', limits: { credits_usd: included } }, workspace: null, project: null });
const msg = (chars = 20) => [{ role: 'user', content: 'x'.repeat(chars) }];
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { status?: number; code?: string };
  }
};

describe('SEC-04 platform compute only spends on budgeted models', () => {
  beforeEach(() => {
    invalidatePricingCache();
    provider.calls.length = 0;
    provider.delayMs = 0;
    provider.cost = 0.001;
  });

  const run = (admin: ReturnType<typeof fakeAdmin>, userId: string, payload: Row, included = 5) =>
    completeForUser({ admin, user: { id: userId }, billing: billing(userId, included), payload, operation: 'platform_completion' } as never);
  const tables = (userId: string, included = 5) => ({ model_pricing: PRICING.map((r) => ({ ...r })), credit_balances: [{ user_id: userId, included_usd: included, used_usd: 0 }], feature_flags: [] });

  it('refuses a model with no price on record and never calls the provider', async () => {
    const admin = fakeAdmin(tables('u-unpriced'));
    const err = await errorOf(run(admin, 'u-unpriced', { model: 'openai/o1-pro', messages: msg() }));
    expect(err?.status).toBe(400);
    expect(err?.code).toBe('MODEL_NOT_ALLOWED');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses embedding models and pricier siblings that only share a family name', async () => {
    const admin = fakeAdmin(tables('u-family'));
    expect((await errorOf(run(admin, 'u-family', { model: 'openai/text-embedding-3-small', messages: msg() })))?.code).toBe('MODEL_NOT_ALLOWED');
    expect((await errorOf(run(admin, 'u-family', { model: 'openai/gpt-4o-search-preview', messages: msg() })))?.code).toBe('MODEL_NOT_ALLOWED');
    expect(provider.calls).toHaveLength(0);
  });

  it('runs openrouter/auto on the default model instead of letting it pick any price', async () => {
    const admin = fakeAdmin(tables('u-auto'));
    const out = (await run(admin, 'u-auto', { model: 'openrouter/auto', messages: msg() })) as Row;
    expect(provider.calls).toEqual([{ model: 'openai/gpt-4o-mini' }]);
    expect(out.model).toBe('openai/gpt-4o-mini');
  });

  it('keeps the desktop engine\'s alias ids working, budgeted at the aliased price', () => {
    const pricing = new Map(PRICING.map((r) => [r.model, r]));
    expect(pricedModelKey(pricing, 'deepseek/deepseek-chat')).toBe('deepseek/deepseek-chat-v3');
    expect(pricedModelKey(pricing, 'OpenAI/GPT-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(pricedModelKey(pricing, 'openrouter/auto')).toBeNull();
  });

  it('charges the list-price estimate, not zero, when the provider reports no cost', async () => {
    provider.cost = null;
    const admin = fakeAdmin(tables('u-nocost'));
    const out = (await run(admin, 'u-nocost', { model: 'openai/gpt-4o', messages: msg() })) as Row;
    const consume = admin.rpcCalls.find((c) => c.name === 'consume_credits');
    // 1000 prompt + 100 completion tokens at 2.50 / 10.00 per million.
    expect(consume?.args.p_amount).toBeCloseTo(0.0035, 6);
    expect(consume?.args.p_metadata.cost_source).toBe('pricing_snapshot_estimate');
    expect(out.zevqora.cost_source).toBe('pricing_snapshot_estimate');
  });

  it('concurrent calls cannot overspend one balance: only what the remaining credit covers goes out', async () => {
    provider.delayMs = 30;
    // $0.10 left; each call's worst case is ~$0.073 (25k input tokens + 1024 output on gpt-4o).
    const admin = fakeAdmin(tables('u-race', 0.1), {});
    const results = await Promise.all([0, 1, 2, 3].map(() => errorOf(run(admin, 'u-race', { model: 'openai/gpt-4o', messages: msg(100_000) }, 0.1))));
    expect(provider.calls).toHaveLength(1);
    expect(results.filter((e) => e === null)).toHaveLength(1);
    expect(results.filter((e) => e?.status === 402 && e.code === 'INSUFFICIENT_CREDITS')).toHaveLength(3);
    // Every hold is released once its call ends.
    expect(admin.counters.get('credit:hold:u-race')).toBe(0);
  });

  it('fails closed when the hold counter cannot answer', async () => {
    const admin = fakeAdmin(tables('u-down'), { reserveFails: true });
    const err = await errorOf(run(admin, 'u-down', { model: 'openai/gpt-4o-mini', messages: msg() }));
    expect(err?.status).toBe(503);
    expect(err?.code).toBe('BUDGET_UNAVAILABLE');
    expect(provider.calls).toHaveLength(0);
  });
});

describe('SEC-05 email lookups are literal', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await PGlite.create();
  });
  afterEach(async () => {
    await db.close();
  });
  const pg = async (value: string, pattern: string) => (await db.query<{ m: boolean }>('select $1::text ilike $2::text as m', [value, pattern])).rows[0].m;

  it('escapes wildcards for real Postgres ILIKE', async () => {
    expect(await pg('john@outlook.com', 'j_hn@outlook.com')).toBe(true); // the old behaviour
    expect(await pg('john@outlook.com', likeLiteral('j_hn@outlook.com'))).toBe(false);
    expect(await pg('anyone@acme.com', likeLiteral('%@acme.com'))).toBe(false);
    expect(await pg('j_hn@outlook.com', likeLiteral('j_hn@outlook.com'))).toBe(true);
    expect(await pg('John.Doe@Acme.com', likeLiteral('john.doe@acme.com'))).toBe(true);
    expect(await pg('a\\b@x.io', likeLiteral('a\\b@x.io'))).toBe(true);
  });

  const invites = () => ({
    workspace_invites: [{ id: 'i1', workspace_id: 'w1', role: 'admin', invited_by: 'owner', email: 'john@outlook.com', accepted_at: null, expires_at: new Date(Date.now() + 86_400_000).toISOString() }],
    workspace_members: [] as Row[],
  });

  it('a look-alike address does not inherit someone else\'s pending invite', async () => {
    const t = invites();
    const n = await acceptPendingInvites(fakeAdmin(t) as never, { id: 'attacker', email: 'j_hn@outlook.com', email_confirmed_at: '2026-11-18T00:00:00Z' } as never);
    expect(n).toBe(0);
    expect(t.workspace_members).toHaveLength(0);
  });

  it('an unconfirmed address never auto-accepts', async () => {
    const t = invites();
    expect(await acceptPendingInvites(fakeAdmin(t) as never, { id: 'u', email: 'john@outlook.com', email_confirmed_at: null } as never)).toBe(0);
    expect(t.workspace_members).toHaveLength(0);
  });

  it('the invited, confirmed address still joins (case-insensitive)', async () => {
    const t = invites();
    expect(await acceptPendingInvites(fakeAdmin(t) as never, { id: 'john', email: 'John@Outlook.com', email_confirmed_at: '2026-11-18T00:00:00Z' } as never)).toBe(1);
    expect(t.workspace_members).toEqual([expect.objectContaining({ workspace_id: 'w1', user_id: 'john', role: 'admin' })]);
  });
});

describe('SEC-07 CSV cells', () => {
  it('neutralises formulas and keeps numbers', () => {
    expect(csvCell('=HYPERLINK("https://evil.example","x")')).toBe(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-0.25')).toBe('-0.25');
    expect(csvCell(-0.25)).toBe('-0.25');
    expect(csvCell('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(csvCell(null)).toBe('');
  });
});

describe('SEC-08 malformed route parameters', () => {
  it('answers 400 instead of throwing out of the router', async () => {
    router.on('GET', '/api/sec-test/:id', ({ params }: { params: Row }) => ({ id: params.id }));
    const bad = await router.dispatch(new Request('https://x.test/api/sec-test/%E0%A4%A'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('BAD_PATH');
    const good = await router.dispatch(new Request('https://x.test/api/sec-test/a%20b'));
    expect(await good.json()).toEqual({ id: 'a b' });
  });
});

describe('SEC-10 cron secret', () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });
  it('refuses a missing, wrong or prefix-only secret', async () => {
    await import('../api/_lib/handlers/cron.js');
    process.env.CRON_SECRET = 'cron-secret-value-for-tests';
    for (const auth of [null, 'Bearer wrong', 'Bearer cron-secret-value-for-test', 'cron-secret-value-for-tests']) {
      const res = await router.dispatch(new Request('https://x.test/api/cron/daily', { headers: auth ? { authorization: auth } : {} }));
      expect(res.status).toBe(401);
    }
  });
});

describe('SEC-11 password login is limited across instances', () => {
  afterEach(async () => {
    (await import('../api/_lib/support/limits.js')).setSupportLimiterClient(null);
  });
  const login = (ip: string) =>
    router.dispatch(new Request('https://x.test/api/auth/password-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ identifier: 'victim@example.com', password: 'guess-guess-1' }) }));

  it('stops at the shared counter before Supabase is asked, and lets attempts through otherwise', async () => {
    await import('../api/_lib/handlers/public.js');
    const limits = await import('../api/_lib/support/limits.js');
    const buckets = new Map<string, number>();
    limits.setSupportLimiterClient({
      rpc: async (_name: string, a: Row) => {
        const n = (buckets.get(a.p_bucket) || 0) + 1;
        buckets.set(a.p_bucket, n);
        return { data: n <= a.p_limit, error: null };
      },
    });
    signIns.count = 0;
    const statuses: number[] = [];
    // A different address per attempt: only the per-account bucket can stop this.
    for (let i = 0; i < 25; i += 1) statuses.push((await login(`198.51.100.${i}`)).status);
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
    expect(signIns.count).toBe(20);
    expect([...buckets.keys()].some((k) => k.includes('victim'))).toBe(false);
  });

  it('an unavailable counter does not block sign-in', async () => {
    await import('../api/_lib/handlers/public.js');
    const limits = await import('../api/_lib/support/limits.js');
    limits.setSupportLimiterClient({ rpc: async () => ({ data: null, error: { message: 'down' } }) });
    signIns.count = 0;
    expect((await login('203.0.113.9')).status).toBe(401);
    expect(signIns.count).toBe(1);
  });
});

describe('SEC-06 / SEC-09 desktop bridge guards', () => {
  const require = createRequire(import.meta.url);
  const { isAllowedPlatformPath, resolveOpenablePath } = require('../desktop-app/desktop/electron/bridge-guards.cjs');

  it('keeps platform requests inside the allowlist', () => {
    expect(isAllowedPlatformPath('/api/me')).toBe(true);
    expect(isAllowedPlatformPath('/api/workspaces/abc/projects?limit=5')).toBe(true);
    expect(isAllowedPlatformPath('/api/me/../admin/users')).toBe(false);
    expect(isAllowedPlatformPath('/api/workspaces/./x')).toBe(false);
    expect(isAllowedPlatformPath('/api/me/..')).toBe(false);
    expect(isAllowedPlatformPath('/api/admin/users')).toBe(false);
    expect(isAllowedPlatformPath('/api/desktop/create-handoff')).toBe(false);
  });

  it('opens existing local folders only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zq-sec-'));
    const file = join(dir, 'run-me.exe');
    writeFileSync(file, 'MZ');
    try {
      expect(resolveOpenablePath(dir)).toBe(dir);
      expect(() => resolveOpenablePath(file)).toThrow(/Only folders/);
      expect(() => resolveOpenablePath(join(dir, 'missing'))).toThrow(/no longer exists/);
      expect(() => resolveOpenablePath('\\\\attacker.example\\share\\payload.exe', { platform: 'win32' })).toThrow(/Network and device/);
      expect(() => resolveOpenablePath('//attacker.example/share/payload.exe')).toThrow(/Network and device/);
      expect(() => resolveOpenablePath('\\\\?\\C:\\Windows\\System32\\calc.exe', { platform: 'win32' })).toThrow(/Network and device/);
      expect(() => resolveOpenablePath('')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
