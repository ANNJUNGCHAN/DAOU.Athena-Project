"""시각 설계 라우트 — 계약 모양과 **부작용 없음**을 고정한다.

`/map`과 같은 자리다: 백테스트 서브시스템(DB)이 꺼져 있어도 동작해야 한다. 저장하는 것이
없기 때문이다. 그리고 이 라우트들은 runner·backfill·activate·deploy를 **한 번도** 부르지
않는다 — 그 넷을 터지는 함수로 갈아끼운 채 전 라우트를 두드려 그 부재를 증명한다.
"""

from __future__ import annotations

import inspect
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from athena_api.backtest import data as data_mod
from athena_api.backtest import deploy as deploy_mod
from athena_api.backtest import presets
from athena_api.backtest import visual_schema as vs
from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.store import BacktestStore
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest/visual"


def _client() -> TestClient:
    """백테스트 서브시스템이 **꺼진** 앱 — 시각 라우트는 DB 없이 성립해야 한다."""
    return TestClient(create_app(Settings(_env_file=None)))


def _graph(client: TestClient, preset_id: str = "sma_crossover") -> dict[str, Any]:
    response = client.post(f"{BASE}/from-spec", json={"yaml": presets.preset_yaml(preset_id)})
    assert response.status_code == 200
    return response.json()["graph"]


def _drop_edge_into(doc: dict[str, Any], node_id: str, port: str) -> None:
    doc["edges"] = [
        e for e in doc["edges"] if not (e["to"]["node_id"] == node_id and e["to"]["port"] == port)
    ]


def test_registry_is_built_from_the_indicator_registry() -> None:
    body = _client().get(f"{BASE}/registry").json()
    kinds = {kind["kind"]: kind for kind in body["kinds"]}
    assert body["port_types"] == ["Series<Number>", "Series<Bool>", "Number", "OHLCV"]
    assert {"data.ohlcv", "param", "output.entry", "output.exit"} <= set(kinds)
    assert len([k for k in kinds if k.startswith("condition.")]) == 7
    sma = kinds["indicator.sma"]
    assert sma["indicator_id"] == "SMA"
    assert [p["name"] for p in sma["inputs"]] == ["source", "period"]
    assert [p["name"] for p in sma["outputs"]] == ["value"]
    assert sma["inputs"][0]["required"] is True and sma["inputs"][1]["required"] is False
    macd = kinds["indicator.macd"]
    assert [p["name"] for p in macd["outputs"]] == ["macd", "signal", "hist"]
    assert kinds["indicator.adx"]["inputs"][0]["type"] == "OHLCV"


def test_from_spec_then_validate_then_compile() -> None:
    client = _client()
    graph = _graph(client)
    validate = client.post(f"{BASE}/validate", json={"graph": graph}).json()
    assert validate["valid"] is True
    assert validate["exact_code_jump"] is True
    assert validate["preview"] is None
    assert [d["code"] for d in validate["diagnostics"]] == ["BTG-DATA-001"]

    compiled = client.post(f"{BASE}/compile", json={"graph": graph})
    assert compiled.status_code == 200
    body = compiled.json()
    assert "def signals(df, p):" in body["source"]
    assert "SMA 골든크로스" in body["spec_yaml"]
    assert body["hashes"]["graph_hash"] == validate["hashes"]["graph_hash"]
    assert body["hashes"]["compiler_version"] == vs.COMPILER_VERSION
    assert body["warmup_bars"] == 60
    assert body["saved"] is False
    assert body["source_map"]["kind"] == "authoritative"
    covered = {entry["node_id"] for entry in body["source_map"]["entries"]}
    assert covered == {node["id"] for node in graph["nodes"]}


def test_compile_returns_the_structured_spec_next_to_the_yaml() -> None:
    """렌더러가 블록 스타일 yaml을 자체 파서로 읽으면 파서가 둘이 되고 언젠가 갈라진다."""
    client = _client()
    body = client.post(f"{BASE}/compile", json={"graph": _graph(client)}).json()
    spec = body["spec"]
    assert spec["metadata"]["name"] == "SMA 골든크로스"
    assert spec["strategy"]["indicators"][0] == {
        "id": "SMA",
        "alias": "ma_fast",
        "params": {"period": "$fast"},
    }
    assert spec["strategy"]["params"]["fast"]["default"] == 20
    assert spec["risk"]["stop_loss"] == {"enabled": True, "percent": 8.0}
    assert spec["data"] is None
    # yaml과 같은 문서여야 한다 — 두 표현이 갈라지면 어느 쪽이 전략인지 알 수 없다.
    assert yaml.safe_load(body["spec_yaml"])["strategy"]["id"] == spec["strategy"]["id"]


def test_validate_returns_a_preview_for_a_broken_graph() -> None:
    client = _client()
    graph = _graph(client)
    _drop_edge_into(graph, "cond-entry-1", "right")
    body = client.post(f"{BASE}/validate", json={"graph": graph}).json()
    assert body["valid"] is False
    assert body["exact_code_jump"] is True
    assert body["preview"]["executable"] is False
    assert body["preview"]["preview_only"] is True
    assert body["source_map"]["preview_only"] is True
    assert body["source_map"]["kind"] == "preview"
    assert body["hashes"]["preview_hash"] == body["preview"]["preview_hash"]
    diagnostic = next(d for d in body["diagnostics"] if d["code"] == "BTG-PORT-002")
    assert (diagnostic["node_id"], diagnostic["port"]) == ("cond-entry-1", "right")
    assert diagnostic["source_span"]["file"] == "strategy_preview.py"


def test_validate_turns_off_code_jump_when_no_safe_preview_exists() -> None:
    client = _client()
    graph = _graph(client)
    graph["nodes"].append(dict(graph["nodes"][3]))
    body = client.post(f"{BASE}/validate", json={"graph": graph}).json()
    assert body["valid"] is False
    assert body["exact_code_jump"] is False
    assert body["preview"] is None and body["source_map"] is None


def test_compile_refuses_an_invalid_graph_with_its_diagnostics() -> None:
    client = _client()
    graph = _graph(client)
    _drop_edge_into(graph, "out-exit", "signal")
    response = client.post(f"{BASE}/compile", json={"graph": graph})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert [d["code"] for d in detail["diagnostics"]] == ["BTG-PORT-002"]


def test_question_and_patch_round() -> None:
    client = _client()
    graph = _graph(client)
    _drop_edge_into(graph, "ind-ma_slow", "source")
    validate = client.post(f"{BASE}/validate", json={"graph": graph}).json()
    question = client.post(
        f"{BASE}/question", json={"graph": graph, "diagnostics": validate["diagnostics"]}
    ).json()["question"]
    assert question["code"] == "BTG-PORT-002"
    assert question["remaining"] == 0
    choice = next(c for c in question["choices"] if c["recommended"])

    patch = client.post(
        f"{BASE}/patch",
        json={
            "graph": graph,
            "base_graph_hash": validate["hashes"]["graph_hash"],
            "base_version_id": "v-7",
            "intent": {"code": question["code"], "choice_id": choice["id"]},
        },
    )
    assert patch.status_code == 200
    body = patch.json()
    assert body["applied"] is False
    assert body["base_version_id"] == "v-7"
    assert body["graph_compatible"] is True
    assert body["patch_id"].startswith("patch-")
    assert all(op["op"] in ("add", "remove", "replace") for op in body["graph_patch"])
    # 적용 receipt 재료 — 카드가 컴파일을 다시 돌리지 않고도 만들 수 있어야 한다.
    assert body["summary_ko"] == "ma_slow.source ← 캔들.close · 오류 1개 해결"
    assert body["base_artifact_hash"] is None  # base 그래프가 아직 컴파일되지 않는다
    assert body["next_version"] is None

    # 원래 그래프는 그대로다 — patch를 만들었다고 상태가 바뀌지 않는다.
    again = client.post(f"{BASE}/validate", json={"graph": graph}).json()
    assert again["hashes"]["graph_hash"] == validate["hashes"]["graph_hash"]
    assert again["valid"] is False


def test_question_is_null_when_nothing_blocks() -> None:
    client = _client()
    assert client.post(f"{BASE}/question", json={"graph": _graph(client)}).json() == {
        "question": None
    }


def test_stale_base_hash_is_409_and_bad_intent_is_422() -> None:
    client = _client()
    graph = _graph(client)
    stale = client.post(
        f"{BASE}/patch",
        json={"graph": graph, "base_graph_hash": "0" * 64, "intent": {"ops": []}},
    )
    assert stale.status_code == 409
    current = client.post(f"{BASE}/validate", json={"graph": graph}).json()["hashes"]["graph_hash"]
    bad = client.post(
        f"{BASE}/patch",
        json={
            "graph": graph,
            "base_graph_hash": current,
            "intent": {"ops": [{"kind": "exec", "source": "import os"}]},
        },
    )
    assert bad.status_code == 422
    assert "허용되지 않는" in bad.json()["detail"]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/validate", {}),
        ("/validate", {"graph": "문자열"}),
        ("/validate", {"graph": {"graph_version": "1", "nodes": [{"id": "x"}]}}),
        ("/compile", {}),
        ("/question", {"graph": {}, "diagnostics": "배열아님"}),
        ("/patch", {"graph": {}}),
        ("/from-spec", {}),
        ("/from-spec", {"yaml": "이건: 전략이 아니다"}),
    ],
)
def test_malformed_requests_are_422(path: str, body: dict[str, Any]) -> None:
    assert _client().post(f"{BASE}{path}", json=body).status_code == 422


def test_routes_never_reach_runner_backfill_activate_or_deploy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """부작용 울타리 — 넷 중 하나라도 불리면 그 자리에서 터진다."""

    def forbidden(name: str) -> Any:
        def _boom(*_args: Any, **_kwargs: Any) -> Any:
            raise AssertionError(f"시각 라우트가 {name}을(를) 불렀다")

        return _boom

    monkeypatch.setattr(BacktestRunner, "start_run", forbidden("runner.start_run"))
    monkeypatch.setattr(BacktestRunner, "start_backfill", forbidden("runner.start_backfill"))
    monkeypatch.setattr(BacktestStore, "activate_version", forbidden("store.activate_version"))
    monkeypatch.setattr(BacktestStore, "upsert_candles", forbidden("store.upsert_candles"))
    monkeypatch.setattr(data_mod, "kiwoom_fetch_page", forbidden("data.kiwoom_fetch_page"))
    monkeypatch.setattr(deploy_mod, "evaluate_latest", forbidden("deploy.evaluate_latest"))

    client = _client()
    graph = _graph(client)
    broken = _graph(client)
    _drop_edge_into(broken, "ind-ma_slow", "source")
    base = client.post(f"{BASE}/validate", json={"graph": broken}).json()["hashes"]["graph_hash"]

    assert client.get(f"{BASE}/registry").status_code == 200
    assert client.post(f"{BASE}/validate", json={"graph": graph}).status_code == 200
    assert client.post(f"{BASE}/compile", json={"graph": graph}).status_code == 200
    assert client.post(f"{BASE}/question", json={"graph": broken}).status_code == 200
    assert (
        client.post(
            f"{BASE}/patch",
            json={
                "graph": broken,
                "base_graph_hash": base,
                "intent": {
                    "ops": [
                        {
                            "kind": "connect_port",
                            "from": {"node_id": "data-ohlcv", "port": "close"},
                            "to": {"node_id": "ind-ma_slow", "port": "source"},
                        }
                    ]
                },
            },
        ).status_code
        == 200
    )


def test_the_route_module_does_not_even_import_the_store_or_runner() -> None:
    """부재를 파일 경계로도 고정한다 — import가 없으면 실수로 부를 수도 없다."""
    from athena_api.api import backtest_visual

    source = Path(inspect.getfile(backtest_visual)).read_text(encoding="utf-8")
    for forbidden in ("BacktestStore", "BacktestRunner", "backtest_store", "backtest_runner"):
        assert forbidden not in source


def test_visual_routes_work_with_the_backtest_db_enabled_too(tmp_path: Path) -> None:
    app = create_app(
        Settings(
            _env_file=None,
            backtest_enabled=True,
            backtest_db_path=tmp_path / "backtest.sqlite3",
        )
    )
    with TestClient(app) as client:
        graph = _graph(client)
        assert client.post(f"{BASE}/validate", json={"graph": graph}).json()["valid"] is True
