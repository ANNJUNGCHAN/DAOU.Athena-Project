"""전략 코드 샌드박스 — 별도 프로세스 격리 계약 (§7.2).

실제 서브프로세스를 띄우는 통합 테스트라 다른 결정층 테스트보다 느릴 수 있다. 그래도
deterministic으로 남긴다 — LLM도 난수도 안 쓰고, 같은 입력이면 결과가 항상 같다.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from athena_api.backtest.sandbox import host
from athena_api.backtest.sandbox.api import cross_above, cross_below, sma

pytestmark = pytest.mark.deterministic

# §7.1 계약 예시 그대로. import는 signals() 안에서 일어난다 — 함수가 정의된 모듈의
# globals가 곧 guard가 검사하는 strategy_globals이므로, 최상위에 쓰든 함수 안에 쓰든
# 같은 검사를 받는다(guard.py 참고).
_SMA_CROSSOVER_SOURCE = """\
PARAMS = {
    "fast": {"default": 2, "min": 2, "max": 10, "step": 1},
    "slow": {"default": 5, "min": 2, "max": 20, "step": 1},
}


def signals(df, p):
    import athena_bt as bt

    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    return df.assign(
        entry=bt.cross_above(fast, slow),
        exit=bt.cross_below(fast, slow),
    )[["entry", "exit"]]
"""


def _synthetic_bars(n: int = 30) -> pd.DataFrame:
    """SMA(2)/SMA(5) 교차가 여러 번 나오도록 위아래로 흔드는 합성 OHLCV n봉."""
    idx = pd.date_range("2024-01-01", periods=n, freq="D")
    close = pd.Series(100 + np.sin(np.linspace(0, 6, n)) * 10 + np.arange(n) * 0.3, index=idx)
    return pd.DataFrame(
        {"open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 1000},
        index=idx,
    )


def test_happy_path_signals_match_direct_indicator_call(tmp_path: Path) -> None:
    """정상 경로: signals.csv를 회수하고, 값이 athena_bt를 직접(프로세스 밖에서) 호출한
    결과와 정확히 일치한다 — CSV 왕복·프로세스 경계가 값을 바꾸지 않는지 확인한다."""
    bars = _synthetic_bars()
    result = host.run_strategy(tmp_path, _SMA_CROSSOVER_SOURCE, bars, {"fast": 2, "slow": 5})

    assert result["ok"] is True
    assert result["error"] is None
    signals = result["signals_df"]
    assert signals is not None
    assert list(signals.columns) == ["entry", "exit"]
    assert signals.index.equals(bars.index)

    expected_entry = cross_above(sma(bars.close, 2), sma(bars.close, 5))
    expected_exit = cross_below(sma(bars.close, 2), sma(bars.close, 5))
    assert (signals["entry"].to_numpy() == expected_entry.to_numpy()).all()
    assert (signals["exit"].to_numpy() == expected_exit.to_numpy()).all()
    assert signals["entry"].any()  # 교차가 실제로 최소 한 번은 일어나는 픽스처인지 확인


def test_credentials_do_not_leak_to_child_env(tmp_path: Path) -> None:
    """자격증명 미노출: KIWOOM_API_KEY 등을 부모 env에 심어도 화이트리스트가 걸러낸다.

    순수 함수 검증(`_child_env`)에 그치지 않고, 그 env로 실제 자식 프로세스를 띄워
    `os.environ`을 덤프해본다 — "우리가 그렇게 필터링했다는 주장"이 아니라 실제
    OS 프로세스 수준에서 사실인지 확인한다.
    """
    fake_parent_env = {
        "PATH": "C:\\fake",
        "PYTHONPATH": "C:\\fake-pp",
        "SYSTEMROOT": "C:\\Windows",
        "KIWOOM_API_KEY": "super-secret-key",
        "KIWOOM_APP_SECRET": "super-secret-secret",
        "ANTHROPIC_API_KEY": "another-secret",
    }
    built = host._child_env(tmp_path, base_env=fake_parent_env)
    assert "KIWOOM_API_KEY" not in built
    assert "KIWOOM_APP_SECRET" not in built
    assert "ANTHROPIC_API_KEY" not in built
    assert built["PATH"] == "C:\\fake"

    dump_env_script = "import os,json,sys;json.dump(sorted(os.environ),sys.stdout)"
    probe = subprocess.run(
        [sys.executable, "-I", "-B", "-c", dump_env_script],
        env=built,
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    dumped_keys = set(json.loads(probe.stdout))
    assert "KIWOOM_API_KEY" not in dumped_keys
    assert "KIWOOM_APP_SECRET" not in dumped_keys
    assert "ANTHROPIC_API_KEY" not in dumped_keys


def test_import_outside_allowlist_is_blocked(tmp_path: Path) -> None:
    """import 차단: socket을 top level에서 import하면 error.json에 차단 사유가 남는다."""
    bars = _synthetic_bars(n=5)
    source = (
        "import socket\n\n"
        "def signals(df, p):\n"
        "    return df.assign(entry=False, exit=False)[['entry', 'exit']]\n"
    )
    result = host.run_strategy(tmp_path, source, bars, {})

    assert result["ok"] is False
    assert result["signals_df"] is None
    assert result["error"]["type"] == "SandboxImportError"
    assert "socket" in result["error"]["message"]


def test_infinite_loop_is_killed_on_timeout(tmp_path: Path) -> None:
    """타임아웃: while True 전략을 짧은 타임아웃 안에 강제 종료하고 에러로 보고한다."""
    bars = _synthetic_bars(n=5)
    source = "def signals(df, p):\n    while True:\n        pass\n"

    result = host.run_strategy(tmp_path, source, bars, {}, timeout=2)

    assert result["ok"] is False
    assert result["signals_df"] is None
    assert result["error"]["type"] == "TimeoutError"
    assert result["elapsed"] < 10  # 강제 종료가 실제로 동작한다는 상한 — 무한정 안 걸린다


def test_stdout_is_capped_with_truncation_marker(tmp_path: Path) -> None:
    """stdout 캡: 대량 print를 지정한 바이트 상한으로 자르고 '[잘림]' 표기를 남긴다."""
    bars = _synthetic_bars(n=5)
    source = (
        "def signals(df, p):\n"
        "    print('x' * 5000)\n"
        "    return df.assign(entry=False, exit=False)[['entry', 'exit']]\n"
    )
    result = host.run_strategy(tmp_path, source, bars, {}, stdout_cap_bytes=200)

    assert result["ok"] is True
    cap_with_mark = 200 + len("\n[잘림]".encode())
    assert len(result["stdout"].encode("utf-8")) <= cap_with_mark
    assert result["stdout"].endswith("[잘림]")


def test_strategy_exception_is_reported_in_error_json(tmp_path: Path) -> None:
    """예외 전달: 전략이 raise하면 error.json에 타입·메시지가 그대로 담긴다."""
    bars = _synthetic_bars(n=5)
    source = "def signals(df, p):\n    raise ValueError('전략 로직 오류 테스트')\n"

    result = host.run_strategy(tmp_path, source, bars, {})

    assert result["ok"] is False
    assert result["error"]["type"] == "ValueError"
    assert result["error"]["message"] == "전략 로직 오류 테스트"
    assert "traceback" in result["error"]
