-- Design-partner / trial evaluation record: one per project (one authorized
-- workload). Holds only what people decide: customer, agreed data boundary,
-- fixtures, success criteria, recommendation, limitations, next decision.
-- Baseline, requirements, experiments and verdicts stay in the engine tables.
--
-- Additive; existing rows get null (no trial). Server-only like every engine
-- table: no client grant is added.

alter table public.engine_products
  add column if not exists evaluation_trial jsonb;

comment on column public.engine_products.evaluation_trial is
  'Design-partner evaluation record (sanitizeTrial in api/_lib/product/trial.js). data_boundary_confirmed is stamped by the server.';
