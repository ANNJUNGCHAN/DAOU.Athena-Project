"""Paper 보드 표면 템플릿 로더 — 추출물(board.html)과 슬롯 표(slots.json)를 읽는다.

`docs/architecture/card-surface-implementation-plan.md` §2·§3의 계약을 그대로 구현한다.
보드 HTML은 Paper `get_jsx` 추출물이라 **불변**이고, 이 모듈은 그것을 재조립하지
않는다 — 해시 대조와 슬롯 표 검증만 한다.

fail-closed 원칙: 저작된 보드(slots.json이 있는 디렉터리)는 언제나 6종 검증 중
보드-지역 규칙(해시·밀도 예산·상태 참조·비노출 슬롯·중복 바인딩)을 통과해야 한다.
전역 커버리지 규칙(가시 필드 전수 1회 바인딩·299 op 커버)은 index.json이
``"complete": true``를 선언했을 때만 강제한다 — 저작이 끝나기 전에는 부분 로드를
허용해야 나머지 레인이 진행할 수 있기 때문이다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from functools import cache, lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = BACKEND / "ref" / "card-surface-templates"

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "card-surface.v1"

# 헌장 §2.3의 밀도 예산(하드). 위반은 그 보드를 제품 표면에서 뺀다 — Paper 보드가
# 아닌 밀도로 저작된 슬롯 표는 표면이 될 수 없다. `rows_max`는 헌장 문법 C("표시
# 행수 = 응답 행수, 상한 20")에 표 바닥의 합계·평균 두 줄을 더한 선이다. 헌장 A5가
# foot 행을 본문에서 빼므로 본문은 여전히 20이고, 추출 실측은 그 두 줄까지 센다.
DENSITY_BUDGET = MappingProxyType(
    {
        "table_columns": 8,
        "rows_max": 22,
    }
)

# 소프트 예산 — 넘으면 경고만 남기고 로드는 통과한다. 레일 블록 수·KPI 칸 수·레일
# 행수는 모두 헌장 H1(영값 묶음) 적용 **후** 기준이라 추출 시점 실측이 넘을 수 있고,
# 그 한 줄 때문에 보드를 제품 표면에서 지우는 것이 더 큰 손실이다(디자인 완전 동일
# 제약). 하드로 남는 것은 표가 가로로 넘치는 자리(table_columns)·표가 세로로 넘치는
# 자리(rows_max)·보드가 화면을 넘는 자리(height_px)뿐이다.
SOFT_DENSITY_BUDGET = MappingProxyType(
    {
        "kpi_cells": 6,
        "rail_blocks": 5,
        "rail_rows_max": 6,
    }
)

# 헌장 §2.3 "메인 보드 높이 1,120px 이하" — 하드.
HEIGHT_BUDGET_PX = 1120

STATE_KINDS = frozenset({"default", "tab", "sort", "expand"})
# D6 — 추출기가 DOM에서 판정해 적는 슬롯 층위(추출물이 쓰는 한국어가 canonical).
SLOT_LAYERS = frozenset({"직접", "병기", "펼침"})
_LAYER_ALIASES = MappingProxyType(
    {"direct": "직접", "paired": "병기", "expanded": "펼침"}
)
SLOT_KINDS = frozenset({"label", "value"})

# 지시 열(호가 사다리처럼 `..._1`~`..._5`가 한 열에 세로로 앉는 자리)의 원본 패턴에서
# 자리표를 찾는다. 추출기는 셀마다 확장된 `f`를 적고 `f_pattern`에 원본을 남긴다.
_INDEX_PLACEHOLDER = re.compile(r"\{[^{}]*\}")

_REQUIRED_BOARD_KEYS = ("board_id", "card_id", "html_sha256", "operation_refs", "slots")


class CardSurfaceTemplateError(ValueError):
    """Raised when the authored surface templates cannot form a valid registry."""


@dataclass(frozen=True, slots=True)
class SlotBinding:
    """슬롯이 도달하는 (mapping_id, f) 한 쌍과 그것이 해석된 canonical occurrence.

    주 바인딩은 슬롯 자신의 ``mapping_id``/``f``이고, ``alt_mappings``는 같은 잎이
    **다른 op가 답했을 때** 쓰는 대체 경로다. 어느 쪽을 쓸지는 계약 파생 시점에
    실제로 받은 값(bound_values)과 활성 op 우선순위가 정한다.
    """

    mapping_id: str
    f: str
    occurrence_id: str | None
    declared_occurrence_id: str | None
    json_path: str | None


@dataclass(frozen=True, slots=True)
class CompositePart:
    """한 Paper 텍스트 잎 안에서 함께 표시할 원자 값 하나."""

    mapping_id: str
    f: str
    occurrence_id: str | None
    declared_occurrence_id: str | None
    json_path: str | None
    format: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class SlotComposite:
    """명시적으로 저작된 여러 원자 값의 표시 순서와 구분자."""

    separator: str
    parts: tuple[CompositePart, ...]


@dataclass(frozen=True, slots=True)
class TableCell:
    """셀 슬롯의 표 좌표. 같은 ``table_id``·``col``의 다른 행은 한 열의 반복이다."""

    table_id: str
    row: str
    col: int


@dataclass(frozen=True, slots=True)
class SurfaceSlot:
    """추출기가 적은 텍스트 노드 1개. 필드 바인딩은 저작(W2)이 채운다.

    ``mapping_id``/``f``가 둘 다 있는 슬롯만 값 바인딩 대상이다 — 나머지는 보드
    HTML이 이미 갖고 있는 고정 문구(라벨)라 값이 필요 없다.
    """

    slot_id: str
    mapping_id: str | None
    f: str | None
    # 로드 시 canonical occurrence로 해석된 결과. 바인딩을 선언했는데 해석되지
    # 않으면 None이고 validation이 그 보드를 막는다.
    occurrence_id: str | None
    declared_occurrence_id: str | None
    json_path: str | None
    row_index: int | None
    node_id: str | None
    node_path: str | None
    kind: str | None
    anchor: Mapping[str, Any] | None
    kor: str | None
    layer: str | None
    region: str | None
    format: Mapping[str, Any]
    paired_with: str | None
    # 같은 값을 KPI·레일에 한 번 더 보여주는 슬롯(머리글 재표시). 병기가 아니므로
    # `paired_with`로 묶을 수 없고, 저작이 의도를 명시해야 중복 금지에서 빠진다.
    display_dup: bool
    collapse_group: Mapping[str, Any] | None
    expanded_board: str | None
    paper_text: str | None
    # 같은 잎이 도달하는 다른 (mapping_id, f). 보드 하나가 여러 op를 받는 자리(D2)에서
    # 답한 op에 따라 값의 출처가 갈리는 잎이다.
    alt_mappings: tuple[SlotBinding, ...]
    # 한 텍스트 잎에 여러 원자 값을 함께 표시하는 명시적 계약. 대체 바인딩이나
    # 추출기의 extra_fields를 조합으로 추정하지 않는다.
    composite: SlotComposite | None
    # 지시 열의 원본 패턴(`ovt_sigpric_sel_bid_{n}`). 셀의 `f`는 이미 확장돼 있고,
    # 이 값은 그 확장이 어느 열에서 나왔는지를 잃지 않으려고 그대로 보존한다.
    f_pattern: str | None
    table: TableCell | None

    @property
    def binds_a_field(self) -> bool:
        return self.composite is not None or (bool(self.mapping_id) and bool(self.f))

    @property
    def bindings(self) -> tuple[SlotBinding | CompositePart, ...]:
        """주 바인딩이 먼저, 그다음 대체 바인딩. 바인딩이 없으면 빈 튜플."""

        if self.composite is not None:
            return self.composite.parts
        if not self.binds_a_field:
            return ()
        primary = SlotBinding(
            mapping_id=self.mapping_id,
            f=self.f,
            occurrence_id=self.occurrence_id,
            declared_occurrence_id=self.declared_occurrence_id,
            json_path=self.json_path,
        )
        return (primary, *self.alt_mappings)

    @property
    def occurrence_ids(self) -> tuple[str, ...]:
        """이 슬롯이 도달할 수 있는 occurrence 전부(중복 제거, 주 바인딩 먼저)."""

        seen: list[str] = []
        for binding in self.bindings:
            if binding.occurrence_id and binding.occurrence_id not in seen:
                seen.append(binding.occurrence_id)
        return tuple(seen)


@dataclass(frozen=True, slots=True)
class BoardState:
    kind: str
    parent_board: str | None
    control: str | None
    # 화면에 실제로 있는 글자. `control`이 `tab|시간외 호가`처럼 기계 접두를 달고
    # 있어도 프론트가 잎 텍스트로 조작을 찾을 수 있어야 한다(canvas.js findStateControl).
    control_text: str | None


@dataclass(frozen=True, slots=True)
class BoardTemplate:
    board_id: str
    card_id: str
    html: str
    html_sha256: str
    width_px: float | None
    height_px: float | None
    operation_refs: tuple[str, ...]
    state: BoardState
    density: Mapping[str, int]
    slots: tuple[SurfaceSlot, ...]
    primary: Mapping[str, Any] | None
    column_priority: tuple[str, ...]
    section_titles_ko: Mapping[str, str]
    paper_source: Mapping[str, Any]
    # Paper 카드미니(H-1)에서 승인된 360×420 고정 표시 계약. 값은
    # ``surface_contract.slot_values``가 계속 나르고, 이 필드는 어떤 슬롯을 어떤
    # 문법으로 보여줄지만 정한다.
    kiumi: Mapping[str, Any] | None

    def slot(self, slot_id: str) -> SurfaceSlot | None:
        for candidate in self.slots:
            if candidate.slot_id == slot_id:
                return candidate
        return None

    @property
    def binding_slots(self) -> tuple[SurfaceSlot, ...]:
        return tuple(slot for slot in self.slots if slot.binds_a_field)


@dataclass(frozen=True, slots=True)
class SurfaceUniverse:
    """검증 기준 — 표면이 덮어야 할 op 전집합과 가시 occurrence 전집합."""

    operation_refs: frozenset[str]
    visible_occurrence_ids: frozenset[str]


@dataclass(frozen=True, slots=True)
class ExcludedBoard:
    """규칙을 어겨 제품 표면에서 빠진 보드 한 장과 그 사유."""

    board_id: str
    reasons: tuple[str, ...]


def _operation_occurrences(board: BoardTemplate, operation_ref: str) -> set[str]:
    """보드가 그 op로 그리는 occurrence 전부(대체 바인딩 포함)."""

    prefix = f"{operation_ref}|"
    return {
        occurrence_id
        for slot in board.slots
        for occurrence_id in slot.occurrence_ids
        if occurrence_id.startswith(prefix)
    }


@dataclass(frozen=True, slots=True)
class CardSurfaceRegistry:
    boards: Mapping[str, BoardTemplate]
    by_card: Mapping[str, tuple[str, ...]]
    by_operation: Mapping[str, tuple[str, ...]]
    state_links: Mapping[str, tuple[str, ...]]
    complete: bool
    expected: Mapping[str, int]
    root: Path = field(compare=False)
    # 격리 로드(:func:`load_registry` ``strict=False``)가 뺀 보드들. strict 로드는
    # 같은 사유로 예외를 던지므로 언제나 비어 있다.
    excluded_boards: tuple[ExcludedBoard, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.boards)

    def base_board_for(self, operation_ref: str) -> BoardTemplate | None:
        """op의 기본 보드 — default 보드가 있으면 그것, 없으면 tab, 그다음 사전순."""

        board_ids = self.by_operation.get(operation_ref)
        if not board_ids:
            return None
        ordered = sorted(
            board_ids,
            key=lambda board_id: (
                _STATE_RANK.get(self.boards[board_id].state.kind, len(_STATE_RANK)),
                board_id,
            ),
        )
        return self.boards[ordered[0]]

    def initial_state_board_for(self, operation_ref: str) -> BoardTemplate | None:
        """기본 보드를 세운 뒤 곧바로 갈아탈 탭 보드 — 없으면 ``None``.

        후보는 그 op의 값을 기본 보드에 **없는** 자리로 더 그리는 탭이다. 기본
        보드가 이미 그리는 값만 되풀이하는 탭으로는 옮길 이유가 없고, 후보가 둘
        이상이면 어디로도 가지 않는다 — 어느 탭인지 지어내지 않는다.

        기준 보드(:meth:`base_board_for`)는 그대로 두는 것이 요점이다: 형제 탭
        레일은 기본 보드에서 나오므로, 갈아타기는 사람이 탭을 누른 것과 같은
        경로여야 한다. 기본 보드로 되돌아가는 칩은 별개 문제다 — 부모 레일에 자기
        칩이 없는 보드가 있고, 그건 이 규칙이 메우지 않는다.
        """

        base = self.base_board_for(operation_ref)
        if base is None or base.state.kind != "default":
            return None
        shown = _operation_occurrences(base, operation_ref)
        candidates = [
            child
            for child in self.state_boards_for(base.board_id)
            if child.state.kind == "tab"
            and _operation_occurrences(child, operation_ref) - shown
        ]
        return candidates[0] if len(candidates) == 1 else None

    def state_boards_for(self, board_id: str) -> tuple[BoardTemplate, ...]:
        return tuple(self.boards[child] for child in self.state_links.get(board_id, ()))

    def validate(
        self, strict: bool, *, universe: SurfaceUniverse | None = None
    ) -> None:
        """fail-closed 검증. 위반은 예외 — 부분 통과라는 상태는 두지 않는다."""

        problems = self.validation_problems(strict, universe=universe)
        if problems:
            raise CardSurfaceTemplateError("; ".join(problems))

    def validation_warnings(
        self, *, universe: SurfaceUniverse | None = None
    ) -> list[str]:
        """실패시키지 않는 규칙 위반. 호출자가 로그·현황판으로 흘린다."""

        if not self.boards:
            return []
        scope = universe if universe is not None else default_universe()
        return self._density_warnings() + self._restatement_warnings(scope)

    def validation_problems(
        self, strict: bool, *, universe: SurfaceUniverse | None = None
    ) -> list[str]:
        problems: list[str] = []
        if strict or self.boards:
            scope = universe if universe is not None else default_universe()
            for board_id in sorted(self.boards):
                problems.extend(self._board_problems(self.boards[board_id], scope))
            if strict:
                problems.extend(self._coverage_problems(scope))
                problems.extend(self._operation_coverage_problems(scope))
                problems.extend(self._expectation_problems(scope))
        return problems

    def problems_by_board(
        self, *, universe: SurfaceUniverse | None = None
    ) -> dict[str, list[str]]:
        """board_id → 그 보드 혼자서 어긴 규칙들. 전역 규칙(커버리지)은 빠진다.

        격리 로드가 "어느 보드를 뺄 것인가"를 정하는 유일한 기준이다 — 문제 문자열을
        되파싱하지 않고 규칙을 보드 단위로 물어본다.
        """

        if not self.boards:
            return {}
        scope = universe if universe is not None else default_universe()
        found: dict[str, list[str]] = {}
        for board_id in sorted(self.boards):
            problems = self._board_problems(self.boards[board_id], scope)
            if problems:
                found[board_id] = problems
        return found

    def coverage(self, *, universe: SurfaceUniverse | None = None) -> dict[str, Any]:
        """저작 현황 — 가시 필드 중 몇 개가 어떤 보드에든 닿았는가.

        대체 바인딩(``alt_mappings``)이 닿는 필드도 "도달했다"로 센다. 격리 로드로
        보드가 빠지면 그만큼 ``uncovered_occurrences``가 늘어나므로, 이 수치는 언제나
        **지금 서 있는 레지스트리**의 커버리지지 저작물 전체의 커버리지가 아니다.
        """

        scope = universe if universe is not None else default_universe()
        covered = self._covered(scope)
        return {
            "visible_total": len(scope.visible_occurrence_ids),
            "covered": len(covered),
            "uncovered_occurrences": sorted(
                scope.visible_occurrence_ids - covered
            ),
            "operations_without_board": sorted(
                scope.operation_refs - set(self.by_operation)
            ),
        }

    # -- 개별 규칙 -------------------------------------------------------

    def _board_problems(
        self, board: BoardTemplate, universe: SurfaceUniverse
    ) -> list[str]:
        """보드 하나로 판정할 수 있는 규칙 전부(해시·밀도·상태·지시 열·바인딩)."""

        problems: list[str] = []
        problems.extend(self._html_hash_problems(board))
        problems.extend(self._density_problems(board))
        problems.extend(self._state_reference_problems(board))
        problems.extend(self._index_pattern_problems(board))
        problems.extend(self._duplicate_binding_problems(board, universe))
        return problems

    def _html_hash_problems(self, board: BoardTemplate) -> list[str]:
        actual = hashlib.sha256(board.html.encode("utf-8")).hexdigest()
        if actual != board.html_sha256:
            return [
                f"board {board.board_id!r} html_sha256 mismatch "
                f"(declared {board.html_sha256!r}, actual {actual!r})"
            ]
        return []

    def _density_problems(self, board: BoardTemplate) -> list[str]:
        problems = []
        for key, cap in DENSITY_BUDGET.items():
            value = board.density.get(key)
            if value is None:
                continue
            if value > cap:
                problems.append(
                    f"board {board.board_id!r} density {key}={value} exceeds budget {cap}"
                )
        height = board.height_px
        if isinstance(height, (int, float)) and not isinstance(height, bool):
            if height > HEIGHT_BUDGET_PX:
                problems.append(
                    f"board {board.board_id!r} height_px={height} exceeds "
                    f"budget {HEIGHT_BUDGET_PX}"
                )
        return problems

    def _density_warnings(self) -> list[str]:
        """소프트 예산 초과 — 로드는 통과하고 경고만 남는다."""

        warnings = []
        for board in self.boards.values():
            for key, cap in SOFT_DENSITY_BUDGET.items():
                value = board.density.get(key)
                if value is None:
                    continue
                if value > cap:
                    warnings.append(
                        f"board {board.board_id!r} density {key}={value} exceeds "
                        f"soft budget {cap}"
                    )
        return warnings

    def _restatement_warnings(self, universe: SurfaceUniverse) -> list[str]:
        """재표시만 있고 주값이 없는 무리 — 저작이 표시를 한 자리 덜 붙여야 한다.

        로드는 통과한다(:func:`_duplicate_is_declared`). 값은 어차피 슬롯마다 똑같이
        내려가므로 표면이 틀리지는 않고, 이 한 줄 때문에 보드를 지우면 나머지 자리가
        통째로 사라진다. 대신 어느 무리가 그 상태인지는 남겨 저작이 되찾게 한다.
        """

        warnings = []
        for board_id in sorted(self.boards):
            holders, _ = _board_holders(self.boards[board_id], universe)
            for occurrence_id, slots in sorted(holders.items()):
                if len(slots) < 2:
                    continue
                places = _collapse_column_rows(slots)
                if len(places) == 1:
                    continue
                slot_ids = {slot.slot_id for slot in slots}
                if not _restatement_primaries(places, slot_ids):
                    warnings.append(
                        f"board {board_id!r} restates occurrence {occurrence_id!r} in "
                        f"{len(places)} places with no primary slot"
                    )
        return warnings

    def _state_reference_problems(self, board: BoardTemplate) -> list[str]:
        problems = []
        state = board.state
        if state.kind == "default":
            if state.parent_board is not None:
                problems.append(
                    f"board {board.board_id!r} is default but declares parent_board"
                )
        else:
            if state.parent_board == board.board_id:
                problems.append(f"board {board.board_id!r} is its own parent_board")
            elif state.parent_board is None:
                # 레일 주인(rail_owner) — 탭 묶음의 첫 장은 되돌아갈 부모가 없다.
                # 형제 탭들이 이 장을 부모로 가리키고, 이 장 자신은 카드의 기본
                # 보드다(``_STATE_RANK``가 default 다음으로 tab을 고른다). 정렬·펼침은
                # 언제나 어떤 보드를 눌러 들어간 상태라 부모가 있어야 한다.
                if state.kind != "tab":
                    problems.append(
                        f"board {board.board_id!r} state {state.kind!r} has no parent_board"
                    )
            elif state.parent_board not in self.boards and self.complete:
                problems.append(
                    f"board {board.board_id!r} parent_board "
                    f"{state.parent_board!r} is not a known board"
                )
            if not state.control:
                problems.append(
                    f"board {board.board_id!r} state {state.kind!r} has no control"
                )
        for slot in board.slots:
            if slot.expanded_board is None:
                continue
            if slot.expanded_board not in self.boards and self.complete:
                problems.append(
                    f"board {board.board_id!r} slot {slot.slot_id!r} expanded_board "
                    f"{slot.expanded_board!r} is not a known board"
                )
        return problems

    def _index_pattern_problems(self, board: BoardTemplate) -> list[str]:
        """지시 열의 확장 `f`는 그 열의 `f_pattern`에서 나온 이름이어야 한다."""

        problems = []
        for slot in board.slots:
            pattern = slot.f_pattern
            if pattern is None:
                continue
            if slot.f is None:
                problems.append(
                    f"board {board.board_id!r} slot {slot.slot_id!r} declares "
                    f"f_pattern {pattern!r} without f"
                )
            elif not _expands_pattern(slot.f, pattern):
                problems.append(
                    f"board {board.board_id!r} slot {slot.slot_id!r} f {slot.f!r} is "
                    f"not an expansion of f_pattern {pattern!r}"
                )
        return problems

    def _duplicate_binding_problems(
        self, board: BoardTemplate, universe: SurfaceUniverse
    ) -> list[str]:
        """보드 안 "중복 금지" — 한 보드가 같은 값을 두 자리에 넣었는가.

        D2가 보드↔op를 N:M으로 못 박았고 탭·정렬·펼침 보드는 같은 카드의 다른 상태라,
        같은 필드가 형제 보드마다 다시 나오는 것은 정상이다(계좌 머리글이 탭마다 있다).
        어긋나면 안 되는 것은 한 보드 안의 중복이고, D4 병기(``paired_with``)·저작이
        명시한 재표시(``display_dup``)·되풀이 블록의 행 반복
        (:func:`_duplicate_is_declared`)은 예외다. 해석 못 한 바인딩과 비노출 필드
        바인딩도 여기서 걸린다.
        """

        holders, problems = _board_holders(board, universe)
        for occurrence_id, slots in sorted(holders.items()):
            if len(slots) > 1 and not _duplicate_is_declared(slots):
                problems.append(
                    f"board {board.board_id!r} binds occurrence {occurrence_id!r} in "
                    f"{len(slots)} slots that are not paired or display_dup "
                    f"({', '.join(slot.slot_id for slot in slots)})"
                )
        return problems

    def _covered(self, universe: SurfaceUniverse) -> set[str]:
        """어떤 보드에든 닿은 가시 occurrence 전부.

        대체 바인딩(``alt_mappings``)이 닿는 것도 센다 — 그 op가 답하면 그 잎이 그
        값을 그리기 때문이다.
        """

        covered: set[str] = set()
        for board in self.boards.values():
            for slot in board.binding_slots:
                covered.update(
                    occurrence_id
                    for occurrence_id in slot.occurrence_ids
                    if occurrence_id in universe.visible_occurrence_ids
                )
        return covered

    def _coverage_problems(self, universe: SurfaceUniverse) -> list[str]:
        """전역 규칙 — 가시 필드마다 어떤 보드에든 1회 이상 닿아야 한다."""

        missing = sorted(universe.visible_occurrence_ids - self._covered(universe))
        if missing:
            return [
                f"{len(missing)} visible occurrences reach no board "
                f"(first: {missing[0]!r})"
            ]
        return []

    def _expectation_problems(self, universe: SurfaceUniverse) -> list[str]:
        """정본은 원장 파생값(:func:`default_universe`)이고 index.json은 사본이다.

        기대치가 원장과 어긋나면 고칠 쪽은 언제나 index.json이다 — 이 검사는 사본이
        낡았다는 사실을 저작 완료(complete) 시점에 드러낸다.
        """

        actual = {
            "operation_count": len(universe.operation_refs),
            "visible_occurrence_count": len(universe.visible_occurrence_ids),
        }
        return [
            f"index.json expects {key}={value} but the ledger has {actual[key]}"
            for key, value in self.expected.items()
            if key in actual and value != actual[key]
        ]

    def _operation_coverage_problems(self, universe: SurfaceUniverse) -> list[str]:
        missing = sorted(universe.operation_refs - self.by_operation.keys())
        if missing:
            return [
                f"{len(missing)} operations have no board (first: {missing[0]!r})"
            ]
        return []


def _board_holders(
    board: BoardTemplate, universe: SurfaceUniverse
) -> tuple[dict[str, list[SurfaceSlot]], list[str]]:
    """occurrence_id → 그것을 **주 바인딩으로** 그리는 슬롯들. 문제는 함께 돌려준다.

    중복 금지는 "저작이 같은 값을 두 자리에 넣었는가"를 묻는 규칙이고, 저작이 그렇게
    넣은 자리는 슬롯 자신의 (``mapping_id``, ``f``)뿐이다. 대체 바인딩
    (``alt_mappings``)은 **다른 op가 답했을 때만** 쓰는 조각길이라, 여러 잎이 같은
    대체를 공유하는 것은 설계된 중복이 아니다 — 한 셀에 이름·코드·일련번호를 쌓아
    그린 자리가 같은 폴백 하나를 나눠 갖는 것이 실측(2SKU-1·2U5L-1·30TY-0)이고, 그
    잎들의 값은 계약 파생이 잎마다 따로 고른다
    (:func:`card_surface_contract._resolve_slot`).

    해석 못 했거나 비노출인 바인딩은 주·대체를 가리지 않고 문제로 돌려준다 — 그것은
    조건부 폴백이라도 저작 오류다. 커버리지는 대체가 닿는 것까지 세므로
    :meth:`CardSurfaceRegistry._covered`가 따로 본다.
    """

    holders: dict[str, list[SurfaceSlot]] = {}
    problems: list[str] = []
    for slot in board.binding_slots:
        for binding in slot.bindings:
            occurrence_id = binding.occurrence_id
            if occurrence_id is None:
                problems.append(
                    f"board {board.board_id!r} slot {slot.slot_id!r} does not "
                    f"resolve to one occurrence of "
                    f"{binding.mapping_id!r}/{binding.f!r}"
                )
            elif occurrence_id not in universe.visible_occurrence_ids:
                problems.append(
                    f"board {board.board_id!r} slot {slot.slot_id!r} binds "
                    f"non-visible occurrence {occurrence_id!r}"
                )
        primary = slot.occurrence_id
        if primary is not None and primary in universe.visible_occurrence_ids:
            holders.setdefault(primary, []).append(slot)
    return holders, problems


def _duplicate_is_declared(slots: list[SurfaceSlot]) -> bool:
    """보드 안 중복 바인딩이 저작된 세 형태 중 하나인지 본다.

    (1) 행 반복 — 한 표 한 열, 또는 표가 아닌 되풀이 블록의 같은 자리. 추출기는
        셀마다 슬롯을 하나씩 적고 열 바인딩이 그 열 전부에 같은 (mapping_id, f)를
        퍼뜨린다. 8행이면 같은 occurrence를 가진 슬롯이 8개 나오는데 그것은 중복이
        아니라 한 열이다. 되풀이가 한 자리로 접히면 표시(2)(3)도 필요 없다.
    (2) D4 병기 — 병기 슬롯은 주값과 같은 값을 같은 프레임에서 갱신한다.
    (3) 재표시(``display_dup``) — 같은 값을 KPI·레일에 한 번 더 보여주는 슬롯.
        머리글 KPI가 표의 열을 다시 적는 자리라 병기가 아니고, Paper 보드가 실제로
        그렇게 그려져 있어서(디자인 완전 동일) 없앨 수 없다.

    남는 자리가 여럿이면 표시되지 않은 주값(primary)은 **하나 이하**여야 한다 —
    둘이면 저작이 선언하지 않은 중복이다. "하나 이하"는 저작 검사기
    (``scripts/validate_board_slots.py``)가 요구하는 "n개 중 n-1개 이상 표시"와 같은
    선이다. 두 검사기가 다른 선을 그으면 저작을 통과한 보드가 로더에서 막힌다.
    표시만 있고 주값이 없는 무리는 경고로 남긴다(:meth:`validation_warnings`).
    """

    places = _collapse_column_rows(slots)
    if len(places) == 1:
        return True
    slot_ids = {slot.slot_id for slot in slots}
    return len(_restatement_primaries(places, slot_ids)) <= 1


def _restatement_primaries(
    places: list[SurfaceSlot], slot_ids: set[str]
) -> list[SurfaceSlot]:
    return [slot for slot in places if not _is_restatement(slot, slot_ids)]


def _is_restatement(slot: SurfaceSlot, slot_ids: set[str]) -> bool:
    """이 슬롯이 **같은 값을 다시 적는 자리**인가(그래서 주값이 아닌가).

    D6에서 ``병기``는 "2줄 셀의 둘째 줄"이라는 DOM 판정이지 "주값의 사본"이 아니다.
    둘째 줄이 제 필드를 갖고 그 짝(``paired_with``)이 다른 값을 들고 있으면 그 줄이
    자기 필드의 주값이다 — 짝이 이 무리 안에 있을 때만 사본이다.
    """

    if slot.display_dup:
        return True
    if slot.paired_with is not None:
        return slot.paired_with in slot_ids
    return slot.layer == "병기"


def _collapse_column_rows(slots: list[SurfaceSlot]) -> list[SurfaceSlot]:
    """되풀이의 서로 다른 행을 한 자리로 접는다(같은 행의 반복은 남긴다).

    행 좌표는 두 갈래다 — 표 셀은 ``table``(같은 ``table_id``·``col``의 다른 ``row``),
    표가 아닌 되풀이 블록은 ``row_index``(같은 ``region``의 다른 행 번호)다. 뒤엣것은
    보드가 ``<table>``이 아니라 카드 줄을 되풀이해 그린 자리로, 계약 파생이
    ``value[row_index]``로 서로 다른 원소를 꺼내므로 같은 값의 중복이 아니다.
    """

    kept: list[SurfaceSlot] = []
    rows_seen: dict[tuple[str, str | None, int | None], set[str | int]] = {}
    for slot in slots:
        cell = slot.table
        if cell is not None:
            key: tuple[str, str | None, int | None] = ("table", cell.table_id, cell.col)
            row: str | int = cell.row
        elif slot.row_index is not None:
            key = ("region", slot.region, None)
            row = slot.row_index
        else:
            kept.append(slot)
            continue
        rows = rows_seen.setdefault(key, set())
        if not rows or row in rows:
            kept.append(slot)
        rows.add(row)
    return kept


def _expands_pattern(alias: str, pattern: str) -> bool:
    parts = _INDEX_PLACEHOLDER.split(pattern)
    if len(parts) == 1:
        return alias == pattern
    return re.fullmatch(r"\d+".join(re.escape(part) for part in parts), alias) is not None


# default가 있으면 그것이 기본 보드, 없으면 tab — 계획 §3.
_STATE_RANK = {"default": 0, "tab": 1, "sort": 2, "expand": 3}


def _require_mapping(value: Any, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CardSurfaceTemplateError(f"{what} must be a JSON object")
    return value


def _read_json(path: Path, what: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CardSurfaceTemplateError(f"{what} ({path}) is not readable JSON: {exc}") from exc
    return _require_mapping(payload, what)


def _parse_slot(
    raw: Any,
    board_id: str,
    index_patterns: Mapping[str, tuple[str, str | None]] | None = None,
) -> SurfaceSlot:
    slot = _require_mapping(raw, f"board {board_id!r} slot")
    slot_id = slot.get("slot_id")
    if not isinstance(slot_id, str) or not slot_id:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot is missing required string 'slot_id'"
        )
    mapping_id = slot.get("mapping_id") or None
    alias = slot.get("f") or None
    # ``f``만 있는 상태는 정상이다 — 추출기가 Paper 노드 이름 앵커에서 필드명을 먼저
    # 적고, 어느 op의 것인지(``mapping_id``)는 저작 단계가 채운다. 반대 방향은 아니다.
    if mapping_id is not None and alias is None:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} declares mapping_id without f"
        )
    layer = slot.get("layer")
    layer = _LAYER_ALIASES.get(layer, layer)
    if layer is not None and layer not in SLOT_LAYERS:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} has unknown layer {layer!r}"
        )
    kind = slot.get("kind")
    if kind is not None and kind not in SLOT_KINDS:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} has unknown kind {kind!r}"
        )
    row_index = slot.get("row_index")
    if row_index is not None and (not isinstance(row_index, int) or row_index < 0):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} has invalid row_index"
        )
    slot_format = slot.get("format")
    if slot_format is not None and not isinstance(slot_format, dict):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} format must be an object"
        )
    declared_occurrence_id = slot.get("occurrence_id")
    json_path = slot.get("json_path")
    display_dup = slot.get("display_dup", False)
    if not isinstance(display_dup, bool):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} display_dup must be a boolean"
        )
    raw_alts = slot.get("alt_mappings") or []
    if not isinstance(raw_alts, list):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} alt_mappings must be a list"
        )
    alt_mappings = tuple(
        _parse_binding(entry, board_id, slot_id) for entry in raw_alts
    )
    composite = _parse_composite(slot.get("composite"), board_id, slot_id)
    if composite is not None and (mapping_id or alias or alt_mappings):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} composite cannot be combined with "
            f"mapping_id/f or alt_mappings"
        )
    if alt_mappings and not (mapping_id and alias):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} declares alt_mappings without a "
            f"primary mapping_id/f"
        )
    pairs = [(mapping_id, alias)] + [(alt.mapping_id, alt.f) for alt in alt_mappings]
    if len(set(pairs)) != len(pairs):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} repeats one mapping_id/f in "
            f"alt_mappings"
        )
    f_pattern = slot.get("f_pattern") or None
    if f_pattern is not None and not isinstance(f_pattern, str):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} f_pattern must be a string"
        )
    if f_pattern is None and alias and index_patterns:
        # 지시 열은 패턴을 열에 적고 셀에는 편 이름만 남긴다 — 여기서 다시 잇는다.
        # 열의 mapping과 다른 op를 무는 셀(한 열에 이름·코드를 같이 그린 자리)은
        # 그 열의 자리표가 아니다 — 패턴을 잇지 않는다.
        entry = index_patterns.get(slot_id)
        if entry is not None:
            pattern, column_mapping_id = entry
            if column_mapping_id is None or column_mapping_id == mapping_id:
                f_pattern = pattern
    return SurfaceSlot(
        slot_id=slot_id,
        mapping_id=mapping_id,
        f=alias,
        occurrence_id=(
            resolve_occurrence_id(
                mapping_id,
                alias,
                declared_occurrence_id=declared_occurrence_id,
                json_path=json_path,
            )
            if mapping_id and alias
            else None
        ),
        declared_occurrence_id=declared_occurrence_id,
        json_path=json_path,
        row_index=row_index,
        node_id=slot.get("node_id"),
        node_path=slot.get("node_path"),
        kind=kind,
        anchor=(
            MappingProxyType(dict(slot["anchor"]))
            if isinstance(slot.get("anchor"), dict)
            else None
        ),
        kor=slot.get("kor"),
        layer=layer,
        region=slot.get("region"),
        format=MappingProxyType(dict(slot_format or {})),
        paired_with=slot.get("paired_with"),
        display_dup=display_dup,
        collapse_group=(
            MappingProxyType(dict(slot["collapse_group"]))
            if isinstance(slot.get("collapse_group"), dict)
            else None
        ),
        expanded_board=slot.get("expanded_board"),
        paper_text=slot.get("paper_text"),
        alt_mappings=alt_mappings,
        composite=composite,
        f_pattern=f_pattern,
        table=_parse_table_cell(slot.get("table"), board_id, slot_id),
    )


def _parse_binding(raw: Any, board_id: str, slot_id: str) -> SlotBinding:
    entry = _require_mapping(raw, f"board {board_id!r} slot {slot_id!r} alt_mappings entry")
    mapping_id = entry.get("mapping_id") or None
    alias = entry.get("f") or None
    if not mapping_id or not alias:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} alt_mappings entry needs both "
            f"mapping_id and f"
        )
    declared_occurrence_id = entry.get("occurrence_id")
    json_path = entry.get("json_path")
    return SlotBinding(
        mapping_id=mapping_id,
        f=alias,
        occurrence_id=resolve_occurrence_id(
            mapping_id,
            alias,
            declared_occurrence_id=declared_occurrence_id,
            json_path=json_path,
        ),
        declared_occurrence_id=declared_occurrence_id,
        json_path=json_path,
    )


def _parse_composite(
    raw: Any, board_id: str, slot_id: str
) -> SlotComposite | None:
    if raw is None:
        return None
    entry = _require_mapping(raw, f"board {board_id!r} slot {slot_id!r} composite")
    separator = entry.get("separator")
    if not isinstance(separator, str):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} composite separator must be a string"
        )
    raw_parts = entry.get("parts")
    if not isinstance(raw_parts, list) or len(raw_parts) < 2:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} composite parts must contain at "
            f"least two entries"
        )
    parts = tuple(
        _parse_composite_part(part, board_id, slot_id) for part in raw_parts
    )
    occurrences = [part.occurrence_id for part in parts]
    if None not in occurrences and len(set(occurrences)) != len(occurrences):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} composite repeats one occurrence"
        )
    return SlotComposite(separator=separator, parts=parts)


def _parse_composite_part(raw: Any, board_id: str, slot_id: str) -> CompositePart:
    entry = _require_mapping(
        raw, f"board {board_id!r} slot {slot_id!r} composite part"
    )
    mapping_id = entry.get("mapping_id") or None
    alias = entry.get("f") or None
    if not mapping_id or not alias:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} composite part needs both "
            f"mapping_id and f"
        )
    part_format = entry.get("format")
    if part_format is not None and not isinstance(part_format, dict):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} composite part format must be an object"
        )
    for affix in ("prefix", "suffix"):
        if affix in (part_format or {}) and not isinstance(part_format[affix], str):
            raise CardSurfaceTemplateError(
                f"board {board_id!r} slot {slot_id!r} composite part format "
                f"{affix} must be a string"
            )
    declared_occurrence_id = entry.get("occurrence_id")
    json_path = entry.get("json_path")
    return CompositePart(
        mapping_id=mapping_id,
        f=alias,
        occurrence_id=resolve_occurrence_id(
            mapping_id,
            alias,
            declared_occurrence_id=declared_occurrence_id,
            json_path=json_path,
        ),
        declared_occurrence_id=declared_occurrence_id,
        json_path=json_path,
        format=MappingProxyType(dict(part_format or {})),
    )


def _parse_table_cell(raw: Any, board_id: str, slot_id: str) -> TableCell | None:
    """추출기가 셀에 남긴 좌표. `table`은 표 노드 id, `col`은 0부터의 열 번호다."""

    if raw is None:
        return None
    cell = _require_mapping(raw, f"board {board_id!r} slot {slot_id!r} table")
    table_id = cell.get("table_id") or cell.get("table")
    col = cell.get("col")
    if not isinstance(table_id, str) or not table_id:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} table needs a table id"
        )
    if not isinstance(col, int) or isinstance(col, bool) or col < 0:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} slot {slot_id!r} table col must be a "
            f"non-negative integer"
        )
    row = cell.get("row")
    return TableCell(table_id=table_id, row="" if row is None else str(row), col=col)


def _index_patterns(raw: Any, board_id: str) -> dict[str, tuple[str, str | None]]:
    """지시 열이 선언한 ``indexed.f_pattern``을 그 열의 셀 슬롯 id에 되돌려 붙인다.

    추출기는 셀에 편 이름(``f``)만 남기고 패턴은 열에 둔다(`indexed_field`). 로더가
    둘을 다시 이어야 "이 이름이 어느 열의 몇 번째인가"를 잃지 않는다.
    """

    if raw is None:
        return {}
    if not isinstance(raw, list):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} column_bindings must be a list"
        )
    patterns: dict[str, tuple[str, str | None]] = {}
    for table in raw:
        table_map = _require_mapping(table, f"board {board_id!r} column_bindings entry")
        for column in table_map.get("columns") or []:
            column_map = _require_mapping(
                column, f"board {board_id!r} column_bindings column"
            )
            indexed = column_map.get("indexed")
            if not indexed:
                continue
            indexed_map = _require_mapping(
                indexed, f"board {board_id!r} column_bindings indexed"
            )
            pattern = indexed_map.get("f_pattern")
            if not isinstance(pattern, str) or not pattern:
                raise CardSurfaceTemplateError(
                    f"board {board_id!r} indexed column {column_map.get('col')!r} "
                    f"has no f_pattern"
                )
            column_mapping_id = column_map.get("mapping_id")
            if not isinstance(column_mapping_id, str) or not column_mapping_id:
                column_mapping_id = None
            for slot_id in column_map.get("slot_ids") or []:
                if isinstance(slot_id, str):
                    patterns[slot_id] = (pattern, column_mapping_id)
    return patterns


def _parse_board(board_dir: Path, declared_board_id: str) -> BoardTemplate:
    slots_path = board_dir / "slots.json"
    payload = _read_json(slots_path, f"board {declared_board_id!r} slots.json")
    for key in _REQUIRED_BOARD_KEYS:
        if key not in payload:
            raise CardSurfaceTemplateError(
                f"board {declared_board_id!r} slots.json is missing {key!r}"
            )
    board_id = payload["board_id"]
    if board_id != declared_board_id:
        raise CardSurfaceTemplateError(
            f"board directory {declared_board_id!r} declares board_id {board_id!r}"
        )
    html_path = board_dir / "board.html"
    if not html_path.is_file():
        # slots.json만 있고 추출물이 없는 상태는 부분 로드가 아니라 저작 오류다.
        raise CardSurfaceTemplateError(
            f"board {board_id!r} has slots.json but no board.html"
        )
    for key in ("card_id", "html_sha256"):
        if not isinstance(payload[key], str) or not payload[key]:
            raise CardSurfaceTemplateError(
                f"board {board_id!r} {key} must be a non-empty string"
            )
    if not isinstance(payload["slots"], list):
        raise CardSurfaceTemplateError(f"board {board_id!r} slots must be a list")
    operation_refs = payload["operation_refs"]
    if not isinstance(operation_refs, list) or any(
        not isinstance(item, str) or not item for item in operation_refs
    ):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} operation_refs must be non-empty strings"
        )
    raw_state = payload.get("state") or {"kind": "default"}
    state_map = _require_mapping(raw_state, f"board {board_id!r} state")
    kind = state_map.get("kind", "default")
    if kind not in STATE_KINDS:
        raise CardSurfaceTemplateError(f"board {board_id!r} has unknown state kind {kind!r}")
    control_text = state_map.get("control_text")
    if control_text is not None and not isinstance(control_text, str):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} state control_text must be a string"
        )
    density_raw = _require_mapping(
        payload.get("density") or {}, f"board {board_id!r} density"
    )
    density: dict[str, int] = {}
    for key, value in density_raw.items():
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise CardSurfaceTemplateError(
                f"board {board_id!r} density {key!r} must be a non-negative integer"
            )
        density[key] = value
    index_patterns = _index_patterns(payload.get("column_bindings"), board_id)
    slots = tuple(_parse_slot(raw, board_id, index_patterns) for raw in payload["slots"])
    slot_ids = [slot.slot_id for slot in slots]
    if len(set(slot_ids)) != len(slot_ids):
        raise CardSurfaceTemplateError(f"board {board_id!r} has duplicate slot_id")
    section_titles = _require_mapping(
        payload.get("section_titles_ko") or {}, f"board {board_id!r} section_titles_ko"
    )
    for section_id, title in section_titles.items():
        if not isinstance(title, str) or not title:
            raise CardSurfaceTemplateError(
                f"board {board_id!r} section title for {section_id!r} must be a string"
            )
    column_priority = payload.get("column_priority") or []
    if not isinstance(column_priority, list) or any(
        not isinstance(item, str) for item in column_priority
    ):
        raise CardSurfaceTemplateError(f"board {board_id!r} column_priority must be strings")
    kiumi = _parse_kiumi(payload.get("kiumi"), board_id, set(slot_ids))
    return BoardTemplate(
        board_id=board_id,
        card_id=payload["card_id"],
        html=html_path.read_text(encoding="utf-8"),
        html_sha256=payload["html_sha256"],
        width_px=payload.get("width_px"),
        height_px=payload.get("height_px"),
        operation_refs=tuple(operation_refs),
        state=BoardState(
            kind=kind,
            parent_board=state_map.get("parent_board"),
            control=state_map.get("control"),
            control_text=_control_text(state_map.get("control"), control_text),
        ),
        density=MappingProxyType(density),
        slots=slots,
        primary=(
            MappingProxyType(dict(payload["primary"]))
            if isinstance(payload.get("primary"), dict)
            else None
        ),
        column_priority=tuple(column_priority),
        section_titles_ko=MappingProxyType(dict(section_titles)),
        paper_source=MappingProxyType(dict(payload.get("paper_source") or {})),
        kiumi=MappingProxyType(kiumi) if kiumi is not None else None,
    )


def _parse_kiumi(
    raw: Any, board_id: str, slot_ids: set[str]
) -> dict[str, Any] | None:
    """승인된 카드미니 정의를 fail-closed로 읽는다.

    기존 축약 픽스처는 이 필드가 없어도 로드한다. 제품 트리 96장이 모두 필드를
    갖는지는 전수 계약 테스트가 별도로 고정한다.
    """

    if raw is None:
        return None
    spec = _require_mapping(raw, f"board {board_id!r} kiumi")
    if spec.get("version") != 1:
        raise CardSurfaceTemplateError(f"board {board_id!r} kiumi version must be 1")
    if spec.get("width_px") != 360 or spec.get("height_px") != 420:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi size must be exactly 360x420"
        )
    grammar = spec.get("grammar")
    grammars = {
        "table",
        "chart",
        "facts",
        "compound",
        "order_ticket",
        "order_confirm",
        "event",
        "auth",
        "reader",
        "stream",
    }
    if grammar not in grammars:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi has unknown grammar {grammar!r}"
        )
    if spec.get("fixed") is not True:
        raise CardSurfaceTemplateError(f"board {board_id!r} kiumi must be fixed")
    if not isinstance(spec.get("title"), str) or not spec["title"].strip():
        raise CardSurfaceTemplateError(f"board {board_id!r} kiumi title must be a string")
    if not isinstance(spec.get("reviewed_by"), str) or not spec["reviewed_by"].strip():
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi reviewed_by must be a string"
        )
    elements = spec.get("elements")
    if not isinstance(elements, list) or not elements:
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi elements must be a non-empty list"
        )
    selected: list[str] = []
    for index, raw_element in enumerate(elements):
        element = _require_mapping(
            raw_element, f"board {board_id!r} kiumi element {index}"
        )
        source_slot_id = element.get("source_slot_id")
        if not isinstance(source_slot_id, str) or source_slot_id not in slot_ids:
            raise CardSurfaceTemplateError(
                f"board {board_id!r} kiumi element {index} references unknown slot "
                f"{source_slot_id!r}"
            )
        if not isinstance(element.get("label"), str) or not element["label"].strip():
            raise CardSurfaceTemplateError(
                f"board {board_id!r} kiumi element {index} needs a label"
            )
        if not isinstance(element.get("format"), dict):
            raise CardSurfaceTemplateError(
                f"board {board_id!r} kiumi element {index} format must be an object"
            )
        selected.append(source_slot_id)
    if len(selected) != len(set(selected)):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi repeats a source_slot_id"
        )
    fold_note = spec.get("fold_note")
    if fold_note is not None and not isinstance(fold_note, str):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi fold_note must be a string or null"
        )
    structure_missing = spec.get("structure_missing", False)
    if not isinstance(structure_missing, bool):
        raise CardSurfaceTemplateError(
            f"board {board_id!r} kiumi structure_missing must be a boolean"
        )
    return dict(spec)


def _control_text(control: Any, declared: str | None) -> str | None:
    """저작이 적은 문구가 있으면 그것, 없으면 ``kind|문구``의 뒷조각.

    조작 잎을 찾는 쪽(canvas.js ``findStateControl``)은 화면에 있는 글자로만 찾을 수
    있다. 기계 접두는 계약이 떼어 주고, 없는 문구를 지어내지는 않는다.
    """

    if declared is not None:
        return declared.strip() or None
    if not isinstance(control, str):
        return None
    return control.rsplit("|", 1)[-1].strip() or None


def _index_board_ids(index: Mapping[str, Any], root: Path) -> list[str]:
    boards = index.get("boards")
    if boards is None:
        return sorted(
            child.name for child in root.iterdir() if (child / "slots.json").is_file()
        )
    if not isinstance(boards, list):
        raise CardSurfaceTemplateError("index.json boards must be a list")
    board_ids: list[str] = []
    for entry in boards:
        if isinstance(entry, str):
            board_ids.append(entry)
        elif isinstance(entry, dict) and isinstance(entry.get("board_id"), str):
            board_ids.append(entry["board_id"])
        else:
            raise CardSurfaceTemplateError(
                "index.json boards entries must be board ids or objects with board_id"
            )
    if len(set(board_ids)) != len(board_ids):
        raise CardSurfaceTemplateError("index.json lists a board twice")
    return board_ids


def _assemble(
    boards: Mapping[str, BoardTemplate],
    index: Mapping[str, Any],
    root: Path,
    excluded: tuple[ExcludedBoard, ...],
) -> CardSurfaceRegistry:
    by_card: dict[str, list[str]] = {}
    by_operation: dict[str, list[str]] = {}
    state_links: dict[str, list[str]] = {}
    for board_id in sorted(boards):
        board = boards[board_id]
        by_card.setdefault(board.card_id, []).append(board_id)
        for operation_ref in board.operation_refs:
            by_operation.setdefault(operation_ref, []).append(board_id)
        parent = board.state.parent_board
        if parent:
            state_links.setdefault(parent, []).append(board_id)

    return CardSurfaceRegistry(
        boards=MappingProxyType(dict(boards)),
        by_card=MappingProxyType(
            {card_id: tuple(ids) for card_id, ids in by_card.items()}
        ),
        by_operation=MappingProxyType(
            {operation_ref: tuple(ids) for operation_ref, ids in by_operation.items()}
        ),
        state_links=MappingProxyType(
            {parent: tuple(ids) for parent, ids in state_links.items()}
        ),
        complete=index.get("complete") is True,
        expected=MappingProxyType(
            {
                key: value
                for key, value in (index.get("expected") or {}).items()
                if isinstance(value, int) and not isinstance(value, bool)
            }
        ),
        root=root,
        excluded_boards=excluded,
    )


def _isolate_invalid_boards(
    registry: CardSurfaceRegistry,
    index: Mapping[str, Any],
    universe: SurfaceUniverse | None,
) -> CardSurfaceRegistry:
    """규칙을 어긴 보드만 빼고 다시 세운다 — 한 장 때문에 표면이 통째로 사라지지 않게.

    한 장을 빼면 남은 보드의 판정이 달라질 수 있어(부모가 사라진 상태 보드) 더 뺄
    보드가 없을 때까지 되돌린다. 매 바퀴 최소 한 장이 빠지므로 반드시 멈춘다.
    """

    excluded = list(registry.excluded_boards)
    while True:
        problems = registry.problems_by_board(universe=universe)
        if not problems:
            break
        excluded.extend(
            ExcludedBoard(board_id, tuple(reasons))
            for board_id, reasons in sorted(problems.items())
        )
        kept = {
            board_id: board
            for board_id, board in registry.boards.items()
            if board_id not in problems
        }
        registry = _assemble(kept, index, registry.root, tuple(excluded))
    for board in registry.excluded_boards:
        logger.warning(
            "card surface board %s is excluded from the product surface: %s",
            board.board_id,
            "; ".join(board.reasons),
        )
    return registry


def load_registry(
    root: Path | str = TEMPLATE_ROOT,
    *,
    universe: SurfaceUniverse | None = None,
    strict: bool = True,
) -> CardSurfaceRegistry:
    """Read one template tree.

    ``strict``(기본)은 CI·테스트가 쓰는 fail-closed 로드다 — 규칙을 어긴 트리는
    예외로 막히고 부분 통과라는 상태는 없다. ``strict=False``는 런타임 로드로, 어긴
    보드만 빼고(``excluded_boards``에 보드·사유) 나머지를 세운다. 어느 쪽이든 규칙은
    같은 것을 쓴다 — 다른 것은 어겼을 때 트리 전체가 죽느냐 그 보드만 빠지느냐다.
    """

    root = Path(root)
    index_path = root / "index.json"
    if not index_path.is_file():
        # 아직 추출물이 없다 — 빈 레지스트리는 정상이고, 표면 계약은 None이 된다.
        return _assemble({}, {}, root, ())
    index = _read_json(index_path, "index.json")
    version = index.get("version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise CardSurfaceTemplateError(
            f"index.json version {version!r} is not {SCHEMA_VERSION!r}"
        )
    boards: dict[str, BoardTemplate] = {}
    unreadable: list[ExcludedBoard] = []
    for board_id in _index_board_ids(index, root):
        board_dir = root / board_id
        if not (board_dir / "slots.json").is_file():
            # 부분 로드 — 아직 저작되지 않은 보드는 건너뛴다.
            continue
        try:
            boards[board_id] = _parse_board(board_dir, board_id)
        except CardSurfaceTemplateError as exc:
            if strict:
                raise
            # 슬롯 표 자체를 읽지 못한 보드도 격리 대상이다 — 나머지는 선다.
            unreadable.append(ExcludedBoard(board_id, (str(exc),)))

    registry = _assemble(boards, index, root, tuple(unreadable))
    if strict:
        registry.validate(registry.complete, universe=universe)
    else:
        registry = _isolate_invalid_boards(registry, index, universe)
    for warning in registry.validation_warnings(universe=universe):
        logger.warning("card surface soft budget: %s", warning)
    return registry


@cache
def visible_contracts(operation_ref: str) -> tuple[Any, ...]:
    """제품 표면에 도달할 수 있는 semantic contract만. 미지 op는 빈 튜플."""

    from athena_api.semantic_presentation_registry import (
        get_semantic_presentation_registry,
    )

    try:
        contracts = get_semantic_presentation_registry().for_operation(operation_ref)
    except (KeyError, ValueError):
        return ()
    return tuple(
        contract
        for contract in contracts
        if contract.field_class in {"semantic", "unresolved", "derived"}
    )


def resolve_occurrence_id(
    mapping_id: str,
    alias: str,
    *,
    declared_occurrence_id: str | None = None,
    json_path: str | None = None,
) -> str | None:
    """슬롯의 ``mapping_id``/``f``를 canonical wire occurrence로 되돌린다.

    한 op 안에서 별칭이 두 경로에 걸리는 경우(실측 2건)에는 슬롯이
    ``occurrence_id`` 또는 ``json_path``로 스스로를 못 박아야 한다 — 아니면 None.
    """

    candidates = [
        contract
        for contract in visible_contracts(mapping_id)
        if contract.alias == alias
    ]
    if declared_occurrence_id is not None:
        candidates = [
            contract
            for contract in candidates
            if contract.wire_occurrence_id == declared_occurrence_id
        ]
    if json_path is not None:
        candidates = [
            contract for contract in candidates if contract.json_path == json_path
        ]
    if len(candidates) != 1:
        return None
    return candidates[0].wire_occurrence_id


_CARD_SURFACE_NON_VISIBLE_RESERVE_OCCURRENCES = frozenset(
    {
        "base:04|$.data[].924|1",
        "base:04|$.data[].951|1",
    }
)


@lru_cache(maxsize=1)
def default_universe() -> SurfaceUniverse:
    """제품 표면이 덮어야 할 전집합 — 원장이 아니라 canonical 레지스트리에서 온다."""

    from athena_api.semantic_presentation_registry import (
        get_semantic_presentation_registry,
    )

    contracts = get_semantic_presentation_registry().contracts
    visible = frozenset(
        contract.wire_occurrence_id
        for contract in contracts
        if contract.field_class in {"semantic", "unresolved", "derived"}
        and contract.wire_occurrence_id
        not in _CARD_SURFACE_NON_VISIBLE_RESERVE_OCCURRENCES
    )
    return SurfaceUniverse(
        operation_refs=frozenset(contract.mapping_id for contract in contracts),
        visible_occurrence_ids=visible,
    )


@lru_cache(maxsize=1)
def get_registry() -> CardSurfaceRegistry:
    """프로덕션 접근점. 규칙을 어긴 **보드만** 빼고 나머지를 준다.

    로더 자체는 fail-closed로 예외를 던지지만(``strict=True``: 테스트·CI가 그걸로
    나쁜 트리를 막는다), 런타임에서 그 예외를 그대로 올리면 보드 한 장 때문에 나머지
    95장의 표면이 통째로 사라진다. 표면에 대한 fail-closed의 올바른 형태는 "잘못된
    보드를 그리지 않는 것"이지 "아무 보드도 그리지 않는 것"이 아니다 — 어긴 보드는
    ``excluded_boards``에 사유와 함께 남고, 그 op만 `surface_contract: None`이 된다.

    트리 자체를 읽지 못하는 오류(index.json 스키마)는 보드 단위로 격리할 수 없으므로
    그때만 빈 레지스트리로 내려앉는다.
    """

    try:
        return load_registry(TEMPLATE_ROOT, strict=False)
    except CardSurfaceTemplateError:
        logger.exception(
            "card surface template tree is unreadable — 보드 표면 없이 진행한다 "
            "(surface_contract=None). 트리: %s",
            TEMPLATE_ROOT,
        )
        return load_registry(TEMPLATE_ROOT / "__none__", strict=False)


def visible_occurrence_ids(operation_refs: Iterable[str] | None = None) -> frozenset[str]:
    universe = default_universe()
    if operation_refs is None:
        return universe.visible_occurrence_ids
    scope = set(operation_refs)
    return frozenset(
        occurrence_id
        for occurrence_id in universe.visible_occurrence_ids
        if occurrence_id.split("|", 1)[0] in scope
    )
