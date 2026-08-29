# DUREM Affiliated Real-Workload Evaluation — v1

**Evidence identity:** `durem-affiliated-eval-v1`
**Status:** `CONTRACT_DRAFT — DECISIONS RECORDED, AWAITING HOST DATA` (see below)
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
| `AUDIT_OBSERVABILITY.md` | Which workload dimensions DUREM's audit logs can actually measure, and which must stay preregistered assumptions |
| `COST_METHODOLOGY.md` | Local serving-cost model, the compute-cost proxy, and the linearity proviso |
| `BASELINE_INSTRUMENTATION_PLAN.md` | Exactly what will be measured, where the probes go, and the behaviour-neutrality argument |

---

## Reviewer decisions recorded 2026-08-29

Two findings blocked a truthful baseline, and both changed what the evaluation would be allowed to
claim. Both are now decided, along with a third question about the workload mix.

| Question | Decision | Effect on claim language |
|---|---|---|
| Measurement host — the preparation machine cannot serve Qwen3-8B representatively (`PREREGISTRATION.md` §4) | **(A)** real Sutainbuyant / Ryzen AI deployment host | serving-cost percentage permitted; no surrogate-host caveat |
| Corpus provenance — DUREM's `data/` is empty at the frozen SHA (`PREREGISTRATION.md` §5) | **R1** sanitized real, retained locally | *"real-workload"* permitted |
| Workload distribution — assumed, not measured (`PREREGISTRATION.md` §3.1) | **hybrid** observed where logs support it, preregistered and labelled where they do not | each proportion reported as `observed` or `assumed` |

## STOP — what remains before the contract can be frozen

What is left is **data collection on the measurement host, not further judgement.** Every remaining
row of `PREREGISTRATION.md` §14 needs a value that can only be captured there:

1. Host identity — CPU, NPU, GPU, RAM, OS build.
2. Lemonade version, model file names, quantization, and file hashes; the verbatim `/v1/models` response.
3. Observed audit-log frequencies for the 8 measurable categories, over a window meeting the validity
   conditions in `AUDIT_OBSERVABILITY.md` §4.1 (≥ 1,000 answer rows, ≥ 30 consecutive days, no routing
   settings change inside it).
4. The sanitized corpus and 60 cases, built under the R1 rules, with their hashes.
5. Idle and under-load power draw, if measurable, plus the four economic assumptions in
   `COST_METHODOLOGY.md` §2.1 — or the evaluation reports the compute-cost proxy instead of dollars.

**Nothing has been optimized, no baseline has been captured, and no DUREM branch has been created.**
No number produced under this identity may be described as a measured saving until the contract is
frozen and a baseline exists.
