# ruff: noqa: E501
"""G001.5 이질감(fit dissonance) 게이트의 결정적 검증 스크립트.

근거 문서: plan/kiwoom-common-template-fit-dissonance-plan.md (특히 §2, §5, §6.3, §9.7).
자동 채점 289개(264 read_display + 23 websocket + 2 oauth, order 12는 §9.7 체크리스트로
별도 집계)를 `backend/ref/kiwoom-common-screen-manifest.json`(301개 매핑)과
`backend/ref/kiwoom-tr-inventory.json`(라벨) + 보정 파일 2종(정규식·픽셀)만으로 채점한다.
`backend/ref/kiwoom-screen-definitions.json`(G002 산출물)이 아직 없으므로 이 실행은 전부
"provisional 모드"(§6.3)다 — 실제 렌더러가 아니라 계약 레이어 수치로 채점한다.

실행:
    python backend/scripts/fit_dissonance_check.py            # 산출물 3종 생성/갱신
    python backend/scripts/fit_dissonance_check.py --check    # 게이트 판정, exit code 3단

exit code(팀리드 지시 — plan.md §6.3의 0/1/2/3 4단 표와는 다른, 이 스크립트 고유의 3단 시맨틱):
    0 = 전부 통과(자동 서킷브레이커 0건 + 사람 표본 90/90 채점 완료 + agreement>=0.7 확인)
    1 = 서킷브레이커 위반(override>40 / 규칙>10 / 자유캔버스>8 / 예외총량>52 /
        zero-tolerance 자동 위반 미해소 / order 체크리스트 8항목 중 fail 1건 이상 /
        필수 입력 파일 누락)
    2 = 자동 검사는 전부 통과했으나 사람 채점(90표본) 또는 inter_rater_agreement가
        아직 완료되지 않음 — "gate incomplete", 실패가 아니라 미완료로 정직하게 구분한다.
"""
from __future__ import annotations

import argparse
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import json  # noqa: E402

from athena_api.output_profile import canonical_json  # noqa: E402

REF = BACKEND / "ref"
OUTPUT_PROFILE_PATH = REF / "kiwoom-output-profile.json"
PROJECTIONS_PATH = REF / "response-projections.json"
INVENTORY_PATH = REF / "kiwoom-tr-inventory.json"
MANIFEST_PATH = REF / "kiwoom-common-screen-manifest.json"
SCREEN_DEFINITIONS_PATH = REF / "kiwoom-screen-definitions.json"
SCORECARD_PATH = REF / "kiwoom-fit-dissonance-scorecard.json"
OVERRIDES_PATH = REF / "kiwoom-screen-overrides.json"
FREE_CANVAS_PATH = REF / "kiwoom-free-canvas-registry.json"
ORDER_CHECKLIST_PATH = REF / "kiwoom-order-popup-checklist.json"
WS_LADDER_CALIBRATION_PATH = REF / "ws-ladder-regex-calibration.json"
WIDTH_CALIBRATION_PATH = REF / "width-anchor-pixel-calibration.json"

REQUIRED_INPUTS = [
    OUTPUT_PROFILE_PATH,
    PROJECTIONS_PATH,
    INVENTORY_PATH,
    MANIFEST_PATH,
    WS_LADDER_CALIBRATION_PATH,
    WIDTH_CALIBRATION_PATH,
]

TR_ID_PATTERN = re.compile(r"^k[at]\d+")
DIGIT_PATTERN = re.compile(r"\d{1,2}")

# §2.2 임계값 (provisional, §2.6). WARN/FAIL 쌍.
WIDTH_WARN, WIDTH_FAIL = 12, 20
FACTS_WARN, FACTS_FAIL = 12, 20
STREAM_FAIL = 20
FORMATTER_UNKNOWN_RATIO = 0.30

# backend/ref/ws-ladder-regex-calibration.json 실측 확정값 (§2.2 STRUCTURAL_MISMATCH 2026-08-18 확정).
LADDER_MIN_REPEAT_THRESHOLD = 3
LADDER_MIN_ROLE_GROUPS = 2

# backend/ref/width-anchor-pixel-calibration.json 실측(1560px 캔버스, 5개 anchor 전부 ~13).
VISIBLE_FOLD_COLUMNS = 13

# §5.3.4 / §5.4 / §5.5 / §6.3 예산 (엄격안, §8 결정3).
RULE_ROW_COUNT = 6  # 현재 규칙 수 — §5.3의 6개 행. 코드가 아니라 계획 문서가 소유하는 값.
RULE_ROW_BUDGET = 10
OVERRIDE_BUDGET = 40
FREE_CANVAS_BUDGET = 8
EXCEPTION_WARN, EXCEPTION_FAIL = 46, 52

# §5.3.1(b) 실측 alias 빈도 tie-break 상위 6개.
HIGH_FREQ_ALIASES = ["cur_prc", "pred_pre", "stk_cd", "stk_nm", "trde_qty", "flu_rt"]
# §5.3.1(a) 식별 컬럼(고정) 후보.
IDENTITY_ALIASES = {"stk_cd", "stk_nm", "acnt_no", "ord_no"}

SENSITIVE_KEYWORDS = [
    "계좌",
    "비밀번호",
    "password",
    "passwd",
    "pwd",
    "account",
    "secret",
    "appkey",
    "access_token",
]

# §2.4 anchor 26 구성. 정확한 mapping_id 구성은 plan.md에 "[측정 필요]"로 남아 있어(§2.4),
# 이 스크립트가 결정적으로 산출한다 — 산출 근거는 scorecard.provenance.anchor_construction_note.
ANCHOR_WIDTH_MAX_TR = ["ka10095", "kt00015", "ka30005", "ka10075", "ka10015"]
ANCHOR_SCALAR_MAX_TR = ["kt00001", "ka10004", "ka30012"]  # ka10007은 legacy 9그룹 버킷으로 별도 처리
ANCHOR_KA10007_TR = "ka10007"
ANCHOR_WS_MAX_TR = ["0D", "0F", "0B", "00", "04"]
ANCHOR_WS_MIN_TR = ["ka10171", "ka10174"]
ANCHOR_COUNTEREXAMPLE_TR = "ka10173"

HUMAN_SAMPLE_TARGET = 90
STRATIFIED_2AXIS_TARGET = 55
STRATIFIED_3AXIS_TARGET = 9
STRATIFIED_SAMPLE_RATIO = 0.20
STRATIFIED_MIN_PER_CELL = 3

ZERO_TOLERANCE_CODES = {"LABEL_MISSING", "TR_ID_LEAKAGE", "FORMATTER_MISSING"}
RULE_IDS = {
    "facts_split",
    "table_column_priority",
    "event_stream_ladder_judgement",
    "label_missing_fallback",
    "formatter_missing_fallback",
    "pagination_continuation",
}
RULE_COVERED_CODES = {
    "FACTS_DENSITY_EXCEEDED": "facts_split",
    "OVERFLOW_WIDTH": "table_column_priority",
    "PRIORITY_FIELD_HIDDEN": "table_column_priority",
}

ORDER_CHECKLIST_ITEM_TITLES = {
    "1_safe_state_transition": "안전 상태 전이 — draft 렌더/새로고침/재오픈 시 call_order_tr 호출 0회",
    "2_field_whitelist": "필드 화이트리스트 — 렌더링 필드가 registry.py TR별 필드와 12/12 일치",
    "3_sensitive_field_scan": "민감정보 비노출 — 계좌번호·비밀번호류 키워드 스캔",
    "4_tr_id_not_leaked": "TR ID 비노출 — 렌더링 DOM에 원시 TR 코드 0건",
    "5_duplicate_submit_lock": "중복 제출/폼 잠금 — confirm 진입 후 재클릭 재호출 불가",
    "6_in_doubt_timeout_states": "in_doubt/타임아웃 표현 — 거부/타임아웃/in_doubt 3종 구분 렌더",
    "7_accessibility_fallback": "접근성 3종 폴백 — reduced-transparency/contrast/motion",
    "8_magenta_exclusivity": "마젠타 배타성 — 팝업 열림 중 다른 두 창 마젠타 0곳",
}
# 구현 산출물(app/order-popup.js 등, §9.8)이 아직 저장소에 없어 런타임/DOM 기반 항목은
# 정적 데이터만으로 판정 불가 — pending으로 정직하게 남긴다(계획 §9.7의 "기계 판정 가능한
# 항목만 자동 집계, 나머지는 pending" 지시를 그대로 반영).
ORDER_CHECKLIST_STATICALLY_SCORABLE = {"3_sensitive_field_scan"}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(canonical_json(value), encoding="utf-8")


# ---------------------------------------------------------------------------
# 라벨/필드 인덱스
# ---------------------------------------------------------------------------


def build_inventory_index(inventory: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {entry["id"]: entry for entry in inventory}


def _body_alias_labels(rows: list[dict[str, Any]]) -> dict[str, str]:
    """resp_body/req_body 행을 alias->kor 라벨로 접는다.

    element가 '- - '로 시작하면 실제 leaf FID(WS 관례, ws-ladder-regex-calibration.json의
    leaf_field_selection_rule과 동일 규칙). '- '만 있으면 envelope 메타(type/name/item/values)
    이므로 제외. 그 외는 REST 평문 필드명 그대로 alias.
    """
    labels: dict[str, str] = {}
    for row in rows:
        element = row.get("element", "") or ""
        if element.startswith("- - "):
            alias = element[4:].strip()
        elif element.startswith("- "):
            continue
        else:
            alias = element.strip()
        if alias and alias not in labels:
            labels[alias] = row.get("kor", "") or ""
    return labels


def resp_alias_labels(tr_entry: dict[str, Any] | None) -> dict[str, str]:
    return _body_alias_labels(tr_entry.get("resp_body", [])) if tr_entry else {}


def req_alias_labels(tr_entry: dict[str, Any] | None) -> dict[str, str]:
    return _body_alias_labels(tr_entry.get("req_body", [])) if tr_entry else {}


def build_projection_index(projections: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    index: dict[str, dict[str, dict[str, Any]]] = {}
    for entry in projections["projections"]:
        index[entry["tr_id"]] = {group["id"]: group for group in entry["groups"]}
    return index


# ---------------------------------------------------------------------------
# semanticType 추론 — §1.2 이름 규칙 기반 의미 추론 방법론의 결정적 재현.
# 원본 alias(스네이크케이스 영문)만으로 판정한다(라벨 문자열 매칭보다 안정적).
# ---------------------------------------------------------------------------


# §5.3.1(b)/§1.2의 고빈도 alias 중 접미사 규칙만으로는 애매한 것들의 명시적 예외.
# pred_pre(전일대비, 85회)는 'pred'+'pre'가 어느 접미사 규칙과도 안 맞아 그대로 두면
# unknown으로 오분류된다 — 이 alias 하나가 §5.3.1(b) tie-break 상위 6개 중 하나이므로
# FORMATTER_MISSING 판정에서 unknown으로 잡히면 안 된다(플랜 §1.2 기준).
KNOWN_ALIAS_SEMANTIC_TYPE = {
    "pred_pre": "price",
    "pred_pre_sig": "flag_enum",
}


def semantic_type(alias: str) -> str:
    a = alias.lower()
    if a in KNOWN_ALIAS_SEMANTIC_TYPE:
        return KNOWN_ALIAS_SEMANTIC_TYPE[a]
    if a in ("dt", "date") or a.endswith("_dt") or a.endswith("dt"):
        return "date"
    if a in ("tm", "time") or a.endswith("_tm") or a.endswith("tm"):
        return "time"
    if a.endswith("_at"):
        return "date"
    if "pric" in a or "prc" in a or "bid" in a or a.endswith("_uv") or a == "uv":
        return "price"
    if a.endswith("_rt") or a.endswith("rt"):
        return "rate"
    if "qty" in a:
        return "quantity"
    if "amt" in a or "cmsn" in a or "_tax" in a or a.endswith("tax") or a in ("cap", "trde_prica", "nav"):
        return "amount"
    if a in ("ready", "configured", "enabled", "active", "locked") or a.startswith("is_") or a.startswith("has_"):
        return "flag_enum"
    if a.endswith("_cd") or a.endswith("cd"):
        return "code"
    if a.endswith("_nm") or a.endswith("nm"):
        return "name"
    if a.endswith("_no") or a.endswith("no"):
        return "identifier"
    if a.endswith("_tp") or a.endswith("tp") or a.endswith("_yn") or a.endswith("yn") or a.endswith("_gb") or a.endswith("sig"):
        return "flag_enum"
    return "unknown"


def semantic_type_from_label(label: str | None) -> str:
    """WS FID(예: '9201', '912')처럼 alias 자체가 의미 없는 숫자 코드인 경우의 폴백.

    §1.2 이름 규칙 방법론은 alias(영문 snake_case) 기반이라 REST에는 그대로 맞지만,
    WS 필드는 alias가 숫자 FID라 이 방법이 적용되지 않는다 — 대신 kor 라벨의 한국어
    키워드로 동일한 semanticType 카테고리를 추론한다.
    """
    if not label:
        return "unknown"
    if "일자" in label or "날짜" in label or label.endswith("일"):
        return "date"
    if "시간" in label or "시각" in label:
        return "time"
    if any(token in label for token in ("호가", "가격", "종가", "시가", "고가", "저가", "단가", "체결가", "현재가")) or label.endswith("가"):
        return "price"
    if "율" in label or "등락" in label:
        return "rate"
    if any(token in label for token in ("수량", "잔량", "거래량", "체결량")) or label.endswith("량"):
        return "quantity"
    if any(token in label for token in ("금액", "대금", "수수료", "세금")) or label.endswith("금"):
        return "amount"
    if "코드" in label:
        return "code"
    if "종목명" in label or label.endswith("명"):
        return "name"
    if "번호" in label or "사번" in label or label.endswith("번"):
        return "identifier"
    if any(token in label for token in ("구분", "여부", "유형", "분류", "상태")):
        return "flag_enum"
    return "unknown"


def semantic_type_for_field(alias: str, label: str | None) -> str:
    if alias.isdigit():
        return semantic_type_from_label(label)
    inferred = semantic_type(alias)
    if inferred == "unknown" and label:
        from_label = semantic_type_from_label(label)
        if from_label != "unknown":
            return from_label
    return inferred


# ---------------------------------------------------------------------------
# STRUCTURAL_MISMATCH 사다리 판정 — ws-ladder-regex-calibration.json 확정 알고리즘.
# kor 라벨에서 \d{1,2} 추출 -> base(역할군) 그룹 -> base당 idx 집합 >= min_repeat이고
# 동일 idx 시그니처를 공유하는 base가 >= min_role_groups면 사다리 가족.
# ---------------------------------------------------------------------------


def ladder_families(
    alias_label_pairs: list[tuple[str, str | None]],
    min_repeat: int = LADDER_MIN_REPEAT_THRESHOLD,
    min_role_groups: int = LADDER_MIN_ROLE_GROUPS,
) -> tuple[list[dict[str, Any]], set[str]]:
    base_to_items: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for alias, label in alias_label_pairs:
        if not label:
            continue
        match = DIGIT_PATTERN.search(label)
        if not match:
            continue
        idx = int(match.group())
        base = label[: match.start()] + label[match.end() :]
        base_to_items[base].append((idx, alias))

    ladder_bases: dict[str, list[int]] = {}
    for base, items in base_to_items.items():
        idx_set = sorted({idx for idx, _ in items})
        if len(idx_set) >= min_repeat:
            ladder_bases[base] = idx_set

    signature_to_bases: dict[tuple[int, ...], list[str]] = defaultdict(list)
    for base, idx_set in ladder_bases.items():
        signature_to_bases[tuple(idx_set)].append(base)

    families = [
        {"idx_signature": list(signature), "role_bases": sorted(bases)}
        for signature, bases in signature_to_bases.items()
        if len(bases) >= min_role_groups
    ]
    family_bases = {base for family in families for base in family["role_bases"]}
    matched_aliases = {
        alias for base, items in base_to_items.items() if base in family_bases for _, alias in items
    }
    return families, matched_aliases


# ---------------------------------------------------------------------------
# 매핑별 필드 추출
# ---------------------------------------------------------------------------


# manifest의 fields.response.top_level은 순수 scalar facts만 담고 있지 않다 — list 섹션이
# 있으면 그 container_alias 이름 자체가 top_level에도 중복으로 나타나고(예: base:ka10095의
# top_level=['atn_stk_infr'], 실제 컬럼은 data[0].field_aliases에 있다), envelope 메타
# 필드(return_code/return_msg/trnm/rtcd)도 섞여 있다(예: base:00). facts_count/컬럼 수 채점이
# 이 노이즈를 그대로 세면 안 된다 — 실측으로 확인된 두 잡음 종류를 제거한다.
ENVELOPE_TOP_LEVEL_ALIASES = {"return_code", "return_msg", "trnm", "rtcd"}
WS_GROUP_META_ALIASES = {"type", "name", "item", "values"}


def mapping_facts_and_groups(
    mapping: dict[str, Any],
) -> tuple[list[str], list[tuple[str | None, list[str], list[str]]]]:
    """facts alias 목록과 table 그룹(container_alias, 선언 순 alias, §5.3.1 우선순위 순 alias)을 반환한다.

    우선순위 순서는 더 이상 여기서 다시 추정하지 않는다 — generate_api.py가 매니페스트를
    구울 때 이미 §5.3.1 규칙(식별 컬럼 고정 + 실측 alias 빈도 tie-break)으로 계산해
    `column_priority`에 구워 넣었으므로 그 값을 그대로 읽는다(이중 추정 제거).
    `column_priority`가 없는 컨테이너(생성물이 아닌 손 조립 fixture 등)는 선언 순서로
    안전하게 폴백한다.
    """
    response = mapping["fields"]["response"]
    data_groups = response.get("data", [])
    container_names = {g.get("container_alias") for g in data_groups if g.get("container_alias")}
    facts = [
        alias
        for alias in response.get("top_level", [])
        if alias not in container_names and alias not in ENVELOPE_TOP_LEVEL_ALIASES
    ]
    groups = [
        (
            group.get("container_alias"),
            [alias for alias in group.get("field_aliases", []) if alias not in WS_GROUP_META_ALIASES],
            [
                alias
                for alias in group.get("column_priority", group.get("field_aliases", []))
                if alias not in WS_GROUP_META_ALIASES
            ],
        )
        for group in data_groups
    ]
    return facts, groups


def resolve_title(
    mapping: dict[str, Any],
    tr_entry: dict[str, Any] | None,
    projection_index: dict[str, dict[str, dict[str, Any]]],
) -> tuple[str | None, str]:
    if mapping["mapping_type"] == "split_derived":
        tr_id = mapping["operation"]["tr_id"]
        group_id = mapping["operation"]["detail_group_id"]
        group = projection_index.get(tr_id, {}).get(group_id)
        title_ko = group.get("title_ko") if group else None
        return (title_ko or None), "response_projections.title_ko"
    name = tr_entry.get("name") if tr_entry else None
    return (name or None), "kiwoom_tr_inventory.name"


def evaluate_mapping(
    mapping: dict[str, Any],
    inventory_index: dict[str, dict[str, Any]],
    projection_index: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    mapping_id = mapping["mapping_id"]
    tr_id = mapping["operation"]["tr_id"]
    category = mapping["classification"]["category"]
    shape = mapping["presentation"]["shape"]
    layout = mapping["presentation"]["layout"]
    facts_aliases, table_groups = mapping_facts_and_groups(mapping)
    tr_entry = inventory_index.get(tr_id)
    resp_labels = resp_alias_labels(tr_entry)

    failure_codes: list[str] = []
    warnings: list[str] = []
    diagnostics: dict[str, Any] = {"shape": shape, "layout": layout}

    facts_count = len(facts_aliases)
    diagnostics["facts_count"] = facts_count
    if layout in ("facts", "compound", "status") or shape == "scalar_only":
        if facts_count > FACTS_FAIL:
            failure_codes.append("FACTS_DENSITY_EXCEEDED")
        elif facts_count > FACTS_WARN:
            warnings.append("FACTS_DENSITY_EXCEEDED_WARN")

    max_col_count = max((len(aliases) for _, aliases, _ in table_groups), default=0)
    diagnostics["max_table_column_count"] = max_col_count
    if max_col_count > WIDTH_FAIL:
        failure_codes.append("OVERFLOW_WIDTH")
    elif max_col_count > WIDTH_WARN:
        warnings.append("OVERFLOW_WIDTH_WARN")

    # §5.3.1 fold: 매니페스트에 구워진 column_priority 순서(식별 컬럼 고정 + 빈도 tie-break)
    # 그대로 앞 VISIBLE_FOLD_COLUMNS개가 fold 안, 나머지가 fold 밖(hidden)이다 — 이 스크립트가
    # pinned/rest를 다시 나누지 않는다(generate_api.py의 이중화 제거, plan §5.3.1 참고).
    priority_hidden: list[str] = []
    for _, aliases, ranked in table_groups:
        if len(aliases) <= VISIBLE_FOLD_COLUMNS:
            continue
        hidden = ranked[VISIBLE_FOLD_COLUMNS:]
        priority_hidden.extend(a for a in hidden if a in HIGH_FREQ_ALIASES)
    if priority_hidden:
        failure_codes.append("PRIORITY_FIELD_HIDDEN")
        diagnostics["priority_field_hidden"] = sorted(set(priority_hidden))

    ladder_families_found: list[dict[str, Any]] = []
    if category == "websocket":
        all_aliases = list(facts_aliases) + [alias for _, aliases, _ in table_groups for alias in aliases]
        pairs = [(alias, resp_labels.get(alias)) for alias in all_aliases]
        families, _matched = ladder_families(pairs)
        diagnostics["event_stream_field_count"] = len(all_aliases)
        if families:
            failure_codes.append("STRUCTURAL_MISMATCH")
            ladder_families_found = families
        elif len(all_aliases) > STREAM_FAIL:
            failure_codes.append("STREAM_FIELD_EXCEEDED")

    title, title_source = resolve_title(mapping, tr_entry, projection_index)
    diagnostics["title"] = title
    diagnostics["title_source"] = title_source
    if not title:
        failure_codes.append("LABEL_MISSING")
    elif TR_ID_PATTERN.match(title):
        failure_codes.append("TR_ID_LEAKAGE")

    all_field_aliases = list(dict.fromkeys(facts_aliases + [a for _, aliases, _ in table_groups for a in aliases]))
    if all_field_aliases:
        unknown = [a for a in all_field_aliases if semantic_type_for_field(a, resp_labels.get(a)) == "unknown"]
        ratio = len(unknown) / len(all_field_aliases)
        diagnostics["formatter_unknown_ratio"] = round(ratio, 4)
        if ratio > FORMATTER_UNKNOWN_RATIO:
            failure_codes.append("FORMATTER_MISSING")

    return {
        "mapping_id": mapping_id,
        "tr_id": tr_id,
        "category": category,
        "mapping_type": mapping["mapping_type"],
        "failure_codes": failure_codes,
        "warnings": warnings,
        "diagnostics": diagnostics,
        "ladder_families": ladder_families_found,
    }


def apply_rest_structural_mismatch(
    results_by_id: dict[str, dict[str, Any]],
    mappings_by_tr: dict[str, list[dict[str, Any]]],
    inventory_index: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """형제 detail group이 동일 idx 시그니처를 공유하는데 분리된 REST 사례(§2.2 REST 확장).

    ka10007의 bid_prices/bid_quantities/bid_changes처럼, 개별 그룹 하나하나가 이미 자기
    안에서 사다리(예: sel_1bid..sel_10bid, buy_1bid..buy_10bid)를 이루는 경우를 잡는다.
    이 실패는 §5.3의 6개 규칙 중 어느 것도 커버하지 않는다(rule #3은 문언상 event_stream
    전용) — override 또는 규칙 예산 확장 논의 대상이며, 이 스크립트는 탐지만 한다.
    """
    per_tr_families: dict[str, list[dict[str, Any]]] = {}
    for tr_id, group_mappings in mappings_by_tr.items():
        detail_groups = [m for m in group_mappings if m["mapping_type"] == "split_derived"]
        if len(detail_groups) < 2:
            continue
        tr_entry = inventory_index.get(tr_id)
        resp_labels = resp_alias_labels(tr_entry)
        pool: list[tuple[str, str | None]] = []
        group_aliases: dict[str, list[str]] = {}
        for group_mapping in detail_groups:
            facts, table_groups = mapping_facts_and_groups(group_mapping)
            aliases = facts + [a for _, aliases, _ in table_groups for a in aliases]
            group_aliases[group_mapping["mapping_id"]] = aliases
            pool.extend((alias, resp_labels.get(alias)) for alias in aliases)
        families, matched = ladder_families(pool)
        if not families:
            continue
        per_tr_families[tr_id] = families
        for mapping_id, aliases in group_aliases.items():
            if any(alias in matched for alias in aliases):
                result = results_by_id[mapping_id]
                if "STRUCTURAL_MISMATCH" not in result["failure_codes"]:
                    result["failure_codes"].append("STRUCTURAL_MISMATCH")
                result["ladder_families"] = families
                result["diagnostics"]["structural_mismatch_scope"] = "rest_sibling_group"
    return per_tr_families


def compute_auto_fit(result: dict[str, Any]) -> tuple[int, list[str]]:
    codes = result["failure_codes"]
    if not codes:
        return 2, []
    if any(code in ZERO_TOLERANCE_CODES for code in codes):
        return 0, []
    rules_applied: set[str] = set()
    unresolved: list[str] = []
    for code in codes:
        if code in RULE_COVERED_CODES:
            rules_applied.add(RULE_COVERED_CODES[code])
        elif code == "STREAM_FIELD_EXCEEDED":
            rules_applied.add("event_stream_ladder_judgement")
        elif code == "STRUCTURAL_MISMATCH" and result["category"] == "websocket":
            rules_applied.add("event_stream_ladder_judgement")
        else:
            # REST STRUCTURAL_MISMATCH(형제 group) — §5.3에 커버 규칙 없음(위 함수 docstring 참조).
            unresolved.append(code)
    if unresolved:
        return 0, sorted(rules_applied)
    return 1, sorted(rules_applied)


# ---------------------------------------------------------------------------
# anchor 26 + stratified 64 표본 설계 (§2.4). mapping_id 정렬 기반 결정적 표집, 난수 없음.
# ---------------------------------------------------------------------------


def build_anchor_set(
    mappings_by_id: dict[str, dict[str, Any]],
    mappings_by_tr: dict[str, list[dict[str, Any]]],
) -> dict[str, str]:
    anchors: dict[str, str] = {}

    def add(mapping_id: str, bucket: str) -> None:
        if mapping_id in mappings_by_id and mapping_id not in anchors:
            anchors[mapping_id] = bucket

    for tr_id in ANCHOR_WIDTH_MAX_TR:
        add(f"base:{tr_id}", "width_max_table_5")

    for tr_id in ANCHOR_SCALAR_MAX_TR:
        detail_ids = sorted(
            m["mapping_id"] for m in mappings_by_tr.get(tr_id, []) if m["mapping_type"] == "split_derived"
        )
        if detail_ids:
            best = max(detail_ids, key=lambda mid: len(mappings_by_id[mid]["fields"]["response"]["top_level"]))
            add(best, "scalar_max_4")
        else:
            add(f"base:{tr_id}", "scalar_max_4")

    ka10007_groups = sorted(
        m["mapping_id"]
        for m in mappings_by_tr.get(ANCHOR_KA10007_TR, [])
        if m["mapping_type"] == "split_derived"
    )
    for mapping_id in ka10007_groups:
        add(mapping_id, "ka10007_legacy_9")

    for tr_id in ANCHOR_WS_MAX_TR:
        add(f"base:{tr_id}", "ws_max_width_5")

    for tr_id in ANCHOR_WS_MIN_TR:
        add(f"base:{tr_id}", "ws_min_width_2")

    add(f"base:{ANCHOR_COUNTEREXAMPLE_TR}", "ka10173_counterexample")

    return anchors


def width_bucket(width: int) -> str:
    if width <= 5:
        return "0-5"
    if width <= 12:
        return "6-12"
    if width <= 20:
        return "13-20"
    return "21+"


def build_stratified_2axis(
    results: list[dict[str, Any]], excluded_ids: set[str]
) -> tuple[list[str], dict[str, Any]]:
    cells: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for result in results:
        if result["mapping_id"] in excluded_ids:
            continue
        width = max(result["diagnostics"]["max_table_column_count"], result["diagnostics"]["facts_count"])
        key = (result["category"], result["diagnostics"]["shape"], width_bucket(width))
        cells[key].append(result["mapping_id"])

    selected: list[str] = []
    cell_report: dict[str, Any] = {}
    for key in sorted(cells):
        ids = sorted(cells[key])
        quota = min(len(ids), max(STRATIFIED_MIN_PER_CELL, math.ceil(len(ids) * STRATIFIED_SAMPLE_RATIO)))
        chosen = ids[:quota]
        selected.extend(chosen)
        cell_key = f"{key[0]}|{key[1]}|{key[2]}"
        cell_report[cell_key] = {"cell_size": len(ids), "quota": quota, "selected": chosen}
    return selected, cell_report


def build_stratified_3axis(results: list[dict[str, Any]], excluded_ids: set[str]) -> list[str]:
    pool = [
        result
        for result in results
        if result["mapping_id"] not in excluded_ids
        and WIDTH_WARN < result["diagnostics"]["max_table_column_count"] < WIDTH_FAIL
    ]
    ids = sorted(result["mapping_id"] for result in pool)
    return ids[:STRATIFIED_3AXIS_TARGET]


# ---------------------------------------------------------------------------
# order 12 전용 체크리스트 (§9.7)
# ---------------------------------------------------------------------------


def compute_order_checklist(
    order_mappings: list[dict[str, Any]], inventory_index: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    sensitive_hits = []
    for mapping in order_mappings:
        tr_id = mapping["operation"]["tr_id"]
        tr_entry = inventory_index.get(tr_id)
        req_labels = req_alias_labels(tr_entry)
        resp_labels = resp_alias_labels(tr_entry)
        request_aliases = list(mapping["fields"]["request"]["top_level"])
        response_aliases = list(mapping["fields"]["response"]["top_level"])
        for alias in request_aliases:
            label = req_labels.get(alias, "")
            haystack = f"{alias} {label}".lower()
            if any(keyword in haystack for keyword in SENSITIVE_KEYWORDS):
                sensitive_hits.append({"mapping_id": mapping["mapping_id"], "field": "request", "alias": alias, "label": label})
        for alias in response_aliases:
            label = resp_labels.get(alias, "")
            haystack = f"{alias} {label}".lower()
            if any(keyword in haystack for keyword in SENSITIVE_KEYWORDS):
                sensitive_hits.append({"mapping_id": mapping["mapping_id"], "field": "response", "alias": alias, "label": label})

    pending_reason = (
        "app/order-popup.js, app/order-preload.js, app/main.js의 order 팝업 구현 산출물이 "
        "아직 저장소에 없다(§9.8) — 런타임/DOM 기반 항목은 구현 후에만 자동 판정 가능. "
        "사람 판정 항목이 아니라 '미착수'로 정직하게 pending 표시한다."
    )
    items: dict[str, Any] = {}
    for key, title in ORDER_CHECKLIST_ITEM_TITLES.items():
        if key == "3_sensitive_field_scan":
            items[key] = {
                "title": title,
                "status": "fail" if sensitive_hits else "pass",
                "method": "manifest request/response 필드 alias+kor 라벨 키워드 스캔(정적, backend/ref/kiwoom-tr-inventory.json)",
                "hits": sensitive_hits,
            }
        else:
            items[key] = {"title": title, "status": "pending", "reason": pending_reason}

    statuses = [item["status"] for item in items.values()]
    summary = {
        "pass": statuses.count("pass"),
        "fail": statuses.count("fail"),
        "pending": statuses.count("pending"),
        "total": len(items),
    }
    return {"items": items, "summary": summary, "scored_mapping_count": len(order_mappings)}


def merge_order_checklist(existing: dict[str, Any] | None, computed: dict[str, Any]) -> dict[str, Any]:
    if not existing:
        return computed
    existing_items = existing.get("items", {})
    for key in computed["items"]:
        if key in ORDER_CHECKLIST_STATICALLY_SCORABLE:
            continue  # 항상 재계산
        previous = existing_items.get(key)
        if previous and previous.get("status") != "pending":
            computed["items"][key] = previous
    statuses = [item["status"] for item in computed["items"].values()]
    computed["summary"] = {
        "pass": statuses.count("pass"),
        "fail": statuses.count("fail"),
        "pending": statuses.count("pending"),
        "total": len(computed["items"]),
    }
    return computed


# ---------------------------------------------------------------------------
# override / free-canvas 로드 + §5.4 게임 방지 검증
# ---------------------------------------------------------------------------


def load_registry(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    value = load_json(path)
    return value if isinstance(value, list) else []


def validate_override(entry: dict[str, Any]) -> bool:
    rule_attempted = entry.get("rule_attempted")
    rescored_fit = entry.get("rescored_fit")
    valid_rule = bool(rule_attempted) and rule_attempted in RULE_IDS
    valid_rescore = rescored_fit is not None
    return valid_rule and valid_rescore


# ---------------------------------------------------------------------------
# scorecard 병합 — 기존 사람 채점값·override/free-canvas 참조는 보존, 자동 필드만 갱신.
# ---------------------------------------------------------------------------


def merge_scorecard_entry(existing: dict[str, Any] | None, computed: dict[str, Any]) -> dict[str, Any]:
    if not existing:
        return computed
    merged = dict(computed)
    for key in ("human_fit", "human_raters", "agreement", "resolution_note"):
        if key in existing:
            merged[key] = existing[key]
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "G001.5 이질감 게이트 검증. exit 0=전부 통과, "
            "exit 1=서킷브레이커 위반(override/규칙/자유캔버스/예외총량 초과, zero-tolerance 미해소, "
            "order 체크리스트 fail, 필수 입력 누락), "
            "exit 2=자동 검사는 통과했으나 사람 표본 채점/inter_rater_agreement 미완료(gate incomplete)."
        )
    )
    parser.add_argument("--check", action="store_true", help="게이트 판정만 수행하고 exit code로 결과를 알린다")
    parser.add_argument("--stamp", default=None, help="generated_at에 쓸 타임스탬프. 생략 시 'unstamped'")
    args = parser.parse_args()

    missing = [str(path.relative_to(BACKEND)) for path in REQUIRED_INPUTS if not path.is_file()]
    if missing:
        print(f"필수 입력 파일 누락: {', '.join(missing)}")
        return 1

    output_profile = load_json(OUTPUT_PROFILE_PATH)
    projections = load_json(PROJECTIONS_PATH)
    inventory = load_json(INVENTORY_PATH)
    manifest = load_json(MANIFEST_PATH)
    ws_calibration = load_json(WS_LADDER_CALIBRATION_PATH)
    if (
        ws_calibration["min_repeat_threshold"] != LADDER_MIN_REPEAT_THRESHOLD
        or ws_calibration["min_role_groups"] != LADDER_MIN_ROLE_GROUPS
    ):
        print("ws-ladder-regex-calibration.json의 확정값이 스크립트 상수와 어긋난다 — 재보정 필요.")
        return 1
    width_calibration = load_json(WIDTH_CALIBRATION_PATH)
    if width_calibration["assumptions"]["canvas_width_px"] != 1560:
        print("width-anchor-pixel-calibration.json의 canvas_width_px가 1560이 아니다 — 재보정 필요.")
        return 1
    screen_definitions_present = SCREEN_DEFINITIONS_PATH.is_file()

    inventory_index = build_inventory_index(inventory)
    projection_index = build_projection_index(projections)

    mappings = manifest["mappings"]
    if len(mappings) != 301:
        print(f"manifest 매핑 수가 301이 아니다: {len(mappings)}")
        return 1

    mappings_by_id = {m["mapping_id"]: m for m in mappings}
    mappings_by_tr: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in mappings:
        mappings_by_tr[m["operation"]["tr_id"]].append(m)

    order_mappings = [m for m in mappings if m["classification"]["category"] == "order"]
    auto_mappings = [m for m in mappings if m["classification"]["category"] != "order"]
    if len(order_mappings) != 12 or len(auto_mappings) != 289:
        print(f"category 분포가 기대(order=12, 자동채점=289)와 다르다: order={len(order_mappings)}, auto={len(auto_mappings)}")
        return 1

    results = [evaluate_mapping(m, inventory_index, projection_index) for m in auto_mappings]
    results_by_id = {r["mapping_id"]: r for r in results}
    rest_family_report = apply_rest_structural_mismatch(results_by_id, mappings_by_tr, inventory_index)

    for result in results:
        auto_fit, rules_applied = compute_auto_fit(result)
        result["auto_fit"] = auto_fit
        result["rules_applied"] = rules_applied

    zero_tolerance_violations = [
        r["mapping_id"] for r in results if any(c in ZERO_TOLERANCE_CODES for c in r["failure_codes"])
    ]

    overrides = load_registry(OVERRIDES_PATH)
    free_canvas = load_registry(FREE_CANVAS_PATH)
    override_by_mapping = {entry.get("mapping_id"): entry for entry in overrides}
    free_canvas_ids = {entry.get("mapping_id") for entry in free_canvas}

    invalid_overrides = []
    for result in results:
        mapping_id = result["mapping_id"]
        override_entry = override_by_mapping.get(mapping_id)
        if mapping_id in free_canvas_ids:
            result["free_canvas_id"] = mapping_id
            result["override_id"] = None
            result["rescored_fit"] = 0
            result["resolved_fit"] = 0
            continue
        result["free_canvas_id"] = None
        if override_entry is not None:
            result["override_id"] = mapping_id
            if validate_override(override_entry):
                result["rescored_fit"] = override_entry.get("rescored_fit")
                result["resolved_fit"] = override_entry.get("rescored_fit")
            else:
                invalid_overrides.append(mapping_id)
                result["rescored_fit"] = None
                result["resolved_fit"] = 0
        else:
            result["override_id"] = None
            result["rescored_fit"] = None
            result["resolved_fit"] = result["auto_fit"]

    # ---- anchor / stratified 표본 ----
    anchors = build_anchor_set(mappings_by_id, mappings_by_tr)
    stratified_2axis, cell_report = build_stratified_2axis(results, set(anchors))
    stratified_3axis = build_stratified_3axis(results, set(anchors) | set(stratified_2axis))

    anchor_sorted = sorted(anchors)
    stratified_sorted = sorted(set(stratified_2axis) | set(stratified_3axis))
    human_sample_ids = anchor_sorted + [mid for mid in stratified_sorted if mid not in anchors]
    blind_index = {mid: f"A{i + 1}" for i, mid in enumerate(anchor_sorted)}
    blind_index.update({mid: f"S{i + 1}" for i, mid in enumerate(stratified_sorted) if mid not in anchors})

    detail_prefix_count = sum(1 for mid in anchor_sorted if mid.startswith("detail:"))
    base_prefix_count = sum(1 for mid in anchor_sorted if mid.startswith("base:"))

    # ---- 기존 scorecard 병합(사람 채점값 보존) ----
    existing_scorecard = load_json(SCORECARD_PATH) if SCORECARD_PATH.is_file() else None
    existing_entries_by_id = {
        entry["mapping_id"]: entry for entry in (existing_scorecard or {}).get("mappings", [])
    }

    scorecard_mappings = []
    for result in results:
        mapping_id = result["mapping_id"]
        is_sample = mapping_id in human_sample_ids
        computed_entry = {
            "mapping_id": mapping_id,
            "tr_id": result["tr_id"],
            "kind": result["category"],
            "mapping_type": result["mapping_type"],
            "auto_failure_codes": result["failure_codes"],
            "auto_warnings": result["warnings"],
            "auto_fit": result["auto_fit"],
            "rules_applied": result["rules_applied"],
            "override_id": result["override_id"],
            "rescored_fit": result["rescored_fit"],
            "free_canvas_id": result["free_canvas_id"],
            "resolved_fit": result["resolved_fit"],
            "in_human_sample": is_sample,
            "blind_index": blind_index.get(mapping_id),
            "human_fit": None,
            "human_raters": [],
            "agreement": None,
            "diagnostics": result["diagnostics"],
        }
        scorecard_mappings.append(merge_scorecard_entry(existing_entries_by_id.get(mapping_id), computed_entry))

    for mapping in order_mappings:
        scorecard_mappings.append(
            {
                "mapping_id": mapping["mapping_id"],
                "tr_id": mapping["operation"]["tr_id"],
                "kind": "order",
                "auto_fit": None,
                "excluded_from_auto_score": "order_popup",
                "human_fit": None,
                "rescored_fit": None,
                "free_canvas_id": None,
            }
        )

    scorecard_mappings.sort(key=lambda entry: entry["mapping_id"])

    human_scored = [
        entry for entry in scorecard_mappings if entry.get("in_human_sample") and entry.get("human_fit") is not None
    ]

    def _final_human_fit(entry: dict[str, Any]) -> int:
        return entry["rescored_fit"] if entry.get("rescored_fit") is not None else entry["human_fit"]

    human_fit_values = [_final_human_fit(e) for e in human_scored]
    fit2 = sum(1 for v in human_fit_values if v == 2)
    fit_ge1 = sum(1 for v in human_fit_values if v is not None and v >= 1)
    fit0 = sum(1 for v in human_fit_values if v == 0)
    human_n = len(human_fit_values)

    existing_provenance = (existing_scorecard or {}).get("provenance", {})
    inter_rater_agreement = existing_provenance.get("inter_rater_agreement")

    rule_row_count = RULE_ROW_COUNT
    override_count = len(overrides)
    free_canvas_count = len(free_canvas)
    exception_total = rule_row_count + override_count + free_canvas_count

    # ---- G005 sentinel(row axis) 구조 검사 ----
    list_ui_page_size = output_profile.get("policy", {}).get("list_ui_page_size")
    g005_row_sentinel = {
        "list_ui_page_size": list_ui_page_size,
        "status": "pass" if list_ui_page_size == 10 else "fail",
    }

    order_checklist_computed = compute_order_checklist(order_mappings, inventory_index)
    existing_order_checklist = load_json(ORDER_CHECKLIST_PATH) if ORDER_CHECKLIST_PATH.is_file() else None
    order_checklist = merge_order_checklist(existing_order_checklist, order_checklist_computed)
    order_checklist_fail = order_checklist["summary"]["fail"] > 0

    stamp = args.stamp or "unstamped"
    scorecard = {
        "generated_at": stamp,
        "mappings": scorecard_mappings,
        "aggregate": {
            "auto_scored": len(results),
            "order_popup_checklist_scored": len(order_mappings),
            "human_sample_target": HUMAN_SAMPLE_TARGET,
            "human_sample_actual": len(human_sample_ids),
            "human_sample_scored": human_n,
            "inter_rater_agreement": inter_rater_agreement,
            "fit2_ratio": (fit2 / human_n) if human_n else None,
            "fit_ge1_ratio": (fit_ge1 / human_n) if human_n else None,
            "fit0_ratio": (fit0 / human_n) if human_n else None,
            "rule_row_count": rule_row_count,
            "override_count": override_count,
            "free_canvas_count": free_canvas_count,
            "exception_total": exception_total,
            "zero_tolerance_violation_count": len(zero_tolerance_violations),
            "invalid_override_count": len(invalid_overrides),
            "g005_row_sentinel": g005_row_sentinel,
        },
        "anchor": {
            "target_count": 26,
            "actual_count": len(anchor_sorted),
            "mapping_ids": anchor_sorted,
            "bucket_by_mapping_id": anchors,
            "detail_prefix_count": detail_prefix_count,
            "base_prefix_count": base_prefix_count,
        },
        "stratified": {
            "2axis": {"target_count": STRATIFIED_2AXIS_TARGET, "actual_count": len(stratified_2axis), "mapping_ids": sorted(stratified_2axis), "cells": cell_report},
            "3axis": {"target_count": STRATIFIED_3AXIS_TARGET, "actual_count": len(stratified_3axis), "mapping_ids": stratified_3axis},
        },
        "rest_structural_mismatch_families": {
            tr_id: families for tr_id, families in rest_family_report.items()
        },
        "provenance": {
            "rater_mode": existing_provenance.get("rater_mode"),
            "design_medium": existing_provenance.get("design_medium"),
            "screen_definitions_present": screen_definitions_present,
            "scoring_mode": "output_profile_provisional" if not screen_definitions_present else "screen_definitions",
            "width_calibration": "measured, not recalibrated (FAIL 20 과관대 권고 기록) — see backend/ref/width-anchor-pixel-calibration.json",
            "ws_ladder_calibration": "confirmed 2026-08-18 — see backend/ref/ws-ladder-regex-calibration.json",
            "ka10173": "deferred — 실측 대기(plan §11-3 참조), 이번 실행에서는 anchor counterexample로만 채점",
            "anchor_construction_note": (
                "plan.md §2.4가 '[측정 필요]'로 남긴 anchor 26 구성을 mapping_id 정렬 기반으로 "
                "결정적으로 산출했다. '최대 스칼라 4'(kt00001/ka10004/ka30012)는 TR당 top_level 필드 수가 "
                "가장 큰 detail 그룹 1개를 대표로 선택했고, ka10007은 legacy 9그룹 전부를 별도 버킷으로 "
                "anchor에 포함해 nominal 26과 실제 산출 수가 다를 수 있다(actual_count 필드 참조)."
            ),
            "stratified_sample_note": (
                "2축(shape x width_bucket) 표집은 셀 크기의 20%(최소 3, 셀 크기 이하로 캡)를 "
                "mapping_id 정렬 후 앞에서부터 선택했다. 3축(>12컬럼<20, anchor/2축 제외)은 "
                "동일 정렬 기준으로 최대 9개를 선택했다. 둘 다 난수를 쓰지 않는다."
            ),
        },
    }

    if not SCREEN_DEFINITIONS_PATH.is_file():
        scorecard["provenance"]["screen_definitions_note"] = (
            "backend/ref/kiwoom-screen-definitions.json(G002 산출물)이 없어 output-profile/manifest "
            "기반 provisional 모드로만 채점했다(§6.3)."
        )

    overrides_out = overrides if OVERRIDES_PATH.is_file() else []
    free_canvas_out = free_canvas if FREE_CANVAS_PATH.is_file() else []

    write_json(SCORECARD_PATH, scorecard)
    if not OVERRIDES_PATH.is_file():
        write_json(OVERRIDES_PATH, overrides_out)
    if not FREE_CANVAS_PATH.is_file():
        write_json(FREE_CANVAS_PATH, free_canvas_out)
    write_json(ORDER_CHECKLIST_PATH, order_checklist)

    # ---- 게이트 판정 ----
    circuit_breaker_violations: list[str] = []
    if rule_row_count > RULE_ROW_BUDGET:
        circuit_breaker_violations.append(f"rule_row_count {rule_row_count} > {RULE_ROW_BUDGET}")
    if override_count > OVERRIDE_BUDGET:
        circuit_breaker_violations.append(f"override_count {override_count} > {OVERRIDE_BUDGET}")
    if free_canvas_count > FREE_CANVAS_BUDGET:
        circuit_breaker_violations.append(f"free_canvas_count {free_canvas_count} > {FREE_CANVAS_BUDGET}")
    if exception_total > EXCEPTION_FAIL:
        circuit_breaker_violations.append(f"exception_total {exception_total} > {EXCEPTION_FAIL}")
    if zero_tolerance_violations:
        circuit_breaker_violations.append(
            f"zero-tolerance failure on {len(zero_tolerance_violations)} mapping(s): {zero_tolerance_violations[:10]}"
        )
    if invalid_overrides:
        circuit_breaker_violations.append(f"invalid override entries (§5.4 gaming check): {invalid_overrides}")
    if order_checklist_fail:
        failing = [key for key, item in order_checklist["items"].items() if item["status"] == "fail"]
        circuit_breaker_violations.append(f"order popup checklist fail: {failing}")
    if human_n:
        if fit_ge1 / human_n < 0.95:
            circuit_breaker_violations.append(f"fit>=1 ratio {fit_ge1 / human_n:.4f} < 0.95")
        if fit2 / human_n < 0.85:
            circuit_breaker_violations.append(f"fit=2 ratio {fit2 / human_n:.4f} < 0.85")
        if fit0 / human_n > 0.05:
            circuit_breaker_violations.append(f"fit=0 ratio {fit0 / human_n:.4f} > 0.05")
    if inter_rater_agreement is not None and inter_rater_agreement < 0.7:
        circuit_breaker_violations.append(f"inter_rater_agreement {inter_rater_agreement} < 0.7")

    human_sample_pending = human_n < len(human_sample_ids)
    rubric_pending = inter_rater_agreement is None

    exception_warn = EXCEPTION_WARN <= exception_total <= EXCEPTION_FAIL

    print(f"auto_scored={len(results)} order_popup_checklist_scored={len(order_mappings)}")
    print(
        f"rule_row_count={rule_row_count}/{RULE_ROW_BUDGET} override_count={override_count}/{OVERRIDE_BUDGET} "
        f"free_canvas_count={free_canvas_count}/{FREE_CANVAS_BUDGET} exception_total={exception_total} "
        f"(WARN>={EXCEPTION_WARN}, FAIL>{EXCEPTION_FAIL}){' [WARN]' if exception_warn else ''}"
    )
    print(f"zero_tolerance_violations={len(zero_tolerance_violations)} invalid_overrides={len(invalid_overrides)}")
    print(f"anchor_actual={len(anchor_sorted)} stratified_2axis={len(stratified_2axis)} stratified_3axis={len(stratified_3axis)} human_sample_actual={len(human_sample_ids)}")
    print(f"order_popup_checklist: {order_checklist['summary']}")
    print(f"human_sample_scored={human_n}/{len(human_sample_ids)} inter_rater_agreement={inter_rater_agreement}")

    if args.check:
        if circuit_breaker_violations:
            print("EXIT 1 — 서킷브레이커 위반:")
            for violation in circuit_breaker_violations:
                print(f"  - {violation}")
            return 1
        if human_sample_pending or rubric_pending:
            print("EXIT 2 — gate incomplete: 자동 검사는 통과했으나 사람 표본 채점 또는 inter_rater_agreement가 미완료다.")
            return 2
        print("EXIT 0 — 전부 통과.")
        return 0

    if circuit_breaker_violations:
        print("서킷브레이커 위반 발견(참고, --check 아님):")
        for violation in circuit_breaker_violations:
            print(f"  - {violation}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
