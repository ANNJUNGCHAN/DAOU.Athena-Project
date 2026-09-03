"""루틴 코어(US-004) — 모델·검증·원장의 계약 테스트."""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.projects import store as projects_store
from athena_api.routines.briefings import BriefingStore
from athena_api.routines.engagement import EngagementStore
from athena_api.routines.ledger import LedgerError, RoutineLedger
from athena_api.routines.models import (
    SOURCES,
    Condition,
    RoutineSpec,
    WatchSpec,
    derive_mode,
)
from athena_api.routines.read_marks import ReadMarksStore
from athena_api.routines.rules import (
    RoutineValidationError,
    validate_condition,
    validate_draft,
)
from athena_api.routines.runtime import RoutinesRuntime
from athena_api.routines.scheduler import RoutineScheduler
from athena_api.routines.store import RoutineStore
from athena_api.routines.triggers import TriggerEngine


def _draft(**over):
    raw = {
        "symbol": "005930",
        "condition": {"source": "price.current", "op": "<", "value": 200000},
        "cooldown_s": 1800,
        "expires_days": 7,
    }
    raw.update(over)
    return raw


# ---------- 모델 · mode 유도 (§8 이분법) ----------


def test_mode_is_derived_from_source_transport():
    ws = validate_condition({"source": "price.change_rate", "op": ">=", "value": 5})
    legacy_periodic = Condition(
        source="disclosure.title_keyword", op="contains", value="유상증자"
    )
    scheduled = validate_condition(
        {"source": "schedule.daily", "op": "at", "value": "ALL@07:30"}
    )
    assert derive_mode(ws) == "realtime-ws"
    assert derive_mode(legacy_periodic) == "periodic"
    assert derive_mode(scheduled) == "scheduled"


def test_spec_roundtrip_preserves_everything():
    spec = validate_draft(_draft())
    restored = RoutineSpec.from_dict(spec.to_dict())
    assert restored.to_dict() == spec.to_dict()
    assert restored.mode == "realtime-ws"
    assert restored.status == "draft"


def test_briefing_settings_roundtrip_and_legacy_compat():
    """R1 — briefing_model/briefing_effort 왕복. 키 자체가 없는 옛 dict도
    .get() 하위호환으로 None으로 복원된다."""
    spec = validate_draft(
        _draft(briefing_model="claude-sonnet-5", briefing_effort="low")
    )
    assert spec.briefing_model == "claude-sonnet-5"
    assert spec.briefing_effort == "low"
    restored = RoutineSpec.from_dict(spec.to_dict())
    assert restored.to_dict() == spec.to_dict()

    legacy = spec.to_dict()
    del legacy["briefing_model"], legacy["briefing_effort"]
    old = RoutineSpec.from_dict(legacy)
    assert old.briefing_model is None
    assert old.briefing_effort is None


@pytest.mark.parametrize(
    "over",
    [
        {"briefing_model": "-claude"},  # 선두 하이픈 금지(model-prefs.js:21 이식)
        {"briefing_model": "bad model"},  # 공백 — 문자셋 밖
        {"briefing_model": ""},
        {"briefing_model": "a" * 65},
        {"briefing_effort": "extreme"},  # 닫힌 목록 밖
        {"briefing_effort": ""},
        {"briefing_effort": True},
    ],
)
def test_invalid_briefing_settings_are_rejected(over):
    with pytest.raises(RoutineValidationError):
        validate_draft(_draft(**over))


def test_valid_briefing_model_charset_examples():
    """model-prefs.js:17의 문자셋 — 점·대괄호·하이픈(비선두)을 허용한다."""
    for model in ("claude-sonnet-5", "claude-opus-4.1", "m[1]"):
        assert validate_draft(_draft(briefing_model=model)).briefing_model == model


def test_human_summary_states_mode_in_korean():
    spec = validate_draft(_draft())
    assert "실시간 (WS)" in spec.human_summary()
    legacy = RoutineSpec(
        condition=Condition(
            source="disclosure.title_keyword", op="contains", value="유상증자"
        ),
        symbol="005930",
        cooldown_s=1800,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        note="legacy",
    )
    assert "앱 플러그인 전용" in legacy.human_summary()
    assert RoutineSpec.from_dict(legacy.to_dict()).to_dict() == legacy.to_dict()


def test_external_provider_source_is_explicitly_rejected_for_new_draft():
    with pytest.raises(RoutineValidationError, match="앱 플러그인 전용"):
        validate_draft(
            _draft(
                condition={
                    "source": "disclosure.title_keyword",
                    "op": "contains",
                    "value": "유상증자",
                }
            )
        )


def test_experimental_source_is_flagged_in_summary():
    spec = validate_draft(
        _draft(condition={"source": "volume.prev_day_ratio", "op": ">=", "value": 4.0})
    )
    assert "실값 미확인" in spec.human_summary()


# ---------- 검증 — 화이트리스트 (프리모템 6) ----------

ADVERSARIAL_CONDITIONS = [
    # 1. 표현식 문자열을 source로
    {"source": "__import__('os').system('calc')", "op": "<", "value": 1},
    # 2. eval 흉내 연산자
    {"source": "price.current", "op": "; import os", "value": 1},
    # 3. 중첩 조건(표현식 트리 흉내)
    {"source": "price.current", "op": "<", "value": {"nested": True}},
    # 4. 리스트 값
    {"source": "price.current", "op": "<", "value": [1, 2]},
    # 5. 알 수 없는 키 주입
    {"source": "price.current", "op": "<", "value": 1, "__proto__": "x"},
    # 6. 문자열 값을 숫자 source에
    {"source": "price.current", "op": "<", "value": "200000; DROP TABLE"},
    # 7. 무한대 숫자
    {"source": "price.current", "op": "<", "value": float("inf")},
    # 8. 제어문자 키워드
    {"source": "disclosure.title_keyword", "op": "contains", "value": "유상\x00증자"},
    # 9. 과대 키워드 (65자)
    {"source": "disclosure.title_keyword", "op": "contains", "value": "가" * 65},
    # 10. periodic source에 연속 틱
    {
        "source": "disclosure.title_keyword",
        "op": "contains",
        "value": "유상증자",
        "consecutive_ticks": 3,
    },
]


@pytest.mark.parametrize("raw", ADVERSARIAL_CONDITIONS)
def test_adversarial_conditions_are_rejected(raw):
    with pytest.raises(RoutineValidationError):
        validate_condition(raw)


def test_ops_are_scoped_per_source():
    with pytest.raises(RoutineValidationError):
        validate_condition({"source": "vi.triggered", "op": "<", "value": True})
    with pytest.raises(RoutineValidationError):
        validate_condition({"source": "price.current", "op": "contains", "value": 1})


@pytest.mark.parametrize(
    "value",
    ["07:99@abc", "1,2,3,4,5", "8@07:30", "ALL@25:00", "ALL@07:5", "ALL@0730", ""],
)
def test_schedule_daily_rejects_malformed_values(value):
    with pytest.raises(RoutineValidationError):
        validate_condition({"source": "schedule.daily", "op": "at", "value": value})


def test_schedule_daily_accepts_well_formed_values():
    for value in ("ALL@07:30", "1,2,3,4,5@09:00", "7@23:59"):
        cond = validate_condition({"source": "schedule.daily", "op": "at", "value": value})
        assert cond.value == value


def test_draft_bounds_are_enforced():
    with pytest.raises(RoutineValidationError):
        validate_draft(_draft(symbol="0059301"))
    with pytest.raises(RoutineValidationError):
        validate_draft(_draft(cooldown_s=1))
    with pytest.raises(RoutineValidationError):
        validate_draft(_draft(expires_days=31))


def test_no_eval_exec_in_routines_package():
    """AST/표현식 표면 부재를 소스 레벨로 고정한다 — 회귀하면 여기서 잡힌다."""
    pkg = Path(__file__).resolve().parents[2] / "athena_api" / "routines"
    # re.compile 같은 메서드 호출은 제외 — 내장 eval/exec/compile 호출만 잡는다.
    pattern = re.compile(r"(?<![\w.])(eval|exec|compile)\s*\(")
    offenders = [
        p.name
        for p in pkg.glob("*.py")
        if pattern.search(p.read_text(encoding="utf-8"))
    ]
    assert offenders == []


# ---------- 원장 ----------


def test_ledger_requires_reason(tmp_path):
    ledger = RoutineLedger(tmp_path / "ledger.jsonl")
    with pytest.raises(LedgerError):
        ledger.record(
            "suppressed",
            routine_id="r1",
            symbol="005930",
            source="price.current",
            observed=199000,
            threshold=200000,
            reason="  ",
        )


def test_ledger_rows_contain_only_whitelisted_fields(tmp_path):
    ledger = RoutineLedger(tmp_path / "ledger.jsonl")
    ledger.record(
        "fired",
        routine_id="r1",
        symbol="005930",
        source="price.current",
        observed=199400.0,
        threshold=200000.0,
        reason="임계 도달",
        ts=datetime(2026, 8, 19, 0, 41, tzinfo=UTC),
    )
    rows = ledger.read_all()
    assert len(rows) == 1
    assert set(rows[0]) == {
        "ts",
        "routine_id",
        "symbol",
        "source",
        "verdict",
        "observed",
        "threshold",
        "reason",
        "duration_ms",
    }
    assert rows[0]["duration_ms"] is None  # 미지정 시 기본값


def test_ledger_records_duration_ms_when_given(tmp_path):
    ledger = RoutineLedger(tmp_path / "ledger.jsonl")
    ledger.record(
        "fired",
        routine_id="r1",
        symbol="207940",
        source="disclosure.title_keyword",
        observed="유상증자결정",
        threshold="유상증자",
        reason="조건 도달",
        duration_ms=812.5,
    )
    assert ledger.read_all()[0]["duration_ms"] == 812.5


def test_expiry_helper(tmp_path):
    spec = validate_draft(_draft(expires_days=1))
    assert not spec.is_expired()
    assert spec.is_expired(now=datetime.now(UTC) + timedelta(days=2))


# ---------- goal 플래그 (CP1a) ----------


def test_goal_defaults_false_and_roundtrips():
    spec = validate_draft(_draft())
    assert spec.goal is False
    restored = RoutineSpec.from_dict(spec.to_dict())
    assert restored.goal is False


def test_goal_true_is_preserved_through_roundtrip():
    spec = validate_draft(_draft(goal=True))
    assert spec.goal is True
    restored = RoutineSpec.from_dict(spec.to_dict())
    assert restored.goal is True


def test_goal_missing_in_legacy_dict_defaults_false():
    spec = validate_draft(_draft())
    raw = spec.to_dict()
    del raw["goal"]  # 구버전 저장분 흉내
    restored = RoutineSpec.from_dict(raw)
    assert restored.goal is False


def test_goal_rejects_non_bool():
    with pytest.raises(RoutineValidationError):
        validate_draft(_draft(goal="true"))


# ---------- 코드 감시 (code.watch) ----------


def _watch(**over):
    raw = {
        "project_id": "p1",
        "path": "watch/volume_spike.py",
        "version_hash": "a" * 64,
        "params": {"multiple": 3.0},
        "poll_interval_s": 60,
        "lookback_days": 30,
    }
    raw.update(over)
    return raw


def _code_draft(watch=None, **over):
    raw = _draft(
        condition={"source": "code.watch", "op": "==", "value": True},
        watch=_watch() if watch is None else watch,
    )
    raw.update(over)
    return raw


def test_code_watch_source_spec_and_mode():
    """B-1 — 카탈로그 등록값과 mode 유도."""
    spec = SOURCES["code.watch"]
    assert spec.transport == "code"
    assert spec.value_type == "bool"
    assert spec.ops == ("==",)
    assert spec.label == "코드 감시"
    cond = validate_condition({"source": "code.watch", "op": "==", "value": True})
    assert derive_mode(cond) == "code-watch"


def test_code_watch_draft_accepts_valid_watch_block():
    spec = validate_draft(_code_draft())
    assert spec.mode == "code-watch"
    assert spec.watch == WatchSpec(
        project_id="p1",
        path="watch/volume_spike.py",
        version_hash="a" * 64,
        params={"multiple": 3.0},
        poll_interval_s=60,
        lookback_days=30,
    )


@pytest.mark.parametrize(
    "over",
    [
        {"path": "watch/volume_spike.txt"},
        {"path": "strategy.py"},
        {"path": "watch/../../etc/passwd.py"},
        {"path": "/etc/watch/x.py"},
        {"path": "C:/watch/x.py"},
        {"path": "watch/"},
        {"poll_interval_s": 59},
        {"poll_interval_s": 601},
        {"lookback_days": 6},
        {"lookback_days": 91},
        {"project_id": ""},
        {"version_hash": "not-a-hash"},
        {"params": [1, 2]},
        {"params": {"nested": {"a": 1}}},
        {"last_fired_at": "어제"},
    ],
)
def test_code_watch_rejects_bad_watch_fields(over):
    """B-2 — watch 블록의 각 칸이 따로 막힌다."""
    with pytest.raises(RoutineValidationError):
        validate_draft(_code_draft(watch=_watch(**over)))


def test_code_watch_requires_watch_block_and_expiry_bound_still_applies():
    """B-2 — watch 없는 code.watch 초안은 거부, expires_days 상한은 그대로."""
    raw = _code_draft()
    del raw["watch"]
    with pytest.raises(RoutineValidationError):
        validate_draft(raw)
    with pytest.raises(RoutineValidationError):
        validate_draft(_code_draft(expires_days=31))
    assert validate_draft(_code_draft(expires_days=30)).watch is not None


def test_watch_block_is_rejected_on_non_code_sources():
    with pytest.raises(RoutineValidationError):
        validate_draft(_draft(watch=_watch()))


def test_condition_keys_stay_closed_for_code_watch():
    """B-3 — watch를 condition 안에 밀어 넣거나 모르는 키를 넣으면 거부."""
    with pytest.raises(RoutineValidationError):
        validate_condition(
            {
                "source": "code.watch",
                "op": "==",
                "value": True,
                "watch": _watch(),
            }
        )
    with pytest.raises(RoutineValidationError):
        validate_condition(
            {"source": "price.current", "op": "<", "value": 1, "code": "x"}
        )


def test_code_watch_condition_shape_is_fixed():
    with pytest.raises(RoutineValidationError):
        validate_draft(
            _code_draft(condition={"source": "code.watch", "op": "==", "value": False})
        )
    with pytest.raises(RoutineValidationError):
        validate_draft(
            _code_draft(
                condition={
                    "source": "code.watch",
                    "op": "==",
                    "value": True,
                    "consecutive_ticks": 2,
                }
            )
        )


def test_code_watch_store_roundtrip_has_no_source_text(tmp_path):
    """B-4 — 저장→로드 동일, 코드 원문은 어디에도 없다."""
    spec = validate_draft(_code_draft())
    store = RoutineStore(tmp_path / "routines.json")
    store.upsert(spec)

    text = (tmp_path / "routines.json").read_text(encoding="utf-8")
    assert "def signals" not in text
    assert "source_code" not in text and "code_text" not in text

    reloaded = RoutineStore(tmp_path / "routines.json")
    reloaded.load()
    restored = reloaded.get(spec.id)
    assert restored is not None
    assert restored.to_dict() == spec.to_dict()
    assert restored.watch == spec.watch


def test_non_code_spec_has_no_watch_key_in_dict():
    assert "watch" not in validate_draft(_draft()).to_dict()


def test_watch_last_fired_at_roundtrips(tmp_path):
    """B-20(저장 측) — 마지막 발화 시각이 저장을 건너서 살아남는다."""
    fired = "2026-09-03T01:00:00+00:00"
    spec = validate_draft(_code_draft(watch=_watch(last_fired_at=fired)))
    store = RoutineStore(tmp_path / "routines.json")
    store.upsert(spec)
    reloaded = RoutineStore(tmp_path / "routines.json")
    reloaded.load()
    assert reloaded.get(spec.id).watch.last_fired_at == fired


# ---------- 코드 감시 활성화 게이트 (B-5) · 쿨다운 복원 (B-20) ----------


class _FakeWatchRunner:
    """주입만 확인하는 자리표 — 이 단계에서는 아무것도 실행하지 않는다."""


def _code_runtime(tmp_path, monkeypatch, *, watch_runner=None):
    project_root = tmp_path / "proj"
    (project_root / "watch").mkdir(parents=True)
    monkeypatch.setattr(
        projects_store, "resolve_project_path", lambda pid: project_root
    )

    store = RoutineStore(tmp_path / "r.json")
    ledger = RoutineLedger(tmp_path / "l.jsonl")
    engine = TriggerEngine(ledger=ledger)

    async def noop(_ev):
        pass

    runtime = RoutinesRuntime(
        store=store,
        ledger=ledger,
        engine=engine,
        scheduler=RoutineScheduler(store=store, engine=engine, notify=noop),
        events=asyncio.Queue(200),
        read_marks=ReadMarksStore(tmp_path / "read_marks.json"),
        engagement=EngagementStore(tmp_path / "engagement.jsonl"),
        briefings=BriefingStore(tmp_path / "briefings.jsonl"),
        watch_runner=watch_runner,
    )
    return runtime, project_root


def _write_watch_file(project_root, body="x = 1\n"):
    target = project_root / "watch" / "volume_spike.py"
    target.write_bytes(body.encode("utf-8"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def test_can_activate_code_watch_reports_missing_file(tmp_path, monkeypatch):
    runtime, _ = _code_runtime(tmp_path, monkeypatch, watch_runner=_FakeWatchRunner())
    spec = validate_draft(_code_draft())
    assert runtime.can_activate(spec) == "감시 코드 파일 없음 — 다시 만들기"


def test_can_activate_code_watch_reports_hash_mismatch(tmp_path, monkeypatch):
    runtime, root = _code_runtime(
        tmp_path, monkeypatch, watch_runner=_FakeWatchRunner()
    )
    _write_watch_file(root)
    spec = validate_draft(_code_draft())
    assert runtime.can_activate(spec) == "검사 뒤 코드가 바뀜 — 다시 검사"


def test_can_activate_code_watch_reports_missing_runner(tmp_path, monkeypatch):
    runtime, root = _code_runtime(tmp_path, monkeypatch, watch_runner=None)
    digest = _write_watch_file(root)
    spec = validate_draft(_code_draft(watch=_watch(version_hash=digest)))
    assert runtime.can_activate(spec) == "백엔드 실행층 꺼짐 — 백테스트 모듈 필요"


def test_can_activate_code_watch_passes_when_everything_lines_up(tmp_path, monkeypatch):
    runtime, root = _code_runtime(
        tmp_path, monkeypatch, watch_runner=_FakeWatchRunner()
    )
    digest = _write_watch_file(root)
    spec = validate_draft(_code_draft(watch=_watch(version_hash=digest)))
    assert runtime.can_activate(spec) is None


def test_restore_trigger_state_seeds_cooldown_from_last_fired_at(tmp_path, monkeypatch):
    """B-20 — 부팅 복원이 저장된 발화 시각을 쿨다운 상태로 되살린다."""
    runtime, _ = _code_runtime(tmp_path, monkeypatch, watch_runner=_FakeWatchRunner())
    fired = (datetime.now(UTC) - timedelta(seconds=60)).isoformat()
    spec = validate_draft(
        _code_draft(cooldown_s=1800, watch=_watch(last_fired_at=fired))
    )
    spec.status = "active"
    runtime.store.upsert(spec)

    assert runtime.restore_trigger_state() == 1
    assert runtime.engine.evaluate(spec, True) == "suppressed"
    assert "쿨다운" in runtime.ledger.read_all()[-1]["reason"]


def test_restore_trigger_state_skips_expired_cooldown(tmp_path, monkeypatch):
    runtime, _ = _code_runtime(tmp_path, monkeypatch, watch_runner=_FakeWatchRunner())
    fired = (datetime.now(UTC) - timedelta(hours=5)).isoformat()
    spec = validate_draft(
        _code_draft(cooldown_s=1800, watch=_watch(last_fired_at=fired))
    )
    spec.status = "active"
    runtime.store.upsert(spec)

    assert runtime.restore_trigger_state() == 0
    assert runtime.engine.evaluate(spec, True) == "fired"
