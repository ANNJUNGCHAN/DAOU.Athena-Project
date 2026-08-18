"""US-006 — `selector_tools.SelectorCache`(게이트웨이 search/describe 캐시) 검증.

W4 계획서(.omc/plans/plan-latency-optimization.md) 계약: search/describe만
캐시하고, resolve/call은 절대 캐시 경로에 들어가지 않는다(plan_token
1회용·시세 신선도). 이 파일에서 가장 중요한 테스트는
`test_resolve_never_cached_even_with_identical_arguments`와
`test_call_never_cached_even_with_identical_plan_token`이다 — 캐시 우회
검증이다."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.selector_tools import (
    CALL_TOOL,
    DESCRIBE_TOOL,
    RESOLVE_TOOL,
    SEARCH_TOOL,
    SelectorCache,
)
from athena_mcp.server import AthenaGateway


def _gateway(tmp_path: Path, handler, *, cache: SelectorCache | None = None) -> AthenaGateway:
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


# ---------------------------------------------------------------------------
# search/describe — 동일 인자 두 번째 호출부터 HTTP를 안 탄다
# ---------------------------------------------------------------------------


async def test_search_second_identical_call_skips_http(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    args = {"query": "삼성전자 현재가"}

    first = await gw.dispatch_call(SEARCH_TOOL, args)
    second = await gw.dispatch_call(SEARCH_TOOL, args)

    assert len(calls) == 1
    assert first.isError is False
    assert second.isError is False
    assert json.loads(first.content[0].text) == json.loads(second.content[0].text)


async def test_describe_second_identical_call_skips_http(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={"catalog_version": "v1", "operation_ref": "ka10001", "kind": "query"},
        )

    gw = _gateway(tmp_path, handler)
    args = {"operation_ref": "ka10001"}

    await gw.dispatch_call(DESCRIBE_TOOL, args)
    await gw.dispatch_call(DESCRIBE_TOOL, args)

    assert len(calls) == 1


async def test_search_different_arguments_both_hit_http(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "삼성전자"})
    await gw.dispatch_call(SEARCH_TOOL, {"query": "카카오"})

    assert len(calls) == 2


async def test_search_argument_key_order_does_not_bust_cache(tmp_path):
    """정규화가 키 정렬까지 한다 — {"query": .., "limit": ..}와
    {"limit": .., "query": ..}는 같은 캐시 항목을 가리켜야 한다."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "삼성전자", "limit": 5})
    await gw.dispatch_call(SEARCH_TOOL, {"limit": 5, "query": "삼성전자"})

    assert len(calls) == 1


# ---------------------------------------------------------------------------
# resolve/call — 캐시 절대 우회 금지(가장 중요) — 동일 인자라도 매번 HTTP를 탄다
# ---------------------------------------------------------------------------


async def test_resolve_never_cached_even_with_identical_arguments(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "status": "resolved",
                "catalog_version": "v1",
                "operation_ref": "ka10001",
                "plan_token": f"tok-{len(calls)}",
                "expires_at": "2026-08-19T00:00:00+00:00",
                "selection_reasons": [],
                "required_arguments_satisfied": True,
                "response_mode": "auto",
            },
        )

    gw = _gateway(tmp_path, handler)
    args = {"question": "삼성전자 현재가"}

    await gw.dispatch_call(RESOLVE_TOOL, args)
    await gw.dispatch_call(RESOLVE_TOOL, args)

    assert len(calls) == 2  # 캐시됐다면 1이었을 것 — resolve는 절대 캐시 대상이 아니다


async def test_call_never_cached_even_with_identical_plan_token(tmp_path):
    """call은 plan_token이 1회용이라 실제 백엔드라면 두 번째 호출이
    PLAN_ALREADY_USED로 거부되는 게 정상이지만, 그 판단은 백엔드의 몫이다.
    게이트웨이가 캐시로 먼저 가로채 HTTP 자체를 생략해버리면 그 거부조차
    일어나지 않는다 — 이 테스트는 "HTTP는 매번 나간다"만 확인한다."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={"operation_ref": "ka10001", "data": {}, "continuation": {"cont_yn": "N"}},
        )

    gw = _gateway(tmp_path, handler)
    args = {"plan_token": "tok-abc"}

    await gw.dispatch_call(CALL_TOOL, args)
    await gw.dispatch_call(CALL_TOOL, args)

    assert len(calls) == 2


async def test_resolve_bypasses_even_a_cache_explicitly_shared_with_search(tmp_path):
    """search로 이미 데워진 캐시 인스턴스를 resolve가 재사용하는 상황이라도
    resolve는 그 캐시를 절대 조회/저장하지 않는다 — `SelectorCache.get()`/
    `put()` 자체의 화이트리스트 게이트를 검증한다."""
    search_calls = 0
    resolve_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal search_calls, resolve_calls
        if request.url.path == "/api/v1/llm/tools/search":
            search_calls += 1
            return httpx.Response(
                200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
            )
        resolve_calls += 1
        return httpx.Response(
            200,
            json={
                "status": "resolved",
                "catalog_version": "v1",
                "operation_ref": "ka10001",
                "plan_token": f"tok-{resolve_calls}",
                "expires_at": "2026-08-19T00:00:00+00:00",
                "selection_reasons": [],
                "required_arguments_satisfied": True,
                "response_mode": "auto",
            },
        )

    cache = SelectorCache()
    gw = _gateway(tmp_path, handler, cache=cache)

    await gw.dispatch_call(SEARCH_TOOL, {"query": "삼성전자"})
    await gw.dispatch_call(SEARCH_TOOL, {"query": "삼성전자"})  # 캐시 히트
    assert search_calls == 1

    await gw.dispatch_call(RESOLVE_TOOL, {"question": "삼성전자"})
    await gw.dispatch_call(RESOLVE_TOOL, {"question": "삼성전자"})
    assert resolve_calls == 2  # 같은 캐시 인스턴스를 공유해도 resolve는 매번 HTTP


# ---------------------------------------------------------------------------
# TTL 만료 — 만료 후 재호출은 HTTP를 다시 탄다
# ---------------------------------------------------------------------------


async def test_ttl_expiry_forces_new_http_call(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    fake_now = [0.0]
    cache = SelectorCache(ttl_seconds=60.0, clock=lambda: fake_now[0])
    gw = _gateway(tmp_path, handler, cache=cache)
    args = {"query": "삼성전자 현재가"}

    await gw.dispatch_call(SEARCH_TOOL, args)
    fake_now[0] += 61.0  # TTL(60초) 경과
    await gw.dispatch_call(SEARCH_TOOL, args)

    assert len(calls) == 2


async def test_within_ttl_still_hits_cache(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    fake_now = [0.0]
    cache = SelectorCache(ttl_seconds=60.0, clock=lambda: fake_now[0])
    gw = _gateway(tmp_path, handler, cache=cache)
    args = {"query": "삼성전자 현재가"}

    await gw.dispatch_call(SEARCH_TOOL, args)
    fake_now[0] += 30.0  # 아직 TTL 이내
    await gw.dispatch_call(SEARCH_TOOL, args)

    assert len(calls) == 1


# ---------------------------------------------------------------------------
# 에러 응답은 캐시되지 않는다
# ---------------------------------------------------------------------------


async def test_error_response_is_not_cached(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(503, json={"detail": "credentials unavailable"})

    gw = _gateway(tmp_path, handler)
    args = {"query": "삼성전자 현재가"}

    first = await gw.dispatch_call(SEARCH_TOOL, args)
    second = await gw.dispatch_call(SEARCH_TOOL, args)

    assert first.isError is True
    assert second.isError is True
    assert len(calls) == 2  # 에러는 캐시되지 않으니 매번 HTTP를 탄다


async def test_connect_error_is_not_cached(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise httpx.ConnectError("refused", request=request)

    gw = _gateway(tmp_path, handler)
    args = {"query": "x"}

    await gw.dispatch_call(SEARCH_TOOL, args)
    await gw.dispatch_call(SEARCH_TOOL, args)

    assert len(calls) == 2


async def test_success_after_earlier_error_gets_cached_normally(tmp_path):
    """실패는 캐시하지 않지만, 그 뒤 성공한 응답은 정상적으로 캐시돼야 한다
    — "에러 비캐시"가 "그 키는 영영 캐시 불가"로 오염되면 안 된다."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, json={"detail": "credentials unavailable"})
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    args = {"query": "삼성전자 현재가"}

    first = await gw.dispatch_call(SEARCH_TOOL, args)
    second = await gw.dispatch_call(SEARCH_TOOL, args)
    third = await gw.dispatch_call(SEARCH_TOOL, args)

    assert first.isError is True
    assert second.isError is False
    assert third.isError is False
    assert len(calls) == 2  # 3번째는 2번째 성공이 캐시된 걸 재사용


# ---------------------------------------------------------------------------
# LRU 상한 — 초과하면 가장 오래전에 쓰인 항목이 밀려난다
# ---------------------------------------------------------------------------


async def test_lru_eviction_when_over_capacity(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    cache = SelectorCache(ttl_seconds=300.0, max_entries=2)
    gw = _gateway(tmp_path, handler, cache=cache)

    await gw.dispatch_call(SEARCH_TOOL, {"query": "A"})  # 캐시: [A]
    await gw.dispatch_call(SEARCH_TOOL, {"query": "B"})  # 캐시: [A, B]
    await gw.dispatch_call(SEARCH_TOOL, {"query": "C"})  # 상한(2) 초과 -> A 축출, 캐시: [B, C]
    assert len(calls) == 3

    await gw.dispatch_call(SEARCH_TOOL, {"query": "A"})  # 축출됐으니 다시 HTTP
    assert len(calls) == 4

    await gw.dispatch_call(SEARCH_TOOL, {"query": "C"})  # 아직 캐시에 있음
    assert len(calls) == 4


async def test_lru_touch_on_get_protects_recently_used_entry(tmp_path):
    """A를 다시 조회해 최근 사용으로 갱신하면, 그다음 상한을 넘길 때 A가 아니라
    B(더 오래 방치된 쪽)가 축출돼야 한다."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    cache = SelectorCache(ttl_seconds=300.0, max_entries=2)
    gw = _gateway(tmp_path, handler, cache=cache)

    await gw.dispatch_call(SEARCH_TOOL, {"query": "A"})  # 캐시: [A]
    await gw.dispatch_call(SEARCH_TOOL, {"query": "B"})  # 캐시: [A, B]
    await gw.dispatch_call(SEARCH_TOOL, {"query": "A"})  # 히트, A를 최근 사용으로 갱신: [B, A]
    assert len(calls) == 2

    await gw.dispatch_call(SEARCH_TOOL, {"query": "C"})  # 상한 초과 -> B 축출: [A, C]
    assert len(calls) == 3

    await gw.dispatch_call(SEARCH_TOOL, {"query": "A"})  # 여전히 캐시에 있음
    assert len(calls) == 3

    await gw.dispatch_call(SEARCH_TOOL, {"query": "B"})  # 축출됐으니 다시 HTTP
    assert len(calls) == 4


# ---------------------------------------------------------------------------
# catalog_version 무효화 — 버전이 바뀌면 이전 캐시 키와 안 겹친다
# ---------------------------------------------------------------------------


async def test_catalog_version_change_invalidates_previous_entry(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        version = "v1" if len(calls) == 1 else "v2"
        return httpx.Response(
            200, json={"catalog_version": version, "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    args = {"query": "삼성전자 현재가"}

    first = await gw.dispatch_call(SEARCH_TOOL, args)  # 미스 -> v1 저장
    assert len(calls) == 1

    # 캐시 내부 상태를 직접 조작해 "백엔드가 카탈로그를 갈아치웠다"를 흉내낸다
    # — 실제로는 다음 성공 응답이 catalog_version을 바꾸면서 일어나는 일이다.
    gw.selector_cache._catalog_version = "v2"

    second = await gw.dispatch_call(SEARCH_TOOL, args)  # v2 키라 미스 -> 다시 HTTP
    assert len(calls) == 2
    assert json.loads(first.content[0].text)["catalog_version"] == "v1"
    assert json.loads(second.content[0].text)["catalog_version"] == "v2"


# ---------------------------------------------------------------------------
# 타이밍 로그 — 캐시 히트는 backend_ms=0 + cache_hit=True로 구분된다
# ---------------------------------------------------------------------------


def _timing_log_path(tmp_path: Path) -> Path:
    return tmp_path / "audit" / "kiwoom-selector-timing.jsonl"


async def test_cache_hit_recorded_in_timing_log(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    args = {"query": "삼성전자 현재가"}

    await gw.dispatch_call(SEARCH_TOOL, args)
    await gw.dispatch_call(SEARCH_TOOL, args)

    lines = _timing_log_path(tmp_path).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    first_entry = json.loads(lines[0])
    second_entry = json.loads(lines[1])

    # 미스(첫 호출)는 기존 3필드 계약을 그대로 유지한다 — 회귀 없음.
    assert set(first_entry) == {"ts", "tool", "backend_ms"}

    assert second_entry["cache_hit"] is True
    assert second_entry["backend_ms"] == 0


async def test_audit_log_still_records_success_on_cache_hit(tmp_path):
    """캐시 히트도 "성공한 툴 호출"이다 — 감사 로그 계약(ts/alias/tool/success)은
    캐시 여부와 무관하게 그대로 유지돼야 한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"catalog_version": "v1", "normalized_query": "x", "results": []}
        )

    gw = _gateway(tmp_path, handler)
    args = {"query": "삼성전자 현재가"}

    await gw.dispatch_call(SEARCH_TOOL, args)
    await gw.dispatch_call(SEARCH_TOOL, args)

    entries = gw._audit_log("kiwoom-selector").read_all()
    assert len(entries) == 2
    assert all(e["success"] is True for e in entries)
    assert all(set(e) == {"ts", "alias", "tool", "success"} for e in entries)
