"""루틴 lifespan 결선(US-006) — 기본 비활성·강등·대칭 해체."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from athena_api.config import Settings
from athena_api.routines.models import Condition, RoutineSpec
from athena_api.routines.runtime import open_routines, teardown_routines
from athena_api.routines.store import RoutineStore


def _settings(tmp_path, **over):
    return Settings(
        _env_file=None,
        routines_enabled=True,
        routines_store_path=tmp_path / "routines.json",
        routines_ledger_path=tmp_path / "ledger.jsonl",
        routines_read_marks_path=tmp_path / "read_marks.json",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        routines_briefings_path=tmp_path / "briefings.jsonl",
        routines_ledger_archive_dir=tmp_path / "archive",
        **over,
    )


def test_routines_disabled_by_default():
    assert Settings(_env_file=None).routines_enabled is False


@pytest.mark.asyncio
async def test_open_without_external_provider_configuration_is_ready(tmp_path):
    runtime = await open_routines(_settings(tmp_path), ws_client=None)
    try:
        assert runtime.ready is True
        assert runtime.last_error is None
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
    finally:
        await teardown_routines(runtime)


@pytest.mark.asyncio
async def test_open_migrates_all_nonterminal_legacy_external_sources_once(tmp_path):
    settings = _settings(tmp_path)
    original_statuses = ("draft", "active", "paused", "cancelled", "expired", "failed")
    legacy_specs = [
        RoutineSpec(
            condition=Condition(
                source="disclosure.title_keyword", op="contains", value="유상증자"
            ),
            symbol="207940",
            cooldown_s=3600,
            expires_at=datetime.now(UTC) + timedelta(days=7),
            note=f"저장된 레거시 루틴({status})",
            status=status,
            approved_at=(datetime.now(UTC) if status != "draft" else None),
        )
        for status in original_statuses
    ]
    settings.routines_store_path.write_text(
        json.dumps(
            {"routines": [spec.to_dict() for spec in legacy_specs]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    runtime = await open_routines(settings, ws_client=None)
    try:
        statuses = {
            spec.id: runtime.store.get(spec.id).status for spec in legacy_specs
        }
        assert [statuses[spec.id] for spec in legacy_specs] == [
            "failed",
            "failed",
            "failed",
            "cancelled",
            "expired",
            "failed",
        ]
        for spec in legacy_specs:
            restored = runtime.store.get(spec.id)
            assert restored is not None
            assert restored.mode == "periodic"
            assert "앱 플러그인 전용" in restored.human_summary()
            assert "앱 플러그인 전용" in (runtime.can_activate(restored) or "")

        events = [runtime.events.get_nowait() for _ in range(3)]
        assert [event["type"] for event in events] == [
            "routine-source-disabled",
            "routine-source-disabled",
            "routine-source-disabled",
        ]
        assert [event["routine_id"] for event in events] == [
            spec.id for spec in legacy_specs[:3]
        ]
        assert all(
            event["note"]
            == (
                "외부 사업자 데이터 source의 백엔드 실행 경로가 제거되어 "
                "이 루틴을 failed로 전환했다."
            )
            for event in events
        )
        assert all(
            word not in event["note"]
            for event in events
            for word in ("시작", "감시", "중지")
        )
        assert runtime.events.empty()
    finally:
        await teardown_routines(runtime)

    reloaded = RoutineStore(settings.routines_store_path)
    report = reloaded.load()
    assert report.restored == len(legacy_specs)
    assert [reloaded.get(spec.id).status for spec in legacy_specs] == [
        "failed",
        "failed",
        "failed",
        "cancelled",
        "expired",
        "failed",
    ]


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


@pytest.mark.asyncio
async def test_open_routines_rolls_over_ledger_once_at_startup(tmp_path):
    """R3 — 기동 시 90일 지난 ledger 행이 즉시 아카이브로 옮겨진다(open_routines
    1회 롤오버). scheduler에도 일일 재롤오버 콜백이 결선돼 있어야 한다."""
    old_row = {
        "ts": (datetime.now(UTC) - timedelta(days=95)).isoformat(),
        "routine_id": "r1",
        "symbol": "005930",
        "source": "price.current",
        "verdict": "fired",
        "observed": 1.0,
        "threshold": 1.0,
        "reason": "테스트",
        "duration_ms": None,
    }
    settings = _settings(tmp_path)
    settings.routines_ledger_path.parent.mkdir(parents=True, exist_ok=True)
    settings.routines_ledger_path.write_text(
        json.dumps(old_row, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    runtime = await open_routines(settings, ws_client=None)
    try:
        assert runtime.ledger.read_all() == []  # 유일한 행이 아카이브로 이동
        archived = list(settings.routines_ledger_archive_dir.glob("ledger-*.jsonl"))
        assert len(archived) == 1
        assert runtime.scheduler.run_archive_once is not None  # 일일 재롤오버 결선
    finally:
        await teardown_routines(runtime)
