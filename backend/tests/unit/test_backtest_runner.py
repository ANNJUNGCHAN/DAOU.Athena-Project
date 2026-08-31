"""백테스트 잡 러너 계약(§6.1 runner.py) — run/backfill 잡의 생성→완료, 실패 전파, 취소.

키움 클라이언트는 부르지 않는다 — backfill은 `data.py`의 `fetch_page` 계약을 흉내 내는
가짜를 주입한다(`test_backtest_data.py`와 같은 방식). run은 `compile_signals`/`run_backtest`
를 진짜로 돌린다 — 둘 다 순수 함수라 결정적이다.
"""

from __future__ import annotations

import asyncio
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.schema import from_kis_yaml
from athena_api.backtest.store import BacktestStore
from athena_api.brain.db import SqliteOwner

# 결정층(leaf 9): LLM도 난수도 타지 않는다 — 잡 상태 전이 계약만 검증한다.
pytestmark = pytest.mark.deterministic

_NOW = datetime(2026, 8, 31, 3, 0, tzinfo=UTC)

_SMA_CROSS_YAML = """
version: "1.0"
metadata:
  name: 러너 테스트 — SMA 교차
strategy:
  id: t1
  params:
    fast: {default: 3, min: 2, max: 10, step: 1, type: int}
    slow: {default: 5, min: 2, max: 20, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast"}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}
risk:
  stop_loss:   {enabled: false, percent: 0}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""


@pytest.fixture
async def owner(tmp_path: Path):
    instance = SqliteOwner(tmp_path / "athena-backtest.sqlite3")
    await instance.open()
    try:
        yield instance
    finally:
        if instance.is_open:
            await instance.close()


@pytest.fixture
async def store(owner: SqliteOwner) -> BacktestStore:
    instance = BacktestStore(owner)
    await instance.open()
    return instance


def _synthetic_df(n: int = 40) -> pd.DataFrame:
    """SMA(3)/SMA(5) 골든·데드 크로스가 각각 한 번씩 나오는 합성 봉(§6.4 체결 검증과 같은
    파형) — run 잡이 실제로 체결·자산곡선을 만든다는 것까지 확인하기 위한 최소 데이터."""
    close = [100 + i * 0.3 + 4 * math.sin(i / 5.0) for i in range(n)]
    high = [c + 1 for c in close]
    low = [c - 1 for c in close]
    open_ = [close[i - 1] * 1.001 if i > 0 else close[0] for i in range(n)]
    volume = [1000 + 10 * i for i in range(n)]
    idx = pd.date_range("2024-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


async def _seed_run(store: BacktestStore, run_id: str) -> None:
    """`bt_run.strategy_version_id`는 FK(NOT NULL)다 — runner는 그 행이 이미 있다고
    전제한다(api/backtest.py가 실제로 만드는 순서와 동형)."""
    await store.create_strategy(f"strat-{run_id}", "러너 테스트 전략", "yaml", created_at=_NOW)
    version_id = f"ver-{run_id}"
    await store.add_version(
        version_id, f"strat-{run_id}", 1, "yaml-source",
        origin="form", created_at=_NOW, active=True,
    )
    await store.create_run(
        run_id, version_id, params_json="{}", spec_hash="hash", status="running", started_at=_NOW,
    )


class _SlowFetch:
    """취소 테스트용 — 호출되면 `started`를 켜고 `release`가 켜질 때까지 영원히 대기한다.
    실시간 sleep이 아니라 이벤트로 동기화해 결정적이다(테스트가 정확히 이 지점에서
    태스크가 멈췄다는 것을 실시간 무관하게 확인할 수 있다)."""

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def __call__(
        self, tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        self.started.set()
        await self.release.wait()
        raise AssertionError("release가 켜지면 안 된다 — 취소로만 끝나야 하는 테스트다")


def _ka10081_page(dts_desc: list[str], *, close: float = 100.0) -> dict[str, Any]:
    return {
        "stk_dt_pole_chart_qry": [
            {
                "dt": dt, "cur_prc": f"+{close:.0f}", "trde_qty": "1000",
                "open_pric": f"{close - 1:.0f}", "high_pric": f"{close + 1:.0f}",
                "low_pric": f"{close - 2:.0f}",
            }
            for dt in dts_desc
        ],
    }


def _two_page_fetch():
    pages = [_ka10081_page(["20260105", "20260104"]), _ka10081_page(["20260103", "20260102"])]

    async def fetch(
        tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        idx = 0 if cont_yn != "Y" else 1
        is_last = idx == len(pages) - 1
        return pages[idx], ("N" if is_last else "Y"), (None if is_last else "key1")

    return fetch


async def _boom_fetch(
    tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
) -> tuple[dict[str, Any], str, str | None]:
    raise RuntimeError("kiwoom boom")


# ── run 잡 ───────────────────────────────────────────────────────────────────


async def test_start_run_completes_and_persists_results(store: BacktestStore) -> None:
    spec = from_kis_yaml(_SMA_CROSS_YAML)
    df = _synthetic_df()
    await _seed_run(store, "run-ok")
    runner = BacktestRunner(store)

    job = runner.start_run("run-ok", spec=spec, df=df, overrides=None)
    await job.task

    assert job.status == "done"
    row = await store.run("run-ok")
    assert row is not None
    assert row.status == "done"
    assert row.finished_at is not None
    assert row.metrics_json is not None
    metrics = json.loads(row.metrics_json)
    assert "total_return" in metrics
    assert "sharpe" in metrics

    equity = await store.equity("run-ok")
    assert len(equity) == len(df)


async def test_start_run_applies_param_overrides(store: BacktestStore) -> None:
    """오버라이드가 실제로 반영됐다는 것 자체는 compile.py 몫이지만, 러너가 그 인자를
    그대로 전달하는지는 여기서 확인한다 — 오버라이드 없이 돌린 것과 자산곡선이 달라야
    한다(같으면 인자가 조용히 버려졌다는 뜻)."""
    spec = from_kis_yaml(_SMA_CROSS_YAML)
    df = _synthetic_df()
    await _seed_run(store, "run-a")
    await _seed_run(store, "run-b")
    runner = BacktestRunner(store)

    job_a = runner.start_run("run-a", spec=spec, df=df, overrides=None)
    job_b = runner.start_run("run-b", spec=spec, df=df, overrides={"fast": 2, "slow": 20})
    await job_a.task
    await job_b.task

    equity_a = [p.equity for p in await store.equity("run-a")]
    equity_b = [p.equity for p in await store.equity("run-b")]
    assert equity_a != equity_b


async def test_start_run_failure_sets_failed_status_and_records_error(
    store: BacktestStore,
) -> None:
    bad_yaml = _SMA_CROSS_YAML.replace("compare_to: ma_slow", "compare_to: does_not_exist")
    spec = from_kis_yaml(bad_yaml)
    df = _synthetic_df()
    await _seed_run(store, "run-fail")
    runner = BacktestRunner(store)

    job = runner.start_run("run-fail", spec=spec, df=df, overrides=None)
    await job.task

    assert job.status == "failed"
    assert job.error is not None and "does_not_exist" in job.error
    row = await store.run("run-fail")
    assert row is not None
    assert row.status == "failed"
    assert row.error is not None and "does_not_exist" in row.error
    assert row.metrics_json is None


# ── backfill 잡 ──────────────────────────────────────────────────────────────


async def test_start_backfill_tracks_progress_and_completes(store: BacktestStore) -> None:
    runner = BacktestRunner(store)
    job = runner.start_backfill(
        "job-ok", fetch_page=_two_page_fetch(), stk_cd="005930", period="day",
        adjusted=True, base_dt="20260105", from_dt="20260102",
    )
    await job.task

    assert job.status == "done"
    assert job.progress is not None
    assert job.progress.page == 2
    assert job.progress.oldest_dt == "20260102"
    rows = await store.candles("005930", "day", True)
    assert [r.dt for r in rows] == ["20260102", "20260103", "20260104", "20260105"]


async def test_start_backfill_failure_sets_failed_status(store: BacktestStore) -> None:
    runner = BacktestRunner(store)
    job = runner.start_backfill(
        "job-fail", fetch_page=_boom_fetch, stk_cd="005930", period="day",
        adjusted=True, base_dt="20260105", from_dt="20260102",
    )
    await job.task

    assert job.status == "failed"
    assert job.error is not None and "kiwoom boom" in job.error


# ── 조회·취소 ────────────────────────────────────────────────────────────────


def test_get_returns_none_for_unknown_job(store: BacktestStore) -> None:
    runner = BacktestRunner(store)
    assert runner.get("nope") is None


async def test_cancel_returns_false_for_unknown_job(store: BacktestStore) -> None:
    runner = BacktestRunner(store)
    assert runner.cancel("nope") is False


async def test_cancel_returns_false_for_already_finished_job(store: BacktestStore) -> None:
    runner = BacktestRunner(store)
    job = runner.start_backfill(
        "job-done", fetch_page=_two_page_fetch(), stk_cd="005930", period="day",
        adjusted=True, base_dt="20260105", from_dt="20260102",
    )
    await job.task
    assert runner.cancel("job-done") is False


async def test_cancel_marks_running_backfill_job_cancelled(store: BacktestStore) -> None:
    fetch = _SlowFetch()
    runner = BacktestRunner(store)
    job = runner.start_backfill(
        "job-cancel", fetch_page=fetch, stk_cd="005930", period="day",
        adjusted=True, base_dt="20260105", from_dt="20260102",
    )
    await fetch.started.wait()
    assert runner.cancel("job-cancel") is True
    with pytest.raises(asyncio.CancelledError):
        await job.task
    assert job.status == "cancelled"


async def test_shutdown_cancels_live_jobs(store: BacktestStore) -> None:
    fetch = _SlowFetch()
    runner = BacktestRunner(store)
    job = runner.start_backfill(
        "job-shutdown", fetch_page=fetch, stk_cd="005930", period="day",
        adjusted=True, base_dt="20260105", from_dt="20260102",
    )
    await fetch.started.wait()
    await runner.shutdown()
    assert job.task is not None and job.task.done()
    assert job.status == "cancelled"
