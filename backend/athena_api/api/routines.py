
from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from athena_api.routines.models import SOURCES, parse_schedule_value, source_spec
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import RoutinesRuntime
from athena_api.routines.scheduler import record_scheduled_fire

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


def _missed_since(spec: Any, *, now: datetime | None = None) -> datetime | None:
    """예약(schedule.daily) 스펙의 직전 예약 발생 시각 — _next_fire_at과 대칭인
    순수 함수(과거 방향 탐색). "놓쳤는가" 판정은 호출부가 ledger의 최신 fired
    시각과 비교해 내린다 — 이 함수는 벽시계 계산만 한다."""
    if spec.mode != "scheduled":
        return None
    parsed = parse_schedule_value(spec.condition.value)
    if parsed is None:
        return None
    days, hhmm = parsed
    hour, minute = int(hhmm[:2]), int(hhmm[3:])
    base = (now or datetime.now(_KST)).astimezone(_KST)
    for offset in range(8):  # 오늘 포함 최대 7일 전까지 탐색
        candidate_date = base.date() - timedelta(days=offset)
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
        if candidate <= base:
            return candidate
    return None


def _is_missed(missed_at: datetime | None, last_fired_at: str | None) -> bool:
    """직전 예약 발생 시각 이후로 발화 기록이 없으면 놓친 것이다."""
    if missed_at is None:
        return False
    if last_fired_at is None:
        return True
    try:
        return datetime.fromisoformat(last_fired_at) < missed_at
    except ValueError:
        return True  # 파싱 실패 시 안전한 쪽(놓침)으로 fallback


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
    source = source_spec(spec.condition.source)
    last_fired_at = latest_fired["ts"] if latest_fired else None
    last_read_at = runtime.read_marks.last_read_fired_at(spec.id)
    return {
        "id": spec.id,
        "symbol": spec.symbol,
        "note": spec.note,
        "goal": spec.goal,
        "source_label": source.label,
        "mode": spec.mode,
        "status": spec.status,
        "cooldown_s": spec.cooldown_s,
        "expires_at": spec.expires_at.isoformat(),
        "created_at": spec.created_at.isoformat(),
        "approved_at": spec.approved_at.isoformat() if spec.approved_at else None,
        "activation_blocker": runtime.can_activate(spec),
        "experimental_source": source.experimental,
        "next_fire_at": _next_fire_at(spec),
        "last_fired_at": last_fired_at,
        "unread": _is_unread(last_fired_at, last_read_at),
        "briefing_model": spec.briefing_model,
        "briefing_effort": spec.briefing_effort,
        # 놓친 예약은 활성 루틴에서만 의미가 있다 — 캐치업(catchup-fire)도
        # active만 허용하므로 뷰와 실행 가능성이 일치한다.
        "missed": spec.status == "active"
        and _is_missed(_missed_since(spec), last_fired_at),
    }


# 편집(POST /{id}/update)이 만질 수 있는 필드 — symbol·condition.source는
# 여기 없다(바꾸면 다른 루틴이다). 조건은 op·value·consecutive_ticks만.
_UPDATABLE_FIELDS = ("note", "cooldown_s", "expires_days", "briefing_model", "briefing_effort")
_UPDATABLE_CONDITION_FIELDS = ("op", "value", "consecutive_ticks")


def _detail_view(spec: Any, runtime: RoutinesRuntime) -> dict[str, Any]:
    """단일 루틴 상세 뷰 — 편집 폼이 필요한 조건 원문·소스 명세를 낸다.

    _view()와 달리 발화·읽음·놓침 같은 운영 지표는 담지 않는다(목록의 몫).
    ledger를 읽지 않으므로 편집 왕복이 원장 스캔을 유발하지 않는다."""
    source = source_spec(spec.condition.source)
    return {
        "id": spec.id,
        "symbol": spec.symbol,
        "status": spec.status,
        "mode": spec.mode,
        "source_label": source.label,
        "cooldown_s": spec.cooldown_s,
        "expires_at": spec.expires_at.isoformat(),
        "note": spec.note,
        "briefing_model": spec.briefing_model,
        "briefing_effort": spec.briefing_effort,
        "activation_blocker": runtime.can_activate(spec),
        "experimental_source": source.experimental,
        "goal": spec.goal,
        "condition": spec.condition.to_dict(),
        "source_spec": {
            "ops": list(source.ops),
            "value_type": source.value_type,
            "transport": source.transport,
            "label": source.label,
        },
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
        "last_error": runtime.last_error,
        "fired_today": fired_today,
    }


@router.get("/briefing-budget")
async def briefing_budget(request: Request) -> dict[str, Any]:
    """자동 브리핑 하루 예산 — limit은 가드 설정, used_today는 오늘(KST)
    "briefed" engagement 카운트. main의 러너가 실행 전에 조회한다."""
    runtime = _runtime(request)
    limit = request.app.state.nudge_guard_store.get().max_daily_briefings
    today = datetime.now(_KST).date()
    used_today = 0
    for row in runtime.engagement.read_all():
        if row.get("event") != "briefed":
            continue
        ts = row.get("ts")
        if isinstance(ts, str):
            try:
                if datetime.fromisoformat(ts).astimezone(_KST).date() == today:
                    used_today += 1
            except ValueError:
                pass
    return {
        "limit": limit,
        "used_today": used_today,
        "remaining": max(0, limit - used_today),
    }


@router.get("/source-catalog")
async def source_catalog(request: Request) -> dict[str, Any]:
    """조건 소스 카탈로그 — 06 설정 폼이 소스별 분기(허용 연산자·값 타입·
    연속 틱 가능 여부)를 이 응답 하나로 세운다. 레거시(앱 플러그인 전용)
    소스는 새 조건에 못 쓰므로 나가지 않는다."""
    _runtime(request)
    return {
        source: {
            "ops": list(spec.ops),
            "value_type": spec.value_type,
            "transport": spec.transport,
            "label": spec.label,
            "experimental": spec.experimental,
        }
        for source, spec in SOURCES.items()
    }


@router.get("/{routine_id}")
async def get_routine(request: Request, routine_id: str) -> dict[str, Any]:
    """단일 루틴 상세 — 목록(_view)과 달리 **조건 원문**을 낸다.

    목록은 사람이 읽는 해석문만 노출한다는 규율을 유지하고, 편집 폼이 필요한
    술어(source/op/value/consecutive_ticks)는 이 라우트에서만 나간다. 발화·
    읽음 같은 운영 지표는 목록의 몫이라 여기 없다."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    return _detail_view(spec, runtime)


@router.post("/{routine_id}/update")
async def update_routine(
    request: Request, routine_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """설정 편집 — 저장된 스펙에 허용 필드만 덮어쓰고 **전량 재검증**한다.

    symbol과 condition.source는 바꿀 수 없다(다른 루틴이 되고 구독·모드가
    함께 흔들린다) — 새로 만들어야 한다. 재검증은 draft와 같은 rules를 쓰므로
    소스별 연산자·값 타입·연속 틱 규칙이 편집 경로에서도 똑같이 선다."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    if spec.status == "cancelled":
        raise HTTPException(status_code=409, detail="취소된 작업 — 수정 불가")
    if spec.condition.source not in SOURCES:
        # 레거시 소스는 새 조건 검증을 통과할 수 없다 — 편집이 아니라 재생성이다.
        raise HTTPException(
            status_code=409, detail="지원하지 않는 조건 — 취소 후 새로 만들기"
        )

    body_condition = body.get("condition")
    if body_condition is not None and not isinstance(body_condition, dict):
        raise HTTPException(status_code=422, detail="condition은 객체여야 한다")
    body_condition = body_condition or {}
    if "symbol" in body and body["symbol"] != spec.symbol:
        raise HTTPException(status_code=422, detail="종목 — 변경 불가 · 취소 후 새로 만들기")
    if (
        "source" in body_condition
        and body_condition["source"] != spec.condition.source
    ):
        raise HTTPException(status_code=422, detail="조건 소스 — 변경 불가 · 취소 후 새로 만들기")

    merged = spec.to_dict()
    condition = dict(merged["condition"])
    for key in _UPDATABLE_CONDITION_FIELDS:
        if key in body_condition:
            condition[key] = body_condition[key]
    merged["condition"] = condition
    for key in _UPDATABLE_FIELDS:
        if key in body:
            merged[key] = body[key]
    condition_changed = condition != spec.condition.to_dict()
    # note 신선도: 자동 생성문이었고 조건이 실제로 바뀌었고 새 note가 없으면
    # 비워서 재생성시킨다 — 사람이 쓴 note는 어떤 경우에도 덮어쓰지 않는다.
    if condition_changed and "note" not in body and spec.note == spec.human_summary():
        merged["note"] = ""

    updated = validate_draft(merged)  # RoutineValidationError → 422 (errors.py)
    updated.id = spec.id
    updated.status = spec.status
    updated.created_at = spec.created_at
    updated.approved_at = spec.approved_at
    if "expires_days" not in body:
        updated.expires_at = spec.expires_at  # 편집이 만료를 몰래 연장하지 않는다
    runtime.store.upsert(updated)
    if condition_changed:
        # 옛 조건의 연속 틱·쿨다운 누적을 버린다 — 새 조건은 새로 센다.
        runtime.engine.reset_state(routine_id)
    return _detail_view(updated, runtime)


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
    await runtime.scheduler.clear_near(spec)  # 유령 watch 방지 — CP3-1
    if spec.mode == "realtime-ws":
        await runtime.release_realtime_subscription(spec.symbol)
    return _view(spec, runtime)


@router.post("/{routine_id}/catchup-fire")
async def catchup_fire(request: Request, routine_id: str) -> dict[str, Any]:
    """놓친 예약의 캐치업 발화 기록 — 사용자가 카드에서 승인했을 때만 호출된다.

    응답 fired_at은 서버가 실제로 ledger에 쓴 ISO 시각(authoritative)이다 —
    main이 이 값을 그대로 runBriefingTurn의 fired_at으로 쓴다(idempotency 키·
    briefings 기록·로컬 시계 편차 방지 전부 이 값 하나로 정합)."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    if spec.mode != "scheduled":
        raise HTTPException(status_code=409, detail="예약(scheduled) 루틴만 캐치업할 수 있다")
    if spec.status != "active":
        raise HTTPException(status_code=409, detail="활성(active) 루틴만 캐치업할 수 있다")
    now = datetime.now(_KST)
    missed_at = _missed_since(spec, now=now)
    if missed_at is None:
        raise HTTPException(status_code=409, detail="놓친 예약이 없다")
    # 중복 클릭 방지 — 직전 예약 발생 시각 이후 fired가 이미 있으면 409.
    for row in runtime.ledger.read_all():
        if row.get("routine_id") != routine_id or row.get("verdict") != "fired":
            continue
        ts = row.get("ts")
        if isinstance(ts, str):
            try:
                if datetime.fromisoformat(ts) >= missed_at:
                    raise HTTPException(
                        status_code=409, detail="이미 발화 처리된 예약이다"
                    )
            except ValueError:
                continue
    row = record_scheduled_fire(
        spec,
        runtime.ledger,
        now.strftime("%H:%M"),
        reason="놓친 예약 캐치업(사용자 승인)",
    )
    return {"fired_at": row["ts"]}


@router.post("/{routine_id}/briefing-result")
async def record_briefing_result(
    request: Request, routine_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """브리핑 완료 후 main이 1회 호출하는 통합 보고 — engagement(메타데이터)와
    briefings(본문) 둘 다 기록한다. 엔드포인트 하나가 두 스토어에 쓰지만
    소유권은 여전히 분리다(각 스토어의 읽기는 각자 자기 파일만 본다, P4).
    status="failed"면 본문이 없으므로 briefings에는 기록하지 않는다
    (실패한 시도의 빈 본문을 저장하지 않는다)."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    fired_at = body.get("fired_at")
    if not isinstance(fired_at, str) or not fired_at:
        raise HTTPException(status_code=422, detail="fired_at은 필수 문자열이다")
    status = body.get("status")
    if not isinstance(status, str) or not status:
        raise HTTPException(status_code=422, detail="status는 필수 문자열이다")
    duration_ms = body.get("duration_ms")
    if duration_ms is not None and not isinstance(duration_ms, (int, float)):
        raise HTTPException(status_code=422, detail="duration_ms는 숫자여야 한다")
    destination = body.get("destination")
    if destination is not None and not isinstance(destination, str):
        raise HTTPException(status_code=422, detail="destination은 문자열이어야 한다")
    title = body.get("title")
    content = body.get("content")
    if status != "failed" and (not isinstance(title, str) or not isinstance(content, str)):
        # 검증은 전부 기록 앞에 — 422 응답에 부분 기록(engagement만)을 남기지 않는다.
        raise HTTPException(
            status_code=422, detail="성공 보고에는 title·content 문자열이 필수다"
        )

    engagement_row = runtime.engagement.record(
        "briefed",
        routine_id=routine_id,
        status=status,
        duration_ms=duration_ms,
        destination=destination,
    )
    briefing_row: dict[str, Any] | None = None
    if status != "failed":
        model = body.get("model")
        effort = body.get("effort")
        briefing_row = runtime.briefings.record(
            routine_id=routine_id,
            fired_at=fired_at,
            title=title,
            content=content,
            model=model if isinstance(model, str) else None,
            effort=effort if isinstance(effort, str) else None,
            destination=destination or "",
        )
    return {"engagement": engagement_row, "briefing": briefing_row}


@router.get("/{routine_id}/runs")
async def list_routine_runs(request: Request, routine_id: str) -> dict[str, Any]:
    """실행 이력 조회 — ledger는 그대로 두고 라우터 레벨에서 routine_id로 거른다.

    ledger·engagement·briefings 3개 스토어를 각각 정확히 1회씩 읽는다(단일
    패스, N+1 방지 MAJOR 준수). briefings는 fired_at(=ledger fired 행의 ts,
    서버 authoritative)으로 상관해 본문 필드를 병합한다."""
    runtime = _runtime(request)
    rows = [r for r in runtime.ledger.read_all() if r.get("routine_id") == routine_id]
    briefing_by_fired_at = {
        b["fired_at"]: b
        for b in runtime.briefings.read_all()
        if b.get("routine_id") == routine_id and isinstance(b.get("fired_at"), str)
    }
    for r in rows:
        briefing = briefing_by_fired_at.get(r.get("ts"))
        if briefing is not None:
            r["briefing_title"] = briefing.get("title")
            r["briefing_content"] = briefing.get("content")
            r["truncated"] = briefing.get("truncated", False)
            # 39번 상세 패널 "실행 위치"(6단계) — engagement의 briefed destination과
            # 같은 보고(briefing-result)에서 기록된 값이라 별도 스캔 없이 여기서 노출.
            r["briefing_destination"] = briefing.get("destination")
    # 최근 30건(옛 jsonl은 duration_ms 키 자체가 없을 수 있다 — 하위호환 방어).
    recent = rows[-30:]
    durations = [
        r["duration_ms"] for r in recent if isinstance(r.get("duration_ms"), (int, float))
    ]
    avg_duration_ms = sum(durations) / len(durations) if durations else None

    # 발화→열람/이어진 대화(F2-스트레치) — engagement.py 모듈 독스트링의 지표
    # 정의 참고. fired_recent는 avg_duration_ms와 같은 "최근 30건" 창을
    # 공유하되 fired 판정만 센다(near/suppressed는 능동 턴을 만들지 않는다).
    # opened/replied 이벤트는 fired 행과 1:1 상관 ID가 없다 — 이 엔드포인트는
    # engagement 로그 자신의 "최근 30건" 창을 독립적으로 써서 근사치를
    # 낸다(정직한 근사임을 명시, 엄밀한 행 단위 상관은 하지 않는다).
    fired_recent = [r for r in recent if r.get("verdict") == "fired"]
    engagement_recent = [
        e for e in runtime.engagement.read_all() if e.get("routine_id") == routine_id
    ][-30:]
    opened_count = sum(1 for e in engagement_recent if e.get("event") == "opened")
    replied_count = sum(1 for e in engagement_recent if e.get("event") == "replied")
    opened_rate = (opened_count / len(fired_recent)) if fired_recent else None

    return {
        "runs": rows,
        "avg_duration_ms": avg_duration_ms,
        "opened_rate": opened_rate,
        "replied_count": replied_count,
    }


@router.post("/{routine_id}/engagement")
async def record_engagement(
    request: Request, routine_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """발화 열람·응답 계측 기록 — event는 "opened"|"replied"만 허용한다.

    이 엔드포인트는 판정을 내리지 않는다(예: "N분 이내에 이어졌는가") —
    그 판정은 프론트(app/chat.js)가 이미 마치고 사실만 통보한다. 여기서는
    라우틴 존재 여부만 확인하고 engagement.py로 그대로 넘긴다."""
    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    event = body.get("event")
    if event not in ("opened", "replied"):
        raise HTTPException(
            status_code=422, detail="event는 'opened' 또는 'replied'만 허용된다"
        )
    row = runtime.engagement.record(event, routine_id=routine_id)
    return row


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
