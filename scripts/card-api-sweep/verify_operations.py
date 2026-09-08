"""보드마다 조회를 실제로 부르고, **모든 op의 상태를 사유별로 판정**한다 (2026-09-09).

화면 결측어가 0이어도 그것만으로는 「값이 정상으로 들어왔다」가 증명되지 않는다.
상류가 정상으로 **빈 목록**을 답한 자리는 규칙대로 빈 칸이 되므로 화면에는 아무
흔적이 없다. 그 침묵이 「자료가 지금 없다」인지 「조회가 실패했다」인지 가르는 것이
이 검사기다.

받아들이는 상태 — 그 자리는 정상이다.

  ``bound``                   조회가 return_code 0으로 답했다. 값 수가 0이어도
                              **정상 응답**이다(업무 오류는 bound가 되지 않는다,
                              canvas_push `_hydrate_operation`).
  ``not_a_rest_read``         실시간(websocket) 전용 op — 조회로 부르는 자리가 아니다.
  ``order_operation_refused`` 주문 op — 검사기는 주문을 내지 않는다(모의 계좌라도).
  ``arguments_unmapped:*``    화면이 주지 않은 조회 대상(주문번호 등)이 필요하다.
  ``mock_unsupported``        상류가 「모의투자에서는 해당업무가 제공되지 않습니다」라고
                              답했다 — 이 환경의 한계이고 코드로 닫을 수 없다. 업무
                              오류로 온 자리는 그 op를 직접 한 번 더 불러 응답 문면을
                              읽고 이 갈래로 가른다(사유를 이름으로 남긴다).

결함으로 세는 상태.

  ``upstream_error``            호출이 예외로 끊겼다(HTTP 오류·검증 실패).
  ``upstream_business_result``  상류가 업무 오류로 답했는데 모의투자 한계가 아니다.
  그 밖의 모르는 사유.

실행: python scripts/card-api-sweep/verify_operations.py [--boards 2VDA-0,...]
필요: 백엔드가 8010에 떠 있어야 한다.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:8010"
HYDRATE = "/api/v1/internal/canvas/board-hydrate"
OUT = ROOT / "app" / "captures" / "card-api-sweep" / "OPERATION-LEDGER.json"

OK_EXACT = {"bound", "not_a_rest_read", "order_operation_refused"}
OK_PREFIX = ("arguments_unmapped",)
TARGETS = ROOT / "backend" / "ref" / "probe-instrument-targets.json"


def kind_targets() -> list[dict]:
    """종류별 조회 대상 표 — 앱 프로브(`app/lib/board-sweep-targets.js`)와 같은 파일."""

    return json.loads(TARGETS.read_text(encoding="utf-8"))["kinds"]


def call_json(path: str, body: dict) -> dict | None:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def resolve_targets() -> dict[str, str]:
    """종류 → 조회 코드. 목록 op는 한 번만 부르고 첫 항목을 쓴다."""

    resolved: dict[str, str] = {}
    for entry in kind_targets():
        if entry.get("code"):
            resolved[entry["kind"]] = entry["code"]
            continue
        source = entry.get("list") or {}
        payload = call_json(source.get("path", ""), source.get("body") or {})
        rows = (payload or {}).get(source.get("list_field")) or []
        for row in rows:
            code = str((row or {}).get(source.get("code_field")) or "").strip()
            if code:
                resolved[entry["kind"]] = code
                break
    return resolved


def kind_of(operation_refs: list[str]) -> str:
    for ref in operation_refs:
        tr_id = ref.split(":")[1] if ":" in ref else ""
        for entry in kind_targets():
            if any(tr_id.startswith(prefix) for prefix in entry["tr_prefixes"]):
                return entry["kind"]
    return "stock"


def token() -> str:
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("ATHENA_LOCAL_BEARER_TOKEN"):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("backend/.env에 ATHENA_LOCAL_BEARER_TOKEN이 없다")


def board_ids() -> list[str]:
    sys.path.insert(0, str(ROOT / "backend"))
    from athena_api.card_surface_templates import get_registry

    return sorted(get_registry().boards)


def hydrate(board_id: str, bearer: str, code: str) -> dict:
    request = urllib.request.Request(
        BASE + HYDRATE,
        data=json.dumps({"board_id": board_id, "target": {"stk_cd": code}}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {bearer}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def verdict(status: dict) -> str:
    """op 상태 하나를 사유 문자열로 줄인다."""

    if status.get("status") == "bound":
        return "bound"
    reason = str(status.get("reason") or "unknown")
    return reason.split(":", 1)[0] + (":*" if ":" in reason else "")


def acceptable(reason: str) -> bool:
    if reason in OK_EXACT:
        return True
    return any(reason.startswith(prefix) for prefix in OK_PREFIX)


def business_message(operation_ref: str, code: str) -> str:
    """업무 오류로 온 op를 직접 한 번 불러 응답 문면을 읽는다."""

    sys.path.insert(0, str(ROOT / "backend"))
    from athena_api.generated.registry import TR_REGISTRY
    from athena_api.hydrate_defaults import defaults_for
    from athena_api.selector.catalog import build_operation_catalog

    global _CATALOG  # noqa: PLW0603
    if _CATALOG is None:
        _CATALOG = build_operation_catalog()
    document = _CATALOG.find_exact(operation_ref)
    if document is None:
        return ""
    spec = TR_REGISTRY.get(document.tr_id)
    if spec is None:
        return ""
    parts = operation_ref.split(":")
    route = (
        f"/api/v1/tr/{spec.domain}/{document.tr_id}/detail/{parts[2]}"
        if parts[0] == "detail" and len(parts) == 3
        else f"/api/v1/tr/{spec.domain}/{document.tr_id}"
    )
    body = dict(defaults_for(operation_ref))
    aliases = {
        (field.alias or name): field
        for name, field in document.request_model.model_fields.items()
    }
    if "stk_cd" in aliases:
        body.setdefault("stk_cd", code)
    payload = call_json(route, body) or {}
    return str(payload.get("return_msg") or "")


_CATALOG = None
_MESSAGES: dict[tuple[str, str], str] = {}
_MOCK_LIMIT = "모의투자"


def classify_business_result(operation_ref: str, code: str) -> tuple[str, str]:
    """업무 오류 하나를 (사유, 문면)으로 가른다."""

    key = (operation_ref, code)
    if key not in _MESSAGES:
        _MESSAGES[key] = business_message(operation_ref, code)
    message = _MESSAGES[key]
    if _MOCK_LIMIT in message:
        return "mock_unsupported", message
    return "upstream_business_result", message


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--boards", default="", help="쉼표로 나눈 보드 id(기본: 전체)")
    args = parser.parse_args()

    bearer = token()
    sys.path.insert(0, str(ROOT / "backend"))
    from athena_api.card_surface_templates import get_registry

    registry = get_registry()
    boards = [b for b in args.boards.split(",") if b] or sorted(registry.boards)
    codes = resolve_targets()
    print(f"종류별 조회 대상: {codes}", flush=True)

    reasons: collections.Counter[str] = collections.Counter()
    defects: list[dict] = []
    accepted_limits: list[dict] = []
    empty_ok: list[dict] = []
    records: list[dict] = []

    for index, board_id in enumerate(boards, 1):
        board = registry.boards[board_id]
        refs = sorted({
            binding.mapping_id
            for slot in board.binding_slots
            for binding in slot.bindings
        })
        kind = kind_of(refs)
        code = codes.get(kind, "005930")
        try:
            reply = hydrate(board_id, bearer, code)
        except (urllib.error.URLError, TimeoutError) as exc:
            defects.append({
                "board_id": board_id, "reason": "hydrate_unavailable", "error": str(exc),
            })
            print(f"[{index}/{len(boards)}] {board_id} 하이드레이션 실패 — {exc}", flush=True)
            continue
        operations = reply.get("operations") or []
        filled = len(reply.get("surface_contract", {}).get("slot_values") or [])
        board_defects: list[dict] = []
        for status in operations:
            reason = verdict(status)
            entry = {
                "board_id": board_id,
                "operation_ref": status.get("operation_ref"),
                "reason": str(status.get("reason") or reason),
                "kind": kind,
                "target": code,
            }
            if reason == "upstream_business_result":
                reason, message = classify_business_result(entry["operation_ref"], code)
                entry["reason"] = reason
                entry["upstream_message"] = message
            reasons[reason] += 1
            if reason == "mock_unsupported":
                accepted_limits.append(entry)
            elif not acceptable(reason):
                board_defects.append(entry)
            elif reason == "bound" and not status.get("bound_count"):
                # 정상 응답인데 값이 0 — 지금 자료가 없는 자리다. 결함이 아니지만
                # 「값이 들어오는 것을 봤다」고 말할 수 없으므로 따로 남긴다.
                empty_ok.append(entry)
        defects.extend(board_defects)
        records.append({
            "board_id": board_id,
            "kind": kind,
            "target": code,
            "filled": filled,
            "operations": len(operations),
            "defects": len(board_defects),
        })
        mark = f"결함 {len(board_defects)}" if board_defects else "정상"
        print(
            f"[{index}/{len(boards)}] {board_id} ({kind} {code}) "
            f"op {len(operations)} · 값 {filled} · {mark}",
            flush=True,
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "boards": len(records),
                "targets": codes,
                "reasons": dict(sorted(reasons.items())),
                "defects": defects,
                "mock_unsupported": accepted_limits,
                "answered_without_values": empty_ok,
                "board_records": records,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"사유별: {dict(sorted(reasons.items()))}")
    print(
        f"모의투자 미지원 {len(accepted_limits)}자리 · 정상 응답·값 0 {len(empty_ok)}자리 "
        f"· 결함 {len(defects)}자리 → {OUT}"
    )
    for entry in defects[:20]:
        print(f"  결함 {entry['board_id']} {entry.get('operation_ref')} {entry['reason']}")
    return 1 if defects else 0


if __name__ == "__main__":
    raise SystemExit(main())
