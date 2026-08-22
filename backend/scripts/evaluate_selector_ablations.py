"""Measure selector feature ablations against question-only autonomous cases.

This is deliberately a test/spike harness, not a production feature flag.  Every
variant reruns catalog construction, lexical ranking, and family selection.  It
never edits an already-produced contribution list.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import hmac
import json
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from types import MappingProxyType
from typing import Any

from athena_api.routing_contract import (
    QUERY_FRAME_VERSION,
    ROUTING_CONTRACT_VERSION,
    ROUTING_SOURCE_VERSION,
    EntityKind,
)
from athena_api.selector import lexicon, ranking
from athena_api.selector.catalog import (
    OperationCatalog,
    OperationDocument,
    build_operation_catalog,
)
from athena_api.selector.compatibility import (
    CompatibilityConfidence,
    CompatibilityDecision,
    CompatibilityDecisionStatus,
    decide_selector_compatibility,
)
from athena_api.selector.eligibility import _EXCLUSIVE_DATA_INTENTS
from athena_api.selector.instrument_identity import (
    IDENTITY_MARKET_KINDS,
    IDENTITY_MARKETS,
    InstrumentIdentityIndex,
    TargetResolution,
)
from athena_api.selector.primitive_evidence import (
    TargetPresence,
    analyze_question,
)
from athena_api.selector.query_frame import ENTITY_MARKER_VERSION
from athena_api.selector.schemas import DiscoveryIntent

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = BACKEND / "tests" / "fixtures" / "api_selector_autonomous.jsonl"
HISTORICAL_BASELINE_OUTPUT = (
    BACKEND.parent / "plan" / "selector-ablation-baseline-2026-08-20.json"
)
DEFAULT_OUTPUT = BACKEND.parent / "plan" / "selector-g003-autonomous-2026-08-20.json"
G005_METRIC_OUTPUT = (
    BACKEND.parent / "plan" / "selector-g005-semantic-metrics-2026-08-20.json"
)
SEALED_HOLDOUT_OUTPUT = (
    BACKEND.parent / "plan" / "selector-g006-sealed-holdout-2026-08-21.json"
)
SEALED_HOLDOUT_METRIC_OUTPUT = (
    BACKEND.parent / "plan" / "selector-g006-sealed-holdout-metrics-2026-08-21.json"
)
SEALED_HOLDOUT_FREEZE_MANIFEST = (
    BACKEND.parent / "plan" / "selector-g006-sealed-holdout-freeze-2026-08-21.json"
)
AUTONOMOUS_EXPANSION_CORPUS = (
    BACKEND / "tests" / "fixtures" / "api_selector_autonomous_expansion.jsonl"
)
AUTONOMOUS_EXPANSION_OUTPUT = (
    BACKEND.parent / "plan" / "selector-g006-autonomous-expansion-2026-08-21.json"
)
AUTONOMOUS_EXPANSION_METRIC_OUTPUT = (
    BACKEND.parent
    / "plan"
    / "selector-g006-autonomous-expansion-metrics-2026-08-21.json"
)
EXPOSED_V2_PROVENANCE = "exposed-after-sealed-v2-failure"
EXPOSED_V2_CORPUS = (
    BACKEND / "tests" / "fixtures" / "api_selector_autonomous_expansion_v2.jsonl"
)
EXPOSED_V2_OUTPUT = (
    BACKEND.parent
    / "plan"
    / "selector-g006-autonomous-expansion-v2-postfix-2026-08-21.json"
)
EXPOSED_V2_METRIC_OUTPUT = (
    BACKEND.parent
    / "plan"
    / "selector-g006-autonomous-expansion-v2-postfix-metrics-2026-08-21.json"
)
EXPOSED_V3_CORPUS = (
    BACKEND / "tests" / "fixtures" / "api_selector_autonomous_expansion_v3.jsonl"
)
EXPOSED_V4_CORPUS = (
    BACKEND / "tests" / "fixtures" / "api_selector_autonomous_expansion_v4.jsonl"
)
TRUSTED_STOCK_MASTER_PATH = (
    BACKEND / "tests" / "fixtures" / "stock_entity_master_eval.json"
)
STOCK_ENTITY_CONFORMANCE_PATH = (
    BACKEND / "tests" / "fixtures" / "stock_entity_resolver_conformance.json"
)
APP_STOCK_ENTITY_INDEX_PATH = BACKEND.parent / "app" / "lib" / "main" / "rest-dataset-runner.js"
APP_STOCK_ENTITY_INDEX_TEST_PATH = (
    BACKEND.parent / "app" / "lib" / "main" / "rest-dataset-runner.test.js"
)
APP_MAIN_PATH = BACKEND.parent / "app" / "main.js"
APP_LIVE_PROMPT_PATH = BACKEND.parent / "app" / "lib" / "main" / "live-prompt.js"
APP_LIVE_PROMPT_TEST_PATH = (
    BACKEND.parent / "app" / "lib" / "main" / "live-prompt.test.js"
)
PRODUCTION_IDENTITY_PATH = BACKEND / "athena_api" / "selector" / "instrument_identity.py"
APP_PIPELINE_MODE = "production_instrument_identity_fixture_semantic"
RAW_BACKEND_MODE = "raw_backend"
EVALUATION_MODES = (APP_PIPELINE_MODE, RAW_BACKEND_MODE)

VARIANTS = (
    "baseline",
    "without_field_descriptions",
    "without_family_projection",
    "without_family_capability",
    "with_legacy_multiword_alias_flattening",
    "without_synonym_bigrams",
    "without_raw_bigrams",
    "without_query_coverage",
    "without_title_tiebreak",
    "without_corroboration_cap",
)

_MINIMUM_SCORE = 240
_CLOSE_MARGIN_ABSOLUTE = 80
_CLOSE_MARGIN_RATIO = 1.15
_DESCRIPTIVE_UPPER_BAND_SCORE = 1_000
_GOLD_HINT_KEYS = frozenset({"preferred_ref", "candidate_refs", "detail_group"})
_QUOTE_GRAMMAR_EDGE = r"[\s?!.,~\"'():;·-]*"
_KOREAN_QUOTE_CORE = (
    r"(?:현재\s*(?:가|시세)|오늘\s*주가|주가)"
    r"(?:\s*(?:얼마(?:야|예요|에요|인가요?)?|조회))?"
)
_KOREAN_QUOTE_COURTESY = (
    r"(?:\s*(?:를|은|는))?(?:\s*(?:좀|한번))?"
    r"(?:\s*(?:(?:알려|보여)\s*(?:줘|주세요)|"
    r"(?:조회|확인)\s*(?:해)?\s*(?:줘|주세요)|해\s*(?:줘|주세요)))?"
)
_ENGLISH_QUOTE_CORE = r"(?:current\s+(?:stock\s+)?price|stock\s+price\s+today)"


def _flexible_exact_alias_pattern(alias: str) -> str:
    return r"[\s._-]*".join(re.escape(character) for character in alias)


def _matches_app_direct_quote_intent(
    question: str,
    *,
    index: InstrumentIdentityIndex | None = None,
    resolved: Any | None = None,
) -> bool:
    index = index or _TRUSTED_STOCK_MASTER_RESOLVER
    resolved = resolved or index.resolve(question)
    if resolved is None:
        return False
    text = unicodedata.normalize("NFKC", str(question)).casefold().strip()
    aliases = (
        alias
        for alias, codes in index.snapshot.alias_codes.items()
        if resolved.code in codes
    )
    for alias in aliases:
        alias_pattern = _flexible_exact_alias_pattern(alias)
        korean_entity = rf"{alias_pattern}(?:의|은|는|이|가|을|를)?"
        english_entity = rf"{alias_pattern}(?:\s*'s)?"
        patterns = (
            rf"{_QUOTE_GRAMMAR_EDGE}{korean_entity}\s*{_KOREAN_QUOTE_CORE}"
            rf"{_KOREAN_QUOTE_COURTESY}{_QUOTE_GRAMMAR_EDGE}",
            rf"{_QUOTE_GRAMMAR_EDGE}(?:please\s+)?"
            rf"(?:show\s+me\s+|tell\s+me\s+)?{english_entity}\s+"
            rf"{_ENGLISH_QUOTE_CORE}(?:\s+please)?{_QUOTE_GRAMMAR_EDGE}",
            rf"{_QUOTE_GRAMMAR_EDGE}(?:please\s+)?{_ENGLISH_QUOTE_CORE}\s+"
            rf"(?:for|of)\s+{english_entity}(?:\s+please)?{_QUOTE_GRAMMAR_EDGE}",
        )
        if any(re.fullmatch(pattern, text, re.IGNORECASE) for pattern in patterns):
            return True
    return False


def _node_quote_control_plane_evidence(
    cases: tuple[dict[str, Any], ...],
) -> dict[str, dict[str, str]]:
    fixture = json.loads(TRUSTED_STOCK_MASTER_PATH.read_text(encoding="utf-8"))
    payload = {
        "records": [
            {
                "code": entity["code"],
                "name": entity["name"],
                "market": entity["market"],
            }
            for entity in fixture["entities"]
        ],
        "cases": [
            {"id": str(case["id"]), "question": str(case["question"])}
            for case in cases
            if case.get("identity_support") != "unsupported_by_frozen_provider"
        ],
    }
    module_path = json.dumps(str(APP_STOCK_ENTITY_INDEX_PATH.resolve()))
    script = f"""
const crypto = require('node:crypto');
const fs = require('node:fs');
const {{ StockEntityIndex, buildQuoteDataset }} = require({module_path});
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const index = new StockEntityIndex();
index.replace(payload.records);
const evidence = {{}};
for (const item of payload.cases) {{
  const dataset = buildQuoteDataset(item.question, index, {{ idFactory: () => 'eval' }});
  if (!dataset) continue;
  const primary = dataset.items[0];
  evidence[item.id] = {{
    operation_ref: primary.operationRef,
    bound_code_sha256: crypto.createHash('sha256').update(primary.args.stk_cd).digest('hex'),
  }};
}}
process.stdout.write(JSON.stringify(evidence));
"""
    completed = subprocess.run(
        ["node", "-e", script],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        check=True,
        text=True,
        encoding="utf-8",
        cwd=BACKEND.parent,
    )
    evidence = json.loads(completed.stdout)
    for case in cases:
        if case.get("identity_support") == "unsupported_by_frozen_provider":
            continue
        resolved = _TRUSTED_STOCK_MASTER_RESOLVER.resolve(case["question"])
        python_match = _matches_app_direct_quote_intent(
            case["question"], resolved=resolved
        )
        if python_match != (str(case["id"]) in evidence):
            raise ValueError(
                "Python/App standalone quote grammar parity mismatch: "
                f"{case['id']}"
            )
    return evidence

SEALED_V2_ACCEPTANCE = {
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
SEALED_V3_ACCEPTANCE = {
    **SEALED_V2_ACCEPTANCE,
    "minimum_case_count": 100,
}
SEALED_V4_ACCEPTANCE = dict(SEALED_V3_ACCEPTANCE)
SEALED_V5_ACCEPTANCE = {
    **SEALED_V4_ACCEPTANCE,
    "required_case_count": 100,
    "minimum_raw_question_only_cases": 40,
    "minimum_identity_assisted_quote_control_plane_cases": 10,
    "minimum_resolver_assisted_semantic_shadow_cases": 1,
    "identity_assisted_quote_control_plane_accuracy": 1.0,
    "identity_assisted_quote_exact_binding": True,
    "unsupported_identity_surface_advisory_maximum": 0,
}
EXPOSED_PROVENANCE_PREFIX = "exposed-after-sealed-"

_FREEZE_SOURCE_PATHS = (
    Path(__file__).resolve(),
    BACKEND / "athena_api" / "routing_contract.py",
    BACKEND / "athena_api" / "generated" / "models.py",
    BACKEND / "athena_api" / "generated" / "registry.py",
    BACKEND / "scripts" / "generate_api.py",
    BACKEND / "ref" / "kiwoom-tr-inventory.json",
    BACKEND / "ref" / "response-projections.json",
    BACKEND / "ref" / "ka10007-detail-groups.json",
    BACKEND / "ref" / "kiwoom-io-source-profile.json",
    BACKEND / "ref" / "selector-routing.json",
    BACKEND / "ref" / "selector-entity-markers.json",
    TRUSTED_STOCK_MASTER_PATH,
    STOCK_ENTITY_CONFORMANCE_PATH,
    APP_STOCK_ENTITY_INDEX_PATH,
    APP_STOCK_ENTITY_INDEX_TEST_PATH,
    APP_MAIN_PATH,
    APP_LIVE_PROMPT_PATH,
    APP_LIVE_PROMPT_TEST_PATH,
    BACKEND / "athena_api" / "dependencies.py",
    BACKEND / "athena_api" / "lifespan.py",
    BACKEND / "athena_api" / "main.py",
    BACKEND / "athena_api" / "api" / "llm_tools.py",
)
_OVERLAP_REFERENCE_CORPORA = (
    DEFAULT_CORPUS,
    AUTONOMOUS_EXPANSION_CORPUS,
    EXPOSED_V2_CORPUS,
    EXPOSED_V3_CORPUS,
    EXPOSED_V4_CORPUS,
)


def _validate_identity_support_metadata(case: dict[str, Any]) -> None:
    support = case.get("identity_support")
    if support is None:
        if "counterfactual_entity_kind" in case:
            raise ValueError(
                "counterfactual entity kind requires unsupported identity metadata"
            )
        if "evaluation_scope" in case and case.get("evaluation_scope") == (
            "semantic_operation_advisory"
        ):
            raise ValueError("identity advisory scope requires explicit support metadata")
        return
    if support != "unsupported_by_frozen_provider":
        raise ValueError("unknown identity support metadata")
    identity_metadata_keys = {key for key in case if key.startswith("identity_")}
    if identity_metadata_keys != {"identity_support"}:
        raise ValueError("unsupported identity advisory contains unknown identity metadata")
    if case.get("evaluation_scope") != "semantic_operation_advisory":
        raise ValueError("unsupported identity case requires exact advisory scope")
    if case.get("expected_disposition") not in {"select", "guarded"}:
        raise ValueError("unsupported identity advisory requires select or guarded gold")
    if case.get("provenance") != "post-exposure-production-scope-audit-2026-08-21":
        raise ValueError("unsupported identity advisory requires post-exposure provenance")
    if case.get("counterfactual_entity_kind") not in {
        EntityKind.STOCK.value,
        EntityKind.ETF.value,
        EntityKind.ELW.value,
        EntityKind.GOLD.value,
    }:
        raise ValueError(
            "unsupported identity advisory requires reviewed counterfactual entity kind"
        )
    if _TRUSTED_STOCK_MASTER_RESOLVER.resolve(str(case.get("question", ""))) is not None:
        raise ValueError("unsupported identity metadata conflicts with frozen provider")


def load_cases(path: Path = DEFAULT_CORPUS) -> tuple[dict[str, Any], ...]:
    cases = tuple(
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )
    for case in cases:
        _validate_identity_support_metadata(case)
    return cases


def build_evaluator_identity_index(
    path: Path = TRUSTED_STOCK_MASTER_PATH,
    *,
    records: list[dict[str, Any]] | None = None,
    record_markets: dict[str, str] | None = None,
    market_kinds: dict[str, str] | None = None,
) -> InstrumentIdentityIndex:
    """Adapt value-only fixtures into the production identity index."""
    if records is None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if set(payload) != {"schema_version", "source", "market_kinds", "entities"}:
            raise ValueError("trusted stock master has unexpected top-level fields")
        records = payload["entities"]
        market_kinds = payload["market_kinds"]
    expected_kinds = {
        market: kind.value for market, kind in IDENTITY_MARKET_KINDS.items()
    }
    if market_kinds != expected_kinds:
        raise ValueError("trusted stock master market kinds differ from production")
    grouped: dict[str, list[dict[str, str]]] = {
        market: [] for market in IDENTITY_MARKETS
    }
    for record in records:
        code = str(record.get("code", ""))
        if set(record) == {"code", "name"}:
            market = str((record_markets or {}).get(code, ""))
        elif set(record) == {"code", "name", "market", "kind"}:
            market = str(record["market"])
            if record["kind"] != expected_kinds.get(market):
                raise ValueError("trusted stock master kind disagrees with market")
        else:
            raise ValueError("trusted stock master entities require identity and market kind")
        if market not in grouped:
            raise ValueError("trusted stock master contains an unknown market")
        grouped[market].append(
            {
                "code": code,
                "name": str(record.get("name", "")),
                "marketCode": market,
            }
        )
    index = InstrumentIdentityIndex()
    index.replace(grouped)
    return index


_TRUSTED_STOCK_MASTER_RESOLVER = build_evaluator_identity_index()


def _target_resolver_metadata(evaluation_mode: str) -> dict[str, Any] | None:
    if evaluation_mode == RAW_BACKEND_MODE:
        return None
    return {
        "kind": "production-instrument-identity-index",
        "adapter_version": "production-index-fixture-adapter-v1",
        "scope": "production_algorithm_with_reviewed_fixture_snapshot",
        "implementation": "backend/athena_api/selector/instrument_identity.py",
        "implementation_sha256": _sha256(PRODUCTION_IDENTITY_PATH),
        "market_kinds": {"0": "stock", "10": "stock", "8": "etf"},
        "fixture": TRUSTED_STOCK_MASTER_PATH.name,
        "fixture_sha256": _sha256(TRUSTED_STOCK_MASTER_PATH),
        "value_retention": "none",
        "quote_control_plane_evidence": {
            "scope": "direct_quote_dataset_only",
            "implementation": "app/lib/main/rest-dataset-runner.js",
            "implementation_sha256": _sha256(APP_STOCK_ENTITY_INDEX_PATH),
            "test": "app/lib/main/rest-dataset-runner.test.js",
            "test_sha256": _sha256(APP_STOCK_ENTITY_INDEX_TEST_PATH),
        },
    }


def _normalized_question(case: dict[str, Any]) -> str:
    return " ".join(str(case["question"]).casefold().split())


def _question_copy_key(question: str) -> str:
    return "".join(character for character in question.casefold() if character.isalnum())


def _questions_are_near_copies(left: str, right: str) -> bool:
    left_key = _question_copy_key(left)
    right_key = _question_copy_key(right)
    shorter, longer = sorted((left_key, right_key), key=len)
    if len(shorter) < 12:
        return shorter == longer
    if shorter in longer:
        return True
    return difflib.SequenceMatcher(None, left_key, right_key, autojunk=False).ratio() >= 0.9


def _validate_sealed_v5_overlap(cases: tuple[dict[str, Any], ...]) -> dict[str, Any]:
    case_ids = [str(case["id"]) for case in cases]
    questions = [_normalized_question(case) for case in cases]
    if len(set(case_ids)) != len(case_ids):
        raise ValueError("sealed v5 corpus contains duplicate ids")
    if len(set(questions)) != len(questions):
        raise ValueError("sealed v5 corpus contains duplicate questions")
    for index, question in enumerate(questions):
        if any(_questions_are_near_copies(question, other) for other in questions[index + 1 :]):
            raise ValueError("sealed v5 corpus contains suffix-copy or near-copy questions")

    reference_ids: set[str] = set()
    reference_questions: set[str] = set()
    references: dict[str, dict[str, Any]] = {}
    for path in _OVERLAP_REFERENCE_CORPORA:
        reference_cases = load_cases(path)
        reference_ids.update(str(case["id"]) for case in reference_cases)
        reference_questions.update(_normalized_question(case) for case in reference_cases)
        references[path.name] = {
            "case_count": len(reference_cases),
            "sha256": _sha256(path),
        }
    overlapping_ids = sorted(set(case_ids).intersection(reference_ids))
    overlapping_questions = sorted(set(questions).intersection(reference_questions))
    near_copy_questions = sorted(
        question
        for question in questions
        if any(
            _questions_are_near_copies(question, reference)
            for reference in reference_questions
        )
    )
    if overlapping_ids or overlapping_questions or near_copy_questions:
        raise ValueError(
            "sealed v5 corpus overlaps regression corpora: "
            f"ids={len(overlapping_ids)}, questions={len(overlapping_questions)}, "
            f"near_copies={len(near_copy_questions)}"
        )
    return references


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _freeze_source_paths() -> tuple[Path, ...]:
    paths = {
        *tuple((BACKEND / "athena_api" / "selector").glob("*.py")),
        *_FREEZE_SOURCE_PATHS,
        *_OVERLAP_REFERENCE_CORPORA,
    }
    return tuple(
        sorted(
            paths,
            key=lambda path: str(path.relative_to(BACKEND.parent)).replace("\\", "/"),
        )
    )


def _git_blob_sha1(content: bytes) -> str:
    header = f"blob {len(content)}\0".encode("ascii")
    return hashlib.sha1(header + content, usedforsecurity=False).hexdigest()


def canonical_git_blob_freeze_manifest() -> dict[str, Any]:
    entries = {
        str(path.relative_to(BACKEND.parent)).replace("\\", "/"): _git_blob_sha1(
            path.read_bytes()
        )
        for path in _freeze_source_paths()
    }
    encoded = (
        "".join(f"{path}\0{blob_sha1}\n" for path, blob_sha1 in entries.items())
    ).encode("utf-8")
    return {
        "algorithm": "git-blob-sha1-sorted-path-nul-oid-lines-v1",
        "entries": entries,
        "manifest_sha1": _git_blob_sha1(encoded),
    }


def _verified_git_blob_freeze_manifest(expected_sha1: str) -> dict[str, Any]:
    actual = canonical_git_blob_freeze_manifest()
    if not hmac.compare_digest(expected_sha1.lower(), actual["manifest_sha1"]):
        raise ValueError(
            "production freeze hash mismatch: "
            f"expected {expected_sha1.lower()}, actual {actual['manifest_sha1']}"
        )
    return actual


def assert_freeze_snapshot_unchanged(frozen: dict[str, Any]) -> None:
    current = canonical_git_blob_freeze_manifest()
    if current != frozen:
        raise RuntimeError("selector sources changed after freeze manifest creation")


def _write_exclusive(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="") as handle:
        handle.write(content)


def _sealed_stratum_counts(cases: tuple[dict[str, Any], ...]) -> dict[str, int]:
    counts = Counter()
    node_quote_evidence = _node_quote_control_plane_evidence(cases)
    for case in cases:
        _validate_identity_support_metadata(case)
        if case.get("identity_support") == "unsupported_by_frozen_provider":
            if case.get("evaluation_scope") != "semantic_operation_advisory":
                raise ValueError("unsupported identity case requires advisory scope")
            counts["unsupported_identity_surface_advisory"] += 1
            continue
        question = case["question"]
        static_raw_target = bool(
            re.search(r"(?<!\d)\d{6}(?!\d)", question)
            or re.search(
                r"(?i)(?:\bthis\s+(?:stock|security)\b|이\s*종목|해당\s*종목)",
                question,
            )
        )
        resolution = _TRUSTED_STOCK_MASTER_RESOLVER.resolve(question)
        if (
            resolution is not None
            and not static_raw_target
            and str(case["id"]) in node_quote_evidence
        ):
            counts["identity_assisted_quote_control_plane"] += 1
            continue
        if resolution is not None and not static_raw_target:
            counts["resolver_assisted_semantic_shadow"] += 1
            continue
        counts["raw_question_only"] += 1
    return {
        stratum: counts[stratum]
        for stratum in (
            "raw_question_only",
            "identity_assisted_quote_control_plane",
            "resolver_assisted_semantic_shadow",
            "unsupported_identity_surface_advisory",
        )
    }


def _sealed_coverage(cases: tuple[dict[str, Any], ...]) -> dict[str, Any]:
    tags = {
        str(tag).lower()
        for case in cases
        for tag in case.get("critical_tags", ())
    }
    tags.update(str(case.get("category", "")).lower() for case in cases)
    tags.update(
        token
        for value in tuple(tags)
        for token in re.split(r"[^a-z0-9]+", value)
        if token
    )
    if any(tag.startswith("missing_") for tag in tags):
        tags.add("ambiguity")
    pair_counts = Counter(case.get("pair_id") for case in cases if case.get("pair_id"))
    metamorphic_counts = Counter(
        case.get("metamorphic_group")
        for case in cases
        if case.get("metamorphic_group")
    )
    return {
        "case_count": len(cases),
        "critical_cases": sum(bool(case.get("critical_tags")) for case in cases),
        "rejected_forbidden_cases": sum(
            case["expected_disposition"] in {"reject", "forbidden"} for case in cases
        ),
        "answerable_cases": sum(
            case["expected_disposition"] in {"select", "guarded"} for case in cases
        ),
        "languages": sorted({str(case["language"]).lower() for case in cases}),
        "coverage_tags": sorted(tags),
        "pair_groups": sum(count >= 2 for count in pair_counts.values()),
        "metamorphic_groups": sum(
            count >= 2 for count in metamorphic_counts.values()
        ),
        "stratum_counts": _sealed_stratum_counts(cases),
    }


def _validate_sealed_coverage(
    coverage: dict[str, Any], acceptance: dict[str, Any]
) -> None:
    checks = {
        "minimum_case_count": coverage["case_count"]
        >= acceptance["minimum_case_count"],
        "minimum_critical_cases": coverage["critical_cases"]
        >= acceptance["minimum_critical_cases"],
        "minimum_rejected_forbidden_cases": coverage["rejected_forbidden_cases"]
        >= acceptance["minimum_rejected_forbidden_cases"],
        "minimum_answerable_cases": coverage["answerable_cases"]
        >= acceptance["minimum_answerable_cases"],
        "required_languages": set(acceptance["required_languages"]).issubset(
            coverage["languages"]
        ),
        "minimum_pair_groups": coverage["pair_groups"]
        >= acceptance["minimum_pair_groups"],
        "minimum_metamorphic_groups": coverage["metamorphic_groups"]
        >= acceptance["minimum_metamorphic_groups"],
    }
    if "required_case_count" in acceptance:
        checks["required_case_count"] = (
            coverage["case_count"] == acceptance["required_case_count"]
        )
    stratum_minimums = {
        "minimum_raw_question_only_cases": "raw_question_only",
        "minimum_identity_assisted_quote_control_plane_cases": (
            "identity_assisted_quote_control_plane"
        ),
        "minimum_resolver_assisted_semantic_shadow_cases": (
            "resolver_assisted_semantic_shadow"
        ),
    }
    for key, stratum in stratum_minimums.items():
        if key in acceptance:
            checks[key] = coverage["stratum_counts"][stratum] >= acceptance[key]
    if "unsupported_identity_surface_advisory_maximum" in acceptance:
        checks["unsupported_identity_surface_advisory_maximum"] = (
            coverage["stratum_counts"]["unsupported_identity_surface_advisory"]
            <= acceptance["unsupported_identity_surface_advisory_maximum"]
        )
    for key in ("required_execution_tags", "required_domain_tags", "required_safety_tags"):
        checks[key] = set(acceptance[key]).issubset(coverage["coverage_tags"])
    failed = sorted(key for key, passed in checks.items() if not passed)
    if failed:
        raise ValueError(f"sealed holdout coverage contract failed: {failed}")


def sealed_freeze_manifest(
    *,
    corpus_path: Path,
    cases: tuple[dict[str, Any], ...],
    command: str,
    sealed_generation: str = "v2",
    production_freeze_hash: str | None = None,
    evaluation_mode: str = APP_PIPELINE_MODE,
) -> dict[str, Any]:
    acceptances = {
        "v2": SEALED_V2_ACCEPTANCE,
        "v3": SEALED_V3_ACCEPTANCE,
        "v4": SEALED_V4_ACCEPTANCE,
        "v5": SEALED_V5_ACCEPTANCE,
    }
    if sealed_generation not in acceptances:
        raise ValueError(f"unsupported sealed generation: {sealed_generation}")
    if sealed_generation != "v2" and not production_freeze_hash:
        raise ValueError(f"sealed {sealed_generation} requires production freeze hash")
    acceptance = acceptances[sealed_generation]
    production_freeze = (
        _verified_git_blob_freeze_manifest(production_freeze_hash)
        if production_freeze_hash is not None
        else None
    )
    coverage = _sealed_coverage(cases)
    _validate_sealed_coverage(coverage, acceptance)
    overlap_references = (
        _validate_sealed_v5_overlap(cases) if sealed_generation == "v5" else None
    )
    catalog = build_operation_catalog()
    source_hashes = {
        str(path.relative_to(BACKEND.parent)).replace("\\", "/"): _sha256(path)
        for path in _freeze_source_paths()
    }
    state = "\n".join(f"{path}:{digest}" for path, digest in source_hashes.items())
    return {
        "schema_version": 1,
        "partition": "sealed_holdout",
        "sealed_generation": sealed_generation,
        "production_freeze_git_blob_manifest_sha1": production_freeze_hash,
        "production_freeze_git_blob_manifest": production_freeze,
        "production_freeze_verified": production_freeze is not None,
        "overlap_reference_corpora": overlap_references,
        "command": command,
        "corpus_label": corpus_path.name,
        "case_count": len(cases),
        "corpus_sha256": _sha256(corpus_path),
        "source_state_sha256": hashlib.sha256(state.encode("utf-8")).hexdigest(),
        "source_hashes": source_hashes,
        "catalog_version": catalog.version,
        "routing_contract_version": ROUTING_CONTRACT_VERSION,
        "routing_source_version": ROUTING_SOURCE_VERSION,
        "query_frame_version": QUERY_FRAME_VERSION,
        "lexicon_version": lexicon.LEXICON_VERSION,
        "entity_marker_version": ENTITY_MARKER_VERSION,
        "evaluation_mode": evaluation_mode,
        "target_resolver": _target_resolver_metadata(evaluation_mode),
        "predeclared_gates": acceptance,
        "coverage": coverage,
        "gold_hint_inputs_present": False,
        "run_status": "manifest_created_evaluation_not_started",
        "failure_policy": {
            "on_any_evaluation_failure": "reclassify_corpus_as_autonomous_expansion",
            "next_sealed_generation": (
                f"v{int(sealed_generation[1:]) + 1}_required"
            ),
            "artifacts_are_immutable": True,
        },
    }


def _catalog_without_zones(
    catalog: OperationCatalog, removed_zones: frozenset[str]
) -> OperationCatalog:
    documents = tuple(
        replace(
            document,
            searchable_zones=MappingProxyType(
                {
                    zone: values
                    for zone, values in document.searchable_zones.items()
                    if zone not in removed_zones
                }
            ),
        )
        for document in catalog.documents
    )
    return replace(
        catalog,
        documents=documents,
        by_ref=MappingProxyType({document.operation_ref: document for document in documents}),
    )


def _synonyms_without_generated_bigrams(tokens: tuple[str, ...]) -> tuple[str, ...]:
    """Expand concepts, but emit only reviewed whole terms, not their 2-char slices."""
    original = set(tokens)
    expanded = set(original)
    for concept in lexicon._CONCEPTS:  # noqa: SLF001 - intentional ablation seam
        trigger_tokens = {
            token for term in concept for token in lexicon.tokenize(term)
        }
        if original.intersection(trigger_tokens):
            expanded.update(
                token
                for term in concept
                for token in lexicon.tokenize(term, korean_bigrams=False)
            )
    return tuple(sorted(expanded.difference(original)))


def _legacy_flattened_multiword_synonyms(tokens: tuple[str, ...]) -> tuple[str, ...]:
    """Simulate the old any-token activation that contaminated ETF/ELW aliases."""
    original = set(tokens)
    expanded = set(original)
    for concept in lexicon._CONCEPTS:  # noqa: SLF001 - intentional ablation seam
        aliases = tuple(
            lexicon.tokenize(term, korean_bigrams=False) for term in concept
        )
        if any(original.intersection(alias) for alias in aliases):
            expanded.update(token for alias in aliases for token in alias)
    return tuple(sorted(expanded.difference(original)))


@contextmanager
def _variant_runtime(variant: str) -> Iterator[OperationCatalog]:
    if variant not in VARIANTS:
        raise ValueError(f"unknown variant: {variant}")

    catalog = build_operation_catalog()
    if variant == "without_field_descriptions":
        catalog = _catalog_without_zones(
            catalog, frozenset({"request_description", "response_description"})
        )
    elif variant == "without_family_projection":
        catalog = _catalog_without_zones(catalog, frozenset({"family_projection"}))
    elif variant == "without_family_capability":
        catalog = _catalog_without_zones(catalog, frozenset({"family_capability"}))

    original_tokenize = ranking.tokenize
    original_synonyms = ranking.synonym_only_tokens
    original_coverage = ranking._COVERAGE_POINTS  # noqa: SLF001
    original_cap = ranking._CORROBORATION_CAP  # noqa: SLF001
    original_title_score = ranking.RankedDocument.title_score
    try:
        if variant == "without_raw_bigrams":
            ranking.tokenize = lambda value, korean_bigrams=True: original_tokenize(  # type: ignore[assignment]
                value, korean_bigrams=False
            )
        elif variant == "without_synonym_bigrams":
            ranking.synonym_only_tokens = _synonyms_without_generated_bigrams
        elif variant == "with_legacy_multiword_alias_flattening":
            ranking.synonym_only_tokens = _legacy_flattened_multiword_synonyms
        elif variant == "without_query_coverage":
            ranking._COVERAGE_POINTS = 0  # noqa: SLF001
        elif variant == "without_title_tiebreak":
            ranking.RankedDocument.title_score = property(lambda self: 0)  # type: ignore[assignment]
        elif variant == "without_corroboration_cap":
            ranking._CORROBORATION_CAP = 10**9  # noqa: SLF001
        yield catalog
    finally:
        ranking.tokenize = original_tokenize
        ranking.synonym_only_tokens = original_synonyms
        ranking._COVERAGE_POINTS = original_coverage  # noqa: SLF001
        ranking._CORROBORATION_CAP = original_cap  # noqa: SLF001
        ranking.RankedDocument.title_score = original_title_score  # type: ignore[assignment]


def _family(operation_ref: str) -> str:
    return f"base:{operation_ref.split(':')[1]}"


def _retrieval_score_band(score: int | None) -> str:
    if score is None:
        return "no_result"
    if score >= _DESCRIPTIVE_UPPER_BAND_SCORE:
        return "at_least_1000"
    if score >= _MINIMUM_SCORE:
        return "240_to_999"
    return "below_240"


def _ratio(first: int | None, second: int | None) -> float | None:
    if first is None or second is None or second <= 0:
        return None
    return round(first / second, 6)


def _distribution(values: list[int | float]) -> dict[str, int | float | None]:
    """Small deterministic nearest-index summary; no fitted threshold is inferred."""
    if not values:
        return {"count": 0, "min": None, "p25": None, "p50": None, "p75": None, "max": None}
    ordered = sorted(values)

    def percentile(fraction: float) -> int | float:
        return ordered[round((len(ordered) - 1) * fraction)]

    return {
        "count": len(ordered),
        "min": ordered[0],
        "p25": percentile(0.25),
        "p50": percentile(0.50),
        "p75": percentile(0.75),
        "max": ordered[-1],
    }


def _critical_group_success(group: str, outcome: dict[str, Any]) -> bool:
    """Apply each gate's own contract instead of conflating family and detail metrics."""
    if group == "stock_sector_scope":
        return not outcome["severe_scope_error"]
    if group in {"ambiguity_ood_no_plan", "surface_crossing_no_plan"}:
        return outcome["selected_operation_ref"] is None
    return (
        outcome["correct"]
        and not outcome["severe_scope_error"]
        and not outcome["surface_crossing"]
    )


def _expected_contract(case: dict[str, Any]) -> tuple[set[str], set[str]]:
    family_refs = set(case.get("expected_family_refs", case["expected_refs"]))
    if "expected_operation_refs" in case:
        operation_refs = set(case["expected_operation_refs"])
    elif "expected_family_refs" in case:
        operation_refs = set(case["expected_refs"])
    else:
        operation_refs = set()
    return family_refs, operation_refs


def _disposition_correct(
    case: dict[str, Any],
    *,
    selected_family: str | None,
    selected_operation: str | None,
    selected_kind: str | None,
) -> bool:
    disposition = case["expected_disposition"]
    expected_families, expected_operations = _expected_contract(case)
    if disposition in {"reject", "forbidden"}:
        return selected_family is None
    if disposition in {"select", "guarded"}:
        selected_expected = selected_family in expected_families and (
            not expected_operations or selected_operation in expected_operations
        )
        return selected_expected and (
            disposition != "guarded" or selected_kind in {"order", "websocket"}
        )
    raise ValueError(f"unknown expected disposition: {disposition}")


def _routing_scope_compatible(
    expected: OperationDocument, selected: OperationDocument
) -> bool:
    """Keep same-scope detail errors non-severe while catching axis crossings."""
    if expected.family_ref == selected.family_ref:
        return True
    if expected.kind != selected.kind:
        return False
    left = expected.routing
    right = selected.routing
    if left.execution != right.execution:
        return False
    if left.subject != right.subject:
        return False
    if left.entity_kinds and right.entity_kinds and not set(left.entity_kinds).intersection(
        right.entity_kinds
    ):
        return False
    left_intents = set(left.data_intents).intersection(_EXCLUSIVE_DATA_INTENTS)
    right_intents = set(right.data_intents).intersection(_EXCLUSIVE_DATA_INTENTS)
    if left_intents and right_intents and left_intents.isdisjoint(right_intents):
        return False
    if (
        left.result_shapes
        and right.result_shapes
        and set(left.result_shapes).isdisjoint(right.result_shapes)
    ):
        return False
    return True


def _routing_scope_error(
    catalog: OperationCatalog,
    expected_families: set[str],
    selected_family: str | None,
) -> bool:
    if selected_family is None or not expected_families:
        return False
    selected = catalog.find_exact(selected_family)
    expected = [catalog.find_exact(ref) for ref in expected_families]
    expected_documents = [document for document in expected if document is not None]
    if selected is None or not expected_documents:
        return False
    return not any(
        _routing_scope_compatible(document, selected)
        for document in expected_documents
    )


def _compatibility_decision(
    catalog: OperationCatalog,
    question: str,
    intent: DiscoveryIntent,
    *,
    evaluation_mode: str = APP_PIPELINE_MODE,
    target_resolver: Any | None = None,
) -> CompatibilityDecision:
    if evaluation_mode not in EVALUATION_MODES:
        raise ValueError(f"unsupported evaluation mode: {evaluation_mode}")
    return decide_selector_compatibility(
        catalog,
        question,
        intent,
        bound_argument_roles=(),
        target_resolver=(
            target_resolver or _TRUSTED_STOCK_MASTER_RESOLVER.resolve_target
            if evaluation_mode == APP_PIPELINE_MODE
            else None
        ),
    )


def _compatibility_trace(decision: CompatibilityDecision) -> dict[str, Any]:
    return {
        "status": decision.status.value,
        "confidence": decision.confidence.value,
        "reason_codes": list(decision.reason_codes),
        "compatible_operation_refs": list(decision.compatible_operation_refs),
        "proofs": [
            {
                "operation_ref": proof.operation_ref,
                "status": proof.status.value,
                "matched": list(proof.matched),
                "contradictions": list(proof.contradictions),
                "missing": list(proof.missing),
            }
            for proof in decision.proofs
        ],
        "dominance_edges": [
            {
                "dominating_operation_ref": edge.dominating_operation_ref,
                "dominated_operation_ref": edge.dominated_operation_ref,
            }
            for edge in decision.dominance_edges
        ],
        "equivalence_collapses": [
            {
                "group_id": collapse.group_id,
                "canonical_operation_ref": collapse.canonical_operation_ref,
                "member_operation_refs": list(collapse.member_operation_refs),
            }
            for collapse in decision.equivalence_collapses
        ],
    }


def _typed_advisory_counterfactual(entity_kind: str) -> TargetResolution:
    return TargetResolution(EntityKind(entity_kind))


def _validate_unsupported_advisory_semantics(
    cases: tuple[dict[str, Any], ...],
) -> None:
    advisory_cases = tuple(
        case
        for case in cases
        if case.get("identity_support") == "unsupported_by_frozen_provider"
    )
    if not advisory_cases:
        return
    with _variant_runtime("baseline") as catalog:
        for case in advisory_cases:
            _validate_identity_support_metadata(case)
            decision = _compatibility_decision(
                catalog,
                case["question"],
                DiscoveryIntent(case["intent"]),
                evaluation_mode=RAW_BACKEND_MODE,
            )
            if decision.selected_operation_ref is not None:
                raise ValueError(
                    "unsupported identity advisory raw selector already selects: "
                    f"{case['id']}"
                )
            counterfactual_resolution = _typed_advisory_counterfactual(
                str(case["counterfactual_entity_kind"])
            )
            counterfactual = _compatibility_decision(
                catalog,
                case["question"],
                DiscoveryIntent(case["intent"]),
                evaluation_mode=APP_PIPELINE_MODE,
                target_resolver=lambda _question, resolution=counterfactual_resolution: (
                    resolution
                ),
            )
            expected_operation_refs = set(case.get("expected_operation_refs", ()))
            expected_refs = set(case.get("expected_refs", ()))
            selected_expected = bool(
                counterfactual.selected_operation_ref
                and (
                    counterfactual.selected_operation_ref
                    in expected_operation_refs.union(expected_refs)
                    or counterfactual.selected_family_ref in expected_refs
                )
            )
            if not selected_expected:
                raise ValueError(
                    "unsupported identity advisory requires typed counterfactual "
                    "expected selection: "
                    f"{case['id']}"
                )


def _redacted_code_fingerprint(code: str) -> str:
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def _quote_control_plane_binding(
    document: OperationDocument | None,
    resolution: Any | None,
    *,
    bound_code: str | None = None,
) -> dict[str, Any]:
    resolved_code = resolution.code if resolution else None
    concrete_bound_code = resolved_code if bound_code is None else bound_code
    model_valid = False
    validated_code: str | None = None
    if document is not None and concrete_bound_code is not None:
        try:
            validated = document.request_model.model_validate(
                {"stk_cd": concrete_bound_code}
            )
            dumped = validated.model_dump(by_alias=True)
            validated_code = str(dumped.get("stk_cd", ""))
            model_valid = bool(re.fullmatch(r"\d{6}", validated_code))
        except (TypeError, ValueError):
            model_valid = False
    resolved_fingerprint = (
        _redacted_code_fingerprint(resolved_code) if resolved_code else None
    )
    bound_fingerprint = (
        _redacted_code_fingerprint(validated_code)
        if model_valid and validated_code is not None
        else None
    )
    return {
        "argument_role": "stk_cd" if resolution else None,
        "generated_request_model": (
            document.request_model.__name__ if document is not None else None
        ),
        "bound_arguments_model_valid": model_valid,
        "resolved_code_sha256": resolved_fingerprint,
        "bound_code_sha256": bound_fingerprint,
        "exact_binding_verified": bool(
            model_valid
            and resolved_fingerprint is not None
            and hmac.compare_digest(resolved_fingerprint, bound_fingerprint or "")
        ),
    }


def _unsupported_identity_advisory_decision() -> CompatibilityDecision:
    return CompatibilityDecision(
        status=CompatibilityDecisionStatus.REJECTED,
        selected_family_ref=None,
        selected_operation_ref=None,
        compatible_operation_refs=(),
        proofs=(),
        dominance_edges=(),
        equivalence_collapses=(),
        confidence=CompatibilityConfidence.LOW,
        reason_codes=("UNSUPPORTED_IDENTITY_PROVIDER",),
    )


def evaluate_variant(
    cases: tuple[dict[str, Any], ...],
    variant: str,
    *,
    evaluation_mode: str = APP_PIPELINE_MODE,
    decision_cache: dict[tuple[str, str, str], tuple[Any, ...]] | None = None,
    quote_control_evidence: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    outcomes: list[dict[str, Any]] = []
    if evaluation_mode == APP_PIPELINE_MODE and quote_control_evidence is None:
        quote_control_evidence = _node_quote_control_plane_evidence(cases)
    quote_control_evidence = quote_control_evidence or {}
    with _variant_runtime(variant) as catalog:
        for case in cases:
            intent = DiscoveryIntent(case["intent"])
            surface = catalog.visible_for(intent)
            ranked = ranking.rank_documents(case["question"], surface)
            top_item = ranked[0] if ranked else None
            runner_up = ranked[1] if len(ranked) > 1 else None
            top1 = top_item.document.family_ref if top_item else None
            cache_key = (case["question"], intent.value, evaluation_mode)
            cached = decision_cache.get(cache_key) if decision_cache is not None else None
            unsupported_identity = bool(
                case.get("identity_support") == "unsupported_by_frozen_provider"
                and case.get("evaluation_scope") == "semantic_operation_advisory"
            )
            if cached is None:
                raw_compatibility = (
                    _unsupported_identity_advisory_decision()
                    if unsupported_identity
                    else _compatibility_decision(
                    catalog,
                    case["question"],
                    intent,
                    evaluation_mode=RAW_BACKEND_MODE,
                    )
                )
                resolution = (
                    _TRUSTED_STOCK_MASTER_RESOLVER.resolve(case["question"])
                    if evaluation_mode == APP_PIPELINE_MODE and not unsupported_identity
                    else None
                )
                assisted_compatibility = (
                    _compatibility_decision(
                        catalog,
                        case["question"],
                        intent,
                        evaluation_mode=APP_PIPELINE_MODE,
                    )
                    if resolution is not None
                    else raw_compatibility
                )
                raw_analysis = (
                    None if unsupported_identity else analyze_question(case["question"])
                )
                semantic_assisted = bool(
                    resolution is not None
                    and resolution.identity_assisted
                    and raw_analysis is not None
                    and raw_analysis.target_presence is not TargetPresence.PRESENT
                )
                cached = (
                    raw_compatibility,
                    assisted_compatibility,
                    resolution,
                    raw_analysis.target_presence if raw_analysis is not None else None,
                    semantic_assisted,
                )
                if decision_cache is not None:
                    decision_cache[cache_key] = cached
            (
                raw_compatibility,
                assisted_compatibility,
                resolution,
                raw_target_presence,
                semantic_assisted,
            ) = cached
            direct_quote_scope = bool(
                resolution is not None
                and raw_target_presence is not None
                and raw_target_presence is not TargetPresence.PRESENT
                and str(case["id"]) in quote_control_evidence
            )
            compatibility = (
                assisted_compatibility if semantic_assisted else raw_compatibility
            )
            selected = (
                "base:ka10001" if direct_quote_scope else compatibility.selected_family_ref
            )
            selected_operation = (
                "detail:ka10001:current_trading"
                if direct_quote_scope
                else compatibility.selected_operation_ref
            )
            selected_document = (
                catalog.find_exact(selected_operation) if selected_operation else None
            )
            selected_kind = selected_document.kind if selected_document else None
            request_aliases = (
                {
                    field.alias or name
                    for name, field in selected_document.request_model.model_fields.items()
                }
                if selected_document is not None
                else set()
            )
            evaluation_stratum = (
                "unsupported_identity_surface_advisory"
                if unsupported_identity
                else "identity_assisted_quote_control_plane"
                if direct_quote_scope
                else "resolver_assisted_semantic_shadow"
                if semantic_assisted
                else "raw_question_only"
            )
            binding_evidence = _quote_control_plane_binding(
                selected_document if direct_quote_scope else None,
                resolution if direct_quote_scope else None,
            )
            if direct_quote_scope:
                node_binding = quote_control_evidence[str(case["id"])]
                binding_evidence["node_build_quote_dataset_verified"] = bool(
                    selected_operation == node_binding["operation_ref"]
                    and hmac.compare_digest(
                        binding_evidence.get("bound_code_sha256") or "",
                        node_binding["bound_code_sha256"],
                    )
                )
                binding_evidence["exact_binding_verified"] = bool(
                    binding_evidence["exact_binding_verified"]
                    and binding_evidence["node_build_quote_dataset_verified"]
                )
            else:
                binding_evidence["node_build_quote_dataset_verified"] = False
            control_plane_trace = {
                "scope": (
                    "quote_direct_dataset"
                    if direct_quote_scope
                    else "semantic_shadow"
                    if semantic_assisted
                    else "not_identity_assisted"
                ),
                "resolution_status": "resolved" if resolution else "unresolved",
                "resolver_source": (
                    "production_instrument_identity_index" if resolution else None
                ),
                "selected_operation_ref": selected_operation,
                "selected_operation_accepts_stk_cd": "stk_cd" in request_aliases,
                **binding_evidence,
            }
            selection_outcome = "selected" if direct_quote_scope else compatibility.status.value
            policy_confidence = "high" if direct_quote_scope else compatibility.confidence.value
            expected, expected_operations = _expected_contract(case)
            correct = _disposition_correct(
                case,
                selected_family=selected,
                selected_operation=selected_operation,
                selected_kind=selected_kind,
            )
            forbidden = set(case["forbidden_refs"])
            severe = (
                selected in forbidden
                or _routing_scope_error(catalog, expected, selected)
            )
            expected_kind = case.get("expected_kind")
            surface_crossing = (
                selected_operation is not None
                and (
                    case["expected_disposition"] in {"reject", "forbidden"}
                    or (expected_kind is not None and selected_kind != expected_kind)
                )
            )
            outcomes.append(
                {
                    "id": case["id"],
                    "category": case["category"],
                    "pair_id": case["pair_id"],
                    "critical": bool(
                        case.get("critical", False) or case.get("critical_tags", ())
                    ),
                    "critical_groups": list(
                        case.get("critical_groups", case.get("critical_tags", ()))
                    ),
                    "metamorphic_group": case.get("metamorphic_group"),
                    "expected_disposition": case["expected_disposition"],
                    "evaluation_stratum": evaluation_stratum,
                    "identity_control_plane_trace": control_plane_trace,
                    "top1_family": top1,
                    "top1_score": top_item.score if top_item else None,
                    "top1_authoritative_score": (
                        top_item.authoritative_score if top_item else None
                    ),
                    "top1_typed_tier": top_item.typed_tier if top_item else None,
                    "runner_up_family": (
                        runner_up.document.family_ref if runner_up else None
                    ),
                    "runner_up_score": runner_up.score if runner_up else None,
                    "runner_up_authoritative_score": (
                        runner_up.authoritative_score if runner_up else None
                    ),
                    "runner_up_typed_tier": (
                        runner_up.typed_tier if runner_up else None
                    ),
                    "score_margin": (
                        top_item.score - runner_up.score
                        if top_item and runner_up
                        else None
                    ),
                    "score_margin_ratio": _ratio(
                        top_item.score if top_item else None,
                        runner_up.score if runner_up else None,
                    ),
                    "authoritative_margin": (
                        top_item.authoritative_score - runner_up.authoritative_score
                        if top_item and runner_up
                        else None
                    ),
                    "authoritative_margin_ratio": _ratio(
                        top_item.authoritative_score if top_item else None,
                        runner_up.authoritative_score if runner_up else None,
                    ),
                    "typed_tier_margin": (
                        top_item.typed_tier - runner_up.typed_tier
                        if top_item and runner_up
                        else None
                    ),
                    "retrieval_score_band": _retrieval_score_band(
                        top_item.score if top_item else None
                    ),
                    "policy_confidence": policy_confidence,
                    "selected_family": selected,
                    "selected_operation_ref": selected_operation,
                    "selected_kind": selected_kind,
                    "selection_outcome": selection_outcome,
                    "compatibility_reason_codes": list(
                        ("APP_EXACT_ENTITY_QUOTE_BINDING",)
                        if direct_quote_scope
                        else compatibility.reason_codes
                    ),
                    "compatible_operation_refs": list(
                        (selected_operation,)
                        if direct_quote_scope
                        else compatibility.compatible_operation_refs
                    ),
                    "compatibility_trace": _compatibility_trace(compatibility),
                    "decision": "selected" if selected_operation is not None else "rejected",
                    "expected_refs": sorted(expected),
                    "expected_operation_refs": sorted(expected_operations),
                    "correct": correct,
                    "severe_scope_error": severe,
                    "surface_crossing": surface_crossing,
                }
            )

    paired: dict[str, list[bool]] = defaultdict(list)
    for outcome in outcomes:
        if outcome["pair_id"]:
            paired[outcome["pair_id"]].append(outcome["correct"])
    pair_results = {
        pair_id: len(values) == 2 and all(values)
        for pair_id, values in sorted(paired.items())
    }
    return _summarize_variant(variant, outcomes, pair_results)


def _autonomous_calibration(
    cases: list[dict[str, Any]],
    *,
    population: str = "question_only_autonomous",
    require_rejections: bool = True,
) -> dict[str, Any]:
    total = len(cases)

    def coverage(count: int) -> float:
        return round(count / total, 6) if total else 0.0
    confidence_bins: dict[str, dict[str, Any]] = {}
    for confidence in ("high", "medium", "low"):
        members = [case for case in cases if case["policy_confidence"] == confidence]
        selected = [case for case in members if case["decision"] == "selected"]
        rejected = [case for case in members if case["decision"] == "rejected"]
        confidence_bins[confidence] = {
            "cases": len(members),
            "population_coverage": coverage(len(members)),
            "selected_cases": len(selected),
            "selected_coverage": coverage(len(selected)),
            "selected_correct": sum(case["correct"] for case in selected),
            "selected_precision": (
                round(sum(case["correct"] for case in selected) / len(selected), 6)
                if selected
                else None
            ),
            "rejected_cases": len(rejected),
            "rejected_correct": sum(case["correct"] for case in rejected),
            "rejected_precision": (
                round(sum(case["correct"] for case in rejected) / len(rejected), 6)
                if rejected
                else None
            ),
        }

    retrieval_bands: dict[str, dict[str, Any]] = {}
    for band in ("at_least_1000", "240_to_999", "below_240", "no_result"):
        members = [case for case in cases if case["retrieval_score_band"] == band]
        retrieval_bands[band] = {
            "cases": len(members),
            "population_coverage": coverage(len(members)),
            "correct": sum(case["correct"] for case in members),
            "accuracy": (
                round(sum(case["correct"] for case in members) / len(members), 6)
                if members
                else None
            ),
        }

    selected = [case for case in cases if case["decision"] == "selected"]
    rejected = [case for case in cases if case["decision"] == "rejected"]
    score_margins = [case["score_margin"] for case in cases if case["score_margin"] is not None]
    score_ratios = [
        case["score_margin_ratio"]
        for case in cases
        if case["score_margin_ratio"] is not None
    ]
    authoritative_margins = [
        case["authoritative_margin"]
        for case in cases
        if case["authoritative_margin"] is not None
    ]
    by_id = {case["id"]: case for case in cases}
    flagship = by_id.get("snapshot-stock-current-ko")
    vague_price = by_id.get("ambiguity-price-ko")
    flagship_evidence = (
        {
            key: flagship[key]
            for key in ("id", "decision", "policy_confidence", "correct")
        }
        if flagship
        else None
    )
    vague_price_evidence = (
        {
            key: vague_price[key]
            for key in ("id", "decision", "policy_confidence", "correct")
        }
        if vague_price
        else None
    )
    high_precision = confidence_bins["high"]["selected_precision"]
    medium_precision = confidence_bins["medium"]["selected_precision"]
    rejected_precision = (
        round(sum(case["correct"] for case in rejected) / len(rejected), 6)
        if rejected
        else None
    )
    return {
        "population": population,
        "identity_assisted_cases": sum(
            case.get("evaluation_stratum") != "raw_question_only"
            for case in cases
        ),
        "total_cases": total,
        "retrieval_thresholds_observed": {
            "minimum_score": _MINIMUM_SCORE,
            "close_margin_absolute": _CLOSE_MARGIN_ABSOLUTE,
            "close_margin_ratio": _CLOSE_MARGIN_RATIO,
            "descriptive_upper_band_score": _DESCRIPTIVE_UPPER_BAND_SCORE,
        },
        "retrieval_threshold_policy": "observed_only_no_threshold_tuning",
        "policy_confidence_source": (
            "athena_api.selector.compatibility.decide_selector_compatibility"
        ),
        "policy_confidence_bins": confidence_bins,
        "retrieval_score_bands": retrieval_bands,
        "selected": {
            "cases": len(selected),
            "coverage": coverage(len(selected)),
            "correct": sum(case["correct"] for case in selected),
            "precision": (
                round(sum(case["correct"] for case in selected) / len(selected), 6)
                if selected
                else None
            ),
        },
        "rejected": {
            "cases": len(rejected),
            "coverage": coverage(len(rejected)),
            "correct": sum(case["correct"] for case in rejected),
            "precision": rejected_precision,
        },
        "flagship_case": flagship_evidence,
        "vague_price_case": vague_price_evidence,
        "distributions": {
            "top1_score": _distribution(
                [case["top1_score"] for case in cases if case["top1_score"] is not None]
            ),
            "top1_authoritative_score": _distribution(
                [
                    case["top1_authoritative_score"]
                    for case in cases
                    if case["top1_authoritative_score"] is not None
                ]
            ),
            "score_margin": _distribution(score_margins),
            "score_margin_ratio": _distribution(score_ratios),
            "authoritative_margin": _distribution(authoritative_margins),
        },
        "threshold_evidence": {
            "score_below_240_cases": sum(
                case["top1_score"] is not None and case["top1_score"] < _MINIMUM_SCORE
                for case in cases
            ),
            "score_at_least_240_cases": sum(
                case["top1_score"] is not None and case["top1_score"] >= _MINIMUM_SCORE
                for case in cases
            ),
            "absolute_margin_below_80_cases": sum(
                margin < _CLOSE_MARGIN_ABSOLUTE for margin in score_margins
            ),
            "absolute_margin_at_least_80_cases": sum(
                margin >= _CLOSE_MARGIN_ABSOLUTE for margin in score_margins
            ),
            "ratio_below_1_15_cases": sum(
                ratio < _CLOSE_MARGIN_RATIO for ratio in score_ratios
            ),
            "ratio_at_least_1_15_cases": sum(
                ratio >= _CLOSE_MARGIN_RATIO for ratio in score_ratios
            ),
            "no_runner_up_cases": total - len(score_margins),
            "no_score_ratio_cases": total - len(score_ratios),
        },
        "calibration_pass": (
            total == 0
            or (
            high_precision == 1.0
            and medium_precision in {None, 1.0}
            and confidence_bins["high"]["rejected_cases"] == 0
            and confidence_bins["medium"]["rejected_cases"] == 0
            and confidence_bins["low"]["rejected_cases"] == len(rejected)
            and (rejected_precision == 1.0 or not require_rejections)
            and (
                flagship_evidence is None
                or (
                    flagship_evidence["decision"] == "selected"
                    and flagship_evidence["policy_confidence"] == "high"
                    and flagship_evidence["correct"]
                )
            )
            and (
                vague_price_evidence is None
                or (
                    vague_price_evidence["decision"] == "rejected"
                    and vague_price_evidence["policy_confidence"] == "low"
                    and vague_price_evidence["correct"]
                )
            ))
        ),
    }


def _summarize_variant(
    variant: str,
    outcomes: list[dict[str, Any]],
    pair_results: dict[str, bool],
) -> dict[str, Any]:
    categories: dict[str, list[bool]] = defaultdict(list)
    critical_groups: dict[str, list[bool]] = defaultdict(list)
    metamorphic_groups: dict[str, list[bool]] = defaultdict(list)
    advisory_groups: dict[str, list[bool]] = defaultdict(list)
    for outcome in outcomes:
        categories[outcome["category"]].append(outcome["correct"])
        general_critical_success = (
            outcome["correct"]
            and not outcome["severe_scope_error"]
            and not outcome["surface_crossing"]
        )
        # 동결 제공자가 구조적으로 식별하지 못하는 질문은 라우팅 결함이 아니라 제공자
        # 한계다. 게이트에서 빼되 버리지 않고 별도 키로 보고한다 — shadow는 그대로
        # 게이트에 남는다(실앱은 실제 식별 인덱스를 쓰므로 shadow 실패가 곧 앱 실패다).
        target_groups = (
            advisory_groups
            if outcome.get("evaluation_stratum") == "unsupported_identity_surface_advisory"
            else critical_groups
        )
        for group in outcome["critical_groups"]:
            target_groups[group].append(_critical_group_success(group, outcome))
        if outcome["metamorphic_group"]:
            metamorphic_groups[outcome["metamorphic_group"]].append(
                general_critical_success
            )
    critical_group_results = {
        group: all(values) for group, values in sorted(critical_groups.items())
    }
    critical_group_metrics = {
        group: {
            "passed": sum(values),
            "total": len(values),
            "accuracy": round(sum(values) / len(values), 6),
        }
        for group, values in sorted(critical_groups.items())
    }
    metamorphic_group_results = {
        group: len(values) >= 2 and all(values)
        for group, values in sorted(metamorphic_groups.items())
    }
    return {
        "variant": variant,
        "cases_evaluated": len(outcomes),
        "correct": sum(outcome["correct"] for outcome in outcomes),
        "top1_or_reject_accuracy": round(
            sum(outcome["correct"] for outcome in outcomes) / len(outcomes), 6
        ),
        "severe_scope_errors": sum(
            outcome["severe_scope_error"] for outcome in outcomes
        ),
        "critical_pairs_passed": sum(pair_results.values()),
        "critical_pairs_total": len(pair_results),
        "critical_pairs": pair_results,
        "critical_groups_passed": sum(critical_group_results.values()),
        "critical_groups_total": len(critical_group_results),
        "critical_groups": critical_group_results,
        "critical_group_metrics": critical_group_metrics,
        "unsupported_identity_advisory_groups": {
            group: {
                "passed": sum(values),
                "total": len(values),
            }
            for group, values in sorted(advisory_groups.items())
        },
        "metamorphic_groups_passed": sum(metamorphic_group_results.values()),
        "metamorphic_groups_total": len(metamorphic_group_results),
        "metamorphic_groups": metamorphic_group_results,
        "wrong_plans": sum(
            outcome["selected_family"] is not None
            for outcome in outcomes
            if outcome["critical"] and not outcome["expected_refs"]
        ),
        "surface_crossings": sum(
            outcome["surface_crossing"] for outcome in outcomes if outcome["critical"]
        ),
        "category_accuracy": {
            category: round(sum(values) / len(values), 6)
            for category, values in sorted(categories.items())
        },
        "cases": outcomes,
    }


def semantic_metrics(report: dict[str, Any]) -> dict[str, Any]:
    baseline = report["variants"][0]
    raw_cases = [
        case
        for case in baseline["cases"]
        if case.get("evaluation_stratum") == "raw_question_only"
    ]
    identity_assisted_cases = [
        case
        for case in baseline["cases"]
        if case.get("evaluation_stratum") == "identity_assisted_quote_control_plane"
    ]
    semantic_shadow_cases = [
        case
        for case in baseline["cases"]
        if case.get("evaluation_stratum") == "resolver_assisted_semantic_shadow"
    ]
    unsupported_identity_cases = [
        case
        for case in baseline["cases"]
        if case.get("evaluation_stratum")
        == "unsupported_identity_surface_advisory"
    ]
    production_cases = raw_cases + identity_assisted_cases
    calibration = _autonomous_calibration(
        raw_cases, population=f"{report.get('partition', 'question_only_autonomous')}:raw"
    )
    identity_calibration = _autonomous_calibration(
        identity_assisted_cases,
        population=f"{report.get('partition', 'question_only_autonomous')}:identity_assisted",
        require_rejections=False,
    )
    shadow_calibration = _autonomous_calibration(
        semantic_shadow_cases,
        population=(
            f"{report.get('partition', 'question_only_autonomous')}:"
            "production_instrument_identity_fixture_semantic_shadow"
        ),
    )
    failed_cases = [
        {
            "id": case["id"],
            "category": case["category"],
            "critical_groups": case["critical_groups"],
            "top1_family": case["top1_family"],
            "top1_score": case["top1_score"],
            "top1_authoritative_score": case["top1_authoritative_score"],
            "score_margin": case["score_margin"],
            "score_margin_ratio": case["score_margin_ratio"],
            "policy_confidence": case["policy_confidence"],
            "retrieval_score_band": case["retrieval_score_band"],
            "selected_operation_ref": case["selected_operation_ref"],
            "selection_outcome": case["selection_outcome"],
            "expected_refs": case["expected_refs"],
            "expected_operation_refs": case["expected_operation_refs"],
            "severe_scope_error": case["severe_scope_error"],
            "surface_crossing": case["surface_crossing"],
        }
        for case in production_cases
        if case["critical"]
        and (
            not case["correct"]
            or case["severe_scope_error"]
            or case["surface_crossing"]
        )
    ]
    production_pair_values: dict[str, list[bool]] = defaultdict(list)
    production_group_values: dict[str, list[bool]] = defaultdict(list)
    for case in production_cases:
        if case["pair_id"]:
            production_pair_values[case["pair_id"]].append(case["correct"])
        for group in case["critical_groups"]:
            production_group_values[group].append(case["correct"])
    production_pairs = {
        pair_id: all(values) for pair_id, values in sorted(production_pair_values.items())
    }
    production_groups = {
        group: all(values) for group, values in sorted(production_group_values.items())
    }
    failed_pairs = sorted(
        pair_id for pair_id, passed in production_pairs.items() if not passed
    )
    failed_groups = sorted(
        group for group, passed in production_groups.items() if not passed
    )
    critical_failure_count = len(failed_cases)
    operation_cases = [
        case for case in production_cases if case["expected_operation_refs"]
    ]
    exact_operation_correct = sum(
        case["selected_operation_ref"] in case["expected_operation_refs"]
        for case in operation_cases
    )
    exact_operation_accuracy = (
        round(exact_operation_correct / len(operation_cases), 6)
        if operation_cases
        else None
    )
    expected_rejections = [
        case
        for case in production_cases
        if case["expected_disposition"] in {"reject", "forbidden"}
    ]
    expected_rejection_recall = (
        round(
            sum(case["selected_family"] is None for case in expected_rejections)
            / len(expected_rejections),
            6,
        )
        if expected_rejections
        else None
    )
    policy_rejections = [
        case for case in production_cases if case["selected_family"] is None
    ]
    rejected_forbidden_precision = (
        round(
            sum(
                case["expected_disposition"] in {"reject", "forbidden"}
                for case in policy_rejections
            )
            / len(policy_rejections),
            6,
        )
        if policy_rejections
        else None
    )
    identity_binding_failures = sum(
        not case["identity_control_plane_trace"]["exact_binding_verified"]
        for case in identity_assisted_cases
    )
    partition = report.get("partition", "question_only_autonomous")
    freeze_manifest = report.get("freeze_manifest")
    freeze_content = (
        freeze_manifest.get("content", {}) if isinstance(freeze_manifest, dict) else {}
    )
    sealed_acceptance = freeze_content.get(
        "predeclared_gates", SEALED_V2_ACCEPTANCE
    )
    sealed_generation = freeze_content.get("sealed_generation", "v2")
    next_sealed_generation = f"v{int(sealed_generation[1:]) + 1}"
    sealed_gate = (
        (sum(case["correct"] for case in production_cases) / len(production_cases))
        >= sealed_acceptance["overall_final_policy_accuracy_minimum"]
        and exact_operation_accuracy is not None
        and exact_operation_accuracy
        >= sealed_acceptance["exact_operation_accuracy_minimum"]
        and critical_failure_count == 0
        and not failed_groups
        and not any(
            case["selected_family"] is not None
            for case in production_cases
            if not case["expected_refs"]
        )
        and not any(case["surface_crossing"] for case in production_cases)
        and not any(case["severe_scope_error"] for case in production_cases)
        and rejected_forbidden_precision == 1.0
        and calibration["calibration_pass"]
        and identity_calibration["calibration_pass"]
        and all(case["correct"] for case in identity_assisted_cases)
        and identity_binding_failures == 0
        and freeze_manifest is not None
    )
    return {
        "schema_version": 4,
        "corpus": report["corpus"],
        "corpus_sha256": report.get("corpus_sha256"),
        "partition": partition,
        "evaluation_mode": report.get("evaluation_mode", APP_PIPELINE_MODE),
        "target_resolver": report.get("target_resolver"),
        "headline": report.get("headline"),
        "methodology_provenance": report.get("methodology_provenance"),
        "case_count": report["case_count"],
        "general_accuracy_advisory_all_strata": baseline["top1_or_reject_accuracy"],
        "general_correct_advisory_all_strata": baseline["correct"],
        "production_accuracy": round(
            sum(case["correct"] for case in production_cases) / len(production_cases), 6
        ),
        "production_correct": sum(case["correct"] for case in production_cases),
        "production_case_count": len(production_cases),
        "critical_cases": sum(case["critical"] for case in production_cases),
        "critical_failures": failed_cases,
        "critical_failure_count": critical_failure_count,
        "autonomous_calibration": calibration,
        "identity_assisted_calibration": identity_calibration,
        "resolver_assisted_semantic_shadow_calibration": shadow_calibration,
        "strata": {
            "raw_question_only": {
                "cases": len(raw_cases),
                "correct": sum(case["correct"] for case in raw_cases),
                "gate_pass": all(case["correct"] for case in raw_cases)
                and calibration["calibration_pass"],
            },
            "identity_assisted_quote_control_plane": {
                "cases": len(identity_assisted_cases),
                "correct": sum(case["correct"] for case in identity_assisted_cases),
                "direct_quote_binding_cases": sum(
                    case["identity_control_plane_trace"]["scope"]
                    == "quote_direct_dataset"
                    for case in identity_assisted_cases
                ),
                "direct_quote_binding_failures": identity_binding_failures,
                "gate_pass": all(case["correct"] for case in identity_assisted_cases)
                and identity_calibration["calibration_pass"]
                and all(
                    case["identity_control_plane_trace"]["scope"]
                    != "quote_direct_dataset"
                    or case["identity_control_plane_trace"]["exact_binding_verified"]
                    for case in identity_assisted_cases
                ),
            },
            "resolver_assisted_semantic_shadow": {
                "cases": len(semantic_shadow_cases),
                "correct": sum(case["correct"] for case in semantic_shadow_cases),
                "gate_pass": None,
                "authority": (
                    "research_only_fixture_snapshot_excluded_from_production_green"
                ),
                "scope": (
                    "production_identity_algorithm_with_static_fixture_"
                    "not_live_app_state"
                ),
            },
            "unsupported_identity_surface_advisory": {
                "cases": len(unsupported_identity_cases),
                "operation_gold_evaluated": 0,
                "gate_pass": None,
                "authority": "provider_unsupported_advisory_excluded_from_production",
                "case_ids": [case["id"] for case in unsupported_identity_cases],
            },
        },
        "critical_groups": production_groups,
        "gate_metrics": production_groups,
        "failed_critical_groups": failed_groups,
        "legacy_pairs": production_pairs,
        "failed_legacy_pairs": failed_pairs,
        "metamorphic_groups": baseline["metamorphic_groups"],
        "wrong_plans": sum(
            case["selected_family"] is not None
            for case in production_cases
            if not case["expected_refs"]
        ),
        "surface_crossings": sum(
            case["surface_crossing"] for case in production_cases
        ),
        "severe_scope_errors": sum(
            case["severe_scope_error"] for case in production_cases
        ),
        "exact_operation_cases": len(operation_cases),
        "exact_operation_correct": exact_operation_correct,
        "exact_operation_accuracy": exact_operation_accuracy,
        "expected_rejection_cases": len(expected_rejections),
        "expected_rejection_recall": expected_rejection_recall,
        "policy_rejection_cases": len(policy_rejections),
        "rejected_forbidden_precision": rejected_forbidden_precision,
        "freeze_manifest": freeze_manifest,
        "sealed_run_status": (
            "passed"
            if partition == "sealed_holdout" and sealed_gate
            else (
                "failed_reclassify_as_autonomous_expansion_"
                f"{next_sealed_generation}_required"
                if partition == "sealed_holdout"
                else None
            )
        ),
        "predeclared_gates": (
            sealed_acceptance if partition == "sealed_holdout" else None
        ),
        "gates_pass": (
            sealed_gate
            if partition == "sealed_holdout"
            else (
                all(case["correct"] for case in raw_cases)
                and all(case["correct"] for case in identity_assisted_cases)
                and not any(
                    case["selected_family"] is not None and not case["expected_refs"]
                    for case in production_cases
                )
                and all(not case["surface_crossing"] for case in production_cases)
                and all(not case["severe_scope_error"] for case in production_cases)
                and calibration["calibration_pass"]
                and identity_calibration["calibration_pass"]
            )
        ),
    }


def _assert_observed_strata_match_predeclared(
    report: dict[str, Any], freeze_manifest: dict[str, Any]
) -> None:
    expected = freeze_manifest["content"]["coverage"]["stratum_counts"]
    metrics = semantic_metrics(report)
    observed = {
        stratum: int(metrics["strata"][stratum]["cases"])
        for stratum in expected
    }
    if observed != expected:
        raise ValueError(
            "sealed observed strata differ from predeclared structural strata: "
            f"expected={expected}, observed={observed}"
        )


def evaluate_all(
    cases: tuple[dict[str, Any], ...],
    *,
    corpus_path: Path = DEFAULT_CORPUS,
    partition: str = "question_only_autonomous",
    freeze_manifest: dict[str, Any] | None = None,
    evaluation_mode: str = APP_PIPELINE_MODE,
) -> dict[str, Any]:
    _validate_unsupported_advisory_semantics(cases)
    quote_control_evidence = (
        _node_quote_control_plane_evidence(cases)
        if evaluation_mode == APP_PIPELINE_MODE
        else {}
    )
    decision_cache: dict[tuple[str, str, str], tuple[Any, ...]] = {}
    results = [
        evaluate_variant(
            cases,
            variant,
            evaluation_mode=evaluation_mode,
            decision_cache=decision_cache,
            quote_control_evidence=quote_control_evidence,
        )
        for variant in VARIANTS
    ]
    baseline_by_id = {
        case["id"]: case["correct"] for case in results[0]["cases"]
    }
    baseline_severe = results[0]["severe_scope_errors"]
    for result in results:
        comparisons = Counter()
        for case in result["cases"]:
            before = baseline_by_id[case["id"]]
            after = case["correct"]
            comparisons[
                "win" if after and not before else "loss" if before and not after else "tie"
            ] += 1
        result["vs_baseline"] = {
            "wins": comparisons["win"],
            "losses": comparisons["loss"],
            "ties": comparisons["tie"],
        }
        result["removal_candidate"] = (
            result["variant"] != "baseline"
            and comparisons["loss"] == 0
            and result["severe_scope_errors"] <= baseline_severe
            and comparisons["win"] > 0
        )
    suite_provenance = {case.get("provenance") for case in cases}
    report = {
        "schema_version": 1,
        "corpus": (
            corpus_path.name
            if partition == "sealed_holdout"
            else (
                str(corpus_path.resolve().relative_to(BACKEND.parent.resolve())).replace(
                    "\\", "/"
                )
                if corpus_path.resolve().is_relative_to(BACKEND.parent.resolve())
                else corpus_path.name
            )
        ),
        "corpus_sha256": _sha256(corpus_path),
        "partition": partition,
        "evaluation_mode": evaluation_mode,
        "target_resolver": _target_resolver_metadata(evaluation_mode),
        "freeze_manifest": freeze_manifest,
        "case_count": len(cases),
        "method": (
            "Each variant reruns rank_documents for retrieval diagnostics and uses the "
            "shared typed compatibility decision for final authority; no contribution "
            "is subtracted after ranking."
        ),
        "variants": results,
        "removal_candidates": [
            result["variant"] for result in results if result["removal_candidate"]
        ],
    }
    baseline_cases = results[0]["cases"]
    headline_production = [
        case
        for case in baseline_cases
        if case["evaluation_stratum"]
        in {"raw_question_only", "identity_assisted_quote_control_plane"}
    ]
    unsupported_advisory = [
        case
        for case in baseline_cases
        if case["evaluation_stratum"] == "unsupported_identity_surface_advisory"
    ]
    report["headline"] = {
        "production": (
            f"{sum(case['correct'] for case in headline_production)}/"
            f"{len(headline_production)}"
        ),
        "unsupported_identity_advisory_cases": len(unsupported_advisory),
        "semantic_shadow_cases": sum(
            case["evaluation_stratum"] == "resolver_assisted_semantic_shadow"
            for case in baseline_cases
        ),
    }
    if unsupported_advisory:
        report["methodology_provenance"] = (
            "post-exposure methodology correction: frozen identity-provider "
            "support separated from production authority"
        )
    if suite_provenance == {EXPOSED_V2_PROVENANCE}:
        report["suite_provenance"] = EXPOSED_V2_PROVENANCE
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--metrics-output", type=Path, default=G005_METRIC_OUTPUT)
    parser.add_argument(
        "--partition",
        choices=(
            "question_only_autonomous",
            "autonomous_expansion",
            "sealed_holdout",
        ),
        default="question_only_autonomous",
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--autonomous-expansion", action="store_true")
    parser.add_argument("--autonomous-expansion-v2", action="store_true")
    parser.add_argument("--freeze-manifest-output", type=Path)
    parser.add_argument(
        "--sealed-generation", choices=("v2", "v3", "v4", "v5"), default="v2"
    )
    parser.add_argument("--production-freeze-hash")
    parser.add_argument(
        "--evaluation-mode", choices=EVALUATION_MODES, default=APP_PIPELINE_MODE
    )
    parser.add_argument("--gate-metrics", type=Path)
    args = parser.parse_args()
    if args.gate_metrics is not None:
        gate_metrics = json.loads(args.gate_metrics.read_text(encoding="utf-8"))
        if not gate_metrics.get("gates_pass", False):
            raise SystemExit("semantic gates RED")
        return
    if args.autonomous_expansion:
        args.corpus = AUTONOMOUS_EXPANSION_CORPUS
        args.output = AUTONOMOUS_EXPANSION_OUTPUT
        args.metrics_output = AUTONOMOUS_EXPANSION_METRIC_OUTPUT
        args.partition = "autonomous_expansion"
    if args.autonomous_expansion_v2:
        args.corpus = EXPOSED_V2_CORPUS
        args.output = EXPOSED_V2_OUTPUT
        args.metrics_output = EXPOSED_V2_METRIC_OUTPUT
        args.partition = "autonomous_expansion"
    if args.partition == "sealed_holdout":
        if args.evaluation_mode != APP_PIPELINE_MODE:
            raise SystemExit("sealed_holdout requires app stock-entity-index mode")
        if args.check:
            raise SystemExit("sealed_holdout is one-time only; use --gate-metrics afterward")
        if args.freeze_manifest_output is None:
            raise SystemExit("sealed_holdout requires --freeze-manifest-output")
        sealed_artifacts = (
            args.freeze_manifest_output,
            args.output,
            args.metrics_output,
        )
        existing = [path.name for path in sealed_artifacts if path.exists()]
        if existing:
            raise SystemExit(f"sealed_holdout refuses existing artifacts: {existing}")
    cases = load_cases(args.corpus)
    freeze_manifest = None
    frozen_blob_manifest = None
    if args.partition == "sealed_holdout":
        exposed_provenances = sorted(
            {
                str(case.get("provenance"))
                for case in cases
                if str(case.get("provenance", "")).startswith(
                    EXPOSED_PROVENANCE_PREFIX
                )
            }
        )
        if exposed_provenances:
            raise SystemExit(
                "sealed_holdout refuses corpus provenance "
                + ", ".join(exposed_provenances)
            )
        if any(_GOLD_HINT_KEYS.intersection(case) for case in cases):
            raise SystemExit("sealed_holdout contains prohibited gold hint inputs")
        command = (
            "python scripts/evaluate_selector_ablations.py "
            f"--corpus {args.corpus.name} --partition sealed_holdout "
            f"--sealed-generation {args.sealed_generation} "
            f"--evaluation-mode {args.evaluation_mode} "
            f"--production-freeze-hash {args.production_freeze_hash} "
            f"--output {args.output.name} --metrics-output {args.metrics_output.name} "
            f"--freeze-manifest-output {args.freeze_manifest_output.name}"
        )
        manifest_content = sealed_freeze_manifest(
            corpus_path=args.corpus,
            cases=cases,
            command=command,
            sealed_generation=args.sealed_generation,
            production_freeze_hash=args.production_freeze_hash,
            evaluation_mode=args.evaluation_mode,
        )
        manifest_encoded = (
            json.dumps(manifest_content, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n"
        )
        _write_exclusive(args.freeze_manifest_output, manifest_encoded)
        frozen_blob_manifest = manifest_content.get(
            "production_freeze_git_blob_manifest"
        )
        if frozen_blob_manifest is not None:
            assert_freeze_snapshot_unchanged(frozen_blob_manifest)
        freeze_manifest = {
            "manifest_label": args.freeze_manifest_output.name,
            "manifest_sha256": hashlib.sha256(
                manifest_encoded.encode("utf-8")
            ).hexdigest(),
            "content": manifest_content,
        }
    report = evaluate_all(
        cases,
        corpus_path=args.corpus,
        partition=args.partition,
        freeze_manifest=freeze_manifest,
        evaluation_mode=args.evaluation_mode,
    )
    if freeze_manifest is not None:
        _assert_observed_strata_match_predeclared(report, freeze_manifest)
    encoded = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    metrics_encoded = (
        json.dumps(semantic_metrics(report), ensure_ascii=False, indent=2, sort_keys=True)
        + "\n"
    )
    gates_pass = semantic_metrics(report)["gates_pass"]
    if frozen_blob_manifest is not None:
        assert_freeze_snapshot_unchanged(frozen_blob_manifest)
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != encoded:
            raise SystemExit(f"stale ablation report: {args.output}")
        if (
            not args.metrics_output.exists()
            or args.metrics_output.read_text(encoding="utf-8") != metrics_encoded
        ):
            raise SystemExit(f"stale semantic metric report: {args.metrics_output}")
        if not gates_pass:
            raise SystemExit("semantic gates RED")
        return
    if freeze_manifest is not None:
        _write_exclusive(args.output, encoded)
        _write_exclusive(args.metrics_output, metrics_encoded)
    else:
        args.output.write_text(encoded, encoding="utf-8")
        args.metrics_output.write_text(metrics_encoded, encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "case_count": report["case_count"],
                "removal_candidates": report["removal_candidates"],
                "metrics_output": str(args.metrics_output),
                "gates_pass": gates_pass,
            },
            ensure_ascii=False,
        )
    )
    if not gates_pass:
        raise SystemExit("semantic gates RED")


if __name__ == "__main__":
    main()
