"""브레인이 쓰는 SQLite 파일 하나의 소유자.

2026-08-25 leaf 2. 이 모듈이 생긴 이유는 **적재 1회를 커밋 1개로** 만들기 위해서다.

이전 판은 적재 한 번이 두 커밋이었다 — 그래프는 `brain.lbug`, 잡·커서 상태는
`brain-history.sqlite3`. 그 사이에서 프로세스가 죽으면 "커서는 전진했는데 그래프엔
안 들어간" 상태가 남는다. `reset-and-restart`가 스스로 SIGTERM을 날리는 앱이라
그 창은 이론이 아니라 일상이다.

파일만 합치는 것으로는 부족하다. 연결이 둘이면 커밋도 둘이다. 그래서 연결 하나를
`GraphStore`와 `HistoryStore`가 **공유**하고, 그 위에서 `transaction()`이 둘의 쓰기를
한 단위로 묶는다.

**왜 SAVEPOINT인가.** 두 저장소의 쓰기 메서드는 각자 원자성을 보장해야 한다 — 혼자
불려도 안전해야 하고, `transaction()` 안에서 불려도 바깥 단위를 깨면 안 된다. SQLite에서
`BEGIN`은 중첩되지 않지만 `SAVEPOINT`는 중첩된다. 자동커밋 상태에서 열린 savepoint는
스스로 트랜잭션을 시작하고, 이미 트랜잭션 안이면 중첩 지점이 된다 — 두 경우 모두
같은 코드로 처리된다.

**왜 스레드 하나인가.** `history.py`가 이미 검증한 설정을 그대로 가져왔다. 단일 소유자
스레드 + `isolation_level=None`(명시적 트랜잭션 제어) + WAL + busy_timeout. 소유자가
하나이므로 두 저장소가 같은 연결을 동시에 건드릴 일이 없다.
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator, Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any


class SqliteOwner:
    """한 파일 · 한 연결 · 한 스레드. 여러 저장소가 나눠 쓴다.

    `open()`은 멱등이지만 `close()` 뒤의 재개방은 거부한다. 닫힌 뒤 되살릴 수 있게 하면
    "닫혔지만 살아 있는" 중간 상태가 생기고, 그건 정합성 사고의 자리다 — 리셋은 객체를
    되살리는 대신 프로세스를 재기동한다.
    """

    def __init__(
        self,
        path: Path,
        *,
        busy_timeout_ms: int = 5_000,
        thread_name_prefix: str = "athena-brain-db",
    ) -> None:
        if busy_timeout_ms <= 0:
            raise ValueError("busy_timeout_ms must be positive")
        self.path = Path(path)
        self._busy_timeout_ms = busy_timeout_ms
        self._thread_name_prefix = thread_name_prefix
        self._connection: sqlite3.Connection | None = None
        self._executor: ThreadPoolExecutor | None = None
        self._lock = asyncio.Lock()
        self._closed = False
        self._savepoint_depth = 0
        # 스키마를 이미 깐 컴포넌트. 두 저장소가 같은 파일을 열므로, 각자 자기 스키마를
        # 한 번씩만 깔되 상대 것을 건드리지 않는다.
        self._installed: set[str] = set()

    @property
    def is_open(self) -> bool:
        return self._connection is not None

    @property
    def in_transaction(self) -> bool:
        """지금 바깥 `transaction()` 단위 안인가."""
        return self._savepoint_depth > 0

    async def open(self) -> None:
        async with self._lock:
            if self._closed:
                raise RuntimeError("sqlite owner is closed and cannot be reopened")
            if self._connection is not None:
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix=self._thread_name_prefix
            )
            await self._submit(self._open_sync)

    def _open_sync(self) -> None:
        connection = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms:d}")
            connection.executescript(_SHARED_SCHEMA)
        except Exception:
            connection.close()
            raise
        self._connection = connection

    async def close(self) -> None:
        async with self._lock:
            connection, self._connection = self._connection, None
            self._closed = True
            if connection is not None:
                await self._submit(connection.close)
            executor, self._executor = self._executor, None
        if executor is not None:
            executor.shutdown(wait=True)

    def require(self) -> sqlite3.Connection:
        connection = self._connection
        if connection is None:
            raise RuntimeError("sqlite owner is not open")
        return connection

    def _submit(self, fn: Callable[..., Any], *args: Any) -> asyncio.Future[Any]:
        executor = self._executor
        if executor is None:
            raise RuntimeError("sqlite owner is not open")
        return asyncio.get_running_loop().run_in_executor(executor, fn, *args)

    async def run(self, fn: Callable[[], Any]) -> Any:
        """소유자 스레드에서 `fn`을 돌린다.

        이미 `transaction()` 안이면 락을 다시 잡지 않는다 — 같은 태스크가 자기 락을
        기다리며 영원히 멈추는 것을 막는다(asyncio.Lock은 재진입이 아니다).
        """
        if self.in_transaction:
            return await self._submit(fn)
        async with self._lock:
            return await self._submit(fn)

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[sqlite3.Connection]:
        """여러 저장소의 쓰기를 커밋 하나로 묶는다.

        중첩해도 안전하다: 안쪽은 savepoint가 되어 바깥이 롤백되면 함께 사라진다.
        """
        if self.in_transaction:
            async with self._savepoint():
                yield self.require()
            return
        async with self._lock:
            async with self._savepoint():
                yield self.require()

    @asynccontextmanager
    async def _savepoint(self) -> AsyncIterator[None]:
        name = f"brain_sp_{self._savepoint_depth}"
        connection = self.require()
        await self._submit(lambda: connection.execute(f"SAVEPOINT {name}"))
        self._savepoint_depth += 1
        try:
            yield
        except BaseException:
            self._savepoint_depth -= 1
            # 롤백 자체가 실패해도 원래 예외를 덮지 않는다 — 원인이 사라지면 진단이 끝난다.
            try:
                await self._submit(
                    lambda: connection.execute(f"ROLLBACK TO {name}") or None
                )
            finally:
                await self._submit(lambda: connection.execute(f"RELEASE {name}"))
            raise
        self._savepoint_depth -= 1
        await self._submit(lambda: connection.execute(f"RELEASE {name}"))

    async def install_schema(self, component: str, schema: str, version: int) -> None:
        """컴포넌트의 스키마를 깔고 버전을 못박는다.

        `schema_version`이 컴포넌트별 행인 것이 요점이다. 이전에는 두 저장소가 각자
        `schema_version` 테이블을 `CREATE TABLE IF NOT EXISTS`로 만들었는데 **컬럼이
        서로 달랐다**(`key TEXT` vs `singleton INTEGER`). 파일을 합치면 먼저 여는 쪽이
        이기고 나중 쪽은 "no such column"으로 죽는다 — 한 파일로 가면서 반드시 풀어야
        했던 충돌이다.
        """

        def install() -> None:
            connection = self.require()
            connection.executescript(schema)
            row = connection.execute(
                "SELECT version FROM schema_version WHERE component = ?", (component,)
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO schema_version(component, version) VALUES(?, ?)",
                    (component, version),
                )
            elif int(row["version"]) != version:
                raise RuntimeError(
                    f"unsupported {component} schema version: {row['version']}"
                )

        async with self._lock:
            if component in self._installed:
                return
            await self._submit(install)
            self._installed.add(component)

    async def schema_version(self, component: str) -> int:
        def read() -> int:
            row = self.require().execute(
                "SELECT version FROM schema_version WHERE component = ?", (component,)
            ).fetchone()
            return int(row["version"]) if row else 0

        return await self.run(read)


@contextmanager
def atomic(connection: sqlite3.Connection, name: str) -> Iterator[None]:
    """소유자 스레드 안에서 쓰기 한 단위를 원자화한다.

    `BEGIN IMMEDIATE`가 아니라 `SAVEPOINT`인 이유가 이 함수의 존재 이유다. 저장소의
    쓰기 메서드는 혼자 불려도(자동커밋 → savepoint가 트랜잭션을 연다) `transaction()`
    안에서 불려도(중첩 지점이 된다) 같은 코드로 동작해야 한다. `BEGIN`을 쓰면 후자에서
    "cannot start a transaction within a transaction"으로 죽는다.
    """
    connection.execute(f"SAVEPOINT {name}")
    try:
        yield
    except BaseException:
        connection.execute(f"ROLLBACK TO {name}")
        connection.execute(f"RELEASE {name}")
        raise
    connection.execute(f"RELEASE {name}")


# 두 저장소가 공유하는 유일한 테이블. 나머지는 각자 `install_schema`로 깐다.
_SHARED_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (
    component TEXT PRIMARY KEY,
    version   INTEGER NOT NULL
);
"""


__all__ = ["SqliteOwner", "atomic"]
