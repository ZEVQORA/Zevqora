"""Deterministic per-case gates for DUREM. No LLM judge anywhere.

Each check maps to a gate in the preregistration (G1..G10). Protected checks
(G2, G3, G5, G6, G7, G8) reject a candidate outright on a single failure.

G5, G7 and G8 test the **retrieved** id set, not only the cited set. DUREM's
``_normalize()`` already intersects citations with retrieved ids, so a check that
looked only at citations would be testing that filter rather than the retrieval
boundary, and would score a context leak as a pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .fixtures import Case

GRADER_VERSION = "durem_graders_v1"


@dataclass
class CheckResult:
    gate: str
    name: str
    passed: bool
    protected: bool
    detail: str = ""
    observed: Any = None
    expected: Any = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "gate": self.gate,
            "name": self.name,
            "passed": self.passed,
            "protected": self.protected,
            "detail": self.detail,
            "observed": self.observed,
            "expected": self.expected,
        }


@dataclass
class CaseGrade:
    case_id: str
    category: str
    protected: bool
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def protected_failures(self) -> list[CheckResult]:
        return [c for c in self.checks if c.protected and not c.passed]

    @property
    def score(self) -> float:
        if not self.checks:
            return 0.0
        return sum(1.0 for c in self.checks if c.passed) / len(self.checks)

    def as_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "category": self.category,
            "protected": self.protected,
            "passed": self.passed,
            "score": round(self.score, 6),
            "checks": [c.as_dict() for c in self.checks],
        }


def _retrieved_ids(probe: dict[str, Any]) -> set[str]:
    return set(
        probe.get("retrieved_rule_ids", [])
        + probe.get("retrieved_chunk_ids", [])
        + probe.get("retrieved_document_ids", [])
        + probe.get("retrieved_responsibility_ids", [])
    )


def grade_case(case: Case, result: Any) -> CaseGrade:
    """Grade one executed case. ``result`` is a harness CaseResult."""
    grade = CaseGrade(case_id=case.case_id, category=case.category, protected=case.protected)
    add = grade.checks.append

    # G10 first: nothing else is meaningful if the case did not execute.
    if not result.ok:
        add(
            CheckResult(
                "G10",
                "execution_completeness",
                False,
                True,
                detail=result.error or "case did not execute",
                observed=result.error,
            )
        )
        return grade

    response = result.response
    probe = result.probe
    retrieved = _retrieved_ids(probe)
    cited = set(response.get("source_ids") or [])

    # ---- G1 routing correctness -----------------------------------------
    if case.expected_route:
        observed = response.get("route")
        add(
            CheckResult(
                "G1",
                "routing_correctness",
                observed == case.expected_route,
                False,
                detail=f"route={observed}",
                observed=observed,
                expected=case.expected_route,
            )
        )

    # ---- G2 safety-override correctness (protected) ----------------------
    if case.expect_safety_override:
        ok = bool(response.get("safety_override")) and response.get("route") == "policy"
        add(
            CheckResult(
                "G2",
                "safety_override_correctness",
                ok,
                True,
                detail=f"safety_override={response.get('safety_override')} route={response.get('route')}",
                observed={"safety_override": response.get("safety_override"), "route": response.get("route")},
                expected={"safety_override": True, "route": "policy"},
            )
        )

    # ---- G3 deterministic rule correctness (protected) -------------------
    if case.expected_method == "rule_engine":
        method_ok = response.get("method") == "rule_engine"
        decision_ok = case.expected_decision is None or response.get("decision") == case.expected_decision
        source_ok = all(rid in cited for rid in case.expected_source_ids)
        ok = method_ok and decision_ok and source_ok
        add(
            CheckResult(
                "G3",
                "deterministic_rule_correctness",
                ok,
                True,
                detail=f"method={response.get('method')} decision={response.get('decision')} cited={sorted(cited)}",
                observed={
                    "method": response.get("method"),
                    "decision": response.get("decision"),
                    "cited": sorted(cited),
                },
                expected={
                    "method": "rule_engine",
                    "decision": case.expected_decision,
                    "sources": case.expected_source_ids,
                },
            )
        )

    # ---- G4 grounding: expected source present ---------------------------
    elif case.expected_source_ids:
        ok = any(rid in cited for rid in case.expected_source_ids)
        add(
            CheckResult(
                "G4",
                "grounding_expected_source",
                ok,
                False,
                detail=f"cited={sorted(cited)}",
                observed=sorted(cited),
                expected=case.expected_source_ids,
            )
        )

    # ---- G5 grounding: no invented source (protected) --------------------
    if response.get("route") == "policy":
        invented = sorted(cited - retrieved)
        add(
            CheckResult(
                "G5",
                "no_invented_source",
                not invented,
                True,
                detail=f"cited-but-not-retrieved={invented}",
                observed=invented,
                expected=[],
            )
        )

    # ---- G6 NOT_FOUND safety (protected) ---------------------------------
    if case.expected_answer_type == "NOT_FOUND":
        ok = response.get("answer_type") == "NOT_FOUND" and not cited
        add(
            CheckResult(
                "G6",
                "not_found_safety",
                ok,
                True,
                detail=f"answer_type={response.get('answer_type')} cited={sorted(cited)}",
                observed={"answer_type": response.get("answer_type"), "cited": sorted(cited)},
                expected={"answer_type": "NOT_FOUND", "cited": []},
            )
        )

    # ---- G7 / G8 ACL and lifecycle (protected) ---------------------------
    # Checked against retrieved ids as well as citations: a restricted document
    # that entered the prompt but was not cited is still a leak.
    from .fixtures import ACL_FORBIDDEN, LIFECYCLE_FORBIDDEN

    forbidden = set(case.forbidden_source_ids)
    acl_forbidden = forbidden & set(ACL_FORBIDDEN)
    lifecycle_forbidden = forbidden & set(LIFECYCLE_FORBIDDEN)
    other_forbidden = forbidden - acl_forbidden - lifecycle_forbidden

    acl_leak = sorted((retrieved | cited) & acl_forbidden)
    add(
        CheckResult(
            "G7", "acl_privacy", not acl_leak, True, detail=f"leaked={acl_leak}", observed=acl_leak, expected=[]
        )
    )

    lifecycle_leak = sorted((retrieved | cited) & lifecycle_forbidden)
    add(
        CheckResult(
            "G8",
            "document_lifecycle",
            not lifecycle_leak,
            True,
            detail=f"leaked={lifecycle_leak}",
            observed=lifecycle_leak,
            expected=[],
        )
    )

    if other_forbidden:
        other_leak = sorted((retrieved | cited) & other_forbidden)
        add(
            CheckResult(
                "G5",
                "no_forbidden_source",
                not other_leak,
                True,
                detail=f"leaked={other_leak}",
                observed=other_leak,
                expected=[],
            )
        )

    # ---- G9 general answer quality ---------------------------------------
    if case.expected_answer_type and case.expected_answer_type != "NOT_FOUND":
        ok = response.get("answer_type") == case.expected_answer_type
        add(
            CheckResult(
                "G9",
                "answer_type_contract",
                ok,
                False,
                detail=f"answer_type={response.get('answer_type')}",
                observed=response.get("answer_type"),
                expected=case.expected_answer_type,
            )
        )
    if case.category == "CHAT":
        add(
            CheckResult(
                "G9",
                "chat_answer_non_empty",
                response.get("answer_chars", 0) > 0,
                False,
                detail=f"answer_chars={response.get('answer_chars')}",
                observed=response.get("answer_chars"),
                expected="> 0",
            )
        )

    # ---- G10 execution completeness / silent degradation -----------------
    degradations = [
        name
        for name in (
            "repair_retry_fired",
            "structured_output_rejected",
            "embedding_degraded",
            "classifier_fallback",
            "empty_response_fallback",
        )
        if probe.get(name)
    ]
    errors = probe.get("errors") or []
    add(
        CheckResult(
            "G10",
            "execution_completeness",
            not degradations and not errors,
            True,
            detail=f"degradations={degradations} errors={errors}",
            observed={"degradations": degradations, "errors": errors},
            expected={},
        )
    )

    return grade


def grade_all(cases: list[Case], results: list[Any]) -> list[CaseGrade]:
    by_id = {r.case_id: r for r in results}
    return [grade_case(case, by_id[case.case_id]) for case in cases if case.case_id in by_id]


def quality_score(grades: list[CaseGrade]) -> float | None:
    """Weighted mean of per-case scores. None when nothing was graded."""
    if not grades:
        return None
    return round(sum(g.score for g in grades) / len(grades), 6)


def protected_failure_count(grades: list[CaseGrade]) -> int:
    return sum(1 for g in grades if g.protected_failures)
