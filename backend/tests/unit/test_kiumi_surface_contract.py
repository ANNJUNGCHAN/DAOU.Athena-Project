"""키우미 360×420 미니 카드의 저장·전달 계약."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena_api.card_surface_contract import build_board_surface_contract
from athena_api.card_surface_templates import (
    TEMPLATE_ROOT,
    CardSurfaceTemplateError,
    _parse_kiumi,
    load_registry,
)

GRAMMARS = {
    "table",
    "chart",
    "facts",
    "compound",
    "order_ticket",
    "order_confirm",
    "event",
    "auth",
    "reader",
    "stream",
}
LEDGER_PATH = TEMPLATE_ROOT.parent / "kiumi" / "kiumi-ledger.jsonl"


def test_all_96_boards_have_an_approved_360_by_420_kiumi_spec() -> None:
    registry = load_registry(TEMPLATE_ROOT)

    assert len(registry.boards) == 96
    for board in registry.boards.values():
        spec = board.kiumi
        assert spec is not None, board.board_id
        assert spec["version"] == 1, board.board_id
        assert spec["width_px"] == 360, board.board_id
        assert spec["height_px"] == 420, board.board_id
        assert spec["grammar"] in GRAMMARS, board.board_id
        assert spec["fixed"] is True, board.board_id
        assert spec["reviewed_by"] == "user-approved-paper/H-1@2026-09-03", board.board_id
        elements = spec["elements"]
        assert elements, board.board_id
        slot_ids = [element["source_slot_id"] for element in elements]
        assert len(slot_ids) == len(set(slot_ids)), board.board_id
        assert all(board.slot(slot_id) is not None for slot_id in slot_ids), board.board_id
        assert all("…" not in element["label"] for element in elements), board.board_id


def test_surface_contract_carries_the_same_kiumi_spec_to_the_orb() -> None:
    registry = load_registry(TEMPLATE_ROOT)
    board = registry.boards["2SCE-1"]

    contract = build_board_surface_contract("2SCE-1", {}, registry)

    assert contract is not None
    assert contract["kiumi"] == dict(board.kiumi)
    assert contract["kiumi"]["grammar"] == "compound"
    assert contract["kiumi"]["height_px"] == 420


def test_structure_missing_boards_use_the_approved_facts_override() -> None:
    registry = load_registry(TEMPLATE_ROOT)
    structure_missing = {
        "1WOB-1",
        "2XG6-0",
        "2XKO-0",
        "2XP6-0",
        "2XTO-0",
        "2YA8-0",
        "2YEQ-0",
        "2YJ8-0",
        "2YNQ-0",
        "3BQB-0",
        "3N4O-0",
    }

    assert {
        board_id
        for board_id, board in registry.boards.items()
        if board.kiumi and board.kiumi.get("structure_missing")
    } == structure_missing
    assert all(
        registry.boards[board_id].kiumi["grammar"] == "facts"
        for board_id in structure_missing
    )


def test_ledger_is_the_single_source_for_all_96_slots_specs() -> None:
    ledger = {
        record["board_id"]: record
        for line in Path(LEDGER_PATH).read_text(encoding="utf-8").splitlines()
        if (record := json.loads(line))
    }
    registry = load_registry(TEMPLATE_ROOT)

    assert len(ledger) == 96
    assert set(ledger) == set(registry.boards)
    for board_id, record in ledger.items():
        expected = {key: value for key, value in record.items() if key != "board_id"}
        assert dict(registry.boards[board_id].kiumi) == expected, board_id


def _valid_spec() -> dict[str, object]:
    return {
        "version": 1,
        "width_px": 360,
        "height_px": 420,
        "grammar": "facts",
        "title": "테스트",
        "reviewed_by": "test",
        "fixed": True,
        "elements": [
            {"source_slot_id": "s1", "label": "값", "format": {"unit": "text"}}
        ],
        "fold_note": None,
        "structure_missing": False,
    }


def test_kiumi_parser_rejects_a_non_420_card() -> None:
    spec = _valid_spec()
    spec["height_px"] = 640

    with pytest.raises(CardSurfaceTemplateError, match="exactly 360x420"):
        _parse_kiumi(spec, "B", {"s1"})


def test_kiumi_parser_rejects_unknown_or_repeated_source_slots() -> None:
    unknown = _valid_spec()
    unknown["elements"][0]["source_slot_id"] = "missing"  # type: ignore[index]
    with pytest.raises(CardSurfaceTemplateError, match="unknown slot"):
        _parse_kiumi(unknown, "B", {"s1"})

    repeated = _valid_spec()
    repeated["elements"] = [*repeated["elements"], repeated["elements"][0]]  # type: ignore[index]
    with pytest.raises(CardSurfaceTemplateError, match="repeats a source_slot_id"):
        _parse_kiumi(repeated, "B", {"s1"})
