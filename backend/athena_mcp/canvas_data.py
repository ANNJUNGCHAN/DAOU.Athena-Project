"""render_canvas의 plan_token 데이터 지름길 — 캔버스 우선, 데이터는 모델을 안 거친다.

2026-08-19 실측 배경: 차트 질의에서 모델이 athena_call로 받은 대형 응답을 컨텍스트에
삼키고(입력), 카드 봉투를 손으로 옮겨 적고(출력 — 가장 느린 구간), 그 봉투가 툴
결과로 또 에코됐다(입력). 같은 데이터가 모델을 세 번 통과한 것이다. 이 모듈은
그 경로를 뒤집는다(사용자 지시 "캔버스를 우선 구성하고, 필요 정보만 뽑아 답한다"):

    athena_resolve → plan_token → athena__render_canvas(plan_token, ...)
      → 게이트웨이가 백엔드에서 데이터를 직접 실행·변환해 봉투를 채운다
      → 봉투는 툴 결과에 실려 앱이 즉시 카드를 그리고(캔버스 먼저),
      → 모델은 payload.summary(최신값·기간·행수)만으로 채팅에 답한다.

변환은 전부 결정적이다(CLAUDE.md §7 — 모델 호출·무작위성 없음). 변환 불가능한
형상이면 조용히 그리지 않고 에러로 안내한다(athena_call 직접 경로가 폴백).

안전 성질: 이 경로는 주문 확인 헤더(X-Athena-Confirm 등)를 절대 싣지 않는다 —
주문 계획이 넘어와도 백엔드의 3중 게이트가 헤더 부재로 거부한다(조회 전용).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from mcp import types

from athena_mcp.canvas import validate_canvas_payload

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


def _error(text: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        isError=True,
    )


async def render_with_plan(
    arguments: dict[str, Any],
    http_client: httpx.AsyncClient,
    *,
    call_timeout_seconds: float,
) -> types.CallToolResult:
    """plan_token을 게이트웨이가 직접 실행해 카드 봉투를 채운다.

    반환 payload는 기존 `_render_canvas`와 같은 형상(앱 호환)에 `summary`가
    더해진다 — 모델은 데이터 대신 summary로 답한다.
    """
    canvas_type = arguments.get("canvas_type")
    if canvas_type not in ("chart", "table"):
        return _error(
            "plan_token 데이터 지름길은 canvas_type 'chart'/'table'만 지원한다 — "
            "다른 카드는 athena_call로 데이터를 받아 직접 구성하라"
        )

    plan_token = arguments["plan_token"]
    try:
        response = await http_client.post(
            "/api/v1/llm/tools/call",
            json={"plan_token": plan_token},
            timeout=call_timeout_seconds,
        )
    except httpx.ConnectError:
        return _error("키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다 — 사용자에게 안내하라")
    except httpx.HTTPError as exc:
        return _error(f"plan 실행 중 전송 오류: {exc}")
    if response.status_code >= 400:
        return _error(f"plan 실행 실패 (HTTP {response.status_code}): {response.text[:300]}")
    try:
        call_payload = response.json()
    except ValueError:
        return _error("plan 실행 응답이 JSON이 아니다")

    model_data = arguments.get("data") or {}
    if canvas_type == "chart":
        built = build_chart_bars(call_payload)
        if isinstance(built, str):
            return _error(f"차트 변환 실패: {built}")
        bars, meta = built
        symbol = model_data.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            return _error(
                "차트 카드에는 data.symbol(종목코드)이 필요하다 — 인자에 넣어 다시 호출하라"
            )
        data: dict[str, Any] = {"symbol": symbol, "bars": bars}
        if isinstance(model_data.get("name"), str):
            data["name"] = model_data["name"]
    else:
        built = build_table(call_payload)
        if isinstance(built, str):
            return _error(f"테이블 변환 실패: {built}")
        data, meta = built

    result = validate_canvas_payload(canvas_type, data)
    payload = {
        "canvas_type": result.canvas_type,
        "fell_back": result.fell_back,
        "fallback_reason": result.fallback_reason,
        "caption": arguments.get("caption"),
        "data": result.data,
        "layout": None,
        "drop_types": [],
    }

    # 봉투는 사이드 채널(POST /canvas/push → 앱 WS)로 민다 — 툴 결과에 실으면
    # claude CLI 잘림 한도에 걸려 카드가 깨진다(2026-08-19 프로브 실측). 모델에게는
    # summary만 돌려준다(사용자 지시 "캔버스 먼저, 채팅은 요약만").
    push_note: str | None = None
    try:
        push_response = await http_client.post(
            "/api/v1/canvas/push", json=payload, timeout=5.0
        )
        pushed = push_response.status_code < 400
        if not pushed:
            push_note = f"HTTP {push_response.status_code}"
    except httpx.HTTPError as exc:
        pushed = False
        push_note = str(exc)

    if pushed:
        small = {
            "canvas_type": result.canvas_type,
            # 파서(stream-json-parser.js)가 이 플래그로 'pushed' 분류를 한다 —
            # 앱은 이 결과로 카드를 그리지 않는다(사이드 채널이 이미 그렸다).
            "pushed": True,
            "fell_back": result.fell_back,
            "fallback_reason": result.fallback_reason,
            "caption": arguments.get("caption"),
            # 모델이 답변에 쓰는 요약 — 데이터 본문은 모델 스트림을 타지 않는다.
            # trimmed면 "최근 N행 기준"을 답변에 밝히는 것이 계약이다(프롬프트 v3d).
            "summary": meta,
        }
        return types.CallToolResult(
            content=[
                types.TextContent(type="text", text=json.dumps(small, ensure_ascii=False))
            ],
            structuredContent=small,
            isError=False,
        )

    # 푸시 실패 — 구식 경로(툴 결과에 봉투)로 후퇴한다. 잘릴 수 있으나 아무것도
    # 안 그리는 것보다 낫고, 실패 사실을 payload에 남긴다(조용한 강등 금지).
    payload["push_failed"] = push_note
    payload["summary"] = meta
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        structuredContent=payload,
        isError=False,
    )
