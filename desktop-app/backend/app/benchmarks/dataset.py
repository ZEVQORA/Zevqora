"""Load, validate, and hash versioned benchmark datasets."""

from __future__ import annotations

import json
from pathlib import Path

from ..core.hashing import sha256_json
from .models import DATASET_NAME, DATASET_PATH, DATASET_VERSION, BenchmarkCaseSpec, BenchmarkDataset


def canonical_cases_payload(cases: list[BenchmarkCaseSpec]) -> list[dict]:
    return [c.model_dump(mode="json") for c in cases]


def dataset_hash_from_cases(cases: list[BenchmarkCaseSpec]) -> str:
    return sha256_json(
        {
            "name": DATASET_NAME,
            "version": DATASET_VERSION,
            "cases": canonical_cases_payload(cases),
        }
    )


def difficulty_counts(cases: list[BenchmarkCaseSpec]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in cases:
        counts[c.difficulty] = counts.get(c.difficulty, 0) + 1
    return counts


def load_dataset(path: Path | None = None) -> BenchmarkDataset:
    p = path or DATASET_PATH
    raw = json.loads(p.read_text(encoding="utf-8"))
    cases = [BenchmarkCaseSpec.model_validate(c) for c in raw["cases"]]
    expected_hash = raw.get("dataset_hash")
    computed = dataset_hash_from_cases(cases)
    if expected_hash and expected_hash != computed:
        raise ValueError(f"Dataset hash mismatch: file={expected_hash} computed={computed}")
    return BenchmarkDataset(
        name=raw.get("name", DATASET_NAME),
        version=raw.get("version", DATASET_VERSION),
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
