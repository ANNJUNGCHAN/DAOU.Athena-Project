#!/usr/bin/env python
"""Isolated MCP initialize/list_tools probe. It never calls a tool."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, AsyncIterator, Callable

from mcp import ClientSession, StdioServerParameters
import mcp.client.stdio as mcp_stdio
from mcp.client.stdio import get_default_environment, stdio_client


REPO_ROOT = Path(__file__).resolve().parents[2]
OWNED_ROOT = REPO_ROOT / "artifacts" / "market-session-audit" / "2026-09-07" / "mcp-builtins-probe"
EXPECTED_NAMES = (
    "athena__render_canvas",
    "athena__save_canvas",
    "athena_backtest",
    "athena_brain",
    "athena_call",
    "athena_describe",
    "athena_graph_view",
    "athena_nudge_guard",
    "athena_plugin",
    "athena_resolve",
    "athena_routine",
    "athena_search",
)
EXPECTED_NAME_FINGERPRINT = "dc90701f8e7fcdea6528404725892c545596cbc8f45d6bba7e61fd26d368f5c2"
EXPECTED_SCHEMA_FINGERPRINT = "0e5bd7c6e0f9649df5b7a8ad1b79e8f577d1dfbd199f340e33018f4916f65195"
EXPECTED_ACTION_COUNT = 58
SDK_STDIO_SOURCE_PIN = "a23227cfe1e3456f16ab41311486a399cf547fcc6b645399bf9bf3a6dc6cf654"
SOURCE_PINS = {
    "athena_mcp/registry.py": "e22483fa544e20d82af13db66191c0d42a9070513ed6ab36ac447268513fefc9",
    "athena_mcp/consent.py": "8c30d5e0f2563cbc0f09a1279503972bc8329c0c9529bcc2eb3714734acca089",
    "athena_mcp/runner.py": "d9cbf94b475ed7c501291e531d2190431a077dbfc8cf6a6834287c8f8073c7a7",
    "athena_mcp/__main__.py": "0eb5be87279b81de04b259074b7d2c1a1345ef860f64351b1b4864a2f63c418f",
    "athena_mcp/server.py": "46f0997ed3b4fffa2297cbd0fc585e244d43b3470fa7ca0d99c8af62ba29fbfa",
    "athena_mcp/canvas.py": "996b10dadcf3bb42113a66432566ba33f38c6759c71b5c3f9ae94659669468d7",
    "athena_mcp/selector_tools.py": "24b38b171eae2d67236994d13444b9627244ebb287d82f4caf40cd6426f221e8",
    "athena_mcp/routine_tools.py": "9fa21472502d4065272aa3feb5100072f4915492d0c91cf8eb10f7045b9a3130",
    "athena_mcp/brain_tools.py": "df68ffd2ffed7992144841fa7a392acd06644650d86da7085b753bc4b1bfa32f",
    "athena_mcp/graph_view_tools.py": "4b13d0a7f3808141095e323ea5a60c15e1412130ff354759d0d2fab1252fd1d8",
    "athena_mcp/nudge_guard_tools.py": "122c8c17c771947bac8e290220c52a44661a8265425955dbe1220251ebfd867d",
    "athena_mcp/backtest_tools.py": "967c80a43f015a342aba9c7ddbd9c5d6c06461fbe2a49bde10704f589928b166",
    "athena_mcp/plugin_tools.py": "163a0e1573b8ba9b223ca955291689ecfb030ecf4fa567dbbd2e542e4cbad407",
}


class ProbeError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _TrackedContext:
    def __init__(self, context: Any, lifecycle: dict[str, bool], prefix: str) -> None:
        self._context = context
        self._lifecycle = lifecycle
        self._prefix = prefix

    async def __aenter__(self) -> Any:
        value = await self._context.__aenter__()
        self._lifecycle[f"{self._prefix}_context_entered"] = True
        return value

    async def __aexit__(self, exc_type, exc, traceback) -> bool | None:
        try:
            suppressed = await self._context.__aexit__(exc_type, exc, traceback)
        except BaseException:
            self._lifecycle[f"{self._prefix}_context_exit_failed"] = True
            raise
        self._lifecycle[f"{self._prefix}_context_exited"] = True
        return suppressed


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def validate_owned_paths(
    state_dir: Path,
    registry_path: Path,
    output_path: Path,
    *,
    owned_root: Path = OWNED_ROOT,
) -> tuple[Path, Path, Path]:
    if any(not path.is_absolute() for path in (state_dir, registry_path, output_path)):
        raise ProbeError("ABSOLUTE_PATH_REQUIRED")
    paths = tuple(path.resolve() for path in (state_dir, registry_path, output_path))
    root = owned_root.resolve()
    if any(not _is_relative_to(path, root) for path in paths):
        raise ProbeError("PATH_OUTSIDE_OWNED_ROOT")
    state, registry, output = paths
    if registry.name == "mcp_servers.json" or registry.suffix.lower() != ".json":
        raise ProbeError("REGISTRY_PATH_NOT_ISOLATED")
    if output.suffix.lower() != ".json":
        raise ProbeError("OUTPUT_PATH_INVALID")
    if len({state, registry, output}) != 3:
        raise ProbeError("PATHS_NOT_DISTINCT")
    if state.exists() or registry.exists() or output.exists():
        raise ProbeError("OWNED_PATH_ALREADY_EXISTS")
    if state.parent != registry.parent or state.parent != output.parent:
        raise ProbeError("OWNED_RUN_ROOT_MISMATCH")
    if state.parent.exists():
        raise ProbeError("OWNED_RUN_ROOT_ALREADY_EXISTS")
    return state, registry, output


def verify_sources(repo_root: Path = REPO_ROOT) -> dict[str, str]:
    backend = repo_root.resolve() / "backend"
    observed: dict[str, str] = {}
    for relative, expected in SOURCE_PINS.items():
        source = backend / relative
        try:
            actual = _sha256(source.read_bytes())
        except OSError as exc:
            raise ProbeError("SOURCE_PIN_UNAVAILABLE") from exc
        if actual != expected:
            raise ProbeError("SOURCE_PIN_MISMATCH")
        observed[relative] = actual
    return observed


def verify_sdk_source(repo_root: Path = REPO_ROOT) -> str:
    expected_path = (
        repo_root.resolve()
        / "backend"
        / ".venv"
        / "Lib"
        / "site-packages"
        / "mcp"
        / "client"
        / "stdio"
        / "__init__.py"
    ).resolve()
    actual_path = Path(mcp_stdio.__file__).resolve()
    if actual_path != expected_path:
        raise ProbeError("SDK_STDIO_SOURCE_PATH_MISMATCH")
    try:
        digest = _sha256(actual_path.read_bytes())
    except OSError as exc:
        raise ProbeError("SDK_STDIO_SOURCE_UNAVAILABLE") from exc
    if digest != SDK_STDIO_SOURCE_PIN:
        raise ProbeError("SDK_STDIO_SOURCE_PIN_MISMATCH")
    return digest


def _action_count(value: Any) -> int:
    if isinstance(value, list):
        return sum(_action_count(item) for item in value)
    if not isinstance(value, dict):
        return 0
    count = 0
    properties = value.get("properties")
    if isinstance(properties, dict):
        action = properties.get("action")
        if isinstance(action, dict) and isinstance(action.get("enum"), list):
            count += len(action["enum"])
    return count + sum(_action_count(item) for item in value.values())


def fingerprint_tools(tools: list[Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for tool in tools:
        name = getattr(tool, "name", None)
        schema = getattr(tool, "inputSchema", None)
        if not isinstance(name, str) or not isinstance(schema, dict):
            raise ProbeError("TOOL_METADATA_SHAPE_MISMATCH")
        rows.append({"name": name, "inputSchema": schema})
    rows.sort(key=lambda item: item["name"])
    names = [item["name"] for item in rows]
    if len(names) != len(set(names)):
        raise ProbeError("DUPLICATE_TOOL_NAME")
    name_fingerprint = _sha256(_canonical(names))
    schema_fingerprint = _sha256(_canonical(rows))
    action_count = sum(_action_count(item["inputSchema"]) for item in rows)
    return {
        "tool_count": len(rows),
        "canvas_tool_count": sum(name in {"athena__render_canvas", "athena__save_canvas"} for name in names),
        "action_metadata_count": action_count,
        "exact_name_set_match": tuple(names) == EXPECTED_NAMES,
        "name_fingerprint_sha256": name_fingerprint,
        "schema_fingerprint_sha256": schema_fingerprint,
        "schema_fingerprint_match": schema_fingerprint == EXPECTED_SCHEMA_FINGERPRINT,
        "expected_action_count_match": action_count == EXPECTED_ACTION_COUNT,
    }


def _expected_python(repo_root: Path) -> Path:
    executable = "python.exe" if os.name == "nt" else "python"
    scripts = "Scripts" if os.name == "nt" else "bin"
    return (repo_root / "backend" / ".venv" / scripts / executable).resolve()


def build_server_parameters(
    state_dir: Path,
    registry_path: Path,
    *,
    repo_root: Path = REPO_ROOT,
    python_executable: Path | None = None,
) -> StdioServerParameters:
    python = (python_executable or Path(sys.executable)).resolve()
    if python != _expected_python(repo_root.resolve()):
        raise ProbeError("BACKEND_VENV_REQUIRED")
    system_root = Path(os.environ.get("SYSTEMROOT", r"C:\Windows"))
    launch_env = {
        "SYSTEMROOT": str(system_root),
        "WINDIR": str(system_root),
        "COMSPEC": str(system_root / "System32" / "cmd.exe"),
        "PATH": os.pathsep.join((str(python.parent), str(system_root / "System32"))),
        "PATHEXT": ".COM;.EXE;.BAT;.CMD",
        "SYSTEMDRIVE": system_root.drive or "C:",
    }
    if os.environ.get("PROCESSOR_ARCHITECTURE"):
        launch_env["PROCESSOR_ARCHITECTURE"] = os.environ["PROCESSOR_ARCHITECTURE"]
    run_root = state_dir.parent.resolve()
    synthetic_profile = run_root / "profile"
    synthetic_temp = run_root / "temp"
    drive, home_path = os.path.splitdrive(str(synthetic_profile))
    launch_env.update(
        {
            "APPDATA": str(synthetic_profile / "AppData" / "Roaming"),
            "LOCALAPPDATA": str(synthetic_profile / "AppData" / "Local"),
            "USERPROFILE": str(synthetic_profile),
            "HOMEDRIVE": drive,
            "HOMEPATH": home_path,
            "USERNAME": "athena-audit",
            "TEMP": str(synthetic_temp),
            "TMP": str(synthetic_temp),
            "PYTHONUTF8": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return StdioServerParameters(
        command=str(python),
        args=[
            "-m",
            "athena_mcp",
            "--state-dir",
            str(state_dir),
            "--registry",
            str(registry_path),
            "serve",
        ],
        cwd=repo_root.resolve() / "backend",
        env=launch_env,
        encoding="utf-8",
        encoding_error_handler="strict",
    )


def effective_child_environment(parameters: StdioServerParameters) -> dict[str, str]:
    return {**get_default_environment(), **(parameters.env or {})}


def validate_effective_environment(parameters: StdioServerParameters, run_root: Path) -> None:
    effective = effective_child_environment(parameters)
    expected_profile = (run_root / "profile").resolve()
    expected_temp = (run_root / "temp").resolve()
    expected = {
        "APPDATA": expected_profile / "AppData" / "Roaming",
        "LOCALAPPDATA": expected_profile / "AppData" / "Local",
        "USERPROFILE": expected_profile,
        "TEMP": expected_temp,
        "TMP": expected_temp,
    }
    if any(Path(effective.get(key, "")).resolve() != value for key, value in expected.items()):
        raise ProbeError("EFFECTIVE_ENVIRONMENT_NOT_ISOLATED")
    forbidden_keys = ("TOKEN", "SECRET", "API_KEY", "PASSWORD", "CREDENTIAL")
    if any(any(marker in key.upper() for marker in forbidden_keys) for key in effective):
        raise ProbeError("CREDENTIAL_ENVIRONMENT_INHERITED")
    host_profile_value = os.environ.get("USERPROFILE", "").strip()
    host_profile = Path(host_profile_value).resolve() if host_profile_value else None
    if (
        host_profile
        and not _is_relative_to(run_root.resolve(), host_profile)
        and any(str(host_profile).casefold() in value.casefold() for value in effective.values())
    ):
        raise ProbeError("HOST_PROFILE_ENVIRONMENT_INHERITED")


def prepare_effective_environment_directories(run_root: Path) -> None:
    profile = (run_root / "profile").resolve()
    try:
        (profile / "AppData" / "Roaming").mkdir(parents=True, exist_ok=False)
        (profile / "AppData" / "Local").mkdir(exist_ok=False)
        (run_root / "temp").resolve().mkdir(exist_ok=False)
    except OSError as exc:
        raise ProbeError("ENVIRONMENT_DIRECTORY_PREPARATION_FAILED") from exc


@asynccontextmanager
async def _stdio_context(parameters: StdioServerParameters) -> AsyncIterator[tuple[Any, Any]]:
    with open(os.devnull, "w", encoding="utf-8") as error_log:
        async with stdio_client(parameters, errlog=error_log) as streams:
            yield streams


async def run_probe(
    *,
    execute: bool,
    state_dir: Path,
    registry_path: Path,
    output_path: Path,
    repo_root: Path = REPO_ROOT,
    owned_root: Path = OWNED_ROOT,
    timeout_seconds: float = 10.0,
    stdio_context_factory: Callable[[StdioServerParameters], Any] = _stdio_context,
    session_factory: Callable[[Any, Any], Any] = ClientSession,
    python_executable: Path | None = None,
) -> dict[str, Any]:
    if not execute:
        raise ProbeError("EXPLICIT_EXECUTE_REQUIRED")
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0 or timeout_seconds > 20:
        raise ProbeError("TIMEOUT_OUT_OF_RANGE")
    state, registry, output = validate_owned_paths(state_dir, registry_path, output_path, owned_root=owned_root)
    source_pins = verify_sources(repo_root)
    verify_sdk_source(repo_root)
    parameters = build_server_parameters(state, registry, repo_root=repo_root, python_executable=python_executable)
    validate_effective_environment(parameters, state.parent)
    output.parent.mkdir(parents=True, exist_ok=False)
    prepare_effective_environment_directories(state.parent)
    lifecycle = {
        "stdio_context_entered": False,
        "session_context_entered": False,
        "initialized": False,
        "list_tools_completed": False,
        "session_context_exited": False,
        "stdio_context_exited": False,
        "session_context_exit_failed": False,
        "stdio_context_exit_failed": False,
    }
    observation: dict[str, Any] | None = None
    failure: str | None = None
    try:
        async with asyncio.timeout(timeout_seconds):
            async with _TrackedContext(stdio_context_factory(parameters), lifecycle, "stdio") as (read_stream, write_stream):
                async with _TrackedContext(session_factory(read_stream, write_stream), lifecycle, "session") as session:
                    await session.initialize()
                    lifecycle["initialized"] = True
                    listed = await session.list_tools()
                    lifecycle["list_tools_completed"] = True
                    observation = fingerprint_tools(list(listed.tools))
    except TimeoutError:
        failure = "PROTOCOL_TIMEOUT"
    except ProbeError as exc:
        failure = exc.code
    except Exception:
        failure = "PROTOCOL_ERROR"

    exact = bool(
        observation
        and observation["tool_count"] == 12
        and observation["canvas_tool_count"] == 2
        and observation["exact_name_set_match"]
        and observation["name_fingerprint_sha256"] == EXPECTED_NAME_FINGERPRINT
        and observation["schema_fingerprint_match"]
        and observation["expected_action_count_match"]
    )
    cleanup_complete = bool(
        lifecycle["session_context_exited"]
        and lifecycle["stdio_context_exited"]
        and not lifecycle["session_context_exit_failed"]
        and not lifecycle["stdio_context_exit_failed"]
    )
    report = {
        "schema_version": 1,
        "kind": "athena_mcp_builtins_protocol_probe",
        "generated_at": datetime.now(UTC).isoformat(),
        "mode": "isolated_stdio_protocol",
        "verdict": "PASS_PROTOCOL_METADATA_ONLY" if exact and cleanup_complete else "BLOCKED",
        "reason": None if exact and cleanup_complete else failure or "BUILTIN_FINGERPRINT_MISMATCH",
        "scope": {
            "initialize_count": 1 if lifecycle["initialized"] else 0,
            "list_tools_count": 1 if lifecycle["list_tools_completed"] else 0,
            "call_tool_count": 0,
            "provider_processes_authorized": 0,
            "user_registry_read": False,
            "user_runtime_proven": False,
            "upstream_connectivity_proven": False,
        },
        "isolation": {
            "state_path_is_owned": _is_relative_to(state, owned_root.resolve()),
            "registry_path_is_owned": _is_relative_to(registry, owned_root.resolve()),
            "registry_existed_before": False,
            "source_pin_count": len(source_pins),
            "sdk_stdio_source_pin_verified": True,
            "effective_environment_profile_is_owned": True,
            "effective_environment_directories_created": True,
        },
        "observation": observation,
        "cleanup": {
            **lifecycle,
            "sdk_context_cleanup_complete": cleanup_complete,
            "os_process_identity_captured": False,
            "os_process_exit_independently_verified": False,
        },
    }
    try:
        with output.open("x", encoding="utf-8", errors="strict") as handle:
            handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    except OSError as exc:
        raise ProbeError("ARTIFACT_WRITE_FAILED") from exc
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--registry", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout", type=float, default=10.0)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        report = asyncio.run(
            run_probe(
                execute=args.execute,
                state_dir=args.state_dir,
                registry_path=args.registry,
                output_path=args.output,
                timeout_seconds=args.timeout,
            )
        )
    except ProbeError as exc:
        print(json.dumps({"status": "failed", "reason": exc.code}), file=sys.stderr)
        return 1
    print(json.dumps({"status": report["verdict"], "output": str(args.output.resolve())}))
    return 0 if report["verdict"].startswith("PASS") else 1


if __name__ == "__main__":
    raise SystemExit(main())
