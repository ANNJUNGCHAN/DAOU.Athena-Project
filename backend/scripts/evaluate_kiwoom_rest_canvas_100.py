"""G007 Kiwoom direct-REST canvas exact-100 release gate.

This module deliberately separates measurement production from evaluation.  The
Electron integration runner owns observable paint acknowledgements; this file
owns the immutable corpus contract, the all-cases gate, and the report format.
No case may be selected, retried, or silently dropped.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
from collections.abc import Iterable
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
DEFAULT_CORPUS = BACKEND / "tests" / "fixtures" / "kiwoom_rest_canvas_100.jsonl"
DEFAULT_TRACE = ROOT / "plan" / "kiwoom-rest-canvas-100-trace-2026-08-21.jsonl"
DEFAULT_REPORT = ROOT / "plan" / "kiwoom-rest-canvas-100-benchmark-2026-08-21.json"
DEFAULT_APP_RUNNER = ROOT / "app" / "scripts" / "benchmark-rest-canvas-100.js"
ELECTRON_CLI = ROOT / "app" / "node_modules" / "electron" / "cli.js"
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
CATALOG_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"
AITS_CONTRACTS_PATH = BACKEND / "ref" / "aits-chart-contracts.json"
SOURCE_PATHS = (
    Path(__file__),
    BACKEND / "scripts" / "serve_kiwoom_rest_canvas_benchmark.py",
    BACKEND / "scripts" / "generate_api.py",
    BACKEND / "athena_api" / "main.py",
    BACKEND / "athena_api" / "api" / "canvas_push.py",
    BACKEND / "athena_api" / "canvas_transform.py",
    BACKEND / "athena_api" / "routing_contract.py",
    BACKEND / "athena_api" / "generated" / "registry.py",
    BACKEND / "athena_api" / "selector" / "catalog.py",
    BACKEND / "athena_api" / "selector" / "eligibility.py",
    BACKEND / "athena_api" / "selector" / "plans.py",
    BACKEND / "athena_api" / "selector" / "policy.py",
    BACKEND / "athena_api" / "selector" / "query_frame.py",
    BACKEND / "athena_api" / "selector" / "ranking.py",
    BACKEND / "athena_api" / "selector" / "schemas.py",
    BACKEND / "athena_api" / "selector" / "service.py",
    AITS_CONTRACTS_PATH,
    BACKEND / "ref" / "kiwoom-screen-definitions.json",
    ROOT / "app" / "main.js",
    ROOT / "app" / "canvas.html",
    ROOT / "app" / "canvas.js",
    ROOT / "app" / "preload.js",
    ROOT / "app" / "package.json",
    ROOT / "app" / "package-lock.json",
    ROOT / "app" / "lib" / "canvas-layout.js",
    ROOT / "app" / "lib" / "rest-canvas-paint.js",
    ROOT / "app" / "lib" / "chart-indicator-registry.js",
    ROOT / "app" / "lib" / "chart-indicators.js",
    ROOT / "app" / "lib" / "chart-volume-profile.js",
    ROOT / "app" / "lib" / "chart-resample.js",
    ROOT / "app" / "lib" / "chart-toolbar.js",
    ROOT / "app" / "lib" / "chart-authoring-store.js",
    ROOT / "app" / "lib" / "chart-drawings.js",
    ROOT / "app" / "lib" / "chart-indicator-panel.js",
    ROOT / "app" / "lib" / "chart-card.js",
    ROOT / "app" / "lib" / "aits-chart-panel.js",
    ROOT / "app" / "lib" / "main" / "chart-reload.js",
    ROOT / "app" / "lib" / "main" / "rest-dataset-runner.js",
    ROOT / "app" / "lib" / "main" / "window-readiness.js",
    DEFAULT_APP_RUNNER,
)

EXPECTED_CASE_COUNT = 100
SLA_P50_MS = 1_000.0
SLA_P95_MS = 2_500.0
SLA_MAX_MS = 3_000.0
NO_RENDER_OUTCOMES = {
    "deadline_miss_no_render",
    "cancelled_no_render",
    "rejected_no_render",
}
ALLOWED_OUTCOMES = {
    "render_all",
    "render_partial",
    "render_empty_state",
    "render_manifest_authoritative",
    *NO_RENDER_OUTCOMES,
}
FORBIDDEN_CALL_KEYS = ("mcp", "claude", "ws", "order", "oauth")
AITS_CHART_RENDERER_ID = "aits-chart-v1"
ALLOWED_RECOMMENDATION_INPUTS = {
    "receipt_status",
    "operation_ref",
    "operation_family",
    "canvas_type",
    "domain",
    "freshness",
    "truncated",
    "partial",
    "cache_hit",
}


class GateInputError(ValueError):
    """The corpus or trace cannot be evaluated without weakening the gate."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise GateInputError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        if not isinstance(row, dict):
            raise GateInputError(f"{path}:{line_number}: each row must be an object")
        rows.append(row)
    return rows


@cache
def _manifest_by_operation_ref() -> dict[str, dict[str, Any]]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {item["operation_ref"]: item for item in manifest["mappings"]}


@cache
def _aits_contracts_by_operation_ref() -> dict[str, dict[str, Any]]:
    document = json.loads(AITS_CONTRACTS_PATH.read_text(encoding="utf-8"))
    if document.get("renderer_id") != AITS_CHART_RENDERER_ID:
        raise GateInputError("AITS chart contract renderer_id is not authoritative")
    contracts = document.get("contracts")
    if not isinstance(contracts, list) or len(contracts) != 19:
        raise GateInputError("AITS chart contract must contain exactly 19 operations")
    return {f"base:{item['tr_id']}": item for item in contracts}


def _required(row: dict[str, Any], key: str, case_id: str) -> Any:
    if key not in row:
        raise GateInputError(f"{case_id}: missing required field {key}")
    return row[key]


def validate_corpus(cases: list[dict[str, Any]]) -> None:
    if len(cases) != EXPECTED_CASE_COUNT:
        raise GateInputError(
            f"corpus must contain exactly {EXPECTED_CASE_COUNT} cases, got {len(cases)}"
        )
    ids = [_required(case, "id", f"row-{index}") for index, case in enumerate(cases, 1)]
    if len(ids) != len(set(ids)):
        raise GateInputError("corpus case ids must be unique")

    covered_aits_operations: set[str] = set()
    for case in cases:
        case_id = str(case["id"])
        if case.get("transport") != "direct_rest":
            raise GateInputError(f"{case_id}: transport must be direct_rest")
        if case.get("answer_delivery") != "separate":
            raise GateInputError(f"{case_id}: answer_delivery must be separate")
        if case.get("first_canvas_deadline_ms") != 3000:
            raise GateInputError(f"{case_id}: first_canvas_deadline_ms must be 3000")
        screens = case.get("screens_count")
        if not isinstance(screens, int) or not 1 <= screens <= 6:
            raise GateInputError(f"{case_id}: screens_count must be within 1..6")
        outcome = case.get("expected_outcome")
        if outcome not in ALLOWED_OUTCOMES:
            raise GateInputError(f"{case_id}: unsupported expected_outcome {outcome!r}")

        operations = case.get("operations")
        if not isinstance(operations, list):
            raise GateInputError(f"{case_id}: operations must be a list")
        rejected_before_dispatch = outcome == "rejected_no_render"
        expected_operation_count = 0 if rejected_before_dispatch else screens
        if len(operations) != expected_operation_count:
            raise GateInputError(
                f"{case_id}: operations must match dispatched screen count "
                f"({expected_operation_count})"
            )
        for operation in operations:
            operation_ref = operation.get("operation_ref", "")
            if not isinstance(operation_ref, str) or not operation_ref:
                raise GateInputError(f"{case_id}: operation_ref must be non-empty")
            lowered = operation_ref.lower()
            if any(token in lowered for token in ("oauth", "websocket", "order:")):
                raise GateInputError(f"{case_id}: forbidden operation surface {operation_ref}")
            if operation_ref in _aits_contracts_by_operation_ref():
                covered_aits_operations.add(operation_ref)

        expected = case.get("expected_canvases")
        if not isinstance(expected, list) or len(expected) > 6:
            raise GateInputError(f"{case_id}: expected_canvases must be a list of at most six")
        if outcome in NO_RENDER_OUTCOMES and expected:
            raise GateInputError(f"{case_id}: no-render outcome cannot expect canvases")
        if outcome not in NO_RENDER_OUTCOMES and not expected:
            raise GateInputError(f"{case_id}: render outcome must expect at least one canvas")
        orders = [canvas.get("order") for canvas in expected]
        if orders != list(range(1, len(expected) + 1)):
            raise GateInputError(f"{case_id}: expected canvas order must be contiguous from one")

        profile = case.get("upstream_profile")
        if not isinstance(profile, dict):
            raise GateInputError(f"{case_id}: upstream_profile must be an object")
        calls = profile.get("calls")
        if not isinstance(calls, list):
            raise GateInputError(f"{case_id}: upstream_profile.calls must be a list")
        if profile.get("logical_requests") != len(operations):
            raise GateInputError(f"{case_id}: logical_requests must match dispatched operations")
        for call in calls:
            latency = call.get("latency_ms")
            if not isinstance(latency, (int, float)) or latency < 0:
                raise GateInputError(f"{case_id}: latency_ms must be non-negative")

        reload_expectation = case.get("aits_reload")
        if reload_expectation is not None:
            if not isinstance(reload_expectation, dict):
                raise GateInputError(f"{case_id}: aits_reload must be an object")
            panel_order = reload_expectation.get("panel_order")
            if not isinstance(panel_order, int) or not 1 <= panel_order <= len(expected):
                raise GateInputError(f"{case_id}: aits_reload panel_order is invalid")
            source = expected[panel_order - 1]
            if source.get("canvas_type") != "chart":
                raise GateInputError(f"{case_id}: aits_reload source must be a chart")
            target_ref = reload_expectation.get("operation_ref")
            target = _aits_contracts_by_operation_ref().get(target_ref)
            if target is None:
                raise GateInputError(f"{case_id}: aits_reload target is not authoritative")
            if reload_expectation.get("expected_generation") != 2:
                raise GateInputError(f"{case_id}: aits_reload generation must advance to two")
            if reload_expectation.get("reload_group") != target.get("reload_group"):
                raise GateInputError(f"{case_id}: aits_reload group differs from target contract")
            if reload_expectation.get("series_scope") != target.get("series_scope"):
                raise GateInputError(f"{case_id}: aits_reload scope differs from target contract")
            if profile.get("expected_physical_calls") != len(operations) + 1:
                raise GateInputError(f"{case_id}: aits_reload physical call must be counted")

    authoritative = set(_aits_contracts_by_operation_ref())
    if covered_aits_operations != authoritative:
        missing = sorted(authoritative - covered_aits_operations)
        extra = sorted(covered_aits_operations - authoritative)
        raise GateInputError(
            f"corpus must cover exact AITS operations 19/19; missing={missing}, extra={extra}"
        )


def validate_corpus_against_manifest(cases: list[dict[str, Any]], manifest: dict[str, Any]) -> None:
    mappings = manifest.get("mappings")
    if not isinstance(mappings, list):
        raise GateInputError("common-screen manifest mappings must be a list")
    by_ref = {mapping.get("mapping_id"): mapping for mapping in mappings}
    for case in cases:
        case_id = str(case["id"])
        for operation in case["operations"]:
            operation_ref = operation["operation_ref"]
            mapping = by_ref.get(operation_ref)
            if mapping is None:
                raise GateInputError(f"{case_id}: operation missing from manifest: {operation_ref}")
            classification = mapping.get("classification", {})
            if classification.get("read") is not True:
                raise GateInputError(f"{case_id}: operation is not read-only: {operation_ref}")
            if classification.get("category") in {"order", "oauth", "websocket"}:
                raise GateInputError(f"{case_id}: forbidden operation category: {operation_ref}")

        for expected in case["expected_canvases"]:
            operation_ref = expected["operation_ref"]
            mapping = by_ref.get(operation_ref)
            if mapping is None:
                raise GateInputError(
                    f"{case_id}: expected canvas operation missing from manifest: {operation_ref}"
                )
            layout = mapping.get("presentation", {}).get("layout")
            if expected.get("manifest_layout") != layout:
                raise GateInputError(
                    f"{case_id}: fixture layout differs from manifest for {operation_ref}"
                )
            domain = mapping.get("operation", {}).get("domain")
            expected_canvas_type = "chart" if domain == "charts" else layout
            if expected.get("canvas_type") != expected_canvas_type:
                raise GateInputError(
                    f"{case_id}: fixture canvas type differs from manifest policy "
                    f"for {operation_ref}"
                )
            if operation_ref in _aits_contracts_by_operation_ref() and mapping.get(
                "presentation", {}
            ).get("renderer_id") != AITS_CHART_RENDERER_ID:
                raise GateInputError(
                    f"{case_id}: authoritative AITS operation lacks renderer contract: "
                    f"{operation_ref}"
                )


def validate_traces(cases: list[dict[str, Any]], traces: list[dict[str, Any]]) -> None:
    if len(traces) != EXPECTED_CASE_COUNT:
        raise GateInputError(
            f"trace must contain exactly {EXPECTED_CASE_COUNT} rows, got {len(traces)}"
        )
    case_ids = [str(case["id"]) for case in cases]
    trace_ids = [str(trace.get("case_id", trace.get("datasetId", ""))) for trace in traces]
    if len(trace_ids) != len(set(trace_ids)):
        raise GateInputError("trace case ids must be unique; retries are forbidden")
    if trace_ids != case_ids:
        missing = sorted(set(case_ids) - set(trace_ids))
        extra = sorted(set(trace_ids) - set(case_ids))
        raise GateInputError(
            "trace must preserve exact corpus order and membership; "
            f"missing={missing[:5]}, extra={extra[:5]}"
        )


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return round(ordered[lower], 3)
    weight = position - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight, 3)


def _canvas_projection(canvas: dict[str, Any]) -> dict[str, Any]:
    mapping = _manifest_by_operation_ref().get(canvas.get("operation_ref"), {})
    screen_reference = mapping.get("screen_reference", {})
    presentation = mapping.get("presentation", {})
    observed_screen_id = canvas.get("screen_id")
    return {
        "operation_ref": canvas.get("operation_ref"),
        "canvas_type": canvas.get("canvas_type"),
        "manifest_layout": (
            presentation.get("layout")
            if observed_screen_id == screen_reference.get("screen_id")
            else canvas.get("manifest_layout")
        ),
        "screen_id": observed_screen_id,
        "ordinal": canvas.get("ordinal"),
    }


def _expected_projection(canvas: dict[str, Any], ordinal: int | None) -> dict[str, Any]:
    mapping = _manifest_by_operation_ref().get(canvas.get("operation_ref"), {})
    return {
        "operation_ref": canvas.get("operation_ref"),
        "canvas_type": canvas.get("canvas_type"),
        "manifest_layout": canvas.get("manifest_layout"),
        "screen_id": mapping.get("screen_reference", {}).get("screen_id"),
        "ordinal": ordinal,
    }


def normalize_trace(case: dict[str, Any], trace: dict[str, Any]) -> dict[str, Any]:
    normalized_canvases = []
    for canvas in trace.get("canvases", []):
        if canvas.get("is_data_canvas", canvas.get("isDataCanvas", True)) is False:
            continue
        stage = canvas.get("stage_ms", canvas.get("stageMs", {}))
        normalized_canvases.append(
            {
                "operation_ref": canvas.get("operation_ref", canvas.get("operationRef")),
                "canvas_type": canvas.get("canvas_type", canvas.get("canvasType")),
                "manifest_layout": canvas.get(
                    "manifest_layout",
                    canvas.get("manifestLayout", canvas.get("envelope", {}).get("layout")),
                ),
                "screen_id": canvas.get("screen_id", canvas.get("screenId")),
                "ordinal": canvas.get("ordinal"),
                "renderer_id": canvas.get("renderer_id", canvas.get("rendererId")),
                "render_state": canvas.get("render_state", canvas.get("renderState")),
                "panel_id": canvas.get("panel_id", canvas.get("panelId")),
                "generation": canvas.get("generation"),
                "verified_visible": canvas.get(
                    "verified_visible", canvas.get("verifiedVisible", False)
                ),
                "stage_ms": {
                    "request_to_inline_ms": stage.get(
                        "request_to_inline_ms", stage.get("requestToInlineMs")
                    ),
                    "inline_to_chart_import_ms": stage.get(
                        "inline_to_chart_import_ms", stage.get("inlineToChartImportMs")
                    ),
                    "chart_import_to_dom_ms": stage.get(
                        "chart_import_to_dom_ms", stage.get("chartImportToDomMs")
                    ),
                    "inline_to_dom_ms": stage.get("inline_to_dom_ms", stage.get("inlineToDomMs")),
                    "dom_to_paint_ack_ms": stage.get(
                        "dom_to_paint_ack_ms", stage.get("domToPaintAckMs")
                    ),
                    "total_ms": stage.get("total_ms", stage.get("totalMs")),
                },
                "backend_timing": canvas.get("backend_timing", canvas.get("backendTiming")),
            }
        )

    raw_answer = trace.get("answer", {})
    observed_outcome = trace.get("observed_outcome", trace.get("observedOutcome"))
    recommendations = []
    for item in trace.get("recommendations", []):
        recommendations.append(
            {
                "question": item.get("question", item.get("query")),
                "deterministic_source": item.get(
                    "deterministic_source", item.get("deterministicSource")
                ),
                "action": item.get("action", item.get("targetIntent")),
                "executed_before_click": item.get(
                    "executed_before_click", item.get("executedBeforeClick", False)
                ),
            }
        )
    chart_panel_acks = []
    for ack in trace.get("chart_panel_acks", trace.get("chartPanelAcks", [])):
        chart_panel_acks.append(
            {
                "operation_ref": ack.get("operation_ref", ack.get("operationRef")),
                "ordinal": ack.get("ordinal"),
                "renderer_id": ack.get("renderer_id", ack.get("rendererId")),
                "render_state": ack.get("render_state", ack.get("renderState")),
                "panel_id": ack.get("panel_id", ack.get("panelId")),
                "generation": ack.get("generation"),
                "verified_visible": ack.get(
                    "verified_visible", ack.get("verifiedVisible", False)
                ),
                "total_ms": ack.get("total_ms", ack.get("totalMs")),
                "kind": ack.get("kind"),
                "reload_group": ack.get("reload_group", ack.get("reloadGroup")),
                "series_scope": ack.get("series_scope", ack.get("seriesScope")),
            }
        )
    return {
        "case_id": trace.get("case_id", trace.get("datasetId")),
        "observed_outcome": observed_outcome,
        "canvases": normalized_canvases,
        "rendered_count": trace.get(
            "data_canvas_count",
            trace.get("dataCanvasCount", trace.get("rendered_count", trace.get("renderedCount"))),
        ),
        "physical_calls": trace.get("physical_calls", trace.get("physicalCalls")),
        "answer": {
            "delivery": raw_answer.get("delivery"),
            "blocked_canvas": raw_answer.get("blocked_canvas", raw_answer.get("blockedCanvas")),
            "text": raw_answer.get("text", trace.get("answerText")),
            "reported_outcome": raw_answer.get(
                "reported_outcome", raw_answer.get("reportedOutcome", observed_outcome)
            ),
            "model_calls": raw_answer.get("model_calls", raw_answer.get("modelCalls")),
            "full_payload_exposed": raw_answer.get(
                "full_payload_exposed", raw_answer.get("fullPayloadExposed")
            ),
            "cache_receipt_integrity": raw_answer.get(
                "cache_receipt_integrity", raw_answer.get("cacheReceiptIntegrity")
            ),
        },
        "forbidden_calls": trace.get("forbidden_calls", trace.get("forbiddenCalls", {})),
        "late_canvases": trace.get("late_canvases", trace.get("lateCanvases", 0)),
        "leak_canaries": trace.get("leak_canaries", trace.get("leakCanaries", [])),
        "recommendations": recommendations,
        "recommendation_model_calls": trace.get(
            "recommendation_model_calls", trace.get("recommendationModelCalls")
        ),
        "recommendation_inputs": trace.get(
            "recommendation_inputs", trace.get("recommendationInputs", [])
        ),
        "fail_closed": trace.get("fail_closed", trace.get("failClosed")),
        "feedback": trace.get("feedback", {}),
        "measurement": trace.get("measurement", {}),
        "pipeline_stages": trace.get("pipeline_stages", trace.get("pipelineStages", [])),
        "chart_panel_acks": chart_panel_acks,
        "renderer_errors": trace.get("renderer_errors", trace.get("rendererErrors", [])),
    }


def evaluate_case(case: dict[str, Any], trace: dict[str, Any]) -> dict[str, Any]:
    failures: list[str] = []
    measurement = trace.get("measurement", {})
    if measurement.get("pipeline") != "fastapi_inline_to_electron_visible_paint":
        failures.append("non_integration_measurement")
    if measurement.get("paint_ack") != "visible_nonzero_rect_double_raf":
        failures.append("unverified_paint_measurement")
    if measurement.get("case_retry_count", 0) != 0:
        failures.append("case_retry_detected")
    feedback = trace.get("feedback", {})
    feedback_ms = feedback.get("total_ms", feedback.get("totalMs"))
    if case["expected_outcome"] == "rejected_no_render":
        expected_feedback_kind = "receipt"
    elif case["expected_outcome"] in {
        "deadline_miss_no_render",
        "cancelled_no_render",
    }:
        expected_feedback_kind = "state_canvas"
    else:
        expected_feedback_kind = "data_canvas"
    if feedback.get("kind") != expected_feedback_kind:
        failures.append("wrong_first_visible_feedback_kind")
    if feedback.get("verified_visible", feedback.get("verifiedVisible")) is not True:
        failures.append("unverified_first_visible_feedback")
    if (
        not isinstance(feedback_ms, (int, float))
        or not math.isfinite(feedback_ms)
        or feedback_ms < 0
    ):
        failures.append("invalid_first_visible_feedback_latency")
        feedback_ms = None
    elif feedback_ms > case["first_canvas_deadline_ms"]:
        failures.append("first_visible_feedback_deadline_exceeded")
    canvases = trace.get("canvases")
    if not isinstance(canvases, list):
        canvases = []
        failures.append("canvases_not_list")
    ordinal_queues: dict[str, list[int]] = {}
    for index, operation in enumerate(case["operations"], 1):
        ordinal_queues.setdefault(operation["operation_ref"], []).append(index)
    expected = []
    for item in case["expected_canvases"]:
        ordinals = ordinal_queues.get(item["operation_ref"], [])
        expected.append(_expected_projection(item, ordinals.pop(0) if ordinals else None))
    observed = [_canvas_projection(item) for item in canvases]

    if trace.get("observed_outcome") != case["expected_outcome"]:
        failures.append("wrong_outcome")
    if observed != expected:
        failures.append("wrong_canvas_sequence")
    if len(canvases) > 6 or trace.get("rendered_count") != len(canvases):
        failures.append("invalid_canvas_count")
    if any(not canvas.get("verified_visible", False) for canvas in canvases):
        failures.append("unverified_visible_canvas")
    for canvas in canvases:
        stage = canvas.get("stage_ms", {})
        stage_values = [
            stage.get("request_to_inline_ms"),
            stage.get("inline_to_dom_ms"),
            stage.get("dom_to_paint_ack_ms"),
            stage.get("total_ms"),
        ]
        if any(
            not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0
            for value in stage_values
        ):
            failures.append("invalid_stage_timing")
        elif sum(stage_values[:3]) > stage_values[3] + 2:
            failures.append("inconsistent_stage_timing")
        backend_timing = canvas.get("backend_timing")
        if not isinstance(backend_timing, dict) or any(
            not isinstance(backend_timing.get(key), (int, float))
            for key in ("server_ms", "call_ms", "transform_ms", "delivery_ms")
        ):
            failures.append("missing_backend_timing")
        if canvas.get("canvas_type") == "chart":
            chart_import_values = [
                stage.get("inline_to_chart_import_ms"),
                stage.get("chart_import_to_dom_ms"),
            ]
            if any(
                not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
                for value in chart_import_values
            ):
                failures.append("invalid_aits_chart_import_timing")
            if canvas.get("renderer_id") != AITS_CHART_RENDERER_ID:
                failures.append("wrong_aits_chart_renderer")
            if canvas.get("render_state") != "data":
                failures.append("wrong_aits_chart_render_state")
            if not isinstance(canvas.get("panel_id"), str) or not canvas["panel_id"].strip():
                failures.append("missing_aits_chart_panel_id")
            generation = canvas.get("generation")
            if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
                failures.append("invalid_aits_chart_generation")

    expected_chart_acks = [
        {
            "operation_ref": projection["operation_ref"],
            "ordinal": projection["ordinal"],
            "kind": "initial",
        }
        for projection in expected
        if projection["canvas_type"] == "chart"
    ]
    reload_expectation = case.get("aits_reload")
    if reload_expectation:
        expected_chart_acks.append(
            {
                "operation_ref": reload_expectation["operation_ref"],
                "ordinal": expected[reload_expectation["panel_order"] - 1]["ordinal"],
                "kind": "reload",
            }
        )
    chart_panel_acks = trace.get("chart_panel_acks", [])
    if not isinstance(chart_panel_acks, list):
        chart_panel_acks = []
        failures.append("aits_chart_panel_acks_not_list")
    if [
        {key: ack.get(key) for key in ("operation_ref", "ordinal", "kind")}
        for ack in chart_panel_acks
    ] != expected_chart_acks:
        failures.append("wrong_aits_chart_panel_ack_sequence")
    initial_panel_ids: list[str] = []
    initial_by_ordinal: dict[int, dict[str, Any]] = {}
    for ack in chart_panel_acks:
        operation_ref = ack.get("operation_ref")
        contract = _aits_contracts_by_operation_ref().get(operation_ref)
        if contract is None:
            failures.append("non_authoritative_aits_chart_panel_ack")
            continue
        if ack.get("renderer_id") != AITS_CHART_RENDERER_ID:
            failures.append("wrong_aits_chart_panel_ack_renderer")
        if ack.get("render_state") != "data":
            failures.append("wrong_aits_chart_panel_ack_state")
        panel_id = ack.get("panel_id")
        if not isinstance(panel_id, str) or not panel_id.strip():
            failures.append("missing_aits_chart_panel_ack_id")
        generation = ack.get("generation")
        if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
            failures.append("invalid_aits_chart_panel_ack_generation")
        if ack.get("reload_group") != contract.get("reload_group"):
            failures.append("wrong_aits_chart_reload_group")
        if ack.get("series_scope") != contract.get("series_scope"):
            failures.append("wrong_aits_chart_series_scope")
        if ack.get("verified_visible") is not True:
            failures.append("unverified_aits_chart_panel_ack")
        total_ms = ack.get("total_ms")
        if (
            not isinstance(total_ms, (int, float))
            or not math.isfinite(total_ms)
            or total_ms < 0
        ):
            failures.append("invalid_aits_chart_panel_ack_latency")
        elif total_ms > SLA_MAX_MS:
            failures.append("aits_chart_panel_ack_deadline_exceeded")
        if ack.get("kind") == "initial":
            initial_panel_ids.append(panel_id)
            if isinstance(ack.get("ordinal"), int):
                initial_by_ordinal[ack["ordinal"]] = ack
    if len(initial_panel_ids) != len(set(initial_panel_ids)):
        failures.append("duplicate_aits_chart_panel_id")
    if reload_expectation and chart_panel_acks:
        source = initial_by_ordinal.get(reload_expectation["panel_order"])
        reload_ack = chart_panel_acks[-1]
        if source is None or reload_ack.get("panel_id") != source.get("panel_id"):
            failures.append("aits_reload_did_not_reuse_panel")
        if reload_ack.get("generation") != reload_expectation["expected_generation"]:
            failures.append("wrong_aits_reload_generation")
    if trace.get("late_canvases", 0) != 0:
        failures.append("late_canvas_after_terminal_state")

    answer = trace.get("answer", {})
    if answer.get("delivery") != "separate" or answer.get("blocked_canvas") is not False:
        failures.append("answer_lane_not_independent")
    if not isinstance(answer.get("text"), str) or not answer["text"].strip():
        failures.append("missing_display_receipt")
    if answer.get("reported_outcome") != case["expected_outcome"]:
        failures.append("untruthful_display_receipt")
    if answer.get("model_calls") != 0:
        failures.append("extra_answer_model_call")
    if answer.get("full_payload_exposed") is not False:
        failures.append("payload_not_renderer_only")
    if answer.get("cache_receipt_integrity") is not True:
        failures.append("cache_receipt_integrity_missing")

    receipt_text = answer.get("text", "")
    leak_canaries = trace.get("leak_canaries", [])
    if not isinstance(leak_canaries, list):
        failures.append("invalid_leak_canaries")
        leak_canaries = []
    if any(str(canary) and str(canary) in receipt_text for canary in leak_canaries):
        failures.append("payload_token_in_receipt")

    recommendations = trace.get("recommendations", [])
    if not isinstance(recommendations, list) or len(recommendations) > 3:
        failures.append("invalid_recommendation_count")
        recommendations = []
    questions = [item.get("question") for item in recommendations]
    if len(questions) != len(set(questions)) or any(
        not isinstance(question, str) or not question.strip() for question in questions
    ):
        failures.append("invalid_recommendation_questions")
    for recommendation in recommendations:
        if recommendation.get("deterministic_source") != "predeclared_metadata":
            failures.append("recommendation_not_deterministic_metadata")
        if recommendation.get("action") != "query":
            failures.append("recommendation_not_query_only")
        if recommendation.get("executed_before_click") is not False:
            failures.append("recommendation_preclick_execution")
    if trace.get("recommendation_model_calls") != 0:
        failures.append("recommendation_model_call")
    recommendation_inputs = trace.get("recommendation_inputs", [])
    if not isinstance(recommendation_inputs, list) or not set(recommendation_inputs).issubset(
        ALLOWED_RECOMMENDATION_INPUTS
    ):
        failures.append("recommendation_used_payload_or_secret")
    combined_questions = "\n".join(str(question) for question in questions)
    if any(str(canary) and str(canary) in combined_questions for canary in leak_canaries):
        failures.append("payload_token_in_recommendation")

    forbidden = trace.get("forbidden_calls", {})
    for key in FORBIDDEN_CALL_KEYS:
        if forbidden.get(key) != 0:
            failures.append(f"forbidden_{key}_call")

    expected_physical = case["upstream_profile"].get("expected_physical_calls")
    if trace.get("physical_calls") != expected_physical:
        failures.append("wrong_physical_call_count")

    requires_render = case["expected_outcome"] not in NO_RENDER_OUTCOMES
    first_ms: float | None = None
    if requires_render:
        if not canvases:
            failures.append("missing_expected_render")
        else:
            value = canvases[0].get("stage_ms", {}).get("total_ms")
            if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
                first_ms = float(value)
            else:
                failures.append("invalid_first_canvas_latency")
        if first_ms is not None and first_ms > case["first_canvas_deadline_ms"]:
            failures.append("first_canvas_deadline_exceeded")
    elif canvases:
        failures.append("unexpected_render")
    if case["expected_outcome"] == "rejected_no_render" and trace.get("fail_closed") is not True:
        failures.append("rejection_not_fail_closed")

    return {
        "case_id": case["id"],
        "category": case["category"],
        "expected_outcome": case["expected_outcome"],
        "observed_outcome": trace.get("observed_outcome"),
        "functional_pass": not failures,
        "failures": failures,
        "sla_applicable": requires_render,
        "first_verified_canvas_ms": first_ms,
        "stage_timings": [canvas.get("stage_ms", {}) for canvas in canvases],
        "backend_timings": [canvas.get("backend_timing", {}) for canvas in canvases],
        "rendered_count": len(canvases),
        "physical_calls": trace.get("physical_calls"),
        "first_visible_feedback_ms": feedback_ms,
        "first_visible_feedback_kind": feedback.get("kind"),
        "pipeline_stages": trace.get("pipeline_stages", []),
        "aits_chart_panel_acks": chart_panel_acks,
        "renderer_errors": trace.get("renderer_errors", []),
    }


def evaluate(cases: list[dict[str, Any]], traces: list[dict[str, Any]]) -> dict[str, Any]:
    validate_corpus(cases)
    validate_corpus_against_manifest(cases, json.loads(MANIFEST_PATH.read_text(encoding="utf-8")))
    validate_traces(cases, traces)
    normalized_traces = [
        normalize_trace(case, trace) for case, trace in zip(cases, traces, strict=True)
    ]
    per_case = [
        evaluate_case(case, trace) for case, trace in zip(cases, normalized_traces, strict=True)
    ]
    functional_passes = sum(item["functional_pass"] for item in per_case)
    chart_panel_acks = [
        ack for trace in normalized_traces for ack in trace.get("chart_panel_acks", [])
    ]
    expected_chart_panel_count = sum(
        sum(canvas.get("canvas_type") == "chart" for canvas in case["expected_canvases"])
        + bool(case.get("aits_reload"))
        for case in cases
    )
    chart_ack_latencies = [
        float(ack["total_ms"])
        for ack in chart_panel_acks
        if isinstance(ack.get("total_ms"), (int, float))
        and math.isfinite(ack["total_ms"])
        and ack["total_ms"] >= 0
    ]
    authoritative_aits_operations = set(_aits_contracts_by_operation_ref())
    corpus_aits_operations = {
        operation["operation_ref"]
        for case in cases
        for operation in case["operations"]
        if operation["operation_ref"] in authoritative_aits_operations
    }
    observed_aits_operations = {
        ack.get("operation_ref")
        for ack in chart_panel_acks
        if ack.get("operation_ref") in authoritative_aits_operations
    }
    retry_count = sum(
        int(trace.get("measurement", {}).get("case_retry_count", 0) or 0)
        for trace in normalized_traces
    )
    late_canvas_count = sum(int(trace.get("late_canvases", 0) or 0) for trace in normalized_traces)
    aits_chart_panels_pass = (
        corpus_aits_operations == authoritative_aits_operations
        and observed_aits_operations == authoritative_aits_operations
        and len(chart_panel_acks) == expected_chart_panel_count
        and len(chart_ack_latencies) == expected_chart_panel_count
        and all(latency <= SLA_MAX_MS for latency in chart_ack_latencies)
        and retry_count == 0
        and late_canvas_count == 0
        and all(
            ack.get("renderer_id") == AITS_CHART_RENDERER_ID
            and ack.get("render_state") == "data"
            and isinstance(ack.get("panel_id"), str)
            and bool(ack["panel_id"].strip())
            and isinstance(ack.get("generation"), int)
            and not isinstance(ack.get("generation"), bool)
            and ack["generation"] > 0
            and ack.get("verified_visible") is True
            for ack in chart_panel_acks
        )
    )
    feedback_latencies = [
        item["first_visible_feedback_ms"]
        for item in per_case
        if item["first_visible_feedback_ms"] is not None
    ]
    applicable = [item for item in per_case if item["sla_applicable"]]
    latencies = [
        item["first_verified_canvas_ms"]
        for item in applicable
        if item["first_verified_canvas_ms"] is not None
    ]
    p50 = _percentile(latencies, 0.50)
    p95 = _percentile(latencies, 0.95)
    maximum = round(max(latencies), 3) if latencies else None
    missing_latency_count = len(applicable) - len(latencies)
    latency_pass = (
        missing_latency_count == 0
        and p50 is not None
        and p95 is not None
        and maximum is not None
        and p50 <= SLA_P50_MS
        and p95 <= SLA_P95_MS
        and maximum <= SLA_MAX_MS
    )
    functional_pass = functional_passes == EXPECTED_CASE_COUNT
    return {
        "status": "pass" if functional_pass and latency_pass and aits_chart_panels_pass else "fail",
        "gates": {
            "functional": {
                "passed": functional_pass,
                "pass_count": functional_passes,
                "total": EXPECTED_CASE_COUNT,
                "required": EXPECTED_CASE_COUNT,
            },
            "first_visible_feedback": {
                "passed": len(feedback_latencies) == EXPECTED_CASE_COUNT
                and max(feedback_latencies) <= SLA_MAX_MS,
                "denominator": EXPECTED_CASE_COUNT,
                "measured_count": len(feedback_latencies),
                "p50_ms": _percentile(feedback_latencies, 0.50),
                "p95_ms": _percentile(feedback_latencies, 0.95),
                "max_ms": round(max(feedback_latencies), 3) if feedback_latencies else None,
                "threshold_max_ms": SLA_MAX_MS,
            },
            "first_verified_data_canvas": {
                "passed": latency_pass,
                "denominator": len(applicable),
                "measured_count": len(latencies),
                "missing_count": missing_latency_count,
                "p50_ms": p50,
                "p95_ms": p95,
                "max_ms": maximum,
                "thresholds_ms": {
                    "p50": SLA_P50_MS,
                    "p95": SLA_P95_MS,
                    "max": SLA_MAX_MS,
                },
                "no_render_cases_excluded_from_latency_only": len(cases) - len(applicable),
            },
            "aits_chart_panels": {
                "passed": aits_chart_panels_pass,
                "renderer_id": AITS_CHART_RENDERER_ID,
                "authoritative_operation_count": len(authoritative_aits_operations),
                "corpus_operation_coverage_count": len(corpus_aits_operations),
                "observed_operation_coverage_count": len(observed_aits_operations),
                "missing_corpus_operations": sorted(
                    authoritative_aits_operations - corpus_aits_operations
                ),
                "missing_observed_operations": sorted(
                    authoritative_aits_operations - observed_aits_operations
                ),
                "requested_panel_count": expected_chart_panel_count,
                "measured_ack_count": len(chart_ack_latencies),
                "missing_ack_count": expected_chart_panel_count - len(chart_panel_acks),
                "p50_ms": _percentile(chart_ack_latencies, 0.50),
                "p95_ms": _percentile(chart_ack_latencies, 0.95),
                "max_ms": (
                    round(max(chart_ack_latencies), 3) if chart_ack_latencies else None
                ),
                "threshold_max_ms": SLA_MAX_MS,
                "retry_count": retry_count,
                "late_canvas_count": late_canvas_count,
            },
        },
        "cases": per_case,
    }


def build_report(
    *,
    cases: list[dict[str, Any]],
    traces: list[dict[str, Any]],
    corpus_path: Path,
    trace_path: Path,
    command: list[str],
) -> dict[str, Any]:
    report = evaluate(cases, traces)
    source_hashes = {
        str(path.relative_to(ROOT)).replace("\\", "/"): sha256_file(path)
        for path in SOURCE_PATHS
        if path.is_file()
    }
    report.update(
        {
            "schema_version": 2,
            "generated_at": datetime.now(UTC).isoformat(),
            "corpus": {
                "path": str(corpus_path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(corpus_path),
                "count": len(cases),
            },
            "trace": {
                "path": str(trace_path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(trace_path),
                "count": len(traces),
            },
            "manifest": {
                "path": str(MANIFEST_PATH.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(MANIFEST_PATH),
            },
            "catalog": {
                "path": str(CATALOG_PATH.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(CATALOG_PATH),
            },
            "source_hashes": source_hashes,
            "execution": {
                "command": command,
                "producer_command": [
                    "node",
                    str(ELECTRON_CLI),
                    str(DEFAULT_APP_RUNNER),
                    "--corpus",
                    str(corpus_path),
                    "--output",
                    str(trace_path),
                ],
                "cwd": str(ROOT),
                "python": sys.version.split()[0],
                "platform": platform.platform(),
                "processor_count": os.cpu_count(),
                "whole_corpus_single_pass": True,
                "case_retries": 0,
            },
        }
    )
    return report


def _run_app_runner(*, corpus_path: Path, trace_path: Path, runner_path: Path) -> int:
    command = [
        "node",
        str(ELECTRON_CLI),
        str(runner_path),
        "--corpus",
        str(corpus_path),
        "--output",
        str(trace_path),
    ]
    completed = subprocess.run(command, cwd=ROOT / "app", check=False)
    return completed.returncode


def _fresh_report_matches(report: dict[str, Any], *, corpus_path: Path, trace_path: Path) -> bool:
    return (
        report.get("status") == "pass"
        and report.get("corpus", {}).get("sha256") == sha256_file(corpus_path)
        and report.get("trace", {}).get("sha256") == sha256_file(trace_path)
        and report.get("manifest", {}).get("sha256") == sha256_file(MANIFEST_PATH)
        and report.get("catalog", {}).get("sha256") == sha256_file(CATALOG_PATH)
        and report.get("source_hashes")
        == {
            str(path.relative_to(ROOT)).replace("\\", "/"): sha256_file(path)
            for path in SOURCE_PATHS
            if path.is_file()
        }
    )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--trace", type=Path, default=DEFAULT_TRACE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--app-runner", type=Path, default=DEFAULT_APP_RUNNER)
    parser.add_argument(
        "--run", action="store_true", help="run Electron integration producer first"
    )
    parser.add_argument(
        "--check", action="store_true", help="exit nonzero if report is stale or any gate is red"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        cases = load_jsonl(args.corpus)
        validate_corpus(cases)
        if args.check:
            if not args.trace.is_file() or not args.report.is_file():
                print("FAIL: trace or report artifact is missing")
                return 1
            existing = json.loads(args.report.read_text(encoding="utf-8"))
            traces = load_jsonl(args.trace)
            current_evaluation = evaluate(cases, traces)
            if (
                not _fresh_report_matches(existing, corpus_path=args.corpus, trace_path=args.trace)
                or existing.get("gates") != current_evaluation["gates"]
                or existing.get("cases") != current_evaluation["cases"]
            ):
                print("FAIL: report is stale or red")
                return 1
            print("PASS: exact-100 report is current and all gates are green")
            return 0

        if args.run:
            if not args.app_runner.is_file():
                print(f"FAIL: app integration runner missing: {args.app_runner}")
                return 1
            if (
                _run_app_runner(
                    corpus_path=args.corpus, trace_path=args.trace, runner_path=args.app_runner
                )
                != 0
            ):
                print("FAIL: app integration runner returned nonzero")
                return 1
        if not args.trace.is_file():
            print(f"FAIL: trace artifact missing: {args.trace}")
            return 1

        traces = load_jsonl(args.trace)
        command = [sys.executable, str(Path(__file__)), *sys.argv[1:]]
        report = build_report(
            cases=cases,
            traces=traces,
            corpus_path=args.corpus,
            trace_path=args.trace,
            command=command,
        )
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            canonical_json(
                {
                    "status": report["status"],
                    "functional": report["gates"]["functional"],
                    "latency": report["gates"]["first_verified_data_canvas"],
                    "report": str(args.report),
                }
            )
        )
        return 0 if report["status"] == "pass" else 1
    except (GateInputError, FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
