"""표면 템플릿 로더 — 부분 로드 허용과 fail-closed 6종 규칙.

픽스처는 `tests/fixtures/card-surface`의 축약 2SKU-1 보드(기본 1장 + 탭 T 보드 1장 +
펼침 X 보드 1장)다. 실제 op(`base:ka10085`·`base:kt00003`·
`detail:ka10087:sell_bid_prices`)의 canonical occurrence에 붙어 있어서 바인딩 규칙이
진짜 원장을 상대로 검증된다. 탭 보드가 대체 바인딩(`alt_mappings`)·지시 열
(`indexed.f_pattern`)·한 열의 행 반복을 든다.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from athena_api.card_surface_templates import (
    DENSITY_BUDGET,
    HEIGHT_BUDGET_PX,
    SOFT_DENSITY_BUDGET,
    CardSurfaceTemplateError,
    SurfaceUniverse,
    default_universe,
    load_registry,
    resolve_occurrence_id,
    visible_contracts,
    visible_occurrence_ids,
)

FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "card-surface"
FIXTURE_OPERATIONS = (
    "base:ka10085",
    "base:kt00003",
    "detail:ka10087:sell_bid_prices",
)


@pytest.fixture
def universe() -> SurfaceUniverse:
    """픽스처 보드가 덮기로 한 전집합 — 실제 원장에서 잘라낸다."""

    return SurfaceUniverse(
        operation_refs=frozenset(FIXTURE_OPERATIONS),
        visible_occurrence_ids=visible_occurrence_ids(FIXTURE_OPERATIONS),
    )


def test_default_universe_excludes_only_the_named_base_04_reserve_slots() -> None:
    reserve_contracts = {
        contract.alias: contract
        for contract in visible_contracts("base:04")
        if contract.alias in {"924", "951"}
    }
    unrelated_opaque_contract = next(
        contract
        for contract in visible_contracts("base:1h")
        if contract.alias == "1279"
    )

    assert set(reserve_contracts) == {"924", "951"}
    assert {contract.field_class for contract in reserve_contracts.values()} == {
        "unresolved"
    }

    universe = default_universe()
    assert not (
        {contract.wire_occurrence_id for contract in reserve_contracts.values()}
        & universe.visible_occurrence_ids
    )
    assert unrelated_opaque_contract.wire_occurrence_id in universe.visible_occurrence_ids
    assert len(universe.visible_occurrence_ids) == 3532


def _copy(tmp_path: Path) -> Path:
    root = tmp_path / "card-surface"
    shutil.copytree(FIXTURE_ROOT, root)
    return root


def _read_slots(root: Path, board_id: str) -> dict:
    return json.loads((root / board_id / "slots.json").read_text(encoding="utf-8"))


def _write_slots(root: Path, board_id: str, payload: dict) -> None:
    (root / board_id / "slots.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="",
    )


def _mark_complete(root: Path) -> None:
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    index["complete"] = True
    (root / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="",
    )


def test_loader_indexes_boards_by_card_operation_and_state(universe) -> None:
    registry = load_registry(FIXTURE_ROOT, universe=universe)

    assert sorted(registry.boards) == ["2SKU-1", "2SKU-1-T1", "2SKU-1-X1"]
    assert registry.by_card == {"CC-01": ("2SKU-1", "2SKU-1-T1", "2SKU-1-X1")}
    assert registry.by_operation == {
        "base:ka10085": ("2SKU-1", "2SKU-1-T1", "2SKU-1-X1"),
        "base:kt00003": ("2SKU-1", "2SKU-1-T1"),
        "detail:ka10087:sell_bid_prices": ("2SKU-1-T1",),
    }
    assert registry.state_links == {"2SKU-1": ("2SKU-1-T1", "2SKU-1-X1")}
    assert registry.complete is False


def test_base_board_prefers_the_default_state_over_the_expand_board(universe) -> None:
    registry = load_registry(FIXTURE_ROOT, universe=universe)

    assert registry.base_board_for("base:ka10085").board_id == "2SKU-1"
    assert [board.board_id for board in registry.state_boards_for("2SKU-1")] == [
        "2SKU-1-T1",
        "2SKU-1-X1",
    ]
    # 상태 보드만 가진 op는 그 상태 보드가 기본 보드다.
    assert (
        registry.base_board_for("detail:ka10087:sell_bid_prices").board_id
        == "2SKU-1-T1"
    )
    assert registry.base_board_for("base:ka10060") is None


def test_initial_state_board_only_names_a_tab_that_adds_to_the_base_board(
    universe,
) -> None:
    """기본 보드를 세운 뒤 곧바로 갈아탈 탭 — 없으면 None(지어내지 않는다).

    후보는 그 op의 값을 기본 보드에 **없는** 자리로 더 그리는 탭뿐이다. 기본
    보드가 이미 그리는 값만 되풀이하는 탭으로는 옮길 이유가 없고, 펼침 보드는
    탭이 아니라 후보가 아니다.
    """

    registry = load_registry(FIXTURE_ROOT, universe=universe)

    # 탭(2SKU-1-T1)은 기본 보드에도 있는 ka10085 값만 되풀이하고, 기본 보드에 없는
    # 값을 더 그리는 것은 펼침 보드(2SKU-1-X1)뿐이다 — 펼침은 후보가 아니다.
    assert registry.initial_state_board_for("base:ka10085") is None
    # kt00003은 어느 자식도 기본 보드 밖의 값을 그리지 않는다.
    assert registry.initial_state_board_for("base:kt00003") is None
    # 기본 보드가 탭 보드면 갈아탈 곳이 없다.
    assert registry.initial_state_board_for("detail:ka10087:sell_bid_prices") is None
    assert registry.initial_state_board_for("base:ka10060") is None


def test_slots_resolve_to_canonical_wire_occurrences(universe) -> None:
    registry = load_registry(FIXTURE_ROOT, universe=universe)
    board = registry.boards["2SKU-1"]

    slot = board.slot("col_stk_nm")
    assert slot.occurrence_id == "base:ka10085|$.acnt_prft_rt[].stk_nm|1"
    assert slot.layer == "직접"
    assert slot.anchor == {
        "kind": "raw",
        "tr": "ka10085",
        "section": "body",
        "field": "stk_nm",
    }
    assert registry.boards["2SKU-1-X1"].slots[0].layer == "펼침"


def test_partial_load_skips_boards_that_have_no_slots_yet(tmp_path, universe) -> None:
    """저작 전 보드는 건너뛴다 — 93장이 다 나오기 전에도 레지스트리가 선다."""

    root = _copy(tmp_path)
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    index["boards"].append("17F8-2")
    (root / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="",
    )
    (root / "17F8-2").mkdir()

    registry = load_registry(root, universe=universe)

    assert "17F8-2" not in registry.boards
    assert sorted(registry.boards) == ["2SKU-1", "2SKU-1-T1", "2SKU-1-X1"]


def test_missing_index_yields_an_empty_registry(tmp_path) -> None:
    """추출물이 아직 하나도 없는 상태(현재 리포)는 오류가 아니다."""

    registry = load_registry(tmp_path / "nothing-here")

    assert not registry
    assert registry.boards == {}
    assert registry.base_board_for("base:ka10085") is None


def test_label_slots_carry_no_binding_and_need_no_value(universe) -> None:
    """추출물은 텍스트 노드를 전부 적는다 — 고정 문구는 바인딩 대상이 아니다."""

    board = load_registry(FIXTURE_ROOT, universe=universe).boards["2SKU-1"]

    label = board.slot("s001")
    assert label.kind == "label"
    assert label.binds_a_field is False
    assert len(board.binding_slots) == len(board.slots) - 1


def test_strict_passes_when_every_visible_occurrence_reaches_a_board(universe) -> None:
    registry = load_registry(FIXTURE_ROOT, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []
    assert universe.visible_occurrence_ids == {
        occurrence_id
        for board in registry.boards.values()
        for slot in board.binding_slots
        for occurrence_id in slot.occurrence_ids
    }


# -- fail-closed 6종 -------------------------------------------------------


def test_rule_1_strict_rejects_an_unbound_visible_occurrence(tmp_path, universe) -> None:
    # `col_dt`는 이 보드에만 있는 열이라, 지우면 그 필드는 어느 보드에도 안 닿는다.
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["slots"] = [
        slot for slot in payload["slots"] if slot["slot_id"] != "col_dt"
    ]
    payload["density"]["table_columns"] -= 1
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(False, universe=universe) == []
    problems = registry.validation_problems(True, universe=universe)
    assert any("visible occurrences reach no board" in problem for problem in problems)


def test_rule_1_rejects_the_same_occurrence_twice_inside_one_board(
    tmp_path, universe
) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    twin = dict(payload["slots"][-1])
    twin.update({"slot_id": "col_stk_nm_twin", "layer": "직접", "paired_with": None})
    payload["slots"].append(twin)
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="slots that are not paired"):
        load_registry(root, universe=universe)


def test_paired_slots_may_share_one_occurrence_inside_a_board(universe) -> None:
    """D4 — 병기는 주값과 같은 값을 같은 프레임에서 갱신한다(중복이 아니다)."""

    board = load_registry(FIXTURE_ROOT, universe=universe).boards["2SKU-1"]
    paired = board.slot("col_cur_prc_paired")

    assert paired.layer == "병기"
    assert paired.paired_with == "col_cur_prc"
    assert paired.occurrence_id == board.slot("col_cur_prc").occurrence_id


def test_the_same_occurrence_may_appear_on_sibling_state_boards(
    tmp_path, universe
) -> None:
    """D2 보드↔op N:M — 탭·펼침 보드가 같은 머리글 값을 다시 쓰는 것은 정상이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-X1")
    echo = dict(_read_slots(root, "2SKU-1")["slots"][1])
    echo["slot_id"] = "kpi_acnt_prft_rt_echo"
    payload["slots"].append(echo)
    _write_slots(root, "2SKU-1-X1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []


def test_rule_2_rejects_a_slot_bound_to_a_non_visible_occurrence(
    tmp_path, universe
) -> None:
    """전송/내부 필드(비노출)는 표면 슬롯이 될 수 없다."""

    assert resolve_occurrence_id("base:ka10085", "return_code") is None
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["slots"].append(
        {
            "slot_id": "hidden_return_code",
            "mapping_id": "base:ka10085",
            "f": "return_code",
            "layer": "direct",
            "region": "bs-footer",
            "format": {},
        }
    )
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="does not resolve to one"):
        load_registry(root, universe=universe)


def test_rule_3_strict_rejects_an_operation_with_no_board(tmp_path, universe) -> None:
    wider = SurfaceUniverse(
        operation_refs=universe.operation_refs | {"base:ka10060"},
        visible_occurrence_ids=universe.visible_occurrence_ids,
    )
    root = _copy(tmp_path)
    _mark_complete(root)

    with pytest.raises(CardSurfaceTemplateError, match="have no board"):
        load_registry(root, universe=wider)

    # complete가 아니면 같은 트리가 통과한다 — 부분 로드는 여전히 허용된다.
    assert load_registry(_copy(tmp_path / "again"), universe=wider)


def test_rule_4_rejects_a_board_html_that_drifted_from_its_hash(
    tmp_path, universe
) -> None:
    root = _copy(tmp_path)
    html_path = root / "2SKU-1" / "board.html"
    html_path.write_text(
        html_path.read_text(encoding="utf-8") + "<!-- edited -->",
        encoding="utf-8",
        newline="",
    )

    with pytest.raises(CardSurfaceTemplateError, match="html_sha256 mismatch"):
        load_registry(root, universe=universe)


def test_rule_5_rejects_a_board_over_the_density_budget(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["density"]["table_columns"] = DENSITY_BUDGET["table_columns"] + 1
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="exceeds budget"):
        load_registry(root, universe=universe)


def test_rule_6_rejects_a_broken_state_board_reference(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-X1")
    payload["state"]["parent_board"] = "NOT-A-BOARD"
    _write_slots(root, "2SKU-1-X1", payload)

    # 저작 중에는 아직 안 나온 부모를 가리킬 수 있다 — 완결을 선언한 트리에서만 막는다.
    assert load_registry(root, universe=universe)
    _mark_complete(root)
    with pytest.raises(CardSurfaceTemplateError, match="is not a known board"):
        load_registry(root, universe=universe)


def test_a_tab_board_may_own_its_rail_without_a_parent(tmp_path, universe) -> None:
    """레일 주인(rail_owner) — 탭 묶음의 첫 장은 되돌아갈 부모가 없다.

    형제 탭들이 이 장을 부모로 가리키고, 이 장 자신이 그 카드의 기본 보드다.
    """

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    payload["state"]["parent_board"] = None
    _write_slots(root, "2SKU-1-T1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []
    assert registry.boards["2SKU-1-T1"].state.parent_board is None
    assert registry.state_links == {"2SKU-1": ("2SKU-1-X1",)}


def test_a_sort_or_expand_board_still_needs_a_parent(tmp_path, universe) -> None:
    """정렬·펼침은 언제나 어떤 보드를 눌러 들어간 상태다 — 돌아갈 자리가 있어야 한다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-X1")
    payload["state"]["parent_board"] = None
    _write_slots(root, "2SKU-1-X1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="has no parent_board"):
        load_registry(root, universe=universe)


def test_a_board_may_not_be_its_own_parent(tmp_path, universe) -> None:
    """부모 없음은 레일 주인이지만 자기참조는 상태 그래프의 고리다 — 여전히 금지."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    payload["state"]["parent_board"] = "2SKU-1-T1"
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="is its own parent_board"):
        load_registry(root, universe=universe)

    registry = load_registry(root, universe=universe, strict=False)
    assert sorted(registry.boards) == ["2SKU-1", "2SKU-1-X1"]
    assert registry.excluded_boards[0].reasons == (
        "board '2SKU-1-T1' is its own parent_board",
    )


def test_rule_6_rejects_a_state_board_without_a_control(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-X1")
    payload["state"]["control"] = None
    _write_slots(root, "2SKU-1-X1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="has no control"):
        load_registry(root, universe=universe)


def test_board_html_is_required_when_slots_are_authored(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    (root / "2SKU-1" / "board.html").unlink()

    with pytest.raises(CardSurfaceTemplateError, match="no board.html"):
        load_registry(root, universe=universe)


def test_board_html_hash_covers_the_extraction_bytes(universe) -> None:
    registry = load_registry(FIXTURE_ROOT, universe=universe)
    board = registry.boards["2SKU-1"]

    assert (
        hashlib.sha256(board.html.encode("utf-8")).hexdigest() == board.html_sha256
    )


def test_runtime_accessor_excludes_only_the_board_that_broke_a_rule(
    tmp_path, monkeypatch, caplog
) -> None:
    """표면에 대한 fail-closed는 "잘못된 보드를 그리지 않는 것"이다.

    "아무 보드도 그리지 않는 것"이 아니다 — 저작 중인 보드 하나 때문에 나머지 95장의
    표면이 사라지면 그것이 더 큰 손실이다. strict 로드는 여전히 예외를 던지고
    (테스트·CI가 그걸로 나쁜 트리를 막는다), 런타임 접근점은 어긴 보드만 빼고 사유를
    남긴다.
    """

    from athena_api import card_surface_templates as module

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["density"]["table_columns"] = DENSITY_BUDGET["table_columns"] + 1
    _write_slots(root, "2SKU-1", payload)
    monkeypatch.setattr(module, "TEMPLATE_ROOT", root)
    module.get_registry.cache_clear()

    try:
        with pytest.raises(CardSurfaceTemplateError):
            load_registry(root)
        with caplog.at_level("WARNING", logger=module.__name__):
            registry = module.get_registry()

        assert sorted(registry.boards) == ["2SKU-1-T1", "2SKU-1-X1"]
        assert [board.board_id for board in registry.excluded_boards] == ["2SKU-1"]
        assert registry.excluded_boards[0].reasons == (
            "board '2SKU-1' density table_columns=9 exceeds budget 8",
        )
        # 기본 보드가 빠지면 그 op는 남은 상태 보드로 내려앉는다(표면이 사라지지 않는다).
        assert registry.base_board_for("base:ka10085").board_id == "2SKU-1-T1"
        assert "2SKU-1" in caplog.text and "exceeds budget 8" in caplog.text
    finally:
        module.get_registry.cache_clear()


def test_runtime_accessor_degrades_to_no_surface_when_the_tree_is_unreadable(
    tmp_path, monkeypatch
) -> None:
    """index.json 자체가 깨지면 보드 단위로 격리할 수 없다 — 그때만 빈 레지스트리다."""

    from athena_api import card_surface_templates as module

    root = _copy(tmp_path)
    (root / "index.json").write_text(
        json.dumps({"version": "card-surface.v0", "boards": []}) + "\n",
        encoding="utf-8",
        newline="",
    )
    monkeypatch.setattr(module, "TEMPLATE_ROOT", root)
    module.get_registry.cache_clear()

    try:
        registry = module.get_registry()
        assert registry.boards == {}
        assert registry.base_board_for("base:ka10085") is None
    finally:
        module.get_registry.cache_clear()


def test_isolation_keeps_dropping_boards_until_the_rest_are_clean(
    tmp_path, universe
) -> None:
    """한 장을 빼면 남은 보드의 판정이 달라질 수 있어 더 뺄 것이 없을 때까지 돈다."""

    root = _copy(tmp_path)
    _mark_complete(root)
    payload = _read_slots(root, "2SKU-1")
    payload["height_px"] = HEIGHT_BUDGET_PX + 1
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe, strict=False)

    # 2SKU-1은 높이로 빠지고, complete 트리라 그 장을 부모로 가리키던 두 장이 뒤따른다.
    assert registry.boards == {}
    assert [board.board_id for board in registry.excluded_boards] == [
        "2SKU-1",
        "2SKU-1-T1",
        "2SKU-1-X1",
    ]
    assert registry.excluded_boards[1].reasons == (
        "board '2SKU-1-T1' parent_board '2SKU-1' is not a known board",
    )


def test_isolation_excludes_a_board_whose_slots_json_cannot_be_parsed(
    tmp_path, universe
) -> None:
    """슬롯 표를 읽지도 못하는 보드도 격리 대상이다 — 나머지는 선다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-X1")
    payload["slots"][0]["layer"] = "옆줄"
    _write_slots(root, "2SKU-1-X1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="unknown layer"):
        load_registry(root, universe=universe)

    registry = load_registry(root, universe=universe, strict=False)

    assert sorted(registry.boards) == ["2SKU-1", "2SKU-1-T1"]
    assert [board.board_id for board in registry.excluded_boards] == ["2SKU-1-X1"]
    assert "unknown layer" in registry.excluded_boards[0].reasons[0]


def test_a_clean_tree_excludes_nothing(universe) -> None:
    strict = load_registry(FIXTURE_ROOT, universe=universe)
    isolated = load_registry(FIXTURE_ROOT, universe=universe, strict=False)

    assert strict.excluded_boards == ()
    assert isolated.excluded_boards == ()
    assert sorted(isolated.boards) == sorted(strict.boards)


def test_coverage_reports_what_the_standing_registry_reaches(universe) -> None:
    """D3가 소비하는 현황 — 지금 서 있는 보드들이 덮은 가시 필드와 못 덮은 op."""

    registry = load_registry(FIXTURE_ROOT, universe=universe)

    coverage = registry.coverage(universe=universe)
    assert coverage["visible_total"] == len(universe.visible_occurrence_ids)
    assert coverage["covered"] == coverage["visible_total"]
    assert coverage["uncovered_occurrences"] == []
    assert coverage["operations_without_board"] == []


def test_coverage_names_the_fields_and_operations_that_no_board_reaches(
    tmp_path, universe
) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["slots"] = [
        slot for slot in payload["slots"] if slot["slot_id"] != "col_dt"
    ]
    payload["density"]["table_columns"] -= 1
    _write_slots(root, "2SKU-1", payload)
    wider = SurfaceUniverse(
        operation_refs=universe.operation_refs | {"base:ka10060"},
        visible_occurrence_ids=universe.visible_occurrence_ids,
    )

    coverage = load_registry(root, universe=universe).coverage(universe=wider)

    assert coverage["uncovered_occurrences"] == ["base:ka10085|$.acnt_prft_rt[].dt|1"]
    assert coverage["covered"] == coverage["visible_total"] - 1
    assert coverage["operations_without_board"] == ["base:ka10060"]


def test_coverage_loses_what_an_excluded_board_used_to_reach(tmp_path, universe) -> None:
    """격리는 공짜가 아니다 — 빠진 보드가 들고 있던 자리는 커버리지에서 빠진다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["height_px"] = HEIGHT_BUDGET_PX + 1
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe, strict=False)

    assert [board.board_id for board in registry.excluded_boards] == ["2SKU-1"]
    coverage = registry.coverage(universe=universe)
    assert coverage["covered"] < coverage["visible_total"]
    assert len(coverage["uncovered_occurrences"]) == (
        coverage["visible_total"] - coverage["covered"]
    )


def test_strict_rejects_an_index_whose_expected_counts_drifted(
    tmp_path, universe
) -> None:
    """index.json이 적은 전집합 크기가 원장과 어긋나면 인덱스가 낡은 것이다."""

    root = _copy(tmp_path)
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    assert index["expected"]["visible_occurrence_count"] == len(
        universe.visible_occurrence_ids
    )
    index["expected"]["visible_occurrence_count"] += 1
    index["complete"] = True
    (root / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="",
    )

    with pytest.raises(CardSurfaceTemplateError, match="but the ledger has"):
        load_registry(root, universe=universe)


def test_rows_max_budget_is_the_charter_row_cap_plus_the_two_foot_rows(
    tmp_path, universe
) -> None:
    """헌장 문법 C — 표 본문 상한 20. 실측은 합계·평균 두 줄(A5 foot)까지 세므로 22다."""

    assert DENSITY_BUDGET["rows_max"] == 22
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["density"]["rows_max"] = 22
    _write_slots(root, "2SKU-1", payload)

    assert load_registry(root, universe=universe).validation_problems(
        False, universe=universe
    ) == []

    payload["density"]["rows_max"] = 23
    _write_slots(root, "2SKU-1", payload)
    with pytest.raises(CardSurfaceTemplateError, match="rows_max=23 exceeds budget 22"):
        load_registry(root, universe=universe)


def test_kpi_cells_and_rail_blocks_are_soft_and_do_not_remove_the_board(
    tmp_path, universe
) -> None:
    """레일 블록 수·KPI 칸 수는 H1(영값 묶음) 적용 후 기준이라 실측이 넘을 수 있다.

    그 한 줄 때문에 보드를 제품 표면에서 지우면 "디자인 완전 동일"이 깨진다 — 하드로
    남는 것은 표가 가로·세로로 넘치는 자리와 보드가 화면을 넘는 자리뿐이다.
    """

    assert "kpi_cells" not in DENSITY_BUDGET
    assert "rail_blocks" not in DENSITY_BUDGET
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["density"]["kpi_cells"] = SOFT_DENSITY_BUDGET["kpi_cells"] + 1
    payload["density"]["rail_blocks"] = SOFT_DENSITY_BUDGET["rail_blocks"] + 8
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)

    assert "2SKU-1" in registry.boards
    assert registry.validation_problems(True, universe=universe) == []
    assert registry.validation_warnings(universe=universe) == [
        "board '2SKU-1' density kpi_cells=7 exceeds soft budget 6",
        "board '2SKU-1' density rail_blocks=13 exceeds soft budget 5",
    ]


def test_rail_rows_max_is_soft_and_warns_instead_of_removing_the_board(
    tmp_path, universe
) -> None:
    """레일 행수는 H1(영값 묶음) 적용 후 기준이라 추출 실측이 넘을 수 있다.

    그 한 줄 때문에 보드를 제품 표면에서 지우면 "디자인 완전 동일"이 깨진다 —
    경고만 남기고 로드는 통과한다.
    """

    assert "rail_rows_max" not in DENSITY_BUDGET
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["density"]["rail_rows_max"] = SOFT_DENSITY_BUDGET["rail_rows_max"] + 1
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []
    assert registry.validation_warnings() == [
        "board '2SKU-1' density rail_rows_max=7 exceeds soft budget 6"
    ]


def test_a_board_taller_than_the_height_budget_is_rejected(tmp_path, universe) -> None:
    """헌장 §2.3 — 메인 보드 높이 1,120px 이하. 넘으면 펼침으로 내린다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["height_px"] = HEIGHT_BUDGET_PX
    _write_slots(root, "2SKU-1", payload)
    assert load_registry(root, universe=universe)

    payload["height_px"] = HEIGHT_BUDGET_PX + 1
    _write_slots(root, "2SKU-1", payload)
    with pytest.raises(CardSurfaceTemplateError, match="height_px=1121 exceeds budget"):
        load_registry(root, universe=universe)


def test_display_dup_slots_may_repeat_one_occurrence_inside_a_board(
    tmp_path, universe
) -> None:
    """머리글 KPI가 표의 열을 다시 적는 자리 — 병기가 아니지만 중복도 아니다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    echo = dict(payload["slots"][-1])
    echo.update(
        {
            "slot_id": "kpi_cur_prc_echo",
            "region": "bs-kpi",
            "layer": "직접",
            "paired_with": None,
            "display_dup": True,
        }
    )
    payload["slots"].append(echo)
    payload["density"]["kpi_cells"] += 1
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)

    board = registry.boards["2SKU-1"]
    assert board.slot("kpi_cur_prc_echo").display_dup is True
    assert board.slot("col_cur_prc").display_dup is False
    assert registry.validation_problems(True, universe=universe) == []


def test_a_restatement_with_no_primary_warns_instead_of_removing_the_board(
    tmp_path, universe
) -> None:
    """재표시만 있고 주값이 없는 무리는 결손이지만 보드를 지울 이유는 아니다.

    저작 검사기(``scripts/validate_board_slots.py``)는 "n개 중 n-1개 이상 표시"를
    요구해서 n개 전부 표시한 무리를 통과시킨다. 로더가 "정확히 하나"를 요구하면 저작을
    통과한 보드가 여기서 막히고, 트리 하나가 막히면 표면 전체가 사라진다 — 같은 선을
    긋고(하나 이하), 어느 무리가 그 상태인지는 경고로 남긴다.
    """

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "col_cur_prc":
            slot["display_dup"] = True
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []
    assert registry.validation_warnings(universe=universe) == [
        "board '2SKU-1' restates occurrence "
        "'base:ka10085|$.acnt_prft_rt[].cur_prc|1' in 2 places with no primary slot"
    ]


def test_leaves_sharing_one_alt_mapping_are_not_a_duplicate(tmp_path, universe) -> None:
    """중복 금지는 **저작이 넣은 자리**를 묻는다 — 대체는 조건부 폴백이다.

    실측(2SKU-1·2U5L-1·30TY-0)은 한 셀에 이름·코드·일련번호를 쌓아 그린 잎들이 같은
    폴백 하나를 나눠 갖는 모습이다. 그 잎들의 주 바인딩은 서로 다르고, 값은 계약
    파생이 잎마다 따로 고른다 — 대체까지 세면 보드가 통째로 빠진다.
    """

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    alt = [{"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"}]
    for slot in payload["slots"]:
        if slot["slot_id"] in {"col_stk_nm", "col_stk_cd"}:
            slot["alt_mappings"] = alt
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []
    assert registry.validation_warnings(universe=universe) == []
    # 세 잎이 같은 자리에 닿지만 주 바인딩으로 그것을 그리는 잎은 KPI 하나뿐이다.
    board = registry.boards["2SKU-1"]
    occurrence_id = "base:kt00003|$.prsm_dpst_aset_amt|1"
    assert board.slot("col_stk_nm").occurrence_ids[1] == occurrence_id
    assert board.slot("kpi_prsm_dpst_aset_amt").occurrence_id == occurrence_id


def test_two_undeclared_primaries_are_still_a_duplicate(tmp_path, universe) -> None:
    """선을 "하나 이하"로 옮겨도 **표시되지 않은** 주값 둘은 여전히 중복이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    twin = dict(payload["slots"][-1])
    twin.update({"slot_id": "col_cur_prc_twin", "layer": "직접", "paired_with": None})
    payload["slots"].append(twin)
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(
        CardSurfaceTemplateError, match="slots that are not paired or display_dup"
    ):
        load_registry(root, universe=universe)


def test_display_dup_must_be_a_boolean(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["slots"][1]["display_dup"] = "true"
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="display_dup must be a boolean"):
        load_registry(root, universe=universe)


def test_json_path_resolves_the_two_alias_collisions_in_the_ledger() -> None:
    """원장 실측 2쌍 — 한 op 안에서 같은 별칭이 스칼라와 배열 두 경로에 걸린다.

    이 경우에만 슬롯이 ``json_path``(또는 ``occurrence_id``)로 스스로를 못 박는다.
    """

    collisions = {
        ("base:ka01690", "buy_wght"): (
            "$.buy_wght",
            "$.day_bal_rt[].buy_wght",
        ),
        ("base:ka90002", "flu_rt"): (
            "$.flu_rt",
            "$.thema_comp_stk[].flu_rt",
        ),
    }
    for (mapping_id, alias), paths in collisions.items():
        assert resolve_occurrence_id(mapping_id, alias) is None
        for json_path in paths:
            occurrence_id = resolve_occurrence_id(
                mapping_id, alias, json_path=json_path
            )
            assert occurrence_id == f"{mapping_id}|{json_path}|1"
            assert (
                resolve_occurrence_id(
                    mapping_id, alias, declared_occurrence_id=occurrence_id
                )
                == occurrence_id
            )


def test_a_slot_may_pin_its_occurrence_with_json_path(tmp_path, universe) -> None:
    """충돌이 없는 슬롯도 json_path를 적을 수 있고, 틀리면 해석되지 않는다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "col_stk_nm":
            slot["json_path"] = "$.acnt_prft_rt[].stk_nm"
    _write_slots(root, "2SKU-1", payload)
    board = load_registry(root, universe=universe).boards["2SKU-1"]
    assert board.slot("col_stk_nm").occurrence_id == (
        "base:ka10085|$.acnt_prft_rt[].stk_nm|1"
    )

    for slot in payload["slots"]:
        if slot["slot_id"] == "col_stk_nm":
            slot["json_path"] = "$.not_a_path"
    _write_slots(root, "2SKU-1", payload)
    with pytest.raises(CardSurfaceTemplateError, match="does not resolve to one"):
        load_registry(root, universe=universe)


# -- A4 슬롯 확장(대체 바인딩·지시 열·열 반복·상태 문구) ----------------------


def test_alt_mappings_let_one_leaf_reach_several_operations(universe) -> None:
    """D2 N:M — 보드 하나가 여러 op를 받으면 한 잎의 값 출처가 op마다 갈린다."""

    board = load_registry(FIXTURE_ROOT, universe=universe).boards["2SKU-1-T1"]
    slot = board.slot("t1_kpi_summary")

    assert slot.occurrence_id == "base:ka10085|$.acnt_prft_rt|1"
    assert [(alt.mapping_id, alt.f, alt.occurrence_id) for alt in slot.alt_mappings] == [
        ("base:kt00003", "prsm_dpst_aset_amt", "base:kt00003|$.prsm_dpst_aset_amt|1")
    ]
    # 주 바인딩이 먼저, 그다음 대체 — 이 순서가 계약 파생의 동점 처리 기준이다.
    assert slot.occurrence_ids == (
        "base:ka10085|$.acnt_prft_rt|1",
        "base:kt00003|$.prsm_dpst_aset_amt|1",
    )
    assert board.slot("t1_bid_r0").occurrence_ids == (
        "detail:ka10087:sell_bid_prices|$.ovt_sigpric_sel_bid_1|1",
    )


def test_explicit_composite_resolves_parts_without_using_extra_fields(
    tmp_path, universe
) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    slot = next(item for item in payload["slots"] if item["slot_id"] == "t1_kpi_summary")
    slot.update(
        {
            "mapping_id": None,
            "f": None,
            "alt_mappings": None,
            "extra_fields": [{"mapping_id": "base:ka10085", "f": "cur_prc"}],
            "composite": {
                "separator": " · ",
                "parts": [
                    {
                        "mapping_id": "base:kt00003",
                        "f": "prsm_dpst_aset_amt",
                        "format": {"prefix": "예수금 ", "unit": "원"},
                    },
                    {
                        "mapping_id": "detail:ka10087:sell_bid_prices",
                        "f": "ovt_sigpric_sel_bid_1",
                        "format": {"suffix": "원"},
                    },
                ],
            },
        }
    )
    _write_slots(root, "2SKU-1-T1", payload)

    parsed = load_registry(root, universe=universe).boards["2SKU-1-T1"].slot(
        "t1_kpi_summary"
    )

    assert parsed.mapping_id is None
    assert parsed.alt_mappings == ()
    assert parsed.composite.separator == " · "
    assert [part.f for part in parsed.composite.parts] == [
        "prsm_dpst_aset_amt",
        "ovt_sigpric_sel_bid_1",
    ]
    assert parsed.composite.parts[0].format == {"prefix": "예수금 ", "unit": "원"}
    assert "base:ka10085|$.acnt_prft_rt[].cur_prc|1" not in parsed.occurrence_ids


@pytest.mark.parametrize(
    "composite, error",
    [
        ({"separator": " · ", "parts": []}, "at least two entries"),
        (
            {
                "separator": " · ",
                "parts": [
                    {"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"},
                    {
                        "mapping_id": "detail:ka10087:sell_bid_prices",
                        "f": "ovt_sigpric_sel_bid_1",
                        "format": "money",
                    },
                ],
            },
            "format must be an object",
        ),
    ],
)
def test_invalid_composite_authoring_is_rejected(
    tmp_path, universe, composite, error
) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    slot = next(item for item in payload["slots"] if item["slot_id"] == "t1_kpi_summary")
    slot.update(
        {
            "mapping_id": None,
            "f": None,
            "alt_mappings": None,
            "composite": composite,
        }
    )
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match=error):
        load_registry(root, universe=universe)


def test_composite_cannot_also_declare_a_scalar_binding(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    slot = next(item for item in payload["slots"] if item["slot_id"] == "t1_kpi_summary")
    slot["composite"] = {
        "separator": " · ",
        "parts": [
            {"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"},
            {
                "mapping_id": "detail:ka10087:sell_bid_prices",
                "f": "ovt_sigpric_sel_bid_1",
            },
        ],
    }
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="cannot be combined"):
        load_registry(root, universe=universe)


def test_strict_coverage_counts_an_occurrence_only_an_alt_reaches(
    tmp_path, universe
) -> None:
    """대체 바인딩이 닿는 필드도 "도달했다" — 그 op가 답하면 그 잎이 그린다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    payload["slots"] = [
        slot for slot in payload["slots"] if slot["slot_id"] != "kpi_prsm_dpst_aset_amt"
    ]
    payload["density"]["kpi_cells"] -= 1
    _write_slots(root, "2SKU-1", payload)

    # 주 바인딩으로는 아무 보드도 안 닿지만 탭 보드의 대체가 닿는다.
    assert (
        load_registry(root, universe=universe).validation_problems(
            True, universe=universe
        )
        == []
    )

    tab = _read_slots(root, "2SKU-1-T1")
    for slot in tab["slots"]:
        if slot["slot_id"] == "t1_kpi_summary":
            slot["alt_mappings"] = None
    _write_slots(root, "2SKU-1-T1", tab)
    problems = load_registry(root, universe=universe).validation_problems(
        True, universe=universe
    )
    assert any("visible occurrences reach no board" in problem for problem in problems)


def test_an_alt_mapping_must_resolve_like_a_primary_binding(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_kpi_summary":
            slot["alt_mappings"] = [{"mapping_id": "base:kt00003", "f": "return_code"}]
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="does not resolve to one"):
        load_registry(root, universe=universe)


def test_an_alt_mapping_needs_a_mapping_id_and_an_f(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_kpi_summary":
            slot["alt_mappings"] = [{"mapping_id": "base:kt00003"}]
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="needs both mapping_id and f"):
        load_registry(root, universe=universe)


def test_an_alt_mapping_without_a_primary_binding_is_rejected(tmp_path, universe) -> None:
    """대체는 주 바인딩의 대체다 — 주값 없이 대체만 적은 잎은 저작 오류다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_label":
            slot["alt_mappings"] = [
                {"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"}
            ]
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="alt_mappings without a primary"):
        load_registry(root, universe=universe)


def test_an_alt_mapping_may_not_repeat_the_primary_binding(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_kpi_summary":
            slot["alt_mappings"] = [{"mapping_id": "base:ka10085", "f": "acnt_prft_rt"}]
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="repeats one mapping_id/f"):
        load_registry(root, universe=universe)


def test_indexed_column_cells_keep_the_columns_f_pattern(universe) -> None:
    """지시 열 — 추출기는 셀에 편 이름만 남기고 패턴은 열에 둔다(둘을 다시 잇는다)."""

    board = load_registry(FIXTURE_ROOT, universe=universe).boards["2SKU-1-T1"]

    ladder = [board.slot(f"t1_bid_r{row}") for row in range(5)]
    assert [slot.f for slot in ladder] == [
        f"ovt_sigpric_sel_bid_{index}" for index in range(1, 6)
    ]
    assert {slot.f_pattern for slot in ladder} == {"ovt_sigpric_sel_bid_{i}"}
    assert len({slot.occurrence_id for slot in ladder}) == 5
    # 지시 열이 아닌 열의 셀은 패턴을 갖지 않는다.
    assert board.slot("t1_stk_nm_r0").f_pattern is None


def test_a_cell_bound_to_another_op_does_not_take_the_columns_pattern(
    tmp_path, universe
) -> None:
    """한 열에 이름·코드를 같이 그린 자리 — 열과 다른 op를 무는 셀은 그 열의 자리표가 아니다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    origin = next(s for s in payload["slots"] if s["slot_id"] == "t1_stk_nm_r0")
    intruder = dict(origin)
    intruder["slot_id"] = "t1_bid_code_r0"
    intruder["table"] = {"table": "T1L", "row": "0", "col": 0}
    intruder["display_dup"] = True
    payload["slots"].append(intruder)
    payload["column_bindings"][1]["columns"][0]["slot_ids"].append("t1_bid_code_r0")
    _write_slots(root, "2SKU-1-T1", payload)

    board = load_registry(root, universe=universe).boards["2SKU-1-T1"]

    assert board.slot("t1_bid_code_r0").f_pattern is None
    assert board.slot("t1_bid_r0").f_pattern == "ovt_sigpric_sel_bid_{i}"


def test_an_indexed_cell_whose_f_left_the_pattern_is_rejected(tmp_path, universe) -> None:
    """편 이름이 그 열 패턴에서 나온 것이 아니면 열과 셀이 갈린 것이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_bid_r4":
            slot["f"] = "ovt_sigpric_buy_bid_5"
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="is not an expansion of"):
        load_registry(root, universe=universe)


def test_an_indexed_column_without_a_pattern_is_rejected(tmp_path, universe) -> None:
    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    payload["column_bindings"][1]["columns"][0]["indexed"] = {"start": 1, "step": 1}
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="has no f_pattern"):
        load_registry(root, universe=universe)


def test_repeated_rows_of_one_table_column_are_not_a_duplicate(universe) -> None:
    """추출기는 셀마다 슬롯을 적고 열 바인딩이 그 열 전부에 같은 필드를 퍼뜨린다."""

    registry = load_registry(FIXTURE_ROOT, universe=universe)
    board = registry.boards["2SKU-1-T1"]

    rows = [board.slot("t1_stk_nm_r0"), board.slot("t1_stk_nm_r1")]
    assert len({slot.occurrence_id for slot in rows}) == 1
    assert [slot.table.col for slot in rows] == [0, 0]
    assert [slot.table.row for slot in rows] == ["0", "1"]
    assert registry.validation_problems(True, universe=universe) == []


def _make_row_block(payload: dict, *, region: str, rows: list[int | None]) -> None:
    """``col_cur_prc``를 표가 아닌 되풀이 블록(행 번호만 있는 자리)으로 바꾼다."""

    payload["slots"] = [
        slot for slot in payload["slots"] if slot["slot_id"] != "col_cur_prc_paired"
    ]
    template = next(
        slot for slot in payload["slots"] if slot["slot_id"] == "col_cur_prc"
    )
    payload["slots"].remove(template)
    for index, row_index in enumerate(rows):
        row = dict(template)
        row.update(
            {
                "slot_id": f"row_cur_prc_{index}",
                "region": region,
                "row_index": row_index,
            }
        )
        payload["slots"].append(row)


def test_repeated_rows_without_table_coordinates_are_not_a_duplicate(
    tmp_path, universe
) -> None:
    """되풀이가 ``<table>``이 아닌 카드 줄이면 행 좌표는 ``row_index``뿐이다.

    계약 파생이 그 자리마다 ``value[row_index]``로 다른 원소를 꺼내므로 같은 값의
    중복이 아니다 — 표 좌표가 있을 때와 같은 열 하나다.
    """

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    _make_row_block(payload, region="bs-rows", rows=[0, 1, 2])
    _write_slots(root, "2SKU-1", payload)

    registry = load_registry(root, universe=universe)
    board = registry.boards["2SKU-1"]

    rows = [board.slot(f"row_cur_prc_{index}") for index in range(3)]
    assert len({slot.occurrence_id for slot in rows}) == 1
    assert [slot.row_index for slot in rows] == [0, 1, 2]
    assert all(slot.table is None for slot in rows)
    assert registry.validation_problems(True, universe=universe) == []
    assert registry.validation_warnings(universe=universe) == []


def test_two_slots_on_the_same_row_of_one_block_are_still_a_duplicate(
    tmp_path, universe
) -> None:
    """행 반복은 **행 번호가 다를 때**만이다 — 같은 행을 두 번 적으면 중복이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    _make_row_block(payload, region="bs-rows", rows=[0, 0])
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="slots that are not paired"):
        load_registry(root, universe=universe)


def test_a_row_block_without_row_numbers_is_still_a_duplicate(
    tmp_path, universe
) -> None:
    """행 번호가 없으면 그 자리들은 같은 배열 전체를 그린다 — 열 하나가 아니다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    _make_row_block(payload, region="bs-rows", rows=[None, None])
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="slots that are not paired"):
        load_registry(root, universe=universe)


def test_row_repeats_of_two_different_blocks_are_still_a_duplicate(
    tmp_path, universe
) -> None:
    """구역이 다르면 되풀이도 다른 블록이다 — 같은 값을 두 곳에 그린 것이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1")
    _make_row_block(payload, region="bs-rows", rows=[0, 1])
    for slot in payload["slots"]:
        if slot["slot_id"] == "row_cur_prc_1":
            slot["region"] = "bs-rail"
    _write_slots(root, "2SKU-1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="slots that are not paired"):
        load_registry(root, universe=universe)


def test_two_slots_in_the_same_table_cell_are_still_a_duplicate(
    tmp_path, universe
) -> None:
    """열 반복은 **행이 다를 때**만이다 — 같은 셀을 두 번 적으면 중복이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_stk_nm_r1":
            slot["table"] = {"table": "T1T", "row": "0", "col": 0}
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="slots that are not paired"):
        load_registry(root, universe=universe)


def test_row_repeats_of_two_different_columns_are_still_a_duplicate(
    tmp_path, universe
) -> None:
    """같은 값이 한 표의 두 열에 앉으면 그것은 열 반복이 아니라 중복이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"] == "t1_stk_nm_r1":
            slot["table"] = {"table": "T1T", "row": "1", "col": 1}
    payload["density"]["table_columns"] += 1
    _write_slots(root, "2SKU-1-T1", payload)

    with pytest.raises(CardSurfaceTemplateError, match="slots that are not paired"):
        load_registry(root, universe=universe)


def test_a_stacked_second_line_with_its_own_field_is_that_fields_primary(
    tmp_path, universe
) -> None:
    """D6의 ``병기``는 "2줄 셀의 둘째 줄"이라는 DOM 판정이지 주값의 사본이 아니다.

    둘째 줄이 제 필드를 갖고 짝이 다른 값을 들고 있으면 그 줄이 자기 필드의 주값이다.
    사본으로만 세면 그 열은 주값이 하나도 없는 무리가 되어 보드가 통째로 막힌다.
    """

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    for slot in payload["slots"]:
        if slot["slot_id"].startswith("t1_stk_nm_r"):
            slot["layer"] = "병기"
            slot["paired_with"] = "t1_bid_r0"
    _write_slots(root, "2SKU-1-T1", payload)

    registry = load_registry(root, universe=universe)

    assert registry.validation_problems(True, universe=universe) == []


def test_state_control_text_is_the_display_half_of_the_control(universe) -> None:
    """프론트는 화면에 있는 글자로 조작 잎을 찾는다 — 기계 접두는 로더가 뗀다."""

    registry = load_registry(FIXTURE_ROOT, universe=universe)

    tab = registry.boards["2SKU-1-T1"].state
    assert (tab.kind, tab.control, tab.control_text) == (
        "tab",
        "tab|시간외 단일가",
        "시간외 단일가",
    )
    assert registry.boards["2SKU-1-X1"].state.control_text == "보유 종목"
    assert registry.boards["2SKU-1"].state.control_text is None


def test_an_authored_control_text_wins_over_the_derived_one(tmp_path, universe) -> None:
    """추출기가 손지정한 문구(meta.json ``state.control_text``)가 있으면 그것이 정답이다."""

    root = _copy(tmp_path)
    payload = _read_slots(root, "2SKU-1-T1")
    payload["state"]["control_text"] = "시간외"
    _write_slots(root, "2SKU-1-T1", payload)

    board = load_registry(root, universe=universe).boards["2SKU-1-T1"]

    assert board.state.control == "tab|시간외 단일가"
    assert board.state.control_text == "시간외"


def test_30ty_non_equivalent_same_operation_alts_fail_closed() -> None:
    """금액·수량·부호가 같은 응답에 있어도 서로의 대체 표시는 아니다."""

    from athena_api.card_surface_contract import (
        bind_surface_values,
        build_board_surface_contract,
    )
    from athena_api.card_surface_templates import TEMPLATE_ROOT

    buy_slots = ["s054", "s068", "s082", "s096", "s110", "s124", "s141", "s155"]
    sell_slots = ["s056", "s070", "s084", "s098", "s112", "s126", "s143", "s157"]
    sign_slots = ["s185", "s188", "s191"]
    target_slots = buy_slots + sell_slots + sign_slots
    registry = load_registry(TEMPLATE_ROOT, strict=False)

    wrong_only = {
        **bind_surface_values(
            "base:ka10039",
            {
                "sec_trde_upper": [
                    {
                        "buy_trde_qty": f"BUY_QTY_{index}",
                        "sel_trde_qty": f"SELL_QTY_{index}",
                    }
                    for index in range(8)
                ]
            },
        ),
        **bind_surface_values(
            "base:ka10078",
            {
                "sec_stk_trde_trend": [
                    {"pre_sig": f"SIGN_{index}"} for index in range(3)
                ]
            },
        ),
    }
    wrong_contract = build_board_surface_contract("30TY-0", wrong_only, registry)
    wrong_values = {
        entry["slot_id"]: entry["value"]
        for entry in wrong_contract["slot_values"]
        if entry["slot_id"] in target_slots
    }
    assert wrong_values == {}
    assert set(target_slots).issubset(wrong_contract["unbound_slots"])

    primary = {
        **bind_surface_values(
            "base:ka10039",
            {
                "sec_trde_upper": [
                    {"buy_amt": f"BUY_AMT_{index}", "sell_amt": f"SELL_AMT_{index}"}
                    for index in range(8)
                ]
            },
        ),
        **bind_surface_values(
            "base:ka10078",
            {
                "sec_stk_trde_trend": [
                    {"netprps_qty": f"NET_QTY_{index}"} for index in range(3)
                ]
            },
        ),
    }
    primary_contract = build_board_surface_contract("30TY-0", primary, registry)
    primary_values = {
        entry["slot_id"]: entry["value"]
        for entry in primary_contract["slot_values"]
    }
    assert [primary_values[slot_id] for slot_id in buy_slots] == [
        f"BUY_AMT_{index}" for index in range(8)
    ]
    assert [primary_values[slot_id] for slot_id in sell_slots] == [
        f"SELL_AMT_{index}" for index in range(8)
    ]
    assert [primary_values[slot_id] for slot_id in sign_slots] == [
        f"NET_QTY_{index}" for index in range(3)
    ]


def test_15p5_date_alternate_preserves_rows_and_falls_back_per_row() -> None:
    """날짜 대체 배열이 짧으면 없는 행만 주 source로 돌아가고 행 관찰도 보존한다."""

    from athena_api.card_surface_contract import (
        bind_surface_values,
        build_board_surface_contract,
        observation_id_for,
    )
    from athena_api.card_surface_templates import TEMPLATE_ROOT

    registry = load_registry(TEMPLATE_ROOT, strict=False)

    slot_ids = ["s174", "s187", "s200", "s213"]
    primary_occurrence = "base:ka10048|$.elwdaly_snst_ix[].dt|1"
    alternate_occurrence = "base:ka30003|$.elwlpposs_daly_trnsn[].dt|1"

    primary = bind_surface_values(
        "base:ka10048",
        {"elwdaly_snst_ix": [{"dt": value} for value in ["P0", "P1", "P2", "P3"]]},
    )
    alternate = bind_surface_values(
        "base:ka30003",
        {"elwlpposs_daly_trnsn": [{"dt": value} for value in ["A0", "A1", "A2", "A3"]]},
    )
    short_alternate = bind_surface_values(
        "base:ka30003",
        {"elwlpposs_daly_trnsn": [{"dt": "A0"}, {"dt": "A1"}]},
    )

    def entries(bound, active_operations):
        contract = build_board_surface_contract("15P5-2", bound, registry, active_operations)
        return contract, {
            entry["slot_id"]: entry
            for entry in contract["slot_values"]
            if entry["slot_id"] in slot_ids
        }

    _, primary_rows = entries(primary, ("base:ka10048",))
    assert [
        (
            primary_rows[slot_id]["value"],
            primary_rows[slot_id]["occurrence_id"],
            primary_rows[slot_id]["row_index"],
            primary_rows[slot_id]["observation_id"],
        )
        for slot_id in slot_ids
    ] == [
        ("P0", primary_occurrence, 0, observation_id_for(primary_occurrence, 0)),
        ("P1", primary_occurrence, 1, observation_id_for(primary_occurrence, 1)),
        ("P2", primary_occurrence, 2, observation_id_for(primary_occurrence, 2)),
        ("P3", primary_occurrence, 3, observation_id_for(primary_occurrence, 3)),
    ]

    _, alternate_rows = entries(alternate, ("base:ka30003",))
    assert [
        (
            alternate_rows[slot_id]["value"],
            alternate_rows[slot_id]["occurrence_id"],
            alternate_rows[slot_id]["row_index"],
            alternate_rows[slot_id]["observation_id"],
        )
        for slot_id in slot_ids
    ] == [
        ("A0", alternate_occurrence, 0, observation_id_for(alternate_occurrence, 0)),
        ("A1", alternate_occurrence, 1, observation_id_for(alternate_occurrence, 1)),
        ("A2", alternate_occurrence, 2, observation_id_for(alternate_occurrence, 2)),
        ("A3", alternate_occurrence, 3, observation_id_for(alternate_occurrence, 3)),
    ]

    short_contract, short_rows = entries(short_alternate, ("base:ka30003",))
    assert [
        (
            short_rows[slot_id]["value"],
            short_rows[slot_id]["occurrence_id"],
            short_rows[slot_id]["row_index"],
            short_rows[slot_id]["observation_id"],
        )
        for slot_id in slot_ids[:2]
    ] == [
        ("A0", alternate_occurrence, 0, observation_id_for(alternate_occurrence, 0)),
        ("A1", alternate_occurrence, 1, observation_id_for(alternate_occurrence, 1)),
    ]
    assert set(slot_ids[2:]).issubset(short_contract["unbound_slots"])
    assert set(slot_ids[2:]).isdisjoint(short_rows)

    _, mixed_rows = entries({**primary, **short_alternate}, ("base:ka30003", "base:ka10048"))
    assert [
        (
            mixed_rows[slot_id]["value"],
            mixed_rows[slot_id]["occurrence_id"],
            mixed_rows[slot_id]["row_index"],
            mixed_rows[slot_id]["observation_id"],
        )
        for slot_id in slot_ids
    ] == [
        ("A0", alternate_occurrence, 0, observation_id_for(alternate_occurrence, 0)),
        ("A1", alternate_occurrence, 1, observation_id_for(alternate_occurrence, 1)),
        ("P2", primary_occurrence, 2, observation_id_for(primary_occurrence, 2)),
        ("P3", primary_occurrence, 3, observation_id_for(primary_occurrence, 3)),
    ]
