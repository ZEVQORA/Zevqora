# ZevIR adapter contract

An adapter turns one source's evidence into canonical ZevIR graphs. External
field names live **only** inside the adapter file.

## Rules every adapter follows

1. **Missing stays missing.** A value the source did not report is `null` and,
   where it matters, a completeness gap. No provider, model, token count, cost or
   timing is inferred.
2. **No raw content.** Prompt, output, system instructions, tool arguments/results,
   document text, embeddings and free-form metadata are reduced to
   `{sha256, length}` digests. The canonicalizer drops content and credential keys
   again on the way out; the node schema cannot represent them.
3. **Unknown cost ≠ $0.** `cost_usd` is set only from an explicit source value,
   always with `cost_source`. A cost without a recognised source is discarded.
4. **Deterministic.** Same input → same graph and hash, regardless of span,
   attribute or array order.
5. **Provenance for every node.** At least one evidence reference with the source
   ids and a source hash.
6. **Source vocabulary never becomes a kind.** OpenInference span kinds and
   `gen_ai.operation.name` values map onto the eight canonical kinds.

## Current ZEVQORA engine (`api/_lib/zevir/adapters/engine.js`)

Reads `engine_traces` (explicit column list, **no raw text columns**). One graph per trace:

```
Task(workflow|symbol|"request") ─CALLS→ Function(symbol)? ─CALLS→ ModelCall ─SERVED_BY→ Runtime(provider/model)
                                                                  └─PRODUCES→ Outcome   (only if output_hash)
```

| engine_traces | ZevIR |
|---|---|
| `request_id` | `source_trace_id`, Task attribute |
| `workflow` / `symbol` | Task name; Function (entity, per product+symbol) |
| `timestamp` | `started_at` |
| `provider`, `response_model`∥`model` | ModelCall attributes; Runtime identity |
| `requested_model`, `response_model`, `provider_request_id`, `pricing_version`, `attempt`, `retry_reason`, `protected` | ModelCall attributes |
| `input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_tokens`, `latency_ms`, `ttft_ms` | ModelCall fields |
| `cost_usd` + `cost_source` | ModelCall cost (null stays null) |
| `input_hash`, `output_hash`, `system_prompt_hash` | `input_digest`, `output_digest`, `system_prompt_sha256`; evidence `content_hash` |
| `metadata` | sanitized ModelCall attribute |
| `id` | evidence `source_id` |

Not read: `input_text`, `output_text`, `system_prompt`, `messages`, `expected_output`,
`candidate_output`, `candidate_*`. `task_success` is never computed by a projection.

## OpenTelemetry GenAI (`adapters/otel-genai.js`)

Input: OTLP/JSON (`resourceSpans → scopeSpans → spans`), ids hex or base64.
`source_version` from the resource/scope `schemaUrl`.

| `gen_ai.operation.name` | Node |
|---|---|
| `chat` / `text_completion` / `generate_content` / `embeddings` | ModelCall `chat` / `completion` / `generate_content` / `embedding` |
| `invoke_agent`, `create_agent` | Agent |
| `execute_tool` (or `mcp.method.name = tools/call`) | ToolCall |
| `retrieval` | Retrieval |
| absent / other | Function |

| Attribute | Canonical |
|---|---|
| `gen_ai.provider.name` (fallback deprecated `gen_ai.system`) | `provider` |
| `gen_ai.request.model`, `gen_ai.response.model` | `request_model`, `response_model`; name and Runtime use response ∥ request |
| `gen_ai.response.id` | `provider_request_id` |
| `gen_ai.usage.input_tokens` (∥ deprecated `prompt_tokens`) | `input_tokens` |
| `gen_ai.usage.output_tokens` (∥ deprecated `completion_tokens`) | `output_tokens` |
| `gen_ai.usage.cache_read.input_tokens` | `cached_input_tokens` |
| `gen_ai.response.finish_reasons` | Outcome `finish_reasons` (creates the Outcome) |
| `gen_ai.request.{temperature,top_p,top_k,max_tokens,…}` | `request_params` |
| `gen_ai.agent.id/name/description`, `gen_ai.conversation.id` | Agent / node attributes |
| `gen_ai.tool.name/call.id/type/description` | ToolCall attributes |
| `gen_ai.input.messages`, `gen_ai.system_instructions`, `gen_ai.prompt*`, `gen_ai.tool.call.arguments` | **dropped**, `input_digest` / `arguments_digest` |
| `gen_ai.output.messages`, `gen_ai.completion*`, `gen_ai.tool.call.result` | **dropped**, Outcome `output_digest` / `result_digest` |
| other scalar `gen_ai.*` | `source_attributes` (≤ 24, sorted) |
| span duration | `duration_ms`; for ModelCall also `latency_ms` (the span is the call) |
| span status code | `status` |
| span links (same trace) | `DEPENDS_ON` |

**MCP** (metadata only — no MCP server/proxy/gateway is built): when
`mcp.method.name` is present, ToolCall/Function gets
`attributes.protocol = {protocol: "mcp", protocol_version, method, tool_name, server, session_id}`
from `mcp.protocol.version`, `mcp.method.name`, `gen_ai.tool.name`,
`server.address[:server.port]`, `mcp.session.id`. With a server, the ToolCall is
`SERVED_BY` a Runtime `{runtime_kind: "mcp_server"}`.

Not mapped (unsupported in v0.1): any cost (OTel GenAI defines none), reasoning
tokens, `gen_ai.server.time_to_first_token` (a metric, not a span attribute),
span events (only counted), MCP authorization scope (no standard attribute;
never inferred), cross-trace links (gap `external_link`).

## OpenInference (`adapters/openinference.js`)

Input: OTLP/JSON with `openinference.span.kind`, or a flat span list
(`context.trace_id/span_id`, `parent_id`, `span_kind`, ISO times, nested or dotted attributes).

| Span kind | Node |
|---|---|
| `LLM` | ModelCall |
| `EMBEDDING` | ModelCall `{operation: embedding}` |
| `RERANKER` | ModelCall `{operation: rerank}` |
| `DECISION` | ModelCall `{operation: decision}` |
| `AGENT` | Agent |
| `TOOL` | ToolCall |
| `RETRIEVER` | Retrieval |
| `CHAIN` | Function `{semantic_role: chain}` |
| `PROMPT` | Function `{semantic_role: prompt}` |
| `GUARDRAIL` | Function `{semantic_role: guardrail}` |
| `EVALUATOR` | Function `{semantic_role: evaluator}` |
| `UNKNOWN` / missing | Function (other values: gap `unrecognized_span_kind`) |

| Attribute | Canonical |
|---|---|
| `llm.model_name` / `embedding.model_name` / `reranker.model_name` | model, name, Runtime |
| `llm.provider` (∥ `llm.system`) | provider |
| `llm.token_count.prompt / completion / total` | input / output tokens, `total_tokens` |
| `llm.token_count.prompt_details.cache_read` | `cached_input_tokens` |
| `llm.token_count.completion_details.reasoning` | `reasoning_tokens` |
| `llm.cost.total` (+ `prompt`, `completion`) | `cost_usd`, `cost_source = imported_external` |
| `retrieval.documents.N.document.id / score` | `document_refs`, `document_count` (content dropped) |
| `reranker.top_k`, input/output document counts | attributes |
| `tool.name`, `tool_call.function.name`, `tool_call.id`, `tool.description` | ToolCall attributes |
| `eval.name / label / score` | evaluator `evaluation` |
| `session.id`, `tag.tags`, `input.mime_type`, `output.mime_type` | attributes |
| `user.id` | **hashed** to `user_ref` |
| `input.value`, `output.value`, `llm.input_messages.*`, `llm.output_messages.*`, `llm.prompt_template.*`, `llm.invocation_parameters`, `tool.parameters`, `tool_call.function.arguments`, document content/metadata, `embedding.embeddings.*`, `metadata` | **dropped**, digests only |

An LLM span without output evidence gets no Outcome (gap `no_output_evidence`).

## Shared span structure (`canonicalize.js#spanTraceDraft`)

- One synthesized `Task` per trace; it `CALLS` every root span (spans with no parent).
- Parent → child edges in start-time order; a parent not in the batch is gap
  `missing_parent` (the span is **not** attached elsewhere).
- No roots in the batch → gap `missing_root`.
- Identical duplicate spans collapse; two different spans with one id reject the trace.

## Batches and limits

- ≤ 3 MB request, ≤ 5000 spans, ≤ 200 traces per batch, ≤ 5000 nodes per graph.
- A batch must carry complete traces. A trace already stored is replaced only by a
  **superset** (every stored node present); otherwise it is a `conflict` and the
  stored graph is kept. Cross-batch span assembly is not supported in Part 1
  (use the collector's `groupbytrace` processor).

## Adding an adapter

1. New file in `api/_lib/zevir/adapters/`, external names only there.
2. New `source_kind`: schema enum + `contracts.js` + DB CHECK (new migration) + `ADAPTER_VERSIONS`.
3. Fixture in `tests/fixtures/zevir/` and an exact expected-graph test.
