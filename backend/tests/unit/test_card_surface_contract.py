"""표면 계약 파생 — 값 바인딩·미제공 슬롯·상태 보드 링크.

값은 `canvas_push._bind_semantic_values`와 **같은** JSONPath 평가기·같은 occurrence
식별자를 쓴다. 두 경로가 갈리면 카드 값과 보드 값이 어긋나므로 그 동일성을 여기서
고정한다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from athena_api.api import canvas_push
from athena_api.card_surface_contract import (
    attach_surface_contract,
    bind_surface_values,
    build_board_surface_contract,
    build_surface_contract,
    json_path_values,
    resolve_section_titles_ko,
)
from athena_api.card_surface_templates import (
    SurfaceUniverse,
    load_registry,
    visible_occurrence_ids,
)

FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "card-surface"
FIXTURE_OPERATIONS = (
    "base:ka10085",
    "base:kt00003",
    "detail:ka10087:sell_bid_prices",
)

SOURCE = {
    "acnt_prft_rt": [
        {
            "dt": "20260902",
            "stk_cd": "005930",
            "stk_nm": "삼성전자",
            "cur_prc": "71000",
            "pur_pric": "68000",
            "pur_amt": "6800000",
            "rmnd_qty": "100",
        },
        {
            "dt": "20260902",
            "stk_cd": "000660",
            "stk_nm": "SK하이닉스",
            "cur_prc": "185000",
            "pur_pric": "170000",
            "pur_amt": "1700000",
            "rmnd_qty": "10",
        },
    ]
}


@pytest.fixture(scope="module")
def registry():
    universe = SurfaceUniverse(
        operation_refs=frozenset(FIXTURE_OPERATIONS),
        visible_occurrence_ids=visible_occurrence_ids(FIXTURE_OPERATIONS),
    )
    return load_registry(FIXTURE_ROOT, universe=universe)


def _by_slot(contract: dict) -> dict:
    return {entry["slot_id"]: entry for entry in contract["slot_values"]}


def test_contract_binds_array_columns_as_whole_columns(registry) -> None:
    bound = bind_surface_values("base:ka10085", SOURCE)
    contract = build_surface_contract("base:ka10085", bound, registry)

    values = _by_slot(contract)
    assert values["col_stk_nm"]["value"] == ["삼성전자", "SK하이닉스"]
    assert values["col_cur_prc"]["value"] == ["71000", "185000"]
    assert values["col_cur_prc"]["occurrence_id"] == (
        "base:ka10085|$.acnt_prft_rt[].cur_prc|1"
    )
    assert values["col_cur_prc"]["format"] == {
        "unit": "원",
        "sign": "plain",
        "precision": 0,
        "tone": "neutral",
    }
    assert values["col_stk_nm"]["layer"] == "직접"


def test_contract_reports_slots_the_payload_did_not_supply(registry) -> None:
    """D2 — op가 일부만 오면 그 슬롯만 미제공이고 나머지는 그대로 산다."""

    bound = bind_surface_values("base:ka10085", SOURCE)
    contract = build_surface_contract("base:ka10085", bound, registry)

    assert "col_stk_nm" in _by_slot(contract)
    # 다른 op(base:kt00003)의 KPI와 아직 안 온 열은 미제공으로 남는다.
    assert "kpi_prsm_dpst_aset_amt" in contract["unbound_slots"]
    assert set(contract["unbound_slots"]).isdisjoint(_by_slot(contract))


def test_contract_carries_state_boards_column_priority_and_section_titles(
    registry,
) -> None:
    contract = build_surface_contract("base:ka10085", {}, registry)

    assert contract["board_id"] == "2SKU-1"
    assert contract["card_id"] == "CC-01"
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
    assert contract["column_priority"][0] == "col_dt"
    assert contract["section_titles_ko"]["positions-and-performance"] == "보유 종목"
    assert contract["slot_values"] == []
    assert len(contract["unbound_slots"]) == len(registry.boards["2SKU-1"].slots)


def test_contract_is_none_for_an_operation_without_a_board(registry) -> None:
    assert build_surface_contract("base:ka10060", {}, registry) is None
    assert resolve_section_titles_ko("base:ka10060", registry=registry) == {}


def test_attach_puts_the_contract_on_the_card_metadata(registry) -> None:
    card_contract: dict = {}

    attach_surface_contract(card_contract, "base:ka10085", SOURCE, registry=registry)

    assert card_contract["surface_contract"]["board_id"] == "2SKU-1"
    assert _by_slot(card_contract["surface_contract"])["col_stk_nm"]["value"] == [
        "삼성전자",
        "SK하이닉스",
    ]


def test_attach_without_a_source_produces_the_value_free_skeleton(registry) -> None:
    """봉투 파생 시점의 골격 — REST/MCP가 같은 바이트를 만들어야 게이트가 산다."""

    rest: dict = {}
    mcp: dict = {}

    attach_surface_contract(rest, "base:ka10085", registry=registry)
    attach_surface_contract(mcp, "base:ka10085", None, registry=registry)

    assert rest == mcp
    assert rest["surface_contract"]["slot_values"] == []


def test_slot_values_carry_the_same_observation_id_as_realtime_bindings(
    registry,
) -> None:
    """실시간 프레임이 보드 슬롯을 찾는 유일한 이음매 — 같은 occurrence면 같은 문자열.

    봉투는 ``realtime_bindings``에 binding_id ↔ observation_id를 싣고, 표면 계약은
    슬롯마다 observation_id를 싣는다. 두 값이 다른 규칙으로 만들어지면 실시간
    갱신이 조용히 아무 잎도 못 고친다.
    """

    bound = bind_surface_values("base:ka10085", SOURCE)
    contract = build_surface_contract("base:ka10085", bound, registry)
    values = _by_slot(contract)

    entry = values["col_cur_prc"]
    assert entry["observation_id"] == canvas_push._observation_id(
        entry["occurrence_id"]
    )
    assert entry["observation_id"].startswith("obs_")
    # 같은 occurrence를 가리키는 병기 슬롯은 같은 관찰을 가리킨다(하나의 실시간
    # 프레임이 주값과 병기를 함께 고친다).
    assert (
        values["col_cur_prc_paired"]["observation_id"] == entry["observation_id"]
    )
    # 서로 다른 occurrence는 서로 다른 관찰이다.
    assert values["col_pur_pric"]["observation_id"] != entry["observation_id"]
    assert all("observation_id" in item for item in contract["slot_values"])


def test_row_indexed_slot_observation_matches_the_array_row_observation(
    registry,
) -> None:
    """행 슬롯은 그 행의 관찰(``row:N``)을 가리킨다 — 열 전체(scalar)가 아니다."""

    from athena_api.card_surface_contract import observation_id_for

    occurrence = "base:ka10085|$.acnt_prft_rt[].cur_prc|1"
    assert observation_id_for(occurrence, 1) == canvas_push._observation_id(
        occurrence, 1
    )
    assert observation_id_for(occurrence, 1) != observation_id_for(occurrence)


def test_binding_uses_the_same_path_evaluator_as_semantic_observations() -> None:
    assert canvas_push._json_path_values is json_path_values
    assert json_path_values(SOURCE, "$.acnt_prft_rt[].stk_cd") == ["005930", "000660"]
    assert json_path_values(SOURCE, "$.missing") == []
    assert json_path_values(SOURCE, "$") == [SOURCE]


def test_binding_drops_container_values_like_semantic_observations() -> None:
    bound = bind_surface_values("base:ka10085", SOURCE)

    # `$.acnt_prft_rt` 스칼라 경로는 리스트를 만나므로 값이 되지 않는다.
    assert "base:ka10085|$.acnt_prft_rt|1" not in bound
    assert bound["base:ka10085|$.acnt_prft_rt[].dt|1"] == ["20260902", "20260902"]


def test_board_contract_merges_values_from_every_operation_of_the_board(
    registry,
) -> None:
    """D2 fetch-set — 보드 하나가 여러 op의 값을 한 표면에 모은다."""

    bound = {
        **bind_surface_values("base:ka10085", SOURCE),
        **bind_surface_values("base:kt00003", {"prsm_dpst_aset_amt": "12340000"}),
    }
    contract = build_board_surface_contract("2SKU-1", bound, registry)

    values = _by_slot(contract)
    assert values["col_stk_nm"]["value"] == ["삼성전자", "SK하이닉스"]
    assert values["kpi_prsm_dpst_aset_amt"]["value"] == "12340000"
    assert "kpi_prsm_dpst_aset_amt" not in contract["unbound_slots"]


def test_board_contract_addresses_a_state_board_an_operation_would_not_choose(
    registry,
) -> None:
    """op로 되찾으면 default 보드다 — 펼침 보드는 board_id로만 지목할 수 있다."""

    assert build_surface_contract("base:ka10085", {}, registry)["board_id"] == "2SKU-1"
    assert (
        build_board_surface_contract("2SKU-1-X1", {}, registry)["board_id"]
        == "2SKU-1-X1"
    )
    assert build_board_surface_contract("NOT-A-BOARD", {}, registry) is None


# -- 대체 바인딩·지시 열(A4 슬롯 확장) --------------------------------------

# 계좌 op 둘 다 답했을 때의 값 표. 대체 바인딩이 있는 잎은 이 둘 중 하나를 고른다.
BOTH_ACCOUNT_OPERATIONS = {
    "base:ka10085|$.acnt_prft_rt|1": "3.21",
    "base:kt00003|$.prsm_dpst_aset_amt|1": "12340000",
}


def test_an_alt_slot_takes_the_value_of_the_operation_that_answered(registry) -> None:
    """한 op만 답하면 그 잎은 답한 op의 값을 그린다 — 주·대체 어느 쪽이든."""

    only_alt = build_board_surface_contract(
        "2SKU-1-T1",
        {"base:kt00003|$.prsm_dpst_aset_amt|1": "12340000"},
        registry,
    )
    entry = _by_slot(only_alt)["t1_kpi_summary"]
    assert entry["value"] == "12340000"
    assert entry["occurrence_id"] == "base:kt00003|$.prsm_dpst_aset_amt|1"

    only_primary = build_board_surface_contract(
        "2SKU-1-T1", {"base:ka10085|$.acnt_prft_rt|1": "3.21"}, registry
    )
    assert _by_slot(only_primary)["t1_kpi_summary"]["value"] == "3.21"


def test_the_requested_operation_decides_which_mapping_fills_the_leaf(registry) -> None:
    """둘 다 답했으면 요청 op가 먼저다 — 그다음이 보드가 선언한 순서다."""

    by_request = build_board_surface_contract(
        "2SKU-1-T1", BOTH_ACCOUNT_OPERATIONS, registry, ("base:kt00003",)
    )
    assert _by_slot(by_request)["t1_kpi_summary"]["occurrence_id"] == (
        "base:kt00003|$.prsm_dpst_aset_amt|1"
    )

    # 요청 op를 안 밝히면 보드 선언 순서(ka10085가 먼저)가 정한다.
    by_board = build_board_surface_contract(
        "2SKU-1-T1", BOTH_ACCOUNT_OPERATIONS, registry
    )
    assert _by_slot(by_board)["t1_kpi_summary"]["occurrence_id"] == (
        "base:ka10085|$.acnt_prft_rt|1"
    )


def test_an_alt_slot_with_no_answer_at_all_stays_unbound(registry) -> None:
    contract = build_board_surface_contract("2SKU-1-T1", {}, registry)

    assert "t1_kpi_summary" in contract["unbound_slots"]
    assert "t1_kpi_summary" not in _by_slot(contract)


def test_the_observation_id_follows_the_mapping_that_actually_filled_the_leaf(
    registry,
) -> None:
    """실시간 프레임은 그 잎을 채운 관찰을 가리켜야 한다 — 주 바인딩이 아니라."""

    contract = build_board_surface_contract(
        "2SKU-1-T1", BOTH_ACCOUNT_OPERATIONS, registry, ("base:kt00003",)
    )

    entry = _by_slot(contract)["t1_kpi_summary"]
    assert entry["observation_id"] == canvas_push._observation_id(
        "base:kt00003|$.prsm_dpst_aset_amt|1"
    )


def test_indexed_column_cells_each_carry_their_own_occurrence(registry) -> None:
    """지시 열은 행마다 다른 필드다 — 한 열이지만 값도 관찰도 셀마다 다르다."""

    bound = {
        f"detail:ka10087:sell_bid_prices|$.ovt_sigpric_sel_bid_{index}|1": str(
            71000 + index * 100
        )
        for index in range(1, 6)
    }
    contract = build_board_surface_contract("2SKU-1-T1", bound, registry)

    values = _by_slot(contract)
    assert [values[f"t1_bid_r{row}"]["value"] for row in range(5)] == [
        "71100",
        "71200",
        "71300",
        "71400",
        "71500",
    ]
    assert len({values[f"t1_bid_r{row}"]["observation_id"] for row in range(5)}) == 5


def test_row_cells_of_one_column_take_their_own_row_from_the_column(registry) -> None:
    """열 하나가 여러 셀에 걸리면 셀은 `row_index`로 제 행의 값만 가져간다."""

    bound = bind_surface_values("base:ka10085", SOURCE)
    contract = build_board_surface_contract("2SKU-1-T1", bound, registry)

    values = _by_slot(contract)
    assert values["t1_stk_nm_r0"]["value"] == "삼성전자"
    assert values["t1_stk_nm_r1"]["value"] == "SK하이닉스"
    # 같은 열이라 관찰은 행 관찰(`row:N`)로 갈린다.
    assert values["t1_stk_nm_r0"]["observation_id"] == canvas_push._observation_id(
        "base:ka10085|$.acnt_prft_rt[].stk_nm|1", 0
    )
    assert (
        values["t1_stk_nm_r1"]["observation_id"]
        != values["t1_stk_nm_r0"]["observation_id"]
    )


def test_a_row_the_payload_never_sent_stays_unbound(registry) -> None:
    """응답이 1행이면 둘째 행 셀은 미제공이다 — 값을 지어내지 않는다."""

    one_row = {"acnt_prft_rt": SOURCE["acnt_prft_rt"][:1]}
    contract = build_board_surface_contract(
        "2SKU-1-T1", bind_surface_values("base:ka10085", one_row), registry
    )

    assert _by_slot(contract)["t1_stk_nm_r0"]["value"] == "삼성전자"
    assert "t1_stk_nm_r1" in contract["unbound_slots"]
