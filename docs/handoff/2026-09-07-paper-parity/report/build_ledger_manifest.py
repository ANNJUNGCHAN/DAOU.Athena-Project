# -*- coding: utf-8 -*-
"""스크래치 원장 -> backend/ref/paper-ledger 복사 + manifest.json 저작 (1회용)."""
import json, glob, os, shutil, sys

SRC = r"C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity/paper-ledger"
DST = r"C:/Projects/DAOU.Athena-gates/backend/ref/paper-ledger"
IDX = r"C:/Projects/DAOU.Athena-gates/backend/ref/card-surface-templates/index.json"

PAGES = [
    ("1-0", "화면"), ("D-2", "그래프"), ("A-2", "에이전트"), ("B-2", "플러그인"),
    ("C-2", "키우미"), ("5-1", "카드"), ("F-1", "증명"), ("H-1", "카드미니"),
    ("8-1", "백테스트"), ("G-1", "백테스트 구현 현황"),
]

RETIRED_WHY = "보드 제목이 폐기 선언"
REFERENCE = {
    "164F-2": "설명 보드 — 화면 정본 지도(다른 보드들의 색인)라 구현 대상 표면이 아니다",
    "3WXE-1": "설명 보드 — Open WebUI·Orca 외부 참조 모델을 적은 자료라 구현 대상 표면이 아니다",
}

card_index = {b["board_id"] for b in json.load(open(IDX, encoding="utf-8"))["boards"]}
assert len(card_index) == 96, len(card_index)


def role_for(page, board_id, name):
    if page == "5-1":
        return ("card_template", None) if board_id in card_index else ("card_spec", None)
    if page == "H-1":
        return ("mini_template", None) if name.startswith("template/") else ("mini_card", None)
    if page == "F-1":
        return ("contract", None)
    if page == "G-1":
        return ("record", None)
    if board_id in REFERENCE:
        return ("reference", REFERENCE[board_id])
    if page == "8-1" and board_id in ("3X7M-1", "3XE7-1"):
        return ("retired", RETIRED_WHY)
    return ("screen", None)


pages_out, boards_out, copied = [], [], 0
for page, page_name in PAGES:
    src_dir = os.path.join(SRC, page)
    dst_dir = os.path.join(DST, page)
    os.makedirs(dst_dir, exist_ok=True)
    ids = []
    for f in sorted(glob.glob(os.path.join(src_dir, "*.json"))):
        bid = os.path.basename(f)[:-5]
        tree = os.path.join(src_dir, bid + ".tree.txt")
        if not os.path.exists(tree):
            continue  # 추출 중간 산출물(.fix/.ov/.overrides)은 원장이 아니다
        d = json.load(open(f, encoding="utf-8"))
        assert d["board_id"] == bid and d["page"] == page, (bid, d.get("page"))
        shutil.copyfile(f, os.path.join(dst_dir, bid + ".json"))
        shutil.copyfile(tree, os.path.join(dst_dir, bid + ".tree.txt"))
        copied += 1
        ids.append((bid, d["name"]))
    pages_out.append({"id": page, "name": page_name, "boards": len(ids)})
    for bid, name in ids:
        role, why = role_for(page, bid, name)
        entry = {"id": bid, "page": page, "name": name, "role": role}
        if why:
            entry["why"] = why
        boards_out.append(entry)

manifest = {
    "schema_version": 1,
    "paper_file_id": "01M0VGPX92K1TER4ZV9PWGQJJZ",
    "exported_at": "2026-09-05",
    "pages": pages_out,
    "boards": boards_out,
}
with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

import collections
print("copied", copied, "boards", len(boards_out))
print(collections.Counter(b["role"] for b in boards_out))
print([(p["id"], p["boards"]) for p in pages_out], sum(p["boards"] for p in pages_out))
