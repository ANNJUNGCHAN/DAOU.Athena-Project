"""백테스트 라우트 확장분(2026-09-01) — 보유 구간 실행·전략 버전·플로우·진단·최적화·배포.

`test_backtest_api.py`가 P4까지의 계약을 고정하고, 이 파일은 Paper 보드 02·05·06·07·08·09를
구현하며 늘어난 라우트를 고정한다. 두 파일을 나눈 이유는 원본이 이미 300줄을 넘겨서다 —
계약이 갈라진 것이 아니라 파일만 갈라졌다.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from athena_api.backtest.store import Candle
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest"

_RUN_YAML_TEMPLATE = """
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


def _disabled_client() -> TestClient:
    return TestClient(create_app(Settings(_env_file=None)))


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        Settings(
            _env_file=None, backtest_enabled=True, backtest_db_path=tmp_path / "backtest.sqlite3",
        )
    )
    return TestClient(app)


def _synthetic_candle_rows(n: int = 40) -> list[Candle]:
    closes = [100 + i * 0.3 + 4 * math.sin(i / 5.0) for i in range(n)]
    base = date(2025, 1, 2)
    rows: list[Candle] = []
    for i, close in enumerate(closes):
        dt = (base + timedelta(days=i)).strftime("%Y%m%d")
        open_ = closes[i - 1] * 1.001 if i > 0 else close
        rows.append(
            Candle(
                dt=dt, open=open_, high=close + 1, low=close - 1,
                close=close, volume=1000 + i * 10,
            )
        )
    return rows


def _seed_candles(
    client: TestClient, stk_cd: str, period: str, adjusted: bool, rows: list[Candle]
) -> None:
    store = client.app.state.backtest_store
    client.portal.call(lambda: store.upsert_candles(stk_cd, period, adjusted, rows))
    client.portal.call(
        lambda: store.upsert_coverage(
            stk_cd, period, adjusted,
            first_dt=rows[0].dt, last_dt=rows[-1].dt, fetched_at=datetime.now(UTC), pages=1,
        )
    )


def _await_run(client: TestClient, run_id: str) -> None:
    runner = client.app.state.backtest_runner
    job = runner.get(run_id)
    assert job is not None
    client.portal.call(lambda: job.task)


# ── 보유 구간만으로 실행 — 영구 409 탈출구 (계획서 §11-9, 보드 04·10) ──────────


def test_partial_run_escapes_the_permanent_409(tmp_path: Path) -> None:
    """휴장일을 from으로 주면 채울 수 없는 하루가 남아 백필을 아무리 돌려도 409가
    사라지지 않는다. `allow_partial`이 그 유일한 출구다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        earlier = date(2025, 1, 1).strftime("%Y%m%d")
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=earlier, to_dt=rows[-1].dt
        )

        blocked = client.post(f"{BASE}/runs", json={"yaml": yaml_text})
        assert blocked.status_code == 409

        accepted = client.post(f"{BASE}/runs", json={"yaml": yaml_text, "allow_partial": True})
        assert accepted.status_code == 202
        assert accepted.json()["partial"] is not None
        run_id = accepted.json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done"
        # 요청 구간 전부를 돌린 척하지 않는다 — 플래그가 결과에 그대로 남는다.
        assert any("보유 구간만" in f for f in result["flags"])


def test_partial_run_still_refuses_when_cache_is_completely_empty(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="000660", from_dt="20250102", to_dt="20250210"
        )
        res = client.post(f"{BASE}/runs", json={"yaml": yaml_text, "allow_partial": True})
        assert res.status_code == 422
        assert "봉이 하나도 없다" in res.json()["detail"]


def test_metrics_carry_mdd_window_and_trade_counts(tmp_path: Path) -> None:
    """결과 타일 부제(보드 03)가 쓰는 값들 — 없으면 화면이 숫자를 지어내야 한다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        run_id = client.post(f"{BASE}/runs", json={"yaml": yaml_text}).json()["run_id"]
        _await_run(client, run_id)
        metrics = client.get(f"{BASE}/runs/{run_id}").json()["metrics"]
        assert {
            "mdd_start", "mdd_end", "mdd_bars", "closed_trades",
            "winning_trades", "warmup_bars", "bars",
        } <= set(metrics)
        assert metrics["bars"] > 0
        # 워밍업은 SMA(5)에서 나온다 — 0이면 Sharpe가 부풀려진 채로 저장된 것이다(§6.5).
        assert metrics["warmup_bars"] >= 4


# ── 전략 · 버전 ─────────────────────────────────────────────────────────────


def test_strategy_version_lifecycle_keeps_llm_drafts_inactive(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = client.post(
            f"{BASE}/strategies",
            json={"name": "골든크로스", "kind": "python", "source": "v1 = 1\n"},
        ).json()
        sid = created["strategy_id"]

        draft = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json={"source": "v2 = 2\n", "origin": "llm_draft", "note": "손절 추가"},
        ).json()
        assert draft["active"] is False  # ★ 모델 초안은 켜지지 않는다(§7.3)

        versions = client.get(f"{BASE}/strategies/{sid}/versions").json()["versions"]
        active = [v for v in versions if v["active"]]
        assert len(active) == 1 and active[0]["version"] == 1

        activated = client.post(
            f"{BASE}/strategies/{sid}/activate", json={"version_id": draft["version_id"]}
        )
        assert activated.status_code == 200
        versions = client.get(f"{BASE}/strategies/{sid}/versions").json()["versions"]
        active = [v for v in versions if v["active"]]
        assert len(active) == 1 and active[0]["version"] == 2


def test_human_version_activates_immediately(tmp_path: Path) -> None:
    """사람의 편집은 사람의 클릭이다(§7.3)."""
    with _client(tmp_path) as client:
        sid = client.post(
            f"{BASE}/strategies", json={"name": "s", "kind": "python", "source": "a=1\n"}
        ).json()["strategy_id"]
        res = client.post(f"{BASE}/strategies/{sid}/versions", json={"source": "a=2\n"}).json()
        assert res["active"] is True


def test_activate_rejects_a_version_from_another_strategy(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        a = client.post(
            f"{BASE}/strategies", json={"name": "a", "kind": "python", "source": "a=1\n"}
        ).json()
        b = client.post(
            f"{BASE}/strategies", json={"name": "b", "kind": "python", "source": "b=1\n"}
        ).json()
        res = client.post(
            f"{BASE}/strategies/{a['strategy_id']}/activate",
            json={"version_id": b["version_id"]},
        )
        assert res.status_code == 404


def test_version_diff_counts_added_and_removed(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = client.post(
            f"{BASE}/strategies",
            json={"name": "s", "kind": "python", "source": "a = 1\nb = 2\n"},
        ).json()
        sid = created["strategy_id"]
        second = client.post(
            f"{BASE}/strategies/{sid}/versions", json={"source": "a = 1\nb = 3\nc = 4\n"}
        ).json()
        diff = client.get(
            f"{BASE}/strategies/{sid}/diff",
            params={"base": created["version_id"], "head": second["version_id"]},
        ).json()
        assert diff["base_version"] == 1 and diff["head_version"] == 2
        assert diff["added"] == 2 and diff["removed"] == 1


# ── 플로우 · 진단 (백테스트 비활성이어도 동작해야 한다) ────────────────────────


def test_flow_route_maps_code_without_running_it() -> None:
    client = _disabled_client()
    src = (
        "PARAMS = {'fast': {}}\n"
        "def signals(df, p):\n"
        "    fast = bt.sma(df.close, p['fast'])\n"
        "    entry = fast > 0\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry','exit']]\n"
    )
    body = client.post(f"{BASE}/flow", json={"source": src}).json()
    assert [n["stage"] for n in body["nodes"]] == [
        "prepare", "indicators", "conditions", "output"
    ]
    assert body["params"] == ["fast"]
    assert len(body["app_after"]) == 3


def test_flow_route_rejects_empty_source() -> None:
    client = _disabled_client()
    assert client.post(f"{BASE}/flow", json={"source": "  "}).status_code == 422


def test_diagnose_route_returns_explanation_and_optional_fix() -> None:
    client = _disabled_client()
    src = (
        "def signals(df, p):\n"
        "    entry = df.close > 0\n"
        "    stop = df.close - df.atr\n"
        "    return df\n"
    )
    tb = (
        'File "strategy.py", line 3, in signals\n'
        "ValueError: cannot mask with non-boolean array containing NA / NaN values\n"
    )
    body = client.post(f"{BASE}/diagnose", json={"error": tb, "source": src}).json()
    assert body["line"] == 3
    assert body["why"]
    assert body["suggestion"]["new_source"].count(".ffill()") == 1


def test_diagnose_route_never_applies_the_fix() -> None:
    """진단은 계산만 한다 — 저장은 사람이 누른 뒤 버전 라우트가 한다."""
    client = _disabled_client()
    body = client.post(
        f"{BASE}/diagnose", json={"error": "RuntimeError: x", "source": "a=1\n"}
    ).json()
    assert body["suggestion"] is None
    assert body["unknown_reason"]


# ── 최적화 ──────────────────────────────────────────────────────────────────


def test_optimize_plan_counts_combinations_before_running() -> None:
    client = _disabled_client()
    body = client.post(
        f"{BASE}/optimize/plan",
        json={
            "ranges": [
                {"name": "fast", "start": 5, "stop": 20, "step": 5},
                {"name": "slow", "start": 5, "stop": 20, "step": 5},
            ],
            "ascending": ["fast", "slow"],
        },
    ).json()
    assert body["combinations"] == 6
    assert body["over_limit"] is False


def test_optimize_refuses_when_cache_is_short(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt="20240101", to_dt=rows[-1].dt
        )
        res = client.post(
            f"{BASE}/optimize",
            json={
                "yaml": yaml_text,
                "ranges": [{"name": "fast", "start": 2, "stop": 4, "step": 1}],
            },
        )
        assert res.status_code == 409


def test_optimize_runs_grid_and_reports_heatmap(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows(60)
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        body = client.post(
            f"{BASE}/optimize",
            json={
                "yaml": yaml_text,
                "ranges": [
                    {"name": "fast", "start": 2, "stop": 4, "step": 1},
                    {"name": "slow", "start": 6, "stop": 10, "step": 2},
                ],
                "ascending": ["fast", "slow"],
            },
        ).json()
        assert len(body["trials"]) == 9
        assert body["heatmap"]["x_axis"] == "fast"
        assert isinstance(body["warnings"], list)


def test_optimize_rejects_unknown_parameter(tmp_path: Path) -> None:
    """존재하지 않는 파라미터로 서치를 돌리면 조용히 기본값만 훑게 된다 — 거절한다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        res = client.post(
            f"{BASE}/optimize",
            json={
                "yaml": yaml_text,
                "ranges": [{"name": "nope", "start": 1, "stop": 2, "step": 1}],
            },
        )
        assert res.status_code == 422
        assert "알 수 없는 전략 파라미터" in res.json()["detail"]


# ── 배포 ────────────────────────────────────────────────────────────────────


def _deploy_body(version_id: str, mode: str = "approve") -> dict:
    return {
        "strategy_version_id": version_id,
        "stk_cd": "005930",
        "period": "day",
        "adjusted": True,
        "mode": mode,
        "params": {},
        "limits": {
            "max_order_amount": 2_000_000,
            "max_orders_per_day": 2,
            "valid_from": "20250101",
            "valid_to": "20991231",
            "stop_on_drawdown_pct": 15.0,
            "stop_on_consecutive_losses": 3,
        },
    }


def _seeded_version(client: TestClient, rows: list[Candle]) -> str:
    yaml_text = _RUN_YAML_TEMPLATE.format(
        stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
    )
    return client.post(
        f"{BASE}/strategies", json={"name": "배포용", "kind": "yaml", "source": yaml_text}
    ).json()["version_id"]


def test_deployment_lifecycle_and_signal_recording(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows(60)
        _seed_candles(client, "005930", "day", True, rows)
        version_id = _seeded_version(client, rows)

        dep = client.post(f"{BASE}/deployments", json=_deploy_body(version_id)).json()
        listed = client.get(f"{BASE}/deployments").json()["deployments"]
        assert listed[0]["id"] == dep["deployment_id"]
        assert listed[0]["mode_label"] == "승인을 받고 주문합니다"

        evaluated = client.post(
            f"{BASE}/deployments/{dep['deployment_id']}/evaluate",
            json={"today": "20250301", "holding": False, "orders_today": 0, "order_amount": 100},
        )
        assert evaluated.status_code == 200
        assert evaluated.json()["stage"] in {
            "skipped", "signal", "pending_approval", "ordered", "blocked"
        }

        stopped = client.delete(f"{BASE}/deployments/{dep['deployment_id']}")
        assert stopped.status_code == 200
        assert "취소되지 않는다" in stopped.json()["note"]
        assert client.get(f"{BASE}/deployments").json()["deployments"][0]["status"] == "stopped"


def test_stopped_deployment_never_orders(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows(60)
        _seed_candles(client, "005930", "day", True, rows)
        version_id = _seeded_version(client, rows)
        dep_id = client.post(
            f"{BASE}/deployments", json=_deploy_body(version_id, mode="auto")
        ).json()["deployment_id"]
        client.delete(f"{BASE}/deployments/{dep_id}")
        body = client.post(f"{BASE}/deployments/{dep_id}/evaluate", json={}).json()
        assert body["stage"] != "ordered"


def test_deployment_rejects_missing_limits(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        res = client.post(
            f"{BASE}/deployments",
            json={"strategy_version_id": "v", "stk_cd": "005930", "mode": "auto"},
        )
        assert res.status_code == 422


def test_deployment_rejects_unknown_mode(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        body = _deploy_body("v")
        body["mode"] = "yolo"
        assert client.post(f"{BASE}/deployments", json=body).status_code == 422


def test_deployment_routes_are_gated_when_backtest_disabled() -> None:
    client = _disabled_client()
    assert client.get(f"{BASE}/deployments").status_code == 503


def test_infinite_profit_factor_survives_json_as_a_flag(tmp_path: Path) -> None:
    """손실이 0인 전략의 Profit Factor는 무한대다. JSON은 그 값을 실을 수 없어
    pydantic이 null로 바꾸는데, 그러면 화면에 "모름(—)"이 뜬다 — 사실과 다르다.
    `_json_safe`가 값을 null로 두되 `_infinite` 플래그를 같이 실어 구분을 지킨다."""
    from athena_api.backtest.runner import _json_safe

    payload = _json_safe({"profit_factor": float("inf"), "sharpe": 0.5})
    assert payload["profit_factor"] is None
    assert payload["profit_factor_infinite"] is True
    assert payload["sharpe"] == 0.5


def test_nan_becomes_null_without_an_infinite_flag() -> None:
    """NaN은 그냥 모르는 값이다 — 무한대와 같은 취급을 하면 안 된다."""
    from athena_api.backtest.runner import _json_safe

    payload = _json_safe({"x": float("nan")})
    assert payload["x"] is None
    assert "x_infinite" not in payload


# ── 코드 경로 실행 (§6.2 — 폼과 같은 체결·비용·성과를 지난다) ──────────────────

_CODE_SOURCE = '''\
PARAMS = {
    "fast": {"default": 2, "min": 2, "max": 10, "step": 1},
    "slow": {"default": 5, "min": 2, "max": 20, "step": 1},
}


def signals(df, p):
    import athena_bt as bt

    print("코드 경로 진입 · 봉", len(df))
    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    return df.assign(
        entry=bt.cross_above(fast, slow),
        exit=bt.cross_below(fast, slow),
    )[["entry", "exit"]]
'''

_FAILING_CODE_SOURCE = '''\
PARAMS = {"fast": {"default": 2}}


def signals(df, p):
    print("여기까지는 왔다")
    raise ValueError("전략 로직이 터졌다")
'''

# 자식은 성공하고(열이 다 있다) 부모의 정렬에서 터지는 코드 — 중복 인덱스는 reindex가 못 푼다.
_DUPLICATE_INDEX_CODE_SOURCE = '''\
PARAMS = {}


def signals(df, p):
    print("정렬 전까지는 왔다")
    out = df.assign(entry=False, exit=False)[["entry", "exit"]]
    return out.reindex(list(out.index) + [out.index[0]])
'''


def test_code_path_run_reports_run_path_flag_and_stdout(tmp_path: Path) -> None:
    """`source`를 실으면 signals를 폼이 아니라 그 파이썬이 만든다. 결과에는 어느 경로로
    나온 수치인지(run_path)와 워밍업을 못 셌다는 사실이 그대로 남아야 한다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        accepted = client.post(f"{BASE}/runs", json={"yaml": yaml_text, "source": _CODE_SOURCE})
        assert accepted.status_code == 202
        run_id = accepted.json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done", result["error"]
        assert result["metrics"]["run_path"] == "code"
        assert any("코드 경로" in f for f in result["flags"])
        # 자식 프로세스의 print가 결과에 실려 온다 — 초심자의 유일한 디버그 창구다.
        assert "코드 경로 진입" in result["stdout"]
        assert len(result["equity"]) == len(rows)

        trades = client.get(f"{BASE}/runs/{run_id}/trades").json()["trades"]
        # 이 파형에는 교차가 실제로 있다 — 신호가 체결까지 갔다는 증거다.
        assert trades


def test_code_path_failure_keeps_the_exception_and_the_print_log(tmp_path: Path) -> None:
    """전략이 터지면 실행은 failed다. 오류 문구와 터지기 전 print가 둘 다 남아야
    사용자가 무엇이 잘못됐는지 알 수 있다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        run_id = client.post(
            f"{BASE}/runs", json={"yaml": yaml_text, "source": _FAILING_CODE_SOURCE}
        ).json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "failed"
        assert "ValueError" in result["error"]
        assert "전략 로직이 터졌다" in result["error"]
        assert "여기까지는 왔다" in result["stdout"]
        assert result["metrics"] is None


def test_code_path_failure_after_the_child_still_keeps_the_print_log(tmp_path: Path) -> None:
    """자식은 성공했는데 부모의 정렬·체결·지표에서 터진 경우다 — 결과 프레임이 망가진
    바로 이 상황이야말로 print 로그가 필요하다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        run_id = client.post(
            f"{BASE}/runs", json={"yaml": yaml_text, "source": _DUPLICATE_INDEX_CODE_SOURCE}
        ).json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "failed"
        assert result["error"]
        assert "정렬 전까지는 왔다" in (result["stdout"] or "")


def test_form_path_run_stays_form_and_carries_no_code_flag(tmp_path: Path) -> None:
    """`source` 없는 실행은 예전 그대로다 — 코드 경로 플래그가 붙으면 안 된다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        run_id = client.post(f"{BASE}/runs", json={"yaml": yaml_text}).json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done"
        assert result["metrics"]["run_path"] == "form"
        assert not any("코드 경로" in f for f in result["flags"])
        assert result["stdout"] == ""
