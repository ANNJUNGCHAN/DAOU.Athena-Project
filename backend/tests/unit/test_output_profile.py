from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from athena_api.output_profile import (
    SCREEN_BUDGET,
    analyze_response_contract,
    build_output_profile,
    canonical_json,
    distribution,
    type7_quantile,
)
from scripts.generate_api import classify

BACKEND = Path(__file__).resolve().parents[2]
INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"
OUTPUT_PROFILE_PATH = BACKEND / "ref" / "kiwoom-output-profile.json"

EXPECTED_CANDIDATES = [
    "ka10001",
    "ka10002",
    "ka10004",
    "ka10007",
    "ka10040",
    "ka10087",
    "ka20001",
    "ka20009",
    "ka30012",
    "kt00001",
    "kt00004",
    "kt00005",
    "kt00009",
    "kt00010",
    "kt00011",
    "kt00012",
    "kt00013",
    "kt00016",
    "kt00017",
    "kt00018",
    "kt50020",
    "kt50032",
]


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _inventory_sha256() -> str:
    return hashlib.sha256(INVENTORY_PATH.read_bytes()).hexdigest()


def test_type7_quantile_interpolates_the_hyndman_fan_type_7_position() -> None:
    values = [7, 15, 36, 39, 40, 41]

    assert type7_quantile(values, 0.25) == pytest.approx(20.25)
    assert type7_quantile(values, 0.5) == pytest.approx(37.5)
    assert type7_quantile(values, 0.75) == pytest.approx(39.75)


def test_distribution_reports_type7_quantiles_and_tukey_fences() -> None:
    summary = distribution([1, 2, 3, 4, 100])

    assert summary == {
        "count": 5,
        "min": 1,
        "q1": 2.0,
        "median": 3.0,
        "q3": 4.0,
        "max": 100,
        "iqr": 2.0,
        "tukey_lower_fence": -1.0,
        "tukey_upper_fence": 7.0,
    }


def test_response_contract_metrics_apply_the_screen_budget_to_each_list() -> None:
    response_rows = [
        {"element": "summary", "type": "String"},
        {"element": "first", "type": "LIST"},
        *(
            {"element": f"- first_{index}", "type": "String"}
            for index in range(25)
        ),
        {"element": "second", "type": "LIST"},
        *(
            {"element": f"- second_{index}", "type": "String"}
            for index in range(3)
        ),
    ]

    assert analyze_response_contract(response_rows) == {
        "top_level_total_fields": 3,
        "top_level_non_list_fields": 1,
        "scalar_leaf_count": 29,
        "list_section_count": 2,
        "list_row_widths": [25, 3],
        "max_list_row_width": 25,
        "nesting_depth": 2,
        "shape": "compound",
        "screen_complexity": 1 + SCREEN_BUDGET + 3,
    }


def test_profile_generation_is_independent_of_operation_input_order() -> None:
    operations = [
        {
            "id": "z_query",
            "kind": "query",
            "domain": "quotes",
            "resp_body": [{"element": "value", "type": "String"}],
        },
        {
            "id": "a_query",
            "kind": "query",
            "domain": "quotes",
            "resp_body": [{"element": "rows", "type": "LIST"}],
        },
    ]

    forward = build_output_profile(operations, inventory_sha256="synthetic")
    reverse = build_output_profile(list(reversed(operations)), inventory_sha256="synthetic")

    assert forward == reverse
    assert [operation["id"] for operation in forward["operations"]] == [
        "a_query",
        "z_query",
    ]


def test_checked_in_profile_has_exact_inventory_ids_and_shape_counts() -> None:
    inventory = _json(INVENTORY_PATH)
    profile = _json(OUTPUT_PROFILE_PATH)

    inventory_ids = sorted(operation["id"] for operation in inventory)
    profile_ids = [operation["id"] for operation in profile["operations"]]
    assert len(profile_ids) == len(set(profile_ids)) == 208
    assert profile_ids == inventory_ids
    assert profile["shape_counts"] == {
        "scalar_only": 36,
        "pure_list": 111,
        "compound": 61,
    }


def test_wide_pure_list_ka10095_is_not_a_detail_candidate() -> None:
    profile = _json(OUTPUT_PROFILE_PATH)
    operation = next(
        operation for operation in profile["operations"] if operation["id"] == "ka10095"
    )

    assert operation["shape"] == "pure_list"
    assert operation["max_list_row_width"] == 63
    assert operation["screen_complexity"] == SCREEN_BUDGET
    assert operation["detail_candidate"] is False
    assert operation["id"] not in profile["policy"]["detail_candidates"]


def test_detail_candidates_exactly_follow_the_query_non_pure_over_budget_rule() -> None:
    profile = _json(OUTPUT_PROFILE_PATH)
    candidates_from_predicate = [
        operation["id"]
        for operation in profile["operations"]
        if operation["kind"] == "query"
        and operation["shape"] != "pure_list"
        and operation["screen_complexity"] > SCREEN_BUDGET
    ]

    assert candidates_from_predicate == EXPECTED_CANDIDATES
    assert profile["policy"]["detail_candidates"] == EXPECTED_CANDIDATES
    assert sum(
        operation["detail_candidate"] for operation in profile["operations"]
    ) == 22


def test_checked_in_profile_is_the_canonical_inventory_recomputation() -> None:
    inventory = _json(INVENTORY_PATH)
    operations, _ = classify(inventory)
    expected = build_output_profile(operations, inventory_sha256=_inventory_sha256())

    assert OUTPUT_PROFILE_PATH.read_text(encoding="utf-8") == canonical_json(expected)
