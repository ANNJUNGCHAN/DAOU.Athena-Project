"""`athena_backtest` — 백테스트 조회·검증·실행 빌트인 (HTTP 루프백 프록시).

routine_tools.py와 같은 이유로 `athena_api`를 import하지 않고 이미 떠 있는 백엔드에
루프백 호출만 한다. **재시도 없음** — 같은 문서의 규율 그대로.

허용 액션은 `list_presets`·`list_indicators`·`validate`·`plan`·`run`·`status`·`result`
**일곱뿐**이다(docs/architecture/backtest-mode-plan.md §9). `backfill`·`activate` 액션은
**존재하지 않는다** — 대량 백필은 키움 쿼터를 태우는 행위, 전략 버전 활성화는 모델이
바꿔놓고 사람은 옛 코드/스펙이 도는 줄 아는 경로를 여는 행위라 둘 다 사람 클릭(렌더러)
전용이다(routine_tools.py의 confirm/cancel 부재 규율과 같은 형태). 이 부재는 테스트가
고정한다.

`run`이 캐시 부족(백엔드 409)을 만나면 실행하지 않고 `blocked` 상태 페이로드
(`needed_pages`/`est_seconds`)로 번역해 돌려준다 — 캔버스가 그 숫자로 승인 카드를 띄운다.
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

BACKTEST_TOOL = "athena_backtest"

_ALLOWED_ACTIONS: tuple[str, ...] = (
    "list_presets",
    "list_indicators",
    "validate",
    "plan",
    "run",
    "status",
    "result",
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
                "list_presets/list_indicators = 카탈로그 조회(읽기 전용). "
                "validate = yaml|python 파싱·계약 검사만(실행 안 함). "
                "plan = 필요한 데이터 수집 호출 수 추정. "
                "run = 실행(캐시가 충분할 때만 즉시 실행 — 부족하면 blocked). "
                "status/result = 실행 상태·결과 조회(읽기 전용). "
                "backfill(대량 백필)·activate(전략 버전 활성화)는 이 툴에 없다 — "
                "쿼터를 태우거나 사람이 검토해야 하는 상태 변경이라 사용자가 "
                "앱에서 직접 한다."
            ),
        },
        "validate": {
            "type": "object",
            "description": "action=validate일 때의 입력.",
            "properties": {
                "kind": {"type": "string", "enum": ["yaml", "python"]},
                "source": {"type": "string"},
            },
        },
        "plan": {
            "type": "object",
            "description": "action=plan일 때의 입력 — 종목·주기·수정주가·기간.",
            "properties": {
                "stk_cd": {"type": "string", "description": "6자리 종목코드"},
                "period": {"type": "string", "enum": ["day", "week", "month"]},
                "adjusted": {"type": "boolean"},
                "from_dt": {"type": "string", "description": "YYYYMMDD"},
                "to_dt": {"type": "string", "description": "YYYYMMDD"},
            },
        },
        "run": {
            "type": "object",
            "description": (
                "action=run일 때의 입력 — `.athena.yaml` 전략 원문 + 파라미터 오버라이드."
            ),
            "properties": {
                "yaml": {"type": "string"},
                "params": {"type": "object", "description": "선택: strategy.params 오버라이드"},
            },
        },
        "run_id": {
            "type": "string",
            "description": "action=status|result일 때 조회할 실행 id.",
        },
    },
}

_DESCRIPTION = (
    "백테스트 카탈로그 조회·전략 검증·실행 계획·실행·상태 조회. run은 **캐시가 충분할 "
    "때만 즉시 실행된다** — 부족하면 실행하지 않고 blocked 상태로 필요한 수집량을 "
    "알려준다(사람이 앱에서 데이터 수집을 승인해야 한다). 대량 백필과 전략 버전 활성화는 "
    "이 툴로 할 수 없다 — 둘 다 사람 클릭 전용이다."
)


def builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=BACKTEST_TOOL,
            description=_DESCRIPTION,
            inputSchema=_INPUT_SCHEMA,
        )
    ]


def _error_text(response: httpx.Response) -> str:
    try:
        body = response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
        message = body.get("message") if isinstance(body, dict) else None
    except ValueError:
        detail, message = response.text[:300], None
    text = f"{detail or 'HTTP ' + str(response.status_code)}"
    if message:
        text += f" — {message}"
    return text


async def dispatch(
    arguments: dict[str, Any], http_client: httpx.AsyncClient
) -> types.CallToolResult:
    """재시도 없음 — 단 한 번의 루프백 시도 후 즉시 결과를 반환한다."""
    action = arguments.get("action")
    if action not in _ALLOWED_ACTIONS:
        # backfill·activate를 포함한 그 외 전부 — 사람 전용 행위임을 명시한다.
        return _blocked(
            f"허용되지 않는 action: {action!r}. list_presets/list_indicators/validate/"
            "plan/run/status/result만 가능하다 — 백필·전략 버전 활성화는 사용자가 "
            "앱에서 직접 한다."
        )

    if action in ("status", "result"):
        run_id = arguments.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            return _blocked(f"action={action!r}는 run_id(문자열)가 필요하다.")

    try:
        if action == "list_presets":
            response = await http_client.get(
                "/api/v1/backtest/presets", timeout=_TIMEOUT_SECONDS
            )
        elif action == "list_indicators":
            response = await http_client.get(
                "/api/v1/backtest/indicators", timeout=_TIMEOUT_SECONDS
            )
        elif action == "validate":
            response = await http_client.post(
                "/api/v1/backtest/validate",
                json=arguments.get("validate") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "plan":
            response = await http_client.post(
                "/api/v1/backtest/data/plan",
                json=arguments.get("plan") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        elif action == "run":
            response = await http_client.post(
                "/api/v1/backtest/runs",
                json=arguments.get("run") or {},
                timeout=_TIMEOUT_SECONDS,
            )
        else:  # status | result
            run_id = arguments["run_id"]
            response = await http_client.get(
                f"/api/v1/backtest/runs/{run_id}", timeout=_TIMEOUT_SECONDS
            )
    except httpx.ConnectError:
        return _upstream_failed(
            "키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다. 사용자에게 백엔드 "
            "실행을 안내하고, 실행이 시작됐다고 말하지 마라."
        )
    except httpx.HTTPError as exc:
        return _upstream_failed(f"athena_backtest 호출 중 전송 오류: {exc}")

    if action == "run" and response.status_code == 409:
        # 캐시 부족 — 실행하지 않았다는 사실과 필요한 수집량을 그대로 옮긴다.
        try:
            body = response.json()
        except ValueError:
            body = {}
        detail = body.get("detail") if isinstance(body, dict) else None
        detail = detail if isinstance(detail, dict) else {}
        return _success(
            {
                "status": "blocked",
                "needed_pages": detail.get("needed_pages"),
                "est_seconds": detail.get("est_seconds"),
                "message": (
                    "캔들 캐시가 부족해 실행하지 않았다 — 먼저 데이터 수집(백필)이 "
                    "필요하다. 백필은 사용자가 앱에서 직접 승인해야 한다."
                ),
            }
        )

    if response.status_code >= 400:
        return _upstream_failed(_error_text(response))

    payload = response.json()
    if action == "run":
        payload = {**payload, "status": "accepted"}
    return _success(payload)


__all__ = ["BACKTEST_TOOL", "builtin_tool_defs", "dispatch"]
