"""카드 표면 템플릿 — occurrence 바인딩·저작 현황판 (계획 §5 P4).

정본은 **백엔드 로더**다. 이 스크립트는 바인딩을 스스로 판정하지 않고
``athena_api.card_surface_templates``에 위임한다 — 대체 바인딩(``alt_mappings``)·
지시 열(``indexed``)·되풀이 행 반복 면제를 로더만 알기 때문이다. 스크립트가 그 규칙을
다시 구현하면 같은 트리에서 두 숫자가 나온다(구판이 그랬다: 67.8% · 중복 1,156건).

판정 단위도 로더와 같은 **occurrence**(``wire_occurrence_id``)다. 원장의
``(mapping_id, f)`` 행은 같은 잎이 여러 자리에 걸리면 여러 번 세어져 모수가 어긋난다.

집계 ① occurrence 바인딩률(카드별·층별) ② 미도달 occurrence 전량(kor 병기)
     ③ 보드 없는 op ④ 제외 보드·사유 ⑤ 밀도 하드·소프트 ⑥ 중복 바인딩
     ⑦ 보드별 저작 상태

실행: PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py
      → 콘솔 요약 + CARD_SURFACE_COVERAGE.md 재생성

fail-closed: 슬롯이 occurrence로 **해석되지 않는** 바인딩(비노출 필드 바인딩 포함)만
종료 사유다. 밀도 초과·중복 바인딩·미도달은 저작이 남긴 진행 상태라 보고서로 낸다 —
그것으로 종료하면 현황판이 영원히 생성되지 않는다.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FIELD_LEDGER = ROOT / "PAPER_FIELD_COVERAGE.json"
OP_LEDGER = ROOT / "PAPER_CARD_COVERAGE.json"
TPL_DIR = BACKEND / "ref" / "card-surface-templates"
INDEX = TPL_DIR / "index.json"
OUT_MD = ROOT / "CARD_SURFACE_COVERAGE.md"

CARD_TITLES = {
    "CC-01": "계좌", "CC-02": "주문", "CC-03": "종목·상품",
    "CC-04": "호가", "CC-05": "수급", "CC-06": "탐색",
}
LAYERS = ("직접", "병기", "펼침", "미상")
_LAYER_RANK = {"직접": 0, "병기": 1, "펼침": 2}
# 원장이 증명 페이지에 귀속한 필드는 카드 보드 트리에 자리가 없다. 그 사실 자체는
# 경고가 아니고, **미도달 occurrence 중** 그 보드 귀속인 것만이 재귀속 대상이다.
PROOF_BOARDS = {"17F8-2"}
IGNORE_DIRS = ("fixture-", "_", ".")  # 테스트 픽스처·작업 디렉터리는 보드 모수 밖

# 로더가 내는 문제·경고 문자열의 갈래. 규칙 자체는 로더에 있고 여기서는 표를 나눌
# 뿐이다 — 새 갈래가 생기면 "그 밖의 보드 문제"로 떨어져 눈에 띈다.
_MARK_DENSITY_HARD = " exceeds budget "
_MARK_DENSITY_SOFT = " exceeds soft budget "
_MARK_DUP = " binds occurrence "
_MARK_RESTATE = " restates occurrence "
_MARK_UNRESOLVED = ("does not resolve to one occurrence", "binds non-visible occurrence")


def _import_loader():
    """backend를 sys.path에 올리고 로더 모듈을 돌려준다."""
    path = str(BACKEND)
    if path not in sys.path:
        sys.path.insert(0, path)
    from athena_api import card_surface_templates as loader

    return loader


def _kw(kwargs: dict) -> str:
    return ", ".join(f"{k}={v}" for k, v in kwargs.items())


def _load_registry(loader):
    """``load_registry(strict=False, isolate=True)``를 먼저 쓴다.

    그 인자가 아직 없으면 ``validate``를 우회해 같은 트리를 읽는다 — 밀도 초과·중복
    바인딩이 남아 있는 저작 중간 상태에서도 현황판은 나와야 하기 때문이다. 우회해도
    판정은 여전히 로더 것이다: 검증은 :meth:`validation_problems`로 따로 부른다.
    """
    for kwargs in ({"strict": False, "isolate": True}, {"strict": False}):
        try:
            return loader.load_registry(TPL_DIR, **kwargs), f"load_registry({_kw(kwargs)})"
        except TypeError:
            continue
    original = loader.CardSurfaceRegistry.validate
    loader.CardSurfaceRegistry.validate = lambda self, *a, **k: None
    try:
        return loader.load_registry(TPL_DIR), "load_registry() + validate 우회"
    finally:
        loader.CardSurfaceRegistry.validate = original


def _coverage(registry, universe) -> tuple[frozenset[str], list[str], str]:
    """(도달한 가시 occurrence, 보드 없는 op, 출처). ``registry.coverage()`` 우선."""
    method = getattr(registry, "coverage", None)
    result = None
    if callable(method):
        try:
            result = method(universe=universe)
        except TypeError:
            result = method()
    if isinstance(result, dict) and "uncovered_occurrences" in result:
        return (
            frozenset(universe.visible_occurrence_ids) - frozenset(result["uncovered_occurrences"]),
            list(result.get(
                "operations_without_board",
                sorted(universe.operation_refs - set(registry.by_operation)),
            )),
            "registry.coverage()",
        )
    covered = {
        occurrence_id
        for board in registry.boards.values()
        for slot in board.binding_slots
        for occurrence_id in slot.occurrence_ids
        if occurrence_id in universe.visible_occurrence_ids
    }
    return (
        frozenset(covered),
        sorted(universe.operation_refs - set(registry.by_operation)),
        "슬롯 occurrence_ids 집계",
    )


def _problems_by_board(registry, universe) -> dict[str, list[str]]:
    """board_id → 그 보드 혼자 어긴 규칙. 로더가 물어볼 창구를 주면 그것을 쓴다."""
    method = getattr(registry, "problems_by_board", None)
    if callable(method):
        try:
            return dict(method(universe=universe))
        except TypeError:
            return dict(method())
    found: dict[str, list[str]] = defaultdict(list)
    for problem in registry.validation_problems(False, universe=universe):
        board_id = _board_of(problem)
        if board_id:
            found[board_id].append(problem)
    return dict(found)


def _board_of(problem: str) -> str | None:
    """로더 문제 문자열의 ``board '<id>'`` 접두에서 보드를 뽑는다."""
    prefix = "board '"
    if not problem.startswith(prefix):
        return None
    rest = problem[len(prefix):]
    end = rest.find("'")
    return rest[:end] if end > 0 else None


def _read_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def collect() -> dict:
    """현황판 상태. 바인딩·밀도·중복 판정은 전부 백엔드 로더가 한다."""
    loader = _import_loader()
    # 로더는 소프트 예산 초과를 로거로 흘린다. 그건 아래에서 표로 내므로 로드 동안만
    # 죽이고 곧바로 되돌린다 — 대시보드 프로세스의 다른 로그까지 지우면 안 된다.
    previous = logging.root.manager.disable
    logging.disable(logging.WARNING)
    try:
        registry, load_path = _load_registry(loader)
    finally:
        logging.disable(previous)
    universe = loader.default_universe()
    visible = universe.visible_occurrence_ids

    from athena_api.semantic_presentation_registry import (
        get_semantic_presentation_registry,
    )

    contract_of: dict[str, object] = {}
    for contract in get_semantic_presentation_registry().contracts:
        contract_of.setdefault(contract.wire_occurrence_id, contract)

    covered, ops_no_board, coverage_source = _coverage(registry, universe)
    missing_ids = sorted(visible - covered)

    # --- 원장 — 카드 귀속(op 원장)·층·한글(필드 원장) --------------------
    op_ledger = _read_json(OP_LEDGER) or {"statuses": {}}
    card_of_op = {op: e.get("card", "—") for op, e in op_ledger["statuses"].items()}
    field_ledger = _read_json(FIELD_LEDGER) or {"rows": [], "updated": ""}
    ledger_rows: dict[tuple, list[dict]] = defaultdict(list)
    for row in field_ledger["rows"]:
        if row["cls"] != "비노출":
            ledger_rows[(row["mapping_id"], row["f"])].append(row)

    def _card(occurrence_id: str) -> str:
        return card_of_op.get(occurrence_id.split("|", 1)[0], "—")

    def _rows_for(occurrence_id: str) -> list[dict]:
        contract = contract_of.get(occurrence_id)
        if contract is None:
            return []
        return ledger_rows.get((contract.mapping_id, contract.alias), [])

    # --- 층 — 도달한 것은 슬롯이 선언한 층, 아니면 원장 층 ---------------
    slot_layer: dict[str, str] = {}
    for board in registry.boards.values():
        for slot in board.binding_slots:
            candidate = slot.layer or "미상"
            rank = _LAYER_RANK.get(candidate, 9)
            for occurrence_id in slot.occurrence_ids:
                current = slot_layer.get(occurrence_id)
                if current is None or rank < _LAYER_RANK.get(current, 9):
                    slot_layer[occurrence_id] = candidate

    def _layer(occurrence_id: str) -> tuple[str, bool]:
        """(층, 슬롯이 직접 선언했는가)."""
        if occurrence_id in slot_layer:
            return slot_layer[occurrence_id], True
        for row in _rows_for(occurrence_id):
            if row.get("layer"):
                return row["layer"], False
        return "미상", False

    by_card_total: Counter = Counter()
    by_card_bound: Counter = Counter()
    by_layer_total: Counter = Counter()
    by_layer_bound: Counter = Counter()
    by_layer_declared: Counter = Counter()
    for occurrence_id in visible:
        card = _card(occurrence_id)
        layer, declared = _layer(occurrence_id)
        by_card_total[card] += 1
        by_layer_total[layer] += 1
        if declared:
            by_layer_declared[layer] += 1
        if occurrence_id in covered:
            by_card_bound[card] += 1
            by_layer_bound[layer] += 1

    # --- ② 미도달 occurrence 전량 (kor 병기) ----------------------------
    missing: list[dict] = []
    reattach: Counter = Counter()
    reattach_occurrences = 0
    for occurrence_id in missing_ids:
        contract = contract_of.get(occurrence_id)
        rows = _rows_for(occurrence_id)
        boards_of_row = sorted({r["board"] for r in rows})
        kor = (contract.label_ko if contract else None) or next(
            (r["kor"] for r in rows if r.get("kor")), ""
        )
        off_tree = [b for b in boards_of_row if b not in registry.boards]
        for board_id in off_tree:
            reattach[board_id] += 1
        if off_tree:
            reattach_occurrences += 1
        missing.append({
            "occurrence": occurrence_id,
            "op": occurrence_id.split("|", 1)[0],
            "f": contract.alias if contract else "—",
            "kor": kor,
            "card": _card(occurrence_id),
            "layer": _layer(occurrence_id)[0],
            "ledger_boards": boards_of_row,
        })

    # --- ③ 보드 없는 op --------------------------------------------------
    occ_per_op: Counter = Counter(o.split("|", 1)[0] for o in visible)
    ops_without_board = [
        {"op": op, "card": card_of_op.get(op, "—"), "occurrences": occ_per_op[op]}
        for op in ops_no_board
    ]

    # --- ④ 제외 보드·사유 ------------------------------------------------
    on_disk = {p.name for p in TPL_DIR.iterdir() if p.is_dir()} if TPL_DIR.exists() else set()
    index_entries = (_read_json(INDEX) or {}).get("boards", [])
    index_ids = {b["board_id"] if isinstance(b, dict) else b for b in index_entries}
    excluded: list[dict] = []
    for dropped in getattr(registry, "excluded_boards", ()):
        excluded.append({
            "board": dropped.board_id,
            "reason": "격리 로드가 뺀 보드 — " + " · ".join(dropped.reasons),
            "ledger_fields": 0,
        })
    dropped_ids = {e["board"] for e in excluded}
    for name in sorted(on_disk - set(registry.boards) - dropped_ids):
        if name.startswith(IGNORE_DIRS):
            reason = "테스트 픽스처·작업 디렉터리 — index.json 밖"
        elif name in index_ids:
            reason = "색인에 있으나 slots.json 없음 — 로더가 건너뜀"
        else:
            reason = "디렉터리는 있으나 index.json에 없음"
        excluded.append({"board": name, "reason": reason, "ledger_fields": 0})
    ledger_only: Counter = Counter()
    for rows in ledger_rows.values():
        for row in rows:
            if row["board"] not in registry.boards and row["board"] not in on_disk:
                ledger_only[row["board"]] += 1
    for board_id, n in sorted(ledger_only.items(), key=lambda kv: (-kv[1], kv[0])):
        excluded.append({
            "board": board_id,
            "reason": ("증명 페이지 — 카드 보드가 아니라 트리 밖"
                       if board_id in PROOF_BOARDS else "원장만 아는 보드 — 트리에 없음"),
            "ledger_fields": n,
        })

    # --- ⑤⑥ 밀도·중복·그 밖 — 갈래만 나누고 판정은 로더 것 --------------
    problems_by_board = _problems_by_board(registry, universe)
    density_hard: list[dict] = []
    dups: list[dict] = []
    other_problems: list[dict] = []
    unresolved: list[str] = []
    for board_id in sorted(problems_by_board):
        for problem in problems_by_board[board_id]:
            item = {"board": board_id, "text": problem}
            if _MARK_DENSITY_SOFT in problem:
                continue  # 소프트는 경고 쪽에서 나온다
            if _MARK_DENSITY_HARD in problem or "height_px" in problem:
                density_hard.append(item)
            elif _MARK_DUP in problem:
                dups.append(item)
            else:
                other_problems.append(item)
                if any(mark in problem for mark in _MARK_UNRESOLVED):
                    unresolved.append(problem)

    density_soft: list[dict] = []
    restatements = 0
    for warning in registry.validation_warnings(universe=universe):
        if _MARK_DENSITY_SOFT in warning:
            density_soft.append({"board": _board_of(warning), "text": warning})
        elif _MARK_RESTATE in warning:
            restatements += 1

    # --- ⑦ 보드별 저작 상태 ----------------------------------------------
    boards = []
    for board_id in sorted(registry.boards):
        board = registry.boards[board_id]
        bdir = TPL_DIR / board_id
        reached = {
            occurrence_id
            for slot in board.binding_slots
            for occurrence_id in slot.occurrence_ids
            if occurrence_id in visible
        }
        boards.append({
            "board": board_id,
            "card": board.card_id,
            "state": board.state.kind,
            "saved": (bdir / "paper.jsx").exists() or (bdir / "paper.tree.txt").exists(),
            "extracted": (bdir / "board.html").exists(),
            "slots": len(board.binding_slots),
            "occurrences": len(reached),
            "problems": len(problems_by_board.get(board_id, ())),
            "clean": not problems_by_board.get(board_id),
        })

    n_visible, n_bound = len(visible), len(covered)
    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M+09:00"),
        "ledger_updated": field_ledger.get("updated", ""),
        "loader": {
            "path": load_path,
            "coverage_source": coverage_source,
            "root": str(TPL_DIR.relative_to(ROOT)).replace("\\", "/"),
            "complete": bool(registry.complete),
            "loaded": len(registry.boards),
            "indexed": len(index_ids),
            "on_disk": len(on_disk),
        },
        "occ": {
            "visible": n_visible, "bound": n_bound, "gap": n_visible - n_bound,
            "pct": (n_bound / n_visible * 100) if n_visible else 0.0,
            "by_card": [
                {"card": c, "title": CARD_TITLES[c], "n": by_card_total[c],
                 "bound": by_card_bound[c],
                 "pct": (by_card_bound[c] / by_card_total[c] * 100) if by_card_total[c] else 0.0}
                for c in sorted(CARD_TITLES)
            ],
            "by_layer": [
                {"layer": l, "n": by_layer_total[l], "bound": by_layer_bound[l],
                 "declared": by_layer_declared[l],
                 "pct": (by_layer_bound[l] / by_layer_total[l] * 100) if by_layer_total[l] else 0.0}
                for l in LAYERS
            ],
        },
        "ops": {
            "total": len(universe.operation_refs),
            "with_board": len(registry.by_operation),
            "without_board": ops_without_board,
        },
        "boards": {
            "total": len(registry.boards), "indexed": len(index_ids), "on_disk": len(on_disk),
            "saved": sum(1 for b in boards if b["saved"]),
            "extracted": sum(1 for b in boards if b["extracted"]),
            "clean": sum(1 for b in boards if b["clean"]),
            "rows": boards,
        },
        "missing": missing,
        # 미도달 occurrence 중 원장 귀속이 트리 밖 보드인 것. 트리 밖 보드에 귀속된
        # 원장 행 전부가 아니다 — 도달한 자리는 재귀속할 이유가 없다.
        "reattach": {
            "total": reattach_occurrences,
            "by_board": dict(sorted(reattach.items())),
        },
        "excluded": excluded,
        "density": density_hard,
        "density_soft": density_soft,
        "restatements": restatements,
        "dups": dups,
        "other_problems": other_problems,
        "errors": unresolved,
    }


def _cell(text: str) -> str:
    """표 셀 안의 `|`(occurrence 구분자)가 열을 쪼개지 않게 이스케이프."""
    return str(text).replace("|", "\\|")


def _bar(pct: float, width: int = 24) -> str:
    fill = round(pct / 100 * width)
    return "█" * fill + "·" * (width - fill)


def render_md(s: dict) -> str:
    o, b, ld = s["occ"], s["boards"], s["loader"]
    step = iter(range(1, 99))
    L = [
        "# 카드 표면 템플릿 — occurrence 바인딩·저작 현황",
        "",
        (f"생성: {s['generated']} · 템플릿 `{ld['root']}` · "
        f"재생성 `PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py`"),
        "",
        ("바인딩 판정은 이 스크립트가 하지 않는다 — `athena_api.card_surface_templates` "
        "로더에 위임한다. 대체 바인딩(`alt_mappings`)·지시 열(`indexed`)·되풀이 행 반복 "
        "면제를 로더만 알기 때문이다. 판정 단위도 로더와 같은 **occurrence**"
        "(`wire_occurrence_id`)이고, 원장의 `(mapping_id, f)` 행이 아니다."),
        "",
        (f"로드 경로 `{ld['path']}` · 도달 집합 `{ld['coverage_source']}` · "
        f"보드 {ld['loaded']}장 로드(색인 {ld['indexed']} · 디렉터리 {ld['on_disk']}) · "
        f"`complete` {'선언됨' if ld['complete'] else '미선언(부분 로드)'}"),
        "",
        (f"## 총괄 — occurrence 도달 **{o['bound']:,}/{o['visible']:,} ({o['pct']:.1f}%)** · "
        f"op 커버 **{s['ops']['with_board']}/{s['ops']['total']}**"),
        "",
        "| 항목 | 값 | 판정 근거 |",
        "| --- | ---: | --- |",
        (f"| 가시 occurrence 도달 | {o['bound']:,}/{o['visible']:,} | "
        f"로더 `coverage()` (대체 바인딩 포함) |"),
        f"| 미도달 occurrence | {o['gap']:,} | 어느 보드도 그리지 않는 자리 |",
        f"| 보드 없는 op | {len(s['ops']['without_board'])} | `by_operation`에 없는 op |",
        f"| 밀도 하드 위반 | {len(s['density'])} | 로더 `DENSITY_BUDGET`·`HEIGHT_BUDGET_PX` |",
        f"| 밀도 소프트 경고 | {len(s['density_soft'])} | 로더 `SOFT_DENSITY_BUDGET` |",
        f"| 중복 바인딩 | {len(s['dups'])} | 로더 `_duplicate_is_declared` 미면제분 |",
        f"| 그 밖의 보드 문제 | {len(s['other_problems'])} | 해시·상태 참조·지시 열 패턴 |",
        f"| 재표시 경고 | {s['restatements']} | 주값 없는 재표시 무리(로드는 통과) |",
        f"| 문제 없는 보드 | {b['clean']}/{b['total']} | 보드 지역 규칙 전부 통과 |",
        f"| 제외 보드 | {len(s['excluded'])} | 디렉터리·색인·원장 대조 |",
        "",
        f"## {next(step)}. occurrence 도달 — 카드별",
        "",
        "| 카드 | 가시 occurrence | 도달 | 도달률 |",
        "| --- | ---: | ---: | ---: |",
    ]
    for c in o["by_card"]:
        L.append(f"| {c['card']} {c['title']} | {c['n']:,} | {c['bound']:,} | {c['pct']:.1f}% |")
    L.append(f"| **합계** | **{o['visible']:,}** | **{o['bound']:,}** | **{o['pct']:.1f}%** |")

    L += ["", f"## {next(step)}. occurrence 도달 — 층별", "",
          ("층은 그것을 그리는 슬롯이 선언한 값이다(`슬롯 판정 층`). 미도달이라 슬롯이 "
          "없으면 원장 `layer`, 그것도 없으면 미상."), "",
          "| 층 | 가시 occurrence | 도달 | 도달률 | 슬롯 판정 층 |",
          "| --- | ---: | ---: | ---: | ---: |"]
    for l in o["by_layer"]:
        L.append(f"| {l['layer']} | {l['n']:,} | {l['bound']:,} | {l['pct']:.1f}% | "
                 f"{l['declared']:,} |")

    L += ["", f"## {next(step)}. 미도달 occurrence ({o['gap']:,})", "",
          ("어느 보드에도 자리가 없는 가시 occurrence 전량이다. 로더 strict 검증이 "
          "`visible occurrences reach no board`로 막는 바로 그 집합."), ""]
    if s["reattach"]["total"]:
        by_board = " · ".join(f"`{k}` {v:,}" for k, v in s["reattach"]["by_board"].items())
        L += [(f"이 중 **{s['reattach']['total']:,}건**은 원장이 트리 밖 보드({by_board})에만 "
              "귀속한 자리다 — 원장의 `board`를 카드 보드로 재귀속해야 슬롯이 생긴다. "
              "트리 밖 보드에 귀속된 원장 행 전부가 아니라 **미도달인 것만** 센다."), ""]
    if s["missing"]:
        L += ["| occurrence | op | f | 한글 | 카드 | 층 | 원장 귀속 보드 |",
              "| --- | --- | --- | --- | --- | --- | --- |"]
        for m in s["missing"]:
            led = " · ".join(f"`{x}`" for x in m["ledger_boards"]) or "—"
            L.append(
                f"| `{_cell(m['occurrence'])}` | `{m['op']}` | `{_cell(m['f'])}` | "
                f"{m['kor'] or '—'} | {m['card']} | {m['layer']} | {led} |"
            )
    else:
        L.append("없음 — 가시 occurrence 전부가 어느 보드엔가 도달한다.")

    L += ["", f"## {next(step)}. 보드 없는 op ({len(s['ops']['without_board'])})", "",
          (f"op {s['ops']['total']}종 중 어느 보드도 `operation_refs`에 적지 않은 것. "
          "로더 strict가 `operations have no board`로 막는다."), ""]
    if s["ops"]["without_board"]:
        L += ["| op | 카드 | 가시 occurrence |", "| --- | --- | ---: |"]
        for x in s["ops"]["without_board"]:
            L.append(f"| `{x['op']}` | {x['card']} | {x['occurrences']:,} |")
    else:
        L.append("없음 — 모든 op에 보드가 있다.")

    L += ["", f"## {next(step)}. 제외 보드·사유 ({len(s['excluded'])})", "",
          "보드 모수는 로더가 실제로 세운 보드다. 아래는 그 밖으로 밀린 자리와 사유.", ""]
    if s["excluded"]:
        L += ["| 보드 | 사유 | 원장 가시 행 |", "| --- | --- | ---: |"]
        for e in s["excluded"]:
            fields = f"{e['ledger_fields']:,}" if e["ledger_fields"] else "—"
            L.append(f"| `{e['board']}` | {_cell(e['reason'])} | {fields} |")
    else:
        L.append("없음.")

    L += ["", f"## {next(step)}. 밀도 예산 — 하드 위반 ({len(s['density'])})", "",
          "로더 `DENSITY_BUDGET` + `HEIGHT_BUDGET_PX`. 위반은 strict 로드를 막는다.", ""]
    if s["density"]:
        L += ["| 보드 | 위반 |", "| --- | --- |"]
        for d in s["density"]:
            L.append(f"| `{d['board']}` | {_cell(d['text'])} |")
    else:
        L.append("없음.")

    L += ["", f"## {next(step)}. 밀도 예산 — 소프트 경고 ({len(s['density_soft'])})", "",
          "로더 `SOFT_DENSITY_BUDGET`. 넘어도 로드는 통과한다.", ""]
    if s["density_soft"]:
        L += ["| 보드 | 경고 |", "| --- | --- |"]
        for d in s["density_soft"]:
            L.append(f"| `{d['board']}` | {_cell(d['text'])} |")
    else:
        L.append("없음.")

    L += ["", f"## {next(step)}. 중복 바인딩 ({len(s['dups'])})", "",
          ("한 보드가 같은 occurrence를 여러 자리에 넣은 것 중 **로더가 면제하지 않은** "
          "것만이다. 행 반복(표 한 열·되풀이 블록)·D4 병기(`paired_with`)·선언된 "
          "재표시(`display_dup`)는 면제라 여기 없다."), ""]
    if s["dups"]:
        L += ["| 보드 | 위반 |", "| --- | --- |"]
        for d in s["dups"]:
            L.append(f"| `{d['board']}` | {_cell(d['text'])} |")
    else:
        L.append("없음.")

    L += ["", f"## {next(step)}. 그 밖의 보드 문제 ({len(s['other_problems'])})", "",
          "해시 대조 · 상태 참조 · 지시 열 패턴 등 로더의 보드 지역 규칙.", ""]
    if s["other_problems"]:
        L += ["| 보드 | 문제 |", "| --- | --- |"]
        for p in s["other_problems"]:
            L.append(f"| `{p['board']}` | {_cell(p['text'])} |")
    else:
        L.append("없음.")

    L += ["", f"## {next(step)}. 보드별 저작 상태 ({b['total']}장)", "",
          "| 보드 | 카드 | 상태 | 원문 | 추출 | 바인딩 슬롯 | 도달 occurrence | 문제 |",
          "| --- | --- | --- | :-: | :-: | ---: | ---: | ---: |"]
    mark = {True: "●", False: "○"}
    for r in b["rows"]:
        L.append(
            f"| `{r['board']}` | {r['card']} | {r['state']} | {mark[r['saved']]} | "
            f"{mark[r['extracted']]} | {r['slots']:,} | {r['occurrences']:,} | "
            f"{r['problems']} |"
        )
    return "\n".join(L) + "\n"


def main() -> None:
    s = collect()
    if s["errors"]:
        for e in s["errors"][:20]:
            print("오류:", e)
        raise SystemExit(
            f"fail-closed: occurrence로 해석되지 않는 바인딩 {len(s['errors'])}건 — "
            f"{OUT_MD.name} 미생성"
        )

    OUT_MD.write_text(render_md(s), encoding="utf-8")
    o, b, ld = s["occ"], s["boards"], s["loader"]
    print(f"로더 위임 — {ld['path']} · 도달 집합 {ld['coverage_source']}")
    print(f"보드 {ld['loaded']}장 로드 (색인 {ld['indexed']} · 디렉터리 {ld['on_disk']} · "
          f"문제 없음 {b['clean']})")
    print(f"occurrence 도달 {o['bound']:,}/{o['visible']:,} ({o['pct']:.1f}%)  {_bar(o['pct'])}")
    for c in o["by_card"]:
        print(f"  {c['card']} {c['title']}: {c['bound']:,}/{c['n']:,} ({c['pct']:.0f}%)")
    print("  층별 " + " · ".join(
        f"{l['layer']} {l['bound']:,}/{l['n']:,}(슬롯 판정 {l['declared']:,})"
        for l in o["by_layer"]))
    print(f"미도달 occurrence {o['gap']:,} · 보드 없는 op {len(s['ops']['without_board'])} · "
          f"밀도 하드 {len(s['density'])} · 소프트 {len(s['density_soft'])} · "
          f"중복 바인딩 {len(s['dups'])} · 그 밖의 보드 문제 {len(s['other_problems'])} · "
          f"재표시 경고 {s['restatements']}")
    if s["reattach"]["total"]:
        by_board = " · ".join(f"{k} {v:,}" for k, v in s["reattach"]["by_board"].items())
        print(f"경고: 미도달 {o['gap']:,}건 중 {s['reattach']['total']:,}건은 원장 귀속이 "
              f"트리 밖 보드({by_board}) → 카드 보드 재귀속 필요")
    for e in s["excluded"]:
        print(f"제외: {e['board']} — {e['reason']}"
              + (f" (원장 가시 행 {e['ledger_fields']:,})" if e["ledger_fields"] else ""))
    print(f"→ {OUT_MD.name} 갱신")


if __name__ == "__main__":
    main()
