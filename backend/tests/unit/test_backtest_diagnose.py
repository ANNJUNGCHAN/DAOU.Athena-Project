"""diagnose.py — 오류 진단·수정안 (Paper 보드 09).

**이 파일이 지키는 규율 두 줄.**
① 설명은 항상 낸다 — 모르는 오류도 "모른다"고 말하고 원문을 남긴다.
② 수정안은 확신할 때만 낸다 — 틀린 diff를 초심자가 그대로 적용하는 것이 최악이다.
"""

from __future__ import annotations

from athena_api.backtest import diagnose as dg

SRC = '''\
import athena_bt as bt

PARAMS = {"fast": {"default": 20}, "slow": {"default": 60}, "atr_mult": {"default": 2.0}}


def signals(df, p):
    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    atr = bt.atr(df, 14)
    entry = bt.cross_above(fast, slow)
    stop = df.close - atr * p["atr_mult"]
    exit_ = bt.cross_below(fast, slow) | (df.low <= stop)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''

NAN_TRACEBACK = '''\
Traceback (most recent call last):
  File "C:\\jobdir\\strategy.py", line 11, in signals
    exit_ = bt.cross_below(fast, slow) | (df.low <= stop)
ValueError: cannot mask with non-boolean array containing NA / NaN values
'''


# ── 항상 설명은 낸다 ─────────────────────────────────────────────────────────


def test_unknown_error_still_explains_and_keeps_the_original():
    d = dg.diagnose("RuntimeError: 뭔가 이상함", SRC)
    assert d.why
    assert "RuntimeError" in d.raw
    assert d.suggestion is None
    assert d.unknown_reason is not None
    assert d.tags == ("unknown",)


def test_line_number_comes_from_user_file_not_pandas_internals():
    tb = (
        'Traceback (most recent call last):\n'
        '  File "C:\\\\jobdir\\\\strategy.py", line 11, in signals\n'
        '    x = 1\n'
        '  File "C:\\\\site-packages\\\\pandas\\\\core\\\\ops.py", line 3021, in wrapper\n'
        '    raise ValueError\n'
        'ValueError: boom\n'
    )
    assert dg.diagnose(tb, SRC).line == 11


# ── NaN 마스크 — 보드 09의 대표 사례 ──────────────────────────────────────────


def test_nan_mask_explains_warmup_in_plain_words():
    d = dg.diagnose(NAN_TRACEBACK, SRC)
    assert d.line == 11
    assert "빈칸" in d.why
    assert "NaN" in d.raw
    assert "nan" in d.tags


def test_nan_mask_fix_adds_where_and_ffill():
    d = dg.diagnose(NAN_TRACEBACK, SRC)
    assert d.suggestion is not None
    assert ".where(entry)" in d.suggestion.new_source
    assert ".ffill()" in d.suggestion.new_source
    assert d.suggestion.removed == 1
    assert d.suggestion.added == 2


def test_nan_fix_result_is_valid_python():
    import ast

    d = dg.diagnose(NAN_TRACEBACK, SRC)
    assert d.suggestion is not None
    ast.parse(d.suggestion.new_source)  # 터지면 수정안이 코드를 망가뜨린 것이다


def test_nan_fix_is_withheld_when_the_line_already_uses_where():
    src = SRC.replace(
        'stop = df.close - atr * p["atr_mult"]',
        'stop = (df.close - atr * p["atr_mult"]).where(entry).ffill()',
    )
    d = dg.diagnose(NAN_TRACEBACK, src)
    assert d.suggestion is None
    assert d.unknown_reason is not None


def test_nan_fix_is_withheld_when_no_entry_boolean_exists():
    src = "def signals(df, p):\n    stop = df.close - 1\n    return stop\n"
    tb = NAN_TRACEBACK.replace("line 11", "line 2")
    assert dg.diagnose(tb, src).suggestion is None


# ── 알 수 없는 지표 ─────────────────────────────────────────────────────────


def test_unknown_indicator_suggests_nearest_registered_name():
    d = dg.diagnose(
        "AttributeError: module 'athena_bt' has no attribute 'smaa'",
        "x = bt.smaa(df.close, 20)\n",
        known_indicators=["SMA", "EMA", "ATR", "sma", "ema"],
    )
    assert d.suggestion is not None
    assert "sma" in d.suggestion.new_source


def test_unknown_indicator_without_a_near_match_gives_no_fix():
    d = dg.diagnose(
        "AttributeError: module 'athena_bt' has no attribute 'zzzzzz'",
        "x = bt.zzzzzz(df.close)\n",
        known_indicators=["SMA", "EMA"],
    )
    assert d.suggestion is None
    assert d.unknown_reason is not None


# ── 없는 파라미터 ───────────────────────────────────────────────────────────


def test_missing_param_suggests_nearest_and_rewrites_lookup():
    d = dg.diagnose(
        "KeyError: 'fastt'",
        'x = p["fastt"]\n',
        known_params=["fast", "slow"],
    )
    assert d.suggestion is not None
    assert 'p["fast"]' in d.suggestion.new_source


def test_missing_param_without_candidates_explains_how_to_add_it():
    d = dg.diagnose("KeyError: 'k'", 'x = p["k"]\n')
    assert d.suggestion is None
    assert "PARAMS" in d.why


# ── 샌드박스 차단 ───────────────────────────────────────────────────────────


def test_blocked_import_is_explained_and_removable():
    src = "import os\nimport athena_bt as bt\n"
    d = dg.diagnose("ImportError: os 모듈은 차단되어 있다", src)
    assert "os" in d.title
    assert d.suggestion is not None
    assert "import os" not in d.suggestion.new_source
    assert "import athena_bt as bt" in d.suggestion.new_source


# ── 문법 ────────────────────────────────────────────────────────────────────


def test_syntax_error_refuses_to_guess_a_fix():
    d = dg.diagnose("SyntaxError: invalid syntax (line 3)", "def f(:\n")
    assert d.suggestion is None
    assert d.tags == ("syntax",)


def test_indentation_error_gets_its_own_explanation():
    d = dg.diagnose("IndentationError: unexpected indent (line 2)", "x=1\n  y=2\n")
    assert "들여쓰기" in d.why


# ── 시간 초과 ───────────────────────────────────────────────────────────────


def test_timeout_points_at_loops():
    d = dg.diagnose("TimeoutError: 30초를 넘겼다", SRC)
    assert "반복문" in d.why
    assert d.tags == ("timeout",)


# ── 페이로드 ────────────────────────────────────────────────────────────────


def test_payload_shape_matches_what_the_card_draws():
    payload = dg.to_payload(dg.diagnose(NAN_TRACEBACK, SRC))
    assert set(payload) >= {"title", "detail", "why", "line", "raw", "suggestion"}
    marks = {line["mark"] for line in payload["suggestion"]["diff_lines"]}
    assert {"+", "-"} <= marks
