"""프로젝트 = 내 컴퓨터의 폴더 하나 — 코드 탭 IDE의 저장층(계약 D1·D2·D3).

**진실은 디스크의 파일이다.** sqlite 전략 버전은 실행 재현용 기록으로만 남고, 편집·저장은
전부 이 모듈을 지나 실제 파일에 닿는다. 그래서 지켜야 할 불변식은 둘뿐이다 —
① 프로젝트 폴더 밖은 절대 건드리지 않는다(`resolve_in_project`), ② 파이썬(.py)만 만들고
쓰고 이름 바꾼다(D3). 그 밖의 파일은 목록에 보이되 이 기능이 고치지 않는다.

**레지스트리.** `<projects_root>/registry.json` 하나에 {id, name, path, kind, created_at}를
담는다. 쓰기는 tmp→replace 원자 교체고, 손상 파일은 `registry.corrupt.json`으로 보존한 뒤
빈 목록으로 강등하되 **그 사실을 호출자에게 돌려준다**(`RegistrySnapshot.notice`) —
`routines/store.py`의 `LoadReport`와 같은 이유다. 조용히 사라진 상태가 가장 나쁘다.

**관리형(managed)과 외부(external)의 차이는 위치뿐이다.** 관리형은 `projects_root` 아래에
이 모듈이 만들고, 외부는 사용자가 디스크 아무 데나 이미 가진 폴더를 경로만 등록한다.
등록 해제는 레지스트리에서만 지운다 — 이 모듈에 폴더를 지우는 코드는 없다.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Final
from uuid import uuid4

REGISTRY_FILENAME: Final = "registry.json"
SEED_STRATEGY_FILENAME: Final = "strategy.py"

# 트리에서 통째로 건너뛰는 폴더. 점(.)으로 시작하는 폴더는 이름과 무관하게 전부 건너뛴다.
IGNORED_DIRS: Final[frozenset[str]] = frozenset({".git", ".venv", "__pycache__", "node_modules"})

# 트리 응답이 무한정 커지지 않게 하는 상한. 넘으면 잘랐다고 정직하게 표시한다.
MAX_TREE_ENTRIES: Final = 5000
# 편집기가 한 번에 여는 파일 상한. 넘으면 413 — 이 기능은 코드 편집기지 뷰어가 아니다.
MAX_FILE_BYTES: Final = 1024 * 1024
# 목록의 py_files는 "몇 개나 되는지 감"을 주는 값이라 여기서 세기를 멈춘다.
PY_FILE_COUNT_CAP: Final = 1000

# 프로젝트 가상환경은 폴더 안의 `.venv` 하나로 고정한다 — 이름을 고르게 하면 "어느
# 환경으로 돌았는가"가 실행마다 달라진다. IGNORED_DIRS가 이미 이 이름을 트리에서 뺀다.
VENV_DIRNAME: Final = ".venv"
# 환경 구성이 언제나 깔아주는 기본 패키지. 샌드박스 자식이 실제로 쓰는 것이 이 둘뿐이라
# (sandbox/api.py → indicators/core.py) 여기가 "돌아가는 최소 환경"의 정의다.
BASE_ENV_PACKAGES: Final[tuple[str, ...]] = ("pandas", "numpy")

_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")
# 설치 요청에 실릴 수 있는 이름의 전부 — `pandas`와 `pandas==2.2.3`까지다. 공백·세미콜론·
# 따옴표·경로·URL·`-r`/`--index-url` 같은 옵션이 전부 여기서 걸린다. 명령은 argv 리스트로만
# 만들어져 셸을 지나지 않으니 이 정규식은 두 번째 그물이지 유일한 그물이 아니다.
_PACKAGE_SPEC = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(==[A-Za-z0-9][A-Za-z0-9._+!-]*)?$")
_WINDOWS_RESERVED: Final[frozenset[str]] = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)

# 새 관리형 프로젝트의 씨앗 — §7.1 전략 코드 계약 그대로다. 사용자가 처음 보는 화면이
# 빈 파일이 아니라 "돌아가는 계약"이어야 한다.
SEED_STRATEGY_CODE: Final = '''# athena strategy v1
PARAMS = {
    "fast": {"default": 20, "min": 5, "max": 60, "step": 1},
    "slow": {"default": 60, "min": 20, "max": 240, "step": 1},
}


def signals(df, p):
    """df: DataFrame[open,high,low,close,volume], index=거래일
       p : dict — PARAMS의 현재 값
       반환: DataFrame[entry:bool, exit:bool]"""
    import athena_bt as bt

    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    return df.assign(
        entry=bt.cross_above(fast, slow),
        exit=bt.cross_below(fast, slow),
    )[["entry", "exit"]]
'''


class ProjectStoreError(ValueError):
    """프로젝트 저장층의 거부 — HTTP 경계에서 4xx로 번역된다."""


class ProjectPathError(ProjectStoreError):
    """프로젝트 폴더 밖을 가리키는 경로 — 400."""


class ProjectNameError(ProjectStoreError):
    """이름·경로 입력 자체가 규칙에 어긋난다 — 422."""


class ProjectExistsError(ProjectStoreError):
    """이미 있는 폴더거나 이미 등록된 프로젝트다 — 409."""


class ProjectMissingError(ProjectStoreError):
    """열려는 폴더가 디스크에 없다 — 404."""


class ProjectNotADirectoryError(ProjectStoreError):
    """폴더가 아니라 파일을 열려고 했다 — 422."""


def is_safe_project_name(name: str) -> bool:
    """관리형 프로젝트 이름이 경로 '한 조각'인지 — 폴더를 실제로 만들기 전의 유일한 관문.

    구분자·상대 참조·점으로 시작(트리가 건너뛰는 숨김 폴더가 된다)·양끝 공백·끝점·
    윈도우 예약 장치 이름을 전부 막는다. 한글 이름은 허용한다 — 막을 이유가 없다.
    """
    if not name or len(name) > 64 or name != name.strip():
        return False
    if name in {".", ".."} or name.startswith(".") or name.endswith("."):
        return False
    if any(ch in name for ch in '\\/:*?"<>|'):
        return False
    if any(ord(ch) < 32 for ch in name):
        return False
    return name.split(".")[0].upper() not in _WINDOWS_RESERVED


def _normcase(path: Path) -> str:
    return os.path.normcase(str(path))


def is_within(root: Path, target: Path) -> bool:
    """`target`이 `root` 자신이거나 그 아래인가 — 둘 다 이미 resolve된 절대 경로여야 한다.

    윈도우에서 대소문자·구분자가 뒤섞이므로 `os.path.normcase`로 맞춘 뒤 비교한다.
    `commonpath`는 드라이브가 다르면 예외를 던져서 쓰지 않는다.
    """
    base = _normcase(root).rstrip(os.sep)
    candidate = _normcase(target)
    return candidate == base or candidate.startswith(base + os.sep)


def resolve_in_project(root: Path, candidate: str) -> Path:
    """프로젝트 상대 경로를 루트 안의 절대 경로로 푼다. 이 함수가 이 기능의 하중을 진다.

    거부: 빈 경로 · 절대 경로 · UNC · 윈도우 드라이브 상대 경로(`C:foo`) · `..` 상향 ·
    **심볼릭 링크로 밖을 가리키는 경로**. 마지막 하나 때문에 문자열 검사만으로는 부족하다 —
    실제로 `resolve()`한 뒤 다시 루트 안인지 본다(문자열은 안이라고 말하는데 파일 시스템은
    밖으로 데려가는 경우가 정확히 이 지점에서 갈린다).
    """
    text = (candidate or "").strip().replace("\\", "/")
    if not text or text in {".", "./"}:
        raise ProjectPathError("경로가 비어 있다")
    if text.startswith("/"):
        raise ProjectPathError("절대 경로는 프로젝트 폴더 밖이다")
    if _DRIVE_PREFIX.match(text):
        raise ProjectPathError("드라이브 경로는 프로젝트 폴더 밖이다")
    parts = [part for part in PurePosixPath(text).parts if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ProjectPathError("상위 폴더(..) 참조는 허용하지 않는다")
    if not parts:
        raise ProjectPathError("경로가 비어 있다")
    base = root.resolve()
    target = base.joinpath(*parts).resolve()
    if not is_within(base, target):
        raise ProjectPathError("프로젝트 폴더 밖의 경로다")
    return target


def relative_path(root: Path, target: Path) -> str:
    """프로젝트 상대 경로를 슬래시 표기로 — 응답의 `path`는 항상 이 모양이다."""
    return target.resolve().relative_to(root.resolve()).as_posix()


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def build_tree(root: Path, *, limit: int = MAX_TREE_ENTRIES) -> tuple[list[dict[str, Any]], bool]:
    """루트 아래를 중첩 목록으로 만든다. 폴더 항목은 `children`을 갖는다.

    파이썬이 아닌 파일도 **보여준다**(D3: 사용자가 자기 데이터를 봐야 한다) — 다만 `py`
    플래그로 편집 가능 여부가 드러난다. 심볼릭 링크 폴더는 목록에만 남기고 들어가지
    않는다 — 순환과 프로젝트 밖 탐색을 둘 다 여기서 끊는다.
    """
    state = {"count": 0, "truncated": False}

    def walk(directory: Path) -> list[dict[str, Any]]:
        try:
            children = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return []
        items: list[dict[str, Any]] = []
        for child in children:
            is_dir = child.is_dir()
            if is_dir and (child.name in IGNORED_DIRS or child.name.startswith(".")):
                continue
            if state["count"] >= limit:
                state["truncated"] = True
                break
            state["count"] += 1
            entry: dict[str, Any] = {
                "name": child.name,
                "path": child.relative_to(root).as_posix(),
                "is_dir": is_dir,
                "py": not is_dir and child.suffix.lower() == ".py",
                "size": 0 if is_dir else _file_size(child),
            }
            if is_dir:
                entry["children"] = [] if child.is_symlink() else walk(child)
            items.append(entry)
        return items

    entries = walk(root)
    return entries, bool(state["truncated"])


def count_py_files(root: Path, *, cap: int = PY_FILE_COUNT_CAP) -> int:
    """프로젝트 안의 .py 개수 — `cap`에서 멈춘다(목록 라우트가 디스크를 다 훑지 않게)."""
    total = 0
    for _dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".")]
        for name in filenames:
            if name.lower().endswith(".py"):
                total += 1
                if total >= cap:
                    return total
    return total


# ── 프로젝트 가상환경 ────────────────────────────────────────────────────────
#
# 프로젝트 폴더가 "내 코드"라면 그 옆의 `.venv`는 "내 코드가 도는 환경"이다. 등록도 실행도
# 이 둘을 같이 봐야 성립한다 — 여기 함수들은 그 환경을 **읽기만** 한다. 만드는 것(venv 생성·
# pip 설치)은 잡 러너의 몫이라 이 모듈에 서브프로세스가 없다.


def venv_path(project: Path) -> Path:
    """프로젝트 가상환경 폴더의 위치."""
    return project / VENV_DIRNAME


def venv_python(project: Path) -> Path | None:
    """가상환경 인터프리터의 절대경로. 없으면 None.

    윈도우는 `Scripts/python.exe`, POSIX는 `bin/python`이다. 지금 도는 OS로 고르지 않고
    **둘 다 찾아본다** — 프로젝트 폴더는 사용자 디스크의 물건이라 다른 OS에서 만들어진
    폴더가 올 수 있고, 없는 쪽은 파일이 없어 그냥 걸리지 않는다.
    """
    for parts in (("Scripts", "python.exe"), ("bin", "python")):
        candidate = venv_path(project).joinpath(*parts)
        if candidate.is_file():
            return candidate.resolve()
    return None


def venv_site_packages(project: Path) -> Path | None:
    """가상환경의 site-packages. 윈도우는 `Lib/`, POSIX는 `lib/python3.X/` 아래다."""
    base = venv_path(project)
    windows = base / "Lib" / "site-packages"
    if windows.is_dir():
        return windows
    for candidate in sorted((base / "lib").glob("python*/site-packages")):
        if candidate.is_dir():
            return candidate
    return None


def venv_packages(project: Path) -> list[str]:
    """가상환경에 설치된 패키지 이름 — `site-packages/*.dist-info` 폴더 이름에서 읽는다.

    **왜 `pip list`가 아닌가.** ① 이 값을 읽는 `GET /env`는 화면이 되풀이해 부르는
    조회 라우트라 매번 인터프리터를 하나 더 띄울 자리가 아니다. ② pip이 없는 가상환경
    (`--without-pip`)에서도 답이 나온다. ③ 무엇보다 우리가 필요한 것은 **import 이름**인데,
    dist-info 폴더 이름은 PEP 427 이스케이프를 거쳐 `httpx-sse`가 아니라 `httpx_sse`로
    적혀 있다 — `pip list`가 주는 배포 이름보다 import 이름에 가깝다.

    정직한 한계: 배포 이름과 import 이름이 아예 다른 패키지(scikit-learn → sklearn)는
    여기서 못 맞춘다. 그 경우 샌드박스 허용목록에 안 잡혀 import가 막힌다 — 틀리는 방향이
    "막힘"이라 안전한 쪽이다.
    """
    site = venv_site_packages(project)
    if site is None:
        return []
    return sorted(
        {entry.stem.rsplit("-", 1)[0] for entry in site.glob("*.dist-info") if entry.is_dir()}
    )


def is_valid_package_spec(text: str) -> bool:
    """설치를 요청할 수 있는 이름인가 — `pandas`, `pandas==2.2.3`까지만 참이다."""
    return len(text) <= 128 and bool(_PACKAGE_SPEC.match(text))


@dataclass(frozen=True)
class ProjectEntry:
    """레지스트리 한 줄."""

    id: str
    name: str
    path: Path
    kind: str  # managed | external
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "path": str(self.path),
            "kind": self.kind,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> ProjectEntry:
        return cls(
            id=str(raw["id"]),
            name=str(raw["name"]),
            path=Path(str(raw["path"])),
            kind=str(raw["kind"]),
            created_at=str(raw["created_at"]),
        )


@dataclass(frozen=True)
class RegistrySnapshot:
    """레지스트리 한 벌과, 그것을 읽으며 생긴 할 말."""

    entries: tuple[ProjectEntry, ...]
    notice: str | None = None


@dataclass
class ProjectStore:
    """`projects_root` 하나를 소유하는 레지스트리. 상태를 들고 있지 않다 — 매번 파일을 읽는다.

    캐시를 두지 않는 이유는 진실이 디스크이기 때문이다(D2). 프로세스가 기억한 목록과
    사람이 탐색기에서 만든 폴더가 어긋나는 순간이 이 기능에서 가장 흔한 거짓말이다.
    """

    root: Path

    @property
    def registry_path(self) -> Path:
        return self.root / REGISTRY_FILENAME

    def load(self) -> RegistrySnapshot:
        path = self.registry_path
        if not path.exists():
            return RegistrySnapshot((), "레지스트리 파일이 아직 없어 빈 목록으로 시작한다")
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            entries = tuple(ProjectEntry.from_dict(row) for row in raw["projects"])
        except Exception as exc:  # 손상 — 보존하고 빈 목록으로 강등, 사실은 숨기지 않는다
            corrupt = path.with_suffix(".corrupt.json")
            try:
                path.replace(corrupt)
                detail = f"{corrupt.name}으로 보존했다"
            except OSError:
                detail = "손상 파일 보존에도 실패했다"
            return RegistrySnapshot(
                (),
                f"레지스트리가 손상되어 빈 목록으로 시작한다 ({type(exc).__name__}) — {detail}",
            )
        return RegistrySnapshot(entries)

    def save(self, entries: tuple[ProjectEntry, ...]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "saved_at": datetime.now(UTC).isoformat(),
            "projects": [entry.to_dict() for entry in entries],
        }
        tmp = self.registry_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.registry_path)

    def get(self, project_id: str) -> ProjectEntry | None:
        for entry in self.load().entries:
            if entry.id == project_id:
                return entry
        return None

    def create_managed(self, name: str) -> ProjectEntry:
        """`projects_root/<name>` 폴더와 씨앗 strategy.py를 만들고 등록한다."""
        clean = (name or "").strip()
        if not is_safe_project_name(clean):
            raise ProjectNameError("프로젝트 이름은 경로 구분자·상위 참조 없는 한 조각이어야 한다")
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / clean
        snapshot = self.load()
        if target.exists():
            raise ProjectExistsError("같은 이름의 폴더가 이미 있다")
        if any(_normcase(entry.path) == _normcase(target) for entry in snapshot.entries):
            raise ProjectExistsError("같은 경로가 이미 등록돼 있다")
        target.mkdir(parents=True)
        (target / SEED_STRATEGY_FILENAME).write_text(
            SEED_STRATEGY_CODE, encoding="utf-8", newline="\n"
        )
        entry = ProjectEntry(
            id=str(uuid4()),
            name=clean,
            path=target.resolve(),
            kind="managed",
            created_at=datetime.now(UTC).isoformat(),
        )
        self.save((*snapshot.entries, entry))
        return entry

    def open_external(self, raw_path: str) -> ProjectEntry:
        """디스크에 이미 있는 폴더를 등록한다 — 그 안에 아무것도 만들지 않는다."""
        text = (raw_path or "").strip()
        if not text:
            raise ProjectNameError("폴더 경로가 비어 있다")
        candidate = Path(text).expanduser()
        if not candidate.exists():
            raise ProjectMissingError("폴더가 존재하지 않는다")
        if not candidate.is_dir():
            raise ProjectNotADirectoryError("폴더가 아니라 파일이다")
        resolved = candidate.resolve()
        snapshot = self.load()
        if any(_normcase(entry.path) == _normcase(resolved) for entry in snapshot.entries):
            raise ProjectExistsError("이미 등록된 폴더다")
        entry = ProjectEntry(
            id=str(uuid4()),
            name=resolved.name or str(resolved),
            path=resolved,
            kind="external",
            created_at=datetime.now(UTC).isoformat(),
        )
        self.save((*snapshot.entries, entry))
        return entry

    def unregister(self, project_id: str) -> ProjectEntry | None:
        """등록만 해제한다. **디스크의 파일은 건드리지 않는다** — 지우는 코드가 여기 없다."""
        snapshot = self.load()
        remaining = tuple(entry for entry in snapshot.entries if entry.id != project_id)
        if len(remaining) == len(snapshot.entries):
            return None
        removed = next(entry for entry in snapshot.entries if entry.id == project_id)
        self.save(remaining)
        return removed


def resolve_project_path(project_id: str) -> Path:
    """등록된 프로젝트 id를 폴더 경로로 푼다.

    다른 모듈(사용자 전략 레지스트리)이 프로젝트 폴더를 얻는 유일한 진입점이다.

    `ProjectStore`를 쓰지 않고 함수 하나로 두는 이유: 부르는 쪽은 `projects_root`도
    `Settings`도 몰라야 한다. 등록되지 않은 id는 `KeyError`다 — 호출자가 404로 옮긴다.
    """
    from athena_api.config import get_settings

    store = ProjectStore(get_settings().projects_root)
    for entry in store.load().entries:
        if entry.id == project_id:
            return entry.path
    raise KeyError(project_id)
