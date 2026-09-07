#!/usr/bin/env python3
"""Verify the published benchmark evidence against its checksum manifests.

Why this exists rather than `sha256sum -c`: the manifests were written on Windows
and carry CRLF line endings, so GNU coreutils reads the filename as `metrics.json\\r`
and reports ten FAILED lines on a POSIX toolchain. The hashes are correct — the
manifest bytes are simply not portable.

The evidence is immutable, so the manifests are not being rewritten to suit the
tool. The verifier is made portable instead.

Usage:
    python scripts/verify_evidence.py            # verify every evidence bundle
    python scripts/verify_evidence.py candidate-d
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

EVIDENCE_ROOT = Path(__file__).resolve().parent.parent / "docs" / "evidence"
MANIFEST_NAME = "checksums.sha256"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_line_ending_variants(path: Path) -> dict[str, str]:
    """Hashes of the file as checked out, plus its LF-only and CRLF-only forms.

    The manifests were produced from a Windows working copy (CRLF), while git
    stores the evidence with LF. A checkout on a POSIX runner therefore hashes
    differently from the same bytes on Windows although the content is
    identical. Accepting the matching line-ending form keeps the manifests
    immutable and the verifier portable; a genuine content change still fails
    on every variant.
    """
    raw = path.read_bytes()
    lf = raw.replace(b"\r\n", b"\n")
    crlf = lf.replace(b"\n", b"\r\n")
    return {
        "as-is": hashlib.sha256(raw).hexdigest(),
        "lf": hashlib.sha256(lf).hexdigest(),
        "crlf": hashlib.sha256(crlf).hexdigest(),
    }


def verify_bundle(bundle: Path) -> tuple[int, list[str]]:
    """Return (files_checked, failures)."""
    manifest = bundle / MANIFEST_NAME
    if not manifest.is_file():
        return 0, [f"{bundle.name}: no {MANIFEST_NAME}"]

    failures: list[str] = []
    checked = 0
    # errors="replace" and a manual strip so CRLF, BOM and stray whitespace all parse.
    for raw in manifest.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        expected, _, name = line.partition("  ")
        name = name.strip().lstrip("*")
        if not expected or not name:
            failures.append(f"{bundle.name}: unparsable manifest line: {raw!r}")
            continue

        target = bundle / name
        checked += 1
        if not target.is_file():
            failures.append(f"{bundle.name}/{name}: MISSING")
            continue
        variants = sha256_line_ending_variants(target)
        actual = variants["as-is"]
        if expected.strip().lower() not in {v.lower() for v in variants.values()}:
            failures.append(f"{bundle.name}/{name}: MISMATCH\n    expected {expected}\n    actual   {actual}")
    return checked, failures


def main(argv: list[str]) -> int:
    if not EVIDENCE_ROOT.is_dir():
        print(f"No evidence directory at {EVIDENCE_ROOT}", file=sys.stderr)
        return 1

    wanted = argv[1:]
    bundles = sorted(p for p in EVIDENCE_ROOT.iterdir() if p.is_dir() and (p / MANIFEST_NAME).is_file())
    if wanted:
        bundles = [b for b in bundles if b.name in wanted]
        if not bundles:
            print(f"No evidence bundle matching {wanted}", file=sys.stderr)
            return 1

    total_checked = 0
    all_failures: list[str] = []
    for bundle in bundles:
        checked, failures = verify_bundle(bundle)
        total_checked += checked
        all_failures.extend(failures)
        status = "OK" if not failures else "FAILED"
        print(f"{bundle.name}: {checked} file(s) {status}")

    if all_failures:
        print("\nEvidence verification FAILED:", file=sys.stderr)
        for failure in all_failures:
            print(f"  {failure}", file=sys.stderr)
        return 1

    print(f"\nAll evidence verified: {total_checked} file(s) across {len(bundles)} bundle(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
