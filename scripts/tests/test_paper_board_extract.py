"""`scripts/paper_board_extract.py` 단위 테스트.

실행: cd C:\\Projects\\DAOU.Athena && python -m pytest scripts/tests -q
"""

from __future__ import annotations

import json
import re
import shutil

import pytest

import paper_board_extract as pbe


# --------------------------------------------------------------------------- #
# 1. JSX → HTML 변환
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("backgroundColor", "background-color"),
        ("fontSize", "font-size"),
        ("MozOsxFontSmoothing", "-moz-osx-font-smoothing"),
        ("WebkitFontSmoothing", "-webkit-font-smoothing"),
        ("msFlexAlign", "-ms-flex-align"),
        ("paddingInline", "padding-inline"),
        ("--color-k-bg", "--color-k-bg"),
    ],
)
def test_css_property_name(key, expected):
    assert pbe.css_property_name(key) == expected


def test_parse_style_object_keeps_values_verbatim():
    pairs = pbe.parse_style_object(
        "{ boxShadow: '#10131A1A 0px 18px 48px', flexShrink: 0, "
        "fontFamily: 'var(--font-body)', 'grid-area': 'a' }"
    )
    assert pairs == [
        ("boxShadow", "#10131A1A 0px 18px 48px"),
        ("flexShrink", "0"),
        ("fontFamily", "var(--font-body)"),
        ("grid-area", "a"),
    ]


def test_style_object_to_css():
    style = pbe.StyleObject(pbe.parse_style_object("{ fontSize: '12px', flexShrink: 0 }"))
    assert style.to_css() == "font-size: 12px; flex-shrink: 0"


def test_roundtrip_inline_styles_and_text():
    src = """(
    <div style={{ backgroundColor: 'var(--color-k-bg)', MozOsxFontSmoothing: 'grayscale' }}>
      <div style={{ fontSize: '12px' }}>
        내 계좌
      </div>
    </div>
  )"""
    html = pbe.serialize(pbe.parse_jsx(src))
    assert html == (
        '<div style="background-color: var(--color-k-bg); '
        '-moz-osx-font-smoothing: grayscale">'
        '<div style="font-size: 12px">내 계좌</div>'
        "</div>"
    )


def test_serializer_adds_no_whitespace_between_tags():
    src = "(<div><div>가</div><div>나</div></div>)"
    assert pbe.serialize(pbe.parse_jsx(src)) == "<div><div>가</div><div>나</div></div>"


def test_multiline_text_collapses_to_single_space():
    src = "(<div>\n  앞\n  뒤\n</div>)"
    assert pbe.serialize(pbe.parse_jsx(src)) == "<div>앞 뒤</div>"


def test_text_and_attribute_escaping():
    src = "(<div title='a\"b'>3 &lt; 5 &amp; 6 > 2</div>)"
    html = pbe.serialize(pbe.parse_jsx(src))
    assert 'title="a&quot;b"' in html
    assert ">3 &amp;lt; 5 &amp;amp; 6 &gt; 2<" in html


def test_self_closing_void_and_non_void():
    html = pbe.serialize(pbe.parse_jsx("(<div><img src='a.png' /><span /></div>)"))
    assert html == '<div><img src="a.png" /><span></span></div>'


def test_svg_attribute_names():
    src = (
        "(<svg viewBox='0 0 10 10'>"
        "<path strokeWidth='2' fillRule='evenodd' d='M0 0' /></svg>)"
    )
    html = pbe.serialize(pbe.parse_jsx(src))
    assert 'viewBox="0 0 10 10"' in html
    assert 'stroke-width="2"' in html
    assert 'fill-rule="evenodd"' in html


def test_class_name_and_boolean_attribute():
    html = pbe.serialize(pbe.parse_jsx("(<div className='x' hidden></div>)"))
    assert html == '<div class="x" hidden></div>'


def test_unbalanced_tag_fails_closed():
    with pytest.raises(pbe.ExtractError):
        pbe.parse_jsx("(<div><span></div>)")


# --------------------------------------------------------------------------- #
# 2. 트리 파싱 · DFS 정렬
# --------------------------------------------------------------------------- #

TREE = """Frame "Card" (A-0) 100×50
  Frame "Row" (B-0) 100×32
    Text "raw|kt00001|body|amt" (C-0) 60×16 "1,000원"
    Text "비용 -10" (D-0) 40×13 "비용 -10"
"""

JSX = """(
    <div style={{ width: '100px' }}>
      <div style={{ height: '32px' }}>
        <div style={{ fontSize: '13px' }}>
          1,000원
        </div>
        <div style={{ fontSize: '10px' }}>
          비용 -10
        </div>
      </div>
    </div>
  )"""


def _aligned():
    root = pbe.parse_jsx(JSX)
    nodes = pbe.parse_tree(TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    return root, elements, nodes


def test_parse_tree_reads_depth_id_and_text():
    nodes = pbe.parse_tree(TREE)
    assert [n.node_id for n in nodes] == ["A-0", "B-0", "C-0", "D-0"]
    assert [n.depth for n in nodes] == [0, 1, 2, 2]
    assert nodes[2].text == "1,000원"
    assert nodes[0].text is None


def test_truncated_auto_name_resolves_to_text():
    node = pbe.parse_tree('Text "키움증권 종합계좌 ****4721 ·…" (E-0) 10×10 "키움증권 종합계좌 ****4721 · 개인"')[0]
    assert node.resolved_name == "키움증권 종합계좌 ****4721 · 개인"


def test_align_attaches_data_node_and_data_name():
    root, elements, _ = _aligned()
    html = pbe.serialize(root)
    assert 'data-node="A-0"' in html
    assert 'data-name="Card"' in html
    assert 'data-name="raw|kt00001|body|amt"' in html
    # 자동 이름(텍스트와 같은 이름)은 data-name을 만들지 않는다.
    assert 'data-name="비용 -10"' not in html


def test_align_reports_first_divergence_and_fails_closed():
    nodes = pbe.parse_tree(TREE + '    Text "여분" (Z-0) 1×1 "여분"\n')
    elements = pbe.flatten(pbe.parse_jsx(JSX))
    with pytest.raises(pbe.ExtractError) as exc:
        pbe.align(elements, nodes)
    assert "노드 수 불일치" in str(exc.value)
    assert "index=" in str(exc.value)


def test_tree_subtree_rebases_depth():
    sub = pbe.tree_subtree(pbe.parse_tree(TREE), "B-0")
    assert [n.node_id for n in sub] == ["B-0", "C-0", "D-0"]
    assert [n.depth for n in sub] == [0, 1, 1]


# 트리 요약은 void 요소(<br>)를 노드로 내보내지 않고, 그 줄바꿈을 `\n`으로 적는다.
BR_TREE = """Frame "Row" (A-0) 100×32
  Text "매도 잔량 직전대비" (B-0) 85×32 "매도 잔량\\n직전대비"
"""

BR_JSX = """(
    <div style={{ width: '100px' }}>
      <div style={{ fontSize: '11px' }}>
        매도 잔량<br />직전대비
      </div>
    </div>
  )"""


def test_tree_text_unescapes_newline():
    assert pbe.parse_tree(BR_TREE)[1].text == "매도 잔량\n직전대비"


def test_align_skips_void_elements():
    root = pbe.parse_jsx(BR_JSX)
    elements = pbe.flatten(root)
    nodes = pbe.parse_tree(BR_TREE)
    assert [el.tag for el in elements] == ["div", "div"]
    pbe.align(elements, nodes)
    html = pbe.serialize(root)
    # <br>은 정렬에서만 빠지고 원문에는 그대로 남는다(픽셀 동일).
    assert "<br />" in html
    assert 'data-node="B-0"' in html


def test_br_text_node_stays_one_slot_with_newline():
    root = pbe.parse_jsx(BR_JSX)
    leaf = pbe.flatten(root)[1]
    assert pbe.is_text_leaf(leaf)
    assert pbe.direct_text(leaf) == "매도 잔량\n직전대비"


# --------------------------------------------------------------------------- #
# 3. 라벨/값 · layer 추정
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("총자산", True),
        ("예수금·결제", True),
        ("미수 변제소요", True),
        ("124,580,240원", False),
        ("+4.96%", False),
        ("09/01 09:42", False),
        ("D+2 예정", False),
    ],
)
def test_is_label_text(text, expected):
    assert pbe.is_label_text(text) is expected


def test_layer_pairs_second_smaller_line_in_32px_row():
    _, elements, nodes = _aligned()
    height_of = {id(el): n.height for el, n in zip(elements, nodes)}
    primary, secondary = elements[2], elements[3]
    assert pbe.estimate_layer(primary, height_of, "tab", "value") == "직접"
    assert pbe.estimate_layer(secondary, height_of, "tab", "value") == "병기"


def test_layer_skips_label_kind_and_equal_font_sizes():
    _, elements, nodes = _aligned()
    height_of = {id(el): n.height for el, n in zip(elements, nodes)}
    # 열 머리처럼 같은 크기의 라벨 셀은 둘째 칸이어도 병기가 아니다.
    assert pbe.estimate_layer(elements[3], height_of, "tab", "label") == "직접"


def test_layer_expand_board_marks_every_slot():
    _, elements, nodes = _aligned()
    height_of = {id(el): n.height for el, n in zip(elements, nodes)}
    assert pbe.estimate_layer(elements[2], height_of, "expand", "value") == "펼침"


# --------------------------------------------------------------------------- #
# 4. 앵커 · 영역 · 표
# --------------------------------------------------------------------------- #


def test_parse_anchor_mapping_form():
    got = pbe.parse_anchor("mapping|detail:kt00001:settlement_forecast|d2_amt", set())
    assert got["mapping_id"] == "detail:kt00001:settlement_forecast"
    assert got["f"] == "d2_amt"


def test_parse_anchor_raw_form_only_binds_known_base_op():
    known = pbe.parse_anchor("raw|ka01690|body|tot_evlt_amt", {"base:ka01690"})
    assert known["mapping_id"] == "base:ka01690"
    assert known["f"] == "tot_evlt_amt"
    assert known["anchor"] == {
        "kind": "raw",
        "tr": "ka01690",
        "section": "body",
        "field": "tot_evlt_amt",
    }
    unknown = pbe.parse_anchor("raw|kt00001|body|d2_pymn_alow_amt", {"detail:kt00001:x"})
    assert unknown["mapping_id"] is None
    assert unknown["f"] == "d2_pymn_alow_amt"


def test_parse_anchor_structure_and_plain_names():
    got = pbe.parse_anchor("structure|kt00004|stk_acnt_evlt_prst|count", set())
    assert got["anchor"]["kind"] == "structure"
    assert got["mapping_id"] is None
    assert pbe.parse_anchor("현재 예수금", set()) == {
        "anchor": None,
        "mapping_id": None,
        "f": None,
    }


def test_load_regions_accepts_both_shapes(tmp_path):
    a = tmp_path / "a.json"
    a.write_text(json.dumps({"roles": {"X-0": "rail"}}), encoding="utf-8")
    assert pbe.load_regions(a) == ({"X-0": "rail"}, None)
    b = tmp_path / "b.json"
    b.write_text(
        json.dumps({"root": "R-0", "regions": [{"node_id": "X-0", "role": "rail"}]}),
        encoding="utf-8",
    )
    assert pbe.load_regions(b) == ({"X-0": "rail"}, "R-0")


def test_load_responsive_validates_and_normalizes_manifest(tmp_path):
    manifest = tmp_path / "regions.json"
    manifest.write_text(
        json.dumps(
            {
                "responsive": [
                    {"node_id": "B-0", "traits": ["atomic"]},
                    {
                        "node_id": "A-0",
                        "traits": ["scroll"],
                        "accessible_label": "Quote details",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    assert pbe.load_responsive(manifest, {"A-0", "B-0"}) == [
        {"node_id": "B-0", "traits": ("atomic",), "accessible_label": None},
        {
            "node_id": "A-0",
            "traits": ("scroll",),
            "accessible_label": "Quote details",
        },
    ]


@pytest.mark.parametrize(
    "raw",
    [
        '{"responsive": [{"node_id": "A-0", "traits": []}]}',
        '{"responsive": [{"node_id": "A-0", "traits": ["unknown"]}]}',
        '{"responsive": [{"node_id": "A-0", "traits": ["flow", "scroll"]}]}',
        '{"responsive": [{"node_id": "A-0", "traits": ["scroll"]}]}',
        '{"responsive": [{"node_id": "A-0", "traits": ["atomic"]}, '
        '{"node_id": "A-0", "traits": ["flow"]}]}',
        '{"responsive": [{"node_id": "A-0", "traits": ["atomic"]}], '
        '"responsive": []}',
    ],
)
def test_load_responsive_fails_closed_for_invalid_manifest(tmp_path, raw):
    manifest = tmp_path / "regions.json"
    manifest.write_text(raw, encoding="utf-8")

    with pytest.raises(pbe.ExtractError):
        pbe.load_responsive(manifest, {"A-0"})


def test_load_responsive_rejects_unknown_node(tmp_path):
    manifest = tmp_path / "regions.json"
    manifest.write_text(
        '{"responsive": [{"node_id": "MISSING-0", "traits": ["atomic"]}]}',
        encoding="utf-8",
    )

    with pytest.raises(pbe.ExtractError):
        pbe.load_responsive(manifest, {"A-0"})


def test_apply_responsive_emits_stable_classes_and_scroll_accessibility():
    root, elements, nodes = _aligned()
    declarations = [
        {"node_id": "B-0", "traits": ("scroll", "atomic"), "accessible_label": "Quote details"},
        {"node_id": "C-0", "traits": ("atomic",), "accessible_label": None},
    ]

    pbe.apply_responsive(elements, nodes, declarations)
    html = pbe.serialize(root)

    assert 'class="bs-r-atomic bs-r-scroll"' in html
    assert 'role="region" tabindex="0" aria-label="Quote details"' in html
    assert 'class="bs-r-atomic"' in html


def test_apply_responsive_fails_closed_before_overwriting_existing_role():
    _, elements, nodes = _aligned()
    elements[1].attrs.append(("role", "button"))

    with pytest.raises(pbe.ExtractError, match="existing role"):
        pbe.apply_responsive(
            elements,
            nodes,
            [
                {
                    "node_id": "B-0",
                    "traits": ("scroll",),
                    "accessible_label": "Quote details",
                }
            ],
        )


def test_detect_tables_accepts_explicit_table_directives_without_g1_behavior_change():
    root = pbe.parse_jsx(TABLE_JSX)
    nodes = pbe.parse_tree(TABLE_TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)

    assert pbe.detect_tables(
        elements,
        nodes,
        {},
        explicit_tables={"T-0": {"node_id": "T-0", "traits": ("paired-table",)}},
    ) == pbe.detect_tables(elements, nodes, {})


def test_nonresponsive_13bc_extraction_remains_byte_equivalent():
    board_dir = pbe.TEMPLATE_ROOT / "13BC-2"

    html, payload = pbe.extract_board(board_dir)
    previous = json.loads((board_dir / "slots.json").read_text(encoding="utf-8"))

    assert html == (board_dir / "board.html").read_text(encoding="utf-8")
    assert pbe.dump_json(pbe.merge_authored(previous, payload)) == (
        board_dir / "slots.json"
    ).read_text(encoding="utf-8")


def test_non_table_responsive_annotation_preserves_structural_extraction(tmp_path):
    source = pbe.TEMPLATE_ROOT / "13BC-2"
    board_dir = tmp_path / source.name
    shutil.copytree(source, board_dir)
    baseline_html, baseline = pbe.extract_board(source)
    manifest_path = board_dir / "regions.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["responsive"] = [{"node_id": manifest["root"], "traits": ["atomic"]}]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    annotated_html, annotated = pbe.extract_board(board_dir)

    assert annotated_html != baseline_html
    assert "bs-r-atomic" in annotated_html
    for key in ("regions", "tables", "counts", "density", "slots", "column_bindings"):
        assert annotated[key] == baseline[key]


TABLE_TREE = """Frame "표" (T-0) 800×200
  Frame "제목" (T1-0) 800×20
    Text "결제 예정" (T1A-0) 60×12 "결제 예정"
  Frame "열 머리" (H-0) 800×30
    Text "일자" (H1-0) 100×12 "일자"
    Text "구분" (H2-0) 100×12 "구분"
    Text "금액" (H3-0) 100×12 "금액"
  Frame "행1" (R1-0) 800×40
    Text "09/01" (R1A-0) 100×16 "09/01"
    Text "매도" (R1B-0) 100×16 "매도"
    Text "1,000" (R1C-0) 100×16 "1,000"
  Frame "행2" (R2-0) 800×40
    Text "09/02" (R2A-0) 100×16 "09/02"
    Text "매수" (R2B-0) 100×16 "매수"
    Text "2,000" (R2C-0) 100×16 "2,000"
  Frame "행3" (R3-0) 800×40
    Text "09/03" (R3A-0) 100×16 "09/03"
    Text "매도" (R3B-0) 100×16 "매도"
    Text "3,000" (R3C-0) 100×16 "3,000"
"""

TABLE_JSX = """(
    <div style={{ width: '800px' }}>
      <div style={{ height: '20px' }}><div style={{ fontSize: '12px' }}>결제 예정</div></div>
      <div style={{ height: '30px' }}>
        <div style={{ fontSize: '10px' }}>일자</div>
        <div style={{ fontSize: '10px' }}>구분</div>
        <div style={{ fontSize: '10px' }}>금액</div>
      </div>
      <div style={{ height: '40px' }}>
        <div style={{ fontSize: '12px' }}>09/01</div>
        <div style={{ fontSize: '12px' }}>매도</div>
        <div style={{ fontSize: '12px' }}>1,000</div>
      </div>
      <div style={{ height: '40px' }}>
        <div style={{ fontSize: '12px' }}>09/02</div>
        <div style={{ fontSize: '12px' }}>매수</div>
        <div style={{ fontSize: '12px' }}>2,000</div>
      </div>
      <div style={{ height: '40px' }}>
        <div style={{ fontSize: '12px' }}>09/03</div>
        <div style={{ fontSize: '12px' }}>매도</div>
        <div style={{ fontSize: '12px' }}>3,000</div>
      </div>
    </div>
  )"""


def test_detect_tables_marks_rows_and_columns():
    root = pbe.parse_jsx(TABLE_JSX)
    nodes = pbe.parse_tree(TABLE_TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    tables = pbe.detect_tables(elements, nodes, {})
    assert len(tables) == 1
    assert tables[0]["node_id"] == "T-0"
    assert tables[0]["columns"] == 3
    assert tables[0]["header_row"] == "H-0"
    assert tables[0]["body_rows"] == ["R1-0", "R2-0", "R3-0"]
    html = pbe.serialize(root)
    assert 'class="bs-table"' in html
    assert 'data-row="head"' in html
    assert 'data-row="0"' in html
    assert 'data-col="2"' in html


FOOT_ROW_TREE = """  Frame "합계" (R4-0) 800×40
    Text "합계" (R4A-0) 100×16 "합계"
    Text "—" (R4B-0) 100×16 "—"
    Text "6,000" (R4C-0) 100×16 "6,000"
"""

FOOT_ROW_JSX = """      <div style={{ height: '40px' }}>
        <div style={{ fontSize: '12px' }}>합계</div>
        <div style={{ fontSize: '12px' }}>—</div>
        <div style={{ fontSize: '12px' }}>6,000</div>
      </div>
"""

ROW3_TREE = """  Frame "행3" (R3-0) 800×40
    Text "09/03" (R3A-0) 100×16 "09/03"
    Text "매도" (R3B-0) 100×16 "매도"
    Text "3,000" (R3C-0) 100×16 "3,000"
"""

ROW3_JSX = """      <div style={{ height: '40px' }}>
        <div style={{ fontSize: '12px' }}>09/03</div>
        <div style={{ fontSize: '12px' }}>매도</div>
        <div style={{ fontSize: '12px' }}>3,000</div>
      </div>
"""

FOOT_TREE = TABLE_TREE + FOOT_ROW_TREE
FOOT_JSX = TABLE_JSX.replace("    </div>\n  )", FOOT_ROW_JSX + "    </div>\n  )")


def _board(jsx, tree):
    root = pbe.parse_jsx(jsx)
    nodes = pbe.parse_tree(tree)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    return root, elements, nodes, pbe.detect_tables(elements, nodes, {})


def test_total_row_leaves_the_body_and_is_marked_foot():
    """합계 행은 본문 행이 아니다 — `data-row="foot"`으로 빠진다."""
    root, _, _, tables = _board(FOOT_JSX, FOOT_TREE)
    assert len(tables) == 1
    assert tables[0]["body_rows"] == ["R1-0", "R2-0", "R3-0"]
    assert tables[0]["foot_rows"] == ["R4-0"]
    html = pbe.serialize(root)
    assert 'data-row="foot"' in html
    assert 'data-row="3"' not in html
    # 바닥 행도 셀 번호는 그대로 받는다 — 열 접기·병기가 같은 잣대로 걸린다.
    assert html.count('data-col="2"') == 5


def test_a_table_whose_last_row_is_a_total_stays_a_table():
    """본문 2행 + 합계 1행 — 합계를 뺐다고 표가 아니게 되지는 않는다."""
    root, _, _, tables = _board(
        FOOT_JSX.replace(ROW3_JSX, ""), FOOT_TREE.replace(ROW3_TREE, "")
    )
    assert len(tables) == 1
    assert tables[0]["body_rows"] == ["R1-0", "R2-0"]
    assert tables[0]["foot_rows"] == ["R4-0"]


def test_a_row_that_merely_mentions_a_total_stays_in_the_body():
    """첫 칸이 합계 문구 그 자체일 때만 바닥이다 — `매도 거래 비용 합계`는 본문이다."""
    tree = FOOT_TREE.replace('"합계" (R4A-0) 100×16 "합계"', '"거래 비용 합계" (R4A-0) 100×16 "거래 비용 합계"')
    _, _, _, tables = _board(FOOT_JSX.replace(">합계<", ">거래 비용 합계<"), tree)
    assert tables[0]["body_rows"] == ["R1-0", "R2-0", "R3-0", "R4-0"]
    assert tables[0]["foot_rows"] == []


def test_foot_cells_get_a_table_position_without_a_row_number():
    _, elements, _, tables = _board(FOOT_JSX, FOOT_TREE)
    position = pbe.table_position(elements, tables)
    assert {cell["row"] for cell in position.values()} == {"head", "0", "1", "2", "foot"}


def test_column_collapse_reaches_the_foot_row():
    root, elements, nodes, tables = _board(FOOT_JSX, FOOT_TREE)
    by_node = {n.node_id: el for el, n in zip(elements, nodes)}
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    wrapped, _ = pbe.apply_column_collapse(tables, by_node, node_of)
    # 머리 1 + 본문 3 + 바닥 1 = 5행 × 접히는 셋째 열 1칸.
    assert wrapped == 5


def test_indexed_column_gives_the_foot_row_no_row_number():
    """인덱스 열은 행 번호로 필드를 푼다 — 번호가 없는 바닥 행은 건너뛴다."""
    _, elements, _, tables = _board(FOOT_JSX, FOOT_TREE)
    slots = []
    for cell in pbe.table_position(elements, tables).values():
        slots.append(
            {
                "slot_id": f"s{len(slots) + 1:03d}",
                "table": cell,
                "kind": "value",
                "mapping_id": None,
                "f": None,
                "alt_mappings": None,
            }
        )
    amount = [s["slot_id"] for s in slots if s["table"]["col"] == 2 and s["table"]["row"] != "head"]
    payload = {
        "slots": slots,
        "counts": {"mapped_slots": 0},
        "column_bindings": [
            {
                "table_id": tables[0]["node_id"],
                "columns": [
                    {
                        "col": 3,
                        "data_col": 2,
                        "header": "금액",
                        "slot_ids": amount,
                        "mapping_id": "kt00001",
                        "indexed": {"f_pattern": "amt_{i}", "start": 1, "step": 1},
                    }
                ],
            }
        ],
    }
    pbe.apply_columns(payload)
    got = {s["table"]["row"]: s["f"] for s in slots if s["slot_id"] in amount}
    assert got == {"0": "amt_1", "1": "amt_2", "2": "amt_3", "foot": None}


# --------------------------------------------------------------------------- #
# 4b-2. 레일 블록 — 제목이 블록을 가른다
# --------------------------------------------------------------------------- #

RAIL_TREE = """Frame "레일" (L-0) 480×600
  Frame "머리 여백" (L0-0) 480×12
    Text "09:42" (L0A-0) 40×12 "09:42"
  Frame "체결 블록" (B1-0) 480×58
    Text "실시간 체결" (B1A-0) 86×22 "실시간 체결"
    Frame "Frame" (B1B-0) 95×18
      Text "체결" (B1C-0) 24×18 "체결"
  Frame "체결 09:42:21" (B2-0) 480×32
    Text "09:42:21" (B2A-0) 70×18 "09:42:21"
  Frame "체결 09:42:20" (B3-0) 480×32
    Text "09:42:20" (B3A-0) 70×18 "09:42:20"
  Frame "잔량 블록" (B4-0) 480×60
    Text "호가 잔량" (B4A-0) 60×22 "호가 잔량"
"""

RAIL_JSX = """(
    <div style={{ width: '480px' }}>
      <div style={{ height: '12px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>09:42</div>
      </div>
      <div style={{ height: '58px' }}>
        <div style={{ fontFamily: 'var(--font-strong)', fontSize: '16px' }}>실시간 체결</div>
        <div style={{ height: '18px' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px' }}>체결</div>
        </div>
      </div>
      <div style={{ height: '32px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>09:42:21</div>
      </div>
      <div style={{ height: '32px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>09:42:20</div>
      </div>
      <div style={{ height: '60px' }}>
        <div style={{ fontFamily: 'var(--font-strong)', fontSize: '15px' }}>호가 잔량</div>
      </div>
    </div>
  )"""


def _rail():
    root = pbe.parse_jsx(RAIL_JSX)
    nodes = pbe.parse_tree(RAIL_TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    return root, elements, nodes


def test_rail_blocks_start_at_a_title_not_at_every_child():
    """레일 직계 자식을 그대로 세면 표 본문 행까지 블록이 된다 — 제목만 블록을 연다."""
    root, elements, nodes = _rail()
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    assert len(pbe.element_children(root)) == 5
    blocks = pbe.rail_blocks_of(root)
    assert [node_of[id(b[0])].node_id for b in blocks] == ["B1-0", "B4-0"]
    # 제목 앞에 놓인 자식은 어느 블록에도 들어가지 않는다.
    assert all(node_of[id(m)].node_id != "L0-0" for b in blocks for m in b)


def test_rail_block_rows_count_the_run_then_fall_back_to_the_frame():
    root, elements, nodes = _rail()
    blocks = pbe.rail_blocks_of(root)
    # 제목과 내용이 레일 직계에 나란히 놓인 블록 — 제목 뒤에 딸린 자식이 행이다.
    assert pbe.rail_block_rows(blocks[0]) == 2
    # 제목이 내용을 감싼 블록 — 그 프레임의 자식이 행이다.
    assert pbe.rail_block_rows(blocks[1]) == 1


def test_title_text_is_the_strong_face_at_any_size():
    root, elements, nodes = _rail()
    by_node = {n.node_id: el for el, n in zip(elements, nodes)}
    assert pbe.is_title_text(by_node["B1A-0"]) is True
    assert pbe.is_title_text(by_node["B4A-0"]) is True
    assert pbe.is_title_text(by_node["B1C-0"]) is False
    assert pbe.is_title_text(by_node["B2A-0"]) is False


def _table_board():
    root = pbe.parse_jsx(TABLE_JSX)
    nodes = pbe.parse_tree(TABLE_TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    tables = pbe.detect_tables(elements, nodes, {})
    return root, elements, nodes, tables


# --------------------------------------------------------------------------- #
# 4b. 레인 C 계약 — 접기 래퍼 · 병기 사본 · KPI 셀
# --------------------------------------------------------------------------- #


def test_column_collapse_wraps_from_third_column_and_pairs_into_second():
    root, elements, nodes, tables = _table_board()
    by_node = {n.node_id: el for el, n in zip(elements, nodes)}
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    wrapped, paired = pbe.apply_column_collapse(tables, by_node, node_of)
    # 3열 표 → 셋째 열만 접힌다(첫 2열은 래퍼 없음). 머리 행 + 본문 3행 = 4개.
    assert (wrapped, paired) == (4, 4)
    html = pbe.serialize(root)
    assert '<span class="bs-col" data-col-priority="3">' in html
    assert 'data-col-priority="1"' not in html
    assert 'data-col-priority="2"' not in html
    assert (
        '<span class="bs-paired" data-paired-col="3" data-node="R1C-0">1,000</span>' in html
    )
    # 병기 사본은 그 행의 두 번째 열 셀 안에 들어간다.
    second = pbe.element_children(by_node["R1-0"])[1]
    assert [c.tag for c in second.children if isinstance(c, pbe.Element)] == ["span"]


def test_column_collapse_keeps_text_leaf_and_cell_indexing_intact():
    """래퍼·사본은 Paper 노드가 아니다 — 슬롯 판정과 열 색인이 그대로여야 한다."""
    root, elements, nodes, tables = _table_board()
    by_node = {n.node_id: el for el, n in zip(elements, nodes)}
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    before = pbe.table_position(elements, tables)
    pbe.apply_column_collapse(tables, by_node, node_of)
    assert pbe.table_position(elements, tables) == before
    second = pbe.element_children(by_node["R1-0"])[1]
    assert pbe.is_text_leaf(second)
    assert pbe.direct_text(second) == "매도"
    third = pbe.element_children(by_node["R1-0"])[2]
    assert pbe.node_path(third, root) == "2/2"


def test_kpi_like_block_is_not_a_table():
    """첫 행에 숫자가 있으면 열 머리가 아니므로 표로 보지 않는다."""
    tree = TABLE_TREE.replace('Text "일자" (H1-0) 100×12 "일자"', 'Text "3,000" (H1-0) 100×12 "3,000"')
    jsx = TABLE_JSX.replace(">일자<", ">3,000<")
    root = pbe.parse_jsx(jsx)
    nodes = pbe.parse_tree(tree)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    assert pbe.detect_tables(elements, nodes, {}) == []


def test_kpi_role_marks_direct_children_as_cells():
    root = pbe.parse_jsx(TABLE_JSX)
    nodes = pbe.parse_tree(TABLE_TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    kpi = {n.node_id: el for el, n in zip(elements, nodes)}["H-0"]
    for cell in pbe.element_children(kpi):
        pbe.add_class(cell, "bs-kpi-cell")
    assert pbe.serialize(kpi).count('class="bs-kpi-cell"') == 3


# --------------------------------------------------------------------------- #
# 4c. 열 묶음(column_bindings) · --apply-columns
# --------------------------------------------------------------------------- #


def _table_slots(tables, elements, nodes):
    cell_of = pbe.table_position(elements, tables)
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    slots = []
    for el in elements:
        if not pbe.is_text_leaf(el):
            continue
        slots.append(
            {
                "slot_id": f"s{len(slots) + 1:03d}",
                "node_id": node_of[id(el)].node_id,
                "paper_text": pbe.direct_text(el),
                "table": cell_of.get(id(el)),
                "mapping_id": None,
                "f": None,
            }
        )
    return slots


def test_column_bindings_group_body_cells_and_carry_header():
    _, elements, nodes, tables = _table_board()
    slots = _table_slots(tables, elements, nodes)
    bindings = pbe.build_column_bindings(tables, slots)
    assert len(bindings) == 1
    assert bindings[0]["table_id"] == "T-0"
    columns = bindings[0]["columns"]
    assert [c["col"] for c in columns] == [1, 2, 3]
    assert [c["data_col"] for c in columns] == [0, 1, 2]
    assert [c["header"] for c in columns] == ["일자", "구분", "금액"]
    # 머리 행은 열 묶음에 들어가지 않는다 — 본문 3행만.
    assert all(len(c["slot_ids"]) == 3 for c in columns)


def test_apply_columns_spreads_one_authored_cell_across_its_column():
    _, elements, nodes, tables = _table_board()
    slots = _table_slots(tables, elements, nodes)
    payload = {
        "slots": slots,
        "column_bindings": pbe.build_column_bindings(tables, slots),
        "counts": {"mapped_slots": 0},
    }
    amount = payload["column_bindings"][0]["columns"][2]
    first = {s["slot_id"]: s for s in slots}[amount["slot_ids"][0]]
    first["mapping_id"] = "detail:kt00001:settle"
    first["f"] = "amt"
    assert pbe.apply_columns(payload) == 2
    assert [{s["slot_id"]: s for s in slots}[sid]["f"] for sid in amount["slot_ids"]] == [
        "amt",
        "amt",
        "amt",
    ]
    # 다른 열은 건드리지 않는다.
    date = payload["column_bindings"][0]["columns"][0]
    assert all({s["slot_id"]: s for s in slots}[sid]["mapping_id"] is None for sid in date["slot_ids"])
    assert payload["counts"]["mapped_slots"] == 3


def test_apply_columns_leaves_static_cells_and_static_columns_alone():
    """저작이 '필드가 아니다'라고 못박은 자리는 열 전파가 덮지 않는다."""
    _, elements, nodes, tables = _table_board()
    slots = _table_slots(tables, elements, nodes)
    payload = {
        "slots": slots,
        "column_bindings": pbe.build_column_bindings(tables, slots),
        "counts": {"mapped_slots": 0},
    }
    by_id = {s["slot_id"]: s for s in slots}
    amount = payload["column_bindings"][0]["columns"][2]
    first, second = by_id[amount["slot_ids"][0]], by_id[amount["slot_ids"][1]]
    first["mapping_id"] = "detail:kt00001:settle"
    first["f"] = "amt"
    second["static"] = True
    # 저작이 static으로 못박은 열은 통째로 건너뛴다.
    date = payload["column_bindings"][0]["columns"][0]
    date["kind"] = "static"
    by_id[date["slot_ids"][0]]["mapping_id"] = "base:kt00015"
    by_id[date["slot_ids"][0]]["f"] = "trde_dt"

    assert pbe.apply_columns(payload) == 1
    assert second["mapping_id"] is None
    assert [by_id[sid]["f"] for sid in amount["slot_ids"]] == ["amt", None, "amt"]
    assert "mapping_id" not in date
    assert all(by_id[sid]["mapping_id"] is None for sid in date["slot_ids"][1:])


def test_apply_columns_accepts_mapping_written_on_the_column():
    _, elements, nodes, tables = _table_board()
    slots = _table_slots(tables, elements, nodes)
    payload = {
        "slots": slots,
        "column_bindings": pbe.build_column_bindings(tables, slots),
        "counts": {"mapped_slots": 0},
    }
    payload["column_bindings"][0]["columns"][1]["mapping_id"] = "base:ka10015"
    payload["column_bindings"][0]["columns"][1]["f"] = "trde_tp"
    assert pbe.apply_columns(payload) == 3
    column1 = [s for s in slots if s["table"] and s["table"]["col"] == 1]
    # 머리 행 셀은 열 묶음에 없으니 그대로 비어 있고, 본문 3칸만 채워진다.
    assert [s["mapping_id"] for s in column1] == [None] + ["base:ka10015"] * 3


# --------------------------------------------------------------------------- #
# 4c. 인덱스 열 · 갈음 매핑
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("indexed", "expected"),
    [
        ({"f_pattern": "sel_bid_{i}", "start": 1, "step": 1}, ["sel_bid_1", "sel_bid_2", "sel_bid_3"]),
        (
            {"f_pattern": "sel_bid_req_{i}", "start": 10, "step": -1, "direction": "up"},
            ["sel_bid_req_10", "sel_bid_req_9", "sel_bid_req_8"],
        ),
        (
            {"f_pattern": "sel_trde_ori_nm_{i}", "start": 1, "step": 1, "direction": "down"},
            ["sel_trde_ori_nm_1", "sel_trde_ori_nm_2", "sel_trde_ori_nm_3"],
        ),
    ],
)
def test_indexed_field_walks_the_body_rows(indexed, expected):
    assert [pbe.indexed_field(indexed, row) for row in range(3)] == expected


@pytest.mark.parametrize(
    "indexed",
    [
        {"f_pattern": "sel_bid_{i}", "start": 10, "step": -1, "direction": "down"},
        {"f_pattern": "sel_bid_{i}", "start": 1, "step": 1, "direction": "up"},
        {"f_pattern": "sel_bid_{i}", "direction": "sideways"},
        {"f_pattern": "sel_bid_{j}"},
        {"f_pattern": "sel_bid_{}"},
        {"start": 1, "step": 1},
    ],
)
def test_indexed_field_fails_closed_on_a_broken_column(indexed):
    with pytest.raises(pbe.ExtractError):
        pbe.indexed_field(indexed, 0)


def _column_payload():
    _, elements, nodes, tables = _table_board()
    slots = _table_slots(tables, elements, nodes)
    return {
        "slots": slots,
        "column_bindings": pbe.build_column_bindings(tables, slots),
        "counts": {"mapped_slots": 0},
    }, {s["slot_id"]: s for s in slots}


def test_indexed_column_gives_every_body_row_its_own_field():
    payload, by_id = _column_payload()
    amount = payload["column_bindings"][0]["columns"][2]
    amount["mapping_id"] = "base:ka10004"
    amount["indexed"] = {"f_pattern": "sel_bid_req_{i}", "start": 10, "step": -1, "direction": "up"}
    assert pbe.apply_columns(payload) == 3
    assert [by_id[sid]["f"] for sid in amount["slot_ids"]] == [
        "sel_bid_req_10",
        "sel_bid_req_9",
        "sel_bid_req_8",
    ]
    assert all(by_id[sid]["mapping_id"] == "base:ka10004" for sid in amount["slot_ids"])


def test_indexed_column_leaves_an_authored_cell_alone():
    payload, by_id = _column_payload()
    amount = payload["column_bindings"][0]["columns"][2]
    amount["mapping_id"] = "base:ka10004"
    amount["indexed"] = {"f_pattern": "sel_bid_{i}", "start": 1, "step": 1}
    first = by_id[amount["slot_ids"][0]]
    first["mapping_id"] = "base:ka10004"
    first["f"] = "손으로 적은 것"
    assert pbe.apply_columns(payload) == 2
    assert first["f"] == "손으로 적은 것"


def test_apply_columns_spreads_alt_mappings_written_on_the_column():
    payload, by_id = _column_payload()
    amount = payload["column_bindings"][0]["columns"][2]
    amount["mapping_id"] = "base:ka10079"
    amount["f"] = "cur_prc"
    amount["alt_mappings"] = [
        {"mapping_id": "base:ka10080", "f": "cur_prc"},
        {"mapping_id": "base:ka10081", "f": "cur_prc", "json_path": "$.stk_dt_pole_chart_qry"},
    ]
    assert pbe.apply_columns(payload) == 3
    for slot_id in amount["slot_ids"]:
        assert by_id[slot_id]["alt_mappings"] == amount["alt_mappings"]


def test_apply_columns_lifts_alt_mappings_from_one_cell_to_the_whole_column():
    """열에 mapping_id가 없어도 갈음 매핑만으로 열이 선다(주기 탭이 갈아 끼우는 자리)."""
    payload, by_id = _column_payload()
    amount = payload["column_bindings"][0]["columns"][2]
    alts = [{"mapping_id": "base:ka10080", "f": "cur_prc"}]
    by_id[amount["slot_ids"][0]]["alt_mappings"] = alts
    assert pbe.apply_columns(payload) == 2
    assert amount["alt_mappings"] == alts
    assert all(by_id[sid]["alt_mappings"] == alts for sid in amount["slot_ids"])
    # 갈음만 있는 열은 mapping_id를 지어내지 않는다.
    assert "mapping_id" not in amount
    assert all(by_id[sid]["mapping_id"] is None for sid in amount["slot_ids"])


def test_merge_authored_keeps_alt_mappings_and_indexed():
    previous = {
        "slots": [
            {
                "node_id": "R1C-0",
                "alt_mappings": [{"mapping_id": "base:ka10080", "f": "cur_prc"}],
            }
        ],
        "column_bindings": [
            {
                "table_id": "T-0",
                "columns": [
                    {
                        "col": 3,
                        "indexed": {"f_pattern": "sel_bid_{i}", "start": 1, "step": 1},
                        "alt_mappings": [{"mapping_id": "base:ka10081", "f": "cur_prc"}],
                    }
                ],
            }
        ],
    }
    payload, _ = _column_payload()
    pbe.merge_authored(previous, payload)
    by_node = {s["node_id"]: s for s in payload["slots"]}
    assert by_node["R1C-0"]["alt_mappings"] == previous["slots"][0]["alt_mappings"]
    column = payload["column_bindings"][0]["columns"][2]
    assert column["indexed"]["f_pattern"] == "sel_bid_{i}"
    assert column["alt_mappings"] == previous["column_bindings"][0]["columns"][0]["alt_mappings"]


# --------------------------------------------------------------------------- #
# 4d. meta.json 이름 규약 → state
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("name", "ref", "control"),
    [
        ("CC-05 / R03-T5 · 수급 — 종목 동향", "R03-T5", "종목 동향"),
        ("CC-01 / R10-T2-X3 · 거래내역 상세", "R10-T2-X3", "거래내역 상세"),
        ("A04-X · 호가 정본 — 단계별 낱값", "A04-X", "단계별 낱값"),
        ("CC-06 / R09 · 시장 체온·VI", "R09", "시장 체온·VI"),
    ],
)
def test_parse_board_name_and_control(name, ref, control):
    got_ref, tail = pbe.parse_board_name(name)
    assert got_ref == ref
    assert pbe.control_from_tail(tail) == control


def test_parent_from_ref_walks_up_to_the_nearest_saved_board():
    index = {
        ("CC-03", "R01"): "137X-2",
        ("CC-03", "R01-T4"): "2VDA-0",
        ("CC-01", "R10"): "133H-2",
    }
    assert pbe.parent_from_ref("CC-03", "R01-T4-9-X", "3TCO-0", index) == "2VDA-0"
    assert pbe.parent_from_ref("CC-03", "R01-T6", "2VO0-0", index) == "137X-2"
    # R10-B는 저장본이 없다 — 같은 카드의 기준 보드까지 올라간다.
    assert pbe.parent_from_ref("CC-01", "R10-B-X1", "3ODO-0", index) == "133H-2"
    # 다른 카드로는 건너가지 않는다.
    assert pbe.parent_from_ref("CC-05", "R03-T1", "2QFO-2", index) is None


def test_resolve_state_fills_only_the_blanks():
    index = {("CC-01", "R10"): "133H-2", ("CC-01", "R10-T2"): "2SKU-1"}
    meta = {
        "name": "CC-01 / R10-T2-X4 · D+2 정산 후 계좌",
        "card_id": "CC-01",
        "state": {"kind": "expand", "parent_board": None, "control": None},
    }
    assert pbe.resolve_state(meta, "3MTJ-0", index) == {
        "kind": "expand",
        "parent_board": "2SKU-1",
        "control": "D+2 정산 후 계좌",
        "control_text": None,
    }
    authored = {
        "name": "CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중",
        "card_id": "CC-01",
        "state": {"kind": "tab", "parent_board": "133H-2", "control": "보유종목"},
    }
    assert pbe.resolve_state(authored, "2SCE-1", index)["control"] == "보유종목"
    base = {"name": "CC-01 / R10 · 내 계좌 — 손익·결제·위험", "card_id": "CC-01", "state": {}}
    assert pbe.resolve_state(base, "133H-2", index) == {
        "kind": "default",
        "parent_board": None,
        "control": None,
        "control_text": None,
    }
    hand = {
        "name": "CC-01 / R10-T2-X4 · D+2 정산 후 계좌",
        "card_id": "CC-01",
        "state": {"kind": "expand", "control_text": "D+2 09/03"},
    }
    assert pbe.resolve_state(hand, "3MTJ-0", index)["control_text"] == "D+2 09/03"


def test_resolve_state_turns_a_self_parent_into_a_rail_owner():
    """제 레일을 이고 있는 탭 보드 — 부모가 자기 자신으로 적히면 부모는 없는 것이다."""
    index = {("CC-05", "R03-T1"): "2QFO-2", ("CC-05", "R03-T2"): "2QM7-2"}
    meta = {
        "name": "CC-05 / R03-T1 · 수급 — 투자자별",
        "card_id": "CC-05",
        "state": {
            "kind": "tab",
            "parent_board": "2QFO-2",
            "control": "투자자별",
            "control_text": "투자자별",
        },
    }
    assert pbe.resolve_state(meta, "2QFO-2", index) == {
        "kind": "tab",
        "parent_board": None,
        "control": "투자자별",
        "control_text": "투자자별",
        "rail_owner": True,
    }
    # 부모를 이름 규약으로 다시 채우지도 않는다.
    bare = {
        "name": "CC-05 / R03-T1 · 수급 — 투자자별",
        "card_id": "CC-05",
        "state": {"kind": "tab", "parent_board": "2QFO-2"},
    }
    assert pbe.resolve_state(bare, "2QFO-2", index)["parent_board"] is None
    # 남의 보드를 부모로 적은 탭은 그대로다 — rail_owner를 붙이지 않는다.
    child = {
        "name": "CC-05 / R03-T2 · 수급 — 거래원",
        "card_id": "CC-05",
        "state": {"kind": "tab", "parent_board": "2QFO-2", "control": "거래원"},
    }
    got = pbe.resolve_state(child, "2QM7-2", index)
    assert got["parent_board"] == "2QFO-2"
    assert "rail_owner" not in got


def test_a_rail_owner_is_not_a_state_orphan():
    """레일 주인은 부모가 없어도 표식을 찍을 자리가 있다 — 미해소로 세지 않는다."""
    owners = [
        path.name
        for path in sorted(pbe.TEMPLATE_ROOT.iterdir())
        if (path / "meta.json").exists()
        and json.loads((path / "meta.json").read_text(encoding="utf-8"))
        .get("state", {})
        .get("parent_board")
        == path.name
    ]
    assert owners, "레일 주인 보드가 저장본에 하나는 있어야 한다"
    orphaned = {o["board_id"] for o in pbe.state_orphans()}
    assert not (set(owners) & orphaned)
    # 레일 주인은 제 레일에 제 표식을 단다 — 자식 목록에 자기 자신이 남는다.
    children = pbe.state_children_index()
    for owner in owners:
        assert owner in {child["board_id"] for child in children.get(owner, [])}


def test_parse_anchor_resolves_a_single_detail_op_from_the_ledger():
    details = {("kt00001", "d2_amt"): ["detail:kt00001:settlement_forecast"]}
    got = pbe.parse_anchor("raw|kt00001|body|d2_amt", {"detail:kt00001:settlement_forecast"}, details)
    assert got["mapping_id"] == "detail:kt00001:settlement_forecast"
    assert got["f"] == "d2_amt"
    # base가 보드에 배정돼 있으면 base가 이긴다.
    base = pbe.parse_anchor("raw|kt00001|body|d2_amt", {"base:kt00001"}, details)
    assert base["mapping_id"] == "base:kt00001"
    # 후보가 둘이면 좁혀지지 않으므로 null로 남긴다.
    ambiguous = {("kt00001", "d2_amt"): ["detail:kt00001:a", "detail:kt00001:b"]}
    assert pbe.parse_anchor("raw|kt00001|body|d2_amt", set(), ambiguous)["mapping_id"] is None


# --------------------------------------------------------------------------- #
# 5. 저작 필드 보존
# --------------------------------------------------------------------------- #


def test_merge_authored_keeps_hand_written_fields():
    previous = {
        "column_priority": ["종목", "현재가"],
        "slots": [{"node_id": "C-0", "kor": "예수금", "paper_text": "옛값"}],
        "column_bindings": [
            {
                "table_id": "T-0",
                "columns": [
                    {"col": 3, "header": "옛 머리", "slot_ids": ["s099"], "mapping_id": "base:x"}
                ],
            }
        ],
    }
    payload = {
        "column_priority": [],
        "slots": [{"node_id": "C-0", "kor": None, "paper_text": "1,000원"}],
        "column_bindings": [
            {"table_id": "T-0", "columns": [{"col": 3, "header": "금액", "slot_ids": ["s003"]}]}
        ],
    }
    merged = pbe.merge_authored(previous, payload)
    assert merged["column_priority"] == ["종목", "현재가"]
    assert merged["slots"][0]["kor"] == "예수금"
    assert merged["slots"][0]["paper_text"] == "1,000원"
    # 열 묶음은 구조를 새로 만들고 저작된 mapping_id만 옮겨 담는다.
    column = merged["column_bindings"][0]["columns"][0]
    assert column["header"] == "금액"
    assert column["slot_ids"] == ["s003"]
    assert column["mapping_id"] == "base:x"


def test_merge_authored_recounts_mapped_slots_after_restoring_bindings():
    previous = {
        "slots": [
            {"node_id": "A-0", "mapping_id": "base:x", "f": "amount"},
            {"node_id": "B-0", "mapping_id": None},
        ]
    }
    payload = {
        "counts": {"mapped_slots": 0},
        "slots": [
            {"node_id": "A-0", "mapping_id": None},
            {"node_id": "B-0", "mapping_id": None},
        ],
        "column_bindings": [],
    }

    merged = pbe.merge_authored(previous, payload)

    assert merged["slots"][0]["mapping_id"] == "base:x"
    assert merged["counts"]["mapped_slots"] == 1


def test_merge_authored_keeps_an_explicit_slot_kind_override():
    previous = {"slots": [{"node_id": "A-0", "kind": "label"}]}
    payload = {
        "counts": {"mapped_slots": 0, "labels": 0, "values": 2},
        "slots": [
            {"node_id": "A-0", "kind": "value", "mapping_id": None},
            {"node_id": "B-0", "kind": "value", "mapping_id": None},
        ],
        "column_bindings": [],
    }

    merged = pbe.merge_authored(previous, payload)

    assert merged["slots"][0]["kind"] == "label"
    assert merged["counts"]["labels"] == 1
    assert merged["counts"]["values"] == 1


# --------------------------------------------------------------------------- #
# 6. 실제 보드 전수 (원문이 저장된 보드만)
# --------------------------------------------------------------------------- #


def _saved_boards():
    if not pbe.TEMPLATE_ROOT.exists():
        return []
    return [
        p
        for p in sorted(pbe.TEMPLATE_ROOT.iterdir())
        if p.is_dir()
        and all((p / f).exists() for f in ("paper.jsx", "paper.tree.txt", "meta.json"))
    ]


@pytest.mark.parametrize("board_dir", _saved_boards(), ids=lambda p: p.name)
def test_saved_board_extracts(board_dir):
    html, payload = pbe.extract_board(board_dir)
    assert payload["counts"]["elements"] > 0
    assert payload["counts"]["text_nodes"] == len(payload["slots"])
    assert payload["html_sha256"] == pbe.sha256(html)
    assert sum(payload["text_multiset"].values()) == payload["counts"]["text_nodes"]
    assert len({s["slot_id"] for s in payload["slots"]}) == len(payload["slots"])
    # 레인 C 계약 — 컨테이너 쿼리 기준점은 보드마다 정확히 하나.
    assert html.count("board-surface") == 1
    # 접기 래퍼가 있으면 접을 열(3열 이상)이 있는 표가 있다는 뜻이고, 그 반대도 같다.
    assert bool(payload["counts"]["bs_col"]) == any(t["columns"] > 2 for t in payload["tables"])
    # 값 슬롯은 예외 없이 표기 기본값을 갖는다(라벨은 저작 몫으로 비워 둔다).
    for slot in payload["slots"]:
        assert (slot["format"] is not None) == (slot["kind"] == "value"), slot["slot_id"]
    # 잎 래퍼는 센 수만큼 실제로 나가고, 래퍼에는 인라인 스타일이 없다.
    assert html.count(" data-leaf>") == payload["counts"]["bs_leaf"]
    assert "data-leaf style" not in html
    # 합계·소계 행은 본문 행에 섞이지 않는다 — 표 행 밀도는 본문만 센다.
    foot = sum(len(t["foot_rows"]) for t in payload["tables"])
    assert html.count('data-row="foot"') == foot
    for table in payload["tables"]:
        assert not (set(table["body_rows"]) & set(table["foot_rows"]))
    assert payload["density"]["rows_max"] == max(
        (len(t["body_rows"]) for t in payload["tables"]), default=0
    )
    # 레일 블록은 밀도 예산(하드 5) 안에 든다 — 표 행을 블록으로 세면 여기서 터진다.
    assert payload["density"]["rail_blocks"] <= 5, payload["density"]


def test_every_saved_board_directory_is_named_by_a_paper_node_id():
    """디렉터리 이름은 Paper 보드 id다 — 이름(R11·R11-T1 등)으로 저장하면 안 된다."""
    for board_dir in _saved_boards():
        assert re.fullmatch(r"[0-9A-Z]+-[0-9]+", board_dir.name), board_dir.name


def test_no_saved_tree_is_truncated():
    """`get_tree_summary`는 depth 10에서 자른다 — 잘린 트리는 저장본이 아니다."""
    for board_dir in _saved_boards():
        text = (board_dir / "paper.tree.txt").read_text(encoding="utf-8")
        assert "children" not in text, board_dir.name


# --------------------------------------------------------------------------- #
# 7. 잎 래퍼 — 값 슬롯 앵커는 언제나 잎이다
# --------------------------------------------------------------------------- #


def _collapsed_table():
    root, elements, nodes, tables = _table_board()
    by_node = {n.node_id: el for el, n in zip(elements, nodes)}
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    pbe.apply_column_collapse(tables, by_node, node_of)
    return root, elements, node_of, by_node


def test_leaf_wrapper_moves_text_out_of_the_cell_that_carries_paired_copies():
    root, elements, node_of, by_node = _collapsed_table()
    second = by_node["R1B-0"]  # 병기 사본이 붙는 둘째 열 셀
    assert any(getattr(c, "synthetic", "") == "leaf" for c in second.children)
    wrapped = pbe.wrap_leaf_text(elements, node_of)
    # 머리 행 + 본문 3행의 둘째 셀 4개만 감싼다.
    assert wrapped == 4
    cell = pbe.serialize(second)
    assert '<span data-node="R1B-0" data-leaf>매도</span>' in cell
    # 래퍼 뒤에 병기 사본이 그대로 남는다(순서 보존).
    assert cell.index('data-leaf') < cell.index('class="bs-paired"')


def test_leaf_wrapper_keeps_slot_text_and_leafness_and_runs_once():
    root, elements, node_of, by_node = _collapsed_table()
    second = by_node["R1B-0"]
    before = pbe.direct_text(second)
    pbe.wrap_leaf_text(elements, node_of)
    assert pbe.direct_text(second) == before
    assert pbe.is_text_leaf(second)
    assert pbe.element_children(second) == []
    # 두 번 돌려도 래퍼가 겹치지 않는다(래퍼는 element_children에서 빠진다).
    assert pbe.wrap_leaf_text(elements, node_of) == 0


def test_leaf_wrapper_leaves_plain_leaves_alone():
    root, elements, node_of, _ = _collapsed_table()
    pbe.wrap_leaf_text(elements, node_of)
    html = pbe.serialize(root)
    # 사본이 붙지 않은 셀은 원문 그대로 — 래퍼로 덧씌우지 않는다.
    assert 'data-node="R1A-0" data-col="0">09/01<' in html
    assert html.count(" data-leaf>") == 4


# --------------------------------------------------------------------------- #
# 8. 상태 컨트롤 표식
# --------------------------------------------------------------------------- #

STATE_TREE = """Frame "Card" (S-0) 400×100
  Frame "Strip" (S1-0) 400×30
    Text "현재시세" (S1A-0) 60×12 "현재시세"
    Text "순위" (S1B-0) 40×12 "순위"
  Frame "Block" (S2-0) 400×60
    Text "부채·미수" (S2A-0) 80×12 "부채·미수"
    Frame "Row" (S2B-0) 400×32
      Text "0원 6항목" (S2C-0) 60×12 "0원 6항목"
      Text "▸" (S2D-0) 10×12 "▸"
"""

STATE_JSX = """(
    <div style={{ width: '400px' }}>
      <div style={{ height: '30px' }}>
        <div style={{ fontSize: '12px' }}>현재시세</div>
        <div style={{ fontSize: '12px' }}>순위</div>
      </div>
      <div style={{ height: '60px' }}>
        <div style={{ fontSize: '12px' }}>부채·미수</div>
        <div style={{ height: '32px' }}>
          <div style={{ fontSize: '12px' }}>0원 6항목</div>
          <div style={{ fontSize: '12px' }}>▸</div>
        </div>
      </div>
    </div>
  )"""


def _state_board():
    root = pbe.parse_jsx(STATE_JSX)
    nodes = pbe.parse_tree(STATE_TREE)
    elements = pbe.flatten(root)
    pbe.align(elements, nodes)
    node_of = {id(el): n for el, n in zip(elements, nodes)}
    roles = {"S1-0": "strip", "S2-0": "rail"}
    region_of = {id(el): roles[n.node_id] for el, n in zip(elements, nodes) if n.node_id in roles}
    return root, elements, node_of, region_of


@pytest.mark.parametrize(
    ("candidate", "control", "tier"),
    [
        ("정규장", "정규장", 4),
        ("5단", "호가창 · 5단", 3),
        ("호가창", "호가창 · 5단", 2),
        ("부채·미수", "부채·미수·연체 상세", 2),
        # 4단계 — 공백·`·`로 끊은 토큰이 하나만 겹쳐도 후보다.
        ("D+2 09/03", "D+2 정산 후 계좌", 1),
        ("등락률", "정렬 · 거래량", 0),
        # 한 글자 토큰은 흔해서 겹침으로 세지 않는다.
        ("순", "신용비율 높은 순", 0),
    ],
)
def test_control_tier_orders_exact_then_tail_then_partial_then_token(candidate, control, tier):
    assert pbe.control_tier(candidate, control) == tier


def test_mark_state_controls_marks_strip_leaf_and_expand_arrow():
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {"board_id": "X-0", "kind": "tab", "control": "현재시세"},
            {"board_id": "Y-0", "kind": "expand", "control": "부채·미수·연체 상세"},
            {"board_id": "Q-0", "kind": "sort", "control": "없는 문구"},
        ],
    )
    by_control = {m["control"]: m for m in marks}
    assert by_control["현재시세"]["node_id"] == "S1A-0"
    assert by_control["현재시세"]["how"] == "exact"
    # 펼침은 ▸ 잎에 찍고, 문구는 그 잎을 감싼 블록에서 찾는다.
    assert by_control["부채·미수·연체 상세"]["node_id"] == "S2D-0"
    assert by_control["부채·미수·연체 상세"]["how"] == "partial"
    assert [u["board_id"] for u in unresolved] == ["Q-0"]
    assert unresolved[0]["reason"] == "후보 없음"
    html = pbe.serialize(root)
    assert 'data-state-control="현재시세" data-state-board="X-0"' in html


def test_state_boards_that_share_one_control_share_one_leaf():
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {"board_id": "B-0", "kind": "tab", "control": "순위"},
            {"board_id": "A-0", "kind": "tab", "control": "순위"},
        ],
    )
    assert unresolved == []
    assert marks[0]["boards"] == ["A-0", "B-0"]
    assert 'data-state-board="A-0 B-0"' in pbe.serialize(root)


def test_one_leaf_takes_one_control_only():
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {"board_id": "X-0", "kind": "tab", "control": "순위"},
            {"board_id": "Y-0", "kind": "tab", "control": "순위표"},
        ],
    )
    # 정확 일치가 잎을 먼저 가져가고, 부분 일치만 남은 쪽은 미해소로 적힌다.
    assert [m["control"] for m in marks] == ["순위"]
    assert unresolved[0]["board_id"] == "Y-0"
    assert unresolved[0]["reason"] == "후보를 다른 컨트롤이 먼저 가져감"


def test_control_text_matches_the_leaf_the_name_cannot_reach():
    """이름에서 뽑은 문구로는 못 맞추는 자리를 손지정 문구가 집는다."""
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {
                "board_id": "H-0",
                "kind": "tab",
                "control": "현금 흐름",
                "control_text": "0원 6항목",
            }
        ],
    )
    assert unresolved == []
    assert marks[0]["node_id"] == "S2C-0"
    assert marks[0]["how"] == "hand"
    # 표식에 적히는 이름은 손지정 문구가 아니라 컨트롤 이름이다.
    assert 'data-state-control="현금 흐름"' in pbe.serialize(root)


def test_expand_control_text_falls_back_to_plain_leaf_when_no_expand_glyph_exists():
    root = pbe.parse_jsx("(<div><div>금현물</div></div>)")
    elements = pbe.flatten(root)
    leaf = next(el for el in elements if pbe.direct_text(el) == "금현물")
    node_of = {id(leaf): pbe.TreeNode(1, "Text", "금현물", "G-0", 60, 12, "금현물")}
    region_of = {id(root): "strip"}

    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {
                "board_id": "3ODO-0",
                "kind": "expand",
                "control": "금현물 잔고·거래내역",
                "control_text": "금현물",
            }
        ],
    )

    assert unresolved == []
    assert marks[0]["node_id"] == "G-0"
    assert marks[0]["how"] == "hand"
    assert 'data-state-control="금현물 잔고·거래내역"' in pbe.serialize(root)


def test_expand_control_text_prefers_its_exact_plain_leaf_over_expand_glyphs():
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {
                "board_id": "H-0",
                "kind": "expand",
                "control": "현금 흐름",
                "control_text": "0원 6항목",
            }
        ],
    )

    assert unresolved == []
    assert marks[0]["node_id"] == "S2C-0"
    assert marks[0]["how"] == "hand"


def test_expand_control_text_keeps_glyph_when_no_plain_leaf_matches_exactly():
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {
                "board_id": "H-0",
                "kind": "expand",
                "control": "현금 묶음",
                "control_text": "0원 6항목 상세",
            }
        ],
    )

    assert unresolved == []
    assert marks[0]["node_id"] == "S2D-0"
    assert marks[0]["how"] == "hand"


def test_control_text_takes_the_leaf_before_a_name_match():
    root, elements, node_of, region_of = _state_board()
    marks, unresolved = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [
            {"board_id": "A-0", "kind": "tab", "control": "순위"},
            {"board_id": "B-0", "kind": "tab", "control": "다른 것", "control_text": "순위"},
        ],
    )
    assert [m["boards"] for m in marks] == [["B-0"]]
    assert [u["board_id"] for u in unresolved] == ["A-0"]
    assert unresolved[0]["reason"] == "후보를 다른 컨트롤이 먼저 가져감"


def test_token_overlap_is_the_last_tier_for_an_expand_arrow():
    root, elements, node_of, region_of = _state_board()
    marks, _ = pbe.mark_state_controls(
        elements,
        node_of,
        region_of,
        [{"board_id": "T-0", "kind": "expand", "control": "6항목 통화별 상세"}],
    )
    assert marks[0]["node_id"] == "S2D-0"
    assert marks[0]["how"] == "token"


def test_build_index_counts_resolution_and_lists_the_rest():
    entry = {
        "board_id": "P-0",
        "state_controls": {
            "marks": [{"control": "순위", "kind": "tab", "boards": ["A-0", "B-0"], "how": "exact"}],
            "unresolved": [{"board_id": "C-0", "kind": "expand", "control": "상세", "reason": "후보 없음"}],
        },
    }
    orphans = [{"board_id": "D-0", "kind": "tab", "control": "탭", "reason": "부모 보드 없음"}]
    index = pbe.build_index([entry], orphans)
    assert index["state_controls"]["resolved"] == 2
    assert index["state_controls"]["unresolved_count"] == 2
    assert [u["board_id"] for u in index["state_controls"]["unresolved"]] == ["C-0", "D-0"]


# --------------------------------------------------------------------------- #
# 9. 포맷 추론
# --------------------------------------------------------------------------- #


def _leaf(text: str, style: str = "") -> pbe.Element:
    style_attr = " style={{ %s }}" % style if style else ""
    return pbe.parse_jsx("(<div%s>%s</div>)" % (style_attr, text))


@pytest.mark.parametrize(
    ("text", "unit", "sign", "precision"),
    [
        ("+1,842억원", "krw_ko", True, 0),
        ("31,240,000원", "krw_ko", False, 0),
        ("2.2만", "krw_ko", False, 1),
        ("+1.24%", "percent", True, 2),
        ("고가 0.6%", "percent", False, 1),
        ("3,420주", "shares", False, 0),
        ("42.6만주", "shares", False, 1),
        ("12건", "count", False, 0),
        ("09:42:18", "time", False, 0),
        ("1975-06-11", "date", False, 0),
        ("−2,000", "text", True, 0),
        ("005930", "text", False, 0),
        ("KODEX 200", "text", False, 0),
    ],
)
def test_infer_format_reads_unit_sign_and_precision(text, unit, sign, precision):
    fmt = pbe.infer_format(text, _leaf(text))
    assert (fmt["unit"], fmt["sign"], fmt["precision"]) == (unit, sign, precision)


def test_infer_format_tone_follows_sign_or_up_down_color():
    assert pbe.infer_format("150,850", _leaf("150,850"))["tone"] == "neutral"
    assert pbe.infer_format("+1,850", _leaf("+1,850"))["tone"] == "change"
    colored = _leaf("150,850", "color: 'var(--color-up)'")
    assert pbe.infer_format("150,850", colored)["tone"] == "change"
    inherited = pbe.parse_jsx(
        "(<div style={{ color: 'var(--color-down)' }}><div>150,850</div></div>)"
    )
    leaf = pbe.element_children(inherited)[0]
    assert pbe.infer_format("150,850", leaf)["tone"] == "change"
