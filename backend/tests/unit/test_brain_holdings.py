"""계좌 간 잔고 합산 — 재현된 결함을 닫는다.

2026-08-26. 이 스위트가 존재하는 이유는 계획 검토 중 재현된 결함 하나다.

투자자 노드가 고정 단일값이고 엣지 동일성이 `(출발, 도착, 종류)`뿐이라, 계좌 A의
`owns(005930)`과 계좌 B의 `owns(005930)`은 **같은 엣지 슬롯**이다. 계좌별로 따로
적재하면 나중 계좌가 앞 계좌를 덮어썼다:

    계좌 A 10주 + 계좌 B 5주  →  그래프가 말하는 수량: 5주

`source_id`에 alias를 넣는 것으로는 못 고친다 — **출처**를 나누지 **동일성**을 나누지
않기 때문이다. 그래서 합산을 그래프 밖에서 끝낸다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from athena_api.brain import (
    INVESTOR_PROFILE_ENTITY_ID,
    AccountHolding,
    DeterministicHoldingProjector,
    GraphStore,
    HistoryStore,
    HoldingRecord,
    HoldingSnapshotIngestor,
    PartialHoldingsError,
    SqliteOwner,
    merge_account_holdings,
)

NOW = datetime(2026, 8, 26, 3, 0, tzinfo=UTC)


def holding(alias: str, code: str, quantity: int, price: str) -> AccountHolding:
    return AccountHolding(
        alias=alias, security_id=code, quantity=quantity, average_price=Decimal(price)
    )


# ── 합산 그 자체 ────────────────────────────────────────────────────────────


def test_two_accounts_holding_the_same_security_sum_up() -> None:
    """이것이 재현된 결함을 닫는 기준이다. 합산 전에는 5주라고 답했다."""
    merged = merge_account_holdings(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": [holding("acct-B", "005930", 5, "76000")],
        }
    )
    assert len(merged) == 1
    assert merged[0].security_id == "005930"
    assert merged[0].quantity == 15
    assert merged[0].by_account == {"acct-A": 10, "acct-B": 5}


def test_average_price_is_quantity_weighted() -> None:
    """단순 평균이면 73,000이 나온다 — 수량이 다르므로 틀린 값이다."""
    merged = merge_account_holdings(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": [holding("acct-B", "005930", 5, "76000")],
        }
    )
    # (10×70,000 + 5×76,000) / 15 = 72,000
    assert merged[0].average_price == Decimal("72000")


def test_zero_total_quantity_does_not_divide_by_zero() -> None:
    """전 계좌가 다 팔았다. 평단가를 지어내지 않고 0으로 둔다."""
    merged = merge_account_holdings(
        {
            "acct-A": [holding("acct-A", "005930", 0, "70000")],
            "acct-B": [holding("acct-B", "005930", 0, "76000")],
        }
    )
    assert merged[0].quantity == 0
    assert merged[0].average_price == Decimal(0)


def test_an_account_holding_zero_is_still_recorded_in_the_breakdown() -> None:
    """"이 계좌는 안 들고 있다"도 사실이다. 분해에서 빠지면 계좌가 조회 안 된 것과
    구분할 수 없다."""
    merged = merge_account_holdings(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": [holding("acct-B", "005930", 0, "0")],
        }
    )
    assert merged[0].by_account == {"acct-A": 10, "acct-B": 0}


def test_securities_held_in_only_one_account_pass_through() -> None:
    merged = merge_account_holdings(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": [holding("acct-B", "000660", 3, "180000")],
        }
    )
    assert [m.security_id for m in merged] == ["000660", "005930"], "종목코드 오름차순"
    assert {m.security_id: m.quantity for m in merged} == {"005930": 10, "000660": 3}


def test_the_result_order_is_deterministic() -> None:
    """순서가 흔들리면 지문이 흔들리고, 안 바뀐 잔고가 바뀐 것처럼 재적재된다."""
    payload = {
        "z-acct": [holding("z-acct", "000660", 3, "180000")],
        "a-acct": [holding("a-acct", "005930", 10, "70000")],
    }
    first = merge_account_holdings(payload)
    for _ in range(3):
        assert merge_account_holdings(payload) == first


def test_an_empty_account_set_is_not_an_error() -> None:
    assert merge_account_holdings({}) == ()
    assert merge_account_holdings({"acct-A": []}) == ()


# ── 부분 실패 ───────────────────────────────────────────────────────────────


def test_a_failed_account_skips_the_whole_cycle() -> None:
    """일부만 합산해 적재하면 실패한 계좌의 보유가 "매도"로 보인다.

    결정적 티어라 대화가 정정할 수 없다 — 이 모듈이 존재하게 만든 결함과 같은 종류다.
    """
    with pytest.raises(PartialHoldingsError, match="acct-B"):
        merge_account_holdings(
            {
                "acct-A": [holding("acct-A", "005930", 10, "70000")],
                "acct-B": None,
            }
        )


def test_a_negative_quantity_is_refused() -> None:
    with pytest.raises(ValueError, match="음수"):
        merge_account_holdings({"acct-A": [holding("acct-A", "005930", -1, "70000")]})


# ── 그래프까지 ──────────────────────────────────────────────────────────────


@pytest.fixture
async def stores(tmp_path: Path):
    owner = SqliteOwner(tmp_path / "brain.sqlite3")
    await owner.open()
    history, graph = HistoryStore(owner), GraphStore(owner)
    await history.open()
    await graph.open()
    try:
        yield history, graph
    finally:
        await owner.close()


async def project_merged(history: HistoryStore, graph: GraphStore, merged) -> None:
    """합산 결과를 이력에 넣고 그래프까지 투영한다."""
    for item in merged:
        await history.upsert_holding(
            HoldingRecord(
                security_id=item.security_id,
                quantity=item.quantity,
                average_price=item.average_price,
                by_account=dict(item.by_account),
                occurred_at=NOW,
            ),
            changed_at=NOW,
        )
    for change in await history.holding_changes(0, limit=100):
        await graph.upsert_source(change.record)
        await DeterministicHoldingProjector(graph, clock=lambda: NOW).project_source(
            change.record
        )


async def test_the_graph_says_fifteen_not_five(stores) -> None:
    """끝에서 끝까지. **이 단언이 재현된 결함의 정확한 반대다.**"""
    history, graph = stores
    merged = merge_account_holdings(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": [holding("acct-B", "005930", 5, "76000")],
        }
    )
    await project_merged(history, graph, merged)

    edges = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert len(edges) == 1, "종목 하나이므로 엣지도 하나"

    relations = await graph.relations()
    owns = [r for r in relations if r.kind == "owns"]
    assert len(owns) == 1
    attributes = await _attributes_of(graph, owns[0].id)
    assert attributes["quantity"] == 15, "합산 전에는 여기서 5가 나왔다"
    assert attributes["by_account"] == {"acct-A": 10, "acct-B": 5}
    assert attributes["average_price"] == "72000"


async def test_selling_everything_in_every_account_removes_the_edge(stores) -> None:
    history, graph = stores
    await project_merged(
        history,
        graph,
        merge_account_holdings(
            {"acct-A": [holding("acct-A", "005930", 10, "70000")]}
        ),
    )
    assert len(await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)) == 1

    await project_merged(
        history,
        graph,
        merge_account_holdings({"acct-A": [holding("acct-A", "005930", 0, "0")]}),
    )
    assert await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1) == ()


async def test_a_single_account_leaves_no_breakdown_in_the_fingerprint(stores) -> None:
    """계좌가 하나면 `by_account`를 안 넣는다 — 넣으면 계좌를 늘리기 전후로 같은
    잔고가 다른 지문을 갖게 된다."""
    history, _graph = stores
    result = await history.upsert_holding(
        HoldingRecord(
            security_id="005930", quantity=10, average_price=Decimal("70000"),
            occurred_at=NOW,
        ),
        changed_at=NOW,
    )
    changes = await history.holding_changes(0, limit=10)
    assert "by_account" not in changes[0].record.attributes["holding"]
    assert result.changed is True


# ── 적재기 (계좌 조회 → 합산 → 이력) ──────────────────────────────────────


class FakeAccountSource:
    def __init__(self, per_alias: dict[str, list[AccountHolding] | Exception]) -> None:
        self._per_alias = per_alias
        self.calls: list[str] = []

    async def fetch_holdings(self, alias: str):
        self.calls.append(alias)
        result = self._per_alias[alias]
        if isinstance(result, Exception):
            raise result
        return result


async def test_the_ingestor_sums_across_configured_accounts(stores) -> None:
    history, graph = stores
    source = FakeAccountSource(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": [holding("acct-B", "005930", 5, "76000")],
        }
    )
    ingestor = HoldingSnapshotIngestor(
        history, source, aliases=("acct-A", "acct-B"), clock=lambda: NOW
    )
    merged = await ingestor.ingest()

    assert source.calls == ["acct-A", "acct-B"], "설정된 계좌를 모두 조회한다"
    assert [(m.security_id, m.quantity) for m in merged] == [("005930", 15)]

    changes = await history.holding_changes(0, limit=10)
    assert len(changes) == 1, "종목당 소스 하나"
    assert changes[0].record.attributes["holding"]["quantity"] == 15


async def test_the_ingestor_writes_nothing_when_an_account_fails(stores) -> None:
    """이 계층이 존재하는 이유다. 부분 합산은 "팔았다"로 오독된다."""
    history, _graph = stores
    source = FakeAccountSource(
        {
            "acct-A": [holding("acct-A", "005930", 10, "70000")],
            "acct-B": RuntimeError("키움 응답 없음"),
        }
    )
    ingestor = HoldingSnapshotIngestor(
        history, source, aliases=("acct-A", "acct-B"), clock=lambda: NOW
    )

    with pytest.raises(PartialHoldingsError, match="acct-B"):
        await ingestor.ingest()

    assert await history.holding_changes(0, limit=10) == (), "아무것도 적재되지 않는다"


async def test_an_unchanged_snapshot_is_free(stores) -> None:
    """지문이 같으면 `changed=False`라 어댑터가 안 집는다 — 시간당 돌아도 공짜다."""
    history, _graph = stores
    source = FakeAccountSource({"acct-A": [holding("acct-A", "005930", 10, "70000")]})
    ingestor = HoldingSnapshotIngestor(
        history, source, aliases=("acct-A",), clock=lambda: NOW
    )
    await ingestor.ingest()
    first = len(await history.holding_changes(0, limit=50))
    await ingestor.ingest()
    assert len(await history.holding_changes(0, limit=50)) == first


async def _attributes_of(graph: GraphStore, relation_id: str) -> dict:
    import json

    def read():
        row = graph.owner.require().execute(
            "SELECT attributes_json FROM relations WHERE id = ?", (relation_id,)
        ).fetchone()
        return json.loads(str(row["attributes_json"]))

    return await graph.owner.run(read)
