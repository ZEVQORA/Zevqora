"""Human review trail for prepared implementation candidates."""

from __future__ import annotations

import asyncio
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.db_models import Implementation, Product
from app.implementation.service import (
    ImplementationError,
    compare_url_for,
    decide_implementation,
    implementation_git_context,
    parse_remote,
    push_implementation,
    record_pr_url,
)


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True)


def test_parse_remote_and_compare_urls():
    assert parse_remote("https://github.com/ZEVQORA/Zevqora.git") == ("github.com", "ZEVQORA/Zevqora")
    assert parse_remote("git@github.com:ZEVQORA/Zevqora.git") == ("github.com", "ZEVQORA/Zevqora")
    assert parse_remote("ssh://git@gitlab.com/team/repo") == ("gitlab.com", "team/repo")
    assert parse_remote("https://example.internal/team/repo.git") == ("example.internal", None)
    assert parse_remote(None) == (None, None)

    assert (
        compare_url_for("https://github.com/ZEVQORA/Zevqora.git", "main", "zevqora/exp-1")
        == "https://github.com/ZEVQORA/Zevqora/compare/main...zevqora%2Fexp-1?expand=1"
    )
    assert compare_url_for("git@gitlab.com:team/repo.git", "main", "b").startswith(
        "https://gitlab.com/team/repo/-/merge_requests/new"
    )
    assert (
        compare_url_for("https://bitbucket.org/team/repo", "main", "b")
        == "https://bitbucket.org/team/repo/pull-requests/new?source=b"
    )
    assert compare_url_for("https://example.internal/team/repo.git", "main", "b") is None


def _seed(tmp_path: Path, status: str = "PREPARED_NO_TESTS") -> tuple[Session, str, str, Path]:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)
    (repo / "service.py").write_text("def classify(x):\n    return 'old'\n", encoding="utf-8")
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "test@example.invalid")
    git(repo, "config", "user.name", "ZEVQORA Test")
    git(repo, "add", "service.py")
    git(repo, "commit", "-m", "initial")
    git(repo, "remote", "add", "origin", "https://github.com/acme/support-assistant.git")

    engine = create_engine(f"sqlite:///{(tmp_path / 'db.sqlite').as_posix()}")
    Base.metadata.create_all(engine)
    db = Session(engine)
    product_id = str(uuid.uuid4())
    impl_id = str(uuid.uuid4())
    worktree = tmp_path / "worktrees" / impl_id
    db.add(Product(id=product_id, name="Demo", root_path=str(repo)))
    db.add(
        Implementation(
            id=impl_id,
            product_id=product_id,
            experiment_id=str(uuid.uuid4()),
            finding_id=None,
            status=status,
            branch_name="zevqora/exp-abc123-d3f",
            worktree_path=str(worktree),
            target_file="service.py",
            summary="Use the cheaper verified model",
            diff_text="--- a/service.py\n+++ b/service.py\n",
            model="mock/test-model",
        )
    )
    db.commit()
    return db, product_id, impl_id, repo


def test_decision_records_review_and_blocks_failed_tests(tmp_path: Path):
    db, product_id, impl_id, _ = _seed(tmp_path)
    approved = decide_implementation(db, product_id, impl_id, decision="approve", note="Looks minimal.")
    assert approved.status == "APPROVED_FOR_REVIEW"
    assert approved.review_note == "Looks minimal."
    assert approved.reviewed_at is not None

    rejected = decide_implementation(db, product_id, impl_id, decision="reject", note=None)
    assert rejected.status == "REJECTED"
    assert rejected.review_note is None

    with pytest.raises(ImplementationError):
        decide_implementation(db, product_id, impl_id, decision="ship", note=None)
    with pytest.raises(ImplementationError):
        decide_implementation(db, product_id, str(uuid.uuid4()), decision="approve", note=None)

    db2, product2, impl2, _ = _seed(tmp_path / "second", status="TESTS_FAILED")
    with pytest.raises(ImplementationError):
        decide_implementation(db2, product2, impl2, decision="approve", note=None)


def test_git_context_derives_compare_url_without_network(tmp_path: Path):
    db, product_id, impl_id, _ = _seed(tmp_path)
    context = asyncio.run(implementation_git_context(db, product_id, impl_id))
    assert context["remote_host"] == "github.com"
    assert context["default_branch"] == "main"
    assert context["worktree_exists"] is False
    assert (
        context["compare_url"]
        == "https://github.com/acme/support-assistant/compare/main...zevqora%2Fexp-abc123-d3f?expand=1"
    )
    assert context["pushed_at"] is None


def test_push_refuses_rejected_or_missing_worktree(tmp_path: Path):
    db, product_id, impl_id, _ = _seed(tmp_path)
    with pytest.raises(ImplementationError, match="worktree no longer exists"):
        asyncio.run(push_implementation(db, product_id, impl_id))
    decide_implementation(db, product_id, impl_id, decision="reject", note=None)
    with pytest.raises(ImplementationError, match="rejected"):
        asyncio.run(push_implementation(db, product_id, impl_id))


def test_pr_link_must_be_a_forge_url(tmp_path: Path):
    db, product_id, impl_id, _ = _seed(tmp_path)
    out = record_pr_url(db, product_id, impl_id, "https://github.com/acme/support-assistant/pull/12")
    assert out.pr_url == "https://github.com/acme/support-assistant/pull/12"
    with pytest.raises(ImplementationError):
        record_pr_url(db, product_id, impl_id, "http://evil.example/pull/1")
