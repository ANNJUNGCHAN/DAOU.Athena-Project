"""`athena_nudge_guard` — 말걸기 가드 설정 제안·조회 빌트인 (HTTP 루프백 프록시).

routine_tools.py와 같은 이유로 `athena_api`를 import하지 않고 이미 떠 있는
백엔드에 루프백 호출만 한다. **재시도 없음**.

허용 액션은 `propose`(변경 제안)·`get`(조회) **둘뿐**이다. 저장(확정)
액션은 존재하지 않는다 — routine_tools.py의 confirm 부재 원칙과 같은
이유(모델이 값을 바꿔놓고 사용자는 이전 값이라 믿는 경로를 원천 차단),
사람 클릭(렌더러)만 `POST /api/v1/nudge-guard`로 확정한다. 이 부재는
테스트가 고정한다.

`propose`는 라우틴 draft와 달리 **비영속(ephemeral) 게이트**다 — 아무것도
저장하지 않는다(백엔드에 쓰기 호출을 하지 않는다). 현재 값을 `GET`으로
가져와 모델이 제안한 값과 나란히 반환할 뿐이다 — 그 결과는 채팅 확인
카드에만 잠깐 실리고, 사용자가 [확인]을 눌러야 렌더러가 직접
`POST /api/v1/nudge-guard`를 불러 비로소 확정한다(guard_settings.py
모듈 독스트링 참고).
"""

from __future__ import annotations

from typing import Any

import httpx
import mcp.types as types

from athena_mcp.result import (
    blocked as _blocked,
)
from athena_mcp.result import (
    success as _success,
)
from athena_mcp.result import (
    upstream_failed as _upstream_failed,
)

NUDGE_GUARD_TOOL = "athena_nudge_guard"

_ALLOWED_ACTIONS: tuple[str, ...] = ("propose", "get")

_TIMEOUT_SECONDS = 15.0

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {
            "type": "string",
            "enum": list(_ALLOWED_ACTIONS),
            "description": (
                "propose = 가드 설정 변경 제안(저장 안 함 — 사람이 확인 카드에서 "
                "[확인]을 눌러야 반영), get = 현재 가드 설정 조회(읽기 전용). "
                "저장 액션은 존재하지 않는다 — 확정은 사용자가 앱에서 직접 한다."
            ),
        },
        "propose": {
            "type": "object",
            "description": (
                "action=propose일 때의 제안값. 4개 필드 중 사용자가 언급한 "
                "것만 채운다(비운 필드는 현재 값이 그대로 쓰인다) — get으로 "
                "현재 값을 먼저 확인한 뒤 바뀌는 필드만 채우는 걸 권장한다."
            ),
            "properties": {
                "max_daily_nudges": {
                    "type": "integer",
                    "description": "하루 최대 프로액티브 발화 횟수(0~10).",
                },
                "quiet_hours": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "string", "description": "'HH:MM'"},
                        "end": {"type": "string", "description": "'HH:MM'"},
                    },
                },
                "show_rationale": {"type": "boolean"},
                "learn_from_dismissals": {"type": "boolean"},
            },
        },
    },
}

_DESCRIPTION = (
    "말걸기(프로액티브 발화) 가드 설정의 제안·조회. propose는 **제안일 뿐 "
    "저장이 아니다** — 대화 창 확인 카드에서 사람이 [확인]을 눌러야 값이 "
    "바뀌고, 확인 전에는 어떤 값도 바뀌지 않는다(저장됐다고 말하지 마라)."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=NUDGE_GUARD_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


async def dispatch(
    arguments: dict[str, Any], http_client: httpx.AsyncClient
) -> types.CallToolResult:
    """재시도 없음 — 단 한 번의 루프백 시도 후 즉시 결과를 반환한다."""
    action = arguments.get("action")
    if action not in _ALLOWED_ACTIONS:
        # 저장/확정을 포함한 그 외 전부 — 사람 전용 행위임을 명시한다.
        return _blocked(
            f"허용되지 않는 action: {action!r}. propose(제안)·get(조회)만 가능하다 — "
            "확정은 사용자가 앱에서 직접 한다."
        )
    try:
        # propose·get 둘 다 현재 값은 GET으로만 가져온다 — propose는 쓰기
        # 호출을 아예 하지 않는다(비영속).
        response = await http_client.get(
            "/api/v1/nudge-guard", timeout=_TIMEOUT_SECONDS
        )
    except httpx.ConnectError:
        return _upstream_failed(
            "키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다. 사용자에게 백엔드 "
            "실행을 안내하고, 가드 설정이 바뀌었다고 말하지 마라."
        )
    except httpx.HTTPError as exc:
        return _upstream_failed(f"athena_nudge_guard 호출 중 전송 오류: {exc}")

    if response.status_code >= 400:
        try:
            body = response.json()
            detail = body.get("detail") if isinstance(body, dict) else None
            message = body.get("message") if isinstance(body, dict) else None
        except ValueError:
            detail, message = response.text[:300], None
        text = f"{detail or 'HTTP ' + str(response.status_code)}"
        if message:
            text += f" — {message}"
        return _upstream_failed(text)

    current = response.json()
    if action == "get":
        return _success(current)

    proposed = arguments.get("propose") or {}
    payload = {
        "current": current,
        "proposed": proposed,
        "notice": (
            "이것은 제안이다 — 사용자가 확인 카드에서 [확인]을 누르기 전에는 "
            "가드 설정이 바뀌지 않는다."
        ),
    }
    return _success(payload)
