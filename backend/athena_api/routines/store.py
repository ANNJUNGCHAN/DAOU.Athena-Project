"""루틴 영속 — 원자적 쓰기·기동 복원·상태 전이 게이트.

프리모템 1("루틴이 조용히 죽어 있었다")의 저장 계층 완화: tmp-then-rename
원자 쓰기, 손상 파일은 .corrupt로 보존 후 빈 상태로 강등하되 **복원 실패
사실을 숨기지 않는다**(load 리포트로 노출 — lifespan이 강제 알림으로 승격).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from athena_api.routines.models import ALLOWED_TRANSITIONS, RoutineSpec


class RoutineTransitionError(ValueError):
    """상태 전이 표 밖의 전이 — 4xx로 번역된다."""


@dataclass
class LoadReport:
    restored: int = 0
    corrupt: bool = False
    detail: str | None = None


@dataclass
class RoutineStore:
    """단일 프로세스(uvicorn 1워커) 전제의 소형 JSON 저장소."""

    path: Path
    _items: dict[str, RoutineSpec] = field(default_factory=dict)

    def load(self) -> LoadReport:
        report = LoadReport()
        if not self.path.exists():
            return report
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            specs = [RoutineSpec.from_dict(r) for r in raw["routines"]]
        except Exception as exc:  # 손상 — 보존하고 빈 상태로 강등, 사실은 리포트로
            corrupt_path = self.path.with_suffix(".corrupt")
            try:
                self.path.replace(corrupt_path)
                detail = f"손상 파일을 {corrupt_path.name}으로 보존"
            except OSError:
                detail = "손상 파일 보존 실패"
            report.corrupt = True
            report.detail = f"{type(exc).__name__}: {detail}"
            return report
        self._items = {s.id: s for s in specs}
        report.restored = len(self._items)
        return report

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "saved_at": datetime.now(UTC).isoformat(),
            "routines": [s.to_dict() for s in self._items.values()],
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        tmp.replace(self.path)

    def upsert(self, spec: RoutineSpec) -> None:
        self._items[spec.id] = spec
        self._save()

    def get(self, routine_id: str) -> RoutineSpec | None:
        return self._items.get(routine_id)

    def list_all(self) -> list[RoutineSpec]:
        return sorted(self._items.values(), key=lambda s: s.created_at)

    def list_active(self) -> list[RoutineSpec]:
        return [s for s in self.list_all() if s.status == "active"]

    def transition(self, routine_id: str, new_status: str) -> RoutineSpec:
        spec = self._items.get(routine_id)
        if spec is None:
            raise RoutineTransitionError("루틴이 존재하지 않는다")
        allowed = ALLOWED_TRANSITIONS.get(spec.status, ())
        if new_status not in allowed:
            raise RoutineTransitionError(
                f"'{spec.status}' → '{new_status}' 전이는 허용되지 않는다"
            )
        spec.status = new_status  # type: ignore[assignment]
        if new_status == "active" and spec.approved_at is None:
            spec.approved_at = datetime.now(UTC)
        self._save()
        return spec
