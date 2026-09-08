"""Production instrument identity control-plane and selector binding tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app
from athena_api.routing_contract import BindingRole
from athena_api.selector import (
    PlanSigner,
    SelectorService,
    build_operation_catalog,
    instrument_identity,
)
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


def test_snapshot_build_defers_alias_regex_compilation_until_resolve(monkeypatch) -> None:
    calls: list[str] = []
    original = instrument_identity._alias_pattern

    def counted(alias: str):
        calls.append(alias)
        return original(alias)

    monkeypatch.setattr(instrument_identity, "_alias_pattern", counted)
    index = InstrumentIdentityIndex()

    index.replace(_market_records())

    assert calls == []
    assert index.resolve("삼성전자 현재가").code == "005930"
    assert calls == ["삼성전자"]


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


def test_sqlite_master_persists_across_index_instances(tmp_path: Path) -> None:
    db_path = tmp_path / "instruments.sqlite3"
    writer = InstrumentIdentityIndex(db_path=db_path)
    writer.replace(_market_records())

    restarted = InstrumentIdentityIndex(db_path=db_path)

    resolved = restarted.resolve("삼성전자 현재가")
    assert resolved is not None
    assert (resolved.code, resolved.name, resolved.market) == ("005930", "삼성전자", "0")
    assert restarted.status()[0:2] == (True, 3)
    assert restarted.refreshed_at is not None


async def test_sqlite_refresh_keeps_previous_commit_visible_until_full_replace(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "instruments.sqlite3"
    writer = InstrumentIdentityIndex(db_path=db_path)
    writer.replace(_market_records())
    reader = InstrumentIdentityIndex(db_path=db_path)
    reached_last_market = asyncio.Event()
    release_last_market = asyncio.Event()

    async def fetch(market: str):
        if market == "8":
            reached_last_market.set()
            await release_last_market.wait()
        return [{"code": {"0": "111111", "10": "222222", "8": "333333"}[market],
                 "name": f"신규{market}", "marketCode": market}]

    task = asyncio.create_task(writer.refresh_from(fetch))
    await reached_last_market.wait()
    assert reader.resolve("삼성전자 현재가").code == "005930"
    assert reader.resolve("신규0 현재가") is None
    release_last_market.set()
    assert await task == 3
    assert reader.resolve("삼성전자 현재가") is None
    assert reader.resolve("신규0 현재가").code == "111111"


def test_duplicate_normalized_name_is_ambiguous_in_sqlite(tmp_path: Path) -> None:
    index = InstrumentIdentityIndex(db_path=tmp_path / "instruments.sqlite3")
    index.replace(
        {
            "0": [{"code": "111111", "name": "동명이", "marketCode": "0"}],
            "10": [{"code": "222222", "name": "동명이", "marketCode": "10"}],
            "8": [{"code": "333333", "name": "다른 ETF", "marketCode": "8"}],
        }
    )

    assert index.resolve("동명이 현재가") is None


async def test_refresh_loop_runs_immediately_and_then_on_interval() -> None:
    from athena_api.lifespan import _instrument_identity_refresh_loop

    refreshed_twice = asyncio.Event()

    class RecordingIndex:
        calls = 0

        async def refresh(self, _client: object) -> int:
            self.calls += 1
            if self.calls >= 2:
                refreshed_twice.set()
            return 1

    index = RecordingIndex()
    app = SimpleNamespace(
        state=SimpleNamespace(
            instrument_identity_wakeup=asyncio.Event(),
            kiwoom_client=SimpleNamespace(is_ready=True),
        )
    )
    task = asyncio.create_task(_instrument_identity_refresh_loop(app, index, 0.01))
    try:
        await asyncio.wait_for(refreshed_twice.wait(), timeout=1)
        assert index.calls >= 2
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_refresh_loop_uses_runtime_account_selected_after_start() -> None:
    from athena_api.lifespan import _instrument_identity_refresh_loop

    refreshed = asyncio.Event()
    first_client = SimpleNamespace(is_ready=True, alias="first")
    second_client = SimpleNamespace(is_ready=True, alias="second")

    class RecordingIndex:
        clients: list[object] = []

        async def refresh(self, client: object) -> int:
            self.clients.append(client)
            refreshed.set()
            return 1

    index = RecordingIndex()
    wakeup = asyncio.Event()
    app = SimpleNamespace(
        state=SimpleNamespace(
            instrument_identity_wakeup=wakeup,
            kiwoom_client=first_client,
        )
    )
    task = asyncio.create_task(_instrument_identity_refresh_loop(app, index, 3600))
    try:
        await asyncio.wait_for(refreshed.wait(), timeout=1)
        refreshed.clear()
        app.state.kiwoom_client = second_client
        wakeup.set()
        await asyncio.wait_for(refreshed.wait(), timeout=1)
        assert index.clients == [first_client, second_client]
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


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


async def test_ka10099_continuation_is_fully_collected_before_commit(tmp_path: Path) -> None:
    from athena_api.kiwoom import ResponseEnvelope

    class Client:
        calls: list[tuple[str, str | None]] = []

        async def post_with_headers(self, _tr_id, _path, body, options=None):
            market = body["mrkt_tp"]
            next_key = getattr(options, "next_key", None)
            self.calls.append((market, next_key))
            page = "2" if next_key else "1"
            return ResponseEnvelope(
                body={
                    "return_code": 0,
                    "list": [{
                        "code": f"{int(market):02d}{page}001".zfill(6),
                        "name": f"시장{market}페이지{page}",
                        "marketCode": market,
                    }],
                },
                cont_yn="N" if next_key else "Y",
                next_key=None if next_key else f"next-{market}",
            )

    index = InstrumentIdentityIndex(db_path=tmp_path / "instruments.sqlite3")
    assert await index.refresh(Client()) == 6
    assert Client.calls == [
        ("0", None), ("0", "next-0"),
        ("10", None), ("10", "next-10"),
        ("8", None), ("8", "next-8"),
    ]


async def test_non_success_ka10099_never_replaces_last_good_master(tmp_path: Path) -> None:
    from athena_api.kiwoom import ResponseEnvelope

    class Client:
        async def post_with_headers(self, _tr_id, _path, _body, options=None):
            return ResponseEnvelope(
                body={"return_code": 17, "return_msg": "failed", "list": []},
                cont_yn="N",
                next_key=None,
            )

    index = InstrumentIdentityIndex(db_path=tmp_path / "instruments.sqlite3")
    index.replace(_market_records())

    with pytest.raises(ValueError, match="non-success"):
        await index.refresh(Client())

    assert index.resolve("삼성전자 현재가").code == "005930"


async def test_empty_market_response_never_replaces_last_good_master(tmp_path: Path) -> None:
    index = InstrumentIdentityIndex(db_path=tmp_path / "instruments.sqlite3")
    index.replace(_market_records())

    async def fetch(market: str):
        if market == "10":
            return []
        return [{"code": "111111", "name": f"시장{market}", "marketCode": market}]

    with pytest.raises(ValueError, match="returned no records"):
        await index.refresh_from(fetch)

    assert index.resolve("삼성전자 현재가").code == "005930"


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


def test_lifespan_publishes_one_app_local_identity_index_and_selector(tmp_path: Path) -> None:
    app = create_app(
        Settings(_env_file=None, instrument_db_path=tmp_path / "instruments.sqlite3")
    )

    with TestClient(app):
        assert app.state.selector_service._instrument_identity is app.state.instrument_identity
        assert app.state.instrument_identity.size == 0


# --- 기동 순서: 식별 인덱스 갱신은 기동을 막지 않는다 (2026-09-07) --------------------------
# 별칭 정규식 3,500여 개 컴파일이 30초 안팎(앱 부팅과 겹치면 60초 이상)이라 lifespan이 이를
# 기다리면 앱 launcher의 60초 준비 한도를 넘긴다. 갱신은 백그라운드 태스크로 돌고,
# 끝나기 전에는 빈 스냅숏(fail-closed), teardown이 태스크를 취소한다.

_IDENTITY_STARTUP_ACCOUNTS = (
    '[{"alias":"identity-test","app_key":"key-identity","secret_key":"secret-identity"}]'
)


def _identity_startup_settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        kiwoom_accounts=_IDENTITY_STARTUP_ACCOUNTS,
        kiwoom_default_account="identity-test",
        instrument_db_path=tmp_path / "instruments.sqlite3",
    )


async def _offline_websocket(_url: str):
    raise ConnectionError("offline test")


def _mock_kiwoom_token(mock) -> None:
    from datetime import datetime, timedelta

    import httpx

    expires = datetime.now() + timedelta(hours=1)
    mock.post("/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "return_code": 0,
                "token": "identity-token",
                "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
            },
        )
    )


async def test_lifespan_startup_does_not_wait_for_identity_refresh_and_cancels_it_on_exit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import respx
    from fastapi import FastAPI

    from athena_api.lifespan import build_lifespan

    refresh_started = asyncio.Event()
    release_refresh = asyncio.Event()

    async def slow_refresh(self: InstrumentIdentityIndex, _client: object) -> int:
        refresh_started.set()
        await release_refresh.wait()
        return 0

    monkeypatch.setattr(InstrumentIdentityIndex, "refresh", slow_refresh)
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_kiwoom_token(mock)
        lifespan = build_lifespan(
            _identity_startup_settings(tmp_path), ws_connect=_offline_websocket
        )
        async with lifespan(app):
            task = app.state.instrument_identity_task
            assert isinstance(task, asyncio.Task)
            await asyncio.wait_for(refresh_started.wait(), timeout=5)
            assert not task.done(), "기동은 식별 인덱스 갱신이 끝나기 전에 완료돼야 한다"
            assert app.state.instrument_identity.size == 0, "끝나기 전에는 빈 스냅숏(fail-closed)"
        assert task.done() and task.cancelled(), "teardown이 진행 중인 갱신을 취소한다"
        assert app.state.instrument_identity_task is None


async def test_lifespan_identity_refresh_failure_is_logged_not_raised(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    tmp_path: Path,
) -> None:
    import respx
    from fastapi import FastAPI

    from athena_api.lifespan import build_lifespan

    attempted = asyncio.Event()

    async def failing_refresh(self: InstrumentIdentityIndex, _client: object) -> int:
        attempted.set()
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(InstrumentIdentityIndex, "refresh", failing_refresh)
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_kiwoom_token(mock)
        with caplog.at_level("WARNING", logger="athena_api.lifespan"):
            lifespan = build_lifespan(
                _identity_startup_settings(tmp_path), ws_connect=_offline_websocket
            )
            async with lifespan(app):
                task = app.state.instrument_identity_task
                await asyncio.wait_for(attempted.wait(), timeout=5)
                await asyncio.sleep(0)
                assert not task.done()
                assert app.state.instrument_identity.size == 0
    assert any(
        "instrument identity refresh failed" in record.getMessage() for record in caplog.records
    )
