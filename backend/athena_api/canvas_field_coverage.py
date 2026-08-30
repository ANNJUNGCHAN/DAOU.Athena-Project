"""Fail-closed coverage report derived from the Canvas field registry."""

from __future__ import annotations

from dataclasses import dataclass

from athena_api.canvas_field_registry import (
    EXPECTED_DUPLICATE_PATHS,
    EXPECTED_FIELD_OCCURRENCE_COUNT,
    EXPECTED_UNIQUE_FIELD_PATH_COUNT,
    CanvasFieldRegistry,
    CanvasFieldRegistryError,
    get_canvas_field_registry,
)

EXPECTED_RAW_FIELD_OCCURRENCES = EXPECTED_FIELD_OCCURRENCE_COUNT
EXPECTED_UNIQUE_FIELD_PATHS = EXPECTED_UNIQUE_FIELD_PATH_COUNT


class CanvasFieldCoverageError(ValueError):
    """Raised when field coverage evidence is incomplete or contradictory."""


@dataclass(frozen=True, slots=True)
class DuplicateFieldPath:
    mapping_id: str
    json_path: str
    ordinals: tuple[int, ...]

    @property
    def occurrence_count(self) -> int:
        return len(self.ordinals)


@dataclass(frozen=True, slots=True)
class CanvasFieldCoverageReport:
    raw_occurrence_count: int
    unique_path_count: int
    duplicate_occurrence_count: int
    label_count: int
    official_semantic_count: int
    official_opaque_count: int
    unresolved_semantic_count: int
    duplicate_paths: tuple[DuplicateFieldPath, ...]

    @property
    def wire_complete(self) -> bool:
        return (
            self.raw_occurrence_count == EXPECTED_RAW_FIELD_OCCURRENCES
            and self.unique_path_count == EXPECTED_UNIQUE_FIELD_PATHS
            and self.duplicate_occurrence_count
            == EXPECTED_RAW_FIELD_OCCURRENCES - EXPECTED_UNIQUE_FIELD_PATHS
        )

    @property
    def occurrence_complete(self) -> bool:
        return self.wire_complete

    @property
    def label_complete(self) -> bool:
        return self.label_count == self.raw_occurrence_count

    @property
    def semantic_complete(self) -> bool:
        """Every field has an officially known meaning, with no opaque fields."""

        return (
            self.unresolved_semantic_count == 0
            and self.official_opaque_count == 0
            and self.official_semantic_count == self.raw_occurrence_count
        )

    @property
    def semantic_accounted(self) -> bool:
        """Every field is officially named or explicitly officially opaque."""

        return (
            self.unresolved_semantic_count == 0
            and self.official_semantic_count + self.official_opaque_count
            == self.raw_occurrence_count
        )

    @property
    def fully_named_semantic_complete(self) -> bool:
        return self.semantic_complete

    @property
    def registry_ready(self) -> bool:
        return self.wire_complete and self.label_complete and self.semantic_accounted

    @property
    def review_ready(self) -> bool:
        # Global review requires the separate Canvas runtime/render/E2E gate.
        return False

    @property
    def release_ready(self) -> bool:
        # Global release requires the separate Canvas runtime/render/E2E gate.
        return False

    def require_registry_ready(self) -> None:
        if not self.registry_ready:
            raise CanvasFieldCoverageError(
                "Canvas field registry is not wire, label, and semantic-accounting complete"
            )

    def require_release_ready(self) -> None:
        raise CanvasFieldCoverageError(
            "Canvas runtime rendering and E2E verification are not release ready"
        )


def evaluate_canvas_field_coverage(
    registry: CanvasFieldRegistry,
) -> CanvasFieldCoverageReport:
    """Reconcile coverage from actual registry occurrences."""

    try:
        summary = registry.summary
        duplicate_evidence: dict[tuple[str, str], list[int]] = {}
        for contract in registry.contracts:
            duplicate_evidence.setdefault(
                (contract.mapping_id, contract.json_path), []
            ).append(contract.ordinal)
    except CanvasFieldRegistryError as exc:
        raise CanvasFieldCoverageError(str(exc)) from exc

    duplicates = tuple(
        DuplicateFieldPath(mapping_id, json_path, tuple(ordinals))
        for (mapping_id, json_path), ordinals in sorted(duplicate_evidence.items())
        if len(ordinals) > 1
    )
    if frozenset((item.mapping_id, item.json_path) for item in duplicates) != (
        EXPECTED_DUPLICATE_PATHS
    ):
        raise CanvasFieldCoverageError(
            "duplicate field paths do not match the audited ka10173 wire paths"
        )
    if any(item.ordinals != tuple(range(1, len(item.ordinals) + 1)) for item in duplicates):
        raise CanvasFieldCoverageError("duplicate field occurrence ordinals are not contiguous")

    report = CanvasFieldCoverageReport(
        raw_occurrence_count=summary.field_occurrence_count,
        unique_path_count=summary.unique_field_path_count,
        duplicate_occurrence_count=summary.duplicate_occurrence_count,
        label_count=summary.label_count,
        official_semantic_count=summary.official_semantic_count,
        official_opaque_count=summary.official_opaque_count,
        unresolved_semantic_count=summary.unresolved_semantic_count,
        duplicate_paths=duplicates,
    )
    if not report.registry_ready:
        raise CanvasFieldCoverageError(f"Canvas field coverage is incomplete: {report!r}")
    return report


def get_current_canvas_field_coverage() -> CanvasFieldCoverageReport:
    return evaluate_canvas_field_coverage(get_canvas_field_registry())
