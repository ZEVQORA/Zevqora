# ZEVQORA Backend v0.2 — Engineering Audit (Phase 0 Final)

**Audit baseline:** `main` @ `5ed9a2c` (MVP `0.1.0-premium-desktop`)  
**Active branch:** `nero/backend-v0.2-proof-engine` @ `72cc1ce` (short audit)  
**Preserved early Phase 1:** `backup/backend-v0.2-early-phase1` @ `c6b15eb`  
**Audit date:** 2026-08-27  
**Scope:** `desktop-app/backend/` + desktop API client compatibility

This document is the approved Phase 0 source of truth. Phase ordering below is **proof-first** (fundraising/design-partner credibility), not RAG-first.

---

# Executive Summary

ZEVQORA Desktop backend is a local-first FastAPI + SQLite engine with correct product epistemology already encoded: static findings are signals, runtime findings are observed, only gated experiments become VERIFIED, implementation requires VERIFIED evidence and uses isolated Git worktrees, and the agent cannot cross product boundaries via tool arguments.

The critical product gap remains: the system verifies **pre-populated** candidate fields on imported traces. It does not yet plan, execute, evaluate, and prove optimization candidates with real measured cost/quality/latency.

**Near-term priority:** provider normalization + trustworthy cost/telemetry + migration runner + subprocess safety → then real CandidatePlan/Execution → task-specific evals → dogfood benchmark. RAG is an enabling subsystem deferred until after a real measured optimization path exists.

---

# Current Architecture

## Module layout (MVP)

```
desktop-app/backend/app/
├── main.py                 # All HTTP routes; create_all() on startup
├── config.py               # Env settings
├── db.py / db_models.py
├── schemas.py
├── workspace/scanner.py
├── evidence/{service,diagnosis}.py
├── experiments/service.py
├── implementation/service.py
└── agent/{service,openrouter,tools}.py
```

## Request / data flow

```
connect-local → scan → AICall + Finding(static)
                         │
import traces ───────────┼──► Trace + Finding(runtime, observed)
                         │
                 experiments/run  ◄── candidate_* MUST already exist
                         │
               VERIFIED | REJECTED | NEEDS_EVIDENCE
                         │
            implementations/prepare → isolated git worktree (no merge)

agent/chat → tools (± OpenRouter) for explanation / verification UX
```

---

# What Is Already Good

| Principle | Where | Preserve |
|-----------|-------|----------|
| Local-first workspace | `connect-local`, SQLite | Yes |
| Sensitive path exclusion | `scanner.is_safe_source_path` | Yes |
| Secret redaction | `redact_secret_like_values` | Yes |
| Static ≠ verified | `needs_evidence` | Yes |
| Runtime = observed | `diagnosis.py` | Yes |
| Deterministic gates | `experiments/service.py` | Yes (extend) |
| VERIFIED-only implementation | `implementation/service.py` | Yes |
| Isolated worktree | `git worktree add -b` | Yes |
| Failed impl cleanup | `finally` remove worktree | Yes |
| Product scope override | `agent/openrouter.py` | Yes |
| Stable static finding IDs | UUID5 | Yes |
| Economics honesty | no fabricated monthly projection | Yes |

---

# Critical Product Gap

Missing first-class pipeline:

```
Finding → CandidatePlan → CandidateExecution → Eval → VerifiedExperiment
```

Today `run_experiment()` only judges traces that already contain `candidate_output`, `candidate_cost_usd`, `cost_usd`, and `expected_output`. Nothing generates or executes candidates.

**Core credibility path (product truth):**

```
evidence
  → candidate plan
  → real candidate execution
  → task-specific evaluation
  → verified savings
  → reviewable implementation
```

RAG improves evidence understanding. It is **not** the product.

---

# Data Model Audit

| Model | Strength | Missing / risk |
|-------|----------|----------------|
| Product | Unique root_path | Index version, budgets later |
| AICall | Ephemeral scan hits | AST/context later |
| Finding | Origin + evidence_status | Link to CandidatePlan |
| Trace | Baseline + candidate fields | cost_source, pricing_version, span fields, hashes, run linkage |
| Experiment | Gate JSON + aggregates | Plan/exec provenance; status expansion careful |
| Implementation | Worktree + diff | Base git SHA; safe subprocess |

**HIGH:** Trace column adds require Alembic **execution**, not only ORM model edits. `create_all()` will not upgrade existing SQLite installs.

---

# Provider / LLM Audit

Direct OpenRouter HTTP today:

1. `agent/openrouter.py` — chat + tools loop
2. `implementation/service.py` — `_generate_replacement`

Duplicated: headers, timeout, message parsing, error handling. No shared usage/cost normalization. New httpx client per session.

Target Phase 1 boundary (minimal):

```
providers/base.py
providers/models.py
providers/openrouter.py
providers/mock.py
providers/pricing.py
```

---

# Cost Accounting Audit

| Source today | Trust |
|--------------|-------|
| Imported `Trace.cost_usd` | OBSERVED / imported — not provider-verified |
| Imported `candidate_cost_usd` | Same |
| Experiment aggregates | VERIFIED only if gates pass |
| Agent/impl live calls | Not recorded as cost evidence |

Required classifications:

- `provider_reported`
- `pricing_snapshot_estimate`
- `imported_external`

If estimated → `pricing_version` required. Never rewrite historical measured evidence with a newer snapshot.

---

# Evaluation Audit

Gates today: sample, exact-match quality, protected exact-match, cost lower, latency (missing → pass), fallback boolean.

Exact match alone is insufficient for Zev agent tasks (tools, args, required facts, forbidden actions). Deferred to Phase 3 (proof-first order).

---

# Evidence Provenance Audit

`evidence_version` hashes sorted `request_id`s only. Missing: config SHA, dataset SHA, git SHA, grader version, pricing version, immutable run manifests.

---

# Retrieval / RAG Audit

Exists: `read_source_excerpt` only. No FTS, embeddings, hybrid.

**Decision:** RAG deferred to **Phase 5**. SQLite FTS5 remains the planned lexical approach when built. Optional embeddings/hybrid only if justified after dogfood proof path exists.

---

# Static Analysis Audit

Regex scanner is useful signal generation with false positive/negative risk. Preserve as fallback; improve with Python AST later. Never treat static findings as verified savings.

---

# Security Audit

| Risk | Rank | Phase action |
|------|------|--------------|
| `shell=True` test commands | HIGH | **Phase 1** — argv + `shell=False` |
| Prompt injection via source | HIGH | Phase 5–6 with RAG/agent |
| Unbounded provider spend | MEDIUM | Phase 1 budgets in config; enforce in Phase 2 executor |
| Oversized JSONL import | MEDIUM | Phase 1 or 2 limits |
| Path/symlink escape | MEDIUM | Harden in Phase 1 security helpers if touching paths |
| Cross-product tools | LOW | Already mitigated — preserve |
| Retries creating paid duplicates | MEDIUM | Phase 1: retry only 429/5xx; never retry ambiguous success |

---

# Performance Audit

i5 / 8GB: avoid mandatory embeddings, heavy workers, full-repo dumps. Bound concurrency. Prefer FTS later over local vector DBs.

---

# API Compatibility Audit

Desktop client `desktop-app/desktop/src/lib/api.ts` uses:

| Endpoint | Preserve |
|----------|----------|
| `GET /api/health` | Yes |
| `GET /api/v1/products` | Yes |
| `POST /api/v1/products/connect-local` | Yes |
| `POST /api/v1/products/{id}/scan` | Yes |
| `GET .../ai-calls` | Yes |
| `GET .../findings` | Yes |
| `POST .../traces/import` | Yes |
| `GET .../economics` | Yes |
| `POST .../experiments/run` | Yes |
| `GET .../experiments` | Yes |
| `GET .../implementations` | Yes |
| `POST .../implementations/prepare` | Yes |
| `POST .../monitoring` | Yes |
| `POST /api/v1/agent/chat` | Yes |

Also present server-side: `DELETE /products/{id}`, `DELETE .../traces`.

**Phase 1 requirement:** FastAPI TestClient regression suite with temporary SQLite proving these contracts. MockProvider for agent paths. No paid calls.

---

# Test Coverage Audit

MVP baseline: **9 tests** (scanner, diagnosis, canonical, implementation worktree, agent product scope).

Critical gaps: API contracts, experiment gate combinations, import limits, migration upgrade path, subprocess safety, provider cost provenance.

---

# Migration Risk (HIGH PRIORITY)

## Problem

Startup uses `Base.metadata.create_all(bind=engine)`.

`create_all()`:

- creates missing tables on first run
- **does not** add new columns to existing SQLite tables

Therefore: updating `db_models.Trace` + shipping Alembic `0002` **without running Alembic** breaks existing Electron installs when code selects new columns.

## Safe transition strategy

1. **Alembic is authoritative** for schema evolution after MVP.
2. On startup, run a dedicated migration bootstrap **before** serving traffic:
   - locate `alembic.ini` + `versions/` relative to packaged backend root
   - stamp or upgrade:
     - **New empty DB:** create schema via Alembic upgrade to head (preferred), or create_all once then **stamp head** so future upgrades work
     - **Existing DB without alembic_version:** detect known MVP tables → `alembic stamp 0001` → `upgrade head`
     - **Existing DB with alembic_version:** `upgrade head`
3. **Preserve all user data.** Additive migrations only. No drop/reset.
4. **Fail loud:** migration errors stop startup with a clear health/error message; do not serve against incompatible schema.
5. **Desktop packaging:** bake Alembic scripts into the backend bundle; resolve config via absolute path from executable/resources, not CWD.
6. **Do not remove `create_all` blindly** until bootstrap covers first-run + upgrade + stamp. Transition plan:
   - Phase 1: introduce `core/db_migrate.py` (or similar) called from lifespan; keep create_all only as last-resort for empty DBs **followed by stamp**, or replace with upgrade-only once proven in tests.
7. Tests: temp SQLite — (a) fresh install, (b) MVP schema without alembic_version + Trace v2 upgrade, (c) already-at-head no-op.

---

# Proposed v0.2 Architecture

Modular monolith. Dependency rule: `api → services → domain → core`. Providers do not import agent.

RAG module exists later as enabling subsystem for code understanding — not as product identity.

See `docs/backend-v0.2-architecture.md`.

---

# Exact Phase Plan (Proof-First)

## Phase 1 — Foundations for trustworthy measurement

- Provider abstraction (OpenRouter + Mock)
- Normalized telemetry + Trace v2 migration
- Versioned cost accounting (`provider_reported` / `pricing_snapshot_estimate` / `imported_external`)
- **Database migration runner** (Alembic authoritative)
- **Subprocess safety** (remove `shell=True` default path)
- API contract regression tests (TestClient + temp SQLite + MockProvider)
- Config for budgets/timeouts/retries (enforce spend later in executor)

**Acceptance:** baseline 9 tests pass; new provider/cost/migration/API/subprocess tests pass; existing installs upgrade without data loss.

## Phase 2 — Real optimization execution

- CandidatePlan + CandidateExecution
- Strategies: exact reuse + model substitution (MockProvider + optional live)
- Budget/concurrency limits enforced

## Phase 3 — Eval + gates + provenance

- Task-specific graders
- Non-inferiority + protected slices + latency missing ≠ pass
- Immutable BenchmarkRun / EvalRun provenance

## Phase 4 — Dogfood proof

- `zev_dogfood_v1` dataset (~50 cases)
- Baseline + candidate runners + REPORT.md / JSON artifacts
- Report actual measured savings; never fabricate 45%
- **Phase 4C (`zev_dogfood_v2`) measured 42.01% raw cost reduction and was REJECTED by `quality_floor` — not verified savings.** Stretch 45% is **not measured**. Evidence pack: `docs/evidence/phase4c-v2/`.

## Phase 5 — Secure lexical RAG

- SQLite FTS5 index + chunker + context builder
- Untrusted-content delimiting + injection tests
- Optional embedding interface only if justified; hybrid only with normalized fusion

## Phase 6 — Agent + API cleanup

- Connect Zev tools to retrieval/optimization evidence
- Router split; preserve desktop endpoints

## Phase 7 — Hardening + release quality

- Further implementation engine improvements
- Docs, packaging, release cleanup

---

# Keep / Refactor / Delete

| Module | Action |
|--------|--------|
| scanner / diagnosis / experiments / implementation / agent tools | KEEP / REFACTOR |
| agent/openrouter.py | REPLACE via provider |
| main.py | REFACTOR (migrate bootstrap + later routers) |
| Alembic 0001 | KEEP |
| DELETE | None recommended |

---

# Phase 1 Proposed Diff (exact)

## Create

```
app/core/config.py
app/core/errors.py
app/core/logging.py
app/core/hashing.py
app/core/subprocesses.py      # safe argv runner; shell=False
app/core/db_migrate.py        # Alembic bootstrap/upgrade/stamp
app/providers/base.py
app/providers/models.py
app/providers/openrouter.py
app/providers/mock.py
app/providers/pricing.py
app/providers/data/pricing_v1.json
app/telemetry/models.py
app/telemetry/normalizer.py
app/telemetry/collector.py    # optional thin helper
alembic/versions/0002_trace_telemetry_v2.py
tests/test_providers.py
tests/test_pricing.py         # or fold into providers
tests/test_telemetry.py
tests/test_db_migrate.py
tests/test_subprocess_safety.py
tests/test_api_contracts.py   # FastAPI TestClient regression
```

## Modify

```
app/config.py                 # re-export / thin compat
app/agent/openrouter.py       # use providers
app/implementation/service.py # provider + safe subprocess
app/evidence/service.py       # normalize + imported_external cost_source
app/db_models.py              # additive Trace columns
app/main.py                   # call migration runner before serve
desktop-app/.env.example
requirements-dev.txt          # pytest-cov, ruff, httpx already present
pyproject.toml                # pytest/ruff config
```

## Optional light helper

```
app/providers/registry.py     # only if kept thin (dict + get); no DI framework
```

## Do not create in Phase 1

- retrieval / FTS / embeddings / hybrid
- optimization planner/executor
- dogfood benchmark suite
- unsafe shell mode

## Compatibility guarantees

- Existing `api.ts` paths and response shapes preserved
- Additive Trace fields nullable
- Experiment status literals unchanged
- No paid OpenRouter calls in CI tests

## Reuse note

`backup/backend-v0.2-early-phase1` (`c6b15eb`) is a useful draft. See `docs/early-phase1-review.md` — **partial rewrite / selective reuse**, not whole cherry-pick.
