# Replay Set Design — `durem_replay_v1` / `1.0.0`

Frozen before baseline capture. Not modified after any result is seen.

---

## 1. Provenance **[BLOCKER 2 — decision required]**

DUREM's `data/` directory is empty at the frozen SHA. The repository contains only a 5-rule demo seed
(`db.py::_seed`, behind `DUREM_DEMO_DATA`) covering company-vehicle use and sales discounts. There is
no captured traffic to replay, so the replay set must be constructed.

Two admissible constructions, with different evidentiary weight:

**R1 — sanitized real (stronger).** Real historical questions and a real policy corpus from the
Sutainbuyant deployment, sanitized of names, identifiers and confidential text, **retained locally
only**. The public repository receives content hashes, category counts and structural metadata — never
the fixtures. Supports the phrase *real-workload*.

**R2 — synthetic representative (weaker).** Questions and corpus authored to match the real
workload's structural shape without deriving from real content. Supports only
*representative-workload*. The phrase *real-workload* must not be used.

Everything downstream of this document is identical under R1 and R2 except the claim language and the
manifest's provenance field. **This decision must be made before freezing.**

### 1.1 Sanitization rules (apply under R1)

Applied before a fixture is written anywhere, and re-verified before any commit:

1. No personal names, employee IDs, emails, phone numbers, or national IDs. Replace with stable
   pseudonyms drawn from a local mapping that is never committed.
2. No customer or counterparty names, contract numbers, or monetary amounts traceable to a real deal.
   Thresholds that are genuine policy limits are kept, since they are the object of measurement.
3. No verbatim confidential document text. Chunks are paraphrased to preserve retrieval difficulty and
   decision content without reproducing the source.
4. No secrets, keys, tokens, or internal URLs.
5. The public repository receives: category counts, per-case IDs, expected labels, expected source
   IDs, and hashes. It does not receive question text or chunk text under R1.
6. A pre-commit check enumerates the fixture directory and fails if any file outside the manifest
   allow-list is staged.

---

## 2. Corpus — `durem_corpus_v1`

The corpus must exercise every retrieval and safety surface identified in
`ARCHITECTURE_INSPECTION.md`. Minimum structure:

| Object | Count | Purpose |
|---|---|---|
| Departments | 6 | matches DUREM's seeded set; drives `department_scope` and document visibility |
| Roles | 4 | drives `role_scope`; one admin role for the ACL contrast |
| Users | 4 | one plain employee (the default requester), one department member, one manager, one admin |
| Rules (active) | 18–24 | includes at least 3 adjacent numeric bands per metric family |
| Rules (inactive) | 2 | must never be retrieved (`r.active=1` filter) |
| Documents — active, `visibility='all'` | 8–10 | the general RAG surface |
| Documents — active, `visibility='department'` | 3 | the ACL surface |
| Documents — `status != 'active'` (archived) | 2 | the lifecycle surface |
| Documents — `effective_from` in the future | 1 | not-yet-effective surface |
| Documents — `effective_to` in the past | 1 | expired surface |
| Chunks | 60–90 | with precomputed embedding vectors |
| Responsibilities | 6 | the `who` / routing surface |

### 2.1 Numeric bands

At least one metric family must reproduce the adjacency pattern in DUREM's own seed — `[0,5]`
inclusive/inclusive, `(5,10]` exclusive/inclusive, `(10, inf)` exclusive — because
`_in_range()` honours the inclusivity flags and the boundary is exactly where a candidate is most
likely to silently break. A second family must use the `mnt` metric with Mongolian scale words, to
cover `_metric_values()`'s million/thousand scaling.

### 2.2 Embedding precomputation

Chunk vectors are computed once, at corpus build time, with the frozen embedding model, and stored in
`document_chunks.embedding_json`. They are part of the frozen corpus hash. Per-request embedding cost
therefore covers the **query** only — one call per policy request — which is what the baseline
measures.

---

## 3. Workload distribution (60 cases)

**Reviewer decision 2026-08-29: hybrid provenance.** The table below is the **preregistered
stratified fallback**. Before freezing, the eight categories that DUREM's audit logs can measure are
replaced by observed frequencies from the deployment; the three that cannot be measured keep the
counts below and are labelled `preregistered_assumption`.

`AUDIT_OBSERVABILITY.md` establishes which is which, from the audit schema at the frozen DUREM SHA:
`CHAT`, `ROUTE-OBV`, `ROUTE-AMB`, `SAFETY`, `RULE`, `RAG`, `FOLLOWUP` and `NOTFOUND` (in aggregate)
are observable; `ACL`, `LIFECYCLE` and `SRCVAL` are not, because a correctly-blocked request leaves no
audit record. Missing frequencies are not inferred. If the observed window fails any validity
condition in `AUDIT_OBSERVABILITY.md` §4.1, the **whole** table below is used as-is and the entire
mix is reported as assumed.

| Code | Category | n | % | Protected | Expected baseline LLM calls |
|---|---|---|---|---|---|
| `CHAT` | General chat (translate, draft, explain, code, summarize) | 9 | 15.0% | no | 1 (chat answer) |
| `ROUTE-OBV` | Obvious policy routing | 6 | 10.0% | no | 1 (policy answer), 0 classifier |
| `ROUTE-AMB` | Ambiguous routing | 6 | 10.0% | no | 2 (classifier + answer) |
| `SAFETY` | Safety override — chat mode, company authority | 5 | 8.3% | **yes** | 1–2 |
| `RULE` | Deterministic exact-rule, incl. band boundaries | 8 | 13.3% | **yes** | **0** |
| `RAG` | RAG-grounded policy answers | 8 | 13.3% | no | 1 |
| `FOLLOWUP` | Follow-up policy questions | 4 | 6.7% | no | 1 |
| `NOTFOUND` | Unsupported company questions | 5 | 8.3% | **yes** | 0–1 |
| `ACL` | Restricted / out-of-department material | 4 | 6.7% | **yes** | 0–1 |
| `LIFECYCLE` | Archived, expired, not-yet-effective | 3 | 5.0% | **yes** | 0–1 |
| `SRCVAL` | Source validation / prompt injection in context | 2 | 3.3% | **yes** | 1 |
| | **Total** | **60** | **100%** | **27 protected (45%)** | |

### 3.1 Why this mix is not tuned for optimization

`ROUTE-AMB` is the only category that is *guaranteed* to spend an extra LLM call in the baseline — it
is the band where `_deterministic_decision()` returns `None` and the classifier fires. It is therefore
the single most attractive category to over-represent, and it is deliberately held at **6 of 60
(10%)**.

`RULE` (8 cases) enters the baseline at **zero LLM calls** and cannot yield model-call savings at all;
it exists purely as a correctness trap for candidates that break exact thresholds. Together with
`NOTFOUND`, `ACL`, `LIFECYCLE` and `SRCVAL`, **27 of 60 cases (45%) can only lose points, never gain
them.** That asymmetry is intentional.

### 3.2 Requester identity per category

Cases are executed as a **plain employee** by default (non-admin, single department), because that is
the setting in which ACL and scope filters are load-bearing. `ACL` cases additionally include a
paired admin execution to prove the restricted document exists and is retrievable by someone — an ACL
case that passes because the corpus is empty proves nothing.

---

## 4. Case schema

Each case is a frozen record:

```
case_id                 e.g. "rule-boundary-005"
category                one of the codes in section 3
mode                    auto | chat | can_i | how_to | who | policy
requester               user fixture key
question                the prompt (locally retained under R1)
conversation_seed       ordered prior turns, for FOLLOWUP cases only
protected               bool
expected_route          policy | chat
expect_safety_override  bool
expected_method         rule_engine | llm | safety_fallback | null (null = unconstrained)
expected_answer_type    DECISION | GUIDANCE | ROUTING | POLICY | NOT_FOUND | CHAT
expected_decision       ALLOWED | DENIED | APPROVAL_REQUIRED | NOT_FOUND | null
expected_source_ids     IDs that MUST appear in the source cards
forbidden_source_ids    IDs that must appear in NEITHER the retrieved set NOR the source cards
required_facts          fact strings for the chat/quality grader
graders                 grader specs from app/evals/graders.py
weight                  1.0 for all cases in v1
```

`forbidden_source_ids` is checked against the **retrieved** set as well as the cited set. DUREM's
`_normalize()` already strips uncited-but-invalid IDs, so checking citations alone would test the
filter instead of the retrieval boundary and would score a context leak as a pass.

`weight` is uniform at 1.0 in v1. Weighting categories differently would let the aggregate quality
score be tuned by re-weighting, which section 10 of the preregistration forbids.

## 5. Labelling rules

- Expected labels are written **from the corpus**, by construction, before any run. They are never
  derived from an observed DUREM output.
- Where DUREM's correct behaviour is genuinely a range rather than a point — for instance a `RAG` case
  where two documents would both be acceptable citations — `expected_source_ids` lists the acceptable
  set and the grader requires a non-empty intersection. Ambiguity is declared in advance, not resolved
  after seeing the answer.
- `expected_method` is left `null` wherever DUREM's own path is legitimately data-dependent. Pinning a
  method that the baseline does not in fact take would manufacture a failure.
- Any case whose expected label cannot be justified from the corpus alone is **removed before
  freezing**, not adjusted afterwards.

## 6. Determinism

`temperature` is `0.0` on both the classifier and the policy answer path, so those are expected to be
stable across repeats. The general chat path runs at `0.55` and is **not** expected to be
token-identical; `CHAT` cases are therefore graded with `required_facts` rather than `exact_match`.

Across the 3 baseline repeats, every correctness field is asserted identical. Any case that varies is
flagged **non-deterministic** in the manifest and reported as such. Non-deterministic cases are not
silently averaged, and a candidate's improvement on a non-deterministic case is not counted as
evidence.

## 7. Files (produced at freeze time, not yet written)

| File | Committed? | Content |
|---|---|---|
| `manifest.sanitized.json` | yes | case IDs, categories, expected labels, protected flags, hashes, counts |
| `corpus.manifest.json` | yes | object counts, rule bounds, document visibility/lifecycle states, hashes |
| `cases.local.jsonl` | **no** (R1) / yes (R2) | full case records including question text |
| `corpus.local.json` | **no** (R1) / yes (R2) | full corpus fixtures |
| `checksums.sha256` | yes | hashes of all of the above, including the uncommitted ones |

Under R1 the uncommitted fixtures are still hashed into `checksums.sha256`, so a reviewer with local
access can verify that the fixtures used were the fixtures declared.
