"""화면에 남은 결측어를 사유별로 묶는다 — UI 전수 리포트 + 템플릿 + 진단을 잇는다.

입력: app/captures/card-api-sweep/CARD-API-SWEEP.json (UI 전수 검사 결과)
      app/captures/card-api-sweep/SLOT-DIAGNOSIS-2.json (선택 — 슬롯별 API 사유)

각 결측 노드를 슬롯으로 되찾아, 왜 값이 없는지를 한 줄로 분류한다. 남은 일감을
크기 순으로 세우는 것이 목적이다.
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import athena_api.card_surface_templates as templates  # noqa: E402
from athena_api.generated.registry import TR_REGISTRY  # noqa: E402

REPORT = ROOT / "app" / "captures" / "card-api-sweep" / "CARD-API-SWEEP.json"
DIAGNOSIS = ROOT / "app" / "captures" / "card-api-sweep" / "SLOT-DIAGNOSIS-2.json"


def op_kind(mapping_id: str) -> str:
    parts = mapping_id.split(":")
    spec = TR_REGISTRY.get(parts[1] if len(parts) >= 2 else mapping_id)
    return spec.kind if spec is not None else "unknown"


def classify(slot, board, solo: set[str], api_reason: dict[str, str]) -> str:
    if not slot.binds_a_field:
        return "binding_none"  # 응답이 채우는 자리가 아니다(저작 미표시)
    kinds = {op_kind(binding.mapping_id) for binding in slot.bindings}
    if kinds == {"websocket"}:
        return "realtime_only"
    reasons = {
        api_reason.get(binding.mapping_id)
        for binding in slot.bindings
        if api_reason.get(binding.mapping_id)
    }
    if reasons:
        return sorted(reasons)[0]
    for binding in slot.bindings:
        occurrence_id = binding.occurrence_id or ""
        parts = occurrence_id.split("|")
        if len(parts) >= 2 and "[]" in parts[1] and slot.row_index is None:
            return "array_column_no_row" if occurrence_id not in solo else "array_solo"
    if slot.row_index is not None:
        return "row_beyond_response"
    return "field_absent_in_response"


def main() -> int:
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    diagnosis = (
        json.loads(DIAGNOSIS.read_text(encoding="utf-8"))
        if DIAGNOSIS.exists()
        else {"boards": []}
    )
    api_reasons = {
        board["board_id"]: board.get("op_reasons", {}) for board in diagnosis["boards"]
    }
    registry = templates.get_registry()
    totals: collections.Counter[str] = collections.Counter()
    by_board: dict[str, collections.Counter[str]] = {}
    for entry in report["boards"]:
        board = registry.boards.get(entry["board_id"])
        if board is None or not entry.get("steps"):
            continue
        step = max(entry["steps"], key=lambda item: item["missing_total"])
        if not step["missing_total"]:
            continue
        by_node = {}
        for slot in board.slots:
            key = slot.node_id or slot.slot_id
            by_node.setdefault(key, slot)
        solo = set()
        seen: collections.Counter[str] = collections.Counter()
        for slot in board.binding_slots:
            if slot.row_index is not None:
                continue
            for binding in slot.bindings:
                occurrence_id = binding.occurrence_id or ""
                parts = occurrence_id.split("|")
                if len(parts) >= 2 and "[]" in parts[1]:
                    seen[occurrence_id] += 1
        solo = {key for key, count in seen.items() if count == 1}
        counts: collections.Counter[str] = collections.Counter()
        for node in step["missing_nodes"]:
            slot = by_node.get(node["node"])
            reason = (
                classify(slot, board, solo, api_reasons.get(entry["board_id"], {}))
                if slot is not None
                else "node_not_in_template"
            )
            counts[reason] += 1
            totals[reason] += 1
        by_board[entry["board_id"]] = counts
    print("결측어 사유 (표본: 보드마다 최대 30개 노드)")
    for reason, count in totals.most_common():
        print(f"  {count:5d}  {reason}")
    worst = sorted(by_board.items(), key=lambda item: -sum(item[1].values()))[:10]
    print("\n보드별 상위")
    for board_id, counts in worst:
        print(f"  {board_id}: {dict(counts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
