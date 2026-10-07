-- Rollback for 017_verified_optimization.sql.
--
-- Drops the Optimization Run tables and the lineage columns 017 added to the
-- engine tables. Existing plans, executions and evaluations keep every column
-- they had before 017 and their verdicts are untouched. Run diagnoses,
-- contracts and baselines are lost (contracts are the only non-derived data:
-- export them first if they must be kept). 016 (ZevIR) is not touched.
--
-- Turn the flag off and roll the application back first.

begin;

drop function if exists public.zevir_product_graph_set(uuid, uuid, integer);

drop index if exists public.engine_plans_run_candidate_key;
alter table public.engine_plans drop constraint if exists engine_plans_not_executable_blocked;
alter table public.engine_plans
  drop column if exists run_id,
  drop column if exists diagnosis_id,
  drop column if exists optimization_pass,
  drop column if exists pass_version,
  drop column if exists contract_hash,
  drop column if exists baseline_snapshot_id,
  drop column if exists executable_status,
  drop column if exists candidate_config_hash,
  drop column if exists lineage;
alter table public.engine_executions drop column if exists run_id, drop column if exists contract_hash;
alter table public.engine_evaluations drop column if exists run_id, drop column if exists contract_id, drop column if exists contract_hash, drop column if exists performance_comparison;

alter table if exists public.optimization_runs drop constraint if exists optimization_runs_snapshot_fk;
drop table if exists public.optimization_diagnoses;
drop table if exists public.performance_snapshots;
drop table if exists public.optimization_runs;
drop table if exists public.evaluation_contracts;
drop function if exists public.optimization_runs_bind_contract();
drop function if exists public.evaluation_contracts_guard();
drop function if exists public.evaluation_contract_freeze(uuid, uuid, text);
drop index if exists public.engine_products_id_workspace_key;

delete from public.feature_flags where key = 'verified_optimization_vnext';

commit;
