"""지표 레지스트리 공개 표면. `athena_bt`(§7.1)와 `compile.py`(§6.2)가 여기로만 지표에 접근한다.

`core`를 임포트하는 부작용으로 핵심 25종이 레지스트리에 등록된다 — 등록은 모듈 로드 시
한 번만 일어난다(register()가 중복 등록을 막는다).
"""

from __future__ import annotations

from . import core  # noqa: F401  — 임포트 부작용으로 핵심 25종을 register()에 등록한다.
from .registry import (
    IndicatorSpec,
    ParamSpec,
    cross_above,
    cross_below,
    get,
    list_all,
    register,
)

__all__ = [
    "IndicatorSpec",
    "ParamSpec",
    "cross_above",
    "cross_below",
    "get",
    "list_all",
    "register",
]
