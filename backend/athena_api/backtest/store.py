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

**왜 `visual`·`code_only`는 저장층에서도 활성화를 거부하나.** 시각 편집기가 만든 버전은
"사람이 patch를 검토하고 적용했다"는 뜻이지 "이 전략을 지금부터 돌린다"는 뜻이 아니다
(docs/research/backtest-visual-code-roundtrip-implementation-evaluation.md §사용자 적용 이후
서버 처리). API 층이 `active`를 강제로 끄지만, 그 한 겹이 버그로 뚫리면 사용자가 검토한 적
없는 전략이 실전 경로로 걸어 들어간다 — 저장층도 같은 요청을 fail-closed로 거부한다.

**왜 bundle을 같은 행에 같은 트랜잭션으로 쓰나.** graph/spec/생성 코드/source map/hash는
따로 있으면 아무 의미가 없다 — 셋 중 하나만 남은 행은 "이 코드가 이 그래프에서 나왔다"를
증명하지 못하는데도 증명하는 척한다. 부분 저장을 만들 바에는 아무것도 남기지 않는다.
hash를 **계산**하는 것은 이 층의 일이 아니다: 규칙의 주인은 `visual_schema`(graph_hash ·
spec_hash · source_hash) 하나이며, 저장층은 그 결과를 다른 열들처럼 그대로 왕복시킨다.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from athena_api.brain.db import SqliteOwner, atomic

# **왜 표를 더하면서 버전을 올리지 않나.** `SqliteOwner.install_schema()`는 저장된 버전과
# 넘긴 버전이 다르면 마이그레이션 없이 `RuntimeError`로 거부한다 — 이 저장소에는 마이그레이션
# 경로 자체가 없다. 버전을 2로 올리면 이미 캔들 캐시를 채워둔 사용자의 DB가 열리지 않고,
# 그 캐시를 다시 받으려면 §5.2 레이트 리밋을 처음부터 다시 태워야 한다. 새 표는 전부
# `CREATE TABLE IF NOT EXISTS`라 기존 파일에도 그대로 얹힌다 — 파괴적 변경이 아니다.
# 열 타입을 바꾸거나 표를 지우는 날이 오면 그때 마이그레이션과 함께 버전을 올린다.
# 열을 **더하는** 것도 같은 이유로 버전을 올리지 않는다 — `_migrate_version_bundle()`이
# 없는 열만 NULL 허용으로 붙이므로 이미 쓰던 파일이 그대로 열린다.
SCHEMA_VERSION: Final = 1

# 버전 생성이 받을 수 있는 origin. `visual`·`code_only`는 항상 비활성으로만 저장한다
# (파일 머리 "왜 저장층에서도 활성화를 거부하나").
_ORIGINS: Final = ("human", "form", "llm_draft", "visual", "code_only")
_INACTIVE_ONLY_ORIGINS: Final = ("visual", "code_only")

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
    active      INTEGER NOT NULL DEFAULT 0,
    -- 시각 버전 bundle. 기존 파일에는 `_migrate_version_bundle()`이 같은 열을 붙인다 —
    -- 여기 정의와 그쪽 목록(`_BUNDLE_COLUMNS`)은 반드시 같은 이름·타입이어야 한다.
    graph_json         TEXT,
    spec_yaml          TEXT,
    source_map_json    TEXT,
    hashes_json        TEXT,
    compiler_version   TEXT,
    apply_receipt_json TEXT
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
CREATE TABLE IF NOT EXISTS bt_deployment (
    id                  TEXT PRIMARY KEY,
    strategy_version_id TEXT NOT NULL REFERENCES bt_strategy_version(id) ON DELETE CASCADE,
    run_id              TEXT,
    stk_cd              TEXT NOT NULL,
    period              TEXT NOT NULL,
    adjusted            INTEGER NOT NULL,
    mode                TEXT NOT NULL,
    params_json         TEXT NOT NULL,
    limits_json         TEXT NOT NULL,
    status              TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    stopped_at          TEXT,
    armed               INTEGER
);
CREATE TABLE IF NOT EXISTS bt_signal (
    id             TEXT PRIMARY KEY,
    deployment_id  TEXT NOT NULL REFERENCES bt_deployment(id) ON DELETE CASCADE,
    dt             TEXT NOT NULL,
    side           TEXT,
    stage          TEXT NOT NULL,
    reason         TEXT NOT NULL,
    basis          TEXT NOT NULL,
    blocked_reason TEXT,
    fill_price     REAL,
    created_at     TEXT NOT NULL,
    order_no       TEXT,
    qty            INTEGER
);
CREATE INDEX IF NOT EXISTS bt_signal_by_deployment
    ON bt_signal(deployment_id, dt DESC);
"""


def _ts(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


# `bt_strategy_version`에 나중에 붙은 열들. 위 `_SCHEMA`의 CREATE TABLE과 같은 이름·타입을
# 반복해 적는 이유는 SQLite가 `ADD COLUMN IF NOT EXISTS`를 모르기 때문이다 — 새 파일은
# CREATE로, 이미 있는 파일은 ALTER로 같은 모양이 된다.
_BUNDLE_COLUMNS: Final = (
    ("graph_json", "TEXT"),
    ("spec_yaml", "TEXT"),
    ("source_map_json", "TEXT"),
    ("hashes_json", "TEXT"),
    ("compiler_version", "TEXT"),
    ("apply_receipt_json", "TEXT"),
)


# 자동 매매가 붙으며 나중에 생긴 열들. `armed`를 NULL 허용으로 두는 이유는 **옛 배포가
# 조용히 무장되는 일을 만들지 않기 위해서**다 — NULL은 읽을 때 False가 되고, 무장은
# 사람이 토글을 눌러 1을 쓸 때만 참이 된다.
_DEPLOYMENT_COLUMNS: Final = (("armed", "INTEGER"),)
# 자동 주문이 남기는 흔적. 주문번호가 없으면 "주문했다"고 말할 근거가 없다.
_SIGNAL_COLUMNS: Final = (("order_no", "TEXT"), ("qty", "INTEGER"))


def _add_missing_columns(
    connection: sqlite3.Connection, table: str, columns: tuple[tuple[str, str], ...]
) -> None:
    have = {str(row["name"]) for row in connection.execute(f"PRAGMA table_info({table})")}
    for name, sql_type in columns:
        if name not in have:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}")


def _migrate_version_bundle(connection: sqlite3.Connection) -> None:
    """이미 쓰던 DB에 bundle 열만 덧붙인다 — 몇 번을 불러도 같은 결과다.

    `ALTER TABLE ... ADD COLUMN`은 NULL 허용 열이라 기존 행을 건드리지 않는다. 표를 새로
    만들어 옮기는 마이그레이션이 아니므로 캔들 캐시(§5.2 레이트 리밋)도 그대로 남는다.
    """
    have = {
        str(row["name"]) for row in connection.execute("PRAGMA table_info(bt_strategy_version)")
    }
    for name, sql_type in _BUNDLE_COLUMNS:
        if name not in have:
            connection.execute(f"ALTER TABLE bt_strategy_version ADD COLUMN {name} {sql_type}")


def _active_version_id(connection: sqlite3.Connection, strategy_id: str) -> str | None:
    row = connection.execute(
        "SELECT id FROM bt_strategy_version WHERE strategy_id = ? AND active = 1",
        (strategy_id,),
    ).fetchone()
    return None if row is None else str(row["id"])


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
class VersionBundle:
    """시각 버전 한 개가 같이 저장돼야 하는 산출물 묶음.

    `DeploymentRow.params_json`과 같은 태도로 전부 문자열이다 — 저장층은 graph도 source
    map도 해석하지 않고 그대로 왕복시킨다. 무엇이 유효한 그래프인지는 `visual_schema`가
    알고, 저장층은 "셋이 한 행에 같이 들어갔는가"만 책임진다.
    """

    graph_json: str
    spec_yaml: str
    source_map_json: str
    hashes_json: str
    compiler_version: str
    apply_receipt_json: str | None = None


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
    # bundle 없이 저장된 기존 버전(human/form/llm_draft)은 전부 None이다.
    bundle: VersionBundle | None = None


_VERSION_SELECT: Final = (
    "SELECT id, strategy_id, version, source, note, origin, created_at, active,"
    " graph_json, spec_yaml, source_map_json, hashes_json, compiler_version, apply_receipt_json"
    " FROM bt_strategy_version"
)


def _version_of(row: sqlite3.Row) -> StrategyVersion:
    """한 행을 버전으로 옮긴다. bundle 열이 하나라도 비면 bundle 전체를 None으로 본다 —
    반쪽 bundle을 그럴듯한 객체로 돌려주면 호출자가 없는 그래프를 있다고 믿는다."""
    columns = (
        row["graph_json"],
        row["spec_yaml"],
        row["source_map_json"],
        row["hashes_json"],
        row["compiler_version"],
    )
    bundle = (
        None
        if any(value is None for value in columns)
        else VersionBundle(
            graph_json=str(row["graph_json"]),
            spec_yaml=str(row["spec_yaml"]),
            source_map_json=str(row["source_map_json"]),
            hashes_json=str(row["hashes_json"]),
            compiler_version=str(row["compiler_version"]),
            apply_receipt_json=(
                None if row["apply_receipt_json"] is None else str(row["apply_receipt_json"])
            ),
        )
    )
    return StrategyVersion(
        id=str(row["id"]),
        strategy_id=str(row["strategy_id"]),
        version=int(row["version"]),
        source=str(row["source"]),
        note=None if row["note"] is None else str(row["note"]),
        origin=str(row["origin"]),
        created_at=str(row["created_at"]),
        active=bool(row["active"]),
        bundle=bundle,
    )


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
class DeploymentRow:
    """배포 한 건의 저장 모양. `mode`/`limits_json`은 `deploy.py`가 해석한다 —
    저장층은 값을 해석하지 않고 그대로 왕복시킨다(다른 표들과 같은 태도)."""

    id: str
    strategy_version_id: str
    run_id: str | None
    stk_cd: str
    period: str
    adjusted: bool
    mode: str
    params_json: str
    limits_json: str
    status: str
    created_at: str
    stopped_at: str | None
    armed: bool


@dataclass(frozen=True, slots=True)
class SignalRow:
    """배포가 낸 판정 한 건. 신호가 안 난 날은 저장하지 않는다 — 조용한 날을
    행으로 남기면 이력이 조용한 날로 가득 차 사람이 읽을 수 없다."""

    id: str
    deployment_id: str
    dt: str
    side: str | None
    stage: str
    reason: str
    basis: str
    blocked_reason: str | None
    fill_price: float | None
    created_at: str
    order_no: str | None
    qty: int | None


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

        def migrate() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                _migrate_version_bundle(connection)
                _add_missing_columns(connection, "bt_deployment", _DEPLOYMENT_COLUMNS)
                _add_missing_columns(connection, "bt_signal", _SIGNAL_COLUMNS)

        await self._owner.run(migrate)

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
        bundle: VersionBundle | None = None,
    ) -> str:
        """새 버전을 추가한다. `active=True`면 켜기 전에 기존 활성 버전부터 끈다.

        `origin=human`이 즉시 활성화되는 것(§7.3)과 `origin=llm_draft`가 비활성으로
        남는 것 둘 다 이 하나의 파라미터로 표현한다 — 호출자(API 층)가 origin에 맞는
        `active` 값을 골라 넘긴다. 이 메서드 자체는 origin과 active를 연동시키지
        않는다 — 그 정책은 저장층이 아니라 호출자의 것이다. **예외는 `visual`·`code_only`
        둘뿐이다**(파일 머리): 이 두 origin에 `active=True`를 주면 저장하지 않고 거부한다.

        `bundle`은 graph/spec/source map/hash를 소스와 **같은 INSERT**로 넣는다 —
        두 번 나눠 쓰면 그 사이에 죽었을 때 "그래프 없는 시각 버전"이 남는다.
        """
        if origin not in _ORIGINS:
            raise ValueError(f"origin must be one of {_ORIGINS}")
        if active and origin in _INACTIVE_ONLY_ORIGINS:
            raise ValueError(f"origin '{origin}' must be saved inactive")

        def write() -> str:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                before = _active_version_id(connection, strategy_id)
                if active:
                    connection.execute(
                        "UPDATE bt_strategy_version SET active = 0"
                        " WHERE strategy_id = ? AND active = 1",
                        (strategy_id,),
                    )
                connection.execute(
                    "INSERT INTO bt_strategy_version"
                    "(id, strategy_id, version, source, note, origin, created_at, active,"
                    " graph_json, spec_yaml, source_map_json, hashes_json, compiler_version,"
                    " apply_receipt_json)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        version_id,
                        strategy_id,
                        version,
                        source,
                        note,
                        origin,
                        _ts(created_at),
                        int(active),
                        None if bundle is None else bundle.graph_json,
                        None if bundle is None else bundle.spec_yaml,
                        None if bundle is None else bundle.source_map_json,
                        None if bundle is None else bundle.hashes_json,
                        None if bundle is None else bundle.compiler_version,
                        None if bundle is None else bundle.apply_receipt_json,
                    ),
                )
                # 쓴 뒤 다시 읽어 활성 버전이 의도대로 움직였는지 확인한다 — 비활성 저장이
                # 활성 버전을 건드렸다면 그건 이 트랜잭션을 통째로 되돌릴 사고다(§8 receipt).
                after = _active_version_id(connection, strategy_id)
                expected = version_id if active else before
                if after != expected:
                    raise RuntimeError("active version changed unexpectedly during add_version")
            return version_id

        return await self._owner.run(write)

    async def active_version_id(self, strategy_id: str) -> str | None:
        """전략의 현재 활성 버전 id. 저장 전후를 비교해 "활성은 그대로다"를 증명하는 데 쓴다."""

        def read() -> str | None:
            return _active_version_id(self._require(), strategy_id)

        return await self._owner.run(read)

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
                f"{_VERSION_SELECT} WHERE strategy_id = ? ORDER BY version",
                (strategy_id,),
            ).fetchall()
            return tuple(_version_of(row) for row in rows)

        return await self._owner.run(read)

    async def version(self, version_id: str) -> StrategyVersion | None:
        """버전 하나를 id로 찾는다. 배포(`bt_deployment.strategy_version_id`)와 실행
        (`bt_run.strategy_version_id`)은 전략이 아니라 버전을 가리키므로, 전략을 거치지 않고
        바로 여는 길이 필요하다 — `versions(strategy_id)`만으로는 전략 id를 먼저 알아야 한다."""

        def read() -> StrategyVersion | None:
            row = self._require().execute(
                f"{_VERSION_SELECT} WHERE id = ?",
                (version_id,),
            ).fetchone()
            return None if row is None else _version_of(row)

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

    # ── 배포 · 실전 신호 ─────────────────────────────────────────────────────

    async def create_deployment(
        self,
        deployment_id: str,
        *,
        strategy_version_id: str,
        run_id: str | None,
        stk_cd: str,
        period: str,
        adjusted: bool,
        mode: str,
        params_json: str,
        limits_json: str,
        created_at: datetime,
    ) -> str:
        def write() -> str:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "INSERT INTO bt_deployment(id, strategy_version_id, run_id, stk_cd, period,"
                    " adjusted, mode, params_json, limits_json, status, created_at, stopped_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?,'active',?,NULL)",
                    (
                        deployment_id, strategy_version_id, run_id, stk_cd, period,
                        int(adjusted), mode, params_json, limits_json, _ts(created_at),
                    ),
                )
            return deployment_id

        return await self._owner.run(write)

    async def deployment(self, deployment_id: str) -> DeploymentRow | None:
        def read() -> DeploymentRow | None:
            row = self._require().execute(
                "SELECT * FROM bt_deployment WHERE id = ?", (deployment_id,)
            ).fetchone()
            return None if row is None else _deployment_from_row(row)

        return await self._owner.run(read)

    async def deployments(self) -> tuple[DeploymentRow, ...]:
        def read() -> tuple[DeploymentRow, ...]:
            return tuple(
                _deployment_from_row(row)
                for row in self._require().execute(
                    "SELECT * FROM bt_deployment ORDER BY created_at DESC"
                ).fetchall()
            )

        return await self._owner.run(read)

    async def stop_deployment(self, deployment_id: str, *, stopped_at: datetime) -> None:
        """이미 멈춘 배포를 다시 멈춰도 조용히 성공한다 — 중지는 멱등해야 한다.
        (이미 나간 주문을 되돌리지는 않는다: 그건 주문 게이트의 일이다.)"""

        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "UPDATE bt_deployment SET status='stopped', stopped_at=?"
                    " WHERE id = ? AND status='active'",
                    (_ts(stopped_at), deployment_id),
                )

        await self._owner.run(write)

    async def arm_deployment(self, deployment_id: str, *, armed: bool) -> bool:
        """자동 주문 무장 스위치. **멈춘 배포는 무장되지 않는다** — 중지가 먼저다.

        돌려주는 값은 이 호출 뒤 실제로 무장 상태인지다(멈춘 배포에 켜기를 걸면 False).
        """

        def write() -> bool:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "UPDATE bt_deployment SET armed = ? WHERE id = ? AND status = 'active'",
                    (1 if armed else 0, deployment_id),
                )
                row = connection.execute(
                    "SELECT armed, status FROM bt_deployment WHERE id = ?", (deployment_id,)
                ).fetchone()
            return bool(row is not None and row["status"] == "active" and row["armed"])

        return await self._owner.run(write)

    async def add_signal(
        self,
        signal_id: str,
        *,
        deployment_id: str,
        dt: str,
        side: str | None,
        stage: str,
        reason: str,
        basis: str,
        blocked_reason: str | None,
        created_at: datetime,
        fill_price: float | None = None,
        order_no: str | None = None,
        qty: int | None = None,
    ) -> str:
        def write() -> str:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "INSERT INTO bt_signal(id, deployment_id, dt, side, stage, reason, basis,"
                    " blocked_reason, fill_price, created_at, order_no, qty)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        signal_id, deployment_id, dt, side, stage, reason, basis,
                        blocked_reason, fill_price, _ts(created_at), order_no, qty,
                    ),
                )
            return signal_id

        return await self._owner.run(write)

    async def signals(self, deployment_id: str, *, limit: int = 100) -> tuple[SignalRow, ...]:
        def read() -> tuple[SignalRow, ...]:
            return tuple(
                _signal_from_row(row)
                for row in self._require().execute(
                    "SELECT * FROM bt_signal WHERE deployment_id = ?"
                    " ORDER BY dt DESC, created_at DESC LIMIT ?",
                    (deployment_id, limit),
                ).fetchall()
            )

        return await self._owner.run(read)

    async def update_signal_stage(
        self,
        signal_id: str,
        stage: str,
        *,
        fill_price: float | None = None,
        order_no: str | None = None,
        qty: int | None = None,
    ) -> None:
        """승인·주문·체결로 단계를 올린다. 되돌리지는 않는다 — 이력은 앞으로만 간다.

        주문번호·수량은 COALESCE로 덮어쓰지 않는다 — 한 번 받은 주문번호가 뒤따르는
        체결 갱신에 지워지면 "무엇이 나갔는지"를 되짚을 수 없다.
        """

        def write() -> None:
            connection = self._require()
            with atomic(connection, _BACKTEST_WRITE):
                connection.execute(
                    "UPDATE bt_signal SET stage = ?,"
                    " fill_price = COALESCE(?, fill_price),"
                    " order_no = COALESCE(?, order_no),"
                    " qty = COALESCE(?, qty) WHERE id = ?",
                    (stage, fill_price, order_no, qty, signal_id),
                )

        await self._owner.run(write)


def _deployment_from_row(row: sqlite3.Row) -> DeploymentRow:
    return DeploymentRow(
        id=str(row["id"]),
        strategy_version_id=str(row["strategy_version_id"]),
        run_id=None if row["run_id"] is None else str(row["run_id"]),
        stk_cd=str(row["stk_cd"]),
        period=str(row["period"]),
        adjusted=bool(row["adjusted"]),
        mode=str(row["mode"]),
        params_json=str(row["params_json"]),
        limits_json=str(row["limits_json"]),
        status=str(row["status"]),
        created_at=str(row["created_at"]),
        stopped_at=None if row["stopped_at"] is None else str(row["stopped_at"]),
        # NULL(옛 배포)은 무장 해제다 — 없는 값을 "켜짐"으로 읽으면 사람이 누른 적 없는
        # 배포가 주문을 내게 된다.
        armed=bool(row["armed"]) if "armed" in row.keys() else False,
    )


def _signal_from_row(row: sqlite3.Row) -> SignalRow:
    return SignalRow(
        id=str(row["id"]),
        deployment_id=str(row["deployment_id"]),
        dt=str(row["dt"]),
        side=None if row["side"] is None else str(row["side"]),
        stage=str(row["stage"]),
        reason=str(row["reason"]),
        basis=str(row["basis"]),
        blocked_reason=None if row["blocked_reason"] is None else str(row["blocked_reason"]),
        fill_price=None if row["fill_price"] is None else float(row["fill_price"]),
        created_at=str(row["created_at"]),
        order_no=(
            None
            if "order_no" not in row.keys() or row["order_no"] is None
            else str(row["order_no"])
        ),
        qty=None if "qty" not in row.keys() or row["qty"] is None else int(row["qty"]),
    )


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
    "DeploymentRow",
    "EquityPoint",
    "Run",
    "SignalRow",
    "Strategy",
    "StrategyVersion",
    "Trade",
]
