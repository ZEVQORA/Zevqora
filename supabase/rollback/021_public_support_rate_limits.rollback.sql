-- Rollback for 021_public_support_rate_limits.sql.
--
-- Drops the public rate-limit function and its counter table. The table holds
-- only opaque bucket keys and counters, so no user data is lost. After this,
-- POST /api/support/message serves FAQ answers behind its in-memory limit only
-- and keeps generative answers off.

begin;

drop function if exists public.public_rate_limit_hit(text, integer, integer);
drop table if exists public.public_rate_limits;

commit;
