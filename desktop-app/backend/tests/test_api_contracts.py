import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import create_app
from app.providers.factory import reset_providers_for_tests


def _build_app(tmp_path: Path):
    reset_providers_for_tests()
    db_path = tmp_path / "api.db"
    return create_app(
        database_url=f"sqlite:///{db_path.as_posix()}",
        run_migrations=True,
        start_monitor=False,
    )


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Settings is a dataclass whose defaults are bound at import, so patch the
    # attribute rather than the environment. Keeps the per-launch token out of
    # the developer's real ~/.zevqora during tests.
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    application = _build_app(tmp_path)
    with TestClient(application) as test_client:
        # The renderer supplies this header via the Electron preload bridge.
        test_client.headers.update({"X-Zevqora-Token": application.state.api_token})
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

    # Seed legacy VERIFIED experiment — Phase 3 must refuse implementation preparation.
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
                verification_source="LEGACY_CANDIDATE_EVIDENCE",
                execution_proven=False,
            )
        )
        db.commit()

    listed = client.get(f"/api/v1/products/{product_id}/implementations")
    assert listed.status_code == 200
    assert listed.json() == []

    prepared = client.post(
        f"/api/v1/products/{product_id}/implementations/prepare",
        json={"experiment_id": experiment_id, "run_tests": False},
    )
    assert prepared.status_code == 422
    assert "not execution-proven" in prepared.json()["detail"]


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


def test_optimization_api_exact_reuse_flow(client: TestClient, tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.candidate_models", ("mock/test-model",))
    workspace = tmp_path / "optws"
    workspace.mkdir()
    (workspace / "a.py").write_text("print(1)\n", encoding="utf-8")
    product_id = client.post("/api/v1/products/connect-local", json={"path": str(workspace)}).json()["product"]["id"]

    jsonl = "\n".join(
        [
            '{"request_id":"o1","symbol":"classify","input_text":"same","output_text":"yes","cost_usd":0.02,"provider":"mock","model":"mock/test-model"}',
            '{"request_id":"o2","symbol":"classify","input_text":"same","output_text":"yes","cost_usd":0.02,"provider":"mock","model":"mock/test-model"}',
        ]
    )
    assert (
        client.post(f"/api/v1/products/{product_id}/traces/import", json={"traces": [], "jsonl": jsonl}).json()[
            "imported"
        ]
        == 2
    )

    plans = client.post(
        f"/api/v1/products/{product_id}/optimization/plans",
        json={"strategy": "exact_reuse"},
    )
    assert plans.status_code == 200
    body = plans.json()
    assert len(body) == 1
    plan_id = body[0]["id"]
    assert body[0]["status"] == "READY"

    got = client.get(f"/api/v1/products/{product_id}/optimization/plans/{plan_id}")
    assert got.status_code == 200

    executed = client.post(
        f"/api/v1/products/{product_id}/optimization/plans/{plan_id}/execute",
        json={"force_rerun": False},
    )
    assert executed.status_code == 200
    exe = executed.json()
    assert exe["status"] == "SUCCEEDED"
    assert exe["provider_call_count"] == 0
    assert exe["cost_usd"] == 0.0
    assert exe["cost_source"] == "deterministic_reuse"
    assert "not VERIFIED" in exe["note"]

    listed = client.get(f"/api/v1/products/{product_id}/optimization/executions")
    assert listed.status_code == 200
    assert len(listed.json()) >= 1
    one = client.get(f"/api/v1/products/{product_id}/optimization/executions/{exe['id']}")
    assert one.status_code == 200
    assert one.json()["provenance_hash"]


# ---------------------------------------------------------------------------
# Local API authentication.
#
# The packaged renderer loads from file:// and therefore sends `Origin: null`,
# so "null" must stay in the CORS allowlist. Any web page can also obtain a null
# origin, which is why the shared per-launch token — not CORS — is the control
# that separates the renderer from a drive-by page.
# ---------------------------------------------------------------------------


def test_api_requires_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    application = _build_app(tmp_path)
    with TestClient(application) as raw:
        # No token: this is the drive-by page's position.
        assert raw.get("/api/v1/products").status_code == 401
        # Reading the user's source tree must not be reachable unauthenticated.
        assert raw.post("/api/v1/products/connect-local", json={"path": str(tmp_path), "name": "x"}).status_code == 401
        # Spending the user's provider balance must not be reachable either.
        assert raw.post("/api/v1/agent/chat", json={"messages": []}).status_code == 401
        # Destroying evidence must not be reachable either.
        assert raw.delete("/api/v1/products/whatever/traces").status_code == 401


def test_api_rejects_wrong_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    application = _build_app(tmp_path)
    with TestClient(application) as raw:
        raw.headers.update({"X-Zevqora-Token": "not-the-token"})
        assert raw.get("/api/v1/products").status_code == 401


def test_health_stays_unauthenticated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """The shell polls health to decide whether the engine is up."""
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    application = _build_app(tmp_path)
    with TestClient(application) as raw:
        assert raw.get("/api/health").status_code == 200


def test_token_is_high_entropy_and_per_launch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    monkeypatch.setattr(settings, "api_auth_token", "")
    first = _build_app(tmp_path).state.api_token
    second = _build_app(tmp_path).state.api_token
    assert first != second, "token must not be reused across launches"
    assert len(first) >= 32


def test_unknown_host_header_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """DNS rebinding: attacker.example resolving to 127.0.0.1 must not be same-origin."""
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    application = _build_app(tmp_path)
    with TestClient(application) as raw:
        raw.headers.update({"X-Zevqora-Token": application.state.api_token})
        assert raw.get("/api/health", headers={"Host": "attacker.example"}).status_code == 400
