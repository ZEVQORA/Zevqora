from __future__ import annotations

import hashlib
import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db_models import Finding, Trace


def _key(text: str | None) -> str | None:
    if not text or not text.strip():
        return None
    normalized = " ".join(text.split()).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def diagnose_runtime_evidence(db: Session, product_id: str) -> list[Finding]:
    """Create evidence-derived *signals*, never Verified Savings.

    These findings explain observed cost structure and repeated execution. A replay/eval
    experiment still has to prove a cheaper candidate before any saving becomes verified.
    """
    db.execute(delete(Finding).where(Finding.product_id == product_id, Finding.origin == "runtime_evidence"))
    traces = list(db.scalars(select(Trace).where(Trace.product_id == product_id)))
    findings: list[Finding] = []

    duplicate_groups: dict[tuple[str, str], list[Trace]] = defaultdict(list)
    for row in traces:
        hashed = _key(row.input_text)
        if hashed:
            duplicate_groups[(row.symbol or row.workflow or "unknown", hashed)].append(row)

    for (symbol, _), rows in duplicate_groups.items():
        if len(rows) < 3:
            continue
        costs = [Decimal(str(r.cost_usd)) for r in rows if r.cost_usd is not None]
        observed = sum(costs, Decimal("0")) if costs else None
        finding = Finding(
            id=str(uuid.uuid4()),
            product_id=product_id,
            origin="runtime_evidence",
            category="repeated_execution",
            title=f"Repeated execution observed {len(rows)} times in {symbol}",
            root_cause=(
                f"The same normalized input was paid for {len(rows)} times in the imported evidence"
                + (f", representing ${observed:.6f} of observed baseline cost." if observed is not None else ".")
                + " This is an observed signal, not yet a verified cache/reuse saving."
            ),
            file_path="runtime evidence",
            line=0,
            symbol=None if symbol == "unknown" else symbol,
            confidence=0.92,
            risk="medium",
            evidence_status="observed",
        )
        db.add(finding)
        findings.append(finding)

    cost_rows = [r for r in traces if r.cost_usd is not None]
    total_cost = sum((Decimal(str(r.cost_usd)) for r in cost_rows), Decimal("0"))
    by_workflow: dict[str, list[Trace]] = defaultdict(list)
    for row in cost_rows:
        by_workflow[row.workflow or row.symbol or "unattributed"].append(row)

    if total_cost > 0:
        for workflow, rows in by_workflow.items():
            if len(rows) < 5:
                continue
            group_cost = sum((Decimal(str(r.cost_usd)) for r in rows), Decimal("0"))
            share = float(group_cost / total_cost)
            if share < 0.40:
                continue
            finding = Finding(
                id=str(uuid.uuid4()),
                product_id=product_id,
                origin="runtime_evidence",
                category="cost_concentration",
                title=f"{workflow} drives {share * 100:.1f}% of observed AI cost",
                root_cause=(
                    f"This workload accounts for ${group_cost:.6f} of ${total_cost:.6f} in the imported evidence. "
                    "Cost concentration is a prioritization signal, not proof that the workload is wasteful."
                ),
                file_path="runtime evidence",
                line=0,
                symbol=None if workflow == "unattributed" else workflow,
                confidence=0.88,
                risk="low",
                evidence_status="observed",
            )
            db.add(finding)
            findings.append(finding)

    db.commit()
    return findings
