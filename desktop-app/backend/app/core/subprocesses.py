from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .errors import SubprocessError, UnsafeCommandError

# Shell composition / control operators rejected in normal mode.
_SHELL_CONTROL_MARKERS = (
    "&&",
    "||",
    ">>",
    "2>",
    "|",
    ";",
    ">",
    "<",
    "&",
)


@dataclass(frozen=True)
class SubprocessResult:
    argv: list[str]
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    truncated: bool


def command_contains_shell_control(command: str) -> bool:
    # Check multi-char markers first, then single-char.
    for marker in ("&&", "||", ">>", "2>"):
        if marker in command:
            return True
    for marker in ("|", ";", ">", "<", "&"):
        if marker in command:
            return True
    return False


def parse_command_to_argv(command: str) -> list[str]:
    """Convert a legacy API test_command string into argv without shell=True.

    POSIX: shlex.split
    Windows: CommandLineToArgvW via ctypes when available, else a conservative fallback.
    """
    stripped = command.strip()
    if not stripped:
        raise UnsafeCommandError("Empty command.")
    if command_contains_shell_control(stripped):
        raise UnsafeCommandError("Command contains shell control operators; shell composition is not allowed.")

    if os.name == "nt":
        return _windows_command_line_to_argv(stripped)
    import shlex

    return shlex.split(stripped, posix=True)


def _windows_command_line_to_argv(command: str) -> list[str]:
    import ctypes
    from ctypes import wintypes

    CommandLineToArgvW = ctypes.windll.shell32.CommandLineToArgvW  # type: ignore[attr-defined]
    CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)

    argc = ctypes.c_int(0)
    argv_ptr = CommandLineToArgvW(command, ctypes.byref(argc))
    if not argv_ptr:
        raise UnsafeCommandError("Failed to parse Windows command line.")
    try:
        return [argv_ptr[i] for i in range(argc.value)]
    finally:
        ctypes.windll.kernel32.LocalFree(argv_ptr)  # type: ignore[attr-defined]


def run_argv(
    argv: list[str],
    *,
    cwd: Path | str,
    timeout_seconds: float,
    max_output_bytes: int,
    env: dict[str, str] | None = None,
) -> SubprocessResult:
    """Run argv with shell=False, bounded cwd, timeout, and truncated output."""
    if not argv:
        raise UnsafeCommandError("Empty argv.")
    cwd_path = Path(cwd).resolve()
    if not cwd_path.is_dir():
        raise SubprocessError(f"Working directory does not exist: {cwd_path}")

    try:
        completed = subprocess.run(
            argv,
            cwd=str(cwd_path),
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
            shell=False,
            env=env,
        )
    except FileNotFoundError as exc:
        raise SubprocessError(f"Executable not found: {argv[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        err = (exc.stderr or "") if isinstance(exc.stderr, str) else f"Timed out after {timeout_seconds}s"
        out, trunc_o = _truncate(out, max_output_bytes)
        err, trunc_e = _truncate(err, max_output_bytes)
        return SubprocessResult(
            argv=list(argv),
            exit_code=None,
            stdout=out,
            stderr=err,
            timed_out=True,
            truncated=trunc_o or trunc_e,
        )

    stdout, trunc_o = _truncate(completed.stdout or "", max_output_bytes)
    stderr, trunc_e = _truncate(completed.stderr or "", max_output_bytes)
    return SubprocessResult(
        argv=list(argv),
        exit_code=completed.returncode,
        stdout=stdout,
        stderr=stderr,
        timed_out=False,
        truncated=trunc_o or trunc_e,
    )


def run_command_string(
    command: str,
    *,
    cwd: Path | str,
    timeout_seconds: float,
    max_output_bytes: int,
    env: dict[str, str] | None = None,
) -> SubprocessResult:
    argv = parse_command_to_argv(command)
    return run_argv(
        argv,
        cwd=cwd,
        timeout_seconds=timeout_seconds,
        max_output_bytes=max_output_bytes,
        env=env,
    )


def _truncate(text: str, max_bytes: int) -> tuple[str, bool]:
    raw = text.encode("utf-8", errors="replace")
    if len(raw) <= max_bytes:
        return text, False
    return raw[:max_bytes].decode("utf-8", errors="replace"), True
