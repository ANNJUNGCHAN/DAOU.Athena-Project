"""`athena_search`/`athena_describe`/`athena_resolve`/`athena_call` — 키움
셀렉터 4툴을 게이트웨이 빌트인으로 노출하는 HTTP 루프백 프록시.

## 왜 인프로세스 import가 아니라 HTTP 루프백인가

`SelectorService.call()`(`athena_api/selector/service.py`)은 키움 자격증명에
의존한다. `process_lock.py`의 `CredentialProcessLock`은 정확히 1개의 uvicorn
워커만 자격증명 보유 프로세스로 허용한다(CLAUDE.md §7). 이 MCP 게이트웨이가
`athena_api.selector`를 in-process import하면(그 패키지의 `__init__.py`가
`from .service import SelectorService`를 즉시 실행한다) 게이트웨이 프로세스가
자격증명에 인접한 "두 번째 프로세스"가 될 위험을 안는다 — 그래서 이 파일은
`athena_api`를 단 한 줄도 import하지 않는다. 아래 입력 스키마도
`athena_api.selector.schemas`를 재사용하지 않고 손으로 미러링한다(재사용은
결국 그 패키지를 import하게 만든다). 대신 이미 떠 있는 백엔드(정확히 1워커)에
`httpx.AsyncClient`로 `/api/v1/llm/tools/*` 루프백 호출만 한다.

## 왜 재시도가 절대 없는가

`athena_resolve`가 발급하는 `plan_token`은 1회용이다(`docs/LLM_API_SELECTION.md`
"Single-use enforcement"). 실패한 `athena_call`을 재시도하면 항상
`PLAN_ALREADY_USED`(409)로 돌아오고, 주문 계획이었다면 중복 주문 위험까지
있다(같은 문서 "MCP adapter instructions" 요구사항 6). 이 모듈은 타임아웃·
연결 실패를 포함해 어떤 실패에도 재시도하지 않고 즉시 에러를 반환한다 —
재-resolve는 호출자(LLM)의 몫이다.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
import mcp.types as types

from athena_mcp.result import ERROR_ORIGIN_META_KEY

SEARCH_TOOL = "athena_search"
DESCRIBE_TOOL = "athena_describe"
RESOLVE_TOOL = "athena_resolve"
CALL_TOOL = "athena_call"

# `athena__` 이중 프리픽스를 쓰지 않는 이유: `docs/LLM_API_SELECTION.md`
# §MCP adapter instructions가 못박은 계약 이름 그대로다 — "정확히 네 개의
# model-controlled 툴을 노출해야 한다: athena_search/describe/resolve/call".
# 이 게이트웨이 프로세스 자체가 이미 MCP 서버 이름 "athena"로 등록되므로
# (`runner.py`의 `Server("athena", ...)`), 클라이언트 CLI에는 최종적으로
# `mcp__athena__athena_search`로 보인다 — 서버 이름이 첫 프리픽스를 이미
# 채우고 있어서, 툴 이름에 또 `athena__`를 얹으면 `athena__athena_search`가
# 되어 문서 계약 이름과 달라진다(이중 프리픽스).
#
# 별칭 네임스페이스와의 충돌: `aggregator.py`는 upstream 툴을
# `별칭__툴명`(더블 언더스코어)으로 노출한다. 이 네 이름은 싱글 언더스코어라
# 그 네임스페이스와 형태적으로 겹치지 않지만, 설령 어떤 upstream이 우연히
# 똑같은 문자열을 `qualified_name`으로 만들어내더라도 `server.py`의
# `dispatch_call()`이 이 네 이름을 `aggregator.resolve()`보다 **먼저** 검사하므로
# 빌트인이 항상 이긴다 — `RENDER_CANVAS_TOOL`/`SAVE_CANVAS_TOOL`과 같은 기존
# 우선순위 패턴을 그대로 따른다.
SELECTOR_TOOL_NAMES: tuple[str, ...] = (SEARCH_TOOL, DESCRIBE_TOOL, RESOLVE_TOOL, CALL_TOOL)

_ENDPOINT_BY_TOOL: dict[str, str] = {
    SEARCH_TOOL: "search",
    DESCRIBE_TOOL: "describe",
    RESOLVE_TOOL: "resolve",
    CALL_TOOL: "call",
}

# 로컬 셀렉터 연산(search/describe/resolve)은 백엔드 프로세스 내부에서만
# 끝나므로 짧게, 실제 키움 upstream 호출을 트리거하는 call은 넉넉하게 잡는다.
# `LLM_API_SELECTION.md`의 5 tps/롤링 1초 제한과 무관한, 이 프록시만의 상한이다.
_SHORT_TIMEOUT_SECONDS = 15.0
_CALL_TIMEOUT_SECONDS = 60.0

_TIMEOUT_SECONDS_BY_TOOL: dict[str, float] = {
    SEARCH_TOOL: _SHORT_TIMEOUT_SECONDS,
    DESCRIBE_TOOL: _SHORT_TIMEOUT_SECONDS,
    RESOLVE_TOOL: _SHORT_TIMEOUT_SECONDS,
    CALL_TOOL: _CALL_TIMEOUT_SECONDS,
}

DEFAULT_BACKEND_URL = "http://127.0.0.1:8010"
_BACKEND_URL_ENV_VAR = "ATHENA_BACKEND_URL"


def backend_base_url() -> str:
    return os.environ.get(_BACKEND_URL_ENV_VAR, DEFAULT_BACKEND_URL)


def default_http_client_factory() -> httpx.AsyncClient:
    """실제 서빙에서 `AthenaGateway.selector_http_client`의 기본값을 만든다.

    테스트는 이 팩토리를 바꾸지 않는다 — 대신 `AthenaGateway(selector_http_client=...)`
    생성자에 `transport=httpx.MockTransport(handler)`를 심은 별도
    `httpx.AsyncClient`를 직접 주입해 네트워크 없이 왕복을 검증한다."""
    return httpx.AsyncClient(base_url=backend_base_url())


_DISCOVERY_INTENT_ENUM = ["auto", "query", "order", "websocket"]
_RESPONSE_MODE_ENUM = ["auto", "compact", "full"]

# 아래 네 스키마는 `athena_api/selector/schemas.py`의 SearchRequest/
# DescribeRequest/ResolveRequest/CallRequest 필드를 손으로 그대로 미러링한다
# — import하지 않는 이유는 모듈 docstring 참고. 그 파일의 필드가 바뀌면 이
# 스키마도 같이 갱신해야 한다(자동 동기화 장치는 없다).
_SEARCH_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["query"],
    "properties": {
        "query": {
            "type": "string",
            "minLength": 2,
            "maxLength": 500,
            "description": "자연어 질문(한국어/영어 모두 가능).",
        },
        "intent": {
            "type": "string",
            "enum": _DISCOVERY_INTENT_ENUM,
            "default": "auto",
            "description": (
                "auto/query는 조회 표면만 랭킹한다. 실시간 구독은 'websocket', "
                "주문은 'order'를 명시해야 그 표면이 랭킹에 들어온다 — 모호한 "
                "질문은 절대 order/websocket에 닿지 않는다."
            ),
        },
        "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
    },
}

_DESCRIBE_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["operation_ref"],
    "properties": {
        "operation_ref": {
            "type": "string",
            "description": "athena_search 결과 중 하나의 operation_ref.",
        },
        "intent": {"type": "string", "enum": _DISCOVERY_INTENT_ENUM, "default": "auto"},
    },
}

_CONTINUATION_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "cont_yn": {"type": "string", "enum": ["N", "Y"], "default": "N"},
        "next_key": {"type": ["string", "null"]},
    },
}

_RESOLVE_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["question"],
    "properties": {
        "question": {"type": "string", "minLength": 2, "maxLength": 2000},
        "intent": {
            "type": "string",
            "enum": _DISCOVERY_INTENT_ENUM,
            "default": "auto",
            "description": (
                "athena_search와 같은 게이트를 다시 적용한다 — resolve는 질문을 "
                "한 번 더 랭킹한다."
            ),
        },
        "candidate_refs": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "preferred_ref": {"type": ["string", "null"]},
        "detail_group": {
            "type": ["string", "null"],
            "maxLength": 64,
            "description": (
                "athena_describe 응답의 detail_groups에 나열된 값만 허용한다 — "
                "서버는 질문에서 이걸 추론하지 않는다. 생략하면 전체 타입 기본 "
                "응답을 받는다."
            ),
        },
        "arguments": {"type": "object", "description": "선택된 오퍼레이션의 요청 인자."},
        "response_mode": {"type": "string", "enum": _RESPONSE_MODE_ENUM, "default": "auto"},
        "continuation": _CONTINUATION_INPUT_SCHEMA,
    },
}

_CALL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["plan_token"],
    "properties": {
        "plan_token": {
            "type": "string",
            "minLength": 1,
            "description": (
                "athena_resolve가 발급한 1회용 서명 계획. 이 호출로 소비된다 — "
                "실패해도(타임아웃 포함) 같은 토큰을 재시도하지 말고 "
                "athena_resolve를 다시 불러 새 토큰을 받는다."
            ),
        },
    },
}

_INPUT_SCHEMA_BY_TOOL: dict[str, dict[str, Any]] = {
    SEARCH_TOOL: _SEARCH_INPUT_SCHEMA,
    DESCRIBE_TOOL: _DESCRIBE_INPUT_SCHEMA,
    RESOLVE_TOOL: _RESOLVE_INPUT_SCHEMA,
    CALL_TOOL: _CALL_INPUT_SCHEMA,
}

_FLOW_NOTE = (
    "4단계 흐름의 일부다: athena_search -> athena_describe -> athena_resolve -> "
    "athena_call. detail_group은 athena_describe 응답의 detail_groups에 나열된 "
    "값만 쓸 수 있다(추측 금지, 생략하면 전체 타입 기본 응답). athena_resolve가 "
    "발급하는 plan_token은 1회용이다 — athena_call에 정확히 한 번만 넘기고, "
    "실패해도(타임아웃 포함) 재시도하지 말고 athena_resolve를 다시 불러 새 "
    "토큰을 받는다."
)

_DESCRIPTION_BY_TOOL: dict[str, str] = {
    SEARCH_TOOL: (
        "1/4단계 — 자연어 질문으로 국내 키움 오퍼레이션 후보를 검색한다. 조회가 "
        "기본이며, 실시간 구독은 intent='websocket', 주문은 intent='order'를 "
        f"명시해야 그 표면이 랭킹에 들어온다. {_FLOW_NOTE}"
    ),
    DESCRIBE_TOOL: (
        "2/4단계 — operation_ref 하나의 정확한 인자·응답 계약과 detail_groups를 "
        f"읽는다. {_FLOW_NOTE}"
    ),
    RESOLVE_TOOL: (
        f"3/4단계 — 오퍼레이션을 선택하고 인자를 검증해 서명된 실행 계획을 발급한다. "
        f"{_FLOW_NOTE}"
    ),
    CALL_TOOL: (
        "4/4단계 — 서명된 계획을 실행한다. 웹소켓 계획은 등록 프레임 하나를 보내고 "
        "그 확인 응답만 돌려준다 — 구독 이벤트는 이 응답에 없고 별도 WS 스트림으로 "
        f"온다. {_FLOW_NOTE} 같은 토큰을 재사용하면 서버가 PLAN_ALREADY_USED로 거부한다."
    ),
}


def builtin_tool_defs() -> list[types.Tool]:
    """`server.py`의 `_builtin_tool_defs()`가 캔버스 툴 뒤에 이어붙인다."""
    return [
        types.Tool(
            name=name,
            description=_DESCRIPTION_BY_TOOL[name],
            inputSchema=_INPUT_SCHEMA_BY_TOOL[name],
        )
        for name in SELECTOR_TOOL_NAMES
    ]


def _upstream_failed(text: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        isError=True,
        _meta={ERROR_ORIGIN_META_KEY: "upstream-failed"},
    )


def _success(payload: Any) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        isError=False,
    )


def _extract_error_detail(response: httpx.Response) -> str:
    """4xx/5xx 본문에서 사람이 읽을 만한 요약을 뽑는다.

    이건 원문 그대로 노출해도 upstream 원문 누출이 아니다 — 이 응답은
    `athena_api`(Athena 자신의 백엔드)가 낸 것이고, CLAUDE.md §6의 전제대로
    `athena_api/errors.py`가 실제 키움 upstream 원문·키를 이미 도메인 에러로
    번역해서 내보낸 뒤다. 이 함수는 그 도메인 에러 응답을 한 번 더 간결하게
    만들 뿐이다."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:500]
    if isinstance(body, dict):
        detail = body.get("detail")
        if detail is not None:
            return detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
        return json.dumps(body, ensure_ascii=False)
    return json.dumps(body, ensure_ascii=False)


async def dispatch(
    name: str, arguments: dict[str, Any], http_client: httpx.AsyncClient
) -> types.CallToolResult:
    """`server.py`의 `AthenaGateway.dispatch_call()`이 빌트인 라우팅 분기에서 부른다.

    **재시도 없음** — 연결 실패·타임아웃 어느 쪽도 재시도하지 않고 단 한 번의
    시도 뒤 즉시 에러 결과를 반환한다(모듈 docstring 참고). 연결 거부(백엔드
    미기동)는 별도의 안내 문구를 준다 — 다른 데이터 소스로 조용히 대체하지
    말라는 지시를 명시적으로 담는다.
    """
    endpoint = _ENDPOINT_BY_TOOL[name]
    timeout = _TIMEOUT_SECONDS_BY_TOOL[name]
    url = f"/api/v1/llm/tools/{endpoint}"

    try:
        response = await http_client.post(url, json=arguments, timeout=timeout)
    except httpx.ConnectError:
        return _upstream_failed(
            "키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다. 사용자에게 백엔드 "
            "실행을 안내하고, 다른 데이터 소스로 대체하지 마라."
        )
    except httpx.TimeoutException as exc:
        return _upstream_failed(
            f"{name} 호출이 {timeout:.0f}초 안에 끝나지 않았다: {exc}. 재시도하지 "
            "말고 athena_resolve부터 다시 부른다."
        )
    except httpx.HTTPError as exc:
        return _upstream_failed(f"{name} 호출 중 전송 오류: {exc}")

    if response.status_code >= 400:
        detail = _extract_error_detail(response)
        return _upstream_failed(f"{name} 실패 (HTTP {response.status_code}): {detail}")

    try:
        payload = response.json()
    except ValueError:
        return _upstream_failed(f"{name} 응답이 JSON이 아니다: {response.text[:500]!r}")

    return _success(payload)
