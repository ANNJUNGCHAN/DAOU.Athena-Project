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
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from athena_api.output_profile import build_output_profile, canonical_json  # noqa: E402

INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"
PROJECTION_MANIFEST_PATH = BACKEND / "ref" / "response-projections.json"
KA10007_COMPATIBILITY_PATH = BACKEND / "ref" / "ka10007-detail-groups.json"
IO_SOURCE_PROFILE_PATH = BACKEND / "ref" / "kiwoom-io-source-profile.json"
OUTPUT_PROFILE_PATH = BACKEND / "ref" / "kiwoom-output-profile.json"
COMMON_SCREEN_MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
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


def projection_model_name(tr_id: str, group_id: str) -> str:
    return f"{class_prefix(tr_id)}{pascal(group_id)}Response"


def group_layout(group: dict[str, Any]) -> str:
    return group.get("layout", "facts")


def validate_response_projections(
    operations: list[dict[str, Any]],
    manifest: dict[str, Any],
    output_profile: dict[str, Any],
    ka10007_compatibility: dict[str, Any],
) -> None:
    projections = manifest.get("projections")
    if not isinstance(projections, list):
        raise ValueError("Response projection manifest must contain a projections list")
    candidate_ids = output_profile["policy"]["detail_candidates"]
    projection_ids = [projection.get("tr_id") for projection in projections]
    if projection_ids != candidate_ids:
        raise ValueError(
            "Response projection TR IDs must exactly match profile candidates in source order: "
            f"expected={candidate_ids}, actual={projection_ids}"
        )
    if len(projection_ids) != len(set(projection_ids)):
        raise ValueError("Response projection manifest contains duplicate TR IDs")

    by_id = {operation["id"]: operation for operation in operations}
    for projection in projections:
        tr_id = projection["tr_id"]
        operation = by_id.get(tr_id)
        if operation is None or operation["kind"] != "query":
            raise ValueError(f"Response projections are query-only: {tr_id}")
        response_fields, _ = parse_fields(
            operation.get("resp_body", []), f"{class_prefix(tr_id)}Response"
        )
        aliases = [field["alias"] for field in response_fields]
        if len(aliases) != len(set(aliases)):
            raise ValueError(f"Generated response aliases are not unique for {tr_id}")
        fields_by_alias = {field["alias"]: field for field in response_fields}
        source_index = {alias: index for index, alias in enumerate(aliases)}
        covered: list[str] = []
        group_ids: set[str] = set()
        for group in projection.get("groups", []):
            group_id = group["id"]
            if group_id in group_ids:
                raise ValueError(f"Duplicate response projection group ID for {tr_id}: {group_id}")
            group_ids.add(group_id)
            fields = group.get("fields", [])
            if not fields:
                raise ValueError(f"Empty response projection group: {tr_id}/{group_id}")
            if len(fields) != len(set(fields)):
                raise ValueError(f"Duplicate fields within response projection: {tr_id}/{group_id}")
            extras = [alias for alias in fields if alias not in fields_by_alias]
            if extras:
                raise ValueError(f"Unknown response aliases for {tr_id}/{group_id}: {extras}")
            indexes = [source_index[alias] for alias in fields]
            if indexes != sorted(indexes):
                raise ValueError(f"Response projection fields are not in source order: {tr_id}/{group_id}")
            layout = group_layout(group)
            if layout == "facts":
                if len(fields) > 20:
                    raise ValueError(f"Facts projection exceeds 20 fields: {tr_id}/{group_id}")
                if any(fields_by_alias[alias]["kind"] == "list" for alias in fields):
                    raise ValueError(f"Facts projection contains a LIST alias: {tr_id}/{group_id}")
                if "ui_page_size" in group:
                    raise ValueError(f"Facts projection must not declare ui_page_size: {tr_id}/{group_id}")
            elif layout == "table":
                if group.get("ui_page_size") != 10:
                    raise ValueError(f"Table projection page size must be 10: {tr_id}/{group_id}")
                if len(fields) != 1 or any(
                    fields_by_alias[alias]["kind"] != "list" for alias in fields
                ):
                    raise ValueError(
                        f"Table projection must contain exactly one top-level LIST alias: {tr_id}/{group_id}"
                    )
            else:
                raise ValueError(f"Unknown response projection layout for {tr_id}/{group_id}: {layout}")
            covered.extend(fields)
        duplicates = sorted({alias for alias in covered if covered.count(alias) > 1})
        missing = [alias for alias in aliases if alias not in covered]
        extras = [alias for alias in covered if alias not in fields_by_alias]
        if duplicates or missing or extras or len(covered) != len(aliases):
            raise ValueError(
                f"Response projection coverage mismatch for {tr_id}: "
                f"duplicates={duplicates}, missing={missing}, extras={extras}"
            )

    ka10007 = next(projection for projection in projections if projection["tr_id"] == "ka10007")
    if ka10007 != ka10007_compatibility:
        raise ValueError(
            "ref/ka10007-detail-groups.json must remain a byte-equivalent JSON compatibility mirror "
            "of the canonical ka10007 projection"
        )


def response_projection_metadata(
    manifest: dict[str, Any], *, sha256: str
) -> dict[str, Any]:
    groups = [
        group
        for projection in manifest["projections"]
        for group in projection["groups"]
    ]
    return {
        "path": "ref/response-projections.json",
        "sha256": sha256,
        "candidate_count": len(manifest["projections"]),
        "group_count": len(groups),
        "facts_group_count": sum(group_layout(group) == "facts" for group in groups),
        "table_group_count": sum(group_layout(group) == "table" for group in groups),
        "field_count": sum(len(group["fields"]) for group in groups),
        "route_count": len(groups),
    }


def render_models(trs: list[dict[str, Any]], projection_manifest: dict[str, Any]) -> str:
    blocks = [
        "# ruff: noqa: E501, I001",
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

    for projection in projection_manifest["projections"]:
        tr_id = projection["tr_id"]
        _, response_fields = parsed[tr_id]
        fields_by_alias = {field["alias"]: field for field in response_fields}
        for group in projection["groups"]:
            group_fields = [fields_by_alias[name] for name in group["fields"]]
            blocks.append(
                render_class(
                    projection_model_name(tr_id, group["id"]),
                    tr_id,
                    group_fields,
                    request=False,
                )
            )
    return "\n\n\n".join(blocks) + "\n"


def render_registry(
    operations: list[dict[str, Any]],
    counts: dict[str, int],
    projections: dict[str, Any],
    output_profile: dict[str, Any],
) -> str:
    lines = [
        "# ruff: noqa: E501, I001",
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
        "    category: str = ''",
        "    subcategory: str = ''",
        "    overview: str = ''",
        "",
        "@dataclass(frozen=True, slots=True)",
        "class DetailSpec:",
        "    operation_ref: str",
        "    tr_id: str",
        "    group_id: str",
        "    title_ko: str",
        "    title_en: str",
        "    layout: str",
        "    ui_page_size: int | None",
        "    fields: tuple[str, ...]",
        "    response_model: type[BaseModel]",
        "",
        "TR_REGISTRY: dict[str, TrSpec] = {",
    ]
    for tr in operations:
        prefix = class_prefix(tr["id"])
        lines.append(
            f"    {tr['id']!r}: TrSpec({tr['id']!r}, {tr['kind']!r}, {tr['domain']!r}, {tr['name']!r}, {tr['url']!r}, "
            f"models.{prefix}Request, models.{prefix}Response, "
            f"{tr.get('req_body_count', len(tr.get('req_body', [])))}, {tr.get('resp_body_count', len(tr.get('resp_body', [])))}, "
            f"{tr['cat']!r}, {tr['subcat']!r}, {tr.get('overview', '')!r}),"
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
            f"OUTPUT_PROFILE: dict[str, Any] = {output_profile!r}",
            "OUTPUT_PROFILE_BY_ID: dict[str, dict[str, Any]] = {",
            "    operation['id']: operation for operation in OUTPUT_PROFILE['operations']",
            "}",
            "",
            f"RESPONSE_PROJECTION_MANIFEST: dict[str, Any] = {projections!r}",
            "RESPONSE_PROJECTION_BY_TR_ID: dict[str, dict[str, Any]] = {",
            "    projection['tr_id']: projection",
            "    for projection in RESPONSE_PROJECTION_MANIFEST['projections']",
            "}",
            "",
            "DETAIL_REGISTRY: dict[str, DetailSpec] = {",
        ]
    )
    for projection in projections["projections"]:
        tr_id = projection["tr_id"]
        for group in projection["groups"]:
            group_id = group["id"]
            operation_ref = f"detail:{tr_id}:{group_id}"
            lines.append(
                f"    {operation_ref!r}: DetailSpec("
                f"{operation_ref!r}, {tr_id!r}, {group_id!r}, "
                f"{(group.get('title_ko') or group.get('title') or group_id)!r}, "
                f"{(group.get('title_en') or group.get('title') or group_id)!r}, "
                f"{group_layout(group)!r}, {group.get('ui_page_size')!r}, "
                f"{tuple(group['fields'])!r}, models.{projection_model_name(tr_id, group_id)}),"
            )
    lines.extend(
        [
            "}",
            "",
            "# Base operations replaced by their detail projections. Derived from",
            "# DETAIL_REGISTRY so it can never drift from the projections themselves.",
            "SPLIT_BASE_TR_IDS = frozenset(detail.tr_id for detail in DETAIL_REGISTRY.values())",
            "# The callable read surface: unsplit query bases plus every detail projection.",
            "READ_TR_IDS = QUERY_TR_IDS - SPLIT_BASE_TR_IDS",
            "",
            "KA10007_DETAIL_MANIFEST: dict[str, Any] = next(",
            "    projection",
            "    for projection in RESPONSE_PROJECTION_MANIFEST['projections']",
            "    if projection['tr_id'] == 'ka10007'",
            ")",
        ]
    )
    return "\n".join(lines) + "\n"


def render_routes(operations: list[dict[str, Any]], projections: dict[str, Any]) -> str:
    return '''# ruff: noqa: E501, I001
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
    AccountAliasDep,
    KiwoomClientDep,
    KiwoomWsClientDep,
    OrderKiwoomClientDep,
    TokenManagerDep,
)
from athena_api.generated.registry import (
    DETAIL_REGISTRY,
    SPLIT_BASE_TR_IDS,
    TR_REGISTRY,
    DetailSpec,
    TrSpec,
)

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
        account: AccountAliasDep,
        authorization: Annotated[str, Header(alias="Authorization")],
        confirmation: Annotated[str, Header(alias="X-Athena-Confirm")],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
    ) -> response_model:
        return await call_order_tr(
            spec.tr_id, payload, request, response, client, authorization, confirmation, idempotency_key, account
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


def _detail_endpoint(spec: TrSpec, detail: DetailSpec):
    request_model = spec.request_model
    response_model = detail.response_model

    async def endpoint(payload: request_model, request: Request, response: Response, client: KiwoomClientDep) -> response_model:
        return await call_typed_tr(
            spec.tr_id, payload, request, response, client, response_model=response_model
        )

    return endpoint


for _spec in TR_REGISTRY.values():
    if _spec.kind == "query" and _spec.tr_id in SPLIT_BASE_TR_IDS:
        # Replaced by this TR's detail projections; see ref/kiwoom-common-screen-manifest.json
        # "exclusions". The base response is 5.5x wider on average and nothing consumes it.
        # To restore it, drop this branch in scripts/generate_api.py and regenerate.
        continue
    if _spec.kind == "query":
        _path, _tag, _factory = f"/api/v1/tr/{_spec.domain}/{_spec.tr_id}", "Kiwoom TR", _query_endpoint
        _extra = {"x-kiwoom-tr-id": _spec.tr_id, "x-athena-llm-exposed": False}
    elif _spec.kind == "websocket":
        _path, _tag, _factory = f"/api/v1/websocket/{_spec.tr_id}", "Kiwoom WebSocket", _websocket_endpoint
        _extra = {
            "x-kiwoom-tr-id": _spec.tr_id,
            "x-athena-operation-kind": "websocket",
            "x-athena-upstream-transport": "wss",
            "x-athena-llm-exposed": False,
        }
        if _spec.tr_id == "0g":
            _extra["x-athena-case-sensitive-note"] = "0g is lowercase and distinct from 0G"
    elif _spec.kind == "order":
        _path, _tag, _factory = f"/api/v1/order/{_spec.tr_id}", "Kiwoom Orders", _order_endpoint
        _extra = {"x-kiwoom-tr-id": _spec.tr_id, "x-athena-operation-kind": "order", "x-athena-retry-count": 0, "x-athena-llm-exposed": False}
    else:
        _path, _tag, _factory = f"/api/v1/internal/oauth/{_spec.tr_id}", "Internal OAuth lifecycle", _oauth_endpoint
        _extra = {"x-kiwoom-tr-id": _spec.tr_id, "x-athena-operation-kind": "internal-oauth", "x-athena-secrets-exposed": False, "x-athena-llm-exposed": False}
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

for _detail in DETAIL_REGISTRY.values():
    _spec = TR_REGISTRY[_detail.tr_id]
    router.add_api_route(
        f"/api/v1/tr/{_spec.domain}/{_detail.tr_id}/detail/{_detail.group_id}",
        _detail_endpoint(_spec, _detail),
        methods=["POST"],
        response_model=_detail.response_model,
        tags=["Kiwoom TR details"],
        summary=_detail.title_en or _detail.title_ko or _detail.group_id,
        operation_id=f"post_tr_{_spec.domain}_{_detail.tr_id}_detail_{_detail.group_id}",
        openapi_extra={
            "x-kiwoom-tr-id": _detail.tr_id,
            "x-athena-detail-group": _detail.group_id,
            "x-athena-llm-exposed": False,
        },
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


# 식별 컬럼(§5.3.1(a)): semanticType이 종목코드/종목명/계좌번호/주문번호인 alias.
# fit_dissonance_check.IDENTITY_ALIASES와 값이 동일해야 한다 — 채점 스크립트가 이 매니페스트가
# 구운 순서를 그대로 소비하므로 두 상수가 갈라지면 이중 정의가 서로를 배신한다.
IDENTITY_ALIASES = {"stk_cd", "stk_nm", "acnt_no", "ord_no"}


def response_alias_frequency(mappings: list[dict[str, Any]]) -> dict[str, int]:
    """§5.3.1(b) tie-break 근거: alias가 몇 개 매핑에 등장하는지 실측한다.

    매핑 1개당 alias 1회만 센다(top_level ∪ 모든 data 컨테이너의 field_aliases 합집합).
    backend/scripts/render_screen_card_facts.py의 alias_frequency와 동일한 방법이다 —
    그 스크립트는 이미 조립된 kiwoom-common-screen-manifest.json을 다시 읽어 같은 계산을
    반복하지만, 여기서는 매니페스트를 굽는 도중 이미 메모리에 있는 mappings 리스트에서 바로
    계산해 순환 의존(매니페스트를 읽어야 매니페스트를 만드는 구조)을 피한다.
    실측값(2026-08-18, 301개 매핑 기준) 상위 6개: cur_prc 89, pred_pre 85, stk_cd 83,
    stk_nm 80, trde_qty 63, flu_rt 60 — plan/kiwoom-common-screen-spec.md §1.2와
    backend/ref/kiwoom-common-screen-card-facts.json의 cell_primitive_evidence로 재검증 가능.
    """
    counts: dict[str, int] = {}
    for mapping in mappings:
        response = mapping["fields"]["response"]
        aliases = set(response.get("top_level", []))
        for container in response.get("data", []):
            aliases.update(container.get("field_aliases", []))
        for alias in aliases:
            counts[alias] = counts.get(alias, 0) + 1
    return counts


def column_priority_ranking(aliases: list[str], freq: dict[str, int]) -> list[str]:
    """§5.3.1 컬럼 우선순위: (a) 식별 컬럼 고정 최우선(선언 순서 유지, 복수 허용),
    (b) 나머지는 실측 alias 빈도 내림차순, 동률은 선언 순서(빈도 0인 alias끼리도 동일 규칙)."""
    pinned = [a for a in aliases if a in IDENTITY_ALIASES]
    rest = [a for a in aliases if a not in IDENTITY_ALIASES]
    ranked_indices = sorted(range(len(rest)), key=lambda i: (-freq.get(rest[i], 0), i))
    return pinned + [rest[i] for i in ranked_indices]


def field_aliases(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Return generated-contract aliases, preserving LIST container ownership."""
    top_level: list[str] = []
    data: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for item in items:
        if not item.get("type"):
            continue
        element = str(item.get("element", ""))
        nested = element.lstrip().startswith("-")
        alias = element.lstrip("- ").strip()
        if nested and current is not None:
            current["field_aliases"].append(alias)
            continue
        top_level.append(alias)
        current = None
        if item.get("type") == "LIST":
            current = {"container_alias": alias, "field_aliases": []}
            data.append(current)
    return {"top_level": top_level, "data": data}


def contract_field_aliases(tr: dict[str, Any], *, request: bool) -> dict[str, Any]:
    if tr["kind"] != "oauth":
        return field_aliases(tr.get("req_body" if request else "resp_body", []))
    if request:
        return {"top_level": [], "data": []}
    return {"top_level": ["configured", "ready", "expires_at"], "data": []}


def operation_id(tr: dict[str, Any]) -> str:
    return f"post_{tr['kind']}_{tr['domain']}_{tr['id']}"


def base_layout(kind: str, shape: str) -> str:
    if kind == "websocket":
        return "event"
    if kind == "order":
        return "action"
    if kind == "oauth":
        return "status"
    return {"scalar_only": "facts", "pure_list": "table", "compound": "compound"}[shape]


def workflow_classification(kind: str) -> dict[str, Any]:
    if kind == "query":
        return {"category": "read_display", "workflow": "read", "read": True}
    return {
        "websocket": {"category": "websocket", "workflow": "websocket_lifecycle", "read": False},
        "order": {"category": "order", "workflow": "guarded_order", "read": False},
        "oauth": {"category": "oauth", "workflow": "oauth_lifecycle", "read": False},
    }[kind]


def mapping_provenance(tr_id: str, *, group_id: str | None = None) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "inventory": {"path": "ref/kiwoom-tr-inventory.json", "operation_id": tr_id},
        "output_profile": {"path": "ref/kiwoom-output-profile.json", "operation_id": tr_id},
        "generated_registry": {
            "path": "athena_api/generated/registry.py",
            "registry_key": tr_id,
        },
        "generated_contracts": {"path": "athena_api/generated/models.py"},
    }
    if group_id is not None:
        provenance["response_projection"] = {
            "path": "ref/response-projections.json",
            "tr_id": tr_id,
            "group_id": group_id,
        }
        provenance["generated_registry"] = {
            "path": "athena_api/generated/registry.py",
            "registry_key": f"detail:{tr_id}:{group_id}",
        }
    return provenance


def build_common_screen_manifest(
    operations: list[dict[str, Any]],
    projections: dict[str, Any],
    output_profile: dict[str, Any],
    *,
    inventory_sha256: str,
    projection_sha256: str,
) -> dict[str, Any]:
    """Build the canonical routable common-screen coverage manifest."""
    by_id = {operation["id"]: operation for operation in operations}
    profile_by_id = {operation["id"]: operation for operation in output_profile["operations"]}
    excluded_ids = [projection["tr_id"] for projection in projections["projections"]]
    excluded_set = set(excluded_ids)
    mappings: list[dict[str, Any]] = []

    for tr in operations:
        if tr["id"] in excluded_set:
            continue
        prefix = class_prefix(tr["id"])
        shape = profile_by_id[tr["id"]]["shape"]
        mappings.append(
            {
                "mapping_id": f"base:{tr['id']}",
                "mapping_type": "base",
                "route": {
                    "method": "POST",
                    "path": athena_path(tr),
                    "operation_id": operation_id(tr),
                },
                "operation": {
                    "tr_id": tr["id"],
                    "kind": tr["kind"],
                    "domain": tr["domain"],
                    "upstream_path": tr["url"],
                },
                "fields": {
                    "request": contract_field_aliases(tr, request=True),
                    "response": contract_field_aliases(tr, request=False),
                },
                "presentation": {"shape": shape, "layout": base_layout(tr["kind"], shape)},
                "classification": workflow_classification(tr["kind"]),
                "contracts": {
                    "request_model": f"athena_api.generated.models.{prefix}Request",
                    "response_model": f"athena_api.generated.models.{prefix}Response",
                },
                "provenance": mapping_provenance(tr["id"]),
            }
        )

    for projection in projections["projections"]:
        tr = by_id[projection["tr_id"]]
        request_fields = contract_field_aliases(tr, request=True)
        source_response_fields = contract_field_aliases(tr, request=False)
        source_data_by_container = {
            entry["container_alias"]: entry for entry in source_response_fields["data"]
        }
        for group in projection["groups"]:
            group_id = group["id"]
            selected = set(group["fields"])
            response_fields = {
                "top_level": list(group["fields"]),
                "data": [
                    source_data_by_container[alias]
                    for alias in group["fields"]
                    if alias in selected and alias in source_data_by_container
                ],
            }
            mappings.append(
                {
                    "mapping_id": f"detail:{tr['id']}:{group_id}",
                    "mapping_type": "split_derived",
                    "route": {
                        "method": "POST",
                        "path": f"{athena_path(tr)}/detail/{group_id}",
                        "operation_id": f"post_tr_{tr['domain']}_{tr['id']}_detail_{group_id}",
                    },
                    "operation": {
                        "tr_id": tr["id"],
                        "kind": "query_detail",
                        "domain": tr["domain"],
                        "upstream_path": tr["url"],
                        "detail_group_id": group_id,
                    },
                    "fields": {"request": request_fields, "response": response_fields},
                    "presentation": {
                        "shape": profile_by_id[tr["id"]]["shape"],
                        "layout": group_layout(group),
                    },
                    "classification": workflow_classification("query"),
                    "contracts": {
                        "request_model": f"athena_api.generated.models.{class_prefix(tr['id'])}Request",
                        "response_model": (
                            f"athena_api.generated.models.{projection_model_name(tr['id'], group_id)}"
                        ),
                    },
                    "provenance": mapping_provenance(tr["id"], group_id=group_id),
                }
            )

    # §5.3.1 컬럼 우선순위를 매니페스트에 굽는다. 모든 응답 LIST 컨테이너(=table 렌더링
    # 대상)에 적용한다 — mapping.presentation.layout이 "table"이 아니어도(예: compound)
    # data 컨테이너 자체는 fit_dissonance_check.mapping_facts_and_groups가 이미 layout과
    # 무관하게 table_groups로 취급하므로 여기서도 동일 범위로 굽는다. split_derived 그룹의
    # data 컨테이너는 원본 base 응답과 객체를 공유할 수 있어(같은 container_alias가 정확히
    # 한 그룹에만 속하는 게 보통이라 값은 항상 같다) 중복 계산을 건너뛴다.
    response_alias_freq = response_alias_frequency(mappings)
    for mapping in mappings:
        for container in mapping["fields"]["response"].get("data", []):
            if "column_priority" not in container:
                container["column_priority"] = column_priority_ranking(
                    container["field_aliases"], response_alias_freq
                )

    exclusions = [
        {
            "tr_id": tr_id,
            "route": {"method": "POST", "path": athena_path(by_id[tr_id])},
            "reason": "replaced_by_split_derived_detail_routes",
            "replacement_mapping_ids": [
                f"detail:{tr_id}:{group['id']}"
                for group in next(
                    projection["groups"]
                    for projection in projections["projections"]
                    if projection["tr_id"] == tr_id
                )
            ],
        }
        for tr_id in excluded_ids
    ]
    manifest = {
        "version": 1,
        "description": "Canonical Kiwoom common-screen routable coverage manifest.",
        "sources": {
            "inventory": {
                "path": "ref/kiwoom-tr-inventory.json",
                "sha256": inventory_sha256,
            },
            "output_profile": {"path": "ref/kiwoom-output-profile.json"},
            "response_projections": {
                "path": "ref/response-projections.json",
                "sha256": projection_sha256,
            },
            "generated_registry": {"path": "athena_api/generated/registry.py"},
            "generated_contracts": {"path": "athena_api/generated/models.py"},
        },
        "counts": {
            "base_operations": len(operations),
            "unsplit_base": sum(mapping["mapping_type"] == "base" for mapping in mappings),
            "split_derived": sum(
                mapping["mapping_type"] == "split_derived" for mapping in mappings
            ),
            "routable": len(mappings),
            "excluded_split_originals": len(exclusions),
            "categories": {
                category: sum(
                    mapping["classification"]["category"] == category for mapping in mappings
                )
                for category in ("read_display", "websocket", "order", "oauth")
            },
        },
        "exclusions": exclusions,
        "mappings": mappings,
    }
    validate_common_screen_manifest(manifest, operations, projections)
    return manifest


def validate_common_screen_manifest(
    manifest: dict[str, Any],
    operations: list[dict[str, Any]],
    projections: dict[str, Any],
) -> None:
    mappings = manifest["mappings"]
    exclusions = manifest["exclusions"]
    expected_exclusions = [projection["tr_id"] for projection in projections["projections"]]
    expected_details = {
        f"detail:{projection['tr_id']}:{group['id']}"
        for projection in projections["projections"]
        for group in projection["groups"]
    }
    mapping_ids = [mapping["mapping_id"] for mapping in mappings]
    route_identities = [
        (mapping["route"]["method"], mapping["route"]["path"]) for mapping in mappings
    ]
    actual_details = {
        mapping["mapping_id"]
        for mapping in mappings
        if mapping["mapping_type"] == "split_derived"
    }
    actual_base_ids = {
        mapping["operation"]["tr_id"]
        for mapping in mappings
        if mapping["mapping_type"] == "base"
    }
    expected_base_ids = {operation["id"] for operation in operations} - set(expected_exclusions)
    counts = manifest["counts"]
    expected_counts = {
        "base_operations": 208,
        "unsplit_base": 186,
        "split_derived": 115,
        "routable": 301,
        "excluded_split_originals": 22,
        "categories": {"read_display": 264, "websocket": 23, "order": 12, "oauth": 2},
    }
    if counts != expected_counts:
        raise ValueError(f"Unexpected common-screen manifest counts: {counts}")
    if [entry["tr_id"] for entry in exclusions] != expected_exclusions:
        raise ValueError("Common-screen exclusions do not exactly match split-original query IDs")
    if any(entry["reason"] != "replaced_by_split_derived_detail_routes" for entry in exclusions):
        raise ValueError("Common-screen exclusions must preserve the canonical replacement reason")
    if len(mapping_ids) != len(set(mapping_ids)) or len(route_identities) != len(set(route_identities)):
        raise ValueError("Common-screen mapping IDs and route identities must be unique")
    if actual_base_ids != expected_base_ids or actual_details != expected_details:
        raise ValueError("Common-screen manifest contains an orphan or missing base/detail mapping")
    required_provenance = {
        "inventory",
        "output_profile",
        "generated_registry",
        "generated_contracts",
    }
    for mapping in mappings:
        if not required_provenance <= mapping["provenance"].keys():
            raise ValueError(f"Incomplete provenance for {mapping['mapping_id']}")
        if set(mapping["fields"]) != {"request", "response"}:
            raise ValueError(f"Incomplete field aliases for {mapping['mapping_id']}")
        for direction in ("request", "response"):
            if set(mapping["fields"][direction]) != {"top_level", "data"}:
                raise ValueError(f"Incomplete {direction} aliases for {mapping['mapping_id']}")


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
    projections: dict[str, Any],
    profile: dict[str, Any],
    output_profile: dict[str, Any],
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
        "## Response detail projections",
        "",
        f"The canonical manifest defines {len(projections['projections'])} candidate TRs and "
        f"{sum(len(projection['groups']) for projection in projections['projections'])} non-overlapping routes.",
        "Each route projects one full typed response without making an extra upstream call.",
        "",
        "| TR | Layout | Group | FastAPI path | Fields | Source field names |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    operation_by_id = {operation["id"]: operation for operation in operations}
    for projection in projections["projections"]:
        tr_id = projection["tr_id"]
        domain = operation_by_id[tr_id]["domain"]
        for group in projection["groups"]:
            route = f"/api/v1/tr/{domain}/{tr_id}/detail/{group['id']}"
            fields = ", ".join(f"`{markdown(name)}`" for name in group["fields"])
            lines.append(
                f"| `{tr_id}` | `{group_layout(group)}` | `{group['id']}` | `{route}` | "
                f"{len(group['fields'])} | {fields} |"
            )
    output_policy = output_profile["policy"]
    non_list_query_distribution = output_policy["descriptive_non_list_query_distribution"]
    lines.extend(
        [
            "",
            "## Response output profile and detail-candidate policy",
            "",
            "The generated response contract is profiled for every base operation after applying",
            "the same typed-row and LIST-item structure used by the Pydantic model generator.",
            f"The pinned profile contains {output_profile['shape_counts']['scalar_only']} scalar-only, "
            f"{output_profile['shape_counts']['pure_list']} pure-list, and "
            f"{output_profile['shape_counts']['compound']} compound responses.",
            "Pure lists are pagination/UI concerns and are never field-split; the UI page size is",
            f"{output_policy['list_ui_page_size']} rows. The practical one-screen field budget is "
            f"{output_policy['screen_budget']}.",
            "",
            "`screen_complexity` is transparent and deterministic: top-level non-list fields plus",
            "the sum of `min(list row width, 20)` for each list section. The cap represents the",
            "field budget, not the number of list rows fetched or returned.",
            "",
            "All quantiles use Hyndman-Fan type 7. Tukey fences are `Q1 - 1.5 * IQR` and",
            "`Q3 + 1.5 * IQR`. These statistics describe the pinned response population; Tukey",
            "outlier status does not gate detail-candidate selection. The additional non-list-query",
            "distribution includes domestic HTTP queries with at least one top-level non-list field.",
            "",
            "| Metric (all 208 base operations) | Min | Q1 | Median | Q3 | Max | Tukey upper fence |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for metric, summary in output_profile["distributions"].items():
        lines.append(
            f"| `{metric}` | {summary['min']:g} | {summary['q1']:g} | "
            f"{summary['median']:g} | {summary['q3']:g} | {summary['max']:g} | "
            f"{summary['tukey_upper_fence']:g} |"
        )
    candidates = ", ".join(f"`{tr_id}`" for tr_id in output_policy["detail_candidates"])
    lines.extend(
        [
            "",
            f"The descriptive non-list-query population has **{non_list_query_distribution['count']}** "
            f"operations: Q1 {non_list_query_distribution['q1']:g}, median "
            f"{non_list_query_distribution['median']:g}, Q3 "
            f"{non_list_query_distribution['q3']:g}, IQR "
            f"{non_list_query_distribution['iqr']:g}, and Tukey upper fence "
            f"{non_list_query_distribution['tukey_upper_fence']:g}.",
            f"A domestic HTTP query is a candidate when it is not pure-list and its "
            f"`screen_complexity` is greater than the one-screen budget of "
            f"{output_policy['screen_budget']}. The pinned candidates are {candidates}.",
            "Every pinned candidate has complete semantic projection coverage in",
            "[`ref/response-projections.json`](../ref/response-projections.json). Facts groups contain",
            "at most 20 serialized API aliases; table groups preserve one top-level LIST atomically",
            "and declare a UI page size of 10 rows.",
            "",
            "The canonical machine-readable artifact is",
            "[`ref/kiwoom-output-profile.json`](../ref/kiwoom-output-profile.json).",
            "",
            "## Operation reference",
            "",
        ]
    )

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
            "1. Update the checked-in inventory or canonical response-projection manifest from an authorized source review.",
            "2. Update `ref/kiwoom-io-source-profile.json` counts and SHA-256 values from that review.",
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
    projections = json.loads(PROJECTION_MANIFEST_PATH.read_text(encoding="utf-8"))
    ka10007_compatibility = json.loads(
        KA10007_COMPATIBILITY_PATH.read_text(encoding="utf-8")
    )
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
    output_profile = build_output_profile(operations, inventory_sha256=inventory_sha256)
    validate_response_projections(
        operations, projections, output_profile, ka10007_compatibility
    )
    projection_sha256 = hashlib.sha256(PROJECTION_MANIFEST_PATH.read_bytes()).hexdigest()
    expected_projection_metadata = response_projection_metadata(
        projections, sha256=projection_sha256
    )
    if profile.get("response_projection_manifest") != expected_projection_metadata:
        raise ValueError(
            "Response projection metadata does not match ref/kiwoom-io-source-profile.json: "
            f"expected={expected_projection_metadata}, "
            f"actual={profile.get('response_projection_manifest')}"
        )
    output_profile_json = canonical_json(output_profile)
    common_screen_manifest = build_common_screen_manifest(
        operations,
        projections,
        output_profile,
        inventory_sha256=inventory_sha256,
        projection_sha256=projection_sha256,
    )
    common_screen_manifest_json = canonical_json(common_screen_manifest)
    outputs = {
        "__init__.py": '"""Inventory-generated API artifacts."""\n',
        "models.py": render_models(operations, projections),
        "registry.py": render_registry(operations, counts, projections, output_profile),
        "routes.py": render_routes(operations, projections),
    }
    io_doc = render_io_docs(operations, counts, projections, profile, output_profile)
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
        if (
            not OUTPUT_PROFILE_PATH.is_file()
            or OUTPUT_PROFILE_PATH.read_text(encoding="utf-8") != output_profile_json
        ):
            print(f"Generated output profile is stale: {OUTPUT_PROFILE_PATH.relative_to(BACKEND)}")
            return 1
        if (
            not COMMON_SCREEN_MANIFEST_PATH.is_file()
            or COMMON_SCREEN_MANIFEST_PATH.read_text(encoding="utf-8")
            != common_screen_manifest_json
        ):
            print(
                "Generated common-screen manifest is stale: "
                f"{COMMON_SCREEN_MANIFEST_PATH.relative_to(BACKEND)}"
            )
            return 1
        print("Generated files are current")
        return 0
    for name, content in outputs.items():
        write(GENERATED / name, content)
    write(IO_DOC_PATH, io_doc)
    write(OUTPUT_PROFILE_PATH, output_profile_json)
    write(COMMON_SCREEN_MANIFEST_PATH, common_screen_manifest_json)
    expected = {"__init__.py", "models.py", "registry.py", "routes.py", "runtime.py"}
    for stale in GENERATED.glob("*.py"):
        if stale.name not in expected:
            stale.unlink()
    print(
        f"Generated {len(operations)} inventory operations and "
        f"{expected_projection_metadata['route_count']} response projections, "
        f"{common_screen_manifest['counts']['routable']} common-screen mappings: {counts}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
