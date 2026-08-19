"""공유 manifest 로더 — `mapping_id`/`operation_ref` → `presentation` 조회 (P1a).

`backend/ref/kiwoom-common-screen-manifest.json`(`scripts/generate_api.py` 생성물,
301개 라우팅 매핑)을 이 모듈 하나가 파싱한다. 콜드 경로
(`athena_mcp/canvas_data.py::render_with_plan()`)와 캐시 리플레이 경로
(`athena_api/canvas_push.py`)가 카드 종류를 결정할 때 각자 파싱 로직을 새로 짜지
않고 **둘 다 이 모듈을 임포트**하도록 결선하는 것이 P1b의 몫이다(계획
`plan/공통화면-템플릿-실행계획-2026-08-20.md` P1a Deliverable 1, Architect 권고 1) —
이 시점(P1a)에는 아직 호출부가 없고, 이 모듈 자체의 계약만 존재한다.

**신선도 계약(freshness contract) — 반드시 지킬 것.**
`@lru_cache` 싱글턴은 상시 백엔드 프로세스(CLAUDE.md §7 "uvicorn 워커는 정확히
1개") 생애주기 동안 매니페스트 JSON을 **딱 1회만** 파싱하고, 이후 조회는 전부
인메모리 캐시를 재사용한다. 매니페스트를 재생성(`scripts/generate_api.py` 재실행)
해도 **백엔드 프로세스를 재시작하지 않는 한 이 로더는 재생성 이전의 낡은 매핑을
계속 반환한다** — 이것은 버그가 아니라 임포트 캐시의 본질적 한계다. 따라서
**"매니페스트 재생성 → 백엔드 프로세스 재시작"을 하나의 원자적 절차로 취급한다**
(재시작 생략 금지). 이 모듈은 런타임 핫리로드를 하지 않는다 — 파일 mtime을 검사해
자동 무효화하는 것도 하지 않는다(재생성이 드문 이벤트라는 전제 하에, 매 조회마다
stat 비용을 추가하는 것보다 재시작 계약이 더 단순하다는 판단. 대안은 후속 라운드로
열어둔다 — 계획 §8 Open Question 5).
"""

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
    """`mapping_id` → mapping 원본 전체. `operation_ref`는 이 키 스페이스와 대소문자
    구분까지 1:1이다(GLOSSARY.md §6 "오퍼레이션 아이덴티티" — 조인 실측 증명은 P0
    소관이고, 이 모듈은 그 계약을 전제로 조회만 제공한다)."""
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
