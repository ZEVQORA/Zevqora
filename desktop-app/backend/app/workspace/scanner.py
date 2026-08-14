from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db_models import AICall, Finding, Product

SAFE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".cache",
    ".zevqora",
    "coverage",
}
FORBIDDEN_NAME_PARTS = {
    ".env",
    "secret",
    "private",
    "credential",
    "token",
    "production",
    "backup",
    "dump",
    "keystore",
    "service-account",
}
FORBIDDEN_EXACT_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks"}

PROVIDER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("openrouter", re.compile(r"openrouter|OPENROUTER_API_KEY", re.I)),
    ("openai", re.compile(r"\bOpenAI\b|from\s+openai|import\s+openai|\.responses\.create|chat\.completions\.create", re.I)),
    ("anthropic", re.compile(r"\bAnthropic\b|from\s+anthropic|import\s+anthropic|messages\.create", re.I)),
    ("gemini", re.compile(r"google\.genai|google\.generativeai|GenerativeModel|generate_content", re.I)),
    ("vercel-ai-sdk", re.compile(r"from\s+['\"]ai['\"]|generateText\(|streamText\(|generateObject\(", re.I)),
    ("litellm", re.compile(r"\blitellm\b|completion\(", re.I)),
    ("langchain", re.compile(r"\blangchain\b|ChatOpenAI|ChatAnthropic", re.I)),
]

SECRET_LIKE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?i)(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*([\"'])([^\"'\n]{6,})\2"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bAIza[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
]


def contains_secret_like_value(text: str) -> bool:
    return any(pattern.search(text) for pattern in SECRET_LIKE_PATTERNS)


def redact_secret_like_values(text: str) -> str:
    redacted = text
    assignment = SECRET_LIKE_PATTERNS[0]
    redacted = assignment.sub(lambda m: f'{m.group(1)}={m.group(2)}****{m.group(2)}', redacted)
    redacted = SECRET_LIKE_PATTERNS[1].sub('sk-****', redacted)
    redacted = SECRET_LIKE_PATTERNS[2].sub('AIza****', redacted)
    redacted = SECRET_LIKE_PATTERNS[3].sub('gh_****', redacted)
    return redacted

CALL_HINT = re.compile(
    r"responses\.create|completions\.create|messages\.create|generate_content|generateText\(|streamText\(|generateObject\(|\bcompletion\(|\.invoke\(|\.ainvoke\(",
    re.I,
)
FUNCTION_PATTERNS = [
    re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\("),
    re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("),
    re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
]


@dataclass
class ScanStats:
    files_scanned: int = 0
    skipped_sensitive_paths: int = 0


def is_forbidden_name(name: str) -> bool:
    lowered = name.lower()
    if lowered.endswith(tuple(FORBIDDEN_EXACT_SUFFIXES)):
        return True
    return any(part in lowered for part in FORBIDDEN_NAME_PARTS)


def is_safe_source_path(path: Path, root: Path) -> bool:
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
    except Exception:
        return False
    if path.suffix.lower() not in SAFE_EXTENSIONS:
        return False
    if any(part.lower() in SKIP_DIRS for part in path.parts):
        return False
    if is_forbidden_name(path.name):
        return False
    return True


def _find_symbol(line: str, current_symbol: str | None) -> str | None:
    for pattern in FUNCTION_PATTERNS:
        match = pattern.search(line)
        if match:
            return match.group(1)
    return current_symbol


def _provider_for(text: str) -> str | None:
    for provider, pattern in PROVIDER_PATTERNS:
        if pattern.search(text):
            return provider
    return None


def _classify_finding(context: str, provider: str) -> tuple[str, str, str, float, str]:
    low = context.lower()
    if any(word in low for word in ("retry", "fallback", "backoff")):
        return (
            "reliability_retries",
            "Repeated AI execution may be happening on retry/fallback paths",
            "This call sits near retry or fallback logic. Runtime traces are required to prove whether duplicate paid work is occurring.",
            0.70,
            "medium",
        )
    if any(word in low for word in ("classify", "classification", "intent", "label")):
        return (
            "structured_task_candidate",
            "This AI call looks like a bounded classification task",
            "Bounded tasks can sometimes use a cheaper execution strategy, but ZEVQORA will not call it a saving until replay and quality gates pass.",
            0.68,
            "medium",
        )
    if any(word in low for word in ("extract", "json", "schema", "structured")):
        return (
            "structured_output_candidate",
            "This call appears to produce structured output",
            "Structured workloads often have deterministic quality checks. Import representative traces so ZEVQORA can test cheaper candidates safely.",
            0.64,
            "medium",
        )
    if any(word in low for word in ("system_prompt", "system prompt", "context", "documents", "retrieval", "rag")):
        return (
            "context_review",
            "This AI call may carry repeated or large context",
            "Static inspection cannot quantify context waste. Runtime token and task evidence is needed before proposing an optimization.",
            0.56,
            "medium",
        )
    return (
        "needs_evidence",
        f"AI execution path detected ({provider})",
        "ZEVQORA found an AI execution path. Connect runtime evidence to attribute cost and decide whether any optimization is safe.",
        0.50,
        "medium",
    )


def scan_product(db: Session, product: Product) -> tuple[ScanStats, list[AICall], list[Finding], list[str]]:
    root = Path(product.root_path).resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError("Workspace path does not exist or is not a directory.")

    db.execute(delete(AICall).where(AICall.product_id == product.id))
    db.execute(delete(Finding).where(Finding.product_id == product.id, Finding.origin == "static_scan"))

    stats = ScanStats()
    calls: list[AICall] = []
    findings: list[Finding] = []
    stack: set[str] = set()

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if not is_safe_source_path(path, root):
            if path.suffix.lower() in SAFE_EXTENSIONS and (
                is_forbidden_name(path.name) or any(part.lower() in SKIP_DIRS for part in path.parts)
            ):
                stats.skipped_sensitive_paths += 1
            continue
        try:
            if path.stat().st_size > settings.max_source_file_bytes:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        stats.files_scanned += 1
        lines = text.splitlines()
        current_symbol: str | None = None
        for index, line in enumerate(lines, start=1):
            current_symbol = _find_symbol(line, current_symbol)
            provider = _provider_for(line)
            if provider:
                stack.add(provider)
            if not provider or not CALL_HINT.search(line):
                continue

            relative = str(path.relative_to(root)).replace("\\", "/")
            excerpt = redact_secret_like_values(line.strip())[:500]
            call = AICall(
                id=str(uuid.uuid4()),
                product_id=product.id,
                file_path=relative,
                line=index,
                provider=provider,
                symbol=current_symbol,
                excerpt=excerpt,
            )
            calls.append(call)
            db.add(call)

            start = max(0, index - 5)
            end = min(len(lines), index + 4)
            context = "\n".join(lines[start:end])
            category, title, root_cause, confidence, risk = _classify_finding(context, provider)
            finding_id = str(
                uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    f"zevqora:{product.id}:{relative}:{index}:{category}",
                )
            )
            finding = Finding(
                id=finding_id,
                product_id=product.id,
                origin="static_scan",
                category=category,
                title=title,
                root_cause=root_cause,
                file_path=relative,
                line=index,
                symbol=current_symbol,
                confidence=confidence,
                risk=risk,
                evidence_status="needs_evidence",
            )
            findings.append(finding)
            db.add(finding)

    product.last_scan_at = datetime.now(timezone.utc)
    db.add(product)
    db.commit()
    return stats, calls, findings, sorted(stack)


def get_product(db: Session, product_id: str) -> Product | None:
    return db.scalar(select(Product).where(Product.id == product_id))
