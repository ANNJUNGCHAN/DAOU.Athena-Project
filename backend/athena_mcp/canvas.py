"""캔버스 계약 — `athena__render_canvas` / `athena__save_canvas`가 쓰는 스키마.

W1은 게이트웨이 골격이고 캔버스 전면 설계는 W3 몫이다(`plan/mcp-실행계획.md`
§4). 여기서는 W1-8 요구사항만 채운다: **신규 4종**(스트림/리더/타임라인/
공통 테이블) 스키마를 최소 계약으로 정의하고, 불일치 시 조용히 깨진 캔버스를
그리는 대신 **자유 캔버스로 폴백**하되 폴백 사실을 반환값에 남긴다.

필드 근거는 전부 §3 실측 표에서 가져왔다:

- **스트림**: 필수 `ts`·`source`·`title`·`url`, 선택 `summary`·`tickers[]`·`kind`
  (`stream.py`가 만드는 정규화 레코드 형상과 동일하다 — 신규 어댑터가 아니라
  같은 계약이다)
- **리더**: 문서 크기와 무관하게 항상 전문 반환(§3-② 실측 정정) → 서버가
  TOC/페이지네이션을 주지 않는다. 계약은 `body_markdown` 전문 + 클라이언트가
  유도할 `highlights`(AI 요약 인용 구간) + 문서 미존재/지연을 구분하는
  `error_state`
- **타임라인**: 스트림(①) × 가격 시계열의 합성. 결정 4로 인해 v1에서는
  가격축과 이벤트축이 서로 다른 소스(키움 REST vs MCP)에서 올 수 있으므로
  `render_canvas`가 **부분 데이터를 받아 기존 캔버스에 합류**할 수 있어야
  한다(§7 결정4 파급) — `price_series`/`events` 둘 다 선택 필드로 둔다
- **공통 테이블**: 컬럼을 데이터에서 유도하는 게 기본값 — `columns`가 없으면
  `rows[0]`의 키에서 유도한다(서버가 미리 계산해 보내도 되고 안 보내도 된다)
- **차트**: 키움 셀렉터 게이트웨이 빌트인(`athena_search`/`describe`/`resolve`/
  `call`)이 붙으면서 추가됐다 — 일봉 OHLCV를 그대로 싣는다. 필드 이름은
  `app/lib/chart-card.js`가 소비하는 형상(`opts: {symbol, name, ohlcv}`,
  `ohlcv[i]: {time, open, high, low, close, volume}`)을 그대로 따르되, 캔버스
  계약 레벨에서는 `ohlcv`를 `bars`로 부른다(canvas.py의 다른 배열 필드들과
  이름 규칙을 맞춘 것 — 렌더러 쪽 매핑은 이 모듈이 관여하지 않는다).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import jsonschema

CanvasType = Literal["stream", "reader", "timeline", "table", "chart", "free"]

_STREAM_RECORD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["ts", "ts_precision", "source", "title", "url"],
    "properties": {
        "ts": {"type": "string"},
        "ts_precision": {"enum": ["second", "day"]},
        "source": {"type": "string"},
        "title": {"type": ["string", "null"]},
        "url": {"type": "string"},
        "summary": {"type": ["string", "null"]},
        "tickers": {"type": "array", "items": {"type": "string"}},
        "kind": {"type": "string"},
    },
}

STREAM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["records"],
    "properties": {
        "records": {"type": "array", "items": _STREAM_RECORD_SCHEMA},
    },
}

READER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["title", "body_markdown"],
    "properties": {
        "title": {"type": "string"},
        "body_markdown": {"type": "string"},
        "format": {"enum": ["markdown", "raw"], "default": "markdown"},
        "highlights": {"type": "array", "items": {"type": "string"}},
        # §3-② 실측: 당일 접수 공시는 문서 미존재로 별도 에러 상태가 필요하다.
        "error_state": {"enum": [None, "not_found", "processing_delayed"]},
    },
}

TIMELINE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        # 결정 4(키움 TR 미노출)로 인해 v1에서는 가격축/이벤트축이 서로 다른
        # 호출에서 올 수 있다 — 부분 데이터로도 유효해야 하므로 required 없음.
        "price_series": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["ts", "open", "high", "low", "close"],
                "properties": {
                    "ts": {"type": "string"},
                    "open": {"type": "number"},
                    "high": {"type": "number"},
                    "low": {"type": "number"},
                    "close": {"type": "number"},
                    "volume": {"type": "number"},
                },
            },
        },
        "events": {"type": "array", "items": _STREAM_RECORD_SCHEMA},
    },
    "anyOf": [{"required": ["price_series"]}, {"required": ["events"]}],
}

TABLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["rows"],
    "properties": {
        "columns": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["key", "label"],
                "properties": {"key": {"type": "string"}, "label": {"type": "string"}},
            },
        },
        "rows": {"type": "array", "items": {"type": "object"}},
    },
}

_CHART_BAR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["time", "open", "high", "low", "close"],
    "properties": {
        "time": {"type": "string"},
        "open": {"type": "number"},
        "high": {"type": "number"},
        "low": {"type": "number"},
        "close": {"type": "number"},
        "volume": {"type": "number"},
    },
}

CHART_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["symbol", "bars"],
    "properties": {
        "symbol": {"type": "string"},
        "name": {"type": "string"},
        "bars": {"type": "array", "items": _CHART_BAR_SCHEMA, "minItems": 1},
    },
}

CANVAS_SCHEMAS: dict[str, dict[str, Any]] = {
    "stream": STREAM_SCHEMA,
    "reader": READER_SCHEMA,
    "timeline": TIMELINE_SCHEMA,
    "table": TABLE_SCHEMA,
    "chart": CHART_SCHEMA,
}


@dataclass(frozen=True)
class CanvasValidationResult:
    canvas_type: CanvasType
    fell_back: bool
    fallback_reason: str | None
    data: dict[str, Any]


def validate_canvas_payload(canvas_type: str, data: dict[str, Any]) -> CanvasValidationResult:
    """스키마와 대조한다. 불일치 시 `free`로 폴백하되 폴백 사실을 결과에 남긴다.

    `canvas_type`이 애초에 4종 중 하나가 아니면(예: 오타, 미지원 값) 역시
    `free`로 폴백한다 — "모르는 형상"은 자유 캔버스가 최후의 착지점이라는
    §3의 계층(자유 캔버스 ← 공통 테이블 ← 전용 캔버스)과 일치한다.
    """
    if canvas_type == "free":
        return CanvasValidationResult(
            canvas_type="free", fell_back=False, fallback_reason=None, data=data
        )

    schema = CANVAS_SCHEMAS.get(canvas_type)
    if schema is None:
        known = sorted(CANVAS_SCHEMAS)
        return CanvasValidationResult(
            canvas_type="free",
            fell_back=True,
            fallback_reason=f"알 수 없는 canvas_type={canvas_type!r} — 지원 목록: {known} + free",
            data=data,
        )

    try:
        jsonschema.validate(instance=data, schema=schema)
    except jsonschema.ValidationError as exc:
        return CanvasValidationResult(
            canvas_type="free",
            fell_back=True,
            fallback_reason=f"{canvas_type} 스키마 불일치: {exc.message}",
            data=data,
        )

    return CanvasValidationResult(
        canvas_type=canvas_type,  # type: ignore[arg-type]
        fell_back=False,
        fallback_reason=None,
        data=data,
    )
