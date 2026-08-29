# Audit-Log Observability — which workload dimensions are measurable

Determines which parts of the frozen workload distribution can be set from **observed** DUREM audit
data and which must remain **preregistered assumptions**. Nothing here is inferred or reconstructed
from partial signals: a dimension is either directly recorded by DUREM at the frozen SHA, or it is
declared unobservable.

**Source:** `app/db.py` (`audit_logs` schema, `audit()`) and every `audit()` call site in
`app/assistant_engine.py` and `app/main.py`, read at `7536b80f2d234f29f77870c70bab1da63c8ce306`.

**Scope note:** this is a **schema** analysis. It establishes what the deployment's logs *can* answer.
The actual frequencies must be extracted on the measurement host (`PREREGISTRATION.md` section 4,
option A), because no production `durem.db` is present in the repository.

---

## 1. The audit record

```sql
CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  action        TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_audit_created     ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_type_action ON audit_logs(event_type, action, created_at DESC);
```

Every answered request writes exactly one `('assistant', 'answer')` row. `created_at` plus the
`idx_audit_created` index makes a time-windowed frequency query cheap and exact.

### 1.1 Fields recorded per route

The two routes log **different** metadata. This asymmetry is the single most important fact in this
document.

| Field | Chat route | Policy route |
|---|---|---|
| `mode` | yes | yes |
| `route` | `"chat"` | `"policy"` |
| `route_method` | yes | yes |
| `route_reason` | yes | yes |
| `route_confidence` | yes | yes |
| `classifier_invoked` | yes | yes |
| `safety_override` | yes | yes |
| `method` | yes | yes |
| `answer_type` | always `"CHAT"` | actual value |
| `latency_ms` | yes | yes |
| `decision` | no | yes |
| `confidence` | no | yes |
| `sources` | no | yes — **cited** source IDs |
| `input_chars` / `output_chars` | yes | no |
| `memory_used` | yes | no |
| `question` | **only if `store_raw_chat_questions == "1"`** (default `"0"`) | **always**, truncated to 600 chars |

Chat: `_chat_audit_metadata()`. Policy: the two `audit()` calls in `_answer_policy()` — one on the
deterministic-rule path, one on the model path.

> **Consequence.** Policy question text is retained by default; chat question text is not. Any
> category distinction that needs the question string is therefore observable on the policy side and
> unobservable on the chat side, unless the deployment has `store_raw_chat_questions` enabled — which
> must be checked, not assumed, and recorded in the freeze record.

### 1.2 Supporting events

| Event | Records | Use |
|---|---|---|
| `assistant / structured_output_rejected` | `question[:300]`, `route` | base rate of the policy repair retry — a second LLM call |
| `assistant / model_error` | `error[:800]` | runtime failure rate |
| `assistant / feedback`, `api_feedback` | `conversation_id`, `rating` | user-visible quality signal, out of scope for the mix |
| `memory / preference_learned`, memory actions | `keys`, `changed` | memory short-circuit rate |

---

## 2. Observable categories

Each of these is a direct field equality on logged data — no inference.

| Code | Category | Query predicate on `('assistant','answer')` | Observable |
|---|---|---|---|
| `CHAT` | General chat | `route='chat' AND method='chat_llm'` | **yes** |
| `ROUTE-OBV` | Obvious policy routing | `route='policy' AND classifier_invoked=false AND route_method IN ('deterministic','explicit')` | **yes** |
| `ROUTE-AMB` | Ambiguous routing | `classifier_invoked=true AND route_method='llm_classifier'` | **yes** |
| `SAFETY` | Safety override | `safety_override=true` | **yes** |
| `RULE` | Deterministic exact-rule | `method='rule_engine'` | **yes** (plus the rule ID in `sources`) |
| `RAG` | RAG-grounded policy answer | `route='policy' AND method='llm' AND answer_type<>'NOT_FOUND' AND sources<>[]` | **yes** |
| `FOLLOWUP` | Follow-up policy question | `route_method='followup'` | **yes** |
| `NOTFOUND` | Unsupported question | `answer_type='NOT_FOUND'` | **yes, as an aggregate** — see 2.1 |

`ROUTE-AMB` being directly observable matters more than the rest: it is the only category that
*always* spends an extra classifier call, so it is both the most attractive category to
over-represent and the one whose true share most affects a savings figure. It can be counted exactly,
so it will be.

### 2.1 `NOTFOUND` is observable in total but not by cause

`answer_type='NOT_FOUND'` is logged, so the total rate is exact. But DUREM reaches `NOT_FOUND` through
at least five distinct paths that are **indistinguishable in the audit record**:

1. genuinely no matching evidence in the knowledge base;
2. evidence existed but was excluded by the ACL clause in `retrieve_chunks()` / `_scope_matches()`;
3. evidence existed but was excluded by the document-lifecycle clause;
4. the model cited only invalid source IDs and `_normalize()` rewrote the answer to `NOT_FOUND`;
5. `APPROVAL_REQUIRED` with no resolvable approver.

`method` separates *some* of these — `safety_fallback` indicates the zero-evidence short-circuit or a
failed repair — but paths 2 and 3 produce an ordinary `NOT_FOUND` that looks identical to path 1.

So the **total** `NOTFOUND` rate is measured, and its **decomposition** is not.

---

## 3. Unobservable dimensions

These cannot be recovered from audit logs at the frozen SHA. They are not estimated.

| Dimension | Why it is unobservable |
|---|---|
| `ACL` — restricted material requested | ACL is enforced as a SQL `WHERE` clause at retrieval time. A filtered document is never selected, so nothing is logged. The request appears as an ordinary answer or `NOT_FOUND`. |
| `LIFECYCLE` — archived / expired / not-yet-effective requested | Same mechanism: `d.status='active'` and the `effective_from` / `effective_to` predicates filter before anything is recorded. |
| `SRCVAL` — invented source ID suppressed | `_normalize()` silently intersects `source_*_ids` with the retrieved sets and drops the rest. No audit event fires when an ID is dropped. |
| Chat sub-type (translate / draft / code / explain) | Requires the question text, which is not stored on the chat route by default. |
| Retrieved (as opposed to cited) source IDs | `sources` holds only post-filter cited IDs. The retrieval boundary is invisible. |
| Prompt / output token counts | `lemonade.py` parses and discards the runtime `usage` block; tokens are never logged. |
| Embedding invocation and success | No audit event. A silent degradation to lexical-only retrieval leaves no trace. |
| Inference runtime | Only whole-request `latency_ms` is logged, which includes SQLite and retrieval scoring. |

The first three are exactly the safety-critical categories. That they are unobservable is a direct
consequence of DUREM enforcing them correctly — a filter that works leaves no evidence of what it
filtered. It is a property of a sound design, not a logging defect, but it does mean their real-world
frequency cannot be measured from these logs.

---

## 4. How the frozen distribution is built

Per the reviewer's instruction: measured where the logs reliably support it, preregistered and
labelled where they do not, and nothing fabricated in between.

**Step 1 — measure the observable block.** On the measurement host, over a declared time window,
count the eight categories in section 2 and compute their relative shares. These eight are then
allocated proportionally across the observable portion of the replay set. Recorded as
`provenance: "observed"`, each with its raw count.

**Step 2 — allocate the unobservable safety block at preregistered counts.** `ACL` (4), `LIFECYCLE`
(3) and `SRCVAL` (2) are fixed at the counts in `REPLAY_SET_DESIGN.md` section 3 and recorded as
`provenance: "preregistered_assumption"`. They are **deliberately over-represented** relative to any
plausible production frequency, because all nine are protected cases that can only lose points, never
generate savings. Over-weighting them makes the evaluation harder to pass, not easier.

**Step 3 — resolve the `NOTFOUND` decomposition conservatively.** Because paths 2 and 3 of section 2.1
are folded into the observed `NOTFOUND` count, that observed count is used for the `NOTFOUND` category
as a whole, and the separately-allocated `ACL` and `LIFECYCLE` cases are **not** subtracted from it.
This slightly over-represents safety-critical cases overall. Recorded explicitly as a known,
conservative bias.

**Step 4 — freeze before execution.** The final table is written into `PREREGISTRATION.md` section 14
before the baseline runs, recording for every category: the count, whether it was observed or assumed,
and — for observed rows — the time window and the raw sample count behind it.

### 4.1 Validity conditions for the observed window

Recorded with the frequencies, and the window rejected if any fails:

- the window contains at least **1,000** `('assistant','answer')` rows, so a 10%-share category rests
  on ~100 observations rather than a handful;
- the window covers **at least 30 consecutive days**, so weekly cycles do not dominate;
- `auto_routing_enabled`, `hybrid_router_enabled` and `general_chat_enabled` were all `"1"` for the
  whole window — a period with routing disabled has a structurally different mix and must be excluded;
- no `settings_updated` audit row inside the window changed any of those three, or the window is split
  at that boundary and only the later segment used;
- rows from admin and test accounts are excluded by `user_id`, and the exclusion list is recorded.

### 4.2 If the conditions cannot be met

If the deployment's logs are too short, too sparse, or span a settings change, then **the entire
distribution reverts to the preregistered stratified mix** in `REPLAY_SET_DESIGN.md` section 3, and
every report states that the mix is assumed rather than observed. A partial or marginal window is not
mixed with assumptions to manufacture a stronger provenance claim than the data supports.

---

## 5. Privacy

Only aggregate counts leave the measurement host. Per-row audit content — including the policy-route
`question` field, which is retained by default and may contain confidential company text — stays
local under the R1 rules in `REPLAY_SET_DESIGN.md` section 1.1. The public evidence pack receives
category counts, the time window, the total sample count, and hashes. No `user_id`, no question text,
no `sources` values tied to real documents.
