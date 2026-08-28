"""Read-only metadata for every generated inventory operation."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from athena_api.generated.registry import (
    DETAIL_REGISTRY,
    OUTPUT_PROFILE,
    OUTPUT_PROFILE_BY_ID,
    SPLIT_BASE_TR_IDS,
    TR_REGISTRY,
)

router = APIRouter(prefix="/api/v1/catalog", tags=["Catalog"])


def _base_metadata(tr_id: str) -> dict[str, object]:
    spec = TR_REGISTRY[tr_id]
    return {
        "operation_ref": f"base:{tr_id}",
        "tr_id": spec.tr_id,
        "kind": spec.kind,
        "domain": spec.domain,
        "name": spec.name,
        "upstream_path": spec.upstream_path,
        "request_field_count": spec.request_field_count,
        "response_field_count": spec.response_field_count,
        "request_schema": spec.request_model.model_json_schema(),
        "response_schema": spec.response_model.model_json_schema(),
        "output_profile": OUTPUT_PROFILE_BY_ID[tr_id],
    }


def _detail_metadata(operation_ref: str) -> dict[str, object]:
    detail = DETAIL_REGISTRY[operation_ref]
    spec = TR_REGISTRY[detail.tr_id]
    return {
        "operation_ref": operation_ref,
        "tr_id": detail.tr_id,
        "group_id": detail.group_id,
        "kind": "query",
        "domain": spec.domain,
        "name": spec.name,
        "group_title_ko": detail.title_ko,
        "group_title_en": detail.title_en,
        "upstream_path": spec.upstream_path,
        "request_field_count": spec.request_field_count,
        "response_field_count": len(detail.response_model.model_fields),
        "request_schema": spec.request_model.model_json_schema(),
        "response_schema": detail.response_model.model_json_schema(),
        "route": f"/api/v1/tr/{spec.domain}/{detail.tr_id}/detail/{detail.group_id}",
    }


def _operations() -> list[dict[str, object]]:
    bases = [
        _base_metadata(tr_id) for tr_id in sorted(TR_REGISTRY) if tr_id not in SPLIT_BASE_TR_IDS
    ]
    details = [_detail_metadata(ref) for ref in sorted(DETAIL_REGISTRY)]
    return [*bases, *details]


@router.get(
    "/output-profile",
    operation_id="get_catalog_output_profile",
    summary="Get the generated Kiwoom response output profile",
)
async def get_output_profile() -> dict[str, object]:
    return OUTPUT_PROFILE


@router.get("", operation_id="get_tr_catalog", summary="List all Kiwoom inventory operations")
async def get_catalog() -> dict[str, object]:
    operations = _operations()
    kind_counts = {
        kind: sum(operation["kind"] == kind for operation in operations)
        for kind in ("query", "order", "websocket", "oauth")
    }
    base_count = sum(
        str(operation["operation_ref"]).startswith("base:") for operation in operations
    )
    detail_count = len(operations) - base_count
    return {
        "counts": {
            **kind_counts,
            "base": base_count,
            "detail": detail_count,
            "total": len(operations),
        },
        "output_profile": {
            "operation_count": OUTPUT_PROFILE["operation_count"],
            "shape_counts": OUTPUT_PROFILE["shape_counts"],
            "distributions": OUTPUT_PROFILE["distributions"],
            "policy": OUTPUT_PROFILE["policy"],
        },
        "operations": operations,
    }


@router.get(
    "/{operation_ref}",
    operation_id="get_tr_metadata",
    summary="Get one callable Kiwoom operation's metadata",
)
async def get_metadata(operation_ref: str) -> dict[str, object]:
    if operation_ref in DETAIL_REGISTRY:
        return _detail_metadata(operation_ref)
    tr_id = operation_ref.removeprefix("base:")
    if tr_id not in TR_REGISTRY or tr_id in SPLIT_BASE_TR_IDS:
        raise HTTPException(status_code=404, detail="Unknown callable operation")
    return _base_metadata(tr_id)
