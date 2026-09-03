"""표면화 배치의 필드 클레임(JSONL)을 필드 원장에 병합한다.

사용: python scripts/merge_field_claims.py <claims_dir> [--dry-run]
클레임 행: {"mapping_id","f","cls":"표현","layer":"직접|병기|펼침","board","where"}
검증(fail-closed): 원장에 없는 (mapping_id,f) 거부 · cls는 표현만 허용 · layer/board/where 필수.
병합 후 카드별 표현율을 출력하고 PAPER_FIELD_COVERAGE.json의 updated를 갱신한다.
"""

from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "PAPER_FIELD_COVERAGE.json"
LAYERS = {"직접", "병기", "펼침"}


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: merge_field_claims.py <claims_dir> [--dry-run]")
    claims_dir = Path(sys.argv[1])
    dry = "--dry-run" in sys.argv
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    index = {(r["mapping_id"], r["f"]): r for r in ledger["rows"]}

    accepted = rejected = already = 0
    reasons: Counter = Counter()
    touched: Counter = Counter()
    for path in sorted(claims_dir.glob("*.jsonl")):
        for ln, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                c = json.loads(line)
            except json.JSONDecodeError:
                rejected += 1; reasons["json"] += 1; continue
            key = (c.get("mapping_id"), c.get("f"))
            row = index.get(key)
            if row is None:
                rejected += 1; reasons["unknown-field"] += 1; continue
            if row["cls"] == "비노출":
                rejected += 1; reasons["hidden-field"] += 1; continue
            if c.get("cls") != "표현" or c.get("layer") not in LAYERS or not c.get("board") or not c.get("where"):
                rejected += 1; reasons["incomplete"] += 1; continue
            if row["cls"] == "표현" and row.get("layer"):
                already += 1
            row.update({"cls": "표현", "layer": c["layer"], "board": c["board"], "where": c["where"]})
            touched[row["card"]] += 1
            accepted += 1

    by_card: dict[str, Counter] = defaultdict(Counter)
    visible_rows = [r for r in ledger["rows"] if r["cls"] != "비노출"]
    for r in visible_rows:
        by_card[r["card"]][r["cls"]] += 1
    n = len(visible_rows)
    done = sum(1 for r in visible_rows if r["cls"] == "표현")
    print(f"claims: accepted {accepted} · already-expressed {already} · rejected {rejected} {dict(reasons) if reasons else ''}")
    print(f"필드 표현 {done}/{n} ({done / n * 100:.1f}%)")
    for card in sorted(by_card):
        v = by_card[card]; cn = sum(v.values())
        print(f"  {card}: 표현 {v['표현']}/{cn} ({v['표현'] / cn * 100:.1f}%) 집약 {v['집약']} 미표현 {v['미표현']}  (+{touched[card]})")
    if dry:
        print("dry-run: 원장 미수정")
        return
    ledger["updated"] = time.strftime("%Y-%m-%dT%H:%M+09:00")
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print("원장 갱신:", LEDGER.name)


if __name__ == "__main__":
    main()
