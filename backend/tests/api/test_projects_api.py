"""프로젝트 파일 라우트 — 모든 성공 경로와 모든 오류 분기(계약 D1·D2·D3).

키움도 sqlite도 부르지 않는다. 이 기능의 진실은 디스크의 파일이라(D2) 테스트도 파일만
본다 — 응답이 200이라고 말하면 실제로 tmp_path 아래에 그 파일이 있어야 한다.

두 가지를 특히 못 박는다. ① `DELETE /{id}`는 등록만 해제하고 폴더는 그대로 둔다.
② 파이썬이 아닌 파일은 트리에 보이되 열거나 쓰면 415다.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app
from athena_api.projects.store import MAX_FILE_BYTES

BASE = "/api/v1/projects"


def _client(tmp_path: Path) -> TestClient:
    app = create_app(Settings(_env_file=None, projects_root=tmp_path / "projects"))
    return TestClient(app)


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
