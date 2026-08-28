"""Evidence must survive deletion, rewriting, and re-evaluation.

A VERIFIED run is only auditable while the baselines it was computed from still
exist and still say what they said.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.db as app_db
from app.config import settings
from app.db_models import (
    CandidateExecution,
    CandidatePlan,
    EvaluationCaseResult,
    EvaluationRun,
    Experiment,
    Product,
    Trace,
    utcnow,
)
from app.evidence.canonical import canonical_verified_experiments
from app.main import create_app
from app.optimization.bridge import project_execution_onto_traces
from app.providers.factory import reset_providers_for_tests


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    reset_providers_for_tests()
    application = create_app(
        database_url=f"sqlite:///{(tmp_path / 'ev.db').as_posix()}",
        run_migrations=True,
        start_monitor=False,
    )
    with TestClient(application) as c:
        c.headers.update({"X-Zevqora-Token": application.state.api_token})
        yield c


def _seed(product_id: str, *, trace_id: str, run_status: str = "VERIFIED") -> None:
    """A product with one trace that a finalized evaluation depends on."""
    with app_db.SessionLocal() as db:
        db.add(Product(id=product_id, name="p", root_path=f"/tmp/{product_id}", monitoring_enabled=False))
        db.add(Trace(id=trace_id, product_id=product_id, request_id=f"r-{trace_id}", cost_usd=0.02))
        run_id = str(uuid.uuid4())
        db.add(
            EvaluationRun(
                id=run_id,
                product_id=product_id,
                candidate_execution_id=str(uuid.uuid4()),
                status=run_status,
                evaluation_version="v",
                verification_source="execution",
                grader_config_hash="g",
                gate_config_hash="gc",
                baseline_evidence_hash="b",
                candidate_execution_provenance_hash="c",
            )
        )
        db.add(
            EvaluationCaseResult(
                id=str(uuid.uuid4()),
                evaluation_run_id=run_id,
                case_id="c-1",
                baseline_trace_id=trace_id,
                candidate_execution_id=str(uuid.uuid4()),
            )
        )
        db.commit()


def test_clearing_traces_refuses_when_evidence_depends_on_them(client: TestClient):
    pid, tid = str(uuid.uuid4()), str(uuid.uuid4())
    _seed(pid, trace_id=tid)

    response = client.delete(f"/api/v1/products/{pid}/traces")
    assert response.status_code == 409
    body = response.json()["detail"]
    assert body["error"] == "evidence_referenced"
    assert body["pinned_trace_count"] == 1
    assert body["blocking_evaluation_ids"]

    with app_db.SessionLocal() as db:
        assert db.get(Trace, tid) is not None, "refused delete must not be partial"


def test_clearing_traces_still_works_without_dependent_evidence(client: TestClient):
    pid, tid = str(uuid.uuid4()), str(uuid.uuid4())
    with app_db.SessionLocal() as db:
        db.add(Product(id=pid, name="p", root_path=f"/tmp/{pid}", monitoring_enabled=False))
        db.add(Trace(id=tid, product_id=pid, request_id="r-1", cost_usd=0.01))
        db.commit()
    assert client.delete(f"/api/v1/products/{pid}/traces").status_code == 200
    with app_db.SessionLocal() as db:
        assert db.get(Trace, tid) is None


def test_disconnect_archives_rather_than_destroying_verified_evidence(client: TestClient):
    pid, tid = str(uuid.uuid4()), str(uuid.uuid4())
    _seed(pid, trace_id=tid)

    response = client.delete(f"/api/v1/products/{pid}")
    assert response.status_code == 200
    assert response.json()["status"] == "archived"

    with app_db.SessionLocal() as db:
        product = db.get(Product, pid)
        assert product is not None
        assert product.archived_at is not None
        assert db.get(Trace, tid) is not None, "baseline evidence must survive disconnect"
        runs = list(db.scalars(select(EvaluationRun).where(EvaluationRun.product_id == pid)))
        assert len(runs) == 1, "the verification record must survive disconnect"

    # Archived products leave the workspace listing.
    assert all(p["id"] != pid for p in client.get("/api/v1/products").json())


def test_disconnect_hard_deletes_when_there_is_no_conclusive_evidence(client: TestClient):
    pid = str(uuid.uuid4())
    with app_db.SessionLocal() as db:
        db.add(Product(id=pid, name="p", root_path=f"/tmp/{pid}", monitoring_enabled=False))
        db.commit()
    assert client.delete(f"/api/v1/products/{pid}").json()["status"] == "disconnected"
    with app_db.SessionLocal() as db:
        assert db.get(Product, pid) is None


def _plan(product_id: str) -> CandidatePlan:
    return CandidatePlan(
        id=str(uuid.uuid4()),
        product_id=product_id,
        strategy="model_substitution",
        status="READY",
        config_hash="cfg",
    )


def _execution(product_id: str, plan_id: str, trace_id: str) -> CandidateExecution:
    return CandidateExecution(
        id=str(uuid.uuid4()),
        candidate_plan_id=plan_id,
        product_id=product_id,
        status="SUCCEEDED",
        execution_key=str(uuid.uuid4()),
        requested_model="m",
        baseline_trace_ids_json=json.dumps([trace_id]),
        sample_results_json=json.dumps(
            [
                {
                    "status": "succeeded",
                    "baseline_trace_id": trace_id,
                    "output_text": "REWRITTEN",
                    "cost_usd": 0.001,
                }
            ]
        ),
        provenance_hash="h",
        started_at=utcnow(),
    )


def test_pinned_trace_cannot_be_silently_rewritten(client: TestClient):
    pid, tid = str(uuid.uuid4()), str(uuid.uuid4())
    _seed(pid, trace_id=tid)
    with app_db.SessionLocal() as db:
        trace = db.get(Trace, tid)
        trace.candidate_output = "ORIGINAL"
        plan = _plan(pid)
        db.add(plan)
        db.flush()
        execution = _execution(pid, plan.id, tid)
        db.add(execution)
        db.commit()
        exec_id = execution.id

    with app_db.SessionLocal() as db:
        updated = project_execution_onto_traces(db, db.get(CandidateExecution, exec_id), overwrite=True)
    assert updated == 0, "a trace a finalized evaluation depends on must not be rewritten"
    with app_db.SessionLocal() as db:
        assert db.get(Trace, tid).candidate_output == "ORIGINAL"


def test_projection_cannot_reach_another_products_traces(client: TestClient):
    pid_a, pid_b = str(uuid.uuid4()), str(uuid.uuid4())
    foreign_tid = str(uuid.uuid4())
    with app_db.SessionLocal() as db:
        db.add(Product(id=pid_a, name="a", root_path=f"/tmp/{pid_a}", monitoring_enabled=False))
        db.add(Product(id=pid_b, name="b", root_path=f"/tmp/{pid_b}", monitoring_enabled=False))
        db.add(Trace(id=foreign_tid, product_id=pid_b, request_id="r-b", candidate_output="B-ORIGINAL"))
        db.flush()
        # Execution belongs to A but its samples name B's trace.
        plan = _plan(pid_a)
        db.add(plan)
        db.flush()
        execution = _execution(pid_a, plan.id, foreign_tid)
        db.add(execution)
        db.commit()
        exec_id = execution.id

    with app_db.SessionLocal() as db:
        updated = project_execution_onto_traces(db, db.get(CandidateExecution, exec_id), overwrite=True)
    assert updated == 0
    with app_db.SessionLocal() as db:
        assert db.get(Trace, foreign_tid).candidate_output == "B-ORIGINAL"


def test_repeated_import_does_not_double_observed_cost(client: TestClient, tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "a.py").write_text("x = 1\n", encoding="utf-8")
    pid = client.post("/api/v1/products/connect-local", json={"path": str(ws)}).json()["product"]["id"]
    jsonl = '{"request_id":"r1","output_text":"y","cost_usd":0.02}'

    first = client.post(f"/api/v1/products/{pid}/traces/import", json={"traces": [], "jsonl": jsonl})
    second = client.post(f"/api/v1/products/{pid}/traces/import", json={"traces": [], "jsonl": jsonl})
    assert first.json()["imported"] == 1
    assert second.json()["imported"] == 0, "re-import must be idempotent"

    econ = client.get(f"/api/v1/products/{pid}/economics").json()
    assert econ["trace_count"] == 1
    assert econ["observed_cost_usd"] == pytest.approx(0.02)


def test_repeated_evaluation_does_not_double_verified_savings():
    """Decision 1: history is append-only; the aggregate takes the latest VERIFIED per execution."""
    pid = str(uuid.uuid4())
    exec_id = str(uuid.uuid4())
    with app_db.SessionLocal() as db:
        db.add(Product(id=pid, name="p", root_path=f"/tmp/{pid}", monitoring_enabled=False))
        for index, saving in enumerate([0.05, 0.07, 0.09]):
            db.add(
                Experiment(
                    id=str(uuid.uuid4()),
                    product_id=pid,
                    status="VERIFIED",
                    sample_size=5,
                    verified_savings_usd=saving,
                    evidence_version=f"v{index}",
                    evaluation_run_id=str(uuid.uuid4()),
                    candidate_execution_id=exec_id,
                    created_at=utcnow(),
                )
            )
        db.commit()

        canonical = canonical_verified_experiments(db, pid)
        assert len(canonical) == 1, "three evaluations of one execution count once"
        assert canonical[0].verified_savings_usd == pytest.approx(0.09), "latest eligible run wins"

        all_rows = list(db.scalars(select(Experiment).where(Experiment.product_id == pid)))
        assert len(all_rows) == 3, "history is preserved, never deleted"
