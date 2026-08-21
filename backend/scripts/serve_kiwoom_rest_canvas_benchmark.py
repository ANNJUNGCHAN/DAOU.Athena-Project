"""Run the production FastAPI routes with a deterministic Kiwoom benchmark upstream.

This server is test infrastructure only.  It preserves the real selector,
signed-plan, manifest, transform, and HTTP route stack.  Per-call latency and
result profiles arrive in private benchmark headers and affect only the fake
upstream dependency.
"""

from __future__ import annotations

import argparse
import asyncio
import contextvars
import json
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Request

from athena_api.config import Settings
from athena_api.dependencies import get_selector_service, require_kiwoom_client
from athena_api.errors import KiwoomApiError
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog

BACKEND = Path(__file__).resolve().parents[1]
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
PROFILE_RESULT: contextvars.ContextVar[str] = contextvars.ContextVar(
    "benchmark_result", default="success"
)
PROFILE_LATENCY_MS: contextvars.ContextVar[int] = contextvars.ContextVar(
    "benchmark_latency_ms", default=0
)


def _value_for_alias(alias: str) -> str:
    lowered = alias.lower()
    if lowered in {"dt", "date", "base_dt", "stck_bsop_date", "trde_dt"} or lowered.endswith("_dt"):
        return "20260821"
    if lowered == "cntr_tm":
        return "20260821101500"
    if "time" in lowered or lowered.endswith("_tm"):
        return "101500"
    if "open" in lowered or "open_pric" in lowered:
        return "70000"
    if "high" in lowered or "high_pric" in lowered:
        return "71000"
    if "low" in lowered or "low_pric" in lowered:
        return "69000"
    if lowered in {"cur_prc", "cntr_pric", "close", "close_pric", "now_pric"}:
        return "70500"
    if any(token in lowered for token in ("qty", "volume", "trde_qty")):
        return "123456"
    if "rate" in lowered or lowered.endswith("_rt"):
        return "1.25"
    if "name" in lowered or lowered.endswith("_nm"):
        return "BENCHMARK_NAME"
    if "code" in lowered or lowered.endswith("_cd"):
        return "005930"
    return f"BENCH_{alias.upper()}"


def build_response_bodies() -> dict[str, dict[str, Any]]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    bodies: dict[str, dict[str, Any]] = {}
    for mapping in manifest["mappings"]:
        tr_id = mapping["operation"]["tr_id"]
        response = mapping["fields"]["response"]
        data_groups = response.get("data", [])
        container_aliases = {group["container_alias"] for group in data_groups}
        body = bodies.setdefault(tr_id, {})
        for alias in response.get("top_level", []):
            if alias in container_aliases or alias in {"return_code", "return_msg", "trnm", "rtcd"}:
                continue
            body[alias] = _value_for_alias(alias)
        for group in data_groups:
            row = {alias: _value_for_alias(alias) for alias in group.get("field_aliases", [])}
            existing_rows = body.setdefault(group["container_alias"], [{}])
            if isinstance(existing_rows, list) and existing_rows:
                existing_rows[0].update(row)
    return bodies


class DeterministicBenchmarkClient:
    is_ready = True

    def __init__(self) -> None:
        self._bodies = build_response_bodies()
        self.calls = 0
        self.cancelled_calls = 0

    async def post_with_headers(self, tr_id, path, body, options):
        del path, body, options
        self.calls += 1
        latency_ms = PROFILE_LATENCY_MS.get()
        result = PROFILE_RESULT.get()
        try:
            if latency_ms:
                sleep_ms = min(latency_ms, 1200) if result == "timeout" else latency_ms
                await asyncio.sleep(sleep_ms / 1000)
        except asyncio.CancelledError:
            self.cancelled_calls += 1
            raise
        if result == "timeout":
            raise TimeoutError("deterministic benchmark upstream timeout")
        if result == "empty":
            payload: dict[str, Any] = {}
        elif result.startswith("http_"):
            status = int(result.split("_", 1)[1])
            raise KiwoomApiError(
                code=f"BENCH_{status}",
                message="deterministic benchmark failure",
                http_status=status,
            )
        else:
            payload = self._bodies.get(tr_id, {"benchmark_value": "BENCHMARK_VALUE"})
        return ResponseEnvelope(body=payload, cont_yn="N", next_key=None)


def build_app():
    app = create_app(Settings(_env_file=None))
    client = DeterministicBenchmarkClient()
    service = SelectorService(
        build_operation_catalog(),
        PlanSigner(b"g007-exact-100-benchmark-secret", ttl_seconds=120),
    )
    app.dependency_overrides[get_selector_service] = lambda: service
    app.dependency_overrides[require_kiwoom_client] = lambda: client
    app.state.benchmark_client = client

    @app.middleware("http")
    async def benchmark_profile(request: Request, call_next):
        result = request.headers.get("x-athena-benchmark-result", "success")
        raw_latency = request.headers.get("x-athena-benchmark-latency-ms", "0")
        try:
            latency_ms = max(0, int(raw_latency))
        except ValueError:
            latency_ms = 0
        result_token = PROFILE_RESULT.set(result)
        latency_token = PROFILE_LATENCY_MS.set(latency_ms)
        try:
            return await call_next(request)
        finally:
            PROFILE_RESULT.reset(result_token)
            PROFILE_LATENCY_MS.reset(latency_token)

    return app


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
