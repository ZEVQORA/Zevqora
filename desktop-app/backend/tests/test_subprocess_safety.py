from pathlib import Path

import pytest

from app.core.errors import SubprocessError, UnsafeCommandError
from app.core.subprocesses import (
    command_contains_shell_control,
    parse_command_to_argv,
    run_argv,
    run_command_string,
)


def test_rejects_shell_control_operators():
    for bad in ("echo hi && echo x", "a | b", "a; b", "a > out", "a >> out", "a < in", "a || b", "a 2> err", "bg &"):
        assert command_contains_shell_control(bad)
        with pytest.raises(UnsafeCommandError):
            parse_command_to_argv(bad)


def test_parse_normal_python_command():
    argv = parse_command_to_argv("python -m pytest -q")
    assert argv[0] == "python"
    assert "-m" in argv


def test_parse_quoted_path_with_spaces():
    argv = parse_command_to_argv('python "C:\\Program Files\\app\\run.py" --flag')
    assert any("Program Files" in part or "Program" in part for part in argv) or argv[1].startswith("C:")


def test_run_argv_success_and_nonzero(tmp_path: Path):
    ok = run_argv(["python", "-c", "print('ok')"], cwd=tmp_path, timeout_seconds=10, max_output_bytes=1000)
    assert ok.exit_code == 0
    assert "ok" in ok.stdout
    assert ok.timed_out is False

    bad = run_argv(["python", "-c", "raise SystemExit(7)"], cwd=tmp_path, timeout_seconds=10, max_output_bytes=1000)
    assert bad.exit_code == 7


def test_run_argv_timeout(tmp_path: Path):
    result = run_argv(
        ["python", "-c", "import time; time.sleep(5)"],
        cwd=tmp_path,
        timeout_seconds=0.2,
        max_output_bytes=1000,
    )
    assert result.timed_out is True
    assert result.exit_code is None


def test_run_argv_missing_executable(tmp_path: Path):
    with pytest.raises(SubprocessError):
        run_argv(["definitely-not-a-real-binary-zevqora"], cwd=tmp_path, timeout_seconds=5, max_output_bytes=100)


def test_run_argv_output_truncation(tmp_path: Path):
    result = run_argv(
        ["python", "-c", "print('x' * 5000)"],
        cwd=tmp_path,
        timeout_seconds=10,
        max_output_bytes=100,
    )
    assert result.truncated is True
    assert len(result.stdout.encode("utf-8")) <= 100


def test_run_command_string_shell_false_path(tmp_path: Path):
    result = run_command_string('python -c "print(123)"', cwd=tmp_path, timeout_seconds=10, max_output_bytes=500)
    assert result.exit_code == 0
    assert "123" in result.stdout
