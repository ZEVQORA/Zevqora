"""Run reporting and ZEVQORA trace ingestion for DUREM evaluations."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..core.hashing import sha256_text
from .gates import GateReport
from .graders import CaseGrade, quality_score
from .metrics import MetricFidelity, MetricSelection, WorkMetrics

REPORT_VERSION = "durem_report_v1"


@dataclass
class RunReport:
    run_id: str
    mode: str  # baseline | candidate
    runtime: dict[str, Any]
    dataset: dict[str, Any]
    candidate: dict[str, Any] | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    metric_selection: dict[str, Any] | None = None
    quality: float | None = None
    grades: list[dict[str, Any]] = field(default_factory=list)
    gate_report: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    case_errors: int = 0
    created_at: str = ""
    disclosure: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "report_version": REPORT_VERSION,
            "run_id": self.run_id,
            "mode": self.mode,
            "created_at": self.created_at,
            "runtime": self.runtime,
            "dataset": self.dataset,
            "candidate": self.candidate,
            "metrics": self.metrics,
            "metric_selection": self.metric_selection,
            "quality": self.quality,
            "case_errors": self.case_errors,
            "gate_report": self.gate_report,
            "diagnosis": self.diagnosis,
            "grades": self.grades,
            "disclosure": self.disclosure,
        }

    def write(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.as_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
        return path


DISCLOSURE_SYNTHETIC = (
    "ENGINEERING RUN. Executed against the deterministic stub runtime on representative "
    "synthetic fixtures. Call counts and retrieval counts are REAL_STRUCTURAL (properties of "
    "DUREM's control flow). Token counts and timings are SYNTHETIC_TEST_METRIC and are not "
    "measurements of a real model. No real-workload savings percentage has been measured."
)

DISCLOSURE_REAL = (
    "AFFILIATED EVALUATION RUN against a real local runtime. The ZEVQORA founder built DUREM "
    "and has an existing relationship with Sutainbuyant, so this is affiliated evaluation "
    "evidence rather than independent customer validation."
)


def build_report(
    *,
    run_id: str,
    mode: str,
    runtime: dict[str, Any],
    dataset: dict[str, Any],
    totals: WorkMetrics,
    grades: list[CaseGrade],
    gate_report: GateReport | None,
    metric: MetricSelection | None,
    candidate: dict[str, Any] | None = None,
    diagnosis: dict[str, Any] | None = None,
    case_errors: int = 0,
) -> RunReport:
    real = bool(runtime.get("is_real"))
    return RunReport(
        run_id=run_id,
        mode=mode,
        runtime=runtime,
        dataset=dataset,
        candidate=candidate,
        metrics=totals.as_dict(),
        metric_selection=metric.as_dict() if metric else None,
        quality=quality_score(grades),
        grades=[g.as_dict() for g in grades],
        gate_report=gate_report.as_dict() if gate_report else None,
        diagnosis=diagnosis,
        case_errors=case_errors,
        created_at=datetime.now(UTC).isoformat(),
        disclosure=DISCLOSURE_REAL if real else DISCLOSURE_SYNTHETIC,
    )


def to_trace_payloads(
    results: list[Any],
    *,
    runtime: dict[str, Any],
    dataset_name: str,
    repeat_index: int = 1,
) -> list[dict[str, Any]]:
    """Map executed cases onto ZEVQORA TraceIn payloads.

    ``cost_usd`` is deliberately always ``None``. DUREM has no per-token price, and
    a work metric is not a dollar. Writing a proxy into a ``*_usd`` field would
    reproduce the defect this repository already fixed in be36506. The work
    metrics travel in ``metadata`` under their own explicit names and units.
    """
    real = bool(runtime.get("is_real"))
    payloads: list[dict[str, Any]] = []
    for result in results:
        probe = result.probe or {}
        metrics = result.metrics.as_dict()
        payloads.append(
            {
                "request_id": f"{dataset_name}:{result.case_id}:r{repeat_index}",
                "symbol": result.category,
                "workflow": "durem_policy" if result.response.get("route") == "policy" else "durem_chat",
                "provider": f"lemonade_{runtime.get('kind', 'unknown')}",
                "model": runtime.get("chat_model"),
                "input_tokens": probe.get("input_tokens"),
                "output_tokens": probe.get("output_tokens"),
                "latency_ms": probe.get("request_latency_ms"),
                # No dollar cost exists for a local runtime. Unknown, not zero.
                "cost_usd": None,
                "protected": bool(result.protected),
                "metadata": {
                    "case_id": result.case_id,
                    "category": result.category,
                    "repeat_index": repeat_index,
                    "work_metrics": metrics,
                    "metric_fidelity": {
                        "counters": MetricFidelity.REAL_STRUCTURAL.value,
                        "tokens_and_timing": (
                            MetricFidelity.MEASURED.value if real else MetricFidelity.SYNTHETIC_TEST_METRIC.value
                        ),
                    },
                    "route": result.response.get("route"),
                    "route_method": result.response.get("route_method"),
                    "method": result.response.get("method"),
                    "answer_type": result.response.get("answer_type"),
                    "decision": result.response.get("decision"),
                    "classifier_invoked": result.response.get("classifier_invoked"),
                    "safety_override": result.response.get("safety_override"),
                    "cited_source_ids": result.response.get("source_ids"),
                    "retrieved_rule_ids": probe.get("retrieved_rule_ids"),
                    "retrieved_chunk_ids": probe.get("retrieved_chunk_ids"),
                    "retrieved_document_ids": probe.get("retrieved_document_ids"),
                    "degradations": {
                        k: probe.get(k)
                        for k in (
                            "repair_retry_fired",
                            "structured_output_rejected",
                            "embedding_degraded",
                            "classifier_fallback",
                            "empty_response_fallback",
                        )
                    },
                    "runtime": runtime,
                    "errors": probe.get("errors") or [],
                },
            }
        )
    return payloads


def write_traces_jsonl(payloads: list[dict[str, Any]], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for payload in payloads:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return path


def comparison_summary(
    *,
    baseline_totals: WorkMetrics,
    candidate_totals: WorkMetrics,
    metric: MetricSelection,
    gate_report: GateReport,
) -> dict[str, Any]:
    """Baseline vs candidate, with every metric's fidelity attached."""
    base = baseline_totals.as_dict()
    cand = candidate_totals.as_dict()
    deltas: dict[str, Any] = {}
    for key, base_value in base.items():
        cand_value = cand.get(key)
        if isinstance(base_value, (int, float)) and isinstance(cand_value, (int, float)):
            pct = None
            if base_value:
                pct = round((base_value - cand_value) / base_value * 100.0, 4)
            deltas[key] = {
                "baseline": base_value,
                "candidate": cand_value,
                "delta": round(cand_value - base_value, 6),
                "reduction_pct": pct,
            }
        else:
            deltas[key] = {"baseline": base_value, "candidate": cand_value, "delta": None, "reduction_pct": None}
    return {
        "verdict": gate_report.status,
        "primary_metric": metric.as_dict(),
        "reportable": metric.reportable,
        "per_metric": deltas,
        "warning": (
            None
            if metric.reportable
            else "Primary metric is SYNTHETIC_TEST_METRIC. This run proves the pipeline "
            "executes; it is not evidence of a saving."
        ),
    }


def hash_payload(payload: Any) -> str:
    return sha256_text(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str))
