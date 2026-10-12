/**
 * Retention and test-safety boundaries for Part 3:
 *  - the daily cron purges website events after 400 days and security events
 *    after 90, and never touches product events, evaluation requests (leads)
 *    or content history (business evidence);
 *  - without an explicit test client the security recorder writes nothing,
 *    so a test run can never reach a real Supabase project.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, restClient } from './helpers/pg';

const state: { rest: ReturnType<typeof restClient> | null } = { rest: null };
vi.mock('../api/_lib/supabase.js', () => ({ adminClient: () => state.rest, requireSupabaseEnv: () => ({}) }));

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const KEY = '0'.repeat(64);

describe('daily retention job', () => {
  let db: Awaited<ReturnType<typeof createDb>>;
  let dispatch: (r: Request) => Promise<Response>;
  beforeAll(async () => {
    db = await createDb();
    state.rest = restClient(db);
    ({ dispatch } = await import('../api/_lib/router.js'));
    await import('../api/_lib/handlers/cron.js');
    for (const [i, days] of [401, 399, 10].entries()) await db.query(`insert into public.site_events(occurred_at, event, path, session_id, visitor_key) values ($1, 'pageview', '/', $2, $3)`, [ago(days), `session${i}xxxx`, KEY]);
    for (const days of [91, 89]) await db.query(`insert into public.security_events(occurred_at, kind) values ($1, 'rate_limited')`, [ago(days)]);
    await db.query(`insert into public.product_events(occurred_at, event, dedupe_key) values ($1, 'signup_completed', 'old-signup-key')`, [ago(900)]);
    await db.query(`insert into public.evaluation_requests(created_at, name, email, company, workload, consent) values ($1, 'Old Lead', 'old@example.com', 'Old Co', 'An old but real lead request', true)`, [ago(900)]);
  }, 60_000);

  it('refuses to run without the cron secret', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-value';
    const res = await dispatch(new Request('https://x.test/api/cron/daily'));
    expect(res.status).toBe(401);
  });

  it('purges only expired website and security events and keeps business evidence', async () => {
    const res = await dispatch(new Request('https://x.test/api/cron/daily', { headers: { authorization: 'Bearer test-cron-secret-value' } }));
    expect(res.status).toBe(200);
    const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;
    expect(await n('select count(*)::int n from public.site_events')).toBe(2);
    expect(await n('select count(*)::int n from public.security_events')).toBe(1);
    expect(await n('select count(*)::int n from public.product_events')).toBe(1);
    expect(await n('select count(*)::int n from public.evaluation_requests')).toBe(1);
    expect(await n('select count(*)::int n from public.site_content_revisions')).toBeGreaterThan(0);
  });
});

describe('test safety', () => {
  it('the security recorder writes nothing when no test client was injected', async () => {
    const { recordSecurityEvent, setSecurityClient } = await import('../api/_lib/analytics/security.js');
    setSecurityClient(null);
    const ok = await recordSecurityEvent(new Request('https://x.test/api/x'), { kind: 'rate_limited' });
    expect(ok).toBe(false);
  });
});
