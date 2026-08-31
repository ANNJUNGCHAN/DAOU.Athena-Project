from __future__ import annotations

from scripts.audit_kiwoom_official_spec import (
    FieldIdentity,
    compare_sources,
    current_scope_source_ids,
    main,
    parse_github,
    parse_inventory,
    parse_portal,
)


def _github(*rows: dict) -> dict:
    return {
        "apis": {
            "fixture": {
                "meta": {"API ID": "ka1", "URL": "/api/dostk/chart"},
                "response": {"body": list(rows)},
            }
        }
    }


def _portal(*rows: dict) -> dict:
    return {
        "resp_code": "0",
        "resp_data": [
            {
                "apiId": "ka1",
                "apiInfo": {"apiId": "ka1", "svcTransTp": "REST"},
                "apiTrIo": list(rows),
            }
        ],
    }


def _inventory(*rows: dict) -> list[dict]:
    return [{"id": "ka1", "url": "/api/dostk/chart", "resp_body": list(rows)}]


def _report(inventory: dict, github: dict, portal: dict) -> dict:
    return compare_sources(
        inventory=inventory,
        github=github,
        portal=portal,
        scope_ids={"ka1"},
        scope_route_count=1,
        fetched_at="2026-08-31T00:00:00+00:00",
        inventory_hash="a" * 64,
        github_hash="b" * 64,
        portal_hash="c" * 64,
        github_commit="deadbeef",
    )


def test_parsers_preserve_exact_nested_response_identity_and_order() -> None:
    inventory = parse_inventory(
        _inventory(
            {"element": "rows", "type": "LIST"},
            {"element": "- price", "type": "String"},
            {"element": "- values", "type": "LIST"},
            {"element": "- - 10", "type": "String"},
        )
    )
    github = parse_github(
        _github(
            {"element": "rows", "depth": 0, "type": "LIST"},
            {"element": "price", "depth": 1, "type": "String"},
            {"element": "values", "depth": 1, "type": "LIST"},
            {"element": "10", "depth": 2, "type": "String"},
        )
    )
    portal = parse_portal(
        _portal(
            {"itemId": "rows", "itemType": "R", "inptOutputTp": "O", "headBodyTp": "B"},
            {"itemId": "- price", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"},
            {"itemId": "- values", "itemType": "R", "inptOutputTp": "O", "headBodyTp": "B"},
            {"itemId": "- - 10", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"},
        )
    )

    expected = ["rows", "rows/price", "rows/values", "rows/values/10"]
    for source in (inventory, github, portal):
        assert ["/".join(field.path) for field in source["ka1"].fields] == expected


def test_comparison_reports_order_divergence_without_field_drift() -> None:
    inventory = parse_inventory(
        _inventory(
            {"element": "first", "type": "String"},
            {"element": "second", "type": "String"},
        )
    )
    github = parse_github(
        _github(
            {"element": "first", "depth": 0, "type": "String"},
            {"element": "second", "depth": 0, "type": "String"},
        )
    )
    portal = parse_portal(
        _portal(
            {"itemId": "second", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"},
            {"itemId": "first", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"},
        )
    )

    report = _report(inventory, github, portal)

    assert report["current_299"]["has_field_drift"] is False
    assert report["official_source_divergences"][0]["order_changed"] is True


def test_comparison_uses_official_union_and_reports_additions_and_removals() -> None:
    inventory = parse_inventory(
        _inventory(
            {"element": "kept", "type": "String"},
            {"element": "removed", "type": "String"},
        )
    )
    github = parse_github(_github({"element": "kept", "depth": 0, "type": "String"}))
    portal = parse_portal(
        _portal(
            {"itemId": "kept", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"},
            {"itemId": "added", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"},
        )
    )

    report = _report(inventory, github, portal)

    assert report["current_299"] == {
        "official_field_additions": ["http:ka1:response:added"],
        "official_field_removals": ["http:ka1:response:removed"],
        "has_field_drift": True,
    }


def test_unrelated_vendor_api_does_not_change_current_scope_check() -> None:
    baseline = parse_inventory(_inventory({"element": "kept", "type": "String"}))
    github = parse_github(_github({"element": "kept", "depth": 0, "type": "String"}))
    portal_payload = _portal(
        {"itemId": "kept", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"}
    )
    portal_payload["resp_data"].append(
        {
            "apiId": "vendor-new",
            "apiInfo": {"apiId": "vendor-new", "svcTransTp": "REST"},
            "apiTrIo": [{"itemId": "new", "itemType": "F", "inptOutputTp": "O", "headBodyTp": "B"}],
        }
    )

    report = _report(baseline, github, parse_portal(portal_payload))

    assert report["portal_only_api_ids"] == ["vendor-new"]
    assert report["current_299"]["has_field_drift"] is False


def test_scope_collapses_299_mapping_ids_to_exact_source_api_ids() -> None:
    assignment = {
        "counts": {"assigned": 3},
        "capabilities": [
            {
                "mapping_ids": [
                    "base:ka1",
                    "detail:ka2:summary",
                    "detail:ka2:rows",
                ]
            }
        ],
    }

    assert current_scope_source_ids(assignment) == {"ka1", "ka2"}


def test_duplicate_paths_receive_stable_occurrence_identity() -> None:
    parsed = parse_inventory(
        _inventory(
            {"element": "same", "type": "String"},
            {"element": "same", "type": "String"},
        )
    )

    assert parsed["ka1"].fields == (
        FieldIdentity("http", "ka1", "response", ("same",), 1),
        FieldIdentity("http", "ka1", "response", ("same",), 2),
    )


def test_main_returns_nonzero_and_explicit_json_on_network_error(monkeypatch, capsys) -> None:
    def fail(**_kwargs):
        raise OSError("offline")

    monkeypatch.setattr("scripts.audit_kiwoom_official_spec.run_audit", fail)

    assert main([]) == 2
    assert '"error": "OSError"' in capsys.readouterr().err


def test_check_exit_status_depends_only_on_current_scope_field_drift(monkeypatch, capsys) -> None:
    report = {
        "portal_only_api_ids": ["unrelated-new-api"],
        "current_299": {"has_field_drift": False},
    }
    monkeypatch.setattr("scripts.audit_kiwoom_official_spec.run_audit", lambda **_kwargs: report)
    assert main(["--check"]) == 0

    report["current_299"]["has_field_drift"] = True
    assert main(["--check"]) == 1
    capsys.readouterr()
