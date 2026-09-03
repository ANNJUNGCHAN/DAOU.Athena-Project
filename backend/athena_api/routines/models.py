"""루틴 모델 — 소스 카탈로그·조건·스펙.

소스 카탈로그가 이 모듈의 심장이다: 조건이 참조할 수 있는 값은 여기 등록된
것뿐이고(화이트리스트), transport가 곧 감시 방식(mode)을 결정한다 —
ws 필드는 틱 즉시(realtime-ws), periodic은 주기 확인, clock은 벽시계
예약(scheduled). §8 삼분법(원래 이분법에서 예약 트리거 추가로 확장).

schedule.daily의 value 인코딩: "<요일>@<HH:MM>" — 요일은 "ALL"(매일)
또는 ISO 요일 번호 콤마열(1=월..7=일, 예: "1,2,3,4,5@07:30").
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

Transport = Literal["ws", "periodic", "clock", "code"]
Mode = Literal["realtime-ws", "periodic", "scheduled", "code-watch"]

_NUM_OPS = ("<", "<=", ">", ">=")
_EQ_OPS = ("==",)
_STR_OPS = ("contains",)
_AT_OPS = ("at",)


@dataclass(frozen=True)
class SourceSpec:
    """조건이 참조 가능한 값 하나의 명세."""

    transport: Transport
    value_type: Literal["number", "bool", "string"]
    ops: tuple[str, ...]
    label: str  # 사람이 읽는 해석문에 쓰는 한국어 라벨
    experimental: bool = False  # 실값 미확인(f_851 등) — 승인 카드에 표기


# 트리거 소스 화이트리스트. WS 필드 근거는 감시에이전트-실행계획 §3
# (0B 체결: f_12 등락율·f_228 체결강도·f_851 전일동시간 거래량비율, 1h VI).
# f_851은 mock 서버 실값 미확인(§14)이라 experimental로 표기만 하고 막지는 않는다.
SOURCES: dict[str, SourceSpec] = {
    "price.current": SourceSpec("ws", "number", _NUM_OPS, "현재가"),
    "price.change_rate": SourceSpec("ws", "number", _NUM_OPS, "등락율(%)"),
    "trade.strength": SourceSpec("ws", "number", _NUM_OPS, "체결강도(%)"),
    "volume.prev_day_ratio": SourceSpec(
        "ws", "number", _NUM_OPS, "전일 동시간 거래량 비율", experimental=True
    ),
    "vi.triggered": SourceSpec("ws", "bool", _EQ_OPS, "VI 발동"),
    "schedule.daily": SourceSpec("clock", "string", _AT_OPS, "예약 시각(요일 지정)"),
    # 코드 감시 — 관측값은 감시 함수의 마지막 행 판정(bool) 하나뿐이다.
    # 조건에는 코드가 들어가지 않는다: 코드는 프로젝트 폴더의 파일이고
    # 스펙은 WatchSpec으로 그 파일을 가리키기만 한다(R5).
    "code.watch": SourceSpec("code", "bool", _EQ_OPS, "코드 감시"),
}

# 저장된 구버전 루틴을 읽고 사용자에게 상태를 설명하기 위한 전용 카탈로그다.
# 신규 초안 검증에는 사용하지 않으며, 외부 사업자 데이터는 앱 플러그인이 소유한다.
LEGACY_DISABLED_SOURCES: dict[str, SourceSpec] = {
    "disclosure.title_keyword": SourceSpec(
        "periodic", "string", _STR_OPS, "공시 제목 키워드 (앱 플러그인 전용)"
    ),
}

RoutineStatus = Literal[
    "draft", "active", "paused", "expired", "cancelled", "failed"
]

# 상태 전이 화이트리스트 — 이 표 밖의 전이는 전부 거부한다.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "draft": ("active", "cancelled"),
    "active": ("paused", "cancelled", "expired", "failed"),
    "paused": ("active", "cancelled", "expired"),
    "expired": (),
    "cancelled": (),
    "failed": ("active", "cancelled"),
}


@dataclass(frozen=True)
class Condition:
    """검증을 통과한 조건. rules.validate_condition()만이 이걸 만든다."""

    source: str
    op: str
    value: float | bool | str
    consecutive_ticks: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "op": self.op,
            "value": self.value,
            "consecutive_ticks": self.consecutive_ticks,
        }


_TRANSPORT_TO_MODE: dict[Transport, Mode] = {
    "ws": "realtime-ws",
    "periodic": "periodic",
    "clock": "scheduled",
    "code": "code-watch",
}


def derive_mode(condition: Condition) -> Mode:
    """§8 — mode는 소스의 transport에서 결정론적으로 유도된다(3분기 테이블)."""
    spec = source_spec(condition.source)
    return _TRANSPORT_TO_MODE[spec.transport]


def source_spec(source: str) -> SourceSpec:
    """활성 카탈로그와 읽기 전용 레거시 카탈로그에서 소스 명세를 찾는다."""
    if source in SOURCES:
        return SOURCES[source]
    return LEGACY_DISABLED_SOURCES[source]


def parse_schedule_value(value: str) -> tuple[frozenset[int] | None, str] | None:
    """schedule.daily의 "<요일>@<HH:MM>" 파싱 — 요일 None은 매일(ALL) 의미.

    형식 오류면 None(호출부가 판단 — draft 검증은 거부, 스케줄러는 스킵+기록).
    rules.py의 형식 검증과 scheduler.py/api 양쪽의 다음 발화 시각 계산이
    이 파서 하나를 공유한다 — 형식 정의가 두 곳으로 갈라지지 않게 한다.
    """
    try:
        days_part, hhmm = value.split("@", 1)
    except ValueError:
        return None
    if len(hhmm) != 5 or hhmm[2] != ":" or not hhmm[:2].isdigit() or not hhmm[3:].isdigit():
        return None
    hour, minute = int(hhmm[:2]), int(hhmm[3:])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    if days_part == "ALL":
        return None, hhmm
    try:
        days = frozenset(int(d) for d in days_part.split(","))
    except ValueError:
        return None
    if not days or not days.issubset(range(1, 8)):
        return None
    return days, hhmm


@dataclass(frozen=True)
class WatchSpec:
    """코드 감시 알람이 가리키는 감시 함수 파일 한 건.

    코드 원문은 여기 없다 — 프로젝트 폴더 안 `watch/<이름>.py`가 원본이고,
    이 스펙은 경로와 검사 시점의 내용 해시만 쥔다(R5). `version_hash`가
    달라지면 검사 뒤 코드가 바뀐 것이므로 활성화가 막힌다.
    """

    project_id: str
    path: str  # 프로젝트 상대 POSIX 경로 — 'watch/'로 시작하는 .py
    version_hash: str  # 검사 통과 시점 파일 바이트의 sha256
    params: dict[str, Any] = field(default_factory=dict)
    poll_interval_s: int = 60
    lookback_days: int = 30
    last_fired_at: str | None = None  # ISO8601 — 재시작 쿨다운 복원용(B-20)

    def to_dict(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "path": self.path,
            "version_hash": self.version_hash,
            "params": dict(self.params),
            "poll_interval_s": self.poll_interval_s,
            "lookback_days": self.lookback_days,
            "last_fired_at": self.last_fired_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> WatchSpec:
        return cls(
            project_id=raw["project_id"],
            path=raw["path"],
            version_hash=raw["version_hash"],
            params=dict(raw.get("params") or {}),
            poll_interval_s=int(raw.get("poll_interval_s", 60)),
            lookback_days=int(raw.get("lookback_days", 30)),
            last_fired_at=raw.get("last_fired_at"),
        )


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass
class RoutineSpec:
    """루틴 한 건. 저장·전이는 store가, 검증은 rules가 담당한다."""

    condition: Condition
    symbol: str  # 6자리 종목코드
    cooldown_s: int
    expires_at: datetime
    note: str  # 사람이 읽는 해석문 — 목록·승인 카드가 노출하는 유일한 조건 표현
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: RoutineStatus = "draft"
    created_at: datetime = field(default_factory=_utcnow)
    approved_at: datetime | None = None
    goal: bool = False  # 목표가 도달 의도 — 승인 카드가 노출, 발화 시 FACE.GLAD 배선(CP1a)
    # 예약 브리핑 실행 설정(R1) — None이면 실행 측(main)의 기본값을 따른다.
    # 검증은 rules.validate_draft()가 담당한다(app/lib/main/model-prefs.js와 동기화).
    briefing_model: str | None = None
    briefing_effort: str | None = None
    # 코드 감시(code.watch) 전용 — 그 밖의 소스에서는 항상 None이다.
    watch: WatchSpec | None = None

    @property
    def mode(self) -> Mode:
        return derive_mode(self.condition)

    def human_summary(self) -> str:
        spec = source_spec(self.condition.source)
        mode_text = {
            "realtime-ws": "실시간 (WS) — 틱 즉시",
            "periodic": "주기 확인 — 최대 폴링 주기만큼 지연",
            "scheduled": "예약 — 지정 요일·시각",
            "code-watch": "코드 감시 — 확인 주기마다 감시 함수 실행",
        }[self.mode]
        exp = " [실값 미확인 필드]" if spec.experimental else ""
        return (
            f"{self.symbol} · {spec.label} {self.condition.op} "
            f"{self.condition.value} · 방식 {mode_text}{exp}"
        )

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.id,
            "symbol": self.symbol,
            "condition": self.condition.to_dict(),
            "cooldown_s": self.cooldown_s,
            "expires_at": self.expires_at.isoformat(),
            "note": self.note,
            "goal": self.goal,
            "status": self.status,
            "mode": self.mode,  # 파생값이지만 읽는 쪽 편의로 함께 저장
            "created_at": self.created_at.isoformat(),
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "briefing_model": self.briefing_model,
            "briefing_effort": self.briefing_effort,
        }
        if self.watch is not None:
            data["watch"] = self.watch.to_dict()
        return data

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> RoutineSpec:
        cond_raw = raw["condition"]
        condition = Condition(
            source=cond_raw["source"],
            op=cond_raw["op"],
            value=cond_raw["value"],
            consecutive_ticks=int(cond_raw.get("consecutive_ticks", 1)),
        )
        approved = raw.get("approved_at")
        return cls(
            condition=condition,
            symbol=raw["symbol"],
            cooldown_s=int(raw["cooldown_s"]),
            expires_at=datetime.fromisoformat(raw["expires_at"]),
            note=raw["note"],
            id=raw["id"],
            status=raw["status"],
            created_at=datetime.fromisoformat(raw["created_at"]),
            approved_at=datetime.fromisoformat(approved) if approved else None,
            goal=bool(raw.get("goal", False)),  # 구버전 저장분 하위호환 — 기본 False
            # 옛 jsonl에는 키 자체가 없다 — .get()으로 하위호환.
            briefing_model=raw.get("briefing_model"),
            briefing_effort=raw.get("briefing_effort"),
            watch=(
                WatchSpec.from_dict(raw["watch"]) if raw.get("watch") else None
            ),
        )

    def is_expired(self, now: datetime | None = None) -> bool:
        return (now or _utcnow()) >= self.expires_at


MAX_EXPIRY = timedelta(days=30)
# 코드 감시 확인 주기 하한은 쿨다운 하한과 같다 — 더 자주 봐야 쿨다운이 삼킨다.
WATCH_MIN_POLL_S = 60
WATCH_MAX_POLL_S = 600
WATCH_MIN_LOOKBACK_DAYS = 7
WATCH_MAX_LOOKBACK_DAYS = 90
MIN_COOLDOWN_S = 60
MAX_COOLDOWN_S = 86_400
