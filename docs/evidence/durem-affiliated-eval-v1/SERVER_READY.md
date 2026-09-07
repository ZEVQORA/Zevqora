# Server-Ready Runbook

**STATUS: ENGINEERING_READY_FOR_REAL_HOST_EVALUATION**
**No real benchmark has been executed yet. No real-workload savings percentage has been measured.**

The integration is complete in code and exercised end-to-end against real DUREM using a
deterministic stub runtime. Moving to a real host requires no architectural change — only the five
steps below.

---

## What already works on any machine

```bash
python tools/run_durem_eval.py --mode baseline
python tools/run_durem_eval.py --mode candidate --candidate durem-cand-a
python tools/run_durem_eval.py --mode diagnose
python tools/run_durem_eval.py --mode list-candidates
```

These run real DUREM — real routing, real retrieval, real ACL and lifecycle SQL filters, real
source validation, real instrumentation — against a stub runtime served over real HTTP. Call counts
and retrieval counts measured this way are `REAL_STRUCTURAL`. Token counts and timings are
`SYNTHETIC_TEST_METRIC` and the gates refuse to treat them as evidence.

## Five steps on the real host

**1. Install and start Lemonade**, then confirm:

```bash
curl http://127.0.0.1:13305/v1/models
```

**2. Load the models.** `Qwen3-8B-GGUF` and `Qwen3-Embedding-0.6B-GGUF`. Capture provenance:

```powershell
.\docs\evidence\durem-affiliated-eval-v1\tools\collect_host_provenance.ps1 -Out host_provenance.json
```

**3. Provide sanitized real fixtures** in a directory that is never committed:

```
<fixtures-dir>/cases.local.jsonl     one JSON object per line, matching durem_eval.fixtures.Case
<fixtures-dir>/durem.db              a DUREM database holding the sanitized corpus
```

Measure the observed workload mix at the same time:

```bash
python docs/evidence/durem-affiliated-eval-v1/tools/measure_audit_distribution.py \
    --db <path>/durem.db --out observed_distribution.json
```

**4. Baseline:**

```bash
python tools/run_durem_eval.py --mode baseline \
    --runtime local --runtime-url http://127.0.0.1:13305 \
    --dataset local-real --fixtures-dir <fixtures-dir> \
    --metric inference_ms --repeats 3 --emit-traces
```

**5. Candidate:**

```bash
python tools/run_durem_eval.py --mode candidate --candidate durem-cand-a \
    --runtime local --runtime-url http://127.0.0.1:13305 \
    --dataset local-real --fixtures-dir <fixtures-dir> \
    --metric inference_ms --repeats 3 --emit-traces
```

## What changes automatically on a real runtime

| | Stub runtime | Real Lemonade |
|---|---|---|
| Gate config | `MOCK_GATE_CONFIG` | `REAL_GATE_CONFIG` (selected from `runtime.is_real`) |
| `require_work_improvement` | informational | **required** |
| `require_latency` | informational | **required** |
| `require_reportable_metric` | informational | **required** — a `SYNTHETIC_TEST_METRIC` primary metric is REJECTED |
| Token / timing fidelity | `SYNTHETIC_TEST_METRIC` | `MEASURED` |
| `cost_usd` on emitted traces | `None` | `None` — a local runtime has no per-token price |

`verified_savings_usd` stays `None` until a real cost model with real assumptions exists
(`COST_METHODOLOGY.md` section 2). Runtime seconds are never written into a `*_usd` field.

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `DUREM_REPO_PATH` | location of the DUREM checkout | `../Durem_AI` |
| `LEMONADE_BASE_URL` | set by the harness from `--runtime-url` | — |

DUREM must be on branch `nero/eval-instrumentation-v1` (or a descendant) for the probe to exist.

## Still open

- The measurement host itself (`PREREGISTRATION.md` section 4 — decided as option A, not yet available).
- Sanitized real fixtures and the observed workload distribution (`AUDIT_OBSERVABILITY.md` section 4).
- The four economic assumptions; absent them the run reports the compute proxy, not dollars.
- The frozen contract remains **unfrozen** until those land.
