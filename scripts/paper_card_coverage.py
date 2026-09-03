"""Paper 카드 페이지 × 키움 REST API 디자인 표현 매칭 현황판.

원장: PAPER_CARD_COVERAGE.json (operation 단위 status: 표현/부분/없음/계정)
실행: python scripts/paper_card_coverage.py   → 콘솔 요약 + PAPER_CARD_COVERAGE.md 재생성
검증: 원장이 kiwoom-capability-assignment.json의 299개와 1:1인지 fail-closed 확인.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "PAPER_CARD_COVERAGE.json"
ASSIGN = ROOT / "backend" / "ref" / "kiwoom-capability-assignment.json"
OUT_MD = ROOT / "PAPER_CARD_COVERAGE.md"

CARD_TITLES = {
    "CC-01": "계좌", "CC-02": "주문", "CC-03": "종목·상품",
    "CC-04": "호가", "CC-05": "수급", "CC-06": "탐색",
}
STATUSES = ("표현", "부분", "없음", "계정")


def main() -> None:
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    assign = json.loads(ASSIGN.read_text(encoding="utf-8"))
    expected = {m for cap in assign["capabilities"] for m in cap["mapping_ids"]}
    actual = set(ledger["statuses"])
    if expected != actual:
        missing = sorted(expected - actual)[:5]
        extra = sorted(actual - expected)[:5]
        raise SystemExit(f"원장이 배정표와 어긋남 — 누락 {missing} / 잉여 {extra}")
    bad = {m: e["status"] for m, e in ledger["statuses"].items() if e["status"] not in STATUSES}
    if bad:
        raise SystemExit(f"허용되지 않은 status: {bad}")

    total = Counter(e["status"] for e in ledger["statuses"].values())
    by_card: dict[str, Counter] = defaultdict(Counter)
    remaining: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for mid, e in sorted(ledger["statuses"].items()):
        by_card[e["card"]][e["status"]] += 1
        if e["status"] in ("부분", "없음"):
            remaining[f'{e["card"]} {e["status"]}'].append((mid, e["capability"]))

    n = sum(total.values())
    done = total["표현"]
    pct = done / n * 100
    goal_pct = (done + total["계정"]) / n * 100

    lines = [
        "# Paper 카드 × 키움 REST API — 디자인 표현 매칭 현황",
        "",
        f"갱신: {ledger['updated']} · 원장 `PAPER_CARD_COVERAGE.json` · 재생성 `python scripts/paper_card_coverage.py`",
        "",
        f"## 총괄 — 표현 **{done}/{n} ({pct:.1f}%)** · 부분 {total['부분']} · 없음 {total['없음']} · 계정 {total['계정']} (목표 환산 {goal_pct:.1f}%)",
        "",
        "목표 100% = 표현 296 + 계정 3(내부 코드 테이블, 증명 페이지 각주). 판정: 표현=응답 컬럼이 실제 보드 표면(표·행·차트·밴드)으로 그려짐 / 부분=계열은 있으나 일부 응답 축 미도시 / 없음=어느 보드에도 없음.",
        "",
        "| 카드 | 배정 | 표현 | 부분 | 없음 | 계정 | 표현율 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for card in sorted(CARD_TITLES):
        c = by_card[card]
        ct = sum(c.values())
        lines.append(
            f"| {card} {CARD_TITLES[card]} | {ct} | {c['표현']} | {c['부분']} | {c['없음']} | {c['계정']} | {c['표현'] / ct * 100:.0f}% |"
        )
    lines.append(f"| **합계** | **{n}** | **{done}** | **{total['부분']}** | **{total['없음']}** | **{total['계정']}** | **{pct:.1f}%** |")

    lines += ["", "## 남은 작업 목록 (부분 → 표현, 없음 → 표현)", ""]
    for key in sorted(remaining):
        ids = ", ".join(f"`{m}`" for m, _ in remaining[key])
        lines.append(f"- **{key} ({len(remaining[key])})** — {ids}")

    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"표현 {done}/{n} ({pct:.1f}%) · 부분 {total['부분']} · 없음 {total['없음']} · 계정 {total['계정']} → {OUT_MD.name} 갱신")
    for card in sorted(CARD_TITLES):
        c = by_card[card]
        print(f"  {card} {CARD_TITLES[card]}: 표현 {c['표현']}/{sum(c.values())} 부분 {c['부분']} 없음 {c['없음']}")


if __name__ == "__main__":
    main()
