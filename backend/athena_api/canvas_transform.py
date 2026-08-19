"""캔버스 카드 변환 — 키움 응답 → 카드 봉투의 결정적 변환 (단일 소재지).

원래 게이트웨이(athena_mcp/canvas_data.py)에 있던 순수 함수들이다. 캐시
리플레이 라우트(api/canvas_push.py render-plan)가 같은 변환을 써야 해서
백엔드 소유로 옮겼다 — 게이트웨이가 이 모듈을 역수입한다(같은 venv).
모델 호출·무작위성 없음(CLAUDE.md §7).
"""

from __future__ import annotations

from typing import Any

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


