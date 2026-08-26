"""`athena_brain` — 투자의 뇌 조회 빌트인 (HTTP 루프백 프록시).

`routine_tools.py`·`selector_tools.py`와 같은 이유로 `athena_api`를 import하지 않고
이미 떠 있는 백엔드에 루프백 호출만 한다. **재시도 없음** — 같은 규율 그대로.

**전부 읽기 전용이다.** 그래프에 쓰는 액션은 없다. 이유는 티어 설계에 있다: 모델이
그래프에 직접 쓸 수 있으면 대화 티어가 자기 주장을 결정적 사실처럼 밀어 넣을 길이
생긴다. 쓰기는 두 경로뿐이고 둘 다 사람의 행동에서 시작한다 — 채팅(`POST /brain/chat`
→ 추출)과 체결·잔고(계좌 피드 → 결정적 투영기). 이 부재는 테스트가 고정한다.

노출하는 다섯:

| action | 답하는 질문 |
|---|---|
| `profile` | 이 투자자의 성향은 무엇인가 (말과 행동을 `tier`로 구분해서) |
| `god_nodes` | 투자의 중심에 무엇이 있는가 |
| `surprising` | 내가 못 본 연결은 어디인가 |
| `questions` | 무엇을 되물어야 하는가 (불확실하다고 기록된 것) |
| `diff` | 그 사이 무엇이 바뀌었나 |

`cluster_map`은 일부러 뺐다. 그건 캔버스가 그리는 좌표 데이터고, 노드 수천 개를
모델 컨텍스트에 쏟아 넣는 것은 답이 아니라 비용이다.
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

BRAIN_TOOL = "athena_brain"

_ALLOWED_ACTIONS: tuple[str, ...] = (
    "profile",
    "god_nodes",
    "surprising",
    "questions",
    "diff",
)

# 액션 → (경로, 허용 질의 인자)
_ROUTES: dict[str, tuple[str, tuple[str, ...]]] = {
    "profile": ("/api/v1/brain/profile-summary", ("window_days", "limit")),
    "god_nodes": ("/api/v1/brain/analysis/god-nodes", ("limit",)),
    "surprising": ("/api/v1/brain/analysis/surprising-connections", ("limit",)),
    "questions": ("/api/v1/brain/analysis/suggested-questions", ("limit",)),
    "diff": ("/api/v1/brain/analysis/diff", ("from_revision",)),
}

_TIMEOUT_SECONDS = 15.0

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {
            "type": "string",
            "enum": list(_ALLOWED_ACTIONS),
            "description": (
                "profile = 투자 성향 요약(각 항목의 tier가 대화에서 왔는지 "
                "체결·잔고에서 왔는지 말해준다), "
                "god_nodes = 중심 노드, surprising = 군집 경계를 넘는 연결, "
                "questions = 불확실하다고 기록돼 되물을 만한 것, "
                "diff = 특정 리비전 이후의 변화. 전부 읽기 전용이다 — "
                "그래프에 쓰는 액션은 존재하지 않는다."
            ),
        },
        "window_days": {
            "type": "integer",
            "description": "action=profile일 때 집계 창(일). 기본 90.",
        },
        "limit": {"type": "integer", "description": "결과 개수 상한. 기본 10."},
        "from_revision": {
            "type": "integer",
            "description": "action=diff일 때 이 리비전 **이후**의 변화만.",
        },
    },
}

_DESCRIPTION = (
    "투자자의 성향 그래프 조회. **읽기 전용이다** — 이 도구로는 그래프에 아무것도 "
    "쓸 수 없고, 쓰기는 사람의 채팅과 실제 체결·잔고에서만 생긴다. "
    "profile 결과의 `tier`가 'deterministic'이면 체결·잔고에서 유도된 사실이고 "
    "'conversational'이면 대화에서 추론된 것이다 — 둘이 어긋나면 그 자체가 신호이니 "
    "사실인 것처럼 뭉뚱그리지 마라. `confidence`가 'AMBIGUOUS'인 항목은 확정된 성향이 "
    "아니라 되물어야 할 것이다."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=BRAIN_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


async def dispatch(
    arguments: dict[str, Any], http_client: httpx.AsyncClient
) -> types.CallToolResult:
    """재시도 없음 — 단 한 번의 루프백 시도 후 즉시 결과를 반환한다."""
    action = arguments.get("action")
    if action not in _ROUTES:
        return _blocked(
            f"허용되지 않는 action: {action!r}. "
            f"{'·'.join(_ALLOWED_ACTIONS)}만 가능하다 — 전부 읽기 전용이고, "
            "그래프에 쓰는 액션은 존재하지 않는다."
        )

    path, allowed = _ROUTES[action]
    params = {
        key: arguments[key]
        for key in allowed
        if key in arguments and isinstance(arguments[key], int)
    }

    try:
        response = await http_client.get(path, params=params, timeout=_TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        return _upstream_failed(f"투자의 뇌 조회에 실패했다: {type(exc).__name__}")

    if response.status_code == 503:
        # 브레인은 선택적 기능이다. 꺼져 있는 것과 고장난 것을 구분해 말해야 모델이
        # "데이터가 없다"와 "물어볼 수 없다"를 뒤섞지 않는다.
        return _blocked(
            "투자의 뇌가 아직 준비되지 않았다(설정에서 꺼져 있거나 기동 중). "
            "성향 데이터가 없다고 단정하지 마라."
        )
    if response.status_code >= 400:
        return _upstream_failed(f"투자의 뇌 조회가 {response.status_code}로 실패했다.")

    try:
        payload = response.json()
    except ValueError:
        return _upstream_failed("투자의 뇌 응답이 JSON이 아니다.")
    return _success(payload)


__all__ = ["BRAIN_TOOL", "builtin_tool_defs", "dispatch"]
