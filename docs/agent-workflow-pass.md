# AgentWorkflowPass v0.2

Diagnosis: `agent_workflow` (`api/_lib/optimize/diagnose.js`); pass:
`passes-intelligence.js#agentWorkflowPass`.

Detects structural agent waste from ZevIR Agent / ToolCall / ModelCall /
Retrieval nodes and the content-free digests ZevIR stores (arguments digest,
result digest, query digest, input digest, output digest of the Outcome node).
Nothing is inferred about "thinking quality".

## Steps of a run

The direct children of an Agent node (CALLS / USES / RETRIEVES), ordered by
start time, then edge ordinal, then stable key.

## Patterns

| Pattern | Rule |
|---|---|
| repeated tool call | same tool name and arguments digest **and** the same result digest as an earlier call in the run |
| changed-state repeat | same tool and arguments, **different** result → counted, never collapsed |
| repeated model decision | same ModelCall input digest and same output digest within the run |
| no-progress loop | a window of 1–3 consecutive steps immediately repeated with identical signatures (kind, name, input digest) **and** identical output digests; unknown digests never match |
| excessive steps | ≥ 3 runs of the agent and a run with more than 2 × the median step count |

**NO PROGRESS** is therefore defined only by structural evidence: the same
action, with the same input, produced the same output again.

## Diagnosis

Per agent: runs, steps p50/p95, patterns, counts, wasted steps, known wasted
latency (node durations) and known wasted cost (`null` when no step cost is
recorded), affected nodes and evidence refs (ZevIR nodes), falsifier ("a
repeated step may be polling for a state change the digests do not capture").

## Candidates (all NEEDS_IMPLEMENTATION)

- `repeated_tool_suppression` — reuse a tool result while the result digest is unchanged;
- `agent_loop_guard` — stop or escalate when a 1–3 step window repeats identically;
- `agent_step_budget` — `ceil(p50 steps × 1.5)` (observed basis), only with loops or excessive runs;
- (CachePass) `tool_result_cache` within one run, NEEDS_EVIDENCE until the tool is declared read-only.

They compose with each other by declared rules (budget → guard → suppression)
and are never executable: the replay harness cannot replay an agent loop. They
are delivered with evidence, falsifiers, rollback and materializer hints.
