"""Isolated live Kiwoom WebSocket sweep against an already-running Athena backend.

The harness never starts or stops services.  Each REG uses its own group number with
refresh=1, records the first matching REAL frame, then removes the exact group and
checks that no new matching frame arrives during the restoration window.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
import websockets

from athena_api.config import Settings

BASE = "http://127.0.0.1:8010"
WS = "ws://127.0.0.1:8010/api/v1/ws/stream"
ACCOUNT = "sangsi"
TARGETS = {
    "00": None,
    "04": None,
    "0A": "005930",
    "0B": "005930",
    "0C": "005930",
    "0D": "005930",
    "0E": "005930",
    "0F": "005930",
    "0G": "069500",
    "0H": "005930",
    "0I": "MGD",
    "0J": "001",
    "0U": "001",
    "0g": "005930",
    "0m": "57K123",
    "0s": "",
    "0u": "57K123",
    "0w": "005930",
    "1h": "005930",
}


def frame_types(frame: Any) -> list[str]:
    if not isinstance(frame, dict) or frame.get("trnm") != "REAL":
        return []
    data = frame.get("data")
    if isinstance(data, list):
        return [str(row.get("type")) for row in data if isinstance(row, dict) and row.get("type")]
    type_ = frame.get("type")
    return [str(type_)] if type_ else []


def control_body(operation: str, target: str | None, group: str, command: str) -> dict[str, Any]:
    item: dict[str, str] = {"type": operation}
    if target is not None:
        item["item"] = target
    return {"trnm": command, "grp_no": group, "refresh": "1", "data": [item]}


def write_report(result: dict[str, Any]) -> str:
    out_dir = Path(__file__).resolve().parents[2] / "artifacts" / "live-websocket-sweep"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"sweep-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(out)


async def main() -> int:
    settings = Settings()
    secret = settings.local_bearer_token
    if secret is None:
        raise RuntimeError("local bearer token is unavailable")
    token = secret.get_secret_value()
    groups = {op: str(80 + index) for index, op in enumerate(TARGETS)}
    result: dict[str, Any] = {
        "started_at": datetime.now().astimezone().isoformat(),
        "backend": BASE,
        "account": ACCOUNT,
        "operations": {
            op: {"target": target, "group": groups[op]} for op, target in TARGETS.items()
        },
        "baseline_types": {},
        "restoration_types": {},
    }
    registered: list[str] = []
    first_real: dict[str, dict[str, Any]] = {}
    baseline = Counter()
    restoration = Counter()

    async with httpx.AsyncClient(
        base_url=BASE,
        headers={"X-Athena-Account": ACCOUNT},
        timeout=10,
    ) as client:
        ready = await client.get("/ready")
        result["readiness"] = {
            "status": ready.status_code,
            "body": ready.json() if ready.content else None,
        }
        ready.raise_for_status()
        async with websockets.connect(WS, open_timeout=5, close_timeout=3) as stream:
            await stream.send(json.dumps({"type": "auth", "token": token}))

            baseline_deadline = time.monotonic() + 2
            while time.monotonic() < baseline_deadline:
                try:
                    raw = await asyncio.wait_for(stream.recv(), timeout=0.25)
                except TimeoutError:
                    continue
                for operation in frame_types(json.loads(raw)):
                    baseline[operation] += 1

            for operation, target in TARGETS.items():
                body = control_body(operation, target, groups[operation], "REG")
                response = await client.post(f"/api/v1/websocket/{operation}", json=body)
                payload = response.json() if response.content else None
                op_result = result["operations"][operation]
                op_result["reg_http"] = response.status_code
                op_result["reg_return_code"] = (
                    payload.get("return_code") if isinstance(payload, dict) else None
                )
                if response.is_success and str(op_result["reg_return_code"]) == "0":
                    registered.append(operation)
                else:
                    op_result["reg_error"] = "registration rejected"

            observe_deadline = time.monotonic() + 45
            while time.monotonic() < observe_deadline and len(first_real) < len(registered):
                try:
                    raw = await asyncio.wait_for(stream.recv(), timeout=1)
                except TimeoutError:
                    continue
                frame = json.loads(raw)
                for operation in frame_types(frame):
                    if operation in registered and operation not in first_real:
                        first_real[operation] = {
                            "at_ms": round((time.monotonic() - observe_deadline + 45) * 1000),
                            "shape": "REAL",
                        }

            for operation in reversed(registered):
                target = TARGETS[operation]
                body = control_body(operation, target, groups[operation], "REMOVE")
                response = await client.post(f"/api/v1/websocket/{operation}", json=body)
                payload = response.json() if response.content else None
                op_result = result["operations"][operation]
                op_result["remove_http"] = response.status_code
                op_result["remove_return_code"] = (
                    payload.get("return_code") if isinstance(payload, dict) else None
                )

            restoration_deadline = time.monotonic() + 3
            while time.monotonic() < restoration_deadline:
                try:
                    raw = await asyncio.wait_for(stream.recv(), timeout=0.25)
                except TimeoutError:
                    continue
                for operation in frame_types(json.loads(raw)):
                    restoration[operation] += 1

    for operation, op_result in result["operations"].items():
        op_result["first_real"] = first_real.get(operation)
        op_result["baseline_count"] = baseline[operation]
        op_result["post_remove_count"] = restoration[operation]
    result["baseline_types"] = dict(sorted(baseline.items()))
    result["restoration_types"] = dict(sorted(restoration.items()))
    result["registered"] = len(registered)
    result["first_real_count"] = len(first_real)
    result["removed_ok"] = sum(
        1 for op in registered if str(result["operations"][op].get("remove_return_code")) == "0"
    )
    result["finished_at"] = datetime.now().astimezone().isoformat()
    out = await asyncio.to_thread(write_report, result)
    print(
        json.dumps(
            {
                "artifact": out,
                "registered": len(registered),
                "first_real": len(first_real),
                "removed_ok": result["removed_ok"],
            }
        )
    )
    return 0 if len(registered) == result["removed_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
