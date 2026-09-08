
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import threading
import time
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, model_validator

from athena_api.accounts import account_runtimes

# OptionalOrderClientDep/OptionalWsClientDep는 llm_tools.py가 정의한다 —
# call과 같은 주입 의미론(부재는 주입이 아니라 dispatch에서 에러)을 그대로 쓴다.
from athena_api.api.llm_tools import OptionalOrderClientDep, OptionalWsClientDep
from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket
from athena_api.canvas_card_registry import (
    CanvasCardRegistryError,
    resolve_canvas_card,
)
from athena_api.canvas_field_registry import get_operation_field_contract
from athena_api.canvas_transform import (
    build_aits_chart_envelope_data,
    build_compound_generic,
    build_facts,
    build_table,
    describe_unsupported_render_plan_kind,
    resolve_fixed_card_title,
    resolve_screen_render_contract,
)
from athena_api.hydrate_defaults import (
    chain_for,
    fill_missing_arguments,
    missing_required_aliases,
)
from athena_api.card_surface_contract import (
    attach_surface_contract,
    bind_surface_values,
    build_board_surface_contract,
    json_path_values,
    observation_id_for,
    resolve_section_titles_ko,
)
from athena_api.card_surface_templates import get_registry as get_card_surface_registry
from athena_api.dependencies import (
    AccountAliasDep,
    KiwoomClientDep,
    SelectorServiceDep,
    get_kiwoom_client,
)
from athena_api.errors import KiwoomError, KiwoomNotReadyError
from athena_api.generated.registry import WEBSOCKET_TR_IDS
from athena_api.generated.runtime import call_typed_tr
from athena_api.kiwoom import KiwoomClient
from athena_api.security import require_local_bearer
from athena_api.selector import SelectorService
from athena_api.selector.errors import (
    AmbiguousOperationError,
    DetailGroupRequiredError,
    InvalidArgumentsError,
    NoConfidentMatchError,
    UnknownDetailGroupError,
)
from athena_api.selector.schemas import (
    CallRequest,
    DescribeRequest,
    DiscoveryIntent,
    ResolveRequest,
    SearchRequest,
)
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry
from athena_api.view_recipe_registry import get_view_recipe_registry

logger = logging.getLogger(__name__)

_INLINE_SERVER_BUDGET_MS = 2700

router = APIRouter(tags=["canvas side-channel"])

OptionalDataClientDep = Annotated[KiwoomClient | None, Depends(get_kiwoom_client)]

_ORDER_DRAFT_FIELDS = frozenset(
    {
        "dmst_stex_tp",
        "stk_cd",
        "ord_qty",
        "ord_uv",
        "trde_tp",
        "cond_uv",
        "orig_ord_no",
        "mdfy_qty",
        "mdfy_uv",
        "mdfy_cond_uv",
        "cncl_qty",
        "crd_deal_tp",
        "crd_loan_dt",
    }
)
_WEBSOCKET_ACK_FIELDS = frozenset(
    {"return_code", "return_msg", "trnm", "seq", "cont_yn", "next_key"}
)

# facts/compound는 TR 응답 본문(`call_payload["data"]`)만 보고 top-level 스칼라를
# 뽑는다 — chart/table처럼 전체 응답 트리를 재귀 탐색하지 않는다. call_payload
# 전체를 넘기면 `operation_ref` 같은 봉투 필드를 TR 필드로 오인한다(canvas_data.py
# 동일 주석 참조, 실측 확인) — 반드시 `.get("data")`만 넘긴다.
_BUILD_FROM_TR_DATA = {
    "facts": build_facts,
    "compound": build_compound_generic,
}

_LEGACY_PROJECTION_PUBLIC_LABELS = {
    "detail:ka10004:buy_bid_prices": {
        "stk_cd": "종목코드",
        "stk_nm": "종목명",
        "bid_req_base_tm": "호가 기준 시각",
        "sel_bid_tot_req": "총매도 잔량",
        "buy_bid_tot_req": "총매수 잔량",
        **{
            f"sel_{level}bid": f"매도 {level}호가"
            for level in range(1, 11)
        },
        **{
            f"sel_{level}bid_req": f"매도 {level}호가 잔량"
            for level in range(1, 11)
        },
        **{
            f"buy_{level}bid": f"매수 {level}호가"
            for level in range(1, 11)
        },
        **{
            f"buy_{level}bid_req": f"매수 {level}호가 잔량"
            for level in range(1, 11)
        },
    }
}

_INTEGRATED_CARD_FIELDS = frozenset(
    {
        "card_id",
        "card_kind",
        "capability_id",
        "mode",
        "section",
        "operation_refs",
        "field_contract",
        "coverage_receipt",
        "envelope_version",
        "view_recipe",
        "presentation_contract",
        "view_instance_id",
        "semantic_observations",
        "realtime_bindings",
        "workspace_generation",
        "view_generation",
        "update_policy",
        "surface_contract",
    }
)

# 최상위에 실려도 통합 카드 블록이 canonical과 대조·치환하는 계약 필드다
# (_INTEGRATED_CARD_FIELDS의 부분집합). 중첩 위치에는 그 대조가 없으므로 예외가
# 적용되지 않는다 — _forbidden_generic_task_canvas_aliases 주석 참고.
_TOP_LEVEL_RECONCILED_CONTRACT_FIELDS = frozenset(
    {"field_contract", "coverage_receipt", "surface_contract"}
)

_GENERIC_TASK_CANVAS_CONTRACT_ALIASES = frozenset(
    {
        "task_canvas",
        "taskCanvas",
        "envelope_version",
        "envelopeVersion",
        "view_recipe",
        "viewRecipe",
        "presentation_contract",
        "presentationContract",
        "view_instance_id",
        "viewInstanceId",
        "semantic_observations",
        "semanticObservations",
        "realtime_bindings",
        "realtimeBindings",
        "workspace_generation",
        "workspaceGeneration",
        "view_generation",
        "viewGeneration",
        "update_policy",
        "updatePolicy",
        "surface_contract",
        "surfaceContract",
        "initial_surface_contract",
        "initialSurfaceContract",
        "field_contract",
        "fieldContract",
        "coverage_receipt",
        "coverageReceipt",
    }
)

_TASK_CANVAS_ENVELOPE_VERSION = "task-canvas.v1"
_REALTIME_BINDING_VERSION = "semantic-realtime.v1"
_TECHNICAL_DESCRIPTION_TOKENS = (
    "응답키",
    "응답 키",
    "response key",
    "json path",
    "alias",
    "mapping_id",
    "operation_ref",
    "fid ",
    "raw ",
)


# 표면 슬롯(surface_contract.slot_values)과 **같은** 관찰 식별자를 쓴다 — 두 벌로
# 두면 실시간 프레임이 보드 슬롯을 못 찾는다(card_surface_contract가 단일 출처).
_observation_id = observation_id_for


def _realtime_binding_id(concept_id: str, display_slot: int | None) -> str:
    slot = "scalar" if display_slot is None else f"slot:{display_slot}"
    digest = hashlib.sha256(
        f"semantic-realtime-binding\0{concept_id}\0{slot}".encode()
    ).hexdigest()[:20]
    return f"rtb_{digest}"


def _internal_realtime_binding_contract(operation_id: str) -> dict[str, Any]:
    """Return the raw-key registry for the trusted main-process boundary only.

    Raw WebSocket aliases must never enter the Task Canvas envelope.  The local
    Electron main process fetches this bearer-guarded contract, converts a wire
    tick to opaque ``semantic_updates``, and sends only those updates onward.
    """

    if operation_id not in WEBSOCKET_TR_IDS:
        raise KeyError(f"unknown realtime operation: {operation_id!r}")
    contracts = get_semantic_presentation_registry().for_operation(
        f"base:{operation_id}"
    )
    source_bindings: dict[str, dict[str, Any]] = {}
    for contract in contracts:
        public = _product_field(contract)
        if public is None:
            continue
        descriptor = {
            "binding_id": public["realtime_binding_id"],
            **(
                {"display_slot": public["display_slot"]}
                if public.get("display_slot") is not None
                else {}
            ),
        }
        prior = source_bindings.setdefault(contract.alias, descriptor)
        if prior != descriptor:
            raise ValueError(
                f"ambiguous realtime source alias for {operation_id!r}"
            )
    return {
        "binding_version": _REALTIME_BINDING_VERSION,
        "operation_id": operation_id,
        "source_bindings": source_bindings,
    }


def _product_field(contract: Any) -> dict[str, Any] | None:
    public = contract.public_serializable()
    if public is None or contract.field_class not in {
        "semantic",
        "unresolved",
        "derived",
    }:
        return None
    description = public.get("description")
    if isinstance(description, str) and any(
        token in description.lower() for token in _TECHNICAL_DESCRIPTION_TOKENS
    ):
        public["description"] = None
    public["observation_id"] = _observation_id(contract.wire_occurrence_id)
    public["realtime_binding_id"] = _realtime_binding_id(
        public["concept_id"], public.get("display_slot")
    )
    public["field_class"] = contract.field_class
    return public


def _authoritative_public_labels(operation_ref: str) -> dict[str, str]:
    """Return only unambiguous, operation-scoped product labels by wire alias."""

    labels_by_alias: dict[str, set[str]] = {}
    for contract in get_semantic_presentation_registry().for_operation(operation_ref):
        if not contract.user_visible or not contract.label_ko:
            continue
        labels_by_alias.setdefault(contract.alias, set()).add(contract.label_ko)
    labels = {
        alias: next(iter(labels))
        for alias, labels in labels_by_alias.items()
        if len(labels) == 1
    }
    for alias, label in _LEGACY_PROJECTION_PUBLIC_LABELS.get(
        operation_ref, {}
    ).items():
        existing = labels.get(alias)
        if existing is not None and existing != label:
            raise CanvasCardRegistryError(
                f"operation {operation_ref!r} has conflicting public labels "
                f"for projection field {alias!r}"
            )
        labels[alias] = label
    return labels


def _apply_authoritative_public_labels(
    operation_ref: str,
    data: dict[str, Any],
) -> tuple[dict[str, str], ...]:
    """Replace legacy projection labels without guessing from aliases or text."""

    labels = _authoritative_public_labels(operation_ref)
    contracts_by_alias: dict[str, list[Any]] = {}
    for contract in get_semantic_presentation_registry().for_operation(operation_ref):
        contracts_by_alias.setdefault(contract.alias, []).append(contract)
    dropped: list[dict[str, str]] = []

    def relabel(items: Any, *, location: str, rows: Any = None) -> None:
        if not isinstance(items, list):
            return
        public_items: list[dict[str, Any]] = []
        dropped_keys: set[str] = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            key = item.get("key")
            if not isinstance(key, str):
                continue
            label = labels.get(key)
            if label is None:
                contracts = contracts_by_alias.get(key, [])
                field_classes = {contract.field_class for contract in contracts}
                if contracts and field_classes <= {"internal", "transport"}:
                    reason = "+".join(sorted(field_classes))
                    dropped.append(
                        {"location": location, "key": key, "reason": reason}
                    )
                    dropped_keys.add(key)
                    continue
                raise CanvasCardRegistryError(
                    f"operation {operation_ref!r} has no unambiguous public label "
                    f"for projection field {key!r}"
                )
            item["label"] = label
            public_items.append(item)
        items[:] = public_items
        if dropped_keys and isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                for key in dropped_keys:
                    row.pop(key, None)

    relabel(data.get("fields"), location="fields")
    relabel(data.get("columns"), location="columns", rows=data.get("rows"))
    relabel(data.get("header"), location="header")
    table = data.get("table")
    if isinstance(table, dict):
        relabel(
            table.get("columns"),
            location="table.columns",
            rows=table.get("rows"),
        )
    return tuple(dropped)


def _canonical_identity_value(value: Any) -> Any:
    """Normalize signed JSON values without deriving meaning from user-visible text."""

    if isinstance(value, str):
        return unicodedata.normalize("NFKC", value).strip()
    if isinstance(value, list):
        return [_canonical_identity_value(item) for item in value]
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            key = unicodedata.normalize("NFKC", str(raw_key)).strip()
            if not key or key in normalized:
                raise ValueError("signed plan arguments have ambiguous normalized keys")
            normalized[key] = _canonical_identity_value(raw_value)
        return normalized
    return value


def _view_instance_id(
    operation_ref: str,
    recipe_id: str,
    *,
    arguments: dict[str, Any],
    question_hash: str,
    account: str,
    dataset_id: str | None,
) -> str:
    """Build an opaque workspace identity only from signed and canonical inputs."""

    request_scope = (
        {"dataset_id": unicodedata.normalize("NFKC", dataset_id).strip()}
        if dataset_id is not None
        else {"question_hash": question_hash}
    )
    identity = {
        "request_scope": request_scope,
        "task": {"operation_ref": operation_ref, "recipe_id": recipe_id},
        "target_query": {
            "arguments": _canonical_identity_value(arguments),
        },
        "account": unicodedata.normalize("NFKC", account).strip(),
    }
    canonical = json.dumps(
        identity,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    digest = hashlib.sha256(f"task-canvas-view\0{canonical}".encode()).hexdigest()[:20]
    return f"view_{digest}"


@dataclass(frozen=True, slots=True)
class _WorkspaceReservation:
    view_instance_id: str
    generation: int
    update_policy: Literal["replace", "enrich"]


@dataclass(slots=True)
class _WorkspaceGenerationLedger:
    """In-process latest-request-wins clock for one FastAPI application instance."""

    generation: int = 0
    emitted_views: set[str] = dataclass_field(default_factory=set)
    latest_generation_by_view: dict[str, int] = dataclass_field(default_factory=dict)
    lock: threading.Lock = dataclass_field(default_factory=threading.Lock)

    def reserve(self, view_instance_id: str) -> _WorkspaceReservation:
        with self.lock:
            self.generation += 1
            reservation = _WorkspaceReservation(
                view_instance_id=view_instance_id,
                generation=self.generation,
                update_policy=(
                    "enrich" if view_instance_id in self.emitted_views else "replace"
                ),
            )
            self.latest_generation_by_view[view_instance_id] = reservation.generation
            return reservation

    def finalize(self, reservation: _WorkspaceReservation) -> bool:
        with self.lock:
            if (
                self.latest_generation_by_view.get(reservation.view_instance_id)
                != reservation.generation
            ):
                return False
            self.emitted_views.add(reservation.view_instance_id)
            return True


_WORKSPACE_LEDGER_INIT_LOCK = threading.Lock()


def _workspace_generation_ledger(app: Any) -> _WorkspaceGenerationLedger:
    ledger = getattr(app.state, "task_canvas_generation_ledger", None)
    if isinstance(ledger, _WorkspaceGenerationLedger):
        return ledger
    with _WORKSPACE_LEDGER_INIT_LOCK:
        ledger = getattr(app.state, "task_canvas_generation_ledger", None)
        if not isinstance(ledger, _WorkspaceGenerationLedger):
            ledger = _WorkspaceGenerationLedger()
            app.state.task_canvas_generation_ledger = ledger
    return ledger


def _reserve_workspace(app: Any, card_contract: dict[str, Any]) -> _WorkspaceReservation:
    return _workspace_generation_ledger(app).reserve(card_contract["view_instance_id"])


def _apply_workspace_reservation(
    app: Any,
    card_contract: dict[str, Any],
    reservation: _WorkspaceReservation,
) -> bool:
    if not _workspace_generation_ledger(app).finalize(reservation):
        return False
    card_contract.update(
        {
            "workspace_generation": reservation.generation,
            "view_generation": reservation.generation,
            "update_policy": reservation.update_policy,
        }
    )
    return True


# Investor-facing Korean titles for section ids that must not fall back to the
# hyphen-stripped internal taxonomy (buttonLabel keeps only Korean candidates).
# 보드가 저작되면 slots.json의 section_titles_ko가 먼저다 — 여기 표는 폴백이다.
_SECTION_TITLES_KO = {
    "ranked-results": "순위",
}


def _section_title_ko(section_id: str, board_titles: Mapping[str, str]) -> str:
    return (
        board_titles.get(section_id)
        or _SECTION_TITLES_KO.get(section_id)
        or section_id.replace("-", " ")
    )


def _task_canvas_contract(
    operation_ref: str,
    *,
    arguments: dict[str, Any] | None = None,
    question_hash: str = "0" * 64,
    account: str | None = None,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Derive product-safe presentation solely from canonical server registries."""

    recipe = get_view_recipe_registry().for_operation(operation_ref)
    board_titles = resolve_section_titles_ko(operation_ref)
    semantic_contracts = get_semantic_presentation_registry().for_operation(operation_ref)
    fields_by_section: dict[str, list[dict[str, Any]]] = {
        section_id: [] for section_id in recipe.section_ids
    }
    for contract in semantic_contracts:
        public = _product_field(contract)
        if public is None:
            continue
        fields_by_section[contract.section_id].append(public)

    sections = []
    for section_id in recipe.section_ids:
        policy = recipe.section_policy(section_id)
        sections.append(
            {
                "section_id": section_id,
                "title_ko": _section_title_ko(section_id, board_titles),
                "section_order": policy.section_order,
                "visibility_policy": policy.visibility_policy,
                "required": policy.required,
                "workflow_only": policy.workflow_only,
                "fields": fields_by_section[section_id],
            }
        )
    return {
        "envelope_version": _TASK_CANVAS_ENVELOPE_VERSION,
        "view_instance_id": _view_instance_id(
            operation_ref,
            recipe.recipe_id,
            arguments=arguments or {},
            question_hash=question_hash,
            account=account or "",
            dataset_id=dataset_id,
        ),
        "view_recipe": {
            "recipe_id": recipe.recipe_id,
            "title_ko": recipe.title_ko,
            "user_task": recipe.user_task,
            "section_ids": list(recipe.section_ids),
            "primary_component_id": recipe.primary_component_id,
            "source_precedence": list(recipe.source_precedence),
            "section_policies": [
                policy.serializable() for policy in recipe.section_policies
            ],
        },
        "presentation_contract": {
            "recipe_id": recipe.recipe_id,
            "title_ko": recipe.title_ko,
            "description_ko": recipe.user_task,
            "primary_component_id": recipe.primary_component_id,
            "sections": sections,
        },
        "semantic_observations": [],
        "realtime_bindings": [],
    }


# 표면 슬롯 바인딩과 **같은** 경로 평가기를 쓴다 — 갈리면 카드 값과 보드 값이 어긋난다.
_json_path_values = json_path_values


def _bind_semantic_values(
    card_contract: dict[str, Any],
    operation_ref: str,
    source: Any,
) -> None:
    """Attach only product-safe values while retaining occurrence identity."""

    observations: list[dict[str, Any]] = []
    first_value_by_observation: dict[str, Any] = {}
    columns_by_section: dict[str, dict[str, dict[str, Any]]] = {}
    rows_by_section: dict[str, dict[int, dict[str, Any]]] = {}
    for contract in get_semantic_presentation_registry().for_operation(operation_ref):
        public = _product_field(contract)
        if public is None:
            continue
        indexed_values = [
            (index, value)
            for index, value in enumerate(_json_path_values(source, contract.json_path))
            if not isinstance(value, (dict, list, tuple, set))
        ]
        is_array_field = "[]" in contract.json_path
        column_key = f"col_{_observation_id(contract.wire_occurrence_id)[4:]}"
        for index, value in indexed_values:
            observation = {
                **public,
                "observation_id": _observation_id(
                    contract.wire_occurrence_id,
                    index if is_array_field else None,
                ),
                "value": value,
            }
            if is_array_field:
                observation["array_index"] = index
                columns_by_section.setdefault(contract.section_id, {}).setdefault(
                    column_key,
                    {
                        "key": column_key,
                        "label_ko": public["label_ko"],
                        "unit_or_format": public.get("unit_or_format"),
                        "display_metadata": public.get("display_metadata"),
                        "display_tier": public.get("display_tier"),
                        "display_group": public.get("display_group"),
                        "display_order": public.get("display_order"),
                        "display_slot": public.get("display_slot"),
                        "visibility_policy": public.get("visibility_policy"),
                        "realtime_binding_id": public["realtime_binding_id"],
                    },
                )
                rows_by_section.setdefault(contract.section_id, {}).setdefault(
                    index, {}
                )[column_key] = value
            observations.append(observation)
        if indexed_values and not is_array_field:
            first_value_by_observation[public["observation_id"]] = indexed_values[0][1]

    visible_sections: list[dict[str, Any]] = []
    for section in card_contract["presentation_contract"]["sections"]:
        section["fields"].sort(
            key=lambda field: (
                field.get("display_order") is None,
                field.get("display_order") or 0,
                field.get("display_slot") is None,
                field.get("display_slot") or 0,
                field.get("observation_id") or "",
            )
        )
        for field in section["fields"]:
            observation_id = field.get("observation_id")
            if observation_id in first_value_by_observation:
                field["value"] = first_value_by_observation[observation_id]
        section_id = section["section_id"]
        section_columns = columns_by_section.get(section_id)
        section_rows = rows_by_section.get(section_id)
        if section_columns and section_rows:
            section["columns"] = sorted(
                section_columns.values(),
                key=lambda column: (
                    column.get("display_order") is None,
                    column.get("display_order") or 0,
                    column.get("display_slot") is None,
                    column.get("display_slot") or 0,
                    column["key"],
                ),
            )
            section["rows"] = [section_rows[index] for index in sorted(section_rows)]
        section["fields"] = [field for field in section["fields"] if "value" in field]
        has_data = bool(section["fields"] or section.get("rows"))
        if section["visibility_policy"] == "when-data" and not has_data:
            continue
        section["status"] = "available" if has_data or section["workflow_only"] else "empty"
        visible_sections.append(section)
    card_contract["presentation_contract"]["sections"] = visible_sections
    observations.sort(
        key=lambda item: (
            item.get("display_order") is None,
            item.get("display_order") or 0,
            item.get("display_slot") is None,
            item.get("display_slot") or 0,
            item.get("array_index", -1),
            item["observation_id"],
        )
    )
    card_contract["semantic_observations"] = observations
    card_contract["realtime_bindings"] = [
        {
            "binding_id": observation["realtime_binding_id"],
            "observation_id": observation["observation_id"],
            **(
                {"array_index": observation["array_index"]}
                if "array_index" in observation
                else {}
            ),
        }
        for observation in observations
    ]
    # 보드 슬롯 값은 같은 source·같은 경로 평가기에서 나온다(표면과 관찰이 갈리지 않게).
    attach_surface_contract(card_contract, operation_ref, source)


def _integrated_card_contract(
    operation_ref: str,
    *,
    arguments: dict[str, Any] | None = None,
    question_hash: str = "0" * 64,
    account: str | None = None,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Derive all integrated-card routing from one authoritative operation."""

    resolved = resolve_canvas_card(operation_ref)
    field_contract = get_operation_field_contract(operation_ref)
    if not field_contract:
        raise CanvasCardRegistryError(
            f"operation {operation_ref!r} has no Canvas field contract"
        )
    for field in field_contract:
        if (
            field.get("card_id") != resolved.card_id
            or field.get("card_kind") != resolved.card_kind
            or field.get("capability_id") != resolved.capability_id
        ):
            raise CanvasCardRegistryError(
                f"operation {operation_ref!r} field contract disagrees with card registry"
            )
    unresolved = [
        field["occurrence_id"]
        for field in field_contract
        if field.get("semantic_status") == "unresolved"
    ]
    metadata = resolved.runtime_metadata()
    metadata.update(
        {
            "field_contract": field_contract,
            "coverage_receipt": {
                "operation_ref": operation_ref,
                "field_occurrence_count": len(field_contract),
                "reachable_occurrence_count": len(field_contract),
                "unresolved_occurrence_ids": unresolved,
                "lossless": not unresolved,
            },
            **_task_canvas_contract(
                operation_ref,
                arguments=arguments,
                question_hash=question_hash,
                account=account,
                dataset_id=dataset_id,
            ),
        }
    )
    # 값은 아직 없다 — 여기서는 보드 골격만 붙는다(MCP 쪽과 바이트 동일해야 게이트가
    # canonical 대조에서 어긋나지 않는다). 값은 _bind_semantic_values가 채운다.
    attach_surface_contract(metadata, operation_ref)
    return metadata


def _lossless_source_data(call_payload: dict[str, Any]) -> dict[str, Any]:
    """Keep the complete selector page without copying any execution secret."""

    source_data = {
        key: value
        for key, value in call_payload.items()
        if key in {"operation_ref", "data", "continuation", "canvas_context"}
    }
    continuation = source_data.get("continuation")
    if isinstance(continuation, dict):
        source_data["continuation"] = {
            key: value
            for key, value in continuation.items()
            if key != "next_plan_token"
        }
    return source_data


def _enqueue_envelope(queue: asyncio.Queue, envelope: dict[str, Any]) -> None:
    """큐가 가득 차도 최신 카드가 이긴다 — 가장 오래된 것을 버리고 넣는다."""
    while True:
        try:
            queue.put_nowait(envelope)
            return
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass


def _forbidden_generic_task_canvas_aliases(envelope: dict[str, Any]) -> list[str]:
    """Find client-owned Task Canvas contracts anywhere on the generic wire.

    The generic side channel may still carry ordinary nested card data.  Task
    Canvas contracts, however, are server-derived by signed selector dispatch;
    accepting their renderer aliases from any nested object would bypass that
    authority boundary.
    """

    forbidden: set[str] = set()
    stack: list[Any] = []
    # 최상위의 field_contract·coverage_receipt만 예외다. 그 둘은 아래 통합 카드
    # 블록이 canonical operation_ref로 다시 파생해 값을 대조하고(불일치 → 422)
    # 최종적으로 canonical로 덮어쓰므로 위조가 통하지 않는다. 여기서까지 막으면
    # 그 블록이 도달 불가가 되어, MCP render_with_plan이 항상 싣는 두 필드 때문에
    # 정상 카드 push가 전부 422로 거부된다(2026-08-31 실측). 중첩 객체 안에서는
    # 대조 경로가 없으므로 같은 이름도 그대로 금지다.
    for key, child in envelope.items():
        if key in _TOP_LEVEL_RECONCILED_CONTRACT_FIELDS:
            continue
        if key in _GENERIC_TASK_CANVAS_CONTRACT_ALIASES:
            forbidden.add(key)
        stack.append(child)
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            for key, child in value.items():
                if key in _GENERIC_TASK_CANVAS_CONTRACT_ALIASES:
                    forbidden.add(key)
                stack.append(child)
        elif isinstance(value, list):
            stack.extend(value)
    return sorted(forbidden)


@router.post("/api/v1/canvas/push", operation_id="canvas_push")
async def canvas_push(request: Request, envelope: dict[str, Any]) -> JSONResponse:
    if not isinstance(envelope.get("canvas_type"), str) or not envelope["canvas_type"]:
        return JSONResponse(
            status_code=422, content={"detail": "envelope에 canvas_type(str)이 필요하다"}
        )
    operation_ref = envelope.get("operation_ref")
    if envelope["canvas_type"] == "action":
        return JSONResponse(
            status_code=422,
            content={
                "code": "GENERIC_ORDER_PUSH_FORBIDDEN",
                "detail": "주문 action은 signed selector dispatch에서만 생성할 수 있다",
            },
        )
    if envelope["canvas_type"] in {"event", "status"}:
        return JSONResponse(
            status_code=422,
            content={
                "code": "GENERIC_WORKFLOW_PUSH_FORBIDDEN",
                "detail": "workflow 상태는 signed selector dispatch에서만 생성할 수 있다",
            },
        )
    if isinstance(operation_ref, str) and operation_ref:
        try:
            resolved_operation = resolve_canvas_card(operation_ref)
        except (CanvasCardRegistryError, KeyError, ValueError):
            resolved_operation = None
        if resolved_operation is not None and resolved_operation.capability_id == "order":
            return JSONResponse(
                status_code=422,
                content={
                    "code": "GENERIC_ORDER_PUSH_FORBIDDEN",
                    "detail": "주문 receipt/status는 signed selector dispatch에서만 파생한다",
                },
            )
    forbidden_task_canvas_aliases = _forbidden_generic_task_canvas_aliases(envelope)
    if (
        envelope["canvas_type"] in {"task_canvas", "task-canvas"}
        or forbidden_task_canvas_aliases
    ):
        return JSONResponse(
            status_code=422,
            content={
                "code": "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN",
                "detail": "Task Canvas contract는 signed selector dispatch에서만 생성할 수 있다",
            },
        )
    # 통합 카드 계약은 호출자가 카드 의도를 명시했을 때만 파생한다. 이 엔드포인트에는
    # bearer 검사가 없으므로(같은 파일의 internal_canvas_realtime_bindings와 대비),
    # "canonical operation_ref만 대면 누구나 lossless 딱지가 붙은 공식 카드를 만든다"로
    # 넓히면 호출자 데이터를 공식 라벨로 세탁해주는 통로가 된다. 실제 프로덕션 호출자는
    # athena_mcp/canvas_data.py의 render_with_plan 하나뿐이고, 그쪽은 이미
    # _integrated_card_contract를 실어 보내므로 이 게이트로 충분하다.
    supplied_integrated_fields = _INTEGRATED_CARD_FIELDS.intersection(envelope)
    if supplied_integrated_fields:
        if not isinstance(operation_ref, str) or not operation_ref:
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "통합 카드 envelope에는 canonical operation_ref가 필요하다"
                },
            )
        try:
            canonical = _integrated_card_contract(operation_ref)
        except (CanvasCardRegistryError, KeyError, ValueError) as exc:
            return JSONResponse(status_code=422, content={"detail": str(exc)})
        mismatched = sorted(
            field
            for field in supplied_integrated_fields
            if envelope[field] != canonical[field]
        )
        if mismatched:
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "통합 카드 metadata가 canonical operation_ref와 일치하지 않는다",
                    "mismatched_fields": mismatched,
                },
            )
        # Do not forward caller-owned object identities even when values match.
        # Replace every integrated field with a fresh server-derived contract.
        for field in _INTEGRATED_CARD_FIELDS:
            envelope.pop(field, None)
        envelope.update(canonical)
    queue = getattr(request.app.state, "canvas_events", None)
    if queue is None:
        # fail-closed — 조용히 버리면 게이트웨이가 "밀었다"고 믿는다(정직성 위반).
        return JSONResponse(
            status_code=503, content={"detail": "캔버스 채널이 준비되지 않았다"}
        )
    _enqueue_envelope(queue, envelope)  # 최신 우선 — routines notify와 같은 정책
    return JSONResponse(content={"queued": True})


@router.get(
    "/api/v1/internal/canvas/realtime-bindings/{operation_id}",
    operation_id="internal_canvas_realtime_bindings",
    openapi_extra={"x-athena-llm-exposed": False},
)
async def internal_canvas_realtime_bindings(
    request: Request,
    operation_id: str,
    authorization: Annotated[str, Header(alias="Authorization")] = "",
) -> JSONResponse:
    """Give trusted app-main the wire-to-opaque tick translation registry."""

    require_local_bearer(request, authorization)
    try:
        contract = _internal_realtime_binding_contract(operation_id)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return JSONResponse(content=contract)


class BoardHydrateRequest(BaseModel):
    """D2 보드 단위 fetch-set 요청 — 보드 하나와 그 보드가 가리키는 대상."""

    board_id: str = Field(min_length=1, max_length=64)
    # manifest request 필드 alias로 적은 인자 가방(종목코드 `stk_cd` 등). op마다
    # 자기 요청 모델이 선언한 alias만 골라 쓴다.
    target: dict[str, Any] = Field(default_factory=dict)
    account: str | None = Field(default=None, min_length=1, max_length=64)
    # 렌더러가 현재 보드에서 실제로 부족한 슬롯만 보낸다. 생략은 구버전
    # 클라이언트 호환을 위해 모든 값 바인딩 슬롯을 뜻한다.
    slot_ids: list[str] | None = Field(default=None, max_length=512)


def _hydrate_operation_refs(board: Any, slot_ids: list[str] | None) -> tuple[str, ...]:
    """현재 필요한 슬롯이 실제로 참조하는 op만 보드 선언 순서로 돌려준다."""

    by_slot = {slot.slot_id: slot for slot in board.slots}
    if slot_ids is None:
        slots = board.binding_slots
    else:
        unknown = sorted(set(slot_ids) - by_slot.keys())
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"board {board.board_id!r} has no slots: {', '.join(unknown)}",
            )
        requested = set(slot_ids)
        slots = tuple(
            slot
            for slot in board.slots
            if slot.slot_id in requested and slot.binds_a_field
        )
    needed: list[str] = []
    for slot in slots:
        for binding in slot.bindings:
            if binding.mapping_id not in needed:
                needed.append(binding.mapping_id)
    # 선언 순서가 먼저다. 그다음 **슬롯이 실제로 가리키는데 board.operation_refs에는
    # 없는 op**를 슬롯 순서로 잇는다 — 이 꼬리를 버리면 그 슬롯은 어떤 호출도 받지
    # 못해 영구히 결측으로 남는다(2026-09-09 실측: 보드 41장 · op 139개).
    declared = [ref for ref in board.operation_refs if ref in needed]
    extra = [ref for ref in needed if ref not in board.operation_refs]
    return tuple(declared + extra)


def _same_query_arguments(
    document: Any, tr_id: str, target: Mapping[str, Any], argument_key: str
) -> bool:
    if document is None or document.kind != "query" or document.tr_id != tr_id:
        return False
    arguments, _ = _hydrate_arguments(document, target)
    if arguments is None:
        return False
    return json.dumps(
        arguments.model_dump(mode="json", by_alias=True, exclude_none=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ) == argument_key


def _initial_surface_contract(
    card_contract: Mapping[str, Any],
    *,
    source: BaseModel,
    tr_id: str,
    target: Mapping[str, Any],
    selector: SelectorService,
) -> dict[str, Any] | None:
    surface = card_contract.get("surface_contract")
    if not isinstance(surface, Mapping):
        return None
    board_id = surface.get("initial_state_board")
    if not isinstance(board_id, str) or not board_id:
        return None
    registry = get_card_surface_registry()
    board = registry.boards.get(board_id)
    if board is None:
        return None
    argument_key = json.dumps(
        dict(target), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    queried_refs = {
        operation_ref
        for operation_ref in board.operation_refs
        if _same_query_arguments(
            selector.catalog.find_exact(operation_ref), tr_id, target, argument_key
        )
    }
    source_data = source.model_dump(by_alias=True)
    bound: dict[str, Any] = {}
    for operation_ref in board.operation_refs:
        if operation_ref in queried_refs:
            bound.update(bind_surface_values(operation_ref, source_data))
    contract = build_board_surface_contract(
        board_id, bound, registry, active_operation_refs=queried_refs
    )
    if contract is None:
        return None
    filled = {entry["slot_id"] for entry in contract["slot_values"]}
    contract["hydration_slot_ids"] = [
        slot.slot_id
        for slot in board.binding_slots
        if slot.slot_id not in filled
        and any(binding.mapping_id not in queried_refs for binding in slot.bindings)
    ]
    return contract


def _hydrate_arguments(
    document: Any, target: Mapping[str, Any]
) -> tuple[BaseModel | None, str | None]:
    """target을 op의 request alias로 좁혀 검증한다. 실패는 사유 문자열."""

    aliases: dict[str, bool] = {
        (field_info.alias or name): field_info.is_required()
        for name, field_info in document.request_model.model_fields.items()
    }
    # 화면이 안 보낸 **필수** 조회 조건은 그 보드의 기본 조건으로 채운다. 안 채우면
    # op가 호출조차 되지 않아 보드 전체가 결측어가 된다(hydrate_defaults 모듈 주석).
    arguments = fill_missing_arguments(document.operation_ref, target, aliases)
    try:
        return document.request_model.model_validate(arguments), None
    except ValidationError:
        missing = sorted(
            alias
            for alias, required in aliases.items()
            if required and alias not in arguments
        )
        if not missing:
            # 인자는 다 있는데 값이 이 op의 모델과 맞지 않는다 — 매핑이 아니라 값 문제다.
            return None, "arguments_invalid"
        return None, "arguments_unmapped:" + ",".join(missing)


def _hydrate_data_client(
    request: Request, account: str | None, fallback: KiwoomClient | None
) -> KiwoomClient | None:
    """요청이 계좌를 지목하면 그 계좌의 조회 클라이언트, 아니면 헤더가 고른 것."""

    if not account:
        return fallback
    runtime = account_runtimes(request.app).get(account)
    if runtime is None:
        raise HTTPException(
            status_code=404, detail=f"account {account!r} is not configured"
        )
    return runtime.data_client


async def _resolve_chained_arguments(
    document: Any,
    target: Mapping[str, Any],
    request: Request,
    client: KiwoomClient,
    selector: SelectorService,
    resolved: dict[str, str | None],
) -> dict[str, Any]:
    """비어 있는 필수 인자 중 **API가 목록으로 알려주는** 값을 채운다.

    회원사코드·테마그룹코드·감시그룹SEQ·ETF 대상지수는 화면이 고르는 값이지만, 그
    후보 목록을 API가 직접 싣는다(``ref/hydrate-argument-chains.json``). 목록 op를
    먼저 부르고 **첫 항목**을 쓴다 — 코드를 지어내지 않고, 첫 항목은 그 화면이 처음
    여는 항목이다. 한 요청 안에서 같은 목록은 한 번만 부른다.
    """

    aliases = {
        (field.alias or name): field.is_required()
        for name, field in document.request_model.model_fields.items()
    }
    missing = missing_required_aliases(document.operation_ref, target, aliases)
    if not missing:
        return {}
    filled: dict[str, Any] = {}
    for alias in missing:
        chain = chain_for(alias)
        if chain is None:
            continue
        if alias not in resolved:
            resolved[alias] = await _first_chain_value(
                chain, request, client, selector
            )
        value = resolved[alias]
        if value is not None:
            filled[alias] = value
    return filled


async def _first_chain_value(
    chain: Mapping[str, str],
    request: Request,
    client: KiwoomClient,
    selector: SelectorService,
) -> str | None:
    """목록 op를 부르고 그 경로의 첫 값을 돌려준다. 실패는 ``None``."""

    operation_ref = chain["operation_ref"]
    document = selector.catalog.find_exact(operation_ref)
    if document is None or document.kind != "query" or not document.generic_callable:
        return None
    aliases = {
        (field.alias or name): field.is_required()
        for name, field in document.request_model.model_fields.items()
    }
    arguments = fill_missing_arguments(operation_ref, {}, aliases)
    if any(required and alias not in arguments for alias, required in aliases.items()):
        return None
    try:
        model = document.request_model.model_validate(arguments)
    except ValidationError:
        return None
    try:
        result = await call_typed_tr(document.tr_id, model, request, Response(), client)
    except (KiwoomError, httpx.HTTPError, TimeoutError, ValueError):
        return None
    if isinstance(result, JSONResponse):
        return None
    values = [
        value
        for value in json_path_values(result.model_dump(by_alias=True), chain["json_path"])
        if isinstance(value, (str, int)) and str(value).strip()
    ]
    return str(values[0]) if values else None


async def _hydrate_operation(
    operation_ref: str,
    document: Any,
    payload: BoardHydrateRequest,
    request: Request,
    client: KiwoomClient,
    fetched: dict[tuple[str, str], tuple[BaseModel | None, str | None]],
    selector: SelectorService | None = None,
    chained: dict[str, str | None] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """read op 하나를 호출해 (상태, 바인딩)으로 돌려준다. 실패는 예외로 새지 않는다."""

    def unbound(reason: str) -> tuple[dict[str, Any], dict[str, Any]]:
        return (
            {"operation_ref": operation_ref, "status": "unbound", "reason": reason},
            {},
        )

    if document is None:
        return unbound("unknown_operation")
    if document.kind == "order":
        # 주문 op는 어떤 경우에도 호출하지 않는다 — 보드 하이드레이션은 읽기다.
        return unbound("order_operation_refused")
    if document.kind != "query":
        # 실시간(websocket)·oauth는 REST 조회 경로가 없다.
        return unbound("not_a_rest_read")
    if not document.generic_callable:
        return unbound("not_generic_callable")
    target: Mapping[str, Any] = payload.target
    if selector is not None and chained is not None:
        chain_values = await _resolve_chained_arguments(
            document, target, request, client, selector, chained
        )
        if chain_values:
            target = {**target, **chain_values}
    arguments, reason = _hydrate_arguments(document, target)
    if arguments is None:
        assert reason is not None
        return unbound(reason)
    argument_key = json.dumps(
        arguments.model_dump(mode="json", by_alias=True, exclude_none=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    fetch_key = (document.tr_id, argument_key)
    if fetch_key not in fetched:
        try:
            result = await call_typed_tr(
                document.tr_id,
                arguments,
                request,
                Response(),
                client,
            )
        except (KiwoomError, httpx.HTTPError, TimeoutError, ValueError) as exc:
            logger.warning(
                "board-hydrate upstream failed tr=%s error=%s",
                document.tr_id,
                type(exc).__name__,
            )
            fetched[fetch_key] = (None, "upstream_error")
        else:
            if isinstance(result, JSONResponse):
                # 업무 오류 응답(return_code != 0)은 같은 실제 호출을 공유하는 모든
                # detail group에서도 값이 아니다.
                fetched[fetch_key] = (None, "upstream_business_result")
            else:
                fetched[fetch_key] = (result, None)
    result, fetch_error = fetched[fetch_key]
    if result is None:
        assert fetch_error is not None
        return unbound(fetch_error)
    bound = bind_surface_values(operation_ref, result.model_dump(by_alias=True))
    return (
        {
            "operation_ref": operation_ref,
            "status": "bound",
            "reason": None,
            "bound_count": len(bound),
        },
        bound,
    )


@router.post(
    "/api/v1/internal/canvas/board-hydrate",
    operation_id="internal_canvas_board_hydrate",
    openapi_extra={"x-athena-llm-exposed": False},
)
async def internal_canvas_board_hydrate(
    payload: BoardHydrateRequest,
    request: Request,
    client: OptionalDataClientDep,
    selector: SelectorServiceDep,
    authorization: Annotated[str, Header(alias="Authorization")] = "",
) -> JSONResponse:
    """Fill one Paper board's slots by calling its read operations (D2 fetch-set).

    Same trust boundary as the realtime-binding registry above: bearer-guarded,
    app-internal, never LLM-exposed. Order operations are refused outright, and a
    read that fails leaves only its own slots unbound.
    """

    require_local_bearer(request, authorization)
    registry = get_card_surface_registry()
    board = registry.boards.get(payload.board_id)
    if board is None:
        raise HTTPException(
            status_code=404, detail=f"board {payload.board_id!r} has no surface template"
        )
    data_client = _hydrate_data_client(request, payload.account, client)
    if data_client is None or not data_client.is_ready:
        raise KiwoomNotReadyError("Kiwoom data service is not ready")

    operations: list[dict[str, Any]] = []
    bound: dict[str, Any] = {}
    # 한 실제 TR은 detail group이 여러 개여도 요청 인자와 upstream 응답이 같다.
    # 보드 한 장 안에서는 한 번만 호출하고, 원본 응답을 각 operation_ref의 가시
    # occurrence로 따로 투영한다. 같은 실패도 다시 호출하지 않는다.
    fetched: dict[tuple[str, str], tuple[BaseModel | None, str | None]] = {}
    # 연쇄 인자(회원사·테마 등)는 요청 하나에서 한 번만 조회한다.
    chained: dict[str, str | None] = {}
    for operation_ref in _hydrate_operation_refs(board, payload.slot_ids):
        status, values = await _hydrate_operation(
            operation_ref,
            selector.catalog.find_exact(operation_ref),
            payload,
            request,
            data_client,
            fetched,
            selector,
            chained,
        )
        operations.append(status)
        bound.update(values)

    surface_contract = build_board_surface_contract(board.board_id, bound, registry)
    assert surface_contract is not None
    filled = {entry["slot_id"] for entry in surface_contract["slot_values"]}
    retryable_refs = {
        status["operation_ref"]
        for status in operations
        if status.get("reason") in {"upstream_error", "upstream_business_result"}
    }
    requested_slots = (
        board.binding_slots
        if payload.slot_ids is None
        else tuple(
            slot
            for slot in board.binding_slots
            if slot.slot_id in set(payload.slot_ids)
        )
    )
    surface_contract["hydration_slot_ids"] = [
        slot.slot_id
        for slot in requested_slots
        if slot.slot_id not in filled
        and any(binding.mapping_id in retryable_refs for binding in slot.bindings)
    ]

    return JSONResponse(
        content={
            "board_id": board.board_id,
            "card_id": board.card_id,
            "operations": operations,
            "surface_contract": surface_contract,
        }
    )


class RenderPlanRequest(BaseModel):

    plan_token: str = Field(min_length=1)
    canvas_type: Annotated[str, Field(pattern="^(chart|table|facts|compound)$")] | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    caption: str | None = None
    delivery: Literal["side_channel", "inline"] = "side_channel"
    dataset_id: str | None = Field(default=None, min_length=1, max_length=64)
    item_id: str | None = Field(default=None, min_length=1, max_length=128)
    ordinal: int | None = Field(default=None, ge=1, le=6)
    deadline_ms: int = Field(default=_INLINE_SERVER_BUDGET_MS, ge=100, le=3000)

    @model_validator(mode="after")
    def validate_correlation(self) -> RenderPlanRequest:
        correlation = (self.dataset_id, self.item_id, self.ordinal)
        if any(value is not None for value in correlation) and not all(
            value is not None for value in correlation
        ):
            raise ValueError("dataset_id, item_id, ordinal must be provided together")
        return self


class SelectorDispatchRequest(ResolveRequest):
    """One-shot app-internal selector request.

    The selector fields intentionally stay identical to ``ResolveRequest``. The
    extra fields control only inline delivery and never participate in operation
    selection or the signed plan.
    """

    dataset_id: str | None = Field(default=None, min_length=1, max_length=64)
    item_id: str | None = Field(default=None, min_length=1, max_length=128)
    ordinal: int | None = Field(default=None, ge=1, le=6)
    deadline_ms: int = Field(default=_INLINE_SERVER_BUDGET_MS, ge=100, le=3000)

    @model_validator(mode="after")
    def validate_dispatch_correlation(self) -> SelectorDispatchRequest:
        correlation = (self.dataset_id, self.item_id, self.ordinal)
        if any(value is not None for value in correlation) and not all(
            value is not None for value in correlation
        ):
            raise ValueError("dataset_id, item_id, ordinal must be provided together")
        return self


def _correlation(
    payload: RenderPlanRequest | SelectorDispatchRequest,
) -> dict[str, str | int] | None:
    if payload.dataset_id is None:
        return None
    assert payload.item_id is not None and payload.ordinal is not None
    return {
        "dataset_id": payload.dataset_id,
        "item_id": payload.item_id,
        "ordinal": payload.ordinal,
    }


def _resolve_request(payload: SelectorDispatchRequest) -> ResolveRequest:
    return ResolveRequest.model_validate(
        payload.model_dump(
            exclude={"dataset_id", "item_id", "ordinal", "deadline_ms"}
        )
    )


def _sanitized_order_draft(arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in arguments.items()
        if key in _ORDER_DRAFT_FIELDS and value is not None
    }


_PREFLIGHT_ERRORS = (
    AmbiguousOperationError,
    NoConfidentMatchError,
    InvalidArgumentsError,
    DetailGroupRequiredError,
    UnknownDetailGroupError,
)


def _selector_preflight(
    payload: SelectorDispatchRequest,
    selector: SelectorService,
    error: Exception,
) -> JSONResponse | None:
    """Return a local, effect-free shortlist for recoverable cold-path misses."""

    search = selector.search(
        SearchRequest(query=payload.question, intent=payload.intent, limit=3)
    )
    candidate_search = search
    if search.suggested_intent in {
        DiscoveryIntent.ORDER,
        DiscoveryIntent.WEBSOCKET,
    }:
        candidate_search = selector.search(
            SearchRequest(
                query=payload.question,
                intent=search.suggested_intent,
                limit=3,
            )
        )

    candidate_refs: list[str] = []
    candidate_intent = search.suggested_intent or payload.intent
    for hit in candidate_search.results:
        candidate_ref = hit.suggested_operation_ref or hit.operation_ref
        description = selector.describe(
            DescribeRequest(operation_ref=candidate_ref, intent=candidate_intent)
        )
        if description.execution_policy == "selector_detail_required":
            candidate_refs.extend(group.operation_ref for group in description.detail_groups)
        else:
            candidate_refs.append(candidate_ref)

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for operation_ref in candidate_refs:
        if operation_ref in seen or len(candidates) == 3:
            continue
        document = selector.catalog.find_exact(operation_ref)
        if document is None:
            continue
        description = selector.describe(
            DescribeRequest(operation_ref=operation_ref, intent=candidate_intent)
        )
        seen.add(operation_ref)
        candidates.append(
            {
                "operation_ref": description.operation_ref,
                "kind": description.kind,
                "name": description.name,
                "required_arguments": [
                    {
                        "alias": field.alias,
                        "description": field.description,
                        "json_schema": {
                            key: value
                            for key, value in field.json_schema.items()
                            if key not in {"title", "description"}
                        },
                    }
                    for field in description.required_arguments
                ],
            }
        )

    if not candidates:
        return None
    content: dict[str, Any] = {
        "status": "needs_inference",
        "code": getattr(error, "code", "SELECTOR_ERROR"),
        "catalog_version": search.catalog_version,
        "candidates": candidates,
    }
    if search.suggested_intent is not None:
        content["suggested_intent"] = search.suggested_intent
    return JSONResponse(content=content)


def _compact_websocket_ack(data: dict[str, Any], arguments: dict[str, Any]) -> dict[str, Any]:
    acknowledgement = {
        key: value
        for key, value in data.items()
        if key in _WEBSOCKET_ACK_FIELDS and value is not None
    }
    command = arguments.get("trnm")
    if isinstance(command, str) and command:
        acknowledgement["command"] = command
    return acknowledgement


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 3)


def _is_empty_payload(value: Any) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, dict):
        return all(_is_empty_payload(item) for item in value.values())
    if isinstance(value, list):
        return all(_is_empty_payload(item) for item in value)
    return False


def _empty_canvas(kind: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if kind == "facts":
        data: dict[str, Any] = {"fields": [], "empty_state": True}
    elif kind == "table":
        data = {"columns": [], "rows": [], "empty_state": True}
    else:
        data = {
            "header": [],
            "table": {"columns": [], "rows": []},
            "empty_state": True,
        }
    return data, {"empty_state": True}


def _timing(
    *, total_start: float, call_ms: float, transform_ms: float, delivery_ms: float
) -> dict[str, float]:
    return {
        "server_ms": _elapsed_ms(total_start),
        "call_ms": call_ms,
        "transform_ms": transform_ms,
        "delivery_ms": delivery_ms,
    }


def _display_receipt(
    *,
    delivery: Literal["side_channel", "inline"],
    canvas_kind: str,
    screen_id: str,
    meta: dict[str, Any],
    renderer_id: str | None = None,
) -> dict[str, Any]:
    """Return control metadata only; never copy rows, fields, values, or preview data."""
    receipt = {
        "pushed": delivery == "side_channel",
        "delivery": delivery,
        "canvas_type": canvas_kind,
        "screen_id": screen_id,
        "fell_back": False,
        "fallback_reason": None,
        "trimmed": bool(meta.get("trimmed") or meta.get("table_trimmed")),
        "partial": False,
        "cache_reused": False,
    }
    if renderer_id is not None:
        receipt["renderer_id"] = renderer_id
    return receipt


def _screen_contract(operation_ref: str | None) -> tuple[str, str, str | None] | None:
    resolved = resolve_screen_render_contract(operation_ref)
    return None if isinstance(resolved, str) else resolved


def _error_state_response(
    *,
    app: Any,
    payload: RenderPlanRequest,
    operation_ref: str,
    canvas_kind: str,
    screen_id: str,
    renderer_id: str | None,
    state: Literal["timeout", "cancelled", "error"],
    code: str,
    retryable: bool,
    total_start: float,
    call_ms: float,
    card_contract: dict[str, Any],
    reservation: _WorkspaceReservation,
) -> JSONResponse:
    if not _apply_workspace_reservation(app, card_contract, reservation):
        return _stale_workspace_response(
            operation_ref=operation_ref,
            reservation=reservation,
        )
    correlation = _correlation(payload)
    card_contract["presentation_contract"]["status"] = state
    for section in card_contract["presentation_contract"]["sections"]:
        section["status"] = state
    envelope: dict[str, Any] = {
        "canvas_type": canvas_kind,
        "screen_id": screen_id,
        "state": state,
        "fell_back": False,
        "fallback_reason": None,
        "caption": None,
        "layout": None,
        "drop_types": [],
        "error": {"code": code, "retryable": retryable},
        **card_contract,
    }
    if renderer_id is not None:
        envelope["renderer_id"] = renderer_id
    if correlation is not None:
        envelope["correlation"] = correlation
    receipt = _display_receipt(
        delivery="inline",
        canvas_kind=canvas_kind,
        screen_id=screen_id,
        meta={},
        renderer_id=renderer_id,
    )
    receipt.update({"state": state, "error_code": code})
    return JSONResponse(
        content={
            "delivery": "inline",
            "queued": False,
            "status": "error_rendered",
            "code": code,
            "operation_ref": operation_ref,
            **card_contract,
            "canvas_type": canvas_kind,
            "screen_id": screen_id,
            "correlation": correlation,
            "envelope": envelope,
            "receipt": receipt,
            "timing": _timing(
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=0.0,
                delivery_ms=0.0,
            ),
            "next_actions": ["retry_query"] if retryable else [],
        }
    )


def _stale_workspace_response(
    *,
    operation_ref: str,
    reservation: _WorkspaceReservation,
) -> JSONResponse:
    """A newer app-scoped request won; never emit the obsolete envelope."""

    return JSONResponse(
        content={
            "queued": False,
            "status": "stale_discarded",
            "code": "STALE_WORKSPACE_GENERATION",
            "operation_ref": operation_ref,
            "view_instance_id": reservation.view_instance_id,
            "workspace_generation": reservation.generation,
            "view_generation": reservation.generation,
            "envelope": None,
            "next_actions": [],
        }
    )


def _render_error(
    *,
    payload: RenderPlanRequest,
    status_code: int,
    code: str,
    detail: str,
    operation_ref: str | None,
    total_start: float,
    call_ms: float = 0.0,
    transform_ms: float = 0.0,
    next_actions: list[str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "delivery": payload.delivery,
            "queued": False,
            "status": "rejected" if call_ms == 0.0 else "transform_error",
            "code": code,
            "detail": detail,
            "operation_ref": operation_ref,
            "canvas_type": None,
            "correlation": _correlation(payload),
            "envelope": None,
            "receipt": None,
            "timing": _timing(
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=transform_ms,
                delivery_ms=0.0,
            ),
            "next_actions": next_actions or [],
        },
    )


@router.post(
    "/api/v1/selector/dispatch",
    operation_id="selector_dispatch",
    summary="Resolve and dispatch one app-internal selector request",
    openapi_extra={"x-athena-llm-exposed": False},
)
async def selector_dispatch(
    payload: SelectorDispatchRequest,
    request: Request,
    response: Response,
    client: OptionalDataClientDep,
    ws_client: OptionalWsClientDep,
    selector: SelectorServiceDep,
    account: AccountAliasDep,
) -> JSONResponse:
    """Resolve exactly once, then finish the selected safe workflow in-process."""

    try:
        resolved = selector.resolve(_resolve_request(payload), account=account)
    except _PREFLIGHT_ERRORS as exc:
        preflight = _selector_preflight(payload, selector, exc)
        if preflight is None:
            raise
        return preflight
    plan_token = resolved.plan_token

    if resolved.kind == "query":
        return await canvas_render_plan(
            RenderPlanRequest(
                plan_token=plan_token,
                delivery="inline",
                dataset_id=payload.dataset_id,
                item_id=payload.item_id,
                ordinal=payload.ordinal,
                deadline_ms=payload.deadline_ms,
            ),
            request,
            response,
            client,
            None,
            None,
            selector,
            account,
        )

    verified_plan = selector.signer.verify(
        plan_token, selector.catalog, expected_account=account
    )
    try:
        card_contract = _integrated_card_contract(
            verified_plan.operation_ref,
            arguments=getattr(verified_plan, "arguments", None),
            question_hash=verified_plan.question_hash,
            account=account,
            dataset_id=payload.dataset_id,
        )
    except (CanvasCardRegistryError, KeyError, ValueError) as exc:
        selector._consume_nonce(verified_plan)
        return JSONResponse(
            status_code=422,
            content={
                "status": "rejected",
                "code": "CANVAS_CARD_COVERAGE_MISSING",
                "operation_ref": verified_plan.operation_ref,
                "detail": str(exc),
            },
        )

    reservation = _reserve_workspace(request.app, card_contract)

    if resolved.kind == "order":
        # Resolution validates and seals the order arguments. This endpoint only
        # returns a ticket prefill; it never receives confirmation/auth headers and
        # never dispatches to the order client.
        selector._consume_nonce(verified_plan)
        order_draft = _sanitized_order_draft(verified_plan.arguments)
        _bind_semantic_values(
            card_contract,
            resolved.operation_ref,
            {**order_draft, "state": "draft"},
        )
        if not _apply_workspace_reservation(request.app, card_contract, reservation):
            return _stale_workspace_response(
                operation_ref=resolved.operation_ref,
                reservation=reservation,
            )
        card_title = resolve_fixed_card_title(resolved.operation_ref)
        envelope = {
            "canvas_type": "action",
            "card_title": card_title,
            "data": {"order_draft": order_draft, "state": "draft"},
            "layout": None,
            "drop_types": [],
            **card_contract,
        }
        return JSONResponse(
            content={
                "status": "guarded",
                "operation_ref": resolved.operation_ref,
                **card_contract,
                "card_title": card_title,
                "canvas_type": "action",
                "order_draft": order_draft,
                "envelope": envelope,
            }
        )

    if resolved.kind == "websocket":
        if payload.intent is not DiscoveryIntent.WEBSOCKET:
            selector._consume_nonce(verified_plan)
            return JSONResponse(
                status_code=422,
                content={
                    "status": "rejected",
                    "code": "WEBSOCKET_INTENT_REQUIRED",
                    "operation_ref": resolved.operation_ref,
                },
            )
        call_response = await selector.call(
            CallRequest(plan_token=plan_token),
            request,
            response,
            None,
            account=account,
            order_client=None,
            ws_client=ws_client,
        )
        acknowledgement = _compact_websocket_ack(
            call_response.data, verified_plan.arguments
        )
        _bind_semantic_values(
            card_contract,
            call_response.operation_ref,
            call_response.data,
        )
        if not _apply_workspace_reservation(request.app, card_contract, reservation):
            return _stale_workspace_response(
                operation_ref=call_response.operation_ref,
                reservation=reservation,
            )
        response_aliases = {
            field["alias"]
            for field in card_contract["field_contract"]
            if isinstance(field.get("alias"), str)
        }
        raw_ack_data = {
            key: value
            for key, value in call_response.data.items()
            if key in response_aliases
        }
        command = str(verified_plan.arguments.get("trnm") or "").upper()
        lifecycle = "disconnected" if command in {"REMOVE", "STOP", "CNSRCLR"} else "connected"
        state_label = "연결 해제됨" if lifecycle == "disconnected" else "실시간 연결됨"
        card_title = resolve_fixed_card_title(call_response.operation_ref)
        correlation = _correlation(payload)
        envelope = {
            "canvas_type": "event",
            "fell_back": False,
            "fallback_reason": None,
            "caption": "실시간 연결 상태",
            "card_title": card_title,
            "data": {
                "lifecycle": lifecycle,
                "state_label": state_label,
                "records": [{"상태": state_label}],
            },
            "raw_data": raw_ack_data,
            "source_data": {
                "operation_ref": call_response.operation_ref,
                "data": raw_ack_data,
            },
            "layout": None,
            "drop_types": [],
            "correlation": correlation,
            **card_contract,
        }
        return JSONResponse(
            content={
                "status": "acknowledged",
                "operation_ref": call_response.operation_ref,
                **card_contract,
                "card_title": card_title,
                "canvas_type": "event",
                "correlation": correlation,
                "envelope": envelope,
                "acknowledgement": acknowledgement,
            }
        )

    selector._consume_nonce(verified_plan)
    return JSONResponse(
        status_code=422,
        content={
            "status": "rejected",
            "code": "UNSUPPORTED_SELECTOR_KIND",
            "operation_ref": resolved.operation_ref,
        },
    )


@router.post("/api/v1/canvas/render-plan", operation_id="canvas_render_plan")
async def canvas_render_plan(
    payload: RenderPlanRequest,
    request: Request,
    response: Response,
    client: KiwoomClientDep,
    order_client: OptionalOrderClientDep,
    ws_client: OptionalWsClientDep,
    selector: SelectorServiceDep,
    account: AccountAliasDep,
) -> JSONResponse:
    total_start = time.perf_counter()
    correlation = _correlation(payload)
    # Every render-plan delivery is a read-only Kiwoom REST surface. Verify the
    # signed identity before inspecting delivery or dispatching so a default
    # side-channel request cannot register/remove WebSocket state or place an
    # order and only fail later during manifest transformation. Rejected
    # non-query tokens are deliberately burned: verification succeeded and the
    # caller spent this one-use execution attempt, matching selector.call's
    # established failure-after-verification nonce policy.
    verified_plan = selector.signer.verify(
        payload.plan_token, selector.catalog, expected_account=account
    )
    document = selector.catalog.find_exact(verified_plan.operation_ref)
    if document is None or document.kind != "query":
        selector._consume_nonce(verified_plan)
        return _render_error(
            payload=payload,
            status_code=422,
            code="INLINE_QUERY_ONLY",
            detail="canvas render-plan accepts signed query plans only",
            operation_ref=verified_plan.operation_ref,
            total_start=total_start,
            next_actions=["resolve_query_plan"],
        )

    try:
        card_contract = _integrated_card_contract(
            verified_plan.operation_ref,
            arguments=getattr(verified_plan, "arguments", None),
            question_hash=verified_plan.question_hash,
            account=account,
            dataset_id=payload.dataset_id,
        )
    except (CanvasCardRegistryError, KeyError, ValueError) as exc:
        selector._consume_nonce(verified_plan)
        return _render_error(
            payload=payload,
            status_code=422,
            code="CANVAS_CARD_COVERAGE_MISSING",
            detail=str(exc),
            operation_ref=verified_plan.operation_ref,
            total_start=total_start,
            next_actions=["register_canvas_card_contract"],
        )

    queue = getattr(request.app.state, "canvas_events", None)
    if payload.delivery == "side_channel" and queue is None:
        return JSONResponse(
            status_code=503, content={"detail": "캔버스 채널이 준비되지 않았다"}
        )

    authoritative_screen_contract = _screen_contract(verified_plan.operation_ref)
    if authoritative_screen_contract is None:
        return _render_error(
            payload=payload,
            status_code=422,
            code="CANVAS_COVERAGE_MISSING",
            detail="signed query plan has no authoritative read/display screen contract",
            operation_ref=verified_plan.operation_ref,
            total_start=total_start,
            next_actions=["register_manifest_screen"],
        )
    inline_operation_ref = (
        verified_plan.operation_ref if payload.delivery == "inline" else None
    )
    inline_contract = (
        authoritative_screen_contract if payload.delivery == "inline" else None
    )
    reservation = _reserve_workspace(request.app, card_contract)
    full_responses: list[BaseModel] = []

    # 주문 확인 헤더를 아예 받지 않는다 — 조회 plan만 실행 가능(주문 plan은
    # selector.call의 3중 게이트가 헤더 부재로 거부한다).
    call_start = time.perf_counter()
    try:
        if inline_contract is None:
            call_response = await selector.call(
                CallRequest(plan_token=payload.plan_token),
                request,
                response,
                client,
                account=account,
                order_client=order_client,
                ws_client=ws_client,
                full_response_sink=full_responses.append,
            )
        else:
            budget_ms = min(payload.deadline_ms, _INLINE_SERVER_BUDGET_MS)
            async with asyncio.timeout(budget_ms / 1000):
                call_response = await selector.call(
                    CallRequest(plan_token=payload.plan_token),
                    request,
                    response,
                    client,
                    account=account,
                    order_client=None,
                    ws_client=None,
                    full_response_sink=full_responses.append,
                )
    except TimeoutError:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            app=request.app,
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="timeout",
            code="UPSTREAM_TIMEOUT",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
            card_contract=card_contract,
            reservation=reservation,
        )
    except httpx.TimeoutException:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            app=request.app,
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="timeout",
            code="UPSTREAM_TIMEOUT",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
            card_contract=card_contract,
            reservation=reservation,
        )
    except asyncio.CancelledError:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            app=request.app,
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="cancelled",
            code="UPSTREAM_CANCELLED",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
            card_contract=card_contract,
            reservation=reservation,
        )
    except KiwoomError:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            app=request.app,
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="error",
            code="UPSTREAM_ERROR",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
            card_contract=card_contract,
            reservation=reservation,
        )
    call_ms = _elapsed_ms(call_start)
    call_payload = call_response.model_dump()

    transform_start = time.perf_counter()
    operation_ref = call_payload.get("operation_ref")
    if operation_ref != verified_plan.operation_ref:
        return _render_error(
            payload=payload,
            status_code=422,
            code="SIGNED_OPERATION_MISMATCH",
            detail="selector call response operation_ref differs from the signed plan",
            operation_ref=verified_plan.operation_ref,
            total_start=total_start,
            call_ms=call_ms,
            transform_ms=_elapsed_ms(transform_start),
            next_actions=["resolve_again"],
        )
    _bind_semantic_values(card_contract, operation_ref, call_payload.get("data"))
    if full_responses:
        initial_contract = _initial_surface_contract(
            card_contract,
            source=full_responses[0],
            tr_id=document.tr_id,
            target=verified_plan.arguments,
            selector=selector,
        )
        if initial_contract is not None:
            card_contract["initial_surface_contract"] = initial_contract
    screen_contract = authoritative_screen_contract

    if screen_contract is None:
        reason = describe_unsupported_render_plan_kind(operation_ref)
        logger.warning(
            "canvas_render_plan coverage 결함 — operation_ref=%s caller_canvas_type=%s 사유=%s",
            operation_ref,
            payload.canvas_type,
            reason,
        )
        transform_ms = _elapsed_ms(transform_start)
        return _render_error(
            payload=payload,
            status_code=422,
            code="CANVAS_COVERAGE_MISSING",
            detail=reason,
            operation_ref=operation_ref,
            total_start=total_start,
            call_ms=call_ms,
            transform_ms=transform_ms,
            next_actions=["register_manifest_screen"],
        )
    canvas_kind, screen_id, renderer_id = screen_contract

    if payload.canvas_type is not None and payload.canvas_type != canvas_kind:
        logger.warning(
            "canvas_render_plan canvas_type 불일치 — caller=%s manifest=%s "
            "operation_ref=%s (manifest가 이긴다)",
            payload.canvas_type,
            canvas_kind,
            operation_ref,
        )

    if canvas_kind == "chart":
        built = build_aits_chart_envelope_data(operation_ref, call_payload)
        if isinstance(built, str):
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_TRANSFORM_FAILED",
                detail=f"chart transform failed: {built}",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["resolve_again"],
            )
        aits_envelope, meta = built
        if aits_envelope["renderer_id"] != renderer_id:
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_COVERAGE_MISSING",
                detail="AITS renderer identity drifted during chart transform",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["register_manifest_screen"],
            )
        data: dict[str, Any] = aits_envelope["data"]
    elif canvas_kind == "table":
        if payload.delivery == "inline" and _is_empty_payload(call_payload.get("data")):
            built = _empty_canvas("table")
        else:
            built = build_table(call_payload)
        if isinstance(built, str):
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_TRANSFORM_FAILED",
                detail=f"table transform failed: {built}",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["resolve_again"],
            )
        data, meta = built
    else:  # facts / compound — TR 응답 본문만(위 _BUILD_FROM_TR_DATA 주석)
        tr_data = call_payload.get("data")
        if not isinstance(tr_data, dict):
            tr_data = {}
        if payload.delivery == "inline" and _is_empty_payload(tr_data):
            built = _empty_canvas(canvas_kind)
        else:
            built = _BUILD_FROM_TR_DATA[canvas_kind](tr_data)
        if isinstance(built, str):
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_TRANSFORM_FAILED",
                detail=f"{canvas_kind} transform failed: {built}",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["resolve_again"],
            )
        data, meta = built

    if canvas_kind != "chart":
        try:
            _apply_authoritative_public_labels(operation_ref, data)
        except CanvasCardRegistryError as exc:
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_COVERAGE_MISSING",
                detail=str(exc),
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["register_public_projection_label"],
            )

    if not _apply_workspace_reservation(request.app, card_contract, reservation):
        return _stale_workspace_response(
            operation_ref=operation_ref,
            reservation=reservation,
        )

    envelope = {
        "operation_ref": operation_ref,
        "canvas_type": canvas_kind,
        "screen_id": screen_id,
        "fell_back": False,
        "fallback_reason": None,
        "caption": payload.caption,
        # canvas_data.render_with_plan과 같은 규칙 — TR이 카드 16종 중 하나로
        # 확정되면 고정 이름이 타이틀, caption은 서브타이틀로 내려간다.
        "card_title": resolve_fixed_card_title(operation_ref),
        "data": data,
        "layout": None,
        "drop_types": [],
        # ``data`` is the optimized primary projection.  The full selector page
        # remains available to the integrated card's detail sheet regardless of
        # the legacy 40-field/50-row projection limits.
        "raw_data": call_payload.get("data"),
        "source_data": _lossless_source_data(call_payload),
        **card_contract,
    }
    if renderer_id is not None:
        envelope["renderer_id"] = renderer_id
    if correlation is not None:
        envelope["correlation"] = correlation
    # 서명된 plan이 봉인한 종목 식별자(canvas_context.symbol)를 봉투에 싣는다 —
    # 앱의 시세류 실시간 구독(main.js extractLiveQuoteSymbol)이 이 필드를 본다.
    # chart는 data 안에 이미 심지만(AITS DTO) table 등은 자리가 없었다.
    canvas_context = call_payload.get("canvas_context")
    sealed_symbol = canvas_context.get("symbol") if isinstance(canvas_context, dict) else None
    if isinstance(sealed_symbol, str) and sealed_symbol:
        envelope["stk_cd"] = sealed_symbol
    transform_ms = _elapsed_ms(transform_start)
    if payload.delivery == "inline":
        return JSONResponse(
            content={
                "delivery": "inline",
                "queued": False,
                "status": "rendered",
                "operation_ref": operation_ref,
                **card_contract,
                "canvas_type": canvas_kind,
                "screen_id": screen_id,
                "correlation": correlation,
                "envelope": envelope,
                "receipt": _display_receipt(
                    delivery="inline",
                    canvas_kind=canvas_kind,
                    screen_id=screen_id,
                    meta=meta,
                    renderer_id=renderer_id,
                ),
                "timing": _timing(
                    total_start=total_start,
                    call_ms=call_ms,
                    transform_ms=transform_ms,
                    delivery_ms=0.0,
                ),
                "next_actions": [],
            }
        )
    delivery_start = time.perf_counter()
    _enqueue_envelope(queue, envelope)
    delivery_ms = _elapsed_ms(delivery_start)
    return JSONResponse(
        content={
            "queued": True,
            "delivery": "side_channel",
            "status": "queued",
            "operation_ref": operation_ref,
            **card_contract,
            "canvas_type": canvas_kind,
            "screen_id": screen_id,
            "correlation": correlation,
            "envelope": None,
            "receipt": _display_receipt(
                delivery="side_channel",
                canvas_kind=canvas_kind,
                screen_id=screen_id,
                meta=meta,
                renderer_id=renderer_id,
            ),
            "timing": _timing(
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=transform_ms,
                delivery_ms=delivery_ms,
            ),
            "next_actions": [],
        }
    )


@router.websocket("/api/v1/ws/canvas", name="canvas_side_channel")
async def canvas_side_channel(websocket: WebSocket) -> None:
    await websocket.accept()
    if not await authenticate_downstream_ws(websocket):
        return
    queue = getattr(websocket.app.state, "canvas_events", None)
    if queue is None:
        # 준비 안 된 배포 — 조용한 무한대기 대신 정직하게 닫는다(1013 = try later).
        await websocket.close(code=1013)
        return
    await websocket.send_json({"type": "feed-ready", "feed": "canvas"})
    await pump_queue_to_websocket(websocket, queue)
