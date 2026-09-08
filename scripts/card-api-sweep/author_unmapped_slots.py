"""바인딩도 `static`도 없던 값 자리에 저작 표시를 넣는다 (2026-09-09).

전수 검사에서 마지막까지 결측어로 남은 자리다. 응답이 채우는 자리가 아니므로
`static: true`로 못박고, 화면에서 어떻게 다룰지를 `static_mode`로 명시한다.

  "bind"   응답에 그 필드가 있다 — 결측어가 아니라 바인딩할 자리다(:data:`BINDINGS`).
           검사기 `validate_board_slots.py`가 그 보드의 미바인딩 필드로 지목해 준다.
  "text"   문면 자체가 화면 문구다 — Paper 원문을 그대로 쓴다.
           (`정규장`·`실시간`·`정상 거래`·`● 실시간 갱신 중` 같은 상태 칩·안내줄)
  "blank"  응답에 그 값이 없다 — 빈 칸으로 둔다. Paper 문면은 목업 숫자라 그대로
           두면 없는 값을 지어내고, 결측어를 찍으면 「제공되지 않는다」는 거짓말이
           된다(그 화면에는 원래 그 값이 없다).

`blank`로 정한 자리는 전부 근거를 확인했다 — 그 보드의 op가 그 필드를 싣지 않거나
(예: ka30002에 현재가 없음, 0B에 체결구분 없음), 여러 값을 합친 문장·파생값·차트
목업이라 대응 필드가 아예 없다. 어느 필드인지 저작이 정하지 못한 자리도 `blank`다 —
틀린 값을 그리는 것보다 빈 칸이 낫다.

실행: python scripts/card-api-sweep/author_unmapped_slots.py [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / "backend" / "ref" / "card-surface-templates"

# 바인딩할 자리: (board_id, slot_id) → (mapping_id, f, format.unit)
BINDINGS: dict[tuple[str, str], tuple[str, str, str]] = {
    ("137X-2", "s057"): ("base:ka10086", "for_qty", "shares"),
}

# board_id → slot_id → (mode, note). mode는 "text" · "blank" · "bind".
DECISIONS: dict[str, dict[str, tuple[str, str]]] = {
    "137X-2": {
        "s003": ("text", "장 세션 칩 — 화면 문구. 세션을 싣는 op(0B 장구분)는 실시간이라 이 칩의 출처가 아니다"),
        "s004": ("text", "갱신 방식 칩 — 화면 문구"),
        "s043": ("blank", "회전율 일·주·월 세 구간을 한 문장에 합친 파생 표기 — 대응 필드가 없다"),
        "s044": ("blank", "차트 y축 눈금 목업 — 축은 차트 렌더러가 그린다"),
        "s045": ("blank", "차트 y축 눈금 목업 — 축은 차트 렌더러가 그린다"),
        "s046": ("blank", "차트 y축 눈금 목업 — 축은 차트 렌더러가 그린다"),
        "s047": ("blank", "차트 y축 눈금 목업 — 축은 차트 렌더러가 그린다"),
        "s048": ("blank", "차트 y축 0 눈금 목업 — 축은 차트 렌더러가 그린다"),
        "s050": ("blank", "차트 툴팁 목업 — 툴팁은 차트 렌더러가 그린다"),
        "s052": ("text", "거래 상태 칩 — 화면 문구"),
        # 검사기(validate_board_slots)가 이 보드의 미바인딩 필드로 `외인수량·
        # base:ka10086·for_qty`를 지목한다 — 빈 칸이 아니라 바인딩할 자리다.
        "s057": ("bind", "외인수량 — 일별주가(ka10086) 응답의 for_qty. 되풀이 밖에 한 번 그려진 잎이라 최근 일자(첫 원소)를 쓴다"),
        "s136": ("text", "차트 갱신 안내줄 — 화면 문구"),
        "s137": ("blank", "봉 종류·틱 수·마지막 체결 시각을 합친 목업 문장 — 대응 필드가 없다"),
    },
    "2R3M-1": {
        "s003": ("text", "장 세션 칩 — 화면 문구"),
        "s004": ("text", "갱신 방식 칩 — 화면 문구"),
        "s017": ("blank", "시가·고가·저가 시각 셋을 한 문장에 합친 목업 — 대응 필드가 없다"),
        "s023": ("blank", "업종 평균 PER 비교값 — 이 보드의 op 응답에 없다"),
        "s026": ("blank", "업종 평균 PBR 비교값 — 이 보드의 op 응답에 없다"),
        "s029": ("blank", "전년 배당수익률 비교값 — 이 보드의 op 응답에 없다"),
        "s039": ("blank", "호가단위 — 가격대에서 계산하는 파생값이고 응답 필드가 없다"),
        "s057": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s065": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s073": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s081": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s089": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s097": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s105": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s113": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s121": ("blank", "체결 구분 열 — 실시간 체결(0B) 응답에 체결구분 필드가 없다"),
        "s146": ("text", "거래 상태 칩 — 화면 문구"),
        "s154": ("text", "장 세션 칩 — 화면 문구"),
        "s165": ("text", "VI 발동 여부 칩 — 화면 문구"),
        "s200": ("blank", "기간 등락률 비교값 — 이 보드의 op 응답에 없다"),
        "s203": ("blank", "기간 등락률 비교값 — 이 보드의 op 응답에 없다"),
        "s258": ("text", "현재가·체결 갱신 안내줄 — 화면 문구"),
        "s259": ("blank", "체결 건수·전일 대비·마지막 체결 시각을 합친 목업 문장 — 대응 필드가 없다"),
    },
    "2U5L-1": {
        "s194": ("blank", "감시 신호 건수 — 이 보드의 op 응답에 없다"),
    },
    "2Z49-0": {
        "s124": ("blank", "현재가 열 — ELW 거래원 순매수(ka30002) 응답에 현재가가 없다"),
        "s133": ("blank", "현재가 열 — ELW 거래원 순매수(ka30002) 응답에 현재가가 없다"),
        "s142": ("blank", "현재가 열 — ELW 거래원 순매수(ka30002) 응답에 현재가가 없다"),
        "s151": ("blank", "현재가 열 — ELW 거래원 순매수(ka30002) 응답에 현재가가 없다"),
        "s160": ("blank", "현재가 열 — ELW 거래원 순매수(ka30002) 응답에 현재가가 없다"),
    },
    "30TY-0": {
        "s013": ("blank", "순매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s132": ("blank", "순매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s169": ("blank", "매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s172": ("blank", "매도 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s175": ("blank", "순매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s186": ("blank", "순매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s189": ("blank", "순매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
        "s192": ("blank", "순매수 금액 — 어느 투자자·기간의 값인지 저작이 정하지 않았다(대응 필드 지정이 없음)"),
    },
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="쓰지 않고 남은 자리만 센다")
    args = parser.parse_args()

    changed = 0
    for board_id, decisions in DECISIONS.items():
        path = TEMPLATES / board_id / "slots.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        by_id = {slot["slot_id"]: slot for slot in payload["slots"]}
        for slot_id, (mode, note) in decisions.items():
            slot = by_id.get(slot_id)
            if slot is None:
                raise SystemExit(f"{board_id}: 없는 슬롯 {slot_id}")
            if slot.get("kind") != "value":
                raise SystemExit(f"{board_id} {slot_id}: 값 자리가 아니다")
            if mode == "bind":
                mapping_id, alias, unit = BINDINGS[(board_id, slot_id)]
                if slot.get("f") == alias and slot.get("mapping_id") == mapping_id:
                    continue  # 이미 적용됨(재실행 안전)
                if slot.get("mapping_id"):
                    raise SystemExit(f"{board_id} {slot_id}: 다른 바인딩이 이미 있다")
                if args.check:
                    print(f"미표시 {board_id} {slot_id} → bind {alias}")
                    changed += 1
                    continue
                slot["mapping_id"] = mapping_id
                slot["f"] = alias
                slot["format"] = {
                    "unit": unit, "sign": False, "precision": 0, "tone": "neutral",
                }
                slot["note"] = note
                changed += 1
                continue
            if slot.get("mapping_id") or slot.get("alt_mappings") or slot.get("composite"):
                raise SystemExit(f"{board_id} {slot_id}: 이미 바인딩이 있다")
            if slot.get("static") and slot.get("static_mode") == mode:
                continue
            if args.check:
                print(f"미표시 {board_id} {slot_id} → {mode}")
                changed += 1
                continue
            slot["static"] = True
            slot["static_mode"] = mode
            slot["static_reason"] = note
            changed += 1
        if not args.check:
            path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="",
            )
    print(f"{'미표시' if args.check else '표시'} {changed}자리")
    return 1 if (args.check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
