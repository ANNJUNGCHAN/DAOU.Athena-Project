from __future__ import annotations

import json
from pathlib import Path
from typing import Any, get_args, get_origin

from pydantic import BaseModel

from athena_api.config import Settings
from athena_api.generated.registry import DETAIL_REGISTRY, TR_REGISTRY
from athena_api.main import create_app

BACKEND = Path(__file__).resolve().parents[1]
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
PROJECTION_PATH = BACKEND / "ref" / "response-projections.json"
OUTPUT_PROFILE_PATH = BACKEND / "ref" / "kiwoom-output-profile.json"


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _strip_column_priority(response_fields: dict[str, Any]) -> dict[str, Any]:
    """§5.3.1 column_priority는 generate_api.py가 계약(모델) 필드 위에 추가로 굽는 enrichment다
    (backend/scripts/generate_api.py의 column_priority_ranking) — 계약 필드 자체와는 무관하므로
    contract-exactness 비교(`_model_aliases`와의 동등 비교)에서는 제외한다."""
    return {
        **response_fields,
        "data": [
            {k: v for k, v in container.items() if k != "column_priority"}
            for container in response_fields.get("data", [])
        ],
    }


def _model_aliases(model: type[BaseModel]) -> dict[str, Any]:
    top_level: list[str] = []
    data: list[dict[str, Any]] = []
    for field_name, field in model.model_fields.items():
        alias = field.alias or field_name
        top_level.append(alias)
        if get_origin(field.annotation) is list:
            item_model = get_args(field.annotation)[0]
            data.append(
                {
                    "container_alias": alias,
                    "field_aliases": [
                        item_field.alias or item_name
                        for item_name, item_field in item_model.model_fields.items()
                    ],
                }
            )
    return {"top_level": top_level, "data": data}


def test_common_screen_manifest_has_exact_totals_and_unique_route_identities() -> None:
    manifest = _json(MANIFEST_PATH)
    mappings = manifest["mappings"]

    assert manifest["counts"] == {
        "base_operations": 208,
        "categories": {
            "oauth": 2,
            "order": 12,
            "read_display": 264,
            "websocket": 23,
        },
        "excluded_split_originals": 22,
        "routable": 301,
        "split_derived": 115,
        "unsplit_base": 186,
    }
    mapping_ids = [mapping["mapping_id"] for mapping in mappings]
    route_identities = [
        (mapping["route"]["method"], mapping["route"]["path"], mapping["route"]["operation_id"])
        for mapping in mappings
    ]
    assert len(mapping_ids) == len(set(mapping_ids)) == 301
    assert len(route_identities) == len(set(route_identities)) == 301


def test_common_screen_manifest_preserves_exact_split_original_exclusions() -> None:
    manifest = _json(MANIFEST_PATH)
    projections = _json(PROJECTION_PATH)["projections"]
    expected_ids = [projection["tr_id"] for projection in projections]

    assert [exclusion["tr_id"] for exclusion in manifest["exclusions"]] == expected_ids
    assert len(expected_ids) == len(set(expected_ids)) == 22
    assert {
        exclusion["reason"] for exclusion in manifest["exclusions"]
    } == {"replaced_by_split_derived_detail_routes"}
    assert not set(expected_ids) & {
        mapping["operation"]["tr_id"]
        for mapping in manifest["mappings"]
        if mapping["mapping_type"] == "base"
    }
    for exclusion, projection in zip(manifest["exclusions"], projections, strict=True):
        assert exclusion["replacement_mapping_ids"] == [
            f"detail:{projection['tr_id']}:{group['id']}" for group in projection["groups"]
        ]


def test_common_screen_manifest_category_partition_is_exact() -> None:
    mappings = _json(MANIFEST_PATH)["mappings"]
    by_category = {
        category: [
            mapping
            for mapping in mappings
            if mapping["classification"]["category"] == category
        ]
        for category in ("read_display", "websocket", "order", "oauth")
    }

    assert {category: len(entries) for category, entries in by_category.items()} == {
        "read_display": 264,
        "websocket": 23,
        "order": 12,
        "oauth": 2,
    }
    assert all(mapping["classification"]["read"] for mapping in by_category["read_display"])
    assert all(
        not mapping["classification"]["read"]
        for category in ("websocket", "order", "oauth")
        for mapping in by_category[category]
    )
    assert set().union(*(set(map(id, entries)) for entries in by_category.values())) == set(
        map(id, mappings)
    )


def test_common_screen_manifest_has_no_orphan_base_or_detail_mappings() -> None:
    manifest = _json(MANIFEST_PATH)
    schema = create_app(Settings(_env_file=None)).openapi()
    projection_ids = {
        projection["tr_id"] for projection in _json(PROJECTION_PATH)["projections"]
    }
    base_mappings = {
        mapping["operation"]["tr_id"]: mapping
        for mapping in manifest["mappings"]
        if mapping["mapping_type"] == "base"
    }
    detail_mappings = {
        mapping["mapping_id"]: mapping
        for mapping in manifest["mappings"]
        if mapping["mapping_type"] == "split_derived"
    }

    assert set(base_mappings) == set(TR_REGISTRY) - projection_ids
    assert set(detail_mappings) == set(DETAIL_REGISTRY)
    for tr_id, mapping in base_mappings.items():
        spec = TR_REGISTRY[tr_id]
        assert mapping["operation"]["kind"] == spec.kind
        assert mapping["operation"]["domain"] == spec.domain
        assert mapping["operation"]["upstream_path"] == spec.upstream_path
        route = schema["paths"][mapping["route"]["path"]]["post"]
        assert mapping["route"]["method"] == "POST"
        assert mapping["route"]["operation_id"] == route["operationId"]
    for mapping_id, mapping in detail_mappings.items():
        detail = DETAIL_REGISTRY[mapping_id]
        assert mapping["operation"]["tr_id"] == detail.tr_id
        assert mapping["operation"]["detail_group_id"] == detail.group_id
        assert mapping["presentation"]["layout"] == detail.layout
        route = schema["paths"][mapping["route"]["path"]]["post"]
        assert mapping["route"]["method"] == "POST"
        assert mapping["route"]["operation_id"] == route["operationId"]


def test_every_common_screen_mapping_has_exact_contract_fields_and_provenance() -> None:
    manifest = _json(MANIFEST_PATH)
    profile_by_id = {
        operation["id"]: operation
        for operation in _json(OUTPUT_PROFILE_PATH)["operations"]
    }
    required_provenance = {
        "inventory",
        "output_profile",
        "generated_registry",
        "generated_contracts",
    }

    for mapping in manifest["mappings"]:
        tr_id = mapping["operation"]["tr_id"]
        spec = TR_REGISTRY[tr_id]
        response_model = (
            DETAIL_REGISTRY[mapping["mapping_id"]].response_model
            if mapping["mapping_type"] == "split_derived"
            else spec.response_model
        )
        assert mapping["fields"]["request"] == _model_aliases(spec.request_model)
        actual_response = _strip_column_priority(mapping["fields"]["response"])
        assert actual_response == _model_aliases(response_model)
        for container in mapping["fields"]["response"].get("data", []):
            assert sorted(container["column_priority"]) == sorted(container["field_aliases"])
        assert mapping["presentation"]["shape"] == profile_by_id[tr_id]["shape"]
        assert required_provenance <= set(mapping["provenance"])
        assert mapping["provenance"]["inventory"]["operation_id"] == tr_id
        assert mapping["provenance"]["output_profile"]["operation_id"] == tr_id
        assert mapping["contracts"]["request_model"].endswith(spec.request_model.__name__)
        assert mapping["contracts"]["response_model"].endswith(response_model.__name__)


_EXPECTED_CHART_DEFAULT_PERIODS = {
    "base:ka10081": "D",  # 주식일봉차트조회요청
    "base:ka10082": "W",  # 주식주봉차트조회요청
    "base:ka10083": "M",  # 주식월봉차트조회요청
    "base:ka10094": "Y",  # 주식년봉차트조회요청
    "base:ka20006": "D",  # 업종일봉조회요청
    "base:ka20007": "W",  # 업종주봉조회요청
    "base:ka20008": "M",  # 업종월봉조회요청
    "base:ka20019": "Y",  # 업종년봉조회요청
    "base:ka10079": None,  # 주식틱차트조회요청 — P2b 의도적 비배선
    "base:ka10080": None,  # 주식분봉차트조회요청 — P2b 의도적 비배선
    "base:ka20004": None,  # 업종틱차트조회요청 — P2b 의도적 비배선
    "base:ka20005": None,  # 업종분봉조회요청 — P2b 의도적 비배선
    # 금현물 차트 7종은 AITS 화면 정의(caf8613)가 추가했다. 주식·업종과 같은
    # P2a/P2b 규칙을 따른다 — 일/주/월만 배선, 틱/분은 의도적 null.
    # 금현물에는 년봉 TR이 없어 Y가 없다.
    "base:ka50081": "D",  # 금현물일봉차트조회요청
    "base:ka50082": "W",  # 금현물주봉차트조회요청
    "base:ka50083": "M",  # 금현물월봉차트조회요청
    "base:ka50079": None,  # 금현물틱차트조회요청 — 의도적 비배선
    "base:ka50080": None,  # 금현물분봉차트조회요청 — 의도적 비배선
    "base:ka50091": None,  # 금현물당일틱차트조회요청 — 의도적 비배선
    "base:ka50092": None,  # 금현물당일분봉차트조회요청 — 의도적 비배선
}


def test_common_screen_manifest_chart_default_period_wiring_is_exact() -> None:
    manifest = _json(MANIFEST_PATH)
    by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}

    actual = {
        mapping_id: by_id[mapping_id]["presentation"]["controls"]["default_period"]
        for mapping_id in _EXPECTED_CHART_DEFAULT_PERIODS
    }
    assert actual == _EXPECTED_CHART_DEFAULT_PERIODS

    # 이 19개 밖에서는 controls 필드가 아예 없어야 한다 — "값이 없다"(비차트)와
    # "값이 null이다"(P2b 비배선)를 매니페스트 레벨에서 구조적으로 구분한다.
    with_controls = {
        mapping["mapping_id"]
        for mapping in manifest["mappings"]
        if mapping["presentation"].get("controls") is not None
    }
    assert with_controls == set(_EXPECTED_CHART_DEFAULT_PERIODS)
