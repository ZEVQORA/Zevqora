/**
 * Migration 019 (vNext Part 3) on PGlite: server-only tables with hostile
 * Supabase default grants revoked, the privacy shape of website analytics,
 * deduplicated product events, append-only content history, flag targeting
 * rules, the SQL aggregates behind the admin dashboards, and rollback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { PLATFORM_V3, asUser, createDb, migration, seedWorkspace } from './helpers/pg';

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const TABLES = ['site_events', 'product_events', 'security_events', 'evaluation_requests', 'site_content_revisions'];
const FUNCTIONS = ['analytics_site_summary', 'analytics_product_summary', 'site_content_revisions_guard', 'cms_publish'];
const KEY = (n: number) => n.toString(16).padStart(64, '0');
const rollback = readFileSync(new URL('../supabase/rollback/019_product_experience.rollback.sql', import.meta.url), 'utf8');

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await createDb();
  await seedWorkspace(db, { userId: USER_A, workspaceId: WS_A, slug: 'alpha', role: 'owner' });
  await q('insert into auth.users(id) values ($1)', [USER_B]);
}, 60_000);

describe('privileges', () => {
  it('hostile Supabase default grants stay revoked on every 019 table and function', async () => {
    const fresh = await createDb({ experience: false });
    await fresh.exec(PLATFORM_V3);
    await fresh.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;`);
    await fresh.exec(migration('019_product_experience.sql'));
    const t = await fresh.query<{ n: number }>(`select count(*)::int n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1)
      and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`, [TABLES]);
    expect(t.rows[0].n).toBe(0);
    const f = await fresh.query<{ n: number }>(`select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, [FUNCTIONS]);
    expect(f.rows[0].n).toBe(0);
  }, 60_000);

  it('a signed-in browser user can neither read nor write any 019 table', async () => {
    for (const t of TABLES) {
      const err = await asUser(db, USER_A, (tx) => tx.query(`select * from public.${t} limit 1`)).then(() => null, (e: Error) => e.message);
      expect(err, t).toMatch(/permission denied/);
    }
    const write = await asUser(db, null, (tx) => tx.query(`insert into public.evaluation_requests(name,email,company,workload,consent) values ('x y','a@b.co','c','0123456789 workload',true)`)).then(() => null, (e: Error) => e.message);
    expect(write).toMatch(/permission denied/);
  });

  it('published site content stays publicly readable; drafts do not', async () => {
    const pub = await asUser(db, null, (tx) => tx.query('select key from public.site_content'));
    expect(pub.rows.length).toBeGreaterThan(0);
    const drafts = await asUser(db, null, (tx) => tx.query('select * from public.site_content_revisions')).then(() => null, (e: Error) => e.message);
    expect(drafts).toMatch(/permission denied/);
  });
});

describe('privacy shape', () => {
  it('website events have no column that can hold an IP address, email or user id', async () => {
    const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'site_events'`)).map((r) => r.column_name);
    expect(cols).not.toContain('ip');
    expect(cols.some((c) => /ip|email|user/.test(c))).toBe(false);
    expect(await fails(`insert into public.site_events(event, path, session_id, visitor_key) values ('pageview', '/x', 'abcdefgh', '10.0.0.1')`)).toMatch(/check/);
    expect(await fails(`insert into public.site_events(event, path, session_id, visitor_key) values ('pageview', 'https://evil', 'abcdefgh', $1)`, [KEY(1)])).toMatch(/check/);
  });

  it('security events keep only a prefix and a keyed hash', async () => {
    const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'security_events'`)).map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['ip_prefix', 'ip_hash']));
    expect(cols).not.toContain('ip');
    expect(await fails(`insert into public.security_events(kind, ip_hash) values ('auth_failed', '203.0.113.9')`)).toMatch(/check/);
  });

  it('product events carry bounded properties and are deduplicated', async () => {
    await q(`insert into public.product_events(event, user_id, dedupe_key) values ('signup_completed', $1, $2)`, [USER_A, `signup_completed:${USER_A}`]);
    expect(await fails(`insert into public.product_events(event, user_id, dedupe_key) values ('signup_completed', $1, $2)`, [USER_A, `signup_completed:${USER_A}`])).toMatch(/duplicate|unique/);
    expect(await fails(`insert into public.product_events(event, dedupe_key) values ('made_up_event', 'k-00000001')`)).toMatch(/check/);
    expect(await fails(`insert into public.product_events(event, dedupe_key, properties) values ('report_opened', 'k-00000002', $1)`, [JSON.stringify({ blob: 'x'.repeat(5000) })])).toMatch(/check/);
    await q('delete from public.product_events');
  });
});

describe('content history', () => {
  it('019 seeds version 1 of every live key as published', async () => {
    const rows = await q<{ key: string; version: number; status: string }>(`select key, version, status from public.site_content_revisions order by key`);
    expect(rows.map((r) => r.key)).toEqual(['contact', 'hero', 'status']);
    expect(rows.every((r) => r.version === 1 && r.status === 'published')).toBe(true);
  });

  it('allows one draft and one live revision per key, and published history is append-only', async () => {
    await q(`insert into public.site_content_revisions(key, version, value, status) values ('hero', 2, '{"headline":"a"}', 'draft')`);
    expect(await fails(`insert into public.site_content_revisions(key, version, value, status) values ('hero', 3, '{"headline":"b"}', 'draft')`)).toMatch(/duplicate|unique/);
    expect(await fails(`update public.site_content_revisions set value = '{"headline":"edited"}' where key = 'hero' and version = 1`)).toMatch(/append-only/);
    expect(await fails(`delete from public.site_content_revisions where key = 'hero' and version = 1`)).toMatch(/append-only/);
    expect(await fails(`update public.site_content_revisions set version = 9 where key = 'hero' and version = 2`)).toMatch(/immutable/);
    // A draft can still be edited or discarded.
    await q(`update public.site_content_revisions set value = '{"headline":"a2"}' where key = 'hero' and version = 2`);
    expect(await fails(`insert into public.site_content_revisions(key, version, value, status) values ('hero', 3, '{}', 'published')`)).toMatch(/check|duplicate|unique/);
    await q(`update public.site_content_revisions set status = 'discarded' where key = 'hero' and version = 2`);
    expect(await fails(`update public.site_content_revisions set status = 'draft' where key = 'hero' and version = 2`)).toMatch(/reopened/);
  });
});

describe('flag targeting', () => {
  it('accepts the five targeting modes and requires a percentage only for limited rollout', async () => {
    await q(`update public.feature_flags set targeting = 'internal' where key = 'zevir_graph_ui'`);
    await q(`update public.feature_flags set targeting = 'limited', rollout_percent = 25 where key = 'zevir_graph_ui'`);
    expect(await fails(`update public.feature_flags set targeting = 'limited', rollout_percent = null where key = 'zevir_graph_ui'`)).toMatch(/check/);
    expect(await fails(`update public.feature_flags set targeting = 'on', rollout_percent = 10 where key = 'zevir_graph_ui'`)).toMatch(/check/);
    expect(await fails(`update public.feature_flags set targeting = 'everyone', rollout_percent = null where key = 'zevir_graph_ui'`)).toMatch(/check/);
    expect(await fails(`update public.feature_flags set targeting = 'limited', rollout_percent = 101 where key = 'zevir_graph_ui'`)).toMatch(/check/);
    await q(`update public.feature_flags set targeting = null, rollout_percent = null where key = 'zevir_graph_ui'`);
  });

  it('seeds visitor intelligence off and first-party product analytics on', async () => {
    const flags = await q<{ key: string; enabled: boolean }>(`select key, enabled from public.feature_flags where key in ('visitor_intelligence', 'product_analytics', 'zevir_graph_ui') order by key`);
    expect(flags).toEqual([
      { key: 'product_analytics', enabled: true },
      { key: 'visitor_intelligence', enabled: false },
      { key: 'zevir_graph_ui', enabled: false },
    ]);
  });
});

describe('aggregates', () => {
  it('summarises website traffic by session, excludes bots and honours the half-open range', async () => {
    await q('delete from public.site_events');
    const ins = (at: string, event: string, path: string, session: string, visitor: number, extra: Record<string, unknown> = {}) =>
      q(`insert into public.site_events(occurred_at, event, path, session_id, visitor_key, referrer_host, utm_source, cta, country, device, browser, is_bot)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [at, event, path, session, KEY(visitor), extra.ref ?? null, extra.utm ?? null, extra.cta ?? null, extra.country ?? null, extra.device ?? 'desktop', extra.browser ?? 'chrome', extra.bot ?? false]);
    await ins('2026-09-01T10:00:00Z', 'pageview', '/', 'sessionAAAA', 1, { ref: 'news.example', utm: 'launch', country: 'MN' });
    await ins('2026-09-01T10:01:00Z', 'pageview', '/product', 'sessionAAAA', 1);
    await ins('2026-09-01T10:02:00Z', 'cta_click', '/product', 'sessionAAAA', 1, { cta: 'hero.primary' });
    await ins('2026-09-01T10:03:00Z', 'evaluation_submitted', '/evaluation', 'sessionAAAA', 1);
    await ins('2026-09-02T09:00:00Z', 'pageview', '/security', 'sessionBBBB', 2, { country: 'DE', device: 'mobile', browser: 'safari' });
    await ins('2026-09-02T09:00:00Z', 'pageview', '/', 'botbotbot1', 3, { bot: true, device: 'bot', browser: 'bot' });
    // Exactly at the end of the range: excluded.
    await ins('2026-09-03T00:00:00Z', 'pageview', '/', 'sessionCCCC', 4);
    const [{ result: s }] = await q<{ result: Record<string, any> }>(`select public.analytics_site_summary('2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z') as result`); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.totals).toMatchObject({ pageviews: 3, sessions: 2, visitor_days: 2, cta_clicks: 1, evaluations_submitted: 1 });
    expect(s.funnel).toEqual({ sessions: 2, cta: 1, signup_started: 0, evaluation_submitted: 1 });
    expect(s.daily.map((d: { day: string }) => d.day)).toEqual(['2026-09-01', '2026-09-02']);
    expect(s.landing_pages[0]).toMatchObject({ path: '/', sessions: 1, converted: 1 });
    expect(s.referrers).toEqual(expect.arrayContaining([{ referrer: 'news.example', sessions: 1 }, { referrer: '(direct)', sessions: 1 }]));
    expect(s.campaigns.find((c: { source: string }) => c.source === 'launch')).toMatchObject({ sessions: 1, converted: 1 });
    expect(s.countries).toEqual(expect.arrayContaining([{ country: 'MN', sessions: 1 }, { country: 'DE', sessions: 1 }]));
    expect(s.signals.bot_events).toBe(1);
    expect(JSON.stringify(s)).not.toMatch(new RegExp(KEY(1)));
  });

  it('builds a strict product funnel and weekly retention from real events', async () => {
    await q('delete from public.product_events');
    const users = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
    for (const u of users) await q('insert into auth.users(id) values ($1) on conflict do nothing', [u]);
    let n = 0;
    const ev = (u: string, event: string, at: string) => q(`insert into public.product_events(event, user_id, occurred_at, dedupe_key) values ($1,$2,$3,$4)`, [event, u, at, `t-${(n += 1).toString().padStart(8, '0')}`]);
    // u1 goes all the way; u2 stops after the workspace; u3 has a baseline but no evidence step (not counted past workspace).
    await ev(users[0], 'signup_completed', '2026-09-07T10:00:00Z');
    for (const [e, at] of [['workspace_created', '2026-09-07T11:00:00Z'], ['trace_imported', '2026-09-07T12:00:00Z'], ['baseline_created', '2026-09-07T13:00:00Z'], ['plan_search_started', '2026-09-08T09:00:00Z'], ['full_replay_completed', '2026-09-08T10:00:00Z'], ['verdict_verified', '2026-09-08T10:00:01Z'], ['report_opened', '2026-09-15T10:00:00Z'], ['plan_selected', '2026-09-08T11:00:00Z']]) await ev(users[0], e, at);
    await ev(users[1], 'signup_completed', '2026-09-07T10:00:00Z');
    await ev(users[1], 'workspace_created', '2026-09-07T10:30:00Z');
    await ev(users[2], 'signup_completed', '2026-09-08T10:00:00Z');
    await ev(users[2], 'workspace_created', '2026-09-08T10:05:00Z');
    await ev(users[2], 'baseline_created', '2026-09-08T10:10:00Z');
    const [{ result: p }] = await q<{ result: Record<string, any> }>(`select public.analytics_product_summary('2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z') as result`); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.funnel).toEqual({ signup: 3, workspace: 3, evidence: 1, baseline: 1, search: 1, replay: 1, verdict: 1, evidence_viewed: 1 });
    expect(p.counts.signup_completed).toBe(3);
    expect(p.active).toEqual({ users: 3, workspaces: 0 });
    const cohort = p.retention.find((r: { week: string }) => r.week === '2026-09-07');
    expect(cohort.size).toBe(3);
    // Week 1 (Sep 14–20): only u1 opened a report.
    expect(cohort.retained[1]).toBe(1);
    expect(p.time_to_first.baseline_users).toBe(2);
    expect(p.time_to_verified.users).toBe(1);
    expect(p.time_to_verified.hours_median).toBeCloseTo(25, 5);
  });
});

describe('rollback', () => {
  it('removes 019 completely, leaves published content alone, and can be re-applied', async () => {
    const fresh = await createDb();
    await fresh.query(`update public.site_content set value = '{"headline":"live copy"}' where key = 'hero'`);
    await fresh.exec(rollback);
    const left = await fresh.query<{ n: number }>(`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
    expect(left.rows[0].n).toBe(0);
    const cols = await fresh.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'feature_flags' and column_name in ('targeting', 'rollout_percent')`);
    expect(cols.rows[0].n).toBe(0);
    const hero = await fresh.query<{ v: string }>(`select value->>'headline' v from public.site_content where key = 'hero'`);
    expect(hero.rows[0].v).toBe('live copy');
    const flags = await fresh.query<{ n: number }>(`select count(*)::int n from public.feature_flags where key in ('zevir_graph_ui', 'visitor_intelligence', 'product_analytics', 'experimental_graph_overlays')`);
    expect(flags.rows[0].n).toBe(0);
    await fresh.exec(migration('019_product_experience.sql'));
    const back = await fresh.query<{ n: number }>(`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
    expect(back.rows[0].n).toBe(TABLES.length);
  }, 60_000);

  it('passes the production dry-run wrapper and leaves nothing behind', async () => {
    const fresh = await createDb({ experience: false });
    await fresh.exec(PLATFORM_V3);
    const wrapped = `do $dry$
begin
${migration('019_product_experience.sql')}
raise exception 'OPT19_DRY_RUN_OK';
end
$dry$;`;
    await expect(fresh.exec(wrapped)).rejects.toThrow('OPT19_DRY_RUN_OK');
    expect((await fresh.query<{ t: string | null }>(`select to_regclass('public.site_events')::text t`)).rows[0].t).toBeNull();
    expect((await fresh.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'feature_flags' and column_name = 'targeting'`)).rows[0].n).toBe(0);
  }, 60_000);
});
