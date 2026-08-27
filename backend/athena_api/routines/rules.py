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
    MAX_COOLDOWN_S,
    MAX_EXPIRY,
    MIN_COOLDOWN_S,
    SOURCES,
    Condition,
    RoutineSpec,
)


class RoutineValidationError(ValueError):
    """도메인 에러 — HTTP 경계에서 4xx로 번역된다. upstream 원문을 담지 않는다."""


_ALLOWED_CONDITION_KEYS = {"source", "op", "value", "consecutive_ticks"}
_SYMBOL_RE = re.compile(r"^\d{6}$")
_MAX_KEYWORD_LEN = 64
# 제어문자·개행 금지 — 원장/카드에 그대로 실리는 문자열이다.
_KEYWORD_RE = re.compile(r"^[^\x00-\x1f\x7f]+$")
_MAX_CONSECUTIVE_TICKS = 20


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


def validate_draft(raw: Any, *, now: datetime | None = None) -> RoutineSpec:
    """draft 생성 입력 전체를 검증해 RoutineSpec(status=draft)을 만든다."""
    if not isinstance(raw, dict):
        _fail("draft 본문은 객체여야 한다")

    condition = validate_condition(raw.get("condition"))

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

    spec = RoutineSpec(
        condition=condition,
        symbol=symbol,
        cooldown_s=cooldown,
        expires_at=now + timedelta(days=expires_days),
        note=note,
        goal=goal,
    )
    if not note:
        spec.note = spec.human_summary()
    return spec
