"""`athena_routine` — 루틴 제안·조회 빌트인 (HTTP 루프백 프록시).

selector_tools.py와 같은 이유로 `athena_api`를 import하지 않고 이미 떠 있는
백엔드에 루프백 호출만 한다. **재시도 없음** — 같은 문서의 규율 그대로.

허용 액션은 `draft`(제안 초안)·`list`(읽기 전용) **둘뿐**이다. confirm·cancel
액션은 존재하지 않는다 — 상태를 바꾸는 행위는 사람 클릭(렌더러) 전용이다
(실행계획 §7-6, 델타 검토 blocker: 모델이 취소해놓고 사용자는 감시 중이라
믿는 경로를 원천 차단). 이 부재는 테스트가 고정한다.
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

ROUTINE_TOOL = "athena_routine"

_ALLOWED_ACTIONS: tuple[str, ...] = ("draft", "list")

_TIMEOUT_SECONDS = 15.0

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {
            "type": "string",
            "enum": list(_ALLOWED_ACTIONS),
            "description": (
                "draft = 루틴 초안 제안(등록 아님 — 사람이 승인 카드에서 확정), "
                "list = 등록된 루틴 목록 조회(읽기 전용). 승인·취소 액션은 "
                "존재하지 않는다 — 사람만 할 수 있다."
            ),
        },
        "draft": {
            "type": "object",
            "description": (
                "action=draft일 때의 초안. condition.source는 카탈로그 값만: "
                "price.current / price.change_rate / trade.strength / "
                "volume.prev_day_ratio / vi.triggered (이상 실시간 WS) / "
                "disclosure.title_keyword (주기 확인 — 공시). "
                "감시 방식(mode)은 source에서 자동 유도된다 — 실시간은 WS "
                "필드뿐이고 공시는 주기 확인이라 최대 폴링 주기만큼 늦게 "
                "감지될 수 있다(사용자에게 이 차이를 항상 말하라)."
            ),
            "properties": {
                "symbol": {"type": "string", "description": "6자리 종목코드"},
                "condition": {
                    "type": "object",
                    "properties": {
                        "source": {"type": "string"},
                        "op": {"type": "string"},
                        "value": {},
                        "consecutive_ticks": {"type": "integer"},
                    },
                },
                "cooldown_s": {"type": "integer"},
                "expires_days": {"type": "integer"},
                "note": {"type": "string"},
            },
        },
    },
}

_DESCRIPTION = (
    "감시 루틴의 제안·조회. draft는 **제안일 뿐 등록이 아니다** — 대화 창 승인 "
    "카드에서 사람이 [승인]을 눌러야 감시가 시작되고, 승인 전에는 어떤 감시도 "
    "실재하지 않는다(등록됐다고 말하지 마라). 조건 도달 시 앱이 알림을 보내며, "
    "주문은 자동 집행되지 않는다 — 사람이 티켓에서 직접 실행한다."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=ROUTINE_TOOL,
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
        # confirm·cancel을 포함한 그 외 전부 — 사람 전용 행위임을 명시한다.
        return _blocked(
            f"허용되지 않는 action: {action!r}. draft(제안)·list(조회)만 가능하다 — "
            "승인·취소는 사용자가 앱에서 직접 한다."
        )
    try:
        if action == "list":
            response = await http_client.get(
                "/api/v1/routines", timeout=_TIMEOUT_SECONDS
            )
        else:
            response = await http_client.post(
                "/api/v1/routines/draft",
                json=arguments.get("draft") or {},
                timeout=_TIMEOUT_SECONDS,
            )
    except httpx.ConnectError:
        return _upstream_failed(
            "키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다. 사용자에게 백엔드 "
            "실행을 안내하고, 루틴이 등록됐다고 말하지 마라."
        )
    except httpx.HTTPError as exc:
        return _upstream_failed(f"athena_routine 호출 중 전송 오류: {exc}")

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

    payload = response.json()
    if action == "draft":
        payload = {
            **payload,
            "notice": (
                "이것은 제안이다 — 사용자가 승인 카드에서 [승인]을 누르기 전에는 "
                "감시가 시작되지 않는다."
            ),
        }
    return _success(payload)
