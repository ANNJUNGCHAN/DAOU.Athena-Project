from __future__ import annotations

import importlib
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
ROOT = BACKEND.parent
SCRIPTS = BACKEND / "scripts"
sys.path.insert(0, str(SCRIPTS))

benchmark = importlib.import_module("evaluate_kiwoom_rest_canvas_100")
AITS_CONTRACTS_PATH = BACKEND / "ref" / "aits-chart-contracts.json"


def authoritative_aits_operations() -> set[str]:
    contracts = json.loads(AITS_CONTRACTS_PATH.read_text(encoding="utf-8"))["contracts"]
    return {f"base:{item['tr_id']}" for item in contracts}


def aits_contract(operation_ref: str) -> dict:
    contracts = json.loads(AITS_CONTRACTS_PATH.read_text(encoding="utf-8"))["contracts"]
    return next(item for item in contracts if f"base:{item['tr_id']}" == operation_ref)


def freshness_report_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    corpus = tmp_path / "corpus.jsonl"
    trace = tmp_path / "trace.jsonl"
    manifest = tmp_path / "manifest.json"
    catalog = tmp_path / "catalog.json"
    backend_transform = tmp_path / "backend" / "athena_api" / "canvas_transform.py"
    app_renderer = tmp_path / "app" / "lib" / "chart-card.js"
    for path, content in (
        (corpus, "corpus-v1\n"),
        (trace, "trace-v1\n"),
        (manifest, "{}\n"),
        (catalog, "{}\n"),
        (backend_transform, "transform-v1\n"),
        (app_renderer, "renderer-v1\n"),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    monkeypatch.setattr(benchmark, "ROOT", tmp_path)
    monkeypatch.setattr(benchmark, "MANIFEST_PATH", manifest)
    monkeypatch.setattr(benchmark, "CATALOG_PATH", catalog)
    monkeypatch.setattr(benchmark, "SOURCE_PATHS", (backend_transform, app_renderer))
    report = {
        "status": "pass",
        "corpus": {"sha256": benchmark.sha256_file(corpus)},
        "trace": {"sha256": benchmark.sha256_file(trace)},
        "manifest": {"sha256": benchmark.sha256_file(manifest)},
        "catalog": {"sha256": benchmark.sha256_file(catalog)},
        "source_hashes": {
            str(path.relative_to(tmp_path)).replace("\\", "/"): benchmark.sha256_file(path)
            for path in (backend_transform, app_renderer)
        },
    }
    return report, corpus, trace, backend_transform, app_renderer


@pytest.fixture(scope="module")
def cases() -> list[dict]:
    return benchmark.load_jsonl(benchmark.DEFAULT_CORPUS)


def passing_trace(case: dict, *, latency_ms: float = 250.0) -> dict:
    ordinal_queues: dict[str, list[int]] = {}
    for index, operation in enumerate(case["operations"], 1):
        ordinal_queues.setdefault(operation["operation_ref"], []).append(index)
    canvases = []
    for item in case["expected_canvases"]:
        ordinal = ordinal_queues[item["operation_ref"]].pop(0)
        canvas = {
            "operation_ref": item["operation_ref"],
            "canvas_type": item["canvas_type"],
            "manifest_layout": item["manifest_layout"],
            "screen_id": benchmark._manifest_by_operation_ref()[item["operation_ref"]][
                "screen_reference"
            ]["screen_id"],
            "ordinal": ordinal,
            "verified_visible": True,
            "stage_ms": {
                "request_to_inline_ms": latency_ms * 0.6,
                "inline_to_dom_ms": latency_ms * 0.2,
                "dom_to_paint_ack_ms": latency_ms * 0.2,
                "total_ms": latency_ms,
            },
            "backend_timing": {
                "server_ms": latency_ms * 0.5,
                "call_ms": latency_ms * 0.4,
                "transform_ms": latency_ms * 0.05,
                "delivery_ms": latency_ms * 0.01,
            },
        }
        if item["canvas_type"] == "chart":
            canvas["stage_ms"].update(
                {
                    "inline_to_chart_import_ms": latency_ms * 0.1,
                    "chart_import_to_dom_ms": latency_ms * 0.1,
                }
            )
            canvas.update(
                {
                    "renderer_id": "aits-chart-v1",
                    "render_state": "data",
                    "panel_id": f"{case['id']}-panel-{ordinal}",
                    "generation": 1,
                }
            )
        canvases.append(canvas)
    chart_panel_acks = [
        {
            "operation_ref": canvas["operation_ref"],
            "ordinal": canvas["ordinal"],
            "renderer_id": canvas["renderer_id"],
            "render_state": canvas["render_state"],
            "panel_id": canvas["panel_id"],
            "generation": canvas["generation"],
            "verified_visible": canvas["verified_visible"],
            "total_ms": canvas["stage_ms"]["total_ms"],
            "kind": "initial",
            "reload_group": aits_contract(canvas["operation_ref"])["reload_group"],
            "series_scope": aits_contract(canvas["operation_ref"])["series_scope"],
        }
        for canvas in canvases
        if canvas["canvas_type"] == "chart"
    ]
    reload_expectation = case.get("aits_reload")
    if reload_expectation:
        source = chart_panel_acks[reload_expectation["panel_order"] - 1]
        chart_panel_acks.append(
            {
                **source,
                "operation_ref": reload_expectation["operation_ref"],
                "generation": reload_expectation["expected_generation"],
                "kind": "reload",
                "reload_group": aits_contract(reload_expectation["operation_ref"])[
                    "reload_group"
                ],
                "series_scope": aits_contract(reload_expectation["operation_ref"])[
                    "series_scope"
                ],
            }
        )
    return {
        "case_id": case["id"],
        "observed_outcome": case["expected_outcome"],
        "canvases": canvases,
        "rendered_count": len(canvases),
        "physical_calls": case["upstream_profile"]["expected_physical_calls"],
        "answer": {
            "delivery": "separate",
            "blocked_canvas": False,
            "text": "화면 표시가 완료되었습니다. 캔버스에서 확인하세요.",
            "reported_outcome": case["expected_outcome"],
            "model_calls": 0,
            "full_payload_exposed": False,
            "cache_receipt_integrity": True,
        },
        "forbidden_calls": {key: 0 for key in benchmark.FORBIDDEN_CALL_KEYS},
        "late_canvases": 0,
        "leak_canaries": ["CANARY_PRICE_71234", "CANARY_ROW_SECRET"],
        "recommendations": [],
        "recommendation_model_calls": 0,
        "recommendation_inputs": [],
        "fail_closed": case["expected_outcome"] == "rejected_no_render",
        "measurement": {
            "pipeline": "fastapi_inline_to_electron_visible_paint",
            "paint_ack": "visible_nonzero_rect_double_raf",
        },
        "feedback": {
            "kind": (
                "receipt"
                if case["expected_outcome"] == "rejected_no_render"
                else (
                    "state_canvas"
                    if case["expected_outcome"] in benchmark.NO_RENDER_OUTCOMES
                    else "data_canvas"
                )
            ),
            "verified_visible": True,
            "total_ms": latency_ms,
        },
        "chart_panel_acks": chart_panel_acks,
    }


def test_fixture_is_exactly_100_direct_rest_cases(cases: list[dict]) -> None:
    benchmark.validate_corpus(cases)
    benchmark.validate_corpus_against_manifest(
        cases, json.loads(benchmark.MANIFEST_PATH.read_text(encoding="utf-8"))
    )
    assert len(cases) == 100


def test_fixture_limits_every_case_to_six_canvases(cases: list[dict]) -> None:
    assert all(1 <= case["screens_count"] <= 6 for case in cases)
    assert max(case["screens_count"] for case in cases) == 6


def test_fixture_covers_all_19_authoritative_aits_operations(cases: list[dict]) -> None:
    covered = {
        operation["operation_ref"]
        for case in cases
        for operation in case["operations"]
        if operation["operation_ref"] in authoritative_aits_operations()
    }

    assert covered == authoritative_aits_operations()
    assert len(covered) == 19


def test_fixture_has_six_panel_aits_fanout_with_separate_gold_groups(
    cases: list[dict],
) -> None:
    contracts = json.loads(AITS_CONTRACTS_PATH.read_text(encoding="utf-8"))["contracts"]
    group_by_operation = {
        f"base:{item['tr_id']}": item["reload_group"] for item in contracts
    }
    fanouts = [
        case
        for case in cases
        if case["screens_count"] == 6
        and all(
            operation["operation_ref"] in authoritative_aits_operations()
            for operation in case["operations"]
        )
    ]

    assert fanouts
    groups = {
        group_by_operation[operation["operation_ref"]]
        for operation in fanouts[0]["operations"]
    }
    assert {"gold-generic", "gold-today"}.issubset(groups)


def test_fixture_has_six_same_operation_aits_panels(cases: list[dict]) -> None:
    assert any(
        case["screens_count"] == 6
        and len({item["operation_ref"] for item in case["operations"]}) == 1
        and case["operations"][0]["operation_ref"] in authoritative_aits_operations()
        for case in cases
    )


def test_fixture_declares_same_panel_reload_generation(cases: list[dict]) -> None:
    reload_cases = [case for case in cases if case.get("aits_reload")]

    assert reload_cases
    assert all(case["aits_reload"]["expected_generation"] == 2 for case in reload_cases)


def test_benchmark_producer_preserves_app_computed_render_deadline() -> None:
    producer = (ROOT / "app" / "scripts" / "benchmark-rest-canvas-100.js").read_text(
        encoding="utf-8"
    )

    assert "body.deadline_ms =" not in producer


def test_benchmark_producer_records_every_aits_panel_ack() -> None:
    producer = (ROOT / "app" / "scripts" / "benchmark-rest-canvas-100.js").read_text(
        encoding="utf-8"
    )

    assert "chartPanelAcks" in producer
    assert "rendererId: canvas.rendererId" in producer
    assert "renderState: canvas.renderState" in producer


def test_benchmark_producer_executes_declared_same_panel_reload() -> None:
    producer = (ROOT / "app" / "scripts" / "benchmark-rest-canvas-100.js").read_text(
        encoding="utf-8"
    )

    assert "executeAitsReload(shellWin, testCase, result)" in producer
    assert "athena:reload-chart-panel" in producer


def test_benchmark_producer_records_renderer_paint_errors() -> None:
    producer = (ROOT / "app" / "scripts" / "benchmark-rest-canvas-100.js").read_text(
        encoding="utf-8"
    )

    assert "channel !== 'athena:rest-canvas-painted'" in producer
    assert "rendererErrors: result.rendererErrors || []" in producer


def test_report_source_closure_includes_aits_runtime_and_authority_dependencies() -> None:
    source_paths = {
        str(path.relative_to(ROOT)).replace("\\", "/") for path in benchmark.SOURCE_PATHS
    }
    required = {
        "backend/athena_api/canvas_transform.py",
        "backend/athena_api/generated/registry.py",
        "backend/ref/kiwoom-screen-definitions.json",
        "backend/scripts/generate_api.py",
        "app/shell.html",
        "app/shell.css",
        "app/lib/chart-card.js",
        "app/lib/chart-toolbar.js",
        "app/package.json",
        "app/package-lock.json",
    }

    assert required <= source_paths


def test_check_freshness_rejects_mutated_backend_chart_transform(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    report, corpus, trace, backend_transform, _ = freshness_report_fixture(
        tmp_path, monkeypatch
    )
    assert benchmark._fresh_report_matches(report, corpus_path=corpus, trace_path=trace)

    backend_transform.write_text("transform-v2\n", encoding="utf-8")

    assert not benchmark._fresh_report_matches(report, corpus_path=corpus, trace_path=trace)


def test_check_freshness_rejects_mutated_app_chart_renderer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    report, corpus, trace, _, app_renderer = freshness_report_fixture(tmp_path, monkeypatch)
    assert benchmark._fresh_report_matches(report, corpus_path=corpus, trace_path=trace)

    app_renderer.write_text("renderer-v2\n", encoding="utf-8")

    assert not benchmark._fresh_report_matches(report, corpus_path=corpus, trace_path=trace)


def test_trace_rejects_missing_case_instead_of_shrinking_denominator(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases[:-1]]
    with pytest.raises(benchmark.GateInputError, match="exactly 100"):
        benchmark.validate_traces(cases, traces)


def test_trace_rejects_duplicate_case_as_retry(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[-1] = deepcopy(traces[0])
    with pytest.raises(benchmark.GateInputError, match="retries are forbidden"):
        benchmark.validate_traces(cases, traces)


def test_normalize_trace_accepts_production_app_camel_case(cases: list[dict]) -> None:
    case = cases[0]
    raw = {
        "datasetId": case["id"],
        "observedOutcome": case["expected_outcome"],
        "answerText": "캔버스에 표시했습니다.",
        "answer": {
            "delivery": "separate",
            "blockedCanvas": False,
            "modelCalls": 0,
            "fullPayloadExposed": False,
            "cacheReceiptIntegrity": True,
        },
        "canvases": [
            {
                "operationRef": case["expected_canvases"][0]["operation_ref"],
                "canvasType": case["expected_canvases"][0]["canvas_type"],
                "envelope": {"layout": case["expected_canvases"][0]["manifest_layout"]},
                "ordinal": 1,
                "verifiedVisible": True,
                "stageMs": {"totalMs": 250},
                "backendTiming": {
                    "server_ms": 100,
                    "call_ms": 80,
                    "transform_ms": 10,
                    "delivery_ms": 1,
                },
            }
        ],
    }

    normalized = benchmark.normalize_trace(case, raw)

    assert normalized["case_id"] == case["id"]
    assert normalized["canvases"][0]["stage_ms"]["total_ms"] == 250
    assert normalized["answer"]["text"] == "캔버스에 표시했습니다."


def test_normalize_trace_preserves_chart_import_stage_telemetry(cases: list[dict]) -> None:
    case = next(
        case
        for case in cases
        if case["expected_canvases"] and case["expected_canvases"][0]["canvas_type"] == "chart"
    )
    raw = passing_trace(case)
    raw["canvases"][0]["stageMs"] = {
        "requestToInlineMs": 100,
        "inlineToChartImportMs": 12.5,
        "chartImportToDomMs": 7.5,
        "inlineToDomMs": 20,
        "domToPaintAckMs": 30,
        "totalMs": 150,
    }
    raw["canvases"][0].pop("stage_ms")

    normalized = benchmark.normalize_trace(case, raw)

    assert normalized["canvases"][0]["stage_ms"]["inline_to_chart_import_ms"] == 12.5
    assert normalized["canvases"][0]["stage_ms"]["chart_import_to_dom_ms"] == 7.5


def test_canonical_case_report_preserves_chart_import_stage_telemetry(
    cases: list[dict],
) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(
        index
        for index, case in enumerate(cases)
        if case["expected_canvases"] and case["expected_canvases"][0]["canvas_type"] == "chart"
    )

    result = benchmark.evaluate(cases, traces)
    stage = result["cases"][target]["stage_timings"][0]

    assert stage["inline_to_chart_import_ms"] == 25.0
    assert stage["chart_import_to_dom_ms"] == 25.0


def test_canonical_case_report_preserves_renderer_error_diagnostics(
    cases: list[dict],
) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[0]["rendererErrors"] = [
        {
            "ordinal": 1,
            "operationRef": "base:ka10079",
            "renderState": "error",
            "error": "Value is not a valid time",
        }
    ]

    result = benchmark.evaluate(cases, traces)

    assert result["cases"][0]["renderer_errors"][0]["error"] == "Value is not a valid time"


def test_missing_expected_canvas_fails_functional_and_latency_gates(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(index for index, case in enumerate(cases) if case["expected_canvases"])
    traces[target]["canvases"] = []
    traces[target]["rendered_count"] = 0

    result = benchmark.evaluate(cases, traces)

    assert result["status"] == "fail"
    assert result["gates"]["functional"]["pass_count"] == 99
    assert result["gates"]["first_verified_data_canvas"]["missing_count"] == 1


def test_no_render_cases_count_functionally_but_not_in_latency_denominator(
    cases: list[dict],
) -> None:
    result = benchmark.evaluate(cases, [passing_trace(case) for case in cases])
    no_render = sum(case["expected_outcome"] in benchmark.NO_RENDER_OUTCOMES for case in cases)

    assert result["gates"]["functional"]["total"] == 100
    assert result["gates"]["first_verified_data_canvas"]["denominator"] == 100 - no_render
    assert (
        result["gates"]["first_verified_data_canvas"]["no_render_cases_excluded_from_latency_only"]
        == no_render
    )


def test_no_render_case_requires_visible_receipt_within_three_seconds(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(
        index
        for index, case in enumerate(cases)
        if case["expected_outcome"] in benchmark.NO_RENDER_OUTCOMES
    )
    traces[target]["feedback"]["verified_visible"] = False

    result = benchmark.evaluate(cases, traces)

    assert result["gates"]["functional"]["pass_count"] == 99
    assert "unverified_first_visible_feedback" in result["cases"][target]["failures"]


def test_forbidden_mcp_call_fails_case(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[0]["forbidden_calls"]["mcp"] = 1

    result = benchmark.evaluate(cases, traces)

    assert result["gates"]["functional"]["pass_count"] == 99
    assert "forbidden_mcp_call" in result["cases"][0]["failures"]


def test_payload_canary_in_answer_receipt_fails_case(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[0]["answer"]["text"] = "현재가는 CANARY_PRICE_71234 입니다."

    result = benchmark.evaluate(cases, traces)

    assert "payload_token_in_receipt" in result["cases"][0]["failures"]


def test_recommendation_preclick_execution_fails_case(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[0]["recommendations"] = [
        {
            "question": "최근 일봉도 볼까요?",
            "deterministic_source": "predeclared_metadata",
            "action": "query",
            "executed_before_click": True,
        }
    ]

    result = benchmark.evaluate(cases, traces)

    assert "recommendation_preclick_execution" in result["cases"][0]["failures"]


def test_first_canvas_above_three_seconds_fails_release(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    render_index = next(index for index, case in enumerate(cases) if case["expected_canvases"])
    traces[render_index]["canvases"][0]["stage_ms"]["total_ms"] = 3000.001

    result = benchmark.evaluate(cases, traces)

    assert result["status"] == "fail"
    assert "first_canvas_deadline_exceeded" in result["cases"][render_index]["failures"]


def test_chart_panel_without_aits_renderer_fails_case(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(
        index
        for index, case in enumerate(cases)
        if case["expected_canvases"][0]["canvas_type"] == "chart"
    )
    traces[target]["canvases"][0]["renderer_id"] = "legacy-chart"

    result = benchmark.evaluate(cases, traces)

    assert "wrong_aits_chart_renderer" in result["cases"][target]["failures"]


def test_chart_panel_requires_inline_to_import_timing(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(
        index
        for index, case in enumerate(cases)
        if case["expected_canvases"] and case["expected_canvases"][0]["canvas_type"] == "chart"
    )
    traces[target]["canvases"][0]["stage_ms"]["inline_to_chart_import_ms"] = None

    result = benchmark.evaluate(cases, traces)

    assert "invalid_aits_chart_import_timing" in result["cases"][target]["failures"]


def test_chart_panel_requires_finite_import_to_dom_timing(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(
        index
        for index, case in enumerate(cases)
        if case["expected_canvases"] and case["expected_canvases"][0]["canvas_type"] == "chart"
    )
    traces[target]["canvases"][0]["stage_ms"]["chart_import_to_dom_ms"] = float("nan")

    result = benchmark.evaluate(cases, traces)

    assert "invalid_aits_chart_import_timing" in result["cases"][target]["failures"]


def test_chart_panel_ack_above_three_seconds_fails_aits_gate(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(index for index, trace in enumerate(traces) if trace["chart_panel_acks"])
    traces[target]["chart_panel_acks"][0]["total_ms"] = 3000.001

    result = benchmark.evaluate(cases, traces)

    assert result["gates"]["aits_chart_panels"]["passed"] is False
    assert "aits_chart_panel_ack_deadline_exceeded" in result["cases"][target]["failures"]


def test_chart_panel_ack_requires_nonempty_panel_id(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(index for index, trace in enumerate(traces) if trace["chart_panel_acks"])
    traces[target]["chart_panel_acks"][0]["panel_id"] = ""

    result = benchmark.evaluate(cases, traces)

    assert "missing_aits_chart_panel_ack_id" in result["cases"][target]["failures"]


def test_chart_panel_ack_requires_positive_generation(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(index for index, trace in enumerate(traces) if trace["chart_panel_acks"])
    traces[target]["chart_panel_acks"][0]["generation"] = 0

    result = benchmark.evaluate(cases, traces)

    assert "invalid_aits_chart_panel_ack_generation" in result["cases"][target]["failures"]


def test_aits_gate_requires_all_19_observed_operations(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(
        index
        for index, trace in enumerate(traces)
        if any(ack["operation_ref"] == "base:ka50092" for ack in trace["chart_panel_acks"])
    )
    traces[target]["chart_panel_acks"][0]["operation_ref"] = "base:ka50091"

    result = benchmark.evaluate(cases, traces)

    assert result["gates"]["aits_chart_panels"]["observed_operation_coverage_count"] == 18
    assert result["gates"]["aits_chart_panels"]["passed"] is False


def test_aits_gate_rejects_case_retry(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[0]["measurement"]["case_retry_count"] = 1

    result = benchmark.evaluate(cases, traces)

    assert result["gates"]["aits_chart_panels"]["retry_count"] == 1
    assert result["gates"]["aits_chart_panels"]["passed"] is False


def test_aits_gate_rejects_late_canvas(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    traces[0]["late_canvases"] = 1

    result = benchmark.evaluate(cases, traces)

    assert result["gates"]["aits_chart_panels"]["late_canvas_count"] == 1
    assert result["gates"]["aits_chart_panels"]["passed"] is False


def test_same_panel_reload_must_advance_declared_generation(cases: list[dict]) -> None:
    traces = [passing_trace(case) for case in cases]
    target = next(index for index, case in enumerate(cases) if case.get("aits_reload"))
    traces[target]["chart_panel_acks"][-1]["generation"] = 3

    result = benchmark.evaluate(cases, traces)

    assert "wrong_aits_reload_generation" in result["cases"][target]["failures"]


def test_all_100_green_meets_functional_and_latency_gates(cases: list[dict]) -> None:
    traces = [passing_trace(case, latency_ms=300 + index) for index, case in enumerate(cases)]

    result = benchmark.evaluate(cases, traces)

    assert result["status"] == "pass"
    assert result["gates"]["functional"]["pass_count"] == 100
    assert result["gates"]["first_verified_data_canvas"]["max_ms"] < 1000


def test_check_mode_exits_nonzero_when_report_is_red(tmp_path: Path, cases: list[dict]) -> None:
    corpus_path = tmp_path / "corpus.jsonl"
    trace_path = tmp_path / "trace.jsonl"
    report_path = tmp_path / "report.json"
    corpus_path.write_text(
        "\n".join(json.dumps(case, ensure_ascii=False) for case in cases) + "\n",
        encoding="utf-8",
    )
    trace_path.write_text(
        "\n".join(json.dumps(passing_trace(case), ensure_ascii=False) for case in cases) + "\n",
        encoding="utf-8",
    )
    report_path.write_text(json.dumps({"status": "fail"}), encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "evaluate_kiwoom_rest_canvas_100.py"),
            "--corpus",
            str(corpus_path),
            "--trace",
            str(trace_path),
            "--report",
            str(report_path),
            "--check",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 1
    assert "stale or red" in completed.stdout
