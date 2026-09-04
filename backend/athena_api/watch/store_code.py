"""감시 코드 착지 — 모델이 쓴 감시 함수 파일이 디스크에 닿는 단 하나의 경로(R9).

백테스트의 전략 표(`bt_strategy`·`bt_strategy_version`)나 사용자 전략 등록부는
여기서 만지지 않는다(R5). 감시 코드는 등록된 프로젝트 폴더 안 `watch/<이름>.py`
파일 하나가 원본이고, 루틴 JSON은 경로와 해시만 쥔다.

활성 알람이 가리키는 파일은 덮어쓸 수 없다(R10) — 그 문은 사람이 알람을 멈춘
뒤에만 열린다. 일시중지 알람은 고쳐 쓸 수 있고, 그러면 해시가 어긋나 다시 검사를
통과하기 전에는 재개가 막힌다.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from athena_api.projects.store import ProjectPathError
from athena_api.routines.runtime import resolve_watch_file

_WATCH_DIR = "watch/"
_DRIVE_PREFIX_RE = re.compile(r"^[A-Za-z]:")
_LABELS_RE = re.compile(r"^NODE_LABELS\s*=", re.MULTILINE)

# 코드를 못 바꾸는 상태 — 켜져 있는 알람만 그 파일을 잠근다. 일시중지는 고쳐 쓰기
# 통로다(R10) — 쓰고 나면 해시가 어긋나 재개 전에 다시 검사를 받게 된다.
LOCKED_STATUSES = frozenset({"active"})

_PATH_HINT = "감시 코드 경로는 watch/ 아래 .py 하나만"


class CodeLocked(Exception):
    """켜져 있는 알람이 가리키는 파일을 덮어쓰려 했다(R10)."""


def _validate_path(raw: Any) -> str:
    """`watch/<이름>.py` 상대 경로만 통과시킨다 — rules._validate_watch_path와 같은 규칙."""
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(_PATH_HINT)
    path = raw.strip().replace("\\", "/")
    if path.startswith("/") or _DRIVE_PREFIX_RE.match(path):
        raise ValueError(_PATH_HINT)
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError(_PATH_HINT)
    if not path.endswith(".py") or not path.startswith(_WATCH_DIR) or len(parts) < 2:
        raise ValueError(_PATH_HINT)
    return path


def _has_node_labels(source: str) -> bool:
    """최상위 `NODE_LABELS` 대입이 이미 있는지 — 문법이 깨진 코드는 글자로 본다."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return bool(_LABELS_RE.search(source))
    for node in tree.body:
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        for target in targets:
            if isinstance(target, ast.Name) and target.id == "NODE_LABELS":
                return True
    return False


def _labels_block(labels: dict[str, Any]) -> str:
    body = json.dumps(
        {str(k): str(v) for k, v in labels.items()}, ensure_ascii=False, indent=4
    )
    return f"NODE_LABELS = {body}\n"


def _assert_unlocked(routine_store: Any, project_id: str, path: str) -> None:
    for spec in routine_store.list_all():
        if spec.status not in LOCKED_STATUSES:
            continue
        watch = getattr(spec, "watch", None)
        if watch is None:
            continue
        if watch.project_id == project_id and watch.path == path:
            raise CodeLocked(path)


def save_watch_code(
    project_id: str,
    path: str,
    source: str,
    labels: dict[str, Any] | None = None,
    *,
    routine_store: Any,
) -> dict[str, Any]:
    """감시 코드 파일을 프로젝트 폴더 안에 원자적으로 쓰고 내용 해시를 돌려준다.

    `labels`가 왔는데 코드에 `NODE_LABELS`가 없으면 파일 끝에 붙인다 — 노드 카드의
    한국어 제목이 코드와 같은 파일 같은 버전에 있어야 렌더할 때 부를 곳이 없다(B-11).
    """
    rel = _validate_path(path)
    if not isinstance(source, str) or not source.strip():
        raise ValueError("감시 코드 본문이 비어 있음")
    try:
        target: Path = resolve_watch_file(project_id, rel)
    except ProjectPathError as exc:
        raise ValueError(str(exc)) from exc

    _assert_unlocked(routine_store, project_id, rel)

    body = source
    if labels and not _has_node_labels(body):
        body = body.rstrip("\n") + "\n\n" + _labels_block(labels)
    data = body.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    return {
        "path": rel,
        "code_hash": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
    }
