# -*- coding: utf-8 -*-
"""앱-검증-고난도-100.jsonl 결정적 검증기.

데이터셋의 기계 검증 가능한 계약을 강제한다:
  1. JSONL 파싱 · 100건 · id 유일성
  2. 필수 필드와 enum 값
  3. 키움 api_id / detail_group이 generated/registry.py에 실존
  4. tool_path의 upstream 툴이 등록·승인 별칭 체계와 정합
  5. 질문 문자열 완전 중복 금지

실행:  backend/.venv/Scripts/python.exe datasets/validate.py
성공 시 exit 0, 위반 발견 시 위반 목록을 출력하고 exit 1.
콘솔이 cp949라 한글 요약은 datasets/validate-report.json에도 남긴다.
"""
import io
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = Path(__file__).resolve().parent / "앱-검증-고난도-100.jsonl"
REGISTRY = ROOT / "backend" / "athena_api" / "generated" / "registry.py"

CARDS = {
    "FactsCard", "TableCard", "CompoundCard", "EventCard", "ActionCard", "StatusCard",
    "스트림", "리더", "타임라인", "공통 테이블", "mcp-table", "free", "notice",
}
RENDERERS = {"mcp-table", "free", "notice", "stream", "reader", "table", None}
STATUSES = {"동작-실배선", "동작-픽스처", "설계-미구현", "차단-외부요인"}
KINDS = {"kiwoom-api", "mcp-upstream", "cross-source", "app-mode", "chat-only", "blocked"}
WINDOWS = {"대화 창", "캔버스 창", "대화 창+캔버스 창"}
DIFFICULTIES = {"상", "최상"}
KIWOOM_TOOLS = {"athena_search", "athena_describe", "athena_resolve", "athena_call"}
SELF_TOOLS = {"athena__render_canvas", "athena__save_canvas"}
# 2026-08-17 등록·승인 실측 (datasets/README.md §등록 MCP 실태)
UPSTREAM_TOOLS = {
    "dart-mcp": {
        "get_current_date", "search_business_information",
        "search_detailed_financial_data", "search_disclosure",
        "search_json_financial_data",
    },
    "korea-stock-mcp": {
        "get_corp_code", "get_disclosure", "get_disclosure_list",
        "get_financial_statement", "get_market_type", "get_stock_base_info",
        "get_stock_trade_info", "get_today_date",
    },
    "naver-search-2": {"search_news", "search_webkr"},
    # 미승인 잔재 별칭 — gateway-blocked 검증 케이스 전용
    "naver-search": set(),
}
# 의도적으로 실존하지 않는 툴을 부르는 적대 케이스 (README §적대 케이스)
INTENTIONAL_BAD_TOOLS = {"HRD-094": {"korea-stock-mcp__get_realtime_price"}}

REQUIRED = (
    "id", "category", "difficulty", "question", "why_hard", "expected_answer",
    "expected_route", "expected_screen", "implementation_status", "notes", "group",
)


def main() -> int:
    problems = []
    cases = []
    for lineno, line in enumerate(io.open(DATASET, encoding="utf-8"), 1):
        line = line.strip()
        if not line:
            continue
        try:
            cases.append(json.loads(line))
        except json.JSONDecodeError as exc:
            problems.append(f"line {lineno}: JSON 파싱 실패 — {exc}")

    if len(cases) != 100:
        problems.append(f"총 건수 {len(cases)} != 100")

    registry = io.open(REGISTRY, encoding="utf-8").read()
    ids = Counter(c.get("id") for c in cases)
    for i, n in ids.items():
        if n > 1:
            problems.append(f"id 중복 x{n}: {i}")

    questions = Counter()
    for c in cases:
        cid = c.get("id", "?")
        for key in REQUIRED:
            if key not in c:
                problems.append(f"{cid}: 필수 필드 누락 {key}")
        route = c.get("expected_route") or {}
        screen = c.get("expected_screen") or {}
        if route.get("kind") not in KINDS:
            problems.append(f"{cid}: kind 위반 {route.get('kind')}")
        if c.get("difficulty") not in DIFFICULTIES:
            problems.append(f"{cid}: difficulty 위반 {c.get('difficulty')}")
        if c.get("implementation_status") not in STATUSES:
            problems.append(f"{cid}: implementation_status 위반")
        if screen.get("window") not in WINDOWS:
            problems.append(f"{cid}: window 위반 {screen.get('window')}")
        if screen.get("card") is not None and screen.get("card") not in CARDS:
            problems.append(f"{cid}: card 위반 {screen.get('card')}")
        if screen.get("current_renderer") not in RENDERERS:
            problems.append(f"{cid}: current_renderer 위반 {screen.get('current_renderer')}")
        questions[c.get("question", "")] += 1

        api_id = route.get("api_id")
        detail = route.get("detail_group")
        if route.get("kind") in ("kiwoom-api", "cross-source") and api_id:
            if f'"{api_id}"' not in registry and f"'{api_id}'" not in registry:
                problems.append(f"{cid}: api_id 미실존 {api_id}")
            if detail and f"detail:{api_id}:{detail}" not in registry:
                problems.append(f"{cid}: detail_group 미실존 {api_id}:{detail}")

        for tool in route.get("tool_path", []):
            if tool in KIWOOM_TOOLS or tool in SELF_TOOLS:
                continue
            if tool in INTENTIONAL_BAD_TOOLS.get(cid, set()):
                continue
            if "__" not in tool:
                problems.append(f"{cid}: tool_path 형식 위반 {tool}")
                continue
            alias, name = tool.split("__", 1)
            if alias not in UPSTREAM_TOOLS:
                problems.append(f"{cid}: 미등록 별칭 {alias}")
            elif alias != "naver-search" and name not in UPSTREAM_TOOLS[alias]:
                problems.append(f"{cid}: 허용 밖 툴 {tool}")

    for q, n in questions.items():
        if n > 1:
            problems.append(f"질문 완전 중복 x{n}: {q[:50]}")

    report = {
        "dataset": DATASET.name,
        "total": len(cases),
        "problems": problems,
        "difficulty": dict(Counter(c.get("difficulty") for c in cases)),
        "status": dict(Counter(c.get("implementation_status") for c in cases)),
        "kind": dict(Counter((c.get("expected_route") or {}).get("kind") for c in cases)),
        "group": dict(Counter(c.get("group") for c in cases)),
    }
    out = Path(__file__).resolve().parent / "validate-report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"cases={len(cases)} problems={len(problems)} -> {out.name}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
