"""screen_manifest.py 공유 로더 테스트 (P1a).

호출부(콜드/캐시 경로)는 아직 이 모듈을 쓰지 않는다(P1b가 결선한다) — 여기서는
로더 자체의 계약(캐싱·조회·신선도 계약 문서화)만 검증한다. 네트워크 없음.
"""

from __future__ import annotations

from athena_api import screen_manifest


def test_manifest_loads_expected_top_level_shape():
    manifest = screen_manifest._manifest()
    assert isinstance(manifest, dict)
    assert "mappings" in manifest
    assert isinstance(manifest["mappings"], list)
    assert len(manifest["mappings"]) == manifest["counts"]["routable"]


def test_manifest_is_cached_by_identity():
    """반복 호출이 동일 객체(identity)를 반환한다 — 재파싱하지 않음을 증명한다
    (P1a 수용 기준)."""
    first = screen_manifest._manifest()
    second = screen_manifest._manifest()
    assert first is second


def test_mapping_index_is_cached_by_identity():
    first = screen_manifest._mapping_index()
    second = screen_manifest._mapping_index()
    assert first is second


def test_get_mapping_known_base_mapping_id():
    mapping = screen_manifest.get_mapping("base:ka00001")
    assert mapping is not None
    assert mapping["mapping_id"] == "base:ka00001"
    assert mapping["operation"]["tr_id"] == "ka00001"


def test_get_mapping_known_detail_mapping_id():
    """split_derived(detail:{tr}:{group}) 조인도 동일한 조회 함수로 성립해야 한다
    — SPLIT_BASE_TR_IDS 분기의 실제 산출물이다(ka10001, 계획 P0 참조)."""
    mapping = screen_manifest.get_mapping("detail:ka10001:valuation")
    assert mapping is not None
    assert mapping["mapping_id"] == "detail:ka10001:valuation"
    assert mapping["mapping_type"] == "split_derived"


def test_get_mapping_unknown_id_returns_none():
    assert screen_manifest.get_mapping("base:does-not-exist") is None


def test_get_presentation_facts_layout():
    presentation = screen_manifest.get_presentation("base:ka00001")
    assert presentation == screen_manifest.Presentation(
        layout="facts", shape="scalar_only", controls=None
    )


def test_get_presentation_compound_layout():
    presentation = screen_manifest.get_presentation("base:ka01300")
    assert presentation == screen_manifest.Presentation(
        layout="compound", shape="compound", controls=None
    )


def test_get_presentation_table_layout():
    presentation = screen_manifest.get_presentation("base:ka10029")
    assert presentation is not None
    assert presentation.layout == "table"


def test_get_presentation_unknown_operation_ref_returns_none():
    assert screen_manifest.get_presentation("base:does-not-exist") is None


def test_get_presentation_is_deterministic_across_calls():
    first = screen_manifest.get_presentation("base:ka00001")
    second = screen_manifest.get_presentation("base:ka00001")
    assert first == second
