"""루틴 코어(US-004) — 모델·검증·원장의 계약 테스트."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.routines.ledger import LedgerError, RoutineLedger
from athena_api.routines.models import RoutineSpec, derive_mode
from athena_api.routines.rules import (
    RoutineValidationError,
    validate_condition,
    validate_draft,
)


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
    periodic = validate_condition(
        {"source": "disclosure.title_keyword", "op": "contains", "value": "유상증자"}
    )
    assert derive_mode(ws) == "realtime-ws"
    assert derive_mode(periodic) == "periodic"


def test_spec_roundtrip_preserves_everything():
    spec = validate_draft(_draft())
    restored = RoutineSpec.from_dict(spec.to_dict())
    assert restored.to_dict() == spec.to_dict()
    assert restored.mode == "realtime-ws"
    assert restored.status == "draft"


def test_human_summary_states_mode_in_korean():
    spec = validate_draft(_draft())
    assert "실시간 (WS)" in spec.human_summary()
    disclosure_cond = {
        "source": "disclosure.title_keyword",
        "op": "contains",
        "value": "유상증자",
    }
    disclosure = validate_draft(_draft(condition=disclosure_cond))
    assert "주기 확인" in disclosure.human_summary()


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
    }


def test_expiry_helper(tmp_path):
    spec = validate_draft(_draft(expires_days=1))
    assert not spec.is_expired()
    assert spec.is_expired(now=datetime.now(UTC) + timedelta(days=2))
