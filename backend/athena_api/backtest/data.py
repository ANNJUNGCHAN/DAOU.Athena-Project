"""백테스트 캔들 데이터 층 — 계약 로드 · 페이지 파싱 · 백필 · 커버리지 · 계획 (§5).

**왜 `call_raw_tr`을 쓰지 않고 `client.post_with_headers`를 직접 부르나.**
`generated/runtime.py`의 `call_raw_tr`은 FastAPI `Request`/`Response`를 파라미터로
요구한다(연속조회 헤더를 그 위에서 읽고 쓴다). 백필은 §5.3에서 "백그라운드 잡"으로
명시됐다 — HTTP 요청 문맥 밖에서 돈다. `Request`/`Response`가 있을 자리가 없으므로
`call_raw_tr`은 애초에 호출 불가능하다. 그보다 낮은 층인 `KiwoomClient.post_with_headers`
(cont-yn/next-key를 직접 주고받는다)를 쓰는 어댑터 `kiwoom_fetch_page`를 이 파일에 얇게 둔다.

**왜 레이트 리밋을 여기서 다루지 않나.** `client.post_with_headers`가 내부에서
`RateLimiter.acquire`를 이미 거친다(§5.2, 전역 5 req/s · TR당 1 req/s). 백필 루프가
추가로 sleep을 넣으면 이중 제약이 된다 — 여기서는 페이지네이션 흐름만 관리한다.

**왜 숫자 파싱을 `canvas_transform.py`에서 가져오지 않나.** 그 모듈은 `screen_manifest`
등 화면 계층 의존을 끌고 온다. 백테스트 데이터 층은 화면과 무관한 배치/잡 코드라
가벼운 지역 구현(`_parse_ohlcv_number`)을 둔다 — 규칙 자체(부호 접두 버림)는 동일하다.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from math import ceil
from pathlib import Path
from typing import Any, Final

from athena_api.backtest.store import BacktestStore, Candle, Coverage
from athena_api.generated.registry import TR_REGISTRY
from athena_api.kiwoom.client import KiwoomClient, RequestOptions

# ── 계약 로드 (§5.1) ─────────────────────────────────────────────────────────

_CONTRACTS_PATH: Final = Path(__file__).resolve().parents[2] / "ref" / "aits-chart-contracts.json"
# 1차 범위: stock 대상 + 표준(series_scope=standard) 봉만. 분(ka10080)·틱·연봉은
# 계획서 §5.5에서 1차 비대상으로 못박았다.
_SUPPORTED_PERIODS: Final = ("day", "week", "month")


@dataclass(frozen=True, slots=True)
class ChartContract:
    """aits-chart-contracts.json 한 행 — TR id와 별칭 표만 옮겨 담는다(복제가 아니라 투영)."""

    tr_id: str
    period: str
    container_alias: str
    time_alias: str
    open_alias: str
    high_alias: str
    low_alias: str
    close_alias: str
    volume_alias: str


@lru_cache(maxsize=1)
def _stock_chart_contracts() -> dict[str, ChartContract]:
    raw = json.loads(_CONTRACTS_PATH.read_text(encoding="utf-8"))
    contracts: dict[str, ChartContract] = {}
    for entry in raw["contracts"]:
        if entry.get("target") != "stock" or entry.get("series_scope") != "standard":
            continue
        period = entry["period"]
        if period not in _SUPPORTED_PERIODS:
            continue
        contracts[period] = ChartContract(
            tr_id=entry["tr_id"],
            period=period,
            container_alias=entry["container_alias"],
            time_alias=entry["time_alias"],
            open_alias=entry["open_alias"],
            high_alias=entry["high_alias"],
            low_alias=entry["low_alias"],
            close_alias=entry["close_alias"],
            volume_alias=entry["volume_alias"],
        )
    return contracts


def contract_for(period: str) -> ChartContract:
    """period(day/week/month) → 계약. 1차 비대상 주기는 명시적으로 거부한다."""
    try:
        return _stock_chart_contracts()[period]
    except KeyError:
        raise ValueError(f"unsupported backtest period: {period}") from None


# ── 한 페이지 파싱 ────────────────────────────────────────────────────────────


def _parse_ohlcv_number(raw: Any) -> float | None:
    """키움 가격/거래량 문자열 → 수치. 부호 접두(+/-)는 등락 표기이지 값이 아니다
    (canvas_transform._parse_price와 같은 규칙 — 모듈 머리말 참고)."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip().lstrip("+-")
    try:
        return float(text)
    except ValueError:
        return None


def parse_page(raw: dict[str, Any], contract: ChartContract) -> list[Candle]:
    """원시 TR 응답 dict → 캔들 리스트.

    컨테이너 자체가 리스트가 아니면(계약이 안 맞는다는 뜻) 구조 오류로 본다.
    개별 행이 필수 필드(dt·OHLCV)를 못 채우면 그 행만 건너뛴다 — 화면 변환층
    (`canvas_transform.py`)과 같은 관용이다. 정렬은 강제하지 않는다 — 키움이
    최신순으로 주는지 과거순으로 주는지는 페이지마다의 관례일 뿐, 호출자(백필
    루프)가 dt 값으로 직접 판단한다.
    """
    items = raw.get(contract.container_alias, [])
    if not isinstance(items, list):
        raise ValueError(
            f"contract container is not a list: {contract.container_alias} (tr_id={contract.tr_id})"
        )
    candles: list[Candle] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        dt = item.get(contract.time_alias)
        if not isinstance(dt, str) or not dt.strip():
            continue
        values = (
            _parse_ohlcv_number(item.get(contract.open_alias)),
            _parse_ohlcv_number(item.get(contract.high_alias)),
            _parse_ohlcv_number(item.get(contract.low_alias)),
            _parse_ohlcv_number(item.get(contract.close_alias)),
            _parse_ohlcv_number(item.get(contract.volume_alias)),
        )
        if any(value is None for value in values):
            continue
        open_, high, low, close, volume = values
        candles.append(
            Candle(dt=dt.strip(), open=open_, high=high, low=low, close=close, volume=int(volume))
        )
    return candles


# ── 권리락 대조 (§5.4) ───────────────────────────────────────────────────────


class AdjustmentDetected(Exception):
    """증분 페치 중 겹침 최근 N봉의 종가 불일치 감지 — 권리락 이벤트로 추정(§5.4 규칙 2).

    호출자가 잡아서 전체 재수집을 결정한다. 이 예외를 던지는 시점까지 이번 백필
    호출은 아무 것도 upsert하지 않았다 — 조용히 재수집하지 않는다(규칙 3)는 것은
    "감지 사실이 예외/로그에 남고, 기존 캐시도 섣불리 덮어쓰지 않는다"는 뜻이다.
    """

    def __init__(
        self,
        stk_cd: str,
        period: str,
        adjusted: bool,
        mismatches: list[tuple[str, float, float]],
    ) -> None:
        self.stk_cd = stk_cd
        self.period = period
        self.adjusted = adjusted
        self.mismatches = mismatches
        super().__init__(
            f"adjustment detected: {stk_cd}/{period}/adjusted={adjusted}"
            f" at {len(mismatches)} overlapping dt(s)"
        )


def detect_adjustment(
    existing: Sequence[Candle], fetched: Sequence[Candle], overlap_n: int = 20
) -> list[tuple[str, float, float]]:
    """캐시의 최근 N봉과 새로 받은 페이지가 겹치는 dt의 종가를 대조한다.

    반환값이 비어 있으면 일치(=권리 이벤트 없음으로 간주). 하나라도 다르면
    `(dt, cached_close, fetched_close)` 튜플로 남긴다 — 어떤 날짜에서 얼마나
    벌어졌는지가 판단 근거로 남아야 한다(규칙 3).
    """
    if not existing or not fetched:
        return []
    recent_closes = {c.dt: c.close for c in existing[-overlap_n:]}
    mismatches: list[tuple[str, float, float]] = []
    for c in fetched:
        cached_close = recent_closes.get(c.dt)
        if cached_close is not None and cached_close != c.close:
            mismatches.append((c.dt, cached_close, c.close))
    return mismatches


# ── 백필 루프 ────────────────────────────────────────────────────────────────

# 실 배선용 fetch 함수 계약. 테스트는 이 시그니처를 흉내 내는 가짜를 주입하고,
# 실제 배선은 `kiwoom_fetch_page`가 KiwoomClient 위에 얇게 올린다.
FetchPage = Callable[
    [str, dict[str, Any], str, str | None],
    Awaitable[tuple[dict[str, Any], str, str | None]],
]

OnProgress = Callable[[int, int, str], None]


def _request_body(stk_cd: str, base_dt: str, adjusted: bool) -> dict[str, Any]:
    return {"stk_cd": stk_cd, "base_dt": base_dt, "upd_stkpc_tp": "1" if adjusted else "0"}


def kiwoom_fetch_page(client: KiwoomClient) -> FetchPage:
    """`KiwoomClient` → `FetchPage` 어댑터 — 실 배선용(모듈 머리말 참고).

    `call_raw_tr`이 아니라 `client.post_with_headers`를 직접 부른다. upstream_path는
    aits-chart-contracts.json이 아니라 `TR_REGISTRY`(코드젠 원본)에서 읽는다 — 계약
    파일은 별칭 표만 갖고 있고, 엔드포인트 경로의 SSoT는 코드젠 레지스트리다.
    """

    async def fetch(
        tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        upstream_path = TR_REGISTRY[tr_id].upstream_path
        envelope = await client.post_with_headers(
            tr_id, upstream_path, body, RequestOptions(cont_yn=cont_yn, next_key=next_key)
        )
        return envelope.body, envelope.cont_yn, envelope.next_key

    return fetch


async def backfill(
    *,
    store: BacktestStore,
    fetch_page: FetchPage,
    stk_cd: str,
    period: str,
    adjusted: bool,
    base_dt: str,
    from_dt: str,
    overlap_check_n: int = 20,
    on_progress: OnProgress | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    """`base_dt`에서 과거 방향으로 `from_dt`까지 캔들을 채운다(§5.3 store, §5.4 규칙).

    cont-yn/next-key로 연속조회하며(§5.1) 페이지마다 `store.upsert_candles` +
    `on_progress(page, rows, oldest_dt)`를 부른다. `oldest_dt`가 `from_dt`에 닿거나
    (도달) 서버가 더 줄 게 없으면(cont_yn != "Y" 또는 next_key 없음, 소진) 멈춘다.

    기존 캐시가 있으면(증분 페치) 첫 페이지에서 §5.4 규칙 2(겹침 최근 N봉 종가 대조)를
    수행한다 — 불일치 시 `AdjustmentDetected`를 던지고 아무 것도 upsert하지 않는다.
    호출자가 캐시를 지우고 처음부터 다시 부르는 식으로 전체 재수집을 결정한다.

    반환값: 이번 호출에서 실제로 데이터를 받은 페이지 수(0이면 새로 받은 게 없다 —
    커버리지도 건드리지 않는다).
    """
    contract = contract_for(period)
    existing = await store.candles(stk_cd, period, adjusted)
    body = _request_body(stk_cd, base_dt, adjusted)
    cont_yn = "N"
    next_key: str | None = None
    page = 0
    total_rows = 0
    oldest_dt = base_dt
    newest_dt = base_dt
    first_page = True

    while True:
        page += 1
        raw, cont_yn, next_key = await fetch_page(contract.tr_id, body, cont_yn, next_key)
        candles = parse_page(raw, contract)
        if not candles:
            page -= 1
            break

        if first_page and existing:
            mismatches = detect_adjustment(existing, candles, overlap_check_n)
            if mismatches:
                raise AdjustmentDetected(stk_cd, period, adjusted, mismatches)
        first_page = False

        await store.upsert_candles(stk_cd, period, adjusted, candles)
        total_rows += len(candles)
        page_dts = [c.dt for c in candles]
        oldest_dt = min(oldest_dt, min(page_dts))
        newest_dt = max(newest_dt, max(page_dts))
        if on_progress is not None:
            on_progress(page, len(candles), oldest_dt)

        if oldest_dt <= from_dt:
            break
        if cont_yn != "Y" or not next_key:
            break

    if total_rows == 0:
        return 0

    first_dt = oldest_dt if not existing else min(existing[0].dt, oldest_dt)
    last_dt = newest_dt if not existing else max(existing[-1].dt, newest_dt)
    await store.upsert_coverage(
        stk_cd, period, adjusted, first_dt=first_dt, last_dt=last_dt, fetched_at=now(), pages=page
    )
    return page


# ── 수집 계획 (§6.6 data/plan 화면용, §5.2 추정) ──────────────────────────────

# 페이지당 행 수 — 실측 전 가정(계획서 §5.2), P2 실측으로 갱신.
ASSUMED_ROWS_PER_PAGE: Final = 600

# 주기별 "봉 1개 = 달력 며칠"의 대략적 환산 — 공휴일 등은 반영하지 않은 추정용 비율이다.
_ROWS_PER_CALENDAR_DAY: Final = {"day": 5 / 7, "week": 1 / 7, "month": 1 / 30}


@dataclass(frozen=True, slots=True)
class BackfillPlan:
    stk_cd: str
    period: str
    adjusted: bool
    missing_days: int
    estimated_pages: int
    estimated_seconds: float


def _parse_yyyymmdd(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def _missing_calendar_days(from_dt: str, to_dt: str, coverage: Coverage | None) -> int:
    """`bt_coverage`는 단일 연속 구간(first_dt~last_dt)만 기억한다 — 그 구간 안의
    구멍은 추적하지 않는다. 그래서 부족분은 요청 구간에서 커버 구간을 뺀 앞/뒤
    두 조각으로만 계산한다."""
    start = _parse_yyyymmdd(from_dt)
    end = _parse_yyyymmdd(to_dt)
    if end < start:
        raise ValueError("to_dt는 from_dt보다 이르면 안 된다")
    if coverage is None:
        return (end - start).days + 1

    covered_first = _parse_yyyymmdd(coverage.first_dt)
    covered_last = _parse_yyyymmdd(coverage.last_dt)
    missing = 0
    if start < covered_first:
        before_end = min(end, covered_first - timedelta(days=1))
        if start <= before_end:
            missing += (before_end - start).days + 1
    if end > covered_last:
        after_start = max(start, covered_last + timedelta(days=1))
        if after_start <= end:
            missing += (end - after_start).days + 1
    return missing


def compute_plan(
    *,
    stk_cd: str,
    period: str,
    adjusted: bool,
    from_dt: str,
    to_dt: str,
    coverage: Coverage | None,
) -> BackfillPlan:
    """(stk_cd, period, adjusted, from, to)와 현재 커버리지 → 부족 구간의 추정치.

    레이트 리밋 자체는 강제하지 않는다(§5.2, client 층이 이미 강제) — 여기서는
    "TR당 1req/s가 상한이니 페이지 수만큼 초가 걸린다"는 낙관적 추정만 낸다.
    """
    if period not in _ROWS_PER_CALENDAR_DAY:
        raise ValueError(f"unsupported backtest period: {period}")

    missing_days = _missing_calendar_days(from_dt, to_dt, coverage)
    estimated_rows = ceil(missing_days * _ROWS_PER_CALENDAR_DAY[period])
    estimated_pages = ceil(estimated_rows / ASSUMED_ROWS_PER_PAGE) if estimated_rows > 0 else 0
    return BackfillPlan(
        stk_cd=stk_cd,
        period=period,
        adjusted=adjusted,
        missing_days=missing_days,
        estimated_pages=estimated_pages,
        estimated_seconds=float(estimated_pages),
    )


__all__ = [
    "ASSUMED_ROWS_PER_PAGE",
    "AdjustmentDetected",
    "BackfillPlan",
    "ChartContract",
    "FetchPage",
    "OnProgress",
    "backfill",
    "compute_plan",
    "contract_for",
    "detect_adjustment",
    "kiwoom_fetch_page",
    "parse_page",
]
