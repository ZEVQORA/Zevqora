-- Rollback for 018_optimization_intelligence.sql.
--
-- Drops the plan-search tables, the lineage columns 018 added to
-- engine_executions / engine_evaluations, the v2 graph read and the lock
-- functions. Materialized execution plans (engine_plans.strategy =
-- 'execution_plan') are derived data and are deleted with their executions and
-- evaluations (FK cascade); every other engine plan, execution and evaluation
-- keeps its pre-018 columns and verdict. Diagnoses of the two structural
-- families are deleted before 017's family check is restored. Decisions and
-- bad-day profiles are lost: export them first if they must be kept.
-- 016 and 017 are not touched.
--
-- Turn the flag off and roll the application back first.

begin;

drop function if exists public.zevir_product_graph_set_v2(uuid, uuid, integer);
drop function if exists public.plan_search_lock(uuid, uuid, integer);
drop function if exists public.plan_search_unlock(uuid, uuid);

alter table public.engine_executions drop column if exists execution_plan_id, drop column if exists search_id, drop column if exists stage;
alter table public.engine_evaluations drop column if exists execution_plan_id, drop column if exists search_id;

drop table if exists public.bad_day_results;
drop table if exists public.bad_day_profiles;
drop table if exists public.plan_decisions;
drop table if exists public.plan_calibrations;
drop table if exists public.execution_plans;
drop table if exists public.plan_searches;
drop function if exists public.plan_searches_guard();
drop function if exists public.plan_decisions_guard();

delete from public.engine_plans where strategy = 'execution_plan';

delete from public.optimization_diagnoses where family in ('agent_workflow', 'retrieval_redundancy');
alter table public.optimization_diagnoses drop constraint if exists optimization_diagnoses_family_check;
alter table public.optimization_diagnoses add constraint optimization_diagnoses_family_check
  check (family in ('redundant_call', 'retry_amplification', 'context_amplification', 'model_overprovisioning', 'latency_critical_path'));

drop index if exists public.engine_plans_id_workspace_key;
drop index if exists public.engine_executions_id_workspace_key;
drop index if exists public.engine_evaluations_id_workspace_key;

delete from public.feature_flags where key = 'optimization_intelligence_vnext';

commit;
