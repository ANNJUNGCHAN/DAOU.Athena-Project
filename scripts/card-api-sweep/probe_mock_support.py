"""조회 op를 하나씩 실제로 불러 **모의투자가 지원하는지**를 근거와 함께 적는다 (2026-09-09).

카드 화면의 빈 칸에는 두 가지 원인이 섞여 있다: 지금 자료가 없는 것과 **이 환경이 그
업무를 아예 제공하지 않는 것**. 둘째는 코드로 닫을 수 없으므로 목록과 근거(요청 본문 ·
응답 본문)를 문서로 남긴다.

부르는 것: 하이드레이션이 부르는 것과 **같은 목록**이다 — op 카탈로그의 조회 op 전부
(base와 detail 그룹). TR id만 훑으면 detail 그룹으로만 열리는 op(ka10001 등)의 base
경로가 404가 나서 「부르지 못했다」로 잘못 적힌다(실측).

**부르지 않는 것: 주문 op(`kind == "order"`)와 websocket op.** 모의 계좌라도 주문을
내지 않는다 — 검사기가 주문을 만들면 그 계좌의 잔고와 미체결이 바뀌어 다른 검사의
전제가 흔들린다. oauth op도 뺀다(토큰 발급은 백엔드가 알아서 한다).

판정
  ``supported``        `return_code == 0`. 응답이 실은 값 수를 함께 적는다.
  ``mock_unsupported`` 응답 문면이 모의투자 한계를 말한다(RC9000 · 8104).
  ``business_error``   그 밖의 업무 오류 — 인자가 이 계좌에 안 맞는 자리다.
  ``needs_arguments``  필수 인자를 화면 기본값표·연쇄 인자로도 못 채웠다(422).
                       부르지 못했다 — 값을 지어내지 않는다.
  ``upstream_error``   HTTP 오류로 끊겼다.

실행: python scripts/card-api-sweep/probe_mock_support.py [--ops ka10001,...] [--only-boards]
필요: 백엔드가 8010에 떠 있어야 한다.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:8010"
OUT_JSON = ROOT / "app" / "captures" / "card-api-sweep" / "MOCK-SUPPORT.json"
OUT_DOC = ROOT / "docs" / "reference" / "2026-09-09-mock-unsupported-apis.md"
TARGETS = ROOT / "backend" / "ref" / "probe-instrument-targets.json"

# 모의투자 한계를 말하는 문면. 상류가 코드와 함께 한국어로 적어 준다.
MOCK_MARKERS = ("모의투자에서는 해당업무가 제공되지 않습니다", "모의투자에서 지원하지 않는 API")
RATE_LIMIT_SLEEP = 0.35


def call(path: str, body: dict) -> tuple[int, dict | None, str]:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode("utf-8")), ""
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw), ""
        except json.JSONDecodeError:
            return error.code, None, raw[:400]
    except Exception as exc:  # noqa: BLE001
        return 0, None, f"{type(exc).__name__}: {exc}"


def value_count(payload: dict) -> int:
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


def kind_of(tr_id: str, kinds: list[dict]) -> str:
    for entry in kinds:
        if any(tr_id.startswith(prefix) for prefix in entry["tr_prefixes"]):
            return entry["kind"]
    return "stock"


def resolve_targets(kinds: list[dict]) -> dict[str, str]:
    resolved = {"stock": "005930"}
    for entry in kinds:
        if entry.get("code"):
            resolved[entry["kind"]] = entry["code"]
            continue
        source = entry.get("list") or {}
        _, payload, _ = call(source.get("path", ""), source.get("body") or {})
        rows = (payload or {}).get(source.get("list_field")) or []
        for row in rows:
            code = str((row or {}).get(source.get("code_field")) or "").strip()
            if code:
                resolved[entry["kind"]] = code
                break
    return resolved


_CHAIN_CACHE: dict[tuple[str, str], str] = {}


def resolve_chain(chain, target_code: str, registry, catalog, defaults_for) -> str:
    """연쇄 인자 하나를 값으로 바꾼다 — 목록 op를 부르고 첫 항목을 쓴다."""

    operation_ref = str(chain.get("operation_ref") or "")
    json_path = str(chain.get("json_path") or "")
    key = (operation_ref, json_path)
    if key in _CHAIN_CACHE:
        return _CHAIN_CACHE[key]
    document = catalog.find_exact(operation_ref)
    if document is None:
        return ""
    spec = registry.get(document.tr_id)
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
        body.setdefault("stk_cd", target_code)
    _, payload, _ = call(route, body)
    value = ""
    if payload:
        # `$.list[].code` 또는 `$.field` 두 꼴만 쓴다(ref가 그 둘만 적는다).
        segments = [part for part in json_path.lstrip("$.").split(".") if part]
        cursor: object = payload
        for segment in segments:
            if segment.endswith("[]"):
                rows = (cursor or {}).get(segment[:-2]) if isinstance(cursor, dict) else None
                cursor = rows[0] if isinstance(rows, list) and rows else None
            else:
                cursor = cursor.get(segment) if isinstance(cursor, dict) else None
            if cursor is None:
                break
        if isinstance(cursor, str):
            value = cursor.strip()
    _CHAIN_CACHE[key] = value
    return value


def classify(status: int, payload: dict | None, error: str) -> tuple[str, str]:
    if payload is None:
        return "upstream_error", error or f"HTTP {status}"
    message = str(payload.get("return_msg") or "")
    if status == 404:
        # 그 경로가 없다 — 부르는 목록이 틀린 것이고 상류 판정이 아니다.
        return "route_missing", json.dumps(payload, ensure_ascii=False)[:200]
    if status == 422 or "detail" in payload and "return_code" not in payload:
        missing = payload.get("detail")
        return "needs_arguments", json.dumps(missing, ensure_ascii=False)[:300]
    code = str(payload.get("return_code", ""))
    if code in {"0", "None", ""}:
        return "supported", message
    if any(marker in message for marker in MOCK_MARKERS):
        return "mock_unsupported", message
    return "business_error", message


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ops", default="", help="쉼표로 나눈 tr_id(기본: 조회 op 전부)")
    parser.add_argument("--only-boards", action="store_true", help="카드 보드가 쓰는 op만")
    args = parser.parse_args()

    sys.path.insert(0, str(ROOT / "backend"))
    from athena_api.card_surface_templates import get_registry
    from athena_api.generated.registry import TR_REGISTRY
    from athena_api.hydrate_defaults import chain_for, defaults_for
    from athena_api.selector.catalog import build_operation_catalog

    catalog = build_operation_catalog()

    kinds = json.loads(TARGETS.read_text(encoding="utf-8"))["kinds"]
    targets = resolve_targets(kinds)
    print(f"종류별 조회 대상: {targets}", flush=True)

    board_ops: dict[str, set[str]] = collections.defaultdict(set)
    for board_id, board in get_registry().boards.items():
        for slot in board.binding_slots:
            for binding in slot.bindings:
                board_ops[binding.mapping_id].add(board_id)

    def route_for(document) -> str | None:
        spec = TR_REGISTRY.get(document.tr_id)
        if spec is None:
            return None
        parts = document.operation_ref.split(":")
        if parts[0] == "detail" and len(parts) == 3:
            return f"/api/v1/tr/{spec.domain}/{document.tr_id}/detail/{parts[2]}"
        return f"/api/v1/tr/{spec.domain}/{document.tr_id}"

    picked = [op for op in args.ops.split(",") if op]
    documents = []
    for document in catalog.documents:
        if document.kind != "query" or not document.generic_callable:
            continue
        if picked and document.tr_id not in picked and document.operation_ref not in picked:
            continue
        if args.only_boards and document.operation_ref not in board_ops:
            continue
        documents.append(document)
    documents.sort(key=lambda d: d.operation_ref)

    records: list[dict] = []
    for index, document in enumerate(documents, 1):
        tr_id = document.tr_id
        spec = TR_REGISTRY[tr_id]
        route = route_for(document)
        if route is None:
            continue
        aliases = {
            (field.alias or name): field
            for name, field in document.request_model.model_fields.items()
        }
        body = dict(defaults_for(document.operation_ref))
        kind = kind_of(tr_id, kinds)
        if "stk_cd" in aliases:
            body.setdefault("stk_cd", targets.get(kind, "005930"))
        # 연쇄 인자 — 값을 API 자신이 목록으로 알려주는 자리(회원사·테마·감시그룹·ETF
        # 대상지수). 하이드레이션이 쓰는 것과 같은 표를 쓴다. 이걸 안 쓰면 부를 수 있는
        # 조회가 「인자 부족」으로 잘못 적힌다(실측 8자리).
        chained: dict[str, str] = {}
        for alias, field in aliases.items():
            if not field.is_required() or alias in body:
                continue
            chain = chain_for(alias)
            if chain is None:
                continue
            value = resolve_chain(
                chain, targets.get(kind, "005930"), TR_REGISTRY, catalog, defaults_for,
            )
            if value:
                body[alias] = value
                chained[alias] = value
        status, payload, error = call(route, body)
        # 속도 제한은 결함이 아니다 — 한 번 쉬고 다시 묻는다.
        if payload and "429" in str(payload.get("return_msg") or ""):
            time.sleep(2)
            status, payload, error = call(route, body)
        verdict, message = classify(status, payload, error)
        record = {
            "operation_ref": document.operation_ref,
            "tr_id": tr_id,
            "name": spec.name,
            "domain": spec.domain,
            "route": route,
            "kind": kind,
            "request": body,
            "chained_arguments": chained,
            "http_status": status,
            "return_code": (payload or {}).get("return_code"),
            "return_msg": message,
            "verdict": verdict,
            "value_count": value_count(payload) if payload else 0,
            "response_keys": sorted(
                k for k in (payload or {}) if k not in {"return_code", "return_msg"}
            ),
            "boards": sorted(board_ops.get(document.operation_ref, ())),
        }
        records.append(record)
        print(
            f"[{index}/{len(documents)}] {document.operation_ref} {verdict} 값 {record['value_count']}"
            f"{' — ' + message[:60] if message and verdict != 'supported' else ''}",
            flush=True,
        )
        time.sleep(RATE_LIMIT_SLEEP)

    counts = collections.Counter(record["verdict"] for record in records)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "upstream": "https://mockapi.kiwoom.com (모의투자)",
                "targets": targets,
                "skipped": "주문 op(kind=order) · websocket op · oauth op — 검사기는 주문을 내지 않는다",
                "counts": dict(sorted(counts.items())),
                "operations": records,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    write_doc(records, counts, targets)
    print(f"\n판정별: {dict(sorted(counts.items()))}")
    print(f"→ {OUT_JSON}\n→ {OUT_DOC}")
    return 0


def write_doc(records: list[dict], counts: collections.Counter, targets: dict) -> None:
    unsupported = [r for r in records if r["verdict"] == "mock_unsupported"]
    business = [r for r in records if r["verdict"] == "business_error"]
    needs = [r for r in records if r["verdict"] == "needs_arguments"]
    lines = [
        "# 모의투자가 지원하지 않는 조회 — 실측 목록과 근거 (2026-09-09)",
        "",
        "로컬 백엔드(`127.0.0.1:8010`)를 통해 키움 **모의투자** 서버",
        "`https://mockapi.kiwoom.com`로 조회 op를 하나씩 실제로 불러 적었다. 요청 본문은",
        "화면 기본값표(`backend/ref/hydrate-argument-defaults.json`)가 채운 것이고, 조회",
        "대상은 종류별 표(`backend/ref/probe-instrument-targets.json`)가 고른 것이다 —",
        f"이번 실행은 {json.dumps(targets, ensure_ascii=False)}.",
        "",
        "**주문 op와 websocket op는 부르지 않았다.** 모의 계좌라도 주문을 내지 않는다 —",
        "검사기가 주문을 만들면 그 계좌의 잔고와 미체결이 바뀌어 다른 검사의 전제가 흔들린다.",
        "",
        f"판정별 수: {', '.join(f'`{k}` {v}' for k, v in sorted(counts.items()))}.",
        "재현: `python scripts/card-api-sweep/probe_mock_support.py`",
        "(산출물 `app/captures/card-api-sweep/MOCK-SUPPORT.json`).",
        "",
        "## 1. 모의투자 미지원 — 응답이 그렇게 말한 조회",
        "",
        "이 자리는 코드로 닫을 수 없다. 실계좌 자격으로 같은 검사기를 돌리면 그때 판정 대상이 된다.",
        "",
        "| TR | 이름 | 요청 본문(입력) | 응답 본문(출력) | 쓰는 카드 보드 |",
        "|---|---|---|---|---|",
    ]
    for record in sorted(unsupported, key=lambda r: r["operation_ref"]):
        boards = ", ".join(record["boards"]) or "—"
        lines.append(
            f"| `{record['operation_ref']}` | {record['name']} | `{json.dumps(record['request'], ensure_ascii=False)}` "
            f"| `{{\"return_code\": {record['return_code']}, \"return_msg\": \"{record['return_msg']}\"}}` | {boards} |"
        )
    lines += [
        "",
        "## 2. 업무 오류 — 모의투자 한계가 아닌 거부",
        "",
        "인자가 이 계좌·이 종목에 맞지 않아 상류가 거부한 자리다. 인자를 고치면 닫힌다.",
        "",
        "| TR | 이름 | 요청 본문 | 응답 문면 |",
        "|---|---|---|---|",
    ]
    if not business:
        lines.append("| — | 없다 | — | 이번 실행에서 모의투자 한계가 아닌 업무 거부는 없었다 |")
    for record in sorted(business, key=lambda r: r["operation_ref"]):
        lines.append(
            f"| `{record['operation_ref']}` | {record['name']} | `{json.dumps(record['request'], ensure_ascii=False)}` "
            f"| {record['return_msg']} |"
        )
    lines += [
        "",
        "## 3. 부르지 못한 조회 — 필수 인자를 못 채웠다",
        "",
        "화면이 주지 않은 조회 대상(주문번호 등)이 필요한 자리다. 값을 지어내지 않으므로 부르지 않는다.",
        "",
        "| TR | 이름 | 모자란 인자 |",
        "|---|---|---|",
    ]
    for record in sorted(needs, key=lambda r: r["operation_ref"]):
        lines.append(
            f"| `{record['operation_ref']}` | {record['name']} | `{record['return_msg'][:160]}` |"
        )
    lines.append("")
    OUT_DOC.parent.mkdir(parents=True, exist_ok=True)
    OUT_DOC.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
