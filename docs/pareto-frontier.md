# Pareto frontier and decision policies

Code: `api/_lib/optimize/pareto.js`, decision in `search-store.js`.
Tables: `plan_searches.frontier`, `execution_plans.dominance_state / frontier_state`,
`plan_decisions` (018).

## Who is compared

Only VERIFIED plans (every required gate of the frozen contract passed on the
evaluation set). `paretoFrontier` throws if given anything else; the database
refuses a frontier state without a VERIFIED verdict.

## Dimensions

| Dimension | Better |
|---|---|
| cost per successful outcome | lower |
| p95 latency | lower |
| task success | higher |
| quality | higher |
| replay failure rate | lower |
| provider concentration (HHI of provider calls) | lower |
| risk (low < medium < high) | lower |
| implementation complexity | lower |
| rollback complexity | lower |

## Dominance

A dominates B when A is no worse on every dimension and strictly better on at
least one (tolerance 1e-12). Identical plans do not dominate each other.

A plan with **any unknown dimension** is `INCOMPARABLE`: compared with nobody,
not ranked, not eligible for selection. Unknown never makes a plan better or
worse, and it does not remove the comparisons between the other plans.

States: `FRONTIER` (complete evidence, not dominated), `DOMINATED` (with
`dominated_by`), `INCOMPARABLE` (with the unknown dimensions). Each carries a
`frontier_reason`. The frontier hash covers dimensions, values, states and
dominance; a decision records the hash it was made on.

## Decision policies (explicit rules, no weighted score)

| Policy | Rule |
|---|---|
| MARGIN_FIRST | lowest CPSO → lower p95 → lower implementation complexity |
| LATENCY_FIRST | lowest p95 → lower CPSO → lower failure rate |
| RELIABILITY_FIRST | highest task success → lower failure rate → lower p95 → lower CPSO |
| BALANCED | only plans that regress nothing against the baseline (CPSO, p95, task success, quality, failure rate); then lowest risk → lowest implementation + rollback complexity → lower CPSO → lower p95 |
| CUSTOM_CONSTRAINTS | your limits (max CPSO, max p95, min task success, max risk, max implementation complexity) filter the frontier; then your objective (one of the three above) ranks |

Ties end on the plan hash. A policy chooses only from `FRONTIER` plans; it can
narrow, never widen. A database trigger refuses a decision whose plan is not a
VERIFIED frontier plan of the same search, and decisions are append-only.

The explanation stores the rule, the ranking with its keys, the excluded plans
with reasons, the tradeoffs of the winner against every other frontier plan
(better on / worse on), and the reminder that every candidate passed every
hard gate. Same frontier + policy + parameters → same decision hash.
