"""Reproducible provider-backed ZEVQORA dogfood benchmark runner."""

from __future__ import annotations

import asyncio
import json
import subprocess
import uuid
from pathlib import Path
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.content import bound_text
from ..core.hashing import sha256_json
from ..db_models import (
    BenchmarkCaseResult,
    BenchmarkDatasetVersion,
    BenchmarkRun,
    Product,
    Trace,
    utcnow,
)
from ..evals.models import EvaluationCaseSpec, GateConfig, GraderSpec
from ..evals.provenance import gate_config_hash, grader_config_hash
from ..evals.runner import create_and_run_evaluation
from ..evals.statistics import bootstrap_ci, paired_cost_savings
from ..evidence.replay import ReplayableRequestSnapshot
from ..optimization.executor import execute_plan
from ..optimization.fingerprints import task_fingerprint_from_trace
from ..optimization.planner import create_plans
from ..providers.base import LLMProvider
from ..providers.factory import get_provider
from ..providers.models import LLMMessage, ToolDefinition
from .artifacts import write_benchmark_artifacts
from .models import (
    BENCHMARK_VERSION,
    PHASE4_SPEND_CAP_USD,
    BenchmarkCaseSpec,
)


class BenchmarkError(RuntimeError):
    pass


def git_state(repo_root: Path | None = None) -> tuple[str | None, bool]:
    root = repo_root or Path(__file__).resolve().parents[3]
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        commit = sha.stdout.strip() if sha.returncode == 0 else None
        is_dirty = bool(dirty.stdout.strip()) if dirty.returncode == 0 else True
        return commit, is_dirty
    except OSError:
        return None, True


def _snapshot_from_case(case: BenchmarkCaseSpec) -> ReplayableRequestSnapshot:
    messages = [LLMMessage.model_validate(m) for m in case.request.messages]
    tools = [ToolDefinition.model_validate(t) for t in case.request.tools] if case.request.tools else None
    return ReplayableRequestSnapshot(
        messages=messages,
        tools=tools,
        tool_choice=case.request.tool_choice,
        temperature=case.request.temperature,
        max_tokens=case.request.max_tokens,
        workflow=case.request.workflow,
        symbol=case.request.symbol,
        source_case_id=case.case_id,
        metadata={"benchmark_case_id": case.case_id, "difficulty": case.difficulty},
    )


async def execute_baseline_case(
    db: Session,
    *,
    product_id: str,
    case: BenchmarkCaseSpec,
    model: str,
    provider: LLMProvider,
    run_id: str,
) -> Trace:
    snapshot = _snapshot_from_case(case)
    request = snapshot.to_llm_request(provider=provider.name, model=model)
    response = await provider.complete(request)
    bounded = bound_text(response.content)
    cost = response.cost
    trace = Trace(
        id=str(uuid.uuid4()),
        product_id=product_id,
        request_id=f"bench-{run_id}-{case.case_id}-baseline",
        timestamp=utcnow(),
        symbol=case.request.symbol,
        workflow=case.request.workflow,
        provider=response.provider,
        model=response.resolved_model or model,
        requested_model=response.requested_model,
        response_model=response.resolved_model,
        provider_request_id=response.provider_request_id,
        input_text=messages_to_flat_text(case.request.messages),
        output_text=bounded.text,
        expected_output=str(case.expected) if case.expected is not None else None,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cached_input_tokens=response.usage.cached_input_tokens,
        reasoning_tokens=response.usage.reasoning_tokens,
        latency_ms=response.latency_ms,
        cost_usd=cost.cost_usd if cost else None,
        cost_source=cost.cost_source.value if cost and cost.cost_source else None,
        pricing_version=cost.pricing_version if cost else None,
        input_hash=snapshot.snapshot_hash(),
        output_hash=bounded.full_hash,
        protected=case.protected,
        request_snapshot_json=snapshot.model_dump_json(),
        request_snapshot_hash=snapshot.snapshot_hash(),
        metadata_json=json.dumps(
            {
                "benchmark_run_id": run_id,
                "benchmark_case_id": case.case_id,
                "execution_role": "baseline",
                "tool_calls": [tc.model_dump() for tc in response.tool_calls],
                "finish_reason": response.finish_reason.value,
                "required_tools": list(case.required_tools or []),
                "forbidden_tools": list(case.forbidden_tools or []),
            },
            ensure_ascii=False,
        ),
    )
    db.add(trace)
    db.commit()
    db.refresh(trace)
    return trace


def messages_to_flat_text(messages: list[dict]) -> str:
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content") or ""
        parts.append(f"[{role}] {content}")
    return "\n".join(parts)


def ensure_dataset_version(db: Session, dataset) -> BenchmarkDatasetVersion:
    existing = db.scalar(
        select(BenchmarkDatasetVersion).where(BenchmarkDatasetVersion.dataset_hash == dataset.dataset_hash)
    )
    if existing:
        return existing
    row = BenchmarkDatasetVersion(
        id=str(uuid.uuid4()),
        name=dataset.name,
        version=dataset.version,
        dataset_hash=dataset.dataset_hash,
        case_count=len(dataset.cases),
        case_manifest_json=json.dumps([c.case_id for c in dataset.cases], ensure_ascii=False),
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def estimate_run_cost(cases: list[BenchmarkCaseSpec], *, baseline_model: str, candidate_model: str) -> dict[str, Any]:
    """Conservative estimate using token ceilings — not a spend authorization alone."""
    from ..optimization.strategies.model_substitution import estimate_sample_cost_usd

    class _StubTrace:
        def __init__(self, text: str, max_out: int):
            self.input_text = text
            self.expected_output = None
            self.output_tokens = max_out
            self.input_tokens = max(len(text) // 4, 64)
            self.cached_input_tokens = 0

    per_case_b: list[float] = []
    per_case_c: list[float] = []
    for case in cases:
        text = messages_to_flat_text(case.request.messages)
        stub = _StubTrace(text, case.request.max_tokens)
        be = estimate_sample_cost_usd(baseline_model, stub, max_output_tokens=case.request.max_tokens)  # type: ignore[arg-type]
        ce = estimate_sample_cost_usd(candidate_model, stub, max_output_tokens=case.request.max_tokens)  # type: ignore[arg-type]
        if be is not None:
            per_case_b.append(be)
        elif case.request.max_tokens:
            per_case_b.append(0.00015 * max(case.request.max_tokens, 32))
        if ce is not None:
            per_case_c.append(ce)
        elif case.request.max_tokens:
            per_case_c.append(0.00008 * max(case.request.max_tokens, 32))
    return {
        "case_count": len(cases),
        "provider_calls": len(cases) * 2,
        "baseline_model": baseline_model,
        "candidate_model": candidate_model,
        "estimated_baseline_max_usd": round(sum(per_case_b), 6) if per_case_b else None,
        "estimated_candidate_max_usd": round(sum(per_case_c), 6) if per_case_c else None,
        "estimated_total_max_usd": round(sum(per_case_b) + sum(per_case_c), 6) if per_case_b and per_case_c else None,
        "budget_cap_usd": PHASE4_SPEND_CAP_USD,
        "pricing_note": "Uses packaged snapshot rates when available; live provider_reported may differ.",
    }


async def run_benchmark(
    db: Session,
    *,
    cases: list[BenchmarkCaseSpec],
    baseline_model: str,
    candidate_model: str,
    gate_config: GateConfig,
    provider: LLMProvider | None = None,
    product: Product,
    dataset_version: BenchmarkDatasetVersion,
    run_label: str = "full",
    seed: int = 42,
    max_cost_usd: float = PHASE4_SPEND_CAP_USD,
    concurrency: int = 2,
    resume_run_id: str | None = None,
    dry_run: bool = False,
    strategy: str = "model_substitution",
    cheap_model: str | None = None,
    policy_baseline_model: str | None = None,
) -> BenchmarkRun:
    commit_sha, dirty = git_state()
    if not dry_run and dirty:
        raise BenchmarkError("Refusing real benchmark on dirty git working tree. Commit first.")

    llm = provider or get_provider("openrouter")
    candidate_cfg_meta: dict[str, Any] = {"model": candidate_model, "strategy": strategy}
    if strategy == "bounded_routing":
        candidate_cfg_meta.update(
            {
                "policy_version": "bounded_routing_v1.0.0",
                "cheap_model": cheap_model or candidate_model,
                "baseline_model": policy_baseline_model or baseline_model,
            }
        )
    if dry_run:
        run = BenchmarkRun(
            id=str(uuid.uuid4()),
            product_id=product.id,
            dataset_version_id=dataset_version.id,
            status="PLANNED",
            benchmark_version=BENCHMARK_VERSION,
            baseline_config_json=json.dumps({"model": baseline_model, "label": run_label}, ensure_ascii=False),
            candidate_config_json=json.dumps(candidate_cfg_meta, ensure_ascii=False),
            baseline_model=baseline_model,
            candidate_model=candidate_model,
            git_commit_sha=commit_sha,
            git_dirty=dirty,
            seed=seed,
            case_count=len(cases),
            gate_config_hash=gate_config_hash(gate_config),
            grader_config_hash=grader_config_hash(
                [
                    EvaluationCaseSpec(case_id=c.case_id, baseline_trace_id="x", graders=c.graders, expected=c.expected)
                    for c in cases
                ]
            ),
        )
        db.add(run)
        db.commit()
        return run

    run_id = resume_run_id or str(uuid.uuid4())
    if resume_run_id:
        run = db.scalar(select(BenchmarkRun).where(BenchmarkRun.id == resume_run_id))
        if not run:
            raise BenchmarkError("Resume run not found.")
    else:
        frozen_cfg = {**candidate_cfg_meta, "frozen": True}
        run = BenchmarkRun(
            id=run_id,
            product_id=product.id,
            dataset_version_id=dataset_version.id,
            status="RUNNING",
            benchmark_version=BENCHMARK_VERSION,
            baseline_config_json=json.dumps(
                {"model": baseline_model, "label": run_label, "frozen": True}, ensure_ascii=False
            ),
            candidate_config_json=json.dumps(frozen_cfg, ensure_ascii=False),
            baseline_model=baseline_model,
            candidate_model=candidate_model,
            git_commit_sha=commit_sha,
            git_dirty=dirty,
            seed=seed,
            case_count=len(cases),
            protected_case_count=sum(1 for c in cases if c.protected),
            gate_config_hash=gate_config_hash(gate_config),
            grader_config_hash=grader_config_hash(
                [
                    EvaluationCaseSpec(
                        case_id=c.case_id, baseline_trace_id="pending", graders=c.graders, expected=c.expected
                    )
                    for c in cases
                ]
            ),
            started_at=utcnow(),
            created_at=utcnow(),
        )
        db.add(run)
        db.commit()

    spent = 0.0
    baseline_traces: dict[str, Trace] = {}
    existing = {
        r.case_id: r
        for r in db.scalars(select(BenchmarkCaseResult).where(BenchmarkCaseResult.benchmark_run_id == run.id))
    }

    sem = asyncio.Semaphore(concurrency)

    async def _baseline(case: BenchmarkCaseSpec) -> None:
        nonlocal spent
        if case.case_id in existing and existing[case.case_id].baseline_trace_id:
            tid = existing[case.case_id].baseline_trace_id
            trace = db.get(Trace, tid)
            if trace:
                baseline_traces[case.case_id] = trace
                return
        async with sem:
            trace = await execute_baseline_case(
                db, product_id=product.id, case=case, model=baseline_model, provider=llm, run_id=run.id
            )
            if trace.cost_usd:
                spent += trace.cost_usd
                if spent > max_cost_usd:
                    raise BenchmarkError(f"Phase 4 spend cap exceeded during baseline: {spent:.6f} > {max_cost_usd}")
            baseline_traces[case.case_id] = trace
            row = existing.get(case.case_id) or BenchmarkCaseResult(
                id=str(uuid.uuid4()),
                benchmark_run_id=run.id,
                case_id=case.case_id,
                difficulty=case.difficulty,
                protected=case.protected,
            )
            row.baseline_trace_id = trace.id
            row.baseline_model = trace.model
            row.baseline_output_hash = trace.output_hash
            row.baseline_cost_usd = trace.cost_usd
            row.baseline_cost_source = trace.cost_source
            row.baseline_latency_ms = trace.latency_ms
            row.task_fingerprint = task_fingerprint_from_trace(trace)
            row.comparable = True
            db.merge(row)
            db.commit()

    for case in cases:
        await _baseline(case)

    # Candidate via product path
    import app.core.config as config_mod

    models_to_allow = {candidate_model}
    if strategy == "bounded_routing":
        models_to_allow.add(cheap_model or candidate_model)
        models_to_allow.add(policy_baseline_model or baseline_model)
    config_mod.settings.candidate_models = tuple(set(config_mod.settings.candidate_models) | models_to_allow)
    config_mod.settings.max_candidate_samples = max(len(cases), config_mod.settings.max_candidate_samples)
    trace_ids = [t.id for t in baseline_traces.values()]
    plans = create_plans(
        db,
        product.id,
        strategy=strategy,
        candidate_model=candidate_model,
        max_budget_usd=max_cost_usd - spent,
        include_protected=True,
        sample_trace_ids=trace_ids,
    )
    plan = plans[0]
    if plan.status != "READY":
        run.status = "FAILED"
        run.failure_reason = plan.blocked_reason or "Candidate plan blocked"
        run.completed_at = utcnow()
        db.add(run)
        db.commit()
        return run

    # Override max_tokens from case snapshots via plan candidate config
    cfg = json.loads(plan.candidate_config_json or "{}")
    cfg["max_tokens"] = max(c.request.max_tokens for c in cases)
    cfg["benchmark_mode"] = True
    if strategy == "bounded_routing":
        cfg["cheap_model"] = cheap_model or candidate_model
        cfg["baseline_model"] = policy_baseline_model or baseline_model
        cfg["model"] = cfg["cheap_model"]
    plan.candidate_config_json = json.dumps(cfg, ensure_ascii=False)
    db.add(plan)
    db.commit()

    execution = await execute_plan(db, product.id, plan.id, provider=llm)
    run.candidate_execution_id = execution.id
    if execution.cost_usd:
        spent += execution.cost_usd

    samples = json.loads(execution.sample_results_json or "[]")
    sample_by_baseline = {s.get("baseline_trace_id"): s for s in samples}

    eval_cases: list[EvaluationCaseSpec] = []
    for case in cases:
        trace = baseline_traces[case.case_id]
        graders: list[GraderSpec] = []
        for g in case.graders:
            cfg = dict(g.config or {})
            if g.name == "tool_arguments":
                req = dict(cfg.get("required_args") or {})
                if req.get("product_id") == "BENCHMARK_PRODUCT":
                    req["product_id"] = product.id
                    cfg["required_args"] = req
            graders.append(GraderSpec(name=g.name, version=g.version, config=cfg))
        eval_cases.append(
            EvaluationCaseSpec(
                case_id=case.case_id,
                baseline_trace_id=trace.id,
                protected=case.protected,
                graders=graders,
                expected=case.expected,
                required_tools=case.required_tools,
                forbidden_tools=case.forbidden_tools,
                allowed_tools=case.allowed_tools,
            )
        )

    evaluation = create_and_run_evaluation(
        db,
        product.id,
        candidate_execution_id=execution.id,
        cases=eval_cases,
        gate_config=gate_config,
        project_experiment=False,
    )
    run.evaluation_run_id = evaluation.id

    # Aggregate economics from comparable cases
    b_costs: list[float] = []
    c_costs: list[float] = []
    b_lats: list[float] = []
    c_lats: list[float] = []
    protected_pass = 0
    protected_total = 0
    route_counts = {"deterministic": 0, "cheap_bounded": 0, "baseline_strong": 0, "fallback": 0}

    for case in cases:
        trace = baseline_traces[case.case_id]
        sample = sample_by_baseline.get(trace.id)
        task_fp_b = task_fingerprint_from_trace(trace)
        task_fp_c = sample.get("task_fingerprint") if sample else None
        comparable = bool(sample and task_fp_c == task_fp_b)
        row = db.scalar(
            select(BenchmarkCaseResult).where(
                BenchmarkCaseResult.benchmark_run_id == run.id,
                BenchmarkCaseResult.case_id == case.case_id,
            )
        )
        if not row:
            row = BenchmarkCaseResult(
                id=str(uuid.uuid4()),
                benchmark_run_id=run.id,
                case_id=case.case_id,
                difficulty=case.difficulty,
                protected=case.protected,
            )
        if sample:
            row.candidate_execution_id = execution.id
            row.candidate_model = sample.get("resolved_model") or sample.get("requested_model")
            row.candidate_output_hash = sample.get("output_hash")
            row.candidate_cost_usd = sample.get("cost_usd")
            row.candidate_cost_source = sample.get("cost_source")
            row.candidate_latency_ms = sample.get("latency_ms")
            final_route = sample.get("final_route") or sample.get("route_selected")
            if final_route in route_counts:
                route_counts[final_route] += 1
            if sample.get("fallback_occurred"):
                route_counts["fallback"] += 1
        row.task_fingerprint = task_fp_b
        row.comparable = comparable
        if comparable and trace.cost_usd is not None and sample and sample.get("cost_usd") is not None:
            b_costs.append(trace.cost_usd)
            c_costs.append(float(sample["cost_usd"]))
        if trace.latency_ms is not None:
            b_lats.append(trace.latency_ms)
        if sample and sample.get("latency_ms") is not None:
            c_lats.append(float(sample["latency_ms"]))
        if case.protected:
            protected_total += 1
            # pull eval case result
            from ..db_models import EvaluationCaseResult

            er = db.scalar(
                select(EvaluationCaseResult).where(
                    EvaluationCaseResult.evaluation_run_id == evaluation.id,
                    EvaluationCaseResult.case_id == case.case_id,
                )
            )
            if er and er.candidate_score is not None and er.candidate_score >= 1.0:
                protected_pass += 1
            row.candidate_quality = er.candidate_score if er else None
            row.baseline_quality = er.baseline_score if er else None
        db.add(row)

    stats = paired_cost_savings(b_costs, c_costs)
    ci = bootstrap_ci(b_costs, c_costs, seed=seed) if len(b_costs) >= 5 else {"sufficient": False, "n": len(b_costs)}

    run.baseline_total_cost = stats.get("baseline_total")
    run.candidate_total_cost = stats.get("candidate_total")
    run.absolute_cost_delta = stats.get("absolute_delta")
    run.cost_savings_percent = stats.get("percent_savings")
    run.baseline_quality = evaluation.baseline_quality
    run.candidate_quality = evaluation.candidate_quality
    run.quality_delta = evaluation.quality_delta
    run.baseline_latency_ms = mean(b_lats) if b_lats else evaluation.baseline_latency_ms
    run.candidate_latency_ms = mean(c_lats) if c_lats else evaluation.candidate_latency_ms
    if run.baseline_latency_ms is not None and run.candidate_latency_ms is not None:
        run.latency_delta_ms = run.candidate_latency_ms - run.baseline_latency_ms
    run.protected_pass_rate = (protected_pass / protected_total) if protected_total else None
    run.completed_case_count = len(cases)
    run.statistics_json = json.dumps(
        {"paired": stats, "bootstrap": ci, "route_distribution": route_counts},
        ensure_ascii=False,
    )
    run.status = evaluation.status
    run.failure_reason = evaluation.rejection_reason
    run.evidence_hash = sha256_json(
        {
            "run_id": run.id,
            "dataset_hash": dataset_version.dataset_hash,
            "gate_config_hash": run.gate_config_hash,
            "evaluation_evidence": evaluation.evidence_version,
            "git_commit_sha": run.git_commit_sha,
            "strategy": strategy,
            "candidate_config": candidate_cfg_meta,
        }
    )
    run.completed_at = utcnow()
    artifact_dir = write_benchmark_artifacts(run, evaluation, cases, baseline_traces, samples, stats, ci)
    run.artifact_dir = str(artifact_dir)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def seed_benchmark_product(db: Session, *, root_path: Path) -> Product:
    root_path = Path(root_path)
    root_path.mkdir(parents=True, exist_ok=True)
    # Minimal safe source file so scan_workspace can execute against a real workspace.
    sample = root_path / "README.md"
    if not sample.exists():
        sample.write_text("# ZEVQORA Benchmark Workspace\n", encoding="utf-8")
    product = Product(
        id=str(uuid.uuid4()),
        name="ZEVQORA Dogfood Benchmark",
        root_path=str(root_path.resolve()),
        monitoring_enabled=False,
        created_at=utcnow(),
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product
