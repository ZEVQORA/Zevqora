-- vNext Part 3: product experience, analytics and admin control plane.
--
-- Additive. Requires 004 (profiles, admin_roles, site_content, feature_flags,
-- workspaces). Nothing here touches the proof loop: no engine, ZevIR or
-- optimization table is altered.
--
--   site_events            first-party website analytics (cookieless; no raw IP)
--   product_events         typed, versioned product usage events (deduplicated)
--   security_events        security operations boundary (truncated IP + keyed hash, 90 days)
--   evaluation_requests    the public "evaluate your AI workload" form
--   site_content_revisions CMS drafts, publish history and rollback for site_content
--   feature_flags          + targeting (off | internal | selected | limited | on) + rollout_percent
--
-- Every new table is server-only: RLS on, no browser policy, every hostile
-- default grant revoked explicitly, service_role only. Published site content
-- stays in site_content (public read, as before); drafts never leave the server.
--
-- Rollback: supabase/rollback/019_product_experience.rollback.sql.

-- ------------------------------------------------------------- website events
create table if not exists public.site_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event text not null check (event in ('pageview', 'cta_click', 'signup_started', 'evaluation_submitted', 'outbound_click')),
  path text not null check (path ~ '^/' and char_length(path) <= 200),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 120),
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 100),
  cta text check (cta is null or cta ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  region text check (region is null or char_length(region) <= 64),
  device text not null default 'unknown' check (device in ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  browser text not null default 'other' check (browser in ('chrome', 'safari', 'firefox', 'edge', 'other', 'bot')),
  -- Random per-tab id from sessionStorage: dies with the tab, never a cookie.
  session_id text not null check (session_id ~ '^[A-Za-z0-9]{8,64}$'),
  -- HMAC(daily secret, ip | user agent | day): rotates daily, cannot be reversed or joined across days.
  visitor_key text not null check (visitor_key ~ '^[0-9a-f]{64}$'),
  is_bot boolean not null default false
);
create index if not exists site_events_occurred_idx on public.site_events(occurred_at desc);
create index if not exists site_events_session_idx on public.site_events(session_id, occurred_at);

-- ------------------------------------------------------------- product events
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event text not null check (event in (
    'signup_started', 'signup_completed', 'workspace_created', 'project_created', 'evidence_connected',
    'trace_imported', 'baseline_created', 'contract_frozen', 'diagnosis_viewed', 'plan_search_started',
    'calibration_completed', 'full_replay_completed', 'verdict_verified', 'verdict_rejected',
    'verdict_incomplete', 'pareto_viewed', 'plan_selected', 'report_opened', 'evaluation_requested')),
  version smallint not null default 1 check (version between 1 and 99),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  subject_type text check (subject_type is null or subject_type ~ '^[a-z_]{2,40}$'),
  subject_id text check (subject_id is null or char_length(subject_id) <= 80),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object' and pg_column_size(properties) <= 2048),
  source text not null default 'server' check (source in ('server', 'client')),
  -- A retried request can never count twice.
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200)
);
create index if not exists product_events_occurred_idx on public.product_events(occurred_at desc);
create index if not exists product_events_user_idx on public.product_events(user_id, event);
create index if not exists product_events_workspace_idx on public.product_events(workspace_id, occurred_at desc);

-- ------------------------------------------------------------ security events
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('auth_failed', 'account_suspended', 'authz_denied', 'cross_workspace_denied', 'admin_denied', 'rate_limited', 'unexpected_error', 'admin_action', 'config_change', 'flag_change', 'cms_publish', 'connection_revoked')),
  severity text not null default 'info' check (severity in ('info', 'low', 'medium', 'high')),
  method text check (method is null or method ~ '^[A-Z]{3,7}$'),
  route text check (route is null or char_length(route) <= 200),
  status integer check (status is null or status between 100 and 599),
  code text check (code is null or char_length(code) <= 60),
  actor_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  -- IPv4 /24 or IPv6 /48 only; never the full address.
  ip_prefix text check (ip_prefix is null or char_length(ip_prefix) <= 64),
  -- Keyed hash for correlating repeat sources inside the retention window.
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096)
);
create index if not exists security_events_occurred_idx on public.security_events(occurred_at desc);
create index if not exists security_events_kind_idx on public.security_events(kind, occurred_at desc);

-- -------------------------------------------------------- evaluation requests
create table if not exists public.evaluation_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and char_length(email) <= 200),
  company text not null check (char_length(company) between 1 and 160),
  role_title text check (role_title is null or char_length(role_title) <= 120),
  workload text not null check (char_length(workload) between 10 and 2000),
  ai_spend_band text not null default 'unknown' check (ai_spend_band in ('unknown', 'under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k')),
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object' and pg_column_size(source) <= 1024),
  consent boolean not null check (consent),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists evaluation_requests_created_idx on public.evaluation_requests(created_at desc);

-- ------------------------------------------------------- site content history
create table if not exists public.site_content_revisions (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  version integer not null check (version >= 1),
  value jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 32768),
  status text not null check (status in ('draft', 'published', 'superseded', 'discarded')),
  note text check (note is null or char_length(note) <= 300),
  source_revision_id uuid references public.site_content_revisions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  constraint site_content_revisions_published_stamp check (status not in ('published', 'superseded') or published_at is not null),
  unique (key, version)
);
-- One open draft and one live revision per key.
create unique index if not exists site_content_revisions_one_draft on public.site_content_revisions(key) where status = 'draft';
create unique index if not exists site_content_revisions_one_live on public.site_content_revisions(key) where status = 'published';

-- Published history is append-only: a revision's value never changes once it left draft.
create or replace function public.site_content_revisions_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'published content history is append-only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'draft' and new.value is distinct from old.value then
      raise exception 'published content history is append-only' using errcode = '42501';
    end if;
    if new.key is distinct from old.key or new.version is distinct from old.version then
      raise exception 'revision identity is immutable' using errcode = '42501';
    end if;
    if old.status in ('superseded', 'discarded') and new.status is distinct from old.status then
      raise exception 'a closed revision cannot be reopened' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists site_content_revisions_guard on public.site_content_revisions;
create trigger site_content_revisions_guard before update or delete on public.site_content_revisions
  for each row execute function public.site_content_revisions_guard();

-- Publishing is one transaction: the live revision is superseded, the draft
-- becomes live and site_content (what the public site reads) is updated.
create or replace function public.cms_publish(p_revision uuid, p_actor uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  r public.site_content_revisions;
begin
  select * into r from public.site_content_revisions where id = p_revision for update;
  if not found then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'only a draft can be published' using errcode = '22023';
  end if;
  update public.site_content_revisions set status = 'superseded' where key = r.key and status = 'published';
  update public.site_content_revisions set status = 'published', published_at = now(), published_by = p_actor where id = r.id;
  insert into public.site_content (key, value, updated_by, updated_at) values (r.key, r.value, p_actor, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('key', r.key, 'version', r.version, 'revision_id', r.id);
end;
$$;

-- ------------------------------------------------------------- flag targeting
alter table public.feature_flags add column if not exists targeting text;
alter table public.feature_flags add column if not exists rollout_percent integer;
alter table public.feature_flags drop constraint if exists feature_flags_targeting_check;
alter table public.feature_flags add constraint feature_flags_targeting_check
  check (targeting is null or targeting in ('off', 'internal', 'selected', 'limited', 'on'));
alter table public.feature_flags drop constraint if exists feature_flags_rollout_check;
alter table public.feature_flags add constraint feature_flags_rollout_check
  check (
    (rollout_percent is null or (targeting = 'limited' and rollout_percent between 0 and 100))
    and (targeting is distinct from 'limited' or rollout_percent is not null)
  );

insert into public.feature_flags (key, description, enabled) values
  ('zevir_graph_ui', 'Interactive ZevIR Graph Explorer in the product (needs zevir_shadow_v01 for data).', false),
  ('experimental_graph_overlays', 'Experimental Graph Explorer overlays (security/policy metadata).', false),
  ('visitor_intelligence', 'Record first-party, cookieless website analytics (no raw IP; DNT/GPC respected).', false),
  ('product_analytics', 'Record first-party product usage events (typed taxonomy; ids and counts only).', true)
on conflict (key) do nothing;

-- ------------------------------------------------------------ aggregations
-- Aggregated in SQL so no API row cap can silently truncate a chart.
create or replace function public.analytics_site_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with ev as (
    select * from public.site_events where occurred_at >= p_from and occurred_at < p_to
  ),
  human as (select * from ev where not is_bot),
  landing as (
    select distinct on (session_id) session_id, path, referrer_host, utm_source, utm_medium, utm_campaign, country, region, device, browser
    from human where event = 'pageview' order by session_id, occurred_at
  ),
  converted as (
    select session_id, bool_or(event = 'cta_click') as cta, bool_or(event = 'signup_started') as signup, bool_or(event = 'evaluation_submitted') as evaluation
    from human group by session_id
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
      'pageviews', count(*) filter (where event = 'pageview'),
      'visitor_days', count(distinct visitor_key),
      'sessions', count(distinct session_id),
      'cta_clicks', count(*) filter (where event = 'cta_click'),
      'signups_started', count(*) filter (where event = 'signup_started'),
      'evaluations_submitted', count(*) filter (where event = 'evaluation_submitted'),
      'last_event_at', max(occurred_at)) from human),
    'daily', coalesce((select jsonb_agg(d order by d->>'day') from (
      select jsonb_build_object('day', to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD'),
        'pageviews', count(*) filter (where event = 'pageview'),
        'visitors', count(distinct visitor_key),
        'sessions', count(distinct session_id),
        'cta_clicks', count(*) filter (where event = 'cta_click'),
        'evaluations', count(*) filter (where event = 'evaluation_submitted')) as d
      from human group by date_trunc('day', occurred_at at time zone 'UTC')) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(p order by (p->>'pageviews')::int desc, p->>'path') from (
      select jsonb_build_object('path', path, 'pageviews', count(*), 'sessions', count(distinct session_id)) as p
      from human where event = 'pageview' group by path order by count(*) desc, path limit 25) x), '[]'::jsonb),
    'landing_pages', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc, p->>'path') from (
      select jsonb_build_object('path', l.path, 'sessions', count(*), 'converted', count(*) filter (where c.signup or c.evaluation)) as p
      from landing l join converted c using (session_id) group by l.path order by count(*) desc, l.path limit 25) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc, p->>'referrer') from (
      select jsonb_build_object('referrer', coalesce(referrer_host, '(direct)'), 'sessions', count(*)) as p
      from landing group by coalesce(referrer_host, '(direct)') order by count(*) desc limit 25) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc, p->>'source') from (
      select jsonb_build_object('source', coalesce(l.utm_source, '(none)'), 'medium', coalesce(l.utm_medium, '(none)'), 'campaign', coalesce(l.utm_campaign, '(none)'),
        'sessions', count(*), 'converted', count(*) filter (where c.signup or c.evaluation)) as p
      from landing l join converted c using (session_id)
      group by coalesce(l.utm_source, '(none)'), coalesce(l.utm_medium, '(none)'), coalesce(l.utm_campaign, '(none)') order by count(*) desc limit 25) x), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc, p->>'country') from (
      select jsonb_build_object('country', coalesce(country, '??'), 'sessions', count(*)) as p from landing group by coalesce(country, '??') order by count(*) desc limit 50) x), '[]'::jsonb),
    'regions', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc) from (
      select jsonb_build_object('country', coalesce(country, '??'), 'region', region, 'sessions', count(*)) as p from landing where region is not null group by coalesce(country, '??'), region order by count(*) desc limit 25) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc) from (
      select jsonb_build_object('device', device, 'sessions', count(*)) as p from landing group by device) x), '[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(p order by (p->>'sessions')::int desc) from (
      select jsonb_build_object('browser', browser, 'sessions', count(*)) as p from landing group by browser) x), '[]'::jsonb),
    'ctas', coalesce((select jsonb_agg(p order by (p->>'clicks')::int desc) from (
      select jsonb_build_object('cta', cta, 'clicks', count(*), 'sessions', count(distinct session_id)) as p from human where event = 'cta_click' and cta is not null group by cta order by count(*) desc limit 25) x), '[]'::jsonb),
    'funnel', (select jsonb_build_object(
      'sessions', count(*),
      'cta', count(*) filter (where cta or signup or evaluation),
      'signup_started', count(*) filter (where signup),
      'evaluation_submitted', count(*) filter (where evaluation)) from converted),
    'signals', (select jsonb_build_object(
      'bot_events', (select count(*) from ev where is_bot),
      'heavy_sessions', (select count(*) from (select session_id from human group by session_id having count(*) > 200) h),
      'max_events_per_session', coalesce((select max(n) from (select count(*) as n from human group by session_id) m), 0))),
    'recent', coalesce((select jsonb_agg(r order by r->>'occurred_at' desc) from (
      select jsonb_build_object('occurred_at', occurred_at, 'event', event, 'path', path, 'cta', cta, 'country', country, 'device', device, 'referrer', referrer_host) as r
      from human order by occurred_at desc limit 40) x), '[]'::jsonb)
  );
$$;

create or replace function public.analytics_product_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with ev as (
    select * from public.product_events where occurred_at < p_to
  ),
  in_range as (select * from ev where occurred_at >= p_from),
  cohort as (
    select user_id, min(occurred_at) as signed_up from ev where event = 'signup_completed' and user_id is not null group by user_id
    having min(occurred_at) >= p_from
  ),
  steps as (
    select c.user_id,
      true as s1,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event = 'workspace_created') as s2,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event in ('evidence_connected', 'trace_imported')) as s3,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event = 'baseline_created') as s4,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event = 'plan_search_started') as s5,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event = 'full_replay_completed') as s6,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event in ('verdict_verified', 'verdict_rejected', 'verdict_incomplete')) as s7,
      exists (select 1 from ev e where e.user_id = c.user_id and e.event = 'report_opened') as s8
    from cohort c
  ),
  weeks as (
    select user_id, date_trunc('week', signed_up) as cohort_week from cohort
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(event, n) from (select event, count(*) as n from in_range group by event) x), '{}'::jsonb),
    'daily', coalesce((select jsonb_agg(d order by d->>'day') from (
      select jsonb_build_object('day', to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD'), 'events', count(*), 'active_users', count(distinct user_id), 'active_workspaces', count(distinct workspace_id)) as d
      from in_range group by date_trunc('day', occurred_at at time zone 'UTC')) x), '[]'::jsonb),
    'active', (select jsonb_build_object('users', count(distinct user_id), 'workspaces', count(distinct workspace_id)) from in_range),
    -- Strict funnel over users who signed up in the range: a step counts a user
    -- only if every earlier step was also reached.
    'funnel', (select jsonb_build_object(
      'signup', count(*),
      'workspace', count(*) filter (where s2),
      'evidence', count(*) filter (where s2 and s3),
      'baseline', count(*) filter (where s2 and s3 and s4),
      'search', count(*) filter (where s2 and s3 and s4 and s5),
      'replay', count(*) filter (where s2 and s3 and s4 and s5 and s6),
      'verdict', count(*) filter (where s2 and s3 and s4 and s5 and s6 and s7),
      'evidence_viewed', count(*) filter (where s2 and s3 and s4 and s5 and s6 and s7 and s8)) from steps),
    'retention', coalesce((select jsonb_agg(r order by r->>'week') from (
      select jsonb_build_object('week', to_char(w.cohort_week, 'YYYY-MM-DD'), 'size', count(distinct w.user_id),
        'retained', (select jsonb_agg(n order by k) from (
          select k, count(distinct e.user_id) as n from generate_series(0, 7) k
          left join ev e on e.user_id in (select user_id from weeks w2 where w2.cohort_week = w.cohort_week)
            and e.event <> 'signup_completed'
            and e.occurred_at >= w.cohort_week + (k || ' weeks')::interval
            and e.occurred_at < w.cohort_week + ((k + 1) || ' weeks')::interval
          where w.cohort_week + (k || ' weeks')::interval < p_to
          group by k) z)) as r
      from weeks w group by w.cohort_week) x), '[]'::jsonb),
    'time_to_first', (select jsonb_build_object(
      'baseline_hours_median', percentile_cont(0.5) within group (order by extract(epoch from (b.first_at - c.signed_up)) / 3600.0),
      'baseline_users', count(*)) from cohort c
      join lateral (select min(occurred_at) as first_at from ev e where e.user_id = c.user_id and e.event = 'baseline_created') b on b.first_at is not null),
    'time_to_verified', (select jsonb_build_object(
      'hours_median', percentile_cont(0.5) within group (order by extract(epoch from (v.first_at - c.signed_up)) / 3600.0),
      'users', count(*)) from cohort c
      join lateral (select min(occurred_at) as first_at from ev e where e.user_id = c.user_id and e.event = 'plan_selected') v on v.first_at is not null),
    'last_event_at', (select max(occurred_at) from in_range)
  );
$$;

-- --------------------------------------------------------------- privileges
alter table public.site_events enable row level security;
alter table public.product_events enable row level security;
alter table public.security_events enable row level security;
alter table public.evaluation_requests enable row level security;
alter table public.site_content_revisions enable row level security;

revoke all on public.site_events, public.product_events, public.security_events, public.evaluation_requests, public.site_content_revisions from anon, authenticated;
grant all on public.site_events, public.product_events, public.security_events, public.evaluation_requests, public.site_content_revisions to service_role;

revoke all on function public.site_content_revisions_guard() from public, anon, authenticated;
revoke all on function public.cms_publish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cms_publish(uuid, uuid) to service_role;
revoke all on function public.analytics_site_summary(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.analytics_product_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.analytics_site_summary(timestamptz, timestamptz) to service_role;
grant execute on function public.analytics_product_summary(timestamptz, timestamptz) to service_role;

-- Seed the history with the content that is live today, so the first rollback has a target.
insert into public.site_content_revisions (key, version, value, status, note, published_at)
select key, 1, value, 'published', 'Imported from site_content by 019', coalesce(updated_at, now())
from public.site_content
on conflict (key, version) do nothing;
