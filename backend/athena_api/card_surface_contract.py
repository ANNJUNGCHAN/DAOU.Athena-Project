"""표면 계약 파생 — REST(canvas_push)와 MCP(canvas_data)가 공유하는 단일 헬퍼.

계획 §3: 봉투 메타데이터에 ``surface_contract``를 실어 프론트가 Paper 보드 표면을
그대로 마운트하게 한다. **신뢰 경계는 바뀌지 않는다** — 이 모듈은 카드 계약이 이미
파생된 뒤에 붙는 파생물이고, 어떤 게이트도 넓히지 않는다(핸드오프 §3).

템플릿이 아직 저작되지 않은 op는 ``None``을 돌려준다. 그래서 REST 게이트가
canonical과 대조할 때 REST/MCP 양쪽이 같은 ``None``을 만들어 계약이 어긋나지 않는다.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from typing import Any

from athena_api.generated.registry import TR_REGISTRY
from athena_api.card_surface_templates import (
    BoardTemplate,
    CardSurfaceRegistry,
    SurfaceSlot,
    get_registry,
    visible_contracts,
)

SURFACE_CONTRACT_VERSION = "card-surface.v1"

# ka10099 is a market/product list. The only authored boards that mention it use
# the list as supplementary stock metadata inside unrelated ranking views. Making
# either one the entry surface causes hydration to merge independently ordered
# ka10099 and ka10032 rows. Keep the source rows in the semantic workspace until
# a product-list board with its own entry contract exists.
_SOURCE_ROW_ONLY_OPERATIONS = frozenset({"base:ka10099"})


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


# 배열 **자체**를 가리키는 잎 — 표시할 수 있는 것은 두 가지뿐이다(실측 604자리).
#
#   순번  그 잎이 되풀이의 k번째 줄에 앉아 있으면 「k+1번째 항목」이다. Paper 문면이
#         `01`·`02`로 그 뜻을 적어 두었고, 자릿수(`01`)도 그대로 지킨다.
#   건수  줄 밖에 한 번 그려졌고 문면이 「8종목」·「100개 결과」처럼 수량 단위를 달고
#         있으면 배열의 길이다. 단위는 Paper 문면의 것을 그대로 쓴다.
#
# 그 밖의 문면(`30분 누적`·`1위`)은 배열 길이도 순번도 아니다 — 손대지 않는다.
# 여기서 문자열을 만드는 이유는 문면 자체가 계약(템플릿)에 있기 때문이다.
# 문면 전체가 「수 + 수량 단위」일 때만 건수로 본다. 뒤에 다른 말이 붙은 문면
# (`8종목 · 평가액 순 · 09:42 기준`)은 그 말까지 Paper 목업이라 함께 실으면 없는
# 기준 시각을 지어내게 된다 — 건드리지 않는다.
_COUNT_TEXT = re.compile(r"^(\d[\d,]*)\s*(개 결과|종목|개|건|종|명)$")


def _container_value(slot: SurfaceSlot, occurrence_id: str, rows: list) -> Any:
    parts = occurrence_id.split("|")
    if len(parts) < 2 or "[]" in parts[1]:
        return _UNBOUND
    paper_text = (slot.paper_text or "").strip()
    if slot.row_index is not None:
        if slot.row_index >= len(rows):
            return _UNBOUND
        ordinal = str(slot.row_index + 1)
        if paper_text.isdigit():
            return ordinal.zfill(len(paper_text))
        return _UNBOUND
    match = _COUNT_TEXT.match(paper_text)
    if match is None:
        return _UNBOUND
    return f"{len(rows)}{paper_text[match.end(1):]}"  # 단위는 Paper 문면 그대로


def _slot_value(
    slot: SurfaceSlot,
    occurrence_id: str | None,
    bound: Mapping[str, Any],
    solo_occurrences: frozenset[str] = frozenset(),
) -> Any:
    if occurrence_id is None or occurrence_id not in bound:
        return _UNBOUND
    value = bound[occurrence_id]
    if slot.row_index is None:
        # ``bind_surface_values``는 배열 JSONPath를 열 전체(list)로 보존한다. 목록을
        # 그대로 넘기면 프론트의 String(array)가 쉼표로 이어진 원문을 한 칸에 쏟으므로
        # 반드시 원소 하나를 골라야 한다.
        #
        # 되풀이 블록·표 셀의 행 좌표는 템플릿 로더가 이미 되찾아 ``row_index``에
        # 적는다(``_derive_array_rows``). 그러고도 행이 없는 잎은 **되풀이 밖에 한 번
        # 그려진 자리**다 — 그 자리는 응답 정렬의 첫 원소를 말한다(조회가 정렬을
        # 지정하고, 화면이 그 목록의 첫 항목을 주인공으로 그린다). 그래서 첫 원소를
        # 쓴다. 빈 목록은 값이 아니다.
        if isinstance(value, list):
            if not value:
                return _UNBOUND
            # 배열 자체를 가리키는 잎은 원소가 아니라 순번·건수를 말한다.
            container = _container_value(slot, occurrence_id, value)
            if container is not _UNBOUND:
                return container
            # 같은 배열 자리를 여러 잎이 나눠 그리고 있으면(행 좌표 없는 열) 어느 잎이
            # 어느 행인지 알 수 없다 — 전부 첫 원소로 채우면 같은 값이 여러 줄에
            # 반복되는 **틀린 화면**이 된다. 결측으로 닫고 줄 접기에 맡긴다.
            if occurrence_id not in solo_occurrences:
                return _UNBOUND
            first = value[0]
            if isinstance(first, (dict, list, tuple, set)):
                return _UNBOUND
            if first is None or (isinstance(first, str) and not first.strip()):
                return _EMPTY
            return first
        if value is None or (isinstance(value, str) and not value.strip()):
            return _EMPTY
        return value
    if not isinstance(value, list):
        return _UNBOUND
    # 배열 자체를 가리키는 잎(순번) — 원소를 꺼내는 대상이 아니다.
    container = _container_value(slot, occurrence_id, value)
    if container is not _UNBOUND:
        return container
    if slot.row_index >= len(value):
        return _UNBOUND
    row_value = value[slot.row_index]
    if row_value is None or (isinstance(row_value, str) and not row_value.strip()):
        return _EMPTY
    return row_value


def _resolve_slot(
    slot: SurfaceSlot,
    bound: Mapping[str, Any],
    priority: Mapping[str, int],
    solo_occurrences: frozenset[str] = frozenset(),
    peer_name_occurrence: str | None = None,
) -> tuple[str | None, Any]:
    """대체 바인딩이 있는 잎에서 **실제로 받은 값** 하나를 고른다.

    고르는 순서는 활성 op(요청 op가 먼저, 그다음 보드가 선언한 순서), 같은 op면
    주 바인딩이 먼저다. 값이 안 온 매핑은 후보가 아니다 — 그래야 한 op만 답한
    보드에서도 그 잎이 답한 op의 값을 그린다.

    표 행은 예외: 같은 줄 종목명이 가리키는 목록에 이 필드가 있으면 그 값을 먼저
    쓴다. 서로 다른 순위 TR을 한 행에 섞지 않기 위해서다.
    """

    if peer_name_occurrence and slot.f and slot.f != "stk_nm":
        aligned = _list_field_occurrence(peer_name_occurrence, slot.f)
        if aligned:
            value = _slot_value(slot, aligned, bound, solo_occurrences)
            if value is not _UNBOUND and value is not _EMPTY:
                return aligned, value
    ranked = sorted(
        enumerate(slot.bindings),
        key=lambda item: (priority.get(item[1].mapping_id, len(priority)), item[0]),
    )
    empty: tuple[str | None, Any] | None = None
    for _, binding in ranked:
        value = _slot_value(slot, binding.occurrence_id, bound, solo_occurrences)
        if value is _EMPTY:
            # 다른 op가 실제 값을 실어 왔을 수 있다 — 빈 값은 마지막에 쓴다.
            if empty is None:
                empty = (binding.occurrence_id, value)
            continue
        if value is not _UNBOUND:
            return binding.occurrence_id, value
    if empty is not None:
        return empty
    return None, _UNBOUND


def _composite_value(
    slot: SurfaceSlot,
    bound: Mapping[str, Any],
    solo_occurrences: frozenset[str] = frozenset(),
) -> Any:
    """명시된 모든 part가 원자 값일 때만 wire composite를 만든다."""

    composite = slot.composite
    if composite is None:
        return _UNBOUND
    parts: list[dict[str, Any]] = []
    for part in composite.parts:
        occurrence_id = part.occurrence_id
        value = _slot_value(slot, occurrence_id, bound, solo_occurrences)
        if value is _EMPTY:
            return _EMPTY
        if value is _UNBOUND:
            return _UNBOUND
        assert occurrence_id is not None
        parts.append(
            {
                "mapping_id": part.mapping_id,
                "f": part.f,
                "occurrence_id": occurrence_id,
                "observation_id": observation_id_for(
                    occurrence_id, slot.row_index
                ),
                "value": value,
                "format": dict(part.format),
            }
        )
    return {"composite": {"separator": composite.separator, "parts": parts}}


class _Unbound:
    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - 진단 표시용
        return "<unbound>"


_UNBOUND = _Unbound()


class _EmptyValue:
    """응답이 그 자리를 **빈 값으로 답했다**. 결측(안 왔다)과 구분한다.

    업스트림이 필드를 싣고 값만 비운 자리다(실측 2VIN-0의 ETF `drng` 스무 줄 중
    열다섯). 「미제공」은 「제공되지 않는다」는 뜻이라 여기 쓰면 거짓말이 된다 —
    제공됐고, 그 줄에는 해당 값이 없다. 화면은 빈 칸으로 둔다.
    """

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - 진단 표시용
        return "<empty>"


_EMPTY = _EmptyValue()


def _row_key(slot: SurfaceSlot) -> tuple[str, str, int | str] | None:
    """이 잎이 앉은 되풀이 줄의 이름. 되풀이가 아니면 ``None``."""

    cell = slot.table
    if cell is not None:
        return ("table", cell.table_id, cell.row)
    if slot.row_index is not None:
        return ("region", slot.region or "", slot.row_index)
    return None


def _row_name_occurrences(board: BoardTemplate) -> dict[tuple[str, str, int | str], str]:
    """같은 되풀이 줄의 종목명 occurrence. 이름·코드·가격이 서로 다른 순위 TR을
    물고 한 행에 섞이는 것을 막는다(실측 2V71-0: ka90003 이름 + ka10034 코드)."""

    mapping: dict[tuple[str, str, int | str], str] = {}
    for slot in board.slots:
        if slot.f != "stk_nm" or not slot.occurrence_id:
            continue
        key = _row_key(slot)
        if key is None:
            continue
        mapping.setdefault(key, slot.occurrence_id)
    return mapping


def _list_field_occurrence(occurrence_id: str, field: str) -> str | None:
    """``mapping|$.rows[].stk_nm|1`` 의 필드만 ``field`` 로 바꾼다."""

    parts = occurrence_id.split("|")
    if len(parts) < 3:
        return None
    path = parts[1]
    needle = "[]."
    idx = path.rfind(needle)
    if idx < 0:
        return None
    return "|".join((parts[0], f"{path[: idx + len(needle)]}{field}", *parts[2:]))


def _empty_rows(
    board: BoardTemplate, filled: set[str]
) -> list[dict[str, Any]]:
    """값이 하나도 안 온 되풀이 줄 — 화면에서 지울 줄의 목록.

    응답이 20행짜리 목록에 3행만 실어 오면 나머지 17줄은 **자료가 없는 줄**이다.
    그 줄의 칸마다 결측어를 찍으면 보드가 결측어 벽이 된다(2026-09-09 실측: 응답
    행수를 넘는 칸 642개 · 업무 오류로 빈 칸 401개). 헌장 §3.1의 영값 묶음과 같은
    처리를 줄 단위로 한다 — 줄을 접고, 값이 오면 그 줄이 다시 선다.

    한 칸이라도 값이 온 줄은 목록에 넣지 않는다. 그 줄은 자료가 있는 줄이고, 빈
    칸은 그 줄 안에서 정직하게 결측으로 남아야 한다.
    """

    rows: dict[tuple[str, str, int | str], list[str]] = {}
    bound_rows: set[tuple[str, str, int | str]] = set()
    for slot in board.slots:
        if slot.kind != "value" and not slot.omitted_unsupported:
            continue
        key = _row_key(slot)
        if key is None:
            continue
        rows.setdefault(key, []).append(slot.slot_id)
        if slot.slot_id in filled:
            bound_rows.add(key)
    return [
        {
            "row": f"{key[0]}:{key[1]}:{key[2]}",
            "slot_ids": sorted(slot_ids),
        }
        for key, slot_ids in sorted(rows.items(), key=lambda item: str(item[0]))
        if key not in bound_rows
    ]


def _solo_array_occurrences(board: BoardTemplate) -> frozenset[str]:
    """행 좌표 없이 **한 자리에만** 그려진 배열 occurrence.

    되풀이 밖에 한 번 그려진 잎은 응답 정렬의 첫 원소를 말한다(조회가 정렬을 정하고,
    화면이 그 목록의 첫 항목을 주인공으로 그린다). 반대로 같은 배열 자리를 잎 여럿이
    나눠 그리고 있으면 그것은 행 좌표를 잃은 열이다 — 첫 원소로 다 채우면 같은 값이
    여러 줄 반복되는 틀린 화면이 되므로 채우지 않는다.
    """

    seen: dict[str, int] = {}
    for slot in board.binding_slots:
        if slot.row_index is not None:
            continue
        for binding in slot.bindings:
            occurrence_id = binding.occurrence_id
            if occurrence_id is None:
                continue
            parts = occurrence_id.split("|")
            if len(parts) < 2 or "[]" not in parts[1]:
                continue
            seen[occurrence_id] = seen.get(occurrence_id, 0) + 1
    return frozenset(key for key, count in seen.items() if count == 1)


# 값이 **조회 응답이 아니라 다른 경로**로 오는 op 종류. 하이드레이션은 이 둘을 부르지
# 않는다(실시간은 REST 경로가 없고, 주문은 읽기가 아니다).
_DEFERRED_KINDS = frozenset({"websocket", "order"})


def _operation_is_deferred(mapping_id: str) -> bool:
    """이 op의 값이 조회 응답 밖(실시간 프레임·주문 응답)에서 오는가."""

    parts = mapping_id.split(":")
    tr_id = parts[1] if len(parts) >= 2 else mapping_id
    spec = TR_REGISTRY.get(tr_id)
    return spec is not None and spec.kind in _DEFERRED_KINDS


def _deferred_value_slots(board: BoardTemplate, filled: set[str]) -> list[str]:
    """값이 **조회 응답 밖**에서 오는 잎 — 아직 안 온 것은 결측이 아니다.

    두 갈래다. 호가 사다리·체결 흐름은 websocket 프레임이 채우고(실측 967자리),
    정정·취소 주문 화면의 수량·원주문번호는 주문을 낸 뒤 그 응답이 채운다(실측
    2TAG-1·2TET-1 3자리). 둘 다 첫 값 전에 「미제공」을 찍으면 「이 값은 제공되지
    않는다」는 거짓말이 된다 — 제공되고, 아직 오지 않았을 뿐이다. 프론트는 그 자리를
    빈 칸으로 두고 값이 오면 채운다(board-mount `deferredValueSlots`).

    바인딩이 **하나라도** 그런 op면 그 잎의 주 출처는 그 경로다. 조회 대체 바인딩이
    값을 못 실어 왔더라도 프레임·주문 응답이 오면 채워진다.
    """

    pending: list[str] = []
    for slot in board.binding_slots:
        if slot.slot_id in filled:
            continue
        bindings = slot.bindings
        if not bindings:
            continue
        if any(_operation_is_deferred(binding.mapping_id) for binding in bindings):
            pending.append(slot.slot_id)
    return pending


def _empty_columns(board: BoardTemplate, filled: set[str]) -> list[dict[str, Any]]:
    """값이 **한 줄도** 안 온 표의 열 — 화면에서 지울 열의 목록.

    응답이 어떤 필드를 아예 싣지 않으면 그 열은 모든 줄에서 결측이다(실측 2VIN-0:
    14칸 중 3~4칸이 스무 줄 내리 결측어). 줄 접기(:func:`_empty_rows`)와 같은
    처리를 열 단위로 한다 — 머리글까지 함께 지워 열이 통째로 사라진다. 값이 한
    칸이라도 오면 그 열은 목록에 없다.

    열 하나에 두 줄 셀(병기)이 필드 둘을 실을 수 있으므로 판정은 (표·열) 단위다.
    """

    cells: dict[tuple[str, int], list[str]] = {}
    bound_columns: set[tuple[str, int]] = set()
    rows_seen: dict[tuple[str, int], set[str]] = {}
    for slot in board.slots:
        cell = slot.table
        if cell is None:
            continue
        key = (cell.table_id, cell.col)
        cells.setdefault(key, []).append(slot.slot_id)
        if not slot.binds_a_field:
            continue
        rows_seen.setdefault(key, set()).add(str(cell.row))
        if slot.slot_id in filled:
            bound_columns.add(key)
    empty = [
        (table_id, col, slot_ids)
        for (table_id, col), slot_ids in sorted(cells.items(), key=lambda item: str(item[0]))
        # 값 바인딩이 두 줄 이상 있는 열만 본다 — 한 줄짜리는 열이 아니라 한 칸이고,
        # 그 칸의 결측은 그 자리의 정직한 결측이다.
        if (table_id, col) not in bound_columns
        and len(rows_seen.get((table_id, col), ())) >= 2
    ]
    # 표의 **모든** 열이 비면 머리글만 남은 표가 된다. 그 표는 통째로 접는다 —
    # 자료 없는 표의 머리글만 남기는 것은 화면에 뜻 없는 줄을 남기는 것이다.
    columns_by_table: dict[str, set[int]] = {}
    for table_id, col in cells:
        columns_by_table.setdefault(table_id, set()).add(col)
    empty_by_table: dict[str, set[int]] = {}
    for table_id, col, _ in empty:
        empty_by_table.setdefault(table_id, set()).add(col)
    dead_tables = {
        table_id
        for table_id, columns in columns_by_table.items()
        if table_id in empty_by_table and empty_by_table[table_id] == columns
    }
    result = [
        {"column": f"{table_id}:{col}", "slot_ids": sorted(slot_ids)}
        for table_id, col, slot_ids in empty
        if table_id not in dead_tables
    ]
    for table_id in sorted(dead_tables):
        slot_ids = sorted(
            slot_id
            for (owner, _), ids in cells.items()
            if owner == table_id
            for slot_id in ids
        )
        result.append({"column": f"{table_id}:*", "slot_ids": slot_ids, "whole_table": True})
    return result


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

    if operation_ref in _SOURCE_ROW_ONLY_OPERATIONS:
        return None
    registry = registry if registry is not None else get_registry()
    board = registry.base_board_for(operation_ref)
    if board is None:
        return None
    initial = registry.initial_state_board_for(operation_ref)
    return _board_contract(
        registry,
        board,
        bound_values,
        (operation_ref,),
        initial_state_board=initial.board_id if initial is not None else None,
    )


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
    *,
    initial_state_board: str | None = None,
) -> dict[str, Any]:
    bound = bound_values or {}
    priority = _operation_priority(board, active_operation_refs)
    solo_occurrences = _solo_array_occurrences(board)
    row_names = _row_name_occurrences(board)
    slot_values: list[dict[str, Any]] = []
    unbound_slots: list[str] = []
    empty_value_slots: list[str] = []
    for slot in board.slots:
        if slot.omitted_unsupported and not slot.binds_a_field:
            # 모의투자가 거절하는 TR 만 가리키던 값. 빈 칸이고 결측어가 아니다.
            empty_value_slots.append(slot.slot_id)
            continue
        if not slot.binds_a_field:
            # 보드 HTML이 이미 갖고 있는 고정 문구(라벨)다 — 채울 값이 없다.
            unbound_slots.append(slot.slot_id)
            continue
        if slot.composite is not None:
            occurrence_id = None
            value = _composite_value(slot, bound, solo_occurrences)
        else:
            row = _row_key(slot)
            occurrence_id, value = _resolve_slot(
                slot,
                bound,
                priority,
                solo_occurrences,
                row_names.get(row) if row is not None else None,
            )
        if value is _EMPTY:
            # 응답이 빈 값으로 답한 자리 — 결측어가 아니라 빈 칸이다.
            empty_value_slots.append(slot.slot_id)
            unbound_slots.append(slot.slot_id)
            continue
        if value is _UNBOUND:
            unbound_slots.append(slot.slot_id)
            continue
        entry: dict[str, Any] = {
            "slot_id": slot.slot_id,
            "value": value,
            "layer": slot.layer,
            "format": dict(slot.format),
        }
        if occurrence_id is not None:
            entry["occurrence_id"] = occurrence_id
            # 실시간 프레임(realtime_bindings의 binding_id ↔ observation_id)이 어느
            # 슬롯을 가리키는지 프론트가 해시 없이 잇게 한다. composite는 각 part가
            # 자기 observation_id를 나른다.
            entry["observation_id"] = observation_id_for(
                occurrence_id, slot.row_index
            )
        if slot.row_index is not None:
            entry["row_index"] = slot.row_index
        slot_values.append(entry)
    return {
        "surface_version": SURFACE_CONTRACT_VERSION,
        "board_id": board.board_id,
        "card_id": board.card_id,
        # 자료가 한 칸도 없는 되풀이 줄 — 프론트가 그 줄을 접는다(:func:`_empty_rows`).
        "empty_rows": _empty_rows(
            board, {entry["slot_id"] for entry in slot_values}
        ),
        # 응답이 빈 값으로 답한 자리 — 프론트가 빈 칸으로 둔다(결측어 아님).
        "empty_value_slots": empty_value_slots,
        # 값이 한 줄도 없는 표의 열 — 프론트가 머리글까지 지운다(:func:`_empty_columns`).
        "empty_columns": _empty_columns(
            board, {entry["slot_id"] for entry in slot_values}
        ),
        # 값이 조회 응답 밖(실시간 프레임·주문 응답)에서 오는 잎 — 그전에는 빈 칸이다.
        "deferred_value_slots": _deferred_value_slots(
            board, {entry["slot_id"] for entry in slot_values}
        ),
        "state_boards": _state_boards(registry, board),
        # 이 보드를 세운 직후 갈아탈 탭 보드. op로 연 계약에만 실리고, 보드를
        # 직접 지정한 계약(:func:`build_board_surface_contract`)에서는 언제나
        # None이다 — 이미 그 보드에 있다.
        "initial_state_board": initial_state_board,
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
