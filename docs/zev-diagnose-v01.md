# Zev Diagnose v0.1

Deterministic, evidence-based diagnoses. Code: `api/_lib/optimize/diagnose.js`,
latency in `latency.js`. Table: `optimization_diagnoses`.

**No diagnosis exists because a model said so.** No LLM is called in Part 2A.
Inputs never include raw content: identity from stored hashes, size from token
counts, structure and timing from ZevIR.

## Shape

`id` (deterministic from run + hash), `family`, `version` (`diag_v0.1`),
`product_id`, `snapshot_id`, `scope`, `symptom`, `causal_path`, `root_cause`,
`affected_nodes` (ZevIR graph/node/stable key, ≤ 50), `evidence_refs` (engine
trace ids + ZevIR nodes, ≤ 50, never empty — DB CHECK), `metrics`, `confidence`,
`severity`, `required_additional_evidence`, `falsifier` (never empty),
`suggested_optimization_passes`, `risk_class`, `diagnosis_hash` (sha256 of all of
the above). The two Part 2B families only fire on Agent / ToolCall / Retrieval nodes (read through the v2 graph function, 018), so engine-only workloads and the five families above are unchanged. Diagnoses are computed only after re-deriving the baseline evidence
and confirming it still matches the run's snapshot hash (`EVIDENCE_CHANGED`
otherwise).

## Families and their rules

| Family | Fires when | Notes |
|---|---|---|
| `redundant_call` (exact reuse) | ≥2 final attempts in one scope (symbol/workflow) share input hash, system-prompt hash, provider/model and behaviour-affecting metadata | reports duplicate calls, known duplicate cost/latency, share of known cost; groups with protected / side-effecting / tool calls are counted as blocked |
| `retry_amplification` | at least one retried request and amplification ≥ 1.05 (or ≥2 retried) | retry reasons, failure classes, retry known cost and latency, unrecorded attempts |
| `context_amplification` | median input/output ≥ 20 with median input ≥ 1000; or a system-prompt hash re-sent uncached in ≥5 calls with median input ≥ 1024; or input growing every turn in a conversation (≥3 turns) | states explicitly that relevance of the context is **not established** |
| `model_overprovisioning` | a frontier-tier model (`model_pricing.tier`) in ≥5 calls with p95 output ≤ 64 tokens and a known cheaper candidate | never says the smaller model is safe; requires a graded replay |
| `latency_critical_path` | a node class contributes ≥40% of observed root latency on complete critical paths, or the workload p95 exceeds the contract's `max_p95_ms` | diagnosis-only in v0.1; share is `null` when request timing is missing |
| `agent_workflow` (Part 2B) | an Agent's steps repeat a tool call with unchanged arguments and result, repeat an identical model decision, loop without progress (1–3 step window repeated with identical inputs and outputs), or a run exceeds 2 × the median step count | structural only, from ZevIR digests; see `agent-workflow-pass.md` |
| `retrieval_redundancy` (Part 2B) | a query digest repeats within a task, a document id is returned twice within a task, or median documents per call ≥ 8 | relevance is NOT established; latency share retained; see `retrieval-pass.md` |

Confidence is a fixed per-family rule (e.g. 0.9 for redundant calls with full
identity, 0.5 for overprovisioning). Severity follows stated thresholds (share of
known cost, amplification, input size, budget breach).

## Latency / critical path (`latency.js`)

Per ZevIR graph, follow CALLS/RETRIEVES from the Task. Walk back from a node's end:
take the child that ends last, attribute the gap to the parent, move the cursor to
that child's start, repeat; a child that overlaps an already-chosen child is
parallel and off the path. Segments sum exactly to the root duration.

Returns **INCOMPLETE** (no path) when the call structure has a cycle or exceeds
depth 64, when a node on the path lacks start/end timestamps, or when the root
duration is unknown. Engine graphs carry model latency but no request timing, so
for them only per-node latency is reported and the root share stays unknown.
Workload hotspots aggregate node classes (kind + operation + name): samples,
p50/p95, critical-path count, mean share of root (complete analyses only). Retry
latency comes from the performance snapshot.
