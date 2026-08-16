"""Paper Desktop MCP 브리지 — Claude Code 플러그인 로드가 실패했을 때의 우회로.

`paper-desktop` 플러그인은 `http://127.0.0.1:29979/mcp`에 붙는 HTTP MCP 서버를
등록하는데, 이 세션에서는 플러그인 로드가 실패해 툴이 노출되지 않았다. 서버
자체는 살아 있으므로(`initialize` 응답 확인, paper-desktop v0.5.4) 여기서
직접 JSON-RPC로 말한다.

Streamable HTTP + SSE 응답이라 두 가지를 처리한다:
1. `initialize` 응답의 `mcp-session-id` 헤더를 이후 모든 요청에 실어야 한다.
2. 응답 본문이 `event: message\\ndata: {...}` 형태의 SSE라 `data:` 줄만 파싱한다.

사용:
    python paper.py tools                       # 툴 목록
    python paper.py call <tool> '<json-args>'   # 툴 호출
    python paper.py call get_basic_info '{}'
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "http://127.0.0.1:29979/mcp"
PROTOCOL_VERSION = "2025-06-18"

_session_id: str | None = None


def _post(payload: dict, *, want_session: bool = False) -> dict | None:
    global _session_id
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json, text/event-stream")
    req.add_header("MCP-Protocol-Version", PROTOCOL_VERSION)
    if _session_id:
        req.add_header("Mcp-Session-Id", _session_id)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            if want_session:
                _session_id = resp.headers.get("mcp-session-id")
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"Paper MCP에 못 붙었다 ({exc}). Paper Desktop이 켜져 있고 파일이 열려 있어야 한다."
        ) from exc

    # 알림(notification)은 본문이 비어 있다.
    if not raw.strip():
        return None
    # SSE: `data:` 줄만 모은다.
    chunks = [ln[5:].strip() for ln in raw.splitlines() if ln.startswith("data:")]
    text = chunks[-1] if chunks else raw
    return json.loads(text)


def connect() -> None:
    _post(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "athena-paper-bridge", "version": "1"},
            },
        },
        want_session=True,
    )
    _post({"jsonrpc": "2.0", "method": "notifications/initialized"})


def list_tools() -> list[dict]:
    res = _post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    return res["result"]["tools"]


def call_tool(name: str, arguments: dict) -> dict:
    res = _post(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
    )
    if "error" in res:
        raise SystemExit(json.dumps(res["error"], ensure_ascii=False, indent=2))
    return res["result"]


def _print(obj: object) -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main(argv: list[str]) -> int:
    # Windows 콘솔 기본값이 cp949라 그냥 두면 첫 출력에서 UnicodeEncodeError로
    # 죽는다(실측). Paper 툴 설명에도 한글·em dash가 섞여 온다.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    if not argv:
        print(__doc__)
        return 2
    connect()
    cmd = argv[0]
    if cmd == "tools":
        for t in list_tools():
            desc = (t.get("description") or "").splitlines()
            head = desc[0] if desc else ""
            print(f"{t['name']:<32} {head[:110]}")
        return 0
    if cmd == "schema":
        for t in list_tools():
            if t["name"] == argv[1]:
                _print(t)
                return 0
        print(f"툴 없음: {argv[1]}", file=sys.stderr)
        return 1
    if cmd in ("call", "callf"):
        name = argv[1]
        if cmd == "callf":
            # 인자를 파일에서 읽는다. HTML + 한글을 셸 인용부호로 넘기면
            # 따옴표·백틱·개행이 깨진다 — 파일 경유가 유일하게 안전한 경로다.
            import pathlib

            args = json.loads(pathlib.Path(argv[2]).read_text(encoding="utf-8"))
        else:
            args = json.loads(argv[2]) if len(argv) > 2 else {}
        result = call_tool(name, args)
        # 이미지 블록은 통째로 찍으면 base64로 터진다 — 파일로 떨궈서
        # 경로만 알려준다(그 파일을 Read 툴로 열어 눈으로 본다).
        img_n = 0
        for block in result.get("content", []):
            if block.get("type") == "text":
                print(block["text"])
            elif block.get("type") == "image":
                import base64
                import pathlib

                img_n += 1
                mime = block.get("mimeType", "image/png")
                ext = {"image/png": "png", "image/jpeg": "jpg"}.get(mime, "bin")
                # 파일명을 고정하면 여러 에이전트가 같은 디렉토리에서 동시에
                # 찍을 때 서로의 이미지를 덮어쓴다 — 실제로 다른 아트보드를
                # 자기 것으로 착각하는 사고가 났다. 대상 노드 + PID로 갈라둔다.
                node = str(args.get("nodeId", "node")).replace("/", "_")
                out = pathlib.Path(f"shot-{node}-{os.getpid()}.{ext}").resolve()
                out.write_bytes(base64.b64decode(block["data"]))
                print(f"[image saved] {out}")
            else:
                print(f"[{block.get('type')} block, {len(str(block))} bytes]")
        if result.get("structuredContent"):
            _print(result["structuredContent"])
        return 0
    print(f"알 수 없는 명령: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
