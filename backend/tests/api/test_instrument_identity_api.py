"""HTTP regressions for private instrument identity binding during resolve."""

from pathlib import Path

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.dependencies import get_selector_service
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.selector.instrument_identity import InstrumentIdentityIndex


def _client() -> tuple[TestClient, SelectorService]:
    index = InstrumentIdentityIndex()
    index.replace(
        {
            "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
            "10": [{"code": "035720", "name": "카카오", "marketCode": "10"}],
            "8": [{"code": "069500", "name": "KODEX 200", "marketCode": "8"}],
            "3": [
                {
                    "code": "52M504",
                    "name": "미래M504삼성전자콜",
                    "marketCode": "3",
                }
            ],
        }
    )
    service = SelectorService(
        build_operation_catalog(),
        PlanSigner(b"identity-api-test", nonce_factory=lambda: "identity-api"),
        instrument_identity=index,
    )
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[get_selector_service] = lambda: service
    return TestClient(app), service


def test_http_name_and_code_queries_sign_the_same_operation_with_the_same_code() -> None:
    client, service = _client()
    with client:
        responses = [
            client.post(
                "/api/v1/llm/tools/resolve",
                json={"question": question, "arguments": {}},
            )
            for question in ("삼성전자 오늘 주가 얼마야?", "005930 오늘 주가 얼마야?")
        ]

    assert [response.status_code for response in responses] == [200, 200]
    assert {response.json()["operation_ref"] for response in responses} == {
        "detail:ka10001:current_trading"
    }
    assert [
        service.signer.verify(response.json()["plan_token"], service.catalog).arguments
        for response in responses
    ] == [{"stk_cd": "005930"}, {"stk_cd": "005930"}]


def test_http_resolve_rejects_caller_code_mismatch_without_returning_a_plan() -> None:
    client, _ = _client()
    with client:
        response = client.post(
            "/api/v1/llm/tools/resolve",
            json={
                "question": "삼성전자 오늘 주가 얼마야?",
                "arguments": {"stk_cd": "035720"},
            },
        )

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_ARGUMENTS"
    assert "plan_token" not in response.text


def test_http_unavailable_index_keeps_name_query_fail_closed() -> None:
    service = SelectorService(
        build_operation_catalog(),
        PlanSigner(b"identity-unavailable-api"),
        instrument_identity=InstrumentIdentityIndex(),
    )
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[get_selector_service] = lambda: service

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/llm/tools/resolve",
            json={
                "question": "삼성전자 오늘 주가 얼마야?",
                "arguments": {"stk_cd": "005930"},
            },
        )

    assert response.status_code == 404
    assert response.json()["code"] == "NO_CONFIDENT_MATCH"
    assert "plan_token" not in response.text


def test_http_natural_order_matching_mismatch_missing_and_exact_contract() -> None:
    client, service = _client()
    base_arguments = {
        "dmst_stex_tp": "KRX",
        "stk_cd": "005930",
        "ord_qty": "1",
        "trde_tp": "3",
    }
    with client:
        matching = client.post(
            "/api/v1/llm/tools/resolve",
            json={
                "question": "삼성전자 한 주를 시장가로 매수해줘",
                "intent": "order",
                "arguments": base_arguments,
            },
        )
        mismatch = client.post(
            "/api/v1/llm/tools/resolve",
            json={
                "question": "삼성전자 한 주를 시장가로 매수해줘",
                "intent": "order",
                "arguments": {**base_arguments, "stk_cd": "035720"},
            },
        )
        missing = client.post(
            "/api/v1/llm/tools/resolve",
            json={
                "question": "삼성전자 한 주를 시장가로 매수해줘",
                "intent": "order",
                "arguments": {
                    key: value for key, value in base_arguments.items() if key != "stk_cd"
                },
            },
        )
        exact = client.post(
            "/api/v1/llm/tools/resolve",
            json={
                "question": "base:kt10000",
                "intent": "order",
                "arguments": {**base_arguments, "stk_cd": "035720"},
            },
        )

    assert matching.status_code == 200
    assert service.signer.verify(
        matching.json()["plan_token"], service.catalog
    ).arguments["stk_cd"] == "005930"
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "INVALID_ARGUMENTS"
    assert "plan_token" not in mismatch.text
    assert missing.status_code == 422
    assert missing.json()["code"] == "INVALID_ARGUMENTS"
    assert exact.status_code == 200
    assert service.signer.verify(
        exact.json()["plan_token"], service.catalog
    ).arguments["stk_cd"] == "035720"


def test_instrument_resolve_and_status_read_persisted_sqlite_master(tmp_path: Path) -> None:
    db_path = tmp_path / "instruments.sqlite3"
    index = InstrumentIdentityIndex(db_path=db_path)
    index.replace(
        {
            "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
            "10": [{"code": "035720", "name": "카카오", "marketCode": "10"}],
            "8": [{"code": "069500", "name": "KODEX 200", "marketCode": "8"}],
            "3": [
                {
                    "code": "52M504",
                    "name": "미래M504삼성전자콜",
                    "marketCode": "3",
                }
            ],
        }
    )
    app = create_app(Settings(_env_file=None, instrument_db_path=db_path))

    with TestClient(app) as client:
        resolved = client.post(
            "/api/v1/instruments/resolve", json={"question": "삼성전자 현재가"}
        )
        resolved_elw = client.post(
            "/api/v1/instruments/resolve",
            json={"question": "미래M504삼성전자콜 ELW 시세"},
        )
        missing = client.post(
            "/api/v1/instruments/resolve", json={"question": "없는 종목 현재가"}
        )
        status = client.get("/api/v1/instruments/status")

    assert resolved.status_code == 200
    assert resolved.json() == {
        "ready": True,
        "instrument": {
            "code": "005930",
            "name": "삼성전자",
            "marketCode": "0",
            "kind": "stock",
        },
    }
    assert missing.json() == {"ready": True, "instrument": None}
    assert resolved_elw.status_code == 200
    assert resolved_elw.json() == {
        "ready": True,
        "instrument": {
            "code": "52M504",
            "name": "미래M504삼성전자콜",
            "marketCode": "3",
            "kind": "elw",
        },
    }
    assert status.status_code == 200
    assert status.json()["ready"] is True
    assert status.json()["size"] == 4
    assert status.json()["refreshedAt"] is not None


def test_instrument_resolve_reports_not_ready_for_empty_master(tmp_path: Path) -> None:
    app = create_app(
        Settings(_env_file=None, instrument_db_path=tmp_path / "instruments.sqlite3")
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/instruments/resolve", json={"question": "삼성전자 현재가"}
        )

    assert response.status_code == 200
    assert response.json() == {"ready": False, "instrument": None}
