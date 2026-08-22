"""Production instrument identity control-plane and selector binding tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app
from athena_api.routing_contract import BindingRole
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.selector.errors import InvalidArgumentsError, NoConfidentMatchError
from athena_api.selector.instrument_identity import InstrumentIdentityIndex
from athena_api.selector.schemas import DiscoveryIntent, ResolveRequest

CONFORMANCE = Path(__file__).parents[1] / "fixtures" / "stock_entity_resolver_conformance.json"


def _market_records() -> dict[str, list[dict[str, str]]]:
    return {
        "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
        "10": [{"code": "035720", "name": "카카오", "marketCode": "10"}],
        "8": [{"code": "069500", "name": "KODEX 200", "marketCode": "8"}],
    }


def _service(index: InstrumentIdentityIndex) -> SelectorService:
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"instrument-identity-test", nonce_factory=lambda: "identity"),
        instrument_identity=index,
    )


def _verified_arguments(service: SelectorService, request: ResolveRequest) -> tuple[str, dict]:
    response = service.resolve(request)
    plan = service.signer.verify(response.plan_token, service.catalog)
    return response.operation_ref, plan.arguments


def test_production_index_matches_shared_python_javascript_conformance() -> None:
    payload = json.loads(CONFORMANCE.read_text(encoding="utf-8"))
    records = {market: [] for market in ("0", "10", "8")}
    for record in payload["records"]:
        market = payload["record_markets"][record["code"]]
        records[market].append({**record, "marketCode": market})
    index = InstrumentIdentityIndex()
    index.replace(records)

    actual = []
    for case in payload["cases"]:
        resolved = index.resolve(case["question"])
        actual.append(
            {
                "id": case["id"],
                "code": resolved.code if resolved else None,
                "kind": resolved.target.entity_kind.value if resolved else None,
            }
        )
    assert actual == [
        {
            "id": case["id"],
            "code": case["expected_code"],
            "kind": case.get("expected_kind"),
        }
        for case in payload["cases"]
    ]


@pytest.mark.parametrize(
    "question",
    (
        "삼성전자와 카카오 현재가",
        "005930 035720 현재가",
        "삼성전자 035720 현재가",
        "삼성전자 말고 현재가",
        "999999 현재가",
        "알 수 없는 회사 현재가",
    ),
)
def test_unknown_multiple_mismatch_and_negation_fail_closed(question: str) -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())

    assert index.resolve(question) is None


async def test_refresh_is_all_or_nothing_and_keeps_old_snapshot_on_failure() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    original = index.snapshot

    async def failing_fetch(market: str):
        if market == "10":
            raise RuntimeError("upstream unavailable")
        return [{"code": "111111", "name": f"새종목{market}", "marketCode": market}]

    with pytest.raises(RuntimeError, match="upstream unavailable"):
        await index.refresh_from(failing_fetch)

    assert index.snapshot is original
    assert index.resolve("삼성전자 현재가").code == "005930"


async def test_refresh_never_publishes_a_partial_market_snapshot() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    reached_last_market = asyncio.Event()
    release_last_market = asyncio.Event()

    async def fetch(market: str):
        if market == "8":
            reached_last_market.set()
            await release_last_market.wait()
        return [
            {
                "code": {"0": "111111", "10": "222222", "8": "333333"}[market],
                "name": f"신규{market}",
                "marketCode": market,
            }
        ]

    refresh = asyncio.create_task(index.refresh_from(fetch))
    await reached_last_market.wait()
    assert index.resolve("삼성전자 현재가").code == "005930"
    assert index.resolve("신규0 현재가") is None
    release_last_market.set()
    assert await refresh == 3
    assert index.resolve("삼성전자 현재가") is None
    assert index.resolve("신규0 현재가").code == "111111"


async def test_generated_ka10099_refresh_uses_only_reviewed_markets() -> None:
    class Client:
        def __init__(self) -> None:
            self.calls = []

        async def post_with_headers(self, tr_id, path, body, options=None):
            from athena_api.kiwoom import ResponseEnvelope

            self.calls.append((tr_id, path, body, options))
            market = body["mrkt_tp"]
            return ResponseEnvelope(
                body={
                    "list": [
                        {
                            "code": {"0": "111111", "10": "222222", "8": "333333"}[
                                market
                            ],
                            "name": f"시장{market}종목",
                            "marketCode": market,
                        }
                    ]
                },
                cont_yn="N",
                next_key=None,
            )

    client = Client()
    index = InstrumentIdentityIndex()

    assert await index.refresh(client) == 3
    assert [call[0] for call in client.calls] == ["ka10099"] * 3
    assert [call[2] for call in client.calls] == [
        {"mrkt_tp": "0"},
        {"mrkt_tp": "10"},
        {"mrkt_tp": "8"},
    ]


def test_live_shaped_mixed_market_response_filters_and_deduplicates_by_returned_market() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())

    accepted = index.replace(
        {
            "0": [
                {"code": "111111", "name": "코스피종목", "marketCode": "0"},
                {"code": "333333", "name": "중복ETF", "marketCode": "8"},
                {"code": "666666", "name": "리츠", "marketCode": "6"},
                {"code": "A12345", "name": "영문코드", "marketCode": "0"},
                {"code": "12345A", "name": "혼합코드", "marketCode": "8"},
            ],
            "10": [
                {"code": "222222", "name": "코스닥종목", "marketCode": "10"},
                {"code": "Q22222", "name": "코스닥혼합", "marketCode": "10"},
            ],
            "8": [
                {"code": "333333", "name": "중복ETF", "marketCode": "8"},
                {"code": "444444", "name": "단독ETF", "marketCode": "8"},
                {"code": "E44444", "name": "ETF혼합", "marketCode": "8"},
            ],
        }
    )

    assert accepted == 4
    assert index.resolve("코스피종목 현재가").target.entity_kind.value == "stock"
    assert index.resolve("코스닥종목 현재가").target.entity_kind.value == "stock"
    assert index.resolve("중복ETF 현재가").target.entity_kind.value == "etf"
    assert index.resolve("단독ETF 현재가").target.entity_kind.value == "etf"
    assert index.resolve("리츠 현재가") is None
    assert index.resolve("A12345 현재가") is None


@pytest.mark.parametrize(
    ("question", "arguments", "expected_ref", "expected_code"),
    (
        ("삼성전자 오늘 주가 얼마야?", {}, "detail:ka10001:current_trading", "005930"),
        (
            "삼성전자 일봉 차트 보여줘",
            {"base_dt": "20260821", "upd_stkpc_tp": "1"},
            "base:ka10081",
            "005930",
        ),
        ("Show KODEX 200 ETF information", {}, "base:ka40002", "069500"),
        (
            "Show today's time-stamped NAV observations for KODEX 200",
            {},
            "base:ka40009",
            "069500",
        ),
    ),
)
def test_name_resolved_query_injects_only_the_trusted_stk_cd(
    question: str, arguments: dict, expected_ref: str, expected_code: str
) -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)

    operation_ref, planned = _verified_arguments(
        service, ResolveRequest(question=question, arguments=arguments)
    )

    assert operation_ref == expected_ref
    assert planned["stk_cd"] == expected_code


def test_name_and_code_substitution_changes_only_signed_stk_cd() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)

    name_ref, name_arguments = _verified_arguments(
        service, ResolveRequest(question="삼성전자 오늘 주가 얼마야?", arguments={})
    )
    code_ref, code_arguments = _verified_arguments(
        service, ResolveRequest(question="005930 오늘 주가 얼마야?", arguments={})
    )

    assert name_ref == code_ref == "detail:ka10001:current_trading"
    assert name_arguments == code_arguments == {"stk_cd": "005930"}


def test_same_caller_code_is_accepted_but_mismatch_is_rejected_before_plan() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)

    operation_ref, arguments = _verified_arguments(
        service,
        ResolveRequest(
            question="삼성전자 오늘 주가 얼마야?",
            arguments={"stk_cd": "005930"},
        ),
    )
    assert operation_ref == "detail:ka10001:current_trading"
    assert arguments == {"stk_cd": "005930"}

    with pytest.raises(InvalidArgumentsError, match="does not match"):
        service.resolve(
            ResolveRequest(
                question="삼성전자 오늘 주가 얼마야?",
                arguments={"stk_cd": "035720"},
            )
        )


def test_unavailable_identity_never_uses_caller_code_as_semantic_authority() -> None:
    service = _service(InstrumentIdentityIndex())

    with pytest.raises(NoConfidentMatchError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 오늘 주가 얼마야?",
                arguments={"stk_cd": "005930"},
            )
        )


def test_order_and_websocket_surfaces_never_auto_bind_stk_cd() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)
    order = service.catalog.by_ref["base:kt10000"]
    websocket = service.catalog.by_ref["base:0B"]

    assert service._bind_trusted_instrument(
        order, {}, trusted_code="005930", intent=DiscoveryIntent.ORDER
    ) == {}
    assert service._bind_trusted_instrument(
        websocket, {}, trusted_code="005930", intent=DiscoveryIntent.WEBSOCKET
    ) == {}

    with pytest.raises(InvalidArgumentsError) as order_error:
        service.resolve(
            ResolveRequest(
                question="삼성전자 한 주를 시장가로 매수해줘",
                intent=DiscoveryIntent.ORDER,
                arguments={"dmst_stex_tp": "KRX", "ord_qty": "1", "trde_tp": "3"},
            )
        )
    assert order_error.value.details["errors"][0]["loc"] == ("stk_cd",)

    websocket_response = service.resolve(
        ResolveRequest(
            question="삼성전자 실시간 체결 스트림 구독해줘",
            intent=DiscoveryIntent.WEBSOCKET,
            arguments={
                "trnm": "REG",
                "grp_no": "1",
                "refresh": "1",
                "data": [{"item": "005930", "type": "0B"}],
            },
        )
    )
    websocket_plan = service.signer.verify(websocket_response.plan_token, service.catalog)
    assert websocket_response.operation_ref == "base:0B"
    assert "stk_cd" not in websocket_plan.arguments
    assert websocket_plan.arguments["data"] == [{"item": "005930", "type": "0B"}]


def test_natural_order_validates_trusted_code_without_auto_binding() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)
    order_arguments = {
        "dmst_stex_tp": "KRX",
        "stk_cd": "005930",
        "ord_qty": "1",
        "trde_tp": "3",
    }

    matching = service.resolve(
        ResolveRequest(
            question="삼성전자 한 주를 시장가로 매수해줘",
            intent=DiscoveryIntent.ORDER,
            arguments=order_arguments,
        )
    )
    matching_plan = service.signer.verify(matching.plan_token, service.catalog)
    assert matching.operation_ref == "base:kt10000"
    assert matching_plan.arguments["stk_cd"] == "005930"

    with pytest.raises(InvalidArgumentsError, match="does not match"):
        service.resolve(
            ResolveRequest(
                question="삼성전자 한 주를 시장가로 매수해줘",
                intent=DiscoveryIntent.ORDER,
                arguments={**order_arguments, "stk_cd": "035720"},
            )
        )

    with pytest.raises(InvalidArgumentsError) as missing:
        service.resolve(
            ResolveRequest(
                question="삼성전자 한 주를 시장가로 매수해줘",
                intent=DiscoveryIntent.ORDER,
                arguments={key: value for key, value in order_arguments.items() if key != "stk_cd"},
            )
        )
    assert missing.value.details["errors"][0]["loc"] == ("stk_cd",)


def test_exact_order_identity_does_not_apply_ambient_instrument_resolution() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)

    resolved = service.resolve(
        ResolveRequest(
            question="base:kt10000",
            intent=DiscoveryIntent.ORDER,
            arguments={
                "dmst_stex_tp": "KRX",
                "stk_cd": "035720",
                "ord_qty": "1",
                "trde_tp": "3",
            },
        )
    )
    plan = service.signer.verify(resolved.plan_token, service.catalog)
    assert resolved.operation_ref == "base:kt10000"
    assert plan.arguments["stk_cd"] == "035720"


def test_exact_query_identity_never_auto_binds_from_ambient_question_state() -> None:
    index = InstrumentIdentityIndex()
    index.replace(_market_records())
    service = _service(index)

    with pytest.raises(InvalidArgumentsError) as exc_info:
        service.resolve(
            ResolveRequest(
                question="base:ka10081",
                arguments={"base_dt": "20260821", "upd_stkpc_tp": "1"},
            )
        )
    assert exc_info.value.details["errors"][0]["loc"] == ("stk_cd",)


def test_all_instrument_bound_query_families_have_exactly_one_stk_cd_alias() -> None:
    catalog = build_operation_catalog()
    instrument_families = [
        document
        for document in catalog.documents
        if document.kind == "query"
        and document.group_id is None
        and BindingRole.INSTRUMENT_CODE in document.routing.bindings
    ]
    stk_cd_families = [
        document
        for document in catalog.documents
        if document.kind == "query"
        and document.group_id is None
        and "stk_cd"
        in {field.alias or name for name, field in document.request_model.model_fields.items()}
    ]

    # ka10010's upstream field is named stk_cd, but it carries a sector code.  Assert
    # the exact semantic partition instead of pinning a brittle catalog count.
    instrument_refs = {document.operation_ref for document in instrument_families}
    stk_cd_refs = {document.operation_ref for document in stk_cd_families}
    assert stk_cd_refs - instrument_refs == {"base:ka10010"}
    assert catalog.by_ref["base:ka10010"].routing.bindings == (
        BindingRole.SECTOR_CODE,
    )
    assert {
        document.operation_ref: [
            field.alias or name
            for name, field in document.request_model.model_fields.items()
            if (field.alias or name) == "stk_cd"
        ]
        for document in instrument_families
    } == {document.operation_ref: ["stk_cd"] for document in instrument_families}


def test_lifespan_publishes_one_app_local_identity_index_and_selector() -> None:
    app = create_app(Settings(_env_file=None))

    with TestClient(app):
        assert app.state.selector_service._instrument_identity is app.state.instrument_identity
        assert app.state.instrument_identity.size == 0
