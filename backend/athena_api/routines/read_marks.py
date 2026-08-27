"""읽음 표시 — 라우틴별 "여기까지 읽었다" 지점만 소유한다(P4).

라우틴 *상태*(active/paused)는 store.py가, 발화 *사실*은 ledger.py가 각각
단독 소유한다 — 이 모듈은 그 위에 얹는 제3의 사실(읽음 여부)만 다룬다.
셋 다 겹치는 사실이 없어야 "두 개의 진실"이 안 생긴다.

store.py와 동형의 원자적 tmp-then-rename 쓰기를 쓰되, 손상 시 처리는
더 가볍다 — 이 파일이 손상돼도 최악의 결과가 "알람이 다시 안읽음으로
보인다"뿐이라(라우틴 상태처럼 감시가 멈추는 게 아니다) store.py처럼
손상 파일을 보존하고 강제 알림을 넣는 절차까지는 필요 없다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ReadMarksStore:
    """{routine_id: {"last_read_fired_at": iso|null}} — 원자적 tmp-then-rename."""

    path: Path
    _marks: dict[str, str | None] = field(default_factory=dict)

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self._marks = {
                rid: entry.get("last_read_fired_at")
                for rid, entry in raw.items()
                if isinstance(entry, dict)
            }
        except Exception:
            # 손상 — 낮은 스테이크(읽음 표시뿐)라 빈 상태로 조용히 강등한다.
            self._marks = {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {rid: {"last_read_fired_at": ts} for rid, ts in self._marks.items()}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        tmp.replace(self.path)

    def last_read_fired_at(self, routine_id: str) -> str | None:
        return self._marks.get(routine_id)

    def ack(self, routine_id: str, fired_at: str) -> None:
        self._marks[routine_id] = fired_at
        self._save()
