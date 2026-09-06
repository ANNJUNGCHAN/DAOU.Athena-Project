"""출처 → 지도 잡 라우트 — 시작·폴링·멈추기 세 문의 계약만 본다(Paper 보드 17).

바깥으로 나가지 않는다: `brief_from_url`을 가로채 잡이 그 글로 돌게 한다. 다섯 단계의
속내는 tests/unit/test_backtest_source_to_map.py가 고정하고, 여기서는 라우트가 소유한
것만 본다 — 입력 검증, 202 + job_id, 없는 잡의 404, 이미 끝난 잡의 cancelled:false.

앱은 **백테스트 서브시스템을 켜지 않고** 만든다 — 이 잡은 sqlite도 키움도 쓰지 않는다는
사실을 브리프 라우트와 같은 자리에서 못 박는다(503 게이트 없음).
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from athena_api.backtest import sources as sources_mod
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest/source/map"

TEXT = "\n".join(
    [
        "코스피 대형주 일봉 3년.",
        "· 진입: 종가가 20일 최고가를 넘는 날",
        "· 청산: 20일 이동평균 아래로 마감",
        "· 손절: 진입가 -5%",
    ]
)


def _client(monkeypatch: pytest.MonkeyPatch, *, text: str = TEXT) -> TestClient:
    async def fake(url: str, *, client: Any = None) -> dict[str, Any]:
        return {"text": text, "title": "20일 신고가 돌파", "source_kind": "youtube", "url": url}

    monkeypatch.setattr(sources_mod, "brief_from_url", fake)
    return TestClient(create_app(Settings(_env_file=None)))


def _finished(client: TestClient, job_id: str) -> dict[str, Any]:
    """잡이 끝날 때까지 폴링한다 — 화면이 하는 것과 같은 방법이다(1초 예산)."""
    deadline = time.monotonic() + 1.0
    payload = client.get(f"{BASE}/{job_id}").json()
    while payload["status"] == "running" and time.monotonic() < deadline:
        payload = client.get(f"{BASE}/{job_id}").json()
    return payload


def test_starting_a_job_answers_202_with_the_id_to_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch)

    res = client.post(BASE, json={"url": "https://youtu.be/x"})

    assert res.status_code == 202, res.text
    assert res.json()["job_id"]


@pytest.mark.parametrize("body", [{}, {"url": ""}, {"url": "   "}, {"url": 5}])
def test_url_is_required_before_a_job_exists(
    body: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    res = _client(monkeypatch).post(BASE, json=body)

    assert res.status_code == 422
    assert "url" in res.json()["detail"]


def test_polling_shows_the_five_steps_and_ends_with_the_map(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(monkeypatch)
    job_id = client.post(BASE, json={"url": "https://youtu.be/x"}).json()["job_id"]

    payload = _finished(client, job_id)

    assert payload["status"] == "done", payload["error"]
    assert payload["step_total"] == 5
    assert [s["state"] for s in payload["steps"]] == ["done"] * 5
    assert payload["target_ko"] == "코스피 대형주 · 일봉 · 3년"
    assert payload["target_confirmed"] is False
    assert len(payload["map"]["nodes"]) == payload["map_total"] == 4


def test_a_source_we_cannot_read_leaves_the_reason_on_the_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def broken(url: str, *, client: Any = None) -> dict[str, Any]:
        raise sources_mod.BriefError(502, "페이지 단계가 실패했다 (HTTP 500)")

    monkeypatch.setattr(sources_mod, "brief_from_url", broken)
    client = TestClient(create_app(Settings(_env_file=None)))
    job_id = client.post(BASE, json={"url": "https://x.test"}).json()["job_id"]

    payload = _finished(client, job_id)

    assert payload["status"] == "failed"
    assert payload["error"] == "페이지 단계가 실패했다 (HTTP 500)"
    assert payload["map"] is None


def test_a_source_with_nothing_to_extract_fails_with_a_korean_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(monkeypatch, text="오늘 날씨 이야기입니다.")
    job_id = client.post(BASE, json={"url": "https://x.test"}).json()["job_id"]

    payload = _finished(client, job_id)

    assert payload["status"] == "failed"
    assert "찾지 못했습니다" in payload["error"]


def test_an_unknown_job_is_404_on_both_polling_and_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(monkeypatch)

    assert client.get(f"{BASE}/nope").status_code == 404
    assert client.delete(f"{BASE}/nope").status_code == 404


def test_stopping_a_finished_job_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch)
    job_id = client.post(BASE, json={"url": "https://youtu.be/x"}).json()["job_id"]
    _finished(client, job_id)

    res = client.delete(f"{BASE}/{job_id}")

    assert res.status_code == 200
    assert res.json() == {"ok": True, "cancelled": False}
