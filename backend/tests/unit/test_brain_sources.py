"""키움 체결·잔고 생산자(WP-H) — sell_tp 두 번 호출과 응답 해석.

CI는 키 없이 돈다 — KiwoomClient 자리를 합성 스텁으로 갈아끼운다. 여기서 재는 것은
HTTP가 아니라 **요청을 어떻게 조립하고 응답을 어떤 사실로 읽는가**다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from athena_api.brain import TradeSide
from athena_api.brain_sources import KiwoomExecutionSource, KiwoomHoldingSource
from athena_api.kiwoom.client import ResponseEnvelope

DAY = date(2026, 9, 3)


class StubClient:
    """호출을 기록하고 (api_id, sell_tp) 또는 api_id별로 준비된 페이지를 돌려준다."""

    def __init__(self, pages_by_key: dict[object, list[ResponseEnvelope]]) -> None:
        self._pages = {key: list(pages) for key, pages in pages_by_key.items()}
        self.calls: list[tuple[str, dict, str, str | None]] = []

    async def post_with_headers(self, api_id, endpoint, data=None, options=None):
        body = dict(data or {})
        cont_yn = options.cont_yn if options else "N"
        next_key = options.next_key if options else None
        self.calls.append((api_id, body, cont_yn, next_key))
        key = (api_id, body.get("sell_tp")) if "sell_tp" in body else api_id
        pages = self._pages.get(key) or []
        if not pages:
            return ResponseEnvelope(body={}, cont_yn="N", next_key=None)
        return pages.pop(0)


def page(body: dict, *, more: str | None = None) -> ResponseEnvelope:
    return ResponseEnvelope(body=body, cont_yn="Y" if more else "N", next_key=more)


def execution_row(**overrides) -> dict:
    row = {
        "ord_no": "0000001",
        "stk_cd": "A005930",
        "cntr_qty": "0000000010",
        "cntr_uv": "0000070000",
        "cnfm_tm": "10:30:00",
    }
    row.update(overrides)
    return row


async def test_executions_ask_the_same_day_twice_and_attach_the_callers_side() -> None:
    """sell_tp=1(매도)과 2(매수)를 각각 물어, 응답을 해석하지 않고 방향을 붙인다."""
    client = StubClient({
        ("kt00007", "1"): [page({"acnt_ord_cntr_prps_dtl": [execution_row(ord_no="0000001")]})],
        ("kt00007", "2"): [page({"acnt_ord_cntr_prps_dtl": [execution_row(ord_no="0000002")]})],
    })
    source = KiwoomExecutionSource({"acct-A": client})
    trades = await source.fetch_executions("acct-A", DAY)

    assert [(t.order_no, t.side) for t in trades] == [
        ("0000001", TradeSide.SELL),
        ("0000002", TradeSide.BUY),
    ]
    sell_tps = [body["sell_tp"] for _, body, _, _ in client.calls]
    assert sell_tps == ["1", "2"]
    for _, body, _, _ in client.calls:
        assert body["ord_dt"] == "20260903"
        assert body["qry_tp"] == "4", "체결내역만 — 미체결·정정취소는 이력이 아니다"
        assert body["stk_bond_tp"] == "1"
        assert body["dmst_stex_tp"] == "%"


async def test_executions_strip_the_code_prefix_and_convert_kst_to_utc() -> None:
    client = StubClient({
        ("kt00007", "1"): [page({"acnt_ord_cntr_prps_dtl": [execution_row()]})],
    })
    source = KiwoomExecutionSource({"acct-A": client})
    trades = await source.fetch_executions("acct-A", DAY)

    trade = trades[0]
    assert trade.security_id == "005930", "접두어 A는 종목코드가 아니다"
    assert trade.quantity == 10
    assert trade.price == Decimal(70000)
    # 10:30 KST = 01:30 UTC — history 층은 UTC-aware만 받는다.
    assert trade.occurred_at == datetime(2026, 9, 3, 1, 30, tzinfo=UTC)


async def test_executions_skip_rows_that_cannot_be_facts() -> None:
    """체결수량 0(방어)·종목코드 없음·주문번호 없음 — 지어내지 않고 건너뛴다."""
    client = StubClient({
        ("kt00007", "1"): [page({"acnt_ord_cntr_prps_dtl": [
            execution_row(cntr_qty="0000000000"),
            execution_row(stk_cd=""),
            execution_row(ord_no=""),
            execution_row(ord_no="0000009"),
        ]})],
    })
    source = KiwoomExecutionSource({"acct-A": client})
    trades = await source.fetch_executions("acct-A", DAY)
    assert [t.order_no for t in trades] == ["0000009"]


async def test_executions_follow_the_continuation_headers() -> None:
    client = StubClient({
        ("kt00007", "1"): [
            page({"acnt_ord_cntr_prps_dtl": [execution_row(ord_no="0000001")]}, more="K1"),
            page({"acnt_ord_cntr_prps_dtl": [execution_row(ord_no="0000002")]}),
        ],
    })
    source = KiwoomExecutionSource({"acct-A": client})
    trades = await source.fetch_executions("acct-A", DAY)

    assert [t.order_no for t in trades] == ["0000001", "0000002"]
    sell_one_calls = [c for c in client.calls if c[1].get("sell_tp") == "1"]
    assert [(c[2], c[3]) for c in sell_one_calls] == [("N", None), ("Y", "K1")]


async def test_executions_refuse_an_unknown_alias() -> None:
    """조용히 빈 결과를 내면 '체결이 없다'로 굳는다 — 결선 오류는 소리를 낸다."""
    source = KiwoomExecutionSource({"acct-A": StubClient({})})
    with pytest.raises(ValueError):
        await source.fetch_executions("acct-B", DAY)


async def test_a_broken_time_still_yields_a_utc_fact_on_the_right_day() -> None:
    client = StubClient({
        ("kt00007", "1"): [page({"acnt_ord_cntr_prps_dtl": [
            execution_row(cnfm_tm="", ord_tm="not-a-time"),
        ]})],
    })
    source = KiwoomExecutionSource({"acct-A": client})
    trades = await source.fetch_executions("acct-A", DAY)
    # 자정 KST = 전날 15:00 UTC. 시각을 지어내는 대신 '그 날'만 남긴다.
    assert trades[0].occurred_at == datetime(2026, 9, 2, 15, 0, tzinfo=UTC)


def holding_row(**overrides) -> dict:
    row = {"stk_cd": "A005930", "cur_qty": "000000000015", "buy_uv": "000000068000"}
    row.update(overrides)
    return row


async def test_holdings_map_quantity_and_average_price() -> None:
    client = StubClient({
        "kt00005": [page({"stk_cntr_remn": [holding_row()]})],
    })
    source = KiwoomHoldingSource({"acct-A": client})
    rows = await source.fetch_holdings("acct-A")

    assert len(rows) == 1
    assert rows[0].alias == "acct-A"
    assert rows[0].security_id == "005930"
    assert rows[0].quantity == 15
    assert rows[0].average_price == Decimal(68000)
    (api_id, body, _, _) = client.calls[0]
    assert api_id == "kt00005"
    assert body == {"dmst_stex_tp": "KRX"}


async def test_holdings_keep_zero_quantity_rows() -> None:
    """0주는 유효한 잔고 상태다 — '다 팔았다'가 그래프에서 owns를 지운다(history.py)."""
    client = StubClient({
        "kt00005": [page({"stk_cntr_remn": [holding_row(cur_qty="000000000000")]})],
    })
    source = KiwoomHoldingSource({"acct-A": client})
    rows = await source.fetch_holdings("acct-A")
    assert [r.quantity for r in rows] == [0]


async def test_holdings_follow_the_continuation_headers() -> None:
    client = StubClient({
        "kt00005": [
            page({"stk_cntr_remn": [holding_row()]}, more="K9"),
            page({"stk_cntr_remn": [holding_row(stk_cd="A000660")]}),
        ],
    })
    source = KiwoomHoldingSource({"acct-A": client})
    rows = await source.fetch_holdings("acct-A")
    assert [r.security_id for r in rows] == ["005930", "000660"]


async def test_holdings_refuse_an_unknown_alias() -> None:
    """던져야 HoldingSnapshotIngestor가 그 계좌를 실패로 치고 부분 합산을 거부한다."""
    source = KiwoomHoldingSource({"acct-A": StubClient({})})
    with pytest.raises(ValueError):
        await source.fetch_holdings("acct-B")
