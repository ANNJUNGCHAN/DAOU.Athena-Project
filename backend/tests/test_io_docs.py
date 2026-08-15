from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.generated.registry import (
    DETAIL_REGISTRY,
    INVENTORY_COUNTS,
    RESPONSE_PROJECTION_MANIFEST,
    TR_REGISTRY,
)
from athena_api.main import create_app

BACKEND = Path(__file__).resolve().parents[1]
INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"
PROFILE_PATH = BACKEND / "ref" / "kiwoom-io-source-profile.json"
DETAIL_PATH = BACKEND / "ref" / "ka10007-detail-groups.json"
OUTPUT_PROFILE_PATH = BACKEND / "ref" / "kiwoom-output-profile.json"
PROJECTION_PATH = BACKEND / "ref" / "response-projections.json"
DOC_PATH = BACKEND / "docs" / "KIWOOM_API_IO.md"
GENERATOR_PATH = BACKEND / "scripts" / "generate_api.py"
OPERATION_MARKER = re.compile(
    r"^<!-- io-operation id=(?P<tr_id>\S+) request-rows=(?P<request_rows>\d+) "
    r"response-rows=(?P<response_rows>\d+) -->$",
    re.MULTILINE,
)


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _top_level_response_aliases(operation: dict) -> list[str]:
    aliases: list[str] = []
    for item in operation.get("resp_body", []):
        if not item.get("type"):
            continue
        element = str(item.get("element", ""))
        if element.lstrip().startswith("-"):
            continue
        aliases.append(element.lstrip("- ").strip())
    return aliases


def test_io_reference_exact_inventory_coverage_and_field_counts() -> None:
    inventory = _json(INVENTORY_PATH)
    profile = _json(PROFILE_PATH)["source_inventory"]
    document = DOC_PATH.read_text(encoding="utf-8")
    markers = list(OPERATION_MARKER.finditer(document))

    inventory_ids = [item["id"] for item in sorted(inventory, key=lambda item: item["id"])]
    marker_ids = [marker["tr_id"] for marker in markers]
    assert len(inventory_ids) == len(set(inventory_ids)) == 208
    assert marker_ids == inventory_ids
    assert marker_ids == sorted(TR_REGISTRY)
    assert INVENTORY_COUNTS == {"oauth": 2, "query": 171, "order": 12, "websocket": 23}

    expected_counts = {
        item["id"]: (len(item["req_body"]), len(item["resp_body"])) for item in inventory
    }
    documented_counts = {
        marker["tr_id"]: (int(marker["request_rows"]), int(marker["response_rows"]))
        for marker in markers
    }
    assert documented_counts == expected_counts

    rendered_counts: dict[str, tuple[int, int]] = {}
    for index, marker in enumerate(markers):
        end = markers[index + 1].start() if index + 1 < len(markers) else len(document)
        section = document[marker.end() : end]
        request_text, response_text = section.split("#### Response fields", maxsplit=1)
        request_count = len(re.findall(r"^\| \d+ \|", request_text, re.MULTILINE))
        response_count = len(re.findall(r"^\| \d+ \|", response_text, re.MULTILINE))
        rendered_counts[marker["tr_id"]] = (request_count, response_count)
    assert rendered_counts == expected_counts

    assert sum(value[0] for value in documented_counts.values()) == 767
    assert sum(value[1] for value in documented_counts.values()) == 3710
    assert sum(sum(value) for value in documented_counts.values()) == 4477
    assert profile["request_field_rows"] == 767
    assert profile["response_field_rows"] == 3710
    assert profile["field_rows"] == 4477


def test_io_reference_source_hash_and_ka10007_detail_completeness() -> None:
    profile = _json(PROFILE_PATH)
    detail = _json(DETAIL_PATH)
    document = DOC_PATH.read_text(encoding="utf-8")

    digest = hashlib.sha256(INVENTORY_PATH.read_bytes()).hexdigest()
    assert digest == "318d081c7cac23e3fa290e3b885308bc42a28c6f84f7c74cad3c3103e80ff63b"
    assert profile["source_inventory"]["sha256"] == digest
    assert len(detail["groups"]) == profile["ka10007_detail_manifest"]["group_count"] == 9
    fields = [field for group in detail["groups"] for field in group["fields"]]
    assert len(fields) == len(set(fields)) == 124
    assert profile["ka10007_detail_manifest"]["field_count"] == 124
    for group in detail["groups"]:
        route = f"/api/v1/tr/quotes/ka10007/detail/{group['id']}"
        assert document.count(f"| `{group['id']}` | `{route}` |") == 1


def test_projection_manifest_candidates_exactly_match_output_profile() -> None:
    profile = _json(OUTPUT_PROFILE_PATH)
    manifest = _json(PROJECTION_PATH)

    manifest_ids = [projection["tr_id"] for projection in manifest["projections"]]
    assert manifest_ids == profile["policy"]["detail_candidates"]
    assert len(manifest_ids) == len(set(manifest_ids)) == 22


def test_generated_projection_registry_is_the_canonical_manifest() -> None:
    assert RESPONSE_PROJECTION_MANIFEST == _json(PROJECTION_PATH)


def test_generated_selector_metadata_is_exact_and_immutable() -> None:
    inventory = _json(INVENTORY_PATH)
    inventory_by_id = {operation["id"]: operation for operation in inventory}
    manifest = _json(PROJECTION_PATH)

    assert len(TR_REGISTRY) == 208
    for tr_id, spec in TR_REGISTRY.items():
        source = inventory_by_id[tr_id]
        assert spec.category == source["cat"]
        assert spec.subcategory == source["subcat"]
        assert spec.overview == source.get("overview", "")
        assert spec.__dataclass_params__.frozen is True

    expected_keys = {
        f"detail:{projection['tr_id']}:{group['id']}"
        for projection in manifest["projections"]
        for group in projection["groups"]
    }
    assert set(DETAIL_REGISTRY) == expected_keys
    assert len(DETAIL_REGISTRY) == 115

    for projection in manifest["projections"]:
        tr_id = projection["tr_id"]
        for group in projection["groups"]:
            detail_id = f"detail:{tr_id}:{group['id']}"
            detail = DETAIL_REGISTRY[detail_id]
            assert detail.operation_ref == detail_id
            assert detail.tr_id == tr_id
            assert detail.group_id == group["id"]
            assert detail.title_ko == (
                group.get("title_ko") or group.get("title") or group["id"]
            )
            assert detail.title_en == (
                group.get("title_en") or group.get("title") or group["id"]
            )
            assert detail.layout == group.get("layout", "facts")
            assert detail.ui_page_size == group.get("ui_page_size")
            assert detail.fields == tuple(group["fields"])
            assert tuple(
                field.alias or field_name
                for field_name, field in detail.response_model.model_fields.items()
            ) == detail.fields
            assert detail.__dataclass_params__.frozen is True


def test_generated_projection_routes_exactly_match_the_manifest() -> None:
    manifest = _json(PROJECTION_PATH)
    schema = create_app(Settings(_env_file=None)).openapi()
    expected = {
        (
            f"/api/v1/tr/{TR_REGISTRY[projection['tr_id']].domain}/"
            f"{projection['tr_id']}/detail/{group['id']}",
            projection["tr_id"],
            group["id"],
        )
        for projection in manifest["projections"]
        for group in projection["groups"]
    }
    actual = {
        (
            path,
            operation["x-kiwoom-tr-id"],
            operation["x-athena-detail-group"],
        )
        for path, path_item in schema["paths"].items()
        for method, operation in path_item.items()
        if method in {"get", "post"} and "x-athena-detail-group" in operation
    }

    assert actual == expected


def test_projection_groups_cover_each_top_level_alias_once_within_layout_budget() -> None:
    inventory_by_id = {
        operation["id"]: operation for operation in _json(INVENTORY_PATH)
    }
    manifest = _json(PROJECTION_PATH)

    for projection in manifest["projections"]:
        source_aliases = _top_level_response_aliases(
            inventory_by_id[projection["tr_id"]]
        )
        projected_aliases = [
            alias for group in projection["groups"] for alias in group["fields"]
        ]
        assert len(projected_aliases) == len(set(projected_aliases))
        assert set(projected_aliases) == set(source_aliases)
        for group in projection["groups"]:
            assert group["fields"] == [
                alias for alias in source_aliases if alias in group["fields"]
            ]
            layout = group.get("layout", "facts")
            if layout == "facts":
                assert len(group["fields"]) <= 20
                assert "ui_page_size" not in group
            else:
                assert layout == "table"
                assert len(group["fields"]) == 1
                assert group["fields"][0] in {
                    item["element"].lstrip("- ").strip()
                    for item in inventory_by_id[projection["tr_id"]]["resp_body"]
                    if item.get("type") == "LIST"
                    and not str(item.get("element", "")).lstrip().startswith("-")
                }
                assert group["ui_page_size"] == 10


def test_io_reference_documents_projection_policy_and_every_generated_route() -> None:
    document = DOC_PATH.read_text(encoding="utf-8")
    manifest = _json(PROJECTION_PATH)

    required_policy_text = [
        "Hyndman-Fan type 7",
        "Tukey",
        "screen_complexity",
        "one-screen",
        "20",
        "Pure lists",
        "never field-split",
        "10 rows",
    ]
    for value in required_policy_text:
        assert value in document
    for projection in manifest["projections"]:
        domain = TR_REGISTRY[projection["tr_id"]].domain
        for group in projection["groups"]:
            route = (
                f"/api/v1/tr/{domain}/{projection['tr_id']}"
                f"/detail/{group['id']}"
            )
            assert document.count(f"`{route}`") == 1


def test_io_reference_contains_required_contract_and_audit_notes() -> None:
    document = DOC_PATH.read_text(encoding="utf-8")
    audit = _json(PROFILE_PATH)["official_github_audit"]
    required_text = [
        "/docs",
        "/openapi.json",
        "/api/v1/catalog",
        "LOGIN",
        "REG",
        "REMOVE",
        "REAL",
        "POST /api/v1/batch",
        "OAuth, REST, and WSS all canonicalize integer and numeric-string return codes",
        "`0000` becomes `0`",
        "`01700` becomes `1700`",
        "negative signs are preserved",
        "Booleans are not treated as numeric codes",
        "missing or blank return codes are not success",
        "upstream AITS-compatible wire",
        "`api-id: au10001`",
        "`grant_type`",
        "`api-id: au10002`",
        "official GitHub helper uses identical OAuth headers",
        "caller's exact `grp_no` and `refresh`",
        "stores that exact adapted frame and restores it unchanged after reconnect",
        "source-faithful to the AITS live probe",
        "bare six-digit stock item is",
        "encoded upstream with `_AL`",
        "existing `_AL` or `_NX` suffix and every non-stock item remain",
        "six digits plus `_AL` or `_NX` normalize back",
        "KRX/NXT/SOR",
        "official samples' array shape",
        "must not be treated as a general exchange-selection rule",
        "0G` and `0g",
        "0U` and `0u",
        "337",
        "129",
        "37 error codes",
        "200 IDs",
        "ka10095",
        "69642586f7d84ba9fd8a6faf1f1537c7fda6568b",
        "all-rights-reserved",
        "Domestic Korea only",
        "exactly the 208 checked-in",
        "domestic/OAuth operations",
        "U.S. operations are intentional non-goals",
        "must not enter generated routes, the catalog, or operation reference sections",
    ]
    for value in required_text:
        assert value in document
    delta_ids = [
        "ka10001",
        "ka10005",
        "ka10099",
        "ka10101",
        "ka10173",
        "ka90009",
        "kt00001",
        "0D",
    ]
    for tr_id in delta_ids:
        assert f"`{tr_id}`" in document
    assert audit["operation_count"] == 337
    assert audit["http_operation_count"] == 306
    assert audit["websocket_operation_count"] == 31
    assert audit["us_only_operation_count"] == 129
    assert audit["us_only_http_operation_count"] == 121
    assert audit["us_only_websocket_ids"] == [
        "usa20280",
        "usa20281",
        "usa20290",
        "usa20291",
        "F4",
        "F5",
        "FE",
        "FT",
    ]
    assert audit["shared_body_exact_count"] == 200
    assert audit["typed_error_count"] == 31
    assert len(audit["generic_error_codes"]) == 6


def test_official_us_only_ids_never_enter_athena_surfaces() -> None:
    inventory = _json(INVENTORY_PATH)
    audit = _json(PROFILE_PATH)["official_github_audit"]
    document = DOC_PATH.read_text(encoding="utf-8")
    us_only_ids = set(audit["us_only_operation_ids"])
    projection_ids = {
        projection["tr_id"] for projection in _json(PROJECTION_PATH)["projections"]
    }

    assert len(us_only_ids) == audit["us_only_operation_count"] == 129
    assert not us_only_ids.intersection(item["id"] for item in inventory)
    assert not us_only_ids.intersection(TR_REGISTRY)
    assert projection_ids.issubset(item["id"] for item in inventory)
    assert not us_only_ids.intersection(projection_ids)

    app = create_app(Settings(_env_file=None))
    schema = app.openapi()
    openapi_ids = {
        operation["x-kiwoom-tr-id"]
        for path_item in schema["paths"].values()
        for method, operation in path_item.items()
        if method in {"get", "post"} and "x-kiwoom-tr-id" in operation
    }
    catalog = TestClient(app).get("/api/v1/catalog").json()
    catalog_ids = {operation["tr_id"] for operation in catalog["operations"]}
    assert not us_only_ids.intersection(openapi_ids)
    assert not us_only_ids.intersection(catalog_ids)
    for tr_id in us_only_ids:
        assert f"<!-- io-operation id={tr_id} " not in document
        assert f"### `{tr_id}` —" not in document
    distinct_pairs = [["0G", "0g"], ["0U", "0u"]]
    assert audit["case_sensitive_distinct_pairs"] == distinct_pairs
    assert audit["official_guide_catalog_detail_conflict_pairs"] == distinct_pairs
    assert "repository's per-ID mappings agree with Athena" in document
    assert "catalog/listing conflicts with its per-ID detail and repository mappings" in document
    assert "conflict by case and semantics" not in document


def test_io_generator_check_and_determinism() -> None:
    tracked = [
        *sorted((BACKEND / "athena_api" / "generated").glob("*.py")),
        DOC_PATH,
        OUTPUT_PROFILE_PATH,
        PROJECTION_PATH,
    ]

    def hashes() -> dict[str, str]:
        return {
            str(path.relative_to(BACKEND)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in tracked
        }

    before = hashes()
    subprocess.run([sys.executable, str(GENERATOR_PATH)], cwd=BACKEND, check=True)
    assert hashes() == before
    subprocess.run(
        [sys.executable, str(GENERATOR_PATH), "--check"], cwd=BACKEND, check=True
    )
