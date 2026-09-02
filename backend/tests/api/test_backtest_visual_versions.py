"""시각 버전 REST 계약 — apply receipt · hash 재유도 · stale base · 비활성 강제.

`test_backtest_api_extended.py`가 기존 버전 라우트를 고정한다. 이 파일은 시각 설계↔코드
왕복이 더한 갈래만 고정한다(docs/research/backtest-visual-code-roundtrip-implementation-
evaluation.md §사용자 적용 이후 서버 처리). 핵심은 두 줄이다: 저장은 활성화가 아니고,
클라이언트가 보낸 hash는 증거가 아니다.

**픽스처를 손으로 적지 않는다.** bundle은 `/visual/from-spec` → `/visual/compile`이 실제로
내놓은 것을 그대로 쓴다. 손으로 적은 그래프·hash로 검증하면 "서버가 자기 출력을 자기가
거부한다"를 통과시켜 버린다 — us011 프로브가 막힌 지점이 정확히 거기였다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from athena_api.backtest import presets
from athena_api.backtest import visual_schema as vs
from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.store import BacktestStore
from athena_api.config import Settings
from athena_api.main import create_app

BASE = "/api/v1/backtest"
VISUAL = f"{BASE}/visual"

FIRST_SOURCE = "a = 1\n"


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        Settings(
            _env_file=None, backtest_enabled=True, backtest_db_path=tmp_path / "backtest.sqlite3",
        )
    )
    return TestClient(app)


def _compiled(client: TestClient, preset_id: str = "sma_crossover") -> dict[str, Any]:
    """프리셋 → 편집 가능한 그래프 → 컴파일. 화면이 실제로 밟는 순서 그대로."""
    from_spec = client.post(
        f"{VISUAL}/from-spec", json={"yaml": presets.preset_yaml(preset_id)}
    )
    assert from_spec.status_code == 200, from_spec.text
    graph = from_spec.json()["graph"]
    compiled = client.post(f"{VISUAL}/compile", json={"graph": graph})
    assert compiled.status_code == 200, compiled.text
    return {"graph": graph, **compiled.json()}


def _strategy(client: TestClient) -> dict[str, Any]:
    return client.post(
        f"{BASE}/strategies",
        json={"name": "골든크로스", "kind": "python", "source": FIRST_SOURCE},
    ).json()


def _bundle(compiled: dict[str, Any], **over: Any) -> dict[str, Any]:
    payload = {
        "graph": compiled["graph"],
        "spec": compiled["spec"],
        "spec_yaml": compiled["spec_yaml"],
        "source_map": compiled["source_map"],
        "hashes": compiled["hashes"],
        "compiler_version": compiled["hashes"]["compiler_version"],
    }
    payload.update(over)
    return payload


def _receipt(base_version_id: str, base_source: str = FIRST_SOURCE, **over: Any) -> dict[str, Any]:
    payload = {
        "base_version_id": base_version_id,
        "base_graph_hash": "0" * 64,  # 그래프 없는 base에서는 대조 대상이 없다
        "base_artifact_hash": vs.source_hash(base_source),
        "patch_id": "patch-1",
        "patch_hash": vs.source_hash("patch-1"),
        "applied_at": "2026-09-02T03:00:00+00:00",
    }
    payload.update(over)
    return payload


def _visual_body(compiled: dict[str, Any], base_version_id: str, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "source": compiled["source"],
        "origin": "visual",
        "note": "느린 SMA 연결",
        "apply_receipt": _receipt(base_version_id),
        "bundle": _bundle(compiled),
    }
    body.update(over)
    return body


def _as_javascript_would(value: Any) -> Any:
    """JS 클라이언트의 JSON 왕복을 흉내낸다 — 8.0은 8로만 다시 쓸 수 있다."""
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _as_javascript_would(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_as_javascript_would(v) for v in value]
    return value


# ── 성공 경로 ───────────────────────────────────────────────────────────────


def test_compile_output_saves_without_being_touched(tmp_path: Path) -> None:
    """서버가 낸 bundle을 그대로 되돌려주면 저장돼야 한다 — 자기 출력을 거부하면 안 된다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        sid = created["strategy_id"]
        res = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(compiled, created["version_id"]),
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["version"] == 2
        assert body["origin"] == "visual"
        assert body["active"] is False and body["is_active"] is False
        assert body["active_version_id"] == created["version_id"]  # ★ 활성은 움직이지 않았다
        assert body["hashes"] == {
            "graph_hash": compiled["hashes"]["graph_hash"],
            "spec_hash": compiled["hashes"]["spec_hash"],
            "artifact_hash": compiled["hashes"]["artifact_hash"],
        }
        assert body["compiler_version"] == vs.COMPILER_VERSION
        assert body["apply_receipt"]["patch_id"] == "patch-1"

        versions = client.get(f"{BASE}/strategies/{sid}/versions").json()["versions"]
        active = [v for v in versions if v["active"]]
        assert len(active) == 1 and active[0]["id"] == created["version_id"]


def test_a_javascript_json_round_trip_still_saves(tmp_path: Path) -> None:
    """브라우저를 거친 bundle도 저장돼야 한다 — JS는 8.0을 8로만 쓸 수 있다(us011 실측).

    hash를 파싱한 모델에서 내지 않고 원본 dict에서 내면 이 테스트가 422로 죽는다.
    """
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        body = _visual_body(compiled, created["version_id"])
        body["bundle"] = _as_javascript_would(body["bundle"])
        # 이 테스트가 조용히 무의미해지지 않게: 왕복이 실제로 바이트를 바꿨는지 먼저 본다
        assert json.dumps(body["bundle"]["graph"], sort_keys=True) != json.dumps(
            compiled["graph"], sort_keys=True
        )
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions", json=body
        )
        assert res.status_code == 200, res.text
        assert res.json()["hashes"]["graph_hash"] == compiled["hashes"]["graph_hash"]


def test_compiler_version_may_be_omitted(tmp_path: Path) -> None:
    """생략하면 서버 것을 쓴다 — 저장되는 표기는 실제로 검증한 컴파일러의 것이다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        bundle = _bundle(compiled)
        del bundle["compiler_version"]
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(compiled, created["version_id"], bundle=bundle),
        )
        assert res.status_code == 200, res.text
        assert res.json()["compiler_version"] == vs.COMPILER_VERSION


def test_a_null_compiler_version_is_treated_as_omitted(tmp_path: Path) -> None:
    """아직 컴파일 결과가 없던 화면은 그 칸을 null로 직렬화한다 — 생략과 같게 받는다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(
                compiled,
                created["version_id"],
                bundle=_bundle(compiled, compiler_version=None),
            ),
        )
        assert res.status_code == 200, res.text
        assert res.json()["compiler_version"] == vs.COMPILER_VERSION


def test_a_foreign_compiler_version_is_refused(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(
                compiled,
                created["version_id"],
                bundle=_bundle(compiled, compiler_version="visual-0.9.0"),
            ),
        )
        assert res.status_code == 422
        assert "compiler_version" in res.json()["detail"]


def test_get_version_detail_returns_the_bundle_for_reopening(tmp_path: Path) -> None:
    """지난 시각 버전을 다시 여는 길 — 되읽은 그래프가 저장된 hash를 재현해야 한다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        sid = created["strategy_id"]
        saved = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(compiled, created["version_id"]),
        ).json()
        detail = client.get(f"{BASE}/strategies/{sid}/versions/{saved['version_id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["source_map"] == compiled["source_map"]
        assert body["spec_yaml"] == compiled["spec_yaml"]
        assert body["compiler_version"] == vs.COMPILER_VERSION
        assert body["origin"] == "visual"
        assert body["active"] is False and body["is_active"] is False
        assert body["apply_receipt"]["base_version_id"] == created["version_id"]
        # 되읽은 그래프는 `ui`를 그대로 갖고, 다시 해시하면 저장된 값과 같다
        assert any(node.get("ui") for node in body["graph"]["nodes"])
        reopened = vs.VisualStrategyGraph.model_validate(body["graph"])
        assert vs.graph_hash(reopened) == body["hashes"]["graph_hash"]
        # 그리고 그 그래프를 그대로 다시 컴파일하면 같은 코드가 나온다(재현성)
        again = client.post(f"{VISUAL}/compile", json={"graph": body["graph"]}).json()
        assert again["source"] == compiled["source"]
        assert again["hashes"]["artifact_hash"] == body["hashes"]["artifact_hash"]


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
        compiled = _compiled(client)
        created = _strategy(client)
        sid = created["strategy_id"]
        first = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(compiled, created["version_id"]),
        ).json()
        chained = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(
                compiled,
                first["version_id"],
                apply_receipt=_receipt(
                    first["version_id"],
                    compiled["source"],
                    base_graph_hash=compiled["hashes"]["graph_hash"],
                    patch_id="patch-2",
                ),
            ),
        )
        assert chained.status_code == 200, chained.text
        assert chained.json()["version"] == 3
        assert chained.json()["active_version_id"] == created["version_id"]


# ── 활성화 거부 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("origin", ["visual", "code_only"])
def test_save_is_refused_when_the_client_asks_for_active(tmp_path: Path, origin: str) -> None:
    """`active: true`를 조용히 무시하지 않는다 — 무시하면 화면과 서버의 믿음이 갈린다."""
    with _client(tmp_path) as client:
        created = _strategy(client)
        sid = created["strategy_id"]
        if origin == "visual":
            body = _visual_body(_compiled(client), created["version_id"], active=True)
        else:
            body = {"source": "b = 2\n", "origin": "code_only", "active": True}
        res = client.post(f"{BASE}/strategies/{sid}/versions", json=body)
        assert res.status_code == 422
        assert "활성" in res.json()["detail"]
        # 거부된 요청은 아무 버전도 남기지 않는다
        versions = client.get(f"{BASE}/strategies/{sid}/versions").json()["versions"]
        assert [v["id"] for v in versions] == [created["version_id"]]


# ── apply receipt · hash 검증 ───────────────────────────────────────────────


def test_visual_save_requires_an_apply_receipt(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        body = _visual_body(compiled, created["version_id"])
        del body["apply_receipt"]
        res = client.post(f"{BASE}/strategies/{created['strategy_id']}/versions", json=body)
        assert res.status_code == 422
        assert "apply_receipt" in res.json()["detail"]


def test_visual_save_rejects_a_receipt_missing_fields(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        receipt = _receipt(created["version_id"])
        del receipt["patch_hash"]
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(compiled, created["version_id"], apply_receipt=receipt),
        )
        assert res.status_code == 422
        assert "patch_hash" in res.json()["detail"]


def test_visual_save_requires_a_bundle(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        body = _visual_body(compiled, created["version_id"])
        del body["bundle"]
        res = client.post(f"{BASE}/strategies/{created['strategy_id']}/versions", json=body)
        assert res.status_code == 422
        assert "bundle" in res.json()["detail"]


def test_visual_save_requires_the_normalized_spec(tmp_path: Path) -> None:
    """spec_hash는 정규화된 스펙 모델의 hash다 — 같은 스펙을 여러 yaml로 쓸 수 있어서,
    yaml 텍스트를 해시하면 서식만 바꿔도 다른 전략처럼 보인다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        bundle = _bundle(compiled)
        del bundle["spec"]
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(compiled, created["version_id"], bundle=bundle),
        )
        assert res.status_code == 422
        assert "spec" in res.json()["detail"]


def test_visual_save_rejects_hashes_that_do_not_match_the_bundle(tmp_path: Path) -> None:
    """클라이언트가 보낸 hash를 그대로 저장하면 어긋난 bundle에 서명해 주는 셈이다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        lying = compiled["hashes"] | {"graph_hash": "0" * 64}
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(
                compiled, created["version_id"], bundle=_bundle(compiled, hashes=lying)
            ),
        )
        assert res.status_code == 422
        assert "graph_hash" in res.json()["detail"]


def test_visual_save_rejects_a_graph_that_does_not_match_the_code(tmp_path: Path) -> None:
    """그래프를 바꿔치기하면 graph_hash가 어긋난다 — 코드와 그래프가 갈라진 채 저장되지 않는다."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        tampered = _as_javascript_would(compiled["graph"])
        for node in tampered["nodes"]:
            if node["kind"] == "param":
                node["params"]["default"] = 999
                break
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(
                compiled, created["version_id"], bundle=_bundle(compiled, graph=tampered)
            ),
        )
        assert res.status_code == 422
        assert "graph_hash" in res.json()["detail"]


def test_visual_save_rejects_a_bundle_whose_source_is_not_the_saved_source(
    tmp_path: Path,
) -> None:
    """저장되는 코드와 hash된 코드가 달라지는 갈래를 막는다(artifact_hash 재유도)."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(compiled, created["version_id"], source="entry = 1\n"),
        )
        assert res.status_code == 422
        assert "artifact_hash" in res.json()["detail"]


# ── stale base(409) ─────────────────────────────────────────────────────────


def test_visual_save_rejects_a_base_that_is_no_longer_the_head(tmp_path: Path) -> None:
    """다른 저장이 먼저 들어왔다 — 요청이 틀린 게 아니라 세상이 바뀌었다(409)."""
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        sid = created["strategy_id"]
        client.post(f"{BASE}/strategies/{sid}/versions", json={"source": "a = 2\n"})
        res = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(compiled, created["version_id"]),
        )
        assert res.status_code == 409
        assert "base" in res.json()["detail"]


def test_visual_save_rejects_a_changed_base_artifact(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(
                compiled,
                created["version_id"],
                apply_receipt=_receipt(created["version_id"], "다른 코드\n"),
            ),
        )
        assert res.status_code == 409
        assert "코드" in res.json()["detail"]


def test_visual_save_rejects_a_changed_base_graph(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        sid = created["strategy_id"]
        first = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(compiled, created["version_id"]),
        ).json()
        res = client.post(
            f"{BASE}/strategies/{sid}/versions",
            json=_visual_body(
                compiled,
                first["version_id"],
                apply_receipt=_receipt(
                    first["version_id"],
                    compiled["source"],
                    base_graph_hash="1" * 64,
                    patch_id="patch-2",
                ),
            ),
        )
        assert res.status_code == 409
        assert "그래프" in res.json()["detail"]


def test_visual_save_rejects_an_unknown_base_version(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        compiled = _compiled(client)
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json=_visual_body(compiled, "없는-버전-id"),
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
        compiled = _compiled(client)
        created = _strategy(client)
        res = client.post(
            f"{BASE}/strategies/{created['strategy_id']}/versions",
            json={
                "source": compiled["source"],
                "origin": "code_only",
                "bundle": _bundle(compiled),
            },
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
        compiled = _compiled(client)
        created = _strategy(client)
        sid = created["strategy_id"]
        assert (
            client.post(
                f"{BASE}/strategies/{sid}/versions",
                json=_visual_body(compiled, created["version_id"]),
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
