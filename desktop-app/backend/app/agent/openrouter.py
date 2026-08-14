from __future__ import annotations

import json
from typing import Any

import httpx
from sqlalchemy.orm import Session

from ..config import settings
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


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


async def run_openrouter_agent(
    db: Session,
    *,
    product_id: str | None,
    history: list[dict[str, str]],
    model: str | None,
) -> tuple[str, str, list[ToolEvent]]:
    chosen_model = model or settings.agent_model
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    if product_id:
        messages.append(
            {
                "role": "system",
                "content": f"The currently selected ZEVQORA product_id is {product_id}. Use it for tools unless the user explicitly changes product.",
            }
        )

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "X-Title": "ZEVQORA Desktop",
    }
    tool_events: list[ToolEvent] = []

    async with httpx.AsyncClient(timeout=90.0) as client:
        for _ in range(settings.agent_max_steps):
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers=headers,
                json={
                    "model": chosen_model,
                    "messages": messages,
                    "tools": TOOL_DEFINITIONS,
                    "tool_choice": "auto",
                    "temperature": 0.2,
                },
            )
            if response.status_code >= 400:
                detail = response.text[:600]
                raise RuntimeError(f"OpenRouter request failed ({response.status_code}): {detail}")
            data = response.json()
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("OpenRouter returned no choices.")
            message = choices[0].get("message") or {}
            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                return _content_text(message.get("content")) or "I finished the analysis but received no text response.", chosen_model, tool_events

            messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content"),
                    "tool_calls": tool_calls,
                }
            )
            for call in tool_calls:
                fn = call.get("function") or {}
                name = fn.get("name") or "unknown"
                try:
                    raw_args = fn.get("arguments") or "{}"
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    if product_id:
                        # Product context is selected by the desktop UI, not by model-generated arguments.
                        # Always override it so a tool call cannot cross into another connected workspace.
                        args["product_id"] = product_id
                    result, summary = execute_tool(db, name, args)
                    tool_events.append(ToolEvent(name=name, status="done", summary=summary))
                except Exception as exc:
                    result = json.dumps({"error": str(exc)})
                    tool_events.append(ToolEvent(name=name, status="error", summary=str(exc)))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id"),
                        "name": name,
                        "content": result,
                    }
                )

    return "I reached the tool-step limit. Ask me to continue from the evidence already collected.", chosen_model, tool_events
