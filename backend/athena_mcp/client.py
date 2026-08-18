"""upstream MCP 클라이언트 — `mcp==1.28.x` stdio.

spawn -> initialize -> list_tools -> call_tool 왕복 + 헬스체크 / 크래시 감지 /
재시작 / 서버별 로그 파일.

## 서버마다 다른 것들 (W0 S2/§9 실측)

- `protocolVersion`이 서버마다 다르다(`2025-11-25` vs `2025-06-18` 실측 혼재).
  이 모듈은 단일 버전을 가정하지 않고 서버별로 그대로 기록한다.
- `serverInfo.version`을 믿지 않는다 — `registry.SelfReportedServerInfo`로만
  다룬다(신뢰가 아니라 "자가보고" 필드명 자체가 경고).

## spawn 전 승인 필수

W1-5(consent.py) 요구사항: `claude -p` 헤드리스가 `.mcp.json` 서버를 트러스트
확인 없이 로드하는 구멍이 실측 확인됐다(§8). `start()`는 spawn 직전에
`ConsentStore.require_server_approved()`를 호출한다 — 승인 안 된 서버는 절대
프로세스가 뜨지 않는다.
"""

from __future__ import annotations

import asyncio
import codecs
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.session import ProgressFnT
from mcp.types import CallToolResult, InitializeResult, ListToolsResult, Tool

from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerEntry, resolve_secret_env

# 실측 최대 upstream 응답: `jjlabsio` `get_disclosure`(사업보고서) 1,042,014자
# (spike/mcp-client/CAPTURE-S2B-jjlabsio.md, quirks.py가 인용하는 636,059자
# 사업보고서와는 별개의 대용량 캡처 — 둘 다 실측이고 자릿수 단위가 같다).
# 상한 초과로 정상 DART 응답을 거부하면 안 되므로 관측 최댓값의 약 5배를
# 여유로 뒀다 — 정확한 "안전한" 위치를 정할 근거는 없다(SECURITY.md #4가
# 이미 그렇게 명시한다). 자원 고갈 방어와 실측 최대치 여유 확보 사이의
# 임의 절충이며, 필요하면 생성자 인자로 서버별로 덮어쓴다.
DEFAULT_MAX_RESPONSE_CHARS = 5_000_000


class ServerCrashedError(RuntimeError):
    """upstream 서버 세션이 죽었다(healthcheck 실패 또는 호출 중 예외)."""


class ResponseTooLargeError(RuntimeError):
    """`call_tool()`/`list_tools()` 응답이 설정된 상한을 넘었다 — 자르지 않고 거부한다.

    "조용히 자르지 않는다"는 이 패키지의 공통 규칙(SECURITY.md #4가 미해결로
    남겨둔 항목)을 이 클래스가 채운다. `quirks.py` docstring이 이미 실측한
    636,059자 사업보고서와 `spike/mcp-client/CAPTURE-S2B-jjlabsio.md`의
    1,042,014자 캡처 둘 다 **정상적인 DART 대용량 공시**다 — 상한은 그 값들을
    자르지 않도록 `DEFAULT_MAX_RESPONSE_CHARS`에 여유를 두고 잡았다.

    **알려진 한계**: 이건 SDK가 `await`를 반환한 *뒤에* 파싱된 결과 크기를 재는
    post-parse 상한이다. `mcp.client.stdio.stdio_client`의 `stdout_reader()`
    (`mcp/client/stdio/__init__.py:139-162`)는 개행이 올 때까지
    `buffer = buffer + chunk`로 무한정 이어붙이며 길이 상한이 전혀 없다 —
    anyio의 `max_bytes=65536`은 syscall 1회당 청크 크기일 뿐 총합 상한이
    아니다. 즉 이 클래스는 **이미 SDK 내부에서 벌어진 메모리 스파이크를 막지
    못한다** — 응답이 이 클래스에 닿기 전에 이미 전부 메모리에 올라와 있다.
    진짜 전송 계층 방어는 `stdio_client`의 `stdout_reader`를 로컬 포크해 청크
    누적 중에 길이를 재는 것뿐이고, 이 웨이브에서는 하지 않았다 — 해결된 척
    하지 않는다.
    """

    def __init__(
        self, *, alias: str, tool_name: str | None, observed_size: int, limit: int
    ) -> None:
        self.alias = alias
        self.tool_name = tool_name
        self.observed_size = observed_size
        self.limit = limit
        label = f"call_tool({tool_name!r})" if tool_name is not None else "list_tools()"
        super().__init__(
            f"{alias!r}: {label} 응답이 상한을 넘었다 "
            f"(관측 {observed_size:,}자 > 상한 {limit:,}자) — 자르지 않고 명시 에러로 거부한다"
        )


class MaxRestartsExceededError(RuntimeError):
    """재시작 상한을 넘었다 — 더 이상 자동 재시작하지 않는다."""


class ServerStartupTimeoutError(TimeoutError):
    """`initialize()`가 상한 안에 응답하지 않았다.

    첫 이식에서 가장 흔한 실패다 — 등록된 명령이 실제로는 MCP stdio 서버가
    아니거나(예: 평범한 CLI라 stdout에 JSON-RPC를 안 쓴다), npx/uvx가 패키지를
    처음 내려받느라 상한을 넘긴 경우. 둘을 서버가 구분해줄 방법은 없으므로
    메시지에 실행 명령 전문을 실어 사용자가 판단하게 한다."""


class ListToolsTimeoutError(TimeoutError):
    """`list_tools()`가 상한 안에 응답하지 않았다."""


def describe_exception(exc: BaseException) -> str:
    """중첩 `ExceptionGroup`을 사람이 읽는 한 줄로 편다.

    anyio task group을 두 겹 통과한 upstream 실패는 그대로 찍으면
    `ExceptionGroup('unhandled errors in a TaskGroup', [ExceptionGroup(...,
    [McpError('Connection closed')])])`가 되어 **정작 원인인 잎 예외가 껍질에
    묻힌다.** 실패 원인을 사용자에게 보여주는 게 이 게이트웨이의 일이므로
    잎만 뽑아서 보여준다.
    """
    leaves: list[str] = []

    def _walk(e: BaseException) -> None:
        if isinstance(e, BaseExceptionGroup):
            for sub in e.exceptions:
                _walk(sub)
        else:
            leaves.append(f"{type(e).__name__}: {e}" if str(e) else type(e).__name__)

    _walk(exc)
    if not leaves:
        return repr(exc)
    # 같은 잎이 여러 번 나오는 경우(태스크마다 같은 파이프 끊김)는 한 번만 보인다.
    seen: list[str] = []
    for leaf in leaves:
        if leaf not in seen:
            seen.append(leaf)
    return " / ".join(seen)


def read_log_text(path: Path) -> str:
    """서버별 로그 파일(`UpstreamServerHandle.log_path`)을 관대하게 디코드해서 읽는다.

    이 로그 파일은 두 출처가 섞여 있다: ①`_log_event()`가 쓰는, 항상 유효한
    UTF-8 텍스트(파이썬이 직접 인코딩한다). ②`stdio_client(errlog=...)`에 그대로
    넘겨지는 파일 핸들에 **upstream 서브프로세스가 자기 stderr를 직접 쓰는 바이트**
    (`mcp.client.stdio.stdio_client`/`mcp.os.win32.utilities.create_windows_process`가
    이 핸들의 OS 파일 디스크립터를 자식에게 그대로 넘긴다 — 파이썬 인코딩 계층을
    거치지 않으므로 자식이 어떤 인코딩으로 쓰든 이 프로세스가 통제할 수 없다).

    한글이 포함된 경로에서 실측 확인됐다(US-011): 자식 프로세스(Windows, 한국어
    로케일)가 기본 콘솔 코드페이지(cp949)로 stderr를 쓰면 그 바이트가 이 로그
    파일에 그대로 섞여 들어간다. `read_text(encoding="utf-8")`(strict)로 읽으면
    이 지점에서 `UnicodeDecodeError`로 죽는다 — 로그는 진단용 산출물일 뿐이므로
    크래시보다는 읽을 수 없는 바이트만 U+FFFD로 치환해 보여주는 쪽이 낫다
    (정보 정직성: 조용히 자르지 않고, 깨진 부분이 있다는 사실 자체는 남긴다).
    """
    return path.read_bytes().decode("utf-8", errors="replace")


@dataclass(frozen=True)
class ServerInfoSnapshot:
    """upstream이 스스로 보고한 정보. 신뢰하지 말고 그대로 기록만 한다."""

    reported_name: str | None
    reported_version: str | None
    protocol_version: str | None


class UpstreamServerHandle:
    """등록된 서버 하나의 수명주기(spawn/헬스체크/재시작/로그)를 관리한다."""

    def __init__(
        self,
        entry: ServerEntry,
        consent_store: ConsentStore,
        log_dir: Path,
        *,
        call_timeout_seconds: float = 30.0,
        healthcheck_timeout_seconds: float = 5.0,
        startup_timeout_seconds: float = 60.0,
        list_tools_timeout_seconds: float = 30.0,
        max_restarts: int = 3,
        restart_backoff_seconds: float = 1.0,
        max_response_chars: int = DEFAULT_MAX_RESPONSE_CHARS,
    ) -> None:
        self.entry = entry
        self.consent_store = consent_store
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.call_timeout_seconds = call_timeout_seconds
        self.healthcheck_timeout_seconds = healthcheck_timeout_seconds
        # `initialize()`와 `list_tools()`에도 상한이 필요하다 — 첫 이식에서
        # 실제로 물리는 경로다. `npx`가 패키지를 처음 내려받는 동안 응답이
        # 늦거나(정상), 서버가 stdout에 아무것도 안 쓰고 멈추면(비정상) 둘 다
        # 여기서 걸린다. 상한이 없으면 게이트웨이 전체가 영구 정지한다.
        # startup이 call보다 넉넉한 이유는 npx/uvx의 최초 패키지 다운로드다.
        self.startup_timeout_seconds = startup_timeout_seconds
        self.list_tools_timeout_seconds = list_tools_timeout_seconds
        self.max_restarts = max_restarts
        self.restart_backoff_seconds = restart_backoff_seconds
        # post-parse 상한이다 — `ResponseTooLargeError` docstring의 "알려진 한계"
        # 참고. SDK가 이미 파싱을 끝낸 뒤에야 재므로 전송 계층 메모리 스파이크는
        # 못 막지만, 그 크기가 이 프로세스 밖(aggregator/LLM 컨텍스트)으로 계속
        # 흘러가는 건 여기서 막는다.
        self.max_response_chars = max_response_chars

        self._session: ClientSession | None = None
        self._task: asyncio.Task[None] | None = None
        self._ready: asyncio.Event | None = None
        self._stop: asyncio.Event | None = None
        self._startup_error: BaseException | None = None
        self._init_result: InitializeResult | None = None
        self.server_info: ServerInfoSnapshot | None = None
        self.crash_count = 0
        self.restart_count = 0

    @property
    def alias(self) -> str:
        return self.entry.alias

    @property
    def log_path(self) -> Path:
        return self.log_dir / f"{self.alias}.log"

    @property
    def is_running(self) -> bool:
        return self._session is not None

    def read_log(self) -> str:
        """`log_path`를 관대하게 디코드해서 읽는다 — `read_log_text()` 참고
        (upstream 서브프로세스 stderr가 이 파일에 임의 인코딩으로 섞여 들어올 수
        있어 strict utf-8 읽기는 크래시한다)."""
        return read_log_text(self.log_path)

    def _log_event(self, message: str) -> None:
        ts = datetime.now(UTC).isoformat()
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(f"[{ts}] {message}\n")

    def log_event(self, message: str) -> None:
        """상위 오케스트레이터(server.py의 게이트웨이)가 이 서버의 로그 파일에
        직접 기록할 때 쓴다 — 64자 위반 스킵처럼 핸들 바깥에서 판정되지만
        "이 서버에 대한 사실"인 이벤트가 있다."""
        self._log_event(message)

    def _append_stderr_text(self, text: str) -> None:
        """`_pump_stderr()`가 디코드한 자식 stderr 텍스트를 로그에 그대로
        이어 쓴다. `_log_event()`와 달리 타임스탬프/우리 형식을 붙이지
        않는다 — 자식이 실제로 쓴 원문을 그대로 보존한다(형식만 우리가
        더하지 않을 뿐, 정보 정직성)."""
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(text)

    async def _pump_stderr(self, read_fd: int) -> None:
        """upstream 서브프로세스의 stderr 원시 바이트를 파이프에서 직접 읽어
        `errors="replace"`로 디코드한 뒤 로그 파일에 이어 쓴다.

        **기록 시점 방어(US-011)**: `stdio_client(errlog=...)`에 로그 파일을
        그대로 넘기면(예전 방식) 자식이 그 OS 파일 디스크립터에 직접 쓴다 —
        파이썬 인코딩 계층을 완전히 건너뛰므로 자식이 어떤 인코딩으로 쓰든
        통제할 수 없다. 한글이 포함된 경로에서 실측 확인됐다: Windows 한국어
        로케일 자식이 기본 콘솔 코드페이지(cp949)로 stderr를 쓰면 그 바이트가
        로그 파일에 그대로 섞여 들어갔다. 이제는 파이프로 직접 받아 여기서
        미리 안전한 UTF-8로 바꾸므로, 로그 파일 자체가 **항상** 유효한
        UTF-8이다 — strict로 다시 읽어도 죽지 않는다. `read_log_text()`의
        관대한 읽기는 이중 방어로 남겨둔다(이 파이프 밖에서 로그 파일에 다른
        경로로 잘못된 바이트가 들어올 가능성까지 방어).

        청크 경계에서 멀티바이트 UTF-8 시퀀스가 잘려도 오탐(잘못된 U+FFFD
        치환) 없이 이어붙이도록 `IncrementalDecoder`를 쓴다 — 한 청크씩
        `errors="replace"`로 독립 디코드하면 정상적인 멀티바이트 문자가
        청크 경계에 걸렸을 때도 깨진 것으로 오판할 수 있다.
        """
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        try:
            with os.fdopen(read_fd, "rb") as pipe_in:
                while True:
                    chunk = await asyncio.to_thread(pipe_in.read, 65536)
                    if not chunk:
                        break
                    text = decoder.decode(chunk)
                    if text:
                        self._append_stderr_text(text)
            tail = decoder.decode(b"", final=True)
            if tail:
                self._append_stderr_text(tail)
        except (OSError, ValueError):
            # 파이프가 예기치 않게 이미 닫힌 경우(취소/조기 종료) — 진단용
            # stderr 로그 일부를 놓치는 것이 세션 전체를 죽이는 것보다 낫다.
            pass

    async def _session_lifetime(self) -> None:
        """이 서버의 stdio 컨텍스트를 **자기 태스크 안에서** 열고 닫는다.

        anyio의 취소 스코프(`stdio_client`가 내부에 task group을 쓴다)는 진입한
        태스크에서, 진입 역순으로 빠져나와야 한다. 예전처럼 여러 핸들이 한
        태스크에서 `AsyncExitStack`을 각자 열면 스코프가 서로 겹쳐 쌓이고,
        먼저 연 서버를 먼저 닫는 순간 `CancelledError: Cancelled via cancel
        scope ...`로 터진다 — 서버 3개를 붙여놓고 `doctor`를 돌렸을 때 실제로
        터졌다. 핸들마다 태스크를 하나씩 주면 스코프가 서로 독립이라
        **어떤 순서로 끊어도 안전하다**(동적 disconnect도 포함).
        """
        assert self._ready is not None and self._stop is not None
        errlog = None
        stderr_read_fd: int | None = None
        stderr_pump_task: asyncio.Task[None] | None = None
        try:
            # 로그 파일 열기와 `StdioServerParameters` 생성은 **반드시 try 안**에
            # 있어야 한다. 밖에 두면 여기서 나는 예외가 `finally`의
            # `self._ready.set()`을 건너뛰어 `start()`가 영원히 기다린다.
            # 실제로 두 경로가 있다: (1) 로그 디렉토리가 사라졌거나 잠긴 경우,
            # (2) 등록 정보의 args/env에 문자열이 아닌 값이 있어 pydantic이
            # `ValidationError`를 던지는 경우(스니펫에 `"DEBUG": true`가 섞이면
            # 그대로 여기까지 온다). 둘 다 "느린 서버"가 아니라 즉시 실패이므로
            # 리포트로 돌려줘야 한다.
            #
            # `errlog`는 로그 파일을 직접 여는 대신 우리가 만든 파이프의 쓰기
            # 끝이다 — `_pump_stderr()` 독스트링 참고(US-011). 자식이 이
            # 디스크립터에 직접 쓴 바이트를 우리가 파이프 반대편에서 받아
            # `errors="replace"`로 안전하게 디코드한 뒤에만 로그 파일에 쓴다.
            stderr_read_fd, stderr_write_fd = os.pipe()
            errlog = os.fdopen(stderr_write_fd, "wb")
            stderr_pump_task = asyncio.create_task(self._pump_stderr(stderr_read_fd))
            stderr_read_fd = None  # 소유권이 pump 태스크로 넘어갔다 — 직접 닫지 않는다
            # SECURITY.md §6 — 레지스트리의 env 값은 평문이 아니라 센티널일 수
            # 있다(app/lib/main/mcp-env.js가 마이그레이션한 경우). 여기서 실값으로
            # 푼다 — 이 프로세스 환경에 `ATHENA_MCP_ENV__<alias>__<KEY>`가 없으면
            # `MissingSecretEnvError`가 나고, 그건 이 try 블록 안이라 아래
            # `except Exception`이 `_startup_error`에 담아 정상적인 "즉시 실패"
            # 경로(pydantic ValidationError와 같은 처리)를 그대로 탄다.
            params = StdioServerParameters(
                command=self.entry.command,
                args=list(self.entry.args),
                env=resolve_secret_env(self.alias, self.entry.env) or None,
            )
            async with (
                stdio_client(params, errlog=errlog) as (read, write),
                ClientSession(read, write) as session,
            ):
                try:
                    init_result = await asyncio.wait_for(
                        session.initialize(), timeout=self.startup_timeout_seconds
                    )
                except TimeoutError:
                    self._startup_error = ServerStartupTimeoutError(
                        f"{self.alias!r}: initialize가 {self.startup_timeout_seconds}초 안에 "
                        f"응답하지 않았다. 명령이 실제로 MCP stdio 서버인지, npx/uvx 최초 "
                        f"다운로드가 이 상한보다 오래 걸리는지 확인하라 "
                        f"(명령: {self.entry.full_command_text()})"
                    )
                    self._log_event(
                        f"initialize 타임아웃 ({self.startup_timeout_seconds}s) — "
                        f"명령: {self.entry.full_command_text()!r}"
                    )
                    return
                self._init_result = init_result
                self._session = session
                self._ready.set()
                await self._stop.wait()
        except Exception as exc:
            self._startup_error = exc
        finally:
            self._session = None
            self._ready.set()  # 실패했어도 start()가 영원히 기다리지 않게 한다
            if errlog is not None:
                # 쓰기 끝을 닫아 파이프 반대편(_pump_stderr)에 EOF를 알린다.
                # `stdio_client`의 자체 종료 시퀀스(stdin 닫기 -> 정상 종료
                # 대기 -> SIGTERM/SIGKILL 승격)가 이미 위 `async with`에서 끝난
                # 뒤이므로, 이 시점엔 자식도 자기 쪽 사본을 이미 닫았을 것이다.
                errlog.close()
            if stderr_pump_task is not None:
                try:
                    # 정상 경로는 즉시 끝난다(자식이 이미 죽어 있다). 이 상한은
                    # 고아 손자 프로세스가 파이프 사본을 계속 들고 있는 것 같은
                    # 드문 경우에 대한 방어일 뿐이다 — close()/restart()가
                    # 무한정 멈추면 안 된다.
                    await asyncio.wait_for(stderr_pump_task, timeout=5.0)
                except TimeoutError:
                    stderr_pump_task.cancel()
                    self._log_event("stderr 파이프 배수 태스크가 5초 안에 끝나지 않아 취소했다")
            if stderr_read_fd is not None:
                # pump 태스크를 아예 못 띄운 예외 경로 — 여기서 직접 닫는다.
                os.close(stderr_read_fd)

    async def start(self) -> InitializeResult:
        """서버 승인 확인 -> spawn -> initialize. 승인 없으면 spawn 자체가 금지된다."""
        self.consent_store.require_server_approved(self.alias)

        # 이미 돌고 있는 세션이 있으면 먼저 정리한다. 안 그러면 `self._stop`이
        # 새 Event로 덮여 옛 태스크가 기다리던 Event에 아무도 접근할 수 없게 되고,
        # 그 태스크·자식 프로세스·열린 로그 파일이 영구히 떠돈다(회수 불가).
        if self._task is not None and not self._task.done():
            self._log_event("start() 재호출 — 이전 세션을 먼저 정리한다")
        await self._join_task()

        self._ready = asyncio.Event()
        self._stop = asyncio.Event()
        self._startup_error = None
        self._init_result = None
        task = asyncio.create_task(self._session_lifetime())
        self._task = task

        # `_ready`만 기다리면, 태스크가 `finally`에 못 닿는 방식으로 죽었을 때
        # (예: BaseException) 영원히 멈춘다. 태스크 종료도 같이 기다려서
        # "둘 중 먼저 오는 쪽"으로 깨어난다 — 어느 쪽이든 hang은 없다.
        ready_waiter = asyncio.ensure_future(self._ready.wait())
        try:
            await asyncio.wait(
                {ready_waiter, task}, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            ready_waiter.cancel()

        if self._startup_error is not None or self._init_result is None:
            await self._join_task()
            error = self._startup_error or ServerCrashedError(
                f"{self.alias!r}: initialize 결과 없이 세션이 끝났다"
            )
            raise error

        init_result = self._init_result
        self.server_info = ServerInfoSnapshot(
            reported_name=init_result.serverInfo.name if init_result.serverInfo else None,
            reported_version=init_result.serverInfo.version if init_result.serverInfo else None,
            protocol_version=init_result.protocolVersion,
        )
        self._log_event(
            f"started alias={self.alias} protocolVersion={self.server_info.protocol_version} "
            f"self_reported_name={self.server_info.reported_name!r} "
            f"self_reported_version={self.server_info.reported_version!r} (자가보고, 신뢰 금지)"
        )
        return init_result

    async def _join_task(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            return
        if self._stop is not None:
            self._stop.set()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            # 종료 중 예외는 이미 `_startup_error`에 담겼거나 정리 과정의
            # 잡음이다. 종료를 막을 이유는 없다.
            pass

    def _check_response_size(
        self, result: CallToolResult | ListToolsResult, *, tool_name: str | None
    ) -> None:
        """직렬화된 JSON 문자열 길이로 상한을 검사한다. 초과 시 자르지 않고 던진다.

        `model_dump_json()` 전체 길이를 재는 이유: `call_tool`은 `content` 배열
        (여러 블록 가능) + `structuredContent`를, `list_tools`는 등록된 툴 전체의
        `description`/`inputSchema`를 합산해서 재야 하므로, 두 결과 타입에 공통으로
        적용 가능한 단일 지표가 필요하다. 개별 필드(예: `content[0].text`만)를 재면
        다른 필드로 우회하는 상한이 된다.
        """
        observed_size = len(result.model_dump_json())
        if observed_size > self.max_response_chars:
            raise ResponseTooLargeError(
                alias=self.alias,
                tool_name=tool_name,
                observed_size=observed_size,
                limit=self.max_response_chars,
            )

    async def list_tools(self) -> list[Tool]:
        if self._session is None:
            raise ServerCrashedError(f"{self.alias!r}: 세션이 시작되지 않았다")
        try:
            result = await asyncio.wait_for(
                self._session.list_tools(), timeout=self.list_tools_timeout_seconds
            )
        except TimeoutError:
            self._log_event(f"list_tools 타임아웃 ({self.list_tools_timeout_seconds}s)")
            raise ListToolsTimeoutError(
                f"{self.alias!r}: list_tools가 {self.list_tools_timeout_seconds}초 안에 "
                "응답하지 않았다"
            ) from None
        # 상한 검사는 try/except 바깥이다 — `ResponseTooLargeError`를 크래시로
        # 오분류하면 안 된다(아래 call_tool과 같은 이유).
        self._check_response_size(result, tool_name=None)
        return result.tools

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        *,
        progress_callback: ProgressFnT | None = None,
    ) -> CallToolResult:
        if self._session is None:
            raise ServerCrashedError(f"{self.alias!r}: 세션이 시작되지 않았다")
        try:
            result = await asyncio.wait_for(
                self._session.call_tool(name, arguments or {}, progress_callback=progress_callback),
                timeout=self.call_timeout_seconds,
            )
        except TimeoutError:
            # 느린 호출일 뿐 반드시 크래시는 아니다 — crash_count를 올리지 않고
            # 그대로 전파한다. 상위(aggregator)가 재시도/취소를 판단한다.
            raise
        except asyncio.CancelledError:
            # `asyncio.CancelledError`는 3.8+에서 `BaseException`이라 아래
            # `except Exception`에는 원래도 안 걸리지만, "취소를 크래시로 바꾸지
            # 않는다"는 계약을 코드에서도 명시적으로 보이게 한다 — `wait_for`가
            # 취소되면 내부 `call_tool` 요청도 함께 취소되고(anyio 취소 스코프),
            # 세션은 죽은 것으로 간주하지 않는다. crash_count를 올리지 않고
            # 그대로 재전파한다.
            raise
        except Exception as exc:
            # 그 외 예외(프로세스 종료로 인한 파이프 끊김 등)는 세션이 죽은
            # 것으로 간주한다. 상위가 restart()를 호출할 근거로 crash_count를 남긴다.
            self.crash_count += 1
            self._log_event(
                f"call_tool({name!r}) 중 예외 (크래시로 간주, {self.crash_count}번째): {exc!r}"
            )
            self._mark_dead()
            raise ServerCrashedError(f"{self.alias!r}: call_tool({name!r}) 중 예외 발생") from exc
        # 상한 검사는 try/except 바깥이다 — 여기서 `ResponseTooLargeError`를 던지면
        # 위 `except Exception`에 걸려 `ServerCrashedError`로 오분류된다(서버는
        # 정상 응답했다, 크기가 클 뿐이다). crash_count도 올리지 않는다.
        self._check_response_size(result, tool_name=name)
        return result

    def _mark_dead(self) -> None:
        """크래시가 확인된 세션을 즉시 못 쓰게 만든다.

        예전에는 `crash_count`만 올리고 `_session`을 그대로 뒀다. 그래서
        `is_running`이 계속 True를 보고했고, 다음 호출이 **이미 죽은 세션으로
        그대로 들어가** 같은 실패를 반복했다(빠르게 실패하지 않았다).
        `_stop`을 세워 수명주기 태스크도 함께 풀어준다 — 프로세스는 어차피
        죽었으므로 컨텍스트를 붙들고 있을 이유가 없다. 되살리는 건
        `restart()`의 몫이고, 그건 `close()` 후 `start()`를 다시 탄다.
        """
        self._session = None
        if self._stop is not None:
            self._stop.set()

    async def healthcheck(self) -> bool:
        """가벼운 ping으로 세션 생존을 확인한다. 실패 시 crash_count를 올린다."""
        if self._session is None:
            return False
        try:
            await asyncio.wait_for(
                self._session.list_tools(), timeout=self.healthcheck_timeout_seconds
            )
            return True
        except TimeoutError:
            # 응답이 늦은 것과 죽은 것은 다르다. 바쁜 서버를 5초 무응답만으로
            # 사망 처리하면 멀쩡한 세션을 끊는다 — 세지만 하고 죽이진 않는다.
            self.crash_count += 1
            self._log_event(f"healthcheck 타임아웃 ({self.crash_count}번째, 세션은 유지)")
            return False
        except Exception as exc:
            self.crash_count += 1
            self._log_event(f"healthcheck failed ({self.crash_count}번째): {exc!r}")
            self._mark_dead()
            return False

    async def close(self) -> None:
        await self._join_task()
        self._session = None

    async def restart(self) -> InitializeResult:
        """재시작 상한 내에서 지수 백오프 후 재시작한다."""
        if self.restart_count >= self.max_restarts:
            raise MaxRestartsExceededError(
                f"{self.alias!r}: 재시작 상한({self.max_restarts}) 초과 — 자동 재시작 중단"
            )
        self._log_event(f"restarting (시도 {self.restart_count + 1}/{self.max_restarts})")
        await self.close()
        backoff = self.restart_backoff_seconds * (2**self.restart_count)
        await asyncio.sleep(backoff)
        self.restart_count += 1
        return await self.start()
