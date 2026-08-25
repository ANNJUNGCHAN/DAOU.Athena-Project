
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"


@dataclass(frozen=True)
class Presentation:
    """manifest `presentation` 필드의 최소 사본 — 카드 종류 결정에 필요한 조각만."""

    layout: str | None
    shape: str | None
    controls: dict[str, Any] | None


@lru_cache(maxsize=1)
def _manifest() -> dict[str, Any]:
    """705KB manifest JSON을 프로세스 생애주기 동안 1회만 읽는다(신선도 계약 참조)."""
    with MANIFEST_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def _mapping_index() -> dict[str, dict[str, Any]]:
    return {mapping["mapping_id"]: mapping for mapping in _manifest()["mappings"]}


def get_mapping(mapping_id: str) -> dict[str, Any] | None:
    """`mapping_id`(예: `base:ka00001`, `detail:ka10001:valuation`)로 manifest
    매핑 원본을 조회한다. 없으면 `None` — 추측으로 가장 가까운 값을 고르지 않는다."""
    return _mapping_index().get(mapping_id)


def get_presentation(operation_ref: str) -> Presentation | None:
    """`operation_ref`(= `mapping_id`, 셀렉터가 `CallResponse.operation_ref`로 매
    호출마다 이미 반환하는 값)로 `presentation.layout`/`shape`/`controls`만 뽑아
    반환한다. 콜드/캐시 경로가 카드 종류를 결정할 authority로 쓸 함수다(P1b에서
    결선 — 이번 P1a에서는 호출부 없이 함수 계약만 검증한다). 매칭 실패는 `None` —
    호출부가 `free` 카드로 폴백하고 사유를 남기는 것은 P1b의 책임이다."""
    mapping = get_mapping(operation_ref)
    if mapping is None:
        return None
    presentation = mapping.get("presentation", {})
    return Presentation(
        layout=presentation.get("layout"),
        shape=presentation.get("shape"),
        controls=presentation.get("controls"),
    )
