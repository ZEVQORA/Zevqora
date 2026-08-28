# Candidate D — Preregistration (frozen before paid full run)

**Status:** PREREGISTERED  
**Candidate:** D  
**Branch:** `nero/backend-v0.2-candidate-d-quality`  
**Date (local):** 2026-08-27  

Internal dogfooding only. Not customer evidence. Not verified savings until gates pass.

## Immutable priors (do not alter)

- Phase 4C full run `d5ff5d0f-99b5-468a-9bd6-3fd14faaf6df` remains **REJECTED** at 42.01% (`quality_floor` only).
- Dataset **`zev_dogfood_v2` / `2.0.0`** frozen hash:  
  `b7db3921b8641a6b65883b4427852b50b2b3baccc95aa757eb440e0fcb1fafa7`
- Quality floor: **0.95** (unchanged)
- Protected requirements: unchanged (100% protected pass required)
- Graders / gate semantics: unchanged (no evaluator version bump for this candidate)
- Gate config: `FULL_GATE_CONFIG_V2` (`non_inferiority_tolerance=0.0`, latency max regression 50%)

## Candidate D policy / versions

| Component | Version / value |
|-----------|-----------------|
| Policy | `bounded_routing_v1.2.0` |
| Policy config hash | `545d564962042640423833879fe6fc4b669a1d32ae881e8985fd5be503c2138e` |
| Structured output validator | `structured_output_v1.0.0` |
| Product invariants | `product_invariants_v1.0.0` |
| Product invariants hash | `ca26fb2efe6769095788d40a6160fe14a7f48f2861a24bc09eebf2de7aeca1e5` |
| Fixture / evidence harness | `fixture_harness_v1.1.0` |

## Models / fallback

| Role | Model |
|------|-------|
| Baseline (model-first + hard safety) | `openai/gpt-4o-mini` |
| Tier 2 cheap | `google/gemini-2.5-flash-lite` |
| Tier 3 strong | `openai/gpt-4o-mini` |

**Fallback:** Tier 2 invalid structured output / provider error → Tier 3 strong; costs and latency accumulate both attempts. Fallback does **not** inspect expected answers, graders, case IDs, or cohorts.

## Product improvements (general; not case-ID tuned)

1. Per-case fixture isolation (`fixture_harness_v1.1.0`) — clear+seed; candidate restores `product_state_seed` from request snapshot.
2. Structured output contracts (`structured_output_v1.0.0`) — schema from envelope or request text contract; validate; fallback on failure.
3. Product invariants injection (`product_invariants_v1.0.0`) — versioned rules for complex/policy reasoning; closed-label normalization via contracts.

## Pilot procedure (pre-declared)

- Dataset: `zev_dogfood_v2`
- Case selection: frozen `PILOT_V2_CASE_IDS` (deterministic seed=42 selection already fixed in code):  
  `det-001, det-003, det-011, bnd-001, bnd-004, bnd-008, bnd-012, cpx-001, cpx-005, cpx-009, cpx-013, prot-001`
- Must exercise: Tier 1, Tier 2, Tier 3, structured JSON path (bnd cases), protected (`prot-001`)
- Gates: `PILOT_GATE_CONFIG_V2` (min_samples=12, quality_floor=0.95)

## Full run procedure

- Exactly one new full 50-case run under a **new** run identity after this preregistration commit is clean.
- Strategy: `bounded_routing`
- Max spend: **$2.00 USD** (Phase 4 cap)
- No cherry-picking; no per-case reruns into the same identity; no overwrite of Phase 4C artifacts.

## Acceptance rule

**VERIFIED only if ALL required gates pass.**

Do **not** require 45% savings. Report the truthful measured cost reduction whatever it is.

If REJECTED: preserve the run and diagnose failed gates honestly.

## Git SHA at preregistration

`38813df34934af0a781e34c8bdb9f59f82e70352`
