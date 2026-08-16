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
from athena_mcp.client import describe_exception
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
    ) -> None:
        self.state_dir = state_dir or default_state_dir()
        # 첫 `tools/list`가 초기 연결을 기다려주는 상한. 0이면 안 기다린다.
        # 이유는 `build_server()`의 목록 게이트 주석 참고.
        self.initial_list_wait_seconds = initial_list_wait_seconds
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
        try:
            async with stdio_server() as (read, write):
                connect_task = asyncio.create_task(self._connect_and_report())
                await server.run(read, write, self.initialization_options(server))
        finally:
            if connect_task is not None and not connect_task.done():
                connect_task.cancel()
                try:
                    await connect_task
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
