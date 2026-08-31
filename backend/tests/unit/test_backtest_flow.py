"""flow.py — 코드 플로우 지도 (Paper 보드 08).

이 지도의 값은 "코드와 절대 어긋나지 않는다"는 것 하나다. 그래서 테스트도 **모르는 것을
모른다고 하는지**를 주로 고정한다 — 그럴듯하게 채워 넣는 순간 초심자는 틀린 지도를 믿는다.
"""

from __future__ import annotations

from athena_api.backtest import flow

GOLDEN = '''\
# athena strategy v1
import athena_bt as bt

PARAMS = {
    "fast": {"default": 20, "min": 5, "max": 60, "step": 1},
    "slow": {"default": 60, "min": 20, "max": 240, "step": 1},
    "atr_mult": {"default": 2.0, "min": 0.5, "max": 5.0, "step": 0.1},
}


def signals(df, p):
    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    atr = bt.atr(df, 14)

    entry = bt.cross_above(fast, slow)
    stop = (df.close - atr * p["atr_mult"]).where(entry).ffill()
    exit_ = bt.cross_below(fast, slow) | (df.low <= stop)

    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''


def test_four_stages_in_order():
    m = flow.build_flow(GOLDEN)
    assert [n.stage for n in m.nodes] == ["prepare", "indicators", "conditions", "output"]


def test_params_become_the_sliders():
    m = flow.build_flow(GOLDEN)
    assert m.params == ("fast", "slow", "atr_mult")


def test_indicator_stage_reports_what_it_produced_and_called():
    m = flow.build_flow(GOLDEN)
    node = next(n for n in m.nodes if n.stage == "indicators")
    assert node.produces == ("fast", "slow", "atr")
    assert set(node.calls) >= {"sma", "atr"}


def test_condition_stage_is_split_from_indicator_stage():
    """지표(숫자 열)와 조건(참/거짓 열)을 가르는 것이 이 지도의 핵심 분기다."""
    m = flow.build_flow(GOLDEN)
    node = next(n for n in m.nodes if n.stage == "conditions")
    assert set(node.produces) == {"entry", "stop", "exit_"}


def test_line_ranges_point_at_real_lines():
    m = flow.build_flow(GOLDEN)
    lines = GOLDEN.splitlines()
    for node in m.nodes:
        assert 1 <= node.first_line <= node.last_line <= len(lines)
        assert node.source == "\n".join(lines[node.first_line - 1 : node.last_line])


def test_output_stage_reads_returned_columns():
    m = flow.build_flow(GOLDEN)
    assert m.returns_columns == ("entry", "exit")
    assert m.unknown == ()


# ── 모르는 것을 모른다고 말하는가 ─────────────────────────────────────────────


def test_syntax_error_returns_error_not_a_fake_map():
    m = flow.build_flow("def signals(df, p:\n    return 1")
    assert m.nodes == ()
    assert m.error is not None


def test_missing_signals_function_is_reported():
    m = flow.build_flow("PARAMS = {}\nx = 1\n")
    assert any("signals" in u for u in m.unknown)


def test_missing_params_is_reported():
    m = flow.build_flow("def signals(df, p):\n    return df[['entry','exit']]\n")
    assert any("PARAMS" in u for u in m.unknown)


def test_wrong_return_columns_are_reported():
    src = (
        "PARAMS = {'a': {}}\n"
        "def signals(df, p):\n"
        "    return df[['profit']]\n"
    )
    m = flow.build_flow(src)
    assert any("entry" in u for u in m.unknown)


def test_missing_return_is_reported():
    src = "PARAMS = {'a': {}}\ndef signals(df, p):\n    x = 1\n"
    m = flow.build_flow(src)
    assert any("return" in u for u in m.unknown)


# ── 페이로드 ────────────────────────────────────────────────────────────────


def test_payload_carries_app_stages_so_the_screen_does_not_own_the_words():
    payload = flow.to_payload(flow.build_flow(GOLDEN))
    assert len(payload["app_before"]) == 1
    assert len(payload["app_after"]) == 3
    assert [s["key"] for s in payload["app_after"]] == ["fill", "cost", "metrics"]
    assert payload["nodes"][0]["stage"] == "prepare"


def test_stage_line_ranges_never_overlap():
    """칸을 누르면 그 줄이 켜지는 화면 계약(보드 08) — 한 줄이 두 칸에 속하면 깨진다."""
    m = flow.build_flow(GOLDEN)
    spans = [(n.first_line, n.last_line) for n in m.nodes]
    assert spans == sorted(spans)
    for (_, prev_end), (next_start, _) in zip(spans, spans[1:], strict=False):
        assert prev_end < next_start
