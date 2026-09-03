"""출처 브리프 라우트 — 주소 하나가 브리프가 되는 계약과, 실패가 갈리는 두 상태.

바깥으로 나가지 않는다. 깊은 동작(주소별 갈래·본문 뽑기)은
tests/unit/test_backtest_sources.py가 MockTransport로 고정하고, 이 파일은 라우트가
소유한 것만 본다 — 입력 검증, 본문 그대로 통과, `BriefError`의 HTTP 번역.

앱은 **백테스트 서브시스템을 켜지 않고** 만든다. 바깥 페이지를 읽어 오는 데 sqlite도
키움도 필요 없다는 것이 계약이라, 503 게이트가 없다는 사실을 여기서 못 박는다.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from athena_api.backtest import sources as sources_mod
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest/source"

BRIEF = {
    "source_kind": "naver_blog",
    "url": "https://blog.naver.com/quantkim/223456789",
    "title": "20일선 전략",
    "text": "20일선이 60일선을 위로 뚫으면 산다.",
    "truncated": False,
    "language": None,
}


def _client() -> TestClient:
    return TestClient(create_app(Settings(_env_file=None)))


def _stub(
    monkeypatch: pytest.MonkeyPatch,
    *,
    result: dict[str, Any] | None = None,
    error: Exception | None = None,
) -> list[str]:
    """`brief_from_url`을 가로채고, 라우트가 그 함수를 부른 주소를 기록한다."""
    seen: list[str] = []

    async def fake(url: str, *, client: Any = None) -> dict[str, Any]:
        seen.append(url)
        if error is not None:
            raise error
        return result or {}

    monkeypatch.setattr(sources_mod, "brief_from_url", fake)
    return seen


def test_brief_passes_the_payload_through_without_a_subsystem_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _stub(monkeypatch, result=BRIEF)

    res = _client().post(f"{BASE}/brief", json={"url": BRIEF["url"]})

    assert res.status_code == 200, res.text
    assert res.json() == BRIEF
    assert seen == [BRIEF["url"]]


@pytest.mark.parametrize("body", [{}, {"url": ""}, {"url": "   "}, {"url": 5}, {"url": None}])
def test_url_is_required_before_anything_goes_out(
    body: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = _stub(monkeypatch, result=BRIEF)

    res = _client().post(f"{BASE}/brief", json=body)

    assert res.status_code == 422
    assert "url" in res.json()["detail"]
    assert seen == []  # 검증에서 잘렸으면 바깥을 두드리지 않는다


def test_a_source_we_cannot_read_is_422_with_the_korean_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub(monkeypatch, error=sources_mod.BriefError(422, "본문 글을 찾지 못했다: https://x.test"))

    res = _client().post(f"{BASE}/brief", json={"url": "https://x.test"})

    assert res.status_code == 422
    assert res.json()["detail"] == "본문 글을 찾지 못했다: https://x.test"


def test_a_broken_hop_is_502_naming_the_step(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, error=sources_mod.BriefError(502, "페이지 단계가 실패했다 (HTTP 500)"))

    res = _client().post(f"{BASE}/brief", json={"url": "https://x.test"})

    assert res.status_code == 502
    detail = res.json()["detail"]
    assert "페이지 단계가 실패했다" in detail
    assert "Traceback" not in detail
