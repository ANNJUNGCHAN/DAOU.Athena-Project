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
sys.path.insert(0, str(BACKEND / "scripts"))

from render_screen_case_matrix import (  # noqa: E402
    CASES as SCREEN_TEMPLATE_CASES,
)
from render_screen_case_matrix import classify as classify_screen_case  # noqa: E402

from athena_api.output_profile import build_output_profile, canonical_json  # noqa: E402
from athena_api.routing_contract import (  # noqa: E402
    OperationRouting,
    build_routing_registry,
)

INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"
PROJECTION_MANIFEST_PATH = BACKEND / "ref" / "response-projections.json"
KA10007_COMPATIBILITY_PATH = BACKEND / "ref" / "ka10007-detail-groups.json"
IO_SOURCE_PROFILE_PATH = BACKEND / "ref" / "kiwoom-io-source-profile.json"
OUTPUT_PROFILE_PATH = BACKEND / "ref" / "kiwoom-output-profile.json"
COMMON_SCREEN_MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
SCREEN_DEFINITIONS_PATH = BACKEND / "ref" / "kiwoom-screen-definitions.json"
AITS_CHART_CONTRACTS_PATH = BACKEND / "ref" / "aits-chart-contracts.json"
ROUTING_SOURCE_PATH = BACKEND / "ref" / "selector-routing.json"
ENTITY_MARKER_PATH = BACKEND / "ref" / "selector-entity-markers.json"
GENERATED = BACKEND / "athena_api" / "generated"


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key in selector routing source: {key}")
        result[key] = value
    return result


_EQUIVALENCE_QUALIFIER_AXES = frozenset({"data_intents", "temporal_scopes"})


def validate_routing_equivalence_groups(
    source: dict[str, Any],
    routing_registry: dict[str, OperationRouting],
    contract_registry: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    groups = source.get("equivalence_groups", {})
    if not isinstance(groups, dict):
        raise ValueError("selector routing equivalence_groups must be an object")
    result: dict[str, dict[str, Any]] = {}
    claimed_members: dict[str, str] = {}
    for group_id, raw in groups.items():
        if not isinstance(raw, dict):
            raise ValueError(f"equivalence group must be an object: {group_id}")
        members = raw.get("members")
        canonical = raw.get("canonical_ref")
        if not isinstance(members, list) or len(members) < 2 or not isinstance(canonical, str):
            raise ValueError(f"invalid equivalence group: {group_id}")
        if canonical not in members or any(ref not in routing_registry for ref in members):
            raise ValueError(f"equivalence group references unknown operation: {group_id}")
        if len(set(members)) != len(members):
            raise ValueError(f"equivalence group contains duplicate members: {group_id}")
        qualifier_axes = raw.get("qualifier_axes", [])
        if (
            not isinstance(qualifier_axes, list)
            or len(qualifier_axes) != len(set(qualifier_axes))
            or any(axis not in _EQUIVALENCE_QUALIFIER_AXES for axis in qualifier_axes)
        ):
            raise ValueError(f"invalid equivalence qualifier axes: {group_id}")
        for member in members:
            prior_group = claimed_members.get(member)
            if prior_group is not None:
                raise ValueError(
                    f"equivalence member belongs to multiple groups: "
                    f"{member}/{prior_group}/{group_id}"
                )
            claimed_members[member] = str(group_id)
        core = [routing_registry[ref].canonical() for ref in members]
        routing_axes = tuple(core[0])
        if any(tuple(item) != routing_axes for item in core[1:]):
            raise ValueError(f"equivalence group routing axes mismatch: {group_id}")
        differing_axes = {
            axis
            for axis in routing_axes
            if any(item[axis] != core[0][axis] for item in core[1:])
        }
        if differing_axes != set(qualifier_axes):
            raise ValueError(
                f"equivalence group routing differences must exactly match qualifier axes: "
                f"{group_id}/differences={sorted(differing_axes)}/"
                f"qualifiers={sorted(qualifier_axes)}"
            )
        common_routing = {
            axis: core[0][axis] for axis in routing_axes if axis not in qualifier_axes
        }
        if contract_registry is None:
            raise ValueError(f"equivalence contract registry is required: {group_id}")
        missing_contracts = [ref for ref in members if ref not in contract_registry]
        if missing_contracts:
            raise ValueError(
                f"equivalence group has no normalized contract: {group_id}/{missing_contracts}"
            )
        normalized_contracts = [
            {
                "version": "selector-equivalence-contract-v1",
                "operation": contract_registry[ref],
                "routing_core": common_routing,
            }
            for ref in members
        ]
        canonical_contract = canonical_json(normalized_contracts[0])
        for ref, contract in zip(members[1:], normalized_contracts[1:], strict=True):
            if canonical_json(contract) != canonical_contract:
                raise ValueError(f"equivalence group normalized contract mismatch: {group_id}/{ref}")
        contract_fingerprint = (
            "sha256:" + hashlib.sha256(canonical_contract.encode("utf-8")).hexdigest()
        )
        result[str(group_id)] = {
            "canonical_ref": canonical,
            "members": list(members),
            "qualifier_axes": qualifier_axes,
            "contract_fingerprint": contract_fingerprint,
        }
    return result

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

COMMON_SCREEN_PAPER_DOCUMENT = "Athena — 화면설계서"
COMMON_SCREEN_PAPER_FAMILY_ID = "AT-CV-005"
COMMON_SCREEN_PAPER_ARTBOARD_BY_CARD = {
    "FactsCard": "27 · AT-CV-005 FactsCard",
    "TableCard": "28 · AT-CV-005 TableCard",
    "CompoundCard": "29 · AT-CV-005 CompoundCard",
    "EventCard": "30 · AT-CV-005 EventCard",
    "ActionCard": "31 · AT-CV-005 ActionCard",
    "StatusCard": "32 · AT-CV-005 StatusCard",
}
COMMON_SCREEN_STATES_ARTBOARD = "33 · AT-CV-005 상태 7종"
COMMON_SCREEN_WORKFLOWS_ARTBOARD = "34 · AT-CV-005 보호 워크플로 3종"

COMMON_RESULT_STATES = (
    "loading",
    "empty",
    "partial",
    "truncated",
    "stale",
    "timeout",
    "error",
    "unavailable",
    "auth_required",
)
READ_STATES_BY_LAYOUT = {
    "facts": COMMON_RESULT_STATES,
    "table": (*COMMON_RESULT_STATES, "stale"),
    "compound": (*COMMON_RESULT_STATES, "stale"),
}
WORKFLOW_LIFECYCLE_BY_CATEGORY = {
    "websocket": ("connecting", "open", "reconnecting", "dropped", "stopped", "error"),
    "order": ("draft", "review", "confirm", "committed", "receipt", "error"),
    "oauth": ("auth_required", "authorizing", "ready", "expired", "error"),
}

# Generation-time allowlist only. A runtime never guesses a date-like key. If none of these
# aliases is declared by the generated response contract, the screen definition explicitly
# preserves source order and refuses to claim that any row is the latest observation.
TEMPORAL_FIELD_PRIORITY = (
    "dt",
    "date",
    "cntr_dt",
    "trde_dt",
    "exec_dt",
    "deal_dt",
    "loan_dt",
    "qry_dt",
    "regDay",
    "cntr_tm",
    "tm",
    "ord_tm",
    "qry_tm",
    "proc_time",
    "proc_tm",
    "seq",
)

DISPLAY_EXCLUDED_ALIASES = frozenset(
    {
        "return_code",
        "return_msg",
        "trnm",
        "cont-yn",
        "next-key",
        "authorization",
        "token",
        "secretkey",
        "appkey",
    }
)

FORMATTER_BY_ALIAS = {
    "cur_prc": "signed_price",
    "open_pric": "signed_price",
    "high_pric": "signed_price",
    "low_pric": "signed_price",
    "pred_pre": "signed_number",
    "pred_pre_sig": "change_sign",
    "flu_rt": "signed_percent",
    "trde_qty": "quantity",
    "acc_trde_qty": "quantity",
    "dt": "date_yyyymmdd",
    "date": "date_yyyymmdd",
    "cntr_dt": "date_yyyymmdd",
    "trde_dt": "date_yyyymmdd",
    "cntr_tm": "time_hhmmss",
    "tm": "time_hhmmss",
    "ord_tm": "time_hhmmss",
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


def _normalized_model_fields(
    items: list[dict[str, Any]],
    *,
    request: bool,
    projected_aliases: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Describe the generated Pydantic field contract without model class titles.

    Generated root and nested class names contain the TR ID, but those names do not
    change validation or serialization.  Equivalence therefore compares the actual
    aliases, order, types, requiredness/nullability, model configuration, and the
    (currently empty) validator set instead of raw ``model_json_schema`` hashes.
    """
    fields, nested_models = parse_fields(items, "EquivalenceModel")
    nested_by_name = {model["class_name"]: model for model in nested_models}
    fields_by_alias = {field["alias"]: field for field in fields}
    selected = (
        fields
        if projected_aliases is None
        else [fields_by_alias[alias] for alias in projected_aliases]
    )

    def normalize(field: dict[str, Any], *, nested: bool = False) -> dict[str, Any]:
        if field["kind"] == "list":
            item_model = nested_by_name[field["item_class"]]
            field_type: dict[str, Any] = {
                "kind": "array",
                "items": [
                    normalize({**item, "kind": "scalar"}, nested=True)
                    for item in item_model["fields"]
                ],
            }
            nullable = False
            required = False
        else:
            field_type = {"kind": "scalar", "python_type": field["type"]}
            required = bool(request and field["required"])
            nullable = not required
        return {
            "alias": field["alias"],
            "type": field_type,
            "required": required,
            "nullable": nullable,
            # The generator currently emits no field/model validators. Keeping this
            # explicit makes a future validator addition fingerprint-visible.
            "validators": [],
            "nested": nested,
        }

    return [normalize(field) for field in selected]


def build_routing_equivalence_contracts(
    operations: list[dict[str, Any]],
    projections: dict[str, Any],
    common_screen_manifest: dict[str, Any],
    screen_definitions: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Build the non-routing half of reviewed selector equivalence fingerprints."""
    operations_by_id = {operation["id"]: operation for operation in operations}
    projection_groups = {
        f"detail:{projection['tr_id']}:{group['id']}": group
        for projection in projections["projections"]
        for group in projection["groups"]
    }
    split_ids = {projection["tr_id"] for projection in projections["projections"]}
    mappings = {
        mapping["mapping_id"]: mapping for mapping in common_screen_manifest["mappings"]
    }
    definitions = {
        definition["mapping_id"]: definition
        for definition in screen_definitions["definitions"]
    }
    contracts: dict[str, dict[str, Any]] = {}
    for operation_ref, mapping in mappings.items():
        tr_id = mapping["operation"]["tr_id"]
        operation = operations_by_id[tr_id]
        definition = definitions[operation_ref]
        group = projection_groups.get(operation_ref)
        response_aliases = None if group is None else list(group["fields"])
        if operation_ref.startswith("detail:"):
            selector_kind = "query"
            visibility = "normal"
            generic_callable = True
        else:
            selector_kind = operation["kind"]
            visibility = (
                "hidden"
                if selector_kind == "oauth"
                else "normal"
                if selector_kind == "query"
                else "explicit"
            )
            generic_callable = selector_kind in {"query", "order", "websocket"} and (
                tr_id not in split_ids
            )
        contracts[operation_ref] = {
            "request": {
                "model_config": {"extra": "forbid", "populate_by_name": True},
                "fields": _normalized_model_fields(
                    operation.get("req_body", []), request=True
                ),
                "continuation": {
                    "input": definition["input"]["continuation"],
                    "response_range": (
                        (definition.get("data") or {}).get("range", {}).get("continuation")
                    ),
                },
                "validators": [],
            },
            "response": {
                "model_config": {"extra": "allow", "populate_by_name": True},
                "fields": _normalized_model_fields(
                    operation.get("resp_body", []),
                    request=False,
                    projected_aliases=response_aliases,
                ),
                "validators": [],
            },
            "presentation": {
                "manifest": mapping["presentation"],
                "screen_reference": {
                    key: mapping["screen_reference"][key]
                    for key in ("screen_id", "template_case_id", "card", "paper_artboard")
                },
                "definition": {
                    "screen_id": definition["screen_id"],
                    "template_case_id": definition["template_case_id"],
                    "layout": definition["presentation"]["layout"],
                    "shape": definition["presentation"]["shape"],
                    "card": definition["presentation"]["card"],
                },
            },
            "selector_surface": {
                "kind": selector_kind,
                "visibility": visibility,
                "generic_callable": generic_callable,
                "query_only": selector_kind == "query",
                "classification": mapping["classification"],
                "read_only": definition["input"]["read_only"],
                "failure_behavior": definition["failure_behavior"],
            },
            "upstream": {
                "method": mapping["route"]["method"],
                "path": mapping["operation"]["upstream_path"],
            },
        }
    return contracts


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
    routing_source: dict[str, Any],
    routing_registry: dict[str, OperationRouting],
    routing_equivalence_groups: dict[str, dict[str, Any]],
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
        "from athena_api.routing_contract import (",
        "    ActionKind,",
        "    CapabilityKind,",
        "    FeedKind,",
        "    FinancingKind,",
        "    BindingRole,",
        "    DataIntent,",
        "    EntityKind,",
        "    ExecutionKind,",
        "    Measure,",
        "    OperationRouting,",
        "    RoutingResultShape,",
        "    RoutingSubject,",
        "    TemporalScope,",
        ")",
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
            f"ROUTING_SOURCE_VERSION = {routing_source['version']!r}",
            f"ROUTING_CONTRACT_VERSION = {routing_source['contract_version']!r}",
            f"QUERY_FRAME_VERSION = {routing_source['query_frame_version']!r}",
            "ROUTING_REGISTRY: dict[str, OperationRouting] = {",
        ]
    )
    for operation_ref, routing in routing_registry.items():
        def enum_tuple(enum_name: str, values: tuple[Any, ...]) -> str:
            rendered = ", ".join(f"{enum_name}.{value.name}" for value in values)
            if len(values) == 1:
                rendered += ","
            return f"({rendered})"

        lines.append(
            f"    {operation_ref!r}: OperationRouting("
            f"subject=RoutingSubject.{routing.subject.name}, "
            f"entity_kinds={enum_tuple('EntityKind', routing.entity_kinds)}, "
            f"execution=ExecutionKind.{routing.execution.name}, "
            f"data_intents={enum_tuple('DataIntent', routing.data_intents)}, "
            f"temporal_scopes={enum_tuple('TemporalScope', routing.temporal_scopes)}, "
            f"measures={enum_tuple('Measure', routing.measures)}, "
            f"result_shapes={enum_tuple('RoutingResultShape', routing.result_shapes)}, "
            f"bindings={enum_tuple('BindingRole', routing.bindings)}, "
            f"actions={enum_tuple('ActionKind', routing.actions)}, "
            f"financing={enum_tuple('FinancingKind', routing.financing)}, "
            f"capabilities={enum_tuple('CapabilityKind', routing.capabilities)}, "
            f"feeds={enum_tuple('FeedKind', routing.feeds)}),"
        )
    lines.extend(
        [
            "}",
            f"ROUTING_EQUIVALENCE_GROUPS: dict[str, dict[str, Any]] = {routing_equivalence_groups!r}",
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


AITS_CHART_RENDERER_ID = "aits-chart-v1"
AITS_CHART_PERIODS = frozenset({"tick", "min", "day", "week", "month", "year"})
AITS_CHART_TARGETS = frozenset({"stock", "sector", "gold"})
AITS_CHART_SERIES_SCOPES = frozenset({"standard", "generic", "today"})
_AITS_RELOAD_GROUP_SCOPE = {
    ("stock", "stock"): "standard",
    ("sector", "sector"): "standard",
    ("gold", "gold-generic"): "generic",
    ("gold", "gold-today"): "today",
}
_LEGACY_PERIOD_CONTROL = {
    "day": "D",
    "week": "W",
    "month": "M",
    "year": "Y",
}


def load_aits_chart_contracts(
    operations: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Load and validate the sole chart-routing/projection authority.

    Inventory names, domains, layouts, and response shapes never opt an operation into
    chart rendering.  A checked-in contract row must name every semantic and field path.
    """
    source = json.loads(
        AITS_CHART_CONTRACTS_PATH.read_text(encoding="utf-8"),
        object_pairs_hook=_reject_duplicate_keys,
    )
    if set(source) != {"version", "renderer_id", "contracts"}:
        raise ValueError("AITS chart contract source has unexpected keys")
    if source["version"] != "aits-chart-contracts-v1":
        raise ValueError("Unsupported AITS chart contract source version")
    if source["renderer_id"] != AITS_CHART_RENDERER_ID:
        raise ValueError("AITS chart renderer identity drift")
    rows = source["contracts"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("AITS chart contract source is empty")
    required_keys = {
        "tr_id",
        "period",
        "target",
        "series_scope",
        "reload_group",
        "container_alias",
        "time_alias",
        "open_alias",
        "high_alias",
        "low_alias",
        "close_alias",
        "volume_alias",
    }
    operation_by_id = {operation["id"]: operation for operation in operations}
    contracts: dict[str, dict[str, Any]] = {}
    reload_keys: dict[tuple[str, str, str], str] = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != required_keys:
            raise ValueError("AITS chart contract row is incomplete")
        tr_id = row["tr_id"]
        if not isinstance(tr_id, str) or tr_id in contracts:
            raise ValueError(f"Duplicate or invalid AITS chart operation: {tr_id!r}")
        operation = operation_by_id.get(tr_id)
        if operation is None or operation["kind"] != "query":
            raise ValueError(f"Unknown/non-query AITS chart operation: {tr_id!r}")
        if (
            row["period"] not in AITS_CHART_PERIODS
            or row["target"] not in AITS_CHART_TARGETS
            or row["series_scope"] not in AITS_CHART_SERIES_SCOPES
            or _AITS_RELOAD_GROUP_SCOPE.get((row["target"], row["reload_group"]))
            != row["series_scope"]
        ):
            raise ValueError(f"Invalid AITS chart semantics for {tr_id}")
        reload_key = (row["target"], row["reload_group"], row["period"])
        prior = reload_keys.get(reload_key)
        if prior is not None:
            raise ValueError(
                f"Ambiguous AITS chart reload target: {reload_key}/{prior}/{tr_id}"
            )
        reload_keys[reload_key] = tr_id
        response = field_aliases(operation.get("resp_body", []))
        container = next(
            (
                item
                for item in response["data"]
                if item["container_alias"] == row["container_alias"]
            ),
            None,
        )
        if container is None:
            raise ValueError(f"AITS chart container does not exist for {tr_id}")
        declared = set(container["field_aliases"])
        aliases = {
            row[key]
            for key in (
                "time_alias",
                "open_alias",
                "high_alias",
                "low_alias",
                "close_alias",
            )
        }
        if row["volume_alias"] is not None:
            aliases.add(row["volume_alias"])
        if not aliases <= declared:
            raise ValueError(f"AITS chart fields do not exist for {tr_id}")
        contracts[tr_id] = row
    if len(contracts) != 19:
        raise ValueError(f"Unexpected AITS chart contract count: {len(contracts)}")
    return contracts


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


def screen_reference(mapping: dict[str, Any]) -> dict[str, str]:
    """Return the stable common-template/Paper join for one mapping."""
    case_id = (
        "C1"
        if mapping["presentation"].get("renderer_id") == "aits-chart-v1"
        else classify_screen_case(mapping)
    )
    case = next(case for case in SCREEN_TEMPLATE_CASES if case["id"] == case_id)
    return {
        "screen_id": f"{COMMON_SCREEN_PAPER_FAMILY_ID}:{case_id}",
        "template_case_id": case_id,
        "card": case["card"],
        "paper_artboard": COMMON_SCREEN_PAPER_ARTBOARD_BY_CARD[case["card"]],
    }


def _container_aliases(response_fields: dict[str, Any]) -> set[str]:
    return {
        container["container_alias"]
        for container in response_fields.get("data", [])
        if container.get("container_alias")
    }


def _field_path(container_alias: str | None, alias: str) -> str:
    return f"$.{alias}" if container_alias is None else f"$.{container_alias}[*].{alias}"


def _source_field_metadata(tr: dict[str, Any], *, request: bool) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    for item in tr.get("req_body" if request else "resp_body", []):
        if not item.get("type"):
            continue
        alias = str(item.get("element", "")).lstrip("- ").strip()
        if not alias:
            continue
        metadata[alias] = {
            "label": item.get("kor") or alias,
            "source_type": item.get("type") or None,
            "required": item.get("required") == "Y",
            "description": item.get("desc") or None,
        }
    return metadata


def _display_field(
    alias: str,
    *,
    container_alias: str | None,
    source_metadata: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    metadata = source_metadata.get(alias, {})
    return {
        "path": _field_path(container_alias, alias),
        "alias": alias,
        "label": metadata.get("label", alias),
        "label_source": "kiwoom-tr-inventory.kor",
        "source_type": metadata.get("source_type"),
        "source_required": bool(metadata.get("required", False)),
        "unit": None,
        "formatter": FORMATTER_BY_ALIAS.get(alias, "plain_text"),
        "null": "empty_cell",
        "empty_string": "empty_cell",
        "missing": "contract_error",
        "visible": True,
    }


def build_read_data_contract(
    mapping: dict[str, Any],
    source_metadata: dict[str, dict[str, Any]],
    chart_source: dict[str, Any] | None,
    chart_reload_targets: dict[str, Any] | None,
) -> dict[str, Any]:
    """Materialize the exact response allowlist and bounded display policy.

    The contract deliberately distinguishes a declared temporal field from source-order data.
    No runtime key scanning or array-end heuristic is permitted.
    """
    response_fields = mapping["fields"]["response"]
    container_aliases = _container_aliases(response_fields)
    scalar_aliases = [
        alias
        for alias in response_fields.get("top_level", [])
        if alias not in container_aliases and alias not in DISPLAY_EXCLUDED_ALIASES
    ]
    scalar_fields = [
        _display_field(alias, container_alias=None, source_metadata=source_metadata)
        for alias in scalar_aliases
    ]
    containers: list[dict[str, Any]] = []
    temporal_paths: list[str] = []
    for container in response_fields.get("data", []):
        container_alias = container["container_alias"]
        aliases = [
            alias
            for alias in container.get("field_aliases", [])
            if alias not in DISPLAY_EXCLUDED_ALIASES
        ]
        priority = [
            alias
            for alias in container.get("column_priority", aliases)
            if alias in aliases
        ]
        temporal_alias = next(
            (alias for alias in TEMPORAL_FIELD_PRIORITY if alias in aliases),
            None,
        )
        temporal_path = (
            _field_path(container_alias, temporal_alias) if temporal_alias is not None else None
        )
        if temporal_path is not None:
            temporal_paths.append(temporal_path)
        containers.append(
            {
                "path": f"$.{container_alias}",
                "container_alias": container_alias,
                "field_allowlist": aliases,
                "fields": [
                    _display_field(
                        alias,
                        container_alias=container_alias,
                        source_metadata=source_metadata,
                    )
                    for alias in aliases
                ],
                "column_priority": priority,
                "fixed_columns": [alias for alias in priority if alias in IDENTITY_ALIASES],
                "temporal_field_path": temporal_path,
            }
        )

    is_chart = chart_source is not None
    primary_time_path = temporal_paths[0] if temporal_paths else None
    if not containers:
        range_contract = {
            "mode": "all_allowlisted_scalars",
            "default_rows": 1,
            "max_rows": 1,
            "continuation": "not_applicable",
        }
    elif is_chart:
        range_contract = {
            "mode": "latest_bounded_window" if primary_time_path else "bounded_source_order",
            "default_rows": 240,
            "max_rows": 240,
            "continuation": "explicit_period_or_page_only",
        }
    else:
        range_contract = {
            "mode": "latest_bounded_window" if primary_time_path else "bounded_source_order",
            "default_rows": 10,
            "max_rows": 20,
            "continuation": "explicit_next_page_only",
        }

    if primary_time_path:
        time_contract = {
            "basis": "declared_response_field",
            "field_path": primary_time_path,
            "timezone": "Asia/Seoul",
            "invalid_or_missing": "contract_error_no_latest_claim",
        }
        sort_contract = {
            "keys": [primary_time_path, "$source_index"],
            "direction": "descending",
            "tie_breaker": "$source_index:ascending",
        }
    else:
        time_contract = {
            "basis": "not_declared",
            "field_path": None,
            "timezone": None,
            "invalid_or_missing": "preserve_source_order_no_latest_claim",
        }
        sort_contract = {
            "keys": ["$source_index"],
            "direction": "preserve_source_order",
            "tie_breaker": "$source_index:ascending",
        }

    chart_contract = None
    if is_chart:
        assert chart_source is not None
        if not chart_reload_targets:
            raise ValueError(f"Missing chart reload targets for {mapping['mapping_id']}")
        chart_container = next(
            (
                container
                for container in containers
                if container["container_alias"] == chart_source["container_alias"]
            ),
            None,
        )
        if chart_container is None:
            raise ValueError(f"Missing chart container for {mapping['mapping_id']}")
        aliases = set(chart_container["field_allowlist"])
        contract_aliases = {
            chart_source[key]
            for key in (
                "time_alias",
                "open_alias",
                "high_alias",
                "low_alias",
                "close_alias",
            )
        }
        volume_alias = chart_source.get("volume_alias")
        if volume_alias is not None:
            contract_aliases.add(volume_alias)
        if not contract_aliases <= aliases:
            raise ValueError(f"Incomplete chart field contract for {mapping['mapping_id']}")
        container_alias = chart_container["container_alias"]
        chart_contract = {
            "trId": chart_source["tr_id"],
            "period": chart_source["period"],
            "target": chart_source["target"],
            "series_scope": chart_source["series_scope"],
            "reload_group": chart_source["reload_group"],
            "reload_targets": chart_reload_targets,
            "container_path": chart_container["path"],
            "time_path": _field_path(container_alias, chart_source["time_alias"]),
            "ohlcv": {
                "open": _field_path(container_alias, chart_source["open_alias"]),
                "high": _field_path(container_alias, chart_source["high_alias"]),
                "low": _field_path(container_alias, chart_source["low_alias"]),
                "close": _field_path(container_alias, chart_source["close_alias"]),
                "volume": (
                    _field_path(container_alias, volume_alias)
                    if volume_alias is not None
                    else None
                ),
            },
        }

    return {
        "container_paths": [container["path"] for container in containers],
        "scalar_field_allowlist": scalar_aliases,
        "scalar_fields": scalar_fields,
        "containers": containers,
        "excluded_aliases": sorted(DISPLAY_EXCLUDED_ALIASES),
        "unexpected_field": "drop_and_record_contract_error",
        "time": time_contract,
        "sort": sort_contract,
        "range": range_contract,
        "chart": chart_contract,
    }


def presentation_slots(mapping: dict[str, Any], data_contract: dict[str, Any] | None) -> list[dict[str, Any]]:
    case_id = mapping["screen_reference"]["template_case_id"]
    if case_id in {"F1", "F2"}:
        return [{"slot_id": "facts", "source": "scalar_fields"}]
    if case_id in {"T1", "T2", "T3"}:
        return [{"slot_id": "table", "source": "containers[0]"}]
    if case_id == "T4":
        return [
            {"slot_id": "header_facts", "source": "scalar_fields"},
            {"slot_id": "table", "source": "containers[0]"},
        ]
    if case_id == "C1":
        return [
            {"slot_id": "header_facts", "source": "scalar_fields"},
            {"slot_id": "chart", "source": "chart"},
            {"slot_id": "period_controls", "source": "presentation.controls"},
        ]
    if case_id == "C2":
        return [
            {"slot_id": "header_facts", "source": "scalar_fields"},
            {"slot_id": "table", "source": "containers[0]"},
        ]
    if case_id in {"E1", "E2", "E3"}:
        return [
            {"slot_id": "subscription_status", "source": "workflow.lifecycle"},
            {"slot_id": "bounded_event_log", "source": "workflow.display_allowlist"},
        ]
    if case_id == "A1":
        return [
            {"slot_id": "order_status", "source": "workflow.lifecycle"},
            {"slot_id": "receipt", "source": "workflow.display_allowlist"},
        ]
    if case_id == "S1":
        return [{"slot_id": "auth_status", "source": "workflow.lifecycle"}]
    raise ValueError(f"Unknown screen template case {case_id!r}")


def build_workflow_contract(mapping: dict[str, Any]) -> dict[str, Any]:
    category = mapping["classification"]["category"]
    response_fields = mapping["fields"]["response"]
    container_aliases = _container_aliases(response_fields)
    scalar_allowlist = [
        alias
        for alias in response_fields.get("top_level", [])
        if alias not in container_aliases and alias not in DISPLAY_EXCLUDED_ALIASES
    ]
    container_allowlist = {
        container["container_alias"]: [
            alias
            for alias in container.get("field_aliases", [])
            if alias not in DISPLAY_EXCLUDED_ALIASES
        ]
        for container in response_fields.get("data", [])
    }
    guards = {
        "websocket": {
            "allowed_actions": ["start", "stop"],
            "bounded_event_log": True,
            "chat_frame_dump": False,
        },
        "order": {
            "allowed_actions": [],
            "display_only": True,
            "auto_execute": False,
            "explicit_confirmation_owned_by": "chat_order_confirmation_mode",
        },
        "oauth": {
            "allowed_actions": [],
            "credential_values_in_document": False,
            "token_values_in_document": False,
        },
    }[category]
    return {
        "workflow": mapping["classification"]["workflow"],
        "lifecycle": list(WORKFLOW_LIFECYCLE_BY_CATEGORY[category]),
        "display_allowlist": {
            "top_level": scalar_allowlist,
            "containers": container_allowlist,
        },
        "excluded_aliases": sorted(DISPLAY_EXCLUDED_ALIASES),
        "states": list(COMMON_RESULT_STATES),
        "guards": guards,
        "failure_behavior": "fail_closed_no_read_card_fallback",
    }


def build_follow_up_contract(
    mapping: dict[str, Any],
    *,
    data_contract: dict[str, Any] | None,
    workflow: dict[str, Any] | None,
    sibling_mapping_ids: list[str],
    title_by_mapping_id: dict[str, str],
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Build only executable, catalog-backed follow-ups; never fill to three by prose."""
    mapping_id = mapping["mapping_id"]
    tr_id = mapping["operation"]["tr_id"]
    category = mapping["classification"]["category"]
    candidates: list[dict[str, Any]] = []

    def add(
        follow_up_id: str,
        label: str,
        target_intent: str,
        *,
        target_operation_ref: str,
        parameter_binding: dict[str, Any],
        precondition: str,
        safety: str = "read_only",
    ) -> None:
        candidates.append(
            {
                "follow_up_id": follow_up_id,
                "label": label,
                "target_intent": target_intent,
                "target_operation_ref": target_operation_ref,
                "allowed_operation_family": tr_id,
                "parameter_binding": parameter_binding,
                "precondition": precondition,
                "safety": safety,
            }
        )

    if category == "read_display" and data_contract is not None:
        controls = mapping["presentation"].get("controls", {})
        default_period = controls.get("default_period")
        if default_period:
            alternate_period = "W" if default_period != "W" else "D"
            add(
                f"{mapping_id}:period:{alternate_period}",
                f"{alternate_period} 기간으로 보기",
                "chart_period_change",
                target_operation_ref=mapping_id,
                parameter_binding={"period": alternate_period},
                precondition=f"period_allowed:{alternate_period}",
            )
        if data_contract["time"]["basis"] == "declared_response_field":
            add(
                f"{mapping_id}:previous_period",
                "이전 기간 보기",
                "previous_period",
                target_operation_ref=mapping_id,
                parameter_binding={
                    "range_end": "$current_range.start_exclusive",
                    "range_size": "$current_range.size",
                },
                precondition="current_range_present",
            )
        if data_contract["containers"]:
            add(
                f"{mapping_id}:next_page",
                "다음 항목 보기",
                "next_page",
                target_operation_ref=mapping_id,
                parameter_binding={
                    "cont_yn": "Y",
                    "next_key": "$receipt.next_key",
                },
                precondition="receipt.next_key_present",
            )
        for sibling_id in sibling_mapping_ids:
            if sibling_id == mapping_id:
                continue
            add(
                f"{mapping_id}:detail:{sibling_id.rsplit(':', 1)[-1]}",
                f"{title_by_mapping_id[sibling_id]} 보기",
                "detail_group_switch",
                target_operation_ref=sibling_id,
                parameter_binding={
                    "detail_group": sibling_id.rsplit(":", 1)[-1],
                    "request_args": "$original_request_args",
                },
                precondition=f"selector_allows:{sibling_id}",
            )
            if len(candidates) >= 3:
                break
    elif category == "websocket" and workflow is not None:
        add(
            f"{mapping_id}:stop_subscription",
            "실시간 수신 중지",
            "stop_subscription",
            target_operation_ref=mapping_id,
            parameter_binding={"action": "stop", "subscription_id": "$active_subscription.id"},
            precondition="active_subscription_matches_operation",
            safety="active_subscription_stop_only",
        )

    allowlist = candidates[:3]
    if allowlist:
        coverage = {
            "status": "available",
            "reason": "catalog_backed_safe_candidates",
        }
    else:
        reason = {
            "order": "guarded_order_follow_ups_prohibited",
            "oauth": "hidden_oauth_follow_ups_prohibited",
            "read_display": "no_declared_range_page_or_sibling_target",
        }.get(category, "no_safe_executable_candidate")
        coverage = {"status": "intentionally_empty", "reason": reason}
    return allowlist, coverage


def build_chart_reload_targets(
    manifest: dict[str, Any],
    chart_contracts: dict[str, dict[str, Any]],
) -> dict[str, dict[str, dict[str, Any]]]:
    """Build one unambiguous period target table per reviewed reload group."""
    base_by_tr = {
        mapping["operation"]["tr_id"]: mapping
        for mapping in manifest["mappings"]
        if mapping["mapping_type"] == "base"
    }
    grouped: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for tr_id, contract in chart_contracts.items():
        mapping = base_by_tr.get(tr_id)
        if mapping is None:
            raise ValueError(f"AITS reload target has no base mapping: {tr_id}")
        request = mapping["fields"]["request"]
        request_fields = list(request.get("top_level", []))
        request_fields.extend(
            alias
            for container in request.get("data", [])
            for alias in container.get("field_aliases", [])
        )
        group_key = (contract["target"], contract["reload_group"])
        targets = grouped.setdefault(group_key, {})
        period = contract["period"]
        if period in targets:
            raise ValueError(f"Ambiguous AITS reload period: {group_key}/{period}")
        targets[period] = {
            "operation_ref": f"base:{tr_id}",
            "request_fields": request_fields,
        }
    return {
        tr_id: grouped[(contract["target"], contract["reload_group"])]
        for tr_id, contract in chart_contracts.items()
    }


def build_screen_definitions(
    manifest: dict[str, Any],
    operations: list[dict[str, Any]],
    projections: dict[str, Any],
    chart_contracts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Generate the complete 301-mapping common-screen contract."""
    reload_targets_by_tr = build_chart_reload_targets(manifest, chart_contracts)
    templates = []
    for case in SCREEN_TEMPLATE_CASES:
        artboard = COMMON_SCREEN_PAPER_ARTBOARD_BY_CARD[case["card"]]
        templates.append(
            {
                "screen_id": f"{COMMON_SCREEN_PAPER_FAMILY_ID}:{case['id']}",
                "template_case_id": case["id"],
                "card": case["card"],
                "name": case["name"],
                "classification_rule": case["rule"],
                "paper": {
                    "document": COMMON_SCREEN_PAPER_DOCUMENT,
                    "family_id": COMMON_SCREEN_PAPER_FAMILY_ID,
                    "artboard": artboard,
                    "states_artboard": COMMON_SCREEN_STATES_ARTBOARD,
                    "workflows_artboard": (
                        COMMON_SCREEN_WORKFLOWS_ARTBOARD
                        if case["card"] in {"EventCard", "ActionCard", "StatusCard"}
                        else None
                    ),
                },
            }
        )

    definitions = []
    operation_by_id = {operation["id"]: operation for operation in operations}
    projection_titles = {
        (projection["tr_id"], group["id"]): group.get("title_ko")
        for projection in projections["projections"]
        for group in projection["groups"]
    }
    title_by_mapping_id: dict[str, str] = {}
    siblings_by_tr: dict[str, list[str]] = {}
    for mapping in manifest["mappings"]:
        tr_id = mapping["operation"]["tr_id"]
        tr = operation_by_id[tr_id]
        title_by_mapping_id[mapping["mapping_id"]] = (
            projection_titles.get((tr_id, mapping["operation"].get("detail_group_id")))
            if mapping["mapping_type"] == "split_derived"
            else tr.get("name")
        ) or mapping["mapping_id"]
        siblings_by_tr.setdefault(tr_id, []).append(mapping["mapping_id"])
    for sibling_ids in siblings_by_tr.values():
        sibling_ids.sort()

    for mapping in manifest["mappings"]:
        category = mapping["classification"]["category"]
        tr = operation_by_id[mapping["operation"]["tr_id"]]
        source_metadata = _source_field_metadata(tr, request=False)
        data_contract = (
            build_read_data_contract(
                mapping,
                source_metadata,
                chart_contracts.get(mapping["operation"]["tr_id"])
                if mapping["mapping_type"] == "base"
                else None,
                reload_targets_by_tr.get(mapping["operation"]["tr_id"])
                if mapping["mapping_type"] == "base"
                else None,
            )
            if category == "read_display"
            else None
        )
        workflow = None if category == "read_display" else build_workflow_contract(mapping)
        controls = mapping["presentation"].get("controls", {})
        title = title_by_mapping_id[mapping["mapping_id"]]
        follow_up_allowlist, follow_up_coverage = build_follow_up_contract(
            mapping,
            data_contract=data_contract,
            workflow=workflow,
            sibling_mapping_ids=siblings_by_tr[mapping["operation"]["tr_id"]],
            title_by_mapping_id=title_by_mapping_id,
        )
        definition = {
            "definition_id": f"screen:{mapping['mapping_id']}",
            "mapping_id": mapping["mapping_id"],
            "operation_ref": mapping["mapping_id"],
            "screen_id": mapping["screen_reference"]["screen_id"],
            "template_case_id": mapping["screen_reference"]["template_case_id"],
            "category": category,
            "title": title,
            "presentation": {
                "shape": mapping["presentation"]["shape"],
                "layout": mapping["presentation"]["layout"],
                "renderer_id": mapping["presentation"].get("renderer_id"),
                "card": mapping["screen_reference"]["card"],
                "component_slots": presentation_slots(mapping, data_contract),
                "controls": {
                    "default_period": controls.get("default_period"),
                    "allowed_periods": (
                        ["D", "W", "M", "Y"] if controls.get("default_period") else []
                    ),
                    "pagination": bool(data_contract and data_contract["containers"]),
                },
            },
            "input": {
                "field_allowlist": mapping["fields"]["request"],
                "continuation": {
                    "cont_yn": "header_owned",
                    "next_key": "header_owned",
                },
                "read_only": mapping["classification"]["read"],
            },
            "data": data_contract,
            "workflow": workflow,
            "states": list(
                dict.fromkeys(
                    READ_STATES_BY_LAYOUT[mapping["presentation"]["layout"]]
                    if category == "read_display"
                    else workflow["states"] + workflow["lifecycle"]
                )
            ),
            "follow_up_allowlist": follow_up_allowlist,
            "follow_up_coverage": follow_up_coverage,
            "accessibility": {
                "read_order": [slot["slot_id"] for slot in presentation_slots(mapping, data_contract)],
                "keyboard": "approved_template_controls_only",
                "screen_reader_label": title,
                "screen_reader_label_source": "inventory_or_projection_title",
            },
            "failure_behavior": "coverage_error_no_generic_or_free_fallback",
            "provenance": {
                "manifest": "ref/kiwoom-common-screen-manifest.json",
                "aits_chart_contract": (
                    "ref/aits-chart-contracts.json"
                    if mapping["presentation"].get("renderer_id")
                    == AITS_CHART_RENDERER_ID
                    else None
                ),
            },
        }
        definitions.append(definition)

    result = {
        "version": 1,
        "description": "Generated machine-readable Kiwoom common-screen and guarded-workflow contracts.",
        "sources": {
            "manifest": "ref/kiwoom-common-screen-manifest.json",
            "aits_chart_contracts": "ref/aits-chart-contracts.json",
            "case_matrix_generator": "scripts/render_screen_case_matrix.py",
        },
        "policy": {
            "decision_path": "operation_ref -> manifest presentation -> screen definition",
            "no_runtime_shape_or_field_heuristics": True,
            "missing_contract": "fail_closed",
            "generic_or_free_fallback": False,
            "follow_up_max": 3,
        },
        "counts": {
            "templates": len(templates),
            "definitions": len(definitions),
            "categories": manifest["counts"]["categories"],
        },
        "templates": templates,
        "definitions": definitions,
    }
    validate_screen_definitions(manifest, result)
    return result


def validate_screen_definitions(manifest: dict[str, Any], screen_definitions: dict[str, Any]) -> None:
    """Fail generation on missing, duplicate, free-fallback, or orphan screen contracts."""
    expected_counts = {
        "templates": 13,
        "definitions": 301,
        "categories": {"read_display": 264, "websocket": 23, "order": 12, "oauth": 2},
    }
    if screen_definitions.get("counts") != expected_counts:
        raise ValueError(f"Unexpected screen-definition counts: {screen_definitions.get('counts')}")
    if screen_definitions.get("policy", {}).get("generic_or_free_fallback") is not False:
        raise ValueError("Kiwoom screen definitions must forbid generic/free fallback")
    templates = screen_definitions.get("templates", [])
    definitions = screen_definitions.get("definitions", [])
    template_ids = [template["screen_id"] for template in templates]
    case_ids = [template["template_case_id"] for template in templates]
    if len(template_ids) != len(set(template_ids)) or len(case_ids) != len(set(case_ids)):
        raise ValueError("Screen template IDs and case IDs must be unique")
    if set(case_ids) != {case["id"] for case in SCREEN_TEMPLATE_CASES}:
        raise ValueError("Screen templates do not match the approved 13 common cases")

    manifest_ids = {mapping["mapping_id"] for mapping in manifest["mappings"]}
    definition_ids = [definition["definition_id"] for definition in definitions]
    definition_mapping_ids = [definition["mapping_id"] for definition in definitions]
    if len(definition_ids) != len(set(definition_ids)):
        raise ValueError("Screen definition IDs must be unique")
    if set(definition_mapping_ids) != manifest_ids or len(definition_mapping_ids) != len(manifest_ids):
        raise ValueError("Orphan or duplicate mapping/screen definition detected")
    used_screens = {definition["screen_id"] for definition in definitions}
    if used_screens != set(template_ids):
        raise ValueError("Orphan or unused screen template detected")

    manifest_by_id = {mapping["mapping_id"]: mapping for mapping in manifest["mappings"]}
    required_display_states = {"loading", "empty", "partial", "stale", "timeout", "error"}
    for definition in definitions:
        mapping = manifest_by_id[definition["mapping_id"]]
        if definition["operation_ref"] != definition["mapping_id"]:
            raise ValueError(f"Operation reference drift for {definition['mapping_id']}")
        if definition["screen_id"] != mapping["screen_reference"]["screen_id"]:
            raise ValueError(f"Screen reference drift for {definition['mapping_id']}")
        manifest_renderer = mapping["presentation"].get("renderer_id")
        definition_renderer = definition["presentation"].get("renderer_id")
        if definition_renderer != manifest_renderer:
            raise ValueError(f"Renderer identity drift for {definition['mapping_id']}")
        if definition["failure_behavior"] != "coverage_error_no_generic_or_free_fallback":
            raise ValueError(f"Free fallback enabled for {definition['mapping_id']}")
        if not definition.get("title") or not definition["accessibility"].get(
            "screen_reader_label"
        ):
            raise ValueError(f"Missing screen/accessibility label for {definition['mapping_id']}")
        if not required_display_states <= set(definition.get("states", [])):
            raise ValueError(f"Incomplete display states for {definition['mapping_id']}")
        follow_ups = definition.get("follow_up_allowlist")
        if not isinstance(follow_ups, list) or len(follow_ups) > 3:
            raise ValueError(f"Invalid follow-up allowlist for {definition['mapping_id']}")
        follow_up_coverage = definition.get("follow_up_coverage")
        if not isinstance(follow_up_coverage, dict) or follow_up_coverage.get("status") not in {
            "available",
            "intentionally_empty",
        } or not follow_up_coverage.get("reason"):
            raise ValueError(f"Missing follow-up coverage status for {definition['mapping_id']}")
        if bool(follow_ups) != (follow_up_coverage["status"] == "available"):
            raise ValueError(f"Follow-up coverage/list drift for {definition['mapping_id']}")
        follow_up_ids = [follow_up["follow_up_id"] for follow_up in follow_ups]
        if len(follow_up_ids) != len(set(follow_up_ids)):
            raise ValueError(f"Duplicate follow-up IDs for {definition['mapping_id']}")
        for follow_up in follow_ups:
            required_follow_up_keys = {
                "follow_up_id",
                "label",
                "target_intent",
                "target_operation_ref",
                "allowed_operation_family",
                "parameter_binding",
                "precondition",
                "safety",
            }
            if set(follow_up) != required_follow_up_keys:
                raise ValueError(f"Incomplete follow-up for {definition['mapping_id']}")
            target_ref = follow_up["target_operation_ref"]
            if target_ref not in manifest_by_id:
                raise ValueError(f"Invented follow-up target {target_ref!r}")
            if (
                manifest_by_id[target_ref]["operation"]["tr_id"]
                != follow_up["allowed_operation_family"]
            ):
                raise ValueError(f"Follow-up family drift for {definition['mapping_id']}")
        if definition["category"] in {"order", "oauth"} and follow_ups:
            raise ValueError(f"Unsafe guarded follow-up for {definition['mapping_id']}")
        if definition["category"] == "websocket" and any(
            follow_up["target_intent"] != "stop_subscription"
            or follow_up["safety"] != "active_subscription_stop_only"
            for follow_up in follow_ups
        ):
            raise ValueError(f"Unsafe WebSocket follow-up for {definition['mapping_id']}")
        if definition["category"] == "read_display":
            data = definition.get("data")
            if not data or definition.get("workflow") is not None:
                raise ValueError(f"Missing read data contract for {definition['mapping_id']}")
            required_data_keys = {
                "container_paths",
                "scalar_field_allowlist",
                "scalar_fields",
                "containers",
                "excluded_aliases",
                "unexpected_field",
                "time",
                "sort",
                "range",
                "chart",
            }
            if set(data) != required_data_keys:
                raise ValueError(f"Incomplete read data contract for {definition['mapping_id']}")
            chart = data["chart"]
            if manifest_renderer == AITS_CHART_RENDERER_ID:
                if not isinstance(chart, dict) or set(chart) != {
                    "trId",
                    "period",
                    "target",
                    "series_scope",
                    "reload_group",
                    "reload_targets",
                    "container_path",
                    "time_path",
                    "ohlcv",
                }:
                    raise ValueError(f"Incomplete AITS chart contract for {definition['mapping_id']}")
                if (
                    chart["trId"] != mapping["operation"]["tr_id"]
                    or chart["period"] not in AITS_CHART_PERIODS
                    or chart["target"] not in AITS_CHART_TARGETS
                    or chart["series_scope"] not in AITS_CHART_SERIES_SCOPES
                    or _AITS_RELOAD_GROUP_SCOPE.get(
                        (chart["target"], chart["reload_group"])
                    )
                    != chart["series_scope"]
                    or not isinstance(chart["reload_targets"], dict)
                    or chart["period"] not in chart["reload_targets"]
                    or not isinstance(chart["container_path"], str)
                    or not isinstance(chart["time_path"], str)
                    or not isinstance(chart["ohlcv"], dict)
                    or set(chart["ohlcv"]) != {"open", "high", "low", "close", "volume"}
                    or any(
                        not isinstance(chart["ohlcv"][key], str)
                        for key in ("open", "high", "low", "close")
                    )
                    or (
                        chart["ohlcv"]["volume"] is not None
                        and not isinstance(chart["ohlcv"]["volume"], str)
                    )
                ):
                    raise ValueError(f"Invalid AITS chart contract for {definition['mapping_id']}")
                for period, target in chart["reload_targets"].items():
                    if (
                        period not in AITS_CHART_PERIODS
                        or not isinstance(target, dict)
                        or set(target) != {"operation_ref", "request_fields"}
                        or not isinstance(target["operation_ref"], str)
                        or target["operation_ref"] not in manifest_by_id
                        or not isinstance(target["request_fields"], list)
                        or not all(
                            isinstance(field, str) and field
                            for field in target["request_fields"]
                        )
                    ):
                        raise ValueError(
                            f"Invalid AITS reload target for {definition['mapping_id']}/{period}"
                        )
                    target_mapping = manifest_by_id[target["operation_ref"]]
                    target_definition = next(
                        item
                        for item in definitions
                        if item["mapping_id"] == target["operation_ref"]
                    )
                    target_chart = target_definition["data"]["chart"]
                    if (
                        target_mapping["presentation"].get("renderer_id")
                        != AITS_CHART_RENDERER_ID
                        or target_chart["target"] != chart["target"]
                        or target_chart["reload_group"] != chart["reload_group"]
                        or target_chart["period"] != period
                    ):
                        raise ValueError(
                            f"AITS reload target drift for {definition['mapping_id']}/{period}"
                        )
            elif chart is not None:
                raise ValueError(f"Non-AITS screen carries chart data for {definition['mapping_id']}")
            if not definition["presentation"]["component_slots"] or not definition["states"]:
                raise ValueError(f"Incomplete presentation/state contract for {definition['mapping_id']}")
            for container in data["containers"]:
                if not container["field_allowlist"] or not container["column_priority"]:
                    raise ValueError(f"Empty container allowlist for {definition['mapping_id']}")
                if set(container["column_priority"]) != set(container["field_allowlist"]):
                    raise ValueError(f"Column priority drift for {definition['mapping_id']}")
                if any(not field.get("label") for field in container["fields"]):
                    raise ValueError(f"Missing field label for {definition['mapping_id']}")
        else:
            workflow = definition.get("workflow")
            if definition.get("data") is not None or not workflow:
                raise ValueError(f"Missing guarded workflow contract for {definition['mapping_id']}")
            if workflow["failure_behavior"] != "fail_closed_no_read_card_fallback":
                raise ValueError(f"Workflow read-card fallback enabled for {definition['mapping_id']}")


def build_common_screen_manifest(
    operations: list[dict[str, Any]],
    projections: dict[str, Any],
    output_profile: dict[str, Any],
    chart_contracts: dict[str, dict[str, Any]],
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
        chart_source = chart_contracts.get(tr["id"])
        presentation: dict[str, Any] = {
            "shape": shape,
            "layout": base_layout(tr["kind"], shape),
            "renderer_id": (
                AITS_CHART_RENDERER_ID if chart_source is not None else None
            ),
        }
        if chart_source is not None:
            presentation["controls"] = {
                "default_period": _LEGACY_PERIOD_CONTROL.get(chart_source["period"])
            }
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
                "presentation": presentation,
                "classification": workflow_classification(tr["kind"]),
                "contracts": {
                    "request_model": f"athena_api.generated.models.{prefix}Request",
                    "response_model": f"athena_api.generated.models.{prefix}Response",
                },
                "provenance": {
                    **mapping_provenance(tr["id"]),
                    **(
                        {
                            "aits_chart_contract": {
                                "path": "ref/aits-chart-contracts.json",
                                "tr_id": tr["id"],
                                "renderer_id": AITS_CHART_RENDERER_ID,
                            }
                        }
                        if chart_source is not None
                        else {}
                    ),
                },
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
                        "renderer_id": None,
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
        mapping["operation_ref"] = mapping["mapping_id"]
        mapping["screen_reference"] = screen_reference(mapping)

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
            "provenance": {
                "inventory": {
                    "path": "ref/kiwoom-tr-inventory.json",
                    "operation_id": tr_id,
                },
                "response_projection": {
                    "path": "ref/response-projections.json",
                    "tr_id": tr_id,
                },
                "decision": "split-original replaced by generated detail routes",
            },
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
            "aits_chart_contracts": {
                "path": "ref/aits-chart-contracts.json",
                "sha256": hashlib.sha256(AITS_CHART_CONTRACTS_PATH.read_bytes()).hexdigest(),
            },
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
    if any(
        set(entry.get("provenance", {}))
        != {"inventory", "response_projection", "decision"}
        for entry in exclusions
    ):
        raise ValueError("Common-screen exclusions must preserve source provenance")
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
        if mapping.get("operation_ref") != mapping["mapping_id"]:
            raise ValueError(f"Operation reference drift for {mapping['mapping_id']}")
        reference = mapping.get("screen_reference")
        if not reference or reference.get("template_case_id") not in {
            case["id"] for case in SCREEN_TEMPLATE_CASES
        }:
            raise ValueError(f"Missing approved screen reference for {mapping['mapping_id']}")
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


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    inventory = load_inventory()
    operations, counts = classify(inventory)
    chart_contracts = load_aits_chart_contracts(operations)
    projections = json.loads(PROJECTION_MANIFEST_PATH.read_text(encoding="utf-8"))
    routing_source = json.loads(
        ROUTING_SOURCE_PATH.read_text(encoding="utf-8"),
        object_pairs_hook=_reject_duplicate_keys,
    )
    entity_markers = json.loads(ENTITY_MARKER_PATH.read_text(encoding="utf-8"))
    if (
        set(entity_markers) != {"version", "source", "markers"}
        or entity_markers["version"] != "selector-entity-markers-v1"
        or set(entity_markers["markers"]) != {"etf"}
        or not entity_markers["markers"]["etf"]
        or len(entity_markers["markers"]["etf"])
        != len(set(entity_markers["markers"]["etf"]))
    ):
        raise ValueError("selector entity marker reference is invalid")
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
    routing_registry = build_routing_registry(
        operations, projections, output_profile, routing_source
    )
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
        chart_contracts,
        inventory_sha256=inventory_sha256,
        projection_sha256=projection_sha256,
    )
    common_screen_manifest_json = canonical_json(common_screen_manifest)
    screen_definitions = build_screen_definitions(
        common_screen_manifest,
        operations,
        projections,
        chart_contracts,
    )
    screen_definitions_json = canonical_json(screen_definitions)
    equivalence_contracts = build_routing_equivalence_contracts(
        operations,
        projections,
        common_screen_manifest,
        screen_definitions,
    )
    routing_equivalence_groups = validate_routing_equivalence_groups(
        routing_source,
        routing_registry,
        equivalence_contracts,
    )
    outputs = {
        "__init__.py": '"""Inventory-generated API artifacts."""\n',
        "models.py": render_models(operations, projections),
        "registry.py": render_registry(
            operations,
            counts,
            projections,
            output_profile,
            routing_source,
            routing_registry,
            routing_equivalence_groups,
        ),
        "routes.py": render_routes(operations, projections),
    }
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
        if (
            not SCREEN_DEFINITIONS_PATH.is_file()
            or SCREEN_DEFINITIONS_PATH.read_text(encoding="utf-8")
            != screen_definitions_json
        ):
            print(
                "Generated screen definitions are stale: "
                f"{SCREEN_DEFINITIONS_PATH.relative_to(BACKEND)}"
            )
            return 1
        print("Generated files are current")
        return 0
    for name, content in outputs.items():
        write(GENERATED / name, content)
    write(OUTPUT_PROFILE_PATH, output_profile_json)
    write(COMMON_SCREEN_MANIFEST_PATH, common_screen_manifest_json)
    write(SCREEN_DEFINITIONS_PATH, screen_definitions_json)
    expected = {"__init__.py", "models.py", "registry.py", "routes.py", "runtime.py"}
    for stale in GENERATED.glob("*.py"):
        if stale.name not in expected:
            stale.unlink()
    print(
        f"Generated {len(operations)} inventory operations and "
        f"{expected_projection_metadata['route_count']} response projections, "
        f"{common_screen_manifest['counts']['routable']} common-screen mappings and "
        f"{screen_definitions['counts']['templates']} approved screen templates: {counts}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
