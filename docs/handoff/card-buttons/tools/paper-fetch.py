"""Paper Desktop MCP 직결 — 텍스트 산출(tree summary · jsx)을 파일로 떨군다.

세션 컨텍스트로 11KB~57KB 원문을 나르지 않기 위한 임시 도구다(옮겨 적으면 한 글자만
틀려도 S4 트리 드리프트로 잡힌다). 절차·헤더 규약은 메모 paper-mcp-direct-http.

  python docs/handoff/card-buttons/tools/paper-fetch.py tree <nodeId> <out.txt>
  python docs/handoff/card-buttons/tools/paper-fetch.py jsx  <nodeId> <out.jsx>
"""

from __future__ import annotations

import json
import sys
import urllib.request

URL = "http://127.0.0.1:29979/mcp"
HEADERS = {
    "Content-Type": "application/json;charset=utf-8",
    "Accept": "application/json,text/event-stream",
}


def post(payload: dict, session: str | None = None) -> tuple[str, dict]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = dict(HEADERS)
    if session:
        headers["mcp-session-id"] = session
    request = urllib.request.Request(URL, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=120) as response:
        sid = response.headers.get("mcp-session-id") or session or ""
        raw = response.read().decode("utf-8")
    return sid, raw


def parse(raw: str) -> dict:
    """SSE(`data: `) 또는 평문 JSON 응답에서 첫 JSON 객체를 꺼낸다."""
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    return json.loads(raw)


def call(name: str, arguments: dict) -> dict:
    sid, raw = post(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "athena-ledger-fetch", "version": "0"},
            },
        }
    )
    post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    _, raw = post(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
        sid,
    )
    message = parse(raw)
    if "error" in message:
        raise SystemExit(f"MCP 오류 — {message['error']}")
    content = message["result"]["content"]
    text = "".join(part.get("text", "") for part in content if part.get("type") == "text")
    return json.loads(text)


def main() -> int:
    kind, node_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
    if kind == "tree":
        payload = call("get_tree_summary", {"nodeId": node_id, "depth": 10})
        text = payload["summary"]
    elif kind == "jsx":
        payload = call("get_jsx", {"nodeId": node_id, "format": "inline-styles"})
        text = payload["jsx"]
    else:
        raise SystemExit(f"알 수 없는 종류 — {kind}")
    with open(out, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    print(f"{kind} {node_id} -> {out} ({len(text)}자)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
