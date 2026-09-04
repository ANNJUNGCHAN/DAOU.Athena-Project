"""백테스트 라우트 확장분(2026-09-01) — 보유 구간 실행·전략 버전·플로우·진단·최적화·배포.

`test_backtest_api.py`가 P4까지의 계약을 고정하고, 이 파일은 Paper 보드 02·05·06·07·08·09를
구현하며 늘어난 라우트를 고정한다. 두 파일을 나눈 이유는 원본이 이미 300줄을 넘겨서다 —
계약이 갈라진 것이 아니라 파일만 갈라졌다.
"""

from __future__ import annotations

import math
import subprocess
import sys
import types
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from athena_api.backtest.presets import preset_yaml
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


def test_run_detail_carries_buy_hold_curve_and_list_stays_small(tmp_path: Path) -> None:
    """보드 03의 자산곡선은 "전략 vs 매수보유" 두 선이다 — 값 하나(`buy_hold_return`)로는
    선을 못 그려서 상세 응답이 봉마다의 배수를 같이 준다. 목록은 그 배열을 싣지 않는다
    (실행 수만큼 곱해지는 배열이라 목록 응답이 통째로 커진다)."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        run_id = client.post(f"{BASE}/runs", json={"yaml": yaml_text}).json()["run_id"]
        _await_run(client, run_id)

        detail = client.get(f"{BASE}/runs/{run_id}").json()
        benchmark = detail["benchmark"]
        assert len(benchmark) == len(detail["equity"])
        # 정규화 기준은 첫 종가다 — app/lib/backtest-equity-chart.js `normalize`와 같은 정의.
        assert benchmark[0] == 1.0
        expected = [r.close / rows[0].close for r in rows]
        assert all(
            math.isclose(a, b, rel_tol=1e-12)
            for a, b in zip(benchmark, expected, strict=True)
        )
        assert "benchmark" not in detail["metrics"]

        listed = client.get(f"{BASE}/runs").json()["runs"]
        item = next(r for r in listed if r["run_id"] == run_id)
        assert "benchmark" not in item
        assert "benchmark" not in item["metrics"]


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


def test_map_route_draws_the_form_as_four_numbered_nodes() -> None:
    client = _disabled_client()
    body = client.post(f"{BASE}/map", json={"yaml": preset_yaml("sma_crossover")}).json()
    assert body["source_kind"] == "spec"
    assert [n["id"] for n in body["nodes"]] == ["params", "indicators", "conditions", "guard"]
    assert [n["numeral"] for n in body["nodes"]] == ["①", "②", "③", "④"]
    assert body["code"]["matches_map"] is True


def test_map_route_draws_code_with_line_ranges() -> None:
    client = _disabled_client()
    src = (
        "PARAMS = {'fast': {'default': 3}}\n"
        "def signals(df, p):\n"
        "    fast = bt.sma(df['close'], p['fast'])\n"
        "    entry = fast > 0\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry','exit']]\n"
    )
    body = client.post(f"{BASE}/map", json={"source": src}).json()
    assert body["source_kind"] == "code"
    nodes = {n["id"]: n for n in body["nodes"]}
    assert nodes["indicators"]["first_line"] == 3
    assert nodes["guard"]["status"] == "unknown"
    assert body["boundary_after_lines"] == {"first_line": 5, "last_line": 5}


def test_map_route_takes_exactly_one_of_yaml_or_source() -> None:
    client = _disabled_client()
    assert client.post(f"{BASE}/map", json={}).status_code == 422
    both = {"yaml": preset_yaml("sma_crossover"), "source": "x = 1"}
    assert client.post(f"{BASE}/map", json=both).status_code == 422
    assert client.post(f"{BASE}/map", json={"yaml": "just: text"}).status_code == 422


def test_map_route_fills_facts_from_a_real_run(tmp_path: Path) -> None:
    """오른쪽 "사실"은 지도가 계산한 값이 아니라 그 실행이 실제로 만든 값이다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        run_id = client.post(f"{BASE}/runs", json={"yaml": yaml_text}).json()["run_id"]
        _await_run(client, run_id)

        body = client.post(
            f"{BASE}/map", json={"yaml": yaml_text, "run_id": run_id, "version": 1}
        ).json()
        nodes = {n["id"]: n for n in body["nodes"]}
        assert any(f.startswith("df — ") for f in nodes["indicators"]["facts"])
        assert any(f.startswith("entry ") for f in nodes["conditions"]["facts"])
        assert body["version"] == 1
        assert body["target"]["symbol"] == "005930"


def test_codegen_route_returns_source_that_the_map_can_read_back() -> None:
    client = _disabled_client()
    body = client.post(f"{BASE}/codegen", json={"yaml": preset_yaml("sma_crossover")}).json()
    assert body["lines"] == len(body["source"].splitlines())
    assert "def signals(df, p):" in body["source"]
    mapped = client.post(f"{BASE}/map", json={"source": body["source"]}).json()
    assert mapped["unknown"] == [] and mapped["free_code"] == []
    assert client.post(f"{BASE}/codegen", json={"yaml": "  "}).status_code == 422


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


# 코드 모드에서 캔버스가 실제로 보내는 폼 — 신호를 코드가 만들어서 조건 칸이 비어 있다.
_NO_CONDITION_YAML_TEMPLATE = """
version: "1.0"
metadata:
  name: API 테스트 — 코드 전략
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
  entry: {{logic: AND, conditions: []}}
  exit: {{logic: AND, conditions: []}}
risk:
  stop_loss:   {{enabled: false, percent: 0}}
  take_profit: {{enabled: false, percent: 0}}
  position:    {{sizing: all_in}}
"""


def test_code_path_run_accepts_a_form_whose_conditions_are_empty(tmp_path: Path) -> None:
    """코드 전략은 신호를 자기가 만든다 — 폼의 조건 칸이 비어도 실행돼야 한다
    (2026-09-02 실측: 읽히지도 않는 폼 규칙에 걸려 422로 거부됐다)."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _NO_CONDITION_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        accepted = client.post(f"{BASE}/runs", json={"yaml": yaml_text, "source": _CODE_SOURCE})
        assert accepted.status_code == 202, accepted.json()
        run_id = accepted.json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done", result["error"]
        assert result["metrics"]["run_path"] == "code"


def test_form_path_run_rejects_empty_conditions_with_a_readable_message(tmp_path: Path) -> None:
    """폼 경로는 그대로 거부한다 — 다만 문구가 pydantic 덤프면 안 된다. 앱 오류 패널이
    이 문장을 그대로 보여준다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _NO_CONDITION_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        response = client.post(f"{BASE}/runs", json={"yaml": yaml_text})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "전략 yaml" in detail
    assert "strategy.entry.conditions" in detail
    assert "strategy.exit.conditions" in detail
    assert "pydantic" not in detail
    assert "too_short" not in detail


_CODE_WITHOUT_PARAMS = '''\
def signals(df, p):
    import athena_bt as bt
    print("p:", sorted(p))
    fast = bt.sma(df.close, int(p["fast"]))
    slow = bt.sma(df.close, int(p["slow"]))
    out = df.assign(entry=bt.cross_above(fast, slow), exit=bt.cross_below(fast, slow))
    return out[["entry", "exit"]]
'''


def test_code_path_inherits_form_param_defaults_when_code_has_no_params(tmp_path: Path) -> None:
    """코드에 PARAMS가 없어도 폼(yaml)의 파라미터 기본값이 p에 깔린다(2026-09-02 실측 —
    모델이 PARAMS를 빠뜨려 p["period"]가 KeyError로 죽었다).
    우선순위는 폼 < 코드 PARAMS < override."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        accepted = client.post(
            f"{BASE}/runs", json={"yaml": yaml_text, "source": _CODE_WITHOUT_PARAMS}
        )
        assert accepted.status_code == 202
        run_id = accepted.json()["run_id"]
        _await_run(client, run_id)
        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done", result["error"]
        assert "'fast'" in result["stdout"] and "'slow'" in result["stdout"]


# ── 코드 전략 배포 — 만들 수는 있는데 판정할 수 없는 막다른 길을 없앤다 ─────────


def _python_version(client: TestClient, source: str) -> str:
    return client.post(
        f"{BASE}/strategies", json={"name": "코드 배포", "kind": "python", "source": source}
    ).json()["version_id"]


def test_python_deployment_evaluates_instead_of_failing_yaml_parsing(tmp_path: Path) -> None:
    """kind=python 버전에 묶인 배포는 예전에 422("스펙으로 읽지 못했다")로 끝났다 —
    배포는 만들어지는데 영원히 판정되지 않는 막다른 길이었다(2026-09-02 실측)."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows(60)
        _seed_candles(client, "005930", "day", True, rows)
        version_id = _python_version(client, _CODE_SOURCE)
        dep_id = client.post(
            f"{BASE}/deployments", json=_deploy_body(version_id, mode="observe")
        ).json()["deployment_id"]

        res = client.post(
            f"{BASE}/deployments/{dep_id}/evaluate",
            json={"today": "20250301", "holding": False, "orders_today": 0, "order_amount": 100},
        )
        assert res.status_code == 200, res.json()
        body = res.json()
        assert body["stage"] in {
            "skipped", "signal", "pending_approval", "ordered", "blocked"
        }
        # 마지막 봉으로 판정했다는 증거 — 코드가 만든 신호가 실제 봉 위에 얹혔다.
        assert body["dt"] == datetime.strptime(rows[-1].dt, "%Y%m%d").strftime("%Y-%m-%d")


def test_python_deployment_reports_the_child_error_not_a_yaml_error(tmp_path: Path) -> None:
    """터진 것은 사용자 코드다 — yaml 파서 문구로 바꿔 말하면 사용자가 엉뚱한 곳을 고친다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows(60)
        _seed_candles(client, "005930", "day", True, rows)
        version_id = _python_version(client, _FAILING_CODE_SOURCE)
        dep_id = client.post(
            f"{BASE}/deployments", json=_deploy_body(version_id, mode="observe")
        ).json()["deployment_id"]

        res = client.post(
            f"{BASE}/deployments/{dep_id}/evaluate", json={"today": "20250301"}
        )
        assert res.status_code == 422
        detail = res.json()["detail"]
        assert "ValueError" in detail
        assert "전략 로직이 터졌다" in detail
        assert "block mapping" not in detail
        assert "스펙으로 읽지 못했다" not in detail


# ── 사용자 전략 등록부 · 유튜브 브리프 (결정 D2·D3·D5) ────────────────────────


_USER_STRATEGY_SOURCE = '''\
import athena_bt as bt

PARAMS = {
    "fast": {"default": 5, "min": 2, "max": 60, "step": 1},
    "slow": {"default": 20, "min": 5, "max": 240, "step": 1},
}


def signals(df, p):
    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    entry = bt.cross_above(fast, slow)
    exit_ = bt.cross_below(fast, slow)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''


def _install_projects_registry(monkeypatch: pytest.MonkeyPatch, roots: dict[str, Path]) -> None:
    """프로젝트 폴더 해석은 `athena_api/projects/store.py`가 소유한다 — 아직 없어서
    여기서는 그 계약(`resolve_project_path(id) -> Path`, 모르는 id면 KeyError)만
    sys.modules에 끼워 넣는다. 진짜 모듈이 생기면 이 대역과 같은지가 계약 검사다."""

    def resolve_project_path(project_id: str) -> Path:
        return roots[project_id]

    store = types.ModuleType("athena_api.projects.store")
    store.resolve_project_path = resolve_project_path  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "athena_api.projects", types.ModuleType("athena_api.projects"))
    monkeypatch.setitem(sys.modules, "athena_api.projects.store", store)


def _seed_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "projects" / "my-quant"
    root.mkdir(parents=True)
    _install_projects_registry(monkeypatch, {"p1": root})
    return root


def test_user_strategy_registration_points_at_the_file_and_reads_its_params(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """등록은 파일을 가리키기만 한다 — 소스를 복사하지 않는다(결정 D2). 목록의 params는
    프리셋과 같은 슬라이더를 그리라고 파일의 PARAMS에서 지금 읽은 값이다."""
    root = _seed_project(tmp_path, monkeypatch)
    (root / "strategies").mkdir()
    (root / "strategies" / "golden.py").write_text(_USER_STRATEGY_SOURCE, encoding="utf-8")

    with _client(tmp_path) as client:
        res = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "strategies/golden.py", "name": "골든크로스"},
        )
        assert res.status_code == 200, res.json()
        body = res.json()
        assert body["name"] == "골든크로스"
        assert body["project_id"] == "p1"
        assert body["path"] == "strategies/golden.py"
        assert body["id"] and body["created_at"]

        listed = client.get(f"{BASE}/user-strategies").json()["strategies"]
        assert listed == [
            {
                "id": body["id"],
                "name": "골든크로스",
                "project_id": "p1",
                "path": "strategies/golden.py",
                "exists": True,
                "params": {"fast": 5, "slow": 20},
            }
        ]


def test_user_strategy_without_signals_is_refused_with_the_validate_wording(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """POST /validate(kind=python)와 같은 문구여야 한다 — 같은 계약을 두 화면이 서로
    다른 말로 설명하면 사용자가 엉뚱한 곳을 고친다."""
    root = _seed_project(tmp_path, monkeypatch)
    (root / "notes.py").write_text("def helper(x):\n    return x\n", encoding="utf-8")

    with _client(tmp_path) as client:
        res = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "notes.py", "name": "메모"},
        )
        assert res.status_code == 422
        assert res.json()["detail"] == "최상위에 def signals(df, p): 함수가 없다(§7.1 계약)"
        assert client.get(f"{BASE}/user-strategies").json()["strategies"] == []


def test_only_python_files_can_be_registered(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """데이터 파일은 목록에는 보여도(다른 라우트) 이 등록부에는 못 들어온다(결정 D3)."""
    root = _seed_project(tmp_path, monkeypatch)
    (root / "prices.csv").write_text("dt,close\n20250102,100\n", encoding="utf-8")

    with _client(tmp_path) as client:
        res = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "prices.csv", "name": "가격표"},
        )
        assert res.status_code == 422
        assert res.json()["detail"] == "파이썬 파일(.py)만 등록할 수 있다"


def test_paths_this_feature_will_not_reach(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """프로젝트 폴더 밖과 없는 파일 — 둘 다 등록 전에 잘린다."""
    _seed_project(tmp_path, monkeypatch)
    (tmp_path / "outside.py").write_text(_USER_STRATEGY_SOURCE, encoding="utf-8")

    with _client(tmp_path) as client:
        escaped = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "../../outside.py", "name": "탈출"},
        )
        assert escaped.status_code == 422
        assert escaped.json()["detail"] == "프로젝트 폴더 밖의 경로다"

        missing = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "없는파일.py", "name": "없음"},
        )
        assert missing.status_code == 422
        assert "파일이 없다" in missing.json()["detail"]


def test_list_reports_a_vanished_file_as_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """exists는 저장된 값이 아니라 지금 디스크를 본 결과다 — 파일이 진실이다(D2)."""
    root = _seed_project(tmp_path, monkeypatch)
    target = root / "golden.py"
    target.write_text(_USER_STRATEGY_SOURCE, encoding="utf-8")

    with _client(tmp_path) as client:
        client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "golden.py", "name": "골든크로스"},
        )
        target.unlink()
        entry = client.get(f"{BASE}/user-strategies").json()["strategies"][0]
        assert entry["exists"] is False
        assert entry["params"] == {}


def test_unregister_removes_the_entry_but_never_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _seed_project(tmp_path, monkeypatch)
    target = root / "golden.py"
    target.write_text(_USER_STRATEGY_SOURCE, encoding="utf-8")

    with _client(tmp_path) as client:
        strategy_id = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "golden.py", "name": "골든크로스"},
        ).json()["id"]

        res = client.delete(f"{BASE}/user-strategies/{strategy_id}")
        assert res.status_code == 200
        assert res.json()["ok"] is True
        assert client.get(f"{BASE}/user-strategies").json()["strategies"] == []
        assert target.exists()  # 지운 것은 등록이지 사용자 파일이 아니다

        assert client.delete(f"{BASE}/user-strategies/{strategy_id}").status_code == 404


def test_registration_says_so_while_the_projects_store_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """프로젝트 등록부는 다른 모듈이 만드는 중이다 — 없으면 503으로 말한다(빈 결과로
    조용히 넘어가지 않는다). sys.modules에 None을 박아 import를 확실히 막는다."""
    monkeypatch.setitem(sys.modules, "athena_api.projects.store", None)

    with _client(tmp_path) as client:
        res = client.post(
            f"{BASE}/user-strategies",
            json={"project_id": "p1", "path": "golden.py", "name": "골든크로스"},
        )
        assert res.status_code == 503
        assert res.json()["detail"] == "프로젝트 저장소가 아직 없다"


def test_youtube_brief_refuses_a_url_that_is_not_youtube(tmp_path: Path) -> None:
    """네트워크로 나가기 전에 잘린다 — 이 테스트는 바깥을 두드리지 않는다."""
    with _client(tmp_path) as client:
        res = client.post(f"{BASE}/youtube/brief", json={"url": "https://vimeo.com/123456789"})
        assert res.status_code == 422
        assert "유튜브 주소가 아니다" in res.json()["detail"]

        empty = client.post(f"{BASE}/youtube/brief", json={})
        assert empty.status_code == 422


# ── 프로젝트 가상환경으로 파일 실행 (WAVE-3: 등록 → 실행 → 배포) ──────────────

# 가상환경에만 설치돼 있는 사용자 패키지. dist-info까지 같이 두는 이유는 허용목록이
# **거기서** 나오기 때문이다 — 파일만 떨어뜨리면 import 이름이 목록에 안 잡힌다.
_VENV_ONLY_PACKAGE = """def mean(series, n):
    return series.rolling(n).mean()
"""

_VENV_STRATEGY_SOURCE = """import myindicator

PARAMS = {}


def signals(df, p):
    fast = myindicator.mean(df.close, 2)
    slow = myindicator.mean(df.close, 5)
    return df.assign(entry=fast > slow, exit=fast <= slow)[["entry", "exit"]]
"""


def _seed_project_with_venv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """프로젝트 폴더 + 그 안의 진짜 `.venv` + 그 환경에만 있는 패키지 하나.

    `--without-pip`에 백엔드 site-packages를 `.pth`로 이어 pandas만 빌려온다 — 네트워크
    없이 "다른 인터프리터로 떴는가"를 물을 수 있는 가장 짧은 배치다.
    """
    from athena_api.projects.store import venv_site_packages

    root = tmp_path / "projects" / "my-quant"
    root.mkdir(parents=True)
    subprocess.run(
        [sys.executable, "-m", "venv", "--without-pip", str(root / ".venv")],
        check=True, capture_output=True, timeout=180,
    )
    site = venv_site_packages(root)
    assert site is not None
    site.joinpath("_athena_test_link.pth").write_text(
        str(Path(pd.__file__).resolve().parent.parent), encoding="utf-8"
    )
    site.joinpath("myindicator.py").write_text(_VENV_ONLY_PACKAGE, encoding="utf-8")
    site.joinpath("myindicator-1.0.dist-info").mkdir()
    _install_projects_registry(monkeypatch, {"p1": root})
    return root


def test_run_returns_the_ids_the_canvas_needs_to_deploy(tmp_path: Path) -> None:
    """실행 응답이 strategy_id·version_id를 같이 준다 — 없으면 화면이 "방금 그 실행이 어느
    전략 버전이었나"를 추측해야 하고, 추측은 다른 행을 배포한다."""
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        accepted = client.post(f"{BASE}/runs", json={"yaml": yaml_text, "source": _CODE_SOURCE})
        assert accepted.status_code == 202
        body = accepted.json()
        _await_run(client, body["run_id"])

        versions = client.get(f"{BASE}/strategies/{body['strategy_id']}/versions").json()
        assert [v["id"] for v in versions["versions"]] == [body["version_id"]]
        assert versions["versions"][0]["source"] == _CODE_SOURCE

        # 그 version_id 하나로 곧바로 배포가 선다 — 이것이 "실매매 적용"의 다음 칸이다.
        deployed = client.post(f"{BASE}/deployments", json=_deploy_body(body["version_id"]))
        assert deployed.status_code == 200, deployed.text


def test_run_with_project_id_uses_the_project_venv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`project_id`를 실으면 그 폴더의 가상환경으로 돈다 — 사용자가 자기 환경에 깐 패키지를
    전략 코드가 실제로 쓸 수 있어야 "내 전략"이 성립한다."""
    _seed_project_with_venv(tmp_path, monkeypatch)
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        payload = {"yaml": yaml_text, "source": _VENV_STRATEGY_SOURCE, "project_id": "p1"}

        accepted = client.post(f"{BASE}/runs", json=payload)
        assert accepted.status_code == 202
        run_id = accepted.json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done", result["error"]
        assert result["metrics"]["run_path"] == "code"
        assert len(result["equity"]) == len(rows)


def test_same_run_without_the_project_cannot_see_that_package(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """앞 테스트가 정말 프로젝트 환경 덕인지 — `project_id` 없이 같은 코드를 돌리면
    그 패키지가 없어서 실패한다. 실패 문구는 사용자 코드의 것 그대로다."""
    _seed_project_with_venv(tmp_path, monkeypatch)
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        run_id = client.post(
            f"{BASE}/runs", json={"yaml": yaml_text, "source": _VENV_STRATEGY_SOURCE}
        ).json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "failed"
        assert "myindicator" in result["error"]


def test_run_rejects_an_unknown_project_and_a_non_string_one(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        rows = _synthetic_candle_rows()
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        bad_type = client.post(
            f"{BASE}/runs", json={"yaml": yaml_text, "source": _CODE_SOURCE, "project_id": 7}
        )
        assert bad_type.status_code == 422

        unknown = client.post(
            f"{BASE}/runs",
            json={"yaml": yaml_text, "source": _CODE_SOURCE, "project_id": "없는프로젝트"},
        )
        assert unknown.status_code == 404
