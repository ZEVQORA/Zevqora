"""Benchmark/product fixture harness — isolated materialization of case setup.

Version fixture_harness_v1.1.0:
- clear product-scoped fixture rows before each materialization
- baseline and candidate restore equivalent starting state from a seed payload
"""

from __future__ import annotations

import json
import threading
import uuid
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db_models import (
    AICall,
    CandidateExecution,
    CandidatePlan,
    EvaluationRun,
    Finding,
    utcnow,
)
from .models import BenchmarkCaseSetup, BenchmarkCaseSpec

FIXTURE_HARNESS_VERSION = "fixture_harness_v1.1.0"

_seed_lock = threading.Lock()


def _is_fixture_plan_id(plan_id: str | None) -> bool:
    return bool(plan_id) and str(plan_id).startswith("fixture-")


def _is_fixture_ce_id(ce_id: str | None) -> bool:
    return bool(ce_id) and str(ce_id).startswith("fixture-")


def clear_product_fixture_state(db: Session, product_id: str) -> None:
    """Remove fixture-scoped product rows so the next seed is isolated.

    Live optimization CandidatePlan/Execution rows (non-fixture ids) are preserved.
    """
    # Evaluation runs that reference fixture executions or fixture evidence versions.
    evals = list(db.scalars(select(EvaluationRun).where(EvaluationRun.product_id == product_id)))
    for er in evals:
        if _is_fixture_ce_id(er.candidate_execution_id) or str(er.evidence_version or "").startswith("fixture-ev-"):
            db.delete(er)

    ces = list(db.scalars(select(CandidateExecution).where(CandidateExecution.product_id == product_id)))
    for ce in ces:
        if _is_fixture_ce_id(ce.id) or str(ce.provenance_hash or "").startswith("fixture-prov-"):
            db.delete(ce)

    plans = list(db.scalars(select(CandidatePlan).where(CandidatePlan.product_id == product_id)))
    for plan in plans:
        if _is_fixture_plan_id(plan.id) or plan.plan_version == "fixture":
            db.delete(plan)

    db.execute(delete(AICall).where(AICall.product_id == product_id))
    db.execute(delete(Finding).where(Finding.product_id == product_id))
    db.flush()


def materialize_product_state_seed(
    db: Session,
    product_id: str,
    seed: dict[str, Any] | BenchmarkCaseSetup,
    *,
    clear_first: bool = True,
) -> None:
    """Materialize a deterministic product-state seed (no case_id / expected / cohort)."""
    setup = seed if isinstance(seed, BenchmarkCaseSetup) else BenchmarkCaseSetup.model_validate(seed)
    with _seed_lock:
        if clear_first:
            clear_product_fixture_state(db, product_id)
        _insert_setup_rows(db, product_id, setup)
        db.commit()


def apply_case_setup(db: Session, product_id: str, case: BenchmarkCaseSpec) -> dict[str, Any]:
    """Clear then seed authoritative product rows for this case. Returns seed payload."""
    seed = case.setup.model_dump(mode="json")
    materialize_product_state_seed(db, product_id, seed, clear_first=True)
    return seed


def _insert_setup_rows(db: Session, product_id: str, setup: BenchmarkCaseSetup) -> None:
    for raw in setup.ai_calls:
        cid = str(raw.get("id") or uuid.uuid4())
        if db.get(AICall, cid):
            continue
        db.add(
            AICall(
                id=cid,
                product_id=product_id,
                file_path=str(raw.get("file_path") or "app/main.py"),
                line=int(raw.get("line") or 1),
                provider=str(raw.get("provider") or "openai"),
                symbol=raw.get("symbol"),
                excerpt=str(raw.get("excerpt") or "client.chat.completions.create(...)"),
            )
        )

    for raw in setup.findings:
        fid = str(raw.get("id") or uuid.uuid4())
        if db.get(Finding, fid):
            continue
        db.add(
            Finding(
                id=fid,
                product_id=product_id,
                origin=str(raw.get("origin") or "static_scan"),
                category=str(raw.get("category") or "needs_evidence"),
                title=str(raw.get("title") or "Fixture finding"),
                root_cause=str(raw.get("root_cause") or "fixture"),
                file_path=str(raw.get("file_path") or "app/main.py"),
                line=int(raw.get("line") or 1),
                symbol=raw.get("symbol"),
                confidence=float(raw.get("confidence") or 0.5),
                risk=str(raw.get("risk") or "medium"),
                evidence_status=str(raw.get("evidence_status") or "needs_evidence"),
                created_at=utcnow(),
            )
        )

    plan_by_ce: dict[str, str] = {}
    pending_plans: set[str] = set()
    pending_ces: set[str] = set()
    for raw in setup.candidate_executions:
        ce_id = str(raw.get("id") or uuid.uuid4())
        if ce_id in pending_ces or db.get(CandidateExecution, ce_id):
            plan_by_ce[ce_id] = str(raw.get("candidate_plan_id") or f"fixture-plan-for-{ce_id}")
            continue
        plan_id = str(raw.get("candidate_plan_id") or f"fixture-plan-for-{ce_id}")
        if plan_id not in pending_plans and not db.get(CandidatePlan, plan_id):
            db.add(
                CandidatePlan(
                    id=plan_id,
                    product_id=product_id,
                    finding_id=raw.get("finding_id"),
                    strategy=str(raw.get("strategy") or "model_substitution"),
                    status=str(raw.get("plan_status") or "COMPLETED"),
                    baseline_config_json="{}",
                    candidate_config_json=json.dumps({"model": raw.get("requested_model")}, ensure_ascii=False),
                    reason="benchmark fixture",
                    expected_mechanism="fixture",
                    risk="low",
                    fallback="retain_baseline",
                    required_evidence_json="[]",
                    max_budget_usd=1.0,
                    sample_scope_json="[]",
                    plan_version="fixture",
                    config_hash=f"fixture-{plan_id}",
                    created_at=utcnow(),
                )
            )
            pending_plans.add(plan_id)
        plan_by_ce[ce_id] = plan_id
        db.add(
            CandidateExecution(
                id=ce_id,
                candidate_plan_id=plan_id,
                product_id=product_id,
                status=str(raw.get("status") or "SUCCEEDED"),
                execution_key=str(raw.get("execution_key") or f"fixture-key-{ce_id}"),
                attempt=1,
                provider=str(raw.get("provider") or "openrouter"),
                requested_model=raw.get("requested_model"),
                resolved_model=raw.get("resolved_model") or raw.get("requested_model"),
                baseline_trace_ids_json="[]",
                sample_results_json="[]",
                cost_usd=raw.get("cost_usd"),
                cost_source=raw.get("cost_source"),
                provider_call_count=int(raw.get("provider_call_count") or 0),
                provenance_hash=str(raw.get("provenance_hash") or f"fixture-prov-{ce_id}"),
                created_at=utcnow(),
            )
        )
        pending_ces.add(ce_id)

    db.flush()

    for raw in setup.evaluation_runs:
        eid = str(raw.get("id") or uuid.uuid4())
        if db.get(EvaluationRun, eid):
            continue
        ce_id = str(raw.get("candidate_execution_id") or "")
        if ce_id and ce_id not in pending_ces and not db.get(CandidateExecution, ce_id):
            plan_id = str(raw.get("candidate_plan_id") or f"fixture-plan-for-{ce_id}")
            if plan_id not in pending_plans and not db.get(CandidatePlan, plan_id):
                db.add(
                    CandidatePlan(
                        id=plan_id,
                        product_id=product_id,
                        strategy="model_substitution",
                        status="COMPLETED",
                        baseline_config_json="{}",
                        candidate_config_json="{}",
                        reason="benchmark fixture",
                        expected_mechanism="fixture",
                        risk="low",
                        fallback="retain_baseline",
                        required_evidence_json="[]",
                        max_budget_usd=1.0,
                        sample_scope_json="[]",
                        plan_version="fixture",
                        config_hash=f"fixture-{plan_id}",
                        created_at=utcnow(),
                    )
                )
                pending_plans.add(plan_id)
            db.add(
                CandidateExecution(
                    id=ce_id,
                    candidate_plan_id=plan_id,
                    product_id=product_id,
                    status="SUCCEEDED",
                    execution_key=f"fixture-key-{ce_id}",
                    provenance_hash=f"fixture-prov-{ce_id}",
                    created_at=utcnow(),
                )
            )
            pending_ces.add(ce_id)
            plan_by_ce[ce_id] = plan_id
        gates: list[Any] = list(raw.get("gates") or [])
        db.add(
            EvaluationRun(
                id=eid,
                product_id=product_id,
                candidate_plan_id=raw.get("candidate_plan_id") or plan_by_ce.get(ce_id),
                candidate_execution_id=ce_id or str(uuid.uuid4()),
                status=str(raw.get("status") or "REJECTED"),
                evaluation_version=str(raw.get("evaluation_version") or "evals_v1"),
                sample_count=int(raw.get("sample_count") or 0),
                protected_sample_count=int(raw.get("protected_sample_count") or 0),
                baseline_cost_usd=raw.get("baseline_cost_usd"),
                candidate_cost_usd=raw.get("candidate_cost_usd"),
                verification_source=str(raw.get("verification_source") or "EXECUTION_EVALUATION"),
                execution_proven=bool(raw.get("execution_proven") or False),
                evidence_completeness=bool(raw.get("evidence_completeness") or True),
                evidence_version=str(raw.get("evidence_version") or f"fixture-ev-{eid}"),
                gates_json=json.dumps(gates, ensure_ascii=False),
                created_at=utcnow(),
                completed_at=utcnow(),
            )
        )
