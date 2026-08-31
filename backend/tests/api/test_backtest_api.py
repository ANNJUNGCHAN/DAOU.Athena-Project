"""백테스트 라우트(§6.6) — 프리셋/지표/검증/데이터 계획/실행(성공+409)/상태/결과/체결/취소.

키움 클라이언트는 부르지 않는다 — 캔들은 `client.portal.call(...)`로 seed된 store에
직접 upsert한다(포탈 스레드의 이벤트 루프에서 store를 열었으므로 같은 루프에서
써야 한다). `backfill`만 진짜 키움 클라이언트가 필요해 그 라우트는 신용정보 없는 앱에서
503(KiwoomNotReadyError)로 gate되는지만 본다.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

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
    """SMA(3)/SMA(5) 골든·데드 크로스가 각각 한 번씩 나오는 합성 봉 — runner 유닛
    테스트의 `_synthetic_df`와 같은 파형을 Candle 행으로 만든다."""
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
    """store는 포탈 스레드의 이벤트 루프 위에서 열렸다(lifespan) — 같은 루프에서 써야
    `asyncio.Lock`이 "다른 루프에 묶였다"고 거부하지 않는다. `client.portal.call`이 그
    루프로 진입하는 유일하게 안전한 통로다."""
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


# ── 조회 전용: 프리셋·지표·검증 (백테스트 비활성이어도 동작) ────────────────────


def test_presets_and_indicators_work_even_when_backtest_disabled() -> None:
    client = _disabled_client()
    presets = client.get(f"{BASE}/presets").json()["presets"]
    assert len(presets) == 10
    assert all({"id", "name", "category", "yaml"} <= set(p) for p in presets)

    indicators = client.get(f"{BASE}/indicators").json()["indicators"]
    ids = {i["id"] for i in indicators}
    assert {"SMA", "RSI"} <= ids


def test_validate_yaml_accepts_valid_and_rejects_invalid() -> None:
    client = _disabled_client()
    ok = client.post(
        f"{BASE}/validate", json={"kind": "yaml", "source": preset_yaml("sma_crossover")}
    )
    assert ok.json() == {"ok": True, "errors": []}

    bad = client.post(f"{BASE}/validate", json={"kind": "yaml", "source": "not: [valid"})
    body = bad.json()
    assert body["ok"] is False
    assert body["errors"]


def test_validate_python_checks_syntax_and_signals_function() -> None:
    client = _disabled_client()
    ok = client.post(
        f"{BASE}/validate",
        json={"kind": "python", "source": "def signals(df, p):\n    return df"},
    )
    assert ok.json() == {"ok": True, "errors": []}

    missing = client.post(f"{BASE}/validate", json={"kind": "python", "source": "x = 1"})
    assert missing.json()["ok"] is False

    syntax_err = client.post(f"{BASE}/validate", json={"kind": "python", "source": "def signals(:"})
    assert syntax_err.json()["ok"] is False


# ── 서브시스템 비활성 gate ───────────────────────────────────────────────────


def test_store_gated_routes_503_when_backtest_disabled() -> None:
    client = _disabled_client()
    response = client.get(f"{BASE}/runs")
    assert response.status_code == 503


# ── 데이터 커버리지·계획 ─────────────────────────────────────────────────────


def test_data_coverage_reports_zero_rows_when_uncached(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        body = client.get(
            f"{BASE}/data/coverage",
            params={"stk_cd": "005930", "period": "day", "adjusted": True},
        ).json()
    assert body == {
        "stk_cd": "005930", "period": "day", "adjusted": True,
        "first_dt": None, "last_dt": None, "rows": 0,
    }


def test_data_coverage_reports_seeded_rows(tmp_path: Path) -> None:
    rows = _synthetic_candle_rows(10)
    with _client(tmp_path) as client:
        _seed_candles(client, "005930", "day", True, rows)
        body = client.get(
            f"{BASE}/data/coverage",
            params={"stk_cd": "005930", "period": "day", "adjusted": True},
        ).json()
    assert body["rows"] == 10
    assert body["first_dt"] == rows[0].dt
    assert body["last_dt"] == rows[-1].dt


def test_data_plan_reports_no_gap_when_fully_cached(tmp_path: Path) -> None:
    rows = _synthetic_candle_rows(10)
    with _client(tmp_path) as client:
        _seed_candles(client, "005930", "day", True, rows)
        body = client.post(
            f"{BASE}/data/plan",
            json={
                "stk_cd": "005930", "period": "day", "adjusted": True,
                "from_dt": rows[0].dt, "to_dt": rows[-1].dt,
            },
        ).json()
    assert body["cached_rows"] == 10
    assert body["needed_pages"] == 0
    assert body["segments"] == []


def test_data_plan_reports_gap_when_uncached(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        body = client.post(
            f"{BASE}/data/plan",
            json={
                "stk_cd": "005930", "period": "day", "adjusted": True,
                "from_dt": "20250101", "to_dt": "20250201",
            },
        ).json()
    assert body["cached_rows"] == 0
    assert body["needed_pages"] > 0
    assert body["segments"] == [{"from_dt": "20250101", "to_dt": "20250201"}]


# ── 실행 ─────────────────────────────────────────────────────────────────────


def test_run_success_flow_computes_metrics_trades_and_equity(tmp_path: Path) -> None:
    rows = _synthetic_candle_rows(40)
    with _client(tmp_path) as client:
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )

        response = client.post(f"{BASE}/runs", json={"yaml": yaml_text})
        assert response.status_code == 202
        run_id = response.json()["run_id"]
        _await_run(client, run_id)

        result = client.get(f"{BASE}/runs/{run_id}").json()
        assert result["status"] == "done"
        assert result["metrics"] is not None
        assert "total_return" in result["metrics"]
        assert len(result["equity"]) == len(rows)
        assert result["equity"][0].keys() == {"dt", "equity", "drawdown"}

        trades = client.get(f"{BASE}/runs/{run_id}/trades").json()["trades"]
        assert isinstance(trades, list)

        listed = client.get(f"{BASE}/runs").json()["runs"]
        assert any(r["run_id"] == run_id and r["status"] == "done" for r in listed)


def test_run_returns_409_with_needed_pages_when_cache_insufficient(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt="20250101", to_dt="20250201"
        )
        response = client.post(f"{BASE}/runs", json={"yaml": yaml_text})
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["needed_pages"] > 0
    assert "est_seconds" in detail


def test_run_rejects_yaml_without_data_block(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.post(f"{BASE}/runs", json={"yaml": preset_yaml("sma_crossover")})
    assert response.status_code == 422


def test_run_rejects_multi_symbol_data_spec(tmp_path: Path) -> None:
    yaml_text = _RUN_YAML_TEMPLATE.format(
        stk_cd="005930", from_dt="20250101", to_dt="20250201"
    ).replace('symbols: ["005930"]', 'symbols: ["005930", "000660"]')
    with _client(tmp_path) as client:
        response = client.post(f"{BASE}/runs", json={"yaml": yaml_text})
    assert response.status_code == 422


def test_run_not_found_returns_404(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get(f"{BASE}/runs/does-not-exist")
    assert response.status_code == 404


def test_cancel_run_not_found_returns_404(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.delete(f"{BASE}/runs/does-not-exist")
    assert response.status_code == 404


def test_cancel_run_returns_ok_true_once_finished(tmp_path: Path) -> None:
    rows = _synthetic_candle_rows(40)
    with _client(tmp_path) as client:
        _seed_candles(client, "005930", "day", True, rows)
        yaml_text = _RUN_YAML_TEMPLATE.format(
            stk_cd="005930", from_dt=rows[0].dt, to_dt=rows[-1].dt
        )
        run_id = client.post(f"{BASE}/runs", json={"yaml": yaml_text}).json()["run_id"]
        _await_run(client, run_id)

        response = client.delete(f"{BASE}/runs/{run_id}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


# ── 백필·잡 폴링 ─────────────────────────────────────────────────────────────


def test_backfill_requires_ready_kiwoom_client(tmp_path: Path) -> None:
    """이 앱에는 키움 자격증명이 없다 — `KiwoomClientDep`이 503으로 gate해야 한다."""
    with _client(tmp_path) as client:
        response = client.post(
            f"{BASE}/data/backfill",
            json={
                "stk_cd": "005930", "period": "day", "adjusted": True,
                "from_dt": "20250101", "to_dt": "20250201",
            },
        )
    assert response.status_code == 503


def test_get_job_404_for_unknown_job(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get(f"{BASE}/jobs/does-not-exist")
    assert response.status_code == 404
