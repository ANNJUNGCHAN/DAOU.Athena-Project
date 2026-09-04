"""루틴 검증 — 스키마 화이트리스트가 유일한 입구다.

프리모템 6(규칙 DSL 인젝션)의 완화 그 자체: 표현식 문자열을 받지 않고,
구조화 dict의 각 필드를 카탈로그·연산자·리터럴 타입으로 강제한다.
이 모듈 밖에서 Condition을 직접 만들지 마라 — eval/exec/컴파일 계열은
이 패키지 어디에도 없다(테스트가 소스 grep으로 고정한다).
"""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from athena_api.routines.models import (
    LEGACY_DISABLED_SOURCES,
    MAX_COOLDOWN_S,
    MAX_EXPIRY,
    MIN_COOLDOWN_S,
    SOURCES,
    WATCH_MAX_LOOKBACK_DAYS,
    WATCH_MAX_POLL_S,
    WATCH_MIN_LOOKBACK_DAYS,
    WATCH_MIN_POLL_S,
    Condition,
    RoutineSpec,
    WatchSpec,
    parse_schedule_value,
)


class RoutineValidationError(ValueError):
    """도메인 에러 — HTTP 경계에서 4xx로 번역된다. upstream 원문을 담지 않는다."""


_ALLOWED_CONDITION_KEYS = {"source", "op", "value", "consecutive_ticks"}
_SYMBOL_RE = re.compile(r"^\d{6}$")
_MAX_KEYWORD_LEN = 64
# 제어문자·개행 금지 — 원장/카드에 그대로 실리는 문자열이다.
_KEYWORD_RE = re.compile(r"^[^\x00-\x1f\x7f]+$")
_MAX_CONSECUTIVE_TICKS = 20
# 브리핑 모델·노력 검증(R1) — 이 목록은 `app/lib/main/model-prefs.js:12,17`과
# 수동 동기화 대상이다. JS/Python 교차 언어라 코드 공유가 불가능하므로 한쪽이
# 바뀌면 다른 쪽도 수동 갱신해야 한다. 하이픈은 문자셋에 포함되므로 "선두
# 하이픈 금지"는 별도 검사한다(model-prefs.js:21과 동형).
_MODEL_CHARSET_RE = re.compile(r"^[A-Za-z0-9.\[\]-]{1,64}$")
_BRIEFING_EFFORTS = frozenset({"low", "medium", "high", "xhigh", "max"})

# 코드 감시(code.watch) — 감시 코드는 조건이 아니라 프로젝트 폴더의 파일이다.
# 그래서 검증할 것은 "어느 파일인가"뿐이고, 여기서 폴더 밖·확장자·주기를 막는다.
WATCH_SOURCE = "code.watch"
_WATCH_DIR = "watch/"
_ALLOWED_WATCH_KEYS = {
    "project_id",
    "path",
    "version_hash",
    "params",
    "poll_interval_s",
    "lookback_days",
    "last_fired_at",
}
_DRIVE_PREFIX_RE = re.compile(r"^[A-Za-z]:")
_HEX_RE = re.compile(r"^[0-9a-f]{64}$")
_MAX_WATCH_PARAMS = 32


def _fail(msg: str) -> None:
    raise RoutineValidationError(msg)


def validate_condition(raw: Any) -> Condition:
    """구조화 조건을 화이트리스트로 강제한다. 통과 못 하면 저장 자체가 없다."""
    if not isinstance(raw, dict):
        _fail("condition은 객체여야 한다")
    extra = set(raw.keys()) - _ALLOWED_CONDITION_KEYS
    if extra:
        _fail(f"허용되지 않는 조건 키: {sorted(extra)}")

    source = raw.get("source")
    if isinstance(source, str) and source in LEGACY_DISABLED_SOURCES:
        _fail("이 source는 앱 플러그인 전용이므로 백엔드 루틴 초안에 사용할 수 없다")
    if not isinstance(source, str) or source not in SOURCES:
        _fail("source가 소스 카탈로그에 없다")
    spec = SOURCES[source]

    op = raw.get("op")
    if not isinstance(op, str) or op not in spec.ops:
        _fail(f"source '{source}'에 허용되지 않는 연산자다")

    value = raw.get("value")
    if isinstance(value, bool):
        if spec.value_type != "bool":
            _fail("불리언 값은 이 source에 쓸 수 없다")
    elif isinstance(value, (int, float)):
        if spec.value_type != "number":
            _fail("숫자 값은 이 source에 쓸 수 없다")
        if not math.isfinite(float(value)):
            _fail("숫자 값은 유한해야 한다")
        value = float(value)
    elif isinstance(value, str):
        if spec.value_type != "string":
            _fail("문자열 값은 이 source에 쓸 수 없다")
        if not value or len(value) > _MAX_KEYWORD_LEN:
            _fail(f"키워드는 1~{_MAX_KEYWORD_LEN}자여야 한다")
        if not _KEYWORD_RE.match(value):
            _fail("키워드에 제어문자를 쓸 수 없다")
        if source == "schedule.daily" and parse_schedule_value(value) is None:
            _fail(
                "예약 시각은 '<요일>@<HH:MM>' 형식이어야 한다"
                "(요일: ALL 또는 1~7 콤마열, 1=월..7=일)"
            )
    else:
        # dict·list·None 등 — 중첩 조건·표현식 흉내는 전부 여기서 죽는다.
        _fail("value는 숫자·불리언·문자열 리터럴만 허용된다")

    ticks_raw = raw.get("consecutive_ticks", 1)
    if isinstance(ticks_raw, bool) or not isinstance(ticks_raw, int):
        _fail("consecutive_ticks는 정수여야 한다")
    if not 1 <= ticks_raw <= _MAX_CONSECUTIVE_TICKS:
        _fail(f"consecutive_ticks는 1~{_MAX_CONSECUTIVE_TICKS} 범위다")
    if ticks_raw > 1 and spec.transport != "ws":
        _fail("연속 틱 조건은 실시간(WS) source에서만 유효하다")

    return Condition(
        source=source, op=op, value=value, consecutive_ticks=ticks_raw
    )


def _validate_watch_path(text: Any) -> str:
    """감시 코드 경로 — 프로젝트 폴더 안 `watch/` 아래의 .py 하나만 허용한다."""
    if not isinstance(text, str) or not text.strip():
        _fail("감시 코드 경로가 비어 있다")
    path = text.strip().replace("\\", "/")
    if not path.endswith(".py"):
        _fail("감시 코드 경로는 .py 파일이어야 한다")
    if path.startswith("/") or _DRIVE_PREFIX_RE.match(path):
        _fail("감시 코드 경로는 프로젝트 폴더 안 상대 경로여야 한다")
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        _fail("감시 코드 경로에 상위 폴더(..) 참조를 쓸 수 없다")
    if not path.startswith(_WATCH_DIR) or len(parts) < 2:
        _fail("감시 코드는 프로젝트의 watch 폴더 안에 있어야 한다")
    return path


def validate_watch(raw: Any) -> WatchSpec:
    """code.watch 알람의 watch 블록 검증 — WatchSpec을 만드는 유일한 입구다."""
    if not isinstance(raw, dict):
        _fail("watch는 객체여야 한다")
    extra = set(raw.keys()) - _ALLOWED_WATCH_KEYS
    if extra:
        _fail(f"허용되지 않는 watch 키: {sorted(extra)}")

    project_id = raw.get("project_id")
    if not isinstance(project_id, str) or not project_id.strip():
        _fail("watch.project_id가 비어 있다")

    path = _validate_watch_path(raw.get("path"))

    version_hash = raw.get("version_hash")
    if not isinstance(version_hash, str) or not _HEX_RE.match(version_hash):
        _fail("watch.version_hash는 64자리 sha256 16진 문자열이어야 한다")

    params = raw.get("params", {})
    if not isinstance(params, dict):
        _fail("watch.params는 객체여야 한다")
    if len(params) > _MAX_WATCH_PARAMS:
        _fail(f"watch.params는 {_MAX_WATCH_PARAMS}개 이하여야 한다")
    for key, value in params.items():
        if not isinstance(key, str) or not _KEYWORD_RE.match(key or " "):
            _fail("watch.params의 이름은 제어문자 없는 문자열이어야 한다")
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            if not math.isfinite(float(value)):
                _fail("watch.params의 숫자는 유한해야 한다")
            continue
        if isinstance(value, str):
            if len(value) > _MAX_KEYWORD_LEN or not _KEYWORD_RE.match(value or " "):
                _fail(f"watch.params의 문자열은 {_MAX_KEYWORD_LEN}자 이하여야 한다")
            continue
        _fail("watch.params 값은 숫자·불리언·문자열 리터럴만 허용된다")

    poll = raw.get("poll_interval_s", WATCH_MIN_POLL_S)
    if isinstance(poll, bool) or not isinstance(poll, int):
        _fail("watch.poll_interval_s는 정수여야 한다")
    if not WATCH_MIN_POLL_S <= poll <= WATCH_MAX_POLL_S:
        _fail(f"watch.poll_interval_s는 {WATCH_MIN_POLL_S}~{WATCH_MAX_POLL_S} 범위다")

    lookback = raw.get("lookback_days", 30)
    if isinstance(lookback, bool) or not isinstance(lookback, int):
        _fail("watch.lookback_days는 정수여야 한다")
    if not WATCH_MIN_LOOKBACK_DAYS <= lookback <= WATCH_MAX_LOOKBACK_DAYS:
        _fail(
            f"watch.lookback_days는 {WATCH_MIN_LOOKBACK_DAYS}~"
            f"{WATCH_MAX_LOOKBACK_DAYS} 범위다"
        )

    last_fired_at = raw.get("last_fired_at")
    if last_fired_at is not None:
        if not isinstance(last_fired_at, str):
            _fail("watch.last_fired_at은 ISO8601 문자열이어야 한다")
        try:
            datetime.fromisoformat(last_fired_at)
        except ValueError:
            _fail("watch.last_fired_at은 ISO8601 문자열이어야 한다")

    return WatchSpec(
        project_id=project_id,
        path=path,
        version_hash=version_hash,
        params=dict(params),
        poll_interval_s=poll,
        lookback_days=lookback,
        last_fired_at=last_fired_at,
    )


def validate_draft(raw: Any, *, now: datetime | None = None) -> RoutineSpec:
    """draft 생성 입력 전체를 검증해 RoutineSpec(status=draft)을 만든다."""
    if not isinstance(raw, dict):
        _fail("draft 본문은 객체여야 한다")

    condition = validate_condition(raw.get("condition"))

    watch_raw = raw.get("watch")
    if condition.source == WATCH_SOURCE:
        if watch_raw is None:
            _fail("코드 감시 알람에는 watch 블록이 필요하다")
        if not (condition.op == "==" and condition.value is True):
            _fail("코드 감시 조건은 감시 함수 발화(== true) 하나뿐이다")
        watch = validate_watch(watch_raw)
    else:
        if watch_raw is not None:
            _fail("watch 블록은 코드 감시 알람에서만 쓸 수 있다")
        watch = None

    symbol = raw.get("symbol")
    if not isinstance(symbol, str) or not _SYMBOL_RE.match(symbol):
        _fail("symbol은 6자리 종목코드여야 한다")

    cooldown = raw.get("cooldown_s", 1800)
    if isinstance(cooldown, bool) or not isinstance(cooldown, int):
        _fail("cooldown_s는 정수여야 한다")
    if not MIN_COOLDOWN_S <= cooldown <= MAX_COOLDOWN_S:
        _fail(f"cooldown_s는 {MIN_COOLDOWN_S}~{MAX_COOLDOWN_S} 범위다")

    now = now or datetime.now(UTC)
    expires_days = raw.get("expires_days", 7)
    if isinstance(expires_days, bool) or not isinstance(expires_days, int):
        _fail("expires_days는 정수여야 한다")
    if not 1 <= expires_days <= MAX_EXPIRY.days:
        _fail(f"expires_days는 1~{MAX_EXPIRY.days} 범위다")

    note = raw.get("note", "")
    if not isinstance(note, str) or len(note) > 200:
        _fail("note는 200자 이하 문자열이어야 한다")
    if note and not _KEYWORD_RE.match(note):
        _fail("note에 제어문자를 쓸 수 없다")

    goal = raw.get("goal", False)
    if not isinstance(goal, bool):
        _fail("goal은 불리언이어야 한다")
    briefing_model = raw.get("briefing_model")
    if briefing_model is not None:
        if (
            not isinstance(briefing_model, str)
            or briefing_model.startswith("-")
            or not _MODEL_CHARSET_RE.match(briefing_model)
        ):
            _fail(
                "briefing_model은 영문·숫자·점·대괄호·하이픈 1~64자여야 한다"
                "(선두 하이픈 금지)"
            )

    briefing_effort = raw.get("briefing_effort")
    if briefing_effort is not None:
        if not isinstance(briefing_effort, str) or briefing_effort not in _BRIEFING_EFFORTS:
            _fail("briefing_effort는 low/medium/high/xhigh/max 중 하나여야 한다")

    spec = RoutineSpec(
        condition=condition,
        symbol=symbol,
        cooldown_s=cooldown,
        expires_at=now + timedelta(days=expires_days),
        note=note,
        goal=goal,
        briefing_model=briefing_model,
        briefing_effort=briefing_effort,
        watch=watch,
    )
    if not note:
        spec.note = spec.human_summary()
    return spec
