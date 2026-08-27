import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.factory import reset_providers_for_tests


@pytest.fixture()
def client(tmp_path: Path):
    reset_providers_for_tests()
    db_path = tmp_path / "api.db"
    application = create_app(
        database_url=f"sqlite:///{db_path.as_posix()}",
        run_migrations=True,
        start_monitor=False,
    )
    with TestClient(application) as test_client:
        yield test_client


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert "openrouter_configured" in body


def test_products_connect_scan_findings_ai_calls(client: TestClient, tmp_path: Path):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "service.py").write_text(
        "from openai import OpenAI\nclient = OpenAI()\ndef classify(x):\n    return client.responses.create(model='m', input=x)\n",
        encoding="utf-8",
    )

    empty = client.get("/api/v1/products")
    assert empty.status_code == 200
    assert empty.json() == []

    connected = client.post("/api/v1/products/connect-local", json={"path": str(workspace), "name": "Demo"})
    assert connected.status_code == 200
    payload = connected.json()
    product_id = payload["product"]["id"]
    assert payload["files_scanned"] >= 1
    assert isinstance(payload["ai_calls"], list)
    assert isinstance(payload["findings"], list)

    listed = client.get("/api/v1/products")
    assert len(listed.json()) == 1

    got = client.get(f"/api/v1/products/{product_id}")
    assert got.status_code == 200
    assert got.json()["id"] == product_id

    scanned = client.post(f"/api/v1/products/{product_id}/scan")
    assert scanned.status_code == 200

    ai_calls = client.get(f"/api/v1/products/{product_id}/ai-calls")
    assert ai_calls.status_code == 200
    assert isinstance(ai_calls.json(), list)

    findings = client.get(f"/api/v1/products/{product_id}/findings")
    assert findings.status_code == 200
    assert isinstance(findings.json(), list)

    monitored = client.post(f"/api/v1/products/{product_id}/monitoring", json={"enabled": True})
    assert monitored.status_code == 200
    assert monitored.json()["monitoring_enabled"] is True

    deleted = client.delete(f"/api/v1/products/{product_id}")
    assert deleted.status_code == 200
    assert client.get("/api/v1/products").json() == []


def test_traces_economics_experiments_legacy_candidate_fields(client: TestClient, tmp_path: Path):
    workspace = tmp_path / "ws2"
    workspace.mkdir()
    (workspace / "a.py").write_text("print('ok')\n", encoding="utf-8")
    product_id = client.post("/api/v1/products/connect-local", json={"path": str(workspace)}).json()["product"]["id"]

    jsonl = "\n".join(
        [
            (
                '{"request_id":"r1","symbol":"classify","expected_output":"yes",'
                '"output_text":"yes","candidate_output":"yes","cost_usd":0.02,'
                '"candidate_cost_usd":0.01,"latency_ms":10,"candidate_latency_ms":9,"protected":false}'
            ),
            (
                '{"request_id":"r2","symbol":"classify","expected_output":"yes",'
                '"output_text":"yes","candidate_output":"yes","cost_usd":0.02,'
                '"candidate_cost_usd":0.01,"latency_ms":12,"candidate_latency_ms":11,"protected":false}'
            ),
            (
                '{"request_id":"r3","symbol":"classify","expected_output":"yes",'
                '"output_text":"yes","candidate_output":"yes","cost_usd":0.02,'
                '"candidate_cost_usd":0.01,"latency_ms":11,"candidate_latency_ms":10,"protected":false}'
            ),
            (
                '{"request_id":"r4","symbol":"classify","expected_output":"yes",'
                '"output_text":"yes","candidate_output":"yes","cost_usd":0.02,'
                '"candidate_cost_usd":0.01,"latency_ms":10,"candidate_latency_ms":10,"protected":false}'
            ),
            (
                '{"request_id":"r5","symbol":"classify","expected_output":"yes",'
                '"output_text":"yes","candidate_output":"yes","cost_usd":0.02,'
                '"candidate_cost_usd":0.01,"latency_ms":10,"candidate_latency_ms":10,"protected":false}'
            ),
        ]
    )
    imported = client.post(f"/api/v1/products/{product_id}/traces/import", json={"traces": [], "jsonl": jsonl})
    assert imported.status_code == 200
    assert imported.json()["imported"] == 5

    economics = client.get(f"/api/v1/products/{product_id}/economics")
    assert economics.status_code == 200
    body = economics.json()
    assert body["trace_count"] == 5
    assert body["observed_cost_usd"] == pytest.approx(0.1)
    assert "imported_external" in body["note"] or "Observed" in body["note"]

    experiment = client.post(
        f"/api/v1/products/{product_id}/experiments/run",
        json={"finding_id": None, "quality_gate": 0.98, "min_samples": 5, "fallback_exists": True},
    )
    assert experiment.status_code == 200
    exp = experiment.json()
    assert exp["status"] in {"VERIFIED", "REJECTED", "NEEDS_EVIDENCE"}
    assert "gates" in exp
    assert "evidence_version" in exp

    listed = client.get(f"/api/v1/products/{product_id}/experiments")
    assert listed.status_code == 200
    assert len(listed.json()) >= 1

    cleared = client.delete(f"/api/v1/products/{product_id}/traces")
    assert cleared.status_code == 200


def test_implementations_list_and_prepare_mocked(client: TestClient, tmp_path: Path, monkeypatch):
    import subprocess

    from app.implementation import service as impl_service

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "service.py").write_text("def classify(x):\n    return 'old'\n", encoding="utf-8")
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "ZEVQORA Test"], cwd=repo, check=True)
    subprocess.run(["git", "add", "service.py"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=repo, check=True, capture_output=True)

    # Connect and create verified experiment via DB helpers through API scan + direct prepare path.
    product_id = client.post("/api/v1/products/connect-local", json={"path": str(repo), "name": "Repo"}).json()[
        "product"
    ]["id"]

    # Seed VERIFIED experiment linked to a static finding using TestClient DB session is hard;
    # use implementation service fixtures through monkeypatch after inserting via SQLAlchemy.

    from app.db import SessionLocal
    from app.db_models import Experiment, Finding

    finding_id = str(uuid.uuid4())
    experiment_id = str(uuid.uuid4())
    with SessionLocal() as db:
        db.add(
            Finding(
                id=finding_id,
                product_id=product_id,
                origin="static_scan",
                category="structured_task_candidate",
                title="Bounded classification",
                root_cause="verified candidate available",
                file_path="service.py",
                line=1,
                symbol="classify",
                confidence=0.9,
                risk="medium",
                evidence_status="verified",
            )
        )
        db.add(
            Experiment(
                id=experiment_id,
                product_id=product_id,
                finding_id=finding_id,
                status="VERIFIED",
                sample_size=10,
                baseline_cost_usd=1.0,
                candidate_cost_usd=0.5,
                verified_savings_usd=0.5,
                baseline_quality=1.0,
                candidate_quality=1.0,
                gates_json="[]",
                evidence_version="replay:test",
            )
        )
        db.commit()

    async def fake_generate(**kwargs):
        return "Use the verified cheaper path.", "def classify(x):\n    return 'new'\n"

    monkeypatch.setattr(impl_service, "_generate_replacement", fake_generate)
    monkeypatch.setattr(
        impl_service.settings,
        "worktree_root",
        str(tmp_path / "worktrees"),
        raising=False,
    )

    listed = client.get(f"/api/v1/products/{product_id}/implementations")
    assert listed.status_code == 200
    assert listed.json() == []

    prepared = client.post(
        f"/api/v1/products/{product_id}/implementations/prepare",
        json={"experiment_id": experiment_id, "run_tests": False},
    )
    assert prepared.status_code == 200
    body = prepared.json()
    assert body["status"] == "PREPARED_NO_TESTS"
    assert "return 'new'" in body["diff_text"]
    assert body["worktree_path"]

    # cleanup worktree
    subprocess.run(["git", "worktree", "remove", "--force", body["worktree_path"]], cwd=repo, check=False)
    subprocess.run(["git", "branch", "-D", body["branch_name"]], cwd=repo, check=False)


def test_agent_chat_local_fallback_without_key(client: TestClient, tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.agent.service.settings.openrouter_api_key", "", raising=False)
    workspace = tmp_path / "ws3"
    workspace.mkdir()
    (workspace / "x.py").write_text("print(1)\n", encoding="utf-8")
    product_id = client.post("/api/v1/products/connect-local", json={"path": str(workspace)}).json()["product"]["id"]

    response = client.post(
        "/api/v1/agent/chat",
        json={
            "product_id": product_id,
            "messages": [{"role": "user", "content": "scan this product"}],
            "model": None,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "local"
    assert body["openrouter_configured"] is False
    assert "message" in body
