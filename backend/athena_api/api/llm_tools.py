"""Compact LLM-facing discovery, planning, and query execution tools."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response

from athena_api.dependencies import KiwoomClientDep, SelectorServiceDep
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

router = APIRouter(prefix="/api/v1/llm", tags=["LLM selector"])

_TOOL_SPECS = (
    (
        "athena_search",
        "Rank compact domestic Kiwoom operation candidates for a question.",
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
        "Select an operation, validate arguments, and issue a short-lived signed plan.",
        ResolveRequest,
        ResolveResponse,
    ),
    (
        "athena_call",
        "Execute only the query operation and arguments sealed in a signed plan.",
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
    payload: ResolveRequest, selector: SelectorServiceDep
) -> ResolveResponse:
    return selector.resolve(payload)


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
    selector: SelectorServiceDep,
) -> CallResponse:
    return await selector.call(payload, request, response, client)
