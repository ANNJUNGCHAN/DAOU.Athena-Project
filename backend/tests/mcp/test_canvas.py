"""canvas.py 테스트 — 스키마 불일치 시 free로 폴백 + 폴백 사실 기록."""

from __future__ import annotations

from athena_mcp import canvas


def test_valid_stream_payload_passes_through():
    data = {
        "records": [
            {
                "ts": "2026-08-15T00:43:00+09:00",
                "ts_precision": "second",
                "source": "naver.com",
                "title": "삼성전자 실적 발표",
                "url": "https://example.com/a",
            }
        ]
    }
    result = canvas.validate_canvas_payload("stream", data)
    assert result.canvas_type == "stream"
    assert result.fell_back is False
    assert result.fallback_reason is None


def test_stream_payload_missing_required_field_falls_back_to_free():
    # ts 없음
    data = {"records": [{"ts_precision": "second", "source": "x", "title": "t", "url": "u"}]}
    result = canvas.validate_canvas_payload("stream", data)
    assert result.canvas_type == "free"
    assert result.fell_back is True
    assert result.fallback_reason is not None
    assert "stream" in result.fallback_reason


def test_reader_payload_valid():
    data = {"title": "주요사항보고서", "body_markdown": "# 제목\n본문", "error_state": None}
    result = canvas.validate_canvas_payload("reader", data)
    assert result.fell_back is False


def test_reader_payload_wrong_type_falls_back():
    data = {"title": 123, "body_markdown": "x"}
    result = canvas.validate_canvas_payload("reader", data)
    assert result.fell_back is True
    assert result.canvas_type == "free"


def test_timeline_accepts_partial_data_price_only():
    """결정 4 파급(§7): v1에서는 가격축/이벤트축이 다른 호출에서 올 수 있다 —
    부분 데이터도 유효해야 한다."""
    data = {"price_series": [{"ts": "2026-08-14", "open": 1, "high": 2, "low": 0.5, "close": 1.5}]}
    result = canvas.validate_canvas_payload("timeline", data)
    assert result.fell_back is False


def test_timeline_accepts_partial_data_events_only():
    data = {
        "events": [
            {
                "ts": "2026-08-14",
                "ts_precision": "day",
                "source": "DART",
                "title": "공시",
                "url": "https://dart.fss.or.kr/x",
            }
        ]
    }
    result = canvas.validate_canvas_payload("timeline", data)
    assert result.fell_back is False


def test_timeline_rejects_completely_empty_payload():
    result = canvas.validate_canvas_payload("timeline", {})
    assert result.fell_back is True


def test_table_derives_from_rows_without_columns():
    data = {"rows": [{"a": 1, "b": 2}, {"a": 3, "b": 4}]}
    result = canvas.validate_canvas_payload("table", data)
    assert result.fell_back is False


def test_unknown_canvas_type_falls_back_to_free():
    result = canvas.validate_canvas_payload("nonexistent-canvas", {"whatever": True})
    assert result.canvas_type == "free"
    assert result.fell_back is True
    assert "nonexistent-canvas" in result.fallback_reason


def test_free_canvas_type_never_falls_back():
    result = canvas.validate_canvas_payload("free", {"anything": "goes", "here": [1, 2, 3]})
    assert result.canvas_type == "free"
    assert result.fell_back is False
    assert result.fallback_reason is None


# ---------------------------------------------------------------------------
# 차트 — explicit AITS 입력(symbol + chart{period,target,trId,candles})
# ---------------------------------------------------------------------------


def _aits_chart_data() -> dict:
    return {
        "symbol": "005930",
        "chart": {
            "period": "day",
            "target": "stock",
            "trId": "ka10081",
            "candles": [
                {
                    "time": "2026-08-14",
                    "open": 71000,
                    "high": 72000,
                    "low": 70500,
                    "close": 71500,
                    "volume": 12345678,
                }
            ],
        },
    }


def test_chart_payload_accepts_explicit_aits_shape():
    data = _aits_chart_data()
    result = canvas.validate_canvas_payload("chart", data)
    assert result.canvas_type == "chart"
    assert result.fell_back is False
    assert result.fallback_reason is None
    assert result.data == data


def test_chart_payload_valid_without_optional_fields():
    """volume은 선택이고 intraday epoch time도 명시 계약에서 허용한다."""
    data = {
        "symbol": "005930",
        "chart": {
            "period": "min",
            "target": "stock",
            "trId": "ka10080",
            "candles": [{"time": 1787270400, "open": 1, "high": 2, "low": 0.5, "close": 1.5}],
        },
    }
    result = canvas.validate_canvas_payload("chart", data)
    assert result.fell_back is False


def test_chart_payload_missing_symbol_falls_back_to_free():
    data = _aits_chart_data()
    del data["symbol"]
    result = canvas.validate_canvas_payload("chart", data)
    assert result.canvas_type == "free"
    assert result.fell_back is True
    assert "chart" in result.fallback_reason


def test_chart_payload_empty_candles_falls_back_to_free():
    data = _aits_chart_data()
    data["chart"]["candles"] = []
    result = canvas.validate_canvas_payload("chart", data)
    assert result.canvas_type == "free"
    assert result.fell_back is True


def test_chart_payload_candle_missing_required_field_falls_back_to_free():
    data = _aits_chart_data()
    del data["chart"]["candles"][0]["close"]
    result = canvas.validate_canvas_payload("chart", data)
    assert result.canvas_type == "free"
    assert result.fell_back is True


def test_legacy_symbol_bars_chart_cannot_succeed_or_infer_aits_fields():
    legacy = {
        "symbol": "005930",
        "bars": [{"time": "2026-08-14", "open": 1, "high": 2, "low": 0.5, "close": 1.5}],
    }
    result = canvas.validate_canvas_payload("chart", legacy)
    assert result.canvas_type == "free"
    assert result.fell_back is True
    assert result.data == legacy
    assert "chart" not in result.data


def test_explicit_aits_chart_rejects_legacy_or_unknown_fields():
    data = _aits_chart_data()
    data["bars"] = data["chart"]["candles"]
    result = canvas.validate_canvas_payload("chart", data)
    assert result.canvas_type == "free"
    assert result.fell_back is True
