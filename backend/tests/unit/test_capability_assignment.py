from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"

EXPECTED_OPERATION_COUNTS = {
    "account": 76,
    "order": 12,
    "chart": 21,
    "orderbook": 31,
    "program-trading": 9,
    "etf": 10,
    "elw": 22,
    "sector": 16,
    "investor-flow": 16,
    "broker": 16,
    "discovery": 10,
    "credit-lending-short": 9,
    "stock-info": 21,
    "watchlist": 8,
    "quote": 9,
    "gold": 5,
    "theme": 2,
    "market-status": 2,
    "condition-search": 4,
}

EXPECTED_CAPABILITY_ORDER = tuple(EXPECTED_OPERATION_COUNTS)

EXPECTED_MAPPING_DIGESTS = {
    "account": "b94666393b13cca5d75cd395c011567b2e2682f4e8893eea6f9ab53bbcc0d5db",
    "order": "b2dbd97a3d306d8acd4541c5a754c0a87319a832b3baa5b4398f875ffe42caa1",
    "chart": "314eb5191ffeaa2e866c896ec21ca01a57e6858e81a0231350f5561904b0fecb",
    "orderbook": "f3896d7e7f03057998505b21d283ec0bf4db4b25638aa1e66e1f6b9da2b8c824",
    "program-trading": "7600152a2c4b0a5aba9a61ded7d030c11af3fe43e4f3c430a1d890ff2e689c03",
    "etf": "711d034e8e093ad60d6f104fac29bbfce24460332658d7062762ee1df384aa8d",
    "elw": "4d615d727a47c84430432c77885cb383c556b3f7da345d344d915992b963a18f",
    "sector": "ef390ee6d08d817353be1dda322cbcb099fc9cd9aa866e0ea6a3276e08d551e2",
    "investor-flow": "9d8b114c7965b42316f8d4b5a4c4311c22677f173fd6146190425251023b7d36",
    "broker": "5c39022ba69f96aed48153b926ed18e645f656f2615f4e77630e41dd5aa9328e",
    "discovery": "90e7504da6d7c64a9a7f46b6897d285962a1d8c33d763d4f43613a8df89356d2",
    "credit-lending-short": "1ab49c7de2eef817ec731891f359aeb3484967c1c32df25b032b008273b3975d",
    "stock-info": "139746063090718fb3d445db1835b82281a7955fa6e54e7be9c55dbe48cbc830",
    "watchlist": "17939993c78e1b9c7cf0b657713c232f7ebc0ccb0141e28454c41824d8c079e1",
    "quote": "1cb1e8fd9d74dfcfd19923b99d35095734500b6a0c1087b888d9ac0dc98a1fc5",
    "gold": "b36c953348844b32bc54522f858a88e2175fa3720f61432e26869b2b1650d1e1",
    "theme": "83c2da9dbd3984b692c7eaa14bad745747688a40c9e6e6c42c17681a07822c9e",
    "market-status": "3f5506253f23e9f4d794bfcf4683e31c12274e62c84726bb2ef0cd70da7ae586",
    "condition-search": "9a62c31fdf64b50ee77d4f444542dc6b5318cbff72a621e19a5ac1cf07bcffa1",
}


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def assignment() -> dict:
    return json.loads(ASSIGNMENT_PATH.read_text(encoding="utf-8"))


def _assigned_mapping_ids(assignment: dict) -> list[str]:
    return [
        mapping_id
        for capability in assignment["capabilities"]
        for mapping_id in capability["mapping_ids"]
    ]


def _mapping_digest(mapping_ids: list[str]) -> str:
    payload = "\n".join(sorted(mapping_ids)).encode()
    return hashlib.sha256(payload).hexdigest()


def test_capability_assignment_has_19_capabilities_and_299_unique_operations(
    assignment: dict,
) -> None:
    mapping_ids = _assigned_mapping_ids(assignment)

    assert assignment["assignment_key"] == "mapping_id"
    assert assignment["excluded_categories"] == ["oauth"]
    assert assignment["counts"] == {
        "capabilities": 19,
        "assigned": 299,
        "unassigned": 0,
        "duplicated": 0,
    }
    assert len(assignment["capabilities"]) == 19
    assert len(mapping_ids) == len(set(mapping_ids)) == 299


def test_capability_assignment_matches_the_non_oauth_manifest_exactly_once(
    manifest: dict, assignment: dict
) -> None:
    non_oauth_mappings = [
        mapping
        for mapping in manifest["mappings"]
        if mapping["classification"]["category"] != "oauth"
    ]
    expected = {mapping["mapping_id"] for mapping in non_oauth_mappings}
    assigned = set(_assigned_mapping_ids(assignment))

    assert len(expected) == 299
    assert assigned == expected
    assert sum(mapping["mapping_type"] == "base" for mapping in non_oauth_mappings) == 184
    assert sum(mapping["mapping_type"] == "split_derived" for mapping in non_oauth_mappings) == 115
    assert (
        sum(
            mapping["mapping_type"] == "base"
            and mapping["classification"]["category"] == "read_display"
            for mapping in non_oauth_mappings
        )
        == 149
    )
    assert (
        sum(mapping["classification"]["category"] == "websocket" for mapping in non_oauth_mappings)
        == 23
    )
    assert (
        sum(mapping["classification"]["category"] == "order" for mapping in non_oauth_mappings)
        == 12
    )


def test_capability_operation_counts_are_contract_locked(assignment: dict) -> None:
    actual = {
        capability["capability_id"]: capability["operation_count"]
        for capability in assignment["capabilities"]
    }

    assert actual == EXPECTED_OPERATION_COUNTS
    assert sum(actual.values()) == 299
    assert all(
        capability["operation_count"] == len(capability["mapping_ids"])
        for capability in assignment["capabilities"]
    )


def test_capability_order_and_exact_membership_are_contract_locked(assignment: dict) -> None:
    actual_order = tuple(capability["capability_id"] for capability in assignment["capabilities"])
    actual_digests = {
        capability["capability_id"]: _mapping_digest(capability["mapping_ids"])
        for capability in assignment["capabilities"]
    }

    assert actual_order == EXPECTED_CAPABILITY_ORDER
    assert actual_digests == EXPECTED_MAPPING_DIGESTS


def test_detail_projections_are_assigned_by_full_mapping_id(assignment: dict) -> None:
    detail_mapping_ids = [
        mapping_id
        for mapping_id in _assigned_mapping_ids(assignment)
        if mapping_id.startswith("detail:")
    ]

    assert len(detail_mapping_ids) == 115
    assert all(mapping_id.count(":") == 2 for mapping_id in detail_mapping_ids)
    assert "base:ka10001" not in _assigned_mapping_ids(assignment)
    assert {
        mapping_id for mapping_id in detail_mapping_ids if mapping_id.startswith("detail:ka10001:")
    } == {
        "detail:ka10001:identity_and_capital",
        "detail:ka10001:market_scale_and_ownership",
        "detail:ka10001:price_range",
        "detail:ka10001:valuation",
        "detail:ka10001:financial_performance",
        "detail:ka10001:daily_price_band",
        "detail:ka10001:current_trading",
    }
