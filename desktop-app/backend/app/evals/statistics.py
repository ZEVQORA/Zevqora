"""Lightweight paired benchmark statistics — deterministic bootstrap CIs."""

from __future__ import annotations

import random
from statistics import mean, median
from typing import Any


def paired_cost_savings(
    baseline_costs: list[float],
    candidate_costs: list[float],
) -> dict[str, float | None]:
    if not baseline_costs or len(baseline_costs) != len(candidate_costs):
        return {
            "baseline_total": None,
            "candidate_total": None,
            "absolute_delta": None,
            "percent_savings": None,
            "mean_baseline_per_case": None,
            "mean_candidate_per_case": None,
            "median_baseline_per_case": None,
            "median_candidate_per_case": None,
        }
    b_total = sum(baseline_costs)
    c_total = sum(candidate_costs)
    pct = ((b_total - c_total) / b_total * 100.0) if b_total else None
    return {
        "baseline_total": round(b_total, 10),
        "candidate_total": round(c_total, 10),
        "absolute_delta": round(c_total - b_total, 10),
        "percent_savings": round(pct, 4) if pct is not None else None,
        "mean_baseline_per_case": round(mean(baseline_costs), 10),
        "mean_candidate_per_case": round(mean(candidate_costs), 10),
        "median_baseline_per_case": round(median(baseline_costs), 10),
        "median_candidate_per_case": round(median(candidate_costs), 10),
    }


def bootstrap_ci(
    baseline_values: list[float],
    candidate_values: list[float],
    *,
    seed: int = 42,
    resamples: int = 2000,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Deterministic paired bootstrap CI for mean per-case cost difference (candidate - baseline)."""
    n = len(baseline_values)
    if n < 5 or n != len(candidate_values):
        return {"sufficient": False, "n": n, "reason": "insufficient_sample_for_ci"}
    diffs = [c - b for b, c in zip(baseline_values, candidate_values, strict=True)]
    rng = random.Random(seed)
    boot_means: list[float] = []
    for _ in range(resamples):
        sample = [diffs[rng.randrange(n)] for _ in range(n)]
        boot_means.append(mean(sample))
    boot_means.sort()
    lo_idx = int((alpha / 2) * resamples)
    hi_idx = int((1 - alpha / 2) * resamples) - 1
    lo_idx = max(0, min(lo_idx, len(boot_means) - 1))
    hi_idx = max(0, min(hi_idx, len(boot_means) - 1))
    observed = mean(diffs)
    b_total = sum(baseline_values)
    pct_samples: list[float] = []
    if b_total > 0:
        for _ in range(resamples):
            idxs = [rng.randrange(n) for _ in range(n)]
            b_s = sum(baseline_values[i] for i in idxs)
            c_s = sum(candidate_values[i] for i in idxs)
            if b_s > 0:
                pct_samples.append((b_s - c_s) / b_s * 100.0)
        pct_samples.sort()
    pct_lo = pct_samples[lo_idx] if pct_samples else None
    pct_hi = pct_samples[hi_idx] if pct_samples else None
    return {
        "sufficient": True,
        "n": n,
        "seed": seed,
        "resamples": resamples,
        "mean_cost_diff": round(observed, 10),
        "ci95_cost_diff_low": round(boot_means[lo_idx], 10),
        "ci95_cost_diff_high": round(boot_means[hi_idx], 10),
        "ci95_percent_savings_low": round(pct_lo, 4) if pct_lo is not None else None,
        "ci95_percent_savings_high": round(pct_hi, 4) if pct_hi is not None else None,
    }
