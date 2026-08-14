from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..config import settings
from ..schemas import AgentChatResponse, ToolEvent
from .openrouter import run_openrouter_agent
from .tools import execute_tool


async def chat(
    db: Session,
    *,
    product_id: str | None,
    history: list[dict[str, str]],
    model: str | None,
) -> AgentChatResponse:
    if settings.openrouter_api_key:
        message, chosen_model, events = await run_openrouter_agent(
            db,
            product_id=product_id,
            history=history,
            model=model,
        )
        return AgentChatResponse(
            message=message,
            model=chosen_model,
            provider="openrouter",
            tool_events=events,
            openrouter_configured=True,
        )

    latest = history[-1]["content"].lower() if history else ""
    events: list[ToolEvent] = []
    if product_id and any(word in latest for word in ("scan", "audit", "inspect")):
        result, summary = execute_tool(db, "scan_workspace", {"product_id": product_id})
        payload = json.loads(result)
        events.append(ToolEvent(name="scan_workspace", status="done", summary=summary))
        text = (
            f"Read-only scan complete: {payload['files_scanned']} source files, "
            f"{payload['ai_calls']} AI call sites, {payload['findings']} potential findings. "
            "These are signals only; import runtime/replay evidence before calling any saving verified."
        )
    elif product_id and any(word in latest for word in ("waste", "finding", "opportun")):
        result, summary = execute_tool(db, "list_findings", {"product_id": product_id})
        rows = json.loads(result)
        events.append(ToolEvent(name="list_findings", status="done", summary=summary))
        if rows:
            text = "Potential findings:\n" + "\n".join(f"- {r['title']} — {r['file']}:{r['line']} ({r['evidence_status']})" for r in rows[:8])
        else:
            text = "No findings yet. Run a workspace scan first."
    elif product_id and any(word in latest for word in ("cost", "spend", "saving", "econom")):
        result, summary = execute_tool(db, "economics_summary", {"product_id": product_id})
        row = json.loads(result)
        events.append(ToolEvent(name="economics_summary", status="done", summary=summary))
        text = (
            f"Runtime evidence: {row['trace_count']} traces. Observed cost: {row['observed_cost_usd']}. "
            f"Verified replay savings: {row['verified_savings_usd']}. {row['note']}"
        )
    else:
        text = (
            "Zev is ready, but OpenRouter is not configured. Set OPENROUTER_API_KEY in the backend process to enable full conversational reasoning. "
            "Without a key I can still run explicit local actions: ask me to 'scan this product', 'show findings', or 'show spend'."
        )

    return AgentChatResponse(
        message=text,
        model="local-controlled-tools",
        provider="local",
        tool_events=events,
        openrouter_configured=False,
    )
