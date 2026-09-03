"""코드 감시 검사(미니 백테스트)와 노드 카드 — 계획 B-9 · B-10 소비 · B-11 · B-18 · B-23."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from athena_api.watch import check as wc
from athena_api.watch import nodes as wn
from athena_api.watch.runner import WatchRunner

pytestmark = pytest.mark.deterministic

# 거래량이 5일 평균의 1.5배를 넘으면 울리는 감시 함수 — 보드 10의 예시 그대로 함수 3개 + signals.
_VOLUME_SOURCE = """PARAMS = {"days": 5, "ratio": 1.5}
NODE_LABELS = {
    "load_bars": "일봉 불러오기",
    "avg_volume": "거래량 평균",
    "volume_ratio": "배수 비교",
    "signals": "알림",
}


def load_bars(df):
    return df


def avg_volume(df, days):
    return df.volume.rolling(days).mean()


def volume_ratio(df, avg):
    return df.volume / avg


def signals(df, p):
    bars = load_bars(df)
    avg = avg_volume(bars, p["days"])
    ratio = volume_ratio(bars, avg)
    fired = ratio > p["ratio"]
    return bars.assign(entry=fired.fillna(False), exit=False)[["entry", "exit"]]
"""

_LABELS_BLOCK = (
    'NODE_LABELS = {\n    "load_bars": "일봉 불러오기",\n    "avg_volume": "거래량 평균",\n'
    '    "volume_ratio": "배수 비교",\n    "signals": "알림",\n}\n'
)
_NO_LABELS_SOURCE = _VOLUME_SOURCE.replace(_LABELS_BLOCK, "")


def _bars(spike_days: list[int], n: int = 31, start: str = "2026-08-03") -> pd.DataFrame:
    """평상시 거래량 1,000, 지정한 날만 3,000(5일 평균의 1.5배 초과)."""
    idx = pd.date_range(start, periods=n, freq="D")
    volume = np.full(n, 1000)
    for d in spike_days:
        volume[d] = 3000
    close = pd.Series(100 + np.arange(n) * 0.1, index=idx)
    return pd.DataFrame(
        {"open": close, "high": close + 1, "low": close - 1, "close": close, "volume": volume},
        index=idx,
    )


@pytest.fixture
def runner(tmp_path: Path) -> WatchRunner:
    return WatchRunner(tmp_root=tmp_path)


def test_check_counts_fires_with_cooldown_and_excludes_today(runner: WatchRunner):
    """B-9: 30일 완성 봉 · 발화 후보 5일 · 쿨다운 2일 → 4번, 날짜 정확, 오늘 제외, 해시 안정."""
    df = _bars(spike_days=[10, 11, 17, 24, 28, 30])  # 11은 쿨다운에 억제, 30 = 오늘(9/2)
    today = date(2026, 9, 2)
    result = wc.run_check(
        _VOLUME_SOURCE,
        None,
        df,
        cooldown_s=2 * 86400,
        params={"days": 5, "ratio": 1.5},
        today=today,
        runner=runner,
    )
    assert result.ok, (result.reason, result.error)
    assert result.count == 4
    assert [f["dt"] for f in result.fires] == [
        "2026-08-13",
        "2026-08-20",
        "2026-08-27",
        "2026-08-31",
    ]
    assert result.last_fire == result.fires[-1]["dt"]
    assert all(f["dt"] < "2026-09-02" for f in result.fires)  # 오늘 제외
    assert result.code_hash == wc.code_hash_of(_VOLUME_SOURCE)
    assert len(result.code_hash) == 64
    assert result.counted_until == "어제까지로 세었음 · 오늘은 진행 중"


def test_simulate_fires_applies_cooldown_in_day_units():
    idx = pd.date_range("2026-08-01", periods=6, freq="D")
    sig = pd.DataFrame({"entry": [True, True, False, True, True, True], "exit": False}, index=idx)
    closes = pd.Series(range(6), index=idx, dtype=float)
    fires = wc.simulate_fires(sig, closes, cooldown_s=2 * 86400)
    assert [f["dt"] for f in fires] == ["2026-08-01", "2026-08-04", "2026-08-06"]
    assert fires[0]["close"] == 0.0


def test_nodes_carry_inputs_and_outputs_from_trace(runner: WatchRunner):
    """B-10 소비 · A-2 재료: 최상위 함수 4개 = 카드 4개, 들어감·나옴이 계측값에서 온다."""
    df = _bars(spike_days=[10, 30])
    result = wc.run_check(
        _VOLUME_SOURCE,
        None,
        df,
        cooldown_s=86400,
        params={"days": 5, "ratio": 1.5},
        today=date(2026, 9, 2),
        runner=runner,
    )
    assert result.ok, (result.reason, result.error)
    cards = {c.fn: c for c in result.nodes}
    assert [c.fn for c in result.nodes] == ["load_bars", "avg_volume", "volume_ratio", "signals"]
    assert (
        cards["avg_volume"].title_ko == "거래량 평균"
        and cards["avg_volume"].title_en == "avg_volume"
    )
    assert [i["name"] for i in cards["avg_volume"].inputs] == ["df", "days"]
    assert cards["avg_volume"].inputs[1]["value"] == 5
    assert cards["avg_volume"].output == pytest.approx(1000.0)  # 마지막 완성 봉 기준 5일 평균
    assert cards["volume_ratio"].output == pytest.approx(1.0)
    assert cards["signals"].output is False  # 9/1은 조용
    assert all(c.called for c in result.nodes) and not any(c.unused for c in result.nodes)
    assert not any(c.warnings for c in result.nodes)


def test_missing_node_labels_fall_back_to_english_with_warning(runner: WatchRunner):
    """B-11"""
    df = _bars(spike_days=[10])
    result = wc.run_check(
        _NO_LABELS_SOURCE,
        None,
        df,
        cooldown_s=86400,
        params={"days": 5, "ratio": 1.5},
        today=date(2026, 9, 2),
        runner=runner,
    )
    assert result.ok, (result.reason, result.error)
    avg = next(c for c in result.nodes if c.fn == "avg_volume")
    assert avg.title_ko == "avg_volume"
    assert wn.LABEL_MISSING_WARNING in avg.warnings
    assert wn.LABEL_MISSING_WARNING in result.warnings
    # 넘겨받은 labels가 파일 안 이름표를 대신한다
    result2 = wc.run_check(
        _NO_LABELS_SOURCE,
        {"avg_volume": "거래량 평균"},
        df,
        cooldown_s=86400,
        params={"days": 5, "ratio": 1.5},
        today=date(2026, 9, 2),
        runner=runner,
    )
    assert next(c for c in result2.nodes if c.fn == "avg_volume").title_ko == "거래량 평균"


def test_check_and_runner_agree_on_last_closed_row(runner: WatchRunner):
    """B-18: 같은 D-1 봉을 주면 검사의 마지막 행 판정과 실행기의 판정이 같다."""
    df = _bars(spike_days=[29, 30])  # 29 = 9/1(어제) 급증, 30 = 오늘
    today = date(2026, 9, 2)
    result = wc.run_check(
        _VOLUME_SOURCE,
        None,
        df,
        cooldown_s=86400,
        params={"days": 5, "ratio": 1.5},
        today=today,
        runner=runner,
    )
    assert result.ok, (result.reason, result.error)
    assert result.last_verdict is True
    closed = df[df.index < pd.Timestamp(today)]
    loop_run = runner.run_once(_VOLUME_SOURCE, closed, {"days": 5, "ratio": 1.5})
    assert loop_run.observed is result.last_verdict


def test_syntax_error_returns_ok_false_with_diagnosis(runner: WatchRunner):
    """B-12 지원: 예외 대신 ok=False + 진단."""
    result = wc.run_check(
        "def signals(df, p:\n    return df\n",
        None,
        _bars([]),
        cooldown_s=60,
        today=date(2026, 9, 2),
        runner=runner,
    )
    assert result.ok is False
    assert result.error is not None
    assert result.reason and not result.reason.endswith(("습니다", "입니다", "합니다", "됩니다"))
    assert result.diagnosis is None or "title" in result.diagnosis


def test_called_function_without_output_fails_but_unused_function_does_not(runner: WatchRunner):
    """B-23"""
    src_missing = """NODE_LABELS = {"helper": "도움", "signals": "알림"}


def helper(df):
    return None


def signals(df, p):
    helper(df)
    return df.assign(entry=df.volume > 0, exit=False)[["entry", "exit"]]
"""
    res = wc.run_check(
        src_missing, None, _bars([]), cooldown_s=60, today=date(2026, 9, 2), runner=runner
    )
    assert res.ok is False
    assert res.reason == "칸 1개의 값을 못 읽음 — 다시 만들어 볼게"

    src_unused = """NODE_LABELS = {"spare": "예비", "signals": "알림"}


def spare(df):
    return df.close.mean()


def signals(df, p):
    return df.assign(entry=df.volume > 0, exit=False)[["entry", "exit"]]
"""
    res2 = wc.run_check(
        src_unused, None, _bars([]), cooldown_s=60, today=date(2026, 9, 2), runner=runner
    )
    assert res2.ok is True, (res2.reason, res2.error)
    spare = next(c for c in res2.nodes if c.fn == "spare")
    assert spare.unused is True and spare.called is False
    assert len(res2.nodes) == 2


def test_build_nodes_parses_labels_without_running_code():
    src = (
        'NODE_LABELS = {"a": "가"}\n\ndef a(x, y=2):\n    return x\n\n'
        'def signals(df, p):\n    return df\n'
    )
    cards, warnings = wn.build_nodes(src, None, None)
    assert [c.fn for c in cards] == ["a", "signals"]
    assert cards[0].title_ko == "가" and cards[0].unused is True
    assert [i["name"] for i in cards[0].inputs] == ["x", "y"]
    assert cards[1].title_ko == "signals" and wn.LABEL_MISSING_WARNING in cards[1].warnings
    assert isinstance(warnings, list)
