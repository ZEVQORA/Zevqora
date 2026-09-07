"""Evaluation runner — grades baseline+candidate, applies gates, persists EvaluationRun."""

from __future__ import annotations

import json
import uuid
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.hashing import sha256_json, sha256_text
from ..db_models import (
    CandidateExecution,
    CandidatePlan,
    EvaluationCaseResult,
    EvaluationRun,
    Experiment,
    Trace,
    utcnow,
)
from ..optimization.fingerprints import baseline_evidence_hash, task_fingerprint_from_trace
from ..optimization.models import ExecutionStatus
from .gates import decide_status, evaluate_gates
from .graders import get_grader
from .models import (
    EVALUATION_VERSION,
    GATE_SYSTEM_VERSION,
    VERIFICATION_SOURCE_EXECUTION,
    EvaluationCaseSpec,
    EvaluationStatus,
    GateConfig,
    GraderResult,
    GraderSpec,
)
from .provenance import evidence_version_hash, gate_config_hash, grader_config_hash


def _parse_samples(execution: CandidateExecution) -> list[dict[str, Any]]:
    try:
        rows = json.loads(execution.sample_results_json or "[]")
    except json.JSONDecodeError:
        return []
    return rows if isinstance(rows, list) else []


DEFAULT_CLASSIFICATION_LABELS = ("billing", "technical", "account")


def _is_label(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and "\n" not in value.strip() and len(value.strip()) <= 80


def _label_pool(samples: list[dict[str, Any]], traces: dict[str, Trace]) -> list[str]:
    """Distinct single-line expected outputs across the execution, in first-seen order.

    The label set a classification grader scores against comes from the
    evidence itself, so a workload whose labels are not billing/technical/account
    is graded against its own vocabulary. Falls back to the generic defaults
    only when the evidence carries no labels at all.
    """
    pool: dict[str, None] = {}
    for sample in samples:
        bid = sample.get("baseline_trace_id")
        trace = traces.get(bid) if bid else None
        expected = (trace.expected_output if trace else None) or sample.get("expected_output")
        if _is_label(expected):
            pool[str(expected).strip()] = None
    return list(pool) if pool else list(DEFAULT_CLASSIFICATION_LABELS)


def _default_cases_from_execution(
    execution: CandidateExecution,
    traces: dict[str, Trace],
    *,
    default_grader: GraderSpec | None = None,
) -> list[EvaluationCaseSpec]:
    samples = _parse_samples(execution)
    pool = _label_pool(samples, traces)
    grader = default_grader or GraderSpec(
        name="classification",
        config={"labels": list(pool), "strict": True},
    )
    cases: list[EvaluationCaseSpec] = []
    for sample in samples:
        bid = sample.get("baseline_trace_id")
        if not bid:
            continue
        trace = traces.get(bid)
        expected = (trace.expected_output if trace else None) or sample.get("expected_output")
        # Prefer classification when expected is a simple label; else exact match.
        g = grader
        if _is_label(expected):
            label = str(expected).strip()
            # Deduplicated: a label present twice would make an exact hit "ambiguous".
            labels = list(dict.fromkeys([*pool, label]))
            g = GraderSpec(
                name="classification",
                config={
                    "labels": labels,
                    "expected_label": label,
                    "strict": True,
                },
            )
        elif expected is not None:
            g = GraderSpec(name="exact_match", config={"trim": True, "mode": "text"})
        cases.append(
            EvaluationCaseSpec(
                case_id=f"case:{bid}",
                baseline_trace_id=bid,
                candidate_sample_baseline_trace_id=bid,
                protected=bool(trace.protected) if trace else False,
                graders=[g],
                expected=expected,
                metadata={"auto": True},
            )
        )
    return cases


def _grade_output(
    *,
    actual: str | None,
    expected: Any,
    specs: list[GraderSpec],
    context: dict[str, Any],
) -> tuple[float | None, list[dict[str, Any]], bool]:
    if not specs:
        return None, [], False
    results: list[GraderResult] = []
    for spec in specs:
        grader = get_grader(spec.name)
        # Allow case expected_label override into classification config.
        cfg = dict(spec.config or {})
        if spec.name == "classification" and "expected_label" not in cfg and expected is not None:
            cfg["expected_label"] = expected
        effective = GraderSpec(name=spec.name, version=spec.version or grader.version, config=cfg)
        results.append(grader.grade(actual=actual, expected=expected, spec=effective, context=context))
    score = mean(r.score for r in results)
    passed = all(r.passed for r in results)
    return score, [r.model_dump() for r in results], passed


def _reject_inflated_case_specs(case_specs: list[EvaluationCaseSpec]) -> None:
    """Refuse case lists that would overstate how much evidence exists.

    `cases` arrives unvalidated from the HTTP API, and the sample count it
    produces drives the minimum_samples gate while the per-case baseline costs
    drive the cost gate. Two shapes inflate both:

    - Duplicate case_ids, or several cases bound to the same candidate sample.
      N cases pointing at one sample resolve to the same graded output N times,
      so one real measurement satisfies an N-sample gate and the baseline cost
      is counted N times against a single candidate cost.
    - Cases carrying no graders. They produce no score, so they cannot raise or
      lower quality, yet they still count as samples.
    """
    seen_ids: set[str] = set()
    seen_bindings: set[str] = set()
    for spec in case_specs:
        if spec.case_id in seen_ids:
            raise ValueError(f"Duplicate evaluation case_id {spec.case_id!r}; each case must be distinct.")
        seen_ids.add(spec.case_id)

        binding = spec.candidate_sample_baseline_trace_id or spec.baseline_trace_id
        if binding in seen_bindings:
            raise ValueError(
                f"Evaluation case {spec.case_id!r} reuses candidate sample {binding!r}; "
                "one candidate sample cannot count as more than one evaluated case."
            )
        seen_bindings.add(binding)

        if not spec.graders:
            raise ValueError(
                f"Evaluation case {spec.case_id!r} declares no graders; "
                "an ungraded case cannot count toward the sample gate."
            )


def create_and_run_evaluation(
    db: Session,
    product_id: str,
    *,
    candidate_execution_id: str,
    finding_id: str | None = None,
    cases: list[EvaluationCaseSpec] | None = None,
    gate_config: GateConfig | None = None,
    project_experiment: bool = True,
) -> EvaluationRun:
    gate_config = gate_config or GateConfig()
    execution = db.scalar(
        select(CandidateExecution).where(
            CandidateExecution.id == candidate_execution_id,
            CandidateExecution.product_id == product_id,
        )
    )
    if not execution:
        raise ValueError("CandidateExecution not found for this product.")

    plan = db.scalar(select(CandidatePlan).where(CandidatePlan.id == execution.candidate_plan_id))
    traces = {t.id: t for t in db.scalars(select(Trace).where(Trace.product_id == product_id))}
    samples = _parse_samples(execution)
    sample_by_baseline = {s.get("baseline_trace_id"): s for s in samples if s.get("baseline_trace_id")}

    case_specs = cases or _default_cases_from_execution(execution, traces)
    if not case_specs:
        raise ValueError("No evaluation cases available for this execution.")
    _reject_inflated_case_specs(case_specs)

    run = EvaluationRun(
        id=str(uuid.uuid4()),
        product_id=product_id,
        candidate_plan_id=execution.candidate_plan_id,
        candidate_execution_id=execution.id,
        finding_id=finding_id or (plan.finding_id if plan else None),
        status=EvaluationStatus.RUNNING.value,
        evaluation_version=EVALUATION_VERSION,
        grader_config_json=json.dumps([c.model_dump() for c in case_specs], ensure_ascii=False),
        grader_config_hash=grader_config_hash(case_specs),
        gate_config_json=json.dumps(gate_config.model_dump(), ensure_ascii=False),
        gate_config_hash=gate_config_hash(gate_config),
        baseline_evidence_hash="",
        candidate_execution_provenance_hash=execution.provenance_hash or "",
        sample_count=0,
        protected_sample_count=0,
        gates_json="[]",
        verification_source=VERIFICATION_SOURCE_EXECUTION,
        execution_proven=True,
        evidence_version="",
        created_at=utcnow(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        baseline_ids = [c.baseline_trace_id for c in case_specs]
        baseline_traces = [traces[i] for i in baseline_ids if i in traces]
        run.baseline_evidence_hash = (
            baseline_evidence_hash(baseline_traces) if baseline_traces else sha256_json(baseline_ids)
        )

        case_rows: list[EvaluationCaseResult] = []
        candidate_scores: list[float] = []
        baseline_scores: list[float] = []
        weights: list[float] = []
        protected_failures = 0
        protected_count = 0
        case_errors = 0
        missing_reasons: list[str] = []
        digests: list[dict[str, Any]] = []

        if execution.status != ExecutionStatus.SUCCEEDED.value:
            missing_reasons.append("candidate_execution_not_succeeded")
        if not execution.provenance_hash:
            missing_reasons.append("candidate_execution_provenance_missing")

        for spec in case_specs:
            baseline = traces.get(spec.baseline_trace_id)
            sample = sample_by_baseline.get(spec.candidate_sample_baseline_trace_id or spec.baseline_trace_id)
            if baseline is None:
                missing_reasons.append(f"baseline_missing:{spec.case_id}")
                case_errors += 1
                continue
            if sample is None:
                missing_reasons.append(f"candidate_sample_missing:{spec.case_id}")
                case_errors += 1
                continue
            if not sample.get("execution_proven", False):
                missing_reasons.append(f"candidate_not_execution_proven:{spec.case_id}")
                case_errors += 1
            if sample.get("status") != "succeeded":
                case_errors += 1

            context = {
                "product_id": product_id,
                # Baseline tool calls ONLY. Merging the candidate's calls in here
                # made a candidate that invokes a forbidden tool fail the baseline
                # too, collapsing both qualities to 0.0 — which passes
                # non_inferiority and erases the regression. The candidate pass
                # below overrides this key with the candidate's own calls.
                "tool_calls": list((json.loads(baseline.metadata_json or "{}") or {}).get("tool_calls") or []),
                "required_tools": spec.required_tools,
                "forbidden_tools": spec.forbidden_tools,
                "allowed_tools": spec.allowed_tools,
            }
            # Merge case-level tool constraints into context for graders.
            if spec.required_tools:
                context["required_tools"] = spec.required_tools
            if spec.forbidden_tools:
                context["forbidden_tools"] = spec.forbidden_tools

            b_score, b_details, b_pass = _grade_output(
                actual=baseline.output_text,
                expected=spec.expected,
                specs=spec.graders,
                context=context,
            )
            # Candidate tools only — never inherit baseline tool_calls via falsy [] or.
            sample_tools = sample.get("tool_calls")
            if sample_tools is None:
                sample_tools = []
            c_score, c_details, c_pass = _grade_output(
                actual=sample.get("output_text"),
                expected=spec.expected,
                specs=spec.graders,
                context={
                    **context,
                    "tool_calls": list(sample_tools),
                },
            )

            if spec.protected:
                protected_count += 1
                if not c_pass:
                    protected_failures += 1

            if b_score is not None:
                baseline_scores.append(b_score)
            if c_score is not None:
                candidate_scores.append(c_score)
                weights.append(spec.weight)

            task_fp = sample.get("task_fingerprint") or task_fingerprint_from_trace(baseline)
            case_prov = sha256_json(
                {
                    "case_id": spec.case_id,
                    "baseline_trace_id": baseline.id,
                    "task_fingerprint": task_fp,
                    "baseline_output_hash": baseline.output_hash or sha256_text(baseline.output_text),
                    "candidate_output_hash": sample.get("output_hash"),
                    "graders": [g.model_dump() for g in spec.graders],
                    "baseline_score": b_score,
                    "candidate_score": c_score,
                }
            )
            digests.append(
                {
                    "case_id": spec.case_id,
                    "task_fingerprint": task_fp,
                    "baseline_score": b_score,
                    "candidate_score": c_score,
                    "case_provenance_hash": case_prov,
                }
            )

            row = EvaluationCaseResult(
                id=str(uuid.uuid4()),
                evaluation_run_id=run.id,
                case_id=spec.case_id,
                baseline_trace_id=baseline.id,
                candidate_execution_id=execution.id,
                task_fingerprint=task_fp,
                protected=spec.protected,
                grader_specs_json=json.dumps([g.model_dump() for g in spec.graders], ensure_ascii=False),
                expected_hash=sha256_json(spec.expected),
                baseline_output_hash=baseline.output_hash or sha256_text(baseline.output_text),
                candidate_output_hash=sample.get("output_hash"),
                baseline_score=b_score,
                candidate_score=c_score,
                baseline_grader_json=json.dumps(b_details, ensure_ascii=False),
                candidate_grader_json=json.dumps(c_details, ensure_ascii=False),
                baseline_cost_usd=baseline.cost_usd,
                candidate_cost_usd=sample.get("cost_usd"),
                baseline_cost_source=baseline.cost_source,
                candidate_cost_source=sample.get("cost_source"),
                baseline_latency_ms=baseline.latency_ms,
                candidate_latency_ms=sample.get("latency_ms"),
                error_detail=sample.get("error_detail"),
                case_provenance_hash=case_prov,
                created_at=utcnow(),
            )
            case_rows.append(row)
            db.add(row)

        def _weighted_mean(scores: list[float], w: list[float]) -> float | None:
            if not scores:
                return None
            if len(scores) != len(w):
                return mean(scores)
            total_w = sum(w)
            if total_w <= 0:
                # `or 1.0` here produced an unnormalised number that could exceed
                # 1.0 and sail past the quality floor. Unknown, not 1.0.
                return None
            return sum(s * wt for s, wt in zip(scores, w, strict=False)) / total_w

        baseline_quality = mean(baseline_scores) if baseline_scores else None
        candidate_quality = _weighted_mean(candidate_scores, weights)

        # Costs / latency aggregates from graded cases that have values.
        b_costs = [r.baseline_cost_usd for r in case_rows if r.baseline_cost_usd is not None]
        c_costs = [r.candidate_cost_usd for r in case_rows if r.candidate_cost_usd is not None]
        b_lats = [r.baseline_latency_ms for r in case_rows if r.baseline_latency_ms is not None]
        c_lats = [r.candidate_latency_ms for r in case_rows if r.candidate_latency_ms is not None]

        baseline_cost = (
            sum(b_costs) if b_costs and len(b_costs) == len(case_rows) else (sum(b_costs) if b_costs else None)
        )
        # Prefer execution aggregate cost when available.
        candidate_cost = execution.cost_usd if execution.cost_usd is not None else (sum(c_costs) if c_costs else None)
        if candidate_cost is None and c_costs and len(c_costs) == len(case_rows):
            candidate_cost = sum(c_costs)

        # Completeness for cost/latency gates handled inside evaluate_gates via None checks.
        evidence_complete = (
            execution.status == ExecutionStatus.SUCCEEDED.value
            and bool(execution.provenance_hash)
            and all(
                s.get("execution_proven")
                for s in samples
                if s.get("baseline_trace_id") in {c.baseline_trace_id for c in case_specs}
            )
            and not any(
                r.startswith("baseline_missing") or r.startswith("candidate_sample_missing") for r in missing_reasons
            )
            and len(case_rows) == len(case_specs)
        )
        if not evidence_complete and not missing_reasons:
            missing_reasons.append("evidence_incomplete")

        fallback_configured = bool(plan and (plan.fallback or "").strip())
        # Derived from the samples, not asserted. This flag is what the
        # implementation boundary keys on, so a hardcoded True made it carry
        # no information at all.
        execution_proven = all(bool(s.get("execution_proven")) for s in samples) if samples else False

        gates = evaluate_gates(
            config=gate_config,
            # Scored cases, not submitted cases: a case that produced no
            # score contributes no quality evidence and must not satisfy
            # the minimum-samples gate.
            sample_count=len(candidate_scores),
            protected_failures=protected_failures,
            protected_count=protected_count,
            baseline_quality=baseline_quality,
            candidate_quality=candidate_quality,
            baseline_cost=baseline_cost,
            candidate_cost=candidate_cost,
            baseline_latency=mean(b_lats) if b_lats else None,
            candidate_latency=mean(c_lats) if c_lats else (execution.latency_ms),
            fallback_configured=fallback_configured,
            execution_succeeded=execution.status == ExecutionStatus.SUCCEEDED.value,
            execution_proven=execution_proven,
            evidence_complete=evidence_complete,
            missing_reasons=missing_reasons,
            case_errors=case_errors,
        )
        status = decide_status(gates)

        raw_delta = None
        raw_pct = None
        if baseline_cost is not None and candidate_cost is not None:
            raw_delta = candidate_cost - baseline_cost
            if baseline_cost:
                raw_pct = (baseline_cost - candidate_cost) / baseline_cost * 100.0

        quality_delta = None
        if baseline_quality is not None and candidate_quality is not None:
            quality_delta = candidate_quality - baseline_quality

        run.status = status
        run.execution_proven = execution_proven
        run.sample_count = len(candidate_scores)
        run.protected_sample_count = protected_count
        run.baseline_quality = baseline_quality
        run.candidate_quality = candidate_quality
        run.quality_delta = quality_delta
        run.baseline_cost_usd = baseline_cost
        run.candidate_cost_usd = candidate_cost
        run.raw_cost_delta_usd = raw_delta
        run.raw_cost_delta_percent = raw_pct
        run.baseline_latency_ms = mean(b_lats) if b_lats else None
        run.candidate_latency_ms = mean(c_lats) if c_lats else execution.latency_ms
        run.gates_json = json.dumps([g.model_dump() for g in gates], ensure_ascii=False)
        run.evidence_completeness = evidence_complete
        run.rejection_reason = None
        if status == EvaluationStatus.INCOMPLETE.value:
            run.rejection_reason = "; ".join(missing_reasons) or "Incomplete required evidence."
        elif status == EvaluationStatus.REJECTED.value:
            failed = [g.name for g in gates if g.required and g.outcome.value == "failed"]
            run.rejection_reason = "Failed gates: " + ", ".join(failed)
        run.evidence_version = evidence_version_hash(
            candidate_execution_provenance=execution.provenance_hash or "",
            baseline_evidence_hash=run.baseline_evidence_hash,
            cases=case_specs,
            gate_config=gate_config,
            case_result_digests=digests,
        )
        run.gate_system_version = GATE_SYSTEM_VERSION
        run.completed_at = utcnow()
        db.add(run)

        if project_experiment:
            _project_experiment(db, run, plan)

        db.commit()
        db.refresh(run)
        return run
    except Exception as exc:
        run.status = EvaluationStatus.FAILED.value
        run.rejection_reason = f"Evaluation system failure: {exc}"[:1000]
        run.completed_at = utcnow()
        db.add(run)
        db.commit()
        db.refresh(run)
        raise


def _project_experiment(db: Session, run: EvaluationRun, plan: CandidatePlan | None) -> Experiment:
    """Compatibility Experiment row — authoritative proof remains EvaluationRun."""
    status_map = {
        EvaluationStatus.VERIFIED.value: "VERIFIED",
        EvaluationStatus.REJECTED.value: "REJECTED",
        EvaluationStatus.INCOMPLETE.value: "NEEDS_EVIDENCE",
        EvaluationStatus.FAILED.value: "REJECTED",
    }
    exp = Experiment(
        id=str(uuid.uuid4()),
        product_id=run.product_id,
        finding_id=run.finding_id,
        status=status_map.get(run.status, "NEEDS_EVIDENCE"),
        sample_size=run.sample_count,
        baseline_cost_usd=run.baseline_cost_usd,
        candidate_cost_usd=run.candidate_cost_usd,
        verified_savings_usd=(
            (run.baseline_cost_usd - run.candidate_cost_usd)
            if run.status == EvaluationStatus.VERIFIED.value
            and run.baseline_cost_usd is not None
            and run.candidate_cost_usd is not None
            else None
        ),
        baseline_quality=run.baseline_quality,
        candidate_quality=run.candidate_quality,
        baseline_latency_ms=run.baseline_latency_ms,
        candidate_latency_ms=run.candidate_latency_ms,
        gates_json=run.gates_json,
        evidence_version=run.evidence_version,
        verification_source=VERIFICATION_SOURCE_EXECUTION,
        execution_proven=bool(run.execution_proven),
        evaluation_run_id=run.id,
        candidate_execution_id=run.candidate_execution_id,
        created_at=utcnow(),
    )
    db.add(exp)
    return exp


def get_evaluation(db: Session, product_id: str, evaluation_id: str) -> EvaluationRun | None:
    return db.scalar(
        select(EvaluationRun).where(EvaluationRun.id == evaluation_id, EvaluationRun.product_id == product_id)
    )


def list_evaluations(db: Session, product_id: str) -> list[EvaluationRun]:
    return list(
        db.scalars(
            select(EvaluationRun)
            .where(EvaluationRun.product_id == product_id)
            .order_by(EvaluationRun.created_at.desc())
        )
    )


def list_case_results(db: Session, evaluation_run_id: str) -> list[EvaluationCaseResult]:
    return list(
        db.scalars(select(EvaluationCaseResult).where(EvaluationCaseResult.evaluation_run_id == evaluation_run_id))
    )
