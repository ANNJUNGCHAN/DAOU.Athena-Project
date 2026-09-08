"""`athena_plugin` — 플러그인 설치·권한·삭제 **제안** 빌트인 (읽기 전용).

형제 툴들과 달리 백엔드 루프백 호출조차 하지 않는다. 로컬 상태(레지스트리·
승인 기록)를 **읽기만** 하고 제안 봉투를 조립해 돌려준다 — 그래서 dispatch가
받는 것은 http 클라이언트가 아니라 `registry`·`consent_store`다.

**이 툴은 아무것도 바꾸지 않는다.** 레지스트리(`~/.athena/mcp_servers.json`)와
승인 기록(`~/.athena/consent.json`)은 제안만으로 1바이트도 변하지 않는다
(`registry.reload()`가 잡는 `.mcp_servers.json.lock`은 소비자 파일이 아니다).
확정은 사람 클릭 전용이다 — 렌더러가 승인 카드를 그리고, 사용자가 [승인]을
눌러야 메인 프로세스가 실제 실행 경로를 탄다.

**이 툴은 `athena:mcp-stage-snippet`을 절대 호출하지 않는다.** `stage_snippet`
액션 이름이 그 IPC 채널과 겹치지만 경로가 같지 않다 — 그 IPC는 승인 클릭
시점에 `main.js`만 부른다. 액션 enum 이름공간과 IPC 채널 이름공간은 다르다.

**주의(빌트인은 consent 게이트를 우회한다).** `server.py`의 빌트인 분기는
호출별 승인 검사(`is_tool_allowed`)보다 **앞에서** 반환하므로 이 툴은 승인
없이도 항상 노출·호출된다. 지금은 읽기만 하므로 안전하지만, 여기에 변이
액션을 하나라도 더하면 게이트 없이 통과한다. `_ALLOWED_ACTIONS`의 길이를
`tests/mcp/test_plugin_tools.py`가 고정해 그 추가를 실패로 만든다.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import mcp.types as types

from athena_mcp.consent import ConsentStore
from athena_mcp.onboarding import derive_alias
from athena_mcp.registry import ServerRegistry
from athena_mcp.result import (
    blocked as _blocked,
)
from athena_mcp.result import (
    success as _success,
)

PLUGIN_TOOL = "athena_plugin"

_ALLOWED_ACTIONS: tuple[str, ...] = (
    "install",
    "allow_tools",
    "revoke_tools",
    "set_enabled",
    "remove",
    "stage_snippet",
)

# 내장 마켓플레이스(`athena-official`) 카탈로그 5종의 id.
# **원천은 `app/lib/plugin-catalog.js`의 `CATALOG`다** — 파이썬이 그 JS를
# import할 수 없어 여기 이름만 복제한다. 한쪽을 늘리면 반대쪽도 같이 늘린다
# (낡으면 카탈로그에 있는 서버인데도 설치 제안이 차단된다).
_CATALOG_IDS: frozenset[str] = frozenset(
    {
        "fetch",
        "time",
        "sequential-thinking",
        "memory",
        "korea-stock",
    }
)

# 플러그인이 **아닌** 내장 기능의 별칭. 키움 시세·주문·계좌와 투자의 뇌는
# 아테나 자신의 기능이라 설치·삭제·권한 변경의 대상이 아니다.
_BLOCKED_ALIASES: frozenset[str] = frozenset(
    {
        "kiwoom",
        "kiwoom-selector",
        "kiwoom-mcp",
        "brain",
        "athena",
    }
)

_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["actions"],
    "properties": {
        "actions": {
            "type": "array",
            "minItems": 1,
            "description": (
                "제안할 동작들. 보통 1개이고, 한 카드에 여러 동작을 담을 수도 있다."
            ),
            "items": {
                "type": "object",
                "required": ["action"],
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": list(_ALLOWED_ACTIONS),
                        "description": (
                            "install = 카탈로그의 플러그인 설치 제안. "
                            "allow_tools / revoke_tools = 이미 등록된 플러그인의 기능 "
                            "허용·철회 제안. set_enabled = 켜기/끄기 제안. "
                            "remove = 삭제 제안. stage_snippet = 설정 JSON으로 직접 "
                            "등록 제안(target 없이 snippet만 보낸다). "
                            "여섯 모두 **제안일 뿐이다** — 확정은 사용자가 앱에서 직접 한다."
                        ),
                    },
                    "target": {
                        "type": "string",
                        "description": (
                            "대상 별칭. install은 카탈로그 id, 나머지 넷은 이미 등록된 "
                            "별칭이어야 한다. stage_snippet에는 보내지 않는다."
                        ),
                    },
                    "features": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "allow_tools / revoke_tools의 대상 도구 이름들.",
                    },
                    "enabled": {
                        "type": "boolean",
                        "description": "set_enabled에서 켤지(true) 끌지(false).",
                    },
                    "snippet": {
                        "type": "string",
                        "description": (
                            'stage_snippet의 설정 JSON 문자열. `{"mcpServers": {"별칭": '
                            '{...}}}` 형태이고 서버는 **한 개**만 담는다.'
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": "이 동작 하나에 대한 근거(선택).",
                    },
                },
            },
        },
        "reason": {
            "type": "string",
            "description": "제안 전체의 근거. 승인 카드에 그대로 실린다.",
        },
    },
}

_DESCRIPTION = (
    "플러그인 설치·기능 허용/철회·켜기끄기·삭제·직접 등록의 **제안**을 만든다. "
    "이 툴은 **제안만 한다** — 등록 정보와 승인 기록을 읽을 뿐 한 글자도 바꾸지 "
    "않고, `athena:mcp-stage-snippet` 같은 실행 경로를 부르지도 않는다. 사용자가 "
    "플러그인 화면의 승인 카드에서 [승인]을 눌러야 비로소 실행된다(설치됐다·"
    "허용됐다고 말하지 마라). 키움·투자의 뇌는 아테나 내장 기능이라 대상이 될 수 없다."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=PLUGIN_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


def _is_blocked_alias(alias: str) -> bool:
    name = str(alias).strip().lower()
    return name in _BLOCKED_ALIASES or name.startswith("kiwoom") or name == "brain"


def _snippet_aliases(raw: Any) -> tuple[list[str], str | None]:
    """스니펫에서 별칭 목록을 뽑는다. 실패 사유는 세 갈래로 구분한다."""
    if not isinstance(raw, str) or not raw.strip():
        return [], "직접 등록 제안에 설정 JSON(snippet)이 없다."
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [], "설정 JSON을 읽을 수 없다 — 형식이 올바른지 확인하고 다시 제안하라."
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return [], '설정 JSON에 최상위 "mcpServers" 항목이 없다.'
    aliases = list(servers)
    if not aliases:
        return [], "설정 JSON에 서버가 하나도 없다 — 한 번에 한 서버만 등록한다."
    if len(aliases) > 1:
        return [], f"설정 JSON에 서버가 {len(aliases)}개다 — 한 번에 한 서버만 등록한다."
    name = aliases[0]
    config = servers[name] if isinstance(servers[name], dict) else {}
    command = config.get("command") if isinstance(config.get("command"), str) else ""
    raw_args = config.get("args")
    args = (
        [value for value in raw_args if isinstance(value, str)]
        if isinstance(raw_args, list)
        else []
    )
    return [derive_alias(name, command, args)], None


def _gate_action(
    action: str,
    raw: dict[str, Any],
    known_aliases: set[str],
    planned_additions: set[str],
) -> tuple[dict[str, Any] | None, str | None]:
    """액션 하나를 검사해 봉투 원소로 정규화한다. 거부되면 `(None, 사유)`."""
    if action == "stage_snippet":
        if raw.get("target") not in (None, ""):
            return None, (
                "직접 등록 제안에는 대상 별칭을 보내지 않는다 — 설정 JSON이 이름을 정한다."
            )
        aliases, reason = _snippet_aliases(raw.get("snippet"))
        if reason is not None:
            return None, reason
        for alias in aliases:
            if _is_blocked_alias(alias):
                return None, f"{alias!r}은 아테나 내장 기능이라 플러그인으로 등록할 수 없다."
            alias_key = alias.casefold()
            existing = next(
                (candidate for candidate in known_aliases if candidate.casefold() == alias_key),
                None,
            )
            if existing is not None:
                return None, (
                    f"{existing!r}은 이미 등록된 플러그인이다. 기존 연결 설정과 권한을 "
                    "확인하라. 교체가 필요할 때만 기존 항목을 삭제한 뒤 다시 등록하라."
                )
            if alias_key in planned_additions:
                return None, (
                    f"{alias!r} 직접 등록이 같은 제안에 중복돼 있다. "
                    "하나만 남겨 다시 제안하라."
                )
            planned_additions.add(alias_key)
        # 봉투의 target은 항상 null이다 — 카드 제목은 `직접 등록`으로 뜬다.
        return {"action": action, "target": None, "snippet": raw.get("snippet")}, None

    target = raw.get("target")
    if not isinstance(target, str) or not target.strip():
        return None, f"{action} 제안에 대상 별칭(target)이 없다."
    if _is_blocked_alias(target):
        return None, (
            f"{target!r}은 아테나 내장 기능이라 플러그인으로 다룰 수 없다 — "
            "설치·삭제·권한 변경의 대상이 아니다."
        )
    if action == "install":
        if target not in _CATALOG_IDS:
            return None, (
                f"{target!r}은 내장 마켓플레이스 목록에 없는 서버다 — 설치를 제안할 수 없다."
            )
        target_key = target.casefold()
        existing = next(
            (candidate for candidate in known_aliases if candidate.casefold() == target_key),
            None,
        )
        if existing is not None:
            return None, f"{existing!r}은 이미 등록된 플러그인이다. 기존 연결과 권한을 관리하라."
        if target_key in planned_additions:
            return None, (
                f"{target!r} 설치가 같은 제안에 중복돼 있다. 하나만 남겨 다시 제안하라."
            )
        planned_additions.add(target_key)
    elif target not in known_aliases:
        return None, f"{target!r}은 등록되지 않은 서버다 — {action} 제안의 대상이 아니다."

    entry: dict[str, Any] = {"action": action, "target": target}
    features = raw.get("features")
    if isinstance(features, list):
        entry["features"] = [str(f) for f in features]
    if action == "set_enabled":
        entry["enabled"] = bool(raw.get("enabled"))
    return entry, None


def dispatch(
    arguments: dict[str, Any],
    registry: ServerRegistry,
    consent_store: ConsentStore,
) -> types.CallToolResult:
    """제안 봉투를 만든다. 어떤 경로로도 쓰기를 하지 않는다."""
    actions = arguments.get("actions")
    if not isinstance(actions, list) or not actions:
        return _blocked("제안할 동작(actions)이 비어 있다 — 최소 한 개의 동작을 담아야 한다.")

    # 게이트웨이의 `ServerRegistry`는 기동 시점 캐시라 CLI가 낸 변경을 못 본다.
    # reload()는 **정확히 한 번** 부르고, 그 반환 스냅샷에서 서버 목록과
    # revision을 함께 가져온다(락을 두 번 잡지 않는다).
    snapshot = registry.reload()
    known_aliases = {str(server["alias"]) for server in snapshot.servers}

    normalized: list[dict[str, Any]] = []
    planned_additions: set[str] = set()
    for raw in actions:
        if not isinstance(raw, dict):
            return _blocked("동작 하나하나는 객체여야 한다.")
        action = raw.get("action")
        if action not in _ALLOWED_ACTIONS:
            return _blocked(
                f"허용되지 않는 action: {action!r}. "
                f"{' · '.join(_ALLOWED_ACTIONS)} 여섯뿐이다 — "
                "확정은 사용자가 앱에서 직접 한다."
            )
        entry, reason = _gate_action(action, raw, known_aliases, planned_additions)
        if reason is not None or entry is None:
            return _blocked(reason or f"{action} 제안을 만들 수 없다.")
        normalized.append(entry)

    consent_records = {
        str(record["alias"]): record for record in consent_store.snapshot().records
    }
    servers: list[dict[str, Any]] = []
    for server in snapshot.servers:
        alias = str(server["alias"])
        record = consent_records.get(alias, {})
        approved = bool(record.get("approved", False))
        servers.append(
            {
                "alias": alias,
                "approved": approved,
                # 앱은 승인 여부를 그대로 "켜짐"으로 읽는다(canvas.js의
                # `enabled: !!server.approved`) — 같은 규칙을 봉투에도 쓴다.
                "enabled": approved,
                "tools_allowed": list(record.get("approved_tools", [])),
            }
        )

    envelope = {
        "proposal_id": uuid.uuid4().hex,
        # 모델이 인자로 source를 보내도 무시한다 — 자기 제안을 GUI 클릭으로
        # 위장하는 경로를 막는다.
        "source": "model",
        "revision": snapshot.revision,
        "actions": normalized,
        "reason": arguments.get("reason") or "",
        "current": {"servers": servers},
    }
    return _success(envelope)
