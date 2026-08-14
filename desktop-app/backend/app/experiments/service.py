from __future__ import annotations

import hashlib
import json
import uuid
from statistics import mean

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db_models import Experiment, Finding, Trace
from ..schemas import ExperimentOut, ExperimentRunRequest, GateOut


def _canonical(value: str | None):
    if value is None:
        return None
    stripped = value.strip()
    try:
        parsed = json.loads(stripped)
        return json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except Exception:
        return " ".join(stripped.split())


def _quality(rows: list[Trace], candidate: bool) -> float | None:
    scored = []
    for row in rows:
        if row.expected_output is None:
            continue
        actual = row.candidate_output if candidate else row.output_text
        if actual is None:
            continue
        scored.append(1.0 if _canonical(actual) == _canonical(row.expected_output) else 0.0)
    return mean(scored) if scored else None


def _avg(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    return mean(clean) if clean else None


def _to_out(exp: Experiment) -> ExperimentOut:
    gates = [GateOut(**item) for item in json.loads(exp.gates_json)]
    return ExperimentOut(
        id=exp.id,
        product_id=exp.product_id,
        finding_id=exp.finding_id,
        status=exp.status,
        sample_size=exp.sample_size,
        baseline_cost_usd=exp.baseline_cost_usd,
        candidate_cost_usd=exp.candidate_cost_usd,
        verified_savings_usd=exp.verified_savings_usd,
        baseline_quality=exp.baseline_quality,
        candidate_quality=exp.candidate_quality,
        baseline_latency_ms=exp.baseline_latency_ms,
        candidate_latency_ms=exp.candidate_latency_ms,
        gates=gates,
        evidence_version=exp.evidence_version,
        created_at=exp.created_at,
    )


def run_experiment(db: Session, product_id: str, request: ExperimentRunRequest) -> ExperimentOut:
    finding = None
    if request.finding_id:
        finding = db.scalar(
            select(Finding).where(
                Finding.id == request.finding_id,
                Finding.product_id == product_id,
            )
        )
        if not finding:
            raise ValueError("Finding not found for this product.")

    stmt = select(Trace).where(Trace.product_id == product_id)
    rows = list(db.scalars(stmt))
    if finding and finding.symbol:
        matching = [r for r in rows if r.symbol == finding.symbol]
        if matching:
            rows = matching

    rows_with_candidate = [
        r
        for r in rows
        if r.candidate_output is not None
        and r.candidate_cost_usd is not None
        and r.cost_usd is not None
        and r.expected_output is not None
    ]

    baseline_quality = _quality(rows_with_candidate, candidate=False)
    candidate_quality = _quality(rows_with_candidate, candidate=True)
    baseline_cost = sum(r.cost_usd or 0.0 for r in rows_with_candidate) if rows_with_candidate else None
    candidate_cost = (
        sum(r.candidate_cost_usd or 0.0 for r in rows_with_candidate) if rows_with_candidate else None
    )
    baseline_latency = _avg([r.latency_ms for r in rows_with_candidate])
    candidate_latency = _avg([r.candidate_latency_ms for r in rows_with_candidate])

    sample_pass = len(rows_with_candidate) >= request.min_samples
    quality_pass = candidate_quality is not None and candidate_quality >= request.quality_gate
    cost_pass = (
        baseline_cost is not None
        and candidate_cost is not None
        and candidate_cost < baseline_cost
    )
    protected_rows = [r for r in rows_with_candidate if r.protected]
    protected_pass = all(
        _canonical(r.candidate_output) == _canonical(r.expected_output) for r in protected_rows
    )
    if baseline_latency is None or candidate_latency is None:
        latency_pass = True
        latency_detail = "No complete candidate latency evidence; latency gate is informational for this run."
    else:
        limit = baseline_latency * (1.0 + request.max_latency_regression_pct / 100.0)
        latency_pass = candidate_latency <= limit
        latency_detail = f"Candidate {candidate_latency:.1f} ms; allowed <= {limit:.1f} ms."

    gates = [
        {"name": "sample", "passed": sample_pass, "detail": f"{len(rows_with_candidate)} complete replay rows; minimum {request.min_samples}."},
        {"name": "quality", "passed": quality_pass, "detail": "Candidate exact/task quality must meet the configured gate."},
        {"name": "protected_slices", "passed": protected_pass, "detail": f"{len(protected_rows)} protected replay rows checked."},
        {"name": "cost", "passed": cost_pass, "detail": "Measured candidate cost must be lower than baseline cost."},
        {"name": "latency", "passed": latency_pass, "detail": latency_detail},
        {"name": "fallback", "passed": request.fallback_exists, "detail": "A safe baseline fallback must be explicitly confirmed."},
    ]

    complete_evidence = bool(rows_with_candidate)
    if not complete_evidence:
        status = "NEEDS_EVIDENCE"
    elif all(item["passed"] for item in gates):
        status = "VERIFIED"
    else:
        status = "REJECTED"

    verified_savings = None
    if status == "VERIFIED" and baseline_cost is not None and candidate_cost is not None:
        verified_savings = baseline_cost - candidate_cost

    evidence_seed = "|".join(sorted(r.request_id for r in rows_with_candidate))
    evidence_version = "replay:" + hashlib.sha256(evidence_seed.encode("utf-8")).hexdigest()[:12]

    exp = Experiment(
        id=str(uuid.uuid4()),
        product_id=product_id,
        finding_id=request.finding_id,
        status=status,
        sample_size=len(rows_with_candidate),
        baseline_cost_usd=baseline_cost,
        candidate_cost_usd=candidate_cost,
        verified_savings_usd=verified_savings,
        baseline_quality=baseline_quality,
        candidate_quality=candidate_quality,
        baseline_latency_ms=baseline_latency,
        candidate_latency_ms=candidate_latency,
        gates_json=json.dumps(gates),
        evidence_version=evidence_version,
    )
    db.add(exp)
    if finding:
        finding.evidence_status = status.lower()
        db.add(finding)
    db.commit()
    db.refresh(exp)
    return _to_out(exp)


def list_experiments(db: Session, product_id: str) -> list[ExperimentOut]:
    rows = list(
        db.scalars(
            select(Experiment)
            .where(Experiment.product_id == product_id)
            .order_by(Experiment.created_at.desc())
        )
    )
    return [_to_out(row) for row in rows]
