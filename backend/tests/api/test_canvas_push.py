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
    assert values["col_stk_nm"] == ["삼성전자"]
    assert values["kpi_prsm_dpst_aset_amt"] == "12340000"
    assert "col_stk_nm" not in contract["unbound_slots"]


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
    assert values["col_stk_nm"] == ["삼성전자"]
    assert "kpi_prsm_dpst_aset_amt" in contract["unbound_slots"]


def test_board_hydrate_reports_an_operation_whose_arguments_are_unmappable(
    surface_templates,
):
    """인자 매핑은 manifest request alias 기준 — 못 채우면 호출하지 않는다."""

    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client, target={"stex_tp": "0"})

    assert response.status_code == 200, response.text
    statuses = _statuses(response.json())
    assert statuses["base:ka10085"]["status"] == "bound"
    assert statuses["base:kt00003"]["reason"] == "arguments_unmapped:qry_tp"
    assert data.calls == ["ka10085"]


def test_board_hydrate_never_calls_an_order_operation(surface_templates):
    """보드가 주문 op를 가리켜도 하이드레이션은 읽기다 — 절대 호출하지 않는다."""

    _add_operation_ref(surface_templates, "2SKU-1", "base:kt10000")
    data = _DataSpy({"ka10085": _KA10085_BODY, "kt00003": _KT00003_BODY})
    client = TestClient(_hydrate_app(data))

    response = _hydrate(client)

    assert response.status_code == 200, response.text
    statuses = _statuses(response.json())
    assert statuses["base:kt10000"] == {
        "operation_ref": "base:kt10000",
        "status": "unbound",
        "reason": "order_operation_refused",
    }
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
