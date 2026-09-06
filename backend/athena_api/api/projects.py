"""프로젝트 파일 라우트 — 코드 탭이 내 컴퓨터의 진짜 폴더 위에서 도는 IDE가 되는 지점.

`backtest.py`와 같은 규율을 따른다: 별도 인증을 걸지 않고(로컬 앱이 유일한 호출자),
바디는 dict로 받아 한국어 4xx로 직접 번역한다. 다른 점은 **서브시스템 비활성 게이트가
거의 없다**는 것이다 — 이 라우트가 다루는 것은 사용자의 폴더뿐이라 켜고 끌 스위치가 없다.
예외는 `POST /{id}/env` 하나다(`_env_runner` 주석 참고).

두 가지 규칙이 이 모듈 전체를 지배한다.

1. **경로는 전부 `resolve_in_project()`를 지난다.** 절대 경로·`..`·드라이브 상대 경로·
   프로젝트 밖을 가리키는 심볼릭 링크는 400이다. 예외 없이 한 함수로 모은 이유는,
   경로 검사가 라우트마다 조금씩 다른 순간 그 틈이 바로 구멍이 되기 때문이다.
2. **파이썬만 만들고 쓰고 이름 바꾼다(D3).** 그 밖의 파일은 트리에 보이되(사용자가 자기
   데이터를 봐야 한다) 열거나 쓰려 하면 415다.

`DELETE /{project_id}`는 등록 해제일 뿐이다 — 디스크의 폴더를 지우지 않고, 응답이 그
사실을 말한다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from athena_api.backtest.runner import BacktestRunner
from athena_api.config import get_settings
from athena_api.projects.store import (
    BASE_ENV_PACKAGES,
    MAX_FILE_BYTES,
    SEED_STRATEGY_FILENAME,
    ProjectEntry,
    ProjectExistsError,
    ProjectMissingError,
    ProjectNameError,
    ProjectNotADirectoryError,
    ProjectPathError,
    ProjectStore,
    build_tree,
    count_py_files,
    is_valid_package_spec,
    relative_path,
    resolve_in_project,
    venv_packages,
    venv_python,
)

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


def _store(request: Request) -> ProjectStore:
    """설정의 `projects_root` 하나로 매번 새 스토어를 만든다 — 상태가 없어 캐시할 것도 없다."""
    settings = getattr(request.app.state, "settings", None) or get_settings()
    return ProjectStore(settings.projects_root)


def _env_runner(request: Request) -> BacktestRunner:
    """환경 구성 잡만 백테스트 러너를 빌린다.

    잡 진행 폴링 표면을 둘로 늘리지 않기 위해서다 — 화면과 대화는 이미
    `GET /api/v1/backtest/jobs/{id}` 하나만 본다. 그래서 이 모듈에서 유일하게
    서브시스템 비활성(503)이 보이는 자리가 된다. 조회(`GET /{id}/env`)는 러너가 없어도
    답할 수 있으니 이 gate를 지나지 않는다.
    """
    runner = getattr(request.app.state, "backtest_runner", None)
    if runner is None:
        raise HTTPException(
            status_code=503,
            detail="백테스트 서브시스템이 비활성이다 (ATHENA_BACKTEST_ENABLED=true 필요)",
        )
    return runner


def _entry(request: Request, project_id: str) -> ProjectEntry:
    entry = _store(request).get(project_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="프로젝트가 존재하지 않는다")
    return entry


def _root(entry: ProjectEntry) -> Path:
    """등록된 폴더가 지금 이 순간 실제로 있는지 — 사람은 탐색기에서 폴더를 옮긴다."""
    if not entry.path.is_dir():
        raise HTTPException(status_code=404, detail="프로젝트 폴더가 디스크에 없다")
    return entry.path


def _resolve(root: Path, candidate: str) -> Path:
    try:
        return resolve_in_project(root, candidate)
    except ProjectPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _require_py(target: Path, detail: str) -> None:
    if target.suffix.lower() != ".py":
        raise HTTPException(status_code=415, detail=detail)


def _text_field(body: dict[str, Any], key: str, *, allow_empty: bool = False) -> str:
    value = body.get(key)
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise HTTPException(status_code=422, detail=f"'{key}' 필드가 필요하다")
    return value


def _project_view(entry: ProjectEntry) -> dict[str, Any]:
    """목록 한 줄 — `exists`는 캐시가 아니라 지금 찍은 stat이다(D2)."""
    exists = entry.path.is_dir()
    return {
        "id": entry.id,
        "name": entry.name,
        "path": str(entry.path),
        "kind": entry.kind,
        "created_at": entry.created_at,
        "exists": exists,
        "py_files": count_py_files(entry.path) if exists else 0,
    }


def _file_view(root: Path, target: Path) -> dict[str, Any]:
    stat = target.stat()
    return {
        "path": relative_path(root, target),
        "size": stat.st_size,
        "mtime": stat.st_mtime,
    }


@router.get("")
async def list_projects(request: Request) -> dict[str, Any]:
    """등록된 프로젝트 목록. `notice`는 레지스트리가 없거나 손상됐을 때의 정직한 고지다."""
    snapshot = _store(request).load()
    return {
        "projects": [_project_view(entry) for entry in snapshot.entries],
        "notice": snapshot.notice,
    }


@router.post("")
async def create_project(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """관리형 프로젝트 생성 — 폴더 하나와 §7.1 계약 씨앗 strategy.py."""
    name = _text_field(body, "name")
    try:
        entry = _store(request).create_managed(name)
    except ProjectNameError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProjectExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"project": _project_view(entry), "seed": SEED_STRATEGY_FILENAME}


@router.post("/open")
async def open_project(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """디스크에 이미 있는 폴더를 등록한다 — 그 안에 아무것도 만들지 않는다."""
    path = _text_field(body, "path")
    # 이름은 선택이다 — 만들기 화면(36)이 폴더 이름을 기본값으로 채워 두고 사람이 고칠 수 있다.
    name = _text_field(body, "name") if "name" in body else None
    try:
        entry = _store(request).open_external(path, name)
    except ProjectMissingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ProjectNameError, ProjectNotADirectoryError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProjectExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"project": _project_view(entry)}


@router.delete("/{project_id}")
async def unregister_project(request: Request, project_id: str) -> dict[str, Any]:
    """등록 해제 — **디스크의 파일은 그대로 둔다**. 응답이 그 사실을 말한다."""
    removed = _store(request).unregister(project_id)
    if removed is None:
        raise HTTPException(status_code=404, detail="프로젝트가 존재하지 않는다")
    return {
        "unregistered": removed.id,
        "path": str(removed.path),
        "files_deleted": False,
        "detail": "목록에서만 뺐다 — 디스크의 폴더와 파일은 그대로 있다",
    }


@router.get("/{project_id}/tree")
async def project_tree(request: Request, project_id: str) -> dict[str, Any]:
    """폴더/파일 중첩 목록. 폴더 항목은 `children`을 갖는다."""
    entry = _entry(request, project_id)
    root = _root(entry)
    entries, truncated = build_tree(root)
    return {
        "project_id": entry.id,
        "root": str(root),
        "entries": entries,
        "truncated": truncated,
    }


@router.get("/{project_id}/file")
async def read_file(request: Request, project_id: str, path: str) -> dict[str, Any]:
    """파일 하나를 연다 — 파이썬만, 1MB까지."""
    root = _root(_entry(request, project_id))
    target = _resolve(root, path)
    _require_py(target, "이 기능은 파이썬(.py) 파일만 연다")
    if target.is_dir():
        raise HTTPException(status_code=400, detail="폴더는 열 수 없다")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="파일이 존재하지 않는다")
    stat = target.stat()
    if stat.st_size > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 크다 — 1MB 이하만 연다")
    try:
        # newline=""로 읽어야 CRLF 파일을 열었다 저장하는 것만으로 줄바꿈이 바뀌지 않는다.
        with target.open("r", encoding="utf-8", newline="") as handle:
            text = handle.read()
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=415, detail="UTF-8 텍스트가 아닌 파일은 열지 않는다"
        ) from exc
    return {
        "path": relative_path(root, target),
        "text": text,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "py": True,
    }


@router.put("/{project_id}/file")
async def write_file(request: Request, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """파일 저장 — 여기가 유일한 쓰기 경로다(D2: sqlite를 거치지 않는다)."""
    root = _root(_entry(request, project_id))
    target = _resolve(root, _text_field(body, "path"))
    text = _text_field(body, "text", allow_empty=True)
    _require_py(target, "파이썬(.py) 파일만 저장할 수 있다")
    if target.is_dir():
        raise HTTPException(status_code=400, detail="폴더에는 쓸 수 없다")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # newline=""는 사용자가 보낸 줄바꿈을 그대로 쓴다 — 윈도우에서 임의로 CRLF로
        # 바꾸지 않는다(읽기의 newline=""와 짝이다).
        with target.open("w", encoding="utf-8", newline="") as handle:
            handle.write(text)
    except OSError as exc:
        raise HTTPException(status_code=400, detail="파일을 저장하지 못했다") from exc
    return _file_view(root, target)


@router.post("/{project_id}/file")
async def create_file(request: Request, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """빈 파이썬 파일 또는 폴더 생성."""
    root = _root(_entry(request, project_id))
    target = _resolve(root, _text_field(body, "path"))
    kind = _text_field(body, "kind")
    if kind not in {"file", "dir"}:
        raise HTTPException(status_code=422, detail="'kind'는 file 또는 dir여야 한다")
    if target.exists():
        raise HTTPException(status_code=409, detail="같은 경로가 이미 있다")
    if kind == "file":
        _require_py(target, "파이썬(.py) 파일만 만들 수 있다")
    try:
        if kind == "dir":
            target.mkdir(parents=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="경로를 만들지 못했다") from exc
    return {
        "path": relative_path(root, target),
        "is_dir": kind == "dir",
        "created_at": datetime.now(UTC).isoformat(),
    }


@router.post("/{project_id}/rename")
async def rename_path(request: Request, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """프로젝트 안에서의 이름 변경·이동. 파일이면 대상도 파이썬이어야 한다(D3)."""
    root = _root(_entry(request, project_id))
    source = _resolve(root, _text_field(body, "path"))
    destination = _resolve(root, _text_field(body, "to"))
    if not source.exists():
        raise HTTPException(status_code=404, detail="원본 경로가 존재하지 않는다")
    if destination.exists():
        raise HTTPException(status_code=409, detail="같은 경로가 이미 있다")
    if source.is_file():
        _require_py(destination, "파일은 파이썬(.py)으로만 이름을 바꿀 수 있다")
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)
    except OSError as exc:
        raise HTTPException(status_code=400, detail="이름을 바꾸지 못했다") from exc
    return {
        "path": relative_path(root, destination),
        "from": relative_path(root, source),
        "is_dir": destination.is_dir(),
    }


@router.delete("/{project_id}/file")
async def delete_path(request: Request, project_id: str, path: str) -> dict[str, Any]:
    """파일 하나 또는 **빈** 폴더 하나를 지운다. 내용이 있는 폴더는 409다."""
    root = _root(_entry(request, project_id))
    target = _resolve(root, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="경로가 존재하지 않는다")
    is_dir = target.is_dir()
    if is_dir and any(target.iterdir()):
        raise HTTPException(status_code=409, detail="비어 있지 않은 폴더는 지우지 않는다")
    relative = relative_path(root, target)
    try:
        target.rmdir() if is_dir else target.unlink()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="지우지 못했다") from exc
    return {"deleted": relative, "is_dir": is_dir}


# ── 프로젝트 환경 ─────────────────────────────────────────────────────────────
#
# 폴더 안의 `.venv` 하나가 "내 전략이 도는 환경"이다. 만드는 것은 돈도 할당량도 지나지
# 않는 준비 작업이라 대화가 몰아도 되는 경로다(WAVE-3 계약) — 사람 손이 필요한 자리는
# 실행·수집 승인·배포 쪽이지 여기가 아니다.


@router.get("/{project_id}/env")
async def project_env(request: Request, project_id: str) -> dict[str, Any]:
    """가상환경의 지금 상태 — 캐시가 아니라 지금 찍은 디스크다(`_project_view`와 같은 규율)."""
    root = _root(_entry(request, project_id))
    python = venv_python(root)
    packages = venv_packages(root) if python is not None else []
    return {
        "project_id": project_id,
        "exists": python is not None,
        "python": str(python) if python is not None else None,
        "packages": packages,
        "base_ok": all(name in packages for name in BASE_ENV_PACKAGES),
    }


@router.post("/{project_id}/env")
async def setup_project_env(
    request: Request, project_id: str, body: dict[str, Any] | None = None
) -> JSONResponse:
    """가상환경을 만들고 기본 패키지(pandas·numpy)와 요청분을 설치한다 — 202 + job_id.

    진행은 `GET /api/v1/backtest/jobs/{job_id}`가 보여준다. 같은 프로젝트의 환경 잡이
    아직 돌고 있으면 409다 — 같은 `.venv`에 pip을 둘 동시에 붙이면 무엇이 깔렸는지
    아무도 답할 수 없게 된다.
    """
    root = _root(_entry(request, project_id))
    raw = (body or {}).get("packages", [])
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="'packages'는 문자열 배열이어야 한다")
    packages: list[str] = []
    for item in raw:
        text = item.strip() if isinstance(item, str) else ""
        if not is_valid_package_spec(text):
            raise HTTPException(
                status_code=422,
                detail=f"설치할 수 있는 이름이 아니다: {item!r} (예: pandas, pandas==2.2.3)",
            )
        packages.append(text)

    runner = _env_runner(request)
    busy = runner.env_job_for(root)
    if busy is not None:
        raise HTTPException(
            status_code=409,
            detail=f"이 프로젝트의 환경 구성이 아직 돌고 있다 (job_id={busy.id})",
        )
    job_id = str(uuid4())
    runner.start_env(job_id, project_path=root, packages=packages)
    return JSONResponse(status_code=202, content={"job_id": job_id})
