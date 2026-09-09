from __future__ import annotations

import collections
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).with_name("probe_mock_support.py")
SPEC = importlib.util.spec_from_file_location("probe_mock_support", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


@pytest.mark.parametrize(
    ("status", "payload", "expected"),
    [
        (200, {"return_code": 0, "return_msg": "정상"}, "supported"),
        (200, {"return_code": None}, "upstream_error"),
        (200, {"return_code": ""}, "upstream_error"),
        (200, {"return_code": {}}, "upstream_error"),
        (200, {"return_msg": "코드 없음"}, "upstream_error"),
        (401, {"detail": "인증 실패"}, "upstream_error"),
        (500, {"detail": "상류 실패"}, "upstream_error"),
        (500, {"return_code": 0, "return_msg": "잘못된 성공"}, "upstream_error"),
        (422, {"detail": [{"loc": ["body", "stk_cd"]}]}, "needs_arguments"),
    ],
)
def test_classify_requires_explicit_success_from_a_2xx_response(
    status: int, payload: dict, expected: str,
) -> None:
    assert probe.classify(status, payload, "")[0] == expected


def test_classify_preserves_authentication_failure_detail() -> None:
    verdict, message = probe.classify(401, {"detail": "인증 실패"}, "")

    assert verdict == "upstream_error"
    assert "인증 실패" in message


def test_gold_trade_history_uses_catalog_entity_metadata() -> None:
    sys.path.insert(0, str(probe.ROOT / "backend"))
    from athena_api.selector.catalog import build_operation_catalog

    document = build_operation_catalog().find_exact("detail:kt50032:gold_trade_history")
    assert document is not None
    kinds = json.loads(probe.TARGETS.read_text(encoding="utf-8"))["kinds"]

    targets = {"stock": "005930", "gold": "M04020000"}

    assert probe.target_for(document, kinds, targets) == ("gold", "M04020000")
    assert probe.target_for(document, kinds, {"stock": "005930"}) == ("gold", None)


def test_incomplete_audit_returns_nonzero() -> None:
    assert probe.audit_exit_code([{"verdict": "supported"}], 1) == 0
    assert probe.audit_exit_code([{"verdict": "upstream_error"}], 1) == 1
    assert probe.audit_exit_code([{"verdict": "supported"}], 2) == 1


def test_blocked_chain_does_not_call_target(monkeypatch: pytest.MonkeyPatch) -> None:
    def unexpected_call(path: str, body: dict) -> None:
        raise AssertionError(f"unexpected target call: {path} {body}")

    monkeypatch.setattr(probe, "call", unexpected_call)

    result = probe.execute_probe(
        "/target", {"stk_cd": "005930"},
        ("chain_source_error", "source failed", 500),
    )

    assert result[0] == 500
    assert result[3:] == ("chain_source_error", "source failed")


@pytest.mark.parametrize(
    ("status", "payload"),
    [
        (500, {"return_code": 0, "items": [{"code": "BOGUS"}]}),
        (401, {"detail": "인증 실패"}),
        (200, {"return_code": 0, "items": []}),
    ],
)
def test_chain_source_failure_is_propagated(
    status: int, payload: dict, monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = SimpleNamespace(
        tr_id="source",
        operation_ref="base:source",
        request_model=SimpleNamespace(model_fields={}),
    )
    catalog = SimpleNamespace(find_exact=lambda operation_ref: document)
    registry = {"source": SimpleNamespace(domain="test")}
    monkeypatch.setattr(probe, "call", lambda path, body: (status, payload, ""))
    probe._CHAIN_CACHE.clear()

    value, failure, source_status = probe.resolve_chain(
        {"operation_ref": "base:source", "json_path": "$.items[].code"},
        "005930", registry, catalog, lambda operation_ref: {},
    )

    assert value == ""
    assert failure
    assert source_status == status


def test_target_list_http_error_does_not_extract_bogus_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kinds = [{
        "kind": "etf",
        "list": {"path": "/etf", "list_field": "items", "code_field": "code"},
    }]
    monkeypatch.setattr(
        probe, "call",
        lambda path, body: (500, {"return_code": 0, "items": [{"code": "BOGUS"}]}, ""),
    )

    targets, failures = probe.resolve_targets(kinds)

    assert "etf" not in targets
    assert failures[0]["verdict"] == "upstream_error"


def test_target_list_missing_code_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    kinds = [{
        "kind": "etf",
        "list": {"path": "/etf", "list_field": "items", "code_field": "code"},
    }]
    monkeypatch.setattr(
        probe, "call", lambda path, body: (200, {"return_code": 0, "items": []}, ""),
    )

    targets, failures = probe.resolve_targets(kinds)

    assert "etf" not in targets
    assert failures[0]["verdict"] == "target_unavailable"


def test_target_list_auth_failure_stops_further_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kinds = [
        {"kind": "etf", "list": {"path": "/etf"}},
        {"kind": "elw", "list": {"path": "/elw"}},
    ]
    calls: list[str] = []

    def deny(path: str, body: dict) -> tuple[int, dict, str]:
        calls.append(path)
        return 401, {"detail": "인증 실패"}, ""

    monkeypatch.setattr(probe, "call", deny)

    _, failures = probe.resolve_targets(kinds)

    assert calls == ["/etf"]
    assert failures[0]["status"] == 401


def test_generated_document_uses_lf_newlines(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = tmp_path / "mock-support.md"
    monkeypatch.setattr(probe, "OUT_DOC", output)

    probe.write_doc([], collections.Counter(), {"stock": "005930"})

    assert b"\r\n" not in output.read_bytes()
    assert output.read_bytes().endswith(b"\n")
