"""client.py 통합 테스트 — 진짜 subprocess로 `tests/mcp/fixtures/fake_server.py`를
spawn해 spawn -> initialize -> list_tools -> call_tool 왕복을 검증한다
(npx/node 없이도 backend/.venv의 python으로 실제 stdio 왕복을 확인할 수 있다).
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

from athena_mcp.client import (
    DEFAULT_MAX_RESPONSE_CHARS,
    MaxRestartsExceededError,
    ResponseTooLargeError,
    ServerCrashedError,
    UpstreamServerHandle,
    read_log_text,
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
        # strict utf-8이 아니라 handle.read_log() — 이 로그엔 upstream
        # 서브프로세스가 stderr에 직접 쓴, 임의 인코딩일 수 있는 바이트가 섞여
        # 있다(US-011, read_log_text() 참고). 한글 경로 워크트리에서 실측됨.
        text = handle.read_log()
        assert "started" in text
        assert "fixture" in text
    finally:
        await handle.close()


def test_read_log_text_replaces_undecodable_bytes_instead_of_crashing(tmp_path):
    """US-011 회귀 — `errlog`가 upstream 서브프로세스에 그대로 넘어가는 파일
    디스크립터라, 자식이 우리 로그 UTF-8 텍스트 사이에 임의 인코딩 바이트를
    섞어 써도 막을 수 없다(예: cp949 로케일 자식이 stderr에 쓴 한글 경로).
    실측 재현: '\xc0\xe5\xc1\xdf'는 "장중"의 cp949 인코딩이고, utf-8로는
    유효하지 않은 바이트열이다 — strict 디코드는 여기서 죽는다."""
    log_path = tmp_path / "fixture.log"
    valid_prefix = b"[2026-08-18T00:00:00+00:00] started alias=fixture\n"
    # 실제 침입 경로 그대로: 경로 문자열 중간에만 cp949 바이트가 끼어든다.
    forged_cp949_stderr = b"C:\\...\\DAOU.Athena\\" + b"\xc0\xe5\xc1\xdf" + b"\\backend\r\n"
    valid_suffix_text = "[2026-08-18T00:00:01+00:00] self_reported_version='1.28.1' "
    valid_suffix_text += "(자가보고, 신뢰 금지)\n"
    valid_suffix = valid_suffix_text.encode()
    log_path.write_bytes(valid_prefix + forged_cp949_stderr + valid_suffix)

    text = read_log_text(log_path)  # 크래시하지 않는다 — strict였다면 여기서 UnicodeDecodeError

    assert "started alias=fixture" in text  # 앞뒤 유효 UTF-8 내용은 보존된다
    assert "자가보고, 신뢰 금지" in text
    assert "\ufffd" in text  # 깨진 바이트는 조용히 지워지지 않고 U+FFFD로 남는다


async def test_pump_stderr_writes_valid_utf8_log_even_with_cp949_bytes(tmp_path):
    """US-011 회귀 — **기록 시점** 방어. `_pump_stderr()`는 upstream 서브
    프로세스가 stderr에 쓴 바이트를(예: cp949 로케일 자식이 쓴 한글 경로)
    파이프로 직접 받아 `errors="replace"`로 디코드한 뒤에만 로그 파일에 쓴다
    — 그 결과 로그 파일 자체가 항상 유효한 UTF-8이라, 위 회귀 테스트처럼
    관대하게 읽지 않고 **strict** `read_text(encoding="utf-8")`로 읽어도
    죽지 않는다(이중 방어의 첫 번째 층 — `read_log_text()`는 두 번째 층)."""
    entry = ServerEntry(alias="fixture", command=sys.executable, args=[], env={})
    store = _approved_store(tmp_path, "fixture")
    handle = UpstreamServerHandle(entry, store, log_dir=tmp_path / "logs")

    read_fd, write_fd = os.pipe()
    # 자식 프로세스가 stderr에 직접 쓰는 상황을 그대로 흉내낸다:
    # 경로 문자열 중간에 실측 그대로의 cp949 바이트("장중")가 끼어든다.
    forged_cp949 = bytes([0xC0, 0xE5, 0xC1, 0xDF])
    os.write(write_fd, b"C:\\...\\DAOU.Athena\\" + forged_cp949 + b"\\backend\r\n")
    os.write(write_fd, "정상 UTF-8 줄도 같은 스트림에 있다\n".encode())
    os.close(write_fd)  # EOF — pump 루프가 이걸로 끝난다

    await handle._pump_stderr(read_fd)

    # strict로도 안 죽는다 — 기록 시점에 이미 안전한 UTF-8로 바뀌어 있다.
    text = handle.log_path.read_text(encoding="utf-8")
    assert chr(0xFFFD) in text
    assert "정상 UTF-8 줄도 같은 스트림에 있다" in text


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


# ---------------------------------------------------------------------------
# _join_task() — 바깥 취소를 삼키지 않는지 (결함 3 회귀)
#
# 실제 `asyncio.Task`끼리는 `await task` 지점에서 바깥 코루틴이 취소되면
# `Task.cancel()`의 `_fut_waiter` 위임 메커니즘 때문에 조인 대상 태스크 자신도
# 함께 취소되어(`task.cancelled()`가 True가 됨) 결정적으로 구분 재현하기 매우
# 까다로운 레이스다. 그래서 `cancelled()`를 직접 통제할 수 있는 최소 가짜
# 객체로 `_join_task()`의 분기 로직 자체(`if not task.cancelled(): raise`)를
# 검증한다 — 실제 프로세스 타이밍 레이스를 재현하는 대신, 그 로직이 두 입력
# 각각에 대해 옳게 동작하는지를 결정적으로 고정한다.
# ---------------------------------------------------------------------------


async def test_join_task_reraises_cancelled_error_when_joined_task_was_not_itself_cancelled(
    tmp_path,
):
    """조인 대상(`task`) 자신은 취소로 끝난 게 아닌데도 `await task`에서
    CancelledError가 나는 경우 — 이 코루틴을 감싼 바깥 스코프가 취소된
    경우다. 예전 코드(`except (CancelledError, Exception): pass`)는 이것도
    무조건 삼켜서, 헬스체크 슈퍼바이저 취소 -> restart() -> close() ->
    _join_task 경로에서 바깥 취소가 증발해 `serve_stdio` 종료가 무기한
    걸릴 수 있었다."""
    store = ConsentStore(path=tmp_path / "consent.json")
    handle = UpstreamServerHandle(
        ServerEntry(alias="x", command="noop"), store, log_dir=tmp_path / "logs"
    )

    class _NotCancelledTask:
        def cancelled(self) -> bool:
            return False

        def __await__(self):
            raise asyncio.CancelledError()
            yield  # pragma: no cover — __await__는 제너레이터여야 하지만 위에서 이미 raise한다

    handle._task = _NotCancelledTask()  # type: ignore[assignment]  # noqa: SLF001
    with pytest.raises(asyncio.CancelledError):
        await handle._join_task()  # noqa: SLF001


async def test_join_task_swallows_cancelled_error_when_joined_task_was_itself_cancelled(tmp_path):
    """반대 경우 — 조인 대상 자신이 취소로 끝난 경우(예: 세션 수명주기 태스크가
    실제로 취소돼 완료된 경우)는 예전처럼 삼켜야 한다. 종료 과정의 정상적인
    잡음이지 막을 이유가 없다."""
    store = ConsentStore(path=tmp_path / "consent.json")
    handle = UpstreamServerHandle(
        ServerEntry(alias="x", command="noop"), store, log_dir=tmp_path / "logs"
    )

    class _CancelledTask:
        def cancelled(self) -> bool:
            return True

        def __await__(self):
            raise asyncio.CancelledError()
            yield  # pragma: no cover

    handle._task = _CancelledTask()  # type: ignore[assignment]  # noqa: SLF001
    await handle._join_task()  # noqa: SLF001 — raise하지 않으면 통과


async def test_join_task_still_swallows_plain_exceptions(tmp_path):
    """CancelledError 분기를 따로 뺐다고 해서 그 외 일반 예외까지 새면
    안 된다 — 종료 중 잡음은 여전히 삼킨다(기존 계약 유지)."""
    store = ConsentStore(path=tmp_path / "consent.json")
    handle = UpstreamServerHandle(
        ServerEntry(alias="x", command="noop"), store, log_dir=tmp_path / "logs"
    )

    class _BoomTask:
        def cancelled(self) -> bool:
            return False

        def __await__(self):
            raise RuntimeError("정리 중 잡음")
            yield  # pragma: no cover

    handle._task = _BoomTask()  # type: ignore[assignment]  # noqa: SLF001
    await handle._join_task()  # noqa: SLF001 — raise하지 않으면 통과


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
