"""트리거 엔진(US-005) — 합성 틱으로 3판정·쿨다운·연속 틱·양보를 고정한다."""

from __future__ import annotations

import pytest

from athena_api.kiwoom.rate_limiter import RateLimiter
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.rules import validate_draft
from athena_api.routines.triggers import TriggerEngine, should_yield_to_conversation


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _engine(tmp_path, clock=None):
    return TriggerEngine(
        ledger=RoutineLedger(tmp_path / "ledger.jsonl"),
        clock=clock or FakeClock(),
    )


def _surge_spec(ticks: int = 1):
    return validate_draft(
        {
            "symbol": "005930",
            "condition": {
                "source": "price.change_rate",
                "op": ">=",
                "value": 5.0,
                "consecutive_ticks": ticks,
            },
            "cooldown_s": 1800,
            "expires_days": 7,
        }
    )


def test_fired_near_and_quiet(tmp_path):
    eng = _engine(tmp_path)
    spec = _surge_spec()
    # 조용: 임계에서 멀다(5%의 90% 미만) — 기록 없음
    assert eng.evaluate(spec, 1.0) is None
    # 근접: 4.6%는 5%의 90% 이상 — near 기록
    assert eng.evaluate(spec, 4.6) == "near"
    # 발화
    assert eng.evaluate(spec, 5.3) == "fired"
    verdicts = [r["verdict"] for r in eng.ledger.read_all()]
    assert verdicts == ["near", "fired"]


def test_near_hysteresis_holds_through_boundary_oscillation(tmp_path):
    """결함7 반증 재현 — 진입/이탈 경계가 같으면 경계 부근 교대 입력마다
    근접/조용이 반복된다. 이탈 경계(0.85)를 진입 경계(0.9)보다 낮춰 한 번
    진입하면 더 멀어져야 이탈하도록 만든 데드밴드를 고정한다."""
    eng = _engine(tmp_path)
    spec = _surge_spec()  # threshold=5.0, op>=

    assert eng.evaluate(spec, 4.6) == "near"  # 거리 0.08 — 진입경계(0.10) 안 — 진입
    # 거리 0.13 — 구 단일경계(0.10)라면 여기서 이탈했을 값이지만, 이미 근접
    # 중이라 이탈경계(0.15) 안 — 근접 유지
    assert eng.evaluate(spec, 4.35) == "near"
    assert eng.evaluate(spec, 4.6) == "near"  # 다시 붙음 — 근접 유지
    assert eng.evaluate(spec, 4.1) is None  # 거리 0.18 — 이탈경계(0.15) 밖 — 진짜 이탈


def test_near_entry_threshold_unaffected_by_exit_ratio(tmp_path):
    """진입 경계는 이탈 경계 도입과 무관하게 기존 0.9(거리 0.10)를 유지한다."""
    eng = _engine(tmp_path)
    spec = _surge_spec()
    assert eng.evaluate(spec, 4.35) is None  # 거리 0.13 — 아직 근접 진입 전, 진입경계 밖
    assert eng.evaluate(spec, 4.55) == "near"  # 거리 0.09 — 진입경계 안 — 진입


def test_consecutive_ticks_suppress_until_met(tmp_path):
    eng = _engine(tmp_path)
    spec = _surge_spec(ticks=3)
    assert eng.evaluate(spec, 6.0) == "suppressed"  # 1/3
    assert eng.evaluate(spec, 6.1) == "suppressed"  # 2/3
    assert eng.evaluate(spec, 6.2) == "fired"  # 3/3
    reasons = [r["reason"] for r in eng.ledger.read_all()]
    assert "연속 틱 미충족 (1/3)" in reasons[0]


def test_consecutive_resets_on_miss(tmp_path):
    eng = _engine(tmp_path)
    spec = _surge_spec(ticks=2)
    assert eng.evaluate(spec, 6.0) == "suppressed"  # 1/2
    assert eng.evaluate(spec, 1.0) is None  # 리셋
    assert eng.evaluate(spec, 6.0) == "suppressed"  # 다시 1/2
    assert eng.evaluate(spec, 6.0) == "fired"


def test_cooldown_suppresses_with_remaining_reason(tmp_path):
    clock = FakeClock()
    eng = _engine(tmp_path, clock)
    spec = _surge_spec()
    assert eng.evaluate(spec, 6.0) == "fired"
    clock.now += 100  # 쿨다운 1800초 중 100초 경과
    assert eng.evaluate(spec, 6.0) == "suppressed"
    last = eng.ledger.read_all()[-1]
    assert "쿨다운" in last["reason"] and "1700" in last["reason"]
    clock.now += 1701
    assert eng.evaluate(spec, 6.0) == "fired"


def test_vi_boolean_has_no_near(tmp_path):
    eng = _engine(tmp_path)
    spec = validate_draft(
        {
            "symbol": "005930",
            "condition": {"source": "vi.triggered", "op": "==", "value": True},
            "cooldown_s": 600,
            "expires_days": 7,
        }
    )
    assert eng.evaluate(spec, False) is None  # 근접 없음 — 조용
    assert eng.evaluate(spec, True) == "fired"


def test_disclosure_keyword_contains(tmp_path):
    eng = _engine(tmp_path)
    spec = validate_draft(
        {
            "symbol": "207940",
            "condition": {
                "source": "disclosure.title_keyword",
                "op": "contains",
                "value": "유상증자",
            },
            "cooldown_s": 3600,
            "expires_days": 7,
        }
    )
    assert eng.evaluate(spec, "주요사항보고서(유상증자결정)") == "fired"
    assert eng.evaluate(spec, "반기보고서") is None


# ---------- 대화 우선 — headroom 양보 (동시 경쟁) ----------


@pytest.mark.asyncio
async def test_polling_yields_during_conversation_burst():
    """대화발 burst가 롤링 창을 채우면 폴링은 skip, 창이 비면 재개."""
    clock = FakeClock()

    async def no_sleep(_s: float) -> None:
        clock.now += 0.05

    limiter = RateLimiter(rate_per_second=5.0, clock=clock, sleep=no_sleep)
    # 대화발 셀렉터 호출 burst — 전역 창 5칸을 다 쓴다
    for api in ("ka10001", "ka10081", "ka10095", "ka10016", "ka10007"):
        await limiter.acquire(api)
    assert should_yield_to_conversation(limiter.headroom(), min_headroom=3)

    clock.now += 1.1  # 롤링 창 경과 — 대화가 조용해짐
    assert not should_yield_to_conversation(limiter.headroom(), min_headroom=3)
