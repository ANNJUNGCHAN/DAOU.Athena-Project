"""Capture deterministic provenance for representative Kiwoom screen renderer evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
APP = ROOT / "app"
REF = BACKEND / "ref"

REPORT_PATH = APP / "captures" / "VERIFY-REPORT.json"
SCREEN_DEFINITIONS_PATH = REF / "kiwoom-screen-definitions.json"
EVIDENCE_PATH = REF / "kiwoom-screen-render-evidence.json"

RENDERER_SOURCES = (
    APP / "verify.js",
    APP / "canvas.html",
    APP / "canvas.js",
    APP / "canvas.css",
    APP / "lib" / "canvas-layout.js",
    APP / "lib" / "chart-card.js",
)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


PAPER_CASES = {
    "F1", "F2", "T1", "T2", "T3", "T4", "C1", "C2", "E1", "E2", "E3", "A1", "S1"
}


def _validate_assertion_group(
    case_id: str, group_name: str, value: Any, failures: list[str]
) -> dict[str, bool]:
    if not isinstance(value, dict) or not value:
        failures.append(f"{case_id}: missing {group_name} assertions")
        return {}
    invalid = [name for name, passed in value.items() if passed is not True]
    if invalid:
        failures.append(f"{case_id}: {group_name} assertions failed: {invalid}")
    return value


def build_evidence() -> dict[str, Any]:
    """Build evidence from Electron's machine assertions without adding human labels."""
    required = [REPORT_PATH, SCREEN_DEFINITIONS_PATH, *RENDERER_SOURCES]
    missing = sorted({_relative(path) for path in required if not path.is_file()})
    if missing:
        raise ValueError(f"renderer evidence input missing: {missing}")

    report = _load_json(REPORT_PATH)
    definitions = _load_json(SCREEN_DEFINITIONS_PATH)
    templates = {
        template["template_case_id"]: template["screen_id"]
        for template in definitions.get("templates", [])
    }
    report_cases = report.get("paperScreenCases")
    if not isinstance(report_cases, dict):
        raise ValueError("VERIFY-REPORT.json missing paperScreenCases")
    if set(report_cases) != PAPER_CASES:
        raise ValueError(
            "paperScreenCases must cover exactly 13 approved cases; "
            f"missing={sorted(PAPER_CASES - set(report_cases))}, "
            f"extra={sorted(set(report_cases) - PAPER_CASES)}"
        )
    cases = []
    failures = []
    screenshot_paths: set[str] = set()
    screenshot_hashes: set[str] = set()
    for case_id in sorted(PAPER_CASES):
        case_report = report_cases[case_id]
        if case_id not in templates:
            failures.append(f"{case_id}: screen definition template missing")
            continue
        if not isinstance(case_report, dict):
            failures.append(f"{case_id}: report entry is not an object")
            continue
        if case_report.get("screenId") != templates[case_id]:
            failures.append(f"{case_id}: screenId mismatch")
        if case_report.get("status") != "pass":
            failures.append(f"{case_id}: status is not pass")
        fixture = case_report.get("fixture")
        if not isinstance(fixture, (str, dict)) or not fixture:
            failures.append(f"{case_id}: fixture provenance missing")
        assertions = {
            group_name: _validate_assertion_group(
                case_id, group_name, case_report.get(group_name), failures
            )
            for group_name in ("dom", "layout", "controls", "states")
        }
        screenshot_value = case_report.get("screenshot")
        screenshot = ROOT / screenshot_value if isinstance(screenshot_value, str) else None
        if screenshot is None or not screenshot.is_file() or screenshot.stat().st_size == 0:
            failures.append(f"{case_id}: screenshot missing or empty")
            continue
        screenshot_relative = _relative(screenshot)
        if screenshot_relative in screenshot_paths:
            failures.append(f"{case_id}: screenshot path is not case-specific")
        screenshot_paths.add(screenshot_relative)
        screenshot_sha256 = _sha256(screenshot)
        if screenshot_sha256 in screenshot_hashes:
            failures.append(f"{case_id}: screenshot content duplicates another case")
        screenshot_hashes.add(screenshot_sha256)
        cases.append(
            {
                "template_case_id": case_id,
                "screen_id": templates[case_id],
                "report_assertions": assertions,
                "fixture": fixture,
                "screenshot": screenshot_relative,
                "screenshot_sha256": screenshot_sha256,
                "status": "pass",
            }
        )
    if failures:
        raise ValueError("representative renderer evidence failed: " + "; ".join(failures))

    all_cases = sorted(templates)
    verified_cases = sorted(PAPER_CASES)
    return {
        "schema_version": 1,
        "evidence_kind": "machine_renderer_provenance",
        "source_report": {
            "path": _relative(REPORT_PATH),
            "sha256": _sha256(REPORT_PATH),
            "started_at": report.get("startedAt"),
            "finished_at": report.get("finishedAt"),
            "command": "cd app && npm run verify",
        },
        "source_hashes": {
            _relative(path): _sha256(path) for path in (*RENDERER_SOURCES, SCREEN_DEFINITIONS_PATH)
        },
        "representative_cases": cases,
        "coverage": {
            "fit_gate_representative_cases": verified_cases,
            "fit_gate_status": "pass",
            "all_paper_template_cases": all_cases,
            "paper_cases_with_machine_screenshot_dom_evidence": verified_cases,
            "paper_cases_without_case_specific_machine_evidence": [],
            "all_paper_cases_visual_status": "complete",
            "note": (
                "Every approved Paper case has current case-specific renderer DOM, layout, "
                "control, state, and screenshot evidence."
            ),
        },
    }


def write_evidence(evidence: dict[str, Any]) -> None:
    EVIDENCE_PATH.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="fail when checked-in evidence is missing or stale"
    )
    args = parser.parse_args()
    try:
        expected = build_evidence()
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"screen renderer evidence invalid: {exc}")
        return 1

    if args.check:
        if not EVIDENCE_PATH.is_file():
            print(f"screen renderer evidence missing: {_relative(EVIDENCE_PATH)}")
            return 1
        if _load_json(EVIDENCE_PATH) != expected:
            print(
                "screen renderer evidence is stale; run "
                "capture_screen_render_evidence.py after npm run verify"
            )
            return 1
        print(
            "screen renderer evidence is current "
            "(13/13 approved Paper cases with case-specific DOM and screenshots)."
        )
        return 0

    write_evidence(expected)
    print(f"wrote {_relative(EVIDENCE_PATH)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
