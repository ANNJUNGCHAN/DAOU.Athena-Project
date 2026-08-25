
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from athena_api import screen_manifest

logger = logging.getLogger(__name__)

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

# 모델에게 돌아가는 render-plan summary에는 카드 본문을 다시 싣지 않는다. 다만
# 가격 질의의 자연어 답변이 실제 현재가/등락을 말할 수 있도록, 시장 데이터 중
# 명시적으로 허용한 스칼라만 작은 preview로 남긴다. 계좌·인증 필드는 allowlist에
# 없으므로 값이 summary 경계로 복제되지 않는다. 각 제한은 서로 독립적으로 적용한다.
SUMMARY_PREVIEW_ITEMS_MAX = 6
SUMMARY_PREVIEW_STRING_MAX = 80
SUMMARY_PREVIEW_BYTES_MAX = 1024

_SUMMARY_FIELD_LABELS = {
    "cur_prc": "현재가",
    "pred_pre": "전일대비",
    "pre_sig": "등락기호",
    "pred_pre_sig": "등락기호",
    "flu_smbol": "등락기호",
    "smbol": "등락기호",
    "flu_rt": "등락률",
    "cntr_tm": "체결시각",
    "trde_tm": "거래시각",
    "base_dt": "기준일자",
    "dt": "일자",
    "stk_cd": "종목코드",
    "stk_nm": "종목명",
    "rtcd": "응답코드",
}


def _bounded_text(value: Any) -> tuple[str, bool]:
    """스칼라를 길이 제한 문자열로 만든다. 컨테이너는 preview 대상이 아니다."""
    text = str(value)
    if len(text) <= SUMMARY_PREVIEW_STRING_MAX:
        return text, False
    return text[: SUMMARY_PREVIEW_STRING_MAX - 1] + "…", True


def _summary_preview(items: list[tuple[str, Any]]) -> tuple[list[dict[str, str]], bool]:
    """허용된 스칼라를 item/string/UTF-8 byte 상한 안에서 결정적으로 고른다."""
    by_key = dict(items)
    eligible = [(key, by_key[key]) for key in _SUMMARY_FIELD_LABELS if key in by_key]
    preview: list[dict[str, str]] = []
    truncated = False
    for key, value in eligible:
        if len(preview) >= SUMMARY_PREVIEW_ITEMS_MAX:
            truncated = True
            break
        text, text_truncated = _bounded_text(value)
        candidate = {"key": key, "label": _SUMMARY_FIELD_LABELS[key], "value": text}
        encoded = json.dumps(
            [*preview, candidate], ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        if len(encoded) > SUMMARY_PREVIEW_BYTES_MAX:
            truncated = True
            break
        preview.append(candidate)
        truncated = truncated or text_truncated
    return preview, truncated


def _summary_keys(items: list[tuple[str, Any]]) -> tuple[list[str], bool]:
    """Compound 헤더의 키 이름만 동일한 item/string/byte 상한으로 요약한다."""
    keys: list[str] = []
    truncated = False
    for key, _ in items:
        if len(keys) >= SUMMARY_PREVIEW_ITEMS_MAX:
            truncated = True
            break
        text, text_truncated = _bounded_text(key)
        encoded = json.dumps([*keys, text], ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        if len(encoded) > SUMMARY_PREVIEW_BYTES_MAX:
            truncated = True
            break
        keys.append(text)
        truncated = truncated or text_truncated
    return keys, truncated


def _scalar_items(payload: Any) -> list[tuple[str, Any]] | None:
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
    preview, preview_truncated = _summary_preview(items)
    meta = {
        "fields_total": len(items),
        "fields_kept": len(kept),
        "trimmed": len(items) > len(kept),
        "preview": preview,
        "preview_truncated": preview_truncated,
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
    header_preview, header_preview_truncated = _summary_preview(header_items)
    header_keys, header_keys_truncated = _summary_keys(header_items)
    meta = {
        "header_fields_total": len(header_items),
        "header_fields_kept": len(header_kept),
        "header_keys": header_keys,
        "header_keys_truncated": header_keys_truncated,
        "header_preview": header_preview,
        "header_preview_truncated": header_preview_truncated,
        "table_rows_total": len(rows),
        "table_rows_kept": len(table_rows),
        "table_trimmed": len(rows) > len(table_rows),
        "table_columns": [column["key"] for column in columns],
    }
    return data, meta



AITS_CHART_RENDERER_ID = "aits-chart-v1"
_AITS_PERIODS = frozenset({"tick", "min", "day", "week", "month", "year"})
_AITS_TARGETS = frozenset({"stock", "sector", "gold"})
_AITS_RELOAD_GROUP_SCOPE = {
    ("stock", "stock"): "standard",
    ("sector", "sector"): "standard",
    ("gold", "gold-generic"): "generic",
    ("gold", "gold-today"): "today",
}
_SCREEN_DEFINITIONS_PATH = (
    Path(__file__).resolve().parents[1] / "ref" / "kiwoom-screen-definitions.json"
)

_RENDER_PLAN_LAYOUTS = frozenset({"facts", "table", "compound"})


@lru_cache(maxsize=1)
def _screen_definitions() -> dict[str, dict[str, Any]]:
    try:
        raw = json.loads(_SCREEN_DEFINITIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.exception("키움 화면 정의를 읽지 못했다: %s", _SCREEN_DEFINITIONS_PATH)
        return {}
    definitions = raw.get("definitions")
    if not isinstance(definitions, list):
        return {}
    return {
        definition["mapping_id"]: definition
        for definition in definitions
        if isinstance(definition, dict)
        and isinstance(definition.get("mapping_id"), str)
    }


def _path_container_alias(path: Any) -> str | None:
    if not isinstance(path, str) or not path.startswith("$."):
        return None
    alias = path[2:]
    if not alias or "." in alias or "[" in alias or "]" in alias:
        return None
    return alias


def _path_field_alias(path: Any, container_alias: str) -> str | None:
    prefix = f"$.{container_alias}[*]."
    if not isinstance(path, str) or not path.startswith(prefix):
        return None
    alias = path[len(prefix) :]
    if not alias or "." in alias or "[" in alias or "]" in alias:
        return None
    return alias


def _aits_time(raw: Any, timezone_name: Any) -> str | int | None:
    if not isinstance(raw, str) or not isinstance(timezone_name, str):
        return None
    text = raw.strip()
    if len(text) == 8 and text.isdigit():
        try:
            return datetime.strptime(text, "%Y%m%d").strftime("%Y-%m-%d")
        except ValueError:
            return None
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        try:
            return datetime.strptime(text, "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            return None
    if len(text) != 14 or not text.isdigit() or timezone_name != "Asia/Seoul":
        return None
    try:
        parsed = datetime.strptime(text, "%Y%m%d%H%M%S").replace(
            tzinfo=timezone(timedelta(hours=9))
        )
    except ValueError:
        return None
    return int(parsed.timestamp())


def _aits_number(raw: Any) -> float | None:
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return float(raw.strip().lstrip("+-"))
    except ValueError:
        return None


def resolve_screen_render_contract(
    operation_ref: str | None,
) -> tuple[str, str, str | None] | str:
    """Join manifest and generated screen definition; any drift fails closed."""
    if not isinstance(operation_ref, str):
        return "오퍼레이션 참조가 없다"
    mapping = screen_manifest.get_mapping(operation_ref)
    definition = _screen_definitions().get(operation_ref)
    canvas_kind = resolve_render_plan_kind(operation_ref)
    if mapping is None or definition is None or canvas_kind is None:
        return "매니페스트 또는 화면 정의가 없다"
    classification = mapping.get("classification")
    screen_reference = mapping.get("screen_reference")
    if (
        not isinstance(classification, dict)
        or classification.get("category") != "read_display"
        or not isinstance(screen_reference, dict)
    ):
        return "read/display 화면 계약이 아니다"
    screen_id = screen_reference.get("screen_id")
    if (
        not isinstance(screen_id, str)
        or not screen_id
        or definition.get("mapping_id") != operation_ref
        or definition.get("operation_ref") != operation_ref
        or definition.get("screen_id") != screen_id
        or definition.get("category") != "read_display"
    ):
        return "매니페스트와 화면 정의 식별자가 불일치한다"
    manifest_renderer = mapping.get("presentation", {}).get("renderer_id")
    definition_renderer = definition.get("presentation", {}).get("renderer_id")
    chart = (definition.get("data") or {}).get("chart")
    if manifest_renderer != definition_renderer:
        return "매니페스트와 화면 정의 renderer가 불일치한다"
    if canvas_kind != "chart":
        if manifest_renderer is not None or chart is not None:
            return "비차트 화면에 차트 계약이 섞였다"
        return canvas_kind, screen_id, None
    if (
        manifest_renderer != AITS_CHART_RENDERER_ID
        or not isinstance(chart, dict)
        or set(chart)
        != {
            "trId",
            "period",
            "target",
            "series_scope",
            "reload_group",
            "reload_targets",
            "container_path",
            "time_path",
            "ohlcv",
        }
        or chart.get("trId") != operation_ref.removeprefix("base:")
        or chart.get("period") not in _AITS_PERIODS
        or chart.get("target") not in _AITS_TARGETS
        or _AITS_RELOAD_GROUP_SCOPE.get(
            (chart.get("target"), chart.get("reload_group"))
        )
        != chart.get("series_scope")
        or not isinstance(chart.get("reload_targets"), dict)
        or chart.get("period") not in chart["reload_targets"]
        or not isinstance(chart.get("container_path"), str)
        or not isinstance(chart.get("time_path"), str)
        or not isinstance(chart.get("ohlcv"), dict)
        or set(chart["ohlcv"]) != {"open", "high", "low", "close", "volume"}
        or any(
            not isinstance(chart["ohlcv"].get(key), str)
            for key in ("open", "high", "low", "close")
        )
        or (
            chart["ohlcv"].get("volume") is not None
            and not isinstance(chart["ohlcv"]["volume"], str)
        )
    ):
        return "AITS 차트 계약이 불완전하다"
    definitions = _screen_definitions()
    reload_keys: dict[tuple[Any, Any, Any], str] = {}
    for candidate_ref, candidate_definition in definitions.items():
        candidate_chart = (candidate_definition.get("data") or {}).get("chart")
        if not isinstance(candidate_chart, dict):
            continue
        reload_key = (
            candidate_chart.get("target"),
            candidate_chart.get("reload_group"),
            candidate_chart.get("period"),
        )
        prior_ref = reload_keys.get(reload_key)
        if prior_ref is not None and prior_ref != candidate_ref:
            return "AITS reload target가 중복되어 모호하다"
        reload_keys[reload_key] = candidate_ref
    for period, target in chart["reload_targets"].items():
        if (
            period not in _AITS_PERIODS
            or not isinstance(target, dict)
            or set(target) != {"operation_ref", "request_fields"}
            or not isinstance(target.get("operation_ref"), str)
            or not isinstance(target.get("request_fields"), list)
            or not all(
                isinstance(field, str) and field for field in target["request_fields"]
            )
        ):
            return "AITS reload target 계약이 불완전하다"
        target_definition = definitions.get(target["operation_ref"])
        if not isinstance(target_definition, dict):
            return "AITS reload target 화면 정의가 없다"
        target_chart = (target_definition.get("data") or {}).get("chart")
        request_allowlist = (target_definition.get("input") or {}).get("field_allowlist")
        if not isinstance(target_chart, dict) or not isinstance(request_allowlist, dict):
            return "AITS reload target 데이터 계약이 없다"
        request_fields = list(request_allowlist.get("top_level", []))
        request_fields.extend(
            alias
            for container in request_allowlist.get("data", [])
            for alias in container.get("field_aliases", [])
        )
        if (
            target_chart.get("target") != chart["target"]
            or target_chart.get("reload_group") != chart["reload_group"]
            or target_chart.get("period") != period
            or target_chart.get("trId")
            != target["operation_ref"].removeprefix("base:")
            or request_fields != target["request_fields"]
        ):
            return "AITS reload target가 현재 계약과 불일치한다"
    return canvas_kind, screen_id, AITS_CHART_RENDERER_ID


def build_aits_chart_body(
    operation_ref: str, tr_data: Any
) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """Build the AITS ChartCardBody only from generated JSONPath metadata."""
    resolved = resolve_screen_render_contract(operation_ref)
    if isinstance(resolved, str) or resolved[0] != "chart":
        return resolved if isinstance(resolved, str) else "AITS 차트 화면이 아니다"
    if not isinstance(tr_data, dict):
        return "서명된 차트 응답 본문이 없다"
    definition = _screen_definitions()[operation_ref]
    chart = definition["data"]["chart"]
    container_alias = _path_container_alias(chart["container_path"])
    if container_alias is None:
        return "차트 컨테이너 경로가 유효하지 않다"
    rows = tr_data.get(container_alias)
    if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
        return f"화면 정의 컨테이너 {container_alias}에서 차트 행을 찾지 못했다"
    time_alias = _path_field_alias(chart["time_path"], container_alias)
    aliases = {
        key: _path_field_alias(chart["ohlcv"].get(key), container_alias)
        for key in ("open", "high", "low", "close", "volume")
    }
    if time_alias is None or any(aliases[key] is None for key in ("open", "high", "low", "close")):
        return "차트 시간축 또는 필수 OHLC 경로가 유효하지 않다"
    timezone_name = definition["data"]["time"].get("timezone")
    candles: list[dict[str, Any]] = []
    for row in rows:
        time_value = _aits_time(row.get(time_alias), timezone_name)
        if time_value is None:
            continue
        candle: dict[str, Any] = {"time": time_value}
        for key in ("open", "high", "low", "close"):
            value = _aits_number(row.get(aliases[key]))
            if value is None:
                break
            candle[key] = value
        else:
            volume_alias = aliases["volume"]
            if volume_alias is not None:
                volume = _aits_number(row.get(volume_alias))
                if volume is not None:
                    candle["volume"] = volume
            candles.append(candle)
    if not candles:
        return "시간축과 OHLC 계약으로 유효한 봉을 만들지 못했다"
    max_rows = definition["data"]["range"].get("max_rows")
    if not isinstance(max_rows, int) or isinstance(max_rows, bool) or not 1 <= max_rows <= 240:
        return "차트 행 상한이 유효하지 않다"
    candles.sort(key=lambda candle: candle["time"])
    total = len(candles)
    kept = candles[-max_rows:]
    return {
        "period": chart["period"],
        "target": chart["target"],
        "trId": chart["trId"],
        "candles": kept,
    }, {
        "rows_total": total,
        "rows_kept": len(kept),
        "trimmed": total > len(kept),
        "first_time": kept[0]["time"],
        "last_time": kept[-1]["time"],
        "latest_close": kept[-1]["close"],
    }


def screen_definition_for(operation_ref: str) -> dict[str, Any] | None:
    """화면 정의 1건을 돌려준다(없으면 None).

    라우트가 `_screen_definitions()`(사설 lru_cache)를 직접 만지지 않게 하는 접근자다.
    게이트 통과 후 `data.time` 같은 계약 세부를 봐야 하는 곳에서 쓴다.
    """
    return _screen_definitions().get(operation_ref)


def _split_row_path(path: Any) -> tuple[str, str] | None:
    """'$.shrts_trnsn[*].dt' → ('shrts_trnsn', 'dt').

    차트 계약은 컨테이너 경로(`$.alias`)와 필드 경로를 따로 갖지만, 표 계약은
    `data.time.field_path` 하나에 둘이 붙어 있다. `_path_container_alias`는
    `$.alias` 전용이라 이 형태를 못 읽는다(실측: None을 돌려줬다).
    """
    if not isinstance(path, str) or not path.startswith("$."):
        return None
    body = path[2:]
    marker = "[*]."
    if marker not in body:
        return None
    container_alias, _, field_alias = body.partition(marker)
    if not container_alias or not field_alias:
        return None
    for part in (container_alias, field_alias):
        if "." in part or "[" in part or "]" in part:
            return None
    return container_alias, field_alias


def _series_container(definition: dict[str, Any], container_alias: str) -> dict[str, Any] | None:
    for container in definition["data"].get("containers") or []:
        if isinstance(container, dict) and container.get("container_alias") == container_alias:
            return container
    return None


def _series_number(raw: Any) -> float | None:
    """부호를 살려서 읽는다 — `_aits_number`와 다른 점이 이것뿐이다.

    `_aits_number`는 `.lstrip("+-")`로 부호를 버린다. OHLCV에서는 맞다: 가격은 늘
    양수이고 앞의 +/-는 등락 표시일 뿐이다. 하지만 순매수량은 **부호가 곧 의미다** —
    `-200`은 200주 순매도지 200주 순매수가 아니다. 여기서 부호를 버리면 수급 지표가
    통째로 뒤집힌다(2026-08-26 실측으로 잡음). 가격 경로는 그대로 두려고 함수를 나눴다.
    """
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return float(raw.strip())
    except ValueError:
        return None


def _series_time(raw: Any, formatter: Any, timezone_name: Any, base_dt: str | None) -> Any:
    """시계열 표의 시간 값을 canonical 시각으로 바꾼다.

    `time_hhmmss`(예: ka10064의 `tm`)는 컨테이너에 날짜 필드가 **없다**(2026-08-25 실측).
    그래서 요청이 준 거래일과 결합해야만 시각이 성립한다. 거래일이 없으면 오늘로
    추측하지 않고 None을 돌려 호출자가 실패로 처리하게 한다.
    """
    if formatter == "time_hhmmss":
        text = raw.strip() if isinstance(raw, str) else ""
        if len(text) != 6 or not text.isdigit() or not base_dt:
            return None
        return _aits_time(f"{base_dt}{text}", timezone_name)
    return _aits_time(raw, timezone_name)


def build_series_body(
    operation_ref: str,
    tr_data: Any,
    field_aliases: list[str],
    *,
    base_dt: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """table 계약 + 시간축을 가진 TR 응답을 canonical 시계열로 바꾼다.

    OHLCV가 아닌 시계열(수급 추이 등)을 차트 pane으로 그리기 위한 경로다. 그릴 열은
    호출자가 명시해야 한다 — 자동으로 고르지 않는다. `column_priority` 첫 열이
    `cur_prc`(현재가)/`pred_pre`(전일대비)인 계약이 있어(실측) 자동 선택은 수급이 아닌
    값을 그리게 된다.
    """
    resolved = resolve_screen_render_contract(operation_ref)
    if isinstance(resolved, str):
        return resolved
    if resolved[0] != "table":
        return "시계열 표 화면이 아니다"
    if not isinstance(tr_data, dict):
        return "서명된 응답 본문이 없다"
    if not field_aliases:
        return "그릴 열을 지정해야 한다"

    definition = _screen_definitions()[operation_ref]
    time_meta = definition["data"].get("time") or {}
    split = _split_row_path(time_meta.get("field_path"))
    if split is None:
        return "시간축 계약이 없다"
    container_alias, time_alias = split

    container = _series_container(definition, container_alias)
    if container is None:
        return f"화면 정의 컨테이너 {container_alias}를 찾지 못했다"
    allowlist = set(container.get("field_allowlist") or [])
    fields = {
        field["alias"]: field
        for field in container.get("fields") or []
        if isinstance(field, dict) and isinstance(field.get("alias"), str)
    }
    for alias in field_aliases:
        if alias not in allowlist:
            return f"계약에 없는 열이다: {alias}"

    rows = tr_data.get(container_alias)
    if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
        return f"화면 정의 컨테이너 {container_alias}에서 행을 찾지 못했다"

    timezone_name = time_meta.get("timezone")
    time_formatter = (fields.get(time_alias) or {}).get("formatter")
    collected: dict[str, dict[Any, float]] = {alias: {} for alias in field_aliases}
    if time_formatter == "time_hhmmss" and not base_dt:
        # 장중 계약은 컨테이너에 날짜가 없다 — 거래일 없이는 시각이 성립하지 않는다.
        # "유효한 점이 없다"로 뭉뚱그리지 않고 진짜 사유를 돌려준다.
        return "장중 시계열은 거래일(base_dt)이 있어야 한다"
    for row in rows:
        at = _series_time(row.get(time_alias), time_formatter, timezone_name, base_dt)
        if at is None:
            continue
        for alias in field_aliases:
            value = _series_number(row.get(alias))
            if value is None:
                continue
            # 같은 시각이 두 번 오면 뒤엣것을 쓴다 — dict가 그렇게 동작한다.
            collected[alias][at] = value

    series: list[dict[str, Any]] = []
    for alias in field_aliases:
        points = [
            {"time": at, "value": value}
            for at, value in sorted(collected[alias].items(), key=lambda item: str(item[0]))
        ]
        if not points:
            return f"열 {alias}에서 유효한 점을 만들지 못했다"
        series.append(
            {
                "field": alias,
                "label": (fields.get(alias) or {}).get("label") or alias,
                "points": points,
            }
        )

    max_rows = definition["data"]["range"].get("max_rows")
    if not isinstance(max_rows, int) or isinstance(max_rows, bool) or max_rows < 1:
        return "행 상한이 유효하지 않다"
    total = max(len(entry["points"]) for entry in series)
    for entry in series:
        entry["points"] = entry["points"][-max_rows:]
    kept = max(len(entry["points"]) for entry in series)
    return {"series": series, "time_alias": time_alias}, {
        "rows_total": total,
        "rows_kept": kept,
        "trimmed": total > kept,
    }


def build_aits_chart_envelope_data(
    operation_ref: str, call_payload: Any
) -> tuple[dict[str, Any], dict[str, Any]] | str:
    """Build renderer identity plus safe AITS data from a verified CallResponse dump.

    The only live identity is ``canvas_context.symbol`` sealed by the signed plan;
    caller render-plan data is intentionally absent from this function's inputs.
    """
    if not isinstance(call_payload, dict):
        return "검증된 호출 응답 봉투가 없다"
    built = build_aits_chart_body(operation_ref, call_payload.get("data"))
    if isinstance(built, str):
        return built
    chart, meta = built
    definition_chart = _screen_definitions()[operation_ref]["data"]["chart"]
    canvas_context = call_payload.get("canvas_context")
    symbol = canvas_context.get("symbol") if isinstance(canvas_context, dict) else None
    if not isinstance(symbol, str) or not symbol:
        return "verified chart plan did not contain a display symbol"
    return {
        "renderer_id": AITS_CHART_RENDERER_ID,
        "data": {
            "symbol": symbol,
            "chart": chart,
            "chart_meta": {
                "series_scope": definition_chart["series_scope"],
                "reload_group": definition_chart["reload_group"],
                "reload_targets": definition_chart["reload_targets"],
            },
        },
    }, meta


def resolve_render_plan_kind(operation_ref: str | None) -> str | None:
    """operation_ref(manifest mapping_id) → render-plan 카드 종류.

    차트는 manifest `presentation.renderer_id`가 정확히 AITS renderer일 때만
    선택한다. 제목·domain·layout·응답 모양은 차트 선택 권한이 없다. 나머지
    facts/table/compound는 manifest layout 그대로 사용한다. 알 수 없는 renderer,
    event(WS)/action(주문)/status(oauth) 레이아웃과 미등록
    operation_ref는 이 plan_token read/display 경로 범위 밖이라 `None` —
    호출부가 free로 폴백하고 사유를 로그에 남긴다(무음 오배정 금지, 계획
    §5 Guardrails).
    """
    if not operation_ref:
        return None
    mapping = screen_manifest.get_mapping(operation_ref)
    if mapping is None:
        return None
    presentation = mapping.get("presentation", {})
    renderer_id = presentation.get("renderer_id")
    if renderer_id == AITS_CHART_RENDERER_ID:
        return "chart"
    if renderer_id is not None:
        return None
    layout = presentation.get("layout")
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
    presentation = mapping.get("presentation", {})
    layout = presentation.get("layout")
    renderer_id = presentation.get("renderer_id")
    return (
        f"manifest renderer_id={renderer_id!r}, layout={layout!r}"
        f"(operation_ref={operation_ref!r})은 "
        "read/display 카드가 아니다 — free로 폴백한다"
    )


def resolve_chart_initial_period(operation_ref: str | None) -> str | None:
    if not operation_ref:
        return None
    mapping = screen_manifest.get_mapping(operation_ref)
    if mapping is None:
        return None
    controls = mapping.get("presentation", {}).get("controls") or {}
    period = controls.get("default_period")
    return period if isinstance(period, str) and period else None

