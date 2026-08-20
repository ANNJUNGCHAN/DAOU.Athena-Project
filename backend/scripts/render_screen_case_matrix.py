# ruff: noqa: E501
"""Render the Kiwoom common-screen card case matrix.

Deterministically folds all 301 routable mappings in
`ref/kiwoom-common-screen-manifest.json` into the distinct card cases that the
Paper design must cover: every case gets exactly one Paper board, and every
mapping belongs to exactly one case. Run from any working directory with:

    python backend/scripts/render_screen_case_matrix.py

Run with `--check` to verify the committed file is current without writing it.

Banding is not aesthetic guesswork: the thresholds are the committed layout
constants `LIST_UI_PAGE_SIZE` (10) and `SCREEN_BUDGET` (20) from
`athena_api.output_profile` — the same numbers that already govern list paging
and detail-split candidacy.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from screen_render_shared import BACKEND, load_manifest, mapping_display_name

from athena_api.output_profile import LIST_UI_PAGE_SIZE, SCREEN_BUDGET  # noqa: E402

REPO_ROOT = BACKEND.parent
OUTPUT_PATH = REPO_ROOT / "plan" / "kiwoom-common-screen-case-matrix.md"

# 차트로 그리는 compound TR — plan/공통화면-템플릿-실행계획-2026-08-20.md 기준.
# P2a에서 배선하는 일/주/월/년봉 8종 + P2b에서 의도적으로 비배선하는 분/틱 4종.
CHART_TRS_WIRED = frozenset({"ka10081", "ka10082", "ka10083", "ka10094", "ka20006", "ka20007", "ka20008", "ka20019"})
CHART_TRS_UNWIRED = frozenset({"ka10079", "ka10080", "ka20004", "ka20005"})
CHART_TRS = CHART_TRS_WIRED | CHART_TRS_UNWIRED

CASES: list[dict[str, str]] = [
    {"id": "F1", "card": "FactsCard", "name": "단일 그룹", "rule": f"layout=facts · 스칼라 ≤ {LIST_UI_PAGE_SIZE}"},
    {"id": "F2", "card": "FactsCard", "name": "2단 그룹", "rule": f"layout=facts · 스칼라 {LIST_UI_PAGE_SIZE + 1}–{SCREEN_BUDGET}"},
    {"id": "T1", "card": "TableCard", "name": "표준 표", "rule": f"layout=table · pure_list · 컬럼 ≤ {LIST_UI_PAGE_SIZE}"},
    {"id": "T2", "card": "TableCard", "name": "접힘 표", "rule": f"layout=table · pure_list · 컬럼 {LIST_UI_PAGE_SIZE + 1}–{SCREEN_BUDGET}"},
    {"id": "T3", "card": "TableCard", "name": "광폭 표", "rule": f"layout=table · pure_list · 컬럼 > {SCREEN_BUDGET}"},
    {"id": "T4", "card": "TableCard", "name": "헤더 스칼라 + 표", "rule": "layout=table · compound(스칼라 1 + 리스트 1)"},
    {"id": "C1", "card": "CompoundCard", "name": "차트 (주기 옵션)", "rule": "layout=compound · 차트 12TR (P2a 배선 8 + P2b 비배선 4)"},
    {"id": "C2", "card": "CompoundCard", "name": "일반 (스칼라 + 리스트)", "rule": "layout=compound · 차트 외"},
    {"id": "E1", "card": "EventCard", "name": "표준 이벤트", "rule": "layout=event · 리스트 1"},
    {"id": "E2", "card": "EventCard", "name": "대형 이벤트", "rule": "layout=event · 리스트 2"},
    {"id": "E3", "card": "EventCard", "name": "스칼라 이벤트", "rule": "layout=event · scalar_only"},
    {"id": "A1", "card": "ActionCard", "name": "주문 확인", "rule": "layout=action"},
    {"id": "S1", "card": "StatusCard", "name": "연결 상태", "rule": "layout=status"},
]
CASE_BY_ID = {case["id"]: case for case in CASES}


def scalar_count(mapping: dict[str, Any]) -> int:
    return len(mapping["fields"]["response"]["top_level"])


def list_sections(mapping: dict[str, Any]) -> list[dict[str, Any]]:
    return mapping["fields"]["response"]["data"]


def max_columns(mapping: dict[str, Any]) -> int:
    return max((len(section["field_aliases"]) for section in list_sections(mapping)), default=0)


def classify(mapping: dict[str, Any]) -> str:
    """Assign a mapping to exactly one card case. Raises on anything unassignable."""
    layout = mapping["presentation"]["layout"]
    shape = mapping["presentation"]["shape"]
    tr_id = mapping["operation"]["tr_id"]
    if layout == "facts":
        scalars = scalar_count(mapping)
        if scalars <= LIST_UI_PAGE_SIZE:
            return "F1"
        if scalars <= SCREEN_BUDGET:
            return "F2"
        raise ValueError(f"facts mapping {mapping['mapping_id']} exceeds {SCREEN_BUDGET} scalars: {scalars}")
    if layout == "table":
        if shape == "compound":
            return "T4"
        columns = max_columns(mapping)
        if columns <= LIST_UI_PAGE_SIZE:
            return "T1"
        if columns <= SCREEN_BUDGET:
            return "T2"
        return "T3"
    if layout == "compound":
        return "C1" if tr_id in CHART_TRS else "C2"
    if layout == "event":
        if shape == "scalar_only":
            return "E3"
        return "E2" if len(list_sections(mapping)) >= 2 else "E1"
    if layout == "action":
        return "A1"
    if layout == "status":
        return "S1"
    raise ValueError(f"Unknown layout {layout!r} on {mapping['mapping_id']}")


def group_by_case(mappings: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {case["id"]: [] for case in CASES}
    for mapping in mappings:
        grouped[classify(mapping)].append(mapping)
    total = sum(len(members) for members in grouped.values())
    if total != len(mappings):
        raise ValueError(f"Coverage broken: {total} assigned of {len(mappings)} mappings")
    empty = [case_id for case_id, members in grouped.items() if not members]
    if empty:
        raise ValueError(f"Cases with no members (drop them or fix rules): {empty}")
    return grouped


def structure_cell(mapping: dict[str, Any]) -> str:
    scalars = scalar_count(mapping)
    sections = list_sections(mapping)
    if not sections:
        return f"스칼라 {scalars}"
    columns = "+".join(str(len(section["field_aliases"])) for section in sections)
    if scalars:
        return f"스칼라 {scalars} · 컬럼 {columns}"
    return f"컬럼 {columns}"


def chart_wiring_cell(mapping: dict[str, Any]) -> str:
    tr_id = mapping["operation"]["tr_id"]
    if tr_id in CHART_TRS_WIRED:
        return "배선(P2a)"
    if tr_id in CHART_TRS_UNWIRED:
        return "비배선(P2b)"
    return "—"


def render_case_section(case: dict[str, str], members: list[dict[str, Any]]) -> list[str]:
    is_chart = case["id"] == "C1"
    lines = [
        f"## {case['id']} · {case['card']} — {case['name']} ({len(members)}건)",
        "",
        f"규칙: {case['rule']}",
        "",
        "| Mapping ID | TR | 이름 | 구조 |" + (" 차트 배선 |" if is_chart else ""),
        "| --- | --- | --- | --- |" + (" --- |" if is_chart else ""),
    ]
    for mapping in sorted(members, key=lambda entry: entry["mapping_id"]):
        cells = [
            f"`{mapping['mapping_id']}`",
            f"`{mapping['operation']['tr_id']}`",
            mapping_display_name(mapping),
            structure_cell(mapping),
        ]
        if is_chart:
            cells.append(chart_wiring_cell(mapping))
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    return lines


def render(manifest: dict[str, Any]) -> str:
    mappings = manifest["mappings"]
    grouped = group_by_case(mappings)
    lines = [
        "# Kiwoom common-screen card case matrix",
        "",
        "This file is generated by `backend/scripts/render_screen_case_matrix.py` from",
        "`backend/ref/kiwoom-common-screen-manifest.json`. Do not edit it by hand; re-run the",
        "generator and `python backend/scripts/render_screen_case_matrix.py --check`.",
        "",
        "키움 REST 전 API(301 라우팅)가 만들어내는 **구별되는 카드 경우의 수**를 결정론적으로",
        "접은 목록이다. 경우마다 Paper 보드가 정확히 1장 존재해야 하고, 모든 매핑은 정확히",
        f"한 경우에 속한다. 밴드 경계는 `LIST_UI_PAGE_SIZE`({LIST_UI_PAGE_SIZE})와",
        f"`SCREEN_BUDGET`({SCREEN_BUDGET}) — 이미 커밋된 레이아웃 상수다.",
        "",
        "## Summary",
        "",
        "| Case | Card | 변형 | 규칙 | Mappings |",
        "| --- | --- | --- | --- | ---: |",
    ]
    for case in CASES:
        members = grouped[case["id"]]
        lines.append(
            f"| `{case['id']}` | {case['card']} | {case['name']} | {case['rule']} | {len(members)} |"
        )
    lines.append(f"| | | | **합계** | **{len(mappings)}** |")
    lines.append("")
    for case in CASES:
        lines.extend(render_case_section(case, grouped[case["id"]]))
    return "\n".join(lines)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = load_manifest()
    content = render(manifest)
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text(encoding="utf-8") != content:
            print(f"Generated case matrix is stale: {OUTPUT_PATH.relative_to(REPO_ROOT)}")
            return 1
        print("Generated case matrix is current")
        return 0
    write(OUTPUT_PATH, content)
    grouped = group_by_case(manifest["mappings"])
    summary = ", ".join(f"{case['id']}={len(grouped[case['id']])}" for case in CASES)
    print(f"Generated case matrix ({summary}) to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
