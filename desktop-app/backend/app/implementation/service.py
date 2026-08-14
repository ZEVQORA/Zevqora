from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import uuid
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db_models import Experiment, Finding, Implementation, Product
from ..schemas import ImplementationOut, ImplementationPrepareRequest
from ..workspace.scanner import contains_secret_like_value, is_safe_source_path


class ImplementationError(ValueError):
    pass


def _run_git(args: list[str], cwd: Path, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise ImplementationError("Git is required for isolated implementation worktrees.") from exc


def _extract_json(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate, flags=re.I)
        candidate = re.sub(r"\s*```$", "", candidate)
    try:
        value = json.loads(candidate)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start >= 0 and end > start:
        value = json.loads(candidate[start : end + 1])
        if isinstance(value, dict):
            return value
    raise ImplementationError("The model did not return the required JSON implementation object.")


def _message_content(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                chunks.append(part["text"])
        return "\n".join(chunks)
    return ""


async def _generate_replacement(
    *,
    model: str,
    relative_path: str,
    source_text: str,
    finding: Finding,
    experiment: Experiment,
    instructions: str | None,
) -> tuple[str, str]:
    if not settings.openrouter_api_key:
        raise ImplementationError("OPENROUTER_API_KEY is required to prepare a code implementation.")

    system = """You are the controlled implementation worker inside ZEVQORA.
Return JSON only with exactly this structure:
{
  "summary": "short review summary",
  "content": "the complete replacement contents of the target file"
}

Rules:
- Modify only the one target file supplied by ZEVQORA.
- Preserve unrelated behavior and public interfaces.
- Make the smallest implementation that reflects the verified experiment/finding.
- Keep a safe baseline/fallback path where the task requires one.
- Never add credentials, API keys, telemetry exfiltration, auto-deploy, or auto-merge logic.
- Never claim a saving inside source comments unless it is necessary; evidence belongs in ZEVQORA, not hard-coded marketing copy.
- Output must be valid JSON. Do not wrap it in Markdown.
"""
    user = {
        "target_file": relative_path,
        "finding": {
            "category": finding.category,
            "title": finding.title,
            "root_cause": finding.root_cause,
            "symbol": finding.symbol,
        },
        "verified_experiment": {
            "id": experiment.id,
            "sample_size": experiment.sample_size,
            "baseline_cost_usd": experiment.baseline_cost_usd,
            "candidate_cost_usd": experiment.candidate_cost_usd,
            "baseline_quality": experiment.baseline_quality,
            "candidate_quality": experiment.candidate_quality,
            "baseline_latency_ms": experiment.baseline_latency_ms,
            "candidate_latency_ms": experiment.candidate_latency_ms,
            "evidence_version": experiment.evidence_version,
        },
        "user_instructions": instructions,
        "current_file": source_text,
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "X-Title": "ZEVQORA Desktop",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                ],
                "temperature": 0.1,
            },
        )
    if response.status_code >= 400:
        raise ImplementationError(f"OpenRouter implementation request failed ({response.status_code}): {response.text[:500]}")
    body = response.json()
    choices = body.get("choices") or []
    if not choices:
        raise ImplementationError("OpenRouter returned no implementation choice.")
    raw = _message_content(choices[0].get("message") or {})
    parsed = _extract_json(raw)
    content = parsed.get("content")
    summary = parsed.get("summary")
    if not isinstance(content, str) or not isinstance(summary, str):
        raise ImplementationError("Implementation JSON must contain string fields 'summary' and 'content'.")
    return summary.strip()[:4000], content


def _implementation_out(row: Implementation) -> ImplementationOut:
    return ImplementationOut(
        id=row.id,
        product_id=row.product_id,
        experiment_id=row.experiment_id,
        finding_id=row.finding_id,
        status=row.status,
        branch_name=row.branch_name,
        worktree_path=row.worktree_path,
        target_file=row.target_file,
        summary=row.summary,
        diff_text=row.diff_text,
        test_command=row.test_command,
        test_exit_code=row.test_exit_code,
        test_output=row.test_output,
        model=row.model,
        created_at=row.created_at,
    )


async def prepare_implementation(
    db: Session,
    product_id: str,
    request: ImplementationPrepareRequest,
) -> ImplementationOut:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if not product:
        raise ImplementationError("Product not found.")
    experiment = db.scalar(
        select(Experiment).where(
            Experiment.id == request.experiment_id,
            Experiment.product_id == product_id,
        )
    )
    if not experiment:
        raise ImplementationError("Experiment not found for this product.")
    if experiment.status != "VERIFIED":
        raise ImplementationError("Only a VERIFIED experiment is eligible for implementation preparation.")
    if not experiment.finding_id:
        raise ImplementationError("This experiment is not linked to a source finding.")
    finding = db.scalar(select(Finding).where(Finding.id == experiment.finding_id))
    if not finding:
        raise ImplementationError("Linked finding not found.")
    if finding.origin != "static_scan" or finding.file_path == "runtime evidence":
        raise ImplementationError(
            "This verified experiment is runtime-derived and has no safe source target. Ask Zev for an implementation plan instead of writing code automatically."
        )

    root = Path(product.root_path).resolve()
    target = (root / finding.file_path).resolve()
    if not is_safe_source_path(target, root):
        raise ImplementationError("The linked target file is not allowed by the safe source policy.")
    if not target.exists():
        raise ImplementationError("The linked source file no longer exists. Rescan the product first.")

    repo_check = _run_git(["rev-parse", "--show-toplevel"], root)
    if repo_check.returncode != 0:
        raise ImplementationError("Implementation preparation requires the connected product to be a Git repository.")
    repo_root = Path(repo_check.stdout.strip()).resolve()
    try:
        root.relative_to(repo_root)
    except ValueError as exc:
        raise ImplementationError("Connected workspace is not inside the resolved Git repository.") from exc
    head = _run_git(["rev-parse", "HEAD"], repo_root)
    if head.returncode != 0:
        raise ImplementationError("Unable to resolve the current Git HEAD.")

    impl_id = str(uuid.uuid4())
    branch = f"zevqora/exp-{experiment.id[:8]}-{impl_id[:6]}"
    worktree = Path(settings.worktree_root).expanduser().resolve() / product.id / impl_id
    worktree.parent.mkdir(parents=True, exist_ok=True)
    add = _run_git(["worktree", "add", "-b", branch, str(worktree), head.stdout.strip()], repo_root, timeout=60)
    if add.returncode != 0:
        raise ImplementationError(f"Could not create isolated Git worktree: {add.stderr.strip()[:500]}")

    rel_from_repo = target.relative_to(repo_root)
    worktree_target = (worktree / rel_from_repo).resolve()
    created = False
    try:
        if not is_safe_source_path(worktree_target, worktree):
            raise ImplementationError("Generated worktree target failed the safe source policy.")
        source_text = target.read_text(encoding="utf-8", errors="replace")
        if contains_secret_like_value(source_text):
            raise ImplementationError("Hardcoded secret-like material was detected in the target source file. ZEVQORA refuses to send or rewrite this file until the credential is removed/rotated and replaced with safe configuration.")
        chosen_model = request.model or settings.agent_model
        summary, replacement = await _generate_replacement(
            model=chosen_model,
            relative_path=str(rel_from_repo).replace("\\", "/"),
            source_text=source_text,
            finding=finding,
            experiment=experiment,
            instructions=request.instructions,
        )
        if not replacement.strip():
            raise ImplementationError("The proposed replacement was empty.")
        worktree_target.write_text(replacement, encoding="utf-8")

        compile_output = ""
        compile_exit: int | None = None
        if worktree_target.suffix.lower() == ".py":
            compile_proc = subprocess.run(
                [os.environ.get("PYTHON", "python"), "-m", "py_compile", str(worktree_target)],
                cwd=str(worktree),
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            compile_exit = compile_proc.returncode
            compile_output = (compile_proc.stdout + compile_proc.stderr)[-6000:]

        test_command = None
        test_exit = compile_exit
        test_output = compile_output
        if request.run_tests:
            if not request.test_command or not request.test_command.strip():
                raise ImplementationError("run_tests=true requires an explicit user-approved test_command.")
            test_command = request.test_command.strip()
            test_proc = subprocess.run(
                test_command,
                cwd=str(worktree),
                text=True,
                capture_output=True,
                timeout=180,
                check=False,
                shell=True,
            )
            test_exit = test_proc.returncode
            test_output = (test_proc.stdout + test_proc.stderr)[-20000:]

        diff_proc = _run_git(["diff", "--no-ext-diff", "--", str(rel_from_repo).replace("\\", "/")], worktree)
        diff_text = diff_proc.stdout
        if not diff_text.strip():
            raise ImplementationError("The generated implementation produced no source diff.")

        if test_exit not in (None, 0):
            status = "TESTS_FAILED"
        elif request.run_tests:
            status = "READY_FOR_REVIEW"
        else:
            status = "PREPARED_NO_TESTS"

        row = Implementation(
            id=impl_id,
            product_id=product_id,
            experiment_id=experiment.id,
            finding_id=finding.id,
            status=status,
            branch_name=branch,
            worktree_path=str(worktree),
            target_file=str(rel_from_repo).replace("\\", "/"),
            summary=summary,
            diff_text=diff_text,
            test_command=test_command,
            test_exit_code=test_exit,
            test_output=test_output or None,
            model=chosen_model,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        created = True
        return _implementation_out(row)
    finally:
        if not created:
            # Failed candidates should not leave an untracked worktree/branch behind.
            _run_git(["worktree", "remove", "--force", str(worktree)], repo_root, timeout=60)
            _run_git(["branch", "-D", branch], repo_root, timeout=30)


def list_implementations(db: Session, product_id: str) -> list[ImplementationOut]:
    rows = list(
        db.scalars(
            select(Implementation)
            .where(Implementation.product_id == product_id)
            .order_by(Implementation.created_at.desc())
        )
    )
    return [_implementation_out(row) for row in rows]
