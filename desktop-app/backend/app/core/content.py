"""Bounded local evidence content storage helpers."""

from __future__ import annotations

from dataclasses import dataclass

from .hashing import sha256_text

DEFAULT_MAX_STORED_OUTPUT_CHARS = 50_000


@dataclass(frozen=True)
class BoundedText:
    text: str | None
    full_hash: str | None
    truncated: bool
    original_chars: int
    stored_chars: int


def bound_text(
    value: str | None,
    *,
    max_chars: int = DEFAULT_MAX_STORED_OUTPUT_CHARS,
) -> BoundedText:
    """Hash the full canonical value, then optionally bound stored text.

    Truncation is never silent: truncated=True and original_chars are recorded.
    """
    if value is None:
        return BoundedText(text=None, full_hash=None, truncated=False, original_chars=0, stored_chars=0)
    full_hash = sha256_text(value)
    original = len(value)
    if original <= max_chars:
        return BoundedText(
            text=value,
            full_hash=full_hash,
            truncated=False,
            original_chars=original,
            stored_chars=original,
        )
    stored = value[:max_chars]
    return BoundedText(
        text=stored,
        full_hash=full_hash,
        truncated=True,
        original_chars=original,
        stored_chars=len(stored),
    )
