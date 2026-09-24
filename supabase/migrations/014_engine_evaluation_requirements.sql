-- A project's evaluation requirements: the quality floor, minimum cases,
-- protected-case and latency requirements the team sets during onboarding.
-- POST /api/engine/products/:id/evaluations holds every experiment to them;
-- a request may tighten a gate but never loosen it (enforceRequirements).
--
-- Additive and nullable-by-default; existing rows get {} (no project floor,
-- the engine defaults apply as before). Server-only like every engine table:
-- no client grant is added.

alter table public.engine_products
  add column if not exists evaluation_requirements jsonb not null default '{}'::jsonb;

comment on column public.engine_products.evaluation_requirements is
  'Frozen project gate floor: quality_floor, min_samples, require_protected_cases, require_latency, max_latency_regression_pct, frozen_at, frozen_by.';
