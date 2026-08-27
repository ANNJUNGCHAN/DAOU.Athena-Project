"""발화 열람·응답 계측 — UI 텔레메트리 전용, ledger.py와는 다른 관심사.

ledger.py(판정 감사 로그 — "왜 발화했나")는 이 모듈이 생기는 이유로도
무수정이다: 판정 감사와 UI 텔레메트리는 서로 다른 사실이라 별도
append-only jsonl에 각자 쌓는다(P4 — 소유자 분리).

지표 정의(정직하게 고정, 임의 해석 여지를 남기지 않는다):
- opened: 능동 턴이 뜬 방을 사용자가 실제로 선택(클릭)해 열람한 사건.
  화면에 렌더된 것만으로는 opened가 아니다 — 렌더와 열람은 다른
  사건이다. app/chat.js가 실제 선택 시점에만 이 이벤트를 보낸다.
- replied: 그 능동 턴 이후 같은 대화에서 사용자가 이어서 질의를 보낸
  사건. "이어졌다"의 시간/턴 창 판정은 프론트(app/chat.js)의 몫이다 —
  이 모듈은 이벤트를 있는 그대로 받아 적을 뿐, 판정 로직을 갖지 않는다.

read_marks.py와 동형 정책(형식이 아니라 손상 처리 철학) — 손상은 낮은
스테이크(텔레메트리일 뿐, 감시가 멈추는 게 아니다)라 개별 손상 라인은
조용히 건너뛰고 계속 읽는다. ledger.py의 read_all()과 다른 선택이다
(ledger는 판정 감사 로그라 한 줄이 깨졌다고 나머지를 조용히 버리면 안
되는 성격이지만, 여기서는 텔레메트리 한 건 유실이 감내 가능하다).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

EngagementEvent = Literal["opened", "replied"]

_ALLOWED_EVENTS: tuple[str, ...] = ("opened", "replied")


class EngagementError(ValueError):
    """계측 기록 계약 위반 — 호출부 버그이지 런타임 강등 대상이 아니다."""


class EngagementStore:
    """append-only jsonl. 파일 경로는 호출자가 주입한다(테스트 격리)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def record(
        self,
        event: EngagementEvent,
        *,
        routine_id: str,
        ts: datetime | None = None,
    ) -> dict[str, Any]:
        if event not in _ALLOWED_EVENTS:
            raise EngagementError(f"unknown event: {event!r}")
        row = {
            "ts": (ts or datetime.now(UTC)).isoformat(),
            "routine_id": routine_id,
            "event": event,
        }
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        return row

    def read_all(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        rows: list[dict[str, Any]] = []
        for line in self._path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                # 손상된 개별 라인 — 낮은 스테이크라 건너뛰고 계속 읽는다
                # (read_marks.py와 동형 정책, 모듈 독스트링 참고).
                continue
        return rows
