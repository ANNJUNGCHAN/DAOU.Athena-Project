"""Generate type-valid, lossless fixtures for all integrated Canvas cards.

The factory is intentionally fixture-only.  It imports response models and the
generated field registry, but never constructs a Kiwoom client or invokes a
route.  Order operations therefore remain inert synthetic payloads.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from athena_api.canvas_card_registry import get_canvas_card_registry  # noqa: E402
from athena_api.canvas_field_registry import get_operation_field_contract  # noqa: E402
from athena_api.canvas_transform import (  # noqa: E402
    build_compound_generic,
    build_facts,
    build_table,
)

ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
AITS_CONTRACTS_PATH = BACKEND / "ref" / "aits-chart-contracts.json"


def _orderbook_fixture_fields() -> list[dict[str, str]]:
    """Return a two-sided, renderer-valid orderbook snapshot.

    A detail projection intentionally contains only one semantic slice.  The
    screenshot fixture instead exercises the integrated orderbook renderer, so
    it needs one coherent synthetic snapshot with both sides populated.
    """

    fields: list[dict[str, str]] = [
        {"key": "stk_cd", "label": "종목코드", "value": "005930"},
        {"key": "stk_nm", "label": "종목명", "value": "삼성전자"},
        {"key": "bid_req_base_tm", "label": "호가 기준 시각", "value": "153000"},
        {"key": "sel_bid_tot_req", "label": "총매도 잔량", "value": "185400"},
        {"key": "buy_bid_tot_req", "label": "총매수 잔량", "value": "214700"},
    ]
    for level in range(1, 11):
        ask_price = 72100 + (level - 1) * 100
        bid_price = 72000 - (level - 1) * 100
        fields.extend(
            [
                {"key": f"sel_{level}bid", "label": f"매도 {level}호가", "value": str(ask_price)},
                {
                    "key": f"sel_{level}bid_req",
                    "label": f"매도 {level}호가 잔량",
                    "value": str(9200 + level * 730),
                },
                {"key": f"buy_{level}bid", "label": f"매수 {level}호가", "value": str(bid_price)},
                {
                    "key": f"buy_{level}bid_req",
                    "label": f"매수 {level}호가 잔량",
                    "value": str(10400 + level * 810),
                },
            ]
        )
    return fields


def _chart_fixture_candles() -> list[dict[str, float | str]]:
    """Return a deterministic multi-candle series for the real AITS panel."""

    closes = (71200.0, 71600.0, 71300.0, 72100.0, 72400.0, 72700.0)
    candles: list[dict[str, float | str]] = []
    for index, close in enumerate(closes):
        open_price = closes[index - 1] if index else 70900.0
        candles.append(
            {
                "time": f"2026-08-{24 + index:02d}",
                "open": open_price,
                "high": max(open_price, close) + 500.0,
                "low": min(open_price, close) - 400.0,
                "close": close,
                "volume": 8_400_000.0 + index * 620_000.0,
            }
        )
    return candles


def build_recipe_display_sections() -> dict[str, dict[str, dict[str, Any]]]:
    """Return concise, deterministic product fixtures for semantic screenshots."""

    def fields(*items: tuple[str, object]) -> dict[str, object]:
        return {
            "fields": [
                {
                    "label_ko": label,
                    "value": value,
                    "display_tier": "primary" if index < 3 else "support",
                    "display_order": index + 1,
                    "visibility_policy": "always",
                }
                for index, (label, value) in enumerate(items)
            ]
        }

    def table(
        columns: tuple[tuple[str, str], ...], rows: list[dict[str, object]]
    ) -> dict[str, object]:
        return {
            "columns": [
                {
                    "key": key,
                    "label_ko": label,
                    "display_tier": "primary",
                    "display_order": index + 1,
                    "visibility_policy": "always",
                }
                for index, (key, label) in enumerate(columns)
            ],
            "rows": rows,
        }

    return {
        "instrument-chart": {
            "identity-and-quote": fields(
                ("종목", "삼성전자 · 005930"),
                ("현재가", "72,700원"),
                ("등락률", "+0.41%"),
            ),
            "price-history": fields(
                ("조회 기간", "2026-08-24 ~ 2026-08-29"),
                ("기간 고가", "73,200원"),
                ("기간 저가", "70,500원"),
            ),
            "volume-and-period": fields(
                ("최근 거래량", "11,500,000주"),
                ("평균 거래량", "9,950,000주"),
            ),
        },
        "why-move-flow": {
            "move-summary": fields(
                ("현재가", "72,400원"), ("전일 대비", "+800원"), ("등락률", "+1.12%")
            ),
            "participant-flow": table(
                (("broker", "거래원"), ("buy", "매수"), ("sell", "매도"), ("net", "순매수")),
                [
                    {
                        "broker": "미래에셋증권",
                        "buy": "185,400주",
                        "sell": "122,300주",
                        "net": "+63,100주",
                    },
                    {
                        "broker": "키움증권",
                        "buy": "148,900주",
                        "sell": "171,200주",
                        "net": "-22,300주",
                    },
                    {
                        "broker": "NH투자증권",
                        "buy": "96,700주",
                        "sell": "83,400주",
                        "net": "+13,300주",
                    },
                ],
            ),
            "position-and-risk": fields(
                ("외국인 순매수", "+41,800주"),
                ("기관 순매수", "+27,600주"),
                ("개인 순매수", "-69,400주"),
            ),
        },
        "discovery-value": {
            "ranked-results": table(
                (
                    ("rank", "순위"),
                    ("name", "종목"),
                    ("code", "코드"),
                    ("price", "현재가"),
                    ("per", "PER"),
                    ("pbr", "PBR"),
                    ("roe", "ROE"),
                ),
                [
                    {
                        "rank": 1,
                        "name": "삼성전자",
                        "code": "005930",
                        "price": "72,400원",
                        "per": "18.7배",
                        "pbr": "1.42배",
                        "roe": "8.4%",
                    },
                    {
                        "rank": 2,
                        "name": "SK하이닉스",
                        "code": "000660",
                        "price": "186,500원",
                        "per": "8.9배",
                        "pbr": "1.67배",
                        "roe": "19.7%",
                    },
                ],
            ),
            "valuation-and-profile": fields(
                ("선별 기준", "대형주 · 수익성"), ("평균 PER", "13.8배"), ("평균 ROE", "14.1%")
            ),
        },
        "sector-theme": {
            "market-group-summary": fields(
                ("주도 업종", "반도체"), ("주도 테마", "AI 인프라"), ("상승 종목 비중", "68%")
            ),
            "group-performance": table(
                (("group", "업종·테마"), ("change", "등락률"), ("leader", "대표 종목")),
                [
                    {"group": "반도체", "change": "+2.4%", "leader": "삼성전자"},
                    {"group": "AI 소프트웨어", "change": "+1.7%", "leader": "NAVER"},
                ],
            ),
            "constituents": table(
                (("name", "종목"), ("code", "코드"), ("price", "현재가"), ("change", "등락률")),
                [
                    {"name": "삼성전자", "code": "005930", "price": "72,400원", "change": "+1.12%"},
                    {
                        "name": "SK하이닉스",
                        "code": "000660",
                        "price": "186,500원",
                        "change": "+3.06%",
                    },
                ],
            ),
        },
        "watchlist-condition": {
            "matching-instruments": table(
                (("name", "종목"), ("code", "코드"), ("price", "현재가"), ("change", "등락률")),
                [
                    {"name": "삼성전자", "code": "005930", "price": "72,400원", "change": "+1.12%"},
                    {
                        "name": "SK하이닉스",
                        "code": "000660",
                        "price": "186,500원",
                        "change": "+3.06%",
                    },
                ],
            ),
            "condition-status": fields(
                ("저장 조건", "대형주 모멘텀"), ("일치 종목", "2개"), ("마지막 평가", "15:30")
            ),
        },
        "etf-product": {
            "etf-summary": fields(
                ("ETF", "KODEX 200"), ("종목코드", "069500"), ("현재가", "36,120원")
            ),
            "nav-and-performance": fields(
                ("NAV", "36,085.42원"),
                ("괴리율", "+0.10%"),
                ("과세", "국내주식형 · 매매차익 비과세"),
            ),
            "constituents": table(
                (("name", "구성 종목"), ("code", "코드"), ("weight", "비중")),
                [
                    {"name": "삼성전자", "code": "005930", "weight": "24.6%"},
                    {"name": "SK하이닉스", "code": "000660", "weight": "8.8%"},
                ],
            ),
        },
        "elw-product": {
            "elw-summary": fields(
                ("ELW", "삼성전자 콜 2703 75000"), ("종목코드", "58K123"), ("현재가", "1,245원")
            ),
            "sensitivity-and-expiry": fields(
                ("행사가", "75,000원"), ("만기일", "2027-03-18"), ("델타", "0.42")
            ),
            "liquidity-provider": fields(
                ("LP", "미래에셋증권"), ("매수호가", "1,235원"), ("매도호가", "1,255원")
            ),
        },
        "market-vi": {
            "market-state": fields(
                ("시장", "KOSPI"), ("장 상태", "정규장 · 정상 운영"), ("기준 시각", "15:30")
            ),
            "vi-events": table(
                (("time", "시각"), ("name", "종목"), ("direction", "방향"), ("trigger", "발동가")),
                [
                    {
                        "time": "14:42:18",
                        "name": "삼성전자",
                        "direction": "상승",
                        "trigger": "72,900원",
                    },
                    {
                        "time": "13:17:06",
                        "name": "SK하이닉스",
                        "direction": "상승",
                        "trigger": "188,000원",
                    },
                ],
            ),
            "affected-instruments": table(
                (("name", "종목"), ("code", "코드"), ("status", "상태")),
                [
                    {"name": "삼성전자", "code": "005930", "status": "VI 해제"},
                    {"name": "SK하이닉스", "code": "000660", "status": "VI 감시"},
                ],
            ),
        },
        "account-risk": {
            "account-summary": fields(
                ("추정 자산", "52,480,000원"),
                ("예수금", "8,240,000원"),
                ("당일 손익", "+640,000원"),
            ),
            "positions-and-performance": table(
                (
                    ("name", "보유 종목"),
                    ("code", "코드"),
                    ("qty", "수량"),
                    ("avg", "평균단가"),
                    ("current", "현재가"),
                    ("pnl", "평가손익"),
                ),
                [
                    {
                        "name": "삼성전자",
                        "code": "005930",
                        "qty": "40주",
                        "avg": "68,500원",
                        "current": "72,400원",
                        "pnl": "+156,000원",
                    },
                    {
                        "name": "SK하이닉스",
                        "code": "000660",
                        "qty": "15주",
                        "avg": "172,000원",
                        "current": "186,500원",
                        "pnl": "+217,500원",
                    },
                ],
            ),
            "settlement-and-risk": fields(
                ("주문 가능 금액", "7,860,000원"), ("미수금", "0원"), ("총 평가손익률", "+4.31%")
            ),
        },
        "gold-market": {
            "gold-summary": fields(
                ("상품", "KRX 금 99.99"), ("상품코드", "04020000"), ("현재가", "128,450원/g")
            ),
            "gold-market-data": fields(
                ("시가", "127,800원/g"),
                ("고가", "129,100원/g"),
                ("저가", "127,350원/g"),
                ("거래량", "84,320g"),
                ("전일 대비", "+650원 · +0.51%"),
            ),
        },
    }


@dataclass(frozen=True, slots=True)
class FixtureOccurrence:
    occurrence_id: str
    mapping_id: str
    json_path: str
    ordinal: int
    alias: str
    sentinel_id: str
    wire_value: object
    card_id: str
    card_kind: str
    capability_id: str
    mode: str
    section: str
    surface: str
    label: str
    semantic_status: str


@dataclass(frozen=True, slots=True)
class OperationFixture:
    mapping_id: str
    response_model: str
    payload: dict[str, Any]
    validated_payload: dict[str, Any]
    occurrences: tuple[FixtureOccurrence, ...]
    canvas_type: str
    screen_id: str
    renderer_id: str | None
    primary_data: dict[str, Any]


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _load_response_model(import_path: str) -> type[BaseModel]:
    module_name, class_name = import_path.rsplit(".", 1)
    model = getattr(importlib.import_module(module_name), class_name)
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise TypeError(f"response contract is not a Pydantic model: {import_path}")
    return model


def _wire_value(mapping_id: str, json_path: str, alias: str) -> object:
    sentinel = f"fixture::{mapping_id}::{json_path}"
    # ka10173's real-time values field is the only manifest scalar path backed
    # by a dict model field.  Keep the wire dict empty so its contract covers
    # exactly $.values rather than inventing an uncontracted child key; the
    # occurrence-specific sentinel is carried by field_contract.value.
    if alias == "values" and mapping_id == "base:ka10173":
        return {}
    return sentinel


def _payload_from_contracts(mapping_id: str, contracts: list[dict[str, object]]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    nested: dict[str, dict[str, object]] = {}
    for contract in contracts:
        json_path = str(contract["json_path"])
        alias = str(contract["alias"])
        value = _wire_value(mapping_id, json_path, alias)
        if "[]" not in json_path:
            # Repeated wire aliases (ka10173 trnm/data) intentionally share one
            # payload slot while retaining distinct occurrence identities.
            payload[alias] = value
            continue
        container = json_path[2:].split("[]", 1)[0]
        nested.setdefault(container, {})[alias] = value
    for container, item in nested.items():
        payload[container] = [item]
    return payload


def _primary_projection(
    mapping: dict[str, Any], payload: dict[str, Any]
) -> tuple[str, str | None, dict[str, Any]]:
    presentation = mapping["presentation"]
    renderer_id = presentation.get("renderer_id")
    canvas_type = "chart" if renderer_id == "aits-chart-v1" else presentation["layout"]
    if canvas_type == "facts":
        built = build_facts(payload)
    elif canvas_type == "table":
        built = build_table({"data": payload})
    elif canvas_type == "compound":
        built = build_compound_generic(payload)
    elif canvas_type == "action":
        return (
            canvas_type,
            renderer_id,
            {
                "order_draft": {
                    "dmst_stex_tp": "KRX",
                    "stk_cd": "005930",
                    "ord_qty": "10",
                    "trde_tp": "3",
                },
                # The production order CardKind reads the allowlisted display
                # projection while the guarded selector contract remains available
                # as order_draft.  Neither shape can execute an order here.
                "order": {
                    "stk_cd": "005930",
                    "stk_nm": "삼성전자",
                    "ord_qty": "10",
                    "side": "매수",
                },
                "state_label": "확인 대기",
                "state": "draft",
            },
        )
    elif canvas_type == "event":
        return (
            canvas_type,
            renderer_id,
            {
                "lifecycle": "connected",
                "state_label": "fixture 실시간 등록됨",
                "records": [{"상태": "fixture 실시간 등록됨"}],
            },
        )
    elif canvas_type == "chart":
        chart_contracts = _read_json(AITS_CONTRACTS_PATH)["contracts"]
        by_tr_id = {item["tr_id"]: item for item in chart_contracts}
        tr_id = mapping["operation"]["tr_id"]
        contract = by_tr_id[tr_id]
        return (
            canvas_type,
            renderer_id,
            {
                "symbol": "005930",
                "chart": {
                    "period": contract["period"],
                    "target": contract["target"],
                    "trId": tr_id,
                    "candles": _chart_fixture_candles(),
                },
                "chart_meta": {
                    "series_scope": contract["series_scope"],
                    "reload_group": contract["reload_group"],
                    "reload_targets": {},
                },
            },
        )
    else:
        raise AssertionError(f"unsupported fixture canvas_type: {canvas_type}")
    if isinstance(built, str):
        raise AssertionError(
            f"{mapping['mapping_id']} canonical {canvas_type} projection failed: {built}"
        )
    primary = built[0]
    if mapping["mapping_id"] == "detail:ka10004:buy_bid_prices":
        primary = {"fields": _orderbook_fixture_fields()}
    return canvas_type, renderer_id, primary


def build_operation_fixtures() -> tuple[OperationFixture, ...]:
    assignment = _read_json(ASSIGNMENT_PATH)
    manifest = _read_json(MANIFEST_PATH)
    assigned = {
        mapping_id
        for capability in assignment["capabilities"]
        for mapping_id in capability["mapping_ids"]
    }
    mappings = {
        mapping["mapping_id"]: mapping
        for mapping in manifest["mappings"]
        if mapping["mapping_id"] in assigned
    }
    if set(mappings) != assigned:
        raise AssertionError("assigned operations and common-screen manifest drifted")

    fixtures: list[OperationFixture] = []
    for mapping_id in sorted(assigned):
        mapping = mappings[mapping_id]
        contracts = get_operation_field_contract(mapping_id)
        payload = _payload_from_contracts(mapping_id, contracts)
        response_model_path = mapping["contracts"]["response_model"]
        response_model = _load_response_model(response_model_path)
        validated = response_model.model_validate(payload).model_dump(by_alias=True, mode="json")
        canvas_type, renderer_id, primary_data = _primary_projection(mapping, validated)
        occurrences = tuple(
            FixtureOccurrence(
                occurrence_id=str(contract["occurrence_id"]),
                mapping_id=mapping_id,
                json_path=str(contract["json_path"]),
                ordinal=int(contract["ordinal"]),
                alias=str(contract["alias"]),
                sentinel_id=f"sentinel::{contract['occurrence_id']}",
                wire_value=_wire_value(
                    mapping_id,
                    str(contract["json_path"]),
                    str(contract["alias"]),
                ),
                card_id=str(contract["card_id"]),
                card_kind=str(contract["card_kind"]),
                capability_id=str(contract["capability_id"]),
                mode=str(contract["mode"]),
                section=str(contract["section"]),
                surface=str(contract["surface"]),
                label=str(contract["label"]),
                semantic_status=str(contract["semantic_status"]),
            )
            for contract in contracts
        )
        fixtures.append(
            OperationFixture(
                mapping_id=mapping_id,
                response_model=response_model_path,
                payload=payload,
                validated_payload=validated,
                occurrences=occurrences,
                canvas_type=canvas_type,
                screen_id=str(mapping["screen_reference"]["screen_id"]),
                renderer_id=renderer_id,
                primary_data=primary_data,
            )
        )
    return tuple(fixtures)


def build_fixture_bundle() -> dict[str, object]:
    fixtures = build_operation_fixtures()
    registry = get_canvas_card_registry()
    operations_by_card: dict[str, list[str]] = {card.card_id: [] for card in registry.cards}
    fields_by_card: dict[str, list[dict[str, object]]] = {
        card.card_id: [] for card in registry.cards
    }
    for fixture in fixtures:
        card_id = fixture.occurrences[0].card_id
        operations_by_card[card_id].append(fixture.mapping_id)
        fields_by_card[card_id].extend(
            {
                **asdict(occurrence),
                "wire_value": occurrence.wire_value,
            }
            for occurrence in fixture.occurrences
        )

    cards = []
    for card in registry.cards:
        fields = fields_by_card[card.card_id]
        operations = operations_by_card[card.card_id]
        operation_set = set(operations)
        card_fixtures = [fixture for fixture in fixtures if fixture.mapping_id in operation_set]
        cards.append(
            {
                "card_id": card.card_id,
                "card_kind": card.card_kind,
                "operation_count": len(operations),
                "field_count": len(fields),
                "operations": operations,
                "fields": fields,
                "operation_fixtures": [
                    {
                        "operation_ref": fixture.mapping_id,
                        "capability_id": fixture.occurrences[0].capability_id,
                        "mode": fixture.occurrences[0].mode,
                        "section": fixture.occurrences[0].section,
                        "canvas_type": fixture.canvas_type,
                        "screen_id": fixture.screen_id,
                        "renderer_id": fixture.renderer_id,
                        "primary_data": fixture.primary_data,
                        "raw_data": fixture.payload,
                        "field_contract": [
                            {
                                **contract,
                                "value": f"sentinel::{contract['occurrence_id']}",
                            }
                            for contract in get_operation_field_contract(fixture.mapping_id)
                        ],
                    }
                    for fixture in card_fixtures
                ],
                "opaque_count": sum(
                    field["semantic_status"] == "official_opaque" for field in fields
                ),
                "realtime_required": any(
                    operation.startswith("base:0")
                    or operation
                    in {
                        "base:ka10171",
                        "base:ka10172",
                        "base:ka10173",
                        "base:ka10174",
                    }
                    for operation in operations
                ),
            }
        )

    path_counts = Counter(
        (occurrence.mapping_id, occurrence.json_path)
        for fixture in fixtures
        for occurrence in fixture.occurrences
    )
    return {
        "fixture_only": True,
        "external_calls_allowed": False,
        "operation_count": len(fixtures),
        "field_occurrence_count": sum(len(item.occurrences) for item in fixtures),
        "unique_field_path_count": len(path_counts),
        "duplicate_paths": [
            {"mapping_id": key[0], "json_path": key[1], "count": count}
            for key, count in sorted(path_counts.items())
            if count > 1
        ],
        "cards": cards,
    }


def _main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    bundle = build_fixture_bundle()
    if args.json:
        # ASCII escapes make the pipe deterministic on Windows code pages;
        # JSON.parse restores the original Korean labels in Electron.
        print(json.dumps(bundle, ensure_ascii=True, separators=(",", ":")))
    else:
        print(json.dumps(bundle, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _main()
