"""여러 계좌의 잔고를 종목 하나의 사실로 합친다.

2026-08-26. 이 모듈이 존재하는 이유는 **재현된 결함** 하나다.

투자자 노드는 고정 단일값이고(`store.INVESTOR_PROFILE_ENTITY_ID`) 엣지 동일성은
`(출발, 도착, 종류)`뿐이다(`ontology.relation_id`). 그래서 계좌 A의 `owns(005930)`과
계좌 B의 `owns(005930)`은 **같은 엣지 슬롯**이다. 계좌별로 따로 적재하면
`apply_extraction`의 소스 단위 원자 교체가 서로를 못 보고, 나중 계좌가 앞 계좌를
덮어쓴다:

    계좌 A 10주 + 계좌 B 5주  →  그래프가 말하는 수량: 5주

`source_id`에 계좌 alias를 넣는 것으로는 안 된다 — 그건 **출처**를 나누지 **동일성**을
나누지 않는다. 그래서 합산을 그래프 **밖**에서 끝낸다. 브레인은 "이 투자자가 005930을
15주 들고 있다"는 사실 하나를 받고, 계좌 분해는 `by_account`로 따라온다.

**부분 실패는 통째로 건너뛴다.** 계좌 하나가 조회에 실패했는데 나머지만 합산하면
"계좌 B가 안 잡혀서 수량이 줄었다"가 그래프에는 "팔았다"로 남는다. 결정적 티어라
대화가 정정할 수도 없다 — 이 모듈이 존재하게 만든 결함과 같은 종류다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol

from .history import HoldingRecord


@dataclass(frozen=True, slots=True)
class AccountHolding:
    """한 계좌가 보고한 한 종목."""

    alias: str
    security_id: str
    quantity: int
    average_price: Decimal


@dataclass(frozen=True, slots=True)
class MergedHolding:
    """전 계좌를 합친 한 종목. 이력 층에 이 모양으로 들어간다."""

    security_id: str
    quantity: int
    average_price: Decimal
    by_account: Mapping[str, int]


class PartialHoldingsError(RuntimeError):
    """계좌 일부만 조회됐다. 적재하지 않는다."""


def merge_account_holdings(
    per_account: Mapping[str, Sequence[AccountHolding] | None],
) -> tuple[MergedHolding, ...]:
    """계좌별 잔고를 종목별로 합친다.

    `per_account`의 값이 `None`이면 그 계좌는 조회에 실패한 것이다 — 하나라도 있으면
    `PartialHoldingsError`를 던지고 아무것도 돌려주지 않는다. 부분 합산을 적재하면
    실패한 계좌의 보유가 "매도"로 보인다.

    평단가는 **수량 가중평균**이다. 합계 수량이 0이면(전 계좌 매도) 평단가는 0으로 둔다 —
    0으로 나누지 않고, 없는 가격을 지어내지도 않는다.
    """
    missing = sorted(alias for alias, rows in per_account.items() if rows is None)
    if missing:
        raise PartialHoldingsError(
            f"잔고 조회에 실패한 계좌가 있어 이번 주기를 건너뛴다: {missing}"
        )

    quantities: dict[str, int] = {}
    cost_totals: dict[str, Decimal] = {}
    by_account: dict[str, dict[str, int]] = {}

    for alias in sorted(per_account):
        for row in per_account[alias] or ():
            if row.quantity < 0:
                raise ValueError(f"보유 수량이 음수다: {alias}/{row.security_id}")
            code = row.security_id
            quantities[code] = quantities.get(code, 0) + row.quantity
            cost_totals[code] = cost_totals.get(code, Decimal(0)) + (
                row.average_price * row.quantity
            )
            # 수량 0인 계좌도 기록한다 — "이 계좌는 안 들고 있다"도 사실이고,
            # 분해를 읽는 사람이 계좌가 빠진 것과 0인 것을 구분해야 한다.
            by_account.setdefault(code, {})[alias] = (
                by_account.get(code, {}).get(alias, 0) + row.quantity
            )

    merged: list[MergedHolding] = []
    for code in sorted(quantities):
        total = quantities[code]
        average = (cost_totals[code] / total) if total > 0 else Decimal(0)
        merged.append(
            MergedHolding(
                security_id=code,
                quantity=total,
                average_price=average,
                by_account=dict(sorted(by_account[code].items())),
            )
        )
    return tuple(merged)


class HoldingHistory(Protocol):
    async def upsert_holding(
        self, record: HoldingRecord, *, changed_at: datetime | None = ...
    ) -> Any: ...


class AccountHoldingSource(Protocol):
    """계좌 하나의 현재 잔고를 돌려준다.

    브레인이 키움 클라이언트를 직접 알지 않는 이유는 방향 때문이다 — 잔고 조회는
    시세 런타임에 딸린 것이고, 브레인은 시세 없이도 서야 한다. 결선은 `lifespan`이 한다.
    """

    async def fetch_holdings(self, alias: str) -> Sequence[AccountHolding]: ...


class HoldingSnapshotIngestor:
    """전 계좌를 조회해 합산한 뒤 이력에 적재한다.

    `IngestionCoordinator`가 잡을 돌리기 **직전**에 불린다. 값이 안 바뀌었으면
    `HistoryStore`가 지문으로 걸러내므로 시간당 돌아도 공짜다.
    """

    def __init__(
        self,
        history: HoldingHistory,
        source: AccountHoldingSource,
        *,
        aliases: Sequence[str],
        clock: Callable[[], datetime],
    ) -> None:
        self._history = history
        self._source = source
        self._aliases = tuple(aliases)
        self._clock = clock

    async def ingest(self) -> tuple[MergedHolding, ...]:
        """한 주기. 계좌 하나라도 실패하면 아무것도 적재하지 않는다."""
        per_account: dict[str, Sequence[AccountHolding] | None] = {}
        for alias in self._aliases:
            try:
                per_account[alias] = await self._source.fetch_holdings(alias)
            except Exception:
                # 어느 계좌가 왜 실패했는지는 호출자가 로그로 남긴다. 여기서는
                # "이 계좌를 못 읽었다"만 기록하고 합산기가 판단하게 둔다.
                per_account[alias] = None

        merged = merge_account_holdings(per_account)
        now = self._clock()
        for item in merged:
            await self._history.upsert_holding(
                HoldingRecord(
                    security_id=item.security_id,
                    quantity=item.quantity,
                    average_price=item.average_price,
                    by_account=dict(item.by_account),
                    occurred_at=now,
                ),
                changed_at=now,
            )
        return merged


__all__ = [
    "AccountHolding",
    "AccountHoldingSource",
    "HoldingSnapshotIngestor",
    "MergedHolding",
    "PartialHoldingsError",
    "merge_account_holdings",
]
