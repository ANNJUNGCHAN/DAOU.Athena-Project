"""키움을 브레인의 체결·잔고 프로토콜에 잇는 생산자 (WP-H, 2026-09-03).

`brain/backfill.py`의 `ExecutionSource`와 `brain/holdings.py`의 `AccountHoldingSource`를
키움 REST로 구현한다. 이 모듈이 `brain/` **밖**에 있는 이유는 방향이다 — 브레인은 시세
런타임 없이도 서야 하므로 프로토콜만 내놓고 키움을 모른다(holdings.py 모듈 주석).
결선은 lifespan이 한다.

**매수·매도 구분은 `sell_tp` 두 번 호출로 얻는다(2026-09-03 사용자 확정).**
`kt00007` 요청에는 매매구분 필드가 없고, 응답의 `trde_tp`는 코드값이 문서화되어 있지
않다(generated/models.py:6325 조사, 2026-08-27). 대신 요청 `sell_tp`(1:매도, 2:매수)는
전부 문서화된 필터라, 같은 날을 두 번 물어 **호출한 쪽의 뜻을 그대로** 붙인다 —
응답을 해석하지 않으므로 실측 없이 방향이 확정된다.

숫자 필드는 "좌측 0-padding 처리된 부호 포함 N자리 숫자" 문자열이다 — `int()`/`Decimal()`이
부호와 선행 0을 그대로 소화하므로 별도 파싱을 만들지 않는다. 빈값·결측은 0으로 읽되,
종목코드나 주문번호가 없는 행은 사실을 지어낼 수 없으므로 통째로 건너뛴다.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from athena_api.brain import AccountHolding, ExecutedTrade, TradeSide
from athena_api.kiwoom import KiwoomClient
from athena_api.kiwoom.client import RequestOptions

logger = logging.getLogger(__name__)

# kt00005/kt00007 둘 다 계좌 패밀리다(generated/registry.py).
_ACCOUNT_ENDPOINT = "/api/dostk/acnt"

# 키움 체결·잔고 시각은 한국 시간이다. 브레인 이력은 UTC-aware만 받는다(history.py).
_KST = timezone(timedelta(hours=9))

# 연속조회 안전 상한 — cont-yn이 영원히 Y인 고장난 응답에서 무한 루프를 막는다.
# 하루 체결·잔고가 200페이지를 넘는 계좌는 이 앱의 세계에 없다.
_MAX_PAGES = 200


def _int(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(text)
    except ValueError:
        return 0


def _decimal(value: Any) -> Decimal:
    text = str(value or "").strip()
    if not text:
        return Decimal(0)
    try:
        return Decimal(text)
    except InvalidOperation:
        return Decimal(0)


def _security_code(value: Any) -> str:
    """'A005930' → '005930'. 접두어는 A(주식)/J(ELW)/Q(ETN) 1자리다(응답 필드 설명)."""
    text = str(value or "").strip()
    if text and text[0].isalpha():
        return text[1:]
    return text


def _occurred_at(day: date, value: Any) -> datetime:
    """주문일자 + 'HH:mm:ss'(KST) → UTC. 시각이 없거나 깨졌으면 그 날 자정(KST)이다 —
    시각을 지어내는 것보다 '그 날'이라는 확실한 사실만 남기는 쪽이 정직하다."""
    text = str(value or "").strip()
    moment = time(0, 0)
    if len(text) == 8 and text[2] == ":" and text[5] == ":":
        try:
            moment = time(int(text[0:2]), int(text[3:5]), int(text[6:8]))
        except ValueError:
            moment = time(0, 0)
    return datetime.combine(day, moment, tzinfo=_KST).astimezone(UTC)


async def _pages(
    client: KiwoomClient, api_id: str, body: dict[str, Any]
) -> list[dict[str, Any]]:
    """연속조회(cont-yn/next-key)를 끝까지 따라가 페이지 본문을 전부 모은다."""
    pages: list[dict[str, Any]] = []
    options = RequestOptions()
    for _ in range(_MAX_PAGES):
        envelope = await client.post_with_headers(api_id, _ACCOUNT_ENDPOINT, body, options)
        pages.append(envelope.body)
        if envelope.cont_yn != "Y" or not envelope.next_key:
            return pages
        options = RequestOptions(cont_yn="Y", next_key=envelope.next_key)
    logger.warning("kiwoom %s pagination hit the page cap (%d)", api_id, _MAX_PAGES)
    return pages


class KiwoomExecutionSource:
    """`kt00007 계좌별주문체결내역상세요청`으로 하루치 체결을 읽는다."""

    # qry_tp 4:체결내역만 — 미체결·정정취소 행은 이력이 아니다. stk_bond_tp 1:주식 —
    # 브레인의 security 엔티티는 주식 종목코드다. dmst_stex_tp %:전체 거래소.
    _BASE_QUERY = {
        "qry_tp": "4",
        "stk_bond_tp": "1",
        "stk_cd": "",
        "fr_ord_no": "",
        "dmst_stex_tp": "%",
    }
    _SIDES = (("1", TradeSide.SELL), ("2", TradeSide.BUY))

    def __init__(self, clients: Mapping[str, KiwoomClient]) -> None:
        self._clients = dict(clients)

    async def fetch_executions(self, alias: str, order_date: date) -> tuple[ExecutedTrade, ...]:
        client = self._clients.get(alias)
        if client is None:
            # 백필은 우리가 준 alias만 돌므로 여기 오면 결선이 틀린 것이다 — 조용히
            # 빈 결과를 내면 "체결이 없다"로 굳는다.
            raise ValueError(f"알 수 없는 계좌: {alias}")
        trades: list[ExecutedTrade] = []
        for sell_tp, side in self._SIDES:
            body = dict(self._BASE_QUERY, ord_dt=order_date.strftime("%Y%m%d"), sell_tp=sell_tp)
            for page in await _pages(client, "kt00007", body):
                for item in page.get("acnt_ord_cntr_prps_dtl") or ():
                    if not isinstance(item, dict):
                        continue
                    quantity = _int(item.get("cntr_qty"))
                    if quantity <= 0:
                        # qry_tp=4여도 방어한다 — 체결수량 0은 체결이 아니다.
                        continue
                    code = _security_code(item.get("stk_cd"))
                    order_no = str(item.get("ord_no") or "").strip()
                    if not code or not order_no:
                        continue
                    trades.append(
                        ExecutedTrade(
                            alias=alias,
                            order_no=order_no,
                            security_id=code,
                            side=side,
                            quantity=quantity,
                            price=_decimal(item.get("cntr_uv")),
                            # 확인시간이 주문시간보다 체결에 가깝다 — 있으면 그것을 쓴다.
                            occurred_at=_occurred_at(
                                order_date, item.get("cnfm_tm") or item.get("ord_tm")
                            ),
                        )
                    )
        return tuple(trades)


class KiwoomHoldingSource:
    """`kt00005 체결잔고요청`으로 계좌 하나의 현재 잔고를 읽는다.

    수량 0 행도 그대로 낸다 — "다 팔았다"가 그래프에서 `owns`를 지우는 사실이다
    (history.py HoldingRecord 주석). 실패는 그대로 던진다: `HoldingSnapshotIngestor`가
    계좌 단위로 받아 부분 합산을 거부한다.
    """

    def __init__(self, clients: Mapping[str, KiwoomClient]) -> None:
        self._clients = dict(clients)

    async def fetch_holdings(self, alias: str) -> tuple[AccountHolding, ...]:
        client = self._clients.get(alias)
        if client is None:
            raise ValueError(f"알 수 없는 계좌: {alias}")
        rows: list[AccountHolding] = []
        for page in await _pages(client, "kt00005", {"dmst_stex_tp": "KRX"}):
            for item in page.get("stk_cntr_remn") or ():
                if not isinstance(item, dict):
                    continue
                code = _security_code(item.get("stk_cd"))
                if not code:
                    continue
                rows.append(
                    AccountHolding(
                        alias=alias,
                        security_id=code,
                        quantity=_int(item.get("cur_qty")),
                        average_price=_decimal(item.get("buy_uv")),
                    )
                )
        return tuple(rows)


__all__ = ["KiwoomExecutionSource", "KiwoomHoldingSource"]
