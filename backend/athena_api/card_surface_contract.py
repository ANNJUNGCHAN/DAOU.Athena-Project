"""표면 계약 파생 — REST(canvas_push)와 MCP(canvas_data)가 공유하는 단일 헬퍼.

계획 §3: 봉투 메타데이터에 ``surface_contract``를 실어 프론트가 Paper 보드 표면을
그대로 마운트하게 한다. **신뢰 경계는 바뀌지 않는다** — 이 모듈은 카드 계약이 이미
파생된 뒤에 붙는 파생물이고, 어떤 게이트도 넓히지 않는다(핸드오프 §3).

템플릿이 아직 저작되지 않은 op는 ``None``을 돌려준다. 그래서 REST 게이트가
canonical과 대조할 때 REST/MCP 양쪽이 같은 ``None``을 만들어 계약이 어긋나지 않는다.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping
from typing import Any

from athena_api.card_surface_templates import (
    BoardTemplate,
    CardSurfaceRegistry,
    SurfaceSlot,
    get_registry,
    visible_contracts,
)

SURFACE_CONTRACT_VERSION = "card-surface.v1"


def observation_id_for(wire_occurrence_id: str, array_index: int | None = None) -> str:
    """관찰 식별자 — 표면 슬롯과 의미 관찰이 **같은 문자열**을 써야 한다.

    canvas_push의 ``_observation_id``가 이 함수를 그대로 쓴다. 두 벌로 두면
    실시간 바인딩(binding_id ↔ observation_id)과 보드 슬롯이 조용히 갈린다.
    """

    suffix = "scalar" if array_index is None else f"row:{array_index}"
    digest = hashlib.sha256(
        f"semantic-observation\0{wire_occurrence_id}\0{suffix}".encode()
    ).hexdigest()[:20]
    return f"obs_{digest}"


def json_path_values(source: Any, json_path: str) -> list[Any]:
    """Evaluate the registry's small ``$.key`` / ``$.rows[].key`` path subset.

    canvas_push._bind_semantic_values가 쓰는 것과 **같은** 평가기다(그쪽이 이 함수를
    별칭으로 재수출한다) — 표면 슬롯이 의미 관찰과 다른 경로 해석을 하면 값이 갈린다.
    """

    if json_path == "$":
        return [source]
    if not json_path.startswith("$."):
        return []
    nodes = [source]
    for raw_part in json_path[2:].split("."):
        expands_array = raw_part.endswith("[]")
        key = raw_part[:-2] if expands_array else raw_part
        next_nodes: list[Any] = []
        for node in nodes:
            if not isinstance(node, dict) or key not in node:
                continue
            value = node[key]
            if expands_array:
                if isinstance(value, list):
                    next_nodes.extend(value)
            else:
                next_nodes.append(value)
        nodes = next_nodes
        if not nodes:
            break
    return nodes


def bind_surface_values(operation_ref: str, source: Any) -> dict[str, Any]:
    """occurrence_id → 값. 배열 경로는 열 전체(list), 스칼라는 첫 값이다."""

    bound: dict[str, Any] = {}
    for contract in visible_contracts(operation_ref):
        values = [
            value
            for value in json_path_values(source, contract.json_path)
            if not isinstance(value, (dict, list, tuple, set))
        ]
        if not values:
            continue
        if "[]" in contract.json_path:
            bound[contract.wire_occurrence_id] = values
        else:
            bound[contract.wire_occurrence_id] = values[0]
    return bound


def _slot_value(
    slot: SurfaceSlot, occurrence_id: str | None, bound: Mapping[str, Any]
) -> Any:
    if occurrence_id is None or occurrence_id not in bound:
        return _UNBOUND
    value = bound[occurrence_id]
    if slot.row_index is None:
        return value
    if not isinstance(value, list) or slot.row_index >= len(value):
        return _UNBOUND
    return value[slot.row_index]


def _resolve_slot(
    slot: SurfaceSlot, bound: Mapping[str, Any], priority: Mapping[str, int]
) -> tuple[str | None, Any]:
    """대체 바인딩이 있는 잎에서 **실제로 받은 값** 하나를 고른다.

    고르는 순서는 활성 op(요청 op가 먼저, 그다음 보드가 선언한 순서), 같은 op면
    주 바인딩이 먼저다. 값이 안 온 매핑은 후보가 아니다 — 그래야 한 op만 답한
    보드에서도 그 잎이 답한 op의 값을 그린다.
    """

    ranked = sorted(
        enumerate(slot.bindings),
        key=lambda item: (priority.get(item[1].mapping_id, len(priority)), item[0]),
    )
    for _, binding in ranked:
        value = _slot_value(slot, binding.occurrence_id, bound)
        if value is not _UNBOUND:
            return binding.occurrence_id, value
    return None, _UNBOUND


class _Unbound:
    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - 진단 표시용
        return "<unbound>"


_UNBOUND = _Unbound()


def _state_boards(
    registry: CardSurfaceRegistry, board: BoardTemplate
) -> list[dict[str, Any]]:
    return [
        {
            "board_id": child.board_id,
            "kind": child.state.kind,
            "control": child.state.control,
            # 프론트는 화면에 있는 글자로 조작 잎을 찾는다 — 기계 접두는 여기서 뗀다.
            "control_text": child.state.control_text,
        }
        for child in registry.state_boards_for(board.board_id)
    ]


def build_surface_contract(
    operation_ref: str,
    bound_values: Mapping[str, Any] | None = None,
    registry: CardSurfaceRegistry | None = None,
) -> dict[str, Any] | None:
    """보드 표면 계약을 만든다. 템플릿이 없는 op는 ``None``."""

    registry = registry if registry is not None else get_registry()
    board = registry.base_board_for(operation_ref)
    if board is None:
        return None
    return _board_contract(registry, board, bound_values, (operation_ref,))


def build_board_surface_contract(
    board_id: str,
    bound_values: Mapping[str, Any] | None = None,
    registry: CardSurfaceRegistry | None = None,
    active_operation_refs: Iterable[str] = (),
) -> dict[str, Any] | None:
    """보드를 직접 지정해 같은 계약을 만든다 — D2 보드 단위 fetch-set용.

    op 하나로 보드를 되찾는 :func:`build_surface_contract`와 달리, 보드의
    ``operation_refs`` 여러 개를 합쳐 받은 값으로 슬롯을 채울 때 쓴다.
    """

    registry = registry if registry is not None else get_registry()
    board = registry.boards.get(board_id)
    if board is None:
        return None
    return _board_contract(registry, board, bound_values, active_operation_refs)


def _operation_priority(
    board: BoardTemplate, active_operation_refs: Iterable[str]
) -> dict[str, int]:
    """요청 op가 먼저, 그다음 보드가 선언한 순서. 대체 바인딩 선택의 유일한 기준이다."""

    priority: dict[str, int] = {}
    for operation_ref in (*active_operation_refs, *board.operation_refs):
        priority.setdefault(operation_ref, len(priority))
    return priority


def _board_contract(
    registry: CardSurfaceRegistry,
    board: BoardTemplate,
    bound_values: Mapping[str, Any] | None,
    active_operation_refs: Iterable[str] = (),
) -> dict[str, Any]:
    bound = bound_values or {}
    priority = _operation_priority(board, active_operation_refs)
    slot_values: list[dict[str, Any]] = []
    unbound_slots: list[str] = []
    for slot in board.slots:
        if not slot.binds_a_field:
            # 보드 HTML이 이미 갖고 있는 고정 문구(라벨)다 — 채울 값이 없다.
            unbound_slots.append(slot.slot_id)
            continue
        occurrence_id, value = _resolve_slot(slot, bound, priority)
        if value is _UNBOUND:
            unbound_slots.append(slot.slot_id)
            continue
        entry: dict[str, Any] = {
            "slot_id": slot.slot_id,
            "occurrence_id": occurrence_id,
            # 실시간 프레임(realtime_bindings의 binding_id ↔ observation_id)이 어느
            # 슬롯을 가리키는지 프론트가 해시 없이 잇게 한다. 새 식별자가 아니라
            # 이미 봉투에 실려 있는 관찰 식별자 그대로다.
            "observation_id": observation_id_for(occurrence_id, slot.row_index),
            "value": value,
            "layer": slot.layer,
            "format": dict(slot.format),
        }
        if slot.row_index is not None:
            entry["row_index"] = slot.row_index
        slot_values.append(entry)
    return {
        "surface_version": SURFACE_CONTRACT_VERSION,
        "board_id": board.board_id,
        "card_id": board.card_id,
        "state_boards": _state_boards(registry, board),
        "slot_values": slot_values,
        "unbound_slots": unbound_slots,
        "column_priority": list(board.column_priority),
        "section_titles_ko": dict(board.section_titles_ko),
        "kiumi": dict(board.kiumi) if board.kiumi is not None else None,
    }


def attach_surface_contract(
    card_contract: dict[str, Any],
    operation_ref: str,
    source: Any = None,
    *,
    registry: CardSurfaceRegistry | None = None,
) -> dict[str, Any]:
    """REST·MCP 공통 첨부점. ``source``가 없으면 값 없는 골격(슬롯 전부 unbound)."""

    bound = bind_surface_values(operation_ref, source) if source is not None else None
    card_contract["surface_contract"] = build_surface_contract(
        operation_ref, bound, registry
    )
    return card_contract


def resolve_section_titles_ko(
    operation_ref: str, *, registry: CardSurfaceRegistry | None = None
) -> Mapping[str, str]:
    """slots.json이 선언한 한국어 섹션 제목. 템플릿이 없으면 빈 표."""

    registry = registry if registry is not None else get_registry()
    board = registry.base_board_for(operation_ref)
    if board is None:
        return {}
    return board.section_titles_ko
