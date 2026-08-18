"""게이트웨이를 **실제 프로세스로** 띄운다 — 여기가 W1에서 비어 있던 자리다.

W1은 `build_mcp_server()`로 `Server` 객체를 만드는 데까지만 갔고 `stdio_server()`
도 `Server.run()`도 아무도 부르지 않았다. 그래서 `claude -p`가 이 게이트웨이를
볼 방법 자체가 없었다. 이 모듈이 그 마지막 한 칸이다.

```
.mcp.json  ->  athena-mcp serve  ->  GatewayRunner  ->  등록·승인된 서버 N개
```

## 한 서버가 죽어도 게이트웨이는 뜬다

범용성의 핵심이다. 등록된 서버가 여럿일 때 그중 하나가 (패키지가 사라졌거나,
키가 만료됐거나, 애초에 MCP 서버가 아니거나) 뜨지 않는 건 **정상적으로 흔한
일**이다. 하나가 실패했다고 게이트웨이 전체가 안 뜨면 나머지 정상 서버까지
같이 죽는다. `connect_approved()`는 서버별로 실패를 격리해 `ConnectOutcome`으로
모아 돌려주고, 실패를 **조용히 삼키지 않고** stderr에 남긴다.

## stdout은 JSON-RPC 전용이다

stdio MCP 서버에서 stdout에 아무 문자열이나 쓰면 프로토콜이 깨진다. 이 모듈의
모든 사람용 출력은 **stderr로만** 나간다. `athena-mcp serve`가 아닌 다른
서브커맨드(register/list/probe...)는 별개 프로세스라 stdout을 자유롭게 쓴다.

## `tools/list_changed` 전송

`aggregator.subscribe()` 훅은 W1에서 만들어놓고 아무 데도 안 물려 있었다.
여기서 실제 세션에 연결한다. 다만 `Server.run()`이 `ServerSession`을 내부에서
만들기 때문에 밖에서 미리 잡을 수가 없다 — 그래서 **첫 요청이 들어올 때
세션을 붙잡는다.** 이건 제약이 아니다: `list_changed`는 "네가 전에 받아간
목록이 낡았다"는 뜻이라 클라이언트가 목록을 한 번이라도 요청한 뒤에만 의미가
있고, 그 요청 자체가 세션을 잡아주기 때문이다.

## 백그라운드 헬스체크 슈퍼바이저 (A2)

W1까지는 `client.py`의 `healthcheck()`/`restart()`가 호출 가능한 메서드로만
있었고 주기적으로 부르는 루프가 없었다 — 그래서 서빙 중 upstream이 죽으면
그 서버의 툴 호출이 영원히 `isError`로만 떨어졌다(README "미구현" 절 참고).
`GatewayRunner._supervise_healthchecks()`가 `connect_task`와 같은 자리·같은
패턴으로(`asyncio.create_task` + `finally`에서 취소/조인) 도는 형제 태스크로
그 자리를 채운다.

**정책 — `client.py`의 healthcheck() 의도를 그대로 따른다.** `healthcheck()`는
타임아웃(느릴 뿐, 세션 유지, `crash_count`만 증가)과 하드 실패(`_mark_dead()`로
세션이 죽음)를 이미 구분해서 처리한다(client.py L344-354). 여기서 그 구분을
다시 하지 않고 **`handle.is_running`으로 읽기만 한다** — `healthcheck()`가
`False`를 반환해도 `is_running`이 아직 `True`면 세션은 살아있는 것이니
restart()를 걸지 않는다. `is_running`이 `False`일 때만(세션이 이미 죽었을
때만) `restart()`를 시도한다. `restart()` 자체의 상한(`max_restarts`)·지수
백오프는 손대지 않고 그대로 위임한다 — 슈퍼바이저는 매 라운드 살아있지 않은
핸들에 `restart()`를 한 번 더 걸 뿐이고, "몇 번째 시도인지"는 여전히
`restart_count` 하나가 유일하게 센다(2차 재시도 레이어를 얹지 않는다).
`MaxRestartsExceededError`가 나면 더 이상 걸지 않고 `gateway.disconnect()`로
핸들과 노출 툴을 걷어낸다 — `self.gateway.handles`에서 빠지므로 다음 라운드는
자동으로 그 별칭을 건너뛰고(더 이상 두드리지 않는다), 모델도 더 이상 죽어서
못 부르는 툴을 목록에서 보지 않는다.

**재시작 성공 후 툴 목록 갱신은 새로 만들지 않고 기존 경로를 그대로 탄다.**
`handle.list_tools()`로 새 목록을 받아 `aggregator.update_alias_tools()`에
넘기기만 하면, 그 안의 `_notify_changed()`가 `build_server()`에서 구독해둔
`_on_tools_changed()`를 그대로 호출해 `tools/list_changed`가 나간다 — 알림
전송 코드를 여기 두 번 안 짠다. 영구 실패 쪽도 `gateway.disconnect()`가 내부에서
`aggregator.forget_alias()`를 불러 같은 경로로 알림이 나간다. 둘 다
`_on_tools_changed()`에 이미 있는 `_shutting_down` 가드를 그대로 통과한다.

**격리.** `connect_approved()`가 서버별로 예외를 가두는 것과 같은 원칙을
`_healthcheck_one()`에도 그대로 쓴다 — 한 서버의 healthcheck/restart/list_tools
중 무엇이 터져도 그 서버만 이번 라운드를 포기하고, 다른 서버·슈퍼바이저 루프
자체는 안 죽는다.

**세션 동시 접근.** `UpstreamServerHandle`은 `list_tools()`/`call_tool()`
호출을 직렬화하는 락이 없다 — 필요가 없다. `mcp.shared.session.BaseSession`이
요청마다 `request_id`를 매겨 응답을 그 id의 개인 스트림으로만 배달한다
(`mcp/shared/session.py` `send_request()`/`_response_streams`). 그래서
헬스체크의 `list_tools()` ping이 같은 세션에서 진행 중인 `call_tool()`과
동시에 나가도 서로의 응답을 가로채지 않는다 — 디스패치가 깨질 위험은 프로토콜
레벨에서 이미 없다. 별도로 막아야 하는 건 그게 아니라 **`restart()`가 세션을
통째로 갈아치우는 동안** 같은 순간 그 세션으로 들어간 `call_tool()`이 취소되는
경우인데, 이건 슈퍼바이저가 새로 만든 위험이 아니라 `restart()`/`close()`를
누가 부르든 이미 있던 성질이다(수동 `restart()` 호출도 동일). 슈퍼바이저는
`is_running`이 이미 `False`인 핸들에만 `restart()`를 걸어 그 창을 넓히지 않는다.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path

import mcp.types as types
from mcp.server.lowlevel import NotificationOptions, Server
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server

from athena_mcp.aggregator import ToolAggregator
from athena_mcp.client import MaxRestartsExceededError, UpstreamServerHandle, describe_exception
from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry, default_registry_path
from athena_mcp.server import AthenaGateway, build_mcp_server

SERVER_NAME = "athena"
SERVER_VERSION = "0.1.0"


def default_state_dir() -> Path:
    """레지스트리와 같은 뿌리(`~/.athena/`)를 쓴다 — `registry.py` 독스트링의
    "이 컴퓨터 사용자의 상태" 논리가 승인기록·로그·캔버스에도 그대로 적용된다."""
    return default_registry_path().parent


@dataclass
class ConnectOutcome:
    alias: str
    ok: bool
    tool_count: int = 0
    skipped_tools: list[str] | None = None
    error: str | None = None
    # 실패한 서버의 진짜 원인은 대개 upstream이 stderr에 쓴 스택트레이스다
    # (실측: `uvx pykrx-mcp`의 `ModuleNotFoundError: No module named
    # 'mcp.server.fastmcp'`). 프로토콜 레벨 예외는 "Connection closed"까지밖에
    # 못 말해주므로, 어디를 봐야 하는지 같이 알려준다.
    log_path: Path | None = None


class GatewayRunner:
    """레지스트리에서 읽어 승인된 서버를 붙이고, 게이트웨이를 stdio로 서빙한다."""

    def __init__(
        self,
        *,
        state_dir: Path | None = None,
        registry_path: Path | None = None,
        initial_list_wait_seconds: float = 30.0,
        healthcheck_interval_seconds: float = 30.0,
    ) -> None:
        self.state_dir = state_dir or default_state_dir()
        # 첫 `tools/list`가 초기 연결을 기다려주는 상한. 0이면 안 기다린다.
        # 이유는 `build_server()`의 목록 게이트 주석 참고.
        self.initial_list_wait_seconds = initial_list_wait_seconds
        # 백그라운드 헬스체크 주기. 핸들 기본 `healthcheck_timeout_seconds`(5초)
        # 보다 넉넉히 커야 한 라운드가 끝나기 전에 다음 라운드가 겹치지 않는다
        # (겹쳐도 `_supervise_healthchecks()`가 라운드를 순차로 await하므로 실제
        # 겹침은 없지만, 너무 촘촘하면 응답 느린 서버 하나가 계속 다음 라운드를
        # 미루는 꼴이 된다). `initial_list_wait_seconds`와 같은 30초를 기본값으로
        # 맞췄다 — 이 정도면 죽은 서버를 방치하는 시간과 정상 서버를 불필요하게
        # 자주 두드리는 비용 사이에서 무난하다. 0 이하면 슈퍼바이저를 끈다(테스트나
        # 헬스체크가 필요 없는 배치 실행용).
        self.healthcheck_interval_seconds = healthcheck_interval_seconds
        self.registry = ServerRegistry(registry_path or default_registry_path())
        self.consent_store = ConsentStore(self.state_dir / "consent.json")
        self.gateway = AthenaGateway(
            registry=self.registry,
            consent_store=self.consent_store,
            aggregator=ToolAggregator(),
            audit_log_dir=self.state_dir / "audit",
            canvas_save_dir=self.state_dir / "canvases",
        )
        self.log_dir = self.state_dir / "logs"
        self._session = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._shutting_down = False
        self._initial_connect_done = asyncio.Event()

    # -- 연결 ---------------------------------------------------------------

    async def _connect_one(self, alias: str) -> ConnectOutcome:
        try:
            update = await self.gateway.connect(alias, log_dir=self.log_dir)
            return ConnectOutcome(
                alias=alias,
                ok=update.committed,
                tool_count=update.tool_count,
                skipped_tools=[v.upstream_name for v in update.violations] or None,
                error=update.error,
            )
        except Exception as exc:
            # 이 서버 하나만 포기한다. 나머지는 계속 붙인다.
            try:
                await self.gateway.disconnect(alias)
            except Exception:
                pass
            return ConnectOutcome(
                alias=alias,
                ok=False,
                error=describe_exception(exc),
                log_path=self.log_dir / f"{alias}.log",
            )

    async def connect_approved(self) -> list[ConnectOutcome]:
        """승인된 서버를 전부 붙인다. 실패는 서버 단위로 격리한다.

        **동시에** 붙인다. 순차로 돌면 최악의 경우 서버 수 × `startup_timeout`
        (기본 60초)만큼 걸린다 — `npx`/`uvx`가 패키지를 처음 내려받는 건
        비정상이 아니라 정상이라, 서버 5개면 5분까지 갈 수 있다. 핸들마다
        자기 태스크로 수명주기를 돌리게 바꾼 덕에 동시 spawn이 안전해졌다.
        """
        aliases = [
            e.alias for e in self.registry.list() if self.consent_store.is_server_approved(e.alias)
        ]
        if not aliases:
            return []
        return list(await asyncio.gather(*(self._connect_one(a) for a in aliases)))

    async def close(self) -> None:
        # 종료 중 `disconnect()`는 `forget_alias()`를 부르고, 그게 다시
        # 변경 알림을 깨운다. 그런데 이 시점의 세션 스트림은 이미 닫혀 있어
        # `ClosedResourceError`만 찍힌다(실측). 받을 클라이언트가 없는 알림이라
        # 안 보내는 게 맞다.
        self._shutting_down = True
        for alias in list(self.gateway.handles):
            try:
                await self.gateway.disconnect(alias)
            except Exception:
                pass
        # 키움 셀렉터 4툴이 쓰는 백엔드 루프백 클라이언트도 같이 정리한다 —
        # upstream 핸들과 달리 `disconnect()` 순회에 안 걸리는 별도 자원이다.
        try:
            await self.gateway.selector_http_client.aclose()
        except Exception:
            pass

    # -- 백그라운드 헬스체크 슈퍼바이저 (모듈 docstring 참고) ---------------------

    async def _healthcheck_one(self, alias: str, handle: UpstreamServerHandle) -> None:
        """핸들 하나를 healthcheck하고, 필요하면 restart까지 시도한다.

        `connect_approved()`/`_connect_one()`과 같은 격리 원칙 — 이 함수 안에서
        무엇이 터지든 여기서 끝난다. 다른 별칭의 라운드나 슈퍼바이저 루프 자체를
        절대 막지 않는다.
        """
        try:
            await handle.healthcheck()
            if handle.is_running:
                # `healthcheck()`가 True든(정상) 타임아웃으로 False든, 세션이
                # 아직 살아있으면(`_mark_dead()`가 안 불렸으면) restart 대상이
                # 아니다 — client.py의 명시된 의도: "세지만(crash_count) 죽이진
                # 않는다." 여기서 restart()를 걸면 멀쩡한 세션을 억지로 끊는다.
                return
            if self._shutting_down:
                return

            try:
                await handle.restart()
            except MaxRestartsExceededError as exc:
                # 더 이상 두드리지 않는다 — handles에서 걷어내면 다음 라운드는
                # 이 별칭을 자동으로 건너뛴다. `disconnect()`가 aggregator에서도
                # 노출 툴을 지우고 그 김에 기존 tools/list_changed 경로를 태운다
                # (forget_alias() -> _notify_changed(), 모듈 docstring 참고).
                handle.log_event(f"healthcheck 슈퍼바이저: 재시작 상한 초과, 영구 실패 — {exc}")
                await self.gateway.disconnect(alias)
                print(
                    f"[athena-mcp] {alias}: 재시작 상한 초과 — 더 이상 재시도하지 않고 "
                    f"핸들·툴 목록에서 걷어낸다 (원인: {handle.log_path})",
                    file=sys.stderr,
                )
                return

            # restart 성공 — 새 세션의 툴 목록을 받아 집계기에 반영한다. 여기서
            # 알림을 새로 만들지 않는다: update_alias_tools()가 부르는
            # _notify_changed()가 이미 구독된 _on_tools_changed()를 그대로 태운다.
            tools = await handle.list_tools()
            self.gateway.aggregator.update_alias_tools(alias, tools)
            handle.log_event("healthcheck 슈퍼바이저: 재시작 성공, 툴 목록 갱신")
        except Exception as exc:
            handle.log_event(f"healthcheck 슈퍼바이저 라운드 중 처리되지 않은 예외: {exc!r}")

    async def _healthcheck_round(self) -> None:
        if self._shutting_down:
            return
        # 스냅샷 후 순회 — 라운드 도중 `_healthcheck_one()`이 영구 실패 서버를
        # `self.gateway.handles`에서 지울 수 있으므로, 그 딕셔너리를 직접
        # 순회하면 안 된다.
        handles = list(self.gateway.handles.items())
        if not handles:
            return
        await asyncio.gather(*(self._healthcheck_one(alias, h) for alias, h in handles))

    async def _supervise_healthchecks(self) -> None:
        """`healthcheck_interval_seconds`마다 라운드를 돈다. 0 이하면 즉시 끝낸다
        (슈퍼바이저 끔). 라운드는 순차로 await하므로(겹치지 않는다) 같은 핸들에
        두 라운드가 동시에 restart()를 거는 경우는 없다."""
        if self.healthcheck_interval_seconds <= 0:
            return
        while True:
            await asyncio.sleep(self.healthcheck_interval_seconds)
            if self._shutting_down:
                return
            await self._healthcheck_round()

    # -- list_changed 전송 ---------------------------------------------------

    def _bind_session_from_request(self, server: Server) -> None:
        """요청 처리 중에만 접근 가능한 세션을 붙잡아둔다(모듈 docstring 참고)."""
        if self._session is not None:
            return
        try:
            self._session = server.request_context.session
        except LookupError:
            return
        self._loop = asyncio.get_running_loop()

    def _on_tools_changed(self) -> None:
        """aggregator가 노출 목록을 바꿨을 때 호출된다(동기 콜백).

        실제 전송은 async라 여기서 직접 못 한다 — 잡아둔 루프에 태워 보낸다.
        세션이 아직 없으면(첫 요청 전) 보낼 곳도 받을 쪽의 낡은 목록도 없으므로
        아무것도 하지 않는 게 맞다.
        """
        session = self._session
        loop = self._loop
        if self._shutting_down or session is None or loop is None or loop.is_closed():
            return

        async def _send() -> None:
            try:
                await session.send_tool_list_changed()
            except Exception as exc:  # 알림 실패가 서빙을 죽이면 안 된다
                print(f"[athena-mcp] tools/list_changed 전송 실패: {exc!r}", file=sys.stderr)

        loop.create_task(_send())

    # -- 서빙 ---------------------------------------------------------------

    async def _await_initial_connect(self) -> None:
        """첫 `tools/list`는 초기 연결이 끝날 때까지(상한 내에서) 기다린다.

        서빙을 먼저 여는 것과 목록이 완전한 것은 둘 다 필요하다. 연결을 다
        끝낸 뒤에 stdio를 열면 그동안 stdin을 안 읽어서 클라이언트가 먼저
        포기할 수 있고(그래서 서빙을 먼저 연다), 반대로 그냥 열어두기만 하면
        **초기 `tools/list`가 캔버스 툴 2개만 돌려준다** — 실측으로 확인했다.
        MCP 클라이언트는 initialize 직후 목록을 한 번 받아가므로 그 한 번이
        비면 모델은 한동안 upstream 툴이 없다고 믿는다.

        그래서 목록 요청만 초기 연결을 기다린다. 상한을 넘기면 지금까지 붙은
        것만 돌려주고, 나머지는 `tools/list_changed`가 따라잡는다 — 영원히
        막지 않으면서 흔한 경우(연결이 곧 끝난다)에는 완전한 목록을 준다.
        """
        if self.initial_list_wait_seconds <= 0 or self._initial_connect_done.is_set():
            return
        try:
            await asyncio.wait_for(
                self._initial_connect_done.wait(), timeout=self.initial_list_wait_seconds
            )
        except TimeoutError:
            print(
                f"[athena-mcp] 초기 연결이 {self.initial_list_wait_seconds}초 안에 "
                "안 끝나 지금까지 붙은 툴만 목록에 넣는다. "
                "나머지는 tools/list_changed로 따라온다.",
                file=sys.stderr,
            )

    def build_server(self) -> Server:
        server = build_mcp_server(self.gateway)
        self.gateway.aggregator.subscribe(self._on_tools_changed)

        # 원래 핸들러를 감싸 세션을 붙잡는다. `Server.run()`이 세션을 내부에서
        # 만들기 때문에 밖에서 미리 받을 방법이 없다.
        for request_type, handler in list(server.request_handlers.items()):
            gate_on_initial_connect = request_type is types.ListToolsRequest

            def _wrap(inner=handler, gated=gate_on_initial_connect):
                # 기본값 인자로 루프 변수 캡처를 고정한다
                async def wrapped(req):
                    self._bind_session_from_request(server)
                    if gated:
                        await self._await_initial_connect()
                    return await inner(req)

                return wrapped

            server.request_handlers[request_type] = _wrap()
        return server

    def initialization_options(self, server: Server) -> InitializationOptions:
        return server.create_initialization_options(
            notification_options=NotificationOptions(tools_changed=True)
        )

    async def _connect_and_report(self) -> None:
        try:
            _report_outcomes(await self.connect_approved())
        finally:
            # 실패했든 취소됐든 반드시 세운다 — 안 세우면 `tools/list`가
            # 상한까지 통째로 막힌다.
            self._initial_connect_done.set()

    async def serve_stdio(self) -> None:
        """stdio를 **먼저** 열고, upstream 연결은 백그라운드로 돌린다.

        예전에는 연결을 전부 끝낸 다음에야 `stdio_server()`에 들어갔다. 그러면
        `npx`가 패키지를 처음 내려받는 동안 우리는 stdin을 읽지도 않고 앉아
        있어서, 붙어 있는 CLI 입장에서는 `initialize`에 응답조차 안 하는
        서버로 보인다 — 클라이언트가 먼저 포기할 수 있다.

        먼저 서빙하면 `initialize`/`tools/list`가 즉시 응답된다. 그 시점에
        upstream이 아직 안 붙었으면 캔버스 툴만 보이고, 붙는 대로
        `tools/list_changed`가 나간다 — 이 알림을 배선해둔 이유가 정확히 이거다.
        """
        server = self.build_server()
        connect_task: asyncio.Task[None] | None = None
        healthcheck_task: asyncio.Task[None] | None = None
        try:
            async with stdio_server() as (read, write):
                connect_task = asyncio.create_task(self._connect_and_report())
                # connect_task와 같은 자리·같은 취소/조인 패턴을 쓰는 형제
                # 태스크다(모듈 docstring "백그라운드 헬스체크 슈퍼바이저" 참고).
                healthcheck_task = asyncio.create_task(self._supervise_healthchecks())
                await server.run(read, write, self.initialization_options(server))
        finally:
            for task in (connect_task, healthcheck_task):
                if task is not None and not task.done():
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
            await self.close()


def _report_outcomes(outcomes: list[ConnectOutcome]) -> None:
    """stderr로만 쓴다 — stdout은 JSON-RPC 전용이다."""
    if not outcomes:
        print(
            "[athena-mcp] 승인된 upstream 서버가 없다. "
            "`athena-mcp register` / `athena-mcp approve`로 등록·승인하라. "
            "캔버스 툴(athena__render_canvas/save_canvas)만 노출된다.",
            file=sys.stderr,
        )
        return
    for o in outcomes:
        if o.ok:
            msg = f"[athena-mcp] 연결됨 {o.alias}: 툴 {o.tool_count}개"
            if o.skipped_tools:
                msg += f" (64자 초과로 스킵: {', '.join(o.skipped_tools)})"
        else:
            msg = f"[athena-mcp] 연결 실패 {o.alias}: {o.error} — 이 서버만 건너뛴다"
            if o.log_path:
                msg += f"\n[athena-mcp]   upstream stderr: {o.log_path}"
        print(msg, file=sys.stderr)
