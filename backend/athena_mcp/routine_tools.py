"""`athena_routine` — 루틴 제안·조회 빌트인 (HTTP 루프백 프록시).

selector_tools.py와 같은 이유로 `athena_api`를 import하지 않고 이미 떠 있는
백엔드에 루프백 호출만 한다. **재시도 없음** — 같은 문서의 규율 그대로.

허용 액션은 `draft`(제안 초안)·`list`(읽기 전용)·`propose`(제어 제안)·
`propose_watch_code`(감시 코드 파일 착지) **넷뿐**이다. confirm·cancel 액션은
존재하지 않는다 — 상태를 바꾸는 행위는
사람 클릭(렌더러) 전용이다(실행계획 §7-6, 델타 검토 blocker: 모델이
취소해놓고 사용자는 감시 중이라 믿는 경로를 원천 차단). 이 부재는 테스트가
고정한다.

`propose`는 실행이 아니다 — nudge_guard_tools.py의 propose와 같은 비영속
게이트다. 목록 조회(`GET /api/v1/routines`) 한 번 말고는 어떤 백엔드 호출도
하지 않으며, 현재 값과 제안값을 나란히 반환할 뿐이다. 확정은 사용자가 제안
카드의 칩을 눌렀을 때 렌더러가 직접 해당 REST를 부른다.
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

_ALLOWED_ACTIONS: tuple[str, ...] = (
    "draft",
    "list",
    "propose",
    "propose_watch_code",
)

# 제안 가능한 제어 12종 — 렌더러 IPC 채널명·REST 동사와 같은 식별자다.
# 이 목록은 제안(칩)의 종류일 뿐 실행 권한이 아니다.
_CONTROL_ACTIONS: tuple[str, ...] = (
    "confirm",
    "update",
    "pause",
    "resume",
    "cancel",
    "ack",
    "ack_all",
    "adopt",
    "hold",
    "guard",
    "fire",
    "view",
)

# control=update 제안이 만질 수 있는 필드 — 조건(condition)은 제외다.
# 조건 편집은 06 설정 폼에서 사람이 소스별 분기를 보며 직접 한다.
# briefing_model/briefing_effort도 없다 — 예약 브리핑은 앱 모델 설정(키우미·셸과 같은
# 활성 모델)으로 돈다(app/lib/main/briefing-runner.js selectModel, 2026-09-08 확정).
# 루틴 스키마의 두 필드는 저장만 될 뿐 실행기가 읽지 않으므로 여기서 제안하지 않는다.
_UPDATABLE_FIELDS: tuple[str, ...] = (
    "note",
    "cooldown_s",
    "expires_days",
)

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
                "list = 등록된 루틴 목록 조회(읽기 전용), "
                "propose = 기존 루틴에 대한 제어 제안(실행 아님 — 칩을 사람이 "
                "눌러야 반영), "
                "propose_watch_code = 감시 함수 코드를 프로젝트 폴더의 watch 파일로 "
                "저장(검사 전 — 저장만으로는 아무것도 감시하지 않는다). "
                "승인·취소 액션은 존재하지 않는다 — 사람만 할 수 있다."
            ),
        },
        "draft": {
            "type": "object",
            "description": (
                "action=draft일 때의 초안. condition.source는 카탈로그 값만: "
                "price.current / price.change_rate / trade.strength / "
                "volume.prev_day_ratio / vi.triggered (이상 실시간 WS) / "
                "schedule.daily (예약 — 지정 요일·시각, op는 'at' 고정) / "
                "code.watch (코드 감시 — op는 '==', value는 true 고정). "
                "code.watch 초안은 watch 블록이 필수다: "
                "{project_id, path, version_hash, params, poll_interval_s(60~600), "
                "lookback_days(7~90)}. path는 프로젝트 폴더 안 'watch/<이름>.py' "
                "상대 경로이고, version_hash는 propose_watch_code가 돌려준 "
                "code_hash를 그대로 넣는다(파일이 그 뒤 바뀌면 켜지지 않는다). "
                "감시 함수 파일에는 NODE_LABELS(함수 이름 → 한국어 제목 짝)를 "
                "반드시 적어라 — 노드 카드가 사람에게 보여줄 제목이 그 파일에만 있다. "
                "감시 방식(mode)은 source에서 자동 유도된다 — 실시간은 WS "
                "필드만 사용한다. 외부 사업자 데이터는 앱 플러그인에서 호출하며 "
                "이 백엔드 루틴 source로 제안할 수 없다. "
                "schedule.daily의 value는 '<요일>@<HH:MM>' 문자열이다 — "
                "요일은 ALL(매일) 또는 ISO 요일 번호 콤마열(1=월..7=일, 예: "
                "'1,2,3,4,5@07:30'). symbol은 이 source에서도 6자리 종목코드가 "
                "필수다 — 종목과 무관한 예약(예: '평일 아침 브리핑')이라도 "
                "관련 종목/ETF나 대표 보유 종목을 사용자에게 물어 정하라"
                "(임의로 지어내지 마라). 예약 브리핑이 쓸 모델·노력은 루틴에 "
                "정하지 않는다 — 앱의 모델 설정을 그대로 따른다."
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
                "goal": {
                    "type": "boolean",
                    "description": (
                        "사용자가 목표가·목표 도달을 명시적으로 말했을 때만 true. "
                        "애매하면 생략(기본 false) — 오분류가 과대 반응(FACE.GLAD)을 "
                        "부르니 보수적으로 판단하라."
                    ),
                },
                "watch": {
                    "type": "object",
                    "description": (
                        "condition.source가 code.watch일 때만 — 감시 함수 파일을 "
                        "가리킨다. 코드 원문은 여기 담지 않는다(파일이 원본)."
                    ),
                    "required": ["project_id", "path", "version_hash"],
                    "properties": {
                        "project_id": {"type": "string"},
                        "path": {
                            "type": "string",
                            "description": "프로젝트 상대 경로 'watch/<이름>.py'",
                        },
                        "version_hash": {
                            "type": "string",
                            "description": "propose_watch_code가 돌려준 code_hash",
                        },
                        "params": {"type": "object"},
                        "poll_interval_s": {"type": "integer", "description": "60~600초"},
                        "lookback_days": {"type": "integer", "description": "7~90일"},
                    },
                },
            },
        },
        "watch_code": {
            "type": "object",
            "description": (
                "action=propose_watch_code일 때의 감시 코드. 프로젝트 폴더 안 "
                "'watch/<이름>.py' 하나에만 쓰이고, 저장은 검사도 감시 시작도 "
                "아니다 — 돌려받은 code_hash를 draft의 watch.version_hash에 넣고 "
                "사람이 승인 카드를 눌러야 비로소 감시가 돈다. 이미 켜져 있거나 "
                "잠시 멈춘 알람이 쓰는 파일은 저장되지 않는다."
            ),
            "required": ["project_id", "path", "source"],
            "properties": {
                "project_id": {"type": "string"},
                "path": {
                    "type": "string",
                    "description": "프로젝트 상대 경로 'watch/<이름>.py'",
                },
                "source": {
                    "type": "string",
                    "description": (
                        "감시 함수 파이썬 원문. signals(df, p)가 entry·exit 두 열을 "
                        "돌려주고 마지막 행이 판정이다. 최상위에 NODE_LABELS로 "
                        "함수별 한국어 제목을 적어라."
                    ),
                },
                "labels": {
                    "type": "object",
                    "description": (
                        "함수 이름 → 한국어 제목 짝(선택). 코드에 NODE_LABELS가 "
                        "없으면 이 값이 파일 끝에 함께 저장된다."
                    ),
                },
            },
        },
        "propose": {
            "type": "object",
            "description": (
                "action=propose일 때의 제어 제안. 아무것도 실행하지 않는다 — "
                "현재 값과 제안값을 나란히 반환할 뿐이고, 사용자가 카드의 칩을 "
                "눌러야 비로소 반영된다. control=update의 proposed는 note·"
                "cooldown_s·expires_days만 담을 수 있다 — 조건(condition)은 06 "
                "설정 폼에서 사람이 직접 고친다."
            ),
            "required": ["control"],
            "properties": {
                "control": {
                    "type": "string",
                    "enum": list(_CONTROL_ACTIONS),
                    "description": "제안할 제어 1종.",
                },
                "routine_id": {
                    "type": "string",
                    "description": "대상 루틴 id(선택 — view처럼 대상이 없는 제안도 있다)",
                },
                "proposed": {
                    "type": "object",
                    "description": "편집·가드 제안값(선택).",
                },
                "rationale": {
                    "type": "string",
                    "description": "왜 이 제어를 제안하는지 근거 1줄.",
                },
                "view": {
                    "type": "object",
                    "description": "control=view일 때의 화면 이동 제안(선택).",
                    "properties": {
                        "tab": {"type": "string"},
                        "filter": {"type": "string"},
                        "query": {"type": "string"},
                        "drill_in": {"type": "string"},
                    },
                },
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


# 6-B에서 07·08 보드 승인 문구로 교체될 자리표시자다 — 지금은 상태어만 둔다.
_PROPOSE_NOTICE = "확인 대기"


def _condition_keys(proposed: dict[str, Any]) -> list[str]:
    """update 제안에서 조건을 건드리려는 키 — 중첩(condition)·평면(condition.op) 둘 다."""
    return sorted(
        k
        for k in proposed
        if not isinstance(k, str) or k not in _UPDATABLE_FIELDS
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
            f"허용되지 않는 action: {action!r}. draft(제안)·list(조회)·"
            "propose(제어 제안)·propose_watch_code(감시 코드 저장)만 가능하다 — "
            "승인·취소는 사용자가 앱에서 직접 한다."
        )

    proposal: dict[str, Any] = {}
    control: Any = None
    if action == "propose":
        raw_proposal = arguments.get("propose")
        proposal = raw_proposal if isinstance(raw_proposal, dict) else {}
        control = proposal.get("control")
        if control not in _CONTROL_ACTIONS:
            return _blocked(
                f"허용되지 않는 control: {control!r}. "
                f"제안 가능한 제어는 {list(_CONTROL_ACTIONS)}뿐이다."
            )
        raw_proposed = proposal.get("proposed")
        proposed = raw_proposed if isinstance(raw_proposed, dict) else {}
        if control == "update":
            extra = _condition_keys(proposed)
            if extra:
                return _blocked(
                    f"update 제안에 쓸 수 없는 필드: {extra}. "
                    f"{list(_UPDATABLE_FIELDS)}만 제안할 수 있고, 조건은 "
                    "사용자가 설정 화면에서 직접 고친다."
                )

    try:
        if action in ("list", "propose"):
            response = await http_client.get(
                "/api/v1/routines", timeout=_TIMEOUT_SECONDS
            )
        elif action == "propose_watch_code":
            response = await http_client.post(
                "/api/v1/routines/watch/code",
                json=arguments.get("watch_code") or {},
                timeout=_TIMEOUT_SECONDS,
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

    if response.status_code == 409 and action == "propose_watch_code":
        # 이미 켜진 알람의 코드 — 전송 실패가 아니라 게이트가 막은 것이다(R10).
        try:
            body = response.json()
            detail = body.get("detail") if isinstance(body, dict) else None
        except ValueError:
            detail = None
        return _blocked(str(detail or response.text[:300]))

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
    if action == "propose":
        routines = payload.get("routines") if isinstance(payload, dict) else None
        routine_id = proposal.get("routine_id")
        current = None
        if isinstance(routines, list) and isinstance(routine_id, str):
            current = next(
                (
                    row
                    for row in routines
                    if isinstance(row, dict) and row.get("id") == routine_id
                ),
                None,
            )
        return _success(
            {
                "control": control,
                "routine_id": routine_id,
                "current": current,
                "proposed": proposal.get("proposed"),
                "rationale": proposal.get("rationale"),
                "view": proposal.get("view"),
                "notice": _PROPOSE_NOTICE,
            }
        )
    if action == "propose_watch_code":
        saved = payload if isinstance(payload, dict) else {}
        return _success(
            {
                "path": saved.get("path"),
                "code_hash": saved.get("code_hash"),
                "notice": "저장됨 — 검사 전",
            }
        )
    if action == "draft":
        payload = {
            **payload,
            "notice": (
                "이것은 제안이다 — 사용자가 승인 카드에서 [승인]을 누르기 전에는 "
                "감시가 시작되지 않는다."
            ),
        }
    return _success(payload)
