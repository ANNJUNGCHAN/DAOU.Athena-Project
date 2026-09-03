"""기법 저작 라우트 — 계약 모양과 **부작용 없음**을 고정한다.

`/visual/*`과 같은 자리다: 백테스트 서브시스템(DB)이 꺼져 있어도 노드와 앞 두 검사는
성립해야 한다. 저장하는 것이 없기 때문이다. 봉 캐시가 필요한 시험 실행만 store에 닿고,
그때도 **읽기만** 한다 — run/backfill/activate/deploy를 터지는 함수로 갈아끼운 채 두
라우트를 두드려 그 부재를 증명한다.
"""

from __future__ import annotations

import inspect
import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from athena_api.backtest import data as data_mod
from athena_api.backtest import deploy as deploy_mod
from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.store import BacktestStore, Candle
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest/technique"

CROSSOVER = '''import athena_bt as bt

PARAMS = {
    "fast": {"default": 3, "min": 2, "max": 10, "step": 1, "type": "int"},
    "slow": {"default": 5, "min": 3, "max": 20, "step": 1, "type": "int"},
}


def signals(df, p):
    ma_fast = bt.sma(df["close"], period=p["fast"])
    ma_slow = bt.sma(df["close"], period=p["slow"])
    entry = bt.cross_above(ma_fast, ma_slow)
    exit_ = bt.cross_below(ma_fast, ma_slow)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''

FUNCTIONAL = '''def compute_band(df, p):
    """20봉 최고가 — 돌파선."""
    return df["high"].rolling(20).max()


def should_enter(df, band):
    return df["close"] > band


def should_exit(df, band):
    return df["close"] < band


def signals(df, p):
    band = compute_band(df, p)
    entry = should_enter(df, band)
    exit_ = should_exit(df, band)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''


def _disabled_client() -> TestClient:
    """백테스트 서브시스템이 **꺼진** 앱 — 기법 라우트는 DB 없이 성립해야 한다."""
    return TestClient(create_app(Settings(_env_file=None)))


def _client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                _env_file=None,
                backtest_enabled=True,
                backtest_db_path=tmp_path / "backtest.sqlite3",
            )
        )
    )


def _candles(n: int = 320) -> list[Candle]:
    closes = [100 + i * 0.3 + 4 * math.sin(i / 5.0) for i in range(n)]
    base = date(2024, 1, 2)
    return [
        Candle(
            dt=(base + timedelta(days=i)).strftime("%Y%m%d"),
            open=close, high=close + 1, low=close - 1, close=close, volume=1000 + i,
        )
        for i, close in enumerate(closes)
    ]


def _seed(client: TestClient, stk_cd: str, period: str, adjusted: bool) -> None:
    """store는 포탈 스레드의 이벤트 루프 위에서 열렸다 — 같은 루프에서 써야 한다."""
    store = client.app.state.backtest_store
    rows = _candles()
    client.portal.call(lambda: store.upsert_candles(stk_cd, period, adjusted, rows))
    client.portal.call(
        lambda: store.upsert_coverage(
            stk_cd, period, adjusted,
            first_dt=rows[0].dt, last_dt=rows[-1].dt, fetched_at=datetime.now(UTC), pages=1,
        )
    )


# ── 노드 ────────────────────────────────────────────────────────────────────


def test_nodes_work_even_when_the_backtest_subsystem_is_off() -> None:
    body = _disabled_client().post(f"{BASE}/nodes", json={"source": FUNCTIONAL}).json()
    assert body["granularity"] == "function"
    assert [n["id"] for n in body["nodes"]] == [
        "compute_band", "should_enter", "should_exit", "signals",
    ]
    assert body["flows"]["entry"] == ["compute_band", "should_enter"]
    assert body["flows"]["exit"] == ["compute_band", "should_exit"]
    assert body["error"] is None


def test_nodes_falls_back_to_stages_when_signals_is_the_only_function() -> None:
    body = _disabled_client().post(f"{BASE}/nodes", json={"source": CROSSOVER}).json()
    assert body["granularity"] == "stage"
    assert [n["stage"] for n in body["nodes"]] == [
        "prepare", "indicators", "conditions", "output",
    ]


def test_nodes_returns_error_for_broken_code_instead_of_500() -> None:
    response = _disabled_client().post(f"{BASE}/nodes", json={"source": "def signals(:\n"})
    assert response.status_code == 200
    assert response.json()["error"]


# ── 검사 ────────────────────────────────────────────────────────────────────


def test_check_runs_the_first_two_even_without_a_database() -> None:
    body = _disabled_client().post(f"{BASE}/check", json={"source": CROSSOVER}).json()
    checks = {c["id"]: c for c in body["checks"]}
    assert checks["syntax"]["ok"] is True
    assert checks["contract"]["ok"] is True
    assert checks["dryrun"]["detail_ko"] == "봉 캐시 없음 — 대상을 정하면 시험 실행합니다"
    assert body["passed"] is False
    assert body["stats"] is None


def test_check_with_a_cached_symbol_actually_runs_the_signals(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        _seed(client, "005930", "day", True)
        body = client.post(
            f"{BASE}/check", json={"source": CROSSOVER, "symbol": "005930", "period": "day"}
        ).json()
    assert body["passed"] is True, body["log"]
    assert body["stats"]["rows"] == 300
    assert body["stats"]["entry"] > 0 and body["stats"]["exit"] > 0
    assert any("005930 day 최근 300봉" in line for line in body["log"])


def test_check_falls_back_to_unadjusted_bars_when_that_is_what_the_cache_has(
    tmp_path: Path,
) -> None:
    """몸통에 adjusted가 없다 — 검사 대상은 "캐시에 있는 봉"이라 있는 쪽을 쓴다."""
    with _client(tmp_path) as client:
        _seed(client, "000660", "day", False)
        body = client.post(
            f"{BASE}/check", json={"source": CROSSOVER, "symbol": "000660", "period": "day"}
        ).json()
    assert body["passed"] is True, body["log"]


def test_check_says_no_bars_for_a_symbol_the_cache_never_saw(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        body = client.post(
            f"{BASE}/check", json={"source": CROSSOVER, "symbol": "999999", "period": "day"}
        ).json()
    checks = {c["id"]: c for c in body["checks"]}
    assert checks["dryrun"]["detail_ko"] == "봉 캐시 없음 — 대상을 정하면 시험 실행합니다"


@pytest.mark.parametrize("path", ["/nodes", "/check"])
@pytest.mark.parametrize("body", [{}, {"source": ""}, {"source": 5}])
def test_missing_source_is_422(path: str, body: dict[str, Any]) -> None:
    assert _disabled_client().post(f"{BASE}{path}", json=body).status_code == 422


def test_check_carries_the_principle_items_with_a_severity_each() -> None:
    """렌더러는 항목을 세지 않는다 — 받은 배열을 그대로 그리고 severity 하나만 읽는다."""
    body = _disabled_client().post(f"{BASE}/check", json={"source": FUNCTIONAL}).json()
    assert [c["id"] for c in body["checks"]] == [
        "syntax", "contract", "dryrun", "lookahead", "warmup", "magic", "structure",
    ]
    assert {c["id"]: c["severity"] for c in body["checks"]} == {
        "syntax": "block",
        "contract": "block",
        "dryrun": "block",
        "lookahead": "block",
        "warmup": "block",
        "magic": "warn",
        "structure": "warn",
    }
    checks = {c["id"]: c for c in body["checks"]}
    assert checks["lookahead"]["ok"] is True
    # PARAMS가 없는 샘플이라 창 길이 20이 매직 넘버로 남는다 — 경고지 차단이 아니다.
    assert checks["magic"]["ok"] is False
    assert "3번째 줄: 20" in checks["magic"]["detail_ko"]
    assert checks["structure"]["ok"] is False
    assert "노드 설명이 없습니다: should_enter() · should_exit() · signals()" in (
        checks["structure"]["detail_ko"]
    )


def test_check_reports_the_line_that_looks_at_the_next_bar() -> None:
    source = FUNCTIONAL.replace('return df["close"] > band', 'return df["close"].shift(-1) > band')
    body = _disabled_client().post(f"{BASE}/check", json={"source": source}).json()
    checks = {c["id"]: c for c in body["checks"]}
    assert checks["lookahead"]["ok"] is False
    assert "shift(-1)은 다음 봉의 값을 당겨옵니다" in checks["lookahead"]["detail_ko"]
    assert body["passed"] is False
    assert body["error"]["line"] == 7


def test_a_warning_alone_does_not_close_the_node_window(tmp_path: Path) -> None:
    """경고 하나에 노드 창이 닫히면 사용자는 원칙을 배우는 대신 피해 다니게 된다."""
    with _client(tmp_path) as client:
        _seed(client, "005930", "day", True)
        body = client.post(
            f"{BASE}/check", json={"source": CROSSOVER, "symbol": "005930", "period": "day"}
        ).json()
    checks = {c["id"]: c for c in body["checks"]}
    assert checks["structure"]["ok"] is False and checks["structure"]["severity"] == "warn"
    assert all(c["ok"] for c in body["checks"] if c["severity"] == "block"), body["log"]
    assert body["passed"] is True


# ── 부작용 울타리 ────────────────────────────────────────────────────────────


def test_routes_never_reach_runner_backfill_activate_or_deploy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """넷 중 하나라도 불리면 그 자리에서 터진다 — 시험 실행은 signals만 돌린다."""

    def forbidden(name: str) -> Any:
        def _boom(*_args: Any, **_kwargs: Any) -> Any:
            raise AssertionError(f"기법 라우트가 {name}을(를) 불렀다")

        return _boom

    with _client(tmp_path) as client:
        _seed(client, "005930", "day", True)

        monkeypatch.setattr(BacktestRunner, "start_run", forbidden("runner.start_run"))
        monkeypatch.setattr(BacktestRunner, "start_backfill", forbidden("runner.start_backfill"))
        monkeypatch.setattr(BacktestStore, "activate_version", forbidden("store.activate_version"))
        monkeypatch.setattr(BacktestStore, "add_version", forbidden("store.add_version"))
        monkeypatch.setattr(BacktestStore, "create_run", forbidden("store.create_run"))
        monkeypatch.setattr(BacktestStore, "upsert_candles", forbidden("store.upsert_candles"))
        monkeypatch.setattr(data_mod, "kiwoom_fetch_page", forbidden("data.kiwoom_fetch_page"))
        monkeypatch.setattr(deploy_mod, "evaluate_latest", forbidden("deploy.evaluate_latest"))

        assert client.post(f"{BASE}/nodes", json={"source": FUNCTIONAL}).status_code == 200
        check = client.post(
            f"{BASE}/check", json={"source": CROSSOVER, "symbol": "005930", "period": "day"}
        )
    assert check.status_code == 200
    assert check.json()["passed"] is True


def test_a_dry_run_leaves_no_run_history_behind(tmp_path: Path) -> None:
    """시험 실행은 결과를 저장하지 않는다 — 실행 목록이 비어 있어야 그 말이 참이다."""
    with _client(tmp_path) as client:
        _seed(client, "005930", "day", True)
        before = client.get("/api/v1/backtest/runs").json()["runs"]
        client.post(
            f"{BASE}/check", json={"source": CROSSOVER, "symbol": "005930", "period": "day"}
        )
        after = client.get("/api/v1/backtest/runs").json()["runs"]
        strategies = client.get("/api/v1/backtest/strategies").json()["strategies"]
    assert before == after == []
    assert strategies == []


def test_the_route_module_does_not_import_the_runner_or_the_write_surface() -> None:
    """부재를 파일 경계로도 고정한다. `backtest_store`는 있다 — 봉을 **읽기만** 한다."""
    from athena_api.api import backtest_technique

    source = Path(inspect.getfile(backtest_technique)).read_text(encoding="utf-8")
    for forbidden in (
        "BacktestRunner", "backtest_runner", "start_run", "start_backfill",
        "upsert_candles", "add_version", "create_run", "activate_version",
        "deploy_mod", "import deploy",
    ):
        assert forbidden not in source
