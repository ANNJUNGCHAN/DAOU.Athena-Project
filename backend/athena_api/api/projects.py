"""프로젝트 파일 라우트 — 코드 탭이 내 컴퓨터의 진짜 폴더 위에서 도는 IDE가 되는 지점.

`backtest.py`와 같은 규율을 따른다: 별도 인증을 걸지 않고(로컬 앱이 유일한 호출자),
바디는 dict로 받아 한국어 4xx로 직접 번역한다. 다른 점은 **서브시스템 비활성 게이트가
거의 없다**는 것이다 — 이 라우트가 다루는 것은 사용자의 폴더뿐이라 켜고 끌 스위치가 없다.
예외는 `POST /{id}/env` 하나다(`_env_runner` 주석 참고).

두 가지 규칙이 이 모듈 전체를 지배한다.

1. **경로는 전부 `resolve_in_project()`를 지난다.** 절대 경로·`..`·드라이브 상대 경로·
   프로젝트 밖을 가리키는 심볼릭 링크는 400이다. 예외 없이 한 함수로 모은 이유는,
   경로 검사가 라우트마다 조금씩 다른 순간 그 틈이 바로 구멍이 되기 때문이다.
2. **확장자를 가리지 않는다.** 트리는 모든 항목을 보여주고 UTF-8 텍스트는 열고
   저장한다. 바이너리와 대용량 파일은 메타데이터만 돌려준다.

`DELETE /{project_id}`는 등록 해제일 뿐이다 — 디스크의 폴더를 지우지 않고, 응답이 그
사실을 말한다.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
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
    is_safe_project_name,
    relative_path,
    resolve_in_project,
    venv_packages,
    venv_python,
)

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

MAX_TERMINAL_OUTPUT_BYTES = 512 * 1024
MAX_TERMINAL_ARGS = 128
MAX_TERMINAL_ARG_BYTES = 16 * 1024
DEFAULT_TERMINAL_TIMEOUT_MS = 30_000
MAX_TERMINAL_TIMEOUT_MS = 120_000

TECHNIQUE_TEST_SOURCE = '''from pathlib import Path


def test_strategy_file_exists():
    assert (Path(__file__).parents[1] / "strategy.py").is_file()
'''

TECHNIQUE_SEED_SOURCE = '''# athena technique workspace
PARAMS = {}


def signals(df, p):
    result = df.copy()
    result["entry"] = False
    result["exit"] = False
    return result[["entry", "exit"]]
'''


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


@router.post("/{project_id}/relink")
async def relink_project(request: Request, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """폴더 다시 지정 — 같은 프로젝트 id의 경로만 새 폴더로 바꾼다(코드 감시 초안이
    "프로젝트 폴더 없음 — 다시 연결"로 막혔을 때의 그 「다시 연결」). 디스크는 건드리지 않는다."""
    path = _text_field(body, "path")
    try:
        entry = _store(request).relink(project_id, path)
    except KeyError:
        raise HTTPException(status_code=404, detail="프로젝트가 존재하지 않는다") from None
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


@router.post("/{project_id}/techniques")
async def create_technique_workspace(
    request: Request, project_id: str, body: dict[str, Any]
) -> JSONResponse:
    """기존 프로젝트 안에 새 기법 폴더를 만들고 프로젝트 환경 구성을 시작한다.

    `parent`는 프로젝트 기준 상대 경로인 기존 폴더이고, `name`은 기법 이름이자
    그 아래에 새로 만들 폴더명이다. 프로젝트 루트는 `parent="."`로 지정한다.
    """
    entry = _entry(request, project_id)
    project_root = _root(entry)
    name = _text_field(body, "name").strip()
    if not is_safe_project_name(name):
        raise HTTPException(status_code=422, detail="기법 이름은 경로 구분자·상위 참조 없는 한 조각이어야 한다")
    parent_text = _text_field(body, "parent").strip()
    parent = project_root if parent_text in {".", "./"} else _resolve(project_root, parent_text)
    if not parent.exists():
        raise HTTPException(status_code=404, detail="기법을 만들 상위 폴더가 존재하지 않는다")
    if not parent.is_dir():
        raise HTTPException(status_code=422, detail="기법을 만들 상위 경로가 폴더가 아니다")
    target_path = name if parent == project_root else f"{relative_path(project_root, parent)}/{name}"
    target = _resolve(project_root, target_path)
    if target.exists():
        raise HTTPException(status_code=409, detail="같은 기법 폴더가 이미 있다")

    # 환경 러너 없이 폴더만 만들어 놓는 부분 성공은 피한다.
    runner = _env_runner(request)
    try:
        target.mkdir()
        (target / "tests").mkdir()
        (target / SEED_STRATEGY_FILENAME).write_text(
            TECHNIQUE_SEED_SOURCE, encoding="utf-8", newline="\n"
        )
        (target / "tests" / "test_strategy.py").write_text(
            TECHNIQUE_TEST_SOURCE, encoding="utf-8", newline="\n"
        )
    except OSError as exc:
        shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(status_code=400, detail="기법 폴더를 만들지 못했다") from exc

    packages = venv_packages(project_root) if venv_python(project_root) is not None else []
    base_ok = all(package in packages for package in BASE_ENV_PACKAGES)
    environment_job_id: str | None = None
    environment_status = "ready" if base_ok else "running"
    if not base_ok:
        busy = runner.env_job_for(project_root)
        if busy is not None:
            environment_job_id = busy.id
        else:
            environment_job_id = str(uuid4())
            try:
                runner.start_env(environment_job_id, project_path=project_root, packages=[])
            except Exception as exc:
                shutil.rmtree(target, ignore_errors=True)
                raise HTTPException(
                    status_code=500, detail="프로젝트 환경 구성을 시작하지 못했다"
                ) from exc

    relative = relative_path(project_root, target)
    return JSONResponse(
        status_code=202 if environment_job_id else 200,
        content={
            "project_id": project_id,
            "technique": {
                "name": name,
                "path": relative,
                "strategy_path": f"{relative}/{SEED_STRATEGY_FILENAME}",
                "test_path": f"{relative}/tests/test_strategy.py",
            },
            "env": {
                "status": environment_status,
                "job_id": environment_job_id,
                "scope": "project",
            },
        },
    )


@router.get("/{project_id}/tree")
async def project_tree(
    request: Request, project_id: str, path: str | None = None
) -> dict[str, Any]:
    """폴더/파일 중첩 목록. 폴더 항목은 `children`을 갖는다."""
    entry = _entry(request, project_id)
    project_root = _root(entry)
    tree_root = _resolve(project_root, path) if path else project_root
    if not tree_root.exists():
        raise HTTPException(status_code=404, detail="폴더가 존재하지 않는다")
    if not tree_root.is_dir():
        raise HTTPException(status_code=400, detail="트리 기준 경로가 폴더가 아니다")
    entries, truncated = build_tree(tree_root, path_root=project_root)
    return {
        "project_id": entry.id,
        "root": str(tree_root),
        "path": relative_path(project_root, tree_root) if path else "",
        "entries": entries,
        "truncated": truncated,
    }


@router.get("/{project_id}/file")
async def read_file(request: Request, project_id: str, path: str) -> dict[str, Any]:
    """텍스트 파일은 열고, 바이너리와 대용량 파일은 메타데이터만 돌려준다."""
    root = _root(_entry(request, project_id))
    target = _resolve(root, path)
    if target.is_dir():
        raise HTTPException(status_code=400, detail="폴더는 열 수 없다")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="파일이 존재하지 않는다")
    stat = target.stat()
    if stat.st_size > MAX_FILE_BYTES:
        return {
            "path": relative_path(root, target), "kind": "binary", "binary": True,
            "editable": False, "reason": "too_large", "size": stat.st_size,
            "mtime": stat.st_mtime,
        }
    try:
        # newline=""로 읽어야 CRLF 파일을 열었다 저장하는 것만으로 줄바꿈이 바뀌지 않는다.
        with target.open("r", encoding="utf-8", newline="") as handle:
            text = handle.read()
    except UnicodeDecodeError as exc:
        return {
            "path": relative_path(root, target), "kind": "binary", "binary": True,
            "editable": False, "reason": "non_utf8", "size": stat.st_size,
            "mtime": stat.st_mtime,
        }
    if "\x00" in text:
        return {
            "path": relative_path(root, target), "kind": "binary", "binary": True,
            "editable": False, "reason": "binary", "size": stat.st_size,
            "mtime": stat.st_mtime,
        }
    return {
        "path": relative_path(root, target),
        "kind": "text",
        "text": text,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "encoding": "utf-8",
        "editable": True,
        "py": target.suffix.lower() == ".py",
    }


@router.put("/{project_id}/file")
async def write_file(request: Request, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """파일 저장 — 여기가 유일한 쓰기 경로다(D2: sqlite를 거치지 않는다)."""
    root = _root(_entry(request, project_id))
    target = _resolve(root, _text_field(body, "path"))
    text = _text_field(body, "text", allow_empty=True)
    root_path = body.get("root_path")
    if root_path is not None:
        if not isinstance(root_path, str) or not root_path.strip():
            raise HTTPException(
                status_code=422, detail="'root_path'는 비어 있지 않은 문자열이어야 한다"
            )
        scope = (
            root
            if root_path.strip().replace("\\", "/") in {".", "./"}
            else _resolve(root, root_path)
        )
        if not scope.is_dir():
            raise HTTPException(status_code=400, detail="기법 root_path가 존재하는 폴더가 아니다")
        try:
            target.relative_to(scope)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="파일 경로가 기법 root_path 밖이다"
            ) from exc
    if target.is_dir():
        raise HTTPException(status_code=400, detail="폴더에는 쓸 수 없다")
    if len(text.encode("utf-8")) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="텍스트 파일은 1MB 이하만 저장할 수 있다")
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
    """프로젝트 안에서의 파일·폴더 이름 변경과 이동."""
    root = _root(_entry(request, project_id))
    source = _resolve(root, _text_field(body, "path"))
    destination = _resolve(root, _text_field(body, "to"))
    if not source.exists():
        raise HTTPException(status_code=404, detail="원본 경로가 존재하지 않는다")
    if destination.exists():
        raise HTTPException(status_code=409, detail="같은 경로가 이미 있다")
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


def _terminal_argv(body: dict[str, Any]) -> list[str]:
    raw = body.get("argv")
    if not isinstance(raw, list) or not raw or len(raw) > MAX_TERMINAL_ARGS:
        raise HTTPException(
            status_code=422, detail=f"'argv'는 1~{MAX_TERMINAL_ARGS}개 문자열 배열이어야 한다"
        )
    argv: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item or "\x00" in item:
            raise HTTPException(status_code=422, detail="'argv'의 각 항목은 비어 있지 않은 문자열이어야 한다")
        if len(item.encode("utf-8")) > MAX_TERMINAL_ARG_BYTES:
            raise HTTPException(status_code=422, detail="터미널 인자가 너무 길다")
        argv.append(item)
    return argv


def _terminal_timeout(body: dict[str, Any]) -> int:
    raw = body.get("timeout_ms", DEFAULT_TERMINAL_TIMEOUT_MS)
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise HTTPException(status_code=422, detail="'timeout_ms'는 정수여야 한다")
    if raw < 100 or raw > MAX_TERMINAL_TIMEOUT_MS:
        raise HTTPException(
            status_code=422,
            detail=f"'timeout_ms'는 100~{MAX_TERMINAL_TIMEOUT_MS} 밀리초여야 한다",
        )
    return raw


def _read_terminal_capture(handle: Any) -> tuple[str, bool]:
    handle.seek(0)
    data = handle.read(MAX_TERMINAL_OUTPUT_BYTES + 1)
    truncated = len(data) > MAX_TERMINAL_OUTPUT_BYTES
    return data[:MAX_TERMINAL_OUTPUT_BYTES].decode("utf-8", errors="replace"), truncated


@router.post("/{project_id}/terminal")
async def run_project_terminal(
    request: Request, project_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """`shell=False`로 argv 하나를 프로젝트 안 cwd에서 실행한다.

    cwd 검사는 시작 위치를 프로젝트 안으로 고정한다. 다만 실행된 프로그램 자체가
    절대경로로 다른 파일을 읽는 것까지 OS 샌드박스처럼 막지는 않는다.
    """
    project_root = _root(_entry(request, project_id))
    cwd_input = body.get("cwd", ".")
    if not isinstance(cwd_input, str):
        raise HTTPException(status_code=422, detail="'cwd'는 문자열이어야 한다")
    cwd = project_root if cwd_input.strip() in {"", ".", "./"} else _resolve(project_root, cwd_input)
    if not cwd.exists():
        raise HTTPException(status_code=404, detail="터미널 작업 폴더가 존재하지 않는다")
    if not cwd.is_dir():
        raise HTTPException(status_code=422, detail="터미널 cwd가 폴더가 아니다")
    argv = _terminal_argv(body)
    timeout_ms = _terminal_timeout(body)

    environment = os.environ.copy()
    python = venv_python(project_root)
    if python is not None:
        scripts = str(python.parent)
        environment["VIRTUAL_ENV"] = str(python.parent.parent)
        environment["PATH"] = scripts + os.pathsep + environment.get("PATH", "")
    environment["ATHENA_PROJECT_ROOT"] = str(project_root)

    with tempfile.TemporaryFile() as stdout_capture, tempfile.TemporaryFile() as stderr_capture:
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(cwd),
                env=environment,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=stdout_capture,
                stderr=stderr_capture,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=422, detail=f"명령을 찾을 수 없다: {argv[0]}") from exc
        except OSError as exc:
            raise HTTPException(status_code=400, detail="터미널 명령을 시작하지 못했다") from exc

        timed_out = False
        try:
            await asyncio.wait_for(process.wait(), timeout=timeout_ms / 1000)
        except TimeoutError:
            timed_out = True
            process.kill()
            await process.wait()
        stdout, stdout_truncated = _read_terminal_capture(stdout_capture)
        stderr, stderr_truncated = _read_terminal_capture(stderr_capture)

    return {
        "project_id": project_id,
        "cwd": relative_path(project_root, cwd) if cwd != project_root else "",
        "argv": argv,
        "exit_code": process.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "timed_out": timed_out,
        "stdout_truncated": stdout_truncated,
        "stderr_truncated": stderr_truncated,
    }


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
