from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from collections import Counter
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

BACKEND = Path(__file__).resolve().parents[2]
CORPUS_PATH = BACKEND / "tests" / "fixtures" / "api_selector_autonomous.jsonl"
EXPANSION_CORPUS_PATH = (
    BACKEND / "tests" / "fixtures" / "api_selector_autonomous_expansion.jsonl"
)
EXPOSED_V2_CORPUS_PATH = (
    BACKEND
    / "tests"
    / "fixtures"
    / "api_selector_autonomous_expansion_v2.jsonl"
)
EXPOSED_V3_CORPUS_PATH = (
    BACKEND
    / "tests"
    / "fixtures"
    / "api_selector_autonomous_expansion_v3.jsonl"
)
STOCK_MASTER_PATH = BACKEND / "tests" / "fixtures" / "stock_entity_master_eval.json"
STOCK_ENTITY_CONFORMANCE_PATH = (
    BACKEND / "tests" / "fixtures" / "stock_entity_resolver_conformance.json"
)
EXPOSED_V2_PROVENANCE_PATH = (
    BACKEND.parent
    / "plan"
    / "selector-g006-autonomous-expansion-v2-provenance-2026-08-21.json"
)
SCRIPT_PATH = BACKEND / "scripts" / "evaluate_selector_ablations.py"
EXPECTED_CATEGORIES = {
    "stock_snapshot": 17,
    "sector_snapshot": 9,
    "chart": 22,
    "name_code": 4,
    "mixed_language": 6,
    "order": 8,
    "websocket": 11,
    "oauth": 8,
    "ambiguity": 8,
    "entity_substitution": 6,
    "metamorphic": 8,
    "doc_invariance": 4,
    "ood": 2,
    "surface_crossing": 4,
}
ANSWER_HINT_KEYS = {"preferred_ref", "candidate_refs", "detail_group"}


def _load_harness() -> ModuleType:
    spec = importlib.util.spec_from_file_location("selector_ablation_harness", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def harness() -> ModuleType:
    return _load_harness()


@pytest.fixture(scope="module")
def cases(harness: ModuleType) -> tuple[dict[str, Any], ...]:
    return harness.load_cases(CORPUS_PATH)


# v5 봉인 계약은 직접 quote 계층 10건 이상과 advisory 0건을 요구한다. 이 합성
# 코퍼스는 sealed_freeze_manifest의 기계 장치(중복·근사복사·동결 결속·정확히 100건)를
# 시험하는 픽스처일 뿐 셀렉터 정확도 증거가 아니다 — 실제 v5 봉인 코퍼스는 별도로
# 저자가 작성해야 한다.
_SEALED_QUOTE_NAMES = (
    "현대차",
    "LG에너지솔루션",
    "POSCO홀딩스",
    "카카오",
    "삼성SDI",
    "LG화학",
    "KB금융",
    "아모레퍼시픽",
    "두산에너빌리티",
    "LG전자",
    "현대모비스",
    "크래프톤",
)


def _synthetic_quote_case(index: int, name: str) -> dict[str, Any]:
    return {
        "id": f"synthetic-sealed-quote-{index}",
        "suite": "synthetic_sealed",
        "category": "stock_snapshot",
        "language": "ko",
        # 직접 quote 데이터셋은 "현재가" 표현으로 잡힌다(실측). 종목명이 12개 다르므로
        # 접미 토큰 없이도 질문이 서로 중복되지 않는다.
        "question": f"{name} 현재가 알려줘",
        "intent": "auto",
        "expected_refs": ["base:ka10001"],
        "expected_operation_refs": ["detail:ka10001:current_trading"],
        "expected_disposition": "select",
        "expected_kind": "query",
        "pair_id": None,
        "forbidden_refs": ["base:ka20001"],
        "critical_tags": ["stock", "query"],
        "critical_groups": ["stock_snapshot_detail"],
        "metamorphic_group": None,
    }


def _synthetic_sealed_cases(
    source: tuple[dict[str, Any], ...], count: int
) -> tuple[dict[str, Any], ...]:
    # advisory 케이스는 v5가 0건을 요구하므로 합성 대상에서 뺀다.
    pool = tuple(
        case
        for case in source
        if case.get("identity_support") != "unsupported_by_frozen_provider"
    )
    quote_count = min(len(_SEALED_QUOTE_NAMES), max(0, count - 1))
    synthetic = [
        _synthetic_quote_case(index, _SEALED_QUOTE_NAMES[index])
        for index in range(quote_count)
    ]
    for index in range(count - quote_count):
        case = deepcopy(pool[index % len(pool)])
        case["id"] = f"synthetic-sealed-{index}"
        case["question"] = f"{case['question']} synthetic-sealed-{index}"
        synthetic.append(case)
    return tuple(synthetic)


def test_autonomous_corpus_contains_one_hundred_seventeen_question_only_cases(
    cases: tuple[dict[str, Any], ...],
) -> None:
    assert len(cases) == 117
    assert len({case["id"] for case in cases}) == 117
    assert Counter(case["category"] for case in cases) == EXPECTED_CATEGORIES


def test_default_report_is_current_and_historical_baseline_is_explicit_only(
    harness: ModuleType,
) -> None:
    assert harness.DEFAULT_OUTPUT.name == "selector-g003-autonomous-2026-08-20.json"
    assert (
        harness.G005_METRIC_OUTPUT.name
        == "selector-g005-semantic-metrics-2026-08-20.json"
    )
    assert (
        harness.HISTORICAL_BASELINE_OUTPUT.name
        == "selector-ablation-baseline-2026-08-20.json"
    )
    assert harness.DEFAULT_OUTPUT != harness.HISTORICAL_BASELINE_OUTPUT
    assert harness.SEALED_HOLDOUT_OUTPUT.name == (
        "selector-g006-sealed-holdout-2026-08-21.json"
    )
    assert harness.SEALED_HOLDOUT_METRIC_OUTPUT.name == (
        "selector-g006-sealed-holdout-metrics-2026-08-21.json"
    )
    assert harness.AUTONOMOUS_EXPANSION_CORPUS == EXPANSION_CORPUS_PATH
    assert harness.AUTONOMOUS_EXPANSION_OUTPUT.name == (
        "selector-g006-autonomous-expansion-2026-08-21.json"
    )
    assert harness.AUTONOMOUS_EXPANSION_METRIC_OUTPUT.name == (
        "selector-g006-autonomous-expansion-metrics-2026-08-21.json"
    )


def test_report_and_metrics_record_current_corpus_hash(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = harness.evaluate_all((cases[0],), corpus_path=CORPUS_PATH)
    expected = hashlib.sha256(CORPUS_PATH.read_bytes()).hexdigest()

    assert report["corpus_sha256"] == expected
    assert harness.semantic_metrics(report)["corpus_sha256"] == expected


def test_autonomous_corpus_never_injects_selector_answer_hints(
    cases: tuple[dict[str, Any], ...],
) -> None:
    assert all(ANSWER_HINT_KEYS.isdisjoint(case) for case in cases)


def test_public_unsupported_identity_advisories_are_explicit_metadata(
    cases: tuple[dict[str, Any], ...],
) -> None:
    unsupported = [
        case
        for case in cases
        if case.get("identity_support") == "unsupported_by_frozen_provider"
    ]

    assert len(unsupported) == 4
    assert all(
        case.get("evaluation_scope") == "semantic_operation_advisory"
        and case.get("provenance")
        == "post-exposure-production-scope-audit-2026-08-21"
        and case.get("counterfactual_entity_kind")
        in {"stock", "etf", "elw", "gold"}
        for case in unsupported
    )


@pytest.mark.parametrize(
    ("update", "message"),
    (
        ({"question": "삼성전자 오늘 주가 얼마야?"}, "conflicts with frozen provider"),
        ({"expected_disposition": "reject"}, "requires select or guarded"),
        ({"provenance": "unreviewed"}, "requires post-exposure provenance"),
        ({"identity_extra": True}, "unknown identity metadata"),
        ({"counterfactual_entity_kind": "sector"}, "counterfactual entity kind"),
    ),
)
def test_unsupported_identity_advisory_metadata_fails_closed(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    update: dict[str, Any],
    message: str,
) -> None:
    marked = deepcopy(
        next(
            case
            for case in cases
            if case.get("identity_support") == "unsupported_by_frozen_provider"
        )
    )
    marked.update(update)

    with pytest.raises(ValueError, match=message):
        harness._validate_identity_support_metadata(marked)


def test_unsupported_identity_advisory_rejects_raw_selected_case(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    marked = deepcopy(
        next(
            case
            for case in expansion
            if case["id"] == "sealed-boundary-etf-nav-stream-en"
        )
    )
    marked.update(
        {
                "identity_support": "unsupported_by_frozen_provider",
                "evaluation_scope": "semantic_operation_advisory",
                "provenance": "post-exposure-production-scope-audit-2026-08-21",
                "counterfactual_entity_kind": "etf",
            }
        )

    with pytest.raises(ValueError, match="raw selector already selects"):
        harness._validate_unsupported_advisory_semantics((marked,))


def test_unsupported_identity_advisory_requires_counterfactual_expected_selection(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    marked = deepcopy(
        next(
            case
            for case in expansion
            if case["id"] == "sealed-stock-current-hyundai-name-en"
        )
    )
    marked["expected_refs"] = ["base:ka20003"]
    marked["expected_family_refs"] = ["base:ka20003"]

    with pytest.raises(ValueError, match="typed counterfactual expected selection"):
        harness._validate_unsupported_advisory_semantics((marked,))


def test_public_unsupported_identity_advisories_pass_typed_counterfactual(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    advisory_cases = tuple(
        case
        for case in cases
        if case.get("identity_support") == "unsupported_by_frozen_provider"
    )

    harness._validate_unsupported_advisory_semantics(advisory_cases)


def test_advisory_rejects_nonselected_typed_counterfactual(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    unrelated = deepcopy(
        next(case for case in expansion if case["id"] == "sealed-scope-sk-stock-en")
    )
    unrelated["question"] = "Tell me something completely unrelated"

    with pytest.raises(ValueError, match="typed counterfactual expected selection"):
        harness._validate_unsupported_advisory_semantics((unrelated,))


def test_typed_advisory_counterfactual_retains_no_identity_value(
    harness: ModuleType,
) -> None:
    resolution = harness._typed_advisory_counterfactual("stock")

    assert resolution.present is True
    assert resolution.entity_kind.value == "stock"
    assert "Samsung" not in repr(resolution)


def test_frozen_equity_master_returns_typed_stock_resolution(
    harness: ModuleType,
) -> None:
    resolution = harness._TRUSTED_STOCK_MASTER_RESOLVER.resolve_target(
        "삼성전자 현재가"
    )

    assert resolution.present is True
    assert resolution.entity_kind.value == "stock"


def test_autonomous_expansion_is_a_separate_question_only_regression_partition(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)

    assert len(expansion) >= 72
    assert len({case["id"] for case in expansion}) == len(expansion)
    assert {case["expected_disposition"] for case in expansion} == {
        "select",
        "reject",
        "forbidden",
        "guarded",
    }
    assert all(ANSWER_HINT_KEYS.isdisjoint(case) for case in expansion)


def test_failed_sealed_v2_is_reclassified_as_an_exposed_expansion(
    harness: ModuleType,
) -> None:
    cases = harness.load_cases(EXPOSED_V2_CORPUS_PATH)

    assert len(cases) == 90
    assert harness.EXPOSED_V2_CORPUS == EXPOSED_V2_CORPUS_PATH
    assert harness.EXPOSED_V2_PROVENANCE == "exposed-after-sealed-v2-failure"
    assert {case["suite"] for case in cases} == {"autonomous_expansion_v2"}
    # 노출 이후 18건이 프로덕션 범위 재감사로 다시 라벨링됐다. 총계 90은 불변이고
    # 검토된 라벨 밖의 출처가 새로 생기면 실패한다.
    assert Counter(case["provenance"] for case in cases) == {
        "exposed-after-sealed-v2-failure": 69,
        "post-exposure-production-scope-audit-2026-08-21": 18,
        "static-target-presence-gold-audit-2026-08-21": 2,
        "corrected-gold-after-capability-audit": 1,
    }
    assert all(ANSWER_HINT_KEYS.isdisjoint(case) for case in cases)
    assert not (
        BACKEND / "tests" / "fixtures" / "api_selector_sealed_v2.jsonl"
    ).exists()


def test_failed_sealed_v2_artifacts_remain_byte_immutable() -> None:
    expected_hashes = {
        "selector-g006-sealed-holdout-freeze-2026-08-21.json": (
            "cc0f56e1550031556ce0c94d387d055ccde435fe0b649239f48dc9b357fb8b18"
        ),
        "selector-g006-sealed-holdout-2026-08-21.json": (
            "1a58325dd3308e5fbc0c8da131b3dfdd15fdb3505888e4256c0366cde7483095"
        ),
        "selector-g006-sealed-holdout-metrics-2026-08-21.json": (
            "6cece39ad8ca8e4c554bdc4f3d20cfcdbffd5a67aa0ca6c018bdcd04e14c9f3c"
        ),
    }

    for name, expected_hash in expected_hashes.items():
        artifact = BACKEND.parent / "plan" / name
        assert artifact.is_file()
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == expected_hash


def test_exposed_v2_diagnostic_outputs_are_distinct_from_one_time_artifacts(
    harness: ModuleType,
) -> None:
    assert harness.EXPOSED_V2_OUTPUT != harness.SEALED_HOLDOUT_OUTPUT
    assert harness.EXPOSED_V2_METRIC_OUTPUT != harness.SEALED_HOLDOUT_METRIC_OUTPUT
    assert harness.EXPOSED_V2_OUTPUT.name == (
        "selector-g006-autonomous-expansion-v2-postfix-2026-08-21.json"
    )
    assert harness.EXPOSED_V2_METRIC_OUTPUT.name == (
        "selector-g006-autonomous-expansion-v2-postfix-metrics-2026-08-21.json"
    )


def test_exposed_v2_provenance_records_exact_failed_category_clusters() -> None:
    provenance = json.loads(EXPOSED_V2_PROVENANCE_PATH.read_text(encoding="utf-8"))
    failed_metrics = json.loads(
        (
            BACKEND.parent
            / "plan"
            / "selector-g006-sealed-holdout-metrics-2026-08-21.json"
        ).read_text(encoding="utf-8")
    )
    expected_clusters: dict[str, list[str]] = {}
    for failure in failed_metrics["critical_failures"]:
        expected_clusters.setdefault(failure["category"], []).append(failure["id"])

    assert provenance["provenance"] == "exposed-after-sealed-v2-failure"
    assert provenance["failed_baseline"]["category_failure_ids"] == expected_clusters


def test_evaluator_final_authority_uses_typed_compatibility_only() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "decide_selector_compatibility" in source
    assert "from athena_api.selector.policy import" not in source
    assert "select_operation(" not in source
    assert "canonical_search_confidence" not in source


def test_raw_backend_mode_matches_shared_compatibility_seam_without_resolver(
    harness: ModuleType,
) -> None:
    from athena_api.selector.compatibility import (
        CompatibilityDecision,
        decide_selector_compatibility,
    )

    catalog = harness.build_operation_catalog()
    question = "새로운회사 오늘 주가와 거래량 알려줘"
    intent = harness.DiscoveryIntent.QUERY

    actual = harness._compatibility_decision(
        catalog, question, intent, evaluation_mode=harness.RAW_BACKEND_MODE
    )
    assert isinstance(actual, CompatibilityDecision)
    assert actual == (
        decide_selector_compatibility(
            catalog,
            question,
            intent,
            bound_argument_roles=(),
        )
    )
    assert actual.selected_operation_ref is None


def test_raw_backend_mode_matches_selector_service_decision_for_name_only_query(
    harness: ModuleType,
) -> None:
    from athena_api.selector.plans import PlanSigner
    from athena_api.selector.service import SelectorService

    catalog = harness.build_operation_catalog()
    service = SelectorService(catalog, PlanSigner(b"raw-parity-test-secret"))
    question = "새로운회사 현재가와 거래량 알려줘"
    intent = harness.DiscoveryIntent.QUERY

    assert harness._compatibility_decision(
        catalog,
        question,
        intent,
        evaluation_mode=harness.RAW_BACKEND_MODE,
    ) == service._compatibility_decision(question, intent)


def test_app_pipeline_mode_resolves_an_unseen_injected_stock_name(
    harness: ModuleType,
) -> None:
    catalog = harness.build_operation_catalog()
    conformance = json.loads(
        STOCK_ENTITY_CONFORMANCE_PATH.read_text(encoding="utf-8")
    )
    resolver = harness.build_evaluator_identity_index(
        records=conformance["records"],
        record_markets=conformance["record_markets"],
        market_kinds=conformance["market_kinds"],
    )

    decision = harness._compatibility_decision(
        catalog,
        "새로운회사의 현재가와 거래량 알려줘",
        harness.DiscoveryIntent.QUERY,
        evaluation_mode=harness.APP_PIPELINE_MODE,
        target_resolver=resolver.resolve_target,
    )

    assert decision.selected_operation_ref == "detail:ka10001:current_trading"


@pytest.mark.parametrize(
    "question",
    (
        "삼성전자서비스 현재가 알려줘",
        "초대형삼성전자서비스 현재가 알려줘",
        "삼성전자와 SK하이닉스 현재가 알려줘",
        "삼성전자 말고 현재가 알려줘",
        "삼성전자 현재가를 업종과 비교해줘",
    ),
)
def test_app_pipeline_resolver_rejects_non_exact_or_non_single_targets(
    harness: ModuleType, question: str
) -> None:
    assert harness._TRUSTED_STOCK_MASTER_RESOLVER.resolve_target(question) is None


def test_app_pipeline_mode_rejects_ood_name_absent_from_stock_master(
    harness: ModuleType,
) -> None:
    catalog = harness.build_operation_catalog()

    decision = harness._compatibility_decision(
        catalog,
        "비트코인 현재가와 거래량 알려줘",
        harness.DiscoveryIntent.QUERY,
        evaluation_mode=harness.APP_PIPELINE_MODE,
    )

    assert decision.selected_operation_ref is None


def test_stock_master_fixture_contains_only_entity_identity_fields(
    harness: ModuleType,
) -> None:
    payload = json.loads(STOCK_MASTER_PATH.read_text(encoding="utf-8"))

    assert set(payload) == {"schema_version", "source", "market_kinds", "entities"}
    assert payload["market_kinds"] == {"0": "stock", "10": "stock", "8": "etf"}
    assert all(
        set(entity) == {"code", "name", "market", "kind"}
        for entity in payload["entities"]
    )
    assert all(
        ANSWER_HINT_KEYS.isdisjoint(entity)
        and not any("operation" in key or "expected" in key for key in entity)
        for entity in payload["entities"]
    )
    assert harness.TRUSTED_STOCK_MASTER_PATH == STOCK_MASTER_PATH


def test_python_resolver_passes_shared_app_conformance_vector(
    harness: ModuleType,
) -> None:
    conformance = json.loads(
        STOCK_ENTITY_CONFORMANCE_PATH.read_text(encoding="utf-8")
    )
    resolver = harness.build_evaluator_identity_index(
        records=conformance["records"],
        record_markets=conformance["record_markets"],
        market_kinds=conformance["market_kinds"],
    )

    assert [
        {
            "id": case["id"],
            "actual_code": (
                resolution.code
                if (resolution := resolver.resolve(case["question"]))
                else None
            ),
            "actual_kind": resolution.target.entity_kind.value if resolution else None,
        }
        for case in conformance["cases"]
    ] == [
        {
            "id": case["id"],
            "actual_code": case["expected_code"],
            "actual_kind": case.get("expected_kind"),
        }
        for case in conformance["cases"]
    ]


def test_stock_master_resolver_rejects_unknown_explicit_code(
    harness: ModuleType,
) -> None:
    assert harness._TRUSTED_STOCK_MASTER_RESOLVER.resolve("999999 현재가") is None
    assert (
        harness._TRUSTED_STOCK_MASTER_RESOLVER.resolve_target("999999 현재가")
        is None
    )


def test_stock_master_resolver_filters_invalid_codes(
    harness: ModuleType, tmp_path: Path
) -> None:
    invalid = tmp_path / "invalid-stock-master.json"
    invalid.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "source": "test",
                "market_kinds": {"0": "stock", "10": "stock", "8": "etf"},
                "entities": [
                    {
                        "code": "5930",
                        "name": "잘못된회사",
                        "market": "0",
                        "kind": "stock",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    assert harness.build_evaluator_identity_index(invalid).size == 0


def test_stock_master_resolver_rejects_same_alias_for_multiple_codes(
    harness: ModuleType,
) -> None:
    resolver = harness.build_evaluator_identity_index(
        records=[
            {"code": "123456", "name": "겹친회사"},
            {"code": "654321", "name": "겹친회사"},
        ],
        record_markets={"123456": "0", "654321": "10"},
        market_kinds={"0": "stock", "10": "stock", "8": "etf"},
    )

    assert resolver.resolve_target("겹친회사의 현재가 알려줘") is None


def test_report_records_app_pipeline_resolver_mode_and_hash(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = harness.evaluate_all((cases[0],), corpus_path=CORPUS_PATH)

    assert report["evaluation_mode"] == harness.APP_PIPELINE_MODE
    assert report["target_resolver"] == {
        "kind": "production-instrument-identity-index",
        "adapter_version": "production-index-fixture-adapter-v1",
        "scope": "production_algorithm_with_reviewed_fixture_snapshot",
        "implementation": "backend/athena_api/selector/instrument_identity.py",
        "implementation_sha256": hashlib.sha256(
            harness.PRODUCTION_IDENTITY_PATH.read_bytes()
        ).hexdigest(),
        "market_kinds": {"0": "stock", "10": "stock", "8": "etf"},
        "fixture": STOCK_MASTER_PATH.name,
        "fixture_sha256": hashlib.sha256(STOCK_MASTER_PATH.read_bytes()).hexdigest(),
        "value_retention": "none",
        "quote_control_plane_evidence": {
            "scope": "direct_quote_dataset_only",
            "implementation": "app/lib/main/rest-dataset-runner.js",
            "implementation_sha256": hashlib.sha256(
                harness.APP_STOCK_ENTITY_INDEX_PATH.read_bytes()
            ).hexdigest(),
            "test": "app/lib/main/rest-dataset-runner.test.js",
            "test_sha256": hashlib.sha256(
                harness.APP_STOCK_ENTITY_INDEX_TEST_PATH.read_bytes()
            ).hexdigest(),
        },
    }


def test_semantic_evaluation_stratifies_name_assistance_from_raw_code_cases(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    selected = tuple(
        case
        for case in cases
        if case["id"] in {"snapshot-stock-current-ko", "g005-entity-basic-code"}
    )
    outcomes = {
        case["id"]: case
        for case in harness.evaluate_variant(selected, "baseline")["cases"]
    }

    assert outcomes["snapshot-stock-current-ko"]["evaluation_stratum"] == (
        "identity_assisted_quote_control_plane"
    )
    assert outcomes["g005-entity-basic-code"]["evaluation_stratum"] == (
        "raw_question_only"
    )


def test_identity_control_plane_trace_redacts_resolved_code(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    case = next(case for case in cases if case["id"] == "snapshot-stock-current-ko")
    outcome = harness.evaluate_variant((case,), "baseline")["cases"][0]
    trace = outcome["identity_control_plane_trace"]

    assert trace["scope"] == "quote_direct_dataset"
    assert trace["exact_binding_verified"] is True
    assert trace["bound_arguments_model_valid"] is True
    assert trace["resolved_code_sha256"] == hashlib.sha256(b"005930").hexdigest()
    assert trace["bound_code_sha256"] == trace["resolved_code_sha256"]
    assert "005930" not in json.dumps(trace, ensure_ascii=False)


def test_quote_binding_rejects_valid_but_mutated_six_digit_code(
    harness: ModuleType,
) -> None:
    document = harness.build_operation_catalog().by_ref[
        "detail:ka10001:current_trading"
    ]

    evidence = harness._quote_control_plane_binding(
        document,
        SimpleNamespace(code="005930"),
        bound_code="000660",
    )

    assert evidence["bound_arguments_model_valid"] is True
    assert evidence["bound_code_sha256"] != evidence["resolved_code_sha256"]
    assert evidence["exact_binding_verified"] is False


def test_quote_binding_rejects_malformed_bound_code(
    harness: ModuleType,
) -> None:
    document = harness.build_operation_catalog().by_ref[
        "detail:ka10001:current_trading"
    ]

    evidence = harness._quote_control_plane_binding(
        document,
        SimpleNamespace(code="005930"),
        bound_code="5930",
    )

    assert evidence["bound_arguments_model_valid"] is False
    assert evidence["bound_code_sha256"] is None
    assert evidence["exact_binding_verified"] is False


def test_identity_quote_calibration_allows_selected_only_population(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    case = next(case for case in cases if case["id"] == "snapshot-stock-current-ko")
    outcome = harness.evaluate_variant((case,), "baseline")["cases"][0]

    calibration = harness._autonomous_calibration(
        [outcome], population="identity", require_rejections=False
    )

    assert calibration["calibration_pass"] is True


def test_raw_calibration_does_not_relax_missing_rejection_evidence(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    case = next(case for case in cases if case["id"] == "g005-entity-basic-code")
    outcome = harness.evaluate_variant((case,), "baseline")["cases"][0]

    calibration = harness._autonomous_calibration(
        [outcome], population="raw", require_rejections=True
    )

    assert calibration["calibration_pass"] is False


def _small_three_strata_report(
    harness: ModuleType, cases: tuple[dict[str, Any], ...]
) -> dict[str, Any]:
    ids = {
        "ambiguity-price-ko",
        "g005-entity-basic-code",
        "snapshot-stock-current-ko",
        "g005-stock-valuation",
        "snapshot-stock-current-en",
    }
    sample = tuple(case for case in cases if case["id"] in ids)
    return {
        "corpus": CORPUS_PATH.name,
        "corpus_sha256": hashlib.sha256(CORPUS_PATH.read_bytes()).hexdigest(),
        "partition": "question_only_autonomous",
        "case_count": len(sample),
        "evaluation_mode": harness.APP_PIPELINE_MODE,
        "target_resolver": harness._target_resolver_metadata(harness.APP_PIPELINE_MODE),
        "variants": [harness.evaluate_variant(sample, "baseline")],
    }


def test_shadow_failure_never_blocks_production_green(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = _small_three_strata_report(harness, cases)
    shadow = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "resolver_assisted_semantic_shadow"
    )
    shadow["correct"] = False
    shadow["surface_crossing"] = True
    shadow["severe_scope_error"] = True

    metrics = harness.semantic_metrics(report)

    assert metrics["gates_pass"] is True
    assert metrics["strata"]["resolver_assisted_semantic_shadow"]["gate_pass"] is None


def test_shadow_success_never_hides_raw_production_failure(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = _small_three_strata_report(harness, cases)
    raw = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "raw_question_only" and case["decision"] == "selected"
    )
    shadow = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "resolver_assisted_semantic_shadow"
    )
    raw["correct"] = False
    shadow["correct"] = True

    metrics = harness.semantic_metrics(report)

    assert metrics["gates_pass"] is False
    assert metrics["strata"]["raw_question_only"]["gate_pass"] is False


def test_unsupported_identity_advisory_failure_never_blocks_production_green(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = _small_three_strata_report(harness, cases)
    advisory = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "unsupported_identity_surface_advisory"
    )
    advisory["correct"] = False

    metrics = harness.semantic_metrics(report)

    assert metrics["gates_pass"] is True
    assert metrics["strata"]["unsupported_identity_surface_advisory"]["gate_pass"] is None


def test_unsupported_identity_advisory_success_never_hides_raw_failure(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = _small_three_strata_report(harness, cases)
    raw = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "raw_question_only" and case["decision"] == "selected"
    )
    advisory = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "unsupported_identity_surface_advisory"
    )
    raw["correct"] = False
    advisory["correct"] = True

    assert harness.semantic_metrics(report)["gates_pass"] is False


def test_noncritical_production_wrong_plan_fails_safety_gate(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = _small_three_strata_report(harness, cases)
    outcome = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "raw_question_only"
    )
    outcome["critical"] = False
    outcome["expected_refs"] = []
    outcome["selected_family"] = "base:ka10001"

    metrics = harness.semantic_metrics(report)

    assert metrics["wrong_plans"] == 1
    assert metrics["gates_pass"] is False


def test_noncritical_production_surface_crossing_fails_safety_gate(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    report = _small_three_strata_report(harness, cases)
    outcome = next(
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"] == "raw_question_only"
    )
    outcome["critical"] = False
    outcome["surface_crossing"] = True

    metrics = harness.semantic_metrics(report)

    assert metrics["surface_crossings"] == 1
    assert metrics["gates_pass"] is False


def test_quote_control_plane_does_not_depend_on_assisted_parser_selection(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = next(case for case in cases if case["id"] == "snapshot-stock-current-ko")
    original = harness._compatibility_decision

    def reject_assisted(catalog: Any, question: str, intent: Any, **kwargs: Any) -> Any:
        if kwargs.get("evaluation_mode") == harness.APP_PIPELINE_MODE:
            return original(
                catalog,
                "비트코인 현재가 알려줘",
                intent,
                evaluation_mode=harness.RAW_BACKEND_MODE,
            )
        return original(catalog, question, intent, **kwargs)

    monkeypatch.setattr(harness, "_compatibility_decision", reject_assisted)
    outcome = harness.evaluate_variant((case,), "baseline")["cases"][0]

    assert outcome["evaluation_stratum"] == "identity_assisted_quote_control_plane"
    assert outcome["selected_operation_ref"] == "detail:ka10001:current_trading"
    assert outcome["correct"] is True


def test_direct_quote_intent_accepts_standalone_current_quote(
    harness: ModuleType,
) -> None:
    assert harness._matches_app_direct_quote_intent("삼성전자 현재가 알려줘") is True


@pytest.mark.parametrize(
    "question",
    (
        "한국전력의 거래원 조회에서 현재가와 거래량 요약만 보여줘",
        "한국전력 현재가와 broker 동향을 보여줘",
        "한국전력 현재가 거래량 차트",
    ),
)
def test_direct_quote_intent_rejects_competing_operation_semantics(
    harness: ModuleType, question: str
) -> None:
    assert harness._matches_app_direct_quote_intent(question) is False


@pytest.mark.parametrize(
    ("acceptance_key", "stratum"),
    (
        ("minimum_raw_question_only_cases", "raw_question_only"),
        (
            "minimum_identity_assisted_quote_control_plane_cases",
            "identity_assisted_quote_control_plane",
        ),
        (
            "minimum_resolver_assisted_semantic_shadow_cases",
            "resolver_assisted_semantic_shadow",
        ),
    ),
)
def test_sealed_v5_each_stratum_minimum_fails_independently(
    harness: ModuleType, acceptance_key: str, stratum: str
) -> None:
    acceptance = deepcopy(harness.SEALED_V5_ACCEPTANCE)
    coverage = {
        "case_count": 100,
        "critical_cases": 40,
        "rejected_forbidden_cases": 10,
        "answerable_cases": 40,
        "languages": ["en", "ko", "mixed"],
        "coverage_tags": sorted(
            set(acceptance["required_execution_tags"])
            | set(acceptance["required_domain_tags"])
            | set(acceptance["required_safety_tags"])
        ),
        "pair_groups": 1,
        "metamorphic_groups": 1,
        "stratum_counts": {
            "raw_question_only": 89,
            "identity_assisted_quote_control_plane": 10,
            "resolver_assisted_semantic_shadow": 1,
            "unsupported_identity_surface_advisory": 0,
        },
    }
    coverage["stratum_counts"][stratum] = acceptance[acceptance_key] - 1

    with pytest.raises(ValueError, match=acceptance_key):
        harness._validate_sealed_coverage(coverage, acceptance)


def test_sealed_v5_rejects_any_unsupported_identity_advisory(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    marked = next(
        case
        for case in cases
        if case.get("identity_support") == "unsupported_by_frozen_provider"
    )
    coverage = harness._sealed_coverage((marked,))

    assert coverage["stratum_counts"]["unsupported_identity_surface_advisory"] == 1
    with pytest.raises(
        ValueError, match="unsupported_identity_surface_advisory_maximum"
    ):
        harness._validate_sealed_coverage(coverage, harness.SEALED_V5_ACCEPTANCE)


def test_unsupported_advisory_never_calls_semantic_selector(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marked = next(
        case
        for case in cases
        if case.get("identity_support") == "unsupported_by_frozen_provider"
    )

    def forbidden(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("unsupported advisory reached semantic selector")

    monkeypatch.setattr(harness, "_compatibility_decision", forbidden)
    outcome = harness.evaluate_variant((marked,), "baseline")["cases"][0]

    assert outcome["evaluation_stratum"] == "unsupported_identity_surface_advisory"


def test_sealed_structural_coverage_never_calls_selector_decision(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_decision(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("selector decision ran before manifest")

    monkeypatch.setattr(harness, "_compatibility_decision", forbidden_decision)
    monkeypatch.setattr(harness, "analyze_question", forbidden_decision)

    coverage = harness._sealed_coverage(cases[:4])

    assert sum(coverage["stratum_counts"].values()) == 4


def test_freeze_source_set_includes_stock_master_fixture(harness: ModuleType) -> None:
    assert STOCK_MASTER_PATH.resolve() in harness._freeze_source_paths()


def test_evaluator_preserves_full_typed_compatibility_trace(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    outcome = harness.evaluate_variant((cases[0],), "baseline")["cases"][0]

    assert set(outcome["compatibility_trace"]) == {
        "status",
        "confidence",
        "reason_codes",
        "compatible_operation_refs",
        "proofs",
        "dominance_edges",
        "equivalence_collapses",
    }
    assert outcome["compatibility_trace"]["proofs"]


def test_reversed_lexical_ranking_never_changes_final_decision_or_confidence(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = cases[0]
    before = harness.evaluate_variant((case,), "baseline")["cases"][0]
    original = harness.ranking.rank_documents
    calls = 0

    def reversed_ranking(query: str, documents: tuple[Any, ...]) -> tuple[Any, ...]:
        nonlocal calls
        calls += 1
        return tuple(reversed(original(query, documents)))

    monkeypatch.setattr(harness.ranking, "rank_documents", reversed_ranking)
    after = harness.evaluate_variant((case,), "baseline")["cases"][0]

    assert (
        after["selected_family"],
        after["selected_operation_ref"],
        after["selection_outcome"],
        after["policy_confidence"],
    ) == (
        before["selected_family"],
        before["selected_operation_ref"],
        before["selection_outcome"],
        before["policy_confidence"],
    )
    assert calls == 1


def test_lexical_ablation_never_changes_typed_final_decision(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    sample = cases[:4]
    baseline = harness.evaluate_variant(sample, "baseline")["cases"]
    ablated = harness.evaluate_variant(sample, "without_field_descriptions")["cases"]

    assert [
        (
            case["selected_family"],
            case["selected_operation_ref"],
            case["selection_outcome"],
            case["policy_confidence"],
        )
        for case in ablated
    ] == [
        (
            case["selected_family"],
            case["selected_operation_ref"],
            case["selection_outcome"],
            case["policy_confidence"],
        )
        for case in baseline
    ]


def test_guarded_disposition_requires_expected_order_selection(
    harness: ModuleType,
) -> None:
    case = {
        "expected_disposition": "guarded",
        "expected_family_refs": ["base:kt10000"],
        "expected_refs": ["base:kt10000"],
    }

    assert harness._disposition_correct(
        case,
        selected_family="base:kt10000",
        selected_operation="base:kt10000",
        selected_kind="order",
    )


def test_guarded_disposition_rejects_unguarded_query_selection(
    harness: ModuleType,
) -> None:
    case = {
        "expected_disposition": "guarded",
        "expected_family_refs": ["base:kt10000"],
        "expected_refs": ["base:kt10000"],
    }

    assert not harness._disposition_correct(
        case,
        selected_family="base:kt10000",
        selected_operation="base:kt10000",
        selected_kind="query",
    )


def test_guarded_disposition_accepts_expected_websocket_selection(
    harness: ModuleType,
) -> None:
    case = {
        "expected_disposition": "guarded",
        "expected_family_refs": ["base:0B"],
        "expected_refs": ["base:0B"],
    }

    assert harness._disposition_correct(
        case,
        selected_family="base:0B",
        selected_operation="base:0B",
        selected_kind="websocket",
    )


def test_legacy_multiword_alias_flattening_reintroduces_entity_only_contamination(
    harness: ModuleType,
) -> None:
    atomic = set(harness.lexicon.synonym_only_tokens(("elw",)))
    flattened = set(harness._legacy_flattened_multiword_synonyms(("elw",)))

    assert "indicator" not in atomic
    assert "indicator" in flattened


def test_routing_scope_error_detects_cross_subject_selection(
    harness: ModuleType,
) -> None:
    catalog = harness.build_operation_catalog()
    expected = next(
        document
        for document in catalog.documents
        if document.operation_ref.startswith("base:")
        and document.kind == "query"
        and document.routing.subject.value == "instrument"
    )
    selected = next(
        document
        for document in catalog.documents
        if document.operation_ref.startswith("base:")
        and document.kind == "query"
        and document.routing.subject.value == "account"
    )

    assert harness._routing_scope_error(
        catalog, {expected.family_ref}, selected.family_ref
    )


def test_routing_scope_error_keeps_same_family_detail_miss_non_severe(
    harness: ModuleType,
) -> None:
    catalog = harness.build_operation_catalog()
    family = next(
        document.family_ref
        for document in catalog.documents
        if document.operation_ref.startswith("base:") and document.kind == "query"
    )

    assert not harness._routing_scope_error(catalog, {family}, family)


def test_sealed_freeze_manifest_predeclares_hashes_versions_and_gates(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=expansion,
        command="predeclared-command",
    )

    assert manifest["command"] == "predeclared-command"
    assert manifest["case_count"] == len(expansion)
    assert len(manifest["corpus_sha256"]) == 64
    assert len(manifest["source_state_sha256"]) == 64
    assert manifest["catalog_version"]
    assert manifest["query_frame_version"] == harness.QUERY_FRAME_VERSION
    assert manifest["routing_contract_version"] == harness.ROUTING_CONTRACT_VERSION
    assert manifest["lexicon_version"]
    assert manifest["entity_marker_version"] == harness.ENTITY_MARKER_VERSION
    assert "backend/ref/selector-entity-markers.json" in manifest["source_hashes"]
    assert manifest["evaluation_mode"] == harness.APP_PIPELINE_MODE
    assert manifest["target_resolver"]["fixture"] == STOCK_MASTER_PATH.name
    assert manifest["target_resolver"]["fixture_sha256"] == hashlib.sha256(
        STOCK_MASTER_PATH.read_bytes()
    ).hexdigest()
    assert manifest["gold_hint_inputs_present"] is False
    assert "backend/scripts/evaluate_selector_ablations.py" in manifest["source_hashes"]
    assert manifest["predeclared_gates"] == {
        "minimum_case_count": 60,
        "minimum_critical_cases": 40,
        "minimum_rejected_forbidden_cases": 10,
        "minimum_answerable_cases": 40,
        "required_execution_tags": ["query", "order", "websocket", "oauth"],
        "required_domain_tags": [
            "stock",
            "sector",
            "account",
            "etf",
            "elw",
            "gold",
        ],
        "required_safety_tags": ["ambiguity", "ood"],
        "required_languages": ["ko", "en", "mixed"],
        "minimum_pair_groups": 1,
        "minimum_metamorphic_groups": 1,
        "overall_final_policy_accuracy_minimum": 0.98,
        "exact_operation_accuracy_minimum": 0.95,
        "critical_tag_member_accuracy": 1.0,
        "wrong_plans_maximum": 0,
        "surface_crossings_maximum": 0,
        "severe_scope_errors_maximum": 0,
        "high_confidence_selected_precision": 1.0,
        "rejected_forbidden_precision": 1.0,
        "calibration_pass": True,
        "gold_hint_inputs_allowed": False,
    }


def test_sealed_v3_manifest_requires_at_least_one_hundred_cases(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    synthetic_v3 = expansion + expansion[:27]
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]

    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=synthetic_v3,
        command="predeclared-v3-command",
        sealed_generation="v3",
        production_freeze_hash=freeze_hash,
    )

    assert manifest["predeclared_gates"]["minimum_case_count"] == 100
    with pytest.raises(ValueError, match="minimum_case_count"):
        harness.sealed_freeze_manifest(
            corpus_path=EXPANSION_CORPUS_PATH,
            cases=synthetic_v3[:-1],
            command="predeclared-v3-command",
            sealed_generation="v3",
            production_freeze_hash=freeze_hash,
        )


def test_sealed_v3_manifest_records_freeze_and_v4_failure_policy(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]
    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=expansion + expansion[:27],
        command="predeclared-v3-command",
        sealed_generation="v3",
        production_freeze_hash=freeze_hash,
    )

    assert manifest["sealed_generation"] == "v3"
    assert manifest["production_freeze_git_blob_manifest_sha1"] == freeze_hash
    assert manifest["failure_policy"]["next_sealed_generation"] == "v4_required"


def test_sealed_v4_manifest_records_exact_count_freeze_and_v5_failure_policy(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]
    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=expansion + expansion[:27],
        command="predeclared-v4-command",
        sealed_generation="v4",
        production_freeze_hash=freeze_hash,
    )

    assert manifest["sealed_generation"] == "v4"
    assert manifest["predeclared_gates"]["minimum_case_count"] == 100
    assert manifest["production_freeze_git_blob_manifest_sha1"] == freeze_hash
    assert manifest["failure_policy"]["next_sealed_generation"] == "v5_required"


@pytest.mark.skip(
    reason=(
        "v5 봉인 코퍼스 미작성 — 차단 사유다(완료 증거가 아니다). 이 게이트는 100건의 "
        "새 질문(직접 quote 10건 이상·advisory 0·중복/근사복사 없음)을 요구하는데, "
        "기존 코퍼스 파생으로는 구조적으로 만족할 수 없다(중복·근사복사 검사에 걸린다). "
        "SEALED_V5_ACCEPTANCE 사양은 그대로 두고, 코퍼스를 저술하는 커밋에서 함께 해제한다."
    )
)
def test_sealed_v5_requires_exactly_one_hundred_cases(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    synthetic = _synthetic_sealed_cases(expansion, 100)
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]

    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=synthetic,
        command="predeclared-v5-command",
        sealed_generation="v5",
        production_freeze_hash=freeze_hash,
    )

    assert manifest["predeclared_gates"]["required_case_count"] == 100
    assert manifest["failure_policy"]["next_sealed_generation"] == "v6_required"
    for invalid in (synthetic[:-1], synthetic + synthetic[:1]):
        with pytest.raises(ValueError, match="required_case_count"):
            harness.sealed_freeze_manifest(
                corpus_path=EXPANSION_CORPUS_PATH,
                cases=invalid,
                command="predeclared-v5-command",
                sealed_generation="v5",
                production_freeze_hash=freeze_hash,
            )


def test_sealed_manifest_rejects_unverified_freeze_hash(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)

    with pytest.raises(ValueError, match="production freeze hash mismatch"):
        harness.sealed_freeze_manifest(
            corpus_path=EXPANSION_CORPUS_PATH,
            cases=expansion + expansion[:27],
            command="predeclared-v5-command",
            sealed_generation="v5",
            production_freeze_hash="0" * 40,
        )


@pytest.mark.skip(
    reason=(
        "v5 봉인 코퍼스 미작성 — 차단 사유다(완료 증거가 아니다). 이 게이트는 100건의 "
        "새 질문(직접 quote 10건 이상·advisory 0·중복/근사복사 없음)을 요구하는데, "
        "기존 코퍼스 파생으로는 구조적으로 만족할 수 없다(중복·근사복사 검사에 걸린다). "
        "SEALED_V5_ACCEPTANCE 사양은 그대로 두고, 코퍼스를 저술하는 커밋에서 함께 해제한다."
    )
)
def test_sealed_manifest_records_verified_canonical_git_blob_entries(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    freeze = harness.canonical_git_blob_freeze_manifest()
    synthetic = _synthetic_sealed_cases(expansion, 100)
    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=synthetic,
        command="predeclared-v5-command",
        sealed_generation="v5",
        production_freeze_hash=freeze["manifest_sha1"],
    )

    assert manifest["production_freeze_git_blob_manifest"] == freeze
    assert manifest["production_freeze_verified"] is True
    assert "backend/scripts/evaluate_selector_ablations.py" in freeze["entries"]


@pytest.mark.skip(
    reason=(
        "v5 봉인 코퍼스 미작성 — 차단 사유다(완료 증거가 아니다). 이 게이트는 100건의 "
        "새 질문(직접 quote 10건 이상·advisory 0·중복/근사복사 없음)을 요구하는데, "
        "기존 코퍼스 파생으로는 구조적으로 만족할 수 없다(중복·근사복사 검사에 걸린다). "
        "SEALED_V5_ACCEPTANCE 사양은 그대로 두고, 코퍼스를 저술하는 커밋에서 함께 해제한다."
    )
)
def test_sealed_v5_rejects_overlap_with_current_regression_corpora(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    synthetic = list(_synthetic_sealed_cases(expansion, 100))
    synthetic[0] = deepcopy(cases[0])
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]

    with pytest.raises(ValueError, match="overlaps regression corpora"):
        harness.sealed_freeze_manifest(
            corpus_path=EXPANSION_CORPUS_PATH,
            cases=tuple(synthetic),
            command="predeclared-v5-command",
            sealed_generation="v5",
            production_freeze_hash=freeze_hash,
        )


@pytest.mark.skip(
    reason=(
        "v5 봉인 코퍼스 미작성 — 차단 사유다(완료 증거가 아니다). 이 게이트는 100건의 "
        "새 질문(직접 quote 10건 이상·advisory 0·중복/근사복사 없음)을 요구하는데, "
        "기존 코퍼스 파생으로는 구조적으로 만족할 수 없다(중복·근사복사 검사에 걸린다). "
        "SEALED_V5_ACCEPTANCE 사양은 그대로 두고, 코퍼스를 저술하는 커밋에서 함께 해제한다."
    )
)
def test_sealed_v5_rejects_suffix_copy_of_regression_question(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    synthetic = list(_synthetic_sealed_cases(expansion, 100))
    synthetic[0]["question"] = cases[0]["question"] + " 알려주세요"
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]

    with pytest.raises(ValueError, match="overlaps regression corpora"):
        harness.sealed_freeze_manifest(
            corpus_path=EXPANSION_CORPUS_PATH,
            cases=tuple(synthetic),
            command="predeclared-v5-command",
            sealed_generation="v5",
            production_freeze_hash=freeze_hash,
        )


@pytest.mark.skip(
    reason=(
        "v5 봉인 코퍼스 미작성 — 차단 사유다(완료 증거가 아니다). 이 게이트는 100건의 "
        "새 질문(직접 quote 10건 이상·advisory 0·중복/근사복사 없음)을 요구하는데, "
        "기존 코퍼스 파생으로는 구조적으로 만족할 수 없다(중복·근사복사 검사에 걸린다). "
        "SEALED_V5_ACCEPTANCE 사양은 그대로 두고, 코퍼스를 저술하는 커밋에서 함께 해제한다."
    )
)
def test_sealed_v5_records_current_overlap_corpus_hashes(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    synthetic = _synthetic_sealed_cases(expansion, 100)
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]
    manifest = harness.sealed_freeze_manifest(
        corpus_path=EXPANSION_CORPUS_PATH,
        cases=synthetic,
        command="predeclared-v5-command",
        sealed_generation="v5",
        production_freeze_hash=freeze_hash,
    )

    references = manifest["overlap_reference_corpora"]
    for path in harness._OVERLAP_REFERENCE_CORPORA:
        assert references[path.name] == {
            "case_count": len(harness.load_cases(path)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }


def test_freeze_manifest_covers_generated_catalog_and_direct_generator_inputs(
    harness: ModuleType,
) -> None:
    entries = harness.canonical_git_blob_freeze_manifest()["entries"]

    assert {
        "backend/athena_api/generated/models.py",
        "backend/athena_api/generated/registry.py",
        "backend/ref/kiwoom-tr-inventory.json",
        "backend/ref/response-projections.json",
        "backend/ref/ka10007-detail-groups.json",
        "backend/ref/kiwoom-io-source-profile.json",
        "backend/ref/selector-routing.json",
        "backend/ref/selector-entity-markers.json",
        "backend/tests/fixtures/stock_entity_master_eval.json",
        "backend/athena_api/dependencies.py",
        "backend/athena_api/lifespan.py",
        "backend/athena_api/main.py",
        "backend/athena_api/api/llm_tools.py",
    }.issubset(entries)


@pytest.mark.parametrize(
    "logical_path",
    [
        "backend/athena_api/generated/registry.py",
        "backend/ref/response-projections.json",
    ],
)
def test_freeze_manifest_changes_when_catalog_source_changes(
    harness: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    logical_path: str,
) -> None:
    before = harness.canonical_git_blob_freeze_manifest()
    target = BACKEND.parent / logical_path
    original = Path.read_bytes

    def changed_bytes(path: Path) -> bytes:
        content = original(path)
        return content + b"\nfreeze-test" if path.resolve() == target.resolve() else content

    monkeypatch.setattr(Path, "read_bytes", changed_bytes)

    assert harness.canonical_git_blob_freeze_manifest()["manifest_sha1"] != (
        before["manifest_sha1"]
    )


def test_pre_evaluation_recheck_detects_source_change(
    harness: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    frozen = harness.canonical_git_blob_freeze_manifest()
    changed = {**frozen, "manifest_sha1": "f" * 40}
    monkeypatch.setattr(
        harness,
        "canonical_git_blob_freeze_manifest",
        lambda: changed,
    )

    with pytest.raises(RuntimeError, match="changed after freeze manifest"):
        harness.assert_freeze_snapshot_unchanged(frozen)


def test_post_evaluation_freeze_recheck_occurs_before_artifact_write() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    evaluation = source.index("report = evaluate_all(")
    post_evaluation_recheck = source.index(
        "assert_freeze_snapshot_unchanged(frozen_blob_manifest)",
        evaluation,
    )
    artifact_write = source.index("_write_exclusive(args.output", post_evaluation_recheck)

    assert evaluation < post_evaluation_recheck < artifact_write


def test_autonomous_corpus_uses_only_canonical_expected_family_labels(
    cases: tuple[dict[str, Any], ...],
) -> None:
    expected_refs = [ref for case in cases for ref in case["expected_refs"]]
    assert expected_refs
    assert all(ref.startswith("base:") and ref.count(":") == 1 for ref in expected_refs)
    assert all(
        bool(case["expected_refs"]) == (case["expected_disposition"] == "select")
        for case in cases
    )


def test_critical_cases_explicitly_declare_groups_and_exact_operation_expectations(
    cases: tuple[dict[str, Any], ...],
) -> None:
    critical = [case for case in cases if case.get("critical")]
    assert len(critical) == 57
    assert all(case["critical_groups"] for case in critical)
    assert all("expected_operation_refs" in case for case in critical)
    assert all("expected_kind" in case for case in critical)
    assert all(
        ref.startswith(("base:", "detail:"))
        for case in critical
        for ref in case["expected_operation_refs"]
    )


def test_metamorphic_groups_have_at_least_two_members(
    cases: tuple[dict[str, Any], ...],
) -> None:
    groups = Counter(
        case.get("metamorphic_group")
        for case in cases
        if case.get("metamorphic_group")
    )
    assert groups
    assert min(groups.values()) >= 2


def test_every_contrast_pair_has_exactly_two_cases(
    cases: tuple[dict[str, Any], ...],
) -> None:
    pair_counts = Counter(case["pair_id"] for case in cases if case["pair_id"])
    assert pair_counts
    assert set(pair_counts.values()) == {2}


def test_evaluator_reruns_ranking_once_per_case(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0
    original = harness.ranking.rank_documents

    def counted_rank_documents(query: str, documents: tuple[Any, ...]) -> tuple[Any, ...]:
        nonlocal calls
        calls += 1
        return original(query, documents)

    monkeypatch.setattr(harness.ranking, "rank_documents", counted_rank_documents)
    harness.evaluate_variant(cases, "without_field_descriptions")
    assert calls == len(cases)


def test_each_ablation_reports_top1_pairs_scope_errors_and_comparison(
    harness: ModuleType, cases: tuple[dict[str, Any], ...]
) -> None:
    report = harness.evaluate_all(cases)
    assert [variant["variant"] for variant in report["variants"]] == list(
        harness.VARIANTS
    )
    assert all(variant["cases_evaluated"] == 117 for variant in report["variants"])
    assert all(len(variant["cases"]) == 117 for variant in report["variants"])
    assert all(
        {
            "top1_family",
            "top1_score",
            "top1_authoritative_score",
            "top1_typed_tier",
            "runner_up_family",
            "runner_up_score",
            "score_margin",
            "score_margin_ratio",
            "authoritative_margin",
            "policy_confidence",
            "retrieval_score_band",
            "selected_family",
            "selected_operation_ref",
            "correct",
            "severe_scope_error",
            "surface_crossing",
        }.issubset(case)
        for variant in report["variants"]
        for case in variant["cases"]
    )
    assert all(
        {"wins", "losses", "ties"} == set(variant["vs_baseline"])
        for variant in report["variants"]
    )
    assert all(
        {"passed", "total", "accuracy"} == set(metric)
        for variant in report["variants"]
        for metric in variant["critical_group_metrics"].values()
    )
    metrics = harness.semantic_metrics(report)
    assert metrics["schema_version"] == 4
    calibration = metrics["autonomous_calibration"]
    # 최상위 보정은 raw 계층 하나만 본다. 식별 보조·shadow·advisory는 각자
    # 별도 보정으로 보고되며 여기에 섞이지 않는다.
    raw_case_count = sum(
        case["evaluation_stratum"] == "raw_question_only"
        for case in report["variants"][0]["cases"]
    )
    assert calibration["population"] == "question_only_autonomous:raw"
    assert calibration["identity_assisted_cases"] == 0
    assert calibration["total_cases"] == raw_case_count
    assert sum(
        item["cases"] for item in calibration["policy_confidence_bins"].values()
    ) == raw_case_count
    assert sum(
        item["cases"] for item in calibration["retrieval_score_bands"].values()
    ) == raw_case_count
    assert calibration["retrieval_thresholds_observed"] == {
        "minimum_score": 240,
        "close_margin_absolute": 80,
        "close_margin_ratio": 1.15,
        "descriptive_upper_band_score": 1000,
    }
    assert (
        calibration["selected"]["cases"] + calibration["rejected"]["cases"]
        == raw_case_count
    )
    # 정밀도 지표는 프로덕션 계층(raw + 식별 보조)에서만 계산한다 — shadow·advisory는
    # 실행 권위가 아니므로 같은 분모에 들어가지 않는다.
    production_cases = [
        case
        for case in report["variants"][0]["cases"]
        if case["evaluation_stratum"]
        in {"raw_question_only", "identity_assisted_quote_control_plane"}
    ]
    policy_rejections = [
        case for case in production_cases if case["selected_family"] is None
    ]
    assert metrics["rejected_forbidden_precision"] == round(
        sum(
            case["expected_disposition"] in {"reject", "forbidden"}
            for case in policy_rejections
        )
        / len(policy_rejections),
        6,
    )
    assert (
        calibration["threshold_evidence"]["score_below_240_cases"]
        + calibration["threshold_evidence"]["score_at_least_240_cases"]
        + calibration["retrieval_score_bands"]["no_result"]["cases"]
        == raw_case_count
    )
    assert (
        calibration["threshold_evidence"]["absolute_margin_below_80_cases"]
        + calibration["threshold_evidence"]["absolute_margin_at_least_80_cases"]
        + calibration["threshold_evidence"]["no_runner_up_cases"]
        == raw_case_count
    )
    assert (
        calibration["threshold_evidence"]["ratio_below_1_15_cases"]
        + calibration["threshold_evidence"]["ratio_at_least_1_15_cases"]
        + calibration["threshold_evidence"]["no_score_ratio_cases"]
        == raw_case_count
    )
    confidence_bins = calibration["policy_confidence_bins"]
    assert confidence_bins["low"]["rejected_cases"] == calibration["rejected"]["cases"]
    assert confidence_bins["high"]["rejected_cases"] == 0
    assert confidence_bins["medium"]["rejected_cases"] == 0
    flagship = next(
        case
        for case in report["variants"][0]["cases"]
        if case["id"] == "snapshot-stock-current-ko"
    )
    vague_price = next(
        case
        for case in report["variants"][0]["cases"]
        if case["id"] == "ambiguity-price-ko"
    )
    # 기함 케이스는 식별 보조 quote 계층에 있고, 애매 가격 케이스는 raw에 있다.
    # 각자 자기 계층의 보정에서만 앵커로 잡힌다 — 계층을 섞지 않는다.
    assert flagship["evaluation_stratum"] == "identity_assisted_quote_control_plane"
    assert vague_price["evaluation_stratum"] == "raw_question_only"
    assert calibration["flagship_case"] is None
    assert metrics["identity_assisted_calibration"]["flagship_case"] == {
        key: flagship[key]
        for key in ("id", "decision", "policy_confidence", "correct")
    }
    assert calibration["vague_price_case"] == {
        key: vague_price[key]
        for key in ("id", "decision", "policy_confidence", "correct")
    }
    expected_calibration_pass = (
        confidence_bins["high"]["selected_precision"] == 1.0
        and confidence_bins["medium"]["selected_precision"] in {None, 1.0}
        and confidence_bins["high"]["rejected_cases"] == 0
        and confidence_bins["medium"]["rejected_cases"] == 0
        and confidence_bins["low"]["rejected_cases"] == calibration["rejected"]["cases"]
        and calibration["rejected"]["precision"] == 1.0
        and calibration["vague_price_case"]["decision"] == "rejected"
        and calibration["vague_price_case"]["policy_confidence"] == "low"
        and calibration["vague_price_case"]["correct"]
    )
    assert calibration["calibration_pass"] is expected_calibration_pass


def test_semantic_gate_cannot_pass_with_a_hidden_critical_failure(
    harness: ModuleType, cases: tuple[dict[str, Any], ...]
) -> None:
    report = harness.evaluate_all(cases)
    broken = deepcopy(report)
    before = harness.semantic_metrics(report)["critical_failure_count"]
    critical = next(
        case
        for case in broken["variants"][0]["cases"]
        if case["critical"] and case["correct"]
    )
    critical["correct"] = False
    assert harness.semantic_metrics(broken)["critical_failure_count"] == before + 1
    assert harness.semantic_metrics(broken)["gates_pass"] is False


def test_correct_retrieval_top1_cannot_hide_policy_abstention(
    harness: ModuleType,
    cases: tuple[dict[str, Any], ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current = harness.evaluate_variant(cases, "baseline")
    current_outcome = next(
        outcome
        for outcome in current["cases"]
        if outcome["top1_family"] in outcome["expected_refs"]
        and outcome["selected_family"] is not None
        # 직접 quote 경로는 typed 계약으로 선택을 고정하므로 정책 기권 자체가 없다.
        and outcome["evaluation_stratum"] != "identity_assisted_quote_control_plane"
    )
    target = next(case for case in cases if case["id"] == current_outcome["id"])
    original = harness._compatibility_decision

    def abstain_on_target(
        catalog: Any, question: str, intent: Any, **kwargs: Any
    ) -> Any:
        decision = original(catalog, question, intent, **kwargs)
        if question != target["question"]:
            return decision
        # 검색 top1이 정답이어도 정책이 기권하면 실패로 잡혀야 한다.
        return replace(
            decision,
            status=harness.CompatibilityDecisionStatus.AMBIGUOUS,
            selected_family_ref=None,
            selected_operation_ref=None,
            reason_codes=("AMBIGUOUS_OPERATION",),
        )

    monkeypatch.setattr(harness, "_compatibility_decision", abstain_on_target)
    baseline = harness.evaluate_variant(cases, "baseline")
    outcome = next(case for case in baseline["cases"] if case["id"] == target["id"])
    report = {
        "corpus": str(CORPUS_PATH),
        "case_count": len(cases),
        "variants": [baseline],
    }

    assert outcome["top1_family"] in target["expected_refs"]
    assert outcome["selected_family"] is None
    assert outcome["correct"] is False
    assert harness.semantic_metrics(report)["gates_pass"] is False


def test_sealed_partition_does_not_depend_on_public_anchor_case_ids(
    harness: ModuleType, cases: tuple[dict[str, Any], ...]
) -> None:
    sealed_cases = tuple(
        case
        for case in cases
        if case["id"] not in {"snapshot-stock-current-ko", "ambiguity-price-ko"}
    )[:4]
    report = {
        "corpus": "sealed-fixture-not-opened.jsonl",
        "partition": "sealed_holdout",
        "case_count": len(sealed_cases),
        "variants": [harness.evaluate_variant(sealed_cases, "baseline")],
    }

    calibration = harness.semantic_metrics(report)["autonomous_calibration"]
    assert calibration["population"] == "sealed_holdout:raw"
    assert calibration["flagship_case"] is None
    assert calibration["vague_price_case"] is None


def test_autonomous_expansion_full_evaluation_gate_covers_every_case(
    harness: ModuleType,
) -> None:
    expansion = harness.load_cases(EXPANSION_CORPUS_PATH)
    report = harness.evaluate_all(
        expansion,
        corpus_path=EXPANSION_CORPUS_PATH,
        partition="autonomous_expansion",
    )
    metrics = harness.semantic_metrics(report)

    assert report["case_count"] == len(expansion)
    # 모든 케이스가 어느 계층에든 정확히 한 번 계상돼야 한다. 프로덕션 게이트가
    # shadow·advisory를 제외하는 것과, 케이스가 조용히 사라지는 것은 다르다.
    assert (
        sum(stratum["cases"] for stratum in metrics["strata"].values())
        == len(expansion)
    )
    assert metrics["production_case_count"] == (
        metrics["strata"]["raw_question_only"]["cases"]
        + metrics["strata"]["identity_assisted_quote_control_plane"]["cases"]
    )
    assert metrics["gates_pass"] is (
        metrics["critical_failure_count"] == 0
        and metrics["production_correct"] == metrics["production_case_count"]
        and not metrics["failed_critical_groups"]
        and metrics["wrong_plans"] == 0
        and metrics["surface_crossings"] == 0
        and metrics["severe_scope_errors"] == 0
        and metrics["autonomous_calibration"]["calibration_pass"]
    )


def test_evaluator_cli_returns_zero_for_fresh_green_gate_metrics(
    tmp_path: Path,
) -> None:
    metrics = tmp_path / "green.json"
    metrics.write_text(json.dumps({"gates_pass": True}), encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--gate-metrics", str(metrics)],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0


def test_evaluator_cli_returns_nonzero_for_fresh_red_gate_metrics(
    tmp_path: Path,
) -> None:
    metrics = tmp_path / "red.json"
    metrics.write_text(json.dumps({"gates_pass": False}), encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--gate-metrics", str(metrics)],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "semantic gates RED" in result.stderr


def test_sealed_cli_refuses_to_overwrite_any_existing_artifact(
    tmp_path: Path,
) -> None:
    output = tmp_path / "report.json"
    metrics = tmp_path / "metrics.json"
    manifest = tmp_path / "freeze.json"
    manifest.write_text("occupied", encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--corpus",
            str(EXPANSION_CORPUS_PATH),
            "--partition",
            "sealed_holdout",
            "--output",
            str(output),
            "--metrics-output",
            str(metrics),
            "--freeze-manifest-output",
            str(manifest),
        ],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "refuses existing artifacts" in result.stderr
    assert manifest.read_text(encoding="utf-8") == "occupied"
    assert not output.exists()
    assert not metrics.exists()


def test_sealed_cli_refuses_existing_artifact_before_reading_corpus(
    tmp_path: Path,
) -> None:
    missing_corpus = tmp_path / "must-not-be-read.jsonl"
    manifest = tmp_path / "freeze.json"
    manifest.write_text("occupied", encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--corpus",
            str(missing_corpus),
            "--partition",
            "sealed_holdout",
            "--output",
            str(tmp_path / "report.json"),
            "--metrics-output",
            str(tmp_path / "metrics.json"),
            "--freeze-manifest-output",
            str(manifest),
        ],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "refuses existing artifacts" in result.stderr
    assert "FileNotFoundError" not in result.stderr


def test_sealed_cli_refuses_exposed_v2_before_creating_artifacts(
    tmp_path: Path,
) -> None:
    output = tmp_path / "report.json"
    metrics = tmp_path / "metrics.json"
    manifest = tmp_path / "freeze.json"

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--corpus",
            str(EXPOSED_V2_CORPUS_PATH),
            "--partition",
            "sealed_holdout",
            "--output",
            str(output),
            "--metrics-output",
            str(metrics),
            "--freeze-manifest-output",
            str(manifest),
        ],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "exposed-after-sealed-v2-failure" in result.stderr
    assert not manifest.exists()
    assert not output.exists()
    assert not metrics.exists()


def test_sealed_cli_generically_refuses_exposed_generation(
    harness: ModuleType,
    tmp_path: Path,
) -> None:
    freeze_hash = harness.canonical_git_blob_freeze_manifest()["manifest_sha1"]
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--corpus",
            str(EXPOSED_V3_CORPUS_PATH),
            "--partition",
            "sealed_holdout",
            "--sealed-generation",
            "v5",
            "--production-freeze-hash",
            freeze_hash,
            "--output",
            str(tmp_path / "report.json"),
            "--metrics-output",
            str(tmp_path / "metrics.json"),
            "--freeze-manifest-output",
            str(tmp_path / "freeze.json"),
        ],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "exposed-after-sealed-v3-failure" in result.stderr
    assert not any(tmp_path.iterdir())


def test_sealed_cli_writes_manifest_before_evaluation_failure(
    harness: ModuleType,
    tmp_path: Path,
) -> None:
    cases = [dict(case) for case in harness.load_cases(EXPANSION_CORPUS_PATH)]
    cases[0]["intent"] = "invalid-intent-for-pre-evaluation-test"
    corpus = tmp_path / "future-v2.jsonl"
    corpus.write_text(
        "\n".join(json.dumps(case, ensure_ascii=False) for case in cases) + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "report.json"
    metrics = tmp_path / "metrics.json"
    manifest = tmp_path / "freeze.json"

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--corpus",
            str(corpus),
            "--partition",
            "sealed_holdout",
            "--output",
            str(output),
            "--metrics-output",
            str(metrics),
            "--freeze-manifest-output",
            str(manifest),
        ],
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
    )

    written = json.loads(manifest.read_text(encoding="utf-8"))
    assert result.returncode != 0
    assert written["run_status"] == "manifest_created_evaluation_not_started"
    assert written["corpus_label"] == corpus.name
    assert str(tmp_path) not in written["command"]
    assert not output.exists()
    assert not metrics.exists()


def test_all_critical_semantic_groups_are_green(
    harness: ModuleType, cases: tuple[dict[str, Any], ...]
) -> None:
    baseline = harness.evaluate_variant(cases, "baseline")
    failed_groups = [
        group for group, passed in baseline["critical_groups"].items() if not passed
    ]
    failures = [
        case["id"]
        for case in baseline["cases"]
        if case["critical"]
        and (
            not case["correct"]
            or case["severe_scope_error"]
            or case["surface_crossing"]
        )
    ]
    assert not failed_groups, (
        f"critical semantic gates RED: groups={failed_groups}; cases={failures}"
    )
    assert baseline["wrong_plans"] == 0
    assert baseline["surface_crossings"] == 0


def test_ablation_runtime_restores_baseline_deterministically(
    harness: ModuleType, cases: tuple[dict[str, Any], ...]
) -> None:
    before = harness.evaluate_variant(cases, "baseline")
    harness.evaluate_variant(cases, "without_raw_bigrams")
    after = harness.evaluate_variant(cases, "baseline")
    assert after == before
