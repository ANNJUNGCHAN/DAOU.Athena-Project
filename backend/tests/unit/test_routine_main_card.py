from __future__ import annotations

from datetime import UTC, datetime

from athena_api.canvas_transform import resolve_fixed_card_title
from athena_api.routines.main_card import MainCardValidationError, validate_main_card
from athena_api.routines.rules import RoutineValidationError, validate_draft
from athena_api.routines.store import RoutineStore

OPERATION_REF = "base:ka10005"


def candidate(symbol: str = "005930") -> dict:
    return {
        "operation_ref": OPERATION_REF,
        "args": {"stk_cd": symbol},
        "title": "모델이 임의로 쓴 제목",
    }


def draft(**overrides) -> dict:
    raw = {
        "symbol": "005930",
        "condition": {"source": "schedule.daily", "op": "at", "value": "ALL@07:30"},
        "cooldown_s": 1800,
        "expires_days": 7,
        "main_card_candidate": candidate(),
    }
    raw.update(overrides)
    return raw


def test_candidate_is_normalized_but_not_selected():
    spec = validate_draft(draft())
    assert spec.main_card_candidate is not None
    assert spec.main_card_candidate.title == resolve_fixed_card_title(OPERATION_REF)
    assert spec.main_card is None
    assert spec.main_card_confirmed_at is None


def test_today_marker_is_validated_and_persisted_declaratively():
    raw = candidate()
    raw["operation_ref"] = "base:ka10081"
    raw["args"] = {"stk_cd": "005930", "base_dt": "$today", "upd_stkpc_tp": "1"}
    descriptor = validate_main_card(raw, symbol="005930")
    assert descriptor.args["base_dt"] == "$today"


def test_candidate_rejects_unsafe_or_wrong_symbol_operations():
    for raw in (
        {"operation_ref": "base:kt10000", "args": {"stk_cd": "005930"}, "title": "주문"},
        candidate("000660"),
        {
            "operation_ref": OPERATION_REF,
            "args": {"stk_cd": "005930", "url": "https://example.com"},
            "title": "x",
        },
    ):
        try:
            validate_main_card(raw, symbol="005930")
        except MainCardValidationError:
            pass
        else:
            raise AssertionError("invalid main card candidate was accepted")


def test_draft_rejects_user_supplied_confirmation_fields():
    for key, value in (
        ("main_card", candidate()),
        ("main_card_confirmed_at", "2026-09-08T00:00:00+00:00"),
    ):
        try:
            validate_draft(draft(**{key: value}))
        except RoutineValidationError:
            pass
        else:
            raise AssertionError(f"server-owned {key} was accepted")


def test_store_roundtrip_preserves_candidate_and_legacy_has_no_card(tmp_path):
    path = tmp_path / "routines.json"
    spec = validate_draft(draft())
    spec.main_card = spec.main_card_candidate
    spec.main_card_confirmed_at = datetime.now(UTC)
    RoutineStore(path).upsert(spec)
    restored = RoutineStore(path)
    assert restored.load().restored == 1
    assert restored.get(spec.id).main_card_candidate.to_dict() == spec.main_card_candidate.to_dict()
    assert restored.get(spec.id).main_card.to_dict() == spec.main_card.to_dict()
    assert restored.get(spec.id).main_card_confirmed_at == spec.main_card_confirmed_at

    legacy = validate_draft(
        {key: value for key, value in draft().items() if key != "main_card_candidate"}
    )
    assert legacy.main_card_candidate is None
    assert legacy.main_card is None
