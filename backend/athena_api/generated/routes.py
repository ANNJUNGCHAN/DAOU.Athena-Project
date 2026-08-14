"""Generated static OpenAPI routes registered from the inventory. Do not edit."""
from typing import Annotated

from fastapi import APIRouter, Header, Request, Response

from athena_api.generated.runtime import (
    call_internal_oauth,
    call_order_tr,
    call_typed_tr,
    call_websocket_tr,
)
from athena_api.dependencies import (
    KiwoomClientDep,
    KiwoomWsClientDep,
    OrderKiwoomClientDep,
    TokenManagerDep,
)
from athena_api.generated.registry import KA10007_DETAIL_MANIFEST, TR_REGISTRY, TrSpec
from athena_api.generated import models

router = APIRouter()


def _query_endpoint(spec: TrSpec):
    request_model, response_model = spec.request_model, spec.response_model

    async def endpoint(payload: request_model, request: Request, response: Response, client: KiwoomClientDep) -> response_model:
        return await call_typed_tr(spec.tr_id, payload, request, response, client)

    return endpoint


def _order_endpoint(spec: TrSpec):
    request_model, response_model = spec.request_model, spec.response_model

    async def endpoint(
        payload: request_model,
        request: Request,
        response: Response,
        client: OrderKiwoomClientDep,
        authorization: Annotated[str, Header(alias="Authorization")],
        confirmation: Annotated[str, Header(alias="X-Athena-Confirm")],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
    ) -> response_model:
        return await call_order_tr(
            spec.tr_id, payload, request, response, client, authorization, confirmation, idempotency_key
        )

    return endpoint


def _websocket_endpoint(spec: TrSpec):
    request_model, response_model = spec.request_model, spec.response_model

    async def endpoint(payload: request_model, client: KiwoomWsClientDep) -> response_model:
        return await call_websocket_tr(spec.tr_id, payload, client)

    return endpoint


def _oauth_endpoint(spec: TrSpec):
    request_model, response_model = spec.request_model, spec.response_model

    async def endpoint(
        payload: request_model,
        request: Request,
        response: Response,
        manager: TokenManagerDep,
        authorization: Annotated[str, Header(alias="Authorization")],
    ) -> response_model:
        del payload, response
        return await call_internal_oauth(spec.tr_id, request, manager, authorization)

    return endpoint


def _detail_endpoint(group_id: str, response_model: type):
    request_model = models.Ka10007Request

    async def endpoint(payload: request_model, request: Request, response: Response, client: KiwoomClientDep) -> response_model:
        return await call_typed_tr(
            "ka10007", payload, request, response, client, response_model=response_model
        )

    return endpoint


for _spec in TR_REGISTRY.values():
    if _spec.kind == "query":
        _path, _tag, _factory = f"/api/v1/tr/{_spec.domain}/{_spec.tr_id}", "Kiwoom TR", _query_endpoint
        _extra = {"x-kiwoom-tr-id": _spec.tr_id}
    elif _spec.kind == "websocket":
        _path, _tag, _factory = f"/api/v1/websocket/{_spec.tr_id}", "Kiwoom WebSocket", _websocket_endpoint
        _extra = {
            "x-kiwoom-tr-id": _spec.tr_id,
            "x-athena-operation-kind": "websocket",
            "x-athena-upstream-transport": "wss",
        }
        if _spec.tr_id == "0g":
            _extra["x-athena-case-sensitive-note"] = "0g is lowercase and distinct from 0G"
    elif _spec.kind == "order":
        _path, _tag, _factory = f"/api/v1/order/{_spec.tr_id}", "Kiwoom Orders", _order_endpoint
        _extra = {"x-kiwoom-tr-id": _spec.tr_id, "x-athena-operation-kind": "order", "x-athena-retry-count": 0}
    else:
        _path, _tag, _factory = f"/api/v1/internal/oauth/{_spec.tr_id}", "Internal OAuth lifecycle", _oauth_endpoint
        _extra = {"x-kiwoom-tr-id": _spec.tr_id, "x-athena-operation-kind": "internal-oauth", "x-athena-secrets-exposed": False}
    router.add_api_route(
        _path,
        _factory(_spec),
        methods=["POST"],
        response_model=_spec.response_model,
        tags=[_tag],
        summary=_spec.name,
        operation_id=f"post_{_spec.kind}_{_spec.domain}_{_spec.tr_id}",
        openapi_extra=_extra,
    )

for _group in KA10007_DETAIL_MANIFEST["groups"]:
    _group_id = _group["id"]
    _response_model = getattr(models, "Ka10007" + "".join(part.title() for part in _group_id.split("_")) + "Response")
    router.add_api_route(
        f"/api/v1/tr/quotes/ka10007/detail/{_group_id}",
        _detail_endpoint(_group_id, _response_model),
        methods=["POST"],
        response_model=_response_model,
        tags=["Kiwoom TR details"],
        summary=_group["title"],
        operation_id=f"post_tr_quotes_ka10007_detail_{_group_id}",
        openapi_extra={"x-kiwoom-tr-id": "ka10007", "x-athena-detail-group": _group_id},
    )
