"""Load, validate, and hash versioned benchmark datasets."""

from __future__ import annotations

import json
from pathlib import Path

from ..core.hashing import sha256_json
from .models import (
    DATASET_NAME,
    DATASET_PATH,
    DATASET_V2_NAME,
    DATASET_V2_PATH,
    DATASET_V2_VERSION,
    DATASET_VERSION,
    BenchmarkCaseSpec,
    BenchmarkDataset,
)


def canonical_cases_payload(cases: list[BenchmarkCaseSpec]) -> list[dict]:
    """Stable case dump for hashing. Omits empty Phase-4C setup extensions so v1 hash stays valid."""
    out: list[dict] = []
    for c in cases:
        d = c.model_dump(mode="json")
        setup = dict(d.get("setup") or {})
        for k in ("ai_calls", "evaluation_runs", "candidate_executions"):
            if not setup.get(k):
                setup.pop(k, None)
        d["setup"] = setup
        out.append(d)
    return out


def dataset_hash_from_cases(
    cases: list[BenchmarkCaseSpec],
    *,
    name: str,
    version: str,
) -> str:
    return sha256_json(
        {
            "name": name,
            "version": version,
            "cases": canonical_cases_payload(cases),
        }
    )


def difficulty_counts(cases: list[BenchmarkCaseSpec]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in cases:
        counts[c.difficulty] = counts.get(c.difficulty, 0) + 1
    return counts


def load_dataset(path: Path | None = None, *, name: str | None = None) -> BenchmarkDataset:
    if path is None:
        if name == DATASET_V2_NAME:
            path = DATASET_V2_PATH
        else:
            path = DATASET_PATH
    p = Path(path)
    raw = json.loads(p.read_text(encoding="utf-8"))
    cases = [BenchmarkCaseSpec.model_validate(c) for c in raw["cases"]]
    ds_name = raw.get("name") or name or DATASET_NAME
    ds_version = raw.get("version") or (DATASET_V2_VERSION if ds_name == DATASET_V2_NAME else DATASET_VERSION)
    expected_hash = raw.get("dataset_hash")
    computed = dataset_hash_from_cases(cases, name=ds_name, version=ds_version)
    if expected_hash and expected_hash != computed:
        raise ValueError(f"Dataset hash mismatch: file={expected_hash} computed={computed}")
    return BenchmarkDataset(
        name=ds_name,
        version=ds_version,
        dataset_hash=computed,
        cases=cases,
        difficulty_counts=difficulty_counts(cases),
    )


def filter_cases(dataset: BenchmarkDataset, case_ids: list[str] | None = None) -> list[BenchmarkCaseSpec]:
    if not case_ids:
        return list(dataset.cases)
    by_id = {c.case_id: c for c in dataset.cases}
    missing = [cid for cid in case_ids if cid not in by_id]
    if missing:
        raise ValueError(f"Unknown case ids: {missing}")
    return [by_id[cid] for cid in case_ids]
