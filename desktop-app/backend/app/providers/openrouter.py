from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx

from ..core.config import settings
from ..core.errors import ProviderError, ProviderTimeoutError
from ..core.logging import get_logger
from .base import LLMProvider
from .models import (
    FinishReason,
    LLMMessage,
    LLMRequest,
    LLMResponse,
    LLMUsage,
    ToolCall,
)
from .pricing import get_pricing_snapshot

logger = get_logger(__name__)

# Retry semantics (documented):
# - Retry only on TimeoutException, HTTP 429, and HTTP 5xx before a successful body parse.
# - Do NOT retry after a 2xx response was received (even if JSON parse fails later).
# - Bounded by provider_max_retries. Exponential backoff capped at 8s.
# - We never assume a timed-out POST did not complete; retries may duplicate paid work
#   on pure network timeouts — keep max_retries small and prefer idempotent tooling.


class OpenRouterProvider(LLMProvider):
    name = "openrouter"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        site_url: str | None = None,
        max_retries: int | None = None,
        timeout_seconds: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else settings.openrouter_api_key
        self.base_url = (base_url or settings.openrouter_base_url).rstrip("/")
        self.site_url = site_url or settings.openrouter_site_url
        self.max_retries = max_retries if max_retries is not None else settings.provider_max_retries
        self.default_timeout = timeout_seconds if timeout_seconds is not None else settings.provider_timeout_seconds
        self.pricing = get_pricing_snapshot()
        self._client = client
        self._owns_client = client is None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.default_timeout)
            self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ProviderError("OPENROUTER_API_KEY is not configured.")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": self.site_url,
            "X-Title": "ZEVQORA Desktop",
        }

    @staticmethod
    def _message_payload(messages: list[LLMMessage]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for msg in messages:
            item: dict[str, Any] = {"role": msg.role}
            if msg.content is not None:
                item["content"] = msg.content
            if msg.name:
                item["name"] = msg.name
            if msg.tool_call_id:
                item["tool_call_id"] = msg.tool_call_id
            if msg.tool_calls:
                item["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                    }
                    for tc in msg.tool_calls
                ]
            out.append(item)
        return out

    @staticmethod
    def _parse_usage(raw: dict[str, Any] | None) -> LLMUsage:
        if not raw:
            return LLMUsage()
        input_tokens = int(raw.get("prompt_tokens") or raw.get("input_tokens") or 0)
        output_tokens = int(raw.get("completion_tokens") or raw.get("output_tokens") or 0)
        cached = 0
        details = raw.get("prompt_tokens_details") or raw.get("input_tokens_details") or {}
        if isinstance(details, dict):
            cached = int(details.get("cached_tokens") or 0)
        reasoning = int(raw.get("reasoning_tokens") or 0)
        completion_details = raw.get("completion_tokens_details") or {}
        if isinstance(completion_details, dict) and not reasoning:
            reasoning = int(completion_details.get("reasoning_tokens") or 0)
        total = int(raw.get("total_tokens") or (input_tokens + output_tokens))
        return LLMUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached,
            reasoning_tokens=reasoning,
            total_tokens=total,
        )

    @staticmethod
    def _parse_tool_calls(message: dict[str, Any]) -> list[ToolCall]:
        calls: list[ToolCall] = []
        for item in message.get("tool_calls") or []:
            fn = item.get("function") or {}
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {"raw": raw_args}
            calls.append(
                ToolCall(
                    id=str(item.get("id") or ""),
                    name=str(fn.get("name") or "unknown"),
                    arguments=args if isinstance(args, dict) else {"raw": args},
                )
            )
        return calls

    @staticmethod
    def _content_text(content: Any) -> str | None:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text") or item.get("content")
                    if isinstance(text, str):
                        parts.append(text)
            return "\n".join(parts) if parts else None
        return None

    @staticmethod
    def _provider_cost(body: dict[str, Any]) -> float | None:
        for key in ("total_cost", "cost"):
            value = body.get(key)
            if isinstance(value, (int, float)):
                return float(value)
        usage = body.get("usage") or {}
        if isinstance(usage, dict):
            for key in ("total_cost", "cost"):
                value = usage.get(key)
                if isinstance(value, (int, float)):
                    return float(value)
        return None

    def _bound_metadata(self, meta: dict[str, Any]) -> dict[str, Any]:
        raw = json.dumps(meta, ensure_ascii=False, default=str)
        limit = settings.max_raw_metadata_bytes
        if len(raw.encode("utf-8")) <= limit:
            return meta
        return {"truncated": True, "keys": sorted(meta.keys())}

    async def complete(self, request: LLMRequest) -> LLMResponse:
        timeout = request.timeout_seconds or self.default_timeout
        client = self._ensure_client()
        payload: dict[str, Any] = {
            "model": request.model,
            "messages": self._message_payload(request.messages),
            "temperature": request.temperature,
        }
        if request.tools:
            payload["tools"] = [t.model_dump() for t in request.tools]
            payload["tool_choice"] = request.tool_choice or "auto"
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens

        last_error: Exception | None = None
        retry_reason: str | None = None
        for attempt in range(1, self.max_retries + 2):
            started = time.perf_counter()
            try:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                last_error = ProviderTimeoutError(f"OpenRouter timed out after {timeout}s")
                retry_reason = "timeout"
                if attempt > self.max_retries:
                    raise last_error from exc
                await asyncio.sleep(min(2 ** (attempt - 1), 8))
                continue
            except httpx.HTTPError as exc:
                raise ProviderError(f"OpenRouter HTTP error: {exc}") from exc

            latency_ms = (time.perf_counter() - started) * 1000.0

            if response.status_code == 429 and attempt <= self.max_retries:
                retry_reason = "http_429"
                await asyncio.sleep(min(2 ** attempt, 8))
                continue
            if response.status_code >= 500 and attempt <= self.max_retries:
                retry_reason = f"http_{response.status_code}"
                last_error = ProviderError(f"OpenRouter server error {response.status_code}")
                await asyncio.sleep(min(2 ** attempt, 8))
                continue
            if response.status_code >= 400:
                # Do not include Authorization; response.text is provider error body only.
                raise ProviderError(
                    f"OpenRouter request failed ({response.status_code}): {response.text[:600]}"
                )

            # Successful HTTP response: never retry from here (paid work may have completed).
            body = response.json()
            choices = body.get("choices") or []
            if not choices:
                raise ProviderError("OpenRouter returned no choices.")
            message = choices[0].get("message") or {}
            usage = self._parse_usage(body.get("usage"))
            resolved_model = body.get("model") or request.model
            provider_cost = self._provider_cost(body)
            cost = self.pricing.resolve_cost(
                provider=self.name,
                model=resolved_model,
                usage=usage,
                provider_cost_usd=provider_cost,
            )
            finish_raw = choices[0].get("finish_reason") or "unknown"
            try:
                finish = FinishReason(finish_raw)
            except ValueError:
                finish = FinishReason.UNKNOWN

            tool_calls = self._parse_tool_calls(message)
            if tool_calls and finish == FinishReason.UNKNOWN:
                finish = FinishReason.TOOL_CALLS

            raw_meta = self._bound_metadata(
                {
                    "id": body.get("id"),
                    "system_fingerprint": body.get("system_fingerprint"),
                }
            )
            logger.info(
                "provider.complete",
                extra={
                    "provider": self.name,
                    "model": resolved_model,
                    "request_id": body.get("id"),
                },
            )
            return LLMResponse(
                provider=self.name,
                requested_model=request.model,
                resolved_model=resolved_model,
                content=self._content_text(message.get("content")),
                tool_calls=tool_calls,
                usage=usage,
                cost=cost,
                latency_ms=latency_ms,
                finish_reason=finish,
                provider_request_id=body.get("id"),
                attempt=attempt,
                retry_reason=retry_reason if attempt > 1 else None,
                raw_metadata={k: v for k, v in raw_meta.items() if v is not None},
                is_mock=False,
            )

        raise last_error or ProviderError("OpenRouter request failed after retries.")
