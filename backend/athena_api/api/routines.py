
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from athena_api.routines.models import SOURCES
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import RoutinesRuntime

router = APIRouter(prefix="/api/v1/routines", tags=["routines"])


def _runtime(request: Request) -> RoutinesRuntime:
    runtime = getattr(request.app.state, "routines_runtime", None)
    if runtime is None or not runtime.ready:
        raise HTTPException(
            status_code=503,
            detail="루틴 서브시스템이 비활성이다 (ATHENA_ROUTINES_ENABLED=true 필요)",
        )
    return runtime


def _view(spec: Any, runtime: RoutinesRuntime) -> dict[str, Any]:
    """목록·응답 뷰 — 조건 원문 dict 대신 사람이 읽는 해석문만 노출한다."""
    source_spec = SOURCES[spec.condition.source]
    return {
        "id": spec.id,
        "symbol": spec.symbol,
        "note": spec.note,
        "source_label": source_spec.label,
        "mode": spec.mode,
        "status": spec.status,
        "cooldown_s": spec.cooldown_s,
        "expires_at": spec.expires_at.isoformat(),
        "created_at": spec.created_at.isoformat(),
        "approved_at": spec.approved_at.isoformat() if spec.approved_at else None,
        "activation_blocker": runtime.can_activate(spec),
        "experimental_source": source_spec.experimental,
    }


@router.post("/draft")
async def create_draft(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    runtime = _runtime(request)
    spec = validate_draft(body)  # RoutineValidationError → 422 (errors.py)
    runtime.store.upsert(spec)
    return _view(spec, runtime)


@router.get("")
async def list_routines(request: Request) -> dict[str, Any]:
    runtime = _runtime(request)
    return {
        "routines": [_view(s, runtime) for s in runtime.store.list_all()],
        "disclosure_ready": runtime.disclosure_ready,
        "last_error": runtime.last_error,
    }


@router.post("/{routine_id}/confirm")
async def confirm_routine(request: Request, routine_id: str) -> dict[str, Any]:
    """사람의 승인 — 평가 경로가 살아 있을 때만 활성화한다(정직 게이트)."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    blocker = runtime.can_activate(spec)
    if blocker is not None:
        raise HTTPException(status_code=409, detail=blocker)
    if spec.mode == "realtime-ws":
        try:
            await runtime.ensure_realtime_subscription(spec.symbol)
        except Exception as exc:
            raise HTTPException(
                status_code=502, detail="실시간 구독 등록에 실패했다"
            ) from exc
    spec = runtime.store.transition(routine_id, "active")
    return _view(spec, runtime)


@router.post("/{routine_id}/cancel")
async def cancel_routine(request: Request, routine_id: str) -> dict[str, Any]:
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    spec = runtime.store.transition(routine_id, "cancelled")
    return _view(spec, runtime)
