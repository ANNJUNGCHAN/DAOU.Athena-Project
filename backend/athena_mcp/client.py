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
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult, InitializeResult, Tool

from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerEntry


class ServerCrashedError(RuntimeError):
    """upstream 서버 세션이 죽었다(healthcheck 실패 또는 호출 중 예외)."""


class MaxRestartsExceededError(RuntimeError):
    """재시작 상한을 넘었다 — 더 이상 자동 재시작하지 않는다."""


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
        max_restarts: int = 3,
        restart_backoff_seconds: float = 1.0,
    ) -> None:
        self.entry = entry
        self.consent_store = consent_store
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.call_timeout_seconds = call_timeout_seconds
        self.healthcheck_timeout_seconds = healthcheck_timeout_seconds
        self.max_restarts = max_restarts
        self.restart_backoff_seconds = restart_backoff_seconds

        self._exit_stack: AsyncExitStack | None = None
        self._session: ClientSession | None = None
        self._errlog_file = None
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

    def _log_event(self, message: str) -> None:
        ts = datetime.now(UTC).isoformat()
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(f"[{ts}] {message}\n")

    async def start(self) -> InitializeResult:
        """서버 승인 확인 -> spawn -> initialize. 승인 없으면 spawn 자체가 금지된다."""
        self.consent_store.require_server_approved(self.alias)

        stack = AsyncExitStack()
        errlog = self.log_path.open("a", encoding="utf-8")
        stack.push_async_callback(_close_file, errlog)

        params = StdioServerParameters(
            command=self.entry.command,
            args=list(self.entry.args),
            env=dict(self.entry.env) or None,
        )
        try:
            read, write = await stack.enter_async_context(stdio_client(params, errlog=errlog))
            session = await stack.enter_async_context(ClientSession(read, write))
            init_result = await session.initialize()
        except Exception:
            await stack.aclose()
            raise

        self._exit_stack = stack
        self._session = session
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

    async def list_tools(self) -> list[Tool]:
        if self._session is None:
            raise ServerCrashedError(f"{self.alias!r}: 세션이 시작되지 않았다")
        result = await self._session.list_tools()
        return result.tools

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> CallToolResult:
        if self._session is None:
            raise ServerCrashedError(f"{self.alias!r}: 세션이 시작되지 않았다")
        try:
            return await asyncio.wait_for(
                self._session.call_tool(name, arguments or {}),
                timeout=self.call_timeout_seconds,
            )
        except TimeoutError:
            # 느린 호출일 뿐 반드시 크래시는 아니다 — crash_count를 올리지 않고
            # 그대로 전파한다. 상위(aggregator)가 재시도/취소를 판단한다.
            raise
        except Exception as exc:
            # 그 외 예외(프로세스 종료로 인한 파이프 끊김 등)는 세션이 죽은
            # 것으로 간주한다. 상위가 restart()를 호출할 근거로 crash_count를 남긴다.
            self.crash_count += 1
            self._log_event(
                f"call_tool({name!r}) 중 예외 (크래시로 간주, {self.crash_count}번째): {exc!r}"
            )
            raise ServerCrashedError(f"{self.alias!r}: call_tool({name!r}) 중 예외 발생") from exc

    async def healthcheck(self) -> bool:
        """가벼운 ping으로 세션 생존을 확인한다. 실패 시 crash_count를 올린다."""
        if self._session is None:
            return False
        try:
            await asyncio.wait_for(
                self._session.list_tools(), timeout=self.healthcheck_timeout_seconds
            )
            return True
        except Exception as exc:
            self.crash_count += 1
            self._log_event(f"healthcheck failed ({self.crash_count}번째): {exc!r}")
            return False

    async def close(self) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
        self._exit_stack = None
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


async def _close_file(f: Any) -> None:
    f.close()
