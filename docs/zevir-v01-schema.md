# ZevIR v0.1 — canonical schema

ZevIR is ZEVQORA's **internal** canonical execution representation. External
conventions (OpenTelemetry GenAI, OpenInference, MCP) are input adapters; none of
their names or enums are part of this contract.

- JSON Schema (Draft 2020-12): `schemas/zevir/v0.1/{graph,node,edge,evidence-ref,ingest-envelope}.schema.json`
- Validator: Ajv v8 in 2020-12 mode, `strict: true` (`api/_lib/zevir/validate.js`)
- Constants mirrored in `api/_lib/zevir/contracts.js`, pinned to the schema by `tests/zevir-contract.test.ts`
- Database: migration `016_zevir_part1.sql` (CHECK constraints repeat the enums)

## Graph

One graph = one execution trace (one engine request, or one OTel/OpenInference `trace_id`).

| Field | Meaning |
|---|---|
| `schema_version` | always `zevir.v0.1` |
| `adapter_version` | adapter build that produced it (`zevir-engine/0.1.0`, `zevir-otel-genai/0.1.0`, `zevir-openinference/0.1.0`) |
| `source_kind` | `zevqora_engine` \| `otel_genai` \| `openinference` |
| `source_version` | external convention version when known (OTel schema URL `…/schemas/1.37.0` → `1.37.0`, or the envelope's `source_version`) |
| `graph_key` | `engine:<product_id>:<request_id>` or `trace:<trace_id>`; unique per workspace and source kind |
| `source_trace_id` | the source's trace/request id |
| `root` | stable key of the Task |
| `status` | `complete` or `incomplete` — `incomplete` iff `completeness.gaps` is non-empty |
| `completeness.gaps` | `[{code, count, sample?}]`, sorted by code; samples are the 5 smallest source ids |
| `graph_hash` | sha256 over the canonical graph (see Identity) |
| `nodes`, `edges`, `evidence` | canonical arrays (≤ 5000 nodes, ≤ 20000 edges) |

Gap codes in use: `cost_unknown`, `tokens_unknown`, `latency_unknown`, `timing_unknown`,
`timestamp_unknown`, `provider_unknown`, `model_unknown`, `no_output_evidence`,
`missing_parent`, `missing_root`, `unresolved_link`, `external_link`, `unrecognized_span_kind`.

## Node kinds — exactly eight

| Kind | Represents |
|---|---|
| `Task` | the traced request or workflow (one per graph) |
| `ModelCall` | one model invocation; `operation` ∈ `chat, completion, generate_content, embedding, rerank, decision` or null |
| `Agent` | an agent invocation |
| `ToolCall` | a tool invocation (MCP-backed or not) |
| `Retrieval` | a retrieval step |
| `Function` | any other code step; `attributes.semantic_role` ∈ `chain, prompt, guardrail, evaluator` or absent |
| `Runtime` | what served a call: a model endpoint or an MCP server (entity node) |
| `Outcome` | what a model call produced (only when output evidence exists) |

Embeddings, rerankers, decisions, prompts, guardrails and evaluators are **not**
node kinds; they are `ModelCall.operation` or `Function.attributes.semantic_role`.
`operation` is only valid on `ModelCall`; `semantic_role` only on `Function`
(schema + DB CHECK).

Node fields: `name, operation, started_at, ended_at, duration_ms, status (ok|error|unset),
cost_usd, cost_source, latency_ms, ttft_ms, input_tokens, output_tokens,
cached_input_tokens, reasoning_tokens, task_success, trust_class, data_sensitivity,
action_risk, attributes`. Every field the source did not report is `null`.

## Edge kinds — exactly eleven

`CALLS, USES, DEPENDS_ON, RETRIEVES, PROVIDES_CONTEXT, ROUTES_TO, SERVED_BY, REPLACES, PRODUCES, EVALUATED_BY, LOCATED_AT`.

Emitted by Part 1 adapters:

| Edge | When |
|---|---|
| `CALLS` | parent span → child span (child not a Retrieval); Task → root spans; engine Task → Function → ModelCall |
| `RETRIEVES` | parent → Retrieval child |
| `SERVED_BY` | ModelCall → model-endpoint Runtime; MCP ToolCall → mcp_server Runtime |
| `PRODUCES` | ModelCall → Outcome |
| `DEPENDS_ON` | span → span it links to (OTel span link, same trace) |
| `EVALUATED_BY` | linked span → evaluator Function that links to it |

Defined but not emitted in Part 1: `USES, PROVIDES_CONTEXT, ROUTES_TO, REPLACES,
LOCATED_AT` (no source carries the evidence without inference; `REPLACES` is a
Part 2 relation). Edges are unique per `(source, kind, target)`; `ordinal` is the
sibling order by start time. **No DAG rule**: loops and retries are valid.

## Evidence reference

Every node has at least one. Fields: `node, source_kind, source_id, source_trace_id,
source_span_id, source_hash, adapter_version, schema_version, locator, content_hash,
redaction_state (not_captured|hashed_only|redacted), captured_at`.

- Engine: `source_id` = `engine_traces.id`, `source_trace_id` = `request_id`,
  `source_span_id` = role (`task`, `function`, `model_call`, `runtime`, `outcome`),
  `locator` = `{table, id, product_id, request_id}`, `content_hash` commits to the
  stored `input_hash/output_hash/system_prompt_hash`.
- Spans: `source_id`/`source_span_id` = span id, `source_hash` = sha256 of the span
  as received (attributes in key order), `content_hash` = digest of the content
  attributes that were dropped.

## Identity and hashing

- Trace-scoped node: `stable_key = sha256(["zevir.node", workspace_id, source_kind, source_trace_id, source_span_id, kind])`.
  Derived Outcome nodes use span id `<span>#outcome`; the Task uses span id `null` (spans) or `task` (engine).
- Entity node (Runtime, engine Function symbol): `sha256(["zevir.entity", workspace_id, kind, identity])`,
  source-agnostic so an engine trace and an OTel span served by the same model meet at one key.
- Row ids are deterministic UUIDs: graph from `(workspace, source_kind, graph_key)`,
  node from `(graph, stable_key)`, edge from `(graph, source, kind, target)`, evidence from its identity.
- `graph_hash = sha256(canonical JSON of {schema_version, source_kind, graph_key, source_trace_id, root, status, completeness, capture window, nodes sorted by stable_key, edges sorted by (source, kind, target), evidence sorted})`.
  Canonical JSON = sorted keys, no whitespace. `adapter_version` and `source_version` are recorded, not hashed.
  Independent of input array order and attribute order (tested).

## Versioning strategy

- **schema_version** changes only when the contract changes (a new kind, a field
  meaning change). A new schema version gets a new directory `schemas/zevir/v0.2/`,
  a new DB CHECK value, and adapters emit it explicitly; v0.1 rows stay valid.
  Adding kinds is a schema change — never an adapter change.
- **adapter_version** bumps on any mapping change. Because it is not hashed, a
  release that emits identical graphs is a no-op; one that emits different graphs
  replaces them on the next build (same ids, new hash), and the run records the version.
