"""Read-only metadata for every generated inventory operation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from athena_api.generated.registry import INVENTORY_COUNTS, KA10007_DETAIL_MANIFEST, TR_REGISTRY

router = APIRouter(prefix="/api/v1/catalog", tags=["Catalog"])


def _metadata(tr_id: str) -> dict[str, object]:
    spec = TR_REGISTRY[tr_id]
    result: dict[str, object] = {
        "tr_id": spec.tr_id,
        "kind": spec.kind,
        "domain": spec.domain,
        "name": spec.name,
        "upstream_path": spec.upstream_path,
        "request_field_count": spec.request_field_count,
        "response_field_count": spec.response_field_count,
        "request_schema": spec.request_model.model_json_schema(),
        "response_schema": spec.response_model.model_json_schema(),
    }
    if tr_id == "ka10007":
        result["detail_groups"] = KA10007_DETAIL_MANIFEST["groups"]
    return result


@router.get("", operation_id="get_tr_catalog", summary="List all Kiwoom inventory operations")
async def get_catalog() -> dict[str, object]:
    return {
        "counts": {**INVENTORY_COUNTS, "total": len(TR_REGISTRY)},
        "operations": [_metadata(tr_id) for tr_id in sorted(TR_REGISTRY)],
    }


@router.get(
    "/{tr_id}", operation_id="get_tr_metadata", summary="Get one Kiwoom operation's metadata"
)
async def get_metadata(tr_id: str) -> dict[str, object]:
    if tr_id not in TR_REGISTRY:
        raise HTTPException(status_code=404, detail="Unknown TR id")
    return _metadata(tr_id)
