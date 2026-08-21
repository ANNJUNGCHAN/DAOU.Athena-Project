from __future__ import annotations

import asyncio
import importlib
import json
import sys
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
SCRIPTS = BACKEND / "scripts"
sys.path.insert(0, str(SCRIPTS))

server = importlib.import_module("serve_kiwoom_rest_canvas_benchmark")


def test_response_body_catalog_covers_every_base_manifest_operation() -> None:
    bodies = server.build_response_bodies()
    manifest = json.loads(server.MANIFEST_PATH.read_text(encoding="utf-8"))
    expected_tr_ids = {mapping["operation"]["tr_id"] for mapping in manifest["mappings"]}

    assert set(bodies) == expected_tr_ids
    assert "ka10001" in bodies
    assert "ka10081" in bodies


def test_response_body_contains_chart_values_for_daily_chart() -> None:
    body = server.build_response_bodies()["ka10081"]

    rows = next(value for value in body.values() if isinstance(value, list))
    assert rows
    assert any(value == "20260821" for value in rows[0].values())
    assert any(value == "70000" for value in rows[0].values())


def test_response_body_contains_full_timestamp_for_intraday_chart() -> None:
    body = server.build_response_bodies()["ka10080"]

    rows = next(value for value in body.values() if isinstance(value, list))
    assert rows[0]["cntr_tm"] == "20260821101500"


def test_response_body_contains_numeric_close_for_gold_today_chart() -> None:
    bodies = server.build_response_bodies()

    for tr_id in ("ka50091", "ka50092"):
        rows = next(value for value in bodies[tr_id].values() if isinstance(value, list))
        assert rows[0]["cntr_pric"] == "70500"


def test_2300ms_upstream_profile_yields_without_blocking_event_loop() -> None:
    async def exercise() -> tuple[float, int]:
        client = server.DeterministicBenchmarkClient()
        latency_token = server.PROFILE_LATENCY_MS.set(2300)
        result_token = server.PROFILE_RESULT.set("success")
        heartbeats = 0

        async def heartbeat() -> None:
            nonlocal heartbeats
            while heartbeats < 20:
                await asyncio.sleep(0.05)
                heartbeats += 1

        started = time.perf_counter()
        try:
            await asyncio.gather(
                client.post_with_headers("ka10081", "", {}, None),
                heartbeat(),
            )
        finally:
            server.PROFILE_LATENCY_MS.reset(latency_token)
            server.PROFILE_RESULT.reset(result_token)
        return time.perf_counter() - started, heartbeats

    elapsed, heartbeats = asyncio.run(exercise())

    assert 2.2 <= elapsed < 2.8
    assert heartbeats == 20


def test_timeout_profile_raises_deterministically_before_primary_feedback_reserve() -> None:
    async def exercise() -> float:
        client = server.DeterministicBenchmarkClient()
        latency_token = server.PROFILE_LATENCY_MS.set(3001)
        result_token = server.PROFILE_RESULT.set("timeout")
        started = time.perf_counter()
        try:
            with pytest.raises(TimeoutError, match="deterministic benchmark upstream timeout"):
                await client.post_with_headers("ka20003", "", {}, None)
        finally:
            server.PROFILE_LATENCY_MS.reset(latency_token)
            server.PROFILE_RESULT.reset(result_token)
        return time.perf_counter() - started

    elapsed = asyncio.run(exercise())

    assert 1.1 <= elapsed < 1.5
