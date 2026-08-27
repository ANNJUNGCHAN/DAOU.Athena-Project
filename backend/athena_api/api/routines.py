
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from athena_api.routines.models import SOURCES, parse_schedule_value
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import RoutinesRuntime

router = APIRouter(prefix="/api/v1/routines", tags=["routines"])

_KST = timezone(timedelta(hours=9))


def _next_fire_at(spec: Any, *, now: datetime | None = None) -> str | None:
    """예약(schedule.daily) 스펙의 다음 발화 시각 — 순수 함수, 저장하지 않는다."""
    if spec.mode != "scheduled":
        return None
    parsed = parse_schedule_value(spec.condition.value)
    if parsed is None:
        return None
    days, hhmm = parsed
    hour, minute = int(hhmm[:2]), int(hhmm[3:])
    base = (now or datetime.now(_KST)).astimezone(_KST)
    for offset in range(8):  # 오늘 포함 최대 7일 뒤까지 탐색
        candidate_date = base.date() + timedelta(days=offset)
        if days is not None and candidate_date.isoweekday() not in days:
            continue
        candidate = datetime(
            candidate_date.year,
            candidate_date.month,
            candidate_date.day,
            hour,
            minute,
            tzinfo=_KST,
        )
        if candidate >= base:
            return candidate.isoformat()
    return None


def _fired_today_kst(rows: list[dict[str, Any]], *, now: datetime | None = None) -> int:
    """오늘(KST) 발화(fired) 건수 — list_routines()가 1회 read_all()로 계산한다."""
    today = (now or datetime.now(_KST)).astimezone(_KST).date()
    count = 0
    for row in rows:
        if row.get("verdict") != "fired":
            continue
        ts = row.get("ts")
        if not isinstance(ts, str):
            continue
        try:
            parsed = datetime.fromisoformat(ts)
        except ValueError:
            continue
        if parsed.astimezone(_KST).date() == today:
            count += 1
    return count


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
        "next_fire_at": _next_fire_at(spec),
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
        "fired_today": _fired_today_kst(runtime.ledger.read_all()),
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


@router.post("/{routine_id}/pause")
async def pause_routine(request: Request, routine_id: str) -> dict[str, Any]:
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    spec = runtime.store.transition(routine_id, "paused")
    if spec.mode == "realtime-ws":
        await runtime.release_realtime_subscription(spec.symbol)
    return _view(spec, runtime)


@router.post("/{routine_id}/resume")
async def resume_routine(request: Request, routine_id: str) -> dict[str, Any]:
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
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
    if spec.mode == "realtime-ws":
        await runtime.release_realtime_subscription(spec.symbol)
    return _view(spec, runtime)


@router.get("/{routine_id}/runs")
async def list_routine_runs(request: Request, routine_id: str) -> dict[str, Any]:
    """실행 이력 조회 — ledger는 그대로 두고 라우터 레벨에서 routine_id로 거른다."""
    runtime = _runtime(request)
    rows = [r for r in runtime.ledger.read_all() if r.get("routine_id") == routine_id]
    return {"runs": rows}
