# ruff: noqa: E501
"""Generate Athena's allowlisted Kiwoom query API from the checked-in inventory.

The output is deterministic.  Run from any working directory with:

    python backend/scripts/generate_api.py

All 208 inventory operations are classified into safe query, order, WebSocket-path,
and internal OAuth lifecycle surfaces.
"""
from __future__ import annotations

import argparse
import builtins
import hashlib
import json
import keyword
import re
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"
DETAIL_MANIFEST_PATH = BACKEND / "ref" / "ka10007-detail-groups.json"
IO_SOURCE_PROFILE_PATH = BACKEND / "ref" / "kiwoom-io-source-profile.json"
IO_DOC_PATH = BACKEND / "docs" / "KIWOOM_API_IO.md"
GENERATED = BACKEND / "athena_api" / "generated"

ORDER_SUBCATEGORIES = frozenset({"주문", "신용주문"})
WEBSOCKET_SUBCATEGORIES = frozenset({"실시간시세", "조건검색"})
OAUTH_CATEGORY = "OAuth 인증"
DOMAIN_BY_SUBCATEGORY = {
    "계좌": "account",
    "종목정보": "stockinfo",
    "시세": "quotes",
    "순위정보": "ranking",
    "차트": "charts",
    "업종": "sector",
    "기관/외국인": "investor",
    "대차거래": "lending",
    "공매도": "shortsale",
    "테마": "theme",
    "ELW": "elw",
    "ETF": "etf",
    "관심종목": "watchlist",
}
RESERVED = {name for name in dir(builtins) if not name.startswith("_")} | {
    "BaseModel",
    "ClassVar",
    "ConfigDict",
    "Field",
}


def load_inventory() -> list[dict[str, Any]]:
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    return sorted(inventory, key=lambda entry: entry["id"])


def classify(inventory: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    operations: list[dict[str, Any]] = []
    counts = {"oauth": 0, "order": 0, "websocket": 0, "query": 0}
    for tr in inventory:
        if tr["cat"] == OAUTH_CATEGORY:
            kind, domain = "oauth", "auth"
        elif tr["subcat"] in ORDER_SUBCATEGORIES:
            kind, domain = "order", "order"
        elif tr["subcat"] in WEBSOCKET_SUBCATEGORIES:
            kind, domain = "websocket", "websocket"
        else:
            kind = "query"
            domain = DOMAIN_BY_SUBCATEGORY.get(tr["subcat"])
            if domain is None:
                raise ValueError(f"Unmapped subcategory {tr['subcat']!r} for {tr['id']}")
        counts[kind] += 1
        operations.append({**tr, "domain": domain, "kind": kind})
    expected = {"oauth": 2, "query": 171, "order": 12, "websocket": 23}
    if counts != expected or len(operations) != 208:
        raise ValueError(f"Unexpected inventory classification: {counts}, total={len(operations)}")
    return operations, counts


def pascal(value: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[^0-9A-Za-z]+", value) if part) or "Field"


def class_prefix(tr_id: str) -> str:
    value = tr_id[:1].upper() + tr_id[1:]
    return f"Tr{value}" if value[:1].isdigit() else value


def identifier(raw: str, index: int) -> str:
    name = re.sub(r"[^0-9A-Za-z_]", "_", raw.strip())
    if not name:
        name = f"field_{index}"
    if name[0].isdigit():
        name = f"f_{name}"
    if keyword.iskeyword(name) or name in RESERVED:
        name += "_"
    return name


def unique(name: str, used: set[str]) -> str:
    candidate = name
    suffix = 2
    while candidate in used:
        candidate = f"{name}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def parse_fields(items: list[dict[str, Any]], prefix: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    top: list[dict[str, Any]] = []
    nested_models: list[dict[str, Any]] = []
    top_used: set[str] = set()
    current: dict[str, Any] | None = None
    for index, item in enumerate(items, 1):
        field_type = item.get("type", "")
        if not field_type:
            continue
        element = str(item.get("element", ""))
        is_nested = element.lstrip().startswith("-")
        alias = element.lstrip("- ").strip()
        name = identifier(alias, index)
        data = {
            "name": name,
            "alias": alias,
            "description": " — ".join(filter(None, (item.get("kor", ""), item.get("desc", "")))),
            "required": item.get("required") == "Y",
            "type": "dict[str, Any]" if field_type == "Object" else "str",
        }
        if is_nested and current is not None:
            data["name"] = unique(name, current["used"])
            current["fields"].append(data)
            continue
        data["name"] = unique(name, top_used)
        if field_type == "LIST":
            current = {
                "class_name": f"{prefix}{pascal(data['name'])}Item",
                "fields": [],
                "used": set(),
            }
            nested_models.append(current)
            data["item_class"] = current["class_name"]
            data["kind"] = "list"
        else:
            current = None
            data["kind"] = "scalar"
        top.append(data)
    return top, nested_models


def field_expr(field: dict[str, Any], *, request: bool) -> str:
    description = f", description={field['description']!r}" if field["description"] else ""
    if field["kind"] == "list":
        return f"list[{field['item_class']}] = Field(default_factory=list, alias={field['alias']!r}{description})"
    required = request and field["required"]
    annotation = field["type"] if required else f"{field['type']} | None"
    default = "..." if required else "None"
    return f"{annotation} = Field({default}, alias={field['alias']!r}{description})"


def render_class(
    name: str,
    tr_id: str,
    fields: list[dict[str, Any]],
    *,
    request: bool,
    include_tr_id: bool = True,
) -> str:
    extra = "forbid" if request else "allow"
    lines = [f"class {name}(BaseModel):", f"    model_config = ConfigDict(populate_by_name=True, extra={extra!r})"]
    if include_tr_id:
        lines.append(f"    tr_id: ClassVar[str] = {tr_id!r}")
    for field in fields:
        lines.append(f"    {field['name']}: {field_expr(field, request=request)}")
    return "\n".join(lines)


def render_nested(model: dict[str, Any], *, request: bool) -> str:
    normalized = [{**field, "kind": "scalar"} for field in model["fields"]]
    return render_class(model["class_name"], "", normalized, request=request, include_tr_id=False)


def render_models(trs: list[dict[str, Any]], detail_manifest: dict[str, Any]) -> str:
    blocks = [
        '"""Generated Pydantic models. Do not edit; run backend/scripts/generate_api.py."""',
        "from __future__ import annotations",
        "",
        "from typing import Any, ClassVar",
        "",
        "from pydantic import BaseModel, ConfigDict, Field",
    ]
    parsed: dict[str, tuple[list[dict[str, Any]], list[dict[str, Any]]]] = {}
    for tr in trs:
        prefix = class_prefix(tr["id"])
        if tr["kind"] == "oauth":
            blocks.append(render_class(f"{prefix}Request", tr["id"], [], request=True))
            safe_fields = [
                {"name": "configured", "alias": "configured", "description": "Whether server-side credentials are configured.", "required": False, "type": "bool", "kind": "scalar"},
                {"name": "ready", "alias": "ready", "description": "Whether the memory-only token is ready.", "required": False, "type": "bool", "kind": "scalar"},
                {"name": "expires_at", "alias": "expires_at", "description": "Token expiry timestamp; the token itself is never returned.", "required": False, "type": "str", "kind": "scalar"},
            ]
            blocks.append(render_class(f"{prefix}Response", tr["id"], safe_fields, request=False))
            parsed[tr["id"]] = ([], safe_fields)
            continue
        req_fields, req_nested = parse_fields(tr.get("req_body", []), f"{prefix}Request")
        resp_fields, resp_nested = parse_fields(tr.get("resp_body", []), f"{prefix}Response")
        for model in req_nested:
            blocks.append(render_nested(model, request=True))
        blocks.append(render_class(f"{prefix}Request", tr["id"], req_fields, request=True))
        for model in resp_nested:
            blocks.append(render_nested(model, request=False))
        blocks.append(render_class(f"{prefix}Response", tr["id"], resp_fields, request=False))
        parsed[tr["id"]] = (req_fields, resp_fields)

    _, response_fields = parsed["ka10007"]
    fields_by_alias = {field["alias"]: field for field in response_fields}
    for group in detail_manifest["groups"]:
        group_fields = [fields_by_alias[name] for name in group["fields"]]
        class_name = f"Ka10007{pascal(group['id'])}Response"
        blocks.append(render_class(class_name, "ka10007", group_fields, request=False))
    return "\n\n\n".join(blocks) + "\n"


def render_registry(operations: list[dict[str, Any]], counts: dict[str, int], detail: dict[str, Any]) -> str:
    lines = [
        '"""Generated allowlist and model registry. Do not edit."""',
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass",
        "from typing import Any",
        "",
        "from pydantic import BaseModel",
        "",
        "from . import models",
        "",
        "@dataclass(frozen=True, slots=True)",
        "class TrSpec:",
        "    tr_id: str",
        "    kind: str",
        "    domain: str",
        "    name: str",
        "    upstream_path: str",
        "    request_model: type[BaseModel]",
        "    response_model: type[BaseModel]",
        "    request_field_count: int",
        "    response_field_count: int",
        "",
        "TR_REGISTRY: dict[str, TrSpec] = {",
    ]
    for tr in operations:
        prefix = class_prefix(tr["id"])
        lines.append(
            f"    {tr['id']!r}: TrSpec({tr['id']!r}, {tr['kind']!r}, {tr['domain']!r}, {tr['name']!r}, {tr['url']!r}, "
            f"models.{prefix}Request, models.{prefix}Response, "
            f"{tr.get('req_body_count', len(tr.get('req_body', [])))}, {tr.get('resp_body_count', len(tr.get('resp_body', [])))}),"
        )
    lines.extend(
        [
            "}",
            "QUERY_TR_IDS = frozenset(tr_id for tr_id, spec in TR_REGISTRY.items() if spec.kind == 'query')",
            "ORDER_TR_IDS = frozenset(tr_id for tr_id, spec in TR_REGISTRY.items() if spec.kind == 'order')",
            "WEBSOCKET_TR_IDS = frozenset(tr_id for tr_id, spec in TR_REGISTRY.items() if spec.kind == 'websocket')",
            "OAUTH_TR_IDS = frozenset(tr_id for tr_id, spec in TR_REGISTRY.items() if spec.kind == 'oauth')",
            "ALL_TR_IDS = frozenset(TR_REGISTRY)",
            f"INVENTORY_COUNTS = {counts!r}",
            "",
            f"KA10007_DETAIL_MANIFEST: dict[str, Any] = {detail!r}",
        ]
    )
    return "\n".join(lines) + "\n"


def render_routes(operations: list[dict[str, Any]], detail: dict[str, Any]) -> str:
    return '''"""Generated static OpenAPI routes registered from the inventory. Do not edit."""
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
'''


def athena_path(tr: dict[str, Any]) -> str:
    if tr["kind"] == "query":
        return f"/api/v1/tr/{tr['domain']}/{tr['id']}"
    if tr["kind"] == "order":
        return f"/api/v1/order/{tr['id']}"
    if tr["kind"] == "websocket":
        return f"/api/v1/websocket/{tr['id']}"
    return f"/api/v1/internal/oauth/{tr['id']}"


def markdown(value: Any) -> str:
    """Render one source value without filling in missing inventory data."""
    if value is None:
        return ""
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def field_depth(element: Any) -> int:
    value = str(element)
    depth = 0
    while value.startswith("- "):
        depth += 1
        value = value[2:]
    return depth


def render_field_table(fields: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| # | Depth | Source element | Korean label | Section | Type | Required | Length | Description |",
        "| ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
    ]
    if not fields:
        lines.append("| — | — | *(no source rows)* |  |  |  |  |  |  |")
        return lines
    for index, field in enumerate(fields, 1):
        values = [
            str(index),
            str(field_depth(field.get("element", ""))),
            f"`{markdown(field.get('element', ''))}`",
            markdown(field.get("kor", "")),
            markdown(field.get("section", "")),
            markdown(field.get("type", "")),
            markdown(field.get("required", "")),
            markdown(field.get("length", "")),
            markdown(field.get("desc", "")),
        ]
        lines.append("| " + " | ".join(values) + " |")
    return lines


def render_io_docs(
    operations: list[dict[str, Any]],
    counts: dict[str, int],
    detail: dict[str, Any],
    profile: dict[str, Any],
) -> str:
    source = profile["source_inventory"]
    audit = profile["official_github_audit"]
    distinct_pairs = ", and ".join(
        f"`{left}` and `{right}`" for left, right in audit["case_sensitive_distinct_pairs"]
    )
    catalog_detail_conflicts = ", and ".join(
        f"`{left}` and `{right}`"
        for left, right in audit["official_guide_catalog_detail_conflict_pairs"]
    )
    request_rows = sum(len(tr.get("req_body", [])) for tr in operations)
    response_rows = sum(len(tr.get("resp_body", [])) for tr in operations)
    lines = [
        "# Kiwoom API exhaustive I/O reference",
        "",
        "This file is generated by `scripts/generate_api.py`; do not edit it by hand. It is the",
        "human-readable companion to Athena's live [Swagger UI](/docs),",
        "[OpenAPI document](/openapi.json), and [operation catalog](/api/v1/catalog).",
        "The links are service-relative; from the source tree, see also [the backend README](../README.md).",
        "",
        "## Scope and completeness",
        "",
        "**Domestic Korea only:** Athena's implemented allowlist is exactly the 208 checked-in",
        "domestic/OAuth operations. Official-repository-only U.S. operations are intentional",
        "non-goals and must not enter generated routes, the catalog, or operation reference sections.",
        "",
        f"The checked-in inventory defines **{len(operations)} case-sensitive operations**: "
        f"{counts['query']} query, {counts['order']} order, {counts['websocket']} WebSocket, and "
        f"{counts['oauth']} OAuth. The tables below reproduce all **{request_rows} request** and "
        f"**{response_rows} response** source rows (**{request_rows + response_rows} total**) without "
        "filling blank `required`, `type`, `length`, or description cells. `Depth` is derived only",
        "from the inventory's leading `- ` markers; `Source element` preserves the original value.",
        "",
        f"Inventory SHA-256: `{source['sha256']}` (`{source['path']}`).",
        "",
        "The inventory is an AITS-derived, checked-in snapshot, not a live Kiwoom contract. Athena",
        "generates endpoints only from this snapshot. Re-run the generator and tests whenever the",
        "inventory or detail manifest changes; `--check` rejects stale generated artifacts.",
        "",
        "## Athena transport and wrapper contract",
        "",
        "### Shared REST headers, authentication, and continuation",
        "",
        "For query and order calls Athena sends `Content-Type: application/json;charset=UTF-8`,",
        "the exact case-sensitive `api-id`, `authorization: Bearer <process-memory token>`, and",
        "`cont-yn` (`N` or `Y`); it sends `next-key` only when supplied. Typed and raw query routes",
        "accept downstream `cont-yn`/`next-key` and return upstream `cont-yn` plus `next-key` when",
        "present. The service is mock-only and credentials/tokens remain in process memory.",
        "",
        "### OAuth lifecycle",
        "",
        "`au10001` and `au10002` are exposed only as local, bearer-protected lifecycle controls.",
        "Their Athena request body is empty and their safe response is `configured`, `ready`, and",
        "`expires_at`; credentials and tokens shown in the upstream source tables are deliberately",
        "not accepted or returned by FastAPI. On the upstream AITS-compatible wire, issuance sends",
        "`Content-Type: application/json;charset=UTF-8` and `api-id: au10001`, with `grant_type`,",
        "`appkey`, and `secretkey` in the body. Revocation sends the same content type,",
        "`api-id: au10002`, and `authorization`, with `appkey`, `secretkey`, and `token` in the body.",
        "These are the checked-in AITS/live-probe source boundary; this reference does not claim the",
        "official GitHub helper uses identical OAuth headers. Issue stores a token in memory; revoke",
        "clears it even when upstream revocation fails. Data routes return 503 until credentials and",
        "a token are ready.",
        "",
        "### WebSocket LOGIN, REG, REMOVE, REAL, and conditions",
        "",
        "Athena maintains one `wss://mockapi.kiwoom.com:10000/api/dostk/websocket` connection.",
        "It sends `LOGIN` with the memory-only token, handles `PING`, serializes control replies, and",
        "reconnects with bounded backoff while restoring successful registrations. The 19 realtime",
        "type routes accept only `REG` or `REMOVE` and require every `data.type` to exactly equal the",
        "route ID. The FastAPI wrapper accepts scalar `data[].item` and `data[].type` fields, preserves",
        "the caller's exact `grp_no` and `refresh` in REG/REMOVE, and converts item/type to arrays on",
        "the upstream wire, matching the shape shown by official GitHub samples. Each successful REG",
        "stores that exact adapted frame and restores it unchanged after reconnect.",
        "Because Athena is mock-only and source-faithful to the AITS live probe, a bare six-digit stock item is",
        "encoded upstream with `_AL`; an existing `_AL` or `_NX` suffix and every non-stock item remain",
        "unchanged. Downstream REAL items comprising six digits plus `_AL` or `_NX` normalize back to",
        "the bare six-digit code. This adapter rule is distinct from the inventory's KRX/NXT/SOR",
        "semantic input convention (bare / `_NX` / `_AL`) and from the official samples' array shape;",
        "it must not be treated as a general exchange-selection rule.",
        "`ka10171` lists conditions; `ka10172` performs a general condition request;",
        "`ka10173` starts realtime condition results; `ka10174` clears them. Upstream `REAL` events",
        "are fanned out through bounded queues at `WS /api/v1/ws/stream`, with local bearer auth when",
        "configured and loopback-only access otherwise.",
        "",
        f"**Case safety:** {distinct_pairs} are distinct inventory IDs.",
        "The official repository's per-ID mappings agree with Athena. Never normalize case.",
        "",
        "### Errors, status, and order safety",
        "",
        "`GET /health` reports process liveness; `GET /ready` returns 503 until the data client is",
        "ready. Missing readiness/authentication is sanitized to 503; upstream failures return a",
        "secret-safe `{detail, code}` body as 429 for rate limits and 502 otherwise. Validation and",
        "OAuth, REST, and WSS all canonicalize integer and numeric-string return codes before",
        "success, rate-limit, or error handling: `0000` becomes `0`, `01700` becomes `1700`, and",
        "negative signs are preserved. Booleans are not treated as numeric codes; non-numeric strings",
        "remain strings after surrounding whitespace is removed. WebSocket LOGIN/control replies",
        "must include an explicit `return_code`; missing or blank return codes are not success.",
        "guard failures use FastAPI 4xx responses. Order routes are disabled by default and require",
        "`ATHENA_ENABLE_ORDER_API=true`, local `Authorization: Bearer ...`,",
        "`X-Athena-Confirm: true`, and an `Idempotency-Key` of 1–128 characters. Orders have no",
        "automatic retry; an ambiguous failure is held `in_doubt` and cannot be resubmitted under",
        "the same key.",
        "",
        "### Batch I/O",
        "",
        "`POST /api/v1/batch` accepts 1–100 `{tr_id, body, cont_yn, next_key}` items, but only for",
        "the 171 HTTP query IDs. It runs at most five distinct calls concurrently and preserves input",
        "order. Each result contains `tr_id`, `ok`, `body`, `cont_yn`, `next_key`, and a sanitized",
        "`error` object. Orders, OAuth controls, and WebSocket IDs are rejected.",
        "",
        "## ka10007 detail projections",
        "",
        "The full `ka10007` response has 124 top-level fields. These nine non-overlapping routes",
        "project that response without making extra upstream calls:",
        "",
        "| Group | FastAPI path | Fields | Source field names |",
        "| --- | --- | ---: | --- |",
    ]
    for group in detail["groups"]:
        route = f"/api/v1/tr/quotes/ka10007/detail/{group['id']}"
        fields = ", ".join(f"`{markdown(name)}`" for name in group["fields"])
        lines.append(f"| `{group['id']}` | `{route}` | {len(group['fields'])} | {fields} |")
    lines.extend(["", "## Operation reference", ""])

    for tr in operations:
        transport = "WSS" if tr["kind"] == "websocket" else "HTTPS JSON"
        lines.extend(
            [
                f"### `{tr['id']}` — {markdown(tr['name'])}",
                "",
                f"<!-- io-operation id={tr['id']} request-rows={len(tr.get('req_body', []))} "
                f"response-rows={len(tr.get('resp_body', []))} -->",
                f"- FastAPI: `POST {athena_path(tr)}`",
                f"- Upstream: `{tr['method']} {tr['url']}`",
                f"- Kind / domain / transport: `{tr['kind']}` / `{tr['domain']}` / `{transport}`",
                f"- Source category: {markdown(tr['cat'])} / {markdown(tr['subcat'])}",
                f"- Source format: `{markdown(tr['format'])}`",
                f"- Source overview: {markdown(tr.get('overview', ''))}".rstrip(),
                f"- Source row counts: request {len(tr.get('req_body', []))}; response {len(tr.get('resp_body', []))}",
                "",
                "#### Request fields",
                "",
                *render_field_table(tr.get("req_body", [])),
                "",
                "#### Response fields",
                "",
                *render_field_table(tr.get("resp_body", [])),
                "",
            ]
        )

    delta_ids = ", ".join(f"`{value}`" for value in audit["shared_body_delta_ids"])
    lines.extend(
        [
            "## Appendix: official GitHub audit",
            "",
            f"A bounded audit used Kiwoom Securities' [public repository]({audit['repository']}) at "
            f"commit [`{audit['commit']}`]({audit['repository']}/tree/{audit['commit']}) "
            f"({audit['commit_date']}) and its [API specification]({audit['spec_url']}). The repository's "
            f"[license]({audit['license_url']}) is all-rights-reserved, so Athena stores only derived "
            "comparison facts and links here—not the official spec, examples, or sample code.",
            "",
            f"- The official spec has {audit['operation_count']} IDs: {audit['http_operation_count']} "
            f"HTTP and {audit['websocket_operation_count']} WSS. It covers all "
            f"{audit['shared_operation_count']} "
            f"Athena domestic/OAuth IDs plus {audit['us_only_operation_count']} U.S.-only IDs. Those "
            "U.S. operations are intentional non-goals and are not generated as Athena endpoints,",
            "catalog entries, or operation reference sections.",
            f"- The excluded US set is {audit['us_only_http_operation_count']} HTTPS operations plus "
            "eight WSS IDs: `usa20280`, `usa20281`, `usa20290`, `usa20291`, `F4`, `F5`, `FE`, and `FT`.",
            f"- It defines {audit['error_code_count']} error codes, "
            f"{audit['request_header_count']} request headers, and {audit['response_header_count']} "
            f"response headers, with examples for all {audit['shared_operations_with_examples']} shared IDs.",
            f"- Shared body rows are exact for {audit['shared_body_exact_count']} IDs. Eight IDs have "
            f"field order, type, or description deltas: {delta_ids}.",
            "- `ka10095` is renamed in the current official spec.",
            "- The official guide's catalog/listing conflicts with its per-ID detail and repository "
            f"mappings for {catalog_detail_conflicts}. Athena follows the per-ID/repository mappings",
            "  and preserves all IDs case-sensitively.",
            "",
            "### Known deltas and ambiguities",
            "",
            "- Row-order swaps: `ka10001`, `ka10005`, `ka10099`, `kt00001`, and `0D`.",
            "- Type deltas: `ka10101` is LIST vs String; `ka10173` is LIST vs List<Map>.",
            "- `ka90009` has eight unit-description changes. Athena preserves source strings and does",
            "  **not** automatically normalize their numeric values.",
            "- The official schema adds explicit depth/section metadata. This document derives depth",
            "  only from the checked-in inventory's leading markers and preserves every source row.",
            "- Official runtime handling requires `au10002` to contain a zero `return_code`; the local",
            "  inventory's empty response table must not be read as an upstream success guarantee.",
            f"- Of {audit['error_code_count']} catalogue entries, {audit['typed_error_count']} are typed; "
            "`1701`, `1702`, `1903`, `1999`, `8104`, and `8200` fall through the reference runtime's",
            "generic error path. Athena exposes only its sanitized wrapper status/body contract.",
            "",
            "## Drift procedure",
            "",
            "1. Update the checked-in inventory or detail manifest from an authorized source review.",
            "2. Update `ref/kiwoom-io-source-profile.json` counts and inventory SHA-256 from that review.",
            "3. Run `python scripts/generate_api.py`, review this document's diff, then run",
            "   `python scripts/generate_api.py --check` and the backend test suite.",
            "4. Treat ID case changes, field-row changes, official deltas, and newly discovered US-only",
            "   operations as explicit review items; never silently expand the endpoint allowlist.",
            "",
        ]
    )
    return "\n".join(lines)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    inventory = load_inventory()
    operations, counts = classify(inventory)
    detail = json.loads(DETAIL_MANIFEST_PATH.read_text(encoding="utf-8"))
    profile = json.loads(IO_SOURCE_PROFILE_PATH.read_text(encoding="utf-8"))
    inventory_sha256 = hashlib.sha256(INVENTORY_PATH.read_bytes()).hexdigest()
    if profile["source_inventory"]["sha256"] != inventory_sha256:
        raise ValueError(
            "Inventory SHA-256 does not match ref/kiwoom-io-source-profile.json"
        )
    official_us_ids = set(profile["official_github_audit"]["us_only_operation_ids"])
    inventory_ids = {tr["id"] for tr in operations}
    if len(official_us_ids) != 129 or official_us_ids & inventory_ids:
        raise ValueError("Domestic-only allowlist overlaps official U.S.-only operation IDs")
    outputs = {
        "__init__.py": '"""Inventory-generated API artifacts."""\n',
        "models.py": render_models(operations, detail),
        "registry.py": render_registry(operations, counts, detail),
        "routes.py": render_routes(operations, detail),
    }
    io_doc = render_io_docs(operations, counts, detail, profile)
    if args.check:
        stale = [
            name
            for name, content in outputs.items()
            if not (GENERATED / name).is_file()
            or (GENERATED / name).read_text(encoding="utf-8") != content
        ]
        if stale:
            print(f"Generated files are stale: {', '.join(stale)}")
            return 1
        if not IO_DOC_PATH.is_file() or IO_DOC_PATH.read_text(encoding="utf-8") != io_doc:
            print(f"Generated documentation is stale: {IO_DOC_PATH.relative_to(BACKEND)}")
            return 1
        print("Generated files are current")
        return 0
    for name, content in outputs.items():
        write(GENERATED / name, content)
    write(IO_DOC_PATH, io_doc)
    expected = {"__init__.py", "models.py", "registry.py", "routes.py", "runtime.py"}
    for stale in GENERATED.glob("*.py"):
        if stale.name not in expected:
            stale.unlink()
    print(
        f"Generated {len(operations)} inventory operations: {counts}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
