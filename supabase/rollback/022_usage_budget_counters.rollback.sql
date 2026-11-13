-- Rollback for 022_usage_budget_counters.sql.
--
-- Drops the spend-budget function and its counters. Counters hold only opaque
-- bucket names and amounts, so no user data is lost. After this, Engineering
-- Zev makes no paid Claude call (the server fails closed without the budget).

begin;

drop function if exists public.usage_budget_reserve(text, bigint, bigint, integer);
drop table if exists public.usage_budget_counters;

commit;
