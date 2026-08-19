"""능동 에이전트 루틴 — 감시 단위의 모델·검증·원장.

설계 근거: plan/능동-에이전트-실행계획-2026-08-19.md (ralplan 합의 v4+§8).
- 조건은 문자열 DSL이 아니라 **구조화 dict**다. 표현식 파서를 두지 않는 것이
  프리모템 6(규칙 DSL 인젝션)의 가장 강한 완화다 — eval류 표면이 애초에 없다.
- mode(realtime-ws | periodic)는 조건의 소스 필드에서 결정론적으로 유도된다
  (§8 — 사용자·모델이 고르지 않는다).
- 모델(LLM)은 draft 제안·목록 조회만 가능하다. 승인·취소는 사람이 한다.
"""

from athena_api.routines.models import (
    SOURCES,
    Condition,
    RoutineSpec,
    RoutineStatus,
    derive_mode,
)
from athena_api.routines.rules import (
    RoutineValidationError,
    validate_condition,
    validate_draft,
)

__all__ = [
    "Condition",
    "RoutineSpec",
    "RoutineStatus",
    "SOURCES",
    "derive_mode",
    "RoutineValidationError",
    "validate_condition",
    "validate_draft",
]
