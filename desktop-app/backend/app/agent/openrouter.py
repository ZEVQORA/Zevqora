from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..config import settings
from ..core.errors import ProviderError
from ..providers.factory import get_provider
from ..providers.models import LLMMessage, LLMRequest, ToolDefinition
from ..schemas import ToolEvent
from .tools import TOOL_DEFINITIONS, execute_tool

SYSTEM_PROMPT = """You are Zev, the conversational interface to ZEVQORA, an AI Cost Optimization Engineer for AI products.
Your job is to explain evidence, diagnose likely AI COGS waste, and help the user run controlled verification.

Hard rules:
- ZEVQORA is not a generic model router, gateway, cache product, or chatbot.
- Static code findings are potential signals only. Never call them Verified Savings.
- Only an experiment whose deterministic gates returned status VERIFIED may be described as verified.
- If runtime/replay evidence is missing, say exactly what evidence is missing.
- Prefer workload, task success, quality, latency, retries, duplicate work, context/RAG/agent behavior, and cost-per-successful-task over model-price trivia.
- Never claim zero quality loss, guaranteed savings, or production safety without evidence.
- Source access is read-only through controlled tools. Do not ask for or expose secrets.
- Human approval is mandatory before risky implementation, merge, or deployment.
- Be concise, technical, and understandable to a founder or engineer.
"""


def _tool_definitions() -> list[ToolDefinition]:
    return [ToolDefinition.model_validate(item) for item in TOOL_DEFINITIONS]


async def run_openrouter_agent(
    db: Session,
    *,
    product_id: str | None,
    history: list[dict[str, str]],
    model: str | None,
    provider_name: str | None = None,
) -> tuple[str, str, list[ToolEvent]]:
    """Zev tool-loop orchestration. Provider HTTP lives in providers/openrouter.py."""
    chosen_model = model or settings.agent_model
    provider = get_provider(provider_name)

    messages: list[LLMMessage] = [LLMMessage(role="system", content=SYSTEM_PROMPT)]
    messages.extend(LLMMessage(role=item["role"], content=item["content"]) for item in history)
    if product_id:
        messages.append(
            LLMMessage(
                role="system",
                content=(
                    f"The currently selected ZEVQORA product_id is {product_id}. "
                    "Use it for tools unless the user explicitly changes product."
                ),
            )
        )

    tool_events: list[ToolEvent] = []

    for _ in range(settings.agent_max_steps):
        request = LLMRequest(
            provider=provider.name,
            model=chosen_model,
            messages=messages,
            tools=_tool_definitions(),
            tool_choice="auto",
            temperature=0.2,
        )
        try:
            response = await provider.complete(request)
        except ProviderError as exc:
            raise RuntimeError(str(exc)) from exc

        resolved_model = response.resolved_model or chosen_model
        if not response.tool_calls:
            return (
                response.content or "I finished the analysis but received no text response.",
                resolved_model,
                tool_events,
            )

        messages.append(
            LLMMessage(
                role="assistant",
                content=response.content,
                tool_calls=response.tool_calls,
            )
        )
        for call in response.tool_calls:
            name = call.name
            args = dict(call.arguments)
            try:
                if product_id:
                    # Product context is selected by the desktop UI, not by model-generated arguments.
                    args["product_id"] = product_id
                result, summary = execute_tool(db, name, args)
                tool_events.append(ToolEvent(name=name, status="done", summary=summary))
            except Exception as exc:
                result = json.dumps({"error": str(exc)})
                tool_events.append(ToolEvent(name=name, status="error", summary=str(exc)))
            messages.append(
                LLMMessage(
                    role="tool",
                    content=result,
                    name=name,
                    tool_call_id=call.id,
                )
            )

    return (
        "I reached the tool-step limit. Ask me to continue from the evidence already collected.",
        chosen_model,
        tool_events,
    )
