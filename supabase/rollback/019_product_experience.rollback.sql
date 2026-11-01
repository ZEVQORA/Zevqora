-- Rollback for 019_product_experience.sql.
--
-- Drops the Part 3 analytics, security-event, evaluation-request and CMS
-- history tables, the aggregate functions and the flag targeting columns, and
-- removes the four flags 019 seeded. The published website copy stays, except
-- that the hero 019 published is put back to 013's copy (see below).
--
-- Data loss: website analytics, product events, security events, evaluation
-- requests and content history are deleted. Export evaluation_requests first
-- if they must be kept (they are leads). 016–018 are not touched.
--
-- Turn the Part 3 flags off and roll the application back first: the Part 3
-- API writes to these tables.

begin;

-- The pre-Part-3 app has no /evaluation or /product page: if the hero still
-- holds the copy 019 published, put 013's copy back (an admin edit is left alone).
update public.site_content
set value = '{"announcement": null, "announcement_href": null, "headline": "Make AI cheaper without guessing.", "subheadline": null, "supporting": "ZEVQORA connects code, runtime and workload evidence, finds expensive AI execution patterns, tests alternatives against the same representative workload, and shows you which change is safe to ship.", "primary_cta": {"label": "Run an evaluation", "href": "/signup?intent=evaluation"}, "secondary_cta": {"label": "See how it works", "href": "/#how-it-works"}, "trust_line": "Measure. Replay. Verify. Then optimize."}'::jsonb, updated_at = now()
where key = 'hero'
  and value->'primary_cta'->>'href' = '/evaluation'
  and value->'secondary_cta'->>'href' = '/product'
  and value->>'trust_line' = 'Measure. Replay. Verify. Then optimize.'
  and value->>'subheadline' = 'ZEVQORA understands how your AI system executes, finds expensive or unreliable paths, and proves which changes are worth shipping.';

drop function if exists public.analytics_site_summary(timestamptz, timestamptz);
drop function if exists public.analytics_product_summary(timestamptz, timestamptz);
drop function if exists public.cms_publish(uuid, uuid);

drop table if exists public.site_content_revisions;
drop function if exists public.site_content_revisions_guard();
drop table if exists public.evaluation_requests;
drop table if exists public.security_events;
drop table if exists public.product_events;
drop table if exists public.site_events;

alter table public.feature_flags drop constraint if exists feature_flags_rollout_check;
alter table public.feature_flags drop constraint if exists feature_flags_targeting_check;
alter table public.feature_flags drop column if exists rollout_percent;
alter table public.feature_flags drop column if exists targeting;

delete from public.feature_flags where key in ('zevir_graph_ui', 'experimental_graph_overlays', 'visitor_intelligence', 'product_analytics');

commit;
