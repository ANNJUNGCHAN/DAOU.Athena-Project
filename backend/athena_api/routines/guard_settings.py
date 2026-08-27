"""말걸기 가드 설정 — 프로액티브 발화 빈도를 사용자가 조절하는 단일 전역 설정.

`store.py`의 "라우틴별 목록"과 모양이 다르다 — 라우틴 하나하나가 아니라
앱 전체에 적용되는 설정 값 한 벌뿐이다(42번 패널의 기존 4개 태그와
1:1 대응). 편집은 채팅 경로로만(43 원칙) — 이 모듈 자체는 저장·조회·
검증만 하고 UI·MCP를 모른다.

**"저장이 곧 확정"이다** — 라우틴 draft(사람이 승인 카드에서 confirm)와
달리, 이 설정은 낮은 스테이크(잘못 바뀌어도 다음에 다시 채팅으로 고치면
그만)라 draft/confirm 2단계를 두지 않는다. MCP `propose` 액션은 아무것도
이 스토어에 쓰지 않는다(nudge_guard_tools.py 참고) — `POST
/api/v1/nudge-guard`만이 유일한 쓰기 경로다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MIN_MAX_DAILY_NUDGES = 0
MAX_MAX_DAILY_NUDGES = 10

_DEFAULT_QUIET_START = "22:00"
_DEFAULT_QUIET_END = "07:00"

_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class GuardSettingsError(ValueError):
    """범위 밖 값 — HTTP 경계에서 4xx로 번역된다(errors.py)."""


@dataclass(frozen=True)
class QuietHours:
    start: str = _DEFAULT_QUIET_START
    end: str = _DEFAULT_QUIET_END


@dataclass(frozen=True)
class GuardSettings:
    """42번 패널의 4개 태그와 1:1 대응."""

    max_daily_nudges: int = 2
    quiet_hours: QuietHours = field(default_factory=QuietHours)
    show_rationale: bool = True
    learn_from_dismissals: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "max_daily_nudges": self.max_daily_nudges,
            "quiet_hours": {"start": self.quiet_hours.start, "end": self.quiet_hours.end},
            "show_rationale": self.show_rationale,
            "learn_from_dismissals": self.learn_from_dismissals,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> GuardSettings:
        qh = raw.get("quiet_hours") or {}
        return cls(
            max_daily_nudges=int(raw.get("max_daily_nudges", 2)),
            quiet_hours=QuietHours(
                start=str(qh.get("start", _DEFAULT_QUIET_START)),
                end=str(qh.get("end", _DEFAULT_QUIET_END)),
            ),
            show_rationale=bool(raw.get("show_rationale", True)),
            learn_from_dismissals=bool(raw.get("learn_from_dismissals", True)),
        )


def validate_guard_settings(raw: Any) -> GuardSettings:
    """POST 바디 전체 검증 — 범위 밖 값은 저장 전에 거부한다."""
    if not isinstance(raw, dict):
        raise GuardSettingsError("가드 설정은 객체여야 한다")

    max_daily_nudges = raw.get("max_daily_nudges", 2)
    if isinstance(max_daily_nudges, bool) or not isinstance(max_daily_nudges, int):
        raise GuardSettingsError("max_daily_nudges는 정수여야 한다")
    if not (MIN_MAX_DAILY_NUDGES <= max_daily_nudges <= MAX_MAX_DAILY_NUDGES):
        raise GuardSettingsError(
            f"max_daily_nudges는 {MIN_MAX_DAILY_NUDGES}~{MAX_MAX_DAILY_NUDGES} 범위다"
        )

    quiet_hours_raw = raw.get("quiet_hours", {})
    if not isinstance(quiet_hours_raw, dict):
        raise GuardSettingsError("quiet_hours는 객체여야 한다")
    start = quiet_hours_raw.get("start", _DEFAULT_QUIET_START)
    end = quiet_hours_raw.get("end", _DEFAULT_QUIET_END)
    if not isinstance(start, str) or not _HHMM_RE.match(start):
        raise GuardSettingsError("quiet_hours.start는 'HH:MM' 형식이어야 한다")
    if not isinstance(end, str) or not _HHMM_RE.match(end):
        raise GuardSettingsError("quiet_hours.end는 'HH:MM' 형식이어야 한다")

    show_rationale = raw.get("show_rationale", True)
    if not isinstance(show_rationale, bool):
        raise GuardSettingsError("show_rationale은 불리언이어야 한다")

    learn_from_dismissals = raw.get("learn_from_dismissals", True)
    if not isinstance(learn_from_dismissals, bool):
        raise GuardSettingsError("learn_from_dismissals는 불리언이어야 한다")

    return GuardSettings(
        max_daily_nudges=max_daily_nudges,
        quiet_hours=QuietHours(start=start, end=end),
        show_rationale=show_rationale,
        learn_from_dismissals=learn_from_dismissals,
    )


@dataclass
class GuardSettingsStore:
    """`store.py`와 동형의 원자적 tmp-then-rename JSON 스토어 — 값 한 벌뿐."""

    path: Path
    _settings: GuardSettings = field(default_factory=GuardSettings)

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self._settings = GuardSettings.from_dict(raw)
        except Exception:
            # 손상 — 낮은 스테이크(설정값뿐)라 기본값으로 조용히 강등한다.
            self._settings = GuardSettings()

    def get(self) -> GuardSettings:
        return self._settings

    def replace(self, settings: GuardSettings) -> None:
        self._settings = settings
        self._save()

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self._settings.to_dict(), ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        tmp.replace(self.path)
