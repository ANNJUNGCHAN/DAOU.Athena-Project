"""
S2 단계 1 — 프로토콜 왕복 (키 불필요)
@modelcontextprotocol/server-everything 를 npx stdio로 띄우고
initialize -> list_tools -> call_tool 왕복을 캡처한다.
"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[1] / "captures"
CAPTURES.mkdir(parents=True, exist_ok=True)


def to_jsonable(obj):
    """pydantic 모델이든 뭐든 JSON 직렬화 가능한 dict로 변환"""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj


async def main():
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything", "stdio"],
        env=None,
    )

    print("[1] spawning npx @modelcontextprotocol/server-everything (stdio)...", file=sys.stderr)

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            print("[2] initialize()...", file=sys.stderr)
            init_result = await session.initialize()
            print("protocolVersion reported by server:", init_result.protocolVersion, file=sys.stderr)
            print("serverInfo:", init_result.serverInfo, file=sys.stderr)
            print("capabilities:", init_result.capabilities, file=sys.stderr)

            init_capture = {
                "protocolVersion": init_result.protocolVersion,
                "serverInfo": to_jsonable(init_result.serverInfo),
                "capabilities": to_jsonable(init_result.capabilities),
                "instructions": init_result.instructions,
            }
            (CAPTURES / "S2-everything-initialize.json").write_text(
                json.dumps(init_capture, indent=2, ensure_ascii=False), encoding="utf-8"
            )

            print("[3] list_tools()...", file=sys.stderr)
            tools_result = await session.list_tools()
            tools_capture = to_jsonable(tools_result)
            (CAPTURES / "S2-everything-tools.json").write_text(
                json.dumps(tools_capture, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"tools found: {[t.name for t in tools_result.tools]}", file=sys.stderr)

            # 'echo' 툴 호출 (server-everything 의 기본 데모 툴)
            target_tool = None
            for t in tools_result.tools:
                if t.name == "echo":
                    target_tool = t
                    break
            if target_tool is None:
                target_tool = tools_result.tools[0]

            print(f"[4] call_tool({target_tool.name!r}) ...", file=sys.stderr)
            # echo 툴은 {"message": "..."} 인자를 받는다 (server-everything 소스 기준)
            args = {}
            props = (target_tool.inputSchema or {}).get("properties", {})
            if "message" in props:
                args = {"message": "hello from Athena spike S2"}
            elif len(props) == 0:
                args = {}
            else:
                # 스키마에서 첫 필드에 더미 값 채우기 시도
                for k, v in props.items():
                    t = v.get("type")
                    if t == "string":
                        args[k] = "athena-spike"
                    elif t == "number" or t == "integer":
                        args[k] = 1
                    elif t == "boolean":
                        args[k] = True

            print("call args:", args, file=sys.stderr)
            call_result = await session.call_tool(target_tool.name, args)
            call_capture = to_jsonable(call_result)
            (CAPTURES / "S2-everything-calltoolresult.json").write_text(
                json.dumps(call_capture, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print("CallToolResult:", json.dumps(call_capture, indent=2, ensure_ascii=False), file=sys.stderr)
            print("isError:", call_result.isError, file=sys.stderr)
            print("structuredContent present:", call_result.structuredContent is not None, file=sys.stderr)

            print("[DONE] step1 ok", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
