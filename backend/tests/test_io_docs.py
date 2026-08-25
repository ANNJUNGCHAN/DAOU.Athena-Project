from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from athena_api.config import Settings
from athena_api.generated.registry import (
    DETAIL_REGISTRY,
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


def test_io_generator_check_and_determinism() -> None:
    tracked = [
        *sorted((BACKEND / "athena_api" / "generated").glob("*.py")),
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
