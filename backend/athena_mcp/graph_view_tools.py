"""`athena_graph_view` — 채팅이 그래프 화면을 움직이는 빌트인 (백엔드를 타지 않는다).

**왜 별 도구인가.** `athena_brain`은 "읽기 전용이고 쓰기 액션은 존재하지 않는다"를
계약으로 못박고 테스트가 그것을 고정한다(`test_no_write_action_exists`). 화면을 옮기는
액션을 그 도구에 섞으면 그 계약의 뜻이 흐려진다 — 그래프에 쓰지 않는 것과 화면을
바꾸지 않는 것은 다른 이야기인데 한 도구 안에 있으면 구별해 말할 수 없다.

**왜 백엔드를 안 타나.** 여기서 하는 일은 전부 렌더러의 상태 변경이다. `backtest_tools`의
`navigate`/`propose_*`와 같은 구조를 쓴다: 이 도구는 `delivered:"canvas"` 봉투만
돌려주고, `app/main.js`가 tool_result에서 그것을 골라 렌더러로 보낸다. 루프백 왕복이
없으니 지연도 없고, 백엔드가 화면 상태를 알 필요도 없다.

노출하는 다섯:

| action | 하는 일 | 무엇이 바뀌나 |
|---|---|---|
| `navigate` | 서브뷰 전환 | 요약 표 / 군집 지도 / 수집·노출 |
| `select` | 노드 선택 | 공통 패널이 그 노드로 열리고 지도가 그 노드로 초점을 옮긴다 |
| `filter` | 헤더 필터 | 기간·연결 수·정렬 (localStorage에 남아 다음에 열어도 같다) |
| `fit` | 지도 맞춤 | 전체가 프레임에 들어오게 되돌린다 |
| `propose_edit` | **제안만** | 확정 카드가 뜬다 — 누르는 것은 사람이다 |

**`propose_edit`은 쓰기가 아니다.** 그래프 쓰기는 여전히 두 경로뿐이고 둘 다 사람의
행동에서 시작한다(채팅→추출, 체결·잔고→결정적 투영). 이 액션이 하는 일은 "이 관계를
이렇게 고칠까요?" 카드를 띄우는 것이고, 사람이 누르면 **사람의 답변 문장**이 채팅으로
제출되어 평소의 추출 경로를 탄다. 모델이 카드를 스스로 누를 방법은 없다.
"""

from __future__ import annotations

from typing import Any

import mcp.types as types

from athena_mcp.result import (
    blocked as _blocked,
)
from athena_mcp.result import (
    success as _success,
)

GRAPH_VIEW_TOOL = "athena_graph_view"

_ALLOWED_ACTIONS: tuple[str, ...] = (
    "navigate",
    "select",
    "filter",
    "fit",
    "propose_edit",
)

# 서브뷰 세 개 — 화면의 뷰 토글(요약 / 그래프 / 수집·노출)과 같은 축이다.
_SURFACES: tuple[str, ...] = ("summary", "map", "settings")

# 필터 선택지는 `app/lib/graph-mode/graph-filters.js`가 진실이다. 여기 값이 그것과
# 어긋나면 모델이 걸 수 없는 조건을 건 척하게 된다 — 그 파일의 상수와 같은 값을 쓴다.
_WINDOW_DAYS: tuple[int, ...] = (30, 90, 180, 365)
_MIN_DEGREES: tuple[int, ...] = (0, 2, 3, 5)
_SUMMARY_SORTS: tuple[str, ...] = ("reinforcement", "recent")

# 제안할 수 있는 편집 세 종. `remove`가 있는 이유: 되물을 것들 카드가 이미 "아니다 →
# 그 연결은 지워도 돼"를 사람의 문장으로 보내고 있다. 같은 일을 모델이 먼저 제안할 수
# 있게 하는 것이지, 새 권한을 만드는 것이 아니다.
_EDIT_OPS: tuple[str, ...] = ("add", "change", "remove")

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {
            "type": "string",
            "enum": list(_ALLOWED_ACTIONS),
            "description": (
                "navigate = 서브뷰 전환, select = 노드 선택(패널 열림 + 지도 초점), "
                "filter = 헤더 필터 걸기, fit = 지도를 전체 맞춤으로 되돌리기, "
                "propose_edit = 관계 편집 **제안**(확정은 사람이 카드를 누른다). "
                "전부 화면만 바꾼다 — 그래프에 쓰는 액션은 여기에도 없다."
            ),
        },
        "surface": {
            "type": "string",
            "enum": list(_SURFACES),
            "description": "action=navigate일 때 갈 서브뷰.",
        },
        "entity": {
            "type": "string",
            "description": (
                "action=select일 때 고를 노드의 entity_id. 이름만 알면 먼저 "
                "athena_brain action=entity로 id를 확인해라 — 이름을 넣으면 못 찾는다."
            ),
        },
        "window_days": {
            "type": "integer",
            "enum": list(_WINDOW_DAYS),
            "description": "action=filter일 때 기간(일).",
        },
        "min_degree": {
            "type": "integer",
            "enum": list(_MIN_DEGREES),
            "description": "action=filter일 때 최소 연결 수. 0이면 전체.",
        },
        "summary_sort": {
            "type": "string",
            "enum": list(_SUMMARY_SORTS),
            "description": "action=filter일 때 성향 신호 표의 정렬.",
        },
        "edit": {
            "type": "object",
            "description": (
                "action=propose_edit일 때의 제안. op=add|change|remove, "
                "subject·object는 노드 이름, relation은 관계 이름, "
                "reason은 왜 그렇게 고쳐야 하는지(카드 부제로 사람이 읽는다). "
                # relation의 출처를 지목한다 — 이것이 없어서 모델이 관계 이름을 못
                # 채우고 매번 막혔다(2026-09-03 실사용: 확정 카드가 한 번도 안 떴다).
                "relation은 athena_brain action=entity가 준 관계 목록의 이름을 그대로 "
                "쓴다 — 화면에 보이는 한글 라벨이나 지어낸 이름을 넣으면 사람이 "
                "무엇을 승인하는지 알 수 없다. 관계를 모르면 먼저 그것을 조회해라."
            ),
            "properties": {
                "op": {"type": "string", "enum": list(_EDIT_OPS)},
                "subject": {"type": "string"},
                "object": {"type": "string"},
                "relation": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["op", "object", "relation"],
        },
    },
}

_DESCRIPTION = (
    "그래프 화면 제어. 사람이 말로 시킨 것을 화면에서 실제로 일어나게 한다 — "
    "서브뷰 전환·노드 선택·필터 걸기·지도 맞춤. 답만 하고 화면을 그대로 두면 "
    "사용자는 말한 것이 반영됐는지 알 수 없으니, 화면을 옮기라는 요청에는 이 도구를 "
    "부르고 그 사실을 한 줄로 알려라. "
    "**편집은 propose_edit으로 제안만 한다** — 이 도구로도 그래프에 쓸 수 없다. "
    "제안하면 확정 카드가 뜨고, 사람이 누르면 그 답이 평소의 추출 경로로 그래프를 "
    "갱신한다. 그러니 '고쳤다'고 말하지 말고 '이렇게 고칠지 물었다'고 말해라."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=GRAPH_VIEW_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


async def dispatch(arguments: dict[str, Any]) -> types.CallToolResult:
    """백엔드를 타지 않는다 — 봉투를 만들어 돌려주는 것이 전부다.

    `http_client`를 받지 않는 것이 다른 빌트인과 다른 점이고, 그것이 이 도구의 성질을
    말해 준다: 여기서 일어나는 일은 전부 렌더러 안이다.
    """
    action = arguments.get("action")
    if action not in _ALLOWED_ACTIONS:
        return _blocked(
            f"허용되지 않는 action: {action!r}. {'·'.join(_ALLOWED_ACTIONS)}만 가능하다."
        )

    if action == "navigate":
        surface = arguments.get("surface")
        if surface not in _SURFACES:
            return _blocked(
                f"navigate에는 surface가 필요하다 — {'/'.join(_SURFACES)} 중 하나."
            )
        return _success(
            {
                "delivered": "canvas",
                "kind": "navigate",
                "surface": surface,
                "notice": "화면을 옮겼다. 무엇으로 옮겼는지 한 줄로 알려라.",
            }
        )

    if action == "select":
        entity = _text(arguments.get("entity"))
        if entity is None:
            return _blocked(
                "select에는 entity(entity_id 문자열)가 필요하다. 이름만 안다면 먼저 "
                "athena_brain action=entity로 id를 확인해라."
            )
        return _success(
            {
                "delivered": "canvas",
                "kind": "select",
                "entity_id": entity,
                "notice": (
                    "그 노드를 골랐다 — 공통 패널이 열리고 지도가 초점을 옮겼다. "
                    "화면에 없는 id였으면 아무 일도 일어나지 않는다."
                ),
            }
        )

    if action == "filter":
        window_days = arguments.get("window_days")
        min_degree = arguments.get("min_degree")
        summary_sort = arguments.get("summary_sort")
        patch: dict[str, Any] = {}
        if isinstance(window_days, int) and not isinstance(window_days, bool):
            if window_days not in _WINDOW_DAYS:
                return _blocked(
                    f"window_days는 {'/'.join(str(v) for v in _WINDOW_DAYS)} 중 하나여야 한다."
                )
            patch["windowDays"] = window_days
        if isinstance(min_degree, int) and not isinstance(min_degree, bool):
            if min_degree not in _MIN_DEGREES:
                return _blocked(
                    f"min_degree는 {'/'.join(str(v) for v in _MIN_DEGREES)} 중 하나여야 한다."
                )
            patch["minDegree"] = min_degree
        if summary_sort is not None:
            if summary_sort not in _SUMMARY_SORTS:
                return _blocked(
                    f"summary_sort는 {'/'.join(_SUMMARY_SORTS)} 중 하나여야 한다."
                )
            patch["summarySort"] = summary_sort
        if not patch:
            # 빈 필터를 보내면 화면이 아무 일도 안 하는데 모델은 걸었다고 말한다.
            return _blocked(
                "filter에는 window_days·min_degree·summary_sort 중 하나 이상이 필요하다."
            )
        return _success(
            {
                "delivered": "canvas",
                "kind": "filter",
                "patch": patch,
                "notice": (
                    "필터를 걸었다. 화면이 다시 조회되므로 개수가 줄 수 있다 — "
                    "빈 화면이 되면 '성향이 없다'가 아니라 조건이 빡빡한 것이다."
                ),
            }
        )

    if action == "fit":
        return _success(
            {
                "delivered": "canvas",
                "kind": "fit",
                "notice": "지도를 전체 맞춤으로 되돌렸다.",
            }
        )

    edit = arguments.get("edit")
    edit = edit if isinstance(edit, dict) else {}
    # 막을 때는 **회복 경로까지** 적는다(2026-09-03 실사용으로 발견).
    #
    # 실앱에서 확정 카드가 한 번도 뜨지 않았다. 원인은 백엔드가 아니라 이 막음이었다:
    # edit이 불완전하면 isError로 끝나고, 셸은 is_error인 결과를 카드로 만들지 않는다
    # (main.js maybeForwardGraphChatAction). 그래서 사람에게는 "편집 도구가 응답하지
    # 않는다"로만 보였고, 모델은 관계 이름을 못 채워 "노드를 직접 클릭해 주세요"라고
    # 떠넘겼다 — 말로 시키는 것이 이 모드의 요점인데 그것이 막힌 셈이다.
    #
    # relation을 어디서 얻는지 스키마가 말해 주지 않은 것이 실제 구멍이었다. 위
    # entity 필드가 이미 쓰는 방식대로("athena_brain action=entity로 id를 확인해라")
    # 다음에 부를 것을 지목한다. 막는 것 자체는 그대로다 — 관계 없는 제안은 카드로
    # 만들 수 없고(무엇을 고칠지 모른다), 지어낸 관계를 넣는 것이 더 나쁘다.
    _RECOVERY = (
        "athena_brain action=entity로 그 노드의 관계 목록을 먼저 확인해라 — "
        "relation에는 거기 실린 관계 이름을 그대로 넣는다. "
        "사람에게 노드를 클릭하라고 떠넘기지 마라."
    )
    op = edit.get("op")
    if op not in _EDIT_OPS:
        return _blocked(
            f"propose_edit의 edit.op은 {'/'.join(_EDIT_OPS)} 중 하나여야 한다. {_RECOVERY}"
        )
    obj = _text(edit.get("object"))
    relation = _text(edit.get("relation"))
    if obj is None or relation is None:
        return _blocked(
            f"propose_edit의 edit에는 object와 relation(문자열)이 필요하다. {_RECOVERY}"
        )
    return _success(
        {
            "delivered": "canvas",
            "kind": "edit_proposal",
            "op": op,
            # subject를 안 주면 화면이 투자자 프로필을 주체로 읽는다(성향 관계) —
            # 성향 신호 표가 "내가"를 아예 적지 않는 것과 같은 규칙이다.
            "subject": _text(edit.get("subject")),
            "object": obj,
            "relation": relation,
            "reason": _text(edit.get("reason")),
            "notice": (
                "아직 아무것도 바뀌지 않았다 — 확정 카드를 띄웠을 뿐이다. "
                "사람이 누르면 그 답이 추출 경로로 그래프를 갱신한다. "
                "'고쳤다'고 말하지 마라."
            ),
        }
    )


__all__ = ["GRAPH_VIEW_TOOL", "builtin_tool_defs", "dispatch"]
