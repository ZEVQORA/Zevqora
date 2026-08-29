"""Diagnose avoidable work in a DUREM baseline.

Every finding is evidence-backed: it names the cases that exhibit it and the work
those cases actually spent. Nothing is inferred from the architecture alone.

DUREM already avoids a great deal of model work by design -- deterministic
routing, the numeric rule engine, the zero-evidence NOT_FOUND short-circuit, and
suppressed model thinking. Those are recorded as ALREADY_OPTIMIZED so they can
never be re-sold as a new saving. A diagnosis that counted them would be claiming
credit for DUREM's own engineering.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

DIAGNOSIS_VERSION = "durem_diagnosis_v1"


@dataclass
class Finding:
    finding_id: str
    title: str
    severity: str  # high | medium | low | none
    case_ids: list[str] = field(default_factory=list)
    observed: dict[str, Any] = field(default_factory=dict)
    hypothesis: str = ""
    mechanism: str = ""
    risk: str = ""
    already_optimized: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "finding_id": self.finding_id,
            "title": self.title,
            "severity": self.severity,
            "case_count": len(self.case_ids),
            "case_ids": self.case_ids,
            "observed": self.observed,
            "hypothesis": self.hypothesis,
            "mechanism": self.mechanism,
            "risk": self.risk,
            "already_optimized": self.already_optimized,
        }


# Optimizations DUREM already implements. Recorded so no candidate can claim them.
ALREADY_OPTIMIZED = [
    Finding(
        finding_id="ALREADY-001",
        title="Deterministic routing already avoids a classifier call on high-confidence questions",
        severity="none",
        hypothesis="Eight of nine router conditions resolve with zero model calls.",
        mechanism="assistant_router._deterministic_decision short-circuits before the classifier.",
        already_optimized=True,
    ),
    Finding(
        finding_id="ALREADY-002",
        title="Numeric rule engine already answers exact-threshold questions with zero LLM calls",
        severity="none",
        hypothesis="Metric-matched rules produce a decision without generation.",
        mechanism="assistant_engine._deterministic_numeric_rule then _deterministic_response.",
        already_optimized=True,
    ),
    Finding(
        finding_id="ALREADY-003",
        title="Zero-evidence questions already short-circuit to NOT_FOUND without a model call",
        severity="none",
        hypothesis="No rules, chunks or responsibilities means no generation.",
        mechanism="assistant_engine._answer_policy safety_fallback branch.",
        already_optimized=True,
    ),
    Finding(
        finding_id="ALREADY-004",
        title="Model thinking is already suppressed by default",
        severity="none",
        hypothesis="DUREM_DISABLE_MODEL_THINKING defaults to true for qwen3 models.",
        mechanism="LemonadeClient.chat appends a no-think directive.",
        already_optimized=True,
    ),
]


def _cases_where(results: list[Any], predicate) -> list[str]:
    return [r.case_id for r in results if r.ok and predicate(r)]


def diagnose(results: list[Any]) -> list[Finding]:
    """Inspect executed baseline cases and report avoidable work."""
    findings: list[Finding] = []
    executed = [r for r in results if r.ok]
    if not executed:
        return findings

    # --- 1. Embeddings paid on cases the rule engine answered --------------
    # retrieve_chunks() runs (and embeds the query) before the deterministic rule
    # check, so an exact-threshold question pays an embedding whose result is
    # then discarded. This is real avoidable work, distinct from ALREADY-002.
    wasted_embedding = _cases_where(
        executed,
        lambda r: r.probe.get("rule_engine_used") and r.probe.get("embedding_call_count", 0) > 0,
    )
    if wasted_embedding:
        findings.append(
            Finding(
                finding_id="DIAG-001",
                title="Embedding call paid on cases the deterministic rule engine answers",
                severity="medium",
                case_ids=wasted_embedding,
                observed={
                    "cases": len(wasted_embedding),
                    "embedding_calls_wasted": sum(
                        r.probe.get("embedding_call_count", 0) for r in executed if r.case_id in set(wasted_embedding)
                    ),
                },
                hypothesis=(
                    "retrieve_chunks() embeds the query before _deterministic_numeric_rule() "
                    "runs, so the vector is computed and then discarded."
                ),
                mechanism=(
                    "Skip chunk retrieval when a metric-matched active rule will decide the case. "
                    "Provably output-equivalent: when the rule fires, chunks are never read."
                ),
                risk=(
                    "If the rule-detection predicate diverges from the engine's own, a case could "
                    "lose RAG context. Mitigated by reusing the engine's predicate verbatim."
                ),
            )
        )

    # --- 2. Structured-output repair retries ------------------------------
    repairs = _cases_where(executed, lambda r: r.probe.get("repair_call_count", 0) > 0)
    if repairs:
        findings.append(
            Finding(
                finding_id="DIAG-002",
                title="Policy generation required a second call to satisfy the JSON contract",
                severity="high",
                case_ids=repairs,
                observed={
                    "cases": len(repairs),
                    "extra_calls": sum(r.probe.get("repair_call_count", 0) for r in executed),
                },
                hypothesis="The first generation failed schema validation and was retried.",
                mechanism="Tighter output contract or a constrained decoding format would remove the retry.",
                risk="A stricter contract could increase outright failures instead of retries.",
            )
        )

    # --- 3. Classifier calls in the ambiguous band ------------------------
    classifier_cases = _cases_where(executed, lambda r: r.probe.get("classifier_call_count", 0) > 0)
    if classifier_cases:
        findings.append(
            Finding(
                finding_id="DIAG-003",
                title="Ambiguous questions spend an extra classifier call",
                severity="medium",
                case_ids=classifier_cases,
                observed={
                    "cases": len(classifier_cases),
                    "classifier_calls": sum(r.probe.get("classifier_call_count", 0) for r in executed),
                },
                hypothesis=(
                    "Some questions reaching the classifier may be separable by deterministic "
                    "signals that the current lexicons do not cover."
                ),
                mechanism=(
                    "Extend the deterministic signal set ONLY where a frozen replay shows the "
                    "classifier's own decision is already implied by existing signals."
                ),
                risk=(
                    "HIGH. The classifier is a safety component with a deliberate asymmetry: a false "
                    "chat can fabricate company authority. Any change here must keep every SAFETY "
                    "case passing and must not weaken the low-confidence policy upgrade."
                ),
            )
        )

    # --- 4. Oversized policy context --------------------------------------
    contexts = [r.probe.get("context_chars", 0) for r in executed if r.probe.get("context_chars")]
    if contexts:
        contexts_sorted = sorted(contexts)
        p90 = contexts_sorted[int(len(contexts_sorted) * 0.9) - 1] if len(contexts_sorted) > 1 else contexts_sorted[0]
        large = _cases_where(executed, lambda r: r.probe.get("context_chars", 0) >= p90)
        findings.append(
            Finding(
                finding_id="DIAG-004",
                title="Policy prompt context size varies widely across cases",
                severity="low",
                case_ids=large,
                observed={
                    "max_context_chars": max(contexts),
                    "p90_context_chars": p90,
                    "mean_context_chars": round(sum(contexts) / len(contexts), 1),
                },
                hypothesis="Retrieval returns up to 8 rules + 6 chunks + 4 responsibilities regardless of need.",
                mechanism="Trim low-scoring context below a threshold, or reduce limits for narrow questions.",
                risk="Trimming context can remove the source a correct answer needed; grounding gates would catch it.",
            )
        )

    # --- 5. Repeated identical embeddings ---------------------------------
    seen: dict[str, list[str]] = {}
    for result in executed:
        for call in result.probe.get("embedding_calls", []):
            key = f"{call.get('model')}::{call.get('input_chars')}"
            seen.setdefault(key, []).append(result.case_id)
    repeated = {k: v for k, v in seen.items() if len(v) > 1}
    if repeated:
        findings.append(
            Finding(
                finding_id="DIAG-005",
                title="Embedding calls with identical shape recur across cases",
                severity="low",
                case_ids=sorted({c for v in repeated.values() for c in v}),
                observed={"repeat_groups": len(repeated)},
                hypothesis=(
                    "Follow-up and near-duplicate questions may embed identical text. A content-keyed "
                    "cache would reuse the vector."
                ),
                mechanism="Cache query embeddings keyed by exact normalized text.",
                risk=(
                    "Low for exact-match reuse. A fuzzy cache would risk returning the wrong vector "
                    "and is out of scope."
                ),
            )
        )

    # --- 6. Silent degradation already costing quality --------------------
    degraded = _cases_where(
        executed,
        lambda r: r.probe.get("embedding_degraded") or r.probe.get("classifier_fallback"),
    )
    if degraded:
        findings.append(
            Finding(
                finding_id="DIAG-006",
                title="Cases degraded silently, reducing work at the cost of quality",
                severity="high",
                case_ids=degraded,
                observed={"cases": len(degraded)},
                hypothesis="Embedding or classifier failure silently reduced work in the baseline.",
                mechanism=(
                    "Not an optimization. Recorded so that a candidate cannot bank this as a saving; "
                    "the baseline itself is degraded and should be repaired first."
                ),
                risk="Treating this as a saving would reward breaking the runtime.",
            )
        )

    return findings


def summarize(results: list[Any]) -> dict[str, Any]:
    findings = diagnose(results)
    return {
        "diagnosis_version": DIAGNOSIS_VERSION,
        "cases_examined": len(results),
        "findings": [f.as_dict() for f in findings],
        "already_optimized": [f.as_dict() for f in ALREADY_OPTIMIZED],
        "note": (
            "already_optimized entries are DUREM's existing engineering. They are excluded "
            "from any savings claim by construction."
        ),
    }
