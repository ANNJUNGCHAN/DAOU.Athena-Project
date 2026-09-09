"""모의투자가 거절하는 조회 TR — 카드 값 바인딩에서 빼는 단일 원장.

제품은 mockapi.kiwoom.com 만 허용한다. 이 TR 은 값이 오지 않으므로 슬롯에 묶어
「미제공」 벽을 만들지 않는다. 원문 실측은
``docs/reference/2026-09-09-mock-unsupported-apis.md``.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
LEDGER_PATH = BACKEND / "ref" / "mock-unsupported-trs.json"


@lru_cache(maxsize=1)
def mock_unsupported_trs() -> frozenset[str]:
    payload = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    trs = payload.get("trs") or []
    return frozenset(str(item) for item in trs if item)


def tr_of(mapping_id: str | None) -> str | None:
    if not mapping_id:
        return None
    parts = str(mapping_id).split(":")
    if parts[0] == "base" and len(parts) >= 2:
        return parts[1]
    if parts[0] == "detail" and len(parts) >= 2:
        return parts[1]
    return parts[0] if parts else None


def is_mock_unsupported(mapping_id: str | None) -> bool:
    tr_id = tr_of(mapping_id)
    return tr_id is not None and tr_id in mock_unsupported_trs()


def mock_supported_query_refs() -> frozenset[str]:
    """모의에서 조회 가능한 REST op (주문·websocket·oauth·모의 거절 TR 제외)."""

    from athena_api.selector.catalog import build_operation_catalog

    catalog = build_operation_catalog()
    return frozenset(
        document.operation_ref
        for document in catalog.documents
        if document.kind == "query" and not is_mock_unsupported(document.operation_ref)
    )
