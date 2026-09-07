"""Tests for the DUREM <-> ZEVQORA evaluation integration.

Integration tests execute real DUREM code against the deterministic stub runtime.
They are skipped when the DUREM repository is not present, so the suite stays
green in a checkout that has only ZEVQORA.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.durem_eval import candidates as candidates_mod
from app.durem_eval import diagnosis as diagnosis_mod
from app.durem_eval import fixtures as fixtures_mod
from app.durem_eval import gates as gates_mod
from app.durem_eval import graders as graders_mod
from app.durem_eval import report as report_mod
from app.durem_eval.metrics import (
    DEFAULT_WEIGHTS,
    MetricFidelity,
    WorkMetrics,
    fidelity_for,
    select_metric,
)
from app.durem_eval.runtime import MockRuntimeServer, local_descriptor

REPO_ROOT = Path(__file__).resolve().parents[3]
DUREM_REPO = Path(os.environ.get("DUREM_REPO_PATH", REPO_ROOT.parent / "Durem_AI"))
HAS_DUREM = (DUREM_REPO / "app" / "assistant_engine.py").exists()
requires_durem = pytest.mark.skipif(not HAS_DUREM, reason="DUREM repository not available")


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------


def test_unknown_tokens_never_become_zero():
    a = WorkMetrics(llm_calls=1, input_tokens=None)
    b = WorkMetrics(llm_calls=1, input_tokens=None)
    assert (a + b).input_tokens is None
    assert (a + b).llm_calls == 2


def test_partial_token_reporting_sums_known_values():
    a = WorkMetrics(input_tokens=None)
    b = WorkMetrics(input_tokens=100)
    assert (a + b).input_tokens == 100


def test_total_tokens_none_when_nothing_reported():
    assert WorkMetrics().total_tokens is None
    assert WorkMetrics(input_tokens=5).total_tokens == 5


def test_structural_metrics_are_real_under_mock_runtime():
    """Call counts describe DUREM's control flow, so a stub measures them faithfully."""
    assert fidelity_for("llm_calls", runtime_is_real=False) is MetricFidelity.REAL_STRUCTURAL
    assert fidelity_for("embedding_calls", runtime_is_real=False) is MetricFidelity.REAL_STRUCTURAL


def test_token_and_timing_metrics_are_synthetic_under_mock_runtime():
    assert fidelity_for("inference_ms", runtime_is_real=False) is MetricFidelity.SYNTHETIC_TEST_METRIC
    assert fidelity_for("input_tokens", runtime_is_real=False) is MetricFidelity.SYNTHETIC_TEST_METRIC
    assert fidelity_for("inference_ms", runtime_is_real=True) is MetricFidelity.MEASURED


def test_synthetic_metric_is_not_reportable():
    selection = select_metric(
        name="inference_ms",
        baseline=WorkMetrics(inference_ms=100.0),
        candidate=WorkMetrics(inference_ms=50.0),
        runtime_is_real=False,
    )
    assert selection.reduction_pct == 50.0
    assert selection.reportable is False
    assert "SYNTHETIC_TEST_METRIC" in selection.note


def test_reduction_pct_none_when_a_side_is_missing():
    selection = select_metric(
        name="llm_calls",
        baseline=WorkMetrics(llm_calls=10),
        candidate=None,
        runtime_is_real=False,
    )
    assert selection.reduction_pct is None


def test_model_work_units_uses_declared_weights():
    metrics = WorkMetrics(llm_calls=3, embedding_calls=10)
    assert metrics.model_work_units(DEFAULT_WEIGHTS) == pytest.approx(3 * 1.0 + 10 * 0.1)


# ---------------------------------------------------------------------------
# stub runtime
# ---------------------------------------------------------------------------


def test_stub_runtime_serves_openai_shaped_endpoints():
    import httpx

    with MockRuntimeServer() as server:
        models = httpx.get(f"{server.base_url}/v1/models", timeout=10).json()
        assert any(m["id"] == "Qwen3-8B-GGUF" for m in models["data"])

        chat = httpx.post(
            f"{server.base_url}/v1/chat/completions",
            json={
                "model": "Qwen3-8B-GGUF",
                "messages": [{"role": "system", "content": "you are a helper"}, {"role": "user", "content": "сайн уу"}],
            },
            timeout=10,
        ).json()
        assert chat["choices"][0]["message"]["content"]
        assert chat["usage"]["prompt_tokens"] > 0

        emb = httpx.post(
            f"{server.base_url}/v1/embeddings",
            json={"model": "Qwen3-Embedding-0.6B-GGUF", "input": ["a", "b"]},
            timeout=10,
        ).json()
        assert len(emb["data"]) == 2


def test_stub_embeddings_are_deterministic_across_calls():
    import httpx

    with MockRuntimeServer() as server:

        def vec():
            return httpx.post(
                f"{server.base_url}/v1/embeddings",
                json={"model": "e", "input": ["хөнгөлөлтийн журам"]},
                timeout=10,
            ).json()["data"][0]["embedding"]

        assert vec() == vec()


def test_stub_policy_answer_never_cites_an_absent_id():
    from app.durem_eval.runtime import _policy_answer

    prompt = "QUESTION: хөнгөлөлт хэд вэ\nRULES:\n[RULE r-1] Decision hint: ALLOWED\nText: хөнгөлөлт олгоно"
    answer = json.loads(_policy_answer(prompt))
    for key in ("source_rule_ids", "source_chunk_ids", "source_responsibility_ids"):
        assert set(answer.get(key, [])) <= {"r-1"}


def test_stub_returns_not_found_when_context_is_irrelevant():
    from app.durem_eval.runtime import _policy_answer

    prompt = (
        "QUESTION: цөмийн реакторын хөргөлтийн зарчим юу вэ\n"
        "[RULE r-1] Decision hint: ALLOWED\nText: хөнгөлөлтийн журам"
    )
    assert json.loads(_policy_answer(prompt))["answer_type"] == "NOT_FOUND"


def test_stub_router_prefers_policy_on_a_tie():
    """Matches DUREM's safety asymmetry: a false chat can fabricate authority."""
    from app.durem_eval.runtime import _router_answer

    assert json.loads(_router_answer("POLICY SCORE: 2\nCHAT SCORE: 2"))["route"] == "policy"
    assert json.loads(_router_answer("POLICY SCORE: 0\nCHAT SCORE: 4"))["route"] == "chat"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def test_fixture_set_covers_every_required_category():
    counts = fixtures_mod.manifest()["category_counts"]
    assert set(counts) == {
        "ACL",
        "CHAT",
        "FOLLOWUP",
        "LIFECYCLE",
        "NOTFOUND",
        "RAG",
        "ROUTE-AMB",
        "ROUTE-OBV",
        "RULE",
        "SAFETY",
        "SRCVAL",
    }


def test_fixture_manifest_declares_synthetic_provenance():
    manifest = fixtures_mod.manifest()
    assert manifest["provenance"] == "REPRESENTATIVE_SYNTHETIC"
    assert "not real" in manifest["disclosure"].lower()


def test_fixture_case_ids_are_unique():
    ids = [c.case_id for c in fixtures_mod.build_cases()]
    assert len(ids) == len(set(ids)) == 60


def test_protected_cases_cannot_generate_savings():
    """Every protected category is one that can only lose points."""
    cases = fixtures_mod.build_cases()
    protected = {c.category for c in cases if c.protected}
    assert protected == {"ACL", "LIFECYCLE", "NOTFOUND", "RULE", "SAFETY", "SRCVAL"}
    assert sum(1 for c in cases if c.protected) == 27


def test_manifest_hashes_are_stable():
    assert fixtures_mod.manifest()["corpus_hash"] == fixtures_mod.manifest()["corpus_hash"]


# ---------------------------------------------------------------------------
# graders and gates
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, case, response=None, probe=None, ok=True, error=None):
        self.case_id = case.case_id
        self.category = case.category
        self.protected = case.protected
        self.ok = ok
        self.error = error
        self.response = response or {}
        self.probe = probe or {}


def _clean_probe(**overrides):
    base = {
        "retrieved_rule_ids": [],
        "retrieved_chunk_ids": [],
        "retrieved_document_ids": [],
        "retrieved_responsibility_ids": [],
        "errors": [],
    }
    base.update(overrides)
    return base


def test_grader_flags_invented_source():
    case = fixtures_mod.Case(case_id="x", category="RAG", mode="policy", requester="emp", question="q")
    result = _FakeResult(
        case,
        response={"route": "policy", "source_ids": ["ghost-1"], "answer_type": "POLICY"},
        probe=_clean_probe(retrieved_rule_ids=["real-1"]),
    )
    grade = graders_mod.grade_case(case, result)
    invented = [c for c in grade.checks if c.name == "no_invented_source"]
    assert invented and not invented[0].passed and invented[0].protected


def test_grader_detects_acl_leak_into_retrieval_not_only_citation():
    """A restricted document in the prompt is a leak even if it was never cited."""
    case = fixtures_mod.Case(
        case_id="x",
        category="ACL",
        mode="policy",
        requester="emp",
        question="q",
        protected=True,
        forbidden_source_ids=fixtures_mod.ACL_FORBIDDEN,
    )
    result = _FakeResult(
        case,
        response={"route": "policy", "source_ids": [], "answer_type": "NOT_FOUND"},
        probe=_clean_probe(retrieved_chunk_ids=["chunk-payroll-1"]),
    )
    grade = graders_mod.grade_case(case, result)
    acl = [c for c in grade.checks if c.name == "acl_privacy"]
    assert acl and not acl[0].passed


def test_grader_flags_silent_degradation_as_execution_failure():
    case = fixtures_mod.Case(case_id="x", category="RAG", mode="policy", requester="emp", question="q")
    result = _FakeResult(
        case,
        response={"route": "policy", "source_ids": ["r"], "answer_type": "POLICY"},
        probe=_clean_probe(retrieved_rule_ids=["r"], embedding_degraded=True),
    )
    grade = graders_mod.grade_case(case, result)
    completeness = [c for c in grade.checks if c.name == "execution_completeness"]
    assert completeness and not completeness[0].passed


def test_failed_execution_grades_as_protected_failure():
    case = fixtures_mod.Case(case_id="x", category="RAG", mode="policy", requester="emp", question="q")
    grade = graders_mod.grade_case(case, _FakeResult(case, ok=False, error="boom"))
    assert not grade.passed
    assert grade.protected_failures


def _grades(passing: bool, protected: bool = True, n: int = 60):
    out = []
    for i in range(n):
        grade = graders_mod.CaseGrade(case_id=f"c{i}", category="RULE", protected=protected)
        grade.checks.append(graders_mod.CheckResult("G3", "x", passing, protected))
        out.append(grade)
    return out


def test_one_protected_failure_rejects_the_candidate():
    grades = _grades(True)
    grades[0].checks[0].passed = False
    metric = select_metric(
        name="llm_calls", baseline=WorkMetrics(llm_calls=100), candidate=WorkMetrics(llm_calls=10), runtime_is_real=True
    )
    report = gates_mod.evaluate(
        config=gates_mod.REAL_GATE_CONFIG,
        baseline_grades=_grades(True),
        candidate_grades=grades,
        metric=metric,
        baseline_latency_ms=100.0,
        candidate_latency_ms=90.0,
    )
    assert report.status == "REJECTED"


def test_huge_saving_cannot_override_a_protected_failure():
    """A 99% reduction must not buy its way past the protected slice."""
    grades = _grades(True)
    grades[3].checks[0].passed = False
    metric = select_metric(
        name="llm_calls",
        baseline=WorkMetrics(llm_calls=1000),
        candidate=WorkMetrics(llm_calls=10),
        runtime_is_real=True,
    )
    report = gates_mod.evaluate(
        config=gates_mod.REAL_GATE_CONFIG,
        baseline_grades=_grades(True),
        candidate_grades=grades,
        metric=metric,
        baseline_latency_ms=100.0,
        candidate_latency_ms=10.0,
    )
    assert report.status == "REJECTED"


def test_real_config_rejects_a_synthetic_metric():
    metric = select_metric(
        name="inference_ms",
        baseline=WorkMetrics(inference_ms=100.0),
        candidate=WorkMetrics(inference_ms=50.0),
        runtime_is_real=False,
    )
    report = gates_mod.evaluate(
        config=gates_mod.REAL_GATE_CONFIG,
        baseline_grades=_grades(True),
        candidate_grades=_grades(True),
        metric=metric,
        baseline_latency_ms=100.0,
        candidate_latency_ms=50.0,
    )
    assert report.status == "REJECTED"
    reportable = [g for g in report.gates if g.name == "metric_reportable"]
    assert reportable and reportable[0].outcome.value == "failed"


def test_missing_work_evidence_is_incomplete_not_verified():
    report = gates_mod.evaluate(
        config=gates_mod.REAL_GATE_CONFIG,
        baseline_grades=_grades(True),
        candidate_grades=_grades(True),
        metric=None,
        baseline_latency_ms=100.0,
        candidate_latency_ms=50.0,
    )
    assert report.status == "INCOMPLETE"


def test_zero_protected_cases_is_incomplete_when_required():
    report = gates_mod.evaluate(
        config=gates_mod.REAL_GATE_CONFIG,
        baseline_grades=_grades(True, protected=False),
        candidate_grades=_grades(True, protected=False),
        metric=select_metric(
            name="llm_calls",
            baseline=WorkMetrics(llm_calls=10),
            candidate=WorkMetrics(llm_calls=5),
            runtime_is_real=True,
        ),
        baseline_latency_ms=10.0,
        candidate_latency_ms=5.0,
    )
    assert report.status == "INCOMPLETE"


def test_case_error_fails_execution_gate():
    report = gates_mod.evaluate(
        config=gates_mod.MOCK_GATE_CONFIG,
        baseline_grades=_grades(True),
        candidate_grades=_grades(True),
        metric=None,
        case_errors=1,
    )
    assert report.status == "REJECTED"


# ---------------------------------------------------------------------------
# ingestion
# ---------------------------------------------------------------------------


def test_trace_payloads_never_carry_a_dollar_cost():
    case = fixtures_mod.build_cases()[0]
    result = _FakeResult(
        case, response={"route": "chat", "source_ids": []}, probe=_clean_probe(input_tokens=10, output_tokens=5)
    )
    result.metrics = WorkMetrics(llm_calls=1)
    payloads = report_mod.to_trace_payloads([result], runtime=local_descriptor("http://x").as_dict(), dataset_name="d")
    assert payloads[0]["cost_usd"] is None
    assert "work_metrics" in payloads[0]["metadata"]


def test_trace_payload_records_metric_fidelity():
    case = fixtures_mod.build_cases()[0]
    result = _FakeResult(case, response={"route": "chat", "source_ids": []}, probe=_clean_probe())
    result.metrics = WorkMetrics()
    with MockRuntimeServer() as server:
        payloads = report_mod.to_trace_payloads([result], runtime=server.descriptor().as_dict(), dataset_name="d")
    fidelity = payloads[0]["metadata"]["metric_fidelity"]
    assert fidelity["tokens_and_timing"] == MetricFidelity.SYNTHETIC_TEST_METRIC.value
    assert fidelity["counters"] == MetricFidelity.REAL_STRUCTURAL.value


def test_trace_request_ids_are_unique_per_repeat():
    cases = fixtures_mod.build_cases()[:3]
    results = []
    for case in cases:
        r = _FakeResult(case, response={"route": "chat", "source_ids": []}, probe=_clean_probe())
        r.metrics = WorkMetrics()
        results.append(r)
    runtime = local_descriptor("http://x").as_dict()
    ids = {
        p["request_id"]
        for p in report_mod.to_trace_payloads(results, runtime=runtime, dataset_name="d", repeat_index=1)
    }
    ids |= {
        p["request_id"]
        for p in report_mod.to_trace_payloads(results, runtime=runtime, dataset_name="d", repeat_index=2)
    }
    assert len(ids) == 6


# ---------------------------------------------------------------------------
# candidates and diagnosis
# ---------------------------------------------------------------------------


def test_candidate_declares_a_full_record():
    record = candidates_mod.get("durem-cand-a").as_dict()
    for key in (
        "hypothesis",
        "target_finding",
        "production_change",
        "expected_benefit",
        "expected_risk",
        "rollback",
        "protected_behavior",
        "required_gates",
    ):
        assert record[key], f"{key} must be declared"


def test_already_optimized_findings_are_excluded_from_savings():
    summary = diagnosis_mod.summarize([])
    ids = {f["finding_id"] for f in summary["already_optimized"]}
    assert {"ALREADY-001", "ALREADY-002", "ALREADY-003", "ALREADY-004"} <= ids
    assert all(f["already_optimized"] for f in summary["already_optimized"])


def test_diagnosis_reports_degradation_without_treating_it_as_a_saving():
    case = fixtures_mod.build_cases()[0]
    result = _FakeResult(case, response={}, probe=_clean_probe(embedding_degraded=True))
    findings = {f.finding_id: f for f in diagnosis_mod.diagnose([result])}
    assert "DIAG-006" in findings
    assert findings["DIAG-006"].severity == "high"


# ---------------------------------------------------------------------------
# integration against real DUREM
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def durem_run(tmp_path_factory):
    if not HAS_DUREM:
        pytest.skip("DUREM repository not available")
    from app.durem_eval.harness import DuremSession, aggregate

    server = MockRuntimeServer().start()
    try:
        session = DuremSession(
            durem_repo=DUREM_REPO,
            data_dir=tmp_path_factory.mktemp("durem-work"),
            runtime=server.descriptor(),
        )
        session.build_representative_db()
        cases = fixtures_mod.build_cases()
        results = session.run_all(cases)
        yield {
            "session": session,
            "cases": cases,
            "results": results,
            "totals": aggregate(results),
            "grades": graders_mod.grade_all(cases, results),
            "server": server,
        }
    finally:
        server.stop()


@requires_durem
def test_integration_every_case_executes(durem_run):
    failed = [r.case_id for r in durem_run["results"] if not r.ok]
    assert failed == []


@requires_durem
def test_integration_baseline_passes_all_gates(durem_run):
    report = gates_mod.evaluate(
        config=gates_mod.MOCK_GATE_CONFIG,
        baseline_grades=durem_run["grades"],
        candidate_grades=None,
        metric=None,
        case_errors=0,
    )
    failures = [g.name for g in report.gates if g.required and g.outcome.value in {"failed", "missing"}]
    assert failures == [], f"baseline gate failures: {failures}"
    assert report.status == "VERIFIED"


@requires_durem
def test_integration_rule_engine_answers_with_zero_llm_calls(durem_run):
    """DUREM's existing optimization: exact-threshold cases never reach the model."""
    rule_results = [r for r in durem_run["results"] if r.category == "RULE"]
    assert rule_results
    for result in rule_results:
        assert result.response["method"] == "rule_engine"
        assert result.metrics.llm_calls == 0


@requires_durem
def test_integration_acl_documents_never_enter_retrieval(durem_run):
    forbidden = set(fixtures_mod.ACL_FORBIDDEN)
    for result in durem_run["results"]:
        retrieved = set(result.probe.get("retrieved_chunk_ids", []) + result.probe.get("retrieved_document_ids", []))
        assert not (retrieved & forbidden), f"{result.case_id} retrieved {retrieved & forbidden}"


@requires_durem
def test_integration_archived_and_undated_documents_never_retrieved(durem_run):
    forbidden = set(fixtures_mod.LIFECYCLE_FORBIDDEN)
    for result in durem_run["results"]:
        retrieved = set(
            result.probe.get("retrieved_chunk_ids", [])
            + result.probe.get("retrieved_document_ids", [])
            + result.probe.get("retrieved_rule_ids", [])
        )
        assert not (retrieved & forbidden), f"{result.case_id} retrieved {retrieved & forbidden}"


@requires_durem
def test_integration_inactive_rule_never_retrieved(durem_run):
    for result in durem_run["results"]:
        assert "obsolete-001" not in result.probe.get("retrieved_rule_ids", [])


@requires_durem
def test_integration_no_case_cites_an_unretrieved_source(durem_run):
    for result in durem_run["results"]:
        if not result.ok:
            continue
        retrieved = set(
            result.probe.get("retrieved_rule_ids", [])
            + result.probe.get("retrieved_chunk_ids", [])
            + result.probe.get("retrieved_responsibility_ids", [])
        )
        cited = set(result.response.get("source_ids") or [])
        assert cited <= retrieved, f"{result.case_id} cited {cited - retrieved}"


@requires_durem
def test_integration_injection_case_does_not_cite_the_injected_id(durem_run):
    for result in durem_run["results"]:
        if result.category == "SRCVAL":
            assert "fake-999" not in (result.response.get("source_ids") or [])


@requires_durem
def test_integration_probe_counters_match_recorded_calls(durem_run):
    for result in durem_run["results"]:
        if not result.ok:
            continue
        probe = result.probe
        assert probe["llm_call_count"] == len(probe["llm_calls"])
        assert (
            probe["classifier_call_count"]
            + probe["policy_generation_call_count"]
            + probe["repair_call_count"]
            + probe["chat_call_count"]
        ) <= probe["llm_call_count"]


@requires_durem
def test_integration_diagnosis_finds_the_discarded_embedding(durem_run):
    findings = {f.finding_id: f for f in diagnosis_mod.diagnose(durem_run["results"])}
    assert "DIAG-001" in findings
    assert findings["DIAG-001"].case_ids


@requires_durem
def test_integration_candidate_a_removes_embeddings_without_quality_loss(durem_run):
    """The candidate must remove exactly the embeddings DIAG-001 identified."""
    from app.durem_eval.harness import aggregate

    session = durem_run["session"]
    cases = durem_run["cases"]
    baseline_totals = durem_run["totals"]
    baseline_grades = durem_run["grades"]

    candidate = candidates_mod.get("durem-cand-a")
    revert = candidate.apply(session)
    try:
        candidate_results = session.run_all(cases)
    finally:
        revert()

    candidate_totals = aggregate(candidate_results)
    candidate_grades = graders_mod.grade_all(cases, candidate_results)

    wasted = len([f for f in diagnosis_mod.diagnose(durem_run["results"]) if f.finding_id == "DIAG-001"][0].case_ids)
    assert candidate_totals.embedding_calls == baseline_totals.embedding_calls - wasted
    # LLM work is untouched: this candidate only removes a discarded embedding.
    assert candidate_totals.llm_calls == baseline_totals.llm_calls
    assert graders_mod.quality_score(candidate_grades) >= graders_mod.quality_score(baseline_grades)
    assert graders_mod.protected_failure_count(candidate_grades) == 0


@requires_durem
def test_integration_candidate_revert_restores_baseline_behaviour(durem_run):
    session = durem_run["session"]
    candidate = candidates_mod.get("durem-cand-a")
    original = session.engine.retrieve_chunks
    revert = candidate.apply(session)
    assert session.engine.retrieve_chunks is not original
    revert()
    assert session.engine.retrieve_chunks is original
