"""배포가 낸 신호를 실제 주문으로 잇는다 — 자동 매매의 유일한 집행 지점(보드 23).

**이 모듈이 생기며 규율 하나가 바뀌었다.** 이전까지 `deploy.py`는 "주문을 내지 않는다"고
적었고 실주문은 사람이 주문 티켓에서 눌렀다. 2026-09-04 사용자 결정으로 **승인된 기법을
auto 모드로 배포하고 무장(armed)하면 사람 클릭 없이 주문이 나간다.** 바뀐 것은 그 한 경로
뿐이다 — 배포를 만드는 것도, 무장 토글을 켜는 것도 여전히 사람 클릭이고, 모델은 둘 중
무엇도 부를 수 없다(MCP 표면에 없다).

**두 번째 주문 경로를 만들지 않는다.** 그것이 원래 규율의 핵심이었고 지금도 유효하다.
그래서 이 모듈은 주문 티켓과 같은 것을 공유한다:

- 같은 payload 모양 — `dmst_stex_tp/stk_cd/ord_qty/trde_tp`, 시장가 `3`
  (`app/lib/order-ticket.js buildOrderPayload`와 한 글자도 다르지 않다).
- 같은 멱등 예약 캐시 — `app.state.order_idempotency_cache`. 티켓이 낸 주문과 자동이 낸
  주문이 한 이름 공간에서 중복 판정된다. 캐시를 따로 두면 같은 주문이 둘로 갈린다.
- 같은 무재시도 규율 — 실패는 실패로 남긴다. 자동이 재전송하면 사람이 못 세는 주문이 는다.

**멱등키가 이 모듈의 안전장치다.** 키는 `(배포 id, 신호 시각, 방향)`으로 **결정적으로**
만든다. 스케줄러가 같은 봉을 두 번 보더라도(재기동·중복 tick·시계 흔들림) 두 번째 호출은
첫 예약을 그대로 만나 새 주문이 되지 않는다. 임의 키를 쓰면 tick 한 번이 주문 하나가 된다.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Literal

from athena_api.accounts import account_runtimes, order_scope_for
from athena_api.backtest.deploy import Decision, Deployment
from athena_api.generated.registry import TR_REGISTRY
from athena_api.generated.runtime import (
    _ORDER_CACHE_LIMIT,
    OrderReservation,
    OrderState,
)
from athena_api.kiwoom import RequestOptions
from athena_api.kiwoom.return_codes import normalize_return_code

# 주문 티켓과 같은 값이다(order-ticket.js:69-72). 지정가는 아직 이 경로의 범위가 아니다 —
# 배포에는 사람이 정한 "가격"이 없고, 없는 값을 지어내면 그것은 사람이 정한 주문이 아니다.
_EXCHANGE = "KRX"
_MARKET_ORDER = "3"
_MAX_QTY = 100_000

BUY_TR_ID = "kt10000"
SELL_TR_ID = "kt10001"


@dataclass(frozen=True, slots=True)
class OrderPlan:
    """낼 주문 한 건. 만들어졌다고 나간 것은 아니다 — 제출은 `submit_order`다."""

    tr_id: str
    body: dict[str, str]
    idempotency_key: str
    qty: int
    side: Literal["buy", "sell"]


@dataclass(frozen=True, slots=True)
class OrderOutcome:
    """제출 결과. `ordered`가 아닌 모든 결과는 이유를 갖는다 — 조용한 실패가 없다."""

    stage: Literal["ordered", "blocked", "in_doubt"]
    order_no: str | None = None
    qty: int | None = None
    blocked_reason: str | None = None


def idempotency_key_for(deployment_id: str, dt: str, side: str) -> str:
    """같은 배포·같은 봉·같은 방향이면 언제 다시 계산해도 같은 키.

    128자 상한(`call_order_tr`)을 넘기지 않으려고 배포 id 앞 36자만 쓴다 — uuid4 전체
    길이라 충돌하지 않는다. 접두사 `btd-`는 사람이 로그에서 티켓 주문과 구분하기 위한 것이다.
    """
    return f"btd-{deployment_id[:36]}-{dt}-{side}"[:128]


def plan_order(deployment: Deployment, decision: Decision, price: float) -> OrderPlan | None:
    """한도가 허락하는 수량으로 시장가 주문 하나를 짠다. 못 짜면 `None`이다.

    수량은 `1회 최대 주문(원) // 가격`이다. 한 주도 못 사면 주문을 만들지 않는다 —
    "그래도 한 주"는 사람이 정한 한도가 아니라 우리가 지어낸 결정이다.
    """
    if decision.side not in ("buy", "sell"):
        return None
    if not price or price <= 0:
        return None
    qty = int(deployment.limits.max_order_amount // price)
    if qty < 1 or qty > _MAX_QTY:
        return None
    return OrderPlan(
        tr_id=BUY_TR_ID if decision.side == "buy" else SELL_TR_ID,
        body={
            "dmst_stex_tp": _EXCHANGE,
            "stk_cd": deployment.stk_cd,
            "ord_qty": str(qty),
            "trde_tp": _MARKET_ORDER,
        },
        idempotency_key=idempotency_key_for(deployment.id, decision.dt, decision.side),
        qty=qty,
        side=decision.side,
    )


def blocked_reason_for_plan(deployment: Deployment, decision: Decision, price: float) -> str:
    """`plan_order`가 `None`을 준 이유를 사람 말로 적는다 — 화면이 이 문장을 그대로 쓴다."""
    if decision.side not in ("buy", "sell"):
        return "방향이 없는 신호라 주문을 만들지 않았습니다"
    if not price or price <= 0:
        return "가격을 몰라 수량을 정할 수 없었습니다"
    qty = int(deployment.limits.max_order_amount // price)
    if qty < 1:
        return (
            f"1회 최대 주문 {int(deployment.limits.max_order_amount):,}원으로는 "
            f"{int(price):,}원짜리를 한 주도 살 수 없습니다"
        )
    return f"수량 {qty:,}주가 한 번에 낼 수 있는 상한({_MAX_QTY:,}주)을 넘습니다"


def is_armed_for_auto(deployment: Deployment, *, armed: bool) -> bool:
    """자동 주문이 나갈 수 있는 상태인가. 셋이 모두 참이어야 한다.

    모드는 배포를 만들 때 사람이 고른 것이고, 무장은 지금 켜져 있는지이며, 상태는 배포가
    아직 살아 있는지다. 셋 중 하나라도 아니면 신호는 기록만 된다.
    """
    return deployment.mode == "auto" and armed and deployment.status == "active"


async def submit_order(
    app: Any, client: Any, plan: OrderPlan, *, account: str = ""
) -> OrderOutcome:
    """주문 티켓과 같은 예약 캐시를 지나 실제로 제출한다.

    같은 멱등키의 앞선 주문이 이미 끝났으면 **새로 내지 않고 그 결과를 돌려준다.** 앞선
    주문이 결과를 모른 채 끝났으면(IN_DOUBT) 재전송하지 않는다 — 모르는 주문을 다시 내는
    것이 중복 주문의 가장 흔한 경로다.
    """
    scope = order_scope_for(plan.tr_id, TR_REGISTRY[plan.tr_id].upstream_path)
    runtime = account_runtimes(app).get(account)
    if runtime is not None and not runtime.permits_order(scope):
        return OrderOutcome(
            stage="blocked",
            blocked_reason=f"이 계좌는 {scope.value} 주문 권한이 없습니다",
        )

    lock = app.state.order_idempotency_lock
    cache = app.state.order_idempotency_cache
    key = (account, plan.tr_id, plan.idempotency_key)
    fingerprint = json.dumps(plan.body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    owner = False
    envelope = None
    async with lock:
        reservation = cache.get(key)
        if reservation is not None and reservation.fingerprint != fingerprint:
            # 같은 봉·같은 방향인데 몸통이 다르다 = 한도나 가격이 바뀌었다. 새 주문으로
            # 내보내지 않는다 — 어느 쪽이 사람이 승인한 한도인지 여기서는 알 수 없다.
            return OrderOutcome(
                stage="blocked",
                blocked_reason="같은 신호로 조건이 다른 주문이 이미 있었습니다",
            )
        if reservation is None:
            while len(cache) >= _ORDER_CACHE_LIMIT:
                completed = next(
                    (k for k, v in cache.items() if v.state is OrderState.COMPLETED), None
                )
                if completed is None:
                    return OrderOutcome(
                        stage="blocked", blocked_reason="주문 멱등 캐시가 가득 찼습니다"
                    )
                del cache[completed]
            reservation = OrderReservation(
                fingerprint=fingerprint,
                state=OrderState.PENDING,
                completed=asyncio.Event(),
            )
            cache[key] = reservation
            owner = True
        elif reservation.state is OrderState.IN_DOUBT:
            return OrderOutcome(
                stage="in_doubt",
                blocked_reason="앞선 주문의 결과를 모릅니다 — 다시 내지 않았습니다",
            )
        elif reservation.state is OrderState.COMPLETED:
            cache.move_to_end(key)
            envelope = reservation.envelope

    if not owner:
        if envelope is None:
            # 앞선 제출이 아직 도는 중이다. 기다리지 않는다 — 다음 tick이 같은 키로 와서
            # 그때 결과를 만난다(스케줄러 한 틱을 주문 응답에 묶어두지 않는다).
            return OrderOutcome(
                stage="blocked", blocked_reason="같은 신호의 주문이 아직 진행 중입니다"
            )
        return _outcome_from_envelope(envelope, plan)

    try:
        envelope = await client.post_with_headers(
            plan.tr_id,
            TR_REGISTRY[plan.tr_id].upstream_path,
            plan.body,
            RequestOptions(cont_yn="N", next_key=None),
        )
    except BaseException:
        async with lock:
            if reservation.state is OrderState.PENDING:
                reservation.state = OrderState.IN_DOUBT
                reservation.completed.set()
        # 무재시도 — 티켓과 같은 규율이다. 나갔는지 모르는 주문을 다시 내지 않는다.
        return OrderOutcome(
            stage="in_doubt", blocked_reason="주문을 보냈지만 결과를 받지 못했습니다"
        )

    async with lock:
        reservation.envelope = envelope
        reservation.state = OrderState.COMPLETED
        reservation.completed.set()
        cache.move_to_end(key)
    return _outcome_from_envelope(envelope, plan)


def _outcome_from_envelope(envelope: Any, plan: OrderPlan) -> OrderOutcome:
    """키움의 업무 오류(return_code≠0)는 HTTP 200으로 온다 — 200을 체결로 읽지 않는다."""
    body = getattr(envelope, "body", None) or {}
    code = normalize_return_code(body.get("return_code"))
    if code not in {"", "0"}:
        message = str(body.get("return_msg") or "").strip() or f"주문 거부(코드 {code})"
        return OrderOutcome(stage="blocked", blocked_reason=message)
    order_no = body.get("ord_no")
    return OrderOutcome(
        stage="ordered",
        order_no=None if order_no is None else str(order_no),
        qty=plan.qty,
    )
