"""client.py 통합 테스트 — 진짜 subprocess로 `tests/mcp/fixtures/fake_server.py`를
spawn해 spawn -> initialize -> list_tools -> call_tool 왕복을 검증한다
(npx/node 없이도 backend/.venv의 python으로 실제 stdio 왕복을 확인할 수 있다).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from athena_mcp.client import (
    MaxRestartsExceededError,
    ServerCrashedError,
    UpstreamServerHandle,
)
from athena_mcp.consent import ConsentNotGrantedError, ConsentStore
from athena_mcp.registry import ServerEntry

FIXTURE_SERVER = Path(__file__).resolve().parent / "fixtures" / "fake_server.py"


def _approved_store(tmp_path, alias: str) -> ConsentStore:
    store = ConsentStore(path=tmp_path / "consent.json")
    store.request_consent(alias, sys.executable, [str(FIXTURE_SERVER)], {})
    store.approve(alias)
    return store


@pytest.fixture
def entry() -> ServerEntry:
    return ServerEntry(alias="fixture", command=sys.executable, args=[str(FIXTURE_SERVER)], env={})


async def test_spawn_initialize_list_tools_call_tool_roundtrip(tmp_path, entry):
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    try:
        init_result = await handle.start()
        assert init_result.serverInfo is not None
        assert init_result.serverInfo.name == "fake-athena-fixture"

        tools = await handle.list_tools()
        tool_names = {t.name for t in tools}
        assert {"echo", "get_corp_code", "boom", "flaky"} <= tool_names

        result = await handle.call_tool("echo", {"message": "hello"})
        assert result.isError is False
        assert result.content[0].text == "Echo: hello"
    finally:
        await handle.close()


async def test_server_info_recorded_as_self_reported(tmp_path, entry):
    """`serverInfo.version`을 믿지 않고 그대로 기록만 하는지."""
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    try:
        await handle.start()
        assert handle.server_info is not None
        assert handle.server_info.reported_name == "fake-athena-fixture"
        assert handle.server_info.protocol_version is not None
    finally:
        await handle.close()


async def test_spawn_without_approval_is_blocked(tmp_path, entry):
    """W1-5 핵심: 승인 없이는 프로세스가 절대 뜨지 않는다."""
    store = ConsentStore(path=tmp_path / "consent.json")  # request_consent도 안 함
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    with pytest.raises(ConsentNotGrantedError):
        await handle.start()
    assert handle.is_running is False


async def test_per_server_log_file_created_and_contains_lifecycle_events(tmp_path, entry):
    store = _approved_store(tmp_path, "fixture")
    log_dir = tmp_path / "logs"
    handle = UpstreamServerHandle(entry, store, log_dir=log_dir)
    try:
        await handle.start()
        assert handle.log_path.exists()
        text = handle.log_path.read_text(encoding="utf-8")
        assert "started" in text
        assert "fixture" in text
    finally:
        await handle.close()


async def test_healthcheck_true_while_alive(tmp_path, entry):
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    try:
        await handle.start()
        assert await handle.healthcheck() is True
    finally:
        await handle.close()


async def test_healthcheck_false_before_start(tmp_path):
    store = ConsentStore(path=tmp_path / "consent.json")
    handle = UpstreamServerHandle(
        ServerEntry(alias="x", command="noop"), store, log_dir=tmp_path / "logs"
    )
    assert await handle.healthcheck() is False


async def test_call_tool_iserror_true_on_tool_exception(tmp_path, entry):
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    try:
        await handle.start()
        result = await handle.call_tool("boom", {})
        assert result.isError is True
    finally:
        await handle.close()


async def test_crash_detected_and_restart_recovers(tmp_path):
    """`flaky` 툴이 1번째 호출에서 응답 없이 프로세스를 죽인다 -> call_tool이
    ServerCrashedError를 던진다 -> restart()로 새 프로세스가 뜬다."""
    entry = ServerEntry(
        alias="flaky-fixture",
        command=sys.executable,
        args=[str(FIXTURE_SERVER)],
        env={"CRASH_AFTER_N_CALLS": "1"},
    )
    store = _approved_store(tmp_path, "flaky-fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs", call_timeout_seconds=5.0)
    try:
        await handle.start()
        with pytest.raises(ServerCrashedError):
            await handle.call_tool("flaky", {})
        assert handle.crash_count >= 1

        # 재시작하면 새 프로세스가 뜨고(카운터 리셋) 다시 정상 응답한다
        await handle.restart()
        assert handle.restart_count == 1
        result = await handle.call_tool("echo", {"message": "recovered"})
        assert result.content[0].text == "Echo: recovered"
    finally:
        await handle.close()


async def test_restart_respects_max_restarts(tmp_path):
    entry = ServerEntry(
        alias="always-crashes",
        command=sys.executable,
        args=[str(FIXTURE_SERVER)],
        env={"CRASH_AFTER_N_CALLS": "1"},
    )
    store = _approved_store(tmp_path, "always-crashes")
    handle = UpstreamServerHandle(
        entry, store, log_dir=tmp_path / "logs", max_restarts=1, restart_backoff_seconds=0.01
    )
    try:
        await handle.start()
        with pytest.raises(ServerCrashedError):
            await handle.call_tool("flaky", {})
        await handle.restart()  # 1번째 재시작 — 허용됨(max_restarts=1)
        with pytest.raises(ServerCrashedError):
            await handle.call_tool("flaky", {})
        with pytest.raises(MaxRestartsExceededError):
            await handle.restart()  # 2번째 — 상한 초과
    finally:
        await handle.close()
