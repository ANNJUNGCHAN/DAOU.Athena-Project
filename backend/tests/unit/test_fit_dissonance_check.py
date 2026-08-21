from __future__ import annotations

import importlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
SCRIPTS = BACKEND / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(BACKEND))

fit_dissonance_check = importlib.import_module("fit_dissonance_check")
capture_screen_render_evidence = importlib.import_module("capture_screen_render_evidence")


@pytest.fixture(scope="module")
def manifest() -> dict:
    return fit_dissonance_check.load_json(fit_dissonance_check.MANIFEST_PATH)


@pytest.fixture(scope="module")
def inventory_index() -> dict:
    return fit_dissonance_check.build_inventory_index(
        fit_dissonance_check.load_json(fit_dissonance_check.INVENTORY_PATH)
    )


@pytest.fixture(scope="module")
def projection_index() -> dict:
    return fit_dissonance_check.build_projection_index(
        fit_dissonance_check.load_json(fit_dissonance_check.PROJECTIONS_PATH)
    )


@pytest.fixture(scope="module")
def mappings_by_id(manifest: dict) -> dict:
    return {m["mapping_id"]: m for m in manifest["mappings"]}


def test_manifest_counts_match_plan_invariant(manifest: dict) -> None:
    mappings = manifest["mappings"]
    assert len(mappings) == 301
    categories = [m["classification"]["category"] for m in mappings]
    assert categories.count("read_display") == 264
    assert categories.count("websocket") == 23
    assert categories.count("order") == 12
    assert categories.count("oauth") == 2


def test_ka10007_zero_tolerance_currently_clean(
    manifest: dict, inventory_index: dict, projection_index: dict
) -> None:
    """plan §5.3.4 근거 표: ka10007 legacy 9그룹은 title_ko가 실제로 존재하므로
    LABEL_MISSING/TR_ID_LEAKAGE(zero-tolerance)가 현재 0건이어야 한다."""
    ka10007_groups = [
        m for m in manifest["mappings"] if m["operation"]["tr_id"] == "ka10007"
    ]
    assert len(ka10007_groups) == 9
    for mapping in ka10007_groups:
        result = fit_dissonance_check.evaluate_mapping(mapping, inventory_index, projection_index)
        zero_tolerance_hits = [
            code
            for code in result["failure_codes"]
            if code in ("LABEL_MISSING", "TR_ID_LEAKAGE")
        ]
        assert zero_tolerance_hits == [], (mapping["mapping_id"], result["diagnostics"]["title"])


def test_overflow_width_catches_ka10095(
    mappings_by_id: dict, inventory_index: dict, projection_index: dict
) -> None:
    mapping = mappings_by_id["base:ka10095"]
    result = fit_dissonance_check.evaluate_mapping(mapping, inventory_index, projection_index)
    assert "OVERFLOW_WIDTH" in result["failure_codes"]
    assert result["diagnostics"]["max_table_column_count"] > fit_dissonance_check.WIDTH_FAIL


def test_ka10173_is_deferred_and_not_a_structural_mismatch(
    manifest: dict, inventory_index: dict, projection_index: dict
) -> None:
    """ws-ladder-regex-calibration.json의 counterexample_ka10173: 5개 leaf 필드 전부
    숫자 접미사 없음 -> 사다리 가족 0건이어야 한다(반례 요건)."""
    mappings = manifest["mappings"]
    mappings_by_tr: dict[str, list] = {}
    for m in mappings:
        mappings_by_tr.setdefault(m["operation"]["tr_id"], []).append(m)
    results_by_id = {}
    for m in mappings:
        if m["classification"]["category"] == "order":
            continue
        results_by_id[m["mapping_id"]] = fit_dissonance_check.evaluate_mapping(
            m, inventory_index, projection_index
        )
    fit_dissonance_check.apply_rest_structural_mismatch(
        results_by_id, mappings_by_tr, inventory_index
    )
    result = results_by_id["base:ka10173"]
    assert "STRUCTURAL_MISMATCH" not in result["failure_codes"]


def test_ws_ladder_matches_calibration_file(inventory_index: dict) -> None:
    """0D/0F는 사다리 가족 있음, 0B는 없음 — backend/ref/ws-ladder-regex-calibration.json 그대로."""
    calibration = fit_dissonance_check.load_json(fit_dissonance_check.WS_LADDER_CALIBRATION_PATH)
    for tr_id, expected in calibration["matches"].items():
        tr_entry = inventory_index[tr_id]
        labels = fit_dissonance_check.resp_alias_labels(tr_entry)
        pairs = [(alias, label) for alias, label in labels.items()]
        families, matched = fit_dissonance_check.ladder_families(pairs)
        assert bool(families) == bool(expected["families_found"]), tr_id


def test_rest_structural_mismatch_flags_ka10007_sibling_groups(
    manifest: dict, inventory_index: dict, projection_index: dict
) -> None:
    mappings = manifest["mappings"]
    mappings_by_tr: dict[str, list] = {}
    for m in mappings:
        mappings_by_tr.setdefault(m["operation"]["tr_id"], []).append(m)
    results_by_id = {}
    for m in mappings:
        if m["classification"]["category"] == "order":
            continue
        results_by_id[m["mapping_id"]] = fit_dissonance_check.evaluate_mapping(
            m, inventory_index, projection_index
        )
    families = fit_dissonance_check.apply_rest_structural_mismatch(
        results_by_id, mappings_by_tr, inventory_index
    )
    assert "ka10007" in families
    for group_id in ("bid_prices", "bid_quantities", "bid_changes"):
        mapping_id = f"detail:ka10007:{group_id}"
        assert "STRUCTURAL_MISMATCH" in results_by_id[mapping_id]["failure_codes"]


def test_semantic_type_high_frequency_aliases_are_classified() -> None:
    """§1.2 최다 재사용 alias(cur_prc 89, pred_pre 85, stk_cd 83, stk_nm 80, trde_qty 63,
    flu_rt 61)는 semanticType이 unknown이면 안 된다 — override 없이도 포맷 가능해야 한다."""
    for alias in fit_dissonance_check.HIGH_FREQ_ALIASES:
        assert fit_dissonance_check.semantic_type(alias) != "unknown", alias


def test_order_checklist_has_eight_items_and_only_item_3_is_auto_scored(
    manifest: dict, inventory_index: dict
) -> None:
    order_mappings = [m for m in manifest["mappings"] if m["classification"]["category"] == "order"]
    assert len(order_mappings) == 12
    checklist = fit_dissonance_check.compute_order_checklist(order_mappings, inventory_index)
    assert checklist["summary"]["total"] == 8
    assert checklist["items"]["3_sensitive_field_scan"]["status"] in ("pass", "fail")
    pending_keys = {
        key
        for key, item in checklist["items"].items()
        if item["status"] == "pending"
    }
    assert pending_keys == set(fit_dissonance_check.ORDER_CHECKLIST_ITEM_TITLES) - {
        "3_sensitive_field_scan"
    }


def test_order_checklist_sensitive_scan_currently_passes(
    manifest: dict, inventory_index: dict
) -> None:
    """§9.5: 계좌번호·비밀번호류 필드는 12개 order TR 요청/응답 전체에 0건이어야 한다."""
    order_mappings = [m for m in manifest["mappings"] if m["classification"]["category"] == "order"]
    checklist = fit_dissonance_check.compute_order_checklist(order_mappings, inventory_index)
    assert checklist["items"]["3_sensitive_field_scan"]["status"] == "pass"
    assert checklist["items"]["3_sensitive_field_scan"]["hits"] == []


def test_validate_override_rejects_unknown_rule_and_missing_rescore() -> None:
    assert fit_dissonance_check.validate_override(
        {"rule_attempted": "table_column_priority", "rescored_fit": 1}
    )
    assert not fit_dissonance_check.validate_override(
        {"rule_attempted": "made_up_rule", "rescored_fit": 1}
    )
    assert not fit_dissonance_check.validate_override(
        {"rule_attempted": "table_column_priority", "rescored_fit": None}
    )
    assert not fit_dissonance_check.validate_override({"rescored_fit": 1})


def test_complete_machine_gate_exits_zero_without_fabricated_human_labels(tmp_path: Path) -> None:
    """완전 screen definitions와 최신 렌더 증거가 통과하면 사람 표본은 advisory다."""
    completed = subprocess.run(
        [sys.executable, str(SCRIPTS / "fit_dissonance_check.py"), "--check", "--stamp", "test"],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={"PYTHONIOENCODING": "utf-8"},
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "EXIT 0" in completed.stdout
    assert "human_review_advisory" in completed.stdout


def test_checked_in_renderer_evidence_is_current_and_provenanced() -> None:
    completed = subprocess.run(
        [sys.executable, str(SCRIPTS / "capture_screen_render_evidence.py"), "--check"],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={"PYTHONIOENCODING": "utf-8"},
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr

    evidence = json.loads(
        capture_screen_render_evidence.EVIDENCE_PATH.read_text(encoding="utf-8")
    )
    assert evidence["coverage"]["fit_gate_representative_cases"] == [
        "A1",
        "C1",
        "C2",
        "E1",
        "E2",
        "E3",
        "F1",
        "F2",
        "S1",
        "T1",
        "T2",
        "T3",
        "T4",
    ]
    assert evidence["coverage"]["all_paper_cases_visual_status"] == "complete"
    assert evidence["coverage"]["paper_cases_without_case_specific_machine_evidence"] == []
    assert len(evidence["representative_cases"]) == 13
    assert all(case["status"] == "pass" for case in evidence["representative_cases"])
    assert all(
        all(all(group.values()) for group in case["report_assertions"].values())
        for case in evidence["representative_cases"]
    )


def test_outputs_are_written_as_valid_utf8_json() -> None:
    subprocess.run(
        [sys.executable, str(SCRIPTS / "fit_dissonance_check.py"), "--stamp", "test"],
        cwd=str(BACKEND),
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={"PYTHONIOENCODING": "utf-8"},
    )
    for path in (
        fit_dissonance_check.SCORECARD_PATH,
        fit_dissonance_check.OVERRIDES_PATH,
        fit_dissonance_check.FREE_CANVAS_PATH,
        fit_dissonance_check.ORDER_CHECKLIST_PATH,
    ):
        assert path.is_file(), path
        json.loads(path.read_text(encoding="utf-8"))

    scorecard = json.loads(
        fit_dissonance_check.SCORECARD_PATH.read_text(encoding="utf-8")
    )
    assert scorecard["aggregate"]["auto_scored"] == 289
    assert scorecard["aggregate"]["order_popup_checklist_scored"] == 12
    assert scorecard["aggregate"]["zero_tolerance_violation_count"] == 0
    assert scorecard["provenance"]["screen_definitions_present"] is True
    assert scorecard["provenance"]["scoring_mode"] == "screen_definitions_complete"
    assert scorecard["machine_render_evidence"]["coverage"]["fit_gate_status"] == "pass"
    assert scorecard["human_review_advisory"]["required_for_machine_gate"] is False
    assert scorecard["human_review_advisory"]["status"] == "pending"
