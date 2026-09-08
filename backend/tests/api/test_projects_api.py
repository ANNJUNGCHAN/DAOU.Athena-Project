"""프로젝트 파일 라우트 — 모든 성공 경로와 모든 오류 분기(계약 D1·D2·D3).

키움도 sqlite도 부르지 않는다. 이 기능의 진실은 디스크의 파일이라(D2) 테스트도 파일만
본다 — 응답이 200이라고 말하면 실제로 tmp_path 아래에 그 파일이 있어야 한다.

두 가지를 특히 못 박는다. ① `DELETE /{id}`는 등록만 해제하고 폴더는 그대로 둔다.
② 파이썬이 아닌 파일은 트리에 보이되 열거나 쓰면 415다.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app
from athena_api.projects.store import MAX_FILE_BYTES, venv_site_packages

BASE = "/api/v1/projects"
JOBS = "/api/v1/backtest/jobs"


def _client(tmp_path: Path) -> TestClient:
    app = create_app(Settings(_env_file=None, projects_root=tmp_path / "projects"))
    return TestClient(app)


def _env_client(tmp_path: Path) -> TestClient:
    """환경 라우트만 백테스트 러너를 빌린다 — 잡 진행 폴링이 `GET /backtest/jobs` 하나로
    모여 있어서다(api/projects.py `_env_runner`). 러너는 lifespan이 만들므로 `with`로 연다."""
    app = create_app(
        Settings(
            _env_file=None,
            projects_root=tmp_path / "projects",
            backtest_enabled=True,
            backtest_db_path=tmp_path / "backtest.sqlite3",
        )
    )
    return TestClient(app)


def _await_job(client: TestClient, job_id: str) -> None:
    job = client.app.state.backtest_runner.get(job_id)
    assert job is not None and job.task is not None
    client.portal.call(lambda: job.task)


def _create(client: TestClient, name: str = "알파") -> dict:
    response = client.post(BASE, json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["project"]


# ── 목록·생성·열기·해제 ───────────────────────────────────────────────────────


def test_list_starts_empty_and_says_the_registry_is_not_there_yet(tmp_path: Path) -> None:
    body = _client(tmp_path).get(BASE).json()

    assert body["projects"] == []
    assert body["notice"] is not None and "빈 목록" in body["notice"]


def test_create_managed_project_makes_a_real_folder_with_the_seed(tmp_path: Path) -> None:
    client = _client(tmp_path)

    created = client.post(BASE, json={"name": "모멘텀"})
    assert created.status_code == 200, created.text
    payload = created.json()
    assert payload["seed"] == "strategy.py"
    project = payload["project"]
    assert project["kind"] == "managed"
    assert project["exists"] is True
    assert project["py_files"] == 1

    folder = Path(project["path"])
    assert folder == (tmp_path / "projects" / "모멘텀")
    seed = (folder / "strategy.py").read_text(encoding="utf-8")
    assert "def signals(df, p):" in seed and "import athena_bt as bt" in seed

    listed = client.get(BASE).json()
    assert listed["notice"] is None
    assert [p["id"] for p in listed["projects"]] == [project["id"]]
    assert listed["projects"][0]["py_files"] == 1


def test_create_rejects_duplicate_name_and_unsafe_name_and_missing_field(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _create(client, "dup")

    assert client.post(BASE, json={"name": "dup"}).status_code == 409
    unsafe = client.post(BASE, json={"name": "../탈출"})
    assert unsafe.status_code == 422
    assert "한 조각" in unsafe.json()["detail"]
    assert client.post(BASE, json={}).status_code == 422


def test_open_existing_folder_registers_it_untouched(tmp_path: Path) -> None:
    client = _client(tmp_path)
    outside = tmp_path / "내계량투자"
    outside.mkdir()
    (outside / "quant.py").write_text("x = 1\n", encoding="utf-8")
    (outside / "returns.csv").write_text("a,b\n", encoding="utf-8")

    opened = client.post(f"{BASE}/open", json={"path": str(outside)})
    assert opened.status_code == 200, opened.text
    project = opened.json()["project"]
    assert project["kind"] == "external"
    assert project["name"] == "내계량투자"
    assert project["py_files"] == 1
    assert sorted(p.name for p in outside.iterdir()) == ["quant.py", "returns.csv"]

    assert client.post(f"{BASE}/open", json={"path": str(outside)}).status_code == 409


def test_open_takes_the_name_the_person_typed(tmp_path: Path) -> None:
    """만들기 화면(36)은 폴더 이름을 기본값으로 채워 두고 사람이 고칠 수 있게 한다."""
    client = _client(tmp_path)
    outside = tmp_path / "kiwoom-research"
    outside.mkdir()

    opened = client.post(f"{BASE}/open", json={"path": str(outside), "name": "키움 리서치"})
    assert opened.status_code == 200, opened.text
    assert opened.json()["project"]["name"] == "키움 리서치"

    # 빈 이름은 폴더 이름으로 조용히 되돌리지 않는다 — 화면이 만들기를 잠그는 자리다.
    other = tmp_path / "other"
    other.mkdir()
    assert client.post(f"{BASE}/open", json={"path": str(other), "name": "  "}).status_code == 422


def test_open_reports_missing_folder_and_file_path(tmp_path: Path) -> None:
    client = _client(tmp_path)
    a_file = tmp_path / "메모.txt"
    a_file.write_text("x", encoding="utf-8")

    assert client.post(f"{BASE}/open", json={"path": str(tmp_path / "없다")}).status_code == 404
    not_dir = client.post(f"{BASE}/open", json={"path": str(a_file)})
    assert not_dir.status_code == 422
    assert "폴더가 아니라" in not_dir.json()["detail"]
    assert client.post(f"{BASE}/open", json={}).status_code == 422


def test_delete_unregisters_and_never_removes_files_from_disk(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "보존")
    folder = Path(project["path"])

    response = client.delete(f"{BASE}/{project['id']}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["files_deleted"] is False
    assert "그대로" in body["detail"]
    assert folder.is_dir()
    assert (folder / "strategy.py").is_file()
    assert client.get(BASE).json()["projects"] == []
    assert client.delete(f"{BASE}/{project['id']}").status_code == 404


def test_relink_points_the_same_project_at_a_new_folder(tmp_path: Path) -> None:
    """「프로젝트 폴더 없음 — 다시 연결」의 그 다시 연결 — id는 그대로, 경로만 바뀐다."""
    client = _client(tmp_path)
    old = tmp_path / "옛자리"
    old.mkdir()
    (old / "quant.py").write_text("x = 1\n", encoding="utf-8")
    project = client.post(f"{BASE}/open", json={"path": str(old), "name": "리서치"}).json()["project"]
    new = tmp_path / "새자리"
    old.rename(new)
    assert client.get(BASE).json()["projects"][0]["exists"] is False

    relinked = client.post(f"{BASE}/{project['id']}/relink", json={"path": str(new)})
    assert relinked.status_code == 200, relinked.text
    view = relinked.json()["project"]
    assert view["id"] == project["id"]
    assert view["name"] == "리서치"
    assert view["exists"] is True
    assert view["py_files"] == 1
    assert Path(view["path"]) == new.resolve()
    assert [row["id"] for row in client.get(BASE).json()["projects"]] == [project["id"]]
    assert client.get(f"{BASE}/{project['id']}/tree").status_code == 200
    assert sorted(p.name for p in new.iterdir()) == ["quant.py"]


def test_relink_reports_every_refusal(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "하나")
    other = _create(client, "둘")
    a_file = tmp_path / "메모.txt"
    a_file.write_text("x", encoding="utf-8")

    assert client.post(f"{BASE}/없는-id/relink", json={"path": str(tmp_path)}).status_code == 404
    assert client.post(f"{BASE}/{project['id']}/relink", json={"path": str(tmp_path / "없다")}).status_code == 404
    assert client.post(f"{BASE}/{project['id']}/relink", json={"path": str(a_file)}).status_code == 422
    assert client.post(f"{BASE}/{project['id']}/relink", json={}).status_code == 422
    taken = client.post(f"{BASE}/{project['id']}/relink", json={"path": other["path"]})
    assert taken.status_code == 409
    assert "다른 프로젝트" in taken.json()["detail"]


def test_unknown_project_id_is_404_on_every_file_route(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _create(client)

    assert client.get(f"{BASE}/nope/tree").status_code == 404
    assert client.get(f"{BASE}/nope/file", params={"path": "a.py"}).status_code == 404
    assert client.put(f"{BASE}/nope/file", json={"path": "a.py", "text": ""}).status_code == 404
    made = client.post(f"{BASE}/nope/file", json={"path": "a.py", "kind": "file"})
    assert made.status_code == 404
    renamed = client.post(f"{BASE}/nope/rename", json={"path": "a.py", "to": "b.py"})
    assert renamed.status_code == 404
    assert client.delete(f"{BASE}/nope/file", params={"path": "a.py"}).status_code == 404


def test_vanished_project_folder_is_reported_not_pretended(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "사라짐")
    shutil.rmtree(project["path"])

    listed = client.get(BASE).json()["projects"][0]
    assert listed["exists"] is False
    assert listed["py_files"] == 0
    gone = client.get(f"{BASE}/{project['id']}/tree")
    assert gone.status_code == 404
    assert "디스크에 없다" in gone.json()["detail"]


def test_corrupt_registry_is_surfaced_in_the_list_response(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _create(client)
    (tmp_path / "projects" / "registry.json").write_text("아무말", encoding="utf-8")

    body = client.get(BASE).json()

    assert body["projects"] == []
    assert body["notice"] is not None and "손상" in body["notice"]
    assert (tmp_path / "projects" / "registry.corrupt.json").exists()


# ── 트리 ─────────────────────────────────────────────────────────────────────


def test_tree_nests_folders_and_skips_the_ignore_list(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "트리")
    root = Path(project["path"])
    (root / ".git").mkdir()
    (root / "__pycache__").mkdir()
    (root / "node_modules").mkdir()
    (root / ".venv").mkdir()
    (root / "pkg").mkdir()
    (root / "pkg" / "inner.py").write_text("y = 2\n", encoding="utf-8")
    (root / "returns.csv").write_text("a,b\n", encoding="utf-8")

    body = client.get(f"{BASE}/{project['id']}/tree").json()

    assert body["truncated"] is False
    assert body["root"] == str(root)
    names = [e["name"] for e in body["entries"]]
    assert names == ["pkg", "returns.csv", "strategy.py"]
    folder = body["entries"][0]
    assert folder["is_dir"] is True
    inner = folder["children"][0]
    assert len(folder["children"]) == 1
    assert inner["name"] == "inner.py"
    assert inner["path"] == "pkg/inner.py"
    assert inner["is_dir"] is False and inner["py"] is True
    assert inner["size"] == (root / "pkg" / "inner.py").stat().st_size
    assert [e["py"] for e in body["entries"][1:]] == [False, True]


# ── 파일 읽기 ─────────────────────────────────────────────────────────────────


def test_read_file_returns_text_size_and_mtime(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "읽기")

    body = client.get(f"{BASE}/{project['id']}/file", params={"path": "strategy.py"}).json()

    assert body["path"] == "strategy.py"
    assert body["py"] is True
    assert "def signals(df, p):" in body["text"]
    assert body["size"] == len(body["text"].encode("utf-8"))
    assert body["mtime"] > 0


def test_read_file_rejects_non_python_missing_oversized_and_escapes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "거부")
    root = Path(project["path"])
    (root / "returns.csv").write_text("a,b\n", encoding="utf-8")
    (root / "huge.py").write_bytes(b"#" * (MAX_FILE_BYTES + 1))
    (tmp_path / "secret.py").write_text("훔친다\n", encoding="utf-8")

    def _get(path: str):
        return client.get(f"{BASE}/{project['id']}/file", params={"path": path})

    non_python = _get("returns.csv")
    assert non_python.status_code == 415
    assert "파이썬" in non_python.json()["detail"]
    assert _get("없는파일.py").status_code == 404
    too_big = _get("huge.py")
    assert too_big.status_code == 413
    assert "1MB" in too_big.json()["detail"]
    for escape in ("../secret.py", "/etc/passwd", "C:/Windows/evil.py", "pkg/../../secret.py"):
        assert _get(escape).status_code == 400, escape
    assert _get("").status_code == 400


def test_read_file_rejects_non_utf8_bytes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "인코딩")
    (Path(project["path"]) / "cp949.py").write_bytes("주석\n".encode("cp949"))

    response = client.get(f"{BASE}/{project['id']}/file", params={"path": "cp949.py"})

    assert response.status_code == 415
    assert "UTF-8" in response.json()["detail"]


# ── 파일 쓰기 ─────────────────────────────────────────────────────────────────


def test_write_file_creates_parent_directories(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "쓰기")

    response = client.put(
        f"{BASE}/{project['id']}/file",
        json={"path": "pkg/sub/mine.py", "text": "PARAMS = {}\n"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["path"] == "pkg/sub/mine.py"
    assert body["size"] == 12
    assert body["mtime"] > 0
    written = Path(project["path"]) / "pkg" / "sub" / "mine.py"
    assert written.read_text(encoding="utf-8") == "PARAMS = {}\n"


def test_write_file_round_trips_exactly_including_crlf(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "줄바꿈")
    text = "a = 1\r\nb = 2\r\n"

    client.put(f"{BASE}/{project['id']}/file", json={"path": "crlf.py", "text": text})
    read_back = client.get(f"{BASE}/{project['id']}/file", params={"path": "crlf.py"}).json()

    assert read_back["text"] == text
    assert (Path(project["path"]) / "crlf.py").read_bytes() == text.encode("utf-8")


def test_write_file_is_python_only_and_stays_inside_the_project(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "쓰기거부")

    def _put(path: str, text: str = "x = 1\n"):
        return client.put(f"{BASE}/{project['id']}/file", json={"path": path, "text": text})

    non_python = _put("메모.txt")
    assert non_python.status_code == 415
    assert "파이썬" in non_python.json()["detail"]
    assert _put("../탈출.py").status_code == 400
    assert _put("C:/Windows/evil.py").status_code == 400
    assert client.put(f"{BASE}/{project['id']}/file", json={"path": "a.py"}).status_code == 422
    assert not (tmp_path / "탈출.py").exists()


def test_write_file_reports_an_unwritable_path_without_a_traceback(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "막힌경로")

    # strategy.py는 파일이다 — 그 아래에 폴더를 만들 수 없다(OSError → 400).
    response = client.put(
        f"{BASE}/{project['id']}/file", json={"path": "strategy.py/child.py", "text": "x = 1\n"}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "파일을 저장하지 못했다"


# ── 생성·이름 변경·삭제 ───────────────────────────────────────────────────────


def test_create_empty_python_file_and_directory(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "만들기")
    root = Path(project["path"])

    made_dir = client.post(f"{BASE}/{project['id']}/file", json={"path": "pkg", "kind": "dir"})
    assert made_dir.status_code == 200, made_dir.text
    assert made_dir.json()["path"] == "pkg"
    assert made_dir.json()["is_dir"] is True
    assert made_dir.json()["created_at"].endswith("+00:00")
    assert (root / "pkg").is_dir()

    made_file = client.post(
        f"{BASE}/{project['id']}/file", json={"path": "pkg/new.py", "kind": "file"}
    )
    assert made_file.status_code == 200, made_file.text
    assert made_file.json()["is_dir"] is False
    assert (root / "pkg" / "new.py").read_text(encoding="utf-8") == ""


def test_create_rejects_existing_path_non_python_and_bad_kind(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "만들기거부")

    def _post(path: str, kind: str = "file"):
        return client.post(f"{BASE}/{project['id']}/file", json={"path": path, "kind": kind})

    assert _post("strategy.py").status_code == 409
    non_python = _post("메모.txt")
    assert non_python.status_code == 415
    assert "파이썬" in non_python.json()["detail"]
    bad_kind = _post("a.py", "socket")
    assert bad_kind.status_code == 422
    assert "file 또는 dir" in bad_kind.json()["detail"]
    assert _post("../밖.py").status_code == 400


def test_rename_moves_within_the_project(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "이름변경")
    root = Path(project["path"])

    response = client.post(
        f"{BASE}/{project['id']}/rename", json={"path": "strategy.py", "to": "pkg/모멘텀.py"}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"path": "pkg/모멘텀.py", "from": "strategy.py", "is_dir": False}
    assert not (root / "strategy.py").exists()
    assert (root / "pkg" / "모멘텀.py").is_file()


def test_rename_is_python_only_and_refuses_missing_or_occupied_targets(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "이름거부")
    root = Path(project["path"])
    (root / "other.py").write_text("x = 1\n", encoding="utf-8")

    def _rename(path: str, to: str):
        return client.post(f"{BASE}/{project['id']}/rename", json={"path": path, "to": to})

    non_python = _rename("strategy.py", "strategy.txt")
    assert non_python.status_code == 415
    assert "파이썬" in non_python.json()["detail"]
    assert _rename("없다.py", "새것.py").status_code == 404
    assert _rename("strategy.py", "other.py").status_code == 409
    assert _rename("strategy.py", "../밖.py").status_code == 400
    assert (root / "strategy.py").is_file()


def test_rename_moves_a_directory_without_the_python_rule(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "폴더이동")
    root = Path(project["path"])
    (root / "old").mkdir()
    (root / "old" / "inner.py").write_text("x = 1\n", encoding="utf-8")

    response = client.post(f"{BASE}/{project['id']}/rename", json={"path": "old", "to": "new"})

    assert response.status_code == 200, response.text
    assert response.json()["is_dir"] is True
    assert (root / "new" / "inner.py").is_file()


def test_delete_file_and_empty_directory_but_not_a_full_one(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project = _create(client, "삭제")
    root = Path(project["path"])
    (root / "empty").mkdir()
    (root / "full").mkdir()
    (root / "full" / "inner.py").write_text("x = 1\n", encoding="utf-8")

    def _delete(path: str):
        return client.delete(f"{BASE}/{project['id']}/file", params={"path": path})

    removed = _delete("strategy.py")
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"deleted": "strategy.py", "is_dir": False}
    assert not (root / "strategy.py").exists()

    assert _delete("empty").json() == {"deleted": "empty", "is_dir": True}
    assert not (root / "empty").exists()

    full = _delete("full")
    assert full.status_code == 409
    assert "비어 있지 않은" in full.json()["detail"]
    assert (root / "full" / "inner.py").is_file()

    assert _delete("없다.py").status_code == 404
    assert _delete("../밖.py").status_code == 400


def test_registry_file_stays_valid_json_after_a_full_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    first = _create(client, "하나")
    _create(client, "둘")
    client.delete(f"{BASE}/{first['id']}")

    payload = json.loads((tmp_path / "projects" / "registry.json").read_text(encoding="utf-8"))

    assert [row["name"] for row in payload["projects"]] == ["둘"]
    assert list((tmp_path / "projects").glob("*.tmp")) == []


# ── 프로젝트 환경(.venv) ─────────────────────────────────────────────────────


def test_env_says_nothing_is_there_before_and_reads_the_real_layout_after(tmp_path: Path) -> None:
    """`GET /env`는 캐시가 아니라 지금 찍은 디스크다 — 폴더가 생기면 다음 호출이 곧바로 안다."""
    client = _client(tmp_path)
    project = _create(client, "환경없음")
    root = Path(project["path"])

    before = client.get(f"{BASE}/{project['id']}/env")
    assert before.status_code == 200, before.text
    assert before.json() == {
        "project_id": project["id"],
        "exists": False,
        "python": None,
        "packages": [],
        "base_ok": False,
    }

    scripts = root / ".venv" / "Scripts"
    scripts.mkdir(parents=True)
    (scripts / "python.exe").write_bytes(b"")
    site = root / ".venv" / "Lib" / "site-packages"
    site.mkdir(parents=True)
    for name in ("pandas-2.3.3.dist-info", "numpy-2.5.2.dist-info"):
        (site / name).mkdir()

    after = client.get(f"{BASE}/{project['id']}/env").json()
    assert after["exists"] is True
    assert after["python"] == str((scripts / "python.exe").resolve())
    assert after["packages"] == ["numpy", "pandas"]
    assert after["base_ok"] is True

    assert client.get(f"{BASE}/없는프로젝트/env").status_code == 404


def test_env_setup_refuses_package_names_that_are_not_package_names(tmp_path: Path) -> None:
    """이름 검증이 첫 그물이다 — 명령은 argv 리스트라 셸을 지나지 않지만, 그 사실에
    기대어 무엇이든 받아주지는 않는다. 거절된 요청은 잡을 하나도 남기지 않는다."""
    with _env_client(tmp_path) as client:
        project = _create(client, "이름검증")

        for bad in (["pandas; rm -rf"], ["-r requirements.txt"], ["https://evil/x.whl"], [7]):
            response = client.post(f"{BASE}/{project['id']}/env", json={"packages": bad})
            assert response.status_code == 422, (bad, response.text)

        not_a_list = client.post(f"{BASE}/{project['id']}/env", json={"packages": "pandas"})
        assert not_a_list.status_code == 422
        assert "배열" in not_a_list.json()["detail"]

        assert client.app.state.backtest_runner._jobs == {}


def test_env_setup_streams_progress_and_refuses_a_second_run_meanwhile(tmp_path: Path) -> None:
    """202 + job_id → `GET /jobs/{id}`가 단계와 방금 나온 줄을 보여준다. 같은 프로젝트에
    두 번째 요청은 409다.

    여기 가상환경은 `--without-pip`이라 install 단계가 반드시 실패한다 — 일부러 그렇게
    골랐다. 실패해도 **어느 단계에서 무슨 말이 나왔는지**가 남는지가 이 테스트의 질문이고,
    그 답을 얻는 데 네트워크가 필요 없다.
    """
    with _env_client(tmp_path) as client:
        project = _create(client, "진행표시")
        root = Path(project["path"])
        subprocess.run(
            [sys.executable, "-m", "venv", "--without-pip", str(root / ".venv")],
            check=True, capture_output=True, timeout=180,
        )

        accepted = client.post(f"{BASE}/{project['id']}/env", json={})
        assert accepted.status_code == 202, accepted.text
        job_id = accepted.json()["job_id"]

        busy = client.post(f"{BASE}/{project['id']}/env", json={})
        assert busy.status_code == 409
        assert job_id in busy.json()["detail"]

        _await_job(client, job_id)

        job = client.get(f"{JOBS}/{job_id}").json()
        assert job["kind"] == "env"
        assert job["status"] == "failed"
        assert set(job["progress"]) == {"step", "line"}
        assert job["progress"]["step"] == "install"
        assert "install" in job["error"]
        assert "pip" in job["error"]

        # 끝난 잡은 더 이상 막지 않는다 — 409는 "지금 도는 중"에만이다.
        assert client.post(f"{BASE}/{project['id']}/env", json={}).status_code == 202


def test_env_setup_really_installs_the_base_packages(tmp_path: Path) -> None:
    """진짜 `python -m venv` + 진짜 `pip install pandas numpy`가 끝나면 `GET /env`의
    `base_ok`가 참이 된다.

    네트워크를 타지 않게 두 가지를 미리 놓는다: ① 백엔드 venv의 site-packages를 `.pth`로
    이어 실제 모듈이 보이게 하고, ② pandas/numpy의 dist-info를 복사해 pip이 "이미 설치됨"
    으로 끝나게 한다. 검증 대상은 잡 배선(단계·상태·설치 명령)이지 회선이 아니다.
    """
    with _env_client(tmp_path) as client:
        project = _create(client, "실환경")
        root = Path(project["path"])
        subprocess.run(
            [sys.executable, "-m", "venv", str(root / ".venv")],
            check=True, capture_output=True, timeout=600,
        )
        site = venv_site_packages(root)
        assert site is not None
        backend_site = Path(pd.__file__).resolve().parent.parent
        (site / "_athena_test_link.pth").write_text(str(backend_site), encoding="utf-8")
        for pattern in ("pandas-*.dist-info", "numpy-*.dist-info"):
            for source in backend_site.glob(pattern):
                shutil.copytree(source, site / source.name)

        job_id = client.post(f"{BASE}/{project['id']}/env", json={}).json()["job_id"]
        _await_job(client, job_id)

        job = client.get(f"{JOBS}/{job_id}").json()
        assert job["status"] == "done", job
        assert job["error"] is None
        assert job["progress"] == {"step": "done", "line": "환경 구성 완료"}

        env = client.get(f"{BASE}/{project['id']}/env").json()
        assert env["exists"] is True
        assert env["base_ok"] is True
        assert {"pandas", "numpy"} <= set(env["packages"])


def test_env_setup_needs_the_backtest_subsystem_and_says_so(tmp_path: Path) -> None:
    """조회는 러너 없이도 답한다. 만들기만 503이다 — 진행 폴링이 그쪽에 있기 때문이다."""
    client = _client(tmp_path)
    project = _create(client, "러너없음")

    assert client.get(f"{BASE}/{project['id']}/env").status_code == 200
    denied = client.post(f"{BASE}/{project['id']}/env", json={})
    assert denied.status_code == 503
    assert "ATHENA_BACKTEST_ENABLED" in denied.json()["detail"]
