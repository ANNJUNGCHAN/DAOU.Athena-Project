"""Multi-account credential pooling.

Kiwoom carries no account-number field on the wire: the bearer token *is* the account.
These tests pin the consequences of that — one stack per credential pair, no shared budget,
no shared idempotency namespace, and no plan that survives being pointed at another account.
"""

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient
from starlette.requests import Request

from athena_api.accounts import order_scope_for
from athena_api.config import KiwoomAccount, OrderScope, Settings
from athena_api.dependencies import (
    require_kiwoom_client,
    require_token_manager,
    resolve_account_alias,
)
from athena_api.errors import OrderScopeError, UnknownAccountError
from athena_api.generated import models
from athena_api.generated.registry import TR_REGISTRY
from athena_api.generated.runtime import call_order_tr
from athena_api.lifespan import build_lifespan
from athena_api.main import create_app
from athena_api.process_lock import CredentialProcessLock
from athena_api.selector import PlanSigner, build_operation_catalog
from athena_api.selector.errors import InvalidPlanError

# 이 파일의 모든 테스트가 같은 고정 가짜 자격증명(alias "daeju")을 쓴다 — 즉 같은
# CredentialProcessLock 파일을 놓고 경합한다. xdist 병렬 실행에서 서로 다른 워커
# 프로세스가 이 파일의 테스트를 동시에 돌리면 실제 OS 레벨 락 충돌로 무작위 실패한다
# (US-008 실측: -n auto --dist loadgroup 초기 실행에서 6건 실패, 전부 이 파일).
# xdist_group으로 한 워커에 묶어 서로에게는 직렬을 강제한다 — 다른 파일과는 여전히 병렬.
pytestmark = pytest.mark.xdist_group(name="kiwoom-credential-pool")

ACCOUNTS_JSON = (
    '[{"alias":"daeju","app_key":"key-a","secret_key":"secret-a"},'
    '{"alias":"sangsi","app_key":"key-b","secret_key":"secret-b"}]'
)


def _pooled_settings(**overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        kiwoom_accounts=ACCOUNTS_JSON,
        kiwoom_default_account="sangsi",
        **overrides,
    )


def _request(app: FastAPI, headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "app": app,
            "headers": headers or [],
            "query_string": b"",
        }
    )


# --- configuration -----------------------------------------------------------------


def test_json_array_configures_every_account() -> None:
    settings = _pooled_settings()
    assert [account.alias for account in settings.kiwoom_accounts] == ["daeju", "sangsi"]
    assert settings.kiwoom_default_account == "sangsi"
    assert settings.has_credentials is True


def test_legacy_single_pair_becomes_a_one_entry_pool() -> None:
    settings = Settings(_env_file=None, kiwoom_app_key="app", kiwoom_secret_key="secret")
    assert [account.alias for account in settings.kiwoom_accounts] == ["default"]
    assert settings.kiwoom_default_account == "default"


def test_pool_and_legacy_pair_together_are_rejected() -> None:
    with pytest.raises(ValueError, match="not both"):
        Settings(
            _env_file=None,
            kiwoom_accounts=ACCOUNTS_JSON,
            kiwoom_app_key="app",
            kiwoom_secret_key="secret",
        )


def test_multiple_accounts_require_an_explicit_default() -> None:
    # The old duplicate-key .env silently kept whichever pair came last. Never guess.
    with pytest.raises(ValueError, match="kiwoom_default_account is required"):
        Settings(_env_file=None, kiwoom_accounts=ACCOUNTS_JSON)


def test_duplicate_aliases_are_rejected() -> None:
    duplicated = (
        '[{"alias":"same","app_key":"a","secret_key":"a"},'
        '{"alias":"same","app_key":"b","secret_key":"b"}]'
    )
    with pytest.raises(ValueError, match="duplicate kiwoom account aliases: same"):
        Settings(_env_file=None, kiwoom_accounts=duplicated, kiwoom_default_account="same")


def test_unknown_default_alias_is_rejected() -> None:
    with pytest.raises(ValueError, match="not a configured account alias"):
        Settings(_env_file=None, kiwoom_accounts=ACCOUNTS_JSON, kiwoom_default_account="ghost")


@pytest.mark.parametrize("alias", ["", "Upper", "has space", "-leading", "x" * 33])
def test_malformed_aliases_are_rejected(alias: str) -> None:
    with pytest.raises(ValueError):
        KiwoomAccount(alias=alias, app_key="a", secret_key="b")


def test_settings_repr_never_exposes_pooled_credentials() -> None:
    rendered = repr(_pooled_settings())
    assert "key-a" not in rendered
    assert "secret-b" not in rendered


def test_credential_fingerprint_tracks_the_pair_not_the_alias() -> None:
    first = KiwoomAccount(alias="one", app_key="a", secret_key="b")
    renamed = KiwoomAccount(alias="two", app_key="a", secret_key="b")
    rotated = KiwoomAccount(alias="one", app_key="a", secret_key="c")
    assert first.credential_fingerprint == renamed.credential_fingerprint
    assert first.credential_fingerprint != rotated.credential_fingerprint


# --- ownership locking -------------------------------------------------------------


def test_distinct_credentials_can_be_owned_concurrently(tmp_path: Path) -> None:
    first = CredentialProcessLock(tmp_path / "athena-aaaa.lock", label="daeju")
    second = CredentialProcessLock(tmp_path / "athena-bbbb.lock", label="sangsi")
    first.acquire()
    second.acquire()
    try:
        contender = CredentialProcessLock(tmp_path / "athena-aaaa.lock", label="daeju")
        with pytest.raises(RuntimeError, match="for account 'daeju'"):
            contender.acquire()
    finally:
        first.release()
        second.release()


def test_lock_path_is_derived_from_the_credential_fingerprint() -> None:
    account = KiwoomAccount(alias="daeju", app_key="a", secret_key="b")
    lock = CredentialProcessLock.for_credentials(account.credential_fingerprint, label="daeju")
    assert account.credential_fingerprint in lock.path.name
    assert lock.label == "daeju"


# --- lifespan wiring ---------------------------------------------------------------


async def _no_websocket(_url: str):
    raise ConnectionError("offline test")


def _mock_token(mock: respx.MockRouter) -> None:
    expires = datetime.now() + timedelta(hours=1)
    mock.post("/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "return_code": 0,
                "token": "memory-token",
                "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
            },
        )
    )


@pytest.mark.asyncio
async def test_lifespan_builds_one_isolated_stack_per_account() -> None:
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_pooled_settings(), ws_connect=_no_websocket)(app):
            pool = app.state.kiwoom_accounts
            assert set(pool) == {"daeju", "sangsi"}
            daeju, sangsi = pool["daeju"], pool["sangsi"]
            assert daeju.ready and sangsi.ready
            # Kiwoom meters per app key, so a shared limiter would throttle each to half.
            assert daeju.rate_limiter is not sangsi.rate_limiter
            assert daeju.auth is not sangsi.auth
            assert daeju.data_client is not sangsi.data_client
            # Within one account, data and order share that account's single budget.
            assert daeju.data_client is not daeju.order_client
            assert daeju.order_client.configured_max_retry_on_rate_limit == 0

            # Flat attributes stay live views of the default account, not copies.
            assert app.state.kiwoom_client is sangsi.data_client
            assert app.state.token_manager is sangsi.token_manager
            assert app.state.kiwoom_rate_limiter is sangsi.rate_limiter
            assert app.state.kiwoom_order_rate_limiter is app.state.kiwoom_rate_limiter
    assert app.state.kiwoom_accounts == {}
    assert app.state.kiwoom_client is None


@pytest.mark.asyncio
async def test_one_failed_account_does_not_block_the_others() -> None:
    app = FastAPI()
    expires = datetime.now() + timedelta(hours=1)
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        app_key = request.read().decode("utf-8")
        seen.append(app_key)
        if "key-a" in app_key:
            return httpx.Response(200, json={"return_code": 3, "return_msg": "rejected"})
        return httpx.Response(
            200,
            json={
                "return_code": 0,
                "token": "memory-token",
                "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
            },
        )

    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/oauth2/token").mock(side_effect=handler)
        async with build_lifespan(_pooled_settings(), ws_connect=_no_websocket)(app):
            pool = app.state.kiwoom_accounts
            assert pool["daeju"].ready is False
            assert pool["sangsi"].ready is True
            assert app.state.kiwoom_ready is True
    assert len(seen) == 2


def test_ready_accounts_reports_each_account_separately() -> None:
    app = create_app(_pooled_settings(local_bearer_token="local-test"))
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        with TestClient(app) as client:
            body = client.get(
                "/ready/accounts", headers={"Authorization": "Bearer local-test"}
            ).json()
    assert body["default"] == "sangsi"
    assert set(body["accounts"]) == {"daeju", "sangsi"}
    assert body["accounts"]["daeju"]["ready"] is True


def test_ready_accounts_requires_the_local_bearer_before_aliases_are_returned() -> None:
    app = create_app(_pooled_settings(local_bearer_token="local-test"))
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        with TestClient(app) as client:
            health = client.get("/health")
            ready = client.get("/ready")
            missing = client.get("/ready/accounts")
            wrong = client.get(
                "/ready/accounts", headers={"Authorization": "Bearer wrong"}
            )
            valid = client.get(
                "/ready/accounts", headers={"Authorization": "Bearer local-test"}
            )
    assert health.status_code == 200
    assert ready.status_code == 200
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert "accounts" not in missing.json()
    assert "accounts" not in wrong.json()
    assert valid.status_code == 200
    assert set(valid.json()["accounts"]) == {"daeju", "sangsi"}


# --- request routing ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_header_selects_the_account_and_absence_falls_back_to_default() -> None:
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_pooled_settings(), ws_connect=_no_websocket)(app):
            pool = app.state.kiwoom_accounts
            targeted = _request(app, [(b"x-athena-account", b"daeju")])
            assert resolve_account_alias(targeted) == "daeju"
            assert require_kiwoom_client(targeted) is pool["daeju"].data_client
            assert require_token_manager(targeted) is pool["daeju"].token_manager

            default = _request(app)
            assert resolve_account_alias(default) == "sangsi"
            assert require_kiwoom_client(default) is pool["sangsi"].data_client


@pytest.mark.asyncio
async def test_query_parameter_selects_the_account_for_websocket_handshakes() -> None:
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_pooled_settings(), ws_connect=_no_websocket)(app):
            scope = {
                "type": "http",
                "method": "GET",
                "path": "/",
                "app": app,
                "headers": [],
                "query_string": b"account=daeju",
            }
            assert resolve_account_alias(Request(scope)) == "daeju"


@pytest.mark.asyncio
async def test_unknown_alias_is_rejected_rather_than_silently_defaulted() -> None:
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_pooled_settings(), ws_connect=_no_websocket)(app):
            ghost = _request(app, [(b"x-athena-account", b"ghost")])
            with pytest.raises(UnknownAccountError):
                resolve_account_alias(ghost)
            with pytest.raises(UnknownAccountError):
                require_kiwoom_client(ghost)


def test_unknown_alias_surfaces_as_404_over_http() -> None:
    app = create_app(_pooled_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/tr/quotes/ka10006",
                json={"stk_cd": "005930"},
                headers={"X-Athena-Account": "ghost"},
            )
    # 404, not a silent fall back to the default account's data.
    assert response.status_code == 404
    assert response.json()["detail"] == "Kiwoom account is not configured"


def test_dependencies_still_resolve_without_a_configured_pool() -> None:
    app = SimpleNamespace(state=SimpleNamespace())
    assert resolve_account_alias(SimpleNamespace(app=app)) == ""


# --- plan binding ------------------------------------------------------------------


def _issue_plan(signer: PlanSigner, account: str) -> str:
    catalog = build_operation_catalog()
    document = catalog.find_exact("base:ka10006")
    assert document is not None
    token, _ = signer.issue(
        catalog=catalog,
        document=document,
        arguments={"stk_cd": "005930"},
        question="주식시분",
        account=account,
    )
    return token


def test_a_plan_cannot_be_replayed_against_another_account() -> None:
    signer = PlanSigner(b"plan-binding-test-secret", ttl_seconds=120)
    catalog = build_operation_catalog()
    token = _issue_plan(signer, "daeju")

    assert signer.verify(token, catalog, expected_account="daeju").account == "daeju"
    with pytest.raises(InvalidPlanError, match="different account"):
        signer.verify(token, catalog, expected_account="sangsi")
    with pytest.raises(InvalidPlanError, match="different account"):
        signer.verify(token, catalog)


def test_a_continuation_plan_stays_on_its_original_account() -> None:
    signer = PlanSigner(b"plan-binding-test-secret", ttl_seconds=120)
    catalog = build_operation_catalog()
    document = catalog.find_exact("base:ka10006")
    assert document is not None
    plan = signer.verify(_issue_plan(signer, "daeju"), catalog, expected_account="daeju")
    refreshed, _ = signer.refresh(
        plan, catalog=catalog, document=document, cont_yn="Y", next_key="page-2"
    )
    assert signer.verify(refreshed, catalog, expected_account="daeju").next_key == "page-2"
    with pytest.raises(InvalidPlanError, match="different account"):
        signer.verify(refreshed, catalog, expected_account="sangsi")


# --- order idempotency -------------------------------------------------------------


class _RecordingOrderClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def post_with_headers(self, api_id, endpoint, body, options):
        from athena_api.kiwoom import ResponseEnvelope

        self.calls.append(api_id)
        return ResponseEnvelope(body={"return_code": "0"}, cont_yn="N", next_key=None)


@pytest.mark.asyncio
async def test_two_accounts_may_reuse_one_idempotency_key() -> None:
    app = create_app(
        Settings(enable_order_api=True, local_bearer_token="local-test", _env_file=None)
    )
    client = _RecordingOrderClient()
    payload = models.Kt10000Request.model_validate(
        {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    )

    async def submit(account: str) -> None:
        await call_order_tr(
            "kt10000",
            payload,
            _request(app),
            Response(),
            client,
            "Bearer local-test",
            "true",
            "shared-key",
            account,
        )

    await submit("daeju")
    await submit("sangsi")
    # Same key, two accounts: two real orders, not one cached reply reused across accounts.
    assert client.calls == ["kt10000", "kt10000"]
    assert set(app.state.order_idempotency_cache) == {
        ("daeju", "kt10000", "shared-key"),
        ("sangsi", "kt10000", "shared-key"),
    }

    await submit("daeju")
    assert client.calls == ["kt10000", "kt10000"]


@pytest.mark.asyncio
async def test_order_route_binds_the_resolved_account_into_the_idempotency_key() -> None:
    app = create_app(_pooled_settings(enable_order_api=True, local_bearer_token="local-test"))
    captured: list[str] = []

    class ProbeClient:
        is_ready = True

        async def post_with_headers(self, api_id, endpoint, body, options):
            from athena_api.kiwoom import ResponseEnvelope

            captured.append(api_id)
            return ResponseEnvelope(body={"return_code": "0"}, cont_yn="N", next_key=None)

    from athena_api.dependencies import require_order_kiwoom_client

    app.dependency_overrides[require_order_kiwoom_client] = lambda: ProbeClient()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        with TestClient(app) as http:
            response = http.post(
                "/api/v1/order/kt10000",
                json={"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
                headers={
                    "Authorization": "Bearer local-test",
                    "X-Athena-Confirm": "true",
                    "Idempotency-Key": "route-key",
                    "X-Athena-Account": "daeju",
                },
            )
    assert response.status_code == 200
    assert ("daeju", "kt10000", "route-key") in app.state.order_idempotency_cache


# --- order scopes ------------------------------------------------------------------


SCOPED_ACCOUNTS = (
    '[{"alias":"daeju","app_key":"key-a","secret_key":"secret-a","order_scopes":[]},'
    '{"alias":"sangsi","app_key":"key-b","secret_key":"secret-b","order_scopes":["cash"]}]'
)


def _scoped_settings() -> Settings:
    return Settings(
        _env_file=None,
        kiwoom_accounts=SCOPED_ACCOUNTS,
        kiwoom_default_account="sangsi",
        enable_order_api=True,
        local_bearer_token="local-test",
    )


@pytest.mark.parametrize(
    ("tr_id", "upstream_path", "expected"),
    [
        ("kt10000", "/api/dostk/ordr", OrderScope.CASH),
        ("kt10003", "/api/dostk/ordr", OrderScope.CASH),
        ("kt10006", "/api/dostk/crdordr", OrderScope.CREDIT),
        ("kt10009", "/api/dostk/crdordr", OrderScope.CREDIT),
        ("kt50000", "/api/dostk/ordr", OrderScope.GOLD),
        ("kt50003", "/api/dostk/ordr", OrderScope.GOLD),
    ],
)
def test_every_order_tr_classifies_into_one_scope(
    tr_id: str, upstream_path: str, expected: OrderScope
) -> None:
    assert order_scope_for(tr_id, upstream_path) is expected


def test_order_scopes_cover_all_twelve_order_operations() -> None:
    scopes = {
        tr_id: order_scope_for(tr_id, spec.upstream_path)
        for tr_id, spec in TR_REGISTRY.items()
        if spec.kind == "order"
    }
    assert len(scopes) == 12
    assert sum(scope is OrderScope.CASH for scope in scopes.values()) == 4
    assert sum(scope is OrderScope.CREDIT for scope in scopes.values()) == 4
    assert sum(scope is OrderScope.GOLD for scope in scopes.values()) == 4


def test_kiwoom_exposes_no_short_sell_order_operation() -> None:
    """The reason a short-selling account gets an empty allowlist rather than a scope.

    Credit sell is the only sell operation with a credit-deal discriminator, and it accepts
    only 융자 (margin repayment) codes. If Kiwoom ever adds a 대주 code this test fails and
    the scope model needs a fourth member.
    """
    credit_sell = TR_REGISTRY["kt10007"].request_model.model_fields["crd_deal_tp"]
    assert "33" in str(credit_sell.description)
    assert "대주" not in str(credit_sell.description)


@pytest.mark.asyncio
async def test_short_selling_account_is_refused_every_order_family() -> None:
    app = create_app(_scoped_settings())
    client = _RecordingOrderClient()
    order_bodies = {
        "kt10000": models.Kt10000Request,
        "kt10006": models.Kt10006Request,
        "kt50000": models.Kt50000Request,
    }
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_scoped_settings(), ws_connect=_no_websocket)(app):
            for tr_id, model in order_bodies.items():
                body = {"stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
                if tr_id != "kt50000":
                    body["dmst_stex_tp"] = "KRX"
                with pytest.raises(OrderScopeError, match="daeju"):
                    await call_order_tr(
                        tr_id,
                        model.model_validate(body),
                        _request(app),
                        Response(),
                        client,
                        "Bearer local-test",
                        "true",
                        f"scope-key-{tr_id}",
                        "daeju",
                    )
    # Refused before the order leaves, and without burning the idempotency key.
    assert client.calls == []
    assert app.state.order_idempotency_cache == {}


@pytest.mark.asyncio
async def test_cash_only_account_places_cash_but_not_credit_orders() -> None:
    app = create_app(_scoped_settings())
    client = _RecordingOrderClient()
    cash = models.Kt10000Request.model_validate(
        {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    )
    credit = models.Kt10006Request.model_validate(
        {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    )
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_scoped_settings(), ws_connect=_no_websocket)(app):
            await call_order_tr(
                "kt10000",
                cash,
                _request(app),
                Response(),
                client,
                "Bearer local-test",
                "true",
                "cash-key",
                "sangsi",
            )
            assert client.calls == ["kt10000"]

            with pytest.raises(OrderScopeError, match="credit"):
                await call_order_tr(
                    "kt10006",
                    credit,
                    _request(app),
                    Response(),
                    client,
                    "Bearer local-test",
                    "true",
                    "credit-key",
                    "sangsi",
                )
    assert client.calls == ["kt10000"]


@pytest.mark.asyncio
async def test_unrestricted_account_keeps_placing_every_order_family() -> None:
    app = create_app(
        Settings(enable_order_api=True, local_bearer_token="local-test", _env_file=None)
    )
    client = _RecordingOrderClient()
    credit = models.Kt10006Request.model_validate(
        {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    )
    await call_order_tr(
        "kt10006",
        credit,
        _request(app),
        Response(),
        client,
        "Bearer local-test",
        "true",
        "unrestricted-key",
        "",
    )
    assert client.calls == ["kt10006"]


def test_order_scope_refusal_surfaces_as_403_over_http() -> None:
    app = create_app(_scoped_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        with TestClient(app) as http:
            response = http.post(
                "/api/v1/order/kt10000",
                json={"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
                headers={
                    "Authorization": "Bearer local-test",
                    "X-Athena-Confirm": "true",
                    "Idempotency-Key": "http-scope-key",
                    "X-Athena-Account": "daeju",
                },
            )
    assert response.status_code == 403
    assert response.json()["detail"] == "Account is not permitted to place this order"


def test_ready_accounts_reports_order_scopes() -> None:
    app = create_app(_scoped_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        with TestClient(app) as client:
            accounts = client.get(
                "/ready/accounts", headers={"Authorization": "Bearer local-test"}
            ).json()["accounts"]
    assert accounts["daeju"]["order_scopes"] == []
    assert accounts["sangsi"]["order_scopes"] == ["cash"]


@pytest.mark.asyncio
async def test_account_stacks_do_not_share_a_rate_limit_budget() -> None:
    app = FastAPI()
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        _mock_token(mock)
        async with build_lifespan(_pooled_settings(), ws_connect=_no_websocket)(app):
            pool = app.state.kiwoom_accounts
            await asyncio.gather(
                *(pool["daeju"].rate_limiter.acquire("ka10001") for _ in range(5))
            )
            # Draining one account's budget must leave the other's untouched.
            await asyncio.wait_for(pool["sangsi"].rate_limiter.acquire("ka10001"), timeout=0.5)
