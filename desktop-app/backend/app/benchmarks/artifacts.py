"""Persist local benchmark artifacts (gitignored)."""

from __future__ import annotations

import json
import platform
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..db_models import BenchmarkRun, Trace
from .models import ARTIFACTS_ROOT, BenchmarkCaseSpec


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            lk = str(k).lower()
            if any(x in lk for x in ("api_key", "secret", "password", "authorization")) and "token" not in lk:
                out[k] = "[REDACTED]"
            elif lk in {"api_key", "secret", "password", "authorization", "openrouter_api_key"}:
                out[k] = "[REDACTED]"
            else:
                out[k] = _redact(v)
        return out
    if isinstance(obj, list):
        return [_redact(x) for x in obj]
    if isinstance(obj, str):
        if "sk-" in obj or "OPENROUTER_API_KEY" in obj:
            return "[REDACTED]"
        return obj
    return obj


def write_benchmark_artifacts(
    run: BenchmarkRun,
    evaluation: Any,
    cases: list[BenchmarkCaseSpec],
    baseline_traces: dict[str, Trace],
    candidate_samples: list[dict[str, Any]],
    stats: dict[str, Any],
    ci: dict[str, Any],
) -> Path:
    out = ARTIFACTS_ROOT / run.id
    out.mkdir(parents=True, exist_ok=True)
    run.artifact_dir = str(out)

    manifest = {
        "benchmark_version": run.benchmark_version,
        "benchmark_run_id": run.id,
        "timestamp": datetime.now(UTC).isoformat(),
        "git_commit_sha": run.git_commit_sha,
        "git_dirty": run.git_dirty,
        "dataset_version_id": run.dataset_version_id,
        "baseline_model": run.baseline_model,
        "candidate_model": run.candidate_model,
        "gate_config_hash": run.gate_config_hash,
        "grader_config_hash": run.grader_config_hash,
        "seed": run.seed,
        "case_count": run.case_count,
        "protected_case_count": run.protected_case_count,
        "evaluation_run_id": run.evaluation_run_id,
        "candidate_execution_id": run.candidate_execution_id,
        "evidence_hash": run.evidence_hash,
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "statistics": stats,
        "bootstrap": ci,
    }
    (out / "manifest.json").write_text(json.dumps(_redact(manifest), indent=2), encoding="utf-8")

    dataset_manifest = {
        "cases": [c.case_id for c in cases],
        "difficulty": {c.case_id: c.difficulty for c in cases},
        "protected": [c.case_id for c in cases if c.protected],
    }
    (out / "dataset_manifest.json").write_text(json.dumps(dataset_manifest, indent=2), encoding="utf-8")

    baseline_lines = []
    for case in cases:
        trace = baseline_traces.get(case.case_id)
        if not trace:
            continue
        baseline_lines.append(
            _redact(
                {
                    "case_id": case.case_id,
                    "trace_id": trace.id,
                    "model": trace.model,
                    "cost_usd": trace.cost_usd,
                    "cost_source": trace.cost_source,
                    "latency_ms": trace.latency_ms,
                    "output_hash": trace.output_hash,
                    "request_snapshot_hash": trace.request_snapshot_hash,
                    "provider_request_id": trace.provider_request_id,
                }
            )
        )
    (out / "baseline_cases.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in baseline_lines) + "\n",
        encoding="utf-8",
    )

    sample_by_trace = {s.get("baseline_trace_id"): s for s in candidate_samples}
    candidate_lines = []
    for case in cases:
        trace = baseline_traces.get(case.case_id)
        sample = sample_by_trace.get(trace.id if trace else None)
        if sample:
            candidate_lines.append(_redact({"case_id": case.case_id, **sample}))
    (out / "candidate_cases.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in candidate_lines) + "\n",
        encoding="utf-8",
    )

    eval_payload = {
        "status": evaluation.status,
        "baseline_quality": evaluation.baseline_quality,
        "candidate_quality": evaluation.candidate_quality,
        "quality_delta": evaluation.quality_delta,
        "gates": json.loads(evaluation.gates_json or "[]"),
        "evidence_version": evaluation.evidence_version,
        "rejection_reason": evaluation.rejection_reason,
    }
    (out / "evaluations.jsonl").write_text(
        json.dumps(_redact(eval_payload), ensure_ascii=False) + "\n", encoding="utf-8"
    )

    result = {
        "status": run.status,
        "baseline_total_cost": run.baseline_total_cost,
        "candidate_total_cost": run.candidate_total_cost,
        "absolute_cost_delta": run.absolute_cost_delta,
        "cost_savings_percent": run.cost_savings_percent,
        "baseline_quality": run.baseline_quality,
        "candidate_quality": run.candidate_quality,
        "quality_delta": run.quality_delta,
        "protected_pass_rate": run.protected_pass_rate,
    }
    (out / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    report = _render_report(run, evaluation, stats, ci, cases)
    (out / "REPORT.md").write_text(report, encoding="utf-8")
    return out


def _render_report(run: BenchmarkRun, evaluation: Any, stats: dict, ci: dict, cases: list[BenchmarkCaseSpec]) -> str:
    pct = run.cost_savings_percent
    pct_str = f"{pct:.4f}%" if pct is not None else "N/A"
    ci_line = ""
    if ci.get("sufficient"):
        ci_line = (
            f"- 95% CI mean cost diff: [{ci.get('ci95_cost_diff_low')} , {ci.get('ci95_cost_diff_high')}]\n"
            f"- 95% CI percent savings: [{ci.get('ci95_percent_savings_low')} , {ci.get('ci95_percent_savings_high')}]\n"
        )
    else:
        ci_line = f"- Bootstrap CI: insufficient (n={ci.get('n', 'unknown')})\n"

    strategy_label = "model_substitution"
    try:
        cfg = json.loads(run.candidate_config_json or "{}")
        strategy_label = str(cfg.get("strategy") or strategy_label)
        if cfg.get("policy_version"):
            strategy_label = f"{strategy_label} ({cfg['policy_version']})"
    except (TypeError, json.JSONDecodeError):
        pass

    return f"""# ZEVQORA Internal Dogfooding Benchmark

## Evidence classification

INTERNAL DOGFOODING

Not customer evidence.
Not external validation.

## Benchmark status

{run.status}

## Dataset

- cases: {run.case_count}
- protected: {run.protected_case_count}

## Code version

- Git SHA: `{run.git_commit_sha}`
- dirty: {run.git_dirty}

## Baseline

- provider: openrouter
- model: `{run.baseline_model}`

## Candidate

- provider: openrouter
- model: `{run.candidate_model}`
- strategy: {strategy_label}

## Cost

- baseline total: {run.baseline_total_cost}
- candidate total: {run.candidate_total_cost}
- absolute delta: {run.absolute_cost_delta}
- measured percentage: {pct_str}

## Quality

- baseline: {run.baseline_quality}
- candidate: {run.candidate_quality}
- delta: {run.quality_delta}

## Protected slice

- pass rate: {run.protected_pass_rate}

## Latency

- baseline mean ms: {run.baseline_latency_ms}
- candidate mean ms: {run.candidate_latency_ms}
- delta ms: {run.latency_delta_ms}

## Statistical intervals

{ci_line}

## Gate results

See evaluations.jsonl / evaluation_run `{run.evaluation_run_id}`.

## Limitations

- Internal workload only; not customer or external validation.
- Results depend on pinned models and frozen gate configuration at run time.

## Evidence

- run ID: `{run.id}`
- evidence hash: `{run.evidence_hash}`
- artifact dir: `{run.artifact_dir}`
"""
