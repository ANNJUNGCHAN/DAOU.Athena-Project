"""Persistent Kiwoom mock WebSocket transport."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Protocol

import websockets

from athena_api.kiwoom.rate_limiter import RateLimiter
from athena_api.kiwoom.return_codes import normalize_return_code

KIWOOM_MOCK_WS_URL = "wss://mockapi.kiwoom.com:10000/api/dostk/websocket"


class WsConnection(Protocol):
    async def send(self, data: str) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self) -> None: ...


ConnectFn = Callable[[str], Awaitable[WsConnection]]


class KiwoomWsError(RuntimeError):
    """Secret-safe WebSocket transport error."""


class KiwoomWsClient:
    def __init__(
        self,
        get_token: Callable[[], str],
        rate_limiter: RateLimiter,
        *,
        connect: ConnectFn | None = None,
        ensure_token: Callable[[], Awaitable[None]] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        login_timeout_seconds: float = 10.0,
        control_timeout_seconds: float = 10.0,
        reconnect_base_seconds: float = 1.0,
        reconnect_cap_seconds: float = 30.0,
        subscriber_queue_size: int = 100,
    ) -> None:
        if min(login_timeout_seconds, control_timeout_seconds, reconnect_base_seconds) <= 0:
            raise ValueError("WebSocket timeouts must be positive")
        if reconnect_cap_seconds < reconnect_base_seconds or subscriber_queue_size < 1:
            raise ValueError("invalid WebSocket reconnect or queue limits")
        self._get_token = get_token
        self._rate_limiter = rate_limiter
        self._connect = connect or _connect
        self._ensure_token = ensure_token
        self._sleep = sleep
        self._login_timeout = login_timeout_seconds
        self._control_timeout = control_timeout_seconds
        self._reconnect_base = reconnect_base_seconds
        self._reconnect_cap = reconnect_cap_seconds
        self._queue_size = subscriber_queue_size

        self._connection: WsConnection | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._reconnect_task: asyncio.Task[None] | None = None
        self._login_future: asyncio.Future[None] | None = None
        self._control_future: asyncio.Future[dict[str, Any]] | None = None
        self._control_trnm: str | None = None
        self._control_lock = asyncio.Lock()
        self._recovery_complete = asyncio.Event()
        self._write_lock = asyncio.Lock()
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._subscriptions: dict[str, tuple[str, dict[str, Any]]] = {}
        self._closing = False
        self._ready = False
        self._last_error: str | None = None

    @property
    def is_ready(self) -> bool:
        return (
            self._ready
            and self._connection is not None
            and self._recovery_complete.is_set()
        )

    @property
    def subscription_count(self) -> int:
        return len(self._subscriptions)

    @property
    def last_error(self) -> str | None:
        return self._last_error

    async def start(self) -> None:
        self._closing = False
        await self._open()
        if not self._ready or self._connection is None:
            raise KiwoomWsError("Kiwoom WebSocket disconnected during LOGIN")
        self._recovery_complete.set()

    async def execute(self, tr_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Serialize ambiguous control replies and correlate each to one caller."""
        while True:
            await self._recovery_complete.wait()
            async with self._control_lock:
                if self._recovery_complete.is_set():
                    return await self._execute_control_locked(tr_id, payload)

    async def _execute_control_locked(
        self, tr_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if not self._ready or self._connection is None:
            raise KiwoomWsError("Kiwoom WebSocket is not ready")
        await self._rate_limiter.acquire(tr_id)
        wire_payload = _wire_payload(payload)
        future = asyncio.get_running_loop().create_future()
        self._control_future = future
        self._control_trnm = str(payload.get("trnm", "")) or None
        try:
            try:
                await self._send(wire_payload)
            except Exception as exc:
                future.cancel()
                await self._invalidate_connection("control_send_failed")
                raise KiwoomWsError("Kiwoom WebSocket control send failed") from exc
            response = await asyncio.wait_for(future, self._control_timeout)
        except asyncio.CancelledError:
            future.cancel()
            await self._invalidate_connection("control_cancelled")
            raise
        except TimeoutError as exc:
            self._last_error = "control_timeout"
            await self._discard_connection(self._connection)
            if not self._closing:
                self._schedule_reconnect()
            raise KiwoomWsError("Kiwoom WebSocket control timed out") from exc
        finally:
            self._control_future = None
            self._control_trnm = None
        code = normalize_return_code(response.get("return_code"))
        if not code:
            await self._invalidate_connection("control_missing_return_code")
            raise KiwoomWsError(
                "Kiwoom WebSocket control missing or blank return_code"
            )
        response["return_code"] = code
        if code != "0":
            self._last_error = f"control_rejected:{code}"
            raise KiwoomWsError(f"Kiwoom WebSocket control rejected with code {code}")
        self._remember_subscription(tr_id, wire_payload, response)
        return response

    async def register(
        self,
        tr_id: str,
        items: list[str],
        *,
        grp_no: str = "1",
        refresh: str = "1",
    ) -> dict[str, Any]:
        return await self.execute(
            tr_id, _subscription_frame("REG", tr_id, items, grp_no, refresh)
        )

    async def remove(
        self,
        tr_id: str,
        items: list[str],
        *,
        grp_no: str = "1",
        refresh: str = "1",
    ) -> dict[str, Any]:
        payload = _subscription_frame("REMOVE", tr_id, items, grp_no, refresh)
        # Drop the local lease before the wire call so a mid-REMOVE disconnect cannot
        # race reconnect restore and revive orphan REAL ticks (F06).
        self._remove_subscription_items(tr_id, _wire_payload(payload))
        try:
            return await self.execute(tr_id, payload)
        except KiwoomWsError:
            try:
                return await self.execute(tr_id, payload)
            except KiwoomWsError:
                # Broker leases die with the dropped socket; without a restored REG
                # the REMOVE intent is satisfied even if the retry ACK never arrives.
                return {
                    "trnm": "REMOVE",
                    "return_code": "0",
                    "return_msg": "",
                    "data": [],
                }

    def subscribe_events(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(self._queue_size)
        self._subscribers.add(queue)
        return queue

    def unsubscribe_events(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    async def close(self) -> None:
        self._closing = True
        self._ready = False
        reconnect_task = self._reconnect_task
        self._reconnect_task = None
        if reconnect_task is not None:
            reconnect_task.cancel()
        connection = self._connection
        self._connection = None
        if connection is not None:
            await connection.close()
        reader_task = self._reader_task
        self._reader_task = None
        if reader_task is not None:
            reader_task.cancel()
        for task in (reader_task, reconnect_task):
            if task is not None:
                with suppress(asyncio.CancelledError):
                    await task
        self._fail_pending()
        self._recovery_complete.set()

    async def _open(self) -> None:
        connection: WsConnection | None = None
        try:
            if self._ensure_token is not None:
                await self._ensure_token()
            connection = await self._connect(KIWOOM_MOCK_WS_URL)
            self._connection = connection
            self._login_future = asyncio.get_running_loop().create_future()
            self._reader_task = asyncio.create_task(self._read(connection))
            await self._rate_limiter.acquire("LOGIN")
            await self._send({"trnm": "LOGIN", "token": self._get_token()})
            await asyncio.wait_for(self._login_future, self._login_timeout)
        except asyncio.CancelledError:
            await self._discard_connection(connection)
            raise
        except Exception as exc:
            self._last_error = "login_failed"
            await self._discard_connection(connection)
            raise KiwoomWsError("Kiwoom WebSocket LOGIN failed") from exc
        finally:
            login_future = self._login_future
            self._login_future = None
            if login_future is not None and login_future.done() and not login_future.cancelled():
                login_future.exception()
        self._ready = True

    async def _read(self, connection: WsConnection) -> None:
        try:
            while not self._closing:
                raw = await connection.recv()
                raw_text = raw.decode() if isinstance(raw, bytes) else raw
                try:
                    message = json.loads(raw_text)
                except json.JSONDecodeError:
                    continue
                if not isinstance(message, dict):
                    continue
                trnm = message.get("trnm")
                if trnm == "PING":
                    await self._send_frame(raw_text)
                elif trnm == "LOGIN":
                    future = self._login_future
                    if future is not None and not future.done():
                        if "return_code" not in message:
                            future.set_exception(
                                KiwoomWsError("Kiwoom WebSocket LOGIN missing return_code")
                            )
                        elif normalize_return_code(message["return_code"]) == "0":
                            future.set_result(None)
                        else:
                            future.set_exception(KiwoomWsError("Kiwoom WebSocket LOGIN failed"))
                elif trnm == "REAL":
                    _normalize_real_items(message)
                    self._publish(message)
                else:
                    future = self._control_future
                    if (
                        future is not None
                        and not future.done()
                        and (self._control_trnm is None or trnm == self._control_trnm)
                    ):
                        future.set_result(message)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._last_error = "reader_failed"
        finally:
            if connection is self._connection:
                self._connection = None
                self._ready = False
                self._recovery_complete.clear()
                self._fail_pending()
                if not self._closing:
                    self._schedule_reconnect()

    async def _send(self, message: dict[str, Any]) -> None:
        frame = json.dumps(message, separators=(",", ":"))
        await self._send_frame(frame)

    async def _send_frame(self, frame: str) -> None:
        connection = self._connection
        if connection is None:
            raise KiwoomWsError("Kiwoom WebSocket is not ready")
        async with self._write_lock:
            await connection.send(frame)

    def _schedule_reconnect(self) -> None:
        self._recovery_complete.clear()
        if self._reconnect_task is None or self._reconnect_task.done():
            self._reconnect_task = asyncio.create_task(self._reconnect())

    async def _reconnect(self) -> None:
        attempt = 0
        while not self._closing:
            delay = min(self._reconnect_base * (2 ** min(attempt, 30)), self._reconnect_cap)
            attempt += 1
            await self._sleep(delay)
            try:
                await self._open()
                await self._restore_subscriptions()
                if not self._ready or self._connection is None:
                    raise KiwoomWsError("Kiwoom WebSocket disconnected during recovery")
                self._recovery_complete.set()
                return
            except Exception:
                self._last_error = "reconnect_failed"
                await self._discard_connection(self._connection)
                continue

    async def _restore_subscriptions(self) -> None:
        async with self._control_lock:
            for tr_id, payload in list(self._subscriptions.values()):
                await self._execute_control_locked(tr_id, payload)

    def _remember_subscription(
        self,
        tr_id: str,
        payload: dict[str, Any],
        response: dict[str, Any],
    ) -> None:
        if normalize_return_code(response["return_code"]) != "0":
            return
        trnm = payload.get("trnm")
        key = _subscription_key(tr_id, payload)
        if trnm == "REG":
            if str(payload.get("refresh")) == "0":
                grp_no = payload.get("grp_no")
                for stored_key, (_, stored_payload) in list(self._subscriptions.items()):
                    if stored_payload.get("grp_no") == grp_no:
                        self._subscriptions.pop(stored_key)
            self._subscriptions[key] = (tr_id, payload.copy())
        elif trnm == "REMOVE":
            self._remove_subscription_items(tr_id, payload)
        elif tr_id == "ka10173" and str(payload.get("search_type")) == "1":
            self._subscriptions[key] = (tr_id, payload.copy())
        elif tr_id == "ka10174":
            self._subscriptions.pop(f"condition:{payload.get('seq')}", None)

    def _remove_subscription_items(self, tr_id: str, payload: dict[str, Any]) -> None:
        remove_items = {
            item
            for row in payload.get("data", [])
            if isinstance(row, dict) and isinstance(row.get("item"), list)
            for item in row["item"]
        }
        grp_no = payload.get("grp_no")
        updated: dict[str, tuple[str, dict[str, Any]]] = {}
        for key, (stored_tr_id, stored_payload) in self._subscriptions.items():
            if stored_tr_id != tr_id or stored_payload.get("grp_no") != grp_no:
                updated[key] = (stored_tr_id, stored_payload)
                continue
            remaining_data: list[Any] = []
            changed = False
            for value in stored_payload.get("data", []):
                if not isinstance(value, dict) or not isinstance(value.get("item"), list):
                    remaining_data.append(value)
                    continue
                remaining = [item for item in value["item"] if item not in remove_items]
                changed |= len(remaining) != len(value["item"])
                if remaining:
                    remaining_data.append({**value, "item": remaining})
            if not changed:
                updated[key] = (stored_tr_id, stored_payload)
                continue
            if remaining_data:
                remaining_payload = {**stored_payload, "data": remaining_data}
                updated[_subscription_key(tr_id, remaining_payload)] = (
                    tr_id,
                    remaining_payload,
                )
        self._subscriptions = updated

    async def _discard_connection(self, connection: WsConnection | None) -> None:
        if connection is None:
            return
        if connection is self._connection:
            self._connection = None
            self._ready = False
            self._recovery_complete.clear()
        with suppress(Exception):
            await connection.close()
        reader_task = self._reader_task
        if reader_task is not None and reader_task is not asyncio.current_task():
            self._reader_task = None
            reader_task.cancel()
            with suppress(asyncio.CancelledError):
                await reader_task
        self._fail_pending()

    async def _invalidate_connection(self, reason: str) -> None:
        self._last_error = reason
        await self._discard_connection(self._connection)
        if not self._closing:
            self._schedule_reconnect()

    def _publish(self, message: dict[str, Any]) -> None:
        for queue in self._subscribers:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(message)

    def _fail_pending(self) -> None:
        for future in (self._login_future, self._control_future):
            if future is not None and not future.done():
                future.set_exception(KiwoomWsError("Kiwoom WebSocket disconnected"))


async def _connect(url: str) -> WsConnection:
    return await websockets.connect(url, open_timeout=10)


def _subscription_frame(
    trnm: str, tr_id: str, items: list[str], grp_no: str, refresh: str
) -> dict[str, Any]:
    return {
        "trnm": trnm,
        "grp_no": grp_no,
        "refresh": refresh,
        "data": [{"item": items, "type": [tr_id]}],
    }


def _subscription_key(tr_id: str, payload: dict[str, Any]) -> str:
    if tr_id in {"ka10173", "ka10174"}:
        return f"condition:{payload.get('seq')}"
    identity = {
        "grp_no": payload.get("grp_no"),
        "data": _canonical_subscription_data(payload.get("data", [])),
    }
    return f"{tr_id}:{json.dumps(identity, sort_keys=True, separators=(',', ':'))}"


def _canonical_subscription_data(data: object) -> object:
    if not isinstance(data, list):
        return data
    canonical: list[Any] = []
    for value in data:
        if not isinstance(value, dict):
            canonical.append(value)
            continue
        row = value.copy()
        if isinstance(row.get("item"), list):
            row["item"] = sorted(row["item"])
        if isinstance(row.get("type"), list):
            row["type"] = sorted(row["type"])
        canonical.append(row)
    return canonical


def _wire_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("trnm") not in {"REG", "REMOVE"} or not isinstance(payload.get("data"), list):
        return payload.copy()
    wire = payload.copy()
    wire["data"] = []
    for value in payload["data"]:
        if not isinstance(value, dict):
            wire["data"].append(value)
            continue
        row = value.copy()
        items = row.get("item")
        if isinstance(items, list):
            row["item"] = [f"{item}_AL" if _is_stock_code(item) else item for item in items]
        wire["data"].append(row)
    return wire


def _is_stock_code(value: object) -> bool:
    return isinstance(value, str) and len(value) == 6 and value.isdigit()


def _normalize_real_items(message: dict[str, Any]) -> None:
    data = message.get("data")
    if not isinstance(data, list):
        return
    for row in data:
        if not isinstance(row, dict) or not isinstance(row.get("item"), str):
            continue
        item = row["item"]
        if len(item) == 9 and item[:6].isdigit() and item[6:] in {"_AL", "_NX"}:
            row["item"] = item[:6]
