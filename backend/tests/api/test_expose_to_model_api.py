"""exposeToModel 게이트 라우트(WP-I I1) — 토글 왕복·인증·초기값."""

from __future__ import annotations

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app

BEARER = "local-test-bearer"
PATH = "/api/v1/settings/expose-to-model"


def _client() -> TestClient:
    app = create_app(Settings(_env_file=None, local_bearer_token=BEARER))
    return TestClient(app)


def test_expose_to_model_requires_bearer() -> None:
    response = _client().post(PATH, json={"enabled": True})
    assert response.status_code == 422


def test_expose_to_model_rejects_wrong_bearer() -> None:
    response = _client().post(
        PATH, json={"enabled": True}, headers={"Authorization": "Bearer nope"}
    )
    assert response.status_code == 401


def test_expose_to_model_starts_closed() -> None:
    # 기동 초기값은 안전측 False다(G-I5) — Electron의 재동기화 push가 오기 전까지
    # 게이트는 닫혀 있어야 한다.
    with _client() as client:
        assert client.app.state.expose_to_model is False


def test_expose_to_model_round_trip() -> None:
    with _client() as client:
        on = client.post(
            PATH, json={"enabled": True}, headers={"Authorization": f"Bearer {BEARER}"}
        )
        assert on.status_code == 200
        assert on.json() == {"enabled": True}
        assert client.app.state.expose_to_model is True

        off = client.post(
            PATH, json={"enabled": False}, headers={"Authorization": f"Bearer {BEARER}"}
        )
        assert off.status_code == 200
        assert off.json() == {"enabled": False}
        assert client.app.state.expose_to_model is False


def test_expose_to_model_rejects_extra_fields() -> None:
    # extra="forbid" — 필드를 지어내 보내는 호출을 422로 거른다(계획 공통 규칙).
    with _client() as client:
        response = client.post(
            PATH,
            json={"enabled": True, "surprise": 1},
            headers={"Authorization": f"Bearer {BEARER}"},
        )
        assert response.status_code == 422


def test_model_caller_is_gated_until_toggle_opens() -> None:
    """WP-I I2+I3 — X-Athena-Caller: model 호출은 게이트 전용 503(G-I3)으로
    막히고, 토글 ON 이후에는 게이트를 지나 기존 상태(브레인 미기동 503)로
    떨어진다. 두 503은 detail로 구분된다(MCP dispatch()가 이 마커를 읽는다)."""
    model_headers = {"Authorization": f"Bearer {BEARER}", "X-Athena-Caller": "model"}
    route = "/api/v1/brain/analysis/god-nodes"
    with _client() as client:
        gated = client.get(route, headers=model_headers)
        assert gated.status_code == 503
        assert gated.json()["detail"] == "expose-to-model-disabled"

        client.post(PATH, json={"enabled": True}, headers={"Authorization": f"Bearer {BEARER}"})
        opened = client.get(route, headers=model_headers)
        assert opened.status_code == 503
        assert opened.json()["detail"] == "Investment brain is not ready"


def test_local_caller_without_header_is_not_gated() -> None:
    """헤더 없는 로컬 호출(Electron)은 게이트와 무관하게 기존 경로 그대로다 —
    게이트는 모델 자기신고 경로 전용이다(G-I1)."""
    route = "/api/v1/brain/analysis/god-nodes"
    with _client() as client:
        response = client.get(route, headers={"Authorization": f"Bearer {BEARER}"})
        assert response.status_code == 503
        assert response.json()["detail"] == "Investment brain is not ready"
