"""전략 코드 샌드박스 가드 — import 허용목록 · `open()` 경로 제한.

**정직한 한계.** 이 가드는 사고 방지 수준이다. 결심한 공격자를 막지 못한다 — 바이트코드
조작, ctypes/gc를 통한 우회, C 확장 등으로 뚫을 방법은 늘 있다. 진짜 경계는
**자격증명 미전달 · DB 미접근 · 별도 프로세스 · 타임아웃** 넷이고(host.py가 그 넷을 쥔다),
여기 위협 모델은 "사용자 본인 코드와 사용자가 검토한 LLM 코드"다
(docs/architecture/backtest-mode-plan.md §7.2). 이 문장을 화면에도 그대로 남긴다.

**왜 프레임 identity로 가르나.** pandas/numpy가 내부적으로 하는 import(예: `os`)까지 막으면
지표 계산 자체가 죽는다. 그렇다고 "이미 sys.modules에 있으면 통과"시키면 구멍이 난다 —
pandas가 이미 `os`를 로드해둔 뒤라면 사용자 코드의 `import os`도 캐시를 그대로 타고
통과해버려 허용목록이 무의미해진다. 그래서 "이 import 호출이 어느 globals에서 일어났는가"로
가른다: 전략 코드의 top-level exec globals(`strategy_globals`)에서 **직접** 일어난 호출만
허용목록으로 검사한다. `strategy.py`에서 정의된 함수는 어디서 호출되든 자신의 `__globals__`가
`strategy_globals`이므로 여전히 검사 대상이다. 반면 pandas/numpy/`athena_bt` 내부 코드가
연쇄로 일으키는 import는 그 모듈 자신의 globals에서 나오므로 이 identity 비교를 통과하지
못해 그냥 흘려보낸다 — 검사 대상 자체가 아니다.
"""

from __future__ import annotations

import builtins
from collections.abc import Iterable
from pathlib import Path
from typing import Any

# 전략 코드가 top level에서 직접 import할 수 있는 모듈(계획서 §7.2 표 그대로).
# pandas/numpy/athena_bt 등 신뢰 모듈이 "내부적으로" 연쇄 import하는 것은 이 목록과
# 무관하게 항상 통과한다 — 위 모듈 docstring 참고.
ALLOWED_TOP_LEVEL_IMPORTS: frozenset[str] = frozenset(
    {"pandas", "numpy", "math", "statistics", "datetime", "athena_bt"}
)

# 허용목록을 아무리 넓혀도 절대 열리지 않는 이름. 프로젝트 가상환경에 실제로 설치돼 있어도
# 여기 있으면 막힌다.
#
# **이 목록의 존재 이유.** 사용자가 자기 가상환경에 깐 패키지를 쓸 수 있게 하려고 허용목록에
# 확장 통로를 냈다(spec.json의 allowed_imports). 그 통로가 프로세스·파일·네트워크 표면을
# 통째로 되돌려주는 문이 되면 확장이 아니라 철거다 — 그래서 확장은 **뺄셈이 먼저**다.
# 위 모듈 docstring의 정직한 한계는 그대로다: 이것도 사고 방지선이지 결심한 공격자를
# 막는 경계가 아니다.
BLOCKED_TOP_LEVEL_IMPORTS: frozenset[str] = frozenset(
    {
        "os", "sys", "subprocess", "socket", "urllib", "http", "httpx", "requests",
        "pathlib", "shutil", "ctypes", "importlib", "builtins", "io", "tempfile",
        "multiprocessing", "threading", "signal", "code", "pickle", "marshal",
    }
)


def resolve_allowlist(extra: Iterable[str] | None = None) -> frozenset[str]:
    """기본 허용목록에 `extra`(프로젝트 가상환경의 패키지)를 얹되 차단목록은 빼고 남긴다."""
    names = set(ALLOWED_TOP_LEVEL_IMPORTS)
    names.update(str(name).split(".", 1)[0] for name in (extra or ()))
    return frozenset(names - BLOCKED_TOP_LEVEL_IMPORTS)

_real_import = builtins.__import__


class SandboxImportError(ImportError):
    """허용목록 밖 import를 전략 코드가 top level에서 직접 시도했을 때."""


class SandboxFileAccessError(PermissionError):
    """전략 코드가 jobdir 밖 경로를 열려고 했을 때."""


def _make_guarded_import(strategy_globals: dict[str, Any], allowed: frozenset[str]):
    """`strategy_globals`에서 직접 일어난 import 호출만 허용목록으로 검사하는 훅."""

    def guarded_import(
        name: str,
        globals: dict[str, Any] | None = None,
        locals: dict[str, Any] | None = None,
        fromlist: tuple[str, ...] = (),
        level: int = 0,
    ) -> Any:
        if globals is strategy_globals:
            top = name.split(".", 1)[0]
            if top not in allowed:
                raise SandboxImportError(f"허용되지 않은 import: {name!r}")
        return _real_import(name, globals, locals, fromlist, level)

    return guarded_import


def _make_guarded_open(jobdir: Path):
    """jobdir 밖 경로를 여는 시도를 막는 `open` 대체.

    실제 보안 경계가 아니다(위 모듈 docstring) — 심볼릭 링크·TOCTOU 레이스는 못 막는다.
    절대경로로 정규화한 뒤 jobdir 하위인지만 사고 방지 수준으로 확인한다.
    """
    real_open = builtins.open
    job_root = jobdir.resolve()

    def guarded_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(file, str | Path):
            target = Path(file)
            candidate = target if target.is_absolute() else job_root / target
            resolved = candidate.resolve()
            if resolved != job_root and job_root not in resolved.parents:
                raise SandboxFileAccessError(f"jobdir 밖 경로는 열 수 없다: {file!r}")
        return real_open(file, *args, **kwargs)

    return guarded_open


def install(
    strategy_globals: dict[str, Any],
    jobdir: Path,
    *,
    allowed_imports: Iterable[str] | None = None,
) -> None:
    """전략 코드 `exec()` 직전에 호출한다.

    `strategy_globals["__builtins__"]`를 전체 빌트인 사본으로 바꿔치기하고 `__import__`/
    `open`만 감싼 버전으로 덮는다 — 이 딕셔너리로 실행되는 코드(strategy.py의 top level과
    거기서 정의된 함수 전부)에만 적용되고, 이미 로드된 pandas/numpy 등 신뢰 모듈의 동작에는
    영향이 없다(그 모듈들은 자기 자신의 `__builtins__`를 그대로 쓴다).

    `allowed_imports`는 프로젝트 가상환경의 패키지 이름이다 — `resolve_allowlist()`를
    지나므로 차단목록은 여기서도 뚫리지 않는다.
    """
    restricted = dict(vars(builtins))
    restricted["__import__"] = _make_guarded_import(
        strategy_globals, resolve_allowlist(allowed_imports)
    )
    restricted["open"] = _make_guarded_open(jobdir)
    strategy_globals["__builtins__"] = restricted


__all__ = [
    "ALLOWED_TOP_LEVEL_IMPORTS",
    "BLOCKED_TOP_LEVEL_IMPORTS",
    "SandboxFileAccessError",
    "SandboxImportError",
    "install",
    "resolve_allowlist",
]
