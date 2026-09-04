"""codegen.py — 지도에서 나온 코드가 폼 경로와 **같은 신호**를 내는지 고정한다.

이 테스트의 값은 하나다: 지도를 코드로 옮겼을 때 신호가 달라지지 않는다는 것. 달라지면
"코드는 지도 뒤에 있다"는 규칙이 거짓이 되고, 사용자는 폼에서 본 결과와 코드에서 본
결과 중 어느 쪽이 자기 전략인지 알 수 없게 된다. 그래서 프리셋 10종 전부에 대해
compile.py(폼)와 생성 코드(샌드박스와 같은 배선으로 실행)의 두 열을 직접 맞춰본다.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from athena_api.backtest import codegen, flow, presets
from athena_api.backtest.compile import compile_signals
from athena_api.backtest.sandbox import api as bt_api
from athena_api.backtest.sandbox import guard
from athena_api.backtest.schema import StrategySpec, from_kis_yaml


def _frame(n: int = 400) -> pd.DataFrame:
    """결정적 합성 봉. 240봉짜리 지표(week52_high)도 유효 구간이 남도록 넉넉히 만든다."""
    index = pd.date_range("2020-01-02", periods=n, freq="B")
    closes = [100 + 12 * math.sin(i / 9.0) + i * 0.05 for i in range(n)]
    opens = [closes[0]] + closes[:-1]
    return pd.DataFrame(
        {
            "open": opens,
            "high": [c + 1.5 for c in closes],
            "low": [c - 1.5 for c in closes],
            "close": closes,
            "volume": [1000.0 + (i % 17) * 13 for i in range(n)],
        },
        index=index,
    )


def _run_generated(source: str, spec: StrategySpec, jobdir: Path) -> pd.DataFrame:
    """샌드박스 자식(`sandbox/__main__.py`)과 같은 배선으로 생성 코드를 실행한다 —
    `athena_bt` 별칭을 걸고 guard를 설치한 뒤 exec한다. 가드가 막으면 여기서 터진다."""
    sys.modules["athena_bt"] = bt_api
    strategy_globals: dict[str, Any] = {"__name__": "__athena_strategy__"}
    guard.install(strategy_globals, jobdir)
    exec(compile(source, "strategy.py", "exec"), strategy_globals)  # noqa: S102
    signals_fn = strategy_globals["signals"]
    params = {name: p.default for name, p in spec.strategy.params.items()}
    return signals_fn(_frame(), params)


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_generated_code_matches_the_form_path(preset_id: str, tmp_path: Path) -> None:
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    source = codegen.spec_to_python(spec)
    generated = _run_generated(source, spec, tmp_path)
    expected = compile_signals(spec, _frame())
    for column in ("entry", "exit"):
        left = generated[column].fillna(False).astype(bool)
        right = expected[column].fillna(False).astype(bool)
        assert left.equals(right), f"{preset_id}: {column} 열이 폼 경로와 다르다"


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_generated_code_is_a_map_with_no_unknowns(preset_id: str) -> None:
    """생성 코드는 지도에서 나왔으니 지도가 다시 읽었을 때 모르는 곳이 없어야 한다."""
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    m = flow.build_flow(codegen.spec_to_python(spec))
    assert m.unknown == ()
    assert [n.stage for n in m.nodes] == ["prepare", "indicators", "conditions", "output"]
    assert m.returns_columns == ("entry", "exit")
    assert m.params == tuple(spec.strategy.params)


def test_params_stay_references_so_sliders_still_move() -> None:
    """`$fast`를 숫자로 치환해 넣으면 슬라이더를 움직여도 코드가 옛 숫자를 돈다."""
    spec = from_kis_yaml(presets.preset_yaml("sma_crossover"))
    source = codegen.spec_to_python(spec)
    assert 'bt.sma(df["close"], period=p["fast"])' in source
    assert "period=20" not in source


def test_header_says_the_guard_lines_are_not_here() -> None:
    spec = from_kis_yaml(presets.preset_yaml("sma_crossover"))
    header = codegen.spec_to_python(spec).splitlines()[1]
    assert "지키는 선" in header and "앱 엔진" in header


def test_cross_with_a_constant_broadcasts_like_the_form_path(tmp_path: Path) -> None:
    """`cross_above(rsi, 30)`은 상수 쪽도 시리즈여야 한다 — rules.py가 폼 경로에서 하는
    브로드캐스트를 코드에서도 해야 두 경로가 같은 신호를 낸다."""
    yaml_text = """
version: "1.0"
metadata:
  name: 상수 교차
strategy:
  id: const_cross
  params:
    period: {default: 14, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: RSI, alias: rsi, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: rsi, operator: cross_above, compare_to: 30}
  exit:
    logic: AND
    conditions:
      - {indicator: rsi, operator: cross_below, compare_to: 70}
risk:
  stop_loss:   {enabled: false, percent: 0}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""
    spec = from_kis_yaml(yaml_text)
    source = codegen.spec_to_python(spec)
    assert "import pandas as pd" in source
    generated = _run_generated(source, spec, tmp_path)
    expected = compile_signals(spec, _frame())
    for column in ("entry", "exit"):
        assert generated[column].fillna(False).astype(bool).equals(
            expected[column].fillna(False).astype(bool)
        )
    assert bool(generated["entry"].any())
