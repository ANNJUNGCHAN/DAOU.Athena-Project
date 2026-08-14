import asyncio
import json
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

import pytest
from starlette.requests import HTTPConnection

from athena_api.dependencies import require_kiwoom_ws_client
from athena_api.kiwoom import KiwoomWsClient, KiwoomWsError, RateLimiter


class FakeSocket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | BaseException] = asyncio.Queue()
        self.sent: list[str] = []
        self.closed = False
        self.send_error: BaseException | None = None

    async def send(self, data: str) -> None:
        if self.send_error is not None:
            raise self.send_error
        self.sent.append(data)

    async def recv(self) -> str:
        value = await self.incoming.get()
        if isinstance(value, BaseException):
            raise value
        return value

    async def close(self) -> None:
        self.closed = True

    def push(self, message: dict[str, object]) -> None:
        self.incoming.put_nowait(json.dumps(message))

    def messages(self) -> list[dict[str, object]]:
        return [json.loads(frame) for frame in self.sent]


def test_ws_dependency_accepts_websocket_connection_scope() -> None:
    expected = SimpleNamespace(is_ready=True)
    app = SimpleNamespace(state=SimpleNamespace(kiwoom_ws_client=expected))
    connection = HTTPConnection({"type": "websocket", "app": app, "headers": []})
    assert require_kiwoom_ws_client(connection) is expected


async def until(check: Callable[[], bool]) -> None:
    for _ in range(100):
        if check():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition not reached")


def client_for(
    connect: Callable[[str], Awaitable[FakeSocket]],
    **kwargs: object,
) -> KiwoomWsClient:
    return KiwoomWsClient(
        lambda: "memory-token",
        RateLimiter(1000, per_api_rate=None),
        connect=connect,
        **kwargs,
    )


async def start_client(client: KiwoomWsClient, socket: FakeSocket) -> None:
    task = asyncio.create_task(client.start())
    await until(lambda: bool(socket.sent))
    socket.push({"trnm": "LOGIN", "return_code": 0})
    await task


@pytest.mark.asyncio
async def test_login_has_body_token_and_ping_is_echoed_without_auth_header() -> None:
    socket = FakeSocket()
    urls: list[str] = []

    async def connect(url: str) -> FakeSocket:
        urls.append(url)
        return socket

    client = client_for(connect)
    try:
        await start_client(client, socket)
        assert urls == ["wss://mockapi.kiwoom.com:10000/api/dostk/websocket"]
        assert socket.messages()[0] == {"trnm": "LOGIN", "token": "memory-token"}
        raw_ping = '{"trnm":"PING","seq":1}'
        socket.incoming.put_nowait(raw_ping)
        await until(lambda: raw_ping in socket.sent)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_control_replies_are_isolated_by_serial_execution() -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    try:
        await start_client(client, socket)
        first = asyncio.create_task(client.execute("00", {"trnm": "REG", "seq": 1}))
        await until(lambda: len(socket.sent) == 2)
        second = asyncio.create_task(client.execute("04", {"trnm": "REG", "seq": 2}))
        await asyncio.sleep(0)
        assert len(socket.sent) == 2
        socket.push({"trnm": "REG", "return_code": 0, "seq": 1})
        assert (await first)["seq"] == 1
        await until(lambda: len(socket.sent) == 3)
        socket.push({"trnm": "REG", "return_code": 0, "seq": 2})
        assert (await second)["seq"] == 2
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_real_fanout_uses_bounded_latest_event_queue() -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect, subscriber_queue_size=1)
    queue = client.subscribe_events()
    try:
        await start_client(client, socket)
        socket.push({"trnm": "REAL", "data": [{"item": "005930_AL", "value": 1}]})
        socket.push({"trnm": "REAL", "data": [{"item": "000660_NX", "value": 2}]})
        await until(lambda: queue.qsize() == 1)
        await asyncio.sleep(0)
        event = queue.get_nowait()
        assert event["data"] == [{"item": "000660", "value": 2}]
    finally:
        client.unsubscribe_events(queue)
        await client.close()


@pytest.mark.asyncio
async def test_reconnect_logs_in_and_restores_registration() -> None:
    first_socket = FakeSocket()
    second_socket = FakeSocket()
    sockets = [first_socket, second_socket]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first_socket)
        registration = asyncio.create_task(
            client.register("00", ["005930"], grp_no="7", refresh="0")
        )
        await until(lambda: len(first_socket.sent) == 2)
        first_socket.push({"trnm": "REG", "return_code": 0})
        await registration

        first_socket.incoming.put_nowait(ConnectionError("closed"))
        await until(lambda: bool(second_socket.sent))
        second_socket.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(second_socket.sent) == 2)
        second_socket.push({"trnm": "REG", "return_code": 0})
        await until(lambda: client.is_ready and client.subscription_count == 1)
        assert [message["trnm"] for message in second_socket.messages()] == ["LOGIN", "REG"]
        assert second_socket.messages()[1]["data"] == [
            {"item": ["005930_AL"], "type": ["00"]}
        ]
        assert second_socket.messages()[1]["grp_no"] == "7"
        assert second_socket.messages()[1]["refresh"] == "0"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_close_stops_reader_without_reconnect() -> None:
    socket = FakeSocket()
    calls = 0

    async def connect(_url: str) -> FakeSocket:
        nonlocal calls
        calls += 1
        return socket

    client = client_for(connect)
    await start_client(client, socket)
    await client.close()
    await asyncio.sleep(0)
    assert socket.closed is True
    assert client.is_ready is False
    assert calls == 1


@pytest.mark.asyncio
async def test_login_failure_does_not_leak_token_or_upstream_secret() -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    task = asyncio.create_task(client.start())
    await until(lambda: bool(socket.sent))
    socket.push({"trnm": "LOGIN", "return_code": 1, "return_msg": "upstream-secret"})
    try:
        with pytest.raises(KiwoomWsError) as error:
            await task
    finally:
        await client.close()
    assert "memory-token" not in str(error.value)
    assert "upstream-secret" not in str(error.value)


@pytest.mark.asyncio
async def test_login_send_failure_retrieves_pending_future_exception() -> None:
    socket = FakeSocket()
    socket.send_error = ConnectionError("send failed")
    loop = asyncio.get_running_loop()
    previous_handler = loop.get_exception_handler()
    unhandled: list[dict[str, object]] = []
    loop.set_exception_handler(lambda _loop, context: unhandled.append(context))

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    try:
        with pytest.raises(KiwoomWsError, match="LOGIN failed"):
            await client.start()
        await asyncio.sleep(0)
        assert unhandled == []
    finally:
        loop.set_exception_handler(previous_handler)
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply",
    [{"trnm": "LOGIN"}, {"trnm": "LOGIN", "return_code": "   "}],
)
async def test_login_requires_nonblank_return_code_and_stays_not_ready(
    reply: dict[str, object],
) -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    task = asyncio.create_task(client.start())
    await until(lambda: bool(socket.sent))
    socket.push(reply)
    try:
        with pytest.raises(KiwoomWsError, match="LOGIN failed"):
            await task
        assert client.is_ready is False
        assert socket.closed is True
        assert client.last_error == "login_failed"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_cancelled_login_closes_socket_and_reader() -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    task = asyncio.create_task(client.start())
    await until(lambda: bool(socket.sent))
    task.cancel()
    try:
        with pytest.raises(asyncio.CancelledError):
            await task
        assert socket.closed is True
        assert client.is_ready is False
        assert client._reader_task is None  # noqa: SLF001 - cancellation cleanup invariant
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_string_success_is_normalized_and_nonzero_control_is_secret_safe() -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    try:
        start = asyncio.create_task(client.start())
        await until(lambda: bool(socket.sent))
        socket.push({"trnm": "LOGIN", "return_code": "0000"})
        await start
        task = asyncio.create_task(client.execute("00", {"trnm": "REG"}))
        await until(lambda: len(socket.sent) == 2)
        socket.push(
            {"trnm": "REG", "return_code": "0007", "return_msg": "upstream-secret"}
        )
        with pytest.raises(KiwoomWsError) as error:
            await task
        assert "upstream-secret" not in str(error.value)
        assert client.last_error == "control_rejected:7"
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply",
    [{"trnm": "REG"}, {"trnm": "REG", "return_code": "   "}],
)
async def test_control_requires_nonblank_return_code_and_invalidates_connection(
    reply: dict[str, object],
) -> None:
    first, second = FakeSocket(), FakeSocket()
    sockets = [first, second]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        task = asyncio.create_task(client.execute("00", {"trnm": "REG"}))
        await until(lambda: len(first.sent) == 2)
        first.push(reply)
        with pytest.raises(KiwoomWsError, match="missing or blank return_code"):
            await task
        assert client.is_ready is False
        assert first.closed is True
        assert client.last_error == "control_missing_return_code"
        await until(lambda: bool(second.sent))
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_control_send_failure_invalidates_socket_and_is_secret_safe() -> None:
    first, second = FakeSocket(), FakeSocket()
    sockets = [first, second]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        first.send_error = ConnectionError("raw-upstream-secret")
        with pytest.raises(KiwoomWsError, match="send failed") as error:
            await client.execute("00", {"trnm": "REG"})
        assert "raw-upstream-secret" not in str(error.value)
        assert client.is_ready is False
        assert first.closed is True
        assert client.last_error == "control_send_failed"
        await until(lambda: bool(second.sent))
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_control_reply_wait_cancellation_discards_late_reply_correlation() -> None:
    first, second = FakeSocket(), FakeSocket()
    sockets = [first, second]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        first_request = asyncio.create_task(
            client.execute("00", {"trnm": "REG", "seq": 1})
        )
        await until(lambda: len(first.sent) == 2)
        first_request.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first_request
        assert first.closed is True
        assert client.is_ready is False
        assert client.last_error == "control_cancelled"

        first.push({"trnm": "REG", "return_code": 0, "seq": "late-first"})
        await until(lambda: bool(second.sent))
        second.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: client.is_ready)

        second_request = asyncio.create_task(
            client.execute("00", {"trnm": "REG", "seq": 2})
        )
        await until(lambda: len(second.sent) == 2)
        await asyncio.sleep(0)
        assert second_request.done() is False
        second.push({"trnm": "REG", "return_code": 0, "seq": 2})
        assert (await second_request)["seq"] == 2
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_condition_realtime_subscription_is_restored_and_cleared_by_seq() -> None:
    first, second = FakeSocket(), FakeSocket()
    sockets = [first, second]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        register = asyncio.create_task(
            client.execute(
                "ka10173", {"trnm": "CNSRREQ", "seq": "7", "search_type": "1"}
            )
        )
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "CNSRREQ", "return_code": "0"})
        await register
        assert client.subscription_count == 1
        first.incoming.put_nowait(ConnectionError("closed-secret"))
        await until(lambda: bool(second.sent))
        second.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(second.sent) == 2)
        second.push({"trnm": "CNSRREQ", "return_code": 0})
        await until(lambda: client.is_ready)
        clear = asyncio.create_task(client.execute("ka10174", {"trnm": "CNSRCLR", "seq": "7"}))
        await until(lambda: len(second.sent) == 3)
        second.push({"trnm": "CNSRCLR", "return_code": 0})
        await clear
        assert client.subscription_count == 0
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_control_timeout_discards_correlation_unsafe_connection() -> None:
    first, second = FakeSocket(), FakeSocket()
    sockets = [first, second]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep, control_timeout_seconds=0.01)
    try:
        await start_client(client, first)
        with pytest.raises(KiwoomWsError, match="timed out"):
            await client.execute("00", {"trnm": "REG", "seq": 1})
        client._control_timeout = 1  # noqa: SLF001 - isolate the first timeout only
        assert first.closed is True
        first.push({"trnm": "REG", "return_code": 0, "seq": "late"})
        await until(lambda: bool(second.sent))
        second.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: client.is_ready)
        request = asyncio.create_task(client.execute("00", {"trnm": "REG", "seq": 2}))
        await until(lambda: len(second.sent) == 2)
        second.push({"trnm": "REG", "return_code": 0, "seq": 2})
        assert (await request)["seq"] == 2
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_failed_restore_closes_candidate_before_next_reconnect() -> None:
    first, failed_candidate, recovered = FakeSocket(), FakeSocket(), FakeSocket()
    sockets = [first, failed_candidate, recovered]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        registration = asyncio.create_task(client.register("00", ["005930"]))
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "REG", "return_code": 0})
        await registration
        first.incoming.put_nowait(ConnectionError("closed"))
        await until(lambda: bool(failed_candidate.sent))
        failed_candidate.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(failed_candidate.sent) == 2)
        failed_candidate.push({"trnm": "REG", "return_code": 7})
        await until(lambda: failed_candidate.closed and bool(recovered.sent))
        recovered.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(recovered.sent) == 2)
        recovered.push({"trnm": "REG", "return_code": 0})
        await until(lambda: client.is_ready)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_remove_queued_during_recovery_cannot_be_undone_by_stale_restore() -> None:
    first, recovered = FakeSocket(), FakeSocket()
    sockets = [first, recovered]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        registration = asyncio.create_task(client.register("00", ["005930"]))
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "REG", "return_code": 0})
        await registration

        await client._control_lock.acquire()  # noqa: SLF001 - deterministic queue ordering
        remove = asyncio.create_task(client.remove("00", ["005930"]))
        await asyncio.sleep(0)
        assert remove.done() is False
        first.incoming.put_nowait(ConnectionError("closed"))
        await until(lambda: bool(recovered.sent))
        recovered.push({"trnm": "LOGIN", "return_code": 0})
        await asyncio.sleep(0)
        client._control_lock.release()  # noqa: SLF001

        for index in range(2):
            expected_count = 2 + index
            await until(lambda expected=expected_count: len(recovered.sent) >= expected)
            trnm = recovered.messages()[1 + index]["trnm"]
            recovered.push({"trnm": trnm, "return_code": 0})
        await remove

        assert [message["trnm"] for message in recovered.messages()] == [
            "LOGIN",
            "REG",
            "REMOVE",
        ]
        assert client.subscription_count == 0
    finally:
        if client._control_lock.locked():  # noqa: SLF001
            client._control_lock.release()  # noqa: SLF001
        await client.close()


@pytest.mark.asyncio
async def test_remove_identity_ignores_refresh_and_reconnect_does_not_restore() -> None:
    first, recovered = FakeSocket(), FakeSocket()
    sockets = [first, recovered]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        registration = asyncio.create_task(
            client.register("00", ["005930"], grp_no="7", refresh="0")
        )
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "REG", "return_code": 0})
        await registration

        removal = asyncio.create_task(
            client.remove("00", ["005930"], grp_no="7", refresh="1")
        )
        await until(lambda: len(first.sent) == 3)
        first.push({"trnm": "REMOVE", "return_code": 0})
        await removal
        assert client.subscription_count == 0

        first.incoming.put_nowait(ConnectionError("closed"))
        await until(lambda: bool(recovered.sent))
        recovered.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: client.is_ready)
        await asyncio.sleep(0)
        assert [message["trnm"] for message in recovered.messages()] == ["LOGIN"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_remove_matches_same_items_in_different_order() -> None:
    socket = FakeSocket()

    async def connect(_url: str) -> FakeSocket:
        return socket

    client = client_for(connect)
    try:
        await start_client(client, socket)
        registration = asyncio.create_task(
            client.register("00", ["005930", "000660"], grp_no="7", refresh="0")
        )
        await until(lambda: len(socket.sent) == 2)
        socket.push({"trnm": "REG", "return_code": 0})
        await registration

        removal = asyncio.create_task(
            client.remove("00", ["000660", "005930"], grp_no="7", refresh="1")
        )
        await until(lambda: len(socket.sent) == 3)
        socket.push({"trnm": "REMOVE", "return_code": 0})
        await removal
        assert client.subscription_count == 0
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_partial_remove_restores_only_remaining_items_with_reg_refresh() -> None:
    first, recovered = FakeSocket(), FakeSocket()
    sockets = [first, recovered]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        registration = asyncio.create_task(
            client.register("00", ["005930", "000660"], grp_no="7", refresh="0")
        )
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "REG", "return_code": 0})
        await registration

        retained = asyncio.create_task(
            client.register("04", ["035420"], grp_no="7", refresh="1")
        )
        await until(lambda: len(first.sent) == 3)
        first.push({"trnm": "REG", "return_code": 0})
        await retained

        removal = asyncio.create_task(
            client.remove("00", ["005930"], grp_no="7", refresh="1")
        )
        await until(lambda: len(first.sent) == 4)
        first.push({"trnm": "REMOVE", "return_code": 0})
        await removal
        assert client.subscription_count == 2

        first.incoming.put_nowait(ConnectionError("closed"))
        await until(lambda: bool(recovered.sent))
        recovered.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(recovered.sent) == 2)
        first_restored = recovered.messages()[1]
        assert first_restored["data"] == [{"item": ["000660_AL"], "type": ["00"]}]
        assert first_restored["refresh"] == "0"
        recovered.push({"trnm": "REG", "return_code": 0})
        await until(lambda: len(recovered.sent) == 3)
        second_restored = recovered.messages()[2]
        assert second_restored["data"] == [{"item": ["035420_AL"], "type": ["04"]}]
        assert second_restored["refresh"] == "1"
        recovered.push({"trnm": "REG", "return_code": 0})
        await until(lambda: client.is_ready)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_reg_refresh_zero_replaces_existing_group_before_reconnect() -> None:
    first, recovered = FakeSocket(), FakeSocket()
    sockets = [first, recovered]

    async def connect(_url: str) -> FakeSocket:
        return sockets.pop(0)

    async def no_sleep(_seconds: float) -> None:
        return None

    client = client_for(connect, sleep=no_sleep)
    try:
        await start_client(client, first)
        original = asyncio.create_task(
            client.register("00", ["005930"], grp_no="7", refresh="1")
        )
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "REG", "return_code": 0})
        await original

        replacement = asyncio.create_task(
            client.register("04", ["000660"], grp_no="7", refresh="0")
        )
        await until(lambda: len(first.sent) == 3)
        first.push({"trnm": "REG", "return_code": 0})
        await replacement
        assert client.subscription_count == 1

        first.incoming.put_nowait(ConnectionError("closed"))
        await until(lambda: bool(recovered.sent))
        recovered.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(recovered.sent) == 2)
        restored = recovered.messages()[1]
        assert restored["data"] == [{"item": ["000660_AL"], "type": ["04"]}]
        assert restored["refresh"] == "0"
        recovered.push({"trnm": "REG", "return_code": 0})
        await until(lambda: client.is_ready)
    finally:
        await client.close()
