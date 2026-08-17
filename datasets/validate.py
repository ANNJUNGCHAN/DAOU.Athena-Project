# -*- coding: utf-8 -*-
"""앱-검증-200.jsonl 결정적 검증기 (v2 — tier·judge 루브릭 포함).

데이터셋의 기계 검증 가능한 계약을 강제한다:
  1. JSONL 파싱 · 200건(live 100 + contract 100) · id 유일성
  2. 필수 필드와 enum 값 (v2: tier, judge{must_include/must_not_include/verify_via/auto_checks})
  3. 키움 api_id / detail_group이 generated/registry.py에 실존
  4. tool_path의 upstream 툴이 등록·승인 별칭 체계와 정합
  5. tier 규칙: live는 키움 셀렉터 4툴 금지 + 난이도 최상 + 동작-실배선/차단-외부요인만
  6. 질문 문자열 완전 중복 금지

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
DATASET = Path(__file__).resolve().parent / "앱-검증-200.jsonl"
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
TIERS = {"live", "contract"}
VERIFY_VIA = {"chat-answer", "canvas-file", "audit-log", "upstream-log", "screenshot", "ui-state"}
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
INTENTIONAL_BAD_TOOLS_PREFIX = "의도적-미실존-툴"  # notes에 이 표식이 있으면 허용 밖 툴을 눈감는다
KNOWN_INTENTIONAL = {"HRD-094"}

REQUIRED = (
    "id", "tier", "category", "difficulty", "question", "why_hard", "expected_answer",
    "judge", "expected_route", "expected_screen", "implementation_status", "notes", "group",
)
JUDGE_REQUIRED = ("must_include", "must_not_include", "verify_via", "auto_checks")


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

    if len(cases) != 200:
        problems.append(f"총 건수 {len(cases)} != 200")

    registry = io.open(REGISTRY, encoding="utf-8").read()
    ids = Counter(c.get("id") for c in cases)
    for i, n in ids.items():
        if n > 1:
            problems.append(f"id 중복 x{n}: {i}")

    tier_count = Counter(c.get("tier") for c in cases)
    if tier_count.get("live") != 100 or tier_count.get("contract") != 100:
        problems.append(f"tier 배분 위반: {dict(tier_count)} (live 100 + contract 100 이어야 함)")

    questions = Counter()
    for c in cases:
        cid = c.get("id", "?")
        for key in REQUIRED:
            if key not in c:
                problems.append(f"{cid}: 필수 필드 누락 {key}")
        route = c.get("expected_route") or {}
        screen = c.get("expected_screen") or {}
        judge = c.get("judge") or {}
        tier = c.get("tier")

        if tier not in TIERS:
            problems.append(f"{cid}: tier 위반 {tier}")
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

        # judge 루브릭 계약
        for jk in JUDGE_REQUIRED:
            if jk not in judge:
                problems.append(f"{cid}: judge.{jk} 누락")
        if not (2 <= len(judge.get("must_include", [])) <= 6):
            problems.append(f"{cid}: judge.must_include 개수 위반 ({len(judge.get('must_include', []))})")
        if not (1 <= len(judge.get("must_not_include", [])) <= 4):
            problems.append(f"{cid}: judge.must_not_include 개수 위반")
        vv = judge.get("verify_via", [])
        if not vv:
            problems.append(f"{cid}: judge.verify_via 비어 있음")
        for v in vv:
            if v not in VERIFY_VIA:
                problems.append(f"{cid}: verify_via 값 위반 {v}")

        # tier 규칙
        tool_path = route.get("tool_path", [])
        uses_selector = any(t in KIWOOM_TOOLS for t in tool_path)
        if tier == "live":
            if uses_selector:
                problems.append(f"{cid}: live tier인데 키움 셀렉터 툴 사용")
            if c.get("difficulty") != "최상":
                problems.append(f"{cid}: live tier는 난이도 최상이어야 함")
            if c.get("implementation_status") not in ("동작-실배선", "차단-외부요인"):
                problems.append(f"{cid}: live tier 상태 위반 {c.get('implementation_status')}")

        questions[c.get("question", "")] += 1

        api_id = route.get("api_id")
        detail = route.get("detail_group")
        if route.get("kind") in ("kiwoom-api", "cross-source") and api_id:
            if f'"{api_id}"' not in registry and f"'{api_id}'" not in registry:
                problems.append(f"{cid}: api_id 미실존 {api_id}")
            if detail and f"detail:{api_id}:{detail}" not in registry:
                problems.append(f"{cid}: detail_group 미실존 {api_id}:{detail}")

        intentional = cid in KNOWN_INTENTIONAL or INTENTIONAL_BAD_TOOLS_PREFIX in c.get("notes", "")
        for tool in tool_path:
            if tool in KIWOOM_TOOLS or tool in SELF_TOOLS:
                continue
            if "__" not in tool:
                problems.append(f"{cid}: tool_path 형식 위반 {tool}")
                continue
            alias, name = tool.split("__", 1)
            if alias not in UPSTREAM_TOOLS:
                if not intentional:
                    problems.append(f"{cid}: 미등록 별칭 {alias}")
            elif alias != "naver-search" and name not in UPSTREAM_TOOLS[alias]:
                if not intentional:
                    problems.append(f"{cid}: 허용 밖 툴 {tool}")

    for q, n in questions.items():
        if n > 1:
            problems.append(f"질문 완전 중복 x{n}: {q[:50]}")

    report = {
        "dataset": DATASET.name,
        "total": len(cases),
        "problems": problems,
        "tier": dict(tier_count),
        "difficulty": dict(Counter(c.get("difficulty") for c in cases)),
        "status": dict(Counter(c.get("implementation_status") for c in cases)),
        "kind": dict(Counter((c.get("expected_route") or {}).get("kind") for c in cases)),
        "group": dict(Counter(c.get("group") for c in cases)),
        "verify_via_usage": dict(Counter(v for c in cases for v in (c.get("judge") or {}).get("verify_via", []))),
    }
    out = Path(__file__).resolve().parent / "validate-report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"cases={len(cases)} problems={len(problems)} -> {out.name}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
