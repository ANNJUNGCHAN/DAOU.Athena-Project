"""mapmodel.py — 흐름 지도(Paper 보드 11~14).

지도는 사람이 읽는 문장과 **마지막 실행이 실제로 남긴 사실**만 말한다. 그래서 테스트도
두 가지를 주로 고정한다: (1) 문장이 코드 조각이 아니라 한국어인지, (2) 없는 값을 지어내지
않고 모르는 칸은 모른다고 하는지. flow.py 테스트와 같은 규율이다.
"""

from __future__ import annotations

import pytest

from athena_api.backtest import codegen, mapmodel, presets
from athena_api.backtest.schema import from_kis_yaml

_SMA = presets.preset_yaml("sma_crossover")


def _spec_map(**kwargs):
    return mapmodel.build_map(spec=from_kis_yaml(_SMA), **kwargs)


def _code_map(**kwargs):
    source = codegen.spec_to_python(from_kis_yaml(_SMA))
    return mapmodel.build_map(source=source, **kwargs)


def test_exactly_one_of_spec_or_source() -> None:
    with pytest.raises(ValueError):
        mapmodel.build_map()
    with pytest.raises(ValueError):
        mapmodel.build_map(spec=from_kis_yaml(_SMA), source="x = 1")


def test_spec_map_has_four_numbered_nodes() -> None:
    m = _spec_map(version=2)
    assert m["source_kind"] == "spec"
    assert m["version"] == 2
    assert [n["id"] for n in m["nodes"]] == ["params", "indicators", "conditions", "guard"]
    assert [n["numeral"] for n in m["nodes"]] == ["①", "②", "③", "④"]
    assert m["nodes"][3]["title"] == "지키는 선을 겁니다"
    assert m["boundary_after_note"] == "entry·exit 두 열만 받습니다"


def test_spec_sentences_are_korean_not_code() -> None:
    nodes = {n["id"]: n for n in _spec_map()["nodes"]}
    assert [line["text"] for line in nodes["params"]["lines"]] == [
        "fast 20 (5–60, 1씩)",
        "slow 60 (20–240, 1씩)",
    ]
    assert [line["text"] for line in nodes["indicators"]["lines"]] == [
        "ma_fast — SMA(20) · 종가",
        "ma_slow — SMA(60) · 종가",
    ]
    assert nodes["conditions"]["lines"] == [
        {"role": "entry", "text": "ma_fast가 ma_slow를 위로 뚫는 날"},
        {"role": "exit", "text": "ma_fast가 ma_slow를 아래로 뚫는 날"},
    ]
    # 지키는 선은 스펙에 적힌 값만 말한다 — 익절은 꺼져 있으므로 퍼센트를 말하지 않는다.
    assert [line["text"] for line in nodes["guard"]["lines"]] == [
        "손절 −8% 켜짐",
        "익절 꺼짐",
        "비중 전액 1종목",
    ]


def test_spec_map_carries_the_target_when_the_form_has_one() -> None:
    with_data = _SMA.replace(
        "strategy:",
        'data:\n  symbols: ["005930"]\n  period: day\n  adjusted: true\n'
        '  from: "20240101"\n  to: "20241231"\nstrategy:',
        1,
    )
    m = mapmodel.build_map(spec=from_kis_yaml(with_data))
    assert m["target"] == {
        "symbol": "005930",
        "period": "day",
        "adjusted": True,
        "from": "20240101",
        "to": "20241231",
    }
    # data가 없는 프리셋은 지어내지 않고 None으로 둔다.
    assert _spec_map()["target"] is None


def test_spec_map_counts_the_code_behind_it() -> None:
    m = _spec_map()
    generated = codegen.spec_to_python(from_kis_yaml(_SMA))
    assert m["code"] == {"lines": len(generated.splitlines()), "matches_map": True}


def test_code_map_has_line_ranges_and_an_unknown_guard() -> None:
    m = _code_map()
    assert m["source_kind"] == "code"
    nodes = {n["id"]: n for n in m["nodes"]}
    for node_id in ("params", "indicators", "conditions"):
        assert nodes[node_id]["first_line"] is not None
        assert nodes[node_id]["last_line"] >= nodes[node_id]["first_line"]
        assert nodes[node_id]["editable"] is False
    assert nodes["indicators"]["lines"][0]["text"] == "ma_fast · ma_slow — 2열"
    assert nodes["indicators"]["lines"][1]["text"] == "sma 호출"
    # 코드에는 지키는 선이 없다 — 없는 것을 있다고 하지 않는다.
    assert nodes["guard"]["status"] == "unknown"
    assert nodes["guard"]["note"] == "코드 전략의 지키는 선은 앱 설정에서 옵니다"
    # 앱이 두 열을 가져가는 경계는 return 줄이다.
    assert m["boundary_after_lines"]["first_line"] == m["boundary_after_lines"]["last_line"]
    assert m["unknown"] == [] and m["free_code"] == []


def test_error_line_attaches_to_the_node_that_owns_it() -> None:
    plain = _code_map()
    indicators_node = next(n for n in plain["nodes"] if n["id"] == "indicators")
    m = _code_map(error={"message": "KeyError: 'close'", "lineno": indicators_node["first_line"]})
    hit = next(n for n in m["nodes"] if n["id"] == "indicators")
    assert hit["status"] == "error"
    assert hit["note"] == "KeyError: 'close'"
    assert m["error"] is None
    assert [n["status"] for n in m["nodes"] if n["id"] != "indicators"] == ["ok", "ok", "unknown"]


def test_error_node_id_wins_over_lines() -> None:
    m = _spec_map(error={"message": "지표를 만들지 못했습니다", "node": "indicators"})
    hit = next(n for n in m["nodes"] if n["id"] == "indicators")
    assert hit["status"] == "error" and hit["note"] == "지표를 만들지 못했습니다"


def test_unmappable_error_stays_at_the_top_and_paints_no_node() -> None:
    """어느 칸의 것인지 모르면 아무 칸이나 빨갛게 칠하지 않는다 — 그건 거짓 지도다."""
    m = _code_map(error={"message": "알 수 없는 실패", "lineno": 9999})
    assert m["error"] == "알 수 없는 실패"
    assert {n["status"] for n in m["nodes"]} == {"ok", "unknown"}


def test_facts_come_from_a_real_run_only() -> None:
    empty = _spec_map()
    assert all(n["facts"] == [] for n in empty["nodes"])
    m = _spec_map(
        result={"rows": 606, "warmup_bars": 60, "signal_counts": {"entry": 41, "exit": 41}}
    )
    nodes = {n["id"]: n for n in m["nodes"]}
    assert nodes["indicators"]["facts"] == ["df — 606행 × 5열", "앞 60봉은 빈칸(워밍업)"]
    assert nodes["conditions"]["facts"] == ["entry 41개 · exit 41개"]


def test_broken_code_reports_unknown_and_free_code() -> None:
    """지도가 못 담은 줄은 숨기지 않고 그대로 내놓는다 — 코드가 지도보다 넓을 수 있다."""
    source = (
        "def signals(df, p):\n"
        '    print("여기는 지도에 없는 줄")\n'
        "    fast = 1\n"
        '    return df.assign(entry=fast, exit=fast)[["entry", "exit"]]\n'
    )
    m = mapmodel.build_map(source=source)
    assert m["unknown"]  # PARAMS가 없다
    assert m["code"]["matches_map"] is False
    assert m["free_code"] == [
        {"first_line": 2, "last_line": 2, "text": "지도가 못 담는 코드"}
    ]
    nodes = {n["id"]: n for n in m["nodes"]}
    assert nodes["params"]["status"] == "unknown"


def test_syntax_error_becomes_the_top_level_error() -> None:
    m = mapmodel.build_map(source="def signals(df, p:\n    return df\n")
    assert m["error"] is not None
    assert all(n["status"] == "unknown" for n in m["nodes"])
