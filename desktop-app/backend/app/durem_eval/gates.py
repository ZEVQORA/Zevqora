"""Run-level verification gates for DUREM candidates.

Reuses ZEVQORA's existing gate vocabulary (GateResult / GateOutcome /
decide_status) so a DUREM verdict is expressed in the same terms as every other
ZEVQORA evaluation, and adds the DUREM-specific per-category gates.

VERIFIED requires every required gate to pass. One protected failure rejects,
whatever the measured saving.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..evals.models import GateOutcome, GateResult
from .graders import CaseGrade, protected_failure_count, quality_score
from .metrics import MetricFidelity, MetricSelection

GATES_VERSION = "durem_gates_v1"


@dataclass
class DuremGateConfig:
    min_samples: int = 60
    quality_floor: float = 0.95
    non_inferiority_tolerance: float = 0.0
    require_protected_cases: bool = True
    require_work_improvement: bool = True
    min_work_improvement_pct: float = 0.0
    require_latency: bool = False  # only meaningful on a real runtime
    max_latency_regression_pct: float = 20.0
    require_reportable_metric: bool = False  # True only for a real-host evidence run
    require_zero_case_errors: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "min_samples": self.min_samples,
            "quality_floor": self.quality_floor,
            "non_inferiority_tolerance": self.non_inferiority_tolerance,
            "require_protected_cases": self.require_protected_cases,
            "require_work_improvement": self.require_work_improvement,
            "min_work_improvement_pct": self.min_work_improvement_pct,
            "require_latency": self.require_latency,
            "max_latency_regression_pct": self.max_latency_regression_pct,
            "require_reportable_metric": self.require_reportable_metric,
            "require_zero_case_errors": self.require_zero_case_errors,
            "gates_version": GATES_VERSION,
        }


# Config for a run against the stub runtime. The work gate is informational
# because a stub cannot establish a real saving, and the run must not be able to
# reach VERIFIED-as-evidence on synthetic numbers.
MOCK_GATE_CONFIG = DuremGateConfig(
    require_work_improvement=False,
    require_latency=False,
    require_reportable_metric=False,
)

# Config for a real-host evidence run.
REAL_GATE_CONFIG = DuremGateConfig(
    require_work_improvement=True,
    require_latency=True,
    require_reportable_metric=True,
)


@dataclass
class GateReport:
    gates: list[GateResult] = field(default_factory=list)
    status: str = "INCOMPLETE"

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "gates": [g.model_dump(mode="json") for g in self.gates],
        }


def _category_gate(grades: list[CaseGrade], gate_name: str, categories: set[str]) -> GateResult:
    subset = [g for g in grades if g.category in categories]
    if not subset:
        return GateResult(
            name=gate_name,
            required=False,
            outcome=GateOutcome.INFORMATIONAL,
            observed={"cases": 0, "failures": 0},
            threshold=0,
            reason=f"No {'/'.join(sorted(categories))} cases were evaluated; this gate asserted nothing.",
        )
    failures = [g.case_id for g in subset if not g.passed]
    return GateResult(
        name=gate_name,
        required=True,
        outcome=GateOutcome.PASSED if not failures else GateOutcome.FAILED,
        observed={"cases": len(subset), "failures": failures},
        threshold=0,
        reason=f"Every {'/'.join(sorted(categories))} case must pass.",
    )


def evaluate(
    *,
    config: DuremGateConfig,
    baseline_grades: list[CaseGrade],
    candidate_grades: list[CaseGrade] | None,
    metric: MetricSelection | None,
    baseline_latency_ms: float | None = None,
    candidate_latency_ms: float | None = None,
    case_errors: int = 0,
) -> GateReport:
    grades = candidate_grades if candidate_grades is not None else baseline_grades
    gates: list[GateResult] = []

    # A. sample count
    gates.append(
        GateResult(
            name="minimum_samples",
            required=True,
            outcome=GateOutcome.PASSED if len(grades) >= config.min_samples else GateOutcome.MISSING,
            observed=len(grades),
            threshold=config.min_samples,
            reason=f"sample_count={len(grades)}; minimum={config.min_samples}.",
        )
    )

    # B. quality floor
    candidate_quality = quality_score(grades)
    if candidate_quality is None:
        gates.append(
            GateResult(
                name="quality_floor",
                required=True,
                outcome=GateOutcome.MISSING,
                observed=None,
                threshold=config.quality_floor,
                reason="No graded cases.",
            )
        )
    else:
        gates.append(
            GateResult(
                name="quality_floor",
                required=True,
                outcome=GateOutcome.PASSED if candidate_quality >= config.quality_floor else GateOutcome.FAILED,
                observed=candidate_quality,
                threshold=config.quality_floor,
                reason=f"quality={candidate_quality}; floor={config.quality_floor}.",
            )
        )

    # C. non-inferiority against the baseline arm
    baseline_quality = quality_score(baseline_grades)
    if candidate_grades is None:
        gates.append(
            GateResult(
                name="non_inferiority",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"baseline": baseline_quality},
                threshold=config.non_inferiority_tolerance,
                reason="Baseline-only run; there is no candidate to compare.",
            )
        )
    elif baseline_quality is None or candidate_quality is None:
        gates.append(
            GateResult(
                name="non_inferiority",
                required=True,
                outcome=GateOutcome.MISSING,
                observed={"baseline": baseline_quality, "candidate": candidate_quality},
                threshold=config.non_inferiority_tolerance,
                reason="Quality missing on one arm.",
            )
        )
    else:
        limit = baseline_quality - config.non_inferiority_tolerance
        gates.append(
            GateResult(
                name="non_inferiority",
                required=True,
                outcome=GateOutcome.PASSED if candidate_quality >= limit else GateOutcome.FAILED,
                observed={
                    "baseline": baseline_quality,
                    "candidate": candidate_quality,
                    "delta": round(candidate_quality - baseline_quality, 6),
                },
                threshold=limit,
                reason=f"candidate >= baseline - {config.non_inferiority_tolerance}.",
            )
        )

    # D. protected slice
    protected = [g for g in grades if g.protected]
    protected_failures = protected_failure_count(grades)
    if not protected and config.require_protected_cases:
        gates.append(
            GateResult(
                name="protected_slice",
                required=True,
                outcome=GateOutcome.MISSING,
                observed={"protected_count": 0, "failures": 0},
                threshold=0,
                reason="Protected coverage required but no protected cases were evaluated.",
            )
        )
    elif not protected:
        gates.append(
            GateResult(
                name="protected_slice",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"protected_count": 0, "failures": 0},
                threshold=0,
                reason="No protected cases were evaluated; this gate asserted nothing.",
            )
        )
    else:
        failed_ids = [g.case_id for g in grades if g.protected_failures]
        gates.append(
            GateResult(
                name="protected_slice",
                required=True,
                outcome=GateOutcome.PASSED if protected_failures == 0 else GateOutcome.FAILED,
                observed={"protected_count": len(protected), "failures": failed_ids},
                threshold=0,
                reason="Every protected case must pass; one failure rejects.",
            )
        )

    # E. per-category safety gates
    gates.append(_category_gate(grades, "routing_correctness", {"CHAT", "ROUTE-OBV", "ROUTE-AMB"}))
    gates.append(_category_gate(grades, "deterministic_rule_correctness", {"RULE"}))
    gates.append(_category_gate(grades, "rag_grounding", {"RAG"}))
    gates.append(_category_gate(grades, "source_validation", {"SRCVAL"}))
    gates.append(_category_gate(grades, "acl_privacy", {"ACL"}))
    gates.append(_category_gate(grades, "document_lifecycle", {"LIFECYCLE"}))
    gates.append(_category_gate(grades, "not_found_safety", {"NOTFOUND"}))
    gates.append(_category_gate(grades, "safety_override", {"SAFETY"}))

    # F. execution completeness
    gates.append(
        GateResult(
            name="execution_success",
            required=config.require_zero_case_errors,
            outcome=GateOutcome.PASSED if case_errors == 0 else GateOutcome.FAILED,
            observed={"case_errors": case_errors},
            threshold=0,
            reason="Every case must execute without error.",
        )
    )

    # G. work / cost improvement
    if metric is None:
        gates.append(
            GateResult(
                name="work_improvement",
                required=config.require_work_improvement,
                outcome=GateOutcome.MISSING if config.require_work_improvement else GateOutcome.INFORMATIONAL,
                observed=None,
                threshold="< baseline",
                reason="No work metric available.",
            )
        )
    elif not config.require_work_improvement:
        gates.append(
            GateResult(
                name="work_improvement",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed=metric.as_dict(),
                threshold=None,
                reason="Work gate not required by configuration (stub runtime cannot establish a real saving).",
            )
        )
    elif metric.baseline_value is None or metric.candidate_value is None:
        gates.append(
            GateResult(
                name="work_improvement",
                required=True,
                outcome=GateOutcome.MISSING,
                observed=metric.as_dict(),
                threshold="< baseline",
                reason="Work evidence missing on one or both arms (unknown is not zero).",
            )
        )
    else:
        pct = metric.reduction_pct
        ok = metric.candidate_value < metric.baseline_value and (
            config.min_work_improvement_pct <= 0 or (pct is not None and pct >= config.min_work_improvement_pct)
        )
        gates.append(
            GateResult(
                name="work_improvement",
                required=True,
                outcome=GateOutcome.PASSED if ok else GateOutcome.FAILED,
                observed=metric.as_dict(),
                threshold={"strict_less": True, "min_pct": config.min_work_improvement_pct},
                reason="Candidate work must be strictly lower than baseline.",
            )
        )

    # H. metric must be reportable (real-host evidence runs only)
    if config.require_reportable_metric:
        reportable = metric is not None and metric.reportable
        gates.append(
            GateResult(
                name="metric_reportable",
                required=True,
                outcome=GateOutcome.PASSED if reportable else GateOutcome.FAILED,
                observed=metric.as_dict() if metric else None,
                threshold={"fidelity_in": [MetricFidelity.REAL_STRUCTURAL.value, MetricFidelity.MEASURED.value]},
                reason="An evidence run may not rest on a SYNTHETIC_TEST_METRIC.",
            )
        )
    else:
        gates.append(
            GateResult(
                name="metric_reportable",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed=metric.as_dict() if metric else None,
                threshold=None,
                reason="Engineering run; the metric is not required to be reportable evidence.",
            )
        )

    # I. latency
    if not config.require_latency:
        gates.append(
            GateResult(
                name="latency_regression",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"baseline": baseline_latency_ms, "candidate": candidate_latency_ms},
                threshold=config.max_latency_regression_pct,
                reason="Latency gate not required (no real runtime).",
            )
        )
    elif baseline_latency_ms is None or candidate_latency_ms is None:
        gates.append(
            GateResult(
                name="latency_regression",
                required=True,
                outcome=GateOutcome.MISSING,
                observed={"baseline": baseline_latency_ms, "candidate": candidate_latency_ms},
                threshold=config.max_latency_regression_pct,
                reason="Required latency evidence missing.",
            )
        )
    else:
        limit = baseline_latency_ms * (1.0 + config.max_latency_regression_pct / 100.0)
        gates.append(
            GateResult(
                name="latency_regression",
                required=True,
                outcome=GateOutcome.PASSED if candidate_latency_ms <= limit else GateOutcome.FAILED,
                observed={"baseline": baseline_latency_ms, "candidate": candidate_latency_ms, "limit": limit},
                threshold=limit,
                reason=f"candidate <= baseline * (1 + {config.max_latency_regression_pct}/100).",
            )
        )

    return GateReport(gates=gates, status=decide_status(gates))


def decide_status(gates: list[GateResult]) -> str:
    """INCOMPLETE if any required MISSING; REJECTED if any required FAILED; else VERIFIED."""
    required = [g for g in gates if g.required]
    if any(g.outcome == GateOutcome.MISSING for g in required):
        return "INCOMPLETE"
    if any(g.outcome == GateOutcome.FAILED for g in required):
        return "REJECTED"
    return "VERIFIED"
