"""캔버스 사이드 채널(api/canvas_push.py) — push 큐잉·WS 전달·fail-closed."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from athena_api.api.canvas_push import _integrated_card_contract, router
from athena_api.errors import KiwoomApiError
from athena_api.kiwoom import ResponseEnvelope


def _app(with_queue: bool = True, maxsize: int = 50, token: str | None = None):
    app = FastAPI()
    app.include_router(router)
    app.state.local_bearer_token = token
    app.state.canvas_events = asyncio.Queue(maxsize) if with_queue else None
    return app


def test_push_enqueues_envelope():
    app = _app()
    client = TestClient(app)
    envelope = {"canvas_type": "chart", "data": {"symbol": "005930", "bars": []}}
    response = client.post("/api/v1/canvas/push", json=envelope)
    assert response.status_code == 200
    assert app.state.canvas_events.get_nowait() == envelope


def test_generic_push_derives_card_contract_only_when_caller_signals_card_intent():
    """카드 의도를 밝힌 봉투에만 서버가 CC 계약을 파생해 덮어쓴다.

    이 엔드포인트에는 bearer 검사가 없다. canonical operation_ref만으로 계약을
    파생하도록 넓히면, 아무나 TR 이름 하나만 대고 자기 data를 'lossless 공식 카드'로
    세탁할 수 있게 된다. 그래서 게이트는 "호출자가 통합 카드 필드를 실었는가"로 유지한다.
    실제 프로덕션 호출자(athena_mcp/canvas_data.py의 render_with_plan)는 이미
    _integrated_card_contract를 실어 보내므로 이 게이트로 충분하다.
    """

    app = _app()
    client = TestClient(app)
    # 카드 의도를 밝히지 않은 봉투 — operation_ref가 canonical이어도 계약이 붙지 않는다.
    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "operation_ref": "base:ka10060",
            "data": {"stk_cd": "005930"},
        },
    )
    assert response.status_code == 200
    queued = app.state.canvas_events.get_nowait()
    assert "card_id" not in queued
    assert "presentation_contract" not in queued

    # 카드 의도를 밝힌 봉투 — 서버가 canonical 계약을 파생해 덮어쓴다.
    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "operation_ref": "base:ka10060",
            "card_id": "CC-03",
            "data": {"stk_cd": "005930"},
        },
    )
    assert response.status_code == 200
    queued = app.state.canvas_events.get_nowait()
    assert queued["card_id"] == "CC-03"
    assert queued["card_kind"] == "instrument"
    assert queued["view_recipe"]["recipe_id"]
    assert queued["presentation_contract"]["sections"]


def test_generic_push_without_operation_ref_stays_uncontracted():
    """operation_ref가 없는 봉투(비 키움 소스)는 그대로 통과한다."""

    app = _app()
    client = TestClient(app)
    envelope = {"canvas_type": "chart", "data": {"symbol": "005930", "bars": []}}
    response = client.post("/api/v1/canvas/push", json=envelope)
    assert response.status_code == 200
    queued = app.state.canvas_events.get_nowait()
    assert "card_id" not in queued


def test_push_requires_canvas_type():
    client = TestClient(_app())
    response = client.post("/api/v1/canvas/push", json={"data": {}})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "envelope",
    [
        {"canvas_type": "task_canvas", "data": {}},
        {"canvas_type": "task-canvas", "data": {}},
        {"canvas_type": "facts", "task_canvas": {"status": "available"}},
        {"canvas_type": "facts", "taskCanvas": {"status": "available"}},
        {
            "canvas_type": "facts",
            "data": {"presentation_contract": {"status": "available"}},
        },
        {
            "canvas_type": "facts",
            "data": {"presentationContract": {"status": "available"}},
        },
        {
            "canvas_type": "facts",
            "viewRecipe": {"recipeId": "forged"},
        },
        {
            "canvas_type": "facts",
            "data": {"field_contract": [{"value": "forged"}]},
        },
        {
            "canvas_type": "facts",
            "data": {"coverageReceipt": {"lossless": True}},
        },
        {
            "canvas_type": "facts",
            "data": {
                "rows": [
                    {
                        "payload": {
                            "semantic_observations": [{"value": "forged"}]
                        }
                    }
                ]
            },
        },
        {
            "canvas_type": "facts",
            "data": {
                "rows": [
                    {
                        "payload": {
                            "semanticObservations": [{"value": "forged"}],
                            "realtimeBindings": [{"bindingId": "forged"}],
                        }
                    }
                ]
            },
        },
    ],
    ids=[
        "task-canvas-type",
        "task-canvas-hyphen-type",
        "task-canvas-snake",
        "task-canvas-camel",
        "nested-presentation-snake",
        "nested-presentation-camel",
        "top-level-recipe-camel",
        "nested-field-contract-snake",
        "nested-coverage-receipt-camel",
        "deep-list-semantic-snake",
        "deep-list-semantic-camel",
    ],
)
def test_generic_push_rejects_task_canvas_contracts_before_queue_access(envelope):
    app = _app()
    sentinel = {"canvas_type": "chart", "data": {"kept": True}}
    app.state.canvas_events.put_nowait(sentinel)
    client = TestClient(app)

    response = client.post("/api/v1/canvas/push", json=envelope)

    assert response.status_code == 422
    assert response.json() == {
        "code": "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN",
        "detail": "Task Canvas contract는 signed selector dispatch에서만 생성할 수 있다",
    }
    assert app.state.canvas_events.qsize() == 1
    assert app.state.canvas_events.get_nowait() == sentinel


@pytest.mark.parametrize(
    "alias",
    [
        "envelope_version",
        "envelopeVersion",
        "view_recipe",
        "viewRecipe",
        "presentation_contract",
        "presentationContract",
        "view_instance_id",
        "viewInstanceId",
        "semantic_observations",
        "semanticObservations",
        "realtime_bindings",
        "realtimeBindings",
        "field_contract",
        "fieldContract",
        "coverage_receipt",
        "coverageReceipt",
    ],
)
def test_generic_push_rejects_every_nested_semantic_contract_alias(alias):
    app = _app()
    client = TestClient(app)

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "data": {"outer": {alias: {"forged": True}}},
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN"
    assert app.state.canvas_events.empty()


def test_generic_task_canvas_rejection_precedes_queue_readiness_check():
    client = TestClient(_app(with_queue=False))

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "data": {"presentationContract": {"sections": []}},
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN"


def test_push_fail_closed_without_queue():
    client = TestClient(_app(with_queue=False))
    response = client.post("/api/v1/canvas/push", json={"canvas_type": "chart"})
    assert response.status_code == 503


def test_push_drops_oldest_when_full():
    app = _app(maxsize=2)
    client = TestClient(app)
    for i in range(3):
        client.post("/api/v1/canvas/push", json={"canvas_type": "chart", "n": i})
    first = app.state.canvas_events.get_nowait()
    second = app.state.canvas_events.get_nowait()
    assert [first["n"], second["n"]] == [1, 2]  # 최신이 이긴다 — 0이 버려졌다


def test_ws_loopback_receives_pushed_envelope():
    app = _app()
    app.state.canvas_events.put_nowait({"canvas_type": "table", "data": {"rows": []}})
    client = TestClient(app)
    with client.websocket_connect("/api/v1/ws/canvas") as ws:
        assert ws.receive_json() == {"type": "feed-ready", "feed": "canvas"}
        message = ws.receive_json()
    assert message["canvas_type"] == "table"


def test_ws_without_queue_closes_1013():
    client = TestClient(_app(with_queue=False))
    try:
        with client.websocket_connect("/api/v1/ws/canvas") as ws:
            ws.receive_json()
        raise AssertionError("1013으로 닫혀야 한다")
    except WebSocketDisconnect as exc:
        assert exc.code == 1013


def test_ws_auth_reject_closes_before_feed_ready():
    client = TestClient(_app(token="sekrit"))
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/ws/canvas") as ws:
            ws.send_json({"type": "auth", "token": "wrong"})
            ws.receive_json()
    assert exc_info.value.code == 1008


def test_generic_push_carries_the_board_surface_contract_and_keeps_the_gate():
    """표면 계약은 봉투에 실리되 신뢰 경계는 그대로다(핸드오프 §3).

    - 카드 의도를 밝힌 봉투에는 서버가 파생한 `surface_contract`가 붙는다.
      추출물이 아직 없으므로 현재 값은 None이고, 보드가 저작되면 같은 자리에 온다.
    - 카드 의도를 밝히지 않은 봉투에는 여전히 아무 계약도 붙지 않는다 —
      canonical operation_ref만으로 파생을 넓히지 않는다.
    """

    app = _app()
    client = TestClient(app)

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "operation_ref": "base:ka10060",
            "card_id": "CC-03",
            "data": {"stk_cd": "005930"},
        },
    )
    assert response.status_code == 200
    queued = app.state.canvas_events.get_nowait()
    assert "surface_contract" in queued
    # 추출이 진행 중이라 값은 시간에 따라 변한다 — 서버 파생물과 같다는 것만 고정한다.
    assert queued["surface_contract"] == _integrated_card_contract(
        "base:ka10060"
    )["surface_contract"]

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "operation_ref": "base:ka10060",
            "data": {"stk_cd": "005930"},
        },
    )
    assert response.status_code == 200
    assert "surface_contract" not in app.state.canvas_events.get_nowait()


def test_generic_push_rejects_a_forged_surface_contract():
    """호출자가 지어낸 보드 표면은 canonical과 대조돼 422로 막힌다."""

    app = _app()
    client = TestClient(app)

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "operation_ref": "base:ka10060",
            "card_id": "CC-03",
            "surface_contract": {
                "board_id": "FORGED-1",
                "slot_values": [{"slot_id": "s1", "value": "위조"}],
            },
            "data": {"stk_cd": "005930"},
        },
    )

    assert response.status_code == 422
    assert response.json()["mismatched_fields"] == ["surface_contract"]
    assert app.state.canvas_events.empty()


def test_surface_contract_alone_still_needs_a_canonical_operation_ref():
    app = _app()
    client = TestClient(app)

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "surface_contract": {"board_id": "FORGED-1"},
            "data": {"stk_cd": "005930"},
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "통합 카드 envelope에는 canonical operation_ref가 필요하다"
    }
    assert app.state.canvas_events.empty()


def test_generic_push_rejects_a_nested_or_camelcase_board_surface():
    """중첩·camelCase 표면은 대조 경로가 없다 — 최상위 한 자리만 허용한다.

    프론트 보드 마운트가 `surfaceContract` 폴백을 읽으므로(app/canvas.js), 이 이름이
    범용 채널로 들어오면 호출자 데이터가 Paper 보드 외형으로 그대로 그려진다.
    """

    app = _app()
    client = TestClient(app)

    for envelope in (
        {"canvas_type": "facts", "surfaceContract": {"board_id": "FORGED-1"}},
        {
            "canvas_type": "facts",
            "data": {"surface_contract": {"board_id": "FORGED-1"}},
        },
        {
            "canvas_type": "facts",
            "data": {"rows": [{"payload": {"surfaceContract": {"slot_values": []}}}]},
        },
        {
            "canvas_type": "facts",
            "initial_surface_contract": {
                "board_id": "FORGED-INITIAL",
                "slot_values": [{"slot_id": "s006", "value": "위조"}],
            },
        },
        {
            "canvas_type": "facts",
            "data": {
                "rows": [
                    {
                        "payload": {
                            "initialSurfaceContract": {"board_id": "FORGED-INITIAL"}
                        }
                    }
                ]
            },
        },
    ):
        response = client.post("/api/v1/canvas/push", json=envelope)
        assert response.status_code == 422
        assert response.json()["code"] == "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN"

    assert app.state.canvas_events.empty()


# -- 보드 하이드레이션(D2 fetch-set) ---------------------------------------

_SURFACE_FIXTURE_ROOT = (
    Path(__file__).resolve().parents[1] / "fixtures" / "card-surface"
)
_KA10085_BODY = {
    "acnt_prft_rt": [
        {
            "dt": "20260902",
            "stk_cd": "005930",
            "stk_nm": "삼성전자",
            "cur_prc": "71000",
            "pur_pric": "68000",
            "pur_amt": "6800000",
            "rmnd_qty": "100",
        }
    ]
}
_KT00003_BODY = {"prsm_dpst_aset_amt": "12340000"}
_HYDRATE_TARGET = {"stex_tp": "0", "qry_tp": "1", "stk_cd": "005930"}


class _DataSpy:
    """조회 클라이언트 대역 — TR별 응답과 실패를 지정한다."""

    is_ready = True

    def __init__(self, bodies: dict, failing: set[str] | None = None) -> None:
        self.bodies = bodies
        self.failing = failing or set()
        self.calls: list[str] = []

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append(tr_id)
        if tr_id in self.failing:
            raise KiwoomApiError("500", "upstream refused", 500)
        return ResponseEnvelope(body=self.bodies.get(tr_id, {}), cont_yn="N", next_key=None)


@pytest.fixture
def surface_templates(tmp_path, monkeypatch):
    """픽스처 보드를 프로덕션 트리 자리에 세운다(테스트 격리 + 캐시 정리)."""

    from athena_api import card_surface_templates as templates

    root = tmp_path / "card-surface"
    shutil.copytree(_SURFACE_FIXTURE_ROOT, root)
    monkeypatch.setattr(templates, "TEMPLATE_ROOT", root)
    templates.get_registry.cache_clear()
    try:
        yield root
    finally:
        templates.get_registry.cache_clear()


def _add_operation_ref(root: Path, board_id: str, operation_ref: str) -> None:
    path = root / board_id / "slots.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["operation_refs"].append(operation_ref)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="",
    )


def _bind_slot(
    root: Path, board_id: str, slot_id: str, operation_ref: str, field: str
) -> None:
    path = root / board_id / "slots.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    slot = next(entry for entry in payload["slots"] if entry["slot_id"] == slot_id)
    slot["mapping_id"] = operation_ref
    slot["f"] = field
    slot["node_name"] = f"mapping|{operation_ref}"
    slot["anchor"] = {
        "kind": "raw",
        "tr": operation_ref.split(":")[1],
        "section": "body",
        "field": field,
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="",
    )


def _bind_composite_slot(root: Path, board_id: str, slot_id: str) -> None:
    path = root / board_id / "slots.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    slot = next(entry for entry in payload["slots"] if entry["slot_id"] == slot_id)
    slot["mapping_id"] = None
    slot["f"] = None
    slot["composite"] = {
        "separator": " / ",
        "parts": [
            {"mapping_id": "base:ka10085", "f": "acnt_prft_rt", "format": {}},
            {
                "mapping_id": "base:kt00003",
                "f": "prsm_dpst_aset_amt",
                "format": {},
            },
        ],
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="",
    )


def _hydrate_app(data: _DataSpy, token: str = "board-hydrate-token"):
    app = _app(token=token)
    app.state.kiwoom_client = data
    return app


def _hydrate(client: TestClient, token: str = "board-hydrate-token", **body):
    return client.post(
        "/api/v1/internal/canvas/board-hydrate",
        json={"board_id": "2SKU-1", "target": _HYDRATE_TARGET, **body},
        headers={"Authorization": f"Bearer {token}"},
    )


def _statuses(payload: dict) -> dict:
    return {entry["operation_ref"]: entry for entry in payload["operations"]}


def test_board_hydrate_requires_the_local_bearer(surface_templates):
    client = TestClient(_hydrate_app(_DataSpy({})))

    response = client.post(
        "/api/v1/internal/canvas/board-hydrate",
        json={"board_id": "2SKU-1", "target": {}},
    )

    assert response.status_code == 401


def test_board_hydrate_404s_for_a_board_with_no_surface_template(surface_templates):
    client = TestClient(_hydrate_app(_DataSpy({})))

    response = _hydrate(client, board_id="NOT-A-BOARD")

    assert response.status_code == 404


def test_board_hydrate_fills_the_slots_from_every_read_operation(surface_templates):
    """D2 — 보드의 operation_refs 전부를 읽어 한 표면 계약으로 합친다."""

    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["board_id"] == "2SKU-1"
    assert payload["card_id"] == "CC-01"
    assert sorted(data.calls) == ["ka10085", "kt00003"]
    statuses = _statuses(payload)
    assert statuses["base:ka10085"]["status"] == "bound"
    assert statuses["base:kt00003"]["status"] == "bound"
    contract = payload["surface_contract"]
    values = {entry["slot_id"]: entry["value"] for entry in contract["slot_values"]}
    # 한 자리에만 그려진 배열 잎은 첫 원소로 채워지고, 잎 둘이 나눠 쓰는 열은
    # 행을 못 정해 미제공으로 남는다(card_surface_contract의 첫 원소 규칙).
    assert values["col_stk_nm"] == "삼성전자"
    assert values["kpi_prsm_dpst_aset_amt"] == "12340000"
    assert "col_cur_prc" in contract["unbound_slots"]


def test_board_hydrate_fetches_only_operations_used_by_requested_slots(
    surface_templates,
):
    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client, slot_ids=["kpi_prsm_dpst_aset_amt", "s001"])

    assert response.status_code == 200, response.text
    assert data.calls == ["kt00003"]
    assert list(_statuses(response.json())) == ["base:kt00003"]


def test_board_hydrate_empty_slot_plan_makes_no_upstream_call(surface_templates):
    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client, slot_ids=[])

    assert response.status_code == 200, response.text
    assert data.calls == []
    assert response.json()["operations"] == []


@pytest.fixture
def gold_surface_registry(monkeypatch):
    from athena_api.api import canvas_push
    from athena_api.card_surface_templates import load_registry

    registry = load_registry(strict=False)
    assert "2RJ7-1" in registry.boards
    monkeypatch.setattr(canvas_push, "get_card_surface_registry", lambda: registry)
    return registry


@pytest.mark.parametrize("slot_ids", [[], ["s052"]])
def test_gold_hydrate_loads_chart_even_when_quote_slots_are_already_filled(
    gold_surface_registry, slot_ids
):
    data = _DataSpy({
        "ka50100": {"pred_close_pric": "191170"},
        "ka50092": {"gds_min_chart_qry": [{
            "cntr_tm": "20260909134400", "dt": "20260909134400",
            "cntr_pric": "-188910", "open_pric": "-188900",
            "high_pric": "-188930", "low_pric": "-188890", "trde_qty": "12",
        }]},
    })
    response = _hydrate(
        TestClient(_hydrate_app(data)), board_id="2RJ7-1",
        target={"stk_cd": "M04020000"}, slot_ids=slot_ids,
    )

    assert response.status_code == 200, response.text
    primary = response.json()["primary_envelope"]
    assert data.calls.count("ka50092") == 1
    assert set(data.calls) <= {"ka50092", "ka50100"}
    assert primary["operation_ref"] == "base:ka50092"
    assert primary["operation_args"] == {"stk_cd": "M04020000", "tic_scope": "1"}
    assert primary["renderer_id"] == "aits-chart-v1"
    assert primary["data"]["symbol"] == "M04020000"
    assert primary["data"]["chart"]["target"] == "gold"
    candles = primary["data"]["chart"]["candles"]
    assert len(candles) == 1
    assert candles[0]["close"] == 188910
    assert candles[0]["volume"] == 12
    meta = primary["data"]["chart_meta"]
    assert meta["series_scope"] == "today"
    assert meta["reload_group"] == "gold-today"
    assert meta["reload_targets"]["min"]["operation_ref"] == "base:ka50092"


def test_gold_hydrate_does_not_invent_candles_when_chart_read_fails(gold_surface_registry):
    data = _DataSpy({}, failing={"ka50092"})
    response = _hydrate(
        TestClient(_hydrate_app(data)), board_id="2RJ7-1",
        target={"stk_cd": "M04020000"}, slot_ids=[],
    )

    assert response.status_code == 200, response.text
    assert data.calls == ["ka50092"]
    payload = response.json()
    assert payload["primary_envelope"] is None
    assert _statuses(payload)["base:ka50092"]["reason"] == "upstream_error"


def test_board_hydrate_rejects_unknown_requested_slot(surface_templates):
    client = TestClient(_hydrate_app(_DataSpy({})))

    response = _hydrate(client, slot_ids=["not-a-real-slot"])

    assert response.status_code == 422


def test_board_hydrate_fetch_plan_includes_alt_and_composite_sources(
    surface_templates,
):
    _bind_composite_slot(surface_templates, "2SKU-1", "kpi_acnt_prft_rt")
    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    alt = _hydrate(client, board_id="2SKU-1-T1", slot_ids=["t1_kpi_summary"])
    assert alt.status_code == 200, alt.text
    assert sorted(data.calls) == ["ka10085", "kt00003"]

    data.calls.clear()
    composite = _hydrate(client, slot_ids=["kpi_acnt_prft_rt"])
    assert composite.status_code == 200, composite.text
    assert sorted(data.calls) == ["ka10085", "kt00003"]


def test_board_hydrate_successful_empty_slot_is_settled_on_next_roundtrip(
    surface_templates,
):
    data = _DataSpy({"kt00003": {}})
    client = TestClient(_hydrate_app(data))

    first = _hydrate(client, slot_ids=["kpi_prsm_dpst_aset_amt"])
    pending = first.json()["surface_contract"]["hydration_slot_ids"]
    second = _hydrate(client, slot_ids=pending)

    assert first.status_code == second.status_code == 200
    assert pending == []
    assert data.calls == ["kt00003"]


def test_board_hydrate_failed_slot_remains_pending_for_one_retry(surface_templates):
    data = _DataSpy({}, failing={"kt00003"})
    client = TestClient(_hydrate_app(data))

    first = _hydrate(client, slot_ids=["kpi_prsm_dpst_aset_amt"])
    pending = first.json()["surface_contract"]["hydration_slot_ids"]
    second = _hydrate(client, slot_ids=pending)

    assert first.status_code == second.status_code == 200
    assert pending == ["kpi_prsm_dpst_aset_amt"]
    assert data.calls == ["kt00003", "kt00003"]


def test_board_hydrate_fetches_one_actual_tr_once_for_multiple_detail_groups(
    surface_templates,
):
    """ka10001 detail group들은 같은 요청/응답을 공유하므로 upstream은 한 번만 친다."""

    detail_refs = (
        "detail:ka10001:current_trading",
        "detail:ka10001:daily_price_band",
    )
    for operation_ref in detail_refs:
        _add_operation_ref(surface_templates, "2SKU-1", operation_ref)
    _bind_slot(
        surface_templates,
        "2SKU-1",
        "kpi_acnt_prft_rt",
        detail_refs[0],
        "pred_pre",
    )
    _bind_slot(
        surface_templates,
        "2SKU-1",
        "kpi_prsm_dpst_aset_amt",
        detail_refs[1],
        "open_pric",
    )
    data = _DataSpy(
        {
            "ka10085": _KA10085_BODY,
            "kt00003": _KT00003_BODY,
            "ka10001": {
                "cur_prc": "71000",
                "pred_pre": "1000",
                "flu_rt": "1.43",
                "open_pric": "70000",
                "high_pric": "72000",
                "low_pric": "69500",
            },
        }
    )
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    assert data.calls.count("ka10001") == 1
    statuses = _statuses(response.json())
    assert all(statuses[operation_ref]["status"] == "bound" for operation_ref in detail_refs)


def test_board_hydrate_does_not_retry_one_failed_tr_for_each_detail_group(
    surface_templates,
):
    detail_refs = (
        "detail:ka10001:current_trading",
        "detail:ka10001:daily_price_band",
    )
    for operation_ref in detail_refs:
        _add_operation_ref(surface_templates, "2SKU-1", operation_ref)
    _bind_slot(
        surface_templates,
        "2SKU-1",
        "kpi_acnt_prft_rt",
        detail_refs[0],
        "pred_pre",
    )
    _bind_slot(
        surface_templates,
        "2SKU-1",
        "kpi_prsm_dpst_aset_amt",
        detail_refs[1],
        "open_pric",
    )
    data = _DataSpy(
        {"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY},
        failing={"ka10001"},
    )
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    assert data.calls.count("ka10001") == 1
    statuses = _statuses(response.json())
    assert all(
        statuses[operation_ref]["reason"] == "upstream_error"
        for operation_ref in detail_refs
    )


def test_board_hydrate_leaves_only_the_failing_operations_slots_unbound(
    surface_templates,
):
    """부분 실패 — 실패한 op의 슬롯만 미제공이고 나머지 값은 그대로 산다."""

    data = _DataSpy({"ka10085": _KA10085_BODY}, failing={"kt00003"})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    payload = response.json()
    statuses = _statuses(payload)
    assert statuses["base:ka10085"]["status"] == "bound"
    assert statuses["base:kt00003"] == {
        "operation_ref": "base:kt00003",
        "status": "unbound",
        "reason": "upstream_error",
    }
    contract = payload["surface_contract"]
    values = {entry["slot_id"]: entry["value"] for entry in contract["slot_values"]}
    # 잎 둘이 나눠 쓰는 배열 열은 행을 못 정해 미제공으로 남는다(첫 원소 규칙은
    # 한 자리에만 그려진 잎에만 적용된다 — card_surface_contract 참고).
    assert "col_cur_prc" not in values
    assert "col_cur_prc" in contract["unbound_slots"]
    assert "kpi_prsm_dpst_aset_amt" in contract["unbound_slots"]


def test_board_hydrate_reports_an_operation_whose_arguments_are_unmappable(
    surface_templates,
):
    """인자 매핑은 manifest request alias 기준 — 못 채우면 호출하지 않는다.

    필수 인자 중 **조회 대상**(종목코드 등)은 기본값 표에 없다 — 화면이 지목하는
    값이라 지어낼 수 없다(:mod:`athena_api.hydrate_defaults`). 그 자리가 비면 op는
    호출되지 않고 사유가 남는다. 조회 조건(정렬·시장 구분)은 반대로 기본값이 채운다.
    """

    _add_operation_ref(surface_templates, "2SKU-1", "base:ka10081")
    _bind_slot(surface_templates, "2SKU-1", "col_stk_nm", "base:ka10081", "cur_prc")
    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client, target={"stex_tp": "0"})

    assert response.status_code == 200, response.text
    statuses = _statuses(response.json())
    # 조회 조건(qry_tp)은 기본값이 채워 호출된다.
    assert statuses["base:kt00003"]["status"] == "bound"
    assert statuses["base:ka10085"]["status"] == "bound"
    # 조회 대상(stk_cd)은 기본값이 없다 — 그 op만 호출되지 않는다.
    assert statuses["base:ka10081"]["reason"] == "arguments_unmapped:stk_cd"
    assert "ka10081" not in data.calls


def test_board_hydrate_never_calls_an_order_operation(surface_templates):
    """보드가 주문 op를 가리켜도 하이드레이션은 읽기다 — 절대 호출하지 않는다."""

    _add_operation_ref(surface_templates, "2SKU-1", "base:kt10000")
    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    statuses = _statuses(response.json())
    assert "base:kt10000" not in statuses
    assert "kt10000" not in data.calls


def test_board_hydrate_fills_an_alt_slot_from_the_operation_that_answered(
    surface_templates,
):
    """대체 바인딩 — 보드 계약을 만드는 헬퍼가 REST 하이드레이션에서도 그대로 쓰인다.

    탭 보드의 요약 KPI는 주 바인딩(`base:ka10085`의 `acnt_prft_rt`)이 스칼라 값을
    싣고 오지 않으면 대체 매핑(`base:kt00003`)이 답한 값을 그린다.
    """

    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client, board_id="2SKU-1-T1")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["board_id"] == "2SKU-1-T1"
    contract = payload["surface_contract"]
    entry = next(
        item for item in contract["slot_values"] if item["slot_id"] == "t1_kpi_summary"
    )
    assert entry["value"] == "12340000"
    assert entry["occurrence_id"] == "base:kt00003|$.prsm_dpst_aset_amt|1"
    # 한 열의 셀은 제 행의 값만 가져간다(응답이 1행이면 둘째 행은 미제공).
    values = {item["slot_id"]: item["value"] for item in contract["slot_values"]}
    assert values["t1_stk_nm_r0"] == "삼성전자"
    assert "t1_stk_nm_r1" in contract["unbound_slots"]


def test_board_hydrate_carries_the_state_board_control_text(surface_templates):
    """상태 보드 링크는 화면에 있는 글자를 같이 싣는다 — 프론트가 조작 잎을 찾는 열쇠."""

    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    contract = _hydrate(client).json()["surface_contract"]

    assert contract["state_boards"] == [
        {
            "board_id": "2SKU-1-T1",
            "kind": "tab",
            "control": "tab|시간외 단일가",
            "control_text": "시간외 단일가",
        },
        {
            "board_id": "2SKU-1-X1",
            "kind": "expand",
            "control": "row-expand|보유 종목",
            "control_text": "보유 종목",
        },
    ]


def test_generic_push_carries_the_initial_state_board_for_the_quote_operation():
    """시세 op의 봉투는 기본 보드와 함께 곧바로 갈아탈 탭 보드를 싣는다.

    CC-03 기본 보드(137X-2)는 차트 화면이고, 시세 값을 그 op로 더 그리는 탭은
    현재시세(2R3M-1)다. 프론트가 기본 보드를 세운 뒤 이 값으로 갈아탄다 —
    기준 보드(`board_id`)는 그대로라 탭 레일이 산다.
    """

    app = _app()
    client = TestClient(app)

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "operation_ref": "detail:ka10001:current_trading",
            "card_id": "CC-03",
            "data": {"stk_cd": "005930"},
        },
    )

    assert response.status_code == 200
    contract = app.state.canvas_events.get_nowait()["surface_contract"]
    assert contract["board_id"] == "137X-2"
    assert contract["initial_state_board"] == "2R3M-1"


def test_board_hydrate_never_names_an_initial_state_board(surface_templates):
    """보드를 직접 지정해 만든 계약에는 갈아탈 보드가 없다 — 이미 그 보드에 있다."""

    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    contract = _hydrate(client).json()["surface_contract"]

    assert contract["initial_state_board"] is None


def test_board_hydrate_blanks_slots_the_answered_operation_did_not_carry(
    surface_templates,
):
    """정상으로 답한 조회가 싣지 않은 값은 결측어가 아니라 빈 칸이다.

    결측어는 「물어볼 수 없었다」(호출 안 됨·업스트림 실패)에만 남는다.
    """

    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": {}})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    payload = response.json()
    statuses = _statuses(payload)
    assert statuses["base:kt00003"]["status"] == "bound"
    contract = payload["surface_contract"]
    # kt00003이 답했지만 예수금을 싣지 않았다 — 그 자리는 빈 칸이다.
    assert "kpi_prsm_dpst_aset_amt" in contract["empty_value_slots"]
    assert "kpi_prsm_dpst_aset_amt" in contract["unbound_slots"]
