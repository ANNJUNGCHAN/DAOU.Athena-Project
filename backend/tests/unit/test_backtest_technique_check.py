"""기법 자동 검사 일곱 — 순서·건너뜀·시험 실행의 정직함과 차단/경고의 경계를 고정한다.

**무엇을 고정하나.** 앞이 실패하면 뒤는 "앞 검사가 먼저"로 남고(같은 사실을 두 번, 더 어려운
말로 다시 듣지 않는다), 대상이 없으면 시험 실행은 돌지 않고 "봉 캐시 없음"으로 남으며(돌린
척하지 않는다), 통과했을 때만 `stats`가 실린다.

**차단과 경고.** `passed`는 차단 항목만 센다 — 매직 넘버·구조는 경고라 노드 창을 닫지 않는다.
이 경계가 무너지면 사용자는 원칙을 배우는 대신 원칙을 피해 다니게 된다.

시험 실행은 진짜 샌드박스 자식 프로세스를 띄운다 — 느린 만큼 그 경로를 타는 테스트는 몇 개만
둔다. 나머지는 프로세스를 띄우기 전에 끝난다.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd
import pytest

from athena_api.backtest.technique_check import CHECK_SEVERITY, DRYRUN_BARS, run_checks

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


def _bars(n: int = 320) -> pd.DataFrame:
    """SMA(3)/SMA(5) 교차가 여러 번 나오는 합성 봉 — 파형은 runner 유닛 테스트와 같다."""
    closes = [100 + i * 0.3 + 4 * math.sin(i / 5.0) for i in range(n)]
    index = pd.date_range("2024-01-02", periods=n, freq="D")
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c + 1 for c in closes],
            "low": [c - 1 for c in closes],
            "close": closes,
            "volume": [1000] * n,
        },
        index=index,
    )


def _by_id(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {check["id"]: check for check in payload["checks"]}


async def test_seven_checks_always_come_back_in_the_same_order() -> None:
    payload = await run_checks(CROSSOVER)
    assert [c["id"] for c in payload["checks"]] == [
        "syntax", "contract", "dryrun", "lookahead", "warmup", "magic", "structure",
    ]
    assert [c["label_ko"] for c in payload["checks"][:3]] == [
        "문법·금지 import",
        "signals(df, p) 계약 · entry/exit 두 열",
        "짧은 구간 시험 실행",
    ]
    assert [c["label_ko"] for c in payload["checks"][3:]] == [
        "미래를 보지 않음",
        "워밍업 전 신호 없음",
        "매직 넘버 없음",
        "노드 단위 구조",
    ]


async def test_every_item_says_whether_it_blocks_or_only_warns() -> None:
    """화면은 항목을 세지 않는다 — 무엇이 차단인지는 항목에 붙은 severity 하나로 안다."""
    payload = await run_checks(CROSSOVER)
    assert [c["severity"] for c in payload["checks"]] == [
        "block", "block", "block", "block", "block", "warn", "warn",
    ]
    assert {c["id"]: c["severity"] for c in payload["checks"]} == CHECK_SEVERITY


async def test_without_a_target_the_dry_run_stays_unknown_instead_of_pretending() -> None:
    payload = await run_checks(CROSSOVER)
    checks = _by_id(payload)
    assert checks["syntax"]["ok"] is True
    assert checks["contract"]["ok"] is True
    assert checks["dryrun"]["ok"] is False
    assert checks["dryrun"]["detail_ko"] == "봉 캐시 없음 — 대상을 정하면 시험 실행합니다"
    assert payload["passed"] is False
    assert payload["stats"] is None
    assert payload["error"] is None


async def test_syntax_failure_skips_the_rest_and_points_at_the_line() -> None:
    payload = await run_checks("def signals(df, p)\n    return df\n", bars=_bars(20))
    checks = _by_id(payload)
    assert checks["syntax"]["ok"] is False
    assert checks["contract"]["detail_ko"] == "앞 검사가 먼저"
    assert checks["dryrun"]["detail_ko"] == "앞 검사가 먼저"
    assert payload["error"]["line"] == 1
    assert payload["stats"] is None


@pytest.mark.parametrize(
    ("statement", "needle"),
    [
        ("import os", "os 모듈은 전략 코드에서 쓸 수 없습니다"),
        ("from subprocess import run", "subprocess 모듈은"),
        ("import scipy", "샌드박스가 허용하지 않는 import: scipy"),
        ("from . import helper", "상대 import"),
    ],
)
async def test_imports_the_sandbox_would_refuse_fail_the_first_check(
    statement: str, needle: str
) -> None:
    source = f"{statement}\n\ndef signals(df, p):\n    return df[['entry', 'exit']]\n"
    payload = await run_checks(source, bars=_bars(20))
    checks = _by_id(payload)
    assert checks["syntax"]["ok"] is False
    assert needle in checks["syntax"]["detail_ko"]
    assert payload["error"]["line"] == 1
    # 샌드박스를 띄우지 않았다는 사실이 뒤 두 칸에 남는다.
    assert checks["dryrun"]["detail_ko"] == "앞 검사가 먼저"


async def test_allowed_imports_pass_the_first_check() -> None:
    source = (
        "import pandas as pd\nimport numpy as np\nimport athena_bt as bt\n\n"
        "def signals(df, p):\n    return df[['entry', 'exit']]\n"
    )
    payload = await run_checks(source)
    assert _by_id(payload)["syntax"]["ok"] is True


async def test_missing_signals_fails_the_contract_check() -> None:
    payload = await run_checks("def helper(df):\n    return df\n", bars=_bars(20))
    checks = _by_id(payload)
    assert checks["syntax"]["ok"] is True
    assert checks["contract"]["ok"] is False
    assert "def signals(df, p): 함수가 없습니다" in checks["contract"]["detail_ko"]
    assert checks["dryrun"]["detail_ko"] == "앞 검사가 먼저"


async def test_wrong_arity_fails_the_contract_check() -> None:
    payload = await run_checks("def signals(df):\n    return df[['entry', 'exit']]\n")
    checks = _by_id(payload)
    assert checks["contract"]["ok"] is False
    assert "지금은 1개입니다" in checks["contract"]["detail_ko"]


async def test_returning_the_wrong_columns_fails_the_contract_check() -> None:
    payload = await run_checks("def signals(df, p):\n    return df[['buy', 'sell']]\n")
    checks = _by_id(payload)
    assert checks["contract"]["ok"] is False
    assert "entry·exit이(가) 없습니다" in checks["contract"]["detail_ko"]


async def test_a_shape_we_cannot_read_statically_is_left_to_the_dry_run() -> None:
    """정적으로 못 읽은 것을 "어겼다"로 바꾸면 샌드박스가 잘 돌리는 코드를 검사가 막는다."""
    source = "def signals(df, p):\n    frame = build(df)\n    return frame\n"
    checks = _by_id(await run_checks(source))
    assert checks["contract"]["ok"] is True
    assert "시험 실행에서 확인합니다" in checks["contract"]["detail_ko"]


async def test_the_dry_run_reports_what_it_actually_computed() -> None:
    payload = await run_checks(CROSSOVER, bars=_bars(), target_ko="005930 day 최근 300봉")
    checks = _by_id(payload)
    assert checks["dryrun"]["ok"] is True, payload["log"]
    assert payload["passed"] is True
    stats = payload["stats"]
    # 짧은 구간의 정의는 technique_check 하나뿐이다 — 320봉을 줘도 뒤 300봉만 돈다.
    assert stats["rows"] == DRYRUN_BARS
    assert stats["entry"] > 0 and stats["exit"] > 0
    assert 0 <= stats["warmup_bars"] < stats["rows"]
    assert checks["dryrun"]["detail_ko"] == (
        f"워밍업 {stats['warmup_bars']}봉 · entry {stats['entry']} · exit {stats['exit']}"
    )
    assert payload["error"] is None
    # 명령창에 그대로 찍을 줄들 — 대상이 어디였는지도 같이 남는다.
    assert any("005930 day 최근 300봉" in line for line in payload["log"])
    # 세는 것은 차단 다섯뿐이다. 남은 경고는 통과를 막지 않는다는 사실까지 같은 줄에 적는다.
    assert payload["log"][-1].startswith("검사 5/5 통과")
    assert "권고 1건(통과를 막지 않습니다)" in payload["log"][-1]


async def test_a_runtime_failure_comes_back_as_human_words_with_a_line() -> None:
    source = (
        "def signals(df, p):\n"
        "    entry = df['close'] > p['nope']\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry', 'exit']]\n"
    )
    payload = await run_checks(source, bars=_bars(60))
    checks = _by_id(payload)
    assert checks["syntax"]["ok"] is True
    assert checks["contract"]["ok"] is True
    assert checks["dryrun"]["ok"] is False
    assert payload["passed"] is False
    assert payload["stats"] is None
    # 역추적 원문이 아니라 사람 말이 온다(diagnose가 옮긴다). 줄 번호는 사용자 코드의 줄이다.
    assert "Traceback" not in checks["dryrun"]["detail_ko"]
    assert payload["error"]["line"] == 2


async def test_the_log_is_lines_the_command_window_can_print_as_is() -> None:
    log = (await run_checks(CROSSOVER))["log"]
    assert log[0].startswith("$ ")
    # 검사 하나에 명령 한 줄 — 일곱 항목이면 일곱 줄이다.
    assert sum(1 for line in log if line.startswith("$ ")) == 7
    assert all(isinstance(line, str) for line in log)


# ── 원칙 4 · 미래를 보지 않는다 ───────────────────────────────────────────────


def _wrap(body: str) -> str:
    """`signals` 한 줄 안에 검사 대상을 넣는다 — 앞 두 검사는 통과해야 뒤가 보인다."""
    return (
        "import numpy as np\n\n"
        "def signals(df, p):\n"
        f"    {body}\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry', 'exit']]\n"
    )


@pytest.mark.parametrize(
    ("body", "needle"),
    [
        ("entry = df['close'] > df['close'].shift(-1)", "shift(-1)은 다음 봉의 값을"),
        ("entry = df['close'] > df['close'].shift(periods=-2)", "shift(-2)은 다음 봉의 값을"),
        (
            "entry = df['close'] > df['close'].rolling(5, center=True).mean()",
            "rolling(center=True)는 창의 절반이 미래입니다",
        ),
        ("entry = df['close'] > df['close'].iloc[i + 1]", ".iloc[i+1]는 뒤 봉을 직접 읽습니다"),
        ("entry = df['close'] > df.loc[t + 1, 'close']", ".loc[i+1]는 뒤 봉을 직접 읽습니다"),
        ("entry = df['close'] > np.roll(df['close'], -1)", "roll(..., -1)은 뒤 봉을"),
    ],
)
async def test_looking_at_the_next_bar_blocks_with_a_line_number(body: str, needle: str) -> None:
    payload = await run_checks(_wrap(body))
    check = _by_id(payload)["lookahead"]
    assert check["ok"] is False
    assert check["severity"] == "block"
    assert "4번째 줄" in check["detail_ko"]
    assert needle in check["detail_ko"]
    assert payload["passed"] is False
    # 지금 고칠 자리 하나 — 줄 번호는 사용자 코드의 줄이다.
    assert payload["error"]["line"] == 4


@pytest.mark.parametrize(
    "body",
    [
        "entry = df['close'] > df['close'].shift(1)",
        "entry = df['close'] > df['close'].rolling(5).mean()",
        # 오늘까지 누적하는 슬라이스는 미래가 아니다 — 여기서 잡으면 멀쩡한 코드가 막힌다.
        "entry = df['close'] > df['close'].iloc[: i + 1].mean()",
        "entry = df['close'].rolling(5, center=False).mean() > 0",
    ],
)
async def test_yesterdays_bar_and_todays_window_are_not_lookahead(body: str) -> None:
    check = _by_id(await run_checks(_wrap(body)))["lookahead"]
    assert check["ok"] is True, check["detail_ko"]
    assert check["detail_ko"] == "미래를 보는 참조 없음 — 오늘 종가로 오늘 판단합니다"


async def test_a_broken_file_leaves_the_new_items_as_skipped_but_still_present() -> None:
    """검사 항목은 언제나 일곱이다 — 화면이 항목을 지어내지 않도록."""
    checks = _by_id(await run_checks("def signals(df, p)\n    return df\n"))
    assert [c["id"] for c in checks.values()] == [
        "syntax", "contract", "dryrun", "lookahead", "warmup", "magic", "structure",
    ]
    for check_id in ("lookahead", "warmup", "magic", "structure"):
        assert checks[check_id]["detail_ko"] == "앞 검사가 먼저"


# ── 원칙 5 · 워밍업 ──────────────────────────────────────────────────────────


WARMUP_VIOLATION = '''PARAMS = {
    "lookback": {"default": 20, "min": 5, "max": 60, "step": 1, "type": "int"},
}


def compute_band(df, p):
    """min_periods=1이라 첫 봉부터 값이 나온다 — 지표가 준비되기 전이다."""
    return df["close"].rolling(p["lookback"], min_periods=1).mean()


def should_enter(df, band):
    """종가가 평균 위면 진입."""
    return df["close"] > band


def should_exit(df, band):
    """종가가 평균 아래면 청산."""
    return df["close"] < band


def signals(df, p):
    """지표 하나로 진입·청산을 가른다."""
    band = compute_band(df, p)
    entry = should_enter(df, band)
    exit_ = should_exit(df, band)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''


async def test_a_signal_before_the_indicator_is_ready_blocks() -> None:
    payload = await run_checks(WARMUP_VIOLATION, bars=_bars())
    check = _by_id(payload)["warmup"]
    assert check["ok"] is False, payload["log"]
    assert check["severity"] == "block"
    # 창이 20봉이면 앞 19봉이 NaN 구간이다 — 그 안에 신호가 있었다는 사실을 그대로 센다.
    assert check["detail_ko"].startswith("앞 19봉 안에 entry ")
    assert "지표가 준비되기 전 봉입니다" in check["detail_ko"]
    assert payload["passed"] is False


async def test_a_clean_warmup_says_how_long_it_waited() -> None:
    payload = await run_checks(CROSSOVER, bars=_bars())
    check = _by_id(payload)["warmup"]
    # PARAMS 기본값 중 가장 긴 것이 5봉이다(fast 3 · slow 5).
    assert check == {
        "id": "warmup",
        "label_ko": "워밍업 전 신호 없음",
        "ok": True,
        "detail_ko": "워밍업 5봉 · 앞 4봉에 신호 없음",
        "severity": "block",
    }


async def test_without_a_length_to_estimate_the_warmup_check_says_it_skipped() -> None:
    """추정할 근거가 없으면 건너뛴다 — 지어낸 길이로 멀쩡한 코드를 막지 않는다."""
    source = (
        "def signals(df, p):\n"
        "    entry = df['close'] > df['open']\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry', 'exit']]\n"
    )
    check = _by_id(await run_checks(source, bars=_bars()))["warmup"]
    assert check["ok"] is True
    assert check["detail_ko"] == "워밍업 길이를 추정할 수 없어 건너뜀"


async def test_the_warmup_check_waits_for_the_dry_run() -> None:
    """돌려본 신호가 없으면 워밍업도 모른다 — 봉 없이 판정하지 않는다."""
    check = _by_id(await run_checks(CROSSOVER))["warmup"]
    assert check["ok"] is False
    assert check["detail_ko"] == "앞 검사가 먼저"


# ── 원칙 7 · 매직 넘버 ───────────────────────────────────────────────────────


MAGIC = '''PARAMS = {
    "lookback": {"default": 20, "min": 5, "max": 60, "step": 1, "type": "int"},
}


def compute_band(df, p):
    """돌파선."""
    return df["high"].rolling(14).max() * 1.03


def signals(df, p):
    """돌파선을 넘으면 진입."""
    entry = df["close"] > compute_band(df, p)
    exit_ = df["close"] < df["close"].rolling(p["lookback"]).min()
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
'''


async def test_numbers_left_in_the_body_come_back_as_a_warning_with_lines() -> None:
    payload = await run_checks(MAGIC)
    check = _by_id(payload)["magic"]
    assert check["ok"] is False
    assert check["severity"] == "warn"
    assert check["detail_ko"].startswith("기간·배수·문턱은 PARAMS로: ")
    assert "8번째 줄: 14" in check["detail_ko"] and "8번째 줄: 1.03" in check["detail_ko"]


@pytest.mark.parametrize(
    "body",
    [
        # 항등·단위 값은 예외다 — 이것까지 PARAMS로 올리라고 하면 경고가 소음이 된다.
        "entry = df['close'].shift(1) > df['close'] * 1.0",
        "entry = df['close'] > 0",
        "entry = df['close'].pct_change() * 100 > 1",
        "entry = df['close'] > df['close'].shift(-1) * 0.5",
        # PARAMS에 적힌 숫자는 매직 넘버가 아니다 — 범위(min/max/step)에 쓰인 값도 같다.
        "entry = df['close'].rolling(5).max() > df['close'].rolling(60).min()",
    ],
)
async def test_identity_values_and_numbers_written_in_params_are_not_magic(body: str) -> None:
    source = (
        'PARAMS = {"lookback": {"default": 20, "min": 5, "max": 60, "step": 1, "type": "int"}}\n\n'
        "def signals(df, p):\n"
        f"    {body}\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry', 'exit']]\n"
    )
    check = _by_id(await run_checks(source))["magic"]
    assert check["ok"] is True, check["detail_ko"]
    assert check["detail_ko"] == "함수 안에 남은 매직 넘버 없음"


# ── 원칙 2·3 · 노드 단위 구조 ────────────────────────────────────────────────


async def test_one_function_means_no_nodes_and_the_check_says_how_to_split() -> None:
    check = _by_id(await run_checks(CROSSOVER))["structure"]
    assert check["ok"] is False
    assert check["severity"] == "warn"
    assert "함수로 나누면 노드가 생깁니다" in check["detail_ko"]
    assert "compute_*" in check["detail_ko"] and "should_enter" in check["detail_ko"]
    # docstring이 없는 함수는 노드 설명이 빈 칸으로 열린다 — 그 사실도 같은 항목에 담는다.
    assert "노드 설명이 없습니다: signals()" in check["detail_ko"]


async def test_a_missing_exit_function_is_named() -> None:
    source = (
        "def compute_band(df, p):\n"
        '    """돌파선."""\n'
        "    return df['high'].rolling(20).max()\n"
        "\n"
        "def should_enter(df, band):\n"
        '    """돌파선을 넘으면 진입."""\n'
        "    return df['close'] > band\n"
        "\n"
        "def signals(df, p):\n"
        '    """조립."""\n'
        "    entry = should_enter(df, compute_band(df, p))\n"
        "    return df.assign(entry=entry, exit=~entry)[['entry', 'exit']]\n"
    )
    check = _by_id(await run_checks(source))["structure"]
    assert check["ok"] is False
    assert check["detail_ko"] == "청산 판단(should_exit) 함수가 없습니다 — 이름이 역할을 정합니다"


async def test_a_source_that_follows_the_principles_passes_the_structure_check() -> None:
    check = _by_id(await run_checks(WARMUP_VIOLATION))["structure"]
    assert check["ok"] is True
    assert check["detail_ko"] == "최상위 함수 4개 · 진입·청산 판단과 노드 설명이 모두 있습니다"


# ── 차단과 경고의 경계 ───────────────────────────────────────────────────────


async def test_warnings_never_close_the_node_window() -> None:
    """구조·매직 넘버 경고가 둘 다 떠도 차단 다섯이 통과하면 `passed`는 참이다."""
    source = (
        "def signals(df, p):\n"
        "    entry = df['close'] > df['close'].rolling(7).mean()\n"
        "    exit_ = df['close'] < df['close'].rolling(7).mean()\n"
        "    return df.assign(entry=entry, exit=exit_)[['entry', 'exit']]\n"
    )
    payload = await run_checks(source, bars=_bars())
    checks = _by_id(payload)
    assert checks["magic"]["ok"] is False and checks["structure"]["ok"] is False
    assert all(c["ok"] for c in payload["checks"] if c["severity"] == "block"), payload["log"]
    assert payload["passed"] is True
    assert payload["log"][-1].startswith("검사 5/5 통과")
    assert "권고 2건" in payload["log"][-1]
