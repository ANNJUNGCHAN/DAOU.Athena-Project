"""프로젝트 저장층 — 레지스트리 왕복·손상 복구·경로 안전·트리(계약 D1·D2·D3).

이 파일의 무게중심은 `resolve_in_project`다. 나머지가 다 맞아도 저 함수가 한 번 뚫리면
"내 컴퓨터의 폴더 하나를 점유한다"는 계약이 "내 컴퓨터를 점유한다"가 된다. 그래서
`..`·절대 경로·드라이브 상대 경로·심볼릭 링크 탈출을 각각 따로 세운다.

실제 `~/.athena`는 건드리지 않는다 — 전부 tmp_path 아래다.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from athena_api.projects.store import (
    ProjectExistsError,
    ProjectMissingError,
    ProjectNameError,
    ProjectNotADirectoryError,
    ProjectPathError,
    ProjectStore,
    build_tree,
    count_py_files,
    is_safe_project_name,
    is_valid_package_spec,
    relative_path,
    resolve_in_project,
    venv_packages,
    venv_python,
    venv_site_packages,
)

# 결정층(leaf 9): 파일 시스템 위의 순수 조작이다. LLM도 난수도 없다.
pytestmark = pytest.mark.deterministic


def _store(tmp_path: Path) -> ProjectStore:
    return ProjectStore(tmp_path / "projects")


# ── 레지스트리 ────────────────────────────────────────────────────────────────


def test_registry_round_trips_across_store_instances(tmp_path: Path) -> None:
    store = _store(tmp_path)
    entry = store.create_managed("알파")

    reopened = ProjectStore(store.root)
    snapshot = reopened.load()

    assert snapshot.notice is None
    assert [e.id for e in snapshot.entries] == [entry.id]
    assert snapshot.entries[0].name == "알파"
    assert snapshot.entries[0].kind == "managed"
    assert snapshot.entries[0].path == (store.root / "알파").resolve()
    assert reopened.get(entry.id) is not None
    assert reopened.get("없는-id") is None


def test_registry_write_is_atomic_and_leaves_no_temp_file(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.create_managed("a")
    store.create_managed("b")

    assert store.registry_path.exists()
    assert list(store.root.glob("*.tmp")) == []
    payload = json.loads(store.registry_path.read_text(encoding="utf-8"))
    assert [row["name"] for row in payload["projects"]] == ["a", "b"]


def test_missing_registry_starts_empty_and_says_so(tmp_path: Path) -> None:
    snapshot = _store(tmp_path).load()

    assert snapshot.entries == ()
    assert snapshot.notice is not None
    assert "빈 목록" in snapshot.notice


def test_corrupt_registry_recovers_and_preserves_the_broken_file(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.create_managed("a")
    store.registry_path.write_text("{ 이건 JSON이 아니다", encoding="utf-8")

    snapshot = store.load()

    assert snapshot.entries == ()
    assert snapshot.notice is not None
    assert "손상" in snapshot.notice
    assert (store.root / "registry.corrupt.json").exists()
    # 강등 후에도 쓰기는 계속 된다 — 빈 목록에서 다시 시작한다.
    store.create_managed("b")
    assert [e.name for e in store.load().entries] == ["b"]


def test_registry_missing_projects_key_is_treated_as_corrupt(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save(())
    store.registry_path.write_text(json.dumps({"saved_at": "x"}), encoding="utf-8")

    snapshot = store.load()

    assert snapshot.entries == ()
    assert snapshot.notice is not None and "손상" in snapshot.notice


# ── 생성·등록·해제 ────────────────────────────────────────────────────────────


def test_create_managed_seeds_the_section_7_1_contract(tmp_path: Path) -> None:
    entry = _store(tmp_path).create_managed("전략들")

    seed = entry.path / "strategy.py"
    text = seed.read_text(encoding="utf-8")
    assert "PARAMS" in text
    assert "def signals(df, p):" in text
    assert "import athena_bt as bt" in text
    assert '"entry", "exit"' in text
    # 씨앗은 윈도우에서도 LF다 — 편집기가 여는 첫 파일이 줄바꿈으로 시끄러우면 안 된다.
    assert b"\r\n" not in seed.read_bytes()


def test_create_managed_rejects_unsafe_names(tmp_path: Path) -> None:
    store = _store(tmp_path)
    for name in ("../탈출", "a/b", "a\\b", ".hidden", "..", "C:evil", "끝점.", "CON"):
        with pytest.raises(ProjectNameError):
            store.create_managed(name)


def test_create_managed_rejects_duplicate_folder(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.create_managed("dup")
    with pytest.raises(ProjectExistsError):
        store.create_managed("dup")


def test_open_external_registers_without_creating_anything(tmp_path: Path) -> None:
    outside = tmp_path / "내폴더"
    outside.mkdir()
    (outside / "quant.py").write_text("x = 1\n", encoding="utf-8")
    store = _store(tmp_path)

    entry = store.open_external(str(outside))

    assert entry.kind == "external"
    assert entry.name == "내폴더"
    assert sorted(p.name for p in outside.iterdir()) == ["quant.py"]
    with pytest.raises(ProjectExistsError):
        store.open_external(str(outside))


def test_open_external_rejects_missing_and_non_directory(tmp_path: Path) -> None:
    store = _store(tmp_path)
    a_file = tmp_path / "그냥파일.txt"
    a_file.write_text("x", encoding="utf-8")

    with pytest.raises(ProjectMissingError):
        store.open_external(str(tmp_path / "없는폴더"))
    with pytest.raises(ProjectNotADirectoryError):
        store.open_external(str(a_file))
    with pytest.raises(ProjectNameError):
        store.open_external("   ")


def test_unregister_removes_the_row_but_never_the_files(tmp_path: Path) -> None:
    store = _store(tmp_path)
    entry = store.create_managed("보존")

    removed = store.unregister(entry.id)

    assert removed is not None and removed.id == entry.id
    assert store.load().entries == ()
    assert entry.path.is_dir()
    assert (entry.path / "strategy.py").is_file()
    assert store.unregister(entry.id) is None


# ── 경로 안전 ────────────────────────────────────────────────────────────────


def test_resolve_in_project_accepts_nested_paths(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()

    target = resolve_in_project(root, "pkg/sub/strategy.py")

    assert target == (root / "pkg" / "sub" / "strategy.py").resolve()
    assert relative_path(root, target) == "pkg/sub/strategy.py"
    # 앞의 ./와 역슬래시 표기도 같은 자리를 가리킨다.
    assert resolve_in_project(root, "./pkg/strategy.py") == (root / "pkg" / "strategy.py").resolve()
    assert resolve_in_project(root, "pkg\\strategy.py") == (root / "pkg" / "strategy.py").resolve()


@pytest.mark.parametrize(
    "candidate",
    [
        "",
        "   ",
        ".",
        "..",
        "../secret.py",
        "pkg/../../secret.py",
        "..\\secret.py",
        "/etc/passwd",
        "//server/share/secret.py",
        "C:/Windows/system32/evil.py",
        "C:evil.py",
        "c:evil.py",
    ],
)
def test_resolve_in_project_rejects_escapes(tmp_path: Path, candidate: str) -> None:
    root = tmp_path / "proj"
    root.mkdir()

    with pytest.raises(ProjectPathError):
        resolve_in_project(root, candidate)


def test_resolve_in_project_rejects_symlink_pointing_outside(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.py").write_text("훔친다\n", encoding="utf-8")

    link = root / "escape"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:  # 윈도우: 개발자 모드/관리자 없이는 못 만든다
        pytest.skip(f"이 환경에서 심볼릭 링크를 만들 수 없어 탈출 사례를 건너뛴다: {exc}")

    with pytest.raises(ProjectPathError):
        resolve_in_project(root, "escape/secret.py")


def test_is_safe_project_name_boundaries() -> None:
    assert is_safe_project_name("모멘텀_v2")
    assert is_safe_project_name("a.b")
    assert is_safe_project_name("x" * 64)
    assert not is_safe_project_name("x" * 65)
    assert not is_safe_project_name(" 앞뒤공백 ")
    assert not is_safe_project_name("nul\x00byte")
    assert not is_safe_project_name("LPT1.py")


# ── 트리·집계 ────────────────────────────────────────────────────────────────


def _seed_tree(root: Path) -> None:
    (root / ".git").mkdir(parents=True)
    (root / ".git" / "HEAD").write_text("ref\n", encoding="utf-8")
    (root / ".venv" / "Lib").mkdir(parents=True)
    (root / "__pycache__").mkdir()
    (root / "node_modules").mkdir()
    (root / ".hidden").mkdir()
    (root / "pkg").mkdir()
    (root / "pkg" / "inner.py").write_text("y = 2\n", encoding="utf-8")
    (root / "strategy.py").write_text("x = 1\n", encoding="utf-8")
    (root / "data.csv").write_text("a,b\n", encoding="utf-8")


def test_build_tree_shows_every_directory_and_non_python_file(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    _seed_tree(root)

    entries, truncated = build_tree(root)

    assert truncated is False
    names = [e["name"] for e in entries]
    assert names == [
        ".git", ".hidden", ".venv", "__pycache__", "node_modules", "pkg",
        "data.csv", "strategy.py",
    ]  # 폴더 먼저, 그 다음 파일 이름순
    by_name = {e["name"]: e for e in entries}
    assert by_name["strategy.py"]["py"] is True
    assert by_name["data.csv"]["py"] is False  # 데이터는 보이되 편집 대상이 아니다(D3)
    assert by_name["data.csv"]["size"] > 0
    assert by_name["pkg"]["is_dir"] is True
    assert by_name["pkg"]["children"][0]["path"] == "pkg/inner.py"


def test_build_tree_reports_truncation_honestly(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    for i in range(6):
        (root / f"m{i}.py").write_text("x = 1\n", encoding="utf-8")

    entries, truncated = build_tree(root, limit=3)

    assert truncated is True
    assert len(entries) == 3

    all_entries, all_truncated = build_tree(root, limit=50)
    assert all_truncated is False
    assert len(all_entries) == 6


def test_count_py_files_skips_ignored_dirs_and_honours_cap(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    _seed_tree(root)
    (root / "__pycache__" / "cached.py").write_text("x = 1\n", encoding="utf-8")

    assert count_py_files(root) == 2  # strategy.py + pkg/inner.py, 캐시는 세지 않는다
    assert count_py_files(root, cap=1) == 1


# ── 프로젝트 가상환경 ────────────────────────────────────────────────────────


def test_venv_python_is_none_until_a_real_interpreter_is_there(tmp_path: Path) -> None:
    """폴더만 있는 것과 환경이 있는 것은 다르다 — `.venv/`가 있어도 인터프리터가 없으면
    "없음"이다(빈 껍데기를 환경이라고 부르면 실행이 그 거짓말 위에서 터진다)."""
    root = tmp_path / "proj"
    (root / ".venv").mkdir(parents=True)

    assert venv_python(root) is None
    assert venv_packages(root) == []


def test_venv_python_finds_both_windows_and_posix_layouts(tmp_path: Path) -> None:
    """윈도우는 `Scripts/python.exe`, POSIX는 `bin/python`이다. 지금 도는 OS로 고르지 않고
    둘 다 찾는다 — 프로젝트 폴더는 사용자 디스크의 물건이라 다른 OS에서 만들어져 올 수 있다."""
    windows = tmp_path / "win"
    (windows / ".venv" / "Scripts").mkdir(parents=True)
    (windows / ".venv" / "Scripts" / "python.exe").write_bytes(b"")

    posix = tmp_path / "nix"
    (posix / ".venv" / "bin").mkdir(parents=True)
    (posix / ".venv" / "bin" / "python").write_bytes(b"")

    assert venv_python(windows) == (windows / ".venv" / "Scripts" / "python.exe").resolve()
    assert venv_python(posix) == (posix / ".venv" / "bin" / "python").resolve()


def test_venv_helpers_read_a_real_venv(tmp_path: Path) -> None:
    """진짜 `python -m venv`로 만든 환경을 읽는다 — 가짜 파일 배치가 아니라 실제 레이아웃.

    `--without-pip`인 이유는 하나뿐이다: 네트워크도 ensurepip도 필요 없어 빠르다. 확인하려는
    것은 "인터프리터가 실제로 돈다"와 "dist-info를 읽어 이름을 센다"라 pip이 필요 없다.
    """
    root = tmp_path / "proj"
    root.mkdir()
    subprocess.run(
        [sys.executable, "-m", "venv", "--without-pip", str(root / ".venv")],
        check=True,
        capture_output=True,
        timeout=180,
    )

    interpreter = venv_python(root)
    assert interpreter is not None and interpreter.is_file()
    # 경로만 맞는 게 아니라 실제로 도는 인터프리터여야 한다.
    probe = subprocess.run(
        [str(interpreter), "-c", "import sys; print(sys.executable)"],
        check=True, capture_output=True, text=True, timeout=60,
    )
    assert Path(probe.stdout.strip()) == interpreter

    site = venv_site_packages(root)
    assert site is not None and site.is_dir()
    assert venv_packages(root) == []

    # dist-info 폴더 이름이 곧 답이다 — PEP 427 이스케이프를 거쳐 이미 import 이름 모양이다.
    for name in ("pandas-2.3.3.dist-info", "numpy-2.5.2.dist-info", "httpx_sse-0.4.3.dist-info"):
        (site / name).mkdir()
    (site / "not-a-dist-info").mkdir()

    assert venv_packages(root) == ["httpx_sse", "numpy", "pandas"]


def test_package_spec_allows_names_and_pins_and_nothing_else() -> None:
    """설치 요청에 실릴 수 있는 것은 이름과 고정 버전뿐이다 — 셸 조각·옵션·경로는 전부 거짓."""
    for good in ("pandas", "numpy", "scikit-learn", "httpx_sse", "pandas==2.2.3", "ta-lib==0.4.0"):
        assert is_valid_package_spec(good) is True, good
    for bad in (
        "pandas; rm -rf",
        "pandas && echo",
        "pandas | tee x",
        "-r requirements.txt",
        "--index-url http://evil",
        "../../etc/passwd",
        r"C:\pkg\evil.whl",
        "https://evil/x.whl",
        "pandas 2.2.3",
        "",
        "p" * 129,
    ):
        assert is_valid_package_spec(bad) is False, bad


# ── 폴더 다시 지정(relink) ────────────────────────────────────────────────────


def test_relink_moves_only_the_path_and_unblocks_the_watch_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """옮겨진 폴더를 같은 id로 다시 잇는다 — 그 id를 든 코드 감시 초안이 살아난다."""
    from athena_api.projects import store as store_module
    from athena_api.routines.runtime import resolve_watch_file

    store = _store(tmp_path)
    old = tmp_path / "옛자리"
    old.mkdir()
    entry = store.open_external(str(old), "감시 프로젝트")
    new = tmp_path / "새자리"
    old.rename(new)
    (new / "watch").mkdir()
    (new / "watch" / "volume_spike.py").write_text("def signals(df, p):\n    return df\n", encoding="utf-8")
    monkeypatch.setattr(
        store_module, "resolve_project_path", lambda project_id: store.get(project_id).path
    )
    with pytest.raises(ProjectMissingError):
        resolve_watch_file(entry.id, "watch/volume_spike.py")

    relinked = store.relink(entry.id, str(new))

    assert relinked.id == entry.id
    assert relinked.name == "감시 프로젝트"
    assert relinked.kind == "external"
    assert relinked.created_at == entry.created_at
    assert relinked.path == new.resolve()
    assert [row.id for row in store.load().entries] == [entry.id]
    assert resolve_watch_file(entry.id, "watch/volume_spike.py") == (new / "watch" / "volume_spike.py").resolve()
    assert sorted(p.name for p in new.iterdir()) == ["watch"]


def test_relink_rejects_unknown_id_missing_folder_file_and_occupied_folder(tmp_path: Path) -> None:
    store = _store(tmp_path)
    mine = tmp_path / "mine"
    mine.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    entry = store.open_external(str(mine))
    store.open_external(str(other))
    a_file = tmp_path / "파일.txt"
    a_file.write_text("x", encoding="utf-8")

    with pytest.raises(KeyError):
        store.relink("없는-id", str(mine))
    with pytest.raises(ProjectMissingError):
        store.relink(entry.id, str(tmp_path / "없는폴더"))
    with pytest.raises(ProjectNotADirectoryError):
        store.relink(entry.id, str(a_file))
    with pytest.raises(ProjectNameError):
        store.relink(entry.id, "  ")
    with pytest.raises(ProjectExistsError):
        store.relink(entry.id, str(other))
    # 자기 자신의 현재 폴더로 다시 지정하는 것은 거절이 아니다(드라이브가 돌아온 경우).
    assert store.relink(entry.id, str(mine)).path == mine.resolve()
