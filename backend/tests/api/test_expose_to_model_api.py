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
