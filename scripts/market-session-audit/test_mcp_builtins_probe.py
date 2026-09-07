from __future__ import annotations

import asyncio
import importlib.util
import json
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = Path(__file__).with_name("mcp-builtins-probe.py")
SPEC = importlib.util.spec_from_file_location("mcp_builtins_probe", MODULE_PATH)
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def paths(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    owned = tmp_path / "owned"
    run = owned / "run-1"
    return owned, run / "state", run / "registry-new.json", run / "report.json"


def builtin_tools():
    from athena_mcp.server import _builtin_tool_defs

    return _builtin_tool_defs()


class FakeSession:
    def __init__(self, _read, _write, *, tools=None, delay=0.0):
        self.tools = builtin_tools() if tools is None else tools
        self.delay = delay
        self.calls: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        self.calls.append("session_exit")

    async def initialize(self):
        self.calls.append("initialize")
        if self.delay:
            await asyncio.sleep(self.delay)
        return SimpleNamespace(protocolVersion="fixture", serverInfo=None)

    async def list_tools(self):
        self.calls.append("list_tools")
        return SimpleNamespace(tools=self.tools)

    async def call_tool(self, *_args, **_kwargs):
        raise AssertionError("call_tool must never be used")


def fake_transport(captured: dict):
    @asynccontextmanager
    async def factory(parameters):
        captured["parameters"] = parameters
        captured["entered"] = True
        try:
            yield object(), object()
        finally:
            captured["exited"] = True

    return factory


def run_fixture(tmp_path: Path, *, tools=None, delay=0.0, timeout=1.0):
    owned, state, registry, output = paths(tmp_path)
    captured: dict = {}
    sessions: list[FakeSession] = []

    def session_factory(read, write):
        session = FakeSession(read, write, tools=tools, delay=delay)
        sessions.append(session)
        return session

    report = asyncio.run(
        probe.run_probe(
            execute=True,
            state_dir=state,
            registry_path=registry,
            output_path=output,
            repo_root=ROOT,
            owned_root=owned,
            timeout_seconds=timeout,
            stdio_context_factory=fake_transport(captured),
            session_factory=session_factory,
            python_executable=probe._expected_python(ROOT),
        )
    )
    return report, output, captured, sessions


def test_exact_metadata_uses_only_initialize_and_list_tools_and_closes_contexts(tmp_path):
    report, output, captured, sessions = run_fixture(tmp_path)
    assert report["verdict"] == "PASS_PROTOCOL_METADATA_ONLY"
    assert report["observation"] == {
        "tool_count": 12,
        "canvas_tool_count": 2,
        "action_metadata_count": 58,
        "exact_name_set_match": True,
        "name_fingerprint_sha256": probe.EXPECTED_NAME_FINGERPRINT,
        "schema_fingerprint_sha256": probe.EXPECTED_SCHEMA_FINGERPRINT,
        "schema_fingerprint_match": True,
        "expected_action_count_match": True,
    }
    assert sessions[0].calls == ["initialize", "list_tools", "session_exit"]
    assert captured["entered"] and captured["exited"]
    assert report["cleanup"]["sdk_context_cleanup_complete"] is True
    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert persisted["scope"]["call_tool_count"] == 0
    assert "description" not in output.read_text(encoding="utf-8")


def test_server_command_uses_backend_venv_and_exact_new_absolute_paths(tmp_path):
    report, _output, captured, _sessions = run_fixture(tmp_path)
    owned, state, registry, _ = paths(tmp_path)
    parameters = captured["parameters"]
    assert Path(parameters.command).resolve() == probe._expected_python(ROOT)
    assert parameters.cwd == ROOT / "backend"
    assert parameters.args == [
        "-m", "athena_mcp", "--state-dir", str(state.resolve()),
        "--registry", str(registry.resolve()), "serve",
    ]
    assert parameters.env["PYTHONUTF8"] == "1"
    assert not any("TOKEN" in key or "SECRET" in key or "KEY" in key for key in parameters.env)
    assert report["isolation"]["state_path_is_owned"] is True
    assert report["isolation"]["registry_path_is_owned"] is True
    assert not registry.exists()
    assert owned.exists()


def test_missing_or_changed_tool_blocks_but_still_closes_owned_context(tmp_path):
    tools = builtin_tools()[:-1]
    report, _output, captured, sessions = run_fixture(tmp_path, tools=tools)
    assert report["verdict"] == "BLOCKED"
    assert report["reason"] == "BUILTIN_FINGERPRINT_MISMATCH"
    assert report["observation"]["tool_count"] == 11
    assert captured["exited"] is True
    assert sessions[0].calls[-1] == "session_exit"
    assert report["cleanup"]["sdk_context_cleanup_complete"] is True


def test_protocol_timeout_never_lists_or_calls_tools_and_contexts_exit(tmp_path):
    report, _output, captured, sessions = run_fixture(tmp_path, delay=0.1, timeout=0.02)
    assert report["verdict"] == "BLOCKED"
    assert report["reason"] == "PROTOCOL_TIMEOUT"
    assert "list_tools" not in sessions[0].calls
    assert sessions[0].calls[-1] == "session_exit"
    assert captured["exited"] is True
    assert report["scope"]["call_tool_count"] == 0


def test_context_exit_failure_is_not_reported_as_cleanup_complete(tmp_path):
    owned, state, registry, output = paths(tmp_path)

    class ExitFailingSession(FakeSession):
        async def __aexit__(self, *_args):
            raise RuntimeError("fixture exit failed")

    captured: dict = {}
    report = asyncio.run(
        probe.run_probe(
            execute=True, state_dir=state, registry_path=registry, output_path=output,
            repo_root=ROOT, owned_root=owned, timeout_seconds=1,
            stdio_context_factory=fake_transport(captured),
            session_factory=lambda read, write: ExitFailingSession(read, write),
            python_executable=probe._expected_python(ROOT),
        )
    )
    assert report["verdict"] == "BLOCKED"
    assert report["reason"] == "PROTOCOL_ERROR"
    assert report["cleanup"]["session_context_exit_failed"] is True
    assert report["cleanup"]["session_context_exited"] is False
    assert report["cleanup"]["stdio_context_exited"] is True
    assert report["cleanup"]["sdk_context_cleanup_complete"] is False


def test_paths_must_be_distinct_new_absolute_and_below_owned_root(tmp_path):
    owned, state, registry, output = paths(tmp_path)
    with pytest.raises(probe.ProbeError, match="ABSOLUTE_PATH_REQUIRED"):
        probe.validate_owned_paths(Path("relative"), registry, output, owned_root=owned)
    state.parent.mkdir(parents=True)
    registry.write_text("{}", encoding="utf-8")
    with pytest.raises(probe.ProbeError, match="OWNED_PATH_ALREADY_EXISTS"):
        probe.validate_owned_paths(state, registry, output, owned_root=owned)
    registry.unlink()
    with pytest.raises(probe.ProbeError, match="PATHS_NOT_DISTINCT"):
        probe.validate_owned_paths(state, output, output, owned_root=owned)


def test_existing_run_root_is_rejected_even_when_all_leaf_paths_are_new(tmp_path):
    owned, state, registry, output = paths(tmp_path)
    state.parent.mkdir(parents=True)
    with pytest.raises(probe.ProbeError, match="OWNED_RUN_ROOT_ALREADY_EXISTS"):
        probe.validate_owned_paths(state, registry, output, owned_root=owned)


def test_default_user_registry_name_is_rejected_even_under_owned_root(tmp_path):
    owned, state, _registry, output = paths(tmp_path)
    with pytest.raises(probe.ProbeError, match="REGISTRY_PATH_NOT_ISOLATED"):
        probe.validate_owned_paths(state, state.parent / "mcp_servers.json", output, owned_root=owned)


def test_source_pin_drift_stops_before_transport(tmp_path, monkeypatch):
    owned, state, registry, output = paths(tmp_path)
    entered = False

    @asynccontextmanager
    async def transport(_parameters):
        nonlocal entered
        entered = True
        yield object(), object()

    monkeypatch.setitem(probe.SOURCE_PINS, "athena_mcp/registry.py", "0" * 64)
    with pytest.raises(probe.ProbeError, match="SOURCE_PIN_MISMATCH"):
        asyncio.run(
            probe.run_probe(
                execute=True, state_dir=state, registry_path=registry, output_path=output,
                repo_root=ROOT, owned_root=owned, stdio_context_factory=transport,
                python_executable=probe._expected_python(ROOT),
            )
        )
    assert entered is False
    assert not owned.exists()


def test_execute_flag_and_backend_venv_are_mandatory(tmp_path):
    owned, state, registry, output = paths(tmp_path)
    with pytest.raises(probe.ProbeError, match="EXPLICIT_EXECUTE_REQUIRED"):
        asyncio.run(
            probe.run_probe(
                execute=False, state_dir=state, registry_path=registry, output_path=output,
                repo_root=ROOT, owned_root=owned,
            )
        )
    with pytest.raises(probe.ProbeError, match="BACKEND_VENV_REQUIRED"):
        probe.build_server_parameters(
            state, registry, repo_root=ROOT, python_executable=tmp_path / "python.exe"
        )
