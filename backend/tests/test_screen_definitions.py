from __future__ import annotations

import json
from collections import Counter
from copy import deepcopy
from pathlib import Path

import pytest

import scripts.generate_api as generate_api
from scripts.generate_api import AITS_CHART_RENDERER_ID, DISPLAY_EXCLUDED_ALIASES

BACKEND = Path(__file__).resolve().parents[1]
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
SCREEN_DEFINITIONS_PATH = BACKEND / "ref" / "kiwoom-screen-definitions.json"

EXPECTED_CATEGORIES = {"read_display": 264, "websocket": 23, "order": 12, "oauth": 2}
EXPECTED_CASES = {"F1", "F2", "T1", "T2", "T3", "T4", "C1", "C2", "E1", "E2", "E3", "A1", "S1"}
REQUIRED_DISPLAY_STATES = {"loading", "empty", "partial", "stale", "timeout", "error"}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_screen_definitions_cover_every_mapping_once_without_orphans() -> None:
    manifest = _load(MANIFEST_PATH)
    screens = _load(SCREEN_DEFINITIONS_PATH)
    definitions = screens["definitions"]
    templates = screens["templates"]

    assert screens["counts"] == {
        "templates": 13,
        "definitions": 301,
        "categories": EXPECTED_CATEGORIES,
    }
    assert Counter(definition["category"] for definition in definitions) == EXPECTED_CATEGORIES
    assert {template["template_case_id"] for template in templates} == EXPECTED_CASES
    assert len({template["screen_id"] for template in templates}) == 13
    assert {definition["mapping_id"] for definition in definitions} == {
        mapping["mapping_id"] for mapping in manifest["mappings"]
    }
    assert len({definition["definition_id"] for definition in definitions}) == 301
    assert {definition["screen_id"] for definition in definitions} == {
        template["screen_id"] for template in templates
    }


def test_every_definition_is_manifest_owned_and_has_no_free_fallback() -> None:
    manifest = _load(MANIFEST_PATH)
    screens = _load(SCREEN_DEFINITIONS_PATH)
    manifest_by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}

    assert screens["policy"]["decision_path"] == (
        "operation_ref -> manifest presentation -> screen definition"
    )
    assert screens["policy"]["no_runtime_shape_or_field_heuristics"] is True
    assert screens["policy"]["generic_or_free_fallback"] is False
    assert screens["policy"]["missing_contract"] == "fail_closed"

    for definition in screens["definitions"]:
        mapping = manifest_by_id[definition["mapping_id"]]
        assert definition["operation_ref"] == mapping["mapping_id"]
        assert definition["screen_id"] == mapping["screen_reference"]["screen_id"]
        assert definition["template_case_id"] == mapping["screen_reference"]["template_case_id"]
        assert definition["presentation"]["layout"] == mapping["presentation"]["layout"]
        assert definition["presentation"]["shape"] == mapping["presentation"]["shape"]
        assert definition["failure_behavior"] == "coverage_error_no_generic_or_free_fallback"
        assert REQUIRED_DISPLAY_STATES <= set(definition["states"])
        assert len(definition["states"]) == len(set(definition["states"]))
        assert 0 <= len(definition["follow_up_allowlist"]) <= 3
        assert definition["title"]
        assert definition["accessibility"]["screen_reader_label"] == definition["title"]


def test_all_264_read_contracts_have_exact_fields_time_sort_range_and_presentation() -> None:
    manifest = _load(MANIFEST_PATH)
    screens = _load(SCREEN_DEFINITIONS_PATH)
    manifest_by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}
    reads = [
        definition
        for definition in screens["definitions"]
        if definition["category"] == "read_display"
    ]
    assert len(reads) == 264

    for definition in reads:
        mapping = manifest_by_id[definition["mapping_id"]]
        response = mapping["fields"]["response"]
        container_aliases = {container["container_alias"] for container in response["data"]}
        expected_scalars = [
            alias
            for alias in response["top_level"]
            if alias not in container_aliases and alias not in DISPLAY_EXCLUDED_ALIASES
        ]
        data = definition["data"]
        assert definition["workflow"] is None
        assert data["scalar_field_allowlist"] == expected_scalars
        assert data["unexpected_field"] == "drop_and_record_contract_error"
        assert set(data["time"]) == {"basis", "field_path", "timezone", "invalid_or_missing"}
        assert set(data["sort"]) == {"keys", "direction", "tie_breaker"}
        assert set(data["range"]) == {"mode", "default_rows", "max_rows", "continuation"}
        assert data["range"]["default_rows"] <= data["range"]["max_rows"]
        assert definition["presentation"]["component_slots"]
        for field in data["scalar_fields"]:
            assert field["alias"] in expected_scalars
            assert field["label"] and field["formatter"] and field["path"].startswith("$.")
        for source_container, contract_container in zip(
            response["data"], data["containers"], strict=True
        ):
            expected_fields = [
                alias
                for alias in source_container["field_aliases"]
                if alias not in DISPLAY_EXCLUDED_ALIASES
            ]
            assert contract_container["field_allowlist"] == expected_fields
            assert set(contract_container["column_priority"]) == set(expected_fields)
            assert all(
                field["label"] and field["formatter"]
                for field in contract_container["fields"]
            )


def test_aits_chart_contract_is_the_only_chart_routing_authority() -> None:
    manifest = _load(MANIFEST_PATH)
    screens = _load(SCREEN_DEFINITIONS_PATH)
    manifest_by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}
    definitions = {definition["mapping_id"]: definition for definition in screens["definitions"]}
    chart_ids = {
        mapping_id
        for mapping_id, mapping in manifest_by_id.items()
        if mapping["presentation"].get("renderer_id") == AITS_CHART_RENDERER_ID
    }
    assert chart_ids == {
        *(f"base:ka100{suffix:02d}" for suffix in (79, 80, 81, 82, 83, 94)),
        *(f"base:ka200{suffix:02d}" for suffix in (4, 5, 6, 7, 8, 19)),
        *(f"base:ka500{suffix:02d}" for suffix in (79, 80, 81, 82, 83, 91, 92)),
    }
    assert len(chart_ids) == 19

    periods_by_target: dict[str, set[str]] = {}
    reload_keys: set[tuple[str, str, str]] = set()
    for mapping_id, definition in definitions.items():
        mapping_renderer = manifest_by_id[mapping_id]["presentation"].get("renderer_id")
        renderer = definition["presentation"].get("renderer_id")
        chart = (definition.get("data") or {}).get("chart")
        assert renderer == mapping_renderer
        if mapping_id in chart_ids:
            assert renderer == AITS_CHART_RENDERER_ID
            assert chart["trId"] == mapping_id.removeprefix("base:")
            assert chart["period"] in {"tick", "min", "day", "week", "month", "year"}
            assert chart["target"] in {"stock", "sector", "gold"}
            assert chart["series_scope"] in {"standard", "generic", "today"}
            reload_key = (chart["target"], chart["reload_group"], chart["period"])
            assert reload_key not in reload_keys
            reload_keys.add(reload_key)
            assert set(chart["ohlcv"]) == {"open", "high", "low", "close", "volume"}
            assert chart["reload_targets"][chart["period"]]["operation_ref"] == mapping_id
            for period, reload_target in chart["reload_targets"].items():
                target_definition = definitions[reload_target["operation_ref"]]
                target_chart = target_definition["data"]["chart"]
                assert target_chart["target"] == chart["target"]
                assert target_chart["reload_group"] == chart["reload_group"]
                assert target_chart["period"] == period
                assert reload_target["request_fields"] == target_definition["input"][
                    "field_allowlist"
                ]["top_level"]
            periods_by_target.setdefault(chart["target"], set()).add(chart["period"])
        else:
            assert renderer is None
            assert chart is None

    assert periods_by_target["stock"] == {"tick", "min", "day", "week", "month", "year"}
    assert periods_by_target["sector"] == {"tick", "min", "day", "week", "month", "year"}
    # The reviewed Kiwoom inventory exposes no gold yearly chart operation.
    assert periods_by_target["gold"] == {"tick", "min", "day", "week", "month"}

    # These names/domains contain chart-like wording but are table-only participant data.
    for mapping_id in ("base:ka10060", "base:ka10064"):
        assert manifest_by_id[mapping_id]["presentation"]["renderer_id"] is None
        assert definitions[mapping_id]["data"]["chart"] is None

    assert definitions["base:ka50079"]["data"]["chart"]["reload_group"] == "gold-generic"
    assert definitions["base:ka50091"]["data"]["chart"]["reload_group"] == "gold-today"


def test_generator_rejects_ambiguous_target_reload_group_period(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _load(BACKEND / "ref" / "aits-chart-contracts.json")
    corrupted = deepcopy(source)
    today_tick = next(
        row for row in corrupted["contracts"] if row["tr_id"] == "ka50091"
    )
    today_tick["series_scope"] = "generic"
    today_tick["reload_group"] = "gold-generic"
    path = tmp_path / "aits-chart-contracts.json"
    path.write_text(json.dumps(corrupted), encoding="utf-8")
    monkeypatch.setattr(generate_api, "AITS_CHART_CONTRACTS_PATH", path)
    operations, _ = generate_api.classify(generate_api.load_inventory())
    with pytest.raises(ValueError, match="Ambiguous AITS chart reload target"):
        generate_api.load_aits_chart_contracts(operations)


def test_guarded_workflows_use_lifecycle_screens_not_read_cards() -> None:
    screens = _load(SCREEN_DEFINITIONS_PATH)
    expected = {
        "websocket": (23, "EventCard", "websocket_lifecycle"),
        "order": (12, "ActionCard", "guarded_order"),
        "oauth": (2, "StatusCard", "oauth_lifecycle"),
    }
    for category, (count, card, workflow_name) in expected.items():
        definitions = [
            definition
            for definition in screens["definitions"]
            if definition["category"] == category
        ]
        assert len(definitions) == count
        for definition in definitions:
            assert definition["data"] is None
            assert definition["presentation"]["card"] == card
            assert definition["workflow"]["workflow"] == workflow_name
            assert definition["workflow"]["lifecycle"]
            assert definition["workflow"]["failure_behavior"] == (
                "fail_closed_no_read_card_fallback"
            )


def test_follow_ups_are_safe_catalog_backed_and_representative_cases_are_populated() -> None:
    screens = _load(SCREEN_DEFINITIONS_PATH)
    definitions = {
        definition["mapping_id"]: definition for definition in screens["definitions"]
    }
    mapping_ids = set(definitions)

    for definition in definitions.values():
        follow_ups = definition["follow_up_allowlist"]
        coverage = definition["follow_up_coverage"]
        assert 0 <= len(follow_ups) <= 3
        assert coverage["reason"]
        assert coverage["status"] == ("available" if follow_ups else "intentionally_empty")
        for follow_up in follow_ups:
            assert follow_up["target_operation_ref"] in mapping_ids
            target = definitions[follow_up["target_operation_ref"]]
            assert target["operation_ref"].split(":")[1] == follow_up["allowed_operation_family"]
            assert follow_up["label"] and follow_up["precondition"]

    current_price = definitions["detail:ka10001:current_trading"]
    assert current_price["follow_up_allowlist"]
    assert all(
        follow_up["target_intent"] == "detail_group_switch"
        for follow_up in current_price["follow_up_allowlist"]
    )

    chart = definitions["base:ka10081"]
    assert {follow_up["target_intent"] for follow_up in chart["follow_up_allowlist"]} == {
        "chart_period_change",
        "previous_period",
        "next_page",
    }

    table = definitions["base:ka10095"]
    assert "next_page" in {
        follow_up["target_intent"] for follow_up in table["follow_up_allowlist"]
    }

    websocket = definitions["base:0B"]
    assert [follow_up["target_intent"] for follow_up in websocket["follow_up_allowlist"]] == [
        "stop_subscription"
    ]
    assert websocket["follow_up_allowlist"][0]["precondition"] == (
        "active_subscription_matches_operation"
    )

    assert definitions["base:kt10000"]["follow_up_allowlist"] == []
    assert definitions["base:kt10000"]["follow_up_coverage"] == {
        "status": "intentionally_empty",
        "reason": "guarded_order_follow_ups_prohibited",
    }
    assert definitions["base:au10001"]["follow_up_allowlist"] == []


def test_split_original_exclusions_keep_provenance() -> None:
    exclusions = _load(MANIFEST_PATH)["exclusions"]
    assert len(exclusions) == 22
    for exclusion in exclusions:
        assert set(exclusion["provenance"]) == {
            "inventory",
            "response_projection",
            "decision",
        }
        assert exclusion["provenance"]["inventory"]["operation_id"] == exclusion["tr_id"]
        assert exclusion["provenance"]["response_projection"]["tr_id"] == exclusion["tr_id"]
