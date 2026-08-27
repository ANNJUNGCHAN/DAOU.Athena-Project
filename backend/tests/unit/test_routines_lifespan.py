"""루틴 lifespan 결선(US-006) — 기본 비활성·강등·대칭 해체."""

from __future__ import annotations

import pytest

from athena_api.config import Settings
from athena_api.routines.runtime import open_routines, teardown_routines


def _settings(tmp_path, **over):
    return Settings(
        _env_file=None,
        routines_enabled=True,
        routines_store_path=tmp_path / "routines.json",
        routines_ledger_path=tmp_path / "ledger.jsonl",
        routines_read_marks_path=tmp_path / "read_marks.json",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        **over,
    )


def test_routines_disabled_by_default():
    assert Settings(_env_file=None).routines_enabled is False


@pytest.mark.asyncio
async def test_open_without_key_degrades_but_ready(tmp_path):
    runtime = await open_routines(_settings(tmp_path), ws_client=None)
    try:
        assert runtime.ready is True
        assert runtime.disclosure_ready is False
        assert "DART" in (runtime.last_error or "")
        # 정직 게이트 — 평가 경로가 없는 활성화는 사유와 함께 거부된다.
        from athena_api.routines.rules import validate_draft

        rt = validate_draft(
            {
                "symbol": "005930",
                "condition": {"source": "price.current", "op": "<", "value": 1000.0},
                "cooldown_s": 60,
                "expires_days": 1,
            }
        )
        assert runtime.can_activate(rt) is not None  # WS 미가용
        periodic = validate_draft(
            {
                "symbol": "207940",
                "condition": {
                    "source": "disclosure.title_keyword",
                    "op": "contains",
                    "value": "유상증자",
                },
                "cooldown_s": 60,
                "expires_days": 1,
            }
        )
        assert "공시 폴러" in (runtime.can_activate(periodic) or "")
    finally:
        await teardown_routines(runtime)


@pytest.mark.asyncio
async def test_corrupt_store_emits_forced_notification(tmp_path):
    (tmp_path / "routines.json").write_text("{broken", encoding="utf-8")
    runtime = await open_routines(_settings(tmp_path), ws_client=None)
    try:
        assert "복원 실패" in (runtime.last_error or "")
        event = runtime.events.get_nowait()
        assert event["type"] == "routine-restore-failed"
    finally:
        await teardown_routines(runtime)
