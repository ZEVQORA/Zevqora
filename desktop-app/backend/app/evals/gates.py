"""Deterministic verification gates v2."""

from __future__ import annotations

from .models import GateConfig, GateOutcome, GateResult


def evaluate_gates(
    *,
    config: GateConfig,
    sample_count: int,
    protected_failures: int,
    protected_count: int,
    baseline_quality: float | None,
    candidate_quality: float | None,
    baseline_cost: float | None,
    candidate_cost: float | None,
    baseline_latency: float | None,
    candidate_latency: float | None,
    fallback_configured: bool,
    execution_succeeded: bool,
    execution_proven: bool,
    evidence_complete: bool,
    missing_reasons: list[str],
    case_errors: int,
) -> list[GateResult]:
    gates: list[GateResult] = []

    # A. evidence completeness
    gates.append(
        GateResult(
            name="evidence_completeness",
            required=True,
            outcome=GateOutcome.PASSED if evidence_complete else GateOutcome.MISSING,
            observed={"complete": evidence_complete, "missing": missing_reasons},
            threshold="all_required_present",
            reason="All required evaluation evidence present."
            if evidence_complete
            else "; ".join(missing_reasons) or "Missing evidence.",
        )
    )

    # B. minimum sample count
    sample_ok = sample_count >= config.min_samples
    gates.append(
        GateResult(
            name="minimum_samples",
            required=True,
            outcome=GateOutcome.PASSED if sample_ok else GateOutcome.MISSING,
            observed=sample_count,
            threshold=config.min_samples,
            reason=f"sample_count={sample_count}; minimum={config.min_samples}.",
        )
    )

    # C. quality floor
    if candidate_quality is None:
        gates.append(
            GateResult(
                name="quality_floor",
                required=True,
                outcome=GateOutcome.MISSING,
                observed=None,
                threshold=config.quality_floor,
                reason="Candidate quality unavailable.",
            )
        )
    else:
        ok = candidate_quality >= config.quality_floor
        gates.append(
            GateResult(
                name="quality_floor",
                required=True,
                outcome=GateOutcome.PASSED if ok else GateOutcome.FAILED,
                observed=candidate_quality,
                threshold=config.quality_floor,
                reason=f"candidate_quality={candidate_quality}; floor={config.quality_floor}.",
            )
        )

    # D. non-inferiority
    if baseline_quality is None or candidate_quality is None:
        gates.append(
            GateResult(
                name="non_inferiority",
                required=True,
                outcome=GateOutcome.MISSING,
                observed={"baseline": baseline_quality, "candidate": candidate_quality},
                threshold=config.non_inferiority_tolerance,
                reason="Baseline or candidate quality missing.",
            )
        )
    else:
        limit = baseline_quality - config.non_inferiority_tolerance
        ok = candidate_quality >= limit
        gates.append(
            GateResult(
                name="non_inferiority",
                required=True,
                outcome=GateOutcome.PASSED if ok else GateOutcome.FAILED,
                observed={
                    "baseline": baseline_quality,
                    "candidate": candidate_quality,
                    "delta": candidate_quality - baseline_quality,
                    "tolerance": config.non_inferiority_tolerance,
                },
                threshold=limit,
                reason=f"candidate_quality >= baseline_quality - tolerance ({limit}).",
            )
        )

    # E. protected slice
    if protected_count == 0:
        gates.append(
            GateResult(
                name="protected_slice",
                required=True,
                outcome=GateOutcome.PASSED,
                observed={"protected_count": 0, "failures": 0},
                threshold=0,
                reason="No protected cases in this evaluation.",
            )
        )
    else:
        ok = protected_failures == 0
        gates.append(
            GateResult(
                name="protected_slice",
                required=True,
                outcome=GateOutcome.PASSED if ok else GateOutcome.FAILED,
                observed={"protected_count": protected_count, "failures": protected_failures},
                threshold=0,
                reason="Every protected case must pass; one failure rejects.",
            )
        )

    # F. cost improvement
    if not config.require_cost_improvement:
        gates.append(
            GateResult(
                name="cost_improvement",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"baseline": baseline_cost, "candidate": candidate_cost},
                threshold=None,
                reason="Cost gate not required by configuration.",
            )
        )
    elif baseline_cost is None or candidate_cost is None:
        gates.append(
            GateResult(
                name="cost_improvement",
                required=True,
                outcome=GateOutcome.MISSING,
                observed={"baseline": baseline_cost, "candidate": candidate_cost},
                threshold="< baseline",
                reason="Cost evidence missing on one or both sides (unknown != 0).",
            )
        )
    else:
        cheaper = candidate_cost < baseline_cost
        pct = ((baseline_cost - candidate_cost) / baseline_cost * 100.0) if baseline_cost else None
        pct_ok = (
            True
            if config.min_cost_improvement_pct <= 0
            else (pct is not None and pct >= config.min_cost_improvement_pct)
        )
        ok = cheaper and pct_ok
        gates.append(
            GateResult(
                name="cost_improvement",
                required=True,
                outcome=GateOutcome.PASSED if ok else GateOutcome.FAILED,
                observed={"baseline": baseline_cost, "candidate": candidate_cost, "pct": pct},
                threshold={"strict_less": True, "min_pct": config.min_cost_improvement_pct},
                reason="Candidate total cost must be lower than baseline.",
            )
        )

    # G. latency regression
    if config.latency_informational and (baseline_latency is None or candidate_latency is None):
        gates.append(
            GateResult(
                name="latency_regression",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"baseline": baseline_latency, "candidate": candidate_latency},
                threshold=config.max_latency_regression_pct,
                reason="Latency informational; values missing.",
            )
        )
    elif not config.require_latency:
        gates.append(
            GateResult(
                name="latency_regression",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"baseline": baseline_latency, "candidate": candidate_latency},
                threshold=config.max_latency_regression_pct,
                reason="Latency gate not required.",
            )
        )
    elif baseline_latency is None or candidate_latency is None:
        gates.append(
            GateResult(
                name="latency_regression",
                required=True,
                outcome=GateOutcome.MISSING,
                observed={"baseline": baseline_latency, "candidate": candidate_latency},
                threshold=config.max_latency_regression_pct,
                reason="Required latency evidence missing.",
            )
        )
    else:
        limit = baseline_latency * (1.0 + config.max_latency_regression_pct / 100.0)
        ok = candidate_latency <= limit
        gates.append(
            GateResult(
                name="latency_regression",
                required=True,
                outcome=GateOutcome.PASSED if ok else GateOutcome.FAILED,
                observed={"baseline": baseline_latency, "candidate": candidate_latency, "limit": limit},
                threshold=limit,
                reason=f"candidate_latency <= baseline * (1 + {config.max_latency_regression_pct}/100).",
            )
        )

    # H. fallback
    if not config.require_fallback:
        gates.append(
            GateResult(
                name="fallback",
                required=False,
                outcome=GateOutcome.INFORMATIONAL,
                observed={"fallback_configured": fallback_configured, "fallback_exercised": False},
                threshold=True,
                reason="Fallback gate not required.",
            )
        )
    else:
        gates.append(
            GateResult(
                name="fallback",
                required=True,
                outcome=GateOutcome.PASSED if fallback_configured else GateOutcome.MISSING,
                observed={"fallback_configured": fallback_configured, "fallback_exercised": False},
                threshold=True,
                reason="Plan must define usable fallback metadata (not runtime-exercised proof).",
            )
        )

    # I. execution success / no evaluation errors
    exec_ok = execution_succeeded and execution_proven and case_errors == 0
    gates.append(
        GateResult(
            name="execution_success",
            required=True,
            outcome=GateOutcome.PASSED if exec_ok else GateOutcome.FAILED,
            observed={
                "execution_succeeded": execution_succeeded,
                "execution_proven": execution_proven,
                "case_errors": case_errors,
            },
            threshold={"execution_succeeded": True, "execution_proven": True, "case_errors": 0},
            reason="Required candidate samples must succeed with execution-proven evidence.",
        )
    )

    return gates


def decide_status(gates: list[GateResult]) -> str:
    """INCOMPLETE if any required MISSING; REJECTED if any required FAILED; else VERIFIED."""
    required = [g for g in gates if g.required]
    if any(g.outcome == GateOutcome.MISSING for g in required):
        return "INCOMPLETE"
    if any(g.outcome == GateOutcome.FAILED for g in required):
        return "REJECTED"
    return "VERIFIED"
