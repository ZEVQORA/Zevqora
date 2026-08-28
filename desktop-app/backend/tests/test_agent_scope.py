from __future__ import annotations

import json

import pytest

from app.agent import openrouter
from app.providers.factory import reset_providers_for_tests
from app.providers.mock import MockProvider
from app.providers.models import FinishReason, LLMResponse, ToolCall


@pytest.mark.asyncio
async def test_selected_product_overrides_model_tool_argument(monkeypatch):
    seen: dict = {}
    reset_providers_for_tests()

    def fake_execute_tool(db, name, args):
        seen.update(args)
        return json.dumps({"ok": True}), "ok"

    mock = MockProvider(
        tool_response=[
            ToolCall(
                id="call-1",
                name="workspace_summary",
                arguments={"product_id": "model-supplied-other-product"},
            )
        ],
    )
    original_complete = mock.complete
    calls = {"n": 0}

    async def sequential_complete(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return await original_complete(request)
        return LLMResponse(
            provider="mock",
            requested_model=request.model,
            resolved_model=request.model,
            content="Done.",
            finish_reason=FinishReason.STOP,
            is_mock=True,
        )

    mock.complete = sequential_complete  # type: ignore[method-assign]

    monkeypatch.setattr(openrouter, "get_provider", lambda name=None: mock)
    monkeypatch.setattr(openrouter, "execute_tool", fake_execute_tool)

    message, _, events = await openrouter.run_openrouter_agent(
        object(),
        product_id="selected-product",
        history=[{"role": "user", "content": "inspect"}],
        model="openrouter/auto",
        provider_name="mock",
    )
    assert message == "Done."
    assert events
    assert seen["product_id"] == "selected-product"
