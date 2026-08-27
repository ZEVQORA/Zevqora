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
    FULL_GATE_CONFIG,
    PHASE4_SPEND_CAP_USD,
    PILOT_CASE_IDS,
    PILOT_GATE_CONFIG,
)
from ..runner import ensure_dataset_version, estimate_run_cost, git_state, run_benchmark, seed_benchmark_product


def _session(db_path: Path):
    ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=db_path.parent / "backups")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)()


def cmd_validate(_: argparse.Namespace) -> int:
    dataset = load_dataset()
    print(f"dataset={dataset.name} version={dataset.version} hash={dataset.dataset_hash}")
    print(f"cases={len(dataset.cases)} distribution={dataset.difficulty_counts}")
    return 0


def cmd_dry_run(args: argparse.Namespace) -> int:
    dataset = load_dataset()
    cases = filter_cases(dataset, args.case_ids.split(",") if args.case_ids else None)
    baseline = args.baseline_model or BENCHMARK_BASELINE_MODEL
    candidate = args.candidate_model or BENCHMARK_CANDIDATE_MODEL
    est = estimate_run_cost(cases, baseline_model=baseline, candidate_model=candidate)
    commit, dirty = git_state()
    print(
        json.dumps(
            {
                "git_commit_sha": commit,
                "git_dirty": dirty,
                "estimate": est,
                "gate_config": FULL_GATE_CONFIG.model_dump(),
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
    dataset = load_dataset()
    if pilot:
        cases = filter_cases(dataset, PILOT_CASE_IDS)
        gate = PILOT_GATE_CONFIG
        label = "pilot"
    else:
        cases = filter_cases(dataset, args.case_ids.split(",") if args.case_ids else None)
        gate = FULL_GATE_CONFIG
        label = "full"
    baseline = args.baseline_model or BENCHMARK_BASELINE_MODEL
    candidate = args.candidate_model or BENCHMARK_CANDIDATE_MODEL
    est = estimate_run_cost(cases, baseline_model=baseline, candidate_model=candidate)
    if not args.mock and est.get("estimated_total_max_usd") and est["estimated_total_max_usd"] > args.max_cost_usd:
        print(f"Refusing run: estimate {est['estimated_total_max_usd']} > cap {args.max_cost_usd}")
        return 2

    out_dir = Path(args.output_dir) if args.output_dir else Path(tempfile.mkdtemp(prefix="zevqora-bench-"))
    db_path = out_dir / "benchmark.db"
    db = _session(db_path)
    try:
        product = seed_benchmark_product(db, root_path=Path(__file__).resolve().parents[3])
        dver = ensure_dataset_version(db, dataset)
        provider = (
            MockProvider(
                default_content="static_scan",
                usage=LLMUsage(input_tokens=20, output_tokens=4, total_tokens=24),
                provider_cost_usd=0.00001,
                latency_ms=5.0,
            )
            if args.mock
            else get_provider("openrouter")
        )
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
        )
        print(f"benchmark_run_id={run.id}")
        print(f"status={run.status}")
        print(f"cost_savings_percent={run.cost_savings_percent}")
        print(f"artifact_dir={run.artifact_dir}")
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
        # try artifacts root
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

    sub.add_parser("validate")
    p_dry = sub.add_parser("dry-run")
    p_dry.add_argument("--baseline-model", default=None)
    p_dry.add_argument("--candidate-model", default=None)
    p_dry.add_argument("--case-ids", default=None)

    for name in ("pilot", "run"):
        p = sub.add_parser(name)
        p.add_argument("--baseline-model", default=None)
        p.add_argument("--candidate-model", default=None)
        p.add_argument("--max-cost-usd", type=float, default=PHASE4_SPEND_CAP_USD)
        p.add_argument("--concurrency", type=int, default=2)
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--output-dir", default=None)
        p.add_argument("--case-ids", default=None)
        p.add_argument("--mock", action="store_true")

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
