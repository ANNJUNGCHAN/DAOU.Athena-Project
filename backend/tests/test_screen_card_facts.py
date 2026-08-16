"""Guards for the per-card facts the 화면기획서 Paper artboards display.

The artboards for `AT-CV-005` print counts, dimensions and representative
mappings. Numbers drawn by hand into a design file cannot be verified, so they
are generated from the manifest instead; these tests are what make the drawn
numbers checkable.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
SCRIPTS = BACKEND / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from render_screen_card_facts import (  # noqa: E402
    CARD_NAMES,
    DIMENSIONS,
    OUTPUT_PATH,
    SCREEN_ID,
    build,
    percentile,
    serialize,
)
from render_screen_injection_map import load_manifest  # noqa: E402

# Pinned in plan/kiwoom-common-screen-spec.md §1 and independently asserted in
# tests/test_screen_injection_map.py.
EXPECTED_CARD_COUNTS = {
    "TableCard": 121,
    "FactsCard": 114,
    "CompoundCard": 29,
    "EventCard": 23,
    "ActionCard": 12,
    "StatusCard": 2,
}

# The five cell primitives of plan/kiwoom-common-screen-spec.md §4. Every alias
# listed here must be one the manifest actually reports as high-frequency.
CELL_PRIMITIVE_ALIASES = {
    "price": ("cur_prc", "high_pric", "low_pric", "open_pric"),
    "change": ("pred_pre", "pred_pre_sig", "flu_rt"),
    "quantity": ("trde_qty", "acc_trde_qty"),
    "instrument": ("stk_cd", "stk_nm"),
    "datetime": ("dt",),
}


def facts() -> dict[str, Any]:
    return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))


def test_committed_card_facts_are_byte_identical_to_a_fresh_render() -> None:
    """A stale facts file means the artboards show numbers the API no longer has."""
    assert OUTPUT_PATH.read_text(encoding="utf-8") == serialize(build(load_manifest()))


def test_cards_partition_all_301_mappings_with_the_pinned_counts() -> None:
    """Six cards, no remainder: the whole coverage claim of the screen document."""
    data = facts()
    counts = {card["card"]: card["mappings"] for card in data["cards"]}
    assert counts == EXPECTED_CARD_COUNTS
    assert sum(counts.values()) == data["totals"]["routable"] == 301
    assert {card["layout"] for card in data["cards"]} == set(CARD_NAMES)
    assert len({card["layout"] for card in data["cards"]}) == len(data["cards"])


def test_each_card_declares_one_category_and_one_screen_id() -> None:
    """A card serving two safety classes would let a read screen place an order."""
    data = facts()
    category_of = {card["card"]: card["category"] for card in data["cards"]}
    read_display = {"TableCard", "FactsCard", "CompoundCard"}
    assert {category_of[card] for card in read_display} == {"read_display"}
    assert category_of["EventCard"] == "websocket"
    assert category_of["ActionCard"] == "order"
    assert category_of["StatusCard"] == "oauth"
    for card in data["cards"]:
        assert card["screen_id"] == SCREEN_ID == "AT-CV-005"


def test_domain_breakdowns_and_the_domain_matrix_both_reconcile_to_301() -> None:
    """The per-domain injection story must add up to the same 301 as the cards.

    If it did not, an artboard could show a domain whose APIs land nowhere, or
    double-count one across two cards.
    """
    data = facts()
    for card in data["cards"]:
        assert sum(entry["count"] for entry in card["domains"]) == card["mappings"]

    matrix = data["domain_matrix"]
    assert sum(row["total"] for row in matrix) == 301
    for row in matrix:
        assert sum(row["by_card"].values()) == row["total"]
        assert set(row["by_card"]) == set(EXPECTED_CARD_COUNTS)

    per_card_from_matrix = {name: 0 for name in EXPECTED_CARD_COUNTS}
    for row in matrix:
        for name, count in row["by_card"].items():
            per_card_from_matrix[name] += count
    assert per_card_from_matrix == EXPECTED_CARD_COUNTS


def test_every_reported_dimension_recomputes_from_the_manifest() -> None:
    """Distributions on the artboards must be measured, not estimated.

    Recomputes min/median/p90/max for every card from the manifest rather than
    trusting the generated file's own arithmetic.
    """
    manifest = load_manifest()
    by_layout: dict[str, list[dict[str, Any]]] = {}
    for mapping in manifest["mappings"]:
        by_layout.setdefault(mapping["presentation"]["layout"], []).append(mapping)

    for card in facts()["cards"]:
        mappings = by_layout[card["layout"]]
        for name, measure in DIMENSIONS.items():
            values = sorted(measure(mapping) for mapping in mappings)
            assert card["dimensions"][name] == {
                "min": values[0],
                "median": percentile(values, 0.5),
                "p90": percentile(values, 0.9),
                "max": values[-1],
            }, f"{card['card']}.{name}"
            reported = card["dimensions"][name]
            assert reported["min"] <= reported["median"] <= reported["p90"] <= reported["max"]
            for bound in reported.values():
                assert bound in values, "percentiles must be observed values, not interpolations"


def test_extremes_and_representatives_point_at_real_manifest_mappings() -> None:
    """An artboard citing a mapping ID that does not exist is a fabricated example."""
    manifest = load_manifest()
    by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}

    for card in facts()["cards"]:
        for name, extreme in card["extremes"].items():
            mapping = by_id[extreme["mapping_id"]]
            assert mapping["presentation"]["layout"] == card["layout"]
            assert DIMENSIONS[name](mapping) == extreme["value"] == card["dimensions"][name]["max"]

        roles = [representative["role"] for representative in card["representatives"]]
        assert roles == sorted(set(roles), key=roles.index), "roles must not repeat"
        assert roles[0] == "max"
        for representative in card["representatives"]:
            mapping = by_id[representative["mapping_id"]]
            assert mapping["presentation"]["layout"] == card["layout"]
            assert mapping["operation"]["tr_id"] == representative["tr_id"]
            assert mapping["operation"]["domain"] == representative["domain"]
            route = mapping["route"]
            assert representative["route"] == f"{route['method']} {route['path']}"
            assert representative["operation_id"] == mapping["route"]["operation_id"]
            for name, measure in DIMENSIONS.items():
                assert representative[name] == measure(mapping)
            dimension = representative["driving_dimension"]
            assert representative["driving_value"] == DIMENSIONS[dimension](mapping)


def test_sample_aliases_are_real_field_names_and_flag_their_own_truncation() -> None:
    """Mockup content must be real aliases; a truncated list must say so.

    Otherwise an artboard showing 12 of 167 FIDs would read as the whole set.
    """
    manifest = load_manifest()
    by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}

    for card in facts()["cards"]:
        for representative in card["representatives"]:
            mapping = by_id[representative["mapping_id"]]
            samples = representative["sample_aliases"]
            response = mapping["fields"]["response"]

            assert samples["response_top_level"] == response["top_level"][:12]
            assert samples["response_top_level_truncated"] == (len(response["top_level"]) > 12)
            request_top = mapping["fields"]["request"]["top_level"]
            assert samples["request_top_level"] == request_top[:12]
            assert samples["request_top_level_truncated"] == (len(request_top) > 12)

            containers = response["data"]
            if containers:
                assert samples["first_container_alias"] == containers[0]["container_alias"]
                columns = containers[0]["field_aliases"]
                assert samples["first_container_columns"] == columns[:12]
                assert samples["first_container_columns_truncated"] == (len(columns) > 12)
            else:
                assert samples["first_container_alias"] is None
                assert samples["first_container_columns"] == []


def test_cell_primitive_evidence_supports_the_five_primitives() -> None:
    """Five cells, not 301 renderers — the claim needs frequency evidence.

    Every alias the five primitives are built from must actually appear in the
    manifest's most frequent response aliases.
    """
    data = facts()
    evidence = {entry["alias"]: entry["mappings"] for entry in data["cell_primitive_evidence"]}
    assert len(data["cell_primitive_evidence"]) == 20

    counts = [entry["mappings"] for entry in data["cell_primitive_evidence"]]
    assert counts == sorted(counts, reverse=True)

    for primitive, aliases in CELL_PRIMITIVE_ALIASES.items():
        for alias in aliases:
            assert alias in evidence, f"{primitive} cell relies on absent alias {alias!r}"

    top_ten = [entry["alias"] for entry in data["cell_primitive_evidence"][:10]]
    covered = {alias for aliases in CELL_PRIMITIVE_ALIASES.values() for alias in aliases}
    assert set(top_ten) <= covered, f"uncovered top-10 aliases: {set(top_ten) - covered}"


def test_status_card_facts_carry_no_credential_or_token_values() -> None:
    """OAuth screens show state, never secrets (spec §6.3, CLAUDE.md §1).

    The facts file is committed and rendered into a design tool, so a token or
    key alias reaching it would be a leak path, not just a documentation flaw.
    """
    data = facts()
    status = next(card for card in data["cards"] if card["card"] == "StatusCard")
    aliases = {
        alias
        for representative in status["representatives"]
        for alias in representative["sample_aliases"]["response_top_level"]
        + representative["sample_aliases"]["request_top_level"]
    }
    assert aliases == {"configured", "ready", "expires_at"}

    forbidden = ("token", "secret", "appkey", "app_key", "secretkey", "password")
    serialized = OUTPUT_PATH.read_text(encoding="utf-8").lower()
    for needle in forbidden:
        assert needle not in serialized, f"{needle!r} must not reach the generated facts file"
