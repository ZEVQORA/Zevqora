import json

import pytest

from app.agent import openrouter


class FakeResponse:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, *args, **kwargs):
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        self.calls += 1
        if self.calls == 1:
            return FakeResponse(
                {
                    "choices": [
                        {
                            "message": {
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "call-1",
                                        "type": "function",
                                        "function": {
                                            "name": "workspace_summary",
                                            "arguments": json.dumps({"product_id": "model-supplied-other-product"}),
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                }
            )
        return FakeResponse({"choices": [{"message": {"content": "Done."}}]})


@pytest.mark.asyncio
async def test_selected_product_overrides_model_tool_argument(monkeypatch):
    seen = {}

    def fake_execute_tool(db, name, args):
        seen.update(args)
        return json.dumps({"ok": True}), "ok"

    monkeypatch.setattr(openrouter.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(openrouter, "execute_tool", fake_execute_tool)

    message, _, events = await openrouter.run_openrouter_agent(
        object(),
        product_id="selected-product",
        history=[{"role": "user", "content": "inspect"}],
        model="openrouter/auto",
    )
    assert message == "Done."
    assert events
    assert seen["product_id"] == "selected-product"
