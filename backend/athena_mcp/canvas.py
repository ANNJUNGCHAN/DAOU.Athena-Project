
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import jsonschema

CanvasType = Literal["stream", "reader", "timeline", "table", "chart", "facts", "compound", "free"]
AITS_CHART_RENDERER_ID = "aits-chart-v1"

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

_CHART_CANDLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["time", "open", "high", "low", "close"],
    "properties": {
        "time": {"type": ["string", "integer"]},
        "open": {"type": "number"},
        "high": {"type": "number"},
        "low": {"type": "number"},
        "close": {"type": "number"},
        "volume": {"type": "number"},
    },
    "additionalProperties": False,
}

CHART_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["symbol", "chart"],
    "properties": {
        "symbol": {"type": "string", "minLength": 1},
        "chart": {
            "type": "object",
            "required": ["period", "target", "trId", "candles"],
            "properties": {
                "period": {"enum": ["tick", "min", "day", "week", "month", "year"]},
                "target": {"enum": ["stock", "sector", "gold"]},
                "trId": {"type": "string", "minLength": 1},
                "candles": {
                    "type": "array",
                    "items": _CHART_CANDLE_SCHEMA,
                    "minItems": 1,
                },
            },
            "additionalProperties": False,
        },
    },
    "additionalProperties": False,
}

_FACTS_FIELD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["key", "value"],
    "properties": {
        "key": {"type": "string"},
        "label": {"type": ["string", "null"]},
        "value": {"type": ["string", "number", "boolean", "null"]},
    },
}

FACTS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["fields"],
    "properties": {
        "fields": {"type": "array", "items": _FACTS_FIELD_SCHEMA, "minItems": 1},
    },
}

COMPOUND_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["header", "table"],
    "properties": {
        "header": {"type": "array", "items": _FACTS_FIELD_SCHEMA, "minItems": 1},
        "table": TABLE_SCHEMA,
    },
}

CANVAS_SCHEMAS: dict[str, dict[str, Any]] = {
    "stream": STREAM_SCHEMA,
    "reader": READER_SCHEMA,
    "timeline": TIMELINE_SCHEMA,
    "table": TABLE_SCHEMA,
    "chart": CHART_SCHEMA,
    "facts": FACTS_SCHEMA,
    "compound": COMPOUND_SCHEMA,
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
