"""보드 하이드레이션 기본 인자 카탈로그 생성기.

Paper 보드가 그리는 화면은 저마다 조회 조건을 하나 갖는다(시장 전체 · KRX · 최근
구간). 그 조건을 클라이언트가 안 보내면 op가 호출조차 되지 않아 보드 전체가 결측어로
덮인다(2026-09-09 실측). 이 스크립트는 **각 op의 요청 모델이 이미 싣고 있는 설명문**
(`000:전체, 001:코스피, 101:코스닥`)에서 그 화면 기본값을 뽑아 ref JSON으로 굳힌다.

고르는 규칙(하나만):
  1. 열거형이면 「전체」·「통합」·「포함」 라벨의 코드를 쓴다. 없으면 첫 코드.
  2. 날짜·시간은 요청 시점에 정해야 하므로 토큰(`$today` 등)으로 남긴다.
  3. 나머지(식별자·수치)는 사람이 고른 값만 쓴다 — MANUAL 표에 없으면 안 싣는다.

산출물은 검토 대상이다. 실행: python backend/scripts/build_hydrate_argument_defaults.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from athena_api.selector.catalog import build_operation_catalog  # noqa: E402

DEST = BACKEND / "ref" / "hydrate-argument-defaults.json"

# 코드가 앞(`000:전체`)이든 뒤(`전체:000000000000`)든 같은 쌍으로 읽는다.
_CODE_FIRST = re.compile(r"^([A-Za-z0-9%]{1,12})\s*[:：]\s*(.+)$")
_LABEL_FIRST = re.compile(r"^(.+?)\s*[:：]\s*([A-Za-z0-9%]{1,12})$")
_DATE_TOKEN = "$today"
_BROAD = ("전체", "통합", "포함", "종합")
_NARROW = ("제외", "미포함", "만보기", "만 보기")

# 날짜 alias — 설명문이 YYYYMMDD를 말하는 자리. 구간의 시작은 30일 전으로 연다.
DATE_DEFAULTS = {
    "strt_dt": "$today-30d",
    "fr_dt": "$today-30d",
    "start_dt": "$today-30d",
    "end_dt": _DATE_TOKEN,
    "to_dt": _DATE_TOKEN,
    "base_dt": _DATE_TOKEN,
    "dt": _DATE_TOKEN,
    "date": _DATE_TOKEN,
    "qry_dt": _DATE_TOKEN,
    "ord_dt": _DATE_TOKEN,
}

# 열거형이 아니고 날짜도 아닌 자리. 값은 Kiwoom 설명문이 직접 적은 것만 쓴다.
MANUAL = {
    "upd_stkpc_tp": ("1", "수정주가 적용(설명문 '0 or 1')"),
    "tm": ("1", "분 입력 — 최근 1분"),
    "tm_tp": ("1", "분 단위"),
    "rank_strt": ("0", "순위 시작 0"),
    "rank_end": ("100", "순위 끝 100(설명문 상한)"),
    "prps_cnctr_rt": ("0", "매물집중비율 하한 0"),
    "prpscnt": ("1", "매물대수 1"),
    "min_trde_qty": ("0", "설명문 '0 주 이상'"),
    "max_trde_qty": ("100000000", "설명문 '100000000 주 이하'"),
    "min_trde_prica": ("0", "설명문 '0 백만원 이상'"),
    "max_trde_prica": ("100000000", "설명문 '100000000 백만원 이하'"),
    "skip_stk": ("000000000", "설명문 '전종목포함 조회시 9개 0'"),
    "date_tp": ("1", "n일전 — 1일"),
    "stex_tp": ("3", "통합(KRX+NXT)"),
    "dmst_stex_tp": ("KRX", "국내거래소"),
    # 설명문에 열거가 없는 op(ka30003)도 같은 alias다. 형제 op(ka30001·ka30004)가
    # 「전체:000000000000」을 적어 두었고, 그 코드가 ELW 화면의 기본 조회다.
    "bsis_aset_cd": ("000000000000", "형제 op 설명문의 '전체' 코드"),
}

# 조회 대상 식별자는 화면이 지목한다 — 기본값을 지어내지 않는다. 여기 남는 것은
# 「그 값이 없으면 무엇을 조회할지 정할 수 없는」 자리다: 종목·주문번호·회원사·
# 테마·감시그룹·ETF 대상지수. 반대로 설명문이 「전체」·「종합」 코드를 직접 적어
# 둔 자리(기초자산·업종)는 그것이 곧 화면 기본값이라 표에 싣는다.
NEVER_DEFAULT = frozenset(
    {
        "stk_cd",
        "ord_no",
        "arn_grp_id",
        "mmcm_cd",
        "etfobjt_idex_cd",
        "thema_grp_cd",
        "uv",
        "stk_infr",
    }
)


def enum_pairs(description: str) -> list[tuple[str, str]]:
    body = description.split("—", 1)[-1]
    pairs: list[tuple[str, str]] = []
    for chunk in re.split(r"[,/·]", body):
        text = chunk.strip().strip(".").strip()
        if not text or ":" not in text and "：" not in text:
            continue
        match = _CODE_FIRST.match(text)
        if match and not re.search(r"[가-힣]", match.group(1)):
            pairs.append((match.group(1).strip(), match.group(2).strip()))
            continue
        match = _LABEL_FIRST.match(text)
        if match and not re.search(r"[가-힣]", match.group(2)):
            pairs.append((match.group(2).strip(), match.group(1).strip()))
    return pairs


def choose(pairs: list[tuple[str, str]]) -> tuple[str, str] | None:
    for code, label in pairs:
        if any(word in label for word in _BROAD) and not any(
            word in label for word in _NARROW
        ):
            return code, f"열거형 '{label}'"
    for code, label in pairs:
        if not any(word in label for word in _NARROW):
            return code, f"열거형 첫 값 '{label}'"
    return (pairs[0][0], f"열거형 '{pairs[0][1]}'") if pairs else None


def main() -> int:
    catalog = build_operation_catalog()
    table: dict[str, dict[str, dict[str, str]]] = {}
    unresolved: dict[str, list[str]] = {}
    for document in catalog.documents:
        if document.kind != "query" or not document.generic_callable:
            continue
        entries: dict[str, dict[str, str]] = {}
        for name, field in document.request_model.model_fields.items():
            if not field.is_required():
                continue
            alias = field.alias or name
            if alias in NEVER_DEFAULT:
                continue
            description = field.description or ""
            picked: tuple[str, str] | None = None
            if alias in MANUAL:
                picked = MANUAL[alias]
            else:
                picked = choose(enum_pairs(description))
                if picked is None and alias in DATE_DEFAULTS:
                    picked = (DATE_DEFAULTS[alias], "날짜 토큰")
            if picked is None:
                unresolved.setdefault(alias, []).append(document.operation_ref)
                continue
            entries[alias] = {"value": picked[0], "why": picked[1]}
        if entries:
            table[document.operation_ref] = entries
    payload = {
        "version": "hydrate-argument-defaults.v1",
        "description": (
            "보드 하이드레이션이 클라이언트가 안 보낸 필수 조회 인자를 채울 때 쓰는 "
            "화면 기본값. 값은 각 op 요청 모델의 설명문에서 뽑았다."
        ),
        "generator": "backend/scripts/build_hydrate_argument_defaults.py",
        "operations": dict(sorted(table.items())),
        "unresolved": {key: sorted(value) for key, value in sorted(unresolved.items())},
    }
    DEST.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"operations={len(table)} unresolved_aliases={len(unresolved)} -> {DEST}")
    for alias, refs in sorted(unresolved.items()):
        print(f"  unresolved {alias}: {len(refs)} ops")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
