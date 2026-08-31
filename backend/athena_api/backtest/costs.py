"""거래 비용 — 수수료(양방향)·거래세(매도만)·슬리피지(불리한 방향), §6.4/§10.3.

**왜 `costs=None`을 조용히 0으로 채우지 않나.** `schema.py`의 `CostsSpec`은 Optional이다 —
세율은 시점에 따라 바뀌고 이 코드가 정답을 안다고 주장할 근거가 없다(§10.3). 그래서
`resolve_costs()`는 0 비용으로 계산은 하되, "사용자가 아직 비용을 안 정했다"는 사실을
플래그로 남긴다. 엔진이 그 플래그를 숨기면 사용자는 실제로는 계산되지 않은 수수료를
반영된 것으로 오해한다.

**왜 체결가·수수료·세금을 한 함수로 묶지 않나.** 매수 시 수량(all-in 사이징)이
체결가에 의존하므로 엔진이 먼저 체결가를 구하고 그 체결가로 수량을 정한 뒤에야
수수료를 계산할 수 있다 — 체결가와 금액 기반 비용(수수료·세금)을 분리해야 엔진이
이 순서를 그대로 따를 수 있다.
"""

from __future__ import annotations

from typing import Literal

from athena_api.backtest.schema import CostsSpec

Side = Literal["buy", "sell"]

# `resolve_costs()`가 `costs=None`일 때 돌려주는 플래그 문자열. 결과 화면 "가정" 섹션이
# 그대로 노출한다(§8.3) — 이 모듈은 문자열 상수 하나로 그 계약을 고정한다.
UNSET_COSTS_FLAG = "비용 미설정"

_ZERO_COSTS = CostsSpec(fee_bps=0.0, tax_bps=0.0, slippage_bps=0.0)


def resolve_costs(costs: CostsSpec | None) -> tuple[CostsSpec, str | None]:
    """`costs`가 `None`이면 0 비용 스펙 + 미설정 플래그를 돌려준다. 있으면 그대로 통과."""
    if costs is None:
        return _ZERO_COSTS, UNSET_COSTS_FLAG
    return costs, None


def slipped_price(raw_price: float, side: Side, costs: CostsSpec) -> float:
    """슬리피지를 반영한 실제 체결가. 매수는 더 비싸게, 매도는 더 싸게 — 불리한 방향으로만
    움직인다(§6.4). `raw_price`는 시가 체결이면 그 봉의 시가, 손절/익절이면 그 레벨이다."""
    sign = 1 if side == "buy" else -1
    return raw_price * (1 + sign * costs.slippage_bps / 10_000)


def fee_amount(notional: float, costs: CostsSpec) -> float:
    """수수료 — 매수/매도 양방향에 동일하게 붙는다. `notional`은 체결가*수량."""
    return notional * costs.fee_bps / 10_000


def tax_amount(notional: float, costs: CostsSpec) -> float:
    """거래세 — 매도에만 붙는다(현행 한국 주식시장 관례). 매수 쪽 호출부는 이 함수를
    부르지 않는 것으로 "매도만"을 지킨다 — 여기서 side 분기를 두지 않는다."""
    return notional * costs.tax_bps / 10_000


__all__ = [
    "UNSET_COSTS_FLAG",
    "fee_amount",
    "resolve_costs",
    "slipped_price",
    "tax_amount",
]
