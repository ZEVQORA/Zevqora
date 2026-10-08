# RetrievalOptimizationPass v0.2

Diagnosis: `retrieval_redundancy` (`api/_lib/optimize/diagnose.js`); pass:
`passes-intelligence.js#retrievalOptimizationPass`.

## Detection (structural, per retrieval name)

| Signal | Evidence |
|---|---|
| repeat retrieval | the same query digest issued again within the same task (graph) |
| duplicate chunks | the same document id returned more than once within a task |
| oversized top-k | median documents per call ≥ 8 (a size fact, not a relevance fact) |
| retrieval latency hotspot | the node class's mean share of root latency on complete critical paths ≥ 0.4 |
| reranker present | rerank ModelCalls in the same tasks (count, p95) |

Retained metrics: retrievals, repeats, query repeat rate, duplicated chunk
references, documents p50/p95, latency samples/p50/p95/share of root/critical-path
graphs, rerank calls and p95.

**No chunk is ever called irrelevant from a hash.** The diagnosis states that
relevance is not established; that needs an evaluator.

## Candidates (all NEEDS_IMPLEMENTATION)

- `retrieval_dedupe` — deduplicate by document id within a task (low risk);
- `retrieval_top_k` — lower k from the observed median to `max(3, ⌊p50/2⌋)`,
  `requires_replay: true`, quality effect **unknown**;
- (CachePass) `retrieval_result_cache` within a task, NEEDS_EVIDENCE until the
  index version is in the key.

Dedupe → top-k composes (escalates risk); context cap + top-k conflicts (both
shrink the same context). A lower top-k is generated from structural evidence
but can only become VERIFIED through a graded replay, which the harness cannot
run yet — so it is delivered as an implementation brief.
