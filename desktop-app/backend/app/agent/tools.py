from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db_models import AICall, Finding, Product
from ..evidence.service import economics
from ..experiments.service import list_experiments, run_experiment
from ..schemas import ExperimentRunRequest
from ..workspace.scanner import is_safe_source_path, redact_secret_like_values, scan_product

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "workspace_summary",
            "description": "Get the connected product workspace and scan status.",
            "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scan_workspace",
            "description": "Run a safe read-only source scan. Secret-bearing files are excluded.",
            "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_ai_calls",
            "description": "List detected AI execution call sites from the latest static scan.",
            "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_findings",
            "description": "List potential waste/optimization findings. Static findings are never automatically Verified Savings.",
            "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "economics_summary",
            "description": "Get observed cost and verified savings from imported evidence.",
            "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_experiments",
            "description": "List replay/evaluation experiments and their gates.",
            "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_source_excerpt",
            "description": "Read a short excerpt from an allowed source file inside the connected workspace. Secret-bearing paths are refused.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string"},
                    "file_path": {"type": "string"},
                    "start_line": {"type": "integer", "minimum": 1},
                    "end_line": {"type": "integer", "minimum": 1},
                },
                "required": ["product_id", "file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_verification",
            "description": "Run the deterministic replay/evidence gate for a finding. This does not modify source code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string"},
                    "finding_id": {"type": "string"},
                    "quality_gate": {"type": "number", "minimum": 0, "maximum": 1},
                    "min_samples": {"type": "integer", "minimum": 1},
                    "fallback_exists": {"type": "boolean"},
                },
                "required": ["product_id", "finding_id", "fallback_exists"],
            },
        },
    },
]


def _product(db: Session, product_id: str) -> Product:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if not product:
        raise ValueError("Product not found.")
    return product


def execute_tool(db: Session, name: str, args: dict[str, Any]) -> tuple[str, str]:
    if name == "workspace_summary":
        product = _product(db, args["product_id"])
        payload = {
            "id": product.id,
            "name": product.name,
            "root_path": product.root_path,
            "monitoring_enabled": product.monitoring_enabled,
            "last_scan_at": product.last_scan_at.isoformat() if product.last_scan_at else None,
        }
        return json.dumps(payload), f"Workspace: {product.name}"

    if name == "scan_workspace":
        product = _product(db, args["product_id"])
        stats, calls, findings, stack = scan_product(db, product)
        payload = {
            "files_scanned": stats.files_scanned,
            "ai_calls": len(calls),
            "findings": len(findings),
            "detected_stack": stack,
            "skipped_sensitive_paths": stats.skipped_sensitive_paths,
        }
        return json.dumps(payload), f"Scanned {stats.files_scanned} files; {len(calls)} AI calls detected."

    if name == "list_ai_calls":
        product = _product(db, args["product_id"])
        rows = list(db.scalars(select(AICall).where(AICall.product_id == product.id).limit(80)))
        payload = [
            {"file": r.file_path, "line": r.line, "provider": r.provider, "symbol": r.symbol, "excerpt": r.excerpt}
            for r in rows
        ]
        return json.dumps(payload), f"{len(rows)} AI call sites returned."

    if name == "list_findings":
        product = _product(db, args["product_id"])
        rows = list(db.scalars(select(Finding).where(Finding.product_id == product.id).limit(80)))
        payload = [
            {
                "id": r.id,
                "origin": r.origin,
                "title": r.title,
                "category": r.category,
                "root_cause": r.root_cause,
                "file": r.file_path,
                "line": r.line,
                "symbol": r.symbol,
                "confidence": r.confidence,
                "risk": r.risk,
                "evidence_status": r.evidence_status,
            }
            for r in rows
        ]
        return json.dumps(payload), f"{len(rows)} potential findings returned."

    if name == "economics_summary":
        product = _product(db, args["product_id"])
        payload = economics(db, product.id).model_dump(mode="json")
        return json.dumps(payload), f"Observed economics for {product.name}."

    if name == "list_experiments":
        product = _product(db, args["product_id"])
        rows = [x.model_dump(mode="json") for x in list_experiments(db, product.id)]
        return json.dumps(rows), f"{len(rows)} experiments returned."

    if name == "read_source_excerpt":
        product = _product(db, args["product_id"])
        root = Path(product.root_path).resolve()
        requested = (root / args["file_path"]).resolve()
        if not is_safe_source_path(requested, root):
            raise ValueError("Refusing to read a secret-bearing, unsupported, or out-of-workspace path.")
        start = max(1, int(args.get("start_line") or 1))
        end = max(start, int(args.get("end_line") or start + 60))
        end = min(end, start + 120)
        lines = requested.read_text(encoding="utf-8", errors="replace").splitlines()
        selected = lines[start - 1 : end]
        payload = {"file": args["file_path"], "start_line": start, "end_line": min(end, len(lines)), "content": redact_secret_like_values("\n".join(selected))}
        return json.dumps(payload), f"Read {args['file_path']} lines {start}-{min(end, len(lines))}."

    if name == "run_verification":
        product = _product(db, args["product_id"])
        req = ExperimentRunRequest(
            finding_id=args.get("finding_id"),
            quality_gate=float(args.get("quality_gate", 0.98)),
            min_samples=int(args.get("min_samples", 5)),
            fallback_exists=bool(args.get("fallback_exists", False)),
        )
        result = run_experiment(db, product.id, req)
        return json.dumps(result.model_dump(mode="json")), f"Experiment result: {result.status}."

    raise ValueError(f"Unknown tool: {name}")
