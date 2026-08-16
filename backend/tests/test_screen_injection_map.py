from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
SCRIPTS = BACKEND / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from render_screen_injection_map import (  # noqa: E402
    MANIFEST_PATH,
    OUTPUT_PATH,
    load_manifest,
    render,
)

EXPECTED_LAYOUT_COUNTS = {
    "facts": 114,
    "table": 121,
    "compound": 29,
    "event": 23,
    "action": 12,
    "status": 2,
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_committed_injection_map_is_byte_identical_to_a_fresh_render() -> None:
    """The committed appendix must never drift from what the generator produces.

    If it drifted, the plan document would silently describe a stale API surface
    instead of the one actually served.
    """
    manifest = load_manifest()
    rendered = render(manifest)
    committed = OUTPUT_PATH.read_text(encoding="utf-8")
    assert committed == rendered


def test_layouts_partition_all_mappings_with_the_pinned_per_layout_counts() -> None:
    """Every mapping must land in exactly one layout, with the measured counts.

    A mapping missing from every layout, or double-counted across layouts,
    would mean a card either drops an API or double-injects it.
    """
    manifest = load_manifest()
    mappings = manifest["mappings"]
    mapping_ids = {mapping["mapping_id"] for mapping in mappings}

    counted_ids: set[str] = set()
    counts: dict[str, int] = {}
    for mapping in mappings:
        layout = mapping["presentation"]["layout"]
        counts[layout] = counts.get(layout, 0) + 1
        assert mapping["mapping_id"] not in counted_ids
        counted_ids.add(mapping["mapping_id"])

    assert counted_ids == mapping_ids
    assert counts == EXPECTED_LAYOUT_COUNTS
    assert sum(counts.values()) == len(mappings)


def test_layout_and_category_form_a_well_defined_many_to_one_function() -> None:
    """Each layout must map to exactly one category.

    This is the property the whole card model rests on; if it ever broke, one
    card would have to serve two safety classes at once (for example a table
    card that is sometimes read-only and sometimes an order-placing action).
    """
    manifest = load_manifest()
    categories_by_layout: dict[str, set[str]] = {}
    for mapping in manifest["mappings"]:
        layout = mapping["presentation"]["layout"]
        categories_by_layout.setdefault(layout, set()).add(mapping["classification"]["category"])

    assert set(categories_by_layout) == set(EXPECTED_LAYOUT_COUNTS)
    for layout, categories in categories_by_layout.items():
        assert len(categories) == 1, f"layout {layout!r} spans categories {categories}"

    # facts/table/compound intentionally collapse onto one category (read_display);
    # event/action/status are each the sole layout for their category.
    category_of = {
        layout: next(iter(categories)) for layout, categories in categories_by_layout.items()
    }
    read_display_layouts = {
        layout for layout, category in category_of.items() if category == "read_display"
    }
    assert read_display_layouts == {"facts", "table", "compound"}
    for layout, category in category_of.items():
        if layout not in read_display_layouts:
            assert [ly for ly, cat in category_of.items() if cat == category] == [layout]


def test_every_mapping_appears_exactly_once_in_the_rendered_document() -> None:
    """A mapping missing from the document would leave its API silently uninjected.

    A mapping appearing twice as its own row would suggest it was accidentally
    attached to two cards, or that a rendering bug duplicated a section.
    Excluded-original rows may legitimately reference a detail mapping ID again
    in their "replacement mapping IDs" column, so this only counts rows where
    the mapping ID leads the row (its own table entry).
    """
    manifest = load_manifest()
    lines = OUTPUT_PATH.read_text(encoding="utf-8").splitlines()
    for mapping in manifest["mappings"]:
        prefix = f"| `{mapping['mapping_id']}` |"
        occurrences = sum(line.startswith(prefix) for line in lines)
        assert occurrences == 1, f"{mapping['mapping_id']} has {occurrences} own-rows"


def test_every_route_operation_id_is_unique_and_appears_in_the_document() -> None:
    """Operation IDs are the FastAPI-level handle for each route.

    A duplicate operation ID would mean two routes collide in the OpenAPI
    schema; a missing one would mean the appendix omits a live endpoint.
    """
    manifest = load_manifest()
    document = OUTPUT_PATH.read_text(encoding="utf-8")
    operation_ids = [mapping["route"]["operation_id"] for mapping in manifest["mappings"]]

    assert len(operation_ids) == len(set(operation_ids))
    for operation_id in operation_ids:
        assert f"`{operation_id}`" in document


def test_manifest_counts_agree_with_the_actual_mappings_array() -> None:
    """`manifest["counts"]` is a cached summary; it must not be trusted blindly.

    If a manual edit to the manifest ever desynced the recorded counts from the
    mappings array itself, this appendix (and the plan document) would report
    numbers that do not match the routes actually being described.
    """
    manifest = load_manifest()
    mappings = manifest["mappings"]

    actual_base = sum(mapping["mapping_type"] == "base" for mapping in mappings)
    actual_split = sum(mapping["mapping_type"] == "split_derived" for mapping in mappings)
    actual_categories = {
        category: sum(mapping["classification"]["category"] == category for mapping in mappings)
        for category in ("read_display", "websocket", "order", "oauth")
    }

    assert manifest["counts"]["unsplit_base"] == actual_base
    assert manifest["counts"]["split_derived"] == actual_split
    assert manifest["counts"]["routable"] == len(mappings) == actual_base + actual_split
    assert manifest["counts"]["categories"] == actual_categories
    assert manifest["counts"]["excluded_split_originals"] == len(manifest["exclusions"])


def test_all_exclusions_appear_in_the_document_and_none_is_also_routable() -> None:
    """The 22 excluded split originals must be documented, not silently dropped.

    None of them may also appear as a routable base mapping: a TR that was
    split into detail routes is retired as a whole-response endpoint, so it
    must not show up twice with two different meanings.
    """
    manifest = load_manifest()
    document = OUTPUT_PATH.read_text(encoding="utf-8")
    exclusions = manifest["exclusions"]
    excluded_tr_ids = {exclusion["tr_id"] for exclusion in exclusions}
    routable_base_tr_ids = {
        mapping["operation"]["tr_id"]
        for mapping in manifest["mappings"]
        if mapping["mapping_type"] == "base"
    }

    assert len(exclusions) == 22
    assert not excluded_tr_ids & routable_base_tr_ids
    for tr_id in excluded_tr_ids:
        assert f"`{tr_id}`" in document


def test_manifest_path_used_by_the_generator_matches_the_committed_source() -> None:
    """Guards against the generator silently reading a different manifest file."""
    assert MANIFEST_PATH == BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
    assert MANIFEST_PATH.is_file()
    manifest = load_manifest()
    assert manifest["counts"]["routable"] == 301
