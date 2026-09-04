"""자동 주문(보드 23) — 사람 클릭 없이 주문이 나가는 유일한 경로의 그물.

이 파일이 지키는 것은 하나다: **주문은 셋이 모두 참일 때만 나간다** — 모드가 `auto`,
무장 스위치가 켜짐, 배포가 살아 있음. 하나라도 아니면 신호만 남고 브로커는 불리지 않는다.
그래서 대부분의 검사가 "주문이 나가지 않았다"를 본다. 자동 매매에서 회귀는 "안 나가야 할
주문이 나갔다" 쪽으로 생기지, 나가야 할 주문이 안 나가는 쪽으로 생기지 않는다.

브로커는 전부 가짜다 — 이 파일은 키움 모의서버조차 부르지 않는다(호출 횟수를 센다).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from athena_api.backtest import deploy_orders
from athena_api.backtest.deploy import Decision, Deployment, Limits
from athena_api.backtest.store import Candle
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest"

# 기존 배포 테스트와 같은 전략 원문을 쓴다 — 신호가 나는 시드가 그쪽에서 검증돼 있다.
_RUN_YAML = """
version: "1.0"
metadata:
  name: API 테스트 — SMA 교차
data:
  symbols: ["{stk_cd}"]
  period: day
  adjusted: true
  from: "{from_dt}"
  to: "{to_dt}"
strategy:
  id: t1
  params:
    fast: {{default: 3, min: 2, max: 10, step: 1, type: int}}
    slow: {{default: 5, min: 2, max: 20, step: 1, type: int}}
  indicators:
    - {{id: SMA, alias: ma_fast, params: {{period: "$fast"}}}}
    - {{id: SMA, alias: ma_slow, params: {{period: "$slow"}}}}
  entry:
    logic: AND
    conditions:
      - {{indicator: ma_fast, operator: cross_above, compare_to: ma_slow}}
  exit:
    logic: AND
    conditions:
      - {{indicator: ma_fast, operator: cross_below, compare_to: ma_slow}}
risk:
  stop_loss:   {{enabled: false, percent: 0}}
  take_profit: {{enabled: false, percent: 0}}
  position:    {{sizing: all_in}}
"""


class _FakeEnvelope:
    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body
        self.cont_yn = "N"
        self.next_key = None


class _FakeOrderClient:
    """호출을 세는 가짜 브로커. `is_ready`가 참이어야 의존성이 이 객체를 내준다."""

    is_ready = True

    def __init__(self, body: dict[str, Any] | None = None, raises: bool = False) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._body = body or {"return_code": 0, "ord_no": "0001234"}
        self._raises = raises

    async def post_with_headers(
        self, tr_id: str, _path: str, body: dict[str, Any], _options: Any
    ) -> _FakeEnvelope:
        self.calls.append((tr_id, dict(body)))
        if self._raises:
            raise RuntimeError("upstream timeout")
        return _FakeEnvelope(self._body)


def _client(tmp_path: Path, order_client: Any = None) -> TestClient:
    # 주문 게이트(enable_order_api·bearer)는 **앱을 만들 때** 열어야 한다 — lifespan이
    # app.state.settings를 자기가 받은 설정으로 다시 쓰기 때문에, 나중에 꽂으면 지워진다
    # (이 파일을 쓰며 실측).
    app = create_app(
        Settings(
            _env_file=None,
            backtest_enabled=True,
            backtest_db_path=tmp_path / "backtest.sqlite3",
            enable_order_api=order_client is not None,
            local_bearer_token="test-token" if order_client is not None else None,
        )
    )
    return TestClient(app)


@contextmanager
def _running(tmp_path: Path, order_client: Any = None) -> Iterator[TestClient]:
    """앱을 띄운 **뒤** 가짜 브로커를 꽂는다.

    lifespan이 startup에서 app.state.kiwoom_order_client를 자기 값으로 다시 쓰기 때문에,
    TestClient에 들어가기 전에 꽂으면 지워진다(실측). 의존성이 읽는 자리는 실앱과 같다.
    """
    with _client(tmp_path, order_client) as client:
        if order_client is not None:
            client.app.state.kiwoom_order_client = order_client
        yield client


def _candles(n: int = 60) -> list[Candle]:
    """마지막 봉에서 **반드시** 골든크로스가 나는 캔들.

    시드가 우연히 신호를 내주기를 기다리면 "주문이 나갔다"를 보는 검사가 조용히 skip으로
    새고, 자동 매매에 그물이 없어진다(그 실패를 이 파일을 쓰며 실제로 겪었다). 그래서
    값을 결정적으로 만든다: 계속 내려오다가 마지막 봉만 크게 뛴다 —
    직전 봉은 SMA3 < SMA5, 마지막 봉은 SMA3 > SMA5라 cross_above가 마지막에 걸린다.
    """
    closes = [float(200 - i) for i in range(n - 1)] + [600.0]
    base = date(2025, 1, 2)
    return [
        Candle(
            dt=(base + timedelta(days=i)).strftime("%Y%m%d"),
            open=closes[i - 1] if i > 0 else close,
            high=close + 1,
            low=min(close, closes[i - 1] if i > 0 else close) - 1,
            close=close,
            volume=1000 + i * 10,
        )
        for i, close in enumerate(closes)
    ]


def _seed(client: TestClient) -> str:
    # 캔들은 기존 배포 테스트와 같은 방식으로 스토어에 직접 넣는다(수집 API를 태우지 않는다).
    rows = _candles()
    store = client.app.state.backtest_store
    client.portal.call(lambda: store.upsert_candles("005930", "day", True, rows))
    client.portal.call(
        lambda: store.upsert_coverage(
            "005930", "day", True,
            first_dt=rows[0].dt, last_dt=rows[-1].dt, fetched_at=datetime.now(UTC), pages=1,
        )
    )
    yaml_text = _RUN_YAML.format(stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt)
    return client.post(
        f"{BASE}/strategies", json={"name": "자동주문용", "kind": "yaml", "source": yaml_text}
    ).json()["version_id"]


def _deploy_body(version_id: str, mode: str = "auto") -> dict[str, Any]:
    return {
        "strategy_version_id": version_id,
        "stk_cd": "005930",
        "period": "day",
        "adjusted": True,
        "mode": mode,
        "params": {},
        "limits": {
            "max_order_amount": 3_000_000,
            "max_orders_per_day": 3,
            "valid_from": "20250101",
            "valid_to": "20991231",
            "stop_on_drawdown_pct": 15.0,
            "stop_on_consecutive_losses": 3,
        },
    }


# ── 순수 판정 (브로커 없이) ──────────────────────────────────────────────────


def _deployment(
    mode: str = "auto", status: str = "active", amount: float = 3_000_000
) -> Deployment:
    return Deployment(
        id="dep-0000",
        strategy_version_id="v1",
        run_id=None,
        stk_cd="005930",
        period="day",
        adjusted=True,
        mode=mode,
        params={},
        limits=Limits(
            max_order_amount=amount,
            max_orders_per_day=3,
            valid_from="20250101",
            valid_to="20991231",
            stop_on_drawdown_pct=15.0,
            stop_on_consecutive_losses=3,
        ),
        status=status,
    )


def _decision(side: str = "buy") -> Decision:
    return Decision(
        dt="20260904",
        side=side,
        stage="ordered",
        reason="조건 충족",
        basis="근거",
        blocked_reason=None,
    )


def test_arm_gate_needs_auto_mode_armed_switch_and_live_deployment() -> None:
    assert deploy_orders.is_armed_for_auto(_deployment(), armed=True) is True
    # 셋 중 하나만 어긋나도 자동 주문은 없다.
    assert deploy_orders.is_armed_for_auto(_deployment(), armed=False) is False
    assert deploy_orders.is_armed_for_auto(_deployment(mode="approve"), armed=True) is False
    assert deploy_orders.is_armed_for_auto(_deployment(mode="observe"), armed=True) is False
    assert deploy_orders.is_armed_for_auto(_deployment(status="stopped"), armed=True) is False


def test_quantity_comes_from_the_limit_and_never_rounds_up_to_one_share() -> None:
    plan = deploy_orders.plan_order(_deployment(), _decision(), 74_250.0)
    assert plan is not None
    assert plan.qty == 40  # 3,000,000 // 74,250
    assert plan.body["ord_qty"] == "40"
    assert plan.tr_id == deploy_orders.BUY_TR_ID
    # 한 주도 못 사면 주문을 만들지 않는다 — "그래도 한 주"는 사람이 정한 한도가 아니다.
    assert deploy_orders.plan_order(_deployment(amount=1000), _decision(), 74_250.0) is None
    reason = deploy_orders.blocked_reason_for_plan(_deployment(amount=1000), _decision(), 74_250.0)
    assert "한 주도 살 수 없습니다" in reason


def test_sell_uses_the_sell_tr_and_payload_matches_the_order_ticket_shape() -> None:
    plan = deploy_orders.plan_order(_deployment(), _decision("sell"), 1000.0)
    assert plan is not None
    assert plan.tr_id == deploy_orders.SELL_TR_ID
    # 주문 티켓(app/lib/order-ticket.js buildOrderPayload)과 같은 네 칸, 시장가 '3'.
    assert set(plan.body) == {"dmst_stex_tp", "stk_cd", "ord_qty", "trde_tp"}
    assert plan.body["trde_tp"] == "3"
    assert plan.body["dmst_stex_tp"] == "KRX"


def test_idempotency_key_is_deterministic_per_bar_and_within_the_length_limit() -> None:
    a = deploy_orders.idempotency_key_for("dep-1", "20260904", "buy")
    b = deploy_orders.idempotency_key_for("dep-1", "20260904", "buy")
    assert a == b, "같은 봉을 두 번 봐도 같은 키여야 중복 주문이 막힌다"
    assert a != deploy_orders.idempotency_key_for("dep-1", "20260904", "sell")
    assert a != deploy_orders.idempotency_key_for("dep-2", "20260904", "buy")
    assert 1 <= len(deploy_orders.idempotency_key_for("d" * 200, "20260904", "buy")) <= 128


# ── 무장 라우트 ──────────────────────────────────────────────────────────────


def test_new_deployment_is_not_armed_and_arming_is_an_explicit_click(tmp_path: Path) -> None:
    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        listed = client.get(f"{BASE}/deployments").json()["deployments"][0]
        # 만들자마자 자동으로 사고파는 배포는 없다.
        assert listed["armed"] is False
        assert listed["auto_armed"] is False

        armed = client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": True})
        assert armed.status_code == 200
        assert armed.json()["armed"] is True
        listed = client.get(f"{BASE}/deployments").json()["deployments"][0]
        assert listed["armed"] is True
        assert listed["auto_armed"] is True

        client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": False})
        assert client.get(f"{BASE}/deployments").json()["deployments"][0]["auto_armed"] is False


def test_arming_a_stopped_deployment_fails_loudly(tmp_path: Path) -> None:
    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        client.delete(f"{BASE}/deployments/{dep_id}")
        res = client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": True})
        # 조용히 실패하면 화면 토글만 켜져 사람이 "자동으로 사고팔린다"고 믿게 된다.
        assert res.status_code == 409
        assert client.get(f"{BASE}/deployments").json()["deployments"][0]["armed"] is False


def test_arm_route_rejects_non_boolean_and_unknown_deployment(tmp_path: Path) -> None:
    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        bad = client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": "yes"})
        assert bad.status_code == 422
        missing = client.post(f"{BASE}/deployments/nope/arm", json={"armed": True})
        assert missing.status_code == 404


def test_approve_mode_cannot_be_armed_into_auto_orders(tmp_path: Path) -> None:
    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(
            f"{BASE}/deployments", json=_deploy_body(version_id, mode="approve")
        ).json()["deployment_id"]
        client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": True})
        listed = client.get(f"{BASE}/deployments").json()["deployments"][0]
        # 무장은 켜지지만 모드가 approve라 자동 집행 상태는 아니다.
        assert listed["armed"] is True
        assert listed["auto_armed"] is False


# ── 브로커가 실제로 불렸는가 ─────────────────────────────────────────────────


def _evaluate(client: TestClient, dep_id: str, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"holding": False, "orders_today": 0, "order_amount": 0}
    body.update(over)
    return client.post(f"{BASE}/deployments/{dep_id}/evaluate", json=body).json()


def _armed_auto(client: TestClient) -> str:
    version_id = _seed(client)
    dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
        "deployment_id"
    ]
    client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": True})
    return dep_id


def test_unarmed_auto_deployment_never_touches_the_broker(tmp_path: Path) -> None:
    broker = _FakeOrderClient()
    with _running(tmp_path, broker) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        out = _evaluate(client, dep_id)
        assert out["stage"] != "ordered" or broker.calls == []
        assert broker.calls == [], "무장하지 않은 배포가 주문을 냈다"


def test_stopped_armed_deployment_never_touches_the_broker(tmp_path: Path) -> None:
    broker = _FakeOrderClient()
    with _running(tmp_path, broker) as client:
        dep_id = _armed_auto(client)
        client.delete(f"{BASE}/deployments/{dep_id}")
        _evaluate(client, dep_id)
        assert broker.calls == [], "멈춘 배포가 주문을 냈다"


def test_observe_mode_never_touches_the_broker(tmp_path: Path) -> None:
    broker = _FakeOrderClient()
    with _running(tmp_path, broker) as client:
        version_id = _seed(client)
        dep_id = client.post(
            f"{BASE}/deployments", json=_deploy_body(version_id, mode="observe")
        ).json()["deployment_id"]
        client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": True})
        _evaluate(client, dep_id)
        assert broker.calls == [], "기록만 하는 배포가 주문을 냈다"


def test_armed_auto_deployment_orders_once_per_bar_even_when_evaluated_twice(
    tmp_path: Path,
) -> None:
    broker = _FakeOrderClient()
    with _running(tmp_path, broker) as client:
        dep_id = _armed_auto(client)
        first = _evaluate(client, dep_id)
        assert first["stage"] == "ordered", f"시드가 주문 단계를 못 만들었다: {first}"
        assert len(broker.calls) == 1
        assert broker.calls[0][0] == deploy_orders.BUY_TR_ID
        assert first["order_no"] == "0001234"
        assert first["qty"] and first["qty"] >= 1

        # 같은 봉을 다시 평가한다 — 스케줄러 재기동·중복 tick이 이 모양이다.
        second = _evaluate(client, dep_id)
        assert len(broker.calls) == 1, "같은 봉에서 주문이 두 번 나갔다"
        assert second["stage"] == "ordered"

        signals = client.get(f"{BASE}/deployments/{dep_id}/signals").json()["signals"]
        ordered = [s for s in signals if s["stage"] == "ordered"]
        assert ordered and ordered[0]["order_no"] == "0001234"
        assert ordered[0]["qty"] >= 1


def test_business_error_from_broker_is_not_reported_as_ordered(tmp_path: Path) -> None:
    # 키움은 업무 오류도 HTTP 200으로 준다 — 200을 주문 성공으로 읽으면 안 된다.
    broker = _FakeOrderClient({"return_code": 3, "return_msg": "주문가능금액 부족"})
    with _running(tmp_path, broker) as client:
        dep_id = _armed_auto(client)
        out = _evaluate(client, dep_id)
        assert broker.calls, "브로커가 불리지 않아 업무 오류 처리를 검사할 수 없다"
        assert out["stage"] == "blocked"
        assert "주문가능금액 부족" in (out["blocked_reason"] or "")
        assert out["order_no"] is None


def test_transport_failure_is_in_doubt_and_is_never_retried(tmp_path: Path) -> None:
    broker = _FakeOrderClient(raises=True)
    with _running(tmp_path, broker) as client:
        dep_id = _armed_auto(client)
        out = _evaluate(client, dep_id)
        assert broker.calls, "브로커가 불리지 않아 전송 실패 처리를 검사할 수 없다"
        assert out["stage"] == "in_doubt"
        # 두 번째 평가가 같은 키로 와도 재전송하지 않는다.
        again = _evaluate(client, dep_id)
        assert len(broker.calls) == 1, "결과를 모르는 주문을 다시 냈다"
        assert again["stage"] == "in_doubt"


def test_without_an_order_client_the_signal_is_blocked_not_ordered(tmp_path: Path) -> None:
    with _running(tmp_path) as client:  # 주문 클라이언트를 꽂지 않는다
        dep_id = _armed_auto(client)
        out = _evaluate(client, dep_id)
        # 나가지 않은 주문을 나갔다고 적는 것이 가장 나쁜 거짓말이다.
        assert out["stage"] != "ordered"
        if out["stage"] == "blocked":
            assert "주문 서비스" in (out["blocked_reason"] or "")


def test_signal_rows_survive_a_restart_with_their_order_number(tmp_path: Path) -> None:
    broker = _FakeOrderClient()
    with _running(tmp_path, broker) as client:
        dep_id = _armed_auto(client)
        out = _evaluate(client, dep_id)
        assert out["stage"] == "ordered", f"시드가 주문 단계를 못 만들었다: {out}"
    # 같은 DB 파일을 새 앱으로 연다 — 열이 ALTER로 붙는 옛 파일 경로와 같은 모양이다.
    with _running(tmp_path) as reopened:
        signals = reopened.get(f"{BASE}/deployments/{dep_id}/signals").json()["signals"]
        assert any(s["order_no"] == "0001234" for s in signals)


def test_deployment_created_before_this_feature_reads_as_unarmed(tmp_path: Path) -> None:
    # armed 열이 없던 DB를 흉내낸다: 열을 지우고 다시 열어도 무장으로 읽히면 안 된다.
    import sqlite3

    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        client.post(f"{BASE}/deployments/{dep_id}/arm", json={"armed": True})
    connection = sqlite3.connect(tmp_path / "backtest.sqlite3")
    connection.execute("UPDATE bt_deployment SET armed = NULL")
    connection.commit()
    connection.close()
    with _running(tmp_path) as reopened:
        listed = reopened.get(f"{BASE}/deployments").json()["deployments"][0]
        assert listed["armed"] is False, "값이 없는 배포가 무장으로 읽혔다"
        assert listed["auto_armed"] is False


def test_signals_response_carries_order_number_and_quantity(tmp_path: Path) -> None:
    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        _evaluate(client, dep_id)
        signals = client.get(f"{BASE}/deployments/{dep_id}/signals").json()["signals"]
        for row in signals:
            # 화면의 오늘 로그가 이 두 칸을 읽는다 — 없으면 "주문 n주"를 그릴 수 없다.
            assert "order_no" in row
            assert "qty" in row


def test_store_arm_is_idempotent_and_survives_repeated_calls(tmp_path: Path) -> None:
    with _running(tmp_path) as client:
        version_id = _seed(client)
        dep_id = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()[
            "deployment_id"
        ]
        for _ in range(3):
            assert client.post(
                f"{BASE}/deployments/{dep_id}/arm", json={"armed": True}
            ).json()["armed"] is True
        assert client.get(f"{BASE}/deployments").json()["deployments"][0]["armed"] is True


def test_decision_dataclass_shape_is_what_the_planner_expects() -> None:
    # plan_order는 Decision의 dt·side만 읽는다. 그 계약이 깨지면 조용히 None이 된다.
    plan = deploy_orders.plan_order(_deployment(), _decision(), 100.0)
    assert plan is not None
    assert plan.idempotency_key.endswith("-20260904-buy")
    assert datetime.now(UTC).year >= 2025  # 시간 의존이 없다는 것을 남겨둔다
