"""Phase 4 internal dogfooding benchmark — versioned models and frozen gate config."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from ..evals.models import GateConfig, GraderSpec

BENCHMARK_VERSION = "dogfood_v1"
DATASET_NAME = "zev_dogfood_v1"
DATASET_VERSION = "1.0.0"
PHASE4_SPEND_CAP_USD = 2.0
DEFAULT_SEED = 42
DEFAULT_CONCURRENCY = 2

# Pinned internal benchmark baseline — NOT production openrouter/auto traffic.
BENCHMARK_BASELINE_MODEL = "openai/gpt-4o-mini"
# Cheaper candidate verified during pilot dry-run against live OpenRouter catalog.
BENCHMARK_CANDIDATE_MODEL = "google/gemini-2.0-flash-001"

PILOT_CASE_IDS = [
    "simple-001",
    "simple-005",
    "simple-010",
    "simple-015",
    "medium-001",
    "medium-005",
    "medium-010",
    "complex-001",
    "complex-005",
    "protected-001",
]

# Frozen BEFORE full candidate run — do not tune post hoc.
FULL_GATE_CONFIG = GateConfig(
    min_samples=50,
    quality_floor=0.95,
    non_inferiority_tolerance=0.02,
    require_cost_improvement=True,
    require_latency=True,
    max_latency_regression_pct=50.0,
    require_fallback=True,
)

PILOT_GATE_CONFIG = GateConfig(
    min_samples=10,
    quality_floor=0.95,
    non_inferiority_tolerance=0.02,
    require_cost_improvement=True,
    require_latency=True,
    max_latency_regression_pct=50.0,
    require_fallback=True,
)

DATASET_PATH = Path(__file__).resolve().parent / "data" / "zev_dogfood_v1.json"
ARTIFACTS_ROOT = Path(__file__).resolve().parents[2] / "artifacts" / "benchmarks"


class BenchmarkCaseSetup(BaseModel):
    """Deterministic fixture seeds resolved at run time."""

    findings: list[dict] = Field(default_factory=list)
    traces: list[dict] = Field(default_factory=list)
    experiments: list[dict] = Field(default_factory=list)
    product_name: str = "ZEVQORA Benchmark Workspace"


class BenchmarkCaseRequest(BaseModel):
    messages: list[dict]
    tools: list[dict] | None = None
    tool_choice: str | dict | None = "auto"
    temperature: float = 0.0
    max_tokens: int = 64
    workflow: str | None = "zev_dogfood"
    symbol: str | None = None


class BenchmarkCaseSpec(BaseModel):
    case_id: str
    title: str
    difficulty: str
    protected: bool = False
    setup: BenchmarkCaseSetup = Field(default_factory=BenchmarkCaseSetup)
    request: BenchmarkCaseRequest
    graders: list[GraderSpec]
    expected: str | dict | list | None = None
    required_tools: list[str] = Field(default_factory=list)
    forbidden_tools: list[str] = Field(default_factory=list)
    allowed_tools: list[str] | None = None
    metadata: dict = Field(default_factory=dict)


class BenchmarkDataset(BaseModel):
    name: str
    version: str
    dataset_hash: str
    cases: list[BenchmarkCaseSpec]
    difficulty_counts: dict[str, int] = Field(default_factory=dict)
