"""슬롯이 왜 안 채워졌는지 분류한다 — 실제 API 응답을 놓고 사유별로 센다.

보드마다 필요한 op를 실제 REST 경로(`/api/v1/tr/...`)로 부르고, 그 원문 응답을
표면 계약과 같은 평가기로 투영해 슬롯별 사유를 적는다.

  op_not_called_<사유>  op 자체가 호출되지 않았다(인자 없음 · 실시간 op 등)
  upstream_error        업스트림이 오류를 냈다
  occurrence_absent     응답에 그 필드가 아예 없다
  value_empty           필드가 있는데 빈 문자열·null이다
  list_on_scalar_leaf   배열이 왔는데 잎이 행을 지정하지 않았다
  row_beyond_rows       지정한 행이 응답 행수를 넘는다
  bound                 채워졌다
"""

from __future__ import annotations

import collections
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
BASE = os.environ.get("ATHENA_BASE", "http://127.0.0.1:8010")

from athena_api.card_surface_contract import json_path_values  # noqa: E402
from athena_api.card_surface_templates import (  # noqa: E402
    get_registry,
    visible_contracts,
)
from athena_api.hydrate_defaults import fill_missing_arguments  # noqa: E402
from athena_api.selector.catalog import build_operation_catalog  # noqa: E402
from athena_api.generated.registry import DETAIL_REGISTRY, TR_REGISTRY  # noqa: E402


def route_for(document) -> str | None:
    spec = TR_REGISTRY.get(document.tr_id)
    if spec is None:
        return None
    parts = document.operation_ref.split(":")
    if parts[0] == "detail" and len(parts) == 3:
        return f"/api/v1/tr/{spec.domain}/{document.tr_id}/detail/{parts[2]}"
    return f"/api/v1/tr/{spec.domain}/{document.tr_id}"


def post(path: str, body: dict, timeout: float = 30.0):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except ValueError:
            return exc.code, None
    except Exception:  # noqa: BLE001
        return 0, None


def call_operation(document, target: dict, cache: dict):
    """op 하나를 실제로 부른다. 같은 (tr, 인자)는 한 번만."""

    aliases = {
        (field.alias or name): field.is_required()
        for name, field in document.request_model.model_fields.items()
    }
    arguments = fill_missing_arguments(document.operation_ref, target, aliases)
    missing = sorted(
        alias for alias, required in aliases.items() if required and alias not in arguments
    )
    if missing:
        return None, f"op_not_called_arguments:{','.join(missing)}"
    path = route_for(document)
    if path is None:
        return None, "op_not_called_no_route"
    key = (path, json.dumps(arguments, sort_keys=True, ensure_ascii=False))
    if key not in cache:
        status, payload = post(path, arguments)
        if status != 200 or not isinstance(payload, dict):
            cache[key] = (None, f"upstream_error:{status}")
        elif str(payload.get("return_code", "0")) not in {"0", "None"}:
            cache[key] = (None, f"upstream_business:{payload.get('return_code')}")
        else:
            cache[key] = (payload, None)
    return cache[key]


def classify(slot, values_by_occurrence: dict, op_reason: dict) -> str:
    reasons = []
    for binding in slot.bindings:
        occurrence = binding.occurrence_id
        if binding.mapping_id in op_reason:
            reasons.append(op_reason[binding.mapping_id])
            continue
        if occurrence is None or occurrence not in values_by_occurrence:
            reasons.append("occurrence_absent")
            continue
        value = values_by_occurrence[occurrence]
        if isinstance(value, list):
            if slot.row_index is None:
                reasons.append("list_on_scalar_leaf")
            elif slot.row_index >= len(value):
                reasons.append("row_beyond_rows")
            else:
                row = value[slot.row_index]
                if row is None or (isinstance(row, str) and not row.strip()):
                    reasons.append("value_empty")
                else:
                    return "bound"
        elif value is None or (isinstance(value, str) and not value.strip()):
            reasons.append("value_empty")
        else:
            return "bound"
    return reasons[0] if reasons else "no_binding"


def main() -> int:
    registry = get_registry()
    catalog = build_operation_catalog()
    target = json.loads(os.environ.get("SWEEP_TARGET") or '{"stk_cd": "005930"}')
    only = [b for b in (os.environ.get("SWEEP_BOARDS") or "").split(",") if b]
    boards = [b for b in registry.boards.values() if not only or b.board_id in only]
    cache: dict = {}
    reason_totals: collections.Counter[str] = collections.Counter()
    per_board = []
    for index, board in enumerate(boards, 1):
        needed: list[str] = []
        for slot in board.binding_slots:
            for binding in slot.bindings:
                if binding.mapping_id not in needed:
                    needed.append(binding.mapping_id)
        values: dict = {}
        op_reason: dict[str, str] = {}
        for operation_ref in needed:
            document = catalog.find_exact(operation_ref)
            if document is None:
                op_reason[operation_ref] = "op_not_called_unknown"
                continue
            if document.kind == "websocket":
                op_reason[operation_ref] = "op_not_called_websocket"
                continue
            if document.kind == "order":
                op_reason[operation_ref] = "op_not_called_order"
                continue
            if not document.generic_callable:
                op_reason[operation_ref] = "op_not_called_not_generic"
                continue
            payload, reason = call_operation(document, target, cache)
            if payload is None:
                op_reason[operation_ref] = reason or "upstream_error"
                continue
            for contract in visible_contracts(operation_ref):
                found = [
                    value
                    for value in json_path_values(payload, contract.json_path)
                    if not isinstance(value, (dict, list, tuple, set))
                ]
                if not found:
                    continue
                if "[]" in contract.json_path:
                    values[contract.wire_occurrence_id] = found
                else:
                    values[contract.wire_occurrence_id] = found[0]
        counts: collections.Counter[str] = collections.Counter()
        samples: dict[str, list[str]] = {}
        for slot in board.binding_slots:
            reason = classify(slot, values, op_reason)
            counts[reason] += 1
            reason_totals[reason] += 1
            if reason != "bound" and len(samples.setdefault(reason, [])) < 3:
                samples[reason].append(slot.slot_id)
        per_board.append(
            {
                "board_id": board.board_id,
                "card_id": board.card_id,
                "binding_slots": len(board.binding_slots),
                "reasons": dict(counts),
                "samples": samples,
                "op_reasons": op_reason,
            }
        )
        print(
            f"[{index}/{len(boards)}] {board.board_id} "
            f"bound={counts['bound']}/{len(board.binding_slots)} "
            f"{dict(sorted((k, v) for k, v in counts.items() if k != 'bound'))}",
            flush=True,
        )
    out = {
        "target": target,
        "totals": dict(reason_totals.most_common()),
        "boards": per_board,
    }
    dest = Path(
        os.environ.get("SWEEP_OUT")
        or ROOT / "app" / "captures" / "card-api-sweep" / "SLOT-DIAGNOSIS.json"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out["totals"], ensure_ascii=False))
    print(f"wrote {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
