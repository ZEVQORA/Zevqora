from pathlib import Path

from app.workspace.scanner import is_forbidden_name, is_safe_source_path


def test_forbidden_secret_names():
    assert is_forbidden_name(".env")
    assert is_forbidden_name("prod_api_token.py")
    assert is_forbidden_name("service-account.json")
    assert is_forbidden_name("server.key")
    assert not is_forbidden_name("agent.py")


def test_safe_source_scope(tmp_path: Path):
    safe = tmp_path / "service.py"
    safe.write_text("print('ok')", encoding="utf-8")
    forbidden = tmp_path / "private_token.py"
    forbidden.write_text("do_not_read", encoding="utf-8")
    assert is_safe_source_path(safe, tmp_path)
    assert not is_safe_source_path(forbidden, tmp_path)


def test_redacts_secret_like_values():
    from app.workspace.scanner import contains_secret_like_value, redact_secret_like_values

    sample = 'api_key = "EXAMPLE_NOT_A_REAL_KEY_12345"\nprint("safe")'
    assert contains_secret_like_value(sample)
    redacted = redact_secret_like_values(sample)
    assert 'EXAMPLE_NOT_A_REAL_KEY_12345' not in redacted
    assert '****' in redacted


def test_static_finding_identity_survives_rescan(tmp_path: Path):
    import uuid

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.db import Base
    from app.db_models import Product
    from app.workspace.scanner import scan_product

    (tmp_path / "service.py").write_text(
        "from openai import OpenAI\nclient = OpenAI()\ndef classify(x):\n    return client.responses.create(model='m', input=x)\n",
        encoding="utf-8",
    )
    engine = create_engine(f"sqlite:///{tmp_path / 'stable.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(id=str(uuid.uuid4()), name="Stable", root_path=str(tmp_path))
        db.add(product)
        db.commit()
        _, _, first, _ = scan_product(db, product)
        assert first
        first_id = first[0].id
        _, _, second, _ = scan_product(db, product)
        assert second
        assert first_id == second[0].id
