"""기본 조회 인자를 실측으로 교정한다 — 빈 응답을 내는 값을 자료 있는 값으로.

생성기(:mod:`build_hydrate_argument_defaults`)는 설명문만 보고 「전체」류 코드를
고른다. 그 선택이 실제로 자료를 돌려주는지는 부르지 않고 알 수 없다. 이 스크립트는
op마다 현재 기본값으로 실제 API를 부르고, 응답이 비면 그 op의 열거형 후보를 하나씩
바꿔 넣어 **자료가 오는 조합**을 찾아 ref JSON에 적는다.

원칙: 후보는 그 op 설명문에 적힌 코드만 쓴다(값을 지어내지 않는다). 자료가 오는
조합을 못 찾으면 기본값을 바꾸지 않고 `empty_ops`에 남긴다 — 그 자리는 정말로
지금 자료가 없다.

실행: python backend/scripts/calibrate_hydrate_defaults.py [--ops base:ka10025,...]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from athena_api.card_surface_templates import get_registry  # noqa: E402
from athena_api.generated.registry import TR_REGISTRY  # noqa: E402
from athena_api.hydrate_defaults import defaults_for  # noqa: E402
from athena_api.selector.catalog import build_operation_catalog  # noqa: E402

REF = BACKEND / "ref" / "hydrate-argument-defaults.json"
BASE = "http://127.0.0.1:8010"
_CODE_FIRST = re.compile(r"^([A-Za-z0-9%]{1,12})\s*[:：]\s*(.+)$")
_LABEL_FIRST = re.compile(r"^(.+?)\s*[:：]\s*([A-Za-z0-9%]{1,12})$")
# 날짜·수치 자리는 후보 열거가 없다 — 열거형만 바꿔 본다.
_MAX_CANDIDATES = 5


def enum_codes(description: str) -> list[str]:
    codes: list[str] = []
    for chunk in re.split(r"[,/·]", (description or "").split("—", 1)[-1]):
        text = chunk.strip().strip(".").strip()
        if not text or (":" not in text and "：" not in text):
            continue
        match = _CODE_FIRST.match(text)
        code = None
        if match and not re.search(r"[가-힣]", match.group(1)):
            code = match.group(1).strip()
        else:
            match = _LABEL_FIRST.match(text)
            if match and not re.search(r"[가-힣]", match.group(2)):
                code = match.group(2).strip()
        if code and code not in codes:
            codes.append(code)
    return codes


def route_for(document) -> str | None:
    spec = TR_REGISTRY.get(document.tr_id)
    if spec is None:
        return None
    parts = document.operation_ref.split(":")
    if parts[0] == "detail" and len(parts) == 3:
        return f"/api/v1/tr/{spec.domain}/{document.tr_id}/detail/{parts[2]}"
    return f"/api/v1/tr/{spec.domain}/{document.tr_id}"


def call(path: str, body: dict) -> dict | None:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError:
        return None
    except Exception:  # noqa: BLE001
        return None


def score(payload: dict | None) -> int:
    """응답이 실제로 실어온 값의 수. 빈 배열·빈 문자열은 0점."""

    if not payload or str(payload.get("return_code", "0")) not in {"0", "None"}:
        return 0
    total = 0
    for key, value in payload.items():
        if key in {"return_code", "return_msg"}:
            continue
        if isinstance(value, list):
            total += sum(
                1
                for row in value
                if isinstance(row, dict)
                for cell in row.values()
                if cell not in (None, "")
            )
        elif value not in (None, ""):
            total += 1
    return total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ops", default="")
    parser.add_argument("--stk-cd", default="005930")
    args = parser.parse_args()

    payload = json.loads(REF.read_text(encoding="utf-8"))
    catalog = build_operation_catalog()
    registry = get_registry()
    board_ops = sorted(
        {
            binding.mapping_id
            for board in registry.boards.values()
            for slot in board.binding_slots
            for binding in slot.bindings
        }
    )
    wanted = [op for op in args.ops.split(",") if op] or board_ops

    empty_ops: list[str] = []
    changed: dict[str, dict[str, str]] = {}
    for index, operation_ref in enumerate(wanted, 1):
        document = catalog.find_exact(operation_ref)
        if document is None or document.kind != "query" or not document.generic_callable:
            continue
        route = route_for(document)
        if route is None:
            continue
        aliases = {
            (field.alias or name): field
            for name, field in document.request_model.model_fields.items()
        }
        base = dict(defaults_for(operation_ref))
        if "stk_cd" in aliases and aliases["stk_cd"].is_required():
            base["stk_cd"] = args.stk_cd
        missing = [
            alias
            for alias, field in aliases.items()
            if field.is_required() and alias not in base
        ]
        if missing:
            continue
        best = score(call(route, base))
        print(f"[{index}/{len(wanted)}] {operation_ref} score={best}", flush=True)
        if best > 0:
            continue
        found: dict[str, str] = {}
        for alias, field in aliases.items():
            if not field.is_required() or alias == "stk_cd":
                continue
            codes = [
                code
                for code in enum_codes(field.description or "")
                if code != base.get(alias)
            ][:_MAX_CANDIDATES]
            for code in codes:
                trial = {**base, **found, alias: code}
                trial_score = score(call(route, trial))
                if trial_score > 0:
                    found[alias] = code
                    best = trial_score
                    break
            if best > 0:
                break
        if best > 0:
            changed[operation_ref] = found
            print(f"    calibrated {found} score={best}", flush=True)
        else:
            empty_ops.append(operation_ref)

    for operation_ref, values in changed.items():
        entries = payload["operations"].setdefault(operation_ref, {})
        for alias, value in values.items():
            entries[alias] = {"value": value, "why": "실측 교정 — 기본값이 빈 응답"}
    payload["operations"] = dict(sorted(payload["operations"].items()))
    payload["empty_ops"] = sorted(empty_ops)
    REF.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"calibrated={len(changed)} still_empty={len(empty_ops)} -> {REF}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
