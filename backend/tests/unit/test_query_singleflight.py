from __future__ import annotations

import asyncio

import pytest
from fastapi import Response
from starlette.requests import Request

from athena_api.generated.registry import TR_REGISTRY
from athena_api.generated.runtime import call_typed_tr
from athena_api.kiwoom import ResponseEnvelope


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


class QueryClientSpy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.release = asyncio.Event()
        self.fail = False
        self.cancelled = 0

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, body))
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        if self.fail:
            raise RuntimeError("upstream failed")
        return ResponseEnvelope(
            body={"cur_prc": "71000"}, cont_yn="N", next_key=None
        )


async def _quote(client: QueryClientSpy, stk_cd: str = "005930"):
    payload = TR_REGISTRY["ka10001"].request_model.model_validate({"stk_cd": stk_cd})
    return await call_typed_tr(
        "ka10001", payload, _request(), Response(), client
    )


async def _wait_for_calls(client: QueryClientSpy, count: int) -> None:
    for _ in range(20):
        if len(client.calls) >= count:
            return
        await asyncio.sleep(0)
    raise AssertionError(f"expected {count} calls, got {len(client.calls)}")


@pytest.mark.asyncio
async def test_identical_concurrent_queries_share_one_upstream_call() -> None:
    client = QueryClientSpy()
    first = asyncio.create_task(_quote(client))
    second = asyncio.create_task(_quote(client))
    await _wait_for_calls(client, 1)
    assert len(client.calls) == 1

    client.release.set()
    left, right = await asyncio.gather(first, second)

    assert left.model_dump() == right.model_dump()
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_different_clients_or_arguments_do_not_share_query() -> None:
    first_client = QueryClientSpy()
    second_client = QueryClientSpy()
    tasks = [
        asyncio.create_task(_quote(first_client, "005930")),
        asyncio.create_task(_quote(first_client, "000660")),
        asyncio.create_task(_quote(second_client, "005930")),
    ]
    await _wait_for_calls(first_client, 2)
    await _wait_for_calls(second_client, 1)

    assert len(first_client.calls) == 2
    assert len(second_client.calls) == 1
    first_client.release.set()
    second_client.release.set()
    await asyncio.gather(*tasks)


@pytest.mark.asyncio
async def test_failed_query_is_evicted_and_next_call_retries() -> None:
    client = QueryClientSpy()
    client.fail = True
    client.release.set()

    with pytest.raises(RuntimeError, match="upstream failed"):
        await _quote(client)
    client.fail = False
    result = await _quote(client)

    assert result.model_dump(by_alias=True)["cur_prc"] == "71000"
    assert len(client.calls) == 2


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_cancel_shared_query() -> None:
    client = QueryClientSpy()
    cancelled = asyncio.create_task(_quote(client))
    survivor = asyncio.create_task(_quote(client))
    await _wait_for_calls(client, 1)
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled

    client.release.set()
    result = await survivor

    assert result.model_dump(by_alias=True)["cur_prc"] == "71000"
    assert len(client.calls) == 1
    assert client.cancelled == 0


@pytest.mark.asyncio
async def test_sole_cancelled_waiter_cancels_and_evicts_query() -> None:
    client = QueryClientSpy()
    request = asyncio.create_task(_quote(client))
    await _wait_for_calls(client, 1)

    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    for _ in range(20):
        if client.cancelled:
            break
        await asyncio.sleep(0)

    client.release.set()
    result = await _quote(client)

    assert client.cancelled == 1
    assert result.model_dump(by_alias=True)["cur_prc"] == "71000"
    assert len(client.calls) == 2
