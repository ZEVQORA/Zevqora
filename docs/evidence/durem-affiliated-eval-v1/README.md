# DUREM Affiliated Real-Workload Evaluation — v1

**Evidence identity:** `durem-affiliated-eval-v1`
**Status:** `CONTRACT_DRAFT — NOT YET FROZEN` (blocked on two reviewer decisions, see below)
**Stage reached:** Phase A (inspection) + Phase B (preregistration draft) complete. **No optimization performed. No baseline captured.**
**ZEVQORA branch:** `nero/durem-affiliated-eval-v1` (from `c34db54ba846d8182d1212c7819571cf41796640`)
**Date:** 2026-08-29

---

## Evidence classification (must be preserved in every downstream report)

> **AFFILIATED REAL-WORKLOAD EVALUATION / AFFILIATED DESIGN-PARTNER PILOT.**
>
> This is **not** independent customer proof, **not** arm's-length customer validation,
> **not** customer-verified savings, and **not** independent production validation.
>
> **Reason:** the ZEVQORA founder built the DUREM RAG system and has an existing
> family/company relationship with Sutainbuyant LLC.

This disclosure is mandatory and non-removable. It travels with every number produced
under this evidence identity.

---

## Relationship to prior evidence

This is a **new, separate** evidence identity. It does not read from, write to, modify,
supersede, or reinterpret:

- `docs/evidence/candidate-d/` (Candidate D)
- `docs/evidence/phase4c-v2/` (Phase 4C)

Those packs measured a synthetic `zev_dogfood_v2` dataset against **cloud** providers priced
in USD per token. This evaluation measures a **local** runtime with no per-token price. The two
metrics are not comparable and must never be pooled, averaged, or presented as one series.

---

## Contents

| File | Purpose |
|------|---------|
| `ARCHITECTURE_INSPECTION.md` | Phase A: observed repo truth for DUREM and ZEVQORA, and the integration gaps between them |
| `PREREGISTRATION.md` | Phase B: frozen identity, frozen configuration, frozen quality contract, frozen acceptance rule |
| `REPLAY_SET_DESIGN.md` | Replay-set composition, category definitions, labelling rules, sanitization rules |
| `COST_METHODOLOGY.md` | Local serving-cost model, the compute-cost proxy, and the linearity proviso |
| `BASELINE_INSTRUMENTATION_PLAN.md` | Exactly what will be measured, where the probes go, and the behaviour-neutrality argument |

---

## STOP — two decisions are required before this contract can be frozen

Work halted here deliberately, as instructed. Two findings block a truthful baseline and
**both change what the evaluation is allowed to claim.** Neither can be resolved by
assumption without making the eventual result misleading.

### BLOCKER 1 — the current machine cannot host the measurement

The host this session is running on cannot execute the DUREM workload at a
representative operating point. Details and evidence in `PREREGISTRATION.md §4`.
A measurement host must be named before the baseline is frozen.

### BLOCKER 2 — no real workload corpus exists in the repository

DUREM ships an empty `data/` directory and a 5-rule demo seed. There is no real traffic
to replay. The choice of corpus determines whether the final claim may say
*"real-workload"* or only *"representative-workload"*. Details in `REPLAY_SET_DESIGN.md §1`.

Until both are resolved, no number produced under this identity may be described as a
measured saving.
