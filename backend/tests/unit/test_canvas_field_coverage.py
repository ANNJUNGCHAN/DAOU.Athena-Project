from __future__ import annotations

import pytest

from athena_api.canvas_field_coverage import (
    CanvasFieldCoverageError,
    get_current_canvas_field_coverage,
)


def test_current_coverage_is_derived_and_registry_ready() -> None:
    report = get_current_canvas_field_coverage()

    assert report.raw_occurrence_count == 3_705
    assert report.unique_path_count == 3_703
    assert report.duplicate_occurrence_count == 2
    assert report.label_count == 3_705
    assert report.wire_complete is True
    assert report.occurrence_complete is True
    assert report.label_complete is True
    assert report.semantic_accounted is True
    assert report.semantic_complete is False
    assert report.registry_ready is True
    assert report.review_ready is False
    assert report.release_ready is False
    report.require_registry_ready()
    with pytest.raises(CanvasFieldCoverageError, match="runtime rendering and E2E"):
        report.require_release_ready()


def test_official_opaque_fields_are_accounted_but_not_claimed_fully_named() -> None:
    report = get_current_canvas_field_coverage()

    assert report.official_semantic_count == 3_703
    assert report.official_opaque_count == 2
    assert report.unresolved_semantic_count == 0
    assert report.fully_named_semantic_complete is False


def test_duplicate_wire_paths_keep_distinct_contiguous_ordinals() -> None:
    report = get_current_canvas_field_coverage()
    duplicates = {
        (duplicate.mapping_id, duplicate.json_path): duplicate.ordinals
        for duplicate in report.duplicate_paths
    }

    assert duplicates == {
        ("base:ka10173", "$.trnm"): (1, 2),
        ("base:ka10173", "$.data"): (1, 2),
    }
