"""보드 하이드레이션 기본 인자 — 화면이 안 보낸 필수 조회 조건을 채운다.

Paper 보드 하나는 조회 조건 하나를 가진 화면이다(시장 전체 · 통합 거래소 · 최근
구간). 그 조건이 요청에 없으면 op는 호출되지 않고 보드 전체가 결측어로 덮인다.
표는 :mod:`backend/scripts/build_hydrate_argument_defaults.py`가 각 op 요청 모델의
설명문에서 뽑아 ``ref/hydrate-argument-defaults.json``에 굳혀 둔 것이다.

두 원칙:
  * **클라이언트가 보낸 값이 언제나 이긴다** — 기본값은 빈 자리만 채운다.
  * **조회 대상은 지어내지 않는다** — 종목코드·주문번호처럼 화면이 지목하는
    식별자는 표에 없다(생성기의 ``NEVER_DEFAULT``).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from functools import cache
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

KST = timezone(timedelta(hours=9))

BACKEND = Path(__file__).resolve().parents[1]
REF = BACKEND / "ref" / "hydrate-argument-defaults.json"

_TODAY = "$today"
_TODAY_MINUS = "$today-"


@cache
def _table() -> Mapping[str, Mapping[str, str]]:
    try:
        payload = json.loads(REF.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return MappingProxyType({})
    operations = payload.get("operations")
    if not isinstance(operations, dict):
        return MappingProxyType({})
    table: dict[str, Mapping[str, str]] = {}
    for operation_ref, entries in operations.items():
        if not isinstance(entries, dict):
            continue
        values = {
            alias: str(entry["value"])
            for alias, entry in entries.items()
            if isinstance(entry, dict) and "value" in entry
        }
        if values:
            table[operation_ref] = MappingProxyType(values)
    return MappingProxyType(table)


def _resolve_token(value: str) -> str:
    """``$today`` · ``$today-30d``를 KST 오늘 기준 YYYYMMDD로 바꾼다."""

    if value == _TODAY:
        return datetime.now(KST).strftime("%Y%m%d")
    if value.startswith(_TODAY_MINUS) and value.endswith("d"):
        try:
            days = int(value[len(_TODAY_MINUS) : -1])
        except ValueError:
            return value
        return (datetime.now(KST) - timedelta(days=days)).strftime("%Y%m%d")
    return value


def defaults_for(operation_ref: str) -> dict[str, Any]:
    """이 op의 기본 조회 인자(토큰 해석 후). 표에 없으면 빈 표."""

    return {
        alias: _resolve_token(value)
        for alias, value in _table().get(operation_ref, {}).items()
    }


def fill_missing_arguments(
    operation_ref: str,
    target: Mapping[str, Any],
    aliases: Mapping[str, bool],
) -> dict[str, Any]:
    """``target``에서 이 op의 alias만 골라내고, **필수인데 빈 자리**를 기본값으로 채운다.

    ``aliases``는 ``{alias: 필수인가}``다. 선택 인자는 채우지 않는다 — 안 보내는 것이
    그 op의 기본 동작이고, 임의로 채우면 화면이 요청하지 않은 조회가 된다.
    """

    arguments = {
        alias: value
        for alias, value in target.items()
        if alias in aliases and value is not None and str(value).strip() != ""
    }
    for alias, value in defaults_for(operation_ref).items():
        if aliases.get(alias) and alias not in arguments:
            arguments[alias] = value
    return arguments
