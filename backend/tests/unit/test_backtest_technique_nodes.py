"""기법 노드 — 함수 단위 노드·흐름과 signals 하나뿐일 때의 단계 폴백을 고정한다.

**무엇을 고정하나.** 노드는 그 기법 코드가 실제로 가진 함수여야 하고(범용 팔레트 없음),
흐름은 entry/exit를 만드는 호출 사슬이어야 하며, 모르는 것은 지어내지 않고 `unknown`에
남아야 한다. 셋 다 어기면 사용자가 보는 그림이 코드와 갈라진다.
"""

from __future__ import annotations

import pytest

from athena_api.backtest import codegen, presets
from athena_api.backtest.schema import from_kis_yaml
from athena_api.backtest.technique_nodes import ROLE_TOKENS, build_nodes, name_role

FUNCTIONAL = '''# 함수형 샘플 — ATR 돌파 기법
import athena_bt as bt

PARAMS = {
    "lookback": {"default": 20, "min": 5, "max": 120, "step": 1, "type": "int"},
    "atr_mult": {"default": 2.0, "min": 0.5, "max": 5.0, "step": 0.1, "type": "float"},
}


def compute_atr(df, p):
    """변동성 폭을 잰다 — 돌파 문턱의 기준."""
    high_low = df["high"] - df["low"]
    return high_low.rolling(14).mean()


# 최근 고가에 변동성만큼 얹어 돌파선을 만든다.
# 이 선을 종가가 넘으면 진입 후보다.
def breakout_level(df, atr, p):
    return df["high"].rolling(p["lookback"]).max() + atr * p["atr_mult"]


def should_enter(df, level):
    """종가가 돌파선을 넘으면 진입."""
    return df["close"] > level


def should_exit(df, atr):
    """20봉 저가를 깨면 청산."""
    return df["close"] < df["low"].rolling(20).min()


def position_size(df, p):
    return 1.0


def signals(df, p):
    atr = compute_atr(df, p)
    level = breakout_level(df, atr, p)
    entry = should_enter(df, level)
    exit_ = should_exit(df, atr)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''


def _by_id(payload: dict) -> dict[str, dict]:
    return {node["id"]: node for node in payload["nodes"]}


def test_functional_source_becomes_one_node_per_function() -> None:
    payload = build_nodes(FUNCTIONAL)
    assert payload["granularity"] == "function"
    assert payload["error"] is None
    assert [n["id"] for n in payload["nodes"]] == [
        "compute_atr", "breakout_level", "should_enter", "should_exit",
        "position_size", "signals",
    ]
    nodes = _by_id(payload)
    assert nodes["compute_atr"]["label"] == "compute_atr()"
    assert nodes["compute_atr"]["params"] == ["df", "p"]
    assert nodes["breakout_level"]["params"] == ["df", "atr", "p"]
    # 노드 줄 범위는 코드창이 그 줄을 켜는 근거다 — def부터 마지막 줄까지.
    assert nodes["compute_atr"]["first_line"] < nodes["compute_atr"]["last_line"]
    assert all(node["stage"] is None for node in payload["nodes"])


def test_roles_come_from_the_name_then_from_what_the_function_makes() -> None:
    nodes = _by_id(build_nodes(FUNCTIONAL))
    assert nodes["signals"]["role"] == "signals"
    assert nodes["should_enter"]["role"] == "entry"
    assert nodes["should_exit"]["role"] == "exit"
    assert nodes["position_size"]["role"] == "sizing"
    # 이름에 단서가 없으면 무엇을 만드는지로 가른다 — 수치 시리즈면 지표다.
    assert nodes["compute_atr"]["role"] == "indicator"
    assert nodes["breakout_level"]["role"] == "indicator"


def test_returns_hint_reads_the_shape_of_the_return() -> None:
    nodes = _by_id(build_nodes(FUNCTIONAL))
    assert nodes["compute_atr"]["returns_hint"] == "Series<Number>"
    assert nodes["should_enter"]["returns_hint"] == "Series<Bool>"
    assert nodes["should_exit"]["returns_hint"] == "Series<Bool>"
    assert nodes["position_size"]["returns_hint"] == "Number"
    assert nodes["signals"]["returns_hint"] == "DataFrame"


def test_summary_takes_the_docstring_first_line_or_the_comment_above() -> None:
    nodes = _by_id(build_nodes(FUNCTIONAL))
    assert nodes["compute_atr"]["summary_ko"] == "변동성 폭을 잰다 — 돌파 문턱의 기준."
    # 주석 덩어리는 **첫 줄**을 쓴다 — 마지막 줄만 떼면 요약이 아니라 각주가 된다.
    assert nodes["breakout_level"]["summary_ko"] == "최근 고가에 변동성만큼 얹어 돌파선을 만든다."
    assert nodes["position_size"]["summary_ko"] == ""


def test_flows_are_the_call_chains_that_make_entry_and_exit() -> None:
    payload = build_nodes(FUNCTIONAL)
    # 기대는 것이 앞에 온다 — atr → 돌파선 → 진입 판정.
    assert payload["flows"]["entry"] == ["compute_atr", "breakout_level", "should_enter"]
    assert payload["flows"]["exit"] == ["compute_atr", "should_exit"]
    # `calls`는 곧 노드 사이의 선이다 — 노드가 아닌 이름(bt.sma 등)은 들어가지 않는다.
    assert _by_id(payload)["signals"]["calls"] == [
        "compute_atr", "breakout_level", "should_enter", "should_exit",
    ]
    assert _by_id(payload)["compute_atr"]["calls"] == []


def test_exit_underscore_is_the_exit_column() -> None:
    """`exit_`는 파이썬 예약어를 피한 이름일 뿐이다 — 열 이름은 `exit`다."""
    assert build_nodes(FUNCTIONAL)["flows"]["exit"]


def test_nested_call_in_the_entry_expression_still_orders_dependencies_first() -> None:
    source = (
        "def base(df):\n"
        "    return df['close'].rolling(20).mean()\n"
        "\n"
        "def gate(df, level):\n"
        "    return df['close'] > level\n"
        "\n"
        "def signals(df, p):\n"
        "    entry = gate(df, base(df))\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry', 'exit']]\n"
    )
    assert build_nodes(source)["flows"]["entry"] == ["base", "gate"]


def test_only_signals_falls_back_to_the_four_stages() -> None:
    """노드가 하나뿐인 그림은 그림이 아니다 — 그때만 flow.py의 4단계를 준다."""
    source = codegen.spec_to_python(from_kis_yaml(presets.preset_yaml("sma_crossover")))
    payload = build_nodes(source)
    assert payload["granularity"] == "stage"
    assert [n["id"] for n in payload["nodes"]] == [
        "prepare", "indicators", "conditions", "output",
    ]
    assert [n["stage"] for n in payload["nodes"]] == [
        "prepare", "indicators", "conditions", "output",
    ]
    # 네 칸 전부 signals() 안이다 — 이 그림에서 함수는 그것 하나뿐이다.
    assert {n["role"] for n in payload["nodes"]} == {"signals"}
    assert payload["nodes"][0]["label"] == "조절할 값을 정합니다"
    assert payload["nodes"][-1]["returns_hint"] == "DataFrame"
    # 4단계는 진입·청산으로 갈리지 않는다 — 두 갈래를 비워 화면이 한 갈래 "단계 흐름"으로 접는다.
    assert payload["flows"] == {"entry": [], "exit": []}


def test_syntax_error_fills_error_only() -> None:
    payload = build_nodes("def signals(df, p)\n    return df\n")
    assert payload["nodes"] == []
    assert payload["flows"] == {"entry": [], "exit": []}
    assert payload["error"] and "1번째 줄" in payload["error"]


def test_missing_signals_says_so_instead_of_guessing_a_flow() -> None:
    source = "def helper(df):\n    return df['close']\n\ndef other(df):\n    return df\n"
    payload = build_nodes(source)
    assert payload["granularity"] == "function"
    assert payload["flows"] == {"entry": [], "exit": []}
    assert any("signals(df, p) 함수를 찾지 못했습니다" in u for u in payload["unknown"])


def test_unresolved_return_is_left_unknown_and_reported() -> None:
    source = (
        "def mystery(df):\n"
        "    return some_library.thing(df)\n"
        "\n"
        "def signals(df, p):\n"
        "    entry = mystery(df)\n"
        "    return df.assign(entry=entry, exit=entry)[['entry', 'exit']]\n"
    )
    payload = build_nodes(source)
    nodes = _by_id(payload)
    assert nodes["mystery"]["returns_hint"] == "unknown"
    assert nodes["mystery"]["role"] == "helper"
    assert any("mystery()가 무엇을 돌려주는지" in u for u in payload["unknown"])


def test_columns_made_by_subscript_assignment_are_found_too() -> None:
    source = (
        "def rise(df):\n"
        "    return df['close'] > df['open']\n"
        "\n"
        "def fall(df):\n"
        "    return df['close'] < df['open']\n"
        "\n"
        "def signals(df, p):\n"
        "    df['entry'] = rise(df)\n"
        "    df['exit'] = fall(df)\n"
        "    return df[['entry', 'exit']]\n"
    )
    payload = build_nodes(source)
    assert payload["flows"] == {"entry": ["rise"], "exit": ["fall"]}


def test_a_source_without_any_function_says_so() -> None:
    payload = build_nodes("PARAMS = {}\n")
    assert payload["nodes"] == []
    assert any("최상위 함수가 하나도 없습니다" in u for u in payload["unknown"])


# ── 원칙 2의 이름 표 ─────────────────────────────────────────────────────────


def test_the_role_table_is_principle_two_word_for_word() -> None:
    """표는 여기 하나뿐이다 — 검사(technique_check)도 이것을 읽는다.

    두 곳에 따로 적으면 화면이 지표라 부르는 함수를 검사는 진입이라 부르게 된다.
    """
    assert ROLE_TOKENS == {
        "entry": frozenset({"enter", "entry", "buy"}),
        "exit": frozenset({"exit", "sell", "stop", "close", "take"}),
        "indicator": frozenset({"compute", "level", "band", "line"}),
        "sizing": frozenset({"size", "position", "qty"}),
    }


@pytest.mark.parametrize(
    ("name", "role"),
    [
        ("signals", "signals"),
        ("should_enter", "entry"),
        ("entry_gate", "entry"),
        ("buy_when_strong", "entry"),
        ("should_exit", "exit"),
        ("sell_all", "exit"),
        # 손절·익절은 청산이다 — 위 줄이 먼저 맞으므로 `stop_level`은 지표로 새지 않는다.
        ("stop_loss", "exit"),
        ("closeGap", "exit"),
        ("stop_level", "exit"),
        ("compute_atr", "indicator"),
        ("breakout_level", "indicator"),
        ("keltner_band", "indicator"),
        ("trend_line", "indicator"),
        ("position_size", "sizing"),
        ("order_qty", "sizing"),
        # 표에 없으면 이름으로 정하지 않는다 — 그때만 무엇을 돌려주는지로 가른다.
        ("mystery", None),
        ("prepare_frame", None),
    ],
)
def test_the_name_alone_decides_the_role_when_the_table_has_that_word(
    name: str, role: str | None
) -> None:
    assert name_role(name) == role
