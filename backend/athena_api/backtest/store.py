"""백테스트 SQLite 저장층 — 캔들 캐시 · 전략 버전 · 실행 이력 (§5.3, §6.1).

**왜 파일을 분리하나.** `SqliteOwner`(brain/db.py)를 패턴으로 재사용하되 브레인과는
다른 파일을 쓴다. 브레인의 `reset-and-restart`는 스스로 SIGTERM을 날리는 정상 흐름의
일부인데, 그게 캔들 캐시까지 날리면 재시작마다 키움 레이트 리밋(§5.2, 전역 5 req/s ·
TR당 1 req/s)을 다시 태우게 된다. 수명과 재생성 비용이 전혀 다른 데이터를 한 파일에
묶을 이유가 없다.

**왜 `SqliteOwner`를 새로 만들지 않고 주입받나.** 이 모듈은 "이 파일을 어디에 둘까"를
결정할 위치가 아니다 — 그건 lifespan/설정이 아는 일이다. `GraphStore`처럼 경로도 받는
이중 생성자를 두지 않은 이유는, 백테스트 저장소가 브레인처럼 "테스트 전용 단독 파일"
경로가 필요할 이유가 없기 때문이다(테스트도 `SqliteOwner`를 직접 만들어 주입하면 된다).

**활성 버전 불변식.** 전략당 활성 버전은 정확히 하나다 — 두 겹으로 지킨다.
① `add_version`/`activate_version`이 새 버전을 켜기 전에 기존 활성 버전부터 끄는
트랜잭션(SAVEPOINT) 안에서 움직인다. ② 그래도 애플리케이션 로직에 구멍이 나면
`bt_strategy_version_one_active`(부분 유니크 인덱스)가 DB 계층에서 막는다 — ①이
버그로 두 행을 동시에 켜려 들면 ②가 `IntegrityError`로 즉시 거부한다.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from athena_api.brain.db import SqliteOwner, atomic

SCHEMA_VERSION: Final = 1

# 이 저장소의 쓰기 한 단위가 공유하는 savepoint 이름. 브레인의 `_GRAPH_WRITE`와 같은
# 이유로 하나면 된다 — 백테스트 쓰기끼리는 중첩하지 않는다.
_BACKTEST_WRITE: Final = "backtest_write"

_SCHEMA: Final = """
CREATE TABLE IF NOT EXISTS bt_candle (
    stk_cd   TEXT NOT NULL,
    period   TEXT NOT NULL,
    adjusted INTEGER NOT NULL,
    dt       TEXT NOT NULL,
    open     REAL NOT NULL,
    high     REAL NOT NULL,
    low      REAL NOT NULL,
    close    REAL NOT NULL,
    volume   INTEGER NOT NULL,
    PRIMARY KEY (stk_cd, period, adjusted, dt)
);
CREATE TABLE IF NOT EXISTS bt_coverage (
    stk_cd     TEXT NOT NULL,
    period     TEXT NOT NULL,
    adjusted   INTEGER NOT NULL,
    first_dt   TEXT NOT NULL,
    last_dt    TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    pages      INTEGER NOT NULL,
    PRIMARY KEY (stk_cd, period, adjusted)
);
CREATE TABLE IF NOT EXISTS bt_strategy (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bt_strategy_version (
    id          TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES bt_strategy(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    source      TEXT NOT NULL,
    note        TEXT,
    origin      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS bt_strategy_version_unique
    ON bt_strategy_version(strategy_id, version);
-- 전략당 활성 버전은 정확히 하나 — active=1인 행이 strategy_id마다 최대 하나여야
-- 한다. 부분 유니크 인덱스라 active=0인 행은 이 제약과 무관하게 얼마든지 쌓인다.
CREATE UNIQUE INDEX IF NOT EXISTS bt_strategy_version_one_active
    ON bt_strategy_version(strategy_id) WHERE active = 1;
CREATE TABLE IF NOT EXISTS bt_run (
    id                  TEXT PRIMARY KEY,
    strategy_version_id TEXT NOT NULL REFERENCES bt_strategy_version(id) ON DELETE CASCADE,
    params_json         TEXT NOT NULL,
    spec_hash           TEXT NOT NULL,
    status              TEXT NOT NULL,
    started_at          TEXT,
    finished_at         TEXT,
    error               TEXT,
    metrics_json        TEXT,
    stdout              TEXT
);
CREATE INDEX IF NOT EXISTS bt_run_version ON bt_run(strategy_version_id);
CREATE TABLE IF NOT EXISTS bt_trade (
    run_id TEXT NOT NULL REFERENCES bt_run(id) ON DELETE CASCADE,
    seq    INTEGER NOT NULL,
    side   TEXT NOT NULL,
    dt     TEXT NOT NULL,
    price  REAL NOT NULL,
    qty    REAL NOT NULL,
    fee    REAL NOT NULL,
    tax    REAL NOT NULL,
    pnl    REAL,
    reason TEXT,
    PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS bt_equity (
    run_id         TEXT NOT NULL REFERENCES bt_run(id) ON DELETE CASCADE,
    dt             TEXT NOT NULL,
    equity         REAL NOT NULL,
    cash           REAL NOT NULL,
    position_value REAL NOT NULL,
    drawdown       REAL NOT NULL,
    PRIMARY KEY (run_id, dt)
);
CREATE TABLE IF NOT EXISTS bt_optimize (
    id              TEXT PRIMARY KEY,
    run_group       TEXT NOT NULL,
    param_grid_json TEXT NOT NULL,
    method          TEXT NOT NULL,
    status          TEXT NOT NULL,
    best_run_id     TEXT
);
"""


def _ts(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class Candle:
    dt: str
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass(frozen=True, slots=True)
class Coverage:
    stk_cd: str
    period: str
    adjusted: bool
    first_dt: str
    last_dt: str
    fetched_at: str
    pages: int


@dataclass(frozen=True, slots=True)
class Strategy:
    id: str
    name: str
    kind: str
    created_at: str


@dataclass(frozen=True, slots=True)
class StrategyVersion:
    id: str
    strategy_id: str
    version: int
    source: str
    note: str | None
    origin: str
    created_at: str
    active: bool


@dataclass(frozen=True, slots=True)
class Run:
    id: str
    strategy_version_id: str
    params_json: str
    spec_hash: str
    status: str
    started_at: str | None
    finished_at: str | None
    error: str | None
    metrics_json: str | None
    stdout: str | None


@dataclass(frozen=True, slots=True)
class Trade:
    seq: int
    side: str
    dt: str
    price: float
    qty: float
    fee: float
    tax: float
    pnl: float | None
    reason: str | None


@dataclass(frozen=True, slots=True)
class EquityPoint:
    dt: str
    equity: float
    cash: float
    position_value: float
    drawdown: float


class BacktestStore:
    """캔들 캐시 · 전략 버전 · 실행 이력을 한 SQLite 파일에 올린다.

    `SqliteOwner`를 주입받는다 — 파일 경로 결정도, 연결의 열고 닫음도 이 클래스의
    책임이 아니다. 호출자가 이미 연 owner를 넘기고, `open()`은 그 위에 스키마만 깐다.
    """

    def __init__(self, owner: SqliteOwner) -> None:
        self._owner = owner

    async def open(self) -> None:
        if not self._owner.is_open:
            raise RuntimeError("sqlite owner must be opened before the backtest store")
        await self._owner.install_schema("backtest", _SCHEMA, SCHEMA_VERSION)

    def _require(self) -> sqlite3.Connection:
        return self._owner.require()

    async def schema_version(self) -> int:
        return await self._owner.schema_version("backtest")

    # ── 캔들 ────────────────────────────────────────────────────────────────

    async def upsert_candles(
        self, stk_cd: str, period: str, adjusted: bool, candles: Sequence[Candle]
    ) -> None:
        """캔들 묶음을 한 트랜잭션으로 upsert한다.

        페이지 하나가 보통 수백 행이다(§5.2) — 행마다 커밋하면 WAL 쓰기가 그만큼
        늘어난다. `executemany`로 한 SAVEPOINT 안에 묶는다.
        """
        if not candles:
            return

        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.executemany(
                    "INSERT INTO bt_candle"
                    "(stk_cd, period, adjusted, dt, open, high, low, close, volume)"
                    " VALUES(?,?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(stk_cd, period, adjusted, dt) DO UPDATE SET"
                    " open=excluded.open, high=excluded.high, low=excluded.low,"
                    " close=excluded.close, volume=excluded.volume",
                    [
                        (
                            stk_cd,
                            period,
                            int(adjusted),
                            c.dt,
                            c.open,
                            c.high,
                            c.low,
                            c.close,
                            c.volume,
                        )
                        for c in candles
                    ],
                )

        await self._owner.run(write)

    async def candles(
        self,
        stk_cd: str,
        period: str,
        adjusted: bool,
        *,
        start: str | None = None,
        end: str | None = None,
    ) -> tuple[Candle, ...]:
        """시간 오름차순 봉 목록. `start`/`end`는 `dt`(YYYYMMDD) 문자열 경계다."""

        def read() -> tuple[Candle, ...]:
            sql = (
                "SELECT dt, open, high, low, close, volume FROM bt_candle"
                " WHERE stk_cd = ? AND period = ? AND adjusted = ?"
            )
            params: list[Any] = [stk_cd, period, int(adjusted)]
            if start is not None:
                sql += " AND dt >= ?"
                params.append(start)
            if end is not None:
                sql += " AND dt <= ?"
                params.append(end)
            sql += " ORDER BY dt"
            return tuple(
                Candle(
                    dt=str(row["dt"]),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=int(row["volume"]),
                )
                for row in self._require().execute(sql, params)
            )

        return await self._owner.run(read)

    async def upsert_coverage(
        self,
        stk_cd: str,
        period: str,
        adjusted: bool,
        *,
        first_dt: str,
        last_dt: str,
        fetched_at: datetime,
        pages: int,
    ) -> None:
        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "INSERT INTO bt_coverage"
                    "(stk_cd, period, adjusted, first_dt, last_dt, fetched_at, pages)"
                    " VALUES(?,?,?,?,?,?,?)"
                    " ON CONFLICT(stk_cd, period, adjusted) DO UPDATE SET"
                    " first_dt=excluded.first_dt, last_dt=excluded.last_dt,"
                    " fetched_at=excluded.fetched_at, pages=excluded.pages",
                    (stk_cd, period, int(adjusted), first_dt, last_dt, _ts(fetched_at), pages),
                )

        await self._owner.run(write)

    async def coverage(self, stk_cd: str, period: str, adjusted: bool) -> Coverage | None:
        def read() -> Coverage | None:
            row = self._require().execute(
                "SELECT * FROM bt_coverage WHERE stk_cd = ? AND period = ? AND adjusted = ?",
                (stk_cd, period, int(adjusted)),
            ).fetchone()
            if row is None:
                return None
            return Coverage(
                stk_cd=str(row["stk_cd"]),
                period=str(row["period"]),
                adjusted=bool(row["adjusted"]),
                first_dt=str(row["first_dt"]),
                last_dt=str(row["last_dt"]),
                fetched_at=str(row["fetched_at"]),
                pages=int(row["pages"]),
            )

        return await self._owner.run(read)

    # ── 전략 ────────────────────────────────────────────────────────────────

    async def create_strategy(
        self, strategy_id: str, name: str, kind: str, *, created_at: datetime
    ) -> str:
        if kind not in ("yaml", "python"):
            raise ValueError("kind must be 'yaml' or 'python'")

        def write() -> str:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "INSERT INTO bt_strategy(id, name, kind, created_at) VALUES(?,?,?,?)",
                    (strategy_id, name, kind, _ts(created_at)),
                )
            return strategy_id

        return await self._owner.run(write)

    async def strategy(self, strategy_id: str) -> Strategy | None:
        def read() -> Strategy | None:
            row = self._require().execute(
                "SELECT id, name, kind, created_at FROM bt_strategy WHERE id = ?", (strategy_id,)
            ).fetchone()
            if row is None:
                return None
            return Strategy(
                id=str(row["id"]),
                name=str(row["name"]),
                kind=str(row["kind"]),
                created_at=str(row["created_at"]),
            )

        return await self._owner.run(read)

    async def strategies(self) -> tuple[Strategy, ...]:
        def read() -> tuple[Strategy, ...]:
            return tuple(
                Strategy(
                    id=str(row["id"]),
                    name=str(row["name"]),
                    kind=str(row["kind"]),
                    created_at=str(row["created_at"]),
                )
                for row in self._require().execute(
                    "SELECT id, name, kind, created_at FROM bt_strategy ORDER BY created_at"
                )
            )

        return await self._owner.run(read)

    # ── 전략 버전 ───────────────────────────────────────────────────────────

    async def add_version(
        self,
        version_id: str,
        strategy_id: str,
        version: int,
        source: str,
        *,
        origin: str,
        created_at: datetime,
        note: str | None = None,
        active: bool = False,
    ) -> str:
        """새 버전을 추가한다. `active=True`면 켜기 전에 기존 활성 버전부터 끈다.

        `origin=human`이 즉시 활성화되는 것(§7.3)과 `origin=llm_draft`가 비활성으로
        남는 것 둘 다 이 하나의 파라미터로 표현한다 — 호출자(API 층)가 origin에 맞는
        `active` 값을 골라 넘긴다. 이 메서드 자체는 origin과 active를 연동시키지
        않는다 — 그 정책은 저장층이 아니라 호출자의 것이다.
        """
        if origin not in ("human", "form", "llm_draft"):
            raise ValueError("origin must be 'human', 'form', or 'llm_draft'")

        def write() -> str:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                if active:
                    connection.execute(
                        "UPDATE bt_strategy_version SET active = 0"
                        " WHERE strategy_id = ? AND active = 1",
                        (strategy_id,),
                    )
                connection.execute(
                    "INSERT INTO bt_strategy_version"
                    "(id, strategy_id, version, source, note, origin, created_at, active)"
                    " VALUES(?,?,?,?,?,?,?,?)",
                    (
                        version_id,
                        strategy_id,
                        version,
                        source,
                        note,
                        origin,
                        _ts(created_at),
                        int(active),
                    ),
                )
            return version_id

        return await self._owner.run(write)

    async def activate_version(self, strategy_id: str, version_id: str) -> None:
        """버전 하나를 켜고 나머지는 끈다 — 사람 클릭 전용 IPC가 부르는 자리다(§7.3).

        모델이 초안을 만들어놔도 이 메서드를 부르지 않는 한 활성 버전은 바뀌지 않는다.
        """

        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                row = connection.execute(
                    "SELECT strategy_id FROM bt_strategy_version WHERE id = ?", (version_id,)
                ).fetchone()
                if row is None or str(row["strategy_id"]) != strategy_id:
                    raise ValueError("version does not belong to the given strategy")
                connection.execute(
                    "UPDATE bt_strategy_version SET active = 0"
                    " WHERE strategy_id = ? AND active = 1",
                    (strategy_id,),
                )
                connection.execute(
                    "UPDATE bt_strategy_version SET active = 1 WHERE id = ?", (version_id,)
                )

        await self._owner.run(write)

    async def versions(self, strategy_id: str) -> tuple[StrategyVersion, ...]:
        def read() -> tuple[StrategyVersion, ...]:
            rows = self._require().execute(
                "SELECT id, strategy_id, version, source, note, origin, created_at, active"
                " FROM bt_strategy_version WHERE strategy_id = ? ORDER BY version",
                (strategy_id,),
            ).fetchall()
            return tuple(
                StrategyVersion(
                    id=str(row["id"]),
                    strategy_id=str(row["strategy_id"]),
                    version=int(row["version"]),
                    source=str(row["source"]),
                    note=None if row["note"] is None else str(row["note"]),
                    origin=str(row["origin"]),
                    created_at=str(row["created_at"]),
                    active=bool(row["active"]),
                )
                for row in rows
            )

        return await self._owner.run(read)

    # ── 실행 ────────────────────────────────────────────────────────────────

    async def create_run(
        self,
        run_id: str,
        strategy_version_id: str,
        *,
        params_json: str,
        spec_hash: str,
        status: str,
        started_at: datetime | None = None,
    ) -> str:
        def write() -> str:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "INSERT INTO bt_run"
                    "(id, strategy_version_id, params_json, spec_hash, status,"
                    " started_at, finished_at, error, metrics_json, stdout)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        run_id,
                        strategy_version_id,
                        params_json,
                        spec_hash,
                        status,
                        None if started_at is None else _ts(started_at),
                        None,
                        None,
                        None,
                        None,
                    ),
                )
            return run_id

        return await self._owner.run(write)

    async def update_run_status(
        self,
        run_id: str,
        status: str,
        *,
        finished_at: datetime | None = None,
        error: str | None = None,
        metrics_json: str | None = None,
        stdout: str | None = None,
    ) -> None:
        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                cursor = connection.execute(
                    "UPDATE bt_run SET status = ?, finished_at = ?, error = ?,"
                    " metrics_json = ?, stdout = ? WHERE id = ?",
                    (
                        status,
                        None if finished_at is None else _ts(finished_at),
                        error,
                        metrics_json,
                        stdout,
                        run_id,
                    ),
                )
                if cursor.rowcount == 0:
                    raise ValueError(f"run does not exist: {run_id}")

        await self._owner.run(write)

    async def run(self, run_id: str) -> Run | None:
        def read() -> Run | None:
            row = self._require().execute(
                "SELECT id, strategy_version_id, params_json, spec_hash, status,"
                " started_at, finished_at, error, metrics_json, stdout"
                " FROM bt_run WHERE id = ?",
                (run_id,),
            ).fetchone()
            return None if row is None else _run_from_row(row)

        return await self._owner.run(read)

    async def runs(self) -> tuple[Run, ...]:
        def read() -> tuple[Run, ...]:
            rows = self._require().execute(
                "SELECT id, strategy_version_id, params_json, spec_hash, status,"
                " started_at, finished_at, error, metrics_json, stdout"
                " FROM bt_run ORDER BY started_at"
            ).fetchall()
            return tuple(_run_from_row(row) for row in rows)

        return await self._owner.run(read)

    # ── 체결·자산곡선 ───────────────────────────────────────────────────────

    async def save_trades(self, run_id: str, trades: Sequence[Trade]) -> None:
        if not trades:
            return

        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.executemany(
                    "INSERT INTO bt_trade(run_id, seq, side, dt, price, qty, fee, tax, pnl, reason)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?)",
                    [
                        (run_id, t.seq, t.side, t.dt, t.price, t.qty, t.fee, t.tax, t.pnl, t.reason)
                        for t in trades
                    ],
                )

        await self._owner.run(write)

    async def trades(self, run_id: str) -> tuple[Trade, ...]:
        def read() -> tuple[Trade, ...]:
            rows = self._require().execute(
                "SELECT seq, side, dt, price, qty, fee, tax, pnl, reason FROM bt_trade"
                " WHERE run_id = ? ORDER BY seq",
                (run_id,),
            ).fetchall()
            return tuple(
                Trade(
                    seq=int(row["seq"]),
                    side=str(row["side"]),
                    dt=str(row["dt"]),
                    price=float(row["price"]),
                    qty=float(row["qty"]),
                    fee=float(row["fee"]),
                    tax=float(row["tax"]),
                    pnl=None if row["pnl"] is None else float(row["pnl"]),
                    reason=None if row["reason"] is None else str(row["reason"]),
                )
                for row in rows
            )

        return await self._owner.run(read)

    async def save_equity(self, run_id: str, points: Sequence[EquityPoint]) -> None:
        if not points:
            return

        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.executemany(
                    "INSERT INTO bt_equity(run_id, dt, equity, cash, position_value, drawdown)"
                    " VALUES(?,?,?,?,?,?)",
                    [
                        (run_id, p.dt, p.equity, p.cash, p.position_value, p.drawdown)
                        for p in points
                    ],
                )

        await self._owner.run(write)

    async def equity(self, run_id: str) -> tuple[EquityPoint, ...]:
        def read() -> tuple[EquityPoint, ...]:
            rows = self._require().execute(
                "SELECT dt, equity, cash, position_value, drawdown FROM bt_equity"
                " WHERE run_id = ? ORDER BY dt",
                (run_id,),
            ).fetchall()
            return tuple(
                EquityPoint(
                    dt=str(row["dt"]),
                    equity=float(row["equity"]),
                    cash=float(row["cash"]),
                    position_value=float(row["position_value"]),
                    drawdown=float(row["drawdown"]),
                )
                for row in rows
            )

        return await self._owner.run(read)


def _run_from_row(row: sqlite3.Row) -> Run:
    return Run(
        id=str(row["id"]),
        strategy_version_id=str(row["strategy_version_id"]),
        params_json=str(row["params_json"]),
        spec_hash=str(row["spec_hash"]),
        status=str(row["status"]),
        started_at=None if row["started_at"] is None else str(row["started_at"]),
        finished_at=None if row["finished_at"] is None else str(row["finished_at"]),
        error=None if row["error"] is None else str(row["error"]),
        metrics_json=None if row["metrics_json"] is None else str(row["metrics_json"]),
        stdout=None if row["stdout"] is None else str(row["stdout"]),
    )


__all__ = [
    "SCHEMA_VERSION",
    "BacktestStore",
    "Candle",
    "Coverage",
    "EquityPoint",
    "Run",
    "Strategy",
    "StrategyVersion",
    "Trade",
]
