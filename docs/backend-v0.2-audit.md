# ZEVQORA Backend v0.2 — Deep Audit

**Branch:** `nero/backend-v0.2-proof-engine`  
**Audit date:** 2026-08-27  
**Baseline version:** `0.1.0-premium-desktop`  
**Scope:** `desktop-app/backend/`

---

## 1. Executive Summary

ZEVQORA Desktop backend is a **local-first FastAPI + SQLite** engine with correct product philosophy baked into code comments and gate logic. It already enforces several non-negotiables (static ≠ verified, human review, isolated worktrees, secret exclusion).

However, it is still an **early MVP evaluation shell**, not a proof engine:

- Experiments evaluate **pre-populated** trace candidate fields; nothing **generates** or **executes** optimization candidates.
- OpenRouter is called directly from `agent/openrouter.py` and `implementation/service.py` with no normalized provider contract.
- Trace model lacks provenance, cost source, span hierarchy, and pricing version.
- No RAG, no benchmark harness, no statistics, no composable graders.
- Test coverage is minimal (9 tests, mostly happy-path unit checks).

The refactor goal is **gradual hardening** toward a reproducible local optimization/evaluation system — not a rewrite.

---

## 2. Current Architecture

```
desktop-app/backend/app/
├── main.py                 # Monolithic FastAPI app (~300 lines)
├── config.py               # Env-based Settings dataclass
├── db.py / db_models.py    # SQLAlchemy + SQLite
├── schemas.py              # Pydantic API models
├── workspace/scanner.py    # Regex static scan + secret policy
├── evidence/
│   ├── service.py          # Trace import + economics aggregation
│   └── diagnosis.py        # Runtime duplicate/cost-concentration signals
├── experiments/service.py  # Gate evaluation on imported traces
├── implementation/service.py # Git worktree + OpenRouter code gen
└── agent/
    ├── service.py          # OpenRouter or keyword fallback
    ├── openrouter.py       # Direct httpx → OpenRouter
    └── tools.py            # 8 deterministic tools
```

**Data flow today:**

1. User connects local folder → `scan_product()` → static AI call sites + findings.
2. User imports JSONL traces → `import_traces()` → runtime diagnosis findings.
3. User runs experiment → compares baseline vs **already present** candidate fields on traces.
4. If VERIFIED + static finding → optional implementation in isolated Git worktree.
5. Zev agent uses tools + optional OpenRouter for conversational layer.

**Frontend contract** (`desktop-app/desktop/src/lib/api.ts`):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Backend status |
| `GET/POST /api/v1/products/*` | Connect, scan, monitor |
| `GET .../ai-calls, findings, economics` | Evidence views |
| `POST .../traces/import` | Runtime evidence |
| `POST .../experiments/run` | Verification gates |
| `POST .../implementations/prepare` | Isolated code prep |
| `POST /api/v1/agent/chat` | Zev |

All existing endpoints must remain compatible unless explicitly extended.

---

## 3. What Works (Preserve)

| Property | Implementation | Quality |
|----------|----------------|---------|
| Local-first workspace | `connect-local`, SQLite per install | ✅ Solid |
| Sensitive path exclusion | `is_safe_source_path`, forbidden names | ✅ Good baseline |
| Secret redaction | Regex patterns in scanner | ✅ Good baseline |
| Static = signal only | `evidence_status: needs_evidence` | ✅ Correct |
| Runtime ≠ static | Separate `origin` values | ✅ Correct |
| Deterministic gates before VERIFIED | `experiments/service.py` | ⚠️ Partial (see gaps) |
| VERIFIED-only implementation | Checked in `prepare_implementation` | ✅ Correct |
| Isolated Git worktree | `git worktree add -b` | ✅ Correct |
| No auto-merge/deploy | No merge/push code paths | ✅ Correct |
| Failed impl cleanup | `finally` removes worktree | ✅ Correct |
| Product scope enforcement | Agent overrides `product_id` in tools | ✅ Important security win |
| Stable static finding IDs | UUID5 on rescan | ✅ Good UX |
| Economics honesty | No fabricated monthly projection | ✅ Correct |

---

## 4. Technical Debt

### 4.1 Monolithic structure
- All routes in `main.py`; no router separation.
- Business logic mixed across services without shared abstractions.

### 4.2 Provider coupling
- OpenRouter HTTP duplicated in `agent/openrouter.py` and `implementation/service.py`.
- No `LLMRequest`/`LLMResponse` normalization.
- No retry policy, no cost capture from provider responses.
- New httpx client per request (no connection reuse).

### 4.3 Trace model (v0.1)
Current `Trace` columns are insufficient for proof-grade telemetry:

**Missing:** `trace_id`, `span_id`, `parent_span_id`, `session_id`, `request_id` uniqueness enforcement, `response_model`, token breakdown (cached/reasoning), `cost_source`, `pricing_version`, `ttft_ms`, `attempt`, `input_hash`, `output_hash`, baseline/candidate linkage, `dataset_case_id`, `benchmark_run_id`.

**Risk:** Full prompts stored by default (`input_text`, `output_text`) with no content capture policy.

### 4.4 Experiment engine limitations
- Only evaluates traces that **already have** `candidate_output`, `candidate_cost_usd`, `expected_output`.
- No candidate planner, executor, or strategy modules.
- Quality = exact string/JSON canonical match only.
- No non-inferiority gate (candidate can be worse than baseline if above absolute floor).
- Latency gate **passes by default** when data missing (informational bypass).
- `fallback_exists` is a manual boolean — not validated.
- Evidence version = hash of request IDs only (weak provenance).

### 4.5 No RAG / retrieval
- Agent reads source via line-range excerpt tool only.
- No FTS index, no chunking, no hybrid retrieval, no injection boundaries beyond system prompt.

### 4.6 Static analysis
- Regex-only; no AST for Python, no JS/TS parser.
- Symbol detection is line-local; no call-graph or duplicate path detection.
- Framework signals are keyword heuristics.

### 4.7 Economics
- `observed_cost_usd` and `verified_savings_usd` exist but no classification layer (STATIC_SIGNAL / OBSERVED / ESTIMATED / BENCHMARK_MEASURED / VERIFIED / EXTERNAL_VERIFIED).
- No versioned pricing; historical costs could be misinterpreted if rates change.

### 4.8 Database / migrations
- Alembic migration `0001` exists but `main.py` also calls `Base.metadata.create_all()` — dual schema path.
- No indexes on `traces.request_id`, `workflow`, `model`, `provider`.
- No `BenchmarkRun`, `EvalRun`, `DatasetVersion` tables.

### 4.9 Testing & tooling
- 9 tests total; no integration tests for API, no security regression suite.
- No ruff, mypy, pytest-cov configured.
- No CI for backend specifically.

### 4.10 Implementation engine
- `shell=True` for user test commands (intentional but risky).
- Single-file only (acceptable for v0.1).
- No Git base commit captured on implementation record.

---

## 5. Security Risks

| Risk | Severity | Notes |
|------|----------|-------|
| Prompt injection via source excerpts | Medium | System prompt warns Zev; no delimited untrusted context wrapper |
| Path traversal / symlink | Medium | `resolve()` + `relative_to()` helps; symlink following not explicitly blocked |
| Cross-product tool args | Low | **Mitigated** — product_id overridden |
| Unbounded trace import | Medium | No size/count limits on JSONL import |
| Raw prompt storage | Medium | Sensitive content in DB by default |
| OpenRouter spend | Medium | No budget caps on agent or implementation |
| `shell=True` test commands | Medium | User-approved only, but metacharacters allowed |
| Secret patterns incomplete | Low | Common patterns covered; not exhaustive |
| Duplicate request_id | Low | No uniqueness constraint |

---

## 6. Missing Optimization Loop

The product loop requires:

```
Finding → CandidatePlan → CandidateExecution → Eval → VerifiedExperiment
```

**Currently implemented:** `Finding` (static + runtime signals) → `Experiment` (gate check on pre-filled traces).

**Missing entirely:**
- `CandidatePlan` model and planner
- Strategy modules (exact reuse, model substitution, semantic reuse, context reduction, deterministic replacement)
- `CandidateExecution` with real provider calls
- Budget limits (`max experiment USD`, concurrency, timeouts)
- Replay harness that **runs** baseline vs candidate
- Task-specific graders beyond exact match
- Statistics / confidence intervals
- Benchmark provenance

---

## 7. Missing Measurement / Eval Capabilities

- No composable grader framework
- No protected-slice stricter gates (only exact match on protected rows)
- No latency non-regression when data present but incomplete samples
- No bootstrap CI for savings/quality
- No dogfood dataset or CLI
- No MockProvider for deterministic tests
- No structured JSON logging with trace/request correlation

---

## 8. Migration Risks

1. **Dual schema init:** `create_all()` vs Alembic — must converge on Alembic-only for new columns.
2. **Additive-only migrations:** Existing Electron installs have live SQLite DBs; never drop columns.
3. **Trace content policy:** New defaults must not delete existing `input_text`/`output_text`.
4. **Experiment status enum expansion:** Adding `PLANNED`, `RUNNING`, etc. must not break frontend Literal type (extend carefully).
5. **Index creation on large trace tables:** Use `batch_alter_table` patterns for SQLite.

---

## 9. Planned Architecture (v0.2 Target)

Gradual module layout under `desktop-app/backend/app/`:

```
api/routers/          # Split main.py; preserve routes
core/                 # config, errors, logging, hashing, security, subprocesses
providers/            # base contract, openrouter, mock, registry, pricing
telemetry/            # trace normalization, collector, OTEL-inspired fields
workspace/            # scanner (+ AST), symbols, chunker
retrieval/            # FTS5 lexical, optional dense, hybrid, context_builder
evidence/             # service, diagnosis, provenance
optimization/         # planner, executor, strategies/*
evals/                # graders, gates, statistics, runner
benchmarks/dogfood/   # dataset, runner, report
experiments/          # extended service
implementation/       # hardened service
agent/                # tools + provider-backed service
```

**Principles for migration:**
- Keep existing API response shapes; add fields optionally.
- Feature-gate dense retrieval and LLM judge.
- MockProvider enables CI without API keys.
- Every savings number carries evidence classification.

---

## 10. Phase Plan

| Phase | Deliverable | Commit message |
|-------|-------------|----------------|
| 0 | This audit + baseline test pass | `chore(backend): document v0.2 architecture and current gaps` |
| 1 | Provider abstraction, telemetry v2 migration, pricing, logging | `feat(backend): add normalized provider telemetry and cost accounting` |
| 2 | FTS5 RAG + security boundaries | `feat(rag): add secure local hybrid workspace retrieval` |
| 3 | Planner + executor + initial strategies | `feat(optimizer): execute measurable optimization candidates` |
| 4 | Graders + gates v2 + provenance models | `feat(evals): add reproducible task-specific verification` |
| 5 | Dogfood dataset + benchmark CLI + reports | `feat(benchmark): add reproducible Zev dogfooding benchmark` |
| 6 | Agent tools + API routers + security tests | `feat(agent): connect Zev to retrieval and optimization evidence` |
| 7 | Implementation hardening + docs | `refactor(backend): harden implementation workflow and release quality` |

---

## 11. Acceptance Gap Checklist (Baseline)

| Criterion | Status |
|-----------|--------|
| Repository cloned | ✅ |
| Branch created | ✅ |
| Audit written | ✅ |
| Old tests pass | ✅ (9/9) |
| Provider abstraction | ❌ Phase 1 |
| Usage/cost normalized | ❌ Phase 1 |
| Trace provenance | ❌ Phase 1–4 |
| Secure lexical RAG | ❌ Phase 2 |
| Candidate planner/executor | ❌ Phase 3 |
| Composable graders | ❌ Phase 4 |
| Dogfood benchmark | ❌ Phase 5 |
| No fabricated 45% | ✅ (not in backend) |

---

## 12. Immediate Next Steps (Phase 1)

1. Create `core/` and `providers/` with typed `LLMRequest`/`LLMResponse`.
2. Implement `OpenRouterProvider` + `MockProvider` + `ProviderRegistry`.
3. Add versioned `pricing/` snapshot with `actual_provider_cost` vs `estimated_cost`.
4. Alembic `0002_trace_telemetry_v2` — additive columns + indexes.
5. Add `telemetry/normalizer.py` for trace import enrichment.
6. Structured JSON logging (`request_id`, `trace_id`, `product_id`).
7. Refactor `agent/openrouter.py` and `implementation/service.py` to use provider layer.
8. Unit tests: provider normalization, pricing, cost calculation, trace fields.

**Do not push. Commit on branch after tests pass.**
