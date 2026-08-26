
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

import mcp.types as types

ParsedStatus = Literal["error", "structured", "json", "text", "empty"]

ErrorOrigin = Literal["gateway-blocked", "upstream-failed"]
ERROR_ORIGIN_META_KEY = "athena/error_origin"
"""`CallToolResult._meta`에 발생지점 마커를 실을 때 쓰는 키.

`athena/` 접두사는 mcp SDK 자신이 쓰는 관례를 따른다 — `_meta`는 여러
구현체가 같은 딕셔너리를 공유하는 확장 공간이라, 접두사 없는 평범한 키
("origin" 등)를 쓰면 다른 서버/클라이언트가 우연히 같은 키를 다른 뜻으로 써
충돌할 수 있다(SDK가 `io.modelcontextprotocol/related-task`를 `_meta` 키로
쓰는 것과 같은 패턴, `mcp/types.py`의 `RelatedTaskMetadata` 독스트링).
"""


def blocked(text: str) -> types.CallToolResult:
    """upstream에 보내지 않고 게이트 단계에서 거부된 에러 결과."""
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        isError=True,
        _meta={ERROR_ORIGIN_META_KEY: "gateway-blocked"},
    )


def upstream_failed(text: str) -> types.CallToolResult:
    """upstream 호출이 실패해 게이트웨이가 대신 합성한 에러 결과."""
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        isError=True,
        _meta={ERROR_ORIGIN_META_KEY: "upstream-failed"},
    )


def success(payload: Any) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        isError=False,
    )


class UnsupportedContentBlockError(Exception):
    """`structuredContent`가 없고 text 블록도 없다 — 조용히 넘기지 않는다."""

    def __init__(self, block_types: list[str]) -> None:
        self.block_types = block_types
        types_repr = ", ".join(block_types) if block_types else "(없음)"
        super().__init__(
            f"structuredContent 없음 + text 블록 없음 (실제 블록 타입: {types_repr}) — "
            "이미지/리소스 링크 등 미지원 콘텐츠 블록을 무시하지 않고 에러로 처리한다"
        )


@dataclass(frozen=True)
class ParsedResult:
    """4단계 우선순위 판정 결과."""

    status: ParsedStatus
    data: Any
    raw_text: str | None
    error_message: str | None
    error_origin: ErrorOrigin | None = None
    """`status == "error"`일 때만 값을 가질 수 있다 — 그 외 상태에선 항상
    `None`(발생지점 구분 자체가 무의미하다). `status == "error"`인데도 `None`인
    경우가 있다 — upstream이 자체적으로 낸 `isError:true` 응답(A1의 대다수,
    예: DART 키 없음)은 이 마커를 달고 오지 않는다. "구분 불가"와 "게이트웨이
    발생"을 섞지 않기 위해 마커가 없으면 그냥 `None`으로 둔다(제3의 값을
    지어내지 않는다)."""


def _to_dict(result: Any) -> dict[str, Any]:
    """`CallToolResult`(pydantic 모델) 또는 캡처된 raw dict를 동일하게 다룬다."""
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump"):
        # by_alias=True가 필수다 — `meta` 필드의 와이어 이름은 `_meta`(mcp
        # SDK가 `Result.meta = Field(alias="_meta")`로 선언). alias 없이
        # 덤프하면 raw dict 입력(이미 와이어 그대로라 항상 `_meta`)과 모델
        # 인스턴스 입력(기본 덤프는 파이썬 필드명 `meta`)이 서로 다른 키를
        # 쓰게 돼, 아래 `_error_origin()`의 판정이 입력 타입에 따라 갈라진다
        # (실측: `CallToolResult(...).model_dump(mode="json")` -> `"meta"`,
        # `by_alias=True` -> `"_meta"`).
        return result.model_dump(mode="json", by_alias=True)
    raise TypeError(f"CallToolResult로 다룰 수 없는 타입: {type(result)!r}")


def _error_origin(d: dict[str, Any]) -> ErrorOrigin | None:
    meta = d.get("_meta")
    if not isinstance(meta, dict):
        return None
    origin = meta.get(ERROR_ORIGIN_META_KEY)
    return origin if origin in ("gateway-blocked", "upstream-failed") else None


def _content_blocks(d: dict[str, Any]) -> list[dict[str, Any]]:
    content = d.get("content") or []
    blocks: list[dict[str, Any]] = []
    for block in content:
        blocks.append(block if isinstance(block, dict) else _to_dict(block))
    return blocks


def _first_text(blocks: list[dict[str, Any]]) -> str | None:
    for block in blocks:
        if block.get("type") == "text":
            return block.get("text")
    return None


def parse_call_tool_result(result: Any) -> ParsedResult:
    """`CallToolResult`(객체 또는 raw dict)를 4단계 우선순위로 판정한다."""
    d = _to_dict(result)
    blocks = _content_blocks(d)
    first_text = _first_text(blocks)

    # 1. isError
    if d.get("isError"):
        message = first_text if first_text is not None else "(에러 결과에 text 블록이 없다)"
        return ParsedResult(
            status="error",
            data=None,
            raw_text=first_text,
            error_message=message,
            error_origin=_error_origin(d),
        )

    # 2. structuredContent
    structured = d.get("structuredContent")
    if structured is not None:
        return ParsedResult(
            status="structured", data=structured, raw_text=first_text, error_message=None
        )

    # text 블록이 없는데 다른 블록은 있다 -> 미지원 블록, 조용히 넘기지 않는다
    if blocks and first_text is None:
        block_types = sorted({b.get("type", "unknown") for b in blocks})
        raise UnsupportedContentBlockError(block_types)

    if not blocks:
        return ParsedResult(status="empty", data=None, raw_text=None, error_message=None)

    # 3. content[0].text -> json.loads() 시도
    try:
        parsed = json.loads(first_text)
    except (json.JSONDecodeError, TypeError):
        # 4. 파싱 실패 -> 순수 텍스트
        return ParsedResult(status="text", data=first_text, raw_text=first_text, error_message=None)

    return ParsedResult(status="json", data=parsed, raw_text=first_text, error_message=None)
