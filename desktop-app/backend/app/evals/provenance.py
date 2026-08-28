"""Immutable evaluation provenance hashing."""

from __future__ import annotations

from typing import Any

from ..core.hashing import sha256_json
from .models import EVALUATION_VERSION, GATE_SYSTEM_VERSION, EvaluationCaseSpec, GateConfig


def evidence_version_hash(
    *,
    candidate_execution_provenance: str,
    baseline_evidence_hash: str,
    cases: list[EvaluationCaseSpec],
    gate_config: GateConfig,
    case_result_digests: list[dict[str, Any]],
) -> str:
    payload = {
        "evaluation_version": EVALUATION_VERSION,
        "gate_system_version": GATE_SYSTEM_VERSION,
        "candidate_execution_provenance": candidate_execution_provenance,
        "baseline_evidence_hash": baseline_evidence_hash,
        "cases": [
            {
                "case_id": c.case_id,
                "baseline_trace_id": c.baseline_trace_id,
                "protected": c.protected,
                "graders": [g.model_dump() for g in c.graders],
                "expected": c.expected,
                "reference": c.reference,
                "required_tools": c.required_tools,
                "forbidden_tools": c.forbidden_tools,
                "weight": c.weight,
            }
            for c in cases
        ],
        "gate_config": gate_config.model_dump(),
        "aggregation": gate_config.aggregation,
        "case_results": case_result_digests,
    }
    return sha256_json(payload)


def grader_config_hash(cases: list[EvaluationCaseSpec]) -> str:
    return sha256_json([{"case_id": c.case_id, "graders": [g.model_dump() for g in c.graders]} for c in cases])


def gate_config_hash(config: GateConfig) -> str:
    return sha256_json(config.model_dump())
