"""Immutable replayable LLM request snapshots for faithful benchmark replay."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ..core.hashing import sha256_json
from ..providers.models import LLMMessage, LLMRequest, ToolDefinition

CAPTURE_VERSION = "replay_v1"


class ReplayableRequestSnapshot(BaseModel):
    """Provider-independent normalized request preserved for substitution replay.

    Excludes credentials. Immutable once attached to benchmark/baseline evidence.
    """

    capture_version: str = CAPTURE_VERSION
    messages: list[LLMMessage]
    tools: list[ToolDefinition] | None = None
    tool_choice: str | dict[str, Any] | None = "auto"
    temperature: float = 0.0
    max_tokens: int | None = None
    timeout_seconds: float | None = None
    response_format: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_case_id: str | None = None
    workflow: str | None = None
    symbol: str | None = None

    def snapshot_hash(self) -> str:
        return sha256_json(self.canonical_payload())

    def task_fingerprint(self) -> str:
        # Imported here: optimization imports this module, so a module-level
        # import would make whichever package loads first fail.
        from ..optimization.fingerprints import task_fingerprint_from_request

        return task_fingerprint_from_request(self.to_llm_request(provider="replay", model="task-only"))

    def canonical_payload(self) -> dict[str, Any]:
        return {
            "capture_version": self.capture_version,
            "messages": [m.model_dump(exclude_none=True) for m in self.messages],
            "tools": [t.model_dump(exclude_none=True) for t in self.tools] if self.tools else None,
            "tool_choice": self.tool_choice if self.tools else None,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timeout_seconds": self.timeout_seconds,
            "response_format": self.response_format,
            "metadata": self.metadata,
            "workflow": self.workflow,
            "symbol": self.symbol,
            "source_case_id": self.source_case_id,
        }

    def to_llm_request(self, *, provider: str, model: str) -> LLMRequest:
        meta = dict(self.metadata or {})
        if self.response_format is not None:
            meta.setdefault("response_format", self.response_format)
        if self.workflow:
            meta.setdefault("workflow", self.workflow)
        if self.symbol:
            meta.setdefault("symbol", self.symbol)
        return LLMRequest(
            provider=provider,
            model=model,
            messages=list(self.messages),
            tools=list(self.tools) if self.tools else None,
            tool_choice=self.tool_choice,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            timeout_seconds=self.timeout_seconds,
            metadata=meta,
        )

    @classmethod
    def from_llm_request(cls, request: LLMRequest, *, source_case_id: str | None = None) -> ReplayableRequestSnapshot:
        meta = dict(request.metadata or {})
        return cls(
            messages=list(request.messages),
            tools=list(request.tools) if request.tools else None,
            tool_choice=request.tool_choice,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            timeout_seconds=request.timeout_seconds,
            response_format=meta.get("response_format"),
            metadata={k: v for k, v in meta.items() if k != "response_format"},
            source_case_id=source_case_id,
            workflow=meta.get("workflow"),
            symbol=meta.get("symbol"),
        )

    @classmethod
    def from_trace_legacy(cls, *, input_text: str, metadata: dict[str, Any] | None = None) -> ReplayableRequestSnapshot:
        """Best-effort legacy reconstruction when no snapshot was captured."""
        meta = dict(metadata or {})
        messages: list[LLMMessage] = []
        system = meta.get("system_prompt") or meta.get("system_message")
        if system:
            messages.append(LLMMessage(role="system", content=str(system)))
        messages.append(LLMMessage(role="user", content=input_text))
        return cls(
            messages=messages,
            temperature=float(meta.get("temperature", 0.0)),
            max_tokens=meta.get("max_tokens"),
            response_format=meta.get("response_format"),
            metadata=meta,
            workflow=meta.get("workflow"),
            symbol=meta.get("symbol"),
        )
