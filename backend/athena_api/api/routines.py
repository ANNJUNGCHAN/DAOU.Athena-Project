
from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
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


def _is_unread(last_fired_at: str | None, last_read_at: str | None) -> bool:
    if last_fired_at is None:
        return False
    if last_read_at is None:
        return True
    try:
        return datetime.fromisoformat(last_fired_at) > datetime.fromisoformat(last_read_at)
    except ValueError:
        return True  # 파싱 실패 시 안전한 쪽(안읽음)으로 fallback


def _runtime(request: Request) -> RoutinesRuntime:
    runtime = getattr(request.app.state, "routines_runtime", None)
    if runtime is None or not runtime.ready:
        raise HTTPException(
            status_code=503,
            detail="루틴 서브시스템이 비활성이다 (ATHENA_ROUTINES_ENABLED=true 필요)",
        )
    return runtime


def _view(
    spec: Any, runtime: RoutinesRuntime, *, latest_fired: dict[str, Any] | None = None
) -> dict[str, Any]:
    """목록·응답 뷰 — 조건 원문 dict 대신 사람이 읽는 해석문만 노출한다.

    latest_fired는 list_routines()가 ledger를 1회 스캔해 만든 routine_id→
    최신 fired 행 맵에서 이 spec 몫만 주입한 것이다 — 이 함수 자신은
    ledger를 읽지 않는다(N+1 스캔 방지, MAJOR)."""
    source_spec = SOURCES[spec.condition.source]
    last_fired_at = latest_fired["ts"] if latest_fired else None
    last_read_at = runtime.read_marks.last_read_fired_at(spec.id)
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
        "last_fired_at": last_fired_at,
        "unread": _is_unread(last_fired_at, last_read_at),
    }


@router.post("/draft")
async def create_draft(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    runtime = _runtime(request)
    spec = validate_draft(body)  # RoutineValidationError → 422 (errors.py)
    runtime.store.upsert(spec)
    return _view(spec, runtime)


@router.get("")
async def list_routines(request: Request) -> dict[str, Any]:
    """목록 — ledger.read_all()을 요청당 정확히 1회만 호출한다(N+1 방지, MAJOR).

    한 번의 스캔으로 ① 오늘(KST) 발화 수와 ② routine_id→최신 fired 행
    맵을 동시에 만들고, 맵은 _view()에 주입한다(ledger를 다시 읽지 않음)."""
    runtime = _runtime(request)
    today = datetime.now(_KST).date()
    fired_today = 0
    latest_fired: dict[str, dict[str, Any]] = {}
    for row in runtime.ledger.read_all():
        if row.get("verdict") != "fired":
            continue
        rid = row.get("routine_id")
        if isinstance(rid, str):
            latest_fired[rid] = row  # append-only라 마지막에 만난 게 최신
        ts = row.get("ts")
        if isinstance(ts, str):
            try:
                if datetime.fromisoformat(ts).astimezone(_KST).date() == today:
                    fired_today += 1
            except ValueError:
                pass
    return {
        "routines": [
            _view(s, runtime, latest_fired=latest_fired.get(s.id))
            for s in runtime.store.list_all()
        ],
        "disclosure_ready": runtime.disclosure_ready,
        "last_error": runtime.last_error,
        "fired_today": fired_today,
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
    # 최근 30건(옛 jsonl은 duration_ms 키 자체가 없을 수 있다 — 하위호환 방어).
    durations = [
        r["duration_ms"] for r in rows[-30:] if isinstance(r.get("duration_ms"), (int, float))
    ]
    avg_duration_ms = sum(durations) / len(durations) if durations else None
    return {"runs": rows, "avg_duration_ms": avg_duration_ms}


@router.post("/{routine_id}/ack")
async def ack_routine(
    request: Request, routine_id: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    """읽음 처리 — read_marks에 확인 시각까지 기록한다. body.fired_at으로 특정
    발화까지 지정할 수 있고, 없으면 현재 시각(그 이전 발화는 전부 읽음 처리)."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    fired_at = (body or {}).get("fired_at")
    if not isinstance(fired_at, str) or not fired_at:
        fired_at = datetime.now(UTC).isoformat()
    runtime.read_marks.ack(routine_id, fired_at)
    return {"id": routine_id, "last_read_fired_at": fired_at}
