"""표면 계약 파생 — 값 바인딩·미제공 슬롯·상태 보드 링크.

값은 `canvas_push._bind_semantic_values`와 **같은** JSONPath 평가기·같은 occurrence
식별자를 쓴다. 두 경로가 갈리면 카드 값과 보드 값이 어긋나므로 그 동일성을 여기서
고정한다.
"""

from __future__ import annotations

import json
import shutil
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
    TEMPLATE_ROOT,
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


@pytest.mark.parametrize("board_id", ["137X-2", "2R3M-1", "2RBO-1", "3DI2-0", "3FR6-0"])
def test_stock_state_boards_keep_the_requested_instrument_name(board_id: str) -> None:
    registry = load_registry(TEMPLATE_ROOT)
    bound = bind_surface_values(
        "detail:ka10001:identity_and_capital", {"stk_cd": "066570", "stk_nm": "LG전자"}
    )
    contract = build_board_surface_contract(board_id, bound, registry)
    values = _by_slot(contract)
    assert values.get("s001", {}).get("value") == "LG전자"
    assert values.get("s002", {}).get("value") == "066570"


def test_ranking_row_code_and_price_follow_the_row_name_list() -> None:
    """한 순위 행의 이름·코드·현재가는 같은 목록 원소여야 한다.

    2V71-0 실측: 종목명은 ka90003 프로그램 순매수 1위(삼성전자)인데 코드·현재가는
    ka10034 외국인 매매 1위(252670_AL, -70)를 물었다.
    """

    registry = load_registry(TEMPLATE_ROOT)
    bound = {
        "base:ka90003|$.prm_netprps_upper_50[].stk_nm|1": ["삼성전자", "SK하이닉스"],
        "base:ka90003|$.prm_netprps_upper_50[].stk_cd|1": ["005930", "000660"],
        "base:ka90003|$.prm_netprps_upper_50[].cur_prc|1": ["269500", "1832000"],
        "base:ka10034|$.for_dt_trde_upper[].stk_cd|1": ["252670_AL", "114800_AL"],
        "base:ka10034|$.for_dt_trde_upper[].cur_prc|1": ["-70", "978"],
    }
    contract = build_board_surface_contract(
        "2V71-0",
        bound,
        registry,
        active_operation_refs=("base:ka90003", "base:ka10034"),
    )
    values = _by_slot(contract)
    assert values["s042"]["value"] == "삼성전자"
    assert values["s043"]["value"] == "005930"
    assert values["s043"]["occurrence_id"].startswith("base:ka90003|")
    assert values["s044"]["value"] == "269500"
    assert values["s044"]["occurrence_id"].startswith("base:ka90003|")


def _registry_with_composite(tmp_path: Path, parts: list[dict]):
    root = tmp_path / "card-surface"
    shutil.copytree(FIXTURE_ROOT, root)
    path = root / "2SKU-1-T1" / "slots.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    slot = next(
        item for item in payload["slots"] if item["slot_id"] == "t1_kpi_summary"
    )
    slot.update(
        {
            "mapping_id": None,
            "f": None,
            "alt_mappings": None,
            "composite": {"separator": " · ", "parts": parts},
        }
    )
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="",
    )
    universe = SurfaceUniverse(
        operation_refs=frozenset(FIXTURE_OPERATIONS),
        visible_occurrence_ids=visible_occurrence_ids(FIXTURE_OPERATIONS),
    )
    return load_registry(root, universe=universe)


def test_unindexed_array_leaf_takes_the_first_element_only_when_drawn_once(
    registry,
) -> None:
    """행 좌표 없는 배열 잎의 두 갈래.

    한 자리에만 그려진 잎은 응답 정렬의 **첫 원소**를 말한다. 반대로 같은 배열
    자리를 잎 여럿이 나눠 그리고 있으면(행 좌표를 잃은 열) 어느 잎이 어느 행인지
    알 수 없어 채우지 않는다 — 전부 첫 원소로 채우면 같은 값이 여러 줄 반복되는
    틀린 화면이 된다. 픽스처의 ``col_cur_prc``는 ``col_cur_prc_paired``와 같은
    occurrence를 나눠 쓴다.
    """

    bound = bind_surface_values("base:ka10085", SOURCE)
    contract = build_surface_contract("base:ka10085", bound, registry)

    values = _by_slot(contract)
    assert values["col_stk_nm"]["value"] == "삼성전자"
    assert "col_cur_prc" not in values
    assert "col_cur_prc" in contract["unbound_slots"]
    assert "col_cur_prc_paired" in contract["unbound_slots"]


def test_contract_reports_slots_the_payload_did_not_supply(registry) -> None:
    """D2 — op가 일부만 오면 그 슬롯만 미제공이고 나머지는 그대로 산다."""

    bound = bind_surface_values("base:ka10085", SOURCE)
    contract = build_surface_contract("base:ka10085", bound, registry)

    # 잎 여럿이 나눠 쓰는 배열 열과 다른 op(base:kt00003)의 KPI는 미제공으로 남는다.
    assert "col_cur_prc" in contract["unbound_slots"]
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
    assert "col_cur_prc" not in _by_slot(card_contract["surface_contract"])
    assert "col_cur_prc" in card_contract["surface_contract"]["unbound_slots"]


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
    contract = build_board_surface_contract("2SKU-1-T1", bound, registry)
    values = _by_slot(contract)

    entry = values["t1_stk_nm_r0"]
    assert entry["observation_id"] == canvas_push._observation_id(
        entry["occurrence_id"], 0
    )
    assert entry["observation_id"].startswith("obs_")
    # 같은 열이어도 다른 행은 서로 다른 관찰이다.
    assert values["t1_stk_nm_r1"]["observation_id"] != entry["observation_id"]
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


def test_authored_composite_carries_all_available_scalar_parts(tmp_path) -> None:
    registry = _registry_with_composite(
        tmp_path,
        [
            {
                "mapping_id": "base:kt00003",
                "f": "prsm_dpst_aset_amt",
                "format": {"unit": "원", "prefix": "예수금 "},
            },
            {
                "mapping_id": "detail:ka10087:sell_bid_prices",
                "f": "ovt_sigpric_sel_bid_1",
                "format": {"suffix": "원"},
            },
        ],
    )
    bound = {
        **bind_surface_values("base:kt00003", {"prsm_dpst_aset_amt": "12340000"}),
        **bind_surface_values(
            "detail:ka10087:sell_bid_prices", {"ovt_sigpric_sel_bid_1": "71000"}
        ),
    }

    contract = build_board_surface_contract(
        "2SKU-1-T1",
        bound,
        registry,
        ("detail:ka10087:sell_bid_prices", "base:kt00003"),
    )
    entry = _by_slot(contract)["t1_kpi_summary"]
    composite = entry["value"]["composite"]

    assert composite["separator"] == " · "
    assert [part["value"] for part in composite["parts"]] == ["12340000", "71000"]
    assert [part["mapping_id"] for part in composite["parts"]] == [
        "base:kt00003",
        "detail:ka10087:sell_bid_prices",
    ]
    assert composite["parts"][0]["format"] == {
        "unit": "원",
        "prefix": "예수금 ",
    }
    assert all(part["observation_id"] for part in composite["parts"])
    assert "occurrence_id" not in entry
    assert "observation_id" not in entry


def test_composite_is_unbound_when_any_part_is_missing(tmp_path) -> None:
    registry = _registry_with_composite(
        tmp_path,
        [
            {"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"},
            {
                "mapping_id": "detail:ka10087:sell_bid_prices",
                "f": "ovt_sigpric_sel_bid_1",
            },
        ],
    )
    bound = bind_surface_values(
        "base:kt00003", {"prsm_dpst_aset_amt": "12340000"}
    )

    contract = build_board_surface_contract("2SKU-1-T1", bound, registry)

    assert "t1_kpi_summary" not in _by_slot(contract)
    assert "t1_kpi_summary" in contract["unbound_slots"]


def test_composite_part_without_a_row_takes_the_first_element(tmp_path) -> None:
    """되풀이 밖에 한 번 그려진 part는 응답 정렬의 첫 원소를 말한다."""

    registry = _registry_with_composite(
        tmp_path,
        [
            {"mapping_id": "base:ka10085", "f": "stk_nm"},
            {"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"},
        ],
    )
    bound = {
        **bind_surface_values("base:ka10085", SOURCE),
        **bind_surface_values("base:kt00003", {"prsm_dpst_aset_amt": "12340000"}),
    }

    contract = build_board_surface_contract("2SKU-1-T1", bound, registry)

    parts = _by_slot(contract)["t1_kpi_summary"]["value"]["composite"]["parts"]
    assert [part["value"] for part in parts] == ["삼성전자", "12340000"]
    assert "t1_kpi_summary" not in contract["unbound_slots"]


def test_composite_is_unbound_when_an_unindexed_part_is_an_empty_array(
    tmp_path,
) -> None:
    """빈 목록은 값이 아니다 — 첫 원소 규칙도 빈 배열은 채우지 않는다."""

    registry = _registry_with_composite(
        tmp_path,
        [
            {"mapping_id": "base:ka10085", "f": "stk_nm"},
            {"mapping_id": "base:kt00003", "f": "prsm_dpst_aset_amt"},
        ],
    )
    bound = {
        **bind_surface_values("base:ka10085", {"acnt_prft_rt": []}),
        **bind_surface_values("base:kt00003", {"prsm_dpst_aset_amt": "12340000"}),
    }

    contract = build_board_surface_contract("2SKU-1-T1", bound, registry)

    assert "t1_kpi_summary" not in _by_slot(contract)
    assert "t1_kpi_summary" in contract["unbound_slots"]


def test_composite_support_does_not_change_indexed_scalar_entries(registry) -> None:
    bound = bind_surface_values("base:ka10085", SOURCE)

    entry = _by_slot(
        build_board_surface_contract("2SKU-1-T1", bound, registry)
    )["t1_stk_nm_r0"]

    assert entry["value"] == "삼성전자"
    assert entry["row_index"] == 0
    assert entry["occurrence_id"] == "base:ka10085|$.acnt_prft_rt[].stk_nm|1"


def test_current_quote_real_templates_keep_composites_and_trade_rows_aligned() -> None:
    """실제 깨짐을 만든 137X/2R3M 메타데이터를 합성·행 계약에 고정한다."""

    registry = load_registry(TEMPLATE_ROOT)
    source = {"pred_pre": "+1850", "flu_rt": "+1.24", "pre_sig": "2"}
    operation_ref = "detail:ka10001:current_trading"
    bound = bind_surface_values(operation_ref, source)

    default_contract = build_surface_contract(operation_ref, bound, registry)
    state_contract = build_board_surface_contract("2R3M-1", bound, registry)

    assert default_contract["board_id"] == "137X-2"
    assert default_contract["initial_state_board"] == "2R3M-1"
    for contract in (default_contract, state_contract):
        parts = _by_slot(contract)["s006"]["value"]["composite"]["parts"]
        assert [(part["f"], part["value"]) for part in parts] == [
            ("pred_pre", "+1850"),
            ("flu_rt", "+1.24"),
        ]
        assert all(part["f"] != "pre_sig" for part in parts)

    board = registry.boards["2R3M-1"]
    row_fields = {
        "tm",
        "cur_prc",
        "pred_pre",
        "pre_rt",
        "cntr_trde_qty",
        "stex_tp",
        "cntr_str",
    }
    for alias in row_fields:
        assert {
            slot.row_index
            for slot in board.slots
            if slot.mapping_id == "base:ka10003" and slot.f == alias
        } == set(range(9))

    side_slots = [board.slot(f"s{57 + row * 8:03d}") for row in range(9)]
    assert all(slot.kind == "value" and not slot.binds_a_field for slot in side_slots)
    assert all(slot.f != "cntr_infr" for slot in board.slots)

    trade_source = {
        "cntr_infr": [
            {
                "tm": f"0942{18 - row:02d}",
                "cur_prc": str(150_850 + row),
                "pred_pre": str(1_850 + row),
                "pre_rt": "1.24",
                "cntr_trde_qty": str(100 + row),
                "stex_tp": "KRX",
                "cntr_str": "108.4",
                "pri_sel_bid_unit": str(150_900 + row),
                "pri_buy_bid_unit": str(150_850 + row),
            }
            for row in range(9)
        ]
    }
    trade_bound = bind_surface_values("base:ka10003", trade_source)
    trade_contract = build_board_surface_contract(
        "2R3M-1", trade_bound, registry, ("base:ka10003",)
    )
    first_bid_ask = _by_slot(trade_contract)["s053"]["value"]["composite"]

    assert [part["f"] for part in first_bid_ask["parts"]] == [
        "pri_sel_bid_unit",
        "pri_buy_bid_unit",
    ]
    assert [part["value"] for part in first_bid_ask["parts"]] == [
        "150900",
        "150850",
    ]
    assert _by_slot(trade_contract)["s116"]["value"] == "094210"
    assert all(slot.slot_id in trade_contract["unbound_slots"] for slot in side_slots)

    daily_fields = (
        "date",
        "open_pric",
        "high_pric",
        "low_pric",
        "close_pric",
        "pre",
        "flu_rt",
        "trde_qty",
        "trde_prica",
        "frgn",
        "prm",
    )
    for row, first_slot in enumerate((216, 227, 238)):
        daily_slots = [board.slot(f"s{first_slot + column:03d}") for column in range(11)]
        assert [(slot.f, slot.row_index) for slot in daily_slots] == [
            (field, row) for field in daily_fields
        ]
        assert all(slot.mapping_id == "base:ka10005" for slot in daily_slots)

    daily_source = {
        "stk_ddwkmm": [
            {
                field: f"row-{row}-{field}"
                for field in daily_fields
            }
            for row in range(3)
        ]
    }
    daily_bound = bind_surface_values("base:ka10005", daily_source)
    daily_contract = build_board_surface_contract(
        "2R3M-1", daily_bound, registry, ("base:ka10005",)
    )
    daily_by_slot = _by_slot(daily_contract)
    assert daily_by_slot["s216"]["value"] == "row-0-date"
    assert daily_by_slot["s227"]["value"] == "row-1-date"
    assert daily_by_slot["s248"]["value"] == "row-2-prm"

    strength_source = {
        "cntr_str_tm": [
            {
                "cntr_tm": "090000",
                "cntr_str": "108.4",
                "cntr_str_5min": "111.2",
                "cntr_str_20min": "109.0",
                "cntr_str_60min": "106.5",
            },
            {
                "cntr_tm": "083000",
                "cntr_str": "99.9",
                "cntr_str_5min": "98.8",
                "cntr_str_20min": "97.7",
                "cntr_str_60min": "96.6",
            },
        ]
    }
    strength_bound = bind_surface_values("base:ka10046", strength_source)
    strength_contract = build_board_surface_contract(
        "2R3M-1", strength_bound, registry, ("base:ka10046",)
    )
    strength_by_slot = _by_slot(strength_contract)
    assert strength_by_slot["s129"]["value"] == "108.4"
    assert strength_by_slot["s130"]["value"] == "111.2"
    assert [
        part["value"]
        for part in strength_by_slot["s131"]["value"]["composite"]["parts"]
    ] == ["109.0", "106.5"]


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
    assert "col_cur_prc" not in values
    assert "col_cur_prc" in contract["unbound_slots"]
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


def test_quote_operation_contract_lands_on_the_current_trading_tab() -> None:
    """시세 op는 CC-03 기본 보드 계약을 받고, 갈아탈 탭으로 현재시세를 싣는다.

    기준 보드는 그대로 137X-2다 — 형제 탭 레일이 거기서 나온다.
    """

    registry = load_registry(TEMPLATE_ROOT, strict=False)

    contract = build_surface_contract(
        "detail:ka10001:current_trading", {}, registry
    )

    assert contract["board_id"] == "137X-2"
    assert contract["initial_state_board"] == "2R3M-1"
    # 보드를 직접 지정한 계약에는 갈아탈 보드가 없다 — 이미 그 보드에 있다.
    board_contract = build_board_surface_contract("137X-2", {}, registry)
    assert board_contract["initial_state_board"] is None


def test_same_response_composite_part_is_not_an_alternate_surface_value() -> None:
    """동시 응답의 둘째 part는 첫째 part를 대체해 전체 leaf를 차지하지 않는다."""

    registry = load_registry(TEMPLATE_ROOT, strict=False)
    sell_total = "base:0E|$.data[].131|1"
    buy_total = "base:0E|$.data[].135|1"

    # 실시간 프레임 목록에서 이 leaf가 쓰는 것은 첫 프레임이다(행을 지정하지 않은
    # 잎의 첫 원소 규칙). 둘째 part가 첫째를 대체해 leaf 전체를 차지하지는 않는다.
    full_response = build_board_surface_contract(
        "13BC-2",
        {sell_total: ["SELL"], buy_total: ["BUY"]},
        registry,
        ("base:0E",),
    )
    assert _by_slot(full_response)["s024"]["occurrence_id"] == sell_total
    assert _by_slot(full_response)["s024"]["value"] == "SELL"

    buy_only = build_board_surface_contract(
        "13BC-2", {buy_total: ["BUY"]}, registry, ("base:0E",)
    )
    assert "s024" in buy_only["unbound_slots"]
    assert "s024" not in _by_slot(buy_only)

    detail_totals = (
        (
            "detail:ka10004:after_hours_totals",
            "detail:ka10004:after_hours_totals|$.ovt_sel_req|1",
            "detail:ka10004:after_hours_totals|$.ovt_buy_req|1",
        ),
        (
            "detail:ka10087:aggregate_totals",
            "detail:ka10087:aggregate_totals|$.ovt_sel_bid_tot_req|1",
            "detail:ka10087:aggregate_totals|$.ovt_buy_bid_tot_req|1",
        ),
    )
    for mapping_id, detail_sell_total, detail_buy_total in detail_totals:
        full_detail = build_board_surface_contract(
            "13BC-2",
            {detail_sell_total: "SELL", detail_buy_total: "BUY"},
            registry,
            (mapping_id,),
        )
        assert _by_slot(full_detail)["s024"]["occurrence_id"] == detail_sell_total
        assert _by_slot(full_detail)["s024"]["value"] == "SELL"

        buy_only_detail = build_board_surface_contract(
            "13BC-2", {detail_buy_total: "BUY"}, registry, (mapping_id,)
        )
        assert "s024" in buy_only_detail["unbound_slots"]
        assert "s024" not in _by_slot(buy_only_detail)

    # 135 자체는 2TRW의 row_index=0 leaf가 명시적으로 cover한다. repeat 응답은
    # 이렇게 행을 지정한 계약에서만 꺼낸다.
    buy_atomic = build_board_surface_contract(
        "2TRW-1", {buy_total: ["BUY"]}, registry, ("base:0E",)
    )
    assert _by_slot(buy_atomic)["s075"]["occurrence_id"] == buy_total
    assert _by_slot(buy_atomic)["s075"]["value"] == "BUY"
    assert buy_total not in registry.coverage()["uncovered_occurrences"]


def test_container_leaf_in_a_repeated_row_shows_its_ordinal() -> None:
    """배열 자체를 가리키며 되풀이 줄에 앉은 잎은 그 줄의 순번이다(문면 자릿수 유지)."""

    registry = load_registry(TEMPLATE_ROOT, strict=False)
    occurrence = "base:ka10029|$.exp_cntr_flu_rt_upper|1"
    rows = [{"stk_cd": "1"}, {"stk_cd": "2"}, {"stk_cd": "3"}]

    contract = build_board_surface_contract("2XP6-0", {occurrence: rows}, registry)
    values = {entry["slot_id"]: entry["value"] for entry in contract["slot_values"]}

    assert values["s039"] == "01"
    assert values["s050"] == "02"
    assert values["s061"] == "03"
    # 응답 행수를 넘는 줄은 순번도 없다 — 그 줄은 접힌다.
    assert "s072" in contract["unbound_slots"]


def test_container_leaf_outside_a_row_shows_the_count_with_its_unit() -> None:
    """문면 전체가 「수 + 수량 단위」인 잎은 배열 길이다. 다른 말이 붙으면 손대지 않는다."""

    registry = load_registry(TEMPLATE_ROOT, strict=False)
    occurrence = "detail:kt00004:position_valuation|$.stk_acnt_evlt_prst|1"

    contract = build_board_surface_contract(
        "133H-2", {occurrence: [{"a": 1}, {"a": 2}]}, registry
    )
    values = {entry["slot_id"]: entry["value"] for entry in contract["slot_values"]}

    assert values["s019"] == "2종목"
    # `8종목 · 평가액 순 · 09:42 기준`은 뒤 문면까지 목업이라 채우지 않는다.
    assert "s027" in contract["unbound_slots"]


def test_empty_rows_lists_repeat_rows_with_no_value() -> None:
    """값이 한 칸도 없는 되풀이 줄은 계약이 목록으로 알린다(프론트가 접는다)."""

    registry = load_registry(TEMPLATE_ROOT, strict=False)
    occurrence = "base:ka10029|$.exp_cntr_flu_rt_upper|1"

    contract = build_board_surface_contract(
        "2XP6-0", {occurrence: [{"stk_cd": "1"}]}, registry
    )
    rows = {entry["row"] for entry in contract["empty_rows"]}

    # 응답이 1행만 실어 왔다 — 표의 첫 줄은 살고 나머지 줄은 접을 목록에 든다.
    assert not any(row.endswith(":0") for row in rows if row.startswith("table:"))
    assert any(row.startswith("table:") and row.endswith(":2") for row in rows)


def test_ka10099_product_rows_do_not_mount_the_mixed_ranking_board() -> None:
    """종목 목록은 독립 순위 조회와 합치지 않고 받은 행 그대로 작업대에 남긴다."""

    rows = [
        {"code": "000020", "name": "동화약품"},
        {"code": "005930", "name": "삼성전자"},
    ]
    card_contract = {"data": {"rows": rows}}

    attach_surface_contract(
        card_contract,
        "base:ka10099",
        {"list": rows},
    )

    assert card_contract["surface_contract"] is None
    assert card_contract["data"]["rows"] == rows
