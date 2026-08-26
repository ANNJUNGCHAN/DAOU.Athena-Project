
from __future__ import annotations

import json
import os
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import mcp.types as types

from athena_mcp.result import success as _success
from athena_mcp.result import upstream_failed as _upstream_failed

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


_TIMING_LOG_FILENAME = "kiwoom-selector-timing.jsonl"


def default_timing_log_path() -> Path:
    return Path.home() / ".athena" / "audit" / _TIMING_LOG_FILENAME


def _record_backend_timing(
    path: Path, tool: str, backend_ms: int, *, cache_hit: bool = False
) -> None:
    """백엔드 HTTP 왕복 소요 한 줄을 append한다.

    기본 계약은 `{"ts", "tool", "backend_ms"}` 세 필드뿐이다 — 인자·plan_token·
    응답 본문은 이 함수 시그니처에 애초에 들어오지 않는다. 쓰기 실패(디스크
    가득 참 등)는 조용히 무시한다: `consent.py`의 감사 로그와 같은 원칙으로,
    계측이 실제 툴 호출(4단계 흐름)을 깨면 안 된다.

    `cache_hit=True`(W4 게이트웨이 캐시, `SelectorCache` 참고)일 때만 네 번째
    필드 `cache_hit`를 덧붙인다 — 기존 3필드 계약을 깨지 않으면서(필드
    추가는 허용) 캐시 히트로 인해 `backend_ms`가 실제 왕복이 아니라 `0`
    고정값임을 로그만 보고도 구분할 수 있게 한다."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        entry: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "tool": tool,
            "backend_ms": backend_ms,
        }
        if cache_hit:
            entry["cache_hit"] = True
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        return


# ---------------------------------------------------------------------------
# W4 게이트웨이 결정적 캐시(.omc/plans/plan-latency-optimization.md) —
# search/describe 전용 warm-path 캐시.
#
# **warm-path 전용이다** — 첫 질의(콜드 경로)에는 이 캐시가 있어도 전혀
# 빨라지지 않는다. 같은 프로세스가 같은 질의를 반복할 때만 백엔드 왕복을
# 건너뛴다. E2E 1회 측정(질의당 한 번씩만 부르는 경로)에는 거의 안 잡히는
# 최적화라 과대 주장하지 않는다 — 효과는 지연이 아니라 반복 질의의 안정성이다.
_CACHEABLE_TOOLS: frozenset[str] = frozenset({SEARCH_TOOL, DESCRIBE_TOOL})
_CACHE_TTL_SECONDS = 300.0  # 5분
_CACHE_MAX_ENTRIES = 256


class SelectorCache:
    """`athena_search`/`athena_describe` 응답 전용 프로세스 내 캐시.

    `athena_resolve`/`athena_call`은 이 클래스의 `get()`/`put()`이 코드
    구조상 절대 건드리지 않는다 — 두 메서드 모두 첫 줄에서
    `tool not in _CACHEABLE_TOOLS`면 즉시 반환하는 명시적 화이트리스트
    게이트를 갖는다(문자열 비교 하나로 끝나는 확인이라 우회할 틈이 없다).
    resolve가 발급하는 plan_token은 1회용이라 캐시하면 재사용을 만들고,
    call은 시세·주문처럼 신선도가 생명이라 캐시가 곧 결함이다.

    캐시 키는 (툴, catalog_version, 정규화된 인자) 세 부분이다. 인자는
    `json.dumps(..., sort_keys=True)`로 정규화해 키 순서가 달라도 같은 논리
    인자면 같은 키를 만든다. catalog_version은 첫 성공 응답을 받기 전에는
    아직 모르므로, 그때까지는 프로세스(정확히는 이 캐시 인스턴스) 생성
    시각 기반 세대 토큰으로 대신한다 — 백엔드가 catalog_version 필드를 준
    첫 순간부터는 그 값으로 갈아탄다. 카탈로그는 생성물
    (`athena_api/generated/`)이라 프로세스 생애 동안 사실상 불변이므로,
    이 세대 토큰이 사실상 실질 상한 노릇을 하는 건 TTL이다(과도한 고정
    금지 원칙에 따라 정직하게 명시).
    """

    def __init__(
        self,
        *,
        ttl_seconds: float = _CACHE_TTL_SECONDS,
        max_entries: int = _CACHE_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._clock = clock
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._generation_token = f"gen-{clock()}"
        self._catalog_version: str | None = None

    def _key(self, tool: str, arguments: dict[str, Any]) -> str:
        version = self._catalog_version or self._generation_token
        normalized = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
        return f"{tool}\x1f{version}\x1f{normalized}"

    def get(self, tool: str, arguments: dict[str, Any]) -> Any | None:
        """캐시 히트면 저장된 응답 payload를, 미스(또는 캐시 대상 아님)면
        `None`을 반환한다. 만료된 항목은 조회 시점에 지워 상한 계산에서
        빠지게 한다."""
        if tool not in _CACHEABLE_TOOLS:
            return None
        key = self._key(tool, arguments)
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, payload = entry
        if self._clock() >= expires_at:
            del self._store[key]
            return None
        self._store.move_to_end(key)  # LRU: 최근 사용으로 갱신
        return payload

    def put(self, tool: str, arguments: dict[str, Any], payload: Any) -> None:
        """성공 응답만 이 메서드로 들어온다(호출부 `dispatch()`가 보장) —
        에러 응답을 캐시하면 백엔드 복구 후에도 실패가 반복된다."""
        if tool not in _CACHEABLE_TOOLS:
            return
        if isinstance(payload, dict) and isinstance(payload.get("catalog_version"), str):
            self._catalog_version = payload["catalog_version"]
        key = self._key(tool, arguments)
        self._store[key] = (self._clock() + self._ttl_seconds, payload)
        self._store.move_to_end(key)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)  # 가장 오래전에 쓰인 항목부터 축출


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
                "한 번 더 랭킹하며 question의 exact ref/TR ID도 이 intent 표면을 "
                "벗어나면 fail-closed한다."
            ),
        },
        "candidate_refs": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 8,
            "description": (
                "검증되는 soft hint다. 누락·순서·중복은 canonical 선택을 바꾸지 않으며, "
                "unknown/hidden/wrong-intent ref는 fail-closed한다."
            ),
        },
        "preferred_ref": {
            "type": ["string", "null"],
            "description": (
                "canonical family assertion이다. override가 아니며 detail ref는 그 "
                "group을 암시하고 명시 detail_group과 충돌하면 실패한다."
            ),
        },
        "detail_group": {
            "type": ["string", "null"],
            "maxLength": 64,
            "description": (
                "athena_describe 또는 search의 suggested_detail_group에 나온 canonical "
                "group만 허용한다. resolve는 canonical family를 다시 검증하며, 생략 시 "
                "typed 호환성과 권위 있는 canonical 근거가 유일하게 지지하는 "
                "family-local detail만 자동 선택할 수 있다."
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
    "athena_call. search의 top hit에 suggested_detail_group/operation_ref가 있으면 "
    "resolve가 같은 full intent surface에서 재검증한다. candidate_refs는 soft hint, "
    "preferred_ref는 canonical family assertion이다. athena_resolve가 "
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
        f"3/4단계 — 오퍼레이션을 선택하고 인자를 검증해 서명된 실행 계획을 발급한다. {_FLOW_NOTE}"
    ),
    CALL_TOOL: (
        "4/4단계 — 서명된 계획을 실행한다. 웹소켓 계획은 등록 프레임 하나를 보내고 "
        "그 확인 응답만 돌려준다 — 구독 이벤트는 이 응답에 없고 별도 WS 스트림으로 "
        f"온다. {_FLOW_NOTE} 같은 토큰을 재사용하면 서버가 PLAN_ALREADY_USED로 거부한다. "
        "대형 응답(차트 이력 등)은 게이트웨이가 가장 큰 배열의 앞쪽(최신)만 남기고 "
        "_athena_trimmed 마커를 붙인다 — 남은 행으로 즉시 진행하고 다른 주기 "
        "오퍼레이션을 다시 찾지 마라."
    ),
}


# ---------- athena_call 대형 응답 트리밍 (2026-08-19 실사용 결함) ----------
# "삼성전자 차트" 질의에서 ka10081(일봉)이 600행·134,080자를 반환해 claude CLI의
# 툴 결과 한도를 넘었고, 모델이 일→주→월→연봉 4TR을 헛돌며 166초를 태웠다
# (감사 로그 13:05~13:08 실측). REST 응답 자체는 불변이고 **LLM 표면에서만**
# 다듬는다 — 카드 렌더에는 최근 수백 행이면 충분하다. 배열 앞쪽을 남기는 이유:
# 키움 차트류는 최신이 앞이다(ka10081 실측: first=20260819, last=20240229),
# 랭킹류도 앞쪽이 상위다. 잘림은 payload에 _athena_trimmed로 정직하게 밝힌다.
_CALL_TRIM_TARGET_CHARS = 40_000


def _trim_call_payload(payload: Any) -> Any:
    """직렬화가 한도를 넘으면 가장 큰 리스트를 앞에서부터 예산만큼 남긴다.

    구조를 모르는 payload에도 안전하다: dict 트리에서 가장 큰 리스트 하나만
    다듬고, 리스트가 없거나 한도 이하면 원본 그대로 돌려준다(결정적 — 무작위성
    없음). 트리밍 시 최상위에 `_athena_trimmed` 마커를 추가한다.
    """
    serialized = json.dumps(payload, ensure_ascii=False)
    if len(serialized) <= _CALL_TRIM_TARGET_CHARS or not isinstance(payload, dict):
        return payload

    best_path: list[str] | None = None
    best_len = 0

    def walk(node: Any, path: list[str]) -> None:
        nonlocal best_path, best_len
        if isinstance(node, dict):
            for key, value in node.items():
                walk(value, [*path, key])
        elif isinstance(node, list) and len(node) > best_len:
            best_path = path
            best_len = len(node)

    walk(payload, [])
    if not best_path or best_len < 2:
        return payload

    parent: Any = payload
    for key in best_path[:-1]:
        parent = parent[key]
    array = parent[best_path[-1]]

    array_chars = len(json.dumps(array, ensure_ascii=False))
    budget = _CALL_TRIM_TARGET_CHARS - (len(serialized) - array_chars)
    kept = 0
    acc = 2  # "[]"
    for item in array:
        item_chars = len(json.dumps(item, ensure_ascii=False)) + 1
        if kept > 0 and acc + item_chars > budget:
            break
        acc += item_chars
        kept += 1
    kept = max(kept, 1)
    if kept >= len(array):
        return payload

    parent[best_path[-1]] = array[:kept]
    payload["_athena_trimmed"] = {
        "path": ".".join(best_path),
        "kept_rows": kept,
        "total_rows": best_len,
        "note": (
            "LLM 표면 한도로 배열 앞쪽만 남겼다(차트류는 최신이 앞 — 실측). "
            "남은 행으로 즉시 진행하고, 답변에 '최근 "
            f"{kept}행 기준'임을 밝혀라."
        ),
    }
    return payload


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


def _extract_error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:500]
    if isinstance(body, dict):
        code = body.get("code")
        detail = body.get("detail")
        if detail is not None:
            rendered = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
            return f"{code}: {rendered}" if isinstance(code, str) else rendered
        return json.dumps(body, ensure_ascii=False)
    return json.dumps(body, ensure_ascii=False)


async def dispatch(
    name: str,
    arguments: dict[str, Any],
    http_client: httpx.AsyncClient,
    *,
    timing_log_path: Path | None = None,
    cache: SelectorCache | None = None,
) -> types.CallToolResult:
    log_path = timing_log_path or default_timing_log_path()

    if cache is not None:
        cached_payload = cache.get(name, arguments)
        if cached_payload is not None:
            _record_backend_timing(log_path, name, 0, cache_hit=True)
            return _success(cached_payload)

    endpoint = _ENDPOINT_BY_TOOL[name]
    timeout = _TIMEOUT_SECONDS_BY_TOOL[name]
    url = f"/api/v1/llm/tools/{endpoint}"

    start = time.monotonic()
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
    finally:
        _record_backend_timing(log_path, name, int((time.monotonic() - start) * 1000))

    if response.status_code >= 400:
        detail = _extract_error_detail(response)
        return _upstream_failed(f"{name} 실패 (HTTP {response.status_code}): {detail}")

    try:
        payload = response.json()
    except ValueError:
        return _upstream_failed(f"{name} 응답이 JSON이 아니다: {response.text[:500]!r}")

    if cache is not None:
        cache.put(name, arguments, payload)  # resolve/call은 게이트로 걸러 무시된다

    if name == CALL_TOOL:
        payload = _trim_call_payload(payload)

    return _success(payload)
