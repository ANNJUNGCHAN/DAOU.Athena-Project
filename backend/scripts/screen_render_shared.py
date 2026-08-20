"""공통화면 렌더 스크립트 공용 헬퍼.

`render_screen_injection_map.py`와 `render_screen_case_matrix.py`가 복붙으로
공유하던 manifest 로딩·이름 조회 로직의 단일 소재지다. 특히
`mapping_display_name`의 detail 제목 폴백 체인(title_ko → title_en → group_id)은
두 사본이 따로 드리프트하면 생성물 두 개가 같은 매핑을 다른 이름으로 부르게
된다 — 그래서 여기 하나만 둔다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from athena_api.generated.registry import DETAIL_REGISTRY, TR_REGISTRY  # noqa: E402

MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def escape_cell(value: str) -> str:
    """Escape a value for safe embedding in a Markdown table cell."""
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def tr_korean_name(tr_id: str) -> str | None:
    spec = TR_REGISTRY.get(tr_id)
    return spec.name if spec is not None else None


def mapping_display_name(mapping: dict[str, Any]) -> str:
    """Look up the Korean operation name from the generated registry.

    Never invented: base mappings use `TR_REGISTRY[tr].name`; split-derived
    mappings use the detail's `title_ko`, falling back to `title_en` then the
    group id, and also show the parent TR name. Missing names render `—`
    explicitly rather than being silently omitted.
    """
    tr_id = mapping["operation"]["tr_id"]
    parent_name = tr_korean_name(tr_id)
    if mapping["mapping_type"] == "base":
        return escape_cell(parent_name) if parent_name else "—"
    detail = DETAIL_REGISTRY.get(mapping["mapping_id"])
    if detail is None:
        return "—"
    detail_name = detail.title_ko or detail.title_en or detail.group_id
    parent = parent_name or "—"
    return f"{escape_cell(detail_name)} ({escape_cell(parent)})"
