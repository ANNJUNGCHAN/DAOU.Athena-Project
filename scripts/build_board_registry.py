"""보드 표면 템플릿 색인 생성기.

입력: backend/ref/card-surface-templates/<board_id>/board.html (+ meta.json, slots.json)
출력: app/lib/board-templates.index.generated.js     — 보드 id → 카드 id 색인 + 상태 그래프(소형)
      app/lib/board-templates.<card_id>.generated.js — 카드별 청크(원문 HTML + 마운트 계약)
      둘 다 편집 금지, 이 스크립트만 쓴다.

board.html은 Paper `get_jsx` 추출 원문이라 런타임에 파일로 읽을 수 없다(렌더러는
file:// 스코프이고 fetch를 쓰지 않는다). 그래서 문자열 상수로 묶어 `<script src>`
한 줄로 싣는다. 해시는 board-mount가 마운트 전에 드리프트를 잡는 근거다(R5).

보드 96장을 한 파일에 묶으면 수 MB짜리 스크립트가 셸 부팅마다 통째로 파싱된다.
카드는 6종뿐이고 한 화면에 뜨는 보드는 그중 하나이므로 **카드별로 쪼개고 색인만
동기 로드**한다. 필요한 청크는 board-template-registry가 마운트 직전에 script 주입으로
가져온다(file:// 호환, fetch 없음).

실행: python scripts/build_board_registry.py [--check]
  --check 는 파일을 쓰지 않고 현 산출물이 최신인지만 확인한다(CI/게이트용).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_DIR = ROOT / "backend" / "ref" / "card-surface-templates"
OUT_DIR = ROOT / "app" / "lib"
INDEX_JS = OUT_DIR / "board-templates.index.generated.js"
INDEX_JSON = TEMPLATE_DIR / "index.json"

CARD_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")

GENERATED_BANNER = (
    "// 생성물 — scripts/build_board_registry.py가 만든다. 직접 편집하지 마라.\n"
    "// 원본: backend/ref/card-surface-templates/<board_id>/board.html (Paper get_jsx 추출 원문)\n"
)

INDEX_FOOTER = """
const __exports = { BOARD_CARD, CARD_IDS, STATE_GRAPH };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardTemplatesIndex = __exports;
}

})();
"""

CHUNK_FOOTER = """
const __exports = { CARD_ID, BOARDS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardTemplateChunks = window.AthenaLib.BoardTemplateChunks || {};
  window.AthenaLib.BoardTemplateChunks[CARD_ID] = __exports;
}

})();
"""

# 추출기(scripts/paper_board_extract.py)는 Paper 노드 id를 모든 노드에 data-node로
# 남긴다. 중첩은 정상이고, 텍스트 치환 대상이 컨테이너인지 여부는 마운트 시점에
# board-mount가 판정한다. 여기서 고정하는 것은 "슬롯이 가리키는 앵커가 실제로
# board.html에 있는가" 하나다.
NODE_ATTR = re.compile(r'data-node="([^"]+)"')


def _js_string(value: str) -> str:
    """JS 소스에 그대로 넣을 수 있는 리터럴. JSON 인코딩이 정확히 그 일을 한다."""
    return json.dumps(value, ensure_ascii=False)


def _check_slot_anchors(board_id: str, html: str, slots_path: Path) -> None:
    """slots.json이 가리키는 앵커가 board.html에 전부 있는지 확인한다(fail-closed)."""
    if not slots_path.exists():
        return
    contract = json.loads(slots_path.read_text(encoding="utf-8"))
    anchors = set(NODE_ATTR.findall(html))
    missing = sorted({
        str(slot.get("node_id") or slot.get("node") or slot.get("slot_id"))
        for slot in contract.get("slots", [])
    } - anchors)
    if missing:
        raise SystemExit(f"{board_id}: slots.json 앵커가 board.html에 없다 — {missing[:5]}")


# 마운트 계약 투사 — board-mount가 실제로 읽는 필드만 싣는다. slots.json 전체(원장
# 근거·감사 필드 포함)를 그대로 실으면 청크가 두 배가 되고, 프론트는 쓰지도 않는다.
# 값은 봉투(surface_contract.slot_values)가 나르고, 여기 실리는 것은 정적 계약뿐이다.
_MOUNT_FIELDS = ("slot_id", "kind", "paper_text", "paired_with", "collapse_group", "expanded_board")


def _mount_contract(slots_path: Path) -> list[dict]:
    if not slots_path.exists():
        return []
    contract = json.loads(slots_path.read_text(encoding="utf-8"))
    projected = []
    for slot in contract.get("slots", []):
        entry = {"node": slot.get("node_id") or slot.get("node") or slot.get("slot_id")}
        for field in _MOUNT_FIELDS:
            value = slot.get(field)
            if value not in (None, "", [], {}):
                entry[field] = value
        if slot.get("format"):
            entry["format"] = slot["format"]
        projected.append(entry)
    return projected


def collect() -> list[dict]:
    boards = []
    for board_dir in sorted(p for p in TEMPLATE_DIR.iterdir() if p.is_dir()):
        html_path = board_dir / "board.html"
        if not html_path.exists():
            continue
        html = html_path.read_text(encoding="utf-8")
        slots_path = board_dir / "slots.json"
        _check_slot_anchors(board_dir.name, html, slots_path)
        meta_path = board_dir / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        card_id = str(meta.get("card_id") or "")
        # 카드 id는 청크 파일 이름이 된다 — 없거나 이상하면 어느 청크에도 못 넣는다.
        if not CARD_ID_RE.match(card_id):
            raise SystemExit(
                f"{board_dir.name}: meta.json card_id가 없거나 파일명이 못 된다 — {card_id!r}"
            )
        boards.append({
            "board_id": meta.get("board_id", board_dir.name),
            "card_id": card_id,
            "html": html,
            "html_sha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
            "slots": _mount_contract(slots_path),
        })
    return boards


def state_graph() -> dict[str, dict]:
    """보드 id → {parent, links} — 상태 보드 그래프.

    `links`는 그 보드의 레일에 실제로 찍힌 표식을 편 목록이고(board-mount의
    ``stateLinksFromMarks``와 같은 모양), `parent`는 그 보드로 들어온 자리다. 봉투는
    마운트한 보드의 직계 자식만 나르는데 자식 보드의 레일은 부모 레일의 복제본이라,
    전환 뒤에도 레일이 살려면 프론트가 부모의 링크를 여기서 다시 읽어야 한다.

    원본은 추출기가 해석을 끝낸 `index.json`이다 — `meta.json`의 `state`는 부모가
    비어 있거나 자기 자신으로 적힌 채라(레일 주인) 그대로 못 쓴다.
    """
    if not INDEX_JSON.exists():
        raise SystemExit(f"상태 그래프 원본이 없다 — {INDEX_JSON}")
    index = json.loads(INDEX_JSON.read_text(encoding="utf-8"))
    graph: dict[str, dict] = {}
    for board in index.get("boards", []):
        links = []
        for mark in (board.get("state_controls") or {}).get("marks") or []:
            control = str(mark.get("control") or "").strip()
            if not control:
                continue
            for target in mark.get("boards") or []:
                if target:
                    links.append({"control": control, "board_id": str(target)})
        parent = (board.get("state") or {}).get("parent_board")
        # 링크도 부모도 없는 보드는 실을 것이 없다 — 색인은 작아야 한다.
        if links or parent:
            graph[board["board_id"]] = {"parent": parent, "links": links}
    return graph


def chunk_path(card_id: str) -> Path:
    return OUT_DIR / f"board-templates.{card_id}.generated.js"


def card_ids(boards: list[dict]) -> list[str]:
    return sorted({board["card_id"] for board in boards})


def render_index(boards: list[dict], graph: dict[str, dict]) -> str:
    parts = [GENERATED_BANNER, "(function () {\n'use strict';\n\n", "const BOARD_CARD = Object.freeze({\n"]
    for board in boards:
        parts.append(f"  {_js_string(board['board_id'])}: {_js_string(board['card_id'])},\n")
    parts.append("});\n\n")
    parts.append(f"const CARD_IDS = Object.freeze({json.dumps(card_ids(boards), ensure_ascii=False)});\n\n")
    parts.append("const STATE_GRAPH = Object.freeze({\n")
    for board_id in sorted(graph):
        entry = json.dumps(graph[board_id], ensure_ascii=False, separators=(",", ":"))
        parts.append(f"  {_js_string(board_id)}: {entry},\n")
    parts.append("});\n")
    parts.append(INDEX_FOOTER)
    return "".join(parts)


def render_chunk(card_id: str, boards: list[dict]) -> str:
    parts = [GENERATED_BANNER, "(function () {\n'use strict';\n\n"]
    parts.append(f"const CARD_ID = {_js_string(card_id)};\n\n")
    parts.append("const BOARDS = {\n")
    for board in boards:
        parts.append(f"  {_js_string(board['board_id'])}: Object.freeze({{\n")
        parts.append(f"    htmlSha256: {_js_string(board['html_sha256'])},\n")
        parts.append(f"    html: {_js_string(board['html'])},\n")
        parts.append(
            f"    slots: {json.dumps(board['slots'], ensure_ascii=False, separators=(',', ':'))},\n"
        )
        parts.append("  }),\n")
    parts.append("};\n")
    parts.append(CHUNK_FOOTER)
    return "".join(parts)


def render(boards: list[dict], graph: dict[str, dict]) -> dict[Path, str]:
    """경로 → 소스. 색인 1장 + 카드 청크 N장."""
    files = {INDEX_JS: render_index(boards, graph)}
    for card_id in card_ids(boards):
        members = [board for board in boards if board["card_id"] == card_id]
        files[chunk_path(card_id)] = render_chunk(card_id, members)
    return files


def stale_outputs(files: dict[Path, str]) -> list[Path]:
    """색인에 없는 옛 산출물 — 청크 이전의 단일 파일과 사라진 카드의 청크."""
    return sorted(
        path
        for path in OUT_DIR.glob("board-templates*.generated.js")
        if path not in files
    )


def main() -> None:
    # Windows 콘솔 기본 코드페이지(cp949)는 —·조 같은 글자를 못 낸다. 산출물 인코딩과
    # 무관한 표시 문제이므로 stdout만 UTF-8로 돌린다.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="쓰지 않고 최신 여부만 확인")
    args = parser.parse_args()

    boards = collect()
    if not boards:
        raise SystemExit(f"보드 템플릿이 하나도 없다 — {TEMPLATE_DIR}")
    files = render(boards, state_graph())
    stale = stale_outputs(files)

    if args.check:
        problems = [
            f"{path.relative_to(ROOT)} 가 원본과 어긋난다"
            for path, source in files.items()
            if (path.read_text(encoding="utf-8") if path.exists() else "") != source
        ]
        problems += [f"{path.relative_to(ROOT)} 는 색인에 없는 산출물이다" for path in stale]
        if problems:
            raise SystemExit("스크립트를 다시 돌려라 — " + " / ".join(problems))
        print(f"최신 — 보드 {len(boards)}장, 청크 {len(files) - 1}개")
        return

    for path in stale:
        path.unlink()
    # 리포는 작업트리까지 LF다(.gitattributes `* -text`). 윈도우 기본 개행 변환을
    # 끄지 않으면 커밋마다 산출물 전체가 CRLF로 뒤집힌다.
    for path, source in files.items():
        path.write_text(source, encoding="utf-8", newline="\n")
    print(f"{INDEX_JS.relative_to(ROOT)} — 보드 {len(boards)}장, {INDEX_JS.stat().st_size:,}B")
    for card_id in card_ids(boards):
        path = chunk_path(card_id)
        members = [board for board in boards if board["card_id"] == card_id]
        print(f"  {card_id}  보드 {len(members):>3}장  {path.stat().st_size:>10,}B")
    for path in stale:
        print(f"  (삭제) {path.name}")


if __name__ == "__main__":
    sys.exit(main())
