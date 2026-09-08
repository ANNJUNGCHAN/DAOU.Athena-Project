from __future__ import annotations

import asyncio
import hashlib
import os
import re
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from athena_api.routines.models import SOURCES, parse_schedule_value, source_spec
from athena_api.routines.revisions import (
    WatchRevision,
    fix_cycle,
    history_view,
    mark_fixed_nodes,
    push,
)
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import RoutinesRuntime, resolve_watch_file
from athena_api.routines.scheduler import record_scheduled_fire

router = APIRouter(prefix="/api/v1/routines", tags=["routines"])

_KST = timezone(timedelta(hours=9))
_SYMBOL_RE = re.compile(r"^\d{6}$")


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
    view: dict[str, Any] = {
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
        # 놓친 예약은 활성 루틴에서만 의미가 있다 — 캐치업(catchup-fire)도
        # active만 허용하므로 뷰와 실행 가능성이 일치한다.
        "missed": spec.status == "active"
        and _is_missed(_missed_since(spec), last_fired_at),
    }
    if spec.watch is not None:
        # 코드 감시 알람만 갖는 블록 — 다른 모드의 행 모양은 그대로다.
        view["watch"] = spec.watch.to_dict()
    return view


# 편집(POST /{id}/update)이 만질 수 있는 필드 — symbol·condition.source는
# 여기 없다(바꾸면 다른 루틴이다). 조건은 op·value·consecutive_ticks만.
# briefing_model/briefing_effort는 없다 — 예약 브리핑은 앱 모델 설정으로 돈다
# (app/lib/main/briefing-runner.js selectModel). 루틴에는 모델 설정이 존재하지 않는다.
_UPDATABLE_FIELDS = ("note", "cooldown_s", "expires_days")
_UPDATABLE_CONDITION_FIELDS = ("op", "value", "consecutive_ticks")


def _detail_view(spec: Any, runtime: RoutinesRuntime) -> dict[str, Any]:
    """단일 루틴 상세 뷰 — 편집 폼이 필요한 조건 원문·소스 명세를 낸다.

    _view()와 달리 발화·읽음·놓침 같은 운영 지표는 담지 않는다(목록의 몫).
    ledger를 읽지 않으므로 편집 왕복이 원장 스캔을 유발하지 않는다."""
    source = source_spec(spec.condition.source)
    detail: dict[str, Any] = {
        "id": spec.id,
        "symbol": spec.symbol,
        "status": spec.status,
        "mode": spec.mode,
        "source_label": source.label,
        "cooldown_s": spec.cooldown_s,
        "expires_at": spec.expires_at.isoformat(),
        "note": spec.note,
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
    if spec.mode == "code-watch" and spec.watch is not None:
        # 코드 감시 알람에만 붙는 세 칸 — 감시 파일 정보와, 프로세스 로컬로 남아
        # 있는 마지막 검사·마지막 실행 요약이다(영속 안 함).
        detail["watch"] = spec.watch.to_dict()
        check = _watch_last(runtime, spec, "check")
        # 고침 한 바퀴 — 직전 판과 지금 검사를 맞대야 「방금 바뀜」과 「4번 → 2번」이
        # 나온다. 고친 적이 없으면 cycle은 None이고 노드도 손대지 않는다(첫 검사).
        cycle = fix_cycle(spec.revisions, check, status=spec.status)
        if cycle is not None and check is not None:
            check = dict(check)
            previous = WatchRevision.from_dict(spec.revisions[-1])
            check["nodes"] = mark_fixed_nodes(previous.nodes, check.get("nodes"))
        detail["last_check"] = check
        detail["last_run"] = _watch_last(runtime, spec, "run")
        detail["fix_cycle"] = cycle
        detail["fix_history"] = history_view(spec.revisions)
    return detail


def _watch_last(runtime: RoutinesRuntime, spec: Any, kind: str) -> dict[str, Any] | None:
    """마지막 검사·실행 요약 조회 — 검사는 알람 id로도, 파일 경로로도 남는다."""
    last = runtime.watch_last
    entry = last.get(f"{kind}:{spec.id}")
    if entry is None and kind == "check" and spec.watch is not None:
        entry = last.get(f"check:{spec.watch.project_id}:{spec.watch.path}")
    return dict(entry) if entry is not None else None


@router.post("/draft")
async def create_draft(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    runtime = _runtime(request)
    spec = validate_draft(body)  # RoutineValidationError → 422 (errors.py)
    if spec.mode == "code-watch":
        blocker = runtime.code_watch_source_blocker(spec)
        if blocker is not None:
            raise HTTPException(status_code=409, detail=blocker)
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


def _watch_source_before(project_id: str, path: Any) -> tuple[str, str] | None:
    """덮어쓰기 직전의 (경로, 원문). 경로가 이상하거나 파일이 없으면 None.

    경로 검증은 save_watch_code가 하고 여기서 두 번 하지 않는다 — 잘못된 경로면
    바로 아래 착지가 422로 끝나므로 이 판은 쓰이지 않는다.
    """
    rel = str(path or "").strip().replace("\\", "/")
    if not rel:
        return None
    try:
        target = resolve_watch_file(project_id, rel)
        return rel, target.read_text(encoding="utf-8")
    except Exception:
        return None


def _record_fix(
    runtime: RoutinesRuntime,
    project_id: str,
    before: tuple[str, str] | None,
    result: dict[str, Any],
) -> None:
    """고침 한 바퀴의 시작을 이력에 남긴다 — 이 파일을 가리키는 알람마다 한 판.

    바이트가 그대로면 고침이 아니다(같은 코드를 다시 착지시킨 것). 접어 두는 검사
    결과는 그 알람의 마지막 검사 그대로다 — 여기서 새로 세지 않는다.
    """
    if before is None or before[0] != result.get("path"):
        return
    if hashlib.sha256(before[1].encode("utf-8")).hexdigest() == result.get("code_hash"):
        return
    fixed_at = datetime.now(UTC).isoformat()
    for spec in runtime.store.list_all():
        watch = getattr(spec, "watch", None)
        if watch is None or watch.project_id != project_id or watch.path != before[0]:
            continue
        spec.revisions = push(
            spec.revisions,
            WatchRevision(
                version_hash=watch.version_hash,
                fixed_at=fixed_at,
                source=before[1],
                check=_watch_last(runtime, spec, "check") or {},
            ),
        )
        runtime.store.upsert(spec)


@router.post("/watch/code")
async def save_watch_code_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """감시 코드 착지 — 모델이 쓴 감시 함수를 프로젝트 폴더 안 `watch/<이름>.py`에 쓴다.

    선언 위치가 계약이다 — `/{routine_id}`보다 **앞**에 있어야 'watch'가 루틴 id로
    잡히지 않는다(`/source-catalog`과 같은 이유).

    백테스트 표·등록부에는 아무 행도 만들지 않는다(R5·R9). 켜져 있는 알람이
    가리키는 파일만 409로 막는다(R10) — 일시중지 알람의 파일은 고쳐 쓸 수 있고,
    그때는 해시가 어긋나 다시 검사를 받아야 재개된다. 이 문구는 화면이 그대로
    보여주지 않는다.
    """
    from athena_api.projects.store import ProjectMissingError
    from athena_api.watch.store_code import CodeLocked, save_watch_code

    runtime = _runtime(request)
    project_id = body.get("project_id")
    if not isinstance(project_id, str) or not project_id.strip():
        raise HTTPException(status_code=422, detail="프로젝트를 고르지 않음")
    labels = body.get("labels")
    if labels is not None and not isinstance(labels, dict):
        raise HTTPException(status_code=422, detail="노드 제목 묶음은 이름-제목 짝이어야 한다")
    pid = project_id.strip()
    before = _watch_source_before(pid, body.get("path"))
    try:
        result = save_watch_code(
            pid,
            body.get("path"),
            body.get("source"),
            labels,
            routine_store=runtime.store,
        )
        _record_fix(runtime, pid, before, result)
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="프로젝트 없음") from None
    except ProjectMissingError:
        raise HTTPException(status_code=404, detail="프로젝트 폴더 없음 — 다시 연결") from None
    except CodeLocked:
        raise HTTPException(
            status_code=409,
            detail="켜져 있는 알람의 코드는 못 바꿈 — 먼저 일시중지하거나 새로 만들기",
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/watch/check")
async def check_watch_code(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """검사 = 미니 백테스트 1회 — 지난 N일 완성 일봉(어제까지)에 감시 함수를 돌린다.

    선언 위치가 계약이다 — `/{routine_id}`보다 **앞**이어야 'watch'가 루틴 id로
    잡히지 않는다(`/watch/code`와 같은 이유).

    코드가 안 돌아도 500을 내지 않는다(B-12) — 200 + `ok:false` + 한국어 진단이다.
    백테스트의 전략·실행·배포 표에는 아무 행도 만들지 않는다(R5). 늘어날 수 있는 것은
    공유 일봉 캐시(`bt_candle` 행 추가·`bt_coverage` 구간 확장)뿐이다.
    """
    from athena_api.projects.store import ProjectMissingError, ProjectPathError
    from athena_api.watch.check import run_check
    from athena_api.watch.data import assemble_frame, frame_from_candles

    runtime = _runtime(request)
    raw_project_id = body.get("project_id")
    if not isinstance(raw_project_id, str) or not raw_project_id.strip():
        raise HTTPException(status_code=422, detail="프로젝트를 고르지 않음")
    project_id = raw_project_id.strip()
    raw_path = body.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=422, detail="감시 코드 경로가 비어 있음")
    path = raw_path.strip()
    symbol = body.get("symbol")
    if not isinstance(symbol, str) or not _SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=422, detail="종목코드는 6자리")
    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise HTTPException(status_code=422, detail="숫자 설정은 이름-값 짝이어야 한다")
    lookback_days = body.get("lookback_days", 30)
    if isinstance(lookback_days, bool) or not isinstance(lookback_days, int):
        raise HTTPException(status_code=422, detail="며칠을 볼지는 정수")
    cooldown_s = body.get("cooldown_s", 86400)
    if isinstance(cooldown_s, bool) or not isinstance(cooldown_s, int):
        raise HTTPException(status_code=422, detail="쿨다운은 정수 초")
    routine_id = body.get("routine_id")
    if routine_id is not None and not isinstance(routine_id, str):
        raise HTTPException(status_code=422, detail="알람 번호는 문자열")

    try:
        target = resolve_watch_file(project_id, path)
    except KeyError:
        raise HTTPException(status_code=404, detail="프로젝트 없음") from None
    except ProjectMissingError:
        raise HTTPException(status_code=404, detail="프로젝트 폴더 없음 — 다시 연결") from None
    except ProjectPathError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if not target.is_file():
        raise HTTPException(status_code=404, detail="감시 코드 파일 없음 — 먼저 만들기")
    source = target.read_text(encoding="utf-8")

    if runtime.watch_runner is None:
        raise HTTPException(status_code=409, detail="백엔드 실행층 꺼짐 — 백테스트 모듈 필요")

    now = datetime.now(_KST)
    today = now.date()
    warnings: list[str] = []
    store = runtime.watch_candle_store or getattr(request.app.state, "backtest_store", None)
    if store is None:
        warnings.append("일봉 캐시 없음 — 받아 둔 일봉이 없으면 셀 수 없음")
    else:
        warnings.extend(
            await _ensure_watch_candles(
                store, runtime.watch_fetch_page, symbol, lookback_days, today
            )
        )

    frame_df = None
    if store is not None:
        frame = await assemble_frame(
            store, symbol, lookback_days, today_quote=None, quote_provider=None, now=now
        )
        frame_df = frame.df
        if frame.skip_reason:
            warnings.append(frame.skip_reason)
    if frame_df is None:
        frame_df = frame_from_candles([])  # 빈 프레임도 날짜 인덱스를 갖춰야 한다

    result = await asyncio.to_thread(
        run_check,
        source,
        None,
        frame_df,
        cooldown_s=cooldown_s,
        params=params,
        lookback_days=lookback_days,
        today=today,
        runner=runtime.watch_runner,
    )
    payload = result.to_dict()
    payload["warnings"] = warnings + list(payload["warnings"])
    payload["symbol"] = symbol
    payload["checked_at"] = datetime.now(UTC).isoformat()

    key = routine_id or f"{project_id}:{path}"
    runtime.watch_last[f"check:{key}"] = {
        "checked_at": payload["checked_at"],
        "nodes": payload["nodes"],
        "observed": result.last_verdict,
        "duration_ms": result.duration_ms,
        "ok": result.ok,
        "skip_reason": result.reason,
        "count": result.count,
        # 검사가 실제로 센 마지막 날(KST) — 고침 전후 점 띠의 마지막 칸이다.
        # `checked_at`은 UTC라 KST 새벽에는 날짜가 하루 뒤처진다.
        "counted_through": (today - timedelta(days=1)).isoformat(),
        "counted_until": result.counted_until,
        # 고침 전후 비교가 읽는 두 칸 — 울린 날 목록과 센 구간이다.
        "fires": list(payload["fires"]),
        "lookback_days": result.lookback_days,
        # 지금 설정이 아니라 이 검사에서 실제로 적용한 값이다(simulate_fires의 하한).
        "cooldown_s": max(0, cooldown_s),
        "diagnosis": payload["diagnosis"],
    }
    if routine_id and result.ok:
        # 검사에 통과한 그 코드로 확정을 열어 준다 — can_activate가 해시를 대조한다.
        # 켜져 있는 알람의 해시는 여기서 갈아 끼우지 않는다 — 그러면 돌고 있는 알람의
        # 코드가 사람 확정 없이 바뀐다. 초안·일시중지만 다시 심는다.
        spec = runtime.store.get(routine_id)
        if spec is not None and spec.watch is not None:
            if spec.status in ("draft", "paused"):
                # WatchSpec은 frozen이라 갈아 끼운다(검증을 거친 값의 불변성 유지).
                spec.watch = replace(spec.watch, version_hash=result.code_hash)
                runtime.store.upsert(spec)
            else:
                payload["warnings"].append(
                    "켜져 있는 알람 — 검사 결과를 알람에 심지 않았음 · 고치려면 먼저 일시중지"
                )
    runtime.watch_last[f"check:{key}"]["warnings"] = list(payload["warnings"])
    return payload


async def _ensure_watch_candles(
    store: Any,
    fetch_page: Any,
    symbol: str,
    lookback_days: int,
    today: date,
) -> list[str]:
    """검사가 셀 만큼의 일봉이 캐시에 있게 한다 — 없으면 공유 캐시를 채운다(R5 허용).

    지표가 lookback보다 긴 창을 쓸 수 있어 워밍업으로 3배 구간을 요구한다
    (`watch/data.assemble_frame`이 읽는 구간과 같다). 백필 실패는 검사를 깨뜨리지
    않는다 — 사유를 경고로 남기고 있는 일봉까지만 센다.
    """
    from athena_api.backtest.data import backfill

    need_from = (today - timedelta(days=lookback_days * 3)).strftime("%Y%m%d")
    to_dt = today.strftime("%Y%m%d")
    coverage = await store.coverage(symbol, "day", True)
    if coverage is not None and coverage.first_dt <= need_from and coverage.last_dt >= to_dt:
        return []
    if fetch_page is None:
        return ["일봉을 더 받을 통로 없음 — 받아 둔 일봉까지만 셈"]
    try:
        await backfill(
            store=store,
            fetch_page=fetch_page,
            stk_cd=symbol,
            period="day",
            adjusted=True,
            base_dt=to_dt,
            from_dt=need_from,
        )
    except Exception:
        return ["일봉을 더 받지 못함 — 받아 둔 일봉까지만 셈"]
    return []


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
    if spec.mode == "code-watch" and body_condition:
        # 코드 감시의 조건은 감시 함수 발화 하나뿐이다 — 고치기는 코드를 다시 쓰는 길로만.
        raise HTTPException(
            status_code=422, detail="코드 감시 조건은 폼에서 못 바꿈 — 고치기는 말로"
        )
    if "poll_interval_s" in body and spec.watch is None:
        raise HTTPException(
            status_code=422, detail="확인 주기는 코드 감시 알람에서만 바꿀 수 있음"
        )
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
    if "poll_interval_s" in body:
        # 값 범위(60~600초)는 rules.validate_watch가 아래 재검증에서 본다 —
        # 여기서 같은 규칙을 두 번 적지 않는다.
        watch_block = dict(merged.get("watch") or {})
        watch_block["poll_interval_s"] = body["poll_interval_s"]
        merged["watch"] = watch_block
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
    updated.revisions = spec.revisions  # 편집이 고침 이력을 지우지 않는다
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


@router.post("/{routine_id}/watch/rollback")
async def rollback_watch_fix(request: Request, routine_id: str) -> dict[str, Any]:
    """되돌리기 — 마지막 고침을 무르고 그 앞 코드로 파일과 해시를 되돌린다.

    되돌리는 것은 파일이 먼저다: 해시만 되돌리면 디스크의 코드와 알람이 어긋나
    `can_activate`가 「검사 뒤 코드가 바뀜」으로 막는다. 접어 둔 검사 결과도 같이
    되돌아간다 — 그 결과는 이 바이트가 실제로 낸 것이다. 해시는 되쓰는 원문에서
    다시 센다 — 판에 접힌 해시는 검사 없이 두 번 착지하면 그 원문의 것이 아니다.

    켜져 있는 알람은 못 되돌린다(R10과 같은 규칙) — 돌고 있는 코드가 사람 확정
    없이 바뀌면 안 된다.
    """
    from athena_api.projects.store import ProjectMissingError, ProjectPathError

    runtime = _runtime(request)
    spec = runtime.store.get(routine_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="루틴이 존재하지 않는다")
    if spec.watch is None:
        raise HTTPException(status_code=409, detail="코드 감시 알람이 아님")
    if not spec.revisions:
        raise HTTPException(status_code=409, detail="되돌릴 고침이 없음")
    if spec.status not in ("draft", "paused"):
        raise HTTPException(
            status_code=409, detail="켜져 있는 알람은 못 되돌림 — 먼저 일시중지"
        )

    entry = WatchRevision.from_dict(spec.revisions[-1])
    try:
        target = resolve_watch_file(spec.watch.project_id, spec.watch.path)
    except KeyError:
        raise HTTPException(status_code=404, detail="프로젝트 없음") from None
    except ProjectMissingError:
        raise HTTPException(status_code=404, detail="프로젝트 폴더 없음 — 다시 연결") from None
    except ProjectPathError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    # 접어 둘 때 read_text가 이미 개행을 LF로 읽었다 — 여기서 다시 고르지 않는다.
    data = entry.source.encode("utf-8")
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, target)

    spec.watch = replace(spec.watch, version_hash=hashlib.sha256(data).hexdigest())
    spec.revisions = spec.revisions[:-1]
    if entry.check:
        runtime.watch_last[f"check:{spec.id}"] = dict(entry.check)
    else:
        runtime.watch_last.pop(f"check:{spec.id}", None)
    runtime.store.upsert(spec)
    return _detail_view(spec, runtime)


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
