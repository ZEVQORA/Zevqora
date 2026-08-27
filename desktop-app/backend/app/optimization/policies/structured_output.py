"""Structured output contract validation for bounded routing.

Version structured_output_v1.0.0 — product capability, not benchmark-specific.
Validates JSON/object responses against a runtime schema derived from task metadata
or request text contracts. Never inspects expected answers, graders, or case IDs.
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, Field

STRUCTURED_OUTPUT_VERSION = "structured_output_v1.0.0"

_JSON_OBJECT_HINT = re.compile(r"(?i)reply with only a json object|emit json|json object|json with")
_FIELD_PAIR = re.compile(r"(?i)(?:json with|fields?:?|keys?:?)\s+([a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)+)")
_EMIT_FIELDS = re.compile(r"(?i)emit json with\s+([a-z0-9_]+(?:\s+and\s+[a-z0-9_]+)+)")


class OutputContract(BaseModel):
    kind: str = "json_object"  # json_object | labels | none
    required_fields: list[str] = Field(default_factory=list)
    properties: dict[str, dict[str, Any]] = Field(default_factory=dict)
    allowed_labels: list[str] | None = None
    source: str = "none"  # envelope | text_contract | labels | none


class ValidationResult(BaseModel):
    ok: bool
    reason: str | None = None
    normalized_text: str | None = None
    parsed: dict[str, Any] | None = None
    validator_version: str = STRUCTURED_OUTPUT_VERSION


def derive_output_contract(
    *,
    user_text: str = "",
    metadata: dict[str, Any] | None = None,
    allowed_labels: list[str] | None = None,
) -> OutputContract:
    """Derive contract from task envelope / request text only."""
    meta = metadata or {}
    schema = meta.get("output_schema") or meta.get("response_schema")
    if isinstance(schema, dict) and (
        schema.get("required") or schema.get("properties") or schema.get("required_fields")
    ):
        required = list(schema.get("required") or schema.get("required_fields") or [])
        props = dict(schema.get("properties") or {k: {"type": "string"} for k in required})
        return OutputContract(
            kind="json_object",
            required_fields=required,
            properties=props,
            source="envelope",
        )

    if allowed_labels:
        return OutputContract(kind="labels", allowed_labels=list(allowed_labels), source="labels")

    text = user_text or ""
    if _JSON_OBJECT_HINT.search(text):
        fields: list[str] = []
        m = _EMIT_FIELDS.search(text)
        if m:
            raw = m.group(1).replace(" and ", ",")
            fields = [p.strip() for p in raw.split(",") if p.strip()]
        if not fields:
            m2 = _FIELD_PAIR.search(text)
            if m2:
                fields = [p.strip() for p in m2.group(1).split(",") if p.strip()]
        # Common pattern: "JSON with origin and evidence_status"
        if not fields:
            m3 = re.search(
                r"(?i)json with\s+([a-z0-9_]+)\s+and\s+([a-z0-9_]+)",
                text,
            )
            if m3:
                fields = [m3.group(1), m3.group(2)]
        if fields:
            return OutputContract(
                kind="json_object",
                required_fields=fields,
                properties={k: {"type": "string"} for k in fields},
                source="text_contract",
            )
        return OutputContract(kind="json_object", required_fields=[], source="text_contract")

    return OutputContract(kind="none", source="none")


def _extract_json_object(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else None
    except json.JSONDecodeError:
        # Attempt first {...} slice
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                val = json.loads(raw[start : end + 1])
                return val if isinstance(val, dict) else None
            except json.JSONDecodeError:
                return None
        return None


def validate_structured_output(text: str | None, contract: OutputContract) -> ValidationResult:
    if contract.kind == "none":
        return ValidationResult(ok=True, normalized_text=text)

    if contract.kind == "labels":
        from .bounded_routing import parse_label_output

        label = parse_label_output(text, contract.allowed_labels)
        if label is None:
            return ValidationResult(ok=False, reason="invalid_label")
        return ValidationResult(ok=True, normalized_text=label)

    # json_object
    parsed = _extract_json_object(text or "")
    if parsed is None:
        return ValidationResult(ok=False, reason="object_required")
    missing = [f for f in contract.required_fields if f not in parsed]
    if missing:
        return ValidationResult(ok=False, reason=f"missing_fields:{','.join(missing)}", parsed=parsed)
    # Basic type checks when properties declare type=string
    for key, prop in contract.properties.items():
        if key not in parsed:
            continue
        if prop.get("type") == "string" and not isinstance(parsed[key], str):
            return ValidationResult(ok=False, reason=f"type_mismatch:{key}", parsed=parsed)
    normalized = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return ValidationResult(ok=True, normalized_text=normalized, parsed=parsed)


def structured_system_instruction(contract: OutputContract) -> str:
    if contract.kind == "labels" and contract.allowed_labels:
        return (
            "You are a constrained ZEVQORA classifier. "
            "Reply with ONLY the exact label/token from: "
            + ", ".join(contract.allowed_labels)
            + ". No explanation. No punctuation. No extra words."
        )
    if contract.kind == "json_object":
        fields = ", ".join(contract.required_fields) if contract.required_fields else "the required keys"
        return (
            "You are a constrained ZEVQORA structured emitter. "
            f"Reply with ONLY a single JSON object containing keys: {fields}. "
            "No markdown fences. No explanation. Values must be JSON strings/numbers/booleans as appropriate."
        )
    return (
        "You are a constrained ZEVQORA classifier/transformer. "
        "Follow the user instruction exactly. Prefer short structured answers."
    )
