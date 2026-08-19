"""Deterministic response-shape profiling for generated Kiwoom contracts."""
from __future__ import annotations

import json
import statistics
from collections.abc import Iterable, Sequence
from typing import Any

SCREEN_BUDGET = 20
LIST_UI_PAGE_SIZE = 10
QUANTILE_METHOD = "Hyndman-Fan type 7"


def distribution(values: Sequence[int | float]) -> dict[str, int | float]:
    """Summarize a population with type-7 quantiles and Tukey 1.5-IQR fences.

    사분위는 stdlib `statistics.quantiles(method="inclusive")` — Hyndman-Fan
    type 7과 동일하다(저장소 테스트 값 [7,15,36,39,40,41] → 20.25/37.5/39.75로
    수치 검증, 2026-08-20 손구현 type7_quantile 대체). 단일값 모집단은 stdlib이
    거부하므로(2점 미만 StatisticsError) 기존 계약대로 그 값 자체를 쓴다.
    """
    if not values:
        raise ValueError("A distribution requires at least one value")
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        q1 = median = q3 = ordered[0]
    else:
        q1, median, q3 = statistics.quantiles(ordered, n=4, method="inclusive")
    iqr = q3 - q1
    return {
        "count": len(values),
        "min": min(values),
        "q1": q1,
        "median": median,
        "q3": q3,
        "max": max(values),
        "iqr": iqr,
        "tukey_lower_fence": q1 - 1.5 * iqr,
        "tukey_upper_fence": q3 + 1.5 * iqr,
    }


def analyze_response_contract(items: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Measure the exact top-level/list-item structure emitted by ``generate_api``."""
    top_level_kinds: list[str] = []
    list_row_widths: list[int] = []
    current_list: int | None = None

    for item in items:
        field_type = item.get("type", "")
        if not field_type:
            continue
        element = str(item.get("element", ""))
        nested = element.lstrip().startswith("-")
        if nested and current_list is not None:
            list_row_widths[current_list] += 1
            continue
        if field_type == "LIST":
            top_level_kinds.append("list")
            list_row_widths.append(0)
            current_list = len(list_row_widths) - 1
        else:
            top_level_kinds.append("scalar")
            current_list = None

    top_level_total = len(top_level_kinds)
    top_level_non_list = top_level_kinds.count("scalar")
    list_sections = len(list_row_widths)
    if list_sections == 0:
        shape = "scalar_only"
    elif top_level_non_list == 0:
        shape = "pure_list"
    else:
        shape = "compound"
    nesting_depth = 2 if list_sections else (1 if top_level_total else 0)
    scalar_leaves = top_level_non_list + sum(list_row_widths)
    screen_complexity = top_level_non_list + sum(
        min(width, SCREEN_BUDGET) for width in list_row_widths
    )
    return {
        "top_level_total_fields": top_level_total,
        "top_level_non_list_fields": top_level_non_list,
        "scalar_leaf_count": scalar_leaves,
        "list_section_count": list_sections,
        "list_row_widths": list_row_widths,
        "max_list_row_width": max(list_row_widths, default=0),
        "nesting_depth": nesting_depth,
        "shape": shape,
        "screen_complexity": screen_complexity,
    }


def build_output_profile(
    operations: Sequence[dict[str, Any]], *, inventory_sha256: str
) -> dict[str, Any]:
    """Build the committed output profile and evidence-based candidate policy."""
    operation_profiles = []
    for operation in sorted(operations, key=lambda entry: entry["id"]):
        metrics = analyze_response_contract(operation.get("resp_body", []))
        operation_profiles.append(
            {
                "id": operation["id"],
                "kind": operation["kind"],
                "domain": operation["domain"],
                **metrics,
            }
        )

    metric_names = (
        "top_level_total_fields",
        "top_level_non_list_fields",
        "scalar_leaf_count",
        "list_section_count",
        "max_list_row_width",
        "nesting_depth",
        "screen_complexity",
    )
    distributions = {
        name: distribution([profile[name] for profile in operation_profiles])
        for name in metric_names
    }
    reference_population = [
        profile
        for profile in operation_profiles
        if profile["kind"] == "query" and profile["top_level_non_list_fields"] > 0
    ]
    non_list_query_distribution = distribution(
        [profile["top_level_non_list_fields"] for profile in reference_population]
    )
    candidates = [
        profile["id"]
        for profile in reference_population
        if profile["shape"] != "pure_list"
        and profile["screen_complexity"] > SCREEN_BUDGET
    ]
    candidate_set = set(candidates)
    for profile in operation_profiles:
        profile["detail_candidate"] = profile["id"] in candidate_set

    shape_counts = {
        shape: sum(profile["shape"] == shape for profile in operation_profiles)
        for shape in ("scalar_only", "pure_list", "compound")
    }
    return {
        "version": 1,
        "source_inventory": {
            "path": "ref/kiwoom-tr-inventory.json",
            "sha256": inventory_sha256,
        },
        "operation_count": len(operation_profiles),
        "shape_counts": shape_counts,
        "policy": {
            "screen_budget": SCREEN_BUDGET,
            "list_ui_page_size": LIST_UI_PAGE_SIZE,
            "pure_lists_never_split": True,
            "screen_complexity_formula": (
                "top_level_non_list_fields + "
                "sum(min(list_row_width, screen_budget) for each list section)"
            ),
            "quantile_method": QUANTILE_METHOD,
            "tukey_fence_multiplier": 1.5,
            "descriptive_reference_population": (
                "domestic HTTP query operations with top_level_non_list_fields > 0"
            ),
            "candidate_rule": (
                "kind == query and shape != pure_list and "
                "screen_complexity > screen_budget"
            ),
            "descriptive_non_list_query_distribution": non_list_query_distribution,
            "detail_candidates": candidates,
        },
        "distributions": distributions,
        "operations": operation_profiles,
    }


def canonical_json(value: Any) -> str:
    """Serialize a generated artifact with stable ordering and a final newline."""
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
