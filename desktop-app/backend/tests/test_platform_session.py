"""Platform session: desktop → ZEVQORA account service → OpenRouter, without a device key."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.core import platform
from app.core.errors import ProviderError
from app.main import create_app
from app.optimization.strategies.model_substitution import allowed_candidate_models
from app.providers.factory import get_provider, reset_providers_for_tests
from app.providers.mock import MockProvider
from app.providers.models import LLMMessage, LLMRequest
from app.providers.openrouter import OpenRouterProvider
from app.providers.pricing import PricingSnapshot, reset_pricing_snapshot_cache

TOKEN = "eyJhbGciOiJIUzI1NiJ9.desktop-test-access-token.signature-part"


@pytest.fixture(autouse=True)
def _clean_session(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "candidate_models", ("mock/test-model",))
    platform.clear_session()
    reset_providers_for_tests()
    reset_pricing_snapshot_cache()
    yield
    platform.clear_session()
    reset_providers_for_tests()
    reset_pricing_snapshot_cache()


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "api_token_path", str(tmp_path / "api-token"))
    application = create_app(
        database_url=f"sqlite:///{(tmp_path / 'p.db').as_posix()}",
        run_migrations=True,
        start_monitor=False,
    )
    with TestClient(application) as test_client:
        test_client.headers.update({"X-Zevqora-Token": application.state.api_token})
        yield test_client


def test_mode_is_none_without_key_or_session(client: TestClient):
    health = client.get("/api/health").json()
    assert health["provider_mode"] == "none"
    assert health["openrouter_configured"] is False
    assert health["platform_connected"] is False
    assert isinstance(get_provider(), MockProvider)
    assert allowed_candidate_models() == {"mock/test-model"}


def test_session_set_routes_provider_through_platform(client: TestClient):
    # Port 9 is the discard service: the pricing sync must fail fast and stay best effort.
    body = {
        "base_url": "http://127.0.0.1:9/",
        "access_token": TOKEN,
        "user_id": "user-1",
        "email": "engineer@example.com",
        "workspace_id": "ws-1",
        "project_id": "proj-1",
        "plan": "starter",
    }
    response = client.post("/api/v1/platform/session", json=body)
    assert response.status_code == 200, response.text
    status = response.json()
    assert status["mode"] == "platform"
    assert status["connected"] is True
    assert status["base_url"] == "http://127.0.0.1:9"
    assert status["workspace_id"] == "ws-1"
    assert status["pricing_synced"] is False
    assert "openai/gpt-4o-mini" in status["candidate_models"]
    # The token never leaves the process; only its fingerprint is reported.
    assert TOKEN not in response.text
    assert len(status["token_fingerprint"]) == 12

    health = client.get("/api/health").json()
    assert health["provider_mode"] == "platform"
    assert health["openrouter_configured"] is True
    assert health["platform_connected"] is True

    provider = get_provider()
    assert isinstance(provider, OpenRouterProvider)
    assert provider.via == "platform"
    assert provider.base_url == "http://127.0.0.1:9/api/platform"
    assert provider.api_key == TOKEN
    headers = provider._headers()
    assert headers["Authorization"] == f"Bearer {TOKEN}"
    assert headers["X-Zevqora-Workspace"] == "ws-1"
    assert headers["X-Zevqora-Project"] == "proj-1"

    # Changing the active context rebuilds the provider with the new headers.
    client.post("/api/v1/platform/session", json={**body, "workspace_id": "ws-2", "project_id": None})
    rebuilt = get_provider()
    assert rebuilt is not provider
    assert rebuilt._headers()["X-Zevqora-Workspace"] == "ws-2"
    assert "X-Zevqora-Project" not in rebuilt._headers()

    cleared = client.delete("/api/v1/platform/session")
    assert cleared.status_code == 200
    assert cleared.json()["mode"] == "none"
    assert isinstance(get_provider(), MockProvider)


def test_session_rejects_insecure_or_incomplete_input(client: TestClient):
    insecure = client.post(
        "/api/v1/platform/session", json={"base_url": "http://zevqora.example.com", "access_token": TOKEN}
    )
    assert insecure.status_code == 422
    with_path = client.post(
        "/api/v1/platform/session", json={"base_url": "https://zevqora.example.com/app", "access_token": TOKEN}
    )
    assert with_path.status_code == 422
    short = client.post(
        "/api/v1/platform/session", json={"base_url": "https://zevqora.example.com", "access_token": "short"}
    )
    assert short.status_code == 422
    assert platform.get_session() is None


def test_local_key_wins_over_platform_session(monkeypatch: pytest.MonkeyPatch):
    platform.set_session(base_url="https://zevqora.example.com", access_token=TOKEN)
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-or-local-test-key-000000")
    assert platform.provider_mode() == "local_key"
    provider = get_provider()
    assert isinstance(provider, OpenRouterProvider)
    assert provider.via == "direct"
    assert provider.base_url == settings.openrouter_base_url


@pytest.mark.asyncio
async def test_platform_errors_are_explained_without_leaking(monkeypatch: pytest.MonkeyPatch):
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["workspace"] = request.headers.get("x-zevqora-workspace")
        payload = json.loads(request.content)
        seen["stream"] = payload.get("stream")
        if payload["model"] == "openai/gpt-4o-mini":
            return httpx.Response(402, json={"error": "Zev credit is used up.", "code": "INSUFFICIENT_CREDITS"})
        if payload["model"] == "expired/model":
            return httpx.Response(401, json={"error": "Your session expired.", "code": "SESSION_EXPIRED"})
        return httpx.Response(
            200,
            json={
                "id": "gen-1",
                "model": "openai/gpt-4.1-nano",
                "choices": [{"message": {"role": "assistant", "content": "billing"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15, "cost": 0.000021},
                "zevqora": {"credits_remaining_usd": 4.9},
            },
        )

    session = platform.set_session(base_url="https://zevqora.example.com", access_token=TOKEN, workspace_id="ws-9")
    provider = OpenRouterProvider(
        api_key=session.access_token,
        base_url=session.completions_base_url,
        site_url=session.base_url,
        extra_headers=session.context_headers(),
        via="platform",
        max_retries=0,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    ok = await provider.complete(
        LLMRequest(model="openai/gpt-4.1-nano", messages=[LLMMessage(role="user", content="hi")])
    )
    assert ok.content == "billing"
    assert ok.cost is not None and ok.cost.cost_usd == pytest.approx(0.000021)
    assert ok.cost.cost_source.value == "provider_reported"
    assert seen["url"] == "https://zevqora.example.com/api/platform/chat/completions"
    assert seen["auth"] == f"Bearer {TOKEN}"
    assert seen["workspace"] == "ws-9"
    assert seen["stream"] is False

    with pytest.raises(ProviderError) as credit_error:
        await provider.complete(
            LLMRequest(model="openai/gpt-4o-mini", messages=[LLMMessage(role="user", content="hi")])
        )
    assert "INSUFFICIENT_CREDITS" in str(credit_error.value)
    assert TOKEN not in str(credit_error.value)

    with pytest.raises(ProviderError) as auth_error:
        await provider.complete(LLMRequest(model="expired/model", messages=[LLMMessage(role="user", content="hi")]))
    assert "Sign in again" in str(auth_error.value)
    await provider.aclose()


def test_pricing_merge_accepts_only_complete_rows(tmp_path: Path):
    snapshot_path = tmp_path / "pricing.json"
    snapshot_path.write_text(
        json.dumps(
            {
                "version": "local_v1",
                "source": "fixture",
                "models": {"mock/test-model": {"provider": "mock", "input_per_million": 1, "output_per_million": 2}},
            }
        ),
        encoding="utf-8",
    )
    snapshot = PricingSnapshot.load(snapshot_path)
    merged = snapshot.merge_rates(
        {
            "openai/gpt-4o-mini": {
                "provider": "openai",
                "input_per_million": 0.15,
                "output_per_million": 0.6,
                "cached_input_per_million": 0.075,
            },
            "broken/model": {"provider": "x", "input_per_million": 1},
            "weird/model": "nope",
        },
        version="model_pricing@2026-09-01",
        source="zevqora_platform",
    )
    assert merged == 1
    assert snapshot.has_verified_rates("openai/gpt-4o-mini")
    assert not snapshot.has_verified_rates("broken/model")
    assert snapshot.has_verified_rates("mock/test-model")
    assert snapshot.version == "local_v1+model_pricing@2026-09-01"
    # A second merge replaces the suffix rather than growing it forever.
    snapshot.merge_rates(
        {"openai/gpt-4o-mini": {"input_per_million": 0.2, "output_per_million": 0.8}},
        version="model_pricing@2026-09-02",
    )
    assert snapshot.version == "local_v1+model_pricing@2026-09-02"
