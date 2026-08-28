import pytest

from app.core.errors import PricingUnavailableError
from app.providers.mock import MockProvider
from app.providers.models import CostSource, FinishReason, LLMMessage, LLMRequest, LLMUsage
from app.providers.openrouter import OpenRouterProvider
from app.providers.pricing import PricingSnapshot, reset_pricing_snapshot_cache


@pytest.fixture(autouse=True)
def _reset_pricing(tmp_path, monkeypatch):
    snapshot = tmp_path / "pricing.json"
    snapshot.write_text(
        """{
          "version": "test_snap_v1",
          "retrieved_at": "2026-08-27T00:00:00Z",
          "source": "test_fixture",
          "models": {
            "mock/test-model": {
              "provider": "mock",
              "input_per_million": 1.0,
              "output_per_million": 2.0,
              "cached_input_per_million": 0.1
            }
          }
        }""",
        encoding="utf-8",
    )
    monkeypatch.setenv("ZEVQORA_PRICING_SNAPSHOT", str(snapshot))
    # Reload settings path via pricing cache reset + explicit load in tests
    reset_pricing_snapshot_cache()
    yield
    reset_pricing_snapshot_cache()


@pytest.mark.asyncio
async def test_mock_provider_deterministic():
    provider = MockProvider(
        responses={"hello": "world"},
        usage=LLMUsage(input_tokens=10, output_tokens=5, total_tokens=15),
        provider_cost_usd=0.001,
    )
    response = await provider.complete(
        LLMRequest(model="mock/test-model", messages=[LLMMessage(role="user", content="hello")])
    )
    assert response.content == "world"
    assert response.is_mock is True
    assert response.raw_metadata.get("provenance") == "mock_test_only"
    assert response.usage.input_tokens == 10
    assert response.cost is not None
    assert response.cost.cost_source == CostSource.PROVIDER_REPORTED
    assert response.cost.cost_usd == pytest.approx(0.001)


@pytest.mark.asyncio
async def test_mock_provider_tool_calls():
    from app.providers.models import ToolCall

    provider = MockProvider(tool_response=[ToolCall(id="1", name="scan_workspace", arguments={"product_id": "x"})])
    response = await provider.complete(
        LLMRequest(model="mock/test-model", messages=[LLMMessage(role="user", content="scan")])
    )
    assert response.tool_calls[0].name == "scan_workspace"
    assert response.content is None
    assert response.finish_reason == FinishReason.TOOL_CALLS


def test_pricing_estimate_exact_model(tmp_path):
    path = tmp_path / "p.json"
    path.write_text(
        '{"version":"v1","models":{"demo/m":{"input_per_million":1.0,"output_per_million":2.0}}}',
        encoding="utf-8",
    )
    snap = PricingSnapshot.load(path)
    usage = LLMUsage(input_tokens=1_000_000, output_tokens=500_000)
    cost = snap.estimate_cost(provider="mock", model="demo/m", usage=usage)
    assert cost.cost_source == CostSource.PRICING_SNAPSHOT_ESTIMATE
    assert cost.pricing_version == "v1"
    assert cost.cost_usd == pytest.approx(2.0)


def test_pricing_unknown_model_unavailable(tmp_path):
    path = tmp_path / "p.json"
    path.write_text('{"version":"v1","models":{}}', encoding="utf-8")
    snap = PricingSnapshot.load(path)
    with pytest.raises(PricingUnavailableError):
        snap.estimate_cost(provider="x", model="unknown/model", usage=LLMUsage(input_tokens=10, output_tokens=1))


def test_resolve_cost_provider_reported_priority(tmp_path):
    path = tmp_path / "p.json"
    path.write_text(
        '{"version":"v1","models":{"demo/m":{"input_per_million":1.0,"output_per_million":2.0}}}',
        encoding="utf-8",
    )
    snap = PricingSnapshot.load(path)
    cost = snap.resolve_cost(
        provider="openrouter",
        model="demo/m",
        usage=LLMUsage(input_tokens=100, output_tokens=50),
        provider_cost_usd=0.0042,
    )
    assert cost.cost_source == CostSource.PROVIDER_REPORTED
    assert cost.cost_usd == pytest.approx(0.0042)
    assert cost.pricing_version is None
    assert cost.provider_metadata_version == "v1"


def test_resolve_cost_unknown_returns_none(tmp_path):
    path = tmp_path / "p.json"
    path.write_text('{"version":"v1","models":{}}', encoding="utf-8")
    snap = PricingSnapshot.load(path)
    cost = snap.resolve_cost(
        provider="openrouter",
        model="unknown/model",
        usage=LLMUsage(input_tokens=10, output_tokens=1),
        provider_cost_usd=None,
    )
    assert cost.cost_usd is None
    assert cost.cost_source is None


def test_openrouter_parses_usage_and_cost_without_network():
    usage = OpenRouterProvider._parse_usage(
        {
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "total_tokens": 120,
            "prompt_tokens_details": {"cached_tokens": 40},
            "completion_tokens_details": {"reasoning_tokens": 5},
            "cost": 0.0123,
        }
    )
    assert usage.input_tokens == 100
    assert usage.output_tokens == 20
    assert usage.cached_input_tokens == 40
    assert usage.reasoning_tokens == 5
    assert OpenRouterProvider._provider_cost({"usage": {"cost": 0.0123}}) == pytest.approx(0.0123)


# ---------------------------------------------------------------------------
# Cost-integrity regressions.
#
# Each test below fails against the pre-hardening code. They encode the single
# invariant the product's cost claims rest on: an unmeasured call must never be
# priced, and must never be reported as $0.00.
# ---------------------------------------------------------------------------


def _snap(tmp_path, models='{"demo/m":{"input_per_million":1.0,"output_per_million":2.0}}'):
    path = tmp_path / "p.json"
    path.write_text(f'{{"version":"v1","models":{models}}}', encoding="utf-8")
    return PricingSnapshot.load(path)


def test_missing_usage_block_is_unpriced_not_free(tmp_path):
    """A 2xx response with no usage block is unmeasured, not free."""
    usage = OpenRouterProvider._parse_usage(None)
    assert usage.input_tokens is None
    assert usage.output_tokens is None

    cost = _snap(tmp_path).resolve_cost(provider="openrouter", model="demo/m", usage=usage, provider_cost_usd=None)
    assert cost.cost_usd is None, "unreported tokens must not be priced as $0.00"
    assert cost.cost_source is None


def test_partial_usage_is_unpriced(tmp_path):
    """prompt_tokens present but completion_tokens null must not price output at $0."""
    usage = OpenRouterProvider._parse_usage({"prompt_tokens": 512, "completion_tokens": None})
    assert usage.input_tokens == 512
    assert usage.output_tokens is None
    with pytest.raises(PricingUnavailableError):
        _snap(tmp_path).estimate_cost(provider="openrouter", model="demo/m", usage=usage)


def test_genuine_zero_tokens_preserved_not_treated_as_missing():
    """A reported 0 is a measurement and must survive the presence check."""
    usage = OpenRouterProvider._parse_usage({"prompt_tokens": 0, "completion_tokens": 0})
    assert usage.input_tokens == 0
    assert usage.output_tokens == 0
    assert usage.total_tokens == 0


def test_reasoning_tokens_are_not_double_charged(tmp_path):
    """reasoning_tokens is a subset of completion_tokens, not an addition to it."""
    snap = _snap(tmp_path)
    with_reasoning = snap.estimate_cost(
        provider="openrouter",
        model="demo/m",
        usage=LLMUsage(input_tokens=0, output_tokens=20, reasoning_tokens=5),
    )
    without_reasoning = snap.estimate_cost(
        provider="openrouter",
        model="demo/m",
        usage=LLMUsage(input_tokens=0, output_tokens=20, reasoning_tokens=0),
    )
    assert with_reasoning.cost_usd == pytest.approx(without_reasoning.cost_usd)
    # 20 output tokens at $2/M — not 25.
    assert with_reasoning.cost_usd == pytest.approx(20 / 1_000_000.0 * 2.0)


def test_boolean_cost_field_is_not_one_dollar():
    """bool is a subclass of int: `"cost": true` must not become $1.00."""
    assert OpenRouterProvider._provider_cost({"cost": True}) is None
    assert OpenRouterProvider._provider_cost({"usage": {"cost": True}}) is None


def test_zero_provider_cost_does_not_become_provider_reported(tmp_path):
    """A reported 0.0 is an accounting placeholder, not an authoritative measurement."""
    cost = _snap(tmp_path).resolve_cost(
        provider="openrouter",
        model="demo/m",
        usage=LLMUsage(input_tokens=100, output_tokens=50),
        provider_cost_usd=0.0,
    )
    assert cost.cost_source == CostSource.PRICING_SNAPSHOT_ESTIMATE
    assert cost.cost_usd == pytest.approx(100 / 1_000_000.0 * 1.0 + 50 / 1_000_000.0 * 2.0)


def test_unavailable_pricing_claims_no_pricing_version(tmp_path):
    """No arithmetic happened, so no pricing_version may be asserted."""
    cost = _snap(tmp_path, models="{}").resolve_cost(
        provider="openrouter",
        model="unknown/model",
        usage=LLMUsage(input_tokens=10, output_tokens=1),
        provider_cost_usd=None,
    )
    assert cost.cost_usd is None
    assert cost.pricing_version is None
    assert cost.provider_metadata_version == "v1"


@pytest.mark.asyncio
async def test_mock_does_not_fabricate_cost_or_borrow_fixture_rates():
    """MockProvider must not price a real model with the mock fixture's rates."""
    provider = MockProvider(usage=LLMUsage(input_tokens=10, output_tokens=5))
    response = await provider.complete(
        LLMRequest(model="openai/gpt-4o", messages=[LLMMessage(role="user", content="hi")])
    )
    assert response.is_mock is True
    assert response.cost is not None
    assert response.cost.cost_usd is None, "unpriced model must not inherit mock/test-model rates"
    assert response.cost.input_rate_per_million is None
