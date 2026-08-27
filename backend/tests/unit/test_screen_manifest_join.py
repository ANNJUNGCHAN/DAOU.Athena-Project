
from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena_api.generated.registry import DETAIL_REGISTRY, SPLIT_BASE_TR_IDS, TR_REGISTRY
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.errors import DetailGroupRequiredError, NoConfidentMatchError
from _selector_facade import select_operation
from athena_api.selector.schemas import ReasonCode, ResponseMode

BACKEND = Path(__file__).resolve().parents[2]
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"


def _manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def catalog():
    return build_operation_catalog()


@pytest.fixture(scope="module")
def manifest() -> dict:
    return _manifest()


@pytest.fixture(scope="module")
def base_mappings(manifest: dict) -> list[dict]:
    return [m for m in manifest["mappings"] if m["mapping_type"] == "base"]


@pytest.fixture(scope="module")
def detail_mappings(manifest: dict) -> list[dict]:
    return [m for m in manifest["mappings"] if m["mapping_type"] == "split_derived"]


# ---------------------------------------------------------------------------
# Coverage — base + detail must sum to exactly 301 with zero gaps.
# ---------------------------------------------------------------------------


def test_manifest_mapping_coverage_is_301_with_zero_missing(
    manifest: dict, base_mappings: list[dict], detail_mappings: list[dict]
) -> None:
    mappings = manifest["mappings"]
    assert len(mappings) == 301
    assert {m["mapping_type"] for m in mappings} == {"base", "split_derived"}
    assert len(base_mappings) + len(detail_mappings) == 301
    mapping_ids = [m["mapping_id"] for m in mappings]
    assert len(mapping_ids) == len(set(mapping_ids)) == 301
    # Every mapping_id must parse into the shape the selector actually keys on.
    unparsed = [
        mapping_id
        for mapping_id in mapping_ids
        if not (mapping_id.startswith("base:") or mapping_id.startswith("detail:"))
    ]
    assert unparsed == []


# ---------------------------------------------------------------------------
# Base mappings ↔ TR_REGISTRY + real selector resolution.
# ---------------------------------------------------------------------------


def test_every_base_mapping_tr_id_exists_in_generated_tr_registry(
    base_mappings: list[dict],
) -> None:
    missing = [
        mapping["mapping_id"]
        for mapping in base_mappings
        if mapping["operation"]["tr_id"] not in TR_REGISTRY
    ]
    assert missing == []


def test_every_callable_base_mapping_resolves_through_real_select_operation(
    catalog, base_mappings: list[dict]
) -> None:
    """query/order/websocket base mappings must round-trip through the exact same
    legacy `select_operation` exact-ref branch when a caller passes the operation_ref
    back as the question. SelectorService owns an equivalent exact-identity branch."""
    callable_mappings = [
        m for m in base_mappings if m["classification"]["category"] != "oauth"
    ]
    assert callable_mappings  # sanity: fixture is not accidentally empty
    misses: list[str] = []
    for mapping in callable_mappings:
        mapping_id = mapping["mapping_id"]
        tr_id = mapping["operation"]["tr_id"]
        assert mapping_id == f"base:{tr_id}"
        document, reasons = select_operation(catalog, mapping_id, (), ResponseMode.AUTO)
        if document.operation_ref != mapping_id or reasons != [ReasonCode.EXACT_OPERATION_REF]:
            misses.append(mapping_id)
    assert misses == []


def test_oauth_base_mappings_join_the_registry_but_are_deliberately_hidden_from_the_selector(
    catalog, base_mappings: list[dict]
) -> None:
    oauth_mappings = [m for m in base_mappings if m["classification"]["category"] == "oauth"]
    assert len(oauth_mappings) == 2
    for mapping in oauth_mappings:
        mapping_id = mapping["mapping_id"]
        tr_id = mapping["operation"]["tr_id"]
        assert tr_id in TR_REGISTRY
        document = catalog.by_ref.get(mapping_id)
        assert document is not None
        assert document.visibility == "hidden"
        assert document.generic_callable is False
        # find_exact makes hidden operations "deliberately look absent" (catalog.py:127) —
        # confirm select_operation really refuses it end to end, not just by inspection.
        assert catalog.find_exact(mapping_id) is None
        with pytest.raises(NoConfidentMatchError):
            select_operation(catalog, mapping_id, (), ResponseMode.AUTO)


# ---------------------------------------------------------------------------
# Detail mappings ↔ DETAIL_REGISTRY + real _resolve_detail path (SPLIT_BASE_TR_IDS branch).
# ---------------------------------------------------------------------------


def test_every_detail_mapping_key_exists_in_generated_detail_registry(
    detail_mappings: list[dict],
) -> None:
    missing = [
        mapping["mapping_id"]
        for mapping in detail_mappings
        if mapping["mapping_id"] not in DETAIL_REGISTRY
    ]
    assert missing == []


def test_every_detail_mapping_resolves_through_real_split_base_branch(
    catalog, detail_mappings: list[dict]
) -> None:
    """Drives the legacy exact/detail facade for a split family: question equals
    the base operation_ref and detail_group equals the projection's owned group id."""
    assert detail_mappings  # sanity
    misses: list[str] = []
    for mapping in detail_mappings:
        mapping_id = mapping["mapping_id"]
        tr_id = mapping["operation"]["tr_id"]
        group_id = mapping["operation"]["detail_group_id"]
        assert mapping_id == f"detail:{tr_id}:{group_id}"
        assert tr_id in SPLIT_BASE_TR_IDS
        document, reasons = select_operation(
            catalog, f"base:{tr_id}", (), ResponseMode.AUTO, group_id
        )
        if document.operation_ref != mapping_id or reasons != [ReasonCode.EXPLICIT_DETAIL_GROUP]:
            misses.append(mapping_id)
    assert misses == []


def test_split_base_tr_ids_have_no_base_mapping_and_are_fully_covered_by_details(
    manifest: dict,
) -> None:
    base_tr_ids = {
        m["operation"]["tr_id"] for m in manifest["mappings"] if m["mapping_type"] == "base"
    }
    detail_tr_ids = {
        m["operation"]["tr_id"]
        for m in manifest["mappings"]
        if m["mapping_type"] == "split_derived"
    }
    assert not (SPLIT_BASE_TR_IDS & base_tr_ids)
    assert SPLIT_BASE_TR_IDS <= detail_tr_ids
    assert len(SPLIT_BASE_TR_IDS) == 22


# ---------------------------------------------------------------------------
# Named regression — ka10001, the plan's own worked example (P0 Deliverable 2, §1.3).
# ---------------------------------------------------------------------------


def test_ka10001_has_no_base_mapping_and_resolves_only_through_its_seven_details(
    catalog, manifest: dict
) -> None:
    mapping_ids = {m["mapping_id"] for m in manifest["mappings"]}
    assert "base:ka10001" not in mapping_ids
    ka10001_details = sorted(
        m["mapping_id"]
        for m in manifest["mappings"]
        if m["mapping_type"] == "split_derived" and m["operation"]["tr_id"] == "ka10001"
    )
    assert len(ka10001_details) == 7

    for mapping_id in ka10001_details:
        group_id = mapping_id.removeprefix("detail:ka10001:")
        document, reasons = select_operation(
            catalog, "base:ka10001", (), ResponseMode.AUTO, group_id
        )
        assert document.operation_ref == mapping_id
        assert reasons == [ReasonCode.EXPLICIT_DETAIL_GROUP]

    # Asking for the family without a detail_group must fail the same way a live caller's
    # omission would — proving the manifest's exclusion of base:ka10001 matches runtime
    # behaviour rather than being an arbitrary omission.
    with pytest.raises(DetailGroupRequiredError) as caught:
        select_operation(catalog, "base:ka10001", (), ResponseMode.AUTO)
    assert caught.value.details["operation_ref"] == "base:ka10001"
    assert sorted(caught.value.details["available_groups"]) == [
        group_id.removeprefix("detail:ka10001:") for group_id in ka10001_details
    ]


# ---------------------------------------------------------------------------
# Exclusions ledger — the 22 split-original base TRs manifest deliberately omits.
# ---------------------------------------------------------------------------


def test_exclusions_replacement_mapping_ids_are_all_real_resolvable_detail_mappings(
    catalog, manifest: dict
) -> None:
    mapping_ids = {m["mapping_id"] for m in manifest["mappings"]}
    exclusions = manifest["exclusions"]
    assert len(exclusions) == 22
    assert {exclusion["tr_id"] for exclusion in exclusions} == SPLIT_BASE_TR_IDS

    for exclusion in exclusions:
        tr_id = exclusion["tr_id"]
        assert f"base:{tr_id}" not in mapping_ids
        replacements = exclusion["replacement_mapping_ids"]
        assert replacements  # every split original must have at least one detail replacement
        for replacement_id in replacements:
            assert replacement_id in mapping_ids
            assert replacement_id in DETAIL_REGISTRY
            group_id = replacement_id.removeprefix(f"detail:{tr_id}:")
            document, reasons = select_operation(
                catalog, f"base:{tr_id}", (), ResponseMode.AUTO, group_id
            )
            assert document.operation_ref == replacement_id
            assert reasons == [ReasonCode.EXPLICIT_DETAIL_GROUP]
