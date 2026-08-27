"""말걸기 가드 설정 REST — routines.py와 완전히 분리된 별도 라우터(git-lock 정합).

전역 설정 하나뿐이라 라우틴별 엔드포인트와 모양이 다르다 — GET(조회)·
POST(전체 교체)뿐이고 draft/confirm 개념이 없다. 저장이 곧 확정이다
(guard_settings.py 모듈 독스트링 참고 — 낮은 스테이크 설정값이라는 판단).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from athena_api.routines.guard_settings import validate_guard_settings

router = APIRouter(prefix="/api/v1/nudge-guard", tags=["nudge-guard"])


@router.get("")
async def get_nudge_guard(request: Request) -> dict[str, Any]:
    return request.app.state.nudge_guard_store.get().to_dict()


@router.post("")
async def replace_nudge_guard(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    settings = validate_guard_settings(body)  # GuardSettingsError → 422 (errors.py)
    request.app.state.nudge_guard_store.replace(settings)
    return settings.to_dict()
