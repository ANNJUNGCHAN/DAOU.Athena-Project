"""캔버스 카드 변환 — 키움 응답 → 카드 봉투의 결정적 변환 (단일 소재지).

원래 게이트웨이(athena_mcp/canvas_data.py)에 있던 순수 함수들이다. 캐시
리플레이 라우트(api/canvas_push.py render-plan)가 같은 변환을 써야 해서
백엔드 소유로 옮겼다 — 게이트웨이가 이 모듈을 역수입한다(같은 venv).
모델 호출·무작위성 없음(CLAUDE.md §7).
"""

from __future__ import annotations

from typing import Any

from athena_api import screen_manifest

# 차트 봉투에 남기는 최신 봉 수 상한. 240봉 ≈ 일봉 1년 — 직렬화 ~26k자로
# CLI 툴 결과 한도(40k 트리밍 기준) 아래에 안전하게 들어간다. 카드의
# 리샘플링(chart-resample.js)이 주/월 뷰를 여기서 유도한다.
BARS_MAX = 240
TABLE_ROWS_MAX = 50

# 키움 차트류 응답의 필드 매핑 — ka10081(일봉) 실측(2026-08-19) 기준이고
# 주/월/년봉도 같은 필드명을 쓴다. 이 매핑이 응답과 안 맞으면 변환을
# 거절한다(추측으로 그리지 않는다).
_CHART_FIELD_MAP = {
    "time": "dt",
    "open": "open_pric",
    "high": "high_pric",
    "low": "low_pric",
    "close": "cur_prc",
    "volume": "trde_qty",
}
_CHART_REQUIRED = ("dt", "open_pric", "high_pric", "low_pric", "cur_prc")


def _format_time(raw: Any) -> str | None:
    """키움 dt('YYYYMMDD') → 'YYYY-MM-DD'. 렌더러(chart-resample.js)가
    `new Date(time + 'T00:00:00Z')`로 파싱하므로 대시가 없으면 카드가 죽는다."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return text
    return None


def _parse_price(raw: Any) -> float | None:
    """키움 가격 문자열 → 수치. 부호 접두(+/-)는 등락 표기이지 값이 아니다."""
    if isinstance(raw, (int, float)):
        return float(raw)
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip().lstrip("+-")
    try:
        return float(text)
    except ValueError:
        return None


def _largest_dict_array(node: Any) -> list[dict[str, Any]] | None:
    """payload 트리에서 가장 큰 '딕셔너리 리스트'를 찾는다 — 결정적 단일 후보."""
    best: list[dict[str, Any]] | None = None

    def walk(value: Any) -> None:
        nonlocal best
        if isinstance(value, dict):
            for child in value.values():
                walk(child)
        elif (
            isinstance(value, list)
            and value
            and all(isinstance(item, dict) for item in value)
            and (best is None or len(value) > len(best))
        ):
            best = value

    walk(node)
    return best


def build_chart_bars(payload: Any) -> tuple[list[dict[str, Any]], dict[str, Any]] | str:
    """키움 차트 응답 → bars(시간 오름차순, 최신 BARS_MAX개). 실패 시 사유 문자열."""
    rows = _largest_dict_array(payload)
    if not rows:
        return "응답에서 행 배열을 찾지 못했다"
    missing = [key for key in _CHART_REQUIRED if key not in rows[0]]
    if missing:
        return f"차트 필드 매핑 실패(누락: {', '.join(missing)}) — 차트류 오퍼레이션이 맞는지 확인"

    bars: list[dict[str, Any]] = []
    for row in rows:
        bar: dict[str, Any] = {}
        ok = True
        for out_key, src_key in _CHART_FIELD_MAP.items():
            if out_key == "time":
                time_value = _format_time(row.get(src_key))
                if time_value is None:
                    ok = False
                    break
                bar["time"] = time_value
                continue
            value = _parse_price(row.get(src_key))
            if value is None:
                if out_key == "volume":
                    continue  # 거래량은 선택 필드 — 없으면 뺀다
                ok = False
                break
            bar[out_key] = value
        if ok:
            bars.append(bar)
    if not bars:
        return "행은 있으나 유효한 봉을 하나도 만들지 못했다"

    bars.sort(key=lambda bar: bar["time"])  # 키움은 최신이 앞 — 카드는 오름차순
    total = len(bars)
    kept = bars[-BARS_MAX:]
    meta = {
        "rows_total": total,
        "rows_kept": len(kept),
        "trimmed": total > len(kept),
        "first_time": kept[0]["time"],
        "last_time": kept[-1]["time"],
        "latest_close": kept[-1]["close"],
    }
    return kept, meta


def build_table(payload: Any) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """임의 응답 → 공통 테이블(rows 상한, columns는 첫 행 키). 실패 시 사유."""
    rows = _largest_dict_array(payload)
    if not rows:
        return "응답에서 행 배열을 찾지 못했다"
    kept = rows[:TABLE_ROWS_MAX]
    columns = [{"key": key, "label": key} for key in kept[0].keys()]
    data = {"columns": columns, "rows": kept}
    meta = {
        "rows_total": len(rows),
        "rows_kept": len(kept),
        "trimmed": len(rows) > len(kept),
        "columns": [column["key"] for column in columns],
    }
    return data, meta


# FactsCard/CompoundCard 헤더에 남기는 필드 수 상한. 실측 최대 20
# (kiwoom-common-screen-spec.md §3.1, p90 15) — 여유를 두고 40으로 잡는다.
# compound 헤더는 실측 2~9(§3.3)로 더 작지만, 별도 상수를 만들 만큼 다르지 않다.
FACTS_FIELDS_MAX = 40


def _scalar_items(payload: Any) -> list[tuple[str, Any]] | None:
    """dict의 최상위 스칼라(비-dict·비-list) 필드만 순서 보존해 뽑는다.

    manifest 실측(29개 CompoundCard 매핑 전수, 2026-08-20) 결과 컨테이너를 감싸는
    별도 wrapper 없이 스칼라 필드와 리스트 컨테이너가 항상 같은 depth에 있다 —
    그래서 얕은(top-level만) 추출로 충분하다. 이 가정이 깨지는 응답은 명시적
    실패로 남는다(추측으로 깊이 파고들지 않는다, CLAUDE.md §3).
    """
    if not isinstance(payload, dict):
        return None
    return [
        (key, value) for key, value in payload.items() if not isinstance(value, (dict, list))
    ]


def build_facts(payload: Any) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """키움 스칼라 응답 → facts 봉투(key/value grid). 실패 시 사유 문자열.

    FactsCard(spec §3.1)는 컨테이너가 없다 — 리스트/딕셔너리 값은 스칼라가
    아니므로 제외한다(그런 값이 섞여 있으면 compound/table이 맞는 레이아웃이라는
    신호다. build_compound_generic/build_table 참조).
    """
    items = _scalar_items(payload)
    if items is None:
        return "응답이 객체가 아니다 — facts는 스칼라 key/value 응답을 기대한다"
    if not items:
        return "응답에서 스칼라 필드를 찾지 못했다"

    kept = items[:FACTS_FIELDS_MAX]
    fields = [{"key": key, "label": key, "value": value} for key, value in kept]
    data = {"fields": fields}
    meta = {
        "fields_total": len(items),
        "fields_kept": len(kept),
        "trimmed": len(items) > len(kept),
    }
    return data, meta


def build_compound_generic(payload: Any) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """키움 compound 응답(스칼라 헤더 + 리스트 1개) → compound 봉투. 실패 시 사유.

    CompoundCard(spec §3.3)는 "이름과 달리 다중 표가 아니다" — facts 헤더 하나 +
    표 하나로 고정이다. 헤더는 build_facts와, 표는 build_table과 같은 필드
    계약을 재사용해 세 변환이 서로 드리프트하지 않게 한다.
    """
    header_items = _scalar_items(payload)
    if header_items is None:
        return "응답이 객체가 아니다 — compound는 스칼라 헤더 + 리스트 하나를 기대한다"
    if not header_items:
        return "응답에서 헤더로 쓸 스칼라 필드를 찾지 못했다"

    rows = _largest_dict_array(payload)
    if not rows:
        return "응답에서 표로 쓸 행 배열을 찾지 못했다"

    header_kept = header_items[:FACTS_FIELDS_MAX]
    header = [{"key": key, "label": key, "value": value} for key, value in header_kept]

    table_rows = rows[:TABLE_ROWS_MAX]
    columns = [{"key": key, "label": key} for key in table_rows[0].keys()]
    table = {"columns": columns, "rows": table_rows}

    data = {"header": header, "table": table}
    meta = {
        "header_fields_total": len(header_items),
        "header_fields_kept": len(header_kept),
        "table_rows_total": len(rows),
        "table_rows_kept": len(table_rows),
        "table_trimmed": len(rows) > len(table_rows),
        "table_columns": [column["key"] for column in columns],
    }
    return data, meta


# ---------------------------------------------------------------------------
# manifest 기반 카드 종류 결정 (P1b, `plan/공통화면-템플릿-실행계획-2026-08-20.md`
# §Q3·P1b Deliverable 1·2) — 콜드 경로(athena_mcp/canvas_data.py::render_with_plan)
# 캐시 리플레이 경로(athena_api/api/canvas_push.py::canvas_render_plan) 둘 다 이
# 함수 하나로 operation_ref → canvas_type을 결정한다(같은 판정 로직을 두 곳이
# 따로 짜지 않는다, Architect 권고). 모델/캐시 caller가 보낸 canvas_type은 여기
# 관여하지 않는다 — 호출부가 감사용 힌트로만 비교·로그한다. 결정은 오직 manifest다.
# ---------------------------------------------------------------------------

# 실측(2026-08-20): manifest의 compound 레이아웃 29건 중 domain=="charts"인
# 정확히 12건(ka10079/80/81/82/83/94, ka20004/05/06/07/08/19 — P2a 8 + P2b 4와
# 정확히 일치)이 OHLCV 캔들스틱 형상이다. 기존 프로덕션 "chart" canvas_type
# (build_chart_bars, app/lib/chart-card.js 렌더러, 27.3s 콜드/222ms 캐시 실측)이
# 이미 이 형상을 쓰고 있으므로, compound 레이아웃이라도 이 12건은 "chart"로
# 승격한다 — 그러지 않으면 라이브 차트 기능이 아직 렌더러가 없는 제네릭
# "compound" 카드로 강등돼 회귀가 난다. TR id를 손으로 나열하는 대신 manifest
# 자체의 domain 필드를 신호로 쓴다("추측하지 않는다", CLAUDE.md §3) — domain이
# 바뀌면 이 승격도 그대로 따라간다.
_CHART_DOMAIN = "charts"

_RENDER_PLAN_LAYOUTS = frozenset({"facts", "table", "compound"})


def resolve_render_plan_kind(operation_ref: str | None) -> str | None:
    """operation_ref(manifest mapping_id) → render-plan 카드 종류.

    facts/table은 manifest layout 그대로, compound는 domain=="charts"면
    "chart"로 승격(위 주석)하고 그 외는 "compound"(제네릭 facts헤더+표)로
    남는다. event(WS)/action(주문)/status(oauth) 레이아웃과 미등록
    operation_ref는 이 plan_token read/display 경로 범위 밖이라 `None` —
    호출부가 free로 폴백하고 사유를 로그에 남긴다(무음 오배정 금지, 계획
    §5 Guardrails).
    """
    if not operation_ref:
        return None
    mapping = screen_manifest.get_mapping(operation_ref)
    if mapping is None:
        return None
    layout = mapping.get("presentation", {}).get("layout")
    if layout == "compound" and mapping.get("operation", {}).get("domain") == _CHART_DOMAIN:
        return "chart"
    if layout in _RENDER_PLAN_LAYOUTS:
        return layout
    return None


def describe_unsupported_render_plan_kind(operation_ref: str | None) -> str:
    """free 폴백 사유 문구 — 콜드/캐시 경로가 감사 로그·응답 summary에 그대로 쓴다."""
    if not operation_ref:
        return "plan 실행 응답에 operation_ref가 없다 — free로 폴백한다"
    mapping = screen_manifest.get_mapping(operation_ref)
    if mapping is None:
        return f"manifest에 operation_ref={operation_ref!r} 매핑이 없다 — free로 폴백한다"
    layout = mapping.get("presentation", {}).get("layout")
    return (
        f"manifest layout={layout!r}(operation_ref={operation_ref!r})은 "
        "read/display 카드가 아니다 — free로 폴백한다"
    )

