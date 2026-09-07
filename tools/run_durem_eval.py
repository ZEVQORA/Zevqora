#!/usr/bin/env python3
"""One-command DUREM baseline / candidate runner.

    python tools/run_durem_eval.py --mode baseline
    python tools/run_durem_eval.py --mode candidate --candidate durem-cand-a
    python tools/run_durem_eval.py --mode compare  --candidate durem-cand-a

Runtimes
    --runtime mock    deterministic stub over real HTTP (works on any machine)
    --runtime local   a real Lemonade server (--runtime-url)

Datasets
    --dataset representative   synthetic fixtures committed to this repo
    --dataset local-real       sanitized real fixtures from --fixtures-dir (never committed)

The mock runtime exercises the whole architecture -- routing, retrieval, ACL
filtering, source validation, instrumentation and gates -- without a local model.
Counters measured that way are real; token counts and timings are not, and the
runner labels them SYNTHETIC_TEST_METRIC and refuses to call them evidence.
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "desktop-app" / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _default_durem_repo() -> Path:
    env = os.environ.get("DUREM_REPO_PATH")
    if env:
        return Path(env)
    return REPO_ROOT.parent / "Durem_AI"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DUREM evaluation runner")
    parser.add_argument(
        "--mode",
        choices=["baseline", "candidate", "compare", "diagnose", "list-candidates"],
        default="baseline",
    )
    parser.add_argument("--runtime", choices=["mock", "local"], default="mock")
    parser.add_argument("--runtime-url", default="http://127.0.0.1:13305")
    parser.add_argument(
        "--dataset", choices=["representative", "local-real"], default="representative"
    )
    parser.add_argument(
        "--fixtures-dir",
        default=None,
        help="directory holding sanitized real fixtures (--dataset local-real)",
    )
    parser.add_argument(
        "--durem-repo", default=None, help="path to the DUREM repository"
    )
    parser.add_argument("--candidate", default="durem-cand-a")
    parser.add_argument(
        "--out-dir", default=str(REPO_ROOT / "artifacts" / "durem-eval")
    )
    parser.add_argument(
        "--work-dir", default=None, help="scratch dir for the DUREM database"
    )
    parser.add_argument(
        "--metric",
        default="llm_calls",
        help="primary comparison metric (llm_calls, embedding_calls, "
        "model_work_units, inference_ms, total_tokens, ...)",
    )
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument(
        "--emit-traces",
        action="store_true",
        help="also write ZEVQORA TraceIn payloads as JSONL",
    )
    args = parser.parse_args(argv)

    from app.durem_eval import candidates as candidates_mod

    if args.mode == "list-candidates":
        import json

        print(json.dumps(candidates_mod.list_candidates(), indent=2))
        return 0

    from app.durem_eval import diagnosis as diagnosis_mod
    from app.durem_eval import fixtures as fixtures_mod
    from app.durem_eval import gates as gates_mod
    from app.durem_eval import graders as graders_mod
    from app.durem_eval import report as report_mod
    from app.durem_eval.harness import DuremSession, aggregate
    from app.durem_eval.metrics import select_metric
    from app.durem_eval.runtime import (
        MockRuntimeServer,
        local_descriptor,
        probe_local_runtime,
    )

    durem_repo = Path(args.durem_repo) if args.durem_repo else _default_durem_repo()
    out_dir = Path(args.out_dir)
    work_dir = Path(args.work_dir) if args.work_dir else out_dir / "work"
    run_id = f"durem-{args.mode}-{uuid.uuid4().hex[:10]}"

    server: MockRuntimeServer | None = None
    if args.runtime == "mock":
        server = MockRuntimeServer().start()
        runtime = server.descriptor()
    else:
        probe = probe_local_runtime(args.runtime_url)
        if not probe.get("reachable"):
            print(
                f"ERROR: local runtime unreachable at {args.runtime_url}: {probe.get('error')}"
            )
            print("Start Lemonade, or use --runtime mock.")
            return 2
        runtime = local_descriptor(args.runtime_url)
        print(f"local runtime models: {probe.get('models')}")

    try:
        session = DuremSession(
            durem_repo=durem_repo, data_dir=work_dir, runtime=runtime
        )

        if args.dataset == "representative":
            session.build_representative_db()
            cases = fixtures_mod.build_cases()
            dataset_meta = fixtures_mod.manifest()
        else:
            fixtures_dir = Path(args.fixtures_dir or "")
            cases, db_file = fixtures_mod.load_local_real_cases(fixtures_dir)
            dataset_meta = {
                "fixture_set": "durem_local_real",
                "provenance": "SANITIZED_REAL_LOCAL_ONLY",
                "case_count": len(cases),
                "source_dir": str(fixtures_dir),
                "database": str(db_file),
            }

        print(
            f"[{run_id}] runtime={runtime.kind} dataset={args.dataset} cases={len(cases)}"
        )

        # ---- baseline arm -------------------------------------------------
        baseline_results = session.run_all(cases)
        baseline_totals = aggregate(baseline_results)
        baseline_grades = graders_mod.grade_all(cases, baseline_results)
        baseline_errors = sum(1 for r in baseline_results if not r.ok)
        diagnosis = diagnosis_mod.summarize(baseline_results)

        gate_config = (
            gates_mod.REAL_GATE_CONFIG
            if runtime.is_real
            else gates_mod.MOCK_GATE_CONFIG
        )
        gate_config.min_samples = min(gate_config.min_samples, len(cases))

        if args.mode in {"baseline", "diagnose"}:
            metric = select_metric(
                name=args.metric,
                baseline=baseline_totals,
                candidate=None,
                runtime_is_real=runtime.is_real,
            )
            gate_report = gates_mod.evaluate(
                config=gate_config,
                baseline_grades=baseline_grades,
                candidate_grades=None,
                metric=None,
                case_errors=baseline_errors,
            )
            report = report_mod.build_report(
                run_id=run_id,
                mode="baseline",
                runtime=runtime.as_dict(),
                dataset=dataset_meta,
                totals=baseline_totals,
                grades=baseline_grades,
                gate_report=gate_report,
                metric=metric,
                diagnosis=diagnosis,
                case_errors=baseline_errors,
            )
            path = report.write(out_dir / f"{run_id}.json")
            _print_summary(report, gate_report, baseline_totals, None, metric)
            print(f"\nreport: {path}")
            if args.mode == "diagnose":
                _print_diagnosis(diagnosis)
            if args.emit_traces:
                payloads = report_mod.to_trace_payloads(
                    baseline_results,
                    runtime=runtime.as_dict(),
                    dataset_name=dataset_meta.get("fixture_set", "durem"),
                )
                tp = report_mod.write_traces_jsonl(
                    payloads, out_dir / f"{run_id}.traces.jsonl"
                )
                print(f"traces: {tp}")
            return 0

        # ---- candidate arm ------------------------------------------------
        candidate = candidates_mod.get(args.candidate)
        print(
            f"[{run_id}] applying candidate {candidate.candidate_id}: {candidate.title}"
        )
        revert = candidate.apply(session)
        try:
            candidate_results = session.run_all(cases)
        finally:
            revert()

        candidate_totals = aggregate(candidate_results)
        candidate_grades = graders_mod.grade_all(cases, candidate_results)
        candidate_errors = sum(1 for r in candidate_results if not r.ok)

        metric = select_metric(
            name=args.metric,
            baseline=baseline_totals,
            candidate=candidate_totals,
            runtime_is_real=runtime.is_real,
        )
        gate_report = gates_mod.evaluate(
            config=gate_config,
            baseline_grades=baseline_grades,
            candidate_grades=candidate_grades,
            metric=metric,
            baseline_latency_ms=baseline_totals.end_to_end_ms,
            candidate_latency_ms=candidate_totals.end_to_end_ms,
            case_errors=candidate_errors,
        )
        report = report_mod.build_report(
            run_id=run_id,
            mode="candidate",
            runtime=runtime.as_dict(),
            dataset=dataset_meta,
            totals=candidate_totals,
            grades=candidate_grades,
            gate_report=gate_report,
            metric=metric,
            candidate=candidate.as_dict(),
            diagnosis=diagnosis,
            case_errors=candidate_errors,
        )
        comparison = report_mod.comparison_summary(
            baseline_totals=baseline_totals,
            candidate_totals=candidate_totals,
            metric=metric,
            gate_report=gate_report,
        )
        report_dict = report.as_dict()
        report_dict["comparison"] = comparison
        path = out_dir / f"{run_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        import json

        path.write_text(
            json.dumps(report_dict, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        _print_summary(report, gate_report, baseline_totals, candidate_totals, metric)
        _print_diagnosis(diagnosis)
        print(f"\nreport: {path}")
        if args.emit_traces:
            payloads = report_mod.to_trace_payloads(
                candidate_results,
                runtime=runtime.as_dict(),
                dataset_name=dataset_meta.get("fixture_set", "durem"),
            )
            tp = report_mod.write_traces_jsonl(
                payloads, out_dir / f"{run_id}.traces.jsonl"
            )
            print(f"traces: {tp}")
        return 0 if gate_report.status == "VERIFIED" else 1
    finally:
        if server is not None:
            server.stop()


def _print_summary(
    report, gate_report, baseline_totals, candidate_totals, metric
) -> None:
    print("\n" + "=" * 68)
    print(f"VERDICT: {gate_report.status}")
    print("=" * 68)
    print(f"quality           : {report.quality}")
    print(f"case errors       : {report.case_errors}")
    print(f"primary metric    : {metric.name}")
    print(f"  baseline        : {metric.baseline_value}")
    if candidate_totals is not None:
        print(f"  candidate       : {metric.candidate_value}")
        print(f"  reduction       : {metric.reduction_pct}%")
    print(f"  fidelity        : {metric.fidelity.value}")
    print(f"  reportable      : {metric.reportable}")
    print("\ncounters (baseline" + (" -> candidate)" if candidate_totals else ")"))
    base = baseline_totals.as_dict()
    cand = candidate_totals.as_dict() if candidate_totals else {}
    for key in (
        "llm_calls",
        "classifier_calls",
        "policy_generation_calls",
        "repair_calls",
        "chat_calls",
        "embedding_calls",
        "retrieved_context_units",
        "input_tokens",
        "output_tokens",
        "inference_ms",
        "end_to_end_ms",
    ):
        if candidate_totals:
            print(f"  {key:<26}: {base.get(key)} -> {cand.get(key)}")
        else:
            print(f"  {key:<26}: {base.get(key)}")
    failed = [
        g
        for g in gate_report.gates
        if g.required and g.outcome.value in {"failed", "missing"}
    ]
    if failed:
        print("\nfailing/missing required gates:")
        for gate in failed:
            print(f"  [{gate.outcome.value.upper()}] {gate.name}: {gate.reason}")
            print(f"        observed={gate.observed}")
    print(f"\n{report.disclosure}")


def _print_diagnosis(diagnosis: dict) -> None:
    print("\ndiagnosis findings:")
    for finding in diagnosis.get("findings", []):
        print(
            f"  [{finding['severity'].upper():<6}] {finding['finding_id']}: {finding['title']}"
        )
        print(
            f"           cases={finding['case_count']} observed={finding['observed']}"
        )
    print(
        "  (excluded as already-optimized by DUREM: "
        + ", ".join(f["finding_id"] for f in diagnosis.get("already_optimized", []))
        + ")"
    )


if __name__ == "__main__":
    raise SystemExit(main())
