"""Compact LLM-facing discovery, planning, and query execution tools."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request, Response

from athena_api.dependencies import (
    AccountAliasDep,
    KiwoomClientDep,
    SelectorServiceDep,
    get_kiwoom_ws_client,
    get_order_kiwoom_client,
)
from athena_api.kiwoom import KiwoomClient, KiwoomWsClient
from athena_api.selector.schemas import (
    CallRequest,
    CallResponse,
    DescribeRequest,
    OperationDescription,
    ResolveRequest,
    ResolveResponse,
    SearchRequest,
    SearchResponse,
)

# Resolved without raising: whether a call needs the order or websocket stack is known
# only after the signed plan is opened. An order-disabled or socket-less deployment must
# still serve reads, so absence becomes an error at dispatch rather than at injection.
OptionalOrderClientDep = Annotated[KiwoomClient | None, Depends(get_order_kiwoom_client)]
OptionalWsClientDep = Annotated[KiwoomWsClient | None, Depends(get_kiwoom_ws_client)]

router = APIRouter(prefix="/api/v1/llm", tags=["LLM selector"])

_TOOL_SPECS = (
    (
        "athena_search",
        "Rank compact domestic Kiwoom operation candidates for a question. Reads are the "
        "default surface; set intent=websocket for a realtime subscription or intent=order "
        "to place one, and honour suggested_intent when the answer replies with it.",
        SearchRequest,
        SearchResponse,
    ),
    (
        "athena_describe",
        "Load the exact argument and response contract for one candidate.",
        DescribeRequest,
        OperationDescription,
    ),
    (
        "athena_resolve",
        "Select an operation, validate arguments, and issue a short-lived signed plan. Pass "
        "the same intent used to search: resolve ranks the question again, against that "
        "surface only. The returned plan_token is single-use: call athena_call with it "
        "exactly once, never twice for the same answer.",
        ResolveRequest,
        ResolveResponse,
    ),
    (
        "athena_call",
        "Execute the operation and arguments sealed in a signed plan. A websocket plan sends "
        "one registration frame and returns its acknowledgement; the events it turns on "
        "arrive out of band on the stream endpoint, never in this response. plan_token is "
        "single-use: it is consumed on this call even if the request then fails (timeout, "
        "rate limit), so a failed call cannot be retried with the same token — call "
        "athena_resolve again for a new one. A repeated call with an already-used token is "
        "rejected with PLAN_ALREADY_USED.",
        CallRequest,
        CallResponse,
    ),
)


@router.get(
    "/manifest",
    operation_id="llm_get_manifest",
    summary="LLM selector bootstrap manifest",
    openapi_extra={"x-athena-llm-exposed": False},
)
async def get_manifest(selector: SelectorServiceDep) -> dict[str, Any]:
    catalog = selector.catalog
    return {
        "catalog_version": catalog.version,
        "counts": {
            "total": len(catalog.documents),
            "generic_callable": sum(document.generic_callable for document in catalog.documents),
            "discovery_only": sum(
                document.visibility == "explicit" for document in catalog.documents
            ),
            "hidden": sum(document.visibility == "hidden" for document in catalog.documents),
        },
        "workflow": ["athena_search", "athena_describe", "athena_resolve", "athena_call"],
        "tools": [
            {
                "name": name,
                "description": description,
                "input_schema": request_model.model_json_schema(by_alias=True),
                "output_schema": response_model.model_json_schema(by_alias=True),
            }
            for name, description, request_model, response_model in _TOOL_SPECS
        ],
    }


@router.post(
    "/tools/search",
    response_model=SearchResponse,
    operation_id="llm_search_operations",
    summary="Search the domestic operation catalog",
    openapi_extra={"x-athena-llm-exposed": True},
)
async def search_operations(
    payload: SearchRequest, selector: SelectorServiceDep
) -> SearchResponse:
    return selector.search(payload)


@router.post(
    "/tools/describe",
    response_model=OperationDescription,
    operation_id="llm_describe_operation",
    summary="Describe one canonical operation",
    openapi_extra={"x-athena-llm-exposed": True},
)
async def describe_operation(
    payload: DescribeRequest, selector: SelectorServiceDep
) -> OperationDescription:
    return selector.describe(payload)


@router.post(
    "/tools/resolve",
    response_model=ResolveResponse,
    operation_id="llm_resolve_operation",
    summary="Resolve and seal an execution plan",
    openapi_extra={"x-athena-llm-exposed": True},
)
async def resolve_operation(
    payload: ResolveRequest, selector: SelectorServiceDep, account: AccountAliasDep
) -> ResolveResponse:
    return selector.resolve(payload, account=account)


@router.post(
    "/tools/call",
    response_model=CallResponse,
    operation_id="llm_call_operation",
    summary="Execute a signed query plan",
    openapi_extra={"x-athena-llm-exposed": True},
)
async def call_operation(
    payload: CallRequest,
    request: Request,
    response: Response,
    client: KiwoomClientDep,
    order_client: OptionalOrderClientDep,
    ws_client: OptionalWsClientDep,
    selector: SelectorServiceDep,
    account: AccountAliasDep,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    confirmation: Annotated[str | None, Header(alias="X-Athena-Confirm")] = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CallResponse:
    """Execute a signed plan.

    An order plan additionally demands the same headers the typed order route demands:
    signing a plan settles *which* operation, never whether it may be placed.
    """
    return await selector.call(
        payload,
        request,
        response,
        client,
        account=account,
        order_client=order_client,
        ws_client=ws_client,
        authorization=authorization,
        confirmation=confirmation,
        idempotency_key=idempotency_key,
    )
