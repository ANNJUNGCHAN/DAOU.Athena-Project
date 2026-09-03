"""코드 감시 실행기 — 계획 B-8 (마지막 행 판정 · duration_ms) · B-19 (jobdir 정리 · 동시 상한)."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from athena_api.watch import runner as wr

pytestmark = pytest.mark.deterministic

_ALWAYS_FIRE = """PARAMS = {"k": 1}
NODE_LABELS = {"signals": "알림"}


def signals(df, p):
    fired = df.volume > 0
    return df.assign(entry=fired, exit=False)[["entry", "exit"]]
"""


def _bars(n: int = 10) -> pd.DataFrame:
    idx = pd.date_range("2026-08-01", periods=n, freq="D")
    close = pd.Series(100 + np.arange(n) * 0.5, index=idx)
    return pd.DataFrame(
        {"open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 1000},
        index=idx,
    )


def test_trace_names_for_lists_top_level_functions_in_order():
    src = "def a(df):\n    return df\n\ndef signals(df, p):\n    return df\n"
    assert wr.trace_names_for(src) == ["a", "signals"]
    assert wr.trace_names_for("def broken(:\n") == []


def test_verdict_for_last_row_reads_entry_only():
    df = pd.DataFrame({"entry": [False, True], "exit": [False, False]})
    assert wr.verdict_for_last_row(df) is True
    assert wr.verdict_for_last_row(df.iloc[:1]) is False
    assert wr.verdict_for_last_row(None) is False
    assert wr.verdict_for_last_row(pd.DataFrame({"exit": [True]})) is False


def test_run_once_reports_observed_and_duration_through_real_sandbox(tmp_path: Path):
    """B-8: 마지막 행 entry가 참이면 observed=True, duration_ms가 채워진다."""
    runner = wr.WatchRunner(tmp_root=tmp_path)
    result = runner.run_once(_ALWAYS_FIRE, _bars(), {"k": 1}, trace=True)
    assert result.ok, result.error
    assert result.observed is True
    assert result.duration_ms > 0
    assert result.node_io is not None and "signals" in result.node_io["calls"]
    assert list(tmp_path.iterdir()) == []  # jobdir 정리


def test_run_once_returns_error_instead_of_raising(tmp_path: Path):
    runner = wr.WatchRunner(tmp_root=tmp_path)
    result = runner.run_once("def signals(df, p):\n    return 1/0\n", _bars(), {})
    assert result.ok is False
    assert result.observed is None
    assert result.error and result.error["type"]
    assert list(tmp_path.iterdir()) == []


def _stub_run_strategy_factory(delay: float, counter: dict):
    lock = threading.Lock()

    def stub(jobdir, source, bars, params, **kwargs):
        with lock:
            counter["active"] += 1
            counter["peak"] = max(counter["peak"], counter["active"])
        assert Path(jobdir).exists()
        time.sleep(delay)
        with lock:
            counter["active"] -= 1
        return {
            "ok": True,
            "signals_df": pd.DataFrame({"entry": [True], "exit": [False]}),
            "stdout": "",
            "error": None,
            "elapsed": delay,
        }

    return stub


def test_hundred_cycles_leave_no_jobdirs_and_respect_concurrency_cap(tmp_path: Path):
    """B-19: 스텁 100주기 뒤 임시 디렉터리 잔여 0, 동시 실행이 상한을 넘지 않는다."""
    counter = {"active": 0, "peak": 0}
    runner = wr.WatchRunner(
        run_strategy=_stub_run_strategy_factory(0.005, counter), max_concurrent=2, tmp_root=tmp_path
    )

    async def main():
        tasks = [runner.run("src", _bars(3), {}) for _ in range(100)]
        return await asyncio.gather(*tasks)

    results = asyncio.run(main())
    assert len(results) == 100 and all(r.observed is True for r in results)
    assert list(tmp_path.iterdir()) == []
    assert counter["peak"] <= 2
    assert runner.peak_active <= 2


def test_run_does_not_block_event_loop(tmp_path: Path):
    """B-15 보조: 샌드박스가 느려도 다른 코루틴이 그동안 진행된다."""
    counter = {"active": 0, "peak": 0}
    runner = wr.WatchRunner(
        run_strategy=_stub_run_strategy_factory(0.3, counter), tmp_root=tmp_path
    )
    ticks: list[int] = []

    async def ticker():
        for i in range(5):
            ticks.append(i)
            await asyncio.sleep(0.02)

    async def main():
        await asyncio.gather(runner.run("src", _bars(3), {}), ticker())

    asyncio.run(main())
    assert ticks == [0, 1, 2, 3, 4]
