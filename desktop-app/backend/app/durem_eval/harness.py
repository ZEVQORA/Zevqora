"""Replay harness: executes the frozen case set against real DUREM code.

DUREM is imported and driven unmodified. Only two things vary between runs:
which runtime answers the HTTP calls (real Lemonade or the deterministic stub),
and whether a candidate's delta is applied. Routing, retrieval, ACL filtering,
source validation and instrumentation all execute for real in every mode.

DUREM's ``config.settings`` is a frozen dataclass built from the environment at
import time, so the environment must be prepared before DUREM is first imported.
``DuremSession`` enforces that rather than leaving it to call order.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .fixtures import Case
from .metrics import WorkMetrics
from .runtime import RuntimeDescriptor

HARNESS_VERSION = "durem_replay_harness_v1"

# DUREM's package is imported under this alias. Both repositories ship a
# top-level `app` package, so putting DUREM on sys.path would shadow ZEVQORA's
# own modules (or be shadowed by them) depending on import order.
DUREM_PACKAGE_ALIAS = "durem_app"


def _load_durem_package(durem_repo: Path) -> Any:
    """Import DUREM's `app` package under DUREM_PACKAGE_ALIAS.

    Registering the alias in sys.modules before executing the package body means
    DUREM's own relative imports (`from .config import settings`) resolve inside
    the alias, so the whole package loads unmodified.
    """
    if DUREM_PACKAGE_ALIAS in sys.modules:
        return sys.modules[DUREM_PACKAGE_ALIAS]
    package_dir = durem_repo / "app"
    spec = importlib.util.spec_from_file_location(
        DUREM_PACKAGE_ALIAS,
        package_dir / "__init__.py",
        submodule_search_locations=[str(package_dir)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load DUREM package from {package_dir}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[DUREM_PACKAGE_ALIAS] = module
    spec.loader.exec_module(module)
    return module


class DuremImportedTooEarly(RuntimeError):
    """DUREM was imported before its environment was configured."""


@dataclass
class CaseResult:
    case_id: str
    category: str
    protected: bool
    ok: bool
    probe: dict[str, Any] = field(default_factory=dict)
    response: dict[str, Any] = field(default_factory=dict)
    metrics: WorkMetrics = field(default_factory=WorkMetrics)
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "category": self.category,
            "protected": self.protected,
            "ok": self.ok,
            "error": self.error,
            "probe": self.probe,
            "response": self.response,
            "metrics": self.metrics.as_dict(),
        }


class DuremSession:
    """Owns DUREM's environment, database and module imports for one run."""

    def __init__(
        self,
        *,
        durem_repo: Path,
        data_dir: Path,
        runtime: RuntimeDescriptor,
        max_tokens: int = 900,
        timeout_seconds: float = 240.0,
    ) -> None:
        self.durem_repo = Path(durem_repo).resolve()
        self.data_dir = Path(data_dir).resolve()
        self.runtime = runtime

        if not (self.durem_repo / "app" / "assistant_engine.py").exists():
            raise FileNotFoundError(
                f"DUREM repository not found at {self.durem_repo}. Pass --durem-repo or set DUREM_REPO_PATH."
            )
        # ZEVQORA's backend also has a top-level `app` package, so DUREM cannot be
        # put on sys.path -- the two would shadow each other. DUREM is loaded under
        # a distinct alias instead; its internal relative imports resolve inside it.
        if f"{DUREM_PACKAGE_ALIAS}.config" in sys.modules and os.environ.get("DUREM_DATA_DIR") != str(self.data_dir):
            raise DuremImportedTooEarly(
                f"{DUREM_PACKAGE_ALIAS}.config was already imported with a different "
                "DUREM_DATA_DIR; settings are frozen at import time and would be stale. "
                "Use a fresh process, or reuse the existing session."
            )

        self.data_dir.mkdir(parents=True, exist_ok=True)
        os.environ.update(
            {
                "DUREM_DATA_DIR": str(self.data_dir),
                "LEMONADE_BASE_URL": runtime.base_url,
                "LEMONADE_MODEL": runtime.chat_model,
                "LEMONADE_EMBEDDING_MODEL": runtime.embedding_model,
                "LEMONADE_TIMEOUT_SECONDS": str(timeout_seconds),
                "DUREM_LLM_MAX_TOKENS": str(max_tokens),
                # Mock mode would bypass the real engine paths this harness exists
                # to exercise. It is forced off in every mode.
                "DUREM_MOCK_MODE": "false",
                "DUREM_DEMO_DATA": "false",
                "DUREM_SECRET_KEY": "harness-only-not-a-real-secret-" + "x" * 40,
            }
        )
        _load_durem_package(self.durem_repo)
        self.engine = importlib.import_module(f"{DUREM_PACKAGE_ALIAS}.assistant_engine")
        self.models = importlib.import_module(f"{DUREM_PACKAGE_ALIAS}.models")
        self.db = importlib.import_module(f"{DUREM_PACKAGE_ALIAS}.db")
        self.probe = importlib.import_module(f"{DUREM_PACKAGE_ALIAS}.eval_probe")
        self.retrieval = importlib.import_module(f"{DUREM_PACKAGE_ALIAS}.retrieval")
        self.config = importlib.import_module(f"{DUREM_PACKAGE_ALIAS}.config")

    # -- fixtures ----------------------------------------------------------

    def build_representative_db(self) -> None:
        from .fixtures import build_database

        build_database(self.config.settings.db_path, self.db)

    def user(self, username: str) -> dict[str, Any]:
        conn = sqlite3.connect(self.config.settings.db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """SELECT u.id, u.name, COALESCE(d.name,'') AS department,
                      COALESCE(r.name,'') AS role, COALESCE(r.is_admin,0) AS is_admin
               FROM users u
               LEFT JOIN departments d ON d.id = u.department_id
               LEFT JOIN roles r ON r.id = u.role_id
               WHERE u.username = ?""",
            (username,),
        ).fetchone()
        conn.close()
        if row is None:
            raise KeyError(f"fixture user {username!r} not found")
        return {
            "id": int(row["id"]),
            "name": row["name"],
            "department": row["department"],
            "role": row["role"],
            "is_admin": bool(row["is_admin"]),
        }

    # -- execution ---------------------------------------------------------

    def _ask(self, question: str, mode: str, user: dict[str, Any], conversation_id: str | None):
        request = self.models.AskRequest(question=question, mode=mode, conversation_id=conversation_id)
        return asyncio.run(self.engine.answer(request, user))

    def run_case(self, case: Case) -> CaseResult:
        user = self.user(case.requester)
        conversation_id: str | None = None

        try:
            # Seed turns establish conversation state for follow-up cases. They are
            # setup, not the measured unit, so their probes are discarded -- but they
            # execute identically in both arms, so the setup cost is common-mode.
            for seed_question in case.conversation_seed:
                self.probe.start(case_id=f"{case.case_id}:seed")
                seed_response = self._ask(seed_question, "auto", user, conversation_id)
                self.probe.stop()
                conversation_id = seed_response.conversation_id

            probe = self.probe.start(case_id=case.case_id)
            response = self._ask(case.question, case.mode, user, conversation_id)
            self.probe.stop()

            probe_data = probe.to_dict()
            return CaseResult(
                case_id=case.case_id,
                category=case.category,
                protected=case.protected,
                ok=True,
                probe=probe_data,
                response={
                    "route": response.route,
                    "route_method": response.route_method,
                    "route_reason": response.route_reason,
                    "classifier_invoked": response.classifier_invoked,
                    "safety_override": response.safety_override,
                    "method": response.method,
                    "answer_type": response.answer_type,
                    "decision": response.decision,
                    "confidence": response.confidence,
                    "approver": response.approver,
                    "answer_chars": len(response.answer or ""),
                    "source_ids": [s.id for s in response.sources],
                    "latency_ms": response.latency_ms,
                },
                metrics=WorkMetrics.from_probe(probe_data),
            )
        except Exception as exc:  # noqa: BLE001 - a failed case is evidence, not a crash
            self.probe.stop()
            return CaseResult(
                case_id=case.case_id,
                category=case.category,
                protected=case.protected,
                ok=False,
                error=f"{type(exc).__name__}: {exc}",
            )

    def run_all(self, cases: list[Case]) -> list[CaseResult]:
        return [self.run_case(case) for case in cases]


def aggregate(results: list[CaseResult]) -> WorkMetrics:
    total = WorkMetrics()
    for result in results:
        total = total + result.metrics
    return total
