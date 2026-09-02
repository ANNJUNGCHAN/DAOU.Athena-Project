"""시각 버전 REST 계약 — apply receipt · hash 재유도 · stale base · 비활성 강제.

`test_backtest_api_extended.py`가 기존 버전 라우트를 고정한다. 이 파일은 시각 설계↔코드
왕복이 더한 갈래만 고정한다(docs/research/backtest-visual-code-roundtrip-implementation-
evaluation.md §사용자 적용 이후 서버 처리). 핵심은 두 줄이다: 저장은 활성화가 아니고,
클라이언트가 보낸 hash는 증거가 아니다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.store import BacktestStore, hash_bundle, sha256_text
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest"

FIRST_SOURCE = "a = 1\n"
SOURCE = "entry = fast > slow\n"
SPEC_YAML = 'version: "1.0"\n'
GRAPH: dict[str, Any] = {
    "graph_version": 1,
    "nodes": [
        {"id": "sma-fast-01", "kind": "sma", "params": {"period": 5}, "ui": {"x": 10, "y": 20}},
        {"id": "entry-01", "kind": "cross_above", "params": {}},
    ],
    "edges": [
        {
            "id": "e1",
            "from": {"node_id": "sma-fast-01", "port": "value"},
            "to": {"node_id": "entry-01", "port": "fast"},
        }
    ],
    "scenario": {"symbols": ["005930"], "period": "day"},
}
SOURCE_MAP: dict[str, Any] = {
    "compiler_version": "btgraph-1",
    "entries": [
        {
            "node_id": "sma-fast-01",
            "ast_path": "$.body[0]",
            "source_span": {
                "file": "s.py",
                "start": {"line": 1, "column": 0},
                "end": {"line": 1, "column": 20},
            },
            "role": "declaration",
        }
    ],
}


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        Settings(
            _env_file=None, backtest_enabled=True, backtest_db_path=tmp_path / "backtest.sqlite3",
        )
    )
    return TestClient(app)


def _strategy(client: TestClient) -> dict[str, Any]:
    return client.post(
        f"{BASE}/strategies",
        json={"name": "골든크로스", "kind": "python", "source": FIRST_SOURCE},
    ).json()


def _bundle(**over: Any) -> dict[str, Any]:
    payload = {
        "graph": GRAPH,
        "spec_yaml": SPEC_YAML,
        "source_map": SOURCE_MAP,
        "hashes": hash_bundle(GRAPH, SPEC_YAML, SOURCE),
        "compiler_version": "btgraph-1",
    }
    payload.update(over)
    return payload


def _receipt(base_version_id: str, base_source: str = FIRST_SOURCE, **over: Any) -> dict[str, Any]:
    payload = {
        "base_version_id": base_version_id,
        "base_graph_hash": hash_bundle(GRAPH, SPEC_YAML, SOURCE)["graph_hash"],
        "base_artifact_hash": sha256_text(base_source),
        "patch_id": "patch-1",
        "patch_hash": sha256_text("patch-1"),
        "applied_at": "2026-09-02T03:00:00+00:00",
    }
    payload.update(over)
    return payload


def _visual_body(base_version_id: str, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "source": SOURCE,
        "origin": "visual",
        "note": "느린 SMA 연결",
        "apply_receipt": _receipt(base_version_id),
        "bundle": _bundle(),
    }
    body.update(over)
    return body


# ── 성공 경로 ───────────────────────────────────────────────────────────────


def test_visual_save_returns_an_inactive_receipt(tmp_path: Path) -> None:
    """저장 성공의 응답은 "비활성으로 들어갔고 활성은 그대로다"라는 영수증이다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        res = client.post(
            f"{BASE}/strategies/{sid}/versions", json=_visual_body(created["version_id"])
        )
        assert res.status_code == 200
        body = res.json()
        assert body["version"] == 2
        assert body["origin"] == "visual"
        assert body["active"] is False and body["is_active"] is False
        assert body["active_version_id"] == created["version_id"]  # ★ 활성은 움직이지 않았다
        assert body["hashes"] == hash_bundle(GRAPH, SPEC_YAML, SOURCE)
        assert body["compiler_version"] == "btgraph-1"
        assert body["apply_receipt"]["patch_id"] == "patch-1"

        versions = client.get(f"{BASE}/strategies/{sid}/versions").json()["versions"]
        active = [v for v in versions if v["active"]]
        assert len(active) == 1 and active[0]["id"] == created["version_id"]


def test_get_version_detail_returns_the_bundle_for_reopening(tmp_path: Path) -> None:
    """지난 시각 버전을 다시 여는 길 — 소스만으로는 그래프를 재현할 수 없다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        saved = client.post(
            f"{BASE}/strategies/{sid}/versions", json=_visual_body(created["version_id"])
        ).json()
        detail = client.get(f"{BASE}/strategies/{sid}/versions/{saved['version_id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["graph"] == GRAPH
        assert body["source_map"] == SOURCE_MAP
        assert body["hashes"] == hash_bundle(GRAPH, SPEC_YAML, SOURCE)
        assert body["spec_yaml"] == SPEC_YAML
        assert body["compiler_version"] == "btgraph-1"
        assert body["origin"] == "visual"
        assert body["active"] is False and body["is_active"] is False
        assert body["apply_receipt"]["base_version_id"] == created["version_id"]


def test_get_version_detail_has_no_bundle_for_a_human_version(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        detail = client.get(
            f"{BASE}/strategies/{created['strategy_id']}/versions/{created['version_id']}"
        ).json()
        assert detail["origin"] == "human" and detail["active"] is True
        assert detail["graph"] is None and detail["source_map"] is None
        assert detail["hashes"] is None and detail["apply_receipt"] is None


def test_get_version_detail_refuses_another_strategys_version(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        a = _strategy(client)
        b = _strategy(client)
        res = client.get(f"{BASE}/strategies/{a['strategy_id']}/versions/{b['version_id']}")
        assert res.status_code == 404


def test_the_next_visual_save_chains_on_the_previous_one(tmp_path: Path) -> None:
    """두 번째 시각 저장의 base는 첫 시각 버전이고, 그 그래프 hash까지 대조한다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        first = client.post(
            f"{BASE}/strategies/{sid}/versions", json=_visual_body(created["version_id"])
        ).json()
        chained = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(
                first["version_id"],
                apply_receipt=_receipt(first["version_id"], SOURCE, patch_id="patch-2"),
            ),
        )
        assert chained.status_code == 200
        assert chained.json()["version"] == 3
        assert chained.json()["active_version_id"] == created["version_id"]


# ── 활성화 거부 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("origin", ["visual", "code_only"])
def test_save_is_refused_when_the_client_asks_for_active(tmp_path: Path, origin: str) -> None:
    """`active: true`를 조용히 무시하지 않는다 — 무시하면 화면과 서버의 믿음이 갈린다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        body = (
            _visual_body(created["version_id"], active=True)
            if origin == "visual"
            else {"source": SOURCE, "origin": "code_only", "active": True}
        )
        res = client.post(f"{BASE}/strategies/{sid}/versions", json=body)
        assert res.status_code == 422
        assert "활성" in res.json()["detail"]
        # 거부된 요청은 아무 버전도 남기지 않는다
        versions = client.get(f"{BASE}/strategies/{sid}/versions").json()["versions"]
        assert [v["id"] for v in versions] == [created["version_id"]]


# ── apply receipt · hash 검증 ───────────────────────────────────────────────


def test_visual_save_requires_an_apply_receipt(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        body = _visual_body(created["version_id"])
        del body["apply_receipt"]
        res = client.post(f"{BASE}/strategies/{created['strategy_id']}/versions", json=body)
        assert res.status_code == 422
        assert "apply_receipt" in res.json()["detail"]


def test_visual_save_rejects_a_receipt_missing_fields(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        receipt = _receipt(created["version_id"])
        del receipt["patch_hash"]
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(created["version_id"], apply_receipt=receipt),
        )
        assert res.status_code == 422
        assert "patch_hash" in res.json()["detail"]


def test_visual_save_requires_a_bundle(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        body = _visual_body(created["version_id"])
        del body["bundle"]
        res = client.post(f"{BASE}/strategies/{created['strategy_id']}/versions", json=body)
        assert res.status_code == 422
        assert "bundle" in res.json()["detail"]


def test_visual_save_rejects_hashes_that_do_not_match_the_bundle(tmp_path: Path) -> None:
    """클라이언트가 보낸 hash를 그대로 저장하면 어긋난 bundle에 서명해 주는 셈이다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        lying = hash_bundle(GRAPH, SPEC_YAML, SOURCE) | {"graph_hash": "0" * 64}
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(created["version_id"], bundle=_bundle(hashes=lying)),
        )
        assert res.status_code == 422
        assert "graph_hash" in res.json()["detail"]


def test_visual_save_rejects_a_bundle_whose_source_is_not_the_saved_source(
    tmp_path: Path,
) -> None:
    """저장되는 코드와 hash된 코드가 달라지는 갈래를 막는다(artifact_hash 재유도)."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(created["version_id"], source="entry = 1\n"),
        )
        assert res.status_code == 422
        assert "artifact_hash" in res.json()["detail"]


# ── stale base(409) ─────────────────────────────────────────────────────────


def test_visual_save_rejects_a_base_that_is_no_longer_the_head(tmp_path: Path) -> None:
    """다른 저장이 먼저 들어왔다 — 요청이 틀린 게 아니라 세상이 바뀌었다(409)."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        client.post(f"{BASE}/strategies/{sid}/versions", json={"source": "a = 2\n"})
        res = client.post(
            f"{BASE}/strategies/{sid}/versions", json=_visual_body(created["version_id"])
        )
        assert res.status_code == 409
        assert "base" in res.json()["detail"]


def test_visual_save_rejects_a_changed_base_artifact(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(
                created["version_id"],
                apply_receipt=_receipt(created["version_id"], "다른 코드\n"),
            ),
        )
        assert res.status_code == 409
        assert "코드" in res.json()["detail"]


def test_visual_save_rejects_a_changed_base_graph(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        first = client.post(
            f"{BASE}/strategies/{sid}/versions", json=_visual_body(created["version_id"])
        ).json()
        res = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(
                first["version_id"],
                apply_receipt=_receipt(
                    first["version_id"], SOURCE, base_graph_hash="1" * 64, patch_id="patch-2"
                ),
            ),
        )
        assert res.status_code == 409
        assert "그래프" in res.json()["detail"]


def test_visual_save_rejects_an_unknown_base_version(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body("없는-버전-id"),
        )
        assert res.status_code == 409


# ── code_only ───────────────────────────────────────────────────────────────


def test_code_only_save_needs_no_receipt_and_stays_inactive(tmp_path: Path) -> None:
    """코드가 그래프로 표현되지 않는 갈래 — receipt는 없지만 활성화도 없다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        res = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json={"source": "손으로 고친 코드\n", "origin": "code_only", "note": "분기"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["active"] is False and body["origin"] == "code_only"
        assert body["active_version_id"] == created["version_id"]
        assert body["hashes"] is None and body["apply_receipt"] is None


def test_code_only_save_refuses_a_bundle(tmp_path: Path) -> None:
    """code-only에 그래프를 같이 저장하면 "동기화됐다"고 표시하는 것과 같다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json={"source": SOURCE, "origin": "code_only", "bundle": _bundle()},
        )
        assert res.status_code == 422
        assert "bundle" in res.json()["detail"]


# ── 기존 origin 회귀 ────────────────────────────────────────────────────────


def test_existing_origins_keep_their_response_shape(tmp_path: Path) -> None:
    """human/form/llm_draft의 응답은 한 글자도 달라지지 않는다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        human = client.post(f"{BASE}/strategies/{sid}/versions", json={"source": "a = 2\n"})
        assert human.status_code == 200
        assert set(human.json()) == {"version_id", "version", "active"}
        assert human.json()["active"] is True

        form = client.post(
            f"{BASE}/strategies/{sid}/versions", json={"source": "a = 3\n", "origin": "form"}
        ).json()
        assert set(form) == {"version_id", "version", "active"} and form["active"] is True

        draft = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json={"source": "a = 4\n", "origin": "llm_draft"},
        ).json()
        assert set(draft) == {"version_id", "version", "active"} and draft["active"] is False
        assert client.get(f"{BASE}/strategies/{sid}/versions/{form['version_id']}").json()[
            "active"
        ] is True


def test_unknown_origin_is_still_refused(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json={"source": "a = 2\n", "origin": "mcp"},
        )
        assert res.status_code == 422
        assert "code_only" in res.json()["detail"]


# ── 부작용 울타리 ───────────────────────────────────────────────────────────


def test_visual_save_runs_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """저장은 실행도 활성화도 배포도 아니다 — 넷 다 0번 불려야 한다(연구 문서 §8)."""
    calls: list[str] = []
    monkeypatch.setattr(
        BacktestRunner, "start_run", lambda *a, **k: calls.append("run"), raising=True
    )
    monkeypatch.setattr(
        BacktestRunner, "start_backfill", lambda *a, **k: calls.append("backfill"), raising=True
    )
    monkeypatch.setattr(
        BacktestStore, "activate_version", lambda *a, **k: calls.append("activate"), raising=True
    )
    monkeypatch.setattr(
        BacktestStore, "create_deployment", lambda *a, **k: calls.append("deploy"), raising=True
    )
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        assert (
            client.post(
                f"{BASE}/strategies/{sid}/versions", json=_visual_body(created["version_id"])
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"{BASE}/strategies/{sid}/versions",
                json={"source": "손으로 고친 코드\n", "origin": "code_only"},
            ).status_code
            == 200
        )
    assert calls == []
