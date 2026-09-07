"""`scripts/validate_board_slots.py` 단위 테스트.

실행: cd C:\\Projects\\DAOU.Athena && python -m pytest scripts/tests -q
"""

from __future__ import annotations

import json

import pytest
import validate_board_slots as vbs

VISIBLE = {("base:kt00001", "9201"): "계좌번호", ("base:kt00001", "8019"): "예수금"}
HIDDEN = {("base:kt00001", "return_code")}


def _board(tmp_path, payload, pack=None, name="X-0"):
    board_dir = tmp_path / name
    board_dir.mkdir(exist_ok=True)
    (board_dir / "slots.json").write_text(
        json.dumps({"board_id": name, **payload}, ensure_ascii=False), encoding="utf-8"
    )
    pack_dir = tmp_path / "packs"
    pack_dir.mkdir(exist_ok=True)
    if pack is not None:
        (pack_dir / f"{name}.pack.json").write_text(
            json.dumps({"fields": pack}, ensure_ascii=False), encoding="utf-8"
        )
    return board_dir, pack_dir


def _check(tmp_path, payload, pack=None):
    board_dir, pack_dir = _board(tmp_path, payload, pack)
    return vbs.check_board(board_dir, VISIBLE, HIDDEN, pack_dir)


def _slot(slot_id, **extra):
    base = {
        "slot_id": slot_id,
        "kind": "value",
        "mapping_id": None,
        "f": None,
        "table": None,
        "node_path": "0/0",
    }
    base.update(extra)
    return base


# --------------------------------------------------------------------------- #
# a. 원장 대조
# --------------------------------------------------------------------------- #


def test_unknown_and_hidden_mappings_are_separated(tmp_path):
    report = _check(
        tmp_path,
        {
            "slots": [
                _slot("s1", mapping_id="base:kt00001", f="9201"),
                _slot("s2", mapping_id="base:kt00001", f="0000"),
                _slot("s3", mapping_id="base:kt00001", f="return_code"),
            ]
        },
    )
    assert report["mapped"] == 3
    assert report["unknown"] == ["s2 base:kt00001|0000"]
    assert report["hidden"] == ["s3 base:kt00001|return_code"]


def test_hidden_fields_read_the_json_path_form():
    hidden = vbs.hidden_fields()
    # 원장이 `base:00|$.return_code|1` 꼴로 적으므로 `$.` 없는 이름으로도 걸린다.
    assert not hidden or ("base:00", "return_code") in hidden


# --------------------------------------------------------------------------- #
# b. 값 슬롯 미지정
# --------------------------------------------------------------------------- #


def test_unmapped_counts_values_only(tmp_path):
    report = _check(
        tmp_path,
        {
            "slots": [
                _slot("s1"),
                _slot("s2", kind="label"),
                _slot("s3", mapping_id="base:kt00001", f="9201"),
            ]
        },
    )
    assert report["unmapped"] == 1


def test_composite_parts_count_as_slot_and_pack_bindings(tmp_path):
    composite = {
        "separator": " · ",
        "parts": [
            {"mapping_id": "base:kt00001", "f": "9201", "format": {"kind": "text"}},
            {"mapping_id": "base:kt00001", "f": "8019", "format": {"kind": "number"}},
        ],
    }
    pack = [
        {"mapping_id": "base:kt00001", "f": "9201", "kor": "계좌번호", "attributed_here": True},
        {"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True},
    ]
    report = _check(tmp_path, {"slots": [_slot("s1", composite=composite)]}, pack)
    assert report["mapped"] == 1
    assert report["unmapped"] == 0
    assert report["unknown"] == []
    assert report["unbound"] == []


# --------------------------------------------------------------------------- #
# c. 병기 짝
# --------------------------------------------------------------------------- #


def test_paired_with_must_point_at_a_value_slot_in_the_same_row(tmp_path):
    cell = {"table": "T-0", "row": "0", "col": 1}
    other = {"table": "T-0", "row": "1", "col": 1}
    report = _check(
        tmp_path,
        {
            "slots": [
                _slot("good", table=cell, paired_with="anchor"),
                _slot("anchor", table=cell),
                _slot("far", table=other, paired_with="anchor"),
                _slot("gone", paired_with="없음"),
                _slot("label_target", kind="label"),
                _slot("onlabel", paired_with="label_target"),
            ]
        },
    )
    assert report["paired"] == [
        "far→anchor 다른 셀·행",
        "gone→없음 없는 슬롯",
        "onlabel→label_target 값 슬롯이 아니다",
    ]


def test_paired_with_falls_back_to_the_parent_path_off_table(tmp_path):
    report = _check(
        tmp_path,
        {
            "slots": [
                _slot("a", node_path="1/2/0"),
                _slot("b", node_path="1/2/1", paired_with="a"),
                _slot("c", node_path="1/3/0", paired_with="a"),
            ]
        },
    )
    assert report["paired"] == ["c→a 다른 셀·행"]


# --------------------------------------------------------------------------- #
# d·e. 열 묶음 · 팩 미바인딩
# --------------------------------------------------------------------------- #


def test_columns_without_mapping_are_listed(tmp_path):
    report = _check(
        tmp_path,
        {
            "slots": [],
            "column_bindings": [
                {
                    "table_id": "T-0",
                    "columns": [
                        {"col": 1, "header": "일자", "mapping_id": "base:kt00001", "f": "9201"},
                        {"col": 2, "header": "금액"},
                    ],
                }
            ],
        },
    )
    assert report["columns"] == ["T-0·금액"]


def test_static_column_is_not_a_problem_when_its_cells_are_settled(tmp_path):
    """`kind: "static"` 열 — 라벨 셀·`static: true` 셀·셀 단위 바인딩은 다 끝난 자리다."""
    report = _check(
        tmp_path,
        {
            "slots": [
                _slot("s1", kind="label"),
                _slot("s2", static=True),
                _slot("s3", mapping_id="base:kt00001", f="8019"),
            ],
            "column_bindings": [
                {
                    "table_id": "T-0",
                    "columns": [
                        {"col": 1, "header": "항목", "kind": "static", "slot_ids": ["s1"]},
                        {"col": 2, "header": "단계", "kind": "static", "slot_ids": ["s2"]},
                        {"col": 3, "header": "매도호가", "kind": "static", "slot_ids": ["s3"]},
                    ],
                }
            ],
        },
    )
    assert report["columns"] == []


def test_static_column_still_flagged_when_a_value_cell_is_unbound(tmp_path):
    """static 표식으로 미바인딩 값 셀을 덮을 수는 없다."""
    report = _check(
        tmp_path,
        {
            "slots": [_slot("s1", static=True), _slot("s2")],
            "column_bindings": [
                {
                    "table_id": "T-0",
                    "columns": [
                        {"col": 1, "header": "금액", "kind": "static", "slot_ids": ["s1", "s2"]}
                    ],
                }
            ],
        },
    )
    assert report["columns"] == ["T-0·금액"]


def test_pack_fields_attributed_here_must_be_bound(tmp_path):
    payload = {
        "slots": [_slot("s1", mapping_id="base:kt00001", f="9201")],
        "column_bindings": [],
    }
    pack = [
        {"mapping_id": "base:kt00001", "f": "9201", "kor": "계좌번호", "attributed_here": True},
        {"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True},
        {"mapping_id": "base:kt00001", "f": "9999", "kor": "남의 것", "attributed_here": False},
    ]
    report = _check(tmp_path, payload, pack)
    assert report["unbound"] == ["예수금·base:kt00001·8019"]


def test_column_binding_counts_as_binding_for_the_pack(tmp_path):
    payload = {
        "slots": [],
        "column_bindings": [
            {
                "table_id": "T-0",
                "columns": [{"col": 1, "header": "예수금", "mapping_id": "base:kt00001", "f": "8019"}],
            }
        ],
    }
    pack = [{"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True}]
    assert _check(tmp_path, payload, pack)["unbound"] == []


def test_alt_mappings_count_as_binding_for_the_pack(tmp_path):
    """같은 자리를 여러 op가 나눠 쓰면 갈음 매핑이 그 필드를 닿게 한다."""
    payload = {
        "slots": [
            _slot(
                "s1",
                mapping_id="base:kt00001",
                f="9201",
                alt_mappings=[{"mapping_id": "base:kt00001", "f": "8019"}],
            )
        ],
        "column_bindings": [],
    }
    pack = [
        {"mapping_id": "base:kt00001", "f": "9201", "kor": "계좌번호", "attributed_here": True},
        {"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True},
    ]
    assert _check(tmp_path, payload, pack)["unbound"] == []


def test_column_alt_mappings_stand_in_for_a_missing_column_mapping(tmp_path):
    payload = {
        "slots": [],
        "column_bindings": [
            {
                "table_id": "T-0",
                "columns": [
                    {
                        "col": 1,
                        "header": "예수금",
                        "alt_mappings": [{"mapping_id": "base:kt00001", "f": "8019"}],
                    }
                ],
            }
        ],
    }
    pack = [{"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True}]
    report = _check(tmp_path, payload, pack)
    assert report["unbound"] == []
    assert report["columns"] == []


def test_alt_mappings_are_read_against_the_ledger_too(tmp_path):
    """갈음 매핑에 오타를 내면 조용히 바인딩으로 세지 않는다."""
    payload = {
        "slots": [
            _slot("s1", alt_mappings=[{"mapping_id": "base:kt00001", "f": "오타"}]),
            _slot("s2", alt_mappings=[{"mapping_id": "base:kt00001", "f": "return_code"}]),
        ],
        "column_bindings": [],
    }
    report = _check(tmp_path, payload)
    assert report["unknown"] == ["s1 alt base:kt00001|오타"]
    assert report["hidden"] == ["s2 alt base:kt00001|return_code"]
    # 갈음 매핑을 준 값 슬롯은 b(미지정)로 세지 않는다.
    assert report["unmapped"] == 0


def _indexed_board(direction, start, step, rows=2):
    slots = [
        _slot(f"c{r}", table={"table": "T-0", "row": str(r), "col": 0}) for r in range(rows)
    ]
    return {
        "slots": slots,
        "column_bindings": [
            {
                "table_id": "T-0",
                "columns": [
                    {
                        "col": 1,
                        "header": "잔량",
                        "mapping_id": "base:kt00001",
                        "indexed": {
                            "f_pattern": "{i}",
                            "start": start,
                            "step": step,
                            "direction": direction,
                        },
                        "slot_ids": [s["slot_id"] for s in slots],
                    }
                ],
            }
        ],
    }


def test_indexed_column_binds_one_field_per_body_row(tmp_path):
    pack = [
        {"mapping_id": "base:kt00001", "f": "9201", "kor": "계좌번호", "attributed_here": True},
        {"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True},
    ]
    # 행 0 → 9201, 행 1 → 8019(위에서 아래로 번호가 줄어드는 호가 꼴).
    payload = _indexed_board("up", 9201, -1182)
    report = _check(tmp_path, payload, pack)
    assert report["unbound"] == []
    assert report["columns"] == []


def test_indexed_column_with_a_broken_direction_is_a_column_problem(tmp_path):
    report = _check(tmp_path, _indexed_board("down", 9201, -1182))
    assert len(report["columns"]) == 1
    assert "indexed" in report["columns"][0]


def test_indexed_column_skips_the_foot_row(tmp_path):
    """합계·소계 행(`row: "foot"`)은 행 번호가 없다 — 인덱스가 닿지 않는다."""
    payload = _indexed_board("up", 9201, -1182)
    payload["slots"].append(
        _slot("cfoot", table={"table": "T-0", "row": "foot", "col": 0})
    )
    payload["column_bindings"][0]["columns"][0]["slot_ids"].append("cfoot")
    by_id = {slot["slot_id"]: slot for slot in payload["slots"]}
    column = payload["column_bindings"][0]["columns"][0]
    assert vbs.indexed_fields(column, by_id) == ["9201", "8019"]
    pack = [
        {"mapping_id": "base:kt00001", "f": "9201", "kor": "계좌번호", "attributed_here": True},
        {"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True},
    ]
    report = _check(tmp_path, payload, pack)
    assert report["columns"] == []
    assert report["unknown"] == []
    assert report["unbound"] == []


def test_indexed_fields_that_miss_the_ledger_are_reported(tmp_path):
    report = _check(tmp_path, _indexed_board("down", 9201, 1))
    assert report["unknown"] == ["T-0·잔량 base:kt00001|9202"]


# --------------------------------------------------------------------------- #
# f·g. 중복 표기 · 없는 참조
# --------------------------------------------------------------------------- #


def test_duplicate_display_needs_display_dup(tmp_path):
    twice = {"mapping_id": "base:kt00001", "f": "9201"}
    report = _check(tmp_path, {"slots": [_slot("s1", **twice), _slot("s2", **twice)]})
    assert report["dup"] == ["base:kt00001|9201 ×2"]
    marked = _check(
        tmp_path,
        {"slots": [_slot("s1", **twice), _slot("s2", display_dup="병기", **twice)]},
    )
    assert marked["dup"] == []


def test_row_repeat_down_one_table_column_is_not_a_duplicate(tmp_path):
    """열 하나를 행마다 되풀이한 표 본문은 중복 표기가 아니다."""
    twice = {"mapping_id": "base:kt00001", "f": "9201"}
    rows = [
        _slot(f"c{r}", table={"table": "T-0", "row": str(r), "col": 2}, **twice) for r in range(3)
    ]
    assert _check(tmp_path, {"slots": rows})["dup"] == []
    # 다른 열·다른 표에 같은 필드를 또 그리면 여전히 display_dup가 필요하다.
    other = _slot("h1", table={"table": "T-0", "row": "0", "col": 5}, **twice)
    assert _check(tmp_path, {"slots": rows + [other]})["dup"] == ["base:kt00001|9201 ×4"]
    # 헤더 KPI 재표시(표 밖)도 display_dup로 못박아야 한다.
    kpi = _slot("k1", **twice)
    assert _check(tmp_path, {"slots": rows + [kpi]})["dup"] == ["base:kt00001|9201 ×4"]


def test_non_table_row_indices_distinguish_rows_but_not_restatements(tmp_path):
    """되풀이 블록의 서로 다른 배열 행만 중복 표기에서 제외한다."""
    twice = {"mapping_id": "base:kt00001", "f": "9201", "node_path": "0"}
    rows = [_slot(f"r{row}", row_index=row, **twice) for row in range(3)]
    assert _check(tmp_path, {"slots": rows})["dup"] == []

    same_row = _slot("r0-again", row_index=0, **twice)
    assert _check(tmp_path, {"slots": rows + [same_row]})["dup"] == [
        "base:kt00001|9201 ×4"
    ]

    missing_row = _slot("without-row", **twice)
    assert _check(tmp_path, {"slots": rows + [missing_row]})["dup"] == [
        "base:kt00001|9201 ×4"
    ]

    restatement = _slot("row-echo", display_dup=True, **twice)
    assert _check(tmp_path, {"slots": rows + [restatement]})["dup"] == []


def test_two_leaves_in_one_cell_still_need_display_dup(tmp_path):
    twice = {"mapping_id": "base:kt00001", "f": "9201"}
    cell = {"table": "T-0", "row": "0", "col": 2}
    pair = [_slot("c0", table=cell, **twice), _slot("c0b", table=cell, **twice)]
    assert _check(tmp_path, {"slots": pair})["dup"] == ["base:kt00001|9201 ×2"]


def test_collapse_group_and_expanded_board_must_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(vbs, "TEMPLATE_ROOT", tmp_path)
    (tmp_path / "REAL-0").mkdir()
    report = _check(
        tmp_path,
        {
            "slots": [
                _slot("rollup"),
                _slot("a", collapse_group={"group_id": "g", "rollup_slot": "rollup"}),
                _slot("b", collapse_group={"group_id": "g", "rollup_slot": "없음"}),
                _slot("c", expanded_board="REAL-0"),
                _slot("d", expanded_board="NOPE-0"),
            ]
        },
    )
    assert report["dangling"] == ["b rollup_slot=없음", "d expanded_board=NOPE-0"]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def test_problems_sum_and_exit_code(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(vbs, "TEMPLATE_ROOT", tmp_path)
    monkeypatch.setattr(vbs, "visible_fields", lambda: VISIBLE)
    monkeypatch.setattr(vbs, "hidden_fields", lambda: HIDDEN)
    _, pack_dir = _board(
        tmp_path, {"slots": [_slot("s1"), _slot("s2", mapping_id="base:kt00001", f="9201")]}
    )
    assert vbs.main(["X-0", "--pack-dir", str(pack_dir)]) == 1
    out = capsys.readouterr().out
    assert "X-0: 슬롯 2 · 값 2 · 매핑 1 · 문제 1" in out
    assert "합계 문제 1" in out


def test_clean_board_exits_zero(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(vbs, "TEMPLATE_ROOT", tmp_path)
    monkeypatch.setattr(vbs, "visible_fields", lambda: VISIBLE)
    monkeypatch.setattr(vbs, "hidden_fields", lambda: HIDDEN)
    _, pack_dir = _board(
        tmp_path, {"slots": [_slot("s1", mapping_id="base:kt00001", f="9201")]}
    )
    assert vbs.main(["X-0", "--pack-dir", str(pack_dir)]) == 0


def test_missing_board_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(vbs, "TEMPLATE_ROOT", tmp_path)
    with pytest.raises(SystemExit):
        vbs.board_dirs(["없는보드"])


# --------------------------------------------------------------------------- #
# 집계 — 보드별 b/d/e/c/f/g
# --------------------------------------------------------------------------- #


def test_tally_groups_problems_by_letter(tmp_path, capsys):
    payload = {
        "slots": [
            _slot("s1"),
            _slot("s2"),
            _slot("s3", mapping_id="base:kt00001", f="없는 것"),
        ],
        "column_bindings": [{"table_id": "T-0", "columns": [{"col": 1, "header": "금액"}]}],
    }
    pack = [{"mapping_id": "base:kt00001", "f": "8019", "kor": "예수금", "attributed_here": True}]
    report = _check(tmp_path, payload, pack)
    assert report["tally"] == {"a": 1, "b": 2, "d": 1, "e": 1}
    assert report["problems"] == 5
    vbs.print_report(report)
    out = capsys.readouterr().out
    assert "(a1 b2 d1 e1)" in out
    assert "e 미바인딩 필드 1: 예수금·base:kt00001·8019" in out
