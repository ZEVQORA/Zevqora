# Plan composition

Code: `api/_lib/optimize/transformations.js`; rules declared by the passes in
`passes-intelligence.js` (`compositionRules()`, `conflictsWith()`).

## Canonical transformation

`{ kind, layer, scope, call_site, settings, config, pass, pass_version, … }`.
`settings` names exactly what the change sets (`response_cache:classify_ticket`,
`model:openai/gpt-4o`, `lookup:route_refund`, `retry:workload`, …).
Hash = sha256 of {schema `tx_v1`, kind, scope, settings, config, pass, version}.
The same change proposed by two passes or two diagnoses merges into one
transformation with both sources (e.g. provider prompt caching from
ContextMemory and Cache).

## Layers and order

Requests cross the layers outer → inner; composition order is
`layer → kind rank in layer → scope → hash`:

| Layer | Kinds (rank order) |
|---|---|
| agent_control | step budget, loop guard, repeated-tool suppression, tool-result cache, planning collapse, parallelization hint |
| interceptor | validated exact lookup, deterministic rule, exact-response cache |
| context | retrieval cache, dedupe, top-k, reranker skip, parallel retrieval, context cap, app prefix cache, provider prompt cache |
| model_routing | model substitution |
| transport | retry policy |

A declared rule's order must agree with this order, or the pair conflicts.

## Compatibility (deterministic, never silent)

For each pair:

1. Same setting, different value → **conflict** ("both set response_cache:classify_ticket to different values").
2. No overlap (different call site, no shared ZevIR node, no shared request) → **compatible, independent**.
3. Overlap and an explicit conflict declared → **conflict** with the declared reason.
4. Overlap and the same kind → **conflict**.
5. Overlap and a declared composition rule → **compatible**, with a dependency (`before → after`, note) and, where declared, risk escalation.
6. Overlap and no rule → **conflict** ("no declared composition rule for X + Y").

Declared rules include: cache → model substitution (the cache stores the
substituted model's answers), lookup → model substitution (misses go to the
model), interceptors → retry policy, prompt cache → model substitution
(escalates), context cap → model substitution (escalates), agent budget →
guard → suppression, retrieval dedupe → top-k (escalates).
Declared conflicts: lookup vs exact-response cache on the same call
(no precedence), deterministic rule vs model substitution (substitution
irrelevant), context cap vs retrieval top-k (both shrink the same context),
tool cache vs repeated-tool suppression.

## Compatibility result

`{ compatible, conflicts[{a, b, kinds, reason}], dependencies[{before, after, kinds, note}], composition_order, affected_nodes, shared_fields, risk_escalation{from, to, reasons} }`.

## Aggregates

- Risk = highest transformation risk, +1 level when a declared rule escalates or three changes ship together.
- Implementation complexity = sum (1–5 each, 1–15 per plan).
- Rollback complexity = highest + 1 when more than one change (max 5). Rollback runs in reverse composition order.

## Executability

A plan is EXECUTABLE only if every transformation is. One blocked part blocks
the whole plan; the executable parts are never run on their own under it. The
composed executor refuses such a plan before anything runs.
