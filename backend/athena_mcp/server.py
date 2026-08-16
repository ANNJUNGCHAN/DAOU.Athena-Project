"""Athena를 단일 MCP 서버로 노출한다.

```
Claude Code CLI  ->  Athena Gateway  ->  등록된 MCP 서버 N개
                          |
                          +-> athena__render_canvas / athena__save_canvas
```

집계된 `별칭__툴명`(aggregator.py) + `athena__render_canvas` /
`athena__save_canvas`(canvas.py)를 하나의 `mcp.server.lowlevel.Server`로 묶는다.
승인 안 된 툴(consent.py)은 `list_tools`에서 제외되고, `call_tool`은 매 호출마다
1) 승인 여부 재확인 2) 알려진 결함 보정(quirks.py) 3) 4단계 파싱(result.py)
4) 감사 로그 기록(인자/응답 본문 제외) 순으로 처리한다.

키움 TR은 v1 범위 밖이다(결정 4) — 이 파일에서 키움을 노출하지 않는다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import mcp.types as types
from mcp.server.lowlevel import Server

from athena_mcp import quirks
from athena_mcp.aggregator import ToolAggregator, UnknownQualifiedNameError, UpdateResult
from athena_mcp.canvas import CANVAS_SCHEMAS, validate_canvas_payload
from athena_mcp.client import ServerCrashedError, UpstreamServerHandle
from athena_mcp.consent import AuditLog, ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.result import UnsupportedContentBlockError, parse_call_tool_result

RENDER_CANVAS_TOOL = "athena__render_canvas"
SAVE_CANVAS_TOOL = "athena__save_canvas"

_KNOWN_CANVAS_TYPES = [*CANVAS_SCHEMAS.keys(), "free"]

# `canvas_type`을 `enum`으로 고정하지 **않는다.** enum을 걸면 mcp SDK의 기본
# 입력 검증이 미지의 값을 게이트웨이 코드 도달 전에 거부해버려서,
# `canvas.validate_canvas_payload()`가 설계·테스트해둔 "모르는 canvas_type ->
# 자유 캔버스 폴백"(§3 계층: 자유 캔버스 <- 공통 테이블 <- 전용 캔버스)이
# 실행되지 못하는 죽은 가지가 된다. 실측으로 확인했다:
#   canvas_type='streem' -> "Input validation error: 'streem' is not one of [...]"
# 폴백은 이 계약의 핵심이므로 스키마는 문자열로 열어두고, 알려진 목록은
# description으로 모델에 알린다 — 판정은 게이트웨이가 한다.
_CANVAS_TYPE_PROPERTY: dict[str, Any] = {
    "type": "string",
    "description": (
        "알려진 값: " + ", ".join(_KNOWN_CANVAS_TYPES) + ". "
        "그 외의 값을 주면 거부하지 않고 자유 캔버스(free)로 폴백하며, "
        "폴백했다는 사실과 이유를 응답에 남긴다."
    ),
}

_RENDER_CANVAS_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["canvas_type", "data"],
    "properties": {
        "canvas_type": _CANVAS_TYPE_PROPERTY,
        "data": {"type": "object"},
        "caption": {"type": ["string", "null"]},
    },
}

_SAVE_CANVAS_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["canvas_type", "data", "name"],
    "properties": {
        "canvas_type": _CANVAS_TYPE_PROPERTY,
        "data": {"type": "object"},
        "name": {"type": "string"},
        "caption": {"type": ["string", "null"]},
    },
}


@dataclass
class AthenaGateway:
    """레지스트리 + 동의 게이트 + 집계기 + upstream 핸들을 하나로 묶는 조립부."""

    registry: ServerRegistry
    consent_store: ConsentStore
    aggregator: ToolAggregator = field(default_factory=ToolAggregator)
    handles: dict[str, UpstreamServerHandle] = field(default_factory=dict)
    audit_log_dir: Path = field(default_factory=lambda: Path.home() / ".athena" / "audit")
    canvas_save_dir: Path = field(default_factory=lambda: Path.home() / ".athena" / "canvases")

    def _audit_log(self, alias: str) -> AuditLog:
        return AuditLog(self.audit_log_dir / f"{alias}.jsonl")

    def is_tool_allowed(self, alias: str, upstream_name: str) -> bool:
        return self.consent_store.is_tool_allowed(alias, upstream_name)

    async def connect(self, alias: str, *, log_dir: Path) -> UpdateResult:
        """승인된 서버를 spawn하고 툴 목록을 집계기에 반영한다.

        승인 안 된 서버는 `client.start()`가 `ConsentNotGrantedError`를 던진다
        — 여기서 삼키지 않고 그대로 전파한다(조용히 스킵하지 않는다).

        `UpdateResult`를 **반환한다.** 예전에는 버렸는데, 그러면 64자 위반으로
        스킵된 툴(`violations`)과 갱신 실패(`committed=False`)가 아무 데도 안
        남아 조용히 사라졌다 — aggregator 독스트링이 "호출자가 UI에 보여줄 수
        있게" 기록한다고 약속한 정보다. 반환과 별개로 서버 로그에도 남긴다.
        """
        entry = self.registry.get(alias)
        handle = UpstreamServerHandle(entry, self.consent_store, log_dir)
        init_result = await handle.start()
        self.handles[alias] = handle
        self.registry.record_self_reported_info(
            alias,
            reported_name=init_result.serverInfo.name if init_result.serverInfo else None,
            reported_version=init_result.serverInfo.version if init_result.serverInfo else None,
            protocol_version=init_result.protocolVersion,
        )
        tools = await handle.list_tools()
        update = self.aggregator.update_alias_tools(alias, tools)
        if not update.committed:
            handle.log_event(f"툴 목록 갱신 실패 — 이전 캐시 유지: {update.error}")
        for v in update.violations:
            handle.log_event(
                f"툴 스킵: {v.upstream_name!r} -> {v.attempted_qualified_name!r} — {v.reason}"
            )
        return update

    async def disconnect(self, alias: str) -> None:
        handle = self.handles.pop(alias, None)
        if handle is not None:
            await handle.close()
        self.aggregator.forget_alias(alias)

    def rename_alias(self, old_alias: str, new_alias: str) -> None:
        """별칭을 바꾼다 — 레지스트리·승인기록·집계기·핸들을 **함께** 옮긴다.

        예전에는 `registry.rename()`만 있었고 `aggregator.rename_alias()`를
        아무도 부르지 않았다. 그래서 (a) 노출 툴 이름이 옛 별칭 그대로 남고,
        (b) 승인 기록이 옛 별칭에 묶여 있어 이미 승인한 서버가 조용히 미승인
        상태로 되돌아갔다. aggregator 독스트링이 내세운 "별칭이 바뀌어도
        in-flight 호출이 안 깨진다"는 보장도 이 결선이 없으면 도달 불가였다.
        네 곳을 한 함수에서 같이 옮겨 그 갈라짐을 없앤다.
        """
        self.registry.rename(old_alias, new_alias)
        self.consent_store.rename(old_alias, new_alias)
        self.aggregator.rename_alias(old_alias, new_alias)
        handle = self.handles.pop(old_alias, None)
        if handle is not None:
            self.handles[new_alias] = handle

    async def dispatch_call(
        self, qualified_or_builtin_name: str, arguments: dict[str, Any]
    ) -> types.CallToolResult:
        name = qualified_or_builtin_name
        if name == RENDER_CANVAS_TOOL:
            return _render_canvas(arguments)
        if name == SAVE_CANVAS_TOOL:
            return _save_canvas(arguments, self.canvas_save_dir)

        try:
            target = self.aggregator.resolve(name)
        except UnknownQualifiedNameError:
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=f"알 수 없는 툴: {name!r}")],
                isError=True,
            )

        if not self.is_tool_allowed(target.alias, target.upstream_name):
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"{name!r}은 승인되지 않은 툴이라 호출할 수 없다 (allowlist에 없음)",
                    )
                ],
                isError=True,
            )

        handle = self.handles.get(target.alias)
        if handle is None:
            return types.CallToolResult(
                content=[
                    types.TextContent(type="text", text=f"{target.alias!r} 서버가 연결돼 있지 않다")
                ],
                isError=True,
            )

        fixed_args = quirks.normalize_known_args(target.upstream_name, arguments)
        audit = self._audit_log(target.alias)
        try:
            raw_result = await handle.call_tool(target.upstream_name, fixed_args)
        except ServerCrashedError as exc:
            audit.record(target.alias, target.upstream_name, success=False)
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=f"upstream 호출 실패: {exc}")],
                isError=True,
            )

        try:
            parsed = parse_call_tool_result(raw_result)
        except UnsupportedContentBlockError as exc:
            audit.record(target.alias, target.upstream_name, success=False)
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=str(exc))],
                isError=True,
            )

        audit.record(target.alias, target.upstream_name, success=(parsed.status != "error"))
        # raw_result가 이미 올바른 CallToolResult 형태이므로 그대로 재노출한다
        # (파싱은 캔버스 라우팅 등 상위 호출자를 위한 부가 정보다).
        if isinstance(raw_result, types.CallToolResult):
            return raw_result
        structured = raw_result.get("structuredContent") if isinstance(raw_result, dict) else None
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=parsed.raw_text or "")],
            structuredContent=structured,
            isError=parsed.status == "error",
        )


def _render_canvas(arguments: dict[str, Any]) -> types.CallToolResult:
    canvas_type = arguments.get("canvas_type", "free")
    data = arguments.get("data", {})
    caption = arguments.get("caption")
    result = validate_canvas_payload(canvas_type, data)
    payload = {
        "canvas_type": result.canvas_type,
        "fell_back": result.fell_back,
        "fallback_reason": result.fallback_reason,
        "caption": caption,
        "data": result.data,
    }
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        structuredContent=payload,
        isError=False,
    )


def _save_canvas(arguments: dict[str, Any], save_dir: Path) -> types.CallToolResult:
    canvas_type = arguments.get("canvas_type", "free")
    data = arguments.get("data", {})
    name = arguments["name"]
    caption = arguments.get("caption")

    # 경로 조작 방어 — `name`은 LLM/upstream이 사실상 자유롭게 채울 수 있는
    # 필드다. 검증 없이 `save_dir / f"{name}.json"`에 쓰면 "../../etc/passwd"류
    # 상대경로 탈출은 물론, Windows/POSIX 공통으로 `Path.__truediv__`가 절대
    # 경로 피연산자를 만나면 좌변을 통째로 버리는 pathlib 동작 때문에
    # "C:/Windows/Temp/evil"처럼 드라이브/루트가 포함된 `name`도 save_dir
    # 바깥에 임의 파일을 쓸 수 있다(실측 확인). resolve() 후 save_dir의
    # 하위 경로인지 명시적으로 확인해 이탈을 차단한다 — 조용히 자르지 않고
    # 에러로 거부한다.
    resolved_save_dir = save_dir.resolve()
    resolved_save_dir.mkdir(parents=True, exist_ok=True)
    out_path = (save_dir / f"{name}.json").resolve()
    if not out_path.is_relative_to(resolved_save_dir):
        return types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=(
                        f"잘못된 캔버스 이름: {name!r} — 저장 디렉토리 밖으로 "
                        "벗어나는 경로는 허용하지 않는다"
                    ),
                )
            ],
            isError=True,
        )

    result = validate_canvas_payload(canvas_type, data)
    saved_at = datetime.now(UTC).isoformat()
    payload = {
        "name": name,
        "canvas_type": result.canvas_type,
        "fell_back": result.fell_back,
        "fallback_reason": result.fallback_reason,
        "caption": caption,
        "data": result.data,
        "saved_at": saved_at,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    payload_with_path = {**payload, "path": str(out_path)}
    text = json.dumps(payload_with_path, ensure_ascii=False)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        structuredContent=payload_with_path,
        isError=False,
    )


def _builtin_tool_defs() -> list[types.Tool]:
    return [
        types.Tool(
            name=RENDER_CANVAS_TOOL,
            description="4종 캔버스(stream/reader/timeline/table) 또는 free로 렌더링한다. "
            "스키마 불일치 시 free로 폴백하고 그 사실을 응답에 남긴다.",
            inputSchema=_RENDER_CANVAS_INPUT_SCHEMA,
        ),
        types.Tool(
            name=SAVE_CANVAS_TOOL,
            description="캔버스를 이름 붙여 저장한다. 저장된 캔버스는 나중에 다시 열 수 있다.",
            inputSchema=_SAVE_CANVAS_INPUT_SCHEMA,
        ),
    ]


def build_mcp_server(gateway: AthenaGateway) -> Server:
    """`AthenaGateway`를 실제 `mcp.server.lowlevel.Server`에 연결한다."""
    server: Server = Server("athena", version="0.1.0")

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        aggregated = gateway.aggregator.list_tools(allowed=gateway.is_tool_allowed)
        exposed = [
            types.Tool(name=t.qualified_name, description=t.description, inputSchema=t.input_schema)
            for t in aggregated
        ]
        return exposed + _builtin_tool_defs()

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        return await gateway.dispatch_call(name, arguments)

    return server
