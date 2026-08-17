"""client.py 통합 테스트 — 진짜 subprocess로 `tests/mcp/fixtures/fake_server.py`를
spawn해 spawn -> initialize -> list_tools -> call_tool 왕복을 검증한다
(npx/node 없이도 backend/.venv의 python으로 실제 stdio 왕복을 확인할 수 있다).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from athena_mcp.client import (
    DEFAULT_MAX_RESPONSE_CHARS,
    MaxRestartsExceededError,
    ResponseTooLargeError,
    ServerCrashedError,
    UpstreamServerHandle,
)
from athena_mcp.consent import ConsentNotGrantedError, ConsentStore
from athena_mcp.registry import SECRET_SENTINEL, MissingSecretEnvError, ServerEntry

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


# ---------------------------------------------------------------------------
# SECURITY.md §6 — env 센티널이 실제로 자식 프로세스까지 전달되는지 (진짜 spawn)
# ---------------------------------------------------------------------------


async def test_sentinel_env_resolved_and_delivered_to_subprocess(tmp_path, monkeypatch):
    """앱이 주입하는 `ATHENA_MCP_ENV__<alias>__<KEY>`가 실제로 이 프로세스의
    env로 spawn된 자식(fake_server.py)에 전달되는지 진짜 subprocess 왕복으로
    확인한다 — resolve_secret_env() 단위 테스트(test_registry.py)만으로는
    StdioServerParameters를 거쳐 실제 자식까지 도달하는지 증명하지 못한다."""
    monkeypatch.setenv("ATHENA_MCP_ENV__fixture__MY_SECRET", "복호화된-실값")
    entry = ServerEntry(
        alias="fixture",
        command=sys.executable,
        args=[str(FIXTURE_SERVER)],
        env={"MY_SECRET": SECRET_SENTINEL},
    )
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    try:
        await handle.start()
        result = await handle.call_tool("env_var", {"name": "MY_SECRET"})
        assert result.isError is False
        assert result.content[0].text == "복호화된-실값"
    finally:
        await handle.close()


async def test_sentinel_env_missing_injection_blocks_spawn_fail_closed(tmp_path, monkeypatch):
    """앱을 거치지 않고 이 서버를 직접 spawn하려 하면(주입 환경변수 없음)
    조용히 빈 값으로 넘기지 않고 spawn 자체가 명확히 실패한다."""
    monkeypatch.delenv("ATHENA_MCP_ENV__fixture__MY_SECRET", raising=False)
    entry = ServerEntry(
        alias="fixture",
        command=sys.executable,
        args=[str(FIXTURE_SERVER)],
        env={"MY_SECRET": SECRET_SENTINEL},
    )
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    with pytest.raises(MissingSecretEnvError):
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


async def test_default_max_response_chars_does_not_truncate_real_dart_capture_size():
    """실측 최대 upstream 응답(1,042,014자, CAPTURE-S2B-jjlabsio.md)이 기본
    상한을 넘지 않아야 한다 — 넘으면 정상 DART 대용량 공시가 거부된다."""
    observed_max_dart_capture_chars = 1_042_014
    assert DEFAULT_MAX_RESPONSE_CHARS > observed_max_dart_capture_chars


async def test_call_tool_raises_response_too_large_error_over_cap(tmp_path, entry):
    """`large_response` 픽스처로 실제 subprocess 왕복에서 상한 초과를 재현한다.

    자르지 않고 명시 에러를 던지는지, 그 에러가 alias/tool_name/observed_size/
    limit을 다 싣는지, 그리고 이건 "크래시"가 아니므로 crash_count를 올리지
    않는지(세션도 안 죽이는지) 확인한다.
    """
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(
        entry, store, log_dir=tmp_path / "logs", max_response_chars=1_000
    )
    try:
        await handle.start()
        with pytest.raises(ResponseTooLargeError) as exc_info:
            await handle.call_tool("large_response", {"size": 5_000})
        err = exc_info.value
        assert err.alias == "fixture"
        assert err.tool_name == "large_response"
        assert err.observed_size > 1_000
        assert err.limit == 1_000
        assert handle.crash_count == 0
        # 상한 초과는 크래시가 아니다 — 세션은 계속 쓸 수 있어야 한다.
        assert handle.is_running is True
        result = await handle.call_tool("echo", {"message": "still alive"})
        assert result.content[0].text == "Echo: still alive"
    finally:
        await handle.close()


async def test_call_tool_allows_response_under_cap(tmp_path, entry):
    """상한(1,000자)보다 확실히 작게 잡는다 — `model_dump_json()`은 `content`
    배열 등 봉투(envelope) 구조까지 합친 길이라 `content[0].text` 길이보다
    항상 더 크다(실측: text 500자 -> 직렬화 전체 1,132자). 이 여유가 없으면
    "text 길이는 상한 밑인데 직렬화 전체는 넘는" 경계 조건과 헷갈린다."""
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(
        entry, store, log_dir=tmp_path / "logs", max_response_chars=1_000
    )
    try:
        await handle.start()
        result = await handle.call_tool("large_response", {"size": 200})
        assert result.isError is False
        assert len(result.content[0].text) == 200
    finally:
        await handle.close()


async def test_list_tools_raises_response_too_large_error_over_cap(tmp_path, entry):
    """`list_tools()`에도 같은 상한이 적용되는지 — 이번 픽스처에 등록된 7개
    툴의 이름/설명/inputSchema를 합치면 아주 낮은 상한(10자)은 확실히 넘는다."""
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs", max_response_chars=10)
    try:
        await handle.start()
        with pytest.raises(ResponseTooLargeError) as exc_info:
            await handle.list_tools()
        err = exc_info.value
        assert err.alias == "fixture"
        assert err.tool_name is None
        assert err.observed_size > 10
        assert err.limit == 10
    finally:
        await handle.close()


async def test_call_tool_forwards_progress_callback(tmp_path, entry):
    """A3 계약: `progress_callback`이 upstream `session.call_tool`까지 그대로
    전달되는지 실제 subprocess 진행 알림 왕복으로 확인한다."""
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")
    received: list[tuple[float, float | None, str | None]] = []

    async def on_progress(progress: float, total: float | None, message: str | None) -> None:
        received.append((progress, total, message))

    try:
        await handle.start()
        result = await handle.call_tool(
            "progress_tool", {"steps": 3, "delay_seconds": 0.0}, progress_callback=on_progress
        )
        assert result.content[0].text == "done after 3 steps"
        assert [p for p, _, _ in received] == [1, 2, 3]
        assert all(total == 3 for _, total, _ in received)
    finally:
        await handle.close()


async def test_call_tool_cancellation_propagates_and_is_not_treated_as_crash(tmp_path, entry):
    """호출자가 기다리는 동안 취소되면 `asyncio.CancelledError`가 그대로
    전파돼야 한다 — `ServerCrashedError`로 둔갑하면 안 되고(취소는 크래시가
    아니다) `crash_count`도 올라가면 안 된다. `progress_tool`의 지연을 써서
    취소가 정말로 진행 중간에 끼어들게 만든다.
    """
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(
        entry, store, log_dir=tmp_path / "logs", call_timeout_seconds=30.0
    )
    try:
        await handle.start()
        task = asyncio.create_task(
            handle.call_tool("progress_tool", {"steps": 50, "delay_seconds": 0.05})
        )
        await asyncio.sleep(0.15)  # 진행 중간(50스텝 중 몇 스텝)에 걸리게 함
        assert not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert handle.crash_count == 0
        assert handle.is_running is True
        # 세션이 실제로 살아 있고 계속 쓸 수 있는지 재확인한다(취소가 세션을
        # 오염시키지 않았는지).
        result = await handle.call_tool("echo", {"message": "after cancel"})
        assert result.content[0].text == "Echo: after cancel"
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
