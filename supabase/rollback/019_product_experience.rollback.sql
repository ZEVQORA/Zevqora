-- Rollback for 019_product_experience.sql.
--
-- Drops the Part 3 analytics, security-event, evaluation-request and CMS
-- history tables, the aggregate functions and the flag targeting columns, and
-- removes the four flags 019 seeded. site_content (the published website copy)
-- is not touched, so the public site keeps whatever was last published.
--
-- Data loss: website analytics, product events, security events, evaluation
-- requests and content history are deleted. Export evaluation_requests first
-- if they must be kept (they are leads). 016–018 are not touched.
--
-- Turn the Part 3 flags off and roll the application back first: the Part 3
-- API writes to these tables.

begin;

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
