"""CLI: python -m app.benchmarks.dogfood [validate|pilot|run|report|dry-run]"""

from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ...core.config import settings
from ...core.db_migrate import ensure_schema
from ...providers.factory import get_provider, reset_providers_for_tests
from ...providers.mock import MockProvider
from ...providers.models import LLMUsage
from ..dataset import filter_cases, load_dataset
from ..models import (
    BENCHMARK_BASELINE_MODEL,
    BENCHMARK_CANDIDATE_MODEL,
    BENCHMARK_VERSION,
    BENCHMARK_VERSION_V2,
    CANDIDATE_B_PILOT_CASE_IDS,
    DATASET_NAME,
    DATASET_V2_NAME,
    FULL_GATE_CONFIG,
    FULL_GATE_CONFIG_V2,
    PHASE4_SPEND_CAP_USD,
    PILOT_CASE_IDS,
    PILOT_GATE_CONFIG,
    PILOT_GATE_CONFIG_V2,
    PILOT_V2_CASE_IDS,
)
from ..runner import ensure_dataset_version, estimate_run_cost, git_state, run_benchmark, seed_benchmark_product


def _session(db_path: Path):
    ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=db_path.parent / "backups")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)()


def _dataset_name(args: argparse.Namespace) -> str:
    return getattr(args, "dataset", None) or DATASET_NAME


def cmd_validate(args: argparse.Namespace) -> int:
    dataset = load_dataset(name=_dataset_name(args))
    print(f"dataset={dataset.name} version={dataset.version} hash={dataset.dataset_hash}")
    print(f"cases={len(dataset.cases)} distribution={dataset.difficulty_counts}")
    return 0


def cmd_dry_run(args: argparse.Namespace) -> int:
    name = _dataset_name(args)
    dataset = load_dataset(name=name)
    cases = filter_cases(dataset, args.case_ids.split(",") if args.case_ids else None)
    baseline = args.baseline_model or BENCHMARK_BASELINE_MODEL
    candidate = args.candidate_model or BENCHMARK_CANDIDATE_MODEL
    est = estimate_run_cost(cases, baseline_model=baseline, candidate_model=candidate)
    gate = FULL_GATE_CONFIG_V2 if name == DATASET_V2_NAME else FULL_GATE_CONFIG
    commit, dirty = git_state()
    print(
        json.dumps(
            {
                "git_commit_sha": commit,
                "git_dirty": dirty,
                "dataset": name,
                "estimate": est,
                "gate_config": gate.model_dump(),
            },
            indent=2,
        )
    )
    if est.get("estimated_total_max_usd") and est["estimated_total_max_usd"] > PHASE4_SPEND_CAP_USD:
        print(f"WARNING: conservative estimate {est['estimated_total_max_usd']} exceeds cap {PHASE4_SPEND_CAP_USD}")
        return 2
    return 0


async def _execute(args: argparse.Namespace, *, pilot: bool) -> int:
    if not settings.openrouter_api_key and not args.mock:
        print("FAIL: OPENROUTER_API_KEY required for real benchmark (or pass --mock for validation).")
        return 2
    name = _dataset_name(args)
    dataset = load_dataset(name=name)
    strategy = getattr(args, "strategy", None) or (
        "bounded_routing" if name == DATASET_V2_NAME else "model_substitution"
    )
    if pilot:
        if name == DATASET_V2_NAME:
            cases = filter_cases(dataset, PILOT_V2_CASE_IDS)
            gate = PILOT_GATE_CONFIG_V2
        elif strategy == "bounded_routing":
            cases = filter_cases(dataset, CANDIDATE_B_PILOT_CASE_IDS)
            gate = PILOT_GATE_CONFIG
        else:
            cases = filter_cases(dataset, PILOT_CASE_IDS)
            gate = PILOT_GATE_CONFIG
        label = "pilot"
    else:
        cases = filter_cases(dataset, args.case_ids.split(",") if getattr(args, "case_ids", None) else None)
        gate = FULL_GATE_CONFIG_V2 if name == DATASET_V2_NAME else FULL_GATE_CONFIG
        label = "full"
    baseline = args.baseline_model or BENCHMARK_BASELINE_MODEL
    candidate = args.candidate_model or BENCHMARK_CANDIDATE_MODEL
    est = estimate_run_cost(cases, baseline_model=baseline, candidate_model=candidate)
    if not args.mock and est.get("estimated_total_max_usd") and est["estimated_total_max_usd"] > args.max_cost_usd:
        print(f"Refusing run: estimate {est['estimated_total_max_usd']} > cap {args.max_cost_usd}")
        return 2
    print(
        json.dumps(
            {
                "dataset": name,
                "strategy": strategy,
                "case_count": len(cases),
                "estimate": est,
                "gate_config": gate.model_dump(),
            },
            indent=2,
        )
    )

    import time

    out_dir = Path(args.output_dir) if args.output_dir else Path(tempfile.mkdtemp(prefix="zevqora-bench-"))
    stamp = int(time.time())
    run_root = out_dir / f"{label}-{stamp}"
    run_root.mkdir(parents=True, exist_ok=True)
    db_path = run_root / "benchmark.db"
    db = _session(db_path)
    try:
        product = seed_benchmark_product(db, root_path=run_root / "workspace")
        dver = ensure_dataset_version(db, dataset)
        provider = (
            MockProvider(
                default_content="insufficient",
                usage=LLMUsage(input_tokens=20, output_tokens=4, total_tokens=24),
                provider_cost_usd=0.00001,
                latency_ms=5.0,
            )
            if args.mock
            else get_provider("openrouter")
        )
        if args.mock:
            # Prefer first Allowed labels token so Tier 2 can succeed without always falling back.
            from ...optimization.policies.product_knowledge import extract_allowed_labels

            _orig = provider._content_for

            def _label_aware(request):  # type: ignore[no-untyped-def]
                last_user = next(
                    (m.content for m in reversed(request.messages) if m.role == "user" and m.content),
                    "",
                )
                labels = extract_allowed_labels(str(last_user or ""))
                if labels:
                    return labels[0]
                return _orig(request)

            provider._content_for = _label_aware  # type: ignore[method-assign]
        run = await run_benchmark(
            db,
            cases=cases,
            baseline_model=baseline,
            candidate_model=candidate,
            gate_config=gate,
            provider=provider,
            product=product,
            dataset_version=dver,
            run_label=label,
            seed=args.seed,
            max_cost_usd=args.max_cost_usd,
            concurrency=args.concurrency,
            dry_run=False,
            strategy=strategy,
            cheap_model=getattr(args, "cheap_model", None) or candidate,
            policy_baseline_model=getattr(args, "policy_baseline_model", None) or baseline,
            model_first_baseline=name == DATASET_V2_NAME,
            allow_dirty_git=bool(args.mock),
            benchmark_version=BENCHMARK_VERSION_V2 if name == DATASET_V2_NAME else BENCHMARK_VERSION,
        )
        print(f"benchmark_run_id={run.id}")
        print(f"status={run.status}")
        print(f"strategy={strategy}")
        print(f"dataset={name}")
        print(f"cost_savings_percent={run.cost_savings_percent}")
        print(f"baseline_quality={run.baseline_quality}")
        print(f"candidate_quality={run.candidate_quality}")
        print(f"protected_pass_rate={run.protected_pass_rate}")
        print(f"statistics={run.statistics_json}")
        print(f"artifact_dir={run.artifact_dir}")
        print(f"evidence_hash={run.evidence_hash}")
        return 0 if run.status in {"VERIFIED", "REJECTED", "INCOMPLETE"} else 1
    finally:
        db.close()
        if args.mock:
            reset_providers_for_tests()


def cmd_report(args: argparse.Namespace) -> int:
    run_dir = (
        Path(args.output_dir or ".") / "benchmarks" / args.run_id
        if not args.run_id.startswith("/")
        else Path(args.run_id)
    )
    if not run_dir.exists():
        from ..models import ARTIFACTS_ROOT

        run_dir = ARTIFACTS_ROOT / args.run_id
    report = run_dir / "REPORT.md"
    if not report.exists():
        print(f"Report not found: {report}")
        return 1
    print(report.read_text(encoding="utf-8"))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ZEVQORA internal dogfood benchmark")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_val = sub.add_parser("validate")
    p_val.add_argument("--dataset", default=DATASET_NAME, choices=[DATASET_NAME, DATASET_V2_NAME])

    p_dry = sub.add_parser("dry-run")
    p_dry.add_argument("--dataset", default=DATASET_NAME, choices=[DATASET_NAME, DATASET_V2_NAME])
    p_dry.add_argument("--baseline-model", default=None)
    p_dry.add_argument("--candidate-model", default=None)
    p_dry.add_argument("--case-ids", default=None)

    for name in ("pilot", "run"):
        p = sub.add_parser(name)
        p.add_argument("--dataset", default=DATASET_NAME, choices=[DATASET_NAME, DATASET_V2_NAME])
        p.add_argument("--baseline-model", default=None)
        p.add_argument("--candidate-model", default=None)
        p.add_argument("--max-cost-usd", type=float, default=PHASE4_SPEND_CAP_USD)
        p.add_argument("--concurrency", type=int, default=2)
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--output-dir", default=None)
        p.add_argument("--case-ids", default=None)
        p.add_argument("--mock", action="store_true")
        p.add_argument(
            "--strategy",
            default=None,
            choices=["model_substitution", "bounded_routing"],
        )
        p.add_argument("--cheap-model", default=None)
        p.add_argument("--policy-baseline-model", default=None)

    p_rep = sub.add_parser("report")
    p_rep.add_argument("--run-id", required=True)
    p_rep.add_argument("--output-dir", default=None)

    args = parser.parse_args(argv)
    if args.cmd == "validate":
        return cmd_validate(args)
    if args.cmd == "dry-run":
        return cmd_dry_run(args)
    if args.cmd == "pilot":
        return asyncio.run(_execute(args, pilot=True))
    if args.cmd == "run":
        return asyncio.run(_execute(args, pilot=False))
    if args.cmd == "report":
        return cmd_report(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
