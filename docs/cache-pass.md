# CachePass v0.2

Code: `api/_lib/optimize/passes-intelligence.js#cachePass`, semantics in `replay-model.js`.

Detects only evidence-supported caching. Exact hashes support exact reuse;
semantic (approximate) reuse is **not** proposed: it would need separate proof.

| Evidence | Candidate | Executable |
|---|---|---|
| repeated exact input (redundant_call diagnosis) | exact-response cache with a TTL | yes |
| stable system prompt re-sent uncached (context_amplification) | provider prompt caching | no — NEEDS_IMPLEMENTATION (proposed by ContextMemory too; merged) |
| repeated tool call with unchanged arguments and result (agent_workflow) | tool-result cache within one run | no — and NEEDS_EVIDENCE until the tool is declared read-only |
| repeated retrieval query (retrieval_redundancy) | retrieval-result cache within one task | no — and NEEDS_EVIDENCE until the index version is in the key |

## Exact-response cache

- **Key basis**: the existing reuse identity — input hash, system-prompt hash,
  provider/model, temperature, response format, tool schema, context id, model
  config. Any prompt/model/config change is a new key.
- **TTL**: chosen from observed repeat intervals between equal keys: the
  smallest standard TTL (5 m, 15 m, 1 h, 6 h, 24 h) covering the p50 interval
  and the one covering the p95 interval (one or two variants).
- **Metadata** on every candidate: `cache_scope`, `cache_key_basis`, `ttl_ms`,
  `expected_hit_rate` (simulated over recorded requests: estimated),
  `observed_repeat_rate`, repeat-interval p50/p95, `invalidation_requirements`,
  `data_sensitivity`, `staleness_risk`, rollback.
- **Risk**: TTL ≤ 1 h low, longer medium. Part 2A's unbounded reuse (from
  RedundantCallPass) is high risk unless the traces declare `stateless`.
- **Safety**: no safe invalidation story → not a safe candidate
  (NOT_EXECUTABLE with the reason) when the prompt version is not part of the
  recorded identity, or when cached answers would hold data marked sensitive
  (`pii`, `phi`, `pci`, `secret`, `confidential`, `restricted`).
- **Unknown stays unknown**: without timestamps there is no TTL evidence; the
  candidate is NEEDS_EVIDENCE and its hit rate is `null`.
- Protected, side-effecting and tool-executing calls are never cached.

## Replay semantics

An entry is written on a miss with the answer of whatever path served it and
expires `ttl` after it was written (a hit does not refresh it). In a plan
where a smaller model serves the misses, the cache stores the smaller model's
answers. Replayed hit latency is in-process replay time; a production cache's
lookup time is not measured and is listed under "not proven".
