"""고침 이력의 순수 계산 — 한 판 접기·값 맞대기·한 바퀴 요약.

이 모듈이 지어내면 화면이 지어낸다: 「방금 바뀜」·「3일 → 5일」·「4번 → 2번」이
전부 여기서 나온다. 그래서 앞뒤 판이 실제로 다를 때만 표시가 붙는지, 없는 값은
None으로 남는지를 못 박는다.
"""

from __future__ import annotations

from athena_api.routines.revisions import (
    MAX_REVISIONS,
    WatchRevision,
    diff_inputs,
    fix_cycle,
    history_view,
    mark_fixed_nodes,
    push,
)


def _nodes(days, ratio):
    return [
        {
            "fn": "load_bars",
            "title_ko": "일봉 불러오기",
            "inputs": [{"name": "종목", "value": "삼성전자"}],
            "output": "봉 60개",
        },
        {
            "fn": "avg_volume",
            "title_ko": f"{days} 거래량 평균",
            "inputs": [{"name": "봉", "value": "60개"}, {"name": "평균 일수", "value": days}],
            "output": "1,240만주",
        },
        {
            "fn": "volume_ratio",
            "title_ko": "배수 비교",
            "inputs": [{"name": "배수", "value": ratio}],
            "output": "1.27배",
        },
    ]


def _check(days="3일", ratio="1.5배", count=4, fires=("2026-08-12", "2026-08-26")):
    return {
        "checked_at": "2026-09-05T06:31:00+00:00",
        "nodes": _nodes(days, ratio),
        "count": count,
        "fires": [{"dt": d, "close": 71000.0} for d in fires],
        "lookback_days": 30,
        "duration_ms": 9000,
    }


def test_diff_only_reports_inputs_that_actually_changed():
    rows = diff_inputs(_nodes("3일", "1.5배"), _nodes("5일", "2.0배"))
    assert rows == [
        {"label": "평균 일수", "before": "3일", "after": "5일"},
        {"label": "배수", "before": "1.5배", "after": "2.0배"},
    ]


def test_diff_is_empty_when_the_two_rounds_are_identical():
    assert diff_inputs(_nodes("3일", "1.5배"), _nodes("3일", "1.5배")) == []


def test_marks_only_the_changed_cards_and_overlays_the_arrow():
    marked = mark_fixed_nodes(_nodes("3일", "1.5배"), _nodes("5일", "2.0배"))
    assert [n["changed"] for n in marked] == [False, True, True]
    assert marked[1]["inputs"][0]["value"] == "60개"  # 안 바뀐 칸은 그대로
    assert marked[1]["inputs"][1]["value"] == "3일 → 5일"
    assert marked[2]["inputs"][0]["value"] == "1.5배 → 2.0배"


def test_a_node_the_previous_round_did_not_have_is_left_alone():
    after = [*_nodes("5일", "2.0배"), {"fn": "fire", "inputs": [{"name": "넘음", "value": False}]}]
    marked = mark_fixed_nodes(_nodes("3일", "1.5배"), after)
    assert "changed" not in marked[3]


def test_boolean_inputs_are_compared_as_korean_words():
    before = [{"fn": "fire", "inputs": [{"name": "넘음", "value": True}]}]
    after = [{"fn": "fire", "inputs": [{"name": "넘음", "value": False}]}]
    assert diff_inputs(before, after) == [{"label": "넘음", "before": "참", "after": "거짓"}]


def test_cycle_counts_fires_before_and_after_from_real_checks():
    history = push([], WatchRevision("a" * 64, "2026-09-05T06:40:00+00:00", "src", _check()))
    cycle = fix_cycle(history, _check("5일", "2.0배", count=2, fires=("2026-08-12", "2026-08-26")))
    assert cycle["fix_count"] == 1
    assert cycle["past_count"] == 0
    assert (cycle["fires_before"], cycle["fires_after"]) == (4, 2)
    assert cycle["fires_before_dates"] == ["2026-08-12", "2026-08-26"]
    assert cycle["lookback_days"] == 30
    assert cycle["duration_ms"] == 9000
    assert cycle["changed_nodes"] == 2
    assert [r["label"] for r in cycle["changes"]] == ["평균 일수", "배수"]
    assert cycle["can_rollback"] is True


def test_cycle_is_none_before_the_first_fix_and_without_a_check():
    assert fix_cycle([], _check()) is None
    assert fix_cycle([WatchRevision("a" * 64, "t", "src", _check()).to_dict()], None) is None


def test_cycle_leaves_a_missing_count_empty_instead_of_guessing():
    history = [WatchRevision("a" * 64, "t", "src", {}).to_dict()]
    cycle = fix_cycle(history, {"nodes": [], "checked_at": "t2"})
    assert cycle["fires_before"] is None
    assert cycle["fires_after"] is None
    assert cycle["changes"] == []


def test_push_keeps_only_the_last_rounds():
    history: list = []
    for i in range(MAX_REVISIONS + 3):
        history = push(history, WatchRevision(f"{i:064d}", "t", f"src{i}", _check()))
    assert len(history) == MAX_REVISIONS
    assert history[0]["source"] == "src3"
    assert history[-1]["source"] == f"src{MAX_REVISIONS + 2}"


def test_history_view_drops_the_round_that_rollback_would_restore():
    history = [
        WatchRevision("a" * 64, "t1", "s1", _check(count=6)).to_dict(),
        WatchRevision("b" * 64, "t2", "s2", _check(count=4)).to_dict(),
    ]
    assert history_view(history) == [
        {"fixed_at": "t1", "fire_count": 6, "lookback_days": 30}
    ]
    assert history_view([]) == []


def test_revision_round_trips_through_its_dict():
    entry = WatchRevision("c" * 64, "t", "print(1)", _check())
    again = WatchRevision.from_dict(entry.to_dict())
    assert again == entry
    assert again.fire_count == 4
    assert again.lookback_days == 30
