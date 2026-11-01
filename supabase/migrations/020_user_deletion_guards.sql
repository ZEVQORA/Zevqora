-- 020: let a user (or a workspace owner) be deleted after they froze a contract or made a decision.
--
-- 017 and 018 reference auth.users with `on delete set null` (created_by,
-- frozen_by, cancelled_by). Deleting a user therefore UPDATEs those rows, and
-- the immutability guards rejected that UPDATE:
--   evaluation_contracts_guard → CONTRACT_IMMUTABLE for a frozen or superseded contract,
--   plan_decisions_guard       → DECISION_IMMUTABLE for every decision.
-- Found on staging: the Supabase admin API could not delete a test user who
-- had frozen a contract, so the account and its workspace stayed behind.
--
-- The guards now accept exactly that foreign-key action: run by the database
-- (pg_trigger_depth() > 1), only nulling the user/contract reference columns,
-- with every other column unchanged. A direct UPDATE of the same columns is
-- still refused. optimization_runs_bind_contract no longer re-reads the
-- contract on an UPDATE that keeps the contract (the read could fail while the
-- same cascade deletes the contract); changing the contract stays refused.
--
-- When one user is both created_by and frozen_by (or created_by and
-- cancelled_by), the two set-null actions would update the row twice. Postgres
-- re-checks every foreign key of a row updated twice in one transaction, and
-- when the user is the workspace owner that check can run after the cascade
-- removed the product but before it removed the row (23503). The first
-- set-null update therefore clears every column that holds the deleted user,
-- so the second action finds nothing to update.
--
-- execution_plans_evaluation_fk was `on delete set null (evaluation_id)`. The
-- product cascade deletes engine_plans → engine_executions → engine_evaluations,
-- and nulling evaluation_id on a VERIFIED plan breaks
-- execution_plans_verified_evidence (23514), so no product, workspace or owner
-- with a verified plan could be deleted. A verdict cannot outlive its evidence:
-- the plan now goes with its evaluation (on delete cascade). No route deletes an
-- evaluation on its own; it only goes with its product.
--
-- Idempotent: `create or replace function` and one foreign key replaced in a
-- single statement. Rollback: supabase/rollback/020_user_deletion_guards.rollback.sql.

create or replace function public.evaluation_contracts_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- pg_trigger_depth() > 1: the row is going away with its product or workspace (FK cascade).
    if old.status <> 'draft' and pg_trigger_depth() <= 1 then raise exception 'CONTRACT_IMMUTABLE: contract % v% is % and cannot be deleted', old.id, old.version, old.status using errcode = '23514'; end if;
    return old;
  end if;
  -- `on delete set null` from a deleted user or contract: only those references become null.
  if pg_trigger_depth() > 1
     and (new.created_by is null or new.created_by = old.created_by)
     and (new.frozen_by is null or new.frozen_by = old.frozen_by)
     and (new.superseded_by is null or new.superseded_by = old.superseded_by)
     and (to_jsonb(new) - array['created_by', 'frozen_by', 'superseded_by']) = (to_jsonb(old) - array['created_by', 'frozen_by', 'superseded_by']) then
    -- Clear the deleted user from both columns in this one update.
    if new.created_by is null and old.created_by is not null and new.frozen_by = old.created_by then new.frozen_by := null; end if;
    if new.frozen_by is null and old.frozen_by is not null and new.created_by = old.frozen_by then new.created_by := null; end if;
    return new;
  end if;
  if old.status = 'draft' then
    if new.product_id <> old.product_id or new.workspace_id <> old.workspace_id or new.version <> old.version then
      raise exception 'CONTRACT_IMMUTABLE: a contract cannot move to another product, workspace or version' using errcode = '23514';
    end if;
    if new.status = 'superseded' then raise exception 'CONTRACT_IMMUTABLE: a draft cannot be superseded' using errcode = '23514'; end if;
    return new;
  end if;
  if old.status = 'frozen' and new.status = 'superseded'
     and new.requirements = old.requirements and new.contract_hash = old.contract_hash and new.version = old.version
     and new.product_id = old.product_id and new.workspace_id = old.workspace_id and new.frozen_at = old.frozen_at
     and new.frozen_by is not distinct from old.frozen_by then
    return new;
  end if;
  raise exception 'CONTRACT_IMMUTABLE: contract % v% is % and cannot change; create a new version', old.id, old.version, old.status using errcode = '23514';
end;
$$;

create or replace function public.optimization_runs_bind_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare c record;
begin
  if tg_op = 'UPDATE' then
    if new.contract_id <> old.contract_id or new.contract_hash <> old.contract_hash or new.product_id <> old.product_id then
      raise exception 'RUN_CONTRACT_IMMUTABLE: a run keeps the contract it started with' using errcode = '23514';
    end if;
    return new;
  end if;
  select product_id, status, contract_hash into c from public.evaluation_contracts where id = new.contract_id;
  if not found or c.product_id <> new.product_id then raise exception 'RUN_CONTRACT_MISMATCH: contract belongs to another product' using errcode = '23514'; end if;
  if c.status <> 'frozen' then raise exception 'RUN_CONTRACT_NOT_FROZEN: freeze the contract before starting a run' using errcode = '23514'; end if;
  if c.contract_hash <> new.contract_hash then raise exception 'RUN_CONTRACT_HASH: run hash does not match the contract' using errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.plan_decisions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare p record;
begin
  -- `on delete set null` from a deleted user: only created_by becomes null.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  if tg_op <> 'INSERT' then raise exception 'DECISION_IMMUTABLE: decisions are append-only' using errcode = '23514'; end if;
  if new.selected_plan_id is null then return new; end if;
  select search_id, verdict, frontier_state into p from public.execution_plans where id = new.selected_plan_id;
  if not found or p.search_id <> new.search_id then raise exception 'DECISION_PLAN_MISMATCH: the selected plan belongs to another search' using errcode = '23514'; end if;
  if p.verdict is distinct from 'VERIFIED' or p.frontier_state is distinct from 'FRONTIER' then
    raise exception 'DECISION_NOT_ON_FRONTIER: only a VERIFIED plan on the Pareto frontier can be selected' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.plan_searches_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    select contract_id, contract_hash, baseline_snapshot_id, product_id into r from public.optimization_runs where id = new.run_id;
    if not found or r.contract_id <> new.contract_id or r.contract_hash <> new.contract_hash or r.product_id <> new.product_id then
      raise exception 'SEARCH_CONTRACT_MISMATCH: a search uses its run''s frozen contract' using errcode = '23514';
    end if;
    if r.baseline_snapshot_id is distinct from new.baseline_snapshot_id then
      raise exception 'SEARCH_BASELINE_MISMATCH: a search uses its run''s baseline snapshot' using errcode = '23514';
    end if;
    return new;
  end if;
  -- `on delete set null` from a deleted user: clear them from both columns in this one update.
  if pg_trigger_depth() > 1 then
    if new.created_by is null and old.created_by is not null and new.cancelled_by = old.created_by then new.cancelled_by := null; end if;
    if new.cancelled_by is null and old.cancelled_by is not null and new.created_by = old.cancelled_by then new.created_by := null; end if;
  end if;
  if new.run_id <> old.run_id or new.contract_id <> old.contract_id or new.contract_hash <> old.contract_hash
     or new.baseline_snapshot_id <> old.baseline_snapshot_id or new.snapshot_hash <> old.snapshot_hash
     or new.search_hash <> old.search_hash or new.seed <> old.seed or new.bounds <> old.bounds
     or new.evaluation_set_hash <> old.evaluation_set_hash or new.evaluation_set <> old.evaluation_set then
    raise exception 'SEARCH_IMMUTABLE: a search keeps its contract, baseline, bounds, seed and evaluation set' using errcode = '23514';
  end if;
  if old.status in ('cancelled', 'completed', 'budget_exhausted', 'failed') and new.status <> old.status then
    raise exception 'SEARCH_TERMINAL: search is % and cannot change status', old.status using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.evaluation_contracts_guard() from public, anon, authenticated;
revoke all on function public.optimization_runs_bind_contract() from public, anon, authenticated;
revoke all on function public.plan_decisions_guard() from public, anon, authenticated;
revoke all on function public.plan_searches_guard() from public, anon, authenticated;

alter table public.execution_plans
  drop constraint if exists execution_plans_evaluation_fk,
  add constraint execution_plans_evaluation_fk foreign key (evaluation_id, workspace_id) references public.engine_evaluations(id, workspace_id) on delete cascade;
