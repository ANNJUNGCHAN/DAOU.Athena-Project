"""`athena_brain` — 투자의 뇌 조회 빌트인 (HTTP 루프백 프록시).

`routine_tools.py`·`selector_tools.py`와 같은 이유로 `athena_api`를 import하지 않고
이미 떠 있는 백엔드에 루프백 호출만 한다. **재시도 없음** — 같은 규율 그대로.

**전부 읽기 전용이다.** 그래프에 쓰는 액션은 없다. 이유는 티어 설계에 있다: 모델이
그래프에 직접 쓸 수 있으면 대화 티어가 자기 주장을 결정적 사실처럼 밀어 넣을 길이
생긴다. 쓰기는 두 경로뿐이고 둘 다 사람의 행동에서 시작한다 — 채팅(`POST /brain/chat`
→ 추출)과 체결·잔고(계좌 피드 → 결정적 투영기). 이 부재는 테스트가 고정한다.

노출하는 여섯:

| action | 답하는 질문 |
|---|---|
| `profile` | 이 투자자의 성향은 무엇인가 (말과 행동을 `tier`로 구분해서) |
| `god_nodes` | 투자의 중심에 무엇이 있는가 |
| `surprising` | 내가 못 본 연결은 어디인가 |
| `questions` | 무엇을 되물어야 하는가 (불확실하다고 기록된 것) |
| `diff` | 그 사이 무엇이 바뀌었나 |
| `entity` | **이 노드는 왜 이렇게 기록됐나** (관계·근거·보강·이력·대화 원문 발췌) |

`entity`가 2026-09-03에 늘었다. 그전까지 이 도구로는 "전체가 어떻게 생겼나"만 물을 수
있었고 노드 하나를 짚어 설명할 수 없었다 — 화면의 공통 패널은 같은 질문에 답하는데
모델에는 그 자료가 없어서, "이 노드 설명해줘"에 모델이 화면에 보이는 이름만 되풀이했다.
관계마다 `source.text`(그 기록을 만든 원문 발췌)가 실려 오는 것이 이 액션의 요점이다:
`rationale`은 추출기의 한 줄 요약이라 그것만으로는 요약의 요약을 말하게 된다.

`cluster_map`은 일부러 뺐다. 그건 캔버스가 그리는 좌표 데이터고, 노드 수천 개를
모델 컨텍스트에 쏟아 넣는 것은 답이 아니라 비용이다. `entity`는 그 반대 방향이다 —
노드 하나에 대해서만 깊게 준다.
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
    "entity",
)

# 액션 → (경로, 허용 질의 인자)
_ROUTES: dict[str, tuple[str, tuple[str, ...]]] = {
    "profile": ("/api/v1/brain/profile-summary", ("window_days", "limit")),
    "god_nodes": ("/api/v1/brain/analysis/god-nodes", ("limit",)),
    "surprising": ("/api/v1/brain/analysis/surprising-connections", ("limit",)),
    "questions": ("/api/v1/brain/analysis/suggested-questions", ("limit",)),
    "diff": ("/api/v1/brain/analysis/diff", ("from_revision",)),
    "entity": ("/api/v1/brain/analysis/entity-detail", ("entity", "limit")),
}

# 인자별 기대 타입(2026-09-03). 이전에는 전부 정수라 `isinstance(v, int)` 한 줄이면
# 됐는데 `entity`가 문자열이라 갈라야 한다. 키별로 못박는 이유는 느슨하게 "정수 또는
# 문자열"로 두면 `limit="전부"` 같은 값이 그대로 백엔드에 실려 422가 되기 때문이다.
# bool을 따로 막는 것도 같은 이유다 — 파이썬에서 `isinstance(True, int)`는 참이라
# `limit=True`가 `limit=1`로 조용히 통한다.
_PARAM_TYPES: dict[str, type] = {
    "window_days": int,
    "limit": int,
    "from_revision": int,
    "entity": str,
}


def _forwardable(key: str, value: Any) -> bool:
    expected = _PARAM_TYPES.get(key)
    if expected is None:
        return False
    if expected is int:
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, expected) and bool(value.strip())

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
                "diff = 특정 리비전 이후의 변화, "
                "entity = 노드 하나의 관계·근거·보강 횟수·변경 이력과 "
                "그 기록을 만든 **대화 원문 발췌**. 전부 읽기 전용이다 — "
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
        "entity": {
            "type": "string",
            "description": (
                "action=entity일 때 설명할 노드. 화면이 고른 노드가 있으면 그 "
                "entity_id를, 사람이 이름으로 물었으면 그 이름을 그대로 넣는다. "
                "이름이 여럿에 걸리면 resolved=false와 candidates가 오므로 "
                "하나를 골라 단정하지 말고 어느 것인지 되물어라."
            ),
        },
    },
}

_DESCRIPTION = (
    "투자자의 성향 그래프 조회. **읽기 전용이다** — 이 도구로는 그래프에 아무것도 "
    "쓸 수 없고, 쓰기는 사람의 채팅과 실제 체결·잔고에서만 생긴다. "
    "profile 결과의 `tier`가 'deterministic'이면 체결·잔고에서 유도된 사실이고 "
    "'conversational'이면 대화에서 추론된 것이다 — 둘이 어긋나면 그 자체가 신호이니 "
    "사실인 것처럼 뭉뚱그리지 마라. `confidence`가 'AMBIGUOUS'인 항목은 확정된 성향이 "
    "아니라 되물어야 할 것이다. "
    "노드 하나를 설명해 달라는 요청에는 action='entity'를 먼저 불러라 — 관계마다 "
    "`source.text`(그 기록을 만든 대화·체결 원문 발췌)가 실려 오므로 근거를 인용할 수 "
    "있다. `source.truncated`가 true면 잘린 발췌이니 전문인 것처럼 인용하지 마라."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=BRAIN_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


# brain.py의 _MODEL_GATE_DETAIL과 짝인 마커 — exposeToModel 게이트 차단 503을
# 브레인 미기동 503과 구분한다(G-I3).
_EXPOSE_GATE_DETAIL = "expose-to-model-disabled"


def _is_expose_gate_denial(response: httpx.Response) -> bool:
    try:
        payload = response.json()
    except ValueError:
        return False
    return isinstance(payload, dict) and payload.get("detail") == _EXPOSE_GATE_DETAIL


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
        if key in arguments and _forwardable(key, arguments[key])
    }
    if action == "entity" and "entity" not in params:
        # 무엇을 설명할지 모르는 채로 백엔드를 부르면 422가 온다 — 여기서 말해 준다.
        return _blocked(
            "action='entity'는 entity(노드 이름 또는 entity_id 문자열)가 필요하다."
        )

    try:
        response = await http_client.get(path, params=params, timeout=_TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        return _upstream_failed(f"투자의 뇌 조회에 실패했다: {type(exc).__name__}")

    if response.status_code == 503:
        # 브레인은 선택적 기능이다. 꺼져 있는 것과 고장난 것을 구분해 말해야 모델이
        # "데이터가 없다"와 "물어볼 수 없다"를 뒤섞지 않는다. 같은 503이라도
        # exposeToModel 게이트 차단(WP-I, detail 마커는 brain.py의
        # _MODEL_GATE_DETAIL과 짝)은 "미기동"과 다시 구분한다 — 사용자가 노출을
        # 꺼 둔 상태를 기동 문제처럼 말하면 안 된다.
        if _is_expose_gate_denial(response):
            return _blocked(
                "설정의 exposeToModel 토글이 꺼져 있어 성향 그래프를 조회할 수 없다. "
                "성향 데이터가 없다고 단정하지 마라 — 사용자가 모델 노출을 꺼 둔 것이다."
            )
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
