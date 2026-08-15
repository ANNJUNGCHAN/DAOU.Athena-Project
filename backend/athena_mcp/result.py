"""`CallToolResult` 파싱 — W0 S2 실측으로 확정된 4단계 우선순위.

```
1. isError == True      -> content[0].text 는 사람이 읽는 에러. 캔버스로 보내지 말 것
2. structuredContent    -> 있으면 신뢰            (소수 서버만)
3. content[0].text      -> json.loads() 시도      (대부분이 이 경로)
4. 파싱 실패            -> 순수 텍스트 (리더 캔버스 원문 후보)
```

**3번이 주경로다.** 실측 캡처 기준 서버 3개 중 2개(`jjlabsio` 8툴 전부,
`naver-search-mcp` 전부)가 `structuredContent`를 항상 `null`로 준다
(`plan/mcp-실행계획.md` §9-①). `structuredContent` 우선 규칙 자체는 유지하되
"예외지 규칙이 아니다"라는 전제로 짠다.

`content` 배열에는 `text` 외 `image`/`resource_link`/`audio`/`resource` 블록이
올 수 있다(미검증이지만 스펙상 가능). 최소한 타입 분기는 두고, structuredContent도
없고 text 블록도 없으면 **조용히 무시하지 않고 명시적으로 에러를 낸다**
(`UnsupportedContentBlockError`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

ParsedStatus = Literal["error", "structured", "json", "text", "empty"]


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


def _to_dict(result: Any) -> dict[str, Any]:
    """`CallToolResult`(pydantic 모델) 또는 캡처된 raw dict를 동일하게 다룬다."""
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    raise TypeError(f"CallToolResult로 다룰 수 없는 타입: {type(result)!r}")


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
        return ParsedResult(status="error", data=None, raw_text=first_text, error_message=message)

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
