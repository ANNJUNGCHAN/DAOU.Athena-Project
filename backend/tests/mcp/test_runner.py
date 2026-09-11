"""러너 + 이번에 고친 결함들의 회귀 테스트.

여기 있는 테스트는 전부 **실제로 터졌던 것**을 고정한다:

- `doctor`가 서버 3개를 붙였다가 끊을 때 anyio 취소 스코프 위반으로 죽었다
  -> `test_disconnect_in_any_order_does_not_raise`
- `registry.rename()`만 있고 aggregator/consent를 아무도 안 옮겨서, rename하면
  이미 승인한 서버가 조용히 미승인이 됐다 -> `test_rename_moves_*`
- `connect()`가 `UpdateResult`를 버려서 64자 스킵이 아무 데도 안 남았다
  -> `test_connect_returns_update_result_with_violations`
- 캔버스 `canvas_type` enum이 SDK 입력 검증에 걸려 free 폴백이 죽은 가지였다
  -> `test_unknown_canvas_type_falls_back_through_real_protocol_handler`
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from mcp import types

from athena_mcp.aggregator import ToolAggregator
from athena_mcp.client import MaxRestartsExceededError, describe_exception, read_log_text
from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.runner import GatewayRunner
from athena_mcp.server import RENDER_CANVAS_TOOL, AthenaGateway, build_mcp_server

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "fake_server.py"
_APPROVED_TOOLS = {"echo", "get_corp_code", "boom", "flaky"}


def _make_runner(tmp_path: Path, aliases: list[str]) -> GatewayRunner:
    runner = GatewayRunner(
        state_dir=tmp_path / "state", registry_path=tmp_path / "state" / "registry.json"
    )
    for alias in aliases:
        runner.registry.add(alias, command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
        runner.consent_store.request_consent(alias, sys.executable, [str(_FIXTURE_PATH)], {})
        runner.consent_store.approve(alias, approved_tools=_APPROVED_TOOLS)
    return runner


# -- anyio 취소 스코프 회귀 ---------------------------------------------------


async def test_connect_approved_attaches_every_server(tmp_path):
    runner = _make_runner(tmp_path, ["a", "b", "c"])
    try:
        outcomes = await runner.connect_approved()
        assert [o.alias for o in outcomes] == ["a", "b", "c"]
        assert all(o.ok for o in outcomes)
        assert all(o.tool_count > 0 for o in outcomes)
    finally:
        await runner.close()


async def test_disconnect_in_any_order_does_not_raise(tmp_path):
    """핸들마다 자기 태스크를 갖기 전에는, 먼저 연 서버를 먼저 끊는 순간
    `CancelledError: Cancelled via cancel scope ...`로 터졌다."""
    runner = _make_runner(tmp_path, ["a", "b", "c"])
    await runner.connect_approved()
    # 진입 순서와 같은 순서(= LIFO가 아닌 FIFO)로 끊는다 — 예전에 터지던 순서다
    for alias in ["a", "b", "c"]:
        await runner.gateway.disconnect(alias)
    assert runner.gateway.handles == {}


async def test_one_broken_server_does_not_block_the_others(tmp_path):
    runner = _make_runner(tmp_path, ["good1", "good2"])
    runner.registry.add("broken", command="athena-no-such-command-exists", args=[], env={})
    runner.consent_store.request_consent("broken", "athena-no-such-command-exists", [], {})
    runner.consent_store.approve("broken")
    try:
        outcomes = {o.alias: o for o in await runner.connect_approved()}
        assert outcomes["good1"].ok is True
        assert outcomes["good2"].ok is True
        assert outcomes["broken"].ok is False
        assert outcomes["broken"].error
        # 실패 원인을 어디서 볼지 알려줘야 한다
        assert outcomes["broken"].log_path is not None
    finally:
        await runner.close()


async def test_unapproved_server_is_skipped_not_spawned(tmp_path):
    runner = _make_runner(tmp_path, ["approved"])
    runner.registry.add("pending", command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    runner.consent_store.request_consent("pending", sys.executable, [str(_FIXTURE_PATH)], {})
    try:
        outcomes = await runner.connect_approved()
        assert [o.alias for o in outcomes] == ["approved"]
    finally:
        await runner.close()


# -- 예외 평탄화 --------------------------------------------------------------


def test_describe_exception_flattens_nested_exception_groups():
    leaf = RuntimeError("Connection closed")
    nested = BaseExceptionGroup(
        "unhandled errors in a TaskGroup",
        [BaseExceptionGroup("unhandled errors in a TaskGroup", [leaf])],
    )
    described = describe_exception(nested)
    assert described == "RuntimeError: Connection closed"
    assert "ExceptionGroup" not in described


def test_describe_exception_dedupes_identical_leaves():
    leaf_a = RuntimeError("boom")
    leaf_b = RuntimeError("boom")
    group = BaseExceptionGroup("g", [leaf_a, leaf_b])
    assert describe_exception(group) == "RuntimeError: boom"


# -- rename 결선 --------------------------------------------------------------


def _gateway(tmp_path: Path) -> AthenaGateway:
    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    registry.add("old", command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    consent.request_consent("old", sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve("old", approved_tools={"echo"})
    return AthenaGateway(
        registry=registry,
        consent_store=consent,
        aggregator=ToolAggregator(),
        # 기본값(`Path.home() / ".athena" / ...`)을 그대로 두면 아래
        # dispatch_call()이 실제 사용자 홈 디렉토리에 감사 로그를 남긴다 —
        # 테스트 격리를 위해 tmp_path로 못박는다.
        audit_log_dir=tmp_path / "audit",
        canvas_save_dir=tmp_path / "canvases",
    )


def test_rename_moves_approval_so_server_does_not_silently_become_unapproved(tmp_path):
    gw = _gateway(tmp_path)
    assert gw.consent_store.is_server_approved("old") is True

    gw.rename_alias("old", "new")

    assert gw.consent_store.is_server_approved("new") is True
    assert gw.consent_store.is_server_approved("old") is False
    assert gw.consent_store.is_tool_allowed("new", "echo") is True


def test_rename_moves_registry_entry(tmp_path):
    gw = _gateway(tmp_path)
    gw.rename_alias("old", "new")
    assert gw.registry.get("new").alias == "new"
    with pytest.raises(KeyError):
        gw.registry.get("old")


def test_rename_before_connect_does_not_raise_keyerror(tmp_path):
    """집계 목록이 아직 비어 있는(= connect 전) 별칭 rename은 정상 흐름이다.
    예전 `rename_alias()`는 여기서 `KeyError`로 터졌다."""
    gw = _gateway(tmp_path)
    gw.rename_alias("old", "new")  # raise하지 않으면 통과


async def test_rename_after_connect_keeps_old_qualified_name_resolvable(tmp_path):
    """resolve()와 handles만 따로 보면 이 결함을 놓친다 — 실제로
    `dispatch_call("old__echo", ...)`까지 성공해야 "in-flight 호출이 안
    깨진다"는 보장이 실제로 성립한다.

    예전 `aggregator.rename_alias()`는 옛 qualified_name(`old__echo`)의
    리졸루션을 지우지는 않았지만 `alias=old`로 **그대로 남겨뒀다**. 그런데
    `server.py`의 `AthenaGateway.rename_alias()`는 승인(`consent_store`)과
    핸들(`handles`)을 옛 별칭에서 걷어 새 별칭으로 옮기므로, rename 직후
    옛 별칭은 승인 기록도 핸들도 없다 — `resolve("old__echo")`까지는
    성공해도 그 뒤 `is_tool_allowed("old", ...)`와 `handles.get("old")`가
    둘 다 실패해 `gateway_blocked`로 떨어졌다. 이 테스트는 그 결선까지
    실제로 통과하는지를 본다."""
    gw = _gateway(tmp_path)
    await gw.connect("old", log_dir=tmp_path / "logs")
    try:
        assert gw.aggregator.resolve("old__echo").upstream_name == "echo"

        gw.rename_alias("old", "new")

        # 새 이름으로 노출되고
        exposed = {t.qualified_name for t in gw.aggregator.list_tools()}
        assert "new__echo" in exposed
        # 옛 이름으로 온 in-flight 호출도 여전히 풀리는데, 이제는 살아있는
        # 새 별칭을 가리켜야 한다 — 옛 별칭은 rename 후 승인/핸들이 없다.
        resolved = gw.aggregator.resolve("old__echo")
        assert resolved.upstream_name == "echo"
        assert resolved.alias == "new"
        # 핸들도 새 별칭으로 따라와야 실제 호출이 된다
        assert "new" in gw.handles

        # 진짜 결선 검증: 옛 qualified_name으로 실제 dispatch_call이 성공해야
        # 한다. 예전 버그에서는 여기서 gateway_blocked(승인 안 됨 또는 서버
        # 미연결)로 떨어졌다.
        result = await gw.dispatch_call("old__echo", {"message": "여전히 되나"})
        assert result.isError is False
        assert "Echo: 여전히 되나" in result.content[0].text
    finally:
        for alias in list(gw.handles):
            await gw.disconnect(alias)


# -- UpdateResult 유실 회귀 ---------------------------------------------------


async def test_connect_returns_update_result_with_violations(tmp_path):
    """별칭이 길면 `별칭__툴명`이 64자를 넘어 그 툴이 스킵된다. 예전에는
    `connect()`가 반환값을 버려서 그 사실이 아무 데도 안 남았다."""
    long_alias = "a" * 28
    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    registry.add(long_alias, command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    consent.request_consent(long_alias, sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve(long_alias, approved_tools=_APPROVED_TOOLS)
    gw = AthenaGateway(registry=registry, consent_store=consent, aggregator=ToolAggregator())

    log_dir = tmp_path / "logs"
    try:
        update = await gw.connect(long_alias, log_dir=log_dir)
        assert update.committed is True
        assert update.violations, "28자 별칭 + 긴 툴 이름이면 64자 위반이 나와야 한다"
        # 반환만이 아니라 서버 로그에도 남는다. strict utf-8이 아니라
        # read_log_text() — 이 로그엔 upstream 서브프로세스가 stderr에 직접 쓴,
        # 임의 인코딩일 수 있는 바이트가 섞여 있다(US-011).
        log_text = read_log_text(log_dir / f"{long_alias}.log")
        assert "툴 스킵" in log_text
    finally:
        for alias in list(gw.handles):
            await gw.disconnect(alias)


# -- 캔버스 free 폴백이 실제 프로토콜 경로에서 살아있는가 ----------------------


async def _call_through_real_handler(gw: AthenaGateway, name: str, arguments: dict):
    server = build_mcp_server(gw)
    handler = server.request_handlers[types.CallToolRequest]
    req = types.CallToolRequest(
        method="tools/call",
        params=types.CallToolRequestParams(name=name, arguments=arguments),
    )
    return await handler(req)


async def test_unknown_canvas_type_falls_back_through_real_protocol_handler(tmp_path):
    """`dispatch_call()`을 직접 부르는 테스트만 있어서 이게 안 잡혔다.
    `canvas_type`에 enum을 걸어두면 SDK 입력 검증이 게이트웨이 도달 전에
    거부해버려, 설계·테스트된 free 폴백이 실제로는 죽은 가지가 된다."""
    gw = AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
        canvas_save_dir=tmp_path / "canvases",
    )
    result = await _call_through_real_handler(
        gw, RENDER_CANVAS_TOOL, {"canvas_type": "streem", "data": {"anything": 1}}
    )
    payload = result.root.structuredContent
    assert result.root.isError is False
    assert payload["canvas_type"] == "free"
    assert payload["fell_back"] is True
    assert "streem" in payload["fallback_reason"]


async def test_known_canvas_type_still_validated_through_real_handler(tmp_path):
    gw = AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
        canvas_save_dir=tmp_path / "canvases",
    )
    ok = await _call_through_real_handler(
        gw, RENDER_CANVAS_TOOL, {"canvas_type": "table", "data": {"rows": [{"a": 1}]}}
    )
    assert ok.root.structuredContent["canvas_type"] == "table"
    assert ok.root.structuredContent["fell_back"] is False

    bad = await _call_through_real_handler(
        gw, RENDER_CANVAS_TOOL, {"canvas_type": "table", "data": {"no_rows": True}}
    )
    assert bad.root.structuredContent["canvas_type"] == "free"
    assert bad.root.structuredContent["fell_back"] is True


# -- 적대적 리뷰가 잡은 결함 6건 회귀 -----------------------------------------


async def test_start_does_not_hang_when_log_file_cannot_be_opened(tmp_path, monkeypatch):
    """`errlog` 열기가 try 밖에 있으면 `_ready`가 안 서고 start()가 영원히 멈췄다."""
    from athena_mcp.client import UpstreamServerHandle

    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    entry = registry.add("h", command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    consent.request_consent("h", sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve("h")
    handle = UpstreamServerHandle(entry, consent, tmp_path / "logs")

    real_open = Path.open

    def boom(self, *a, **kw):
        if self == handle.log_path:
            raise OSError("simulated: log file locked")
        return real_open(self, *a, **kw)

    monkeypatch.setattr(Path, "open", boom)
    with pytest.raises(OSError):
        await asyncio.wait_for(handle.start(), timeout=10.0)


async def test_non_string_env_is_rejected_at_registration_not_at_spawn(tmp_path):
    """`{"DEBUG": true}` 같은 값이 spawn까지 살아가면 게이트웨이 전체가 멈췄다."""
    from athena_mcp.registry import InvalidServerSpecError

    registry = ServerRegistry(path=tmp_path / "reg.json")
    with pytest.raises(InvalidServerSpecError) as exc:
        registry.add("bad", command="node", args=["x.js"], env={"DEBUG": True})
    assert "DEBUG" in str(exc.value)
    # 값 자체는 노출하지 않는다
    assert "True" not in str(exc.value)

    with pytest.raises(InvalidServerSpecError):
        registry.add("bad2", command="node", args=["x.js", 5])


async def test_probe_with_non_string_env_reports_instead_of_hanging(tmp_path):
    """등록 검증을 우회해 직접 만든 엔트리라도 probe가 멈추면 안 된다."""
    from athena_mcp.onboarding import probe_server
    from athena_mcp.registry import ServerEntry

    consent = ConsentStore(path=tmp_path / "consent.json")
    consent.request_consent("bad", "node", ["x.js"], {})
    consent.approve("bad")
    entry = ServerEntry(alias="bad", command="node", args=["x.js"], env={"DEBUG": True})

    report = await asyncio.wait_for(
        probe_server(entry, consent, tmp_path / "logs"), timeout=15.0
    )
    assert report.ok is False
    assert report.error


async def test_double_start_does_not_leak_the_previous_task(tmp_path):
    from athena_mcp.client import UpstreamServerHandle

    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    entry = registry.add("h", command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    consent.request_consent("h", sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve("h")
    handle = UpstreamServerHandle(entry, consent, tmp_path / "logs")

    await handle.start()
    first = handle._task
    await handle.start()
    try:
        assert first is not None and first.done(), "이전 태스크가 회수되지 않았다"
    finally:
        await handle.close()


async def test_crashed_session_fails_fast_instead_of_redispatching(tmp_path, monkeypatch):
    """크래시 후에도 `is_running`이 True로 남아 죽은 세션으로 계속 들어갔다."""
    from athena_mcp.client import ServerCrashedError, UpstreamServerHandle

    monkeypatch.setenv("CRASH_AFTER_N_CALLS", "1")
    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    entry = registry.add(
        "h",
        command=sys.executable,
        args=[str(_FIXTURE_PATH)],
        env={"CRASH_AFTER_N_CALLS": "1"},
    )
    consent.request_consent("h", sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve("h")
    handle = UpstreamServerHandle(entry, consent, tmp_path / "logs")
    await handle.start()
    try:
        with pytest.raises(ServerCrashedError):
            await handle.call_tool("flaky", {})
        assert handle.is_running is False, "크래시한 세션이 살아있다고 보고한다"
        assert handle.crash_count == 1

        # 두 번째 호출은 죽은 세션으로 다시 들어가지 않고 즉시 실패해야 한다
        with pytest.raises(ServerCrashedError):
            await handle.call_tool("echo", {"message": "x"})
        assert handle.crash_count == 1, "죽은 세션으로 재디스패치해 크래시를 또 셌다"
    finally:
        await handle.close()


async def test_probe_active_tool_requires_allowlist_or_explicit_force(tmp_path):
    """probe가 게이트웨이를 우회하므로 allowlist·감사로그를 여기서 직접 건다."""
    from athena_mcp.consent import AuditLog
    from athena_mcp.onboarding import probe_server

    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    entry = registry.add("h", command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    consent.request_consent("h", sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve("h")  # 서버만 승인, 툴 allowlist는 비어 있다
    audit_path = tmp_path / "audit.jsonl"

    blocked = await probe_server(
        entry,
        consent,
        tmp_path / "logs",
        probe_tool="echo",
        probe_arguments={"message": "hi"},
        audit_log=AuditLog(audit_path),
    )
    assert blocked.ok is True
    assert "allowlist" in (blocked.active_probe_error or "")
    assert blocked.active_probe_mojibake is None, "호출 자체가 일어나면 안 된다"
    assert not audit_path.exists() or audit_path.read_text(encoding="utf-8") == ""

    forced = await probe_server(
        entry,
        consent,
        tmp_path / "logs",
        probe_tool="echo",
        probe_arguments={"message": "hi"},
        audit_log=AuditLog(audit_path),
        force_unallowed_tool=True,
    )
    assert forced.active_probe_error is None
    entries = AuditLog(audit_path).read_all()
    assert any(e["tool"] == "probe:echo" and e["success"] is True for e in entries)


async def test_probe_allowlisted_tool_needs_no_force(tmp_path):
    from athena_mcp.consent import AuditLog
    from athena_mcp.onboarding import probe_server

    registry = ServerRegistry(path=tmp_path / "reg.json")
    consent = ConsentStore(path=tmp_path / "consent.json")
    entry = registry.add("h", command=sys.executable, args=[str(_FIXTURE_PATH)], env={})
    consent.request_consent("h", sys.executable, [str(_FIXTURE_PATH)], {})
    consent.approve("h", approved_tools={"echo"})

    report = await probe_server(
        entry,
        consent,
        tmp_path / "logs",
        probe_tool="echo",
        probe_arguments={"message": "hi"},
        audit_log=AuditLog(tmp_path / "audit.jsonl"),
    )
    assert report.active_probe_error is None
    assert report.active_probe_mojibake is False


async def test_connect_approved_runs_concurrently_not_sequentially(tmp_path):
    """순차 연결이면 서버 N개 × startup_timeout 까지 갈 수 있다."""
    import time

    runner = _make_runner(tmp_path, ["a", "b", "c", "d"])
    try:
        started = time.monotonic()
        outcomes = await runner.connect_approved()
        elapsed = time.monotonic() - started
        assert all(o.ok for o in outcomes)
        # 순차라면 4배가 든다. 넉넉한 상한으로 "동시성이 실제로 있다"만 고정한다.
        assert elapsed < 20.0, f"4개 연결에 {elapsed:.1f}초 — 동시 실행이 아닌 것 같다"
    finally:
        await runner.close()


# -- A2: 백그라운드 헬스체크 슈퍼바이저 ----------------------------------------
#
# README "백그라운드 헬스체크 스케줄러는 없다"가 남긴 다음 일감이다 — 지금까지는
# 크래시한 서버의 툴 호출이 영원히 isError로만 떨어졌다. 아래는 그게 고쳐졌다는
# 회귀 증거다. 첫 테스트는 목만 쓰지 않는다 — `flaky` 툴이 실제로 os._exit(1)로
# 죽는 진짜 subprocess를 슈퍼바이저가 진짜로 되살리는 것까지 확인한다.


async def test_healthcheck_supervisor_restarts_a_crashed_server_and_recovers_dispatch(tmp_path):
    """살아있는 세션이 아니라 진짜 하드 크래시(call_tool 중 예외 -> _mark_dead())를
    슈퍼바이저가 감지해 restart()로 되살리고, 그 뒤 실제 dispatch_call()이 다시
    성공하는 것까지 실제 subprocess로 확인한다. 재시작 성공 시 aggregator의 기존
    변경 알림 경로(_notify_changed())를 그대로 태우는지도 스파이로 확인한다."""
    runner = GatewayRunner(
        state_dir=tmp_path / "state",
        registry_path=tmp_path / "state" / "registry.json",
        healthcheck_interval_seconds=0.05,
    )
    runner.registry.add(
        "h", command=sys.executable, args=[str(_FIXTURE_PATH)], env={"CRASH_AFTER_N_CALLS": "1"}
    )
    runner.consent_store.request_consent(
        "h", sys.executable, [str(_FIXTURE_PATH)], {"CRASH_AFTER_N_CALLS": "1"}
    )
    runner.consent_store.approve("h", approved_tools={"echo", "flaky"})
    try:
        await runner.connect_approved()
        handle = runner.gateway.handles["h"]

        changed_events: list[bool] = []
        runner.gateway.aggregator.subscribe(lambda: changed_events.append(True))

        # flaky의 첫 호출이 프로세스를 os._exit(1)로 죽인다 -> call_tool()이
        # ServerCrashedError를 던지고 _mark_dead()가 세션을 지운다.
        crashed = await runner.gateway.dispatch_call("h__flaky", {})
        assert crashed.isError is True
        assert handle.is_running is False

        supervisor = asyncio.create_task(runner._supervise_healthchecks())
        try:
            for _ in range(150):
                # restart()는 새 세션을 세운 직후 is_running/restart_count를 먼저
                # 갱신하고, 이어 list_tools() -> aggregator 변경 알림을 보낸다.
                # 앞의 두 상태만 보고 supervisor를 취소하면 알림 직전 태스크를
                # 끊을 수 있으므로 복구의 마지막 관찰 지점까지 기다린다.
                if handle.is_running and handle.restart_count >= 1 and changed_events:
                    break
                await asyncio.sleep(0.1)
            assert handle.is_running is True, "슈퍼바이저가 크래시를 감지해 재시작하지 못했다"
            assert handle.restart_count == 1
        finally:
            supervisor.cancel()
            try:
                await supervisor
            except (asyncio.CancelledError, Exception):
                pass

        # 재시작 후 실제 dispatch_call이 다시 성공해야 한다 — isError로만 계속
        # 떨어지던 결함이 해소됐다는 기능적 증거.
        recovered = await runner.gateway.dispatch_call("h__echo", {"message": "again"})
        assert recovered.isError is False

        assert changed_events, (
            "재시작 성공 후 aggregator._notify_changed()(tools/list_changed 경로)가 안 불렸다"
        )
    finally:
        await runner.close()


async def test_healthcheck_supervisor_does_not_restart_on_timeout_only_hard_failure(tmp_path):
    """`healthcheck()`가 타임아웃으로 실패해도(세션은 유지) restart()를 걸면 안
    된다 — client.py의 healthcheck() docstring이 명시한 정책("세지만 죽이진
    않는다"). 하드 실패(`_mark_dead()`로 세션이 죽음)일 때만 재시작해야 한다."""
    runner = _make_runner(tmp_path, ["h"])
    try:
        await runner.connect_approved()
        handle = runner.gateway.handles["h"]

        async def fake_timeout_healthcheck() -> bool:
            # 타임아웃 경로를 흉내낸다 — crash_count만 올라가고 세션(_session)은
            # 그대로 둔다. 실제 healthcheck()의 TimeoutError 분기와 같은 부작용.
            handle.crash_count += 1
            return False

        handle.healthcheck = fake_timeout_healthcheck  # type: ignore[method-assign]

        await runner._healthcheck_round()

        assert handle.is_running is True, "타임아웃일 뿐인데 세션이 끊겼다"
        assert handle.restart_count == 0, "타임아웃만으로 restart()가 걸리면 안 된다"
    finally:
        await runner.close()


async def test_healthcheck_supervisor_evicts_a_permanently_dead_server_and_leaves_others_alone(
    tmp_path,
):
    """재시작 상한을 넘기면(`MaxRestartsExceededError`) 더 재시도하지 않고
    핸들·노출 툴을 걷어낸다 — 모델이 더 이상 부를 수 없는 툴을 계속 보면
    안 된다. 같은 라운드의 다른(정상) 서버는 이 실패에 영향받지 않는다
    (connect_approved()와 같은 서버 단위 격리 원칙)."""
    runner = _make_runner(tmp_path, ["dead", "good"])
    try:
        await runner.connect_approved()
        dead_handle = runner.gateway.handles["dead"]

        # 하드 실패 상태를 직접 만든다 — 세션이 없으면 실제 healthcheck()도
        # 첫 줄에서 그대로 False를 반환하므로 healthcheck()까지 목으로 대신할
        # 필요는 없다.
        dead_handle._session = None  # noqa: SLF001 — 하드 실패 상태를 재현

        async def fake_restart_always_exceeds():
            raise MaxRestartsExceededError("dead: 재시작 상한 초과(테스트)")

        dead_handle.restart = fake_restart_always_exceeds  # type: ignore[method-assign]

        exposed_before = {t.alias for t in runner.gateway.aggregator.list_tools()}
        assert {"dead", "good"} <= exposed_before

        await runner._healthcheck_round()

        assert "dead" not in runner.gateway.handles, "영구 실패 서버가 handles에서 안 걷혔다"
        assert "good" in runner.gateway.handles, "정상 서버가 같이 걷혔다 — 격리가 깨졌다"
        exposed_after = {t.alias for t in runner.gateway.aggregator.list_tools()}
        assert "dead" not in exposed_after, "영구 실패 서버 툴이 여전히 노출된다"
        assert "good" in exposed_after
    finally:
        await runner.close()
