"""사용자 전략 등록부 — 내 폴더의 .py 하나를 프리셋처럼 고를 수 있게 만든다(결정 D2·D3).

**파일이 진실이다(D2).** 여기 남는 것은 "그 파일을 골라 쓸 수 있다"는 사실뿐 —
{project_id, 프로젝트 폴더 기준 상대경로, 이름}이다. 소스는 복사하지 않는다. 그래서
등록한 뒤 사용자가 파일을 고치면 다음 실행이 고쳐진 파일을 읽고, 등록을 지워도 파일은
그대로 남는다(지우는 것은 등록이지 파일이 아니다).

sqlite에는 손대지 않는다 — store.py의 SCHEMA_VERSION은 1이고 마이그레이션 경로가 없다.
routines/read_marks.py와 동형의 원자적 tmp-then-rename JSON 한 장으로 산다. 손상되면
빈 등록부로 강등한다: 최악의 결과가 "다시 등록해야 한다"뿐이고 파일 자체는 무사하다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4


class UserStrategyError(ValueError):
    """사용자가 준 경로가 이 기능의 범위 밖 — 422로 번역된다."""


@dataclass(frozen=True)
class UserStrategy:
    """등록 한 건. `path`는 프로젝트 폴더 기준 상대경로(POSIX 구분자)다."""

    id: str
    name: str
    project_id: str
    path: str
    created_at: str

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.name,
            "project_id": self.project_id,
            "path": self.path,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, str]) -> UserStrategy:
        return cls(
            id=str(raw["id"]),
            name=str(raw["name"]),
            project_id=str(raw["project_id"]),
            path=str(raw["path"]),
            created_at=str(raw["created_at"]),
        )


def relative_python_path(root: Path, raw: str) -> str:
    """프로젝트 폴더 기준 상대경로(POSIX 구분자)로 정규화한다.

    폴더 밖(`..`·다른 절대경로)과 .py가 아닌 파일은 여기서 막는다 — 이 기능이 만지는
    것은 프로젝트 폴더 안의 파이썬뿐이다(결정 D3). 데이터 파일은 목록에는 보여도 이
    등록부에는 들어오지 않는다.
    """
    candidate = Path(raw.strip().replace("\\", "/"))
    if candidate.suffix.lower() != ".py":
        raise UserStrategyError("파이썬 파일(.py)만 등록할 수 있다")
    resolved = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        return resolved.relative_to(root.resolve()).as_posix()
    except ValueError:
        raise UserStrategyError("프로젝트 폴더 밖의 경로다") from None


@dataclass
class UserStrategyRegistry:
    """{id: UserStrategy} — 원자적 tmp-then-rename JSON 한 장(단일 프로세스 전제)."""

    path: Path
    _items: dict[str, UserStrategy] = field(default_factory=dict)

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            items = [UserStrategy.from_dict(r) for r in raw["strategies"]]
        except Exception:
            # 손상 — 빈 등록부로 강등한다. 사용자 파일은 그대로라 다시 등록하면 된다.
            self._items = {}
            return
        self._items = {s.id: s for s in items}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"strategies": [s.to_dict() for s in self._items.values()]}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def add(self, *, name: str, project_id: str, path: str, created_at: str) -> UserStrategy:
        entry = UserStrategy(
            id=str(uuid4()),
            name=name,
            project_id=project_id,
            path=path,
            created_at=created_at,
        )
        self._items[entry.id] = entry
        self._save()
        return entry

    def list_all(self) -> list[UserStrategy]:
        return sorted(self._items.values(), key=lambda s: s.created_at)

    def remove(self, strategy_id: str) -> bool:
        """등록만 지운다 — 파일은 사용자 폴더의 것이라 우리가 지울 물건이 아니다."""
        if self._items.pop(strategy_id, None) is None:
            return False
        self._save()
        return True


__all__ = [
    "UserStrategy",
    "UserStrategyError",
    "UserStrategyRegistry",
    "relative_python_path",
]
