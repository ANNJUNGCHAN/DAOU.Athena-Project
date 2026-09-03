#!/usr/bin/env python3
"""보드 저작물(`slots.json`) 검사 — 원장·팩과 대조해 남은 문제를 센다.

검사 7종
  a 슬롯에 적힌 `mapping_id`/`f`(+`alt_mappings`)가 원장의 가시 필드에 있고 비노출이 아닌가
  b 값 슬롯 중 mapping을 아직 안 준 것(라벨과 `static: true` 고정 문구는 빼고 센다)
  c 병기 슬롯의 `paired_with`가 같은 셀·행의 값 슬롯을 가리키는가
  d `column_bindings`의 열마다 mapping이 있는가(`alt_mappings`·`indexed`도 mapping이다)
    — `kind: "static"` 열(행마다 다른 필드거나 아예 필드가 아닌 자리)은 남은 값 셀이
      전부 `static: true`거나 셀 단위로 바인딩됐으면 넘어간다
  e 팩(`<board>.pack.json`)이 이 보드 몫이라 적은 필드가 다 바인딩됐는가
  f 같은 `(mapping_id, f)`를 `display_dup` 없이 두 번 이상 그렸는가
    — 같은 표·같은 열의 행 반복은 중복이 아니다(헤더 KPI 재표시는 `display_dup`)
  g `collapse_group.rollup_slot`·`expanded_board`가 실재하는가

바인딩으로 세는 자리 셋
  슬롯·열의 `mapping_id`+`f`, 슬롯·열의 `alt_mappings[]`,
  열의 `indexed`를 본문 행 수만큼 편 필드(`f_pattern.format(i=start + r*step)`)

표준 라이브러리만 쓴다. 실행:
  python scripts/validate_board_slots.py [board ...] [--pack-dir DIR]

보드를 생략하면 `slots.json`이 있는 보드를 모두 본다.
종료코드는 문제가 하나라도 있으면 1이다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "backend" / "ref" / "card-surface-templates"
FIELD_LEDGER = ROOT / "PAPER_FIELD_COVERAGE.json"
HIDDEN_LEDGER = ROOT / "backend" / "ref" / "kiwoom-presentation-hidden-occurrences.json"
DEFAULT_PACK_DIR = Path(
    os.environ.get("ATHENA_PACK_DIR", str(ROOT / "backend" / "ref" / "card-surface-authoring" / "packs"))
)


def visible_fields() -> dict[tuple[str, str], str]:
    """원장이 "가시"라고 적은 `(mapping_id, f)` → 한국어 이름."""
    if not FIELD_LEDGER.exists():
        return {}
    rows = json.loads(FIELD_LEDGER.read_text(encoding="utf-8")).get("rows", [])
    return {
        (row["mapping_id"], row["f"]): row.get("kor") or row["f"]
        for row in rows
        if row.get("mapping_id") and row.get("f") and row.get("cls") != "비노출"
    }


def hidden_fields() -> set[tuple[str, str]]:
    """전송·내부 필드(`base:00|$.return_code|1` 꼴)를 `(mapping_id, 필드)`로 편다."""
    if not HIDDEN_LEDGER.exists():
        return set()
    data = json.loads(HIDDEN_LEDGER.read_text(encoding="utf-8"))
    out: set[tuple[str, str]] = set()
    for ids in (data.get("occurrence_ids") or {}).values():
        for occurrence in ids:
            parts = occurrence.split("|")
            if len(parts) < 2:
                continue
            field = parts[1]
            out.add((parts[0], field))
            if field.startswith("$."):
                out.add((parts[0], field[2:]))
    return out


def load_pack(pack_dir: Path, board_id: str) -> list[dict]:
    """팩이 이 보드 몫(`attributed_here`)이라 적은 필드."""
    path = pack_dir / f"{board_id}.pack.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [f for f in data.get("fields", []) if f.get("attributed_here")]


def cell_key(slot: dict) -> tuple | None:
    """같은 셀·행 판정에 쓰는 자리 — 표 셀이면 (표, 행), 아니면 부모 경로."""
    cell = slot.get("table")
    if cell:
        return ("table", cell["table"], cell["row"])
    path = slot.get("node_path")
    if path is None:
        return None
    return ("path", path.rsplit("/", 1)[0] if "/" in path else "")


def alt_pairs(holder: dict) -> list[tuple[str, str]]:
    """슬롯·열의 `alt_mappings`를 `(mapping_id, f)` 목록으로 편다."""
    out: list[tuple[str, str]] = []
    for alt in holder.get("alt_mappings") or []:
        if isinstance(alt, dict) and alt.get("mapping_id") and alt.get("f"):
            out.append((alt["mapping_id"], alt["f"]))
    return out


def indexed_field(indexed: dict, row: int) -> str:
    """인덱스 열의 본문 행 `row`(0부터)가 받을 필드 — 추출기 `indexed_field`와 같은 셈."""
    pattern = indexed.get("f_pattern")
    if not pattern:
        raise ValueError("indexed에 f_pattern이 없다")
    step = indexed.get("step", 1)
    direction = indexed.get("direction", "down")
    if direction not in ("down", "up"):
        raise ValueError(f"indexed.direction은 down·up만 된다: {direction!r}")
    if (direction == "down") != (step > 0):
        raise ValueError(f"indexed.direction={direction}과 step={step}의 부호가 어긋난다")
    return pattern.format(i=indexed.get("start", 1) + row * step)


def is_column_repeat(group_slots: list[dict]) -> bool:
    """같은 표·같은 열의 행 반복인가 — 그렇다면 중복 표기가 아니다."""
    places = set()
    for slot in group_slots:
        cell = slot.get("table")
        if not cell:
            return False
        places.add((cell["table"], cell["col"], cell["row"]))
    columns = {(table, col) for table, col, _ in places}
    return len(columns) == 1 and len(places) == len(group_slots)


def indexed_fields(column: dict, slots_by_id: dict[str, dict]) -> list[str]:
    """인덱스 열이 실제로 덮는 본문 행만큼 편 필드 이름.

    머리 행(`head`)과 합계·소계 행(`foot`)은 행 번호가 없어 인덱스가 닿지 않는다.
    """
    rows = set()
    for slot_id in column.get("slot_ids") or []:
        cell = (slots_by_id.get(slot_id) or {}).get("table") or {}
        row = cell.get("row")
        if row not in (None, "head", "foot"):
            rows.add(int(row))
    return [indexed_field(column["indexed"], row) for row in sorted(rows)]


def column_needs_mapping(column: dict, slots_by_id: dict[str, dict]) -> bool:
    """열 단위 mapping이 아직 필요한 자리인가.

    저작이 `kind: "static"`으로 "이 열은 한 필드가 아니다"라고 못박은 열만 넘어간다
    (추출기 `apply_columns`가 통째로 건너뛰는 바로 그 표식이다). 그 열이라도 아직
    바인딩이 필요한 값 셀 — `static: true`도 아니고 셀에 mapping·`alt_mappings`도 없는
    자리 — 이 하나라도 남으면 여전히 문제다. 값 슬롯을 세는 b와 같은 잣대다.
    """
    if column.get("kind") != "static":
        return True
    for slot_id in column.get("slot_ids") or []:
        slot = slots_by_id.get(slot_id) or {}
        if slot.get("kind") != "value" or slot.get("static"):
            continue
        if (slot.get("mapping_id") and slot.get("f")) or alt_pairs(slot):
            continue
        return True
    return False


def check_board(
    board_dir: Path, visible: dict[tuple[str, str], str], hidden: set[tuple[str, str]], pack_dir: Path
) -> dict:
    payload = json.loads((board_dir / "slots.json").read_text(encoding="utf-8"))
    slots = payload.get("slots", [])
    by_id = {slot.get("slot_id"): slot for slot in slots}
    board_id = payload.get("board_id") or board_dir.name

    bound: set[tuple[str, str]] = set()
    report = {
        "board_id": board_id,
        "slots": len(slots),
        "values": sum(1 for s in slots if s.get("kind") == "value"),
        "mapped": 0,
        "unknown": [],      # a
        "hidden": [],       # a
        "unmapped": 0,      # b
        "paired": [],       # c
        "columns": [],      # d
        "unbound": [],      # e
        "dup": [],          # f
        "dangling": [],     # g
    }

    def ledger_check(where: str, pairs: list[tuple[str, str]]) -> None:
        """원장 대조(a) — 바인딩으로 세는 자리는 모두 이 문을 지난다."""
        for pair in pairs:
            bound.add(pair)
            if pair in hidden:
                report["hidden"].append(f"{where} {pair[0]}|{pair[1]}")
            elif pair not in visible:
                report["unknown"].append(f"{where} {pair[0]}|{pair[1]}")

    for slot in slots:
        mapping_id, field = slot.get("mapping_id"), slot.get("f")
        alts = alt_pairs(slot)
        if mapping_id and field:
            report["mapped"] += 1
            ledger_check(slot["slot_id"], [(mapping_id, field)])
        elif not alts and slot.get("kind") == "value" and not slot.get("static"):
            report["unmapped"] += 1
        ledger_check(f"{slot['slot_id']} alt", alts)

        target_id = slot.get("paired_with")
        if target_id:
            target = by_id.get(target_id)
            if target is None:
                report["paired"].append(f"{slot['slot_id']}→{target_id} 없는 슬롯")
            elif target.get("kind") not in (None, "value"):
                report["paired"].append(f"{slot['slot_id']}→{target_id} 값 슬롯이 아니다")
            else:
                here, there = cell_key(slot), cell_key(target)
                if here is not None and there is not None and here != there:
                    report["paired"].append(f"{slot['slot_id']}→{target_id} 다른 셀·행")

        group = slot.get("collapse_group") or {}
        rollup = group.get("rollup_slot") if isinstance(group, dict) else None
        if rollup and rollup not in by_id:
            report["dangling"].append(f"{slot['slot_id']} rollup_slot={rollup}")
        for key in ("expanded_board",):
            board_ref = slot.get(key) or (group.get(key) if isinstance(group, dict) else None)
            if board_ref and not (TEMPLATE_ROOT / board_ref).is_dir():
                report["dangling"].append(f"{slot['slot_id']} {key}={board_ref}")

    for table in payload.get("column_bindings") or []:
        for column in table.get("columns") or []:
            where = f"{table.get('table_id')}·{column.get('header') or '열 ' + str(column.get('col'))}"
            mapping_id = column.get("mapping_id")
            alts = alt_pairs(column)
            ledger_check(f"{where} alt", alts)
            if mapping_id and column.get("indexed"):
                try:
                    fields = indexed_fields(column, by_id)
                except (ValueError, KeyError, IndexError) as exc:
                    report["columns"].append(f"{where} indexed 오류: {exc}")
                    continue
                ledger_check(where, [(mapping_id, f) for f in fields])
            elif mapping_id and column.get("f"):
                ledger_check(where, [(mapping_id, column["f"])])
            elif not alts and column_needs_mapping(column, by_id):
                report["columns"].append(where)

    # 같은 표·같은 열을 행마다 되풀이한 자리는 중복 표기가 아니다.
    seen: dict[tuple[str, str], list[dict]] = {}
    for slot in slots:
        key = (slot.get("mapping_id"), slot.get("f"))
        if key[0] and key[1]:
            seen.setdefault(key, []).append(slot)
    for (mapping_id, field), group_slots in sorted(seen.items()):
        if len(group_slots) < 2 or is_column_repeat(group_slots):
            continue
        marked = sum(1 for s in group_slots if s.get("display_dup"))
        if marked < len(group_slots) - 1:
            report["dup"].append(f"{mapping_id}|{field} ×{len(group_slots)}")

    for entry in load_pack(pack_dir, board_id):
        key = (entry.get("mapping_id"), entry.get("f"))
        if key not in bound:
            report["unbound"].append(
                f"{entry.get('kor') or '?'}·{entry.get('mapping_id')}·{entry.get('f')}"
            )

    report["tally"] = tally(report)
    report["problems"] = sum(report["tally"].values())
    return report


# 문제 갈래 → 보고서 열쇠. 표시 차례이기도 하다.
TALLY_KEYS = {
    "a": ("unknown", "hidden"),
    "b": ("unmapped",),
    "c": ("paired",),
    "d": ("columns",),
    "e": ("unbound",),
    "f": ("dup",),
    "g": ("dangling",),
}


def tally(report: dict) -> dict[str, int]:
    """보드 하나의 문제를 a/b/c/d/e/f/g로 센다."""
    out: dict[str, int] = {}
    for letter, keys in TALLY_KEYS.items():
        count = sum(
            report[key] if isinstance(report[key], int) else len(report[key]) for key in keys
        )
        if count:
            out[letter] = count
    return out


def tally_text(counts: dict[str, int]) -> str:
    """`b33 e11` 꼴 — 문제가 없으면 빈 문자열."""
    return " ".join(f"{letter}{count}" for letter, count in counts.items())


def print_report(report: dict) -> None:
    breakdown = tally_text(report["tally"])
    print(
        f"{report['board_id']}: 슬롯 {report['slots']} · 값 {report['values']} · "
        f"매핑 {report['mapped']} · 문제 {report['problems']}"
        + (f" ({breakdown})" if breakdown else "")
    )
    lines = [
        ("a 원장에 없는 필드", report["unknown"]),
        ("a 비노출 필드", report["hidden"]),
        ("c 병기 짝", report["paired"]),
        ("d mapping 없는 열", report["columns"]),
        ("f 중복 표기(display_dup 없음)", report["dup"]),
        ("g 없는 참조", report["dangling"]),
    ]
    for label, items in lines:
        if items:
            print(f"  {label} {len(items)}: " + ", ".join(items[:6]) + (" …" if len(items) > 6 else ""))
    if report["unmapped"]:
        print(f"  b mapping 미지정 값 슬롯 {report['unmapped']}")
    if report["unbound"]:
        print(f"  e 미바인딩 필드 {len(report['unbound'])}: " + ", ".join(report["unbound"]))


def board_dirs(selected: list[str]) -> list[Path]:
    if selected:
        dirs = [TEMPLATE_ROOT / name for name in selected]
        for path in dirs:
            if not (path / "slots.json").exists():
                raise SystemExit(f"slots.json이 없다: {path}")
        return dirs
    return sorted(p for p in TEMPLATE_ROOT.iterdir() if (p / "slots.json").exists())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="보드 저작물 검사")
    parser.add_argument("boards", nargs="*", help="검사할 보드 id(생략 시 전체)")
    parser.add_argument(
        "--pack-dir", type=Path, default=DEFAULT_PACK_DIR, help="`<board>.pack.json`이 있는 디렉터리"
    )
    args = parser.parse_args(argv)
    if not args.pack_dir.is_dir():
        raise SystemExit(f"팩 디렉터리가 없다: {args.pack_dir} (ATHENA_PACK_DIR 또는 --pack-dir)")

    visible = visible_fields()
    hidden = hidden_fields()
    total = 0
    totals: dict[str, int] = {letter: 0 for letter in TALLY_KEYS}
    boards_with_problems = 0
    for board_dir in board_dirs(args.boards):
        report = check_board(board_dir, visible, hidden, args.pack_dir)
        print_report(report)
        total += report["problems"]
        boards_with_problems += 1 if report["problems"] else 0
        for letter, count in report["tally"].items():
            totals[letter] += count
    breakdown = tally_text({k: v for k, v in totals.items() if v})
    print(f"합계 문제 {total}" + (f" ({breakdown}) · 문제 보드 {boards_with_problems}" if total else ""))
    return 1 if total else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
