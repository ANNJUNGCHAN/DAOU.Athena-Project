#!/usr/bin/env python3
"""승인된 카드미니 대장을 96개 카드 표면 계약에 투영한다.

``backend/ref/kiumi/kiumi-ledger.jsonl``이 단일 정본이다. 이 스크립트는 대장의
카드 선택을 다시 추론하지 않는다. 따라서 원본 ``slots.json``이 바뀌어도 승인된
표시 슬롯과 문법은 자동으로 변하지 않으며, 사라진 슬롯은 검사에서 실패한다.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "backend" / "ref" / "card-surface-templates"
LEDGER_PATH = ROOT / "backend" / "ref" / "kiumi" / "kiumi-ledger.jsonl"
GRAMMARS = {
    "table",
    "chart",
    "facts",
    "compound",
    "order_ticket",
    "order_confirm",
    "event",
    "auth",
    "reader",
    "stream",
}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_ledger_records() -> list[dict[str, Any]]:
    if not LEDGER_PATH.is_file():
        raise ValueError(f"missing canonical ledger: {LEDGER_PATH.relative_to(ROOT)}")
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_number, line in enumerate(
        LEDGER_PATH.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        record = json.loads(line)
        if not isinstance(record, dict):
            raise TypeError(f"ledger line {line_number} must be an object")
        board_id = record.get("board_id")
        if not isinstance(board_id, str) or not board_id:
            raise ValueError(f"ledger line {line_number} needs board_id")
        if board_id in seen:
            raise ValueError(f"ledger repeats board_id {board_id!r}")
        seen.add(board_id)
        records.append(record)
    return records


def validate_ledger(records: list[dict[str, Any]]) -> None:
    index = load_json(TEMPLATE_ROOT / "index.json")
    expected_ids = [board["board_id"] for board in index["boards"]]
    actual_ids = [record["board_id"] for record in records]
    if len(records) != 96 or set(actual_ids) != set(expected_ids):
        missing = sorted(set(expected_ids) - set(actual_ids))
        extra = sorted(set(actual_ids) - set(expected_ids))
        raise ValueError(
            f"ledger must cover the indexed 96 boards; missing={missing}, extra={extra}"
        )

    for record in records:
        board_id = record["board_id"]
        if record.get("version") != 1:
            raise ValueError(f"{board_id}: version must be 1")
        if record.get("width_px") != 360 or record.get("height_px") != 420:
            raise ValueError(f"{board_id}: size must be exactly 360x420")
        if record.get("grammar") not in GRAMMARS:
            raise ValueError(f"{board_id}: unknown grammar {record.get('grammar')!r}")
        if record.get("fixed") is not True:
            raise ValueError(f"{board_id}: fixed must be true")
        elements = record.get("elements")
        if not isinstance(elements, list) or not elements:
            raise ValueError(f"{board_id}: elements must be a non-empty list")

        slots = load_json(TEMPLATE_ROOT / board_id / "slots.json")
        available = {
            slot.get("slot_id")
            for slot in slots.get("slots", [])
            if isinstance(slot, dict)
        }
        selected = [element.get("source_slot_id") for element in elements]
        if any(not isinstance(slot_id, str) or slot_id not in available for slot_id in selected):
            invalid = [slot_id for slot_id in selected if slot_id not in available]
            raise ValueError(f"{board_id}: unknown source slots {invalid}")
        if len(selected) != len(set(selected)):
            raise ValueError(f"{board_id}: repeated source_slot_id")


def ledger_text(records: list[dict[str, Any]]) -> str:
    return "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    )


def write_text(path: Path, text: str, *, crlf: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if crlf:
        text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


def write_registry(records: list[dict[str, Any]]) -> None:
    for record in records:
        board_id = record["board_id"]
        path = TEMPLATE_ROOT / board_id / "slots.json"
        payload = load_json(path)
        payload["kiumi"] = {
            key: value for key, value in record.items() if key != "board_id"
        }
        write_text(
            path,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            crlf=True,
        )


def check_registry(records: list[dict[str, Any]]) -> list[str]:
    problems: list[str] = []
    actual_ledger = LEDGER_PATH.read_text(encoding="utf-8")
    if actual_ledger != ledger_text(records):
        problems.append(str(LEDGER_PATH.relative_to(ROOT)))
    for record in records:
        board_id = record["board_id"]
        payload = load_json(TEMPLATE_ROOT / board_id / "slots.json")
        expected = {key: value for key, value in record.items() if key != "board_id"}
        if payload.get("kiumi") != expected:
            problems.append(f"backend/ref/card-surface-templates/{board_id}/slots.json")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()

    records = load_ledger_records()
    validate_ledger(records)
    if args.write:
        write_registry(records)
    problems = check_registry(records)
    distribution = Counter(record["grammar"] for record in records)
    print(
        json.dumps(
            {
                "boards": len(records),
                "distribution": dict(sorted(distribution.items())),
                "problems": problems,
            },
            ensure_ascii=False,
        )
    )
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
