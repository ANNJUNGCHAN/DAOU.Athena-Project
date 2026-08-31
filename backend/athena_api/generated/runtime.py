"""Shared execution boundary for generated inventory routes."""

from __future__ import annotations

import asyncio
import json
import secrets
from collections import OrderedDict
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, TypeVar

from fastapi import HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from athena_api.accounts import account_runtimes, order_scope_for
from athena_api.errors import OrderScopeError
from athena_api.generated.registry import TR_REGISTRY
from athena_api.kiwoom import RequestOptions, ResponseEnvelope
from athena_api.kiwoom.return_codes import normalize_return_code

ModelT = TypeVar("ModelT", bound=BaseModel)
_ORDER_CACHE_LIMIT = 1024
_CONDITION_WS_TR_IDS = frozenset({"ka10171", "ka10172", "ka10173", "ka10174"})


class OrderState(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    IN_DOUBT = "in_doubt"


@dataclass(slots=True)
class OrderReservation:
    fingerprint: str
    state: OrderState
    completed: asyncio.Event
    envelope: ResponseEnvelope | None = None


def _request_options(request: Request) -> RequestOptions:
    cont_yn = (request.headers.get("cont-yn") or "N").strip() or "N"
    if cont_yn not in {"N", "Y"}:
        raise HTTPException(status_code=400, detail="cont-yn must be N or Y")
    next_key = (request.headers.get("next-key") or "").strip() or None
    return RequestOptions(cont_yn=cont_yn, next_key=next_key)


def apply_continuation_headers(response: Response, envelope: ResponseEnvelope) -> None:
    response.headers["cont-yn"] = envelope.cont_yn
    if envelope.next_key:
        response.headers["next-key"] = envelope.next_key


def _is_business_result(body: dict[str, Any]) -> bool:
    return normalize_return_code(body.get("return_code")) not in {"", "0"}


def _business_result_response(envelope: ResponseEnvelope) -> JSONResponse:
    headers = {"cont-yn": envelope.cont_yn}
    if envelope.next_key:
        headers["next-key"] = envelope.next_key
    return JSONResponse(status_code=200, content=envelope.body, headers=headers)


def _require_bearer(request: Request, authorization: str) -> None:
    scheme, _, credential = authorization.partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer authentication required"
        )
    expected = getattr(request.app.state, "local_bearer_token", None)
    if expected is None or not secrets.compare_digest(credential.strip(), str(expected)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer credential"
        )


async def call_typed_tr(
    tr_id: str,
    payload: BaseModel,
    request: Request,
    response: Response,
    client: Any,
    *,
    response_model: type[ModelT] | None = None,
) -> ModelT | JSONResponse:
    spec = TR_REGISTRY[tr_id]
    envelope = await client.post_with_headers(
        tr_id,
        spec.upstream_path,
        payload.model_dump(by_alias=True, exclude_none=True),
        _request_options(request),
    )
    if _is_business_result(envelope.body):
        return _business_result_response(envelope)
    apply_continuation_headers(response, envelope)
    model = response_model or spec.response_model
    if response_model is None:
        body = envelope.body
    else:
        aliases = {field.alias or name for name, field in model.model_fields.items()}
        body = {key: value for key, value in envelope.body.items() if key in aliases}
    return model.model_validate(body)


async def call_raw_tr(
    tr_id: str,
    body: dict[str, Any],
    request: Request,
    response: Response,
    client: Any,
) -> dict[str, Any]:
    spec = TR_REGISTRY[tr_id]
    envelope = await client.post_with_headers(
        tr_id, spec.upstream_path, body, _request_options(request)
    )
    apply_continuation_headers(response, envelope)
    return envelope.body


async def call_websocket_tr(tr_id: str, payload: BaseModel, client: Any) -> BaseModel:
    body = payload.model_dump(by_alias=True, exclude_none=True)
    if tr_id in _CONDITION_WS_TR_IDS:
        result = await client.execute(tr_id, body)
    else:
        command = str(body.get("trnm", ""))
        if command not in {"REG", "REMOVE"}:
            raise HTTPException(status_code=422, detail="trnm must be REG or REMOVE")
        items: list[str] = []
        for entry in body.get("data", []):
            entry_type = str(entry.get("type", ""))
            if entry_type != tr_id:
                detail = f"data.type must exactly match case-sensitive TR id {tr_id}"
                if tr_id == "0g":
                    detail += "; lowercase 0g is distinct from uppercase 0G"
                raise HTTPException(status_code=422, detail=detail)
            item = entry.get("item")
            if item is not None:
                items.append(str(item))
        grp_no = str(body.get("grp_no", "1"))
        refresh = str(body.get("refresh", "1"))
        if command == "REG":
            result = await client.register(tr_id, items, grp_no=grp_no, refresh=refresh)
        else:
            result = await client.remove(tr_id, items, grp_no=grp_no, refresh=refresh)
    if not isinstance(result, dict) or "return_code" not in result:
        raise HTTPException(status_code=502, detail="Kiwoom WebSocket response was invalid")
    normalized = dict(result)
    normalized["return_code"] = normalize_return_code(normalized["return_code"])
    if not normalized["return_code"]:
        raise HTTPException(status_code=502, detail="Kiwoom WebSocket response was invalid")
    if tr_id == "ka10171" and isinstance(normalized.get("data"), list):
        normalized["data"] = [
            {"seq": row[0], "name": row[1]}
            if isinstance(row, list) and len(row) == 2
            else row
            for row in normalized["data"]
        ]
    return TR_REGISTRY[tr_id].response_model.model_validate(normalized)


async def call_order_tr(
    tr_id: str,
    payload: BaseModel,
    request: Request,
    response: Response,
    client: Any,
    authorization: str,
    confirmation: str,
    idempotency_key: str,
    account: str = "",
) -> BaseModel | JSONResponse:
    _require_bearer(request, authorization)
    if confirmation.strip().lower() != "true":
        raise HTTPException(status_code=428, detail="X-Athena-Confirm: true is required")
    idempotency_key = idempotency_key.strip()
    if not idempotency_key or len(idempotency_key) > 128:
        raise HTTPException(
            status_code=400, detail="Idempotency-Key must contain 1 to 128 characters"
        )

    spec = TR_REGISTRY[tr_id]
    scope = order_scope_for(tr_id, spec.upstream_path)
    runtime = account_runtimes(request.app).get(account)
    if runtime is not None and not runtime.permits_order(scope):
        raise OrderScopeError(
            f"account '{account}' may not place {scope.value} orders ({tr_id})"
        )

    lock = request.app.state.order_idempotency_lock
    cache: OrderedDict[tuple[str, str, str], OrderReservation] = (
        request.app.state.order_idempotency_cache
    )
    # Account-scoped: two accounts may legitimately reuse the same client-generated key,
    # and without this discriminator one would read or block the other's reservation.
    key = (account, tr_id, idempotency_key)
    order_body = payload.model_dump(by_alias=True, exclude_none=True)
    fingerprint = json.dumps(order_body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    owner = False
    async with lock:
        reservation = cache.get(key)
        if reservation is not None and reservation.fingerprint != fingerprint:
            raise HTTPException(
                status_code=409, detail="Idempotency-Key was already used for another order"
            )
        if reservation is None:
            while len(cache) >= _ORDER_CACHE_LIMIT:
                completed_key = next(
                    (
                        candidate
                        for candidate, value in cache.items()
                        if value.state is OrderState.COMPLETED
                    ),
                    None,
                )
                if completed_key is None:
                    raise HTTPException(
                        status_code=503, detail="Order idempotency capacity exhausted"
                    )
                del cache[completed_key]
            reservation = OrderReservation(
                fingerprint=fingerprint,
                state=OrderState.PENDING,
                completed=asyncio.Event(),
            )
            cache[key] = reservation
            owner = True
        elif reservation.state is OrderState.IN_DOUBT:
            raise HTTPException(status_code=409, detail="Prior order outcome is in doubt")
        elif reservation.state is OrderState.COMPLETED:
            cache.move_to_end(key)
            assert reservation.envelope is not None
            envelope = reservation.envelope

    if not owner and reservation.state is OrderState.PENDING:
        await reservation.completed.wait()
        async with lock:
            if reservation.state is OrderState.IN_DOUBT:
                raise HTTPException(status_code=409, detail="Prior order outcome is in doubt")
            assert reservation.envelope is not None
            envelope = reservation.envelope

    if owner:
        try:
            envelope = await client.post_with_headers(
                tr_id,
                spec.upstream_path,
                order_body,
                _request_options(request),
            )
            async with lock:
                reservation.envelope = envelope
                reservation.state = OrderState.COMPLETED
                reservation.completed.set()
                cache.move_to_end(key)
        except BaseException:
            if reservation.state is OrderState.PENDING:
                reservation.state = OrderState.IN_DOUBT
                reservation.completed.set()
            raise
    if _is_business_result(envelope.body):
        return _business_result_response(envelope)
    apply_continuation_headers(response, envelope)
    return TR_REGISTRY[tr_id].response_model.model_validate(envelope.body)


async def call_internal_oauth(
    tr_id: str, request: Request, manager: Any, authorization: str
) -> BaseModel:
    _require_bearer(request, authorization)
    if tr_id == "au10001":
        lifecycle_status = await manager.issue()
    elif tr_id == "au10002":
        lifecycle_status = await manager.revoke()
    else:  # Generated routes make this unreachable.
        raise HTTPException(status_code=404, detail="Unknown OAuth operation")
    return TR_REGISTRY[tr_id].response_model.model_validate(lifecycle_status)
