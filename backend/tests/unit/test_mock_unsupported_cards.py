"""모의 거절 TR 은 값 바인딩에서 빠지고, 모의 지원 REST 는 보드가 덮는다."""

from __future__ import annotations

from athena_api.card_surface_contract import build_board_surface_contract
from athena_api.card_surface_templates import TEMPLATE_ROOT, get_registry, load_registry
from athena_api.mock_unsupported import (
    is_mock_unsupported,
    mock_supported_query_refs,
    mock_unsupported_trs,
)


def test_ledger_lists_the_twelve_mock_rejected_trs() -> None:
    assert mock_unsupported_trs() == frozenset(
        {
            "ka01690",
            "kt00002",
            "kt00005",
            "kt00012",
            "kt00015",
            "kt00016",
            "kt00017",
            "kt20016",
            "kt20017",
            "kt50020",
            "kt50021",
            "kt50032",
        }
    )
    assert is_mock_unsupported("base:ka01690")
    assert is_mock_unsupported("detail:kt00005:cash_and_capacity")
    assert not is_mock_unsupported("base:ka10001")
    assert not is_mock_unsupported("detail:kt00004:position_valuation")


def test_loaded_boards_have_no_mock_unsupported_value_bindings() -> None:
    registry = load_registry(TEMPLATE_ROOT)
    leftover: list[str] = []
    for board in registry.boards.values():
        for slot in board.binding_slots:
            for binding in slot.bindings:
                if is_mock_unsupported(binding.mapping_id):
                    leftover.append(
                        f"{board.board_id}:{slot.slot_id}:{binding.mapping_id}"
                    )
        for ref in board.operation_refs:
            if is_mock_unsupported(ref):
                leftover.append(f"{board.board_id}:op:{ref}")
    assert leftover == []


def test_omitted_mock_slots_are_empty_not_missing() -> None:
    registry = load_registry(TEMPLATE_ROOT)
    board = registry.boards["133H-2"]
    omitted = [slot.slot_id for slot in board.slots if slot.omitted_unsupported]
    assert omitted
    contract = build_board_surface_contract("133H-2", {}, registry)
    empty = set(contract["empty_value_slots"])
    missing_unbound = set(contract["unbound_slots"])
    for slot_id in omitted:
        assert slot_id in empty
        assert slot_id not in missing_unbound


def test_promoted_alt_keeps_its_own_json_path() -> None:
    registry = load_registry(TEMPLATE_ROOT)
    slot = registry.boards["3GRO-0"].slot("s016")
    assert slot is not None
    assert slot.mapping_id == "detail:kt00004:cash_and_assets"
    assert slot.f == "aset_evlt_amt"
    assert slot.occurrence_id is not None
    assert slot.json_path != "$.day_stk_asst"


def test_percent_slots_do_not_bind_amount_fields() -> None:
    registry = load_registry(TEMPLATE_ROOT)
    leftover: list[str] = []
    for board in registry.boards.values():
        for slot in board.slots:
            if slot.composite is not None:
                continue
            fmt = slot.format or {}
            if fmt.get("unit") != "percent" and fmt.get("kind") != "percent":
                continue
            for binding in slot.bindings:
                field = binding.f or ""
                if field.endswith("_amt"):
                    leftover.append(
                        f"{board.board_id}:{slot.slot_id}:{binding.mapping_id}/{field}"
                    )
    assert leftover == []


def test_mock_supported_query_refs_are_on_some_board() -> None:
    registry = get_registry()
    covered = {
        ref
        for board in registry.boards.values()
        for ref in board.operation_refs
    }
    supported = mock_supported_query_refs()
    missing = sorted(supported - covered)
    # 밀도 한도로 못 넣는 항목은 이 단언이 목록을 드러낸다 — 조용히 낮추지 않는다.
    assert missing == []
