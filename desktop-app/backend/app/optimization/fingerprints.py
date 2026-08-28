"""Stable fingerprints for task equivalence vs execution configuration.

task_fingerprint: model-independent — proves same task across substitution.
execution_configuration_fingerprint: includes model/provider — proves how it ran.
baseline_evidence_hash: immutable baseline content identity for paid idempotency.
"""

from __future__ import annotations

import json
from typing import Any

from ..core.hashing import sha256_json, sha256_text
from ..db_models import Trace
from ..providers.models import LLMRequest


def _parse_meta(trace: Trace) -> dict[str, Any]:
    if not trace.metadata_json:
        return {}
    try:
        raw = json.loads(trace.metadata_json)
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def task_fingerprint_from_trace(trace: Trace) -> str:
    """Model-independent task identity for baseline ↔ candidate equivalence."""
    snap_json = getattr(trace, "request_snapshot_json", None)
    if snap_json:
        try:
            from ..evidence.replay import ReplayableRequestSnapshot

            snap = ReplayableRequestSnapshot.model_validate_json(snap_json)
            return snap.task_fingerprint()
        except Exception:
            pass
    meta = _parse_meta(trace)
    payload = {
        "input_hash": sha256_text(trace.input_text) or sha256_text(trace.expected_output),
        "symbol": trace.symbol or "",
        "workflow": trace.workflow or "",
        "temperature": meta.get("temperature"),
        "system_prompt_version": meta.get("system_prompt_version") or meta.get("prompt_version"),
        "system_prompt_hash": meta.get("system_prompt_hash") or sha256_text(meta.get("system_prompt")),
        "response_format": meta.get("response_format"),
        "tool_schema_hash": meta.get("tool_schema_hash"),
        "context_id": meta.get("context_id") or meta.get("retrieval_context_id"),
        "model_config": meta.get("model_config") or meta.get("generation_config"),
        "prompt_config_version": meta.get("prompt_config_version") or meta.get("app_prompt_version"),
    }
    return sha256_json(payload)


def task_fingerprint_from_request(request: LLMRequest) -> str:
    """Canonical task identity from an LLMRequest (excludes provider/model)."""
    meta = dict(request.metadata or {})
    messages = []
    for msg in request.messages:
        messages.append(
            {
                "role": msg.role,
                "content": msg.content,
                "name": msg.name,
                "tool_call_id": msg.tool_call_id,
                # tool_calls on assistant messages affect task shape
                "tool_calls": [tc.model_dump() for tc in (msg.tool_calls or [])] or None,
            }
        )
    tools = None
    if request.tools:
        tools = [t.model_dump() for t in request.tools]
    payload = {
        "messages": messages,
        "tools": tools,
        "tool_choice": request.tool_choice if request.tools else None,
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "response_format": meta.get("response_format"),
        "context_id": meta.get("context_id") or meta.get("retrieval_context_id"),
        "workflow": meta.get("workflow"),
        "system_prompt_version": meta.get("system_prompt_version") or meta.get("prompt_version"),
        "prompt_config_version": meta.get("prompt_config_version") or meta.get("app_prompt_version"),
        "model_config": meta.get("model_config") or meta.get("generation_config"),
    }
    return sha256_json(payload)


def execution_configuration_fingerprint(
    *,
    provider: str | None,
    model: str | None,
    temperature: float | None,
    max_tokens: int | None,
    extra: dict[str, Any] | None = None,
) -> str:
    """How the candidate was executed (includes model substitution target)."""
    return sha256_json(
        {
            "provider": provider,
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "extra": extra or {},
        }
    )


def baseline_evidence_hash(traces: list[Trace]) -> str:
    """Immutable baseline evidence identity for execution idempotency.

    Changing content/config hashes changes this key even if Trace IDs are reused.
    Timestamps are intentionally excluded.
    """
    items = []
    for t in sorted(traces, key=lambda x: x.id):
        meta = _parse_meta(t)
        items.append(
            {
                "trace_id": t.id,
                "request_id": t.request_id,
                "input_hash": t.input_hash or sha256_text(t.input_text),
                "output_hash": t.output_hash or sha256_text(t.output_text),
                "task_fingerprint": task_fingerprint_from_trace(t),
                "provider": t.provider,
                "model": t.model or t.requested_model,
                "symbol": t.symbol,
                "workflow": t.workflow,
                "protected": t.protected,
                "system_prompt_version": meta.get("system_prompt_version") or meta.get("prompt_version"),
                "tool_schema_hash": meta.get("tool_schema_hash"),
                "context_id": meta.get("context_id") or meta.get("retrieval_context_id"),
                "response_format": meta.get("response_format"),
            }
        )
    return sha256_json(items)
