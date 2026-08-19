"""mcp 테스트 공용 헬퍼 — 4파일(test_selector_tools/test_selector_cache/
test_canvas_data/test_routine_tools)에 중복됐던 MockTransport 클라이언트·
AthenaGateway 조립 로직을 팩토리 픽스처로 통합한다 (2026-08-20 포니테일 감사).

일반 함수를 conftest.py에 두는 것만으로는 각 테스트 파일에 자동 주입되지
않는다 — 그래서 팩토리를 반환하는 픽스처로 감쌌다. 픽스처 이름을 인자로
선언하면(import 불필요) pytest가 자동으로 주입하고, 반환된 콜러블을 기존
로컬 헬퍼처럼 호출하면 된다."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.selector_tools import SelectorCache
from athena_mcp.server import AthenaGateway


@pytest.fixture
def mock_http_client() -> Callable[..., httpx.AsyncClient]:
    """handler(요청 -> 응답/예외)를 MockTransport로 감싼 AsyncClient로 만든다."""

    def _make(handler, base_url: str = "http://backend.test") -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=base_url)

    return _make


@pytest.fixture
def make_gateway(tmp_path: Path) -> Callable[..., AthenaGateway]:
    """MockTransport handler로 AthenaGateway를 조립한다.

    cache=None(기본)이면 기존 무캐시 버전과 동일 — `AthenaGateway`가 자체
    기본 `SelectorCache`를 갖는다. cache에 `SelectorCache` 인스턴스를 넘기면
    그 캐시를 그대로 쓴다(TTL/용량 실험, 캐시 공유 시나리오 등)."""

    def _make(handler, *, cache: SelectorCache | None = None) -> AthenaGateway:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://backend.test"
        )
        kwargs: dict = dict(
            registry=ServerRegistry(path=tmp_path / "reg.json"),
            consent_store=ConsentStore(path=tmp_path / "consent.json"),
            audit_log_dir=tmp_path / "audit",
            canvas_save_dir=tmp_path / "canvases",
            selector_http_client=client,
        )
        if cache is not None:
            kwargs["selector_cache"] = cache
        return AthenaGateway(**kwargs)

    return _make
