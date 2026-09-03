#!/usr/bin/env python3
"""Paper 보드 원문(JSX + 트리) → `board.html` · `slots.json` 추출기.

입력 `backend/ref/card-surface-templates/<board>/`
  `paper.jsx`       `get_jsx(format="inline-styles")` 원문
  `paper.tree.txt`  `get_tree_summary(depth=10)` 원문
  `meta.json`       board_id·card_id·width·height·state·operation_refs
  `regions.json`    node_id → 영역 role (bs-* 클래스가 된다)

출력
  `<board>/board.html`  인라인 스타일 원문 + `data-node`/`data-name` + `bs-*` 영역 클래스
                        + 보드 루트 `.board-surface` · 표 열 접기 래퍼 `.bs-col`
                        + 병기 사본 `.bs-paired` · KPI 셀 `.bs-kpi-cell`(레인 C 계약)
                        + 값 자리 잎 래퍼 `<span data-node data-leaf>`(앵커는 늘 잎)
                        + 상태 컨트롤 표식 `data-state-control`/`data-state-board`
  `<board>/slots.json`  텍스트 노드 1:1 슬롯 스켈레톤 + 해시 · 텍스트 다중집합
                        + 표 열 단위 `column_bindings` · 값 슬롯 `format` 기본값
                        + 자식 상태 보드 표식 결과 `state_controls`
                        + 밀도 `density`(아래 세 줄이 세는 잣대다)

밀도 계수 — Paper가 눈으로 가르는 단위를 그대로 센다
  `rail_blocks`   `bs-rail` 직계 자식 중 제목(`--font-strong` 텍스트로 시작)이 여는 묶음.
                  직계 자식을 그대로 세면 표 본문 행까지 블록이 된다(호가 보드 13 ← 2).
  `kpi_cells`     `bs-kpi` 직계 자식(`bs-kpi-cell`)만.
  `rows_max`      표 본문 행(`data-row`가 `head`·`foot`이 아닌 행). 합계·소계 행은
                  `data-row="foot"`으로 빼고 `tables[].foot_rows`에 따로 적는다.
  `index.json`          보드 목록(board_id·card_id·state·counts)
                        + 상태 컨트롤 해소 요약(`state_controls.unresolved`)

표준 라이브러리만 쓴다. 실행:
  python scripts/paper_board_extract.py [board ...] [--check] [--apply-columns] [--no-index]

`--check`는 파일을 쓰지 않고 디스크 내용과 대조한다(해시 드리프트 검사).
`--apply-columns`는 열 하나에 저작된 mapping_id/f·`alt_mappings`를 그 열의 셀 슬롯
전부에 퍼뜨린다. 열에 `indexed`를 적으면 본문 행마다 다른 필드를 준다.
`--no-index`는 보드 산출물만 쓰고 index.json은 건드리지 않는다.

저작이 손으로 적는 열쇠(추출기는 만들지 않고 `merge_authored`가 지킨다)
  슬롯·열 `alt_mappings` `[{"mapping_id", "f", "json_path"?}]`
        같은 자리를 여러 op의 같은 뜻 필드가 나눠 쓸 때(차트 주기 틱/분/일/주/월/년,
        업종 차트 6종, 금현물 주기). 검사기는 이 목록도 "필드 도달"로 센다.
  슬롯 `kind`
        자동 label/value 판정이 Paper 의미와 다를 때 손으로 고친 값을 재추출에서도 지킨다.
  열 `indexed` `{"f_pattern": "sel_bid_{i}", "start": 1, "step": 1, "direction": "down"}`
        표 본문 행 r(0부터)이 `f_pattern.format(i=start + r*step)`을 받는다.
        호가 10단처럼 위에서 아래로 번호가 줄면 `direction: "up"` · `start: 10` · `step: -1`.
  `meta.json`의 `state.control_text`
        상태 컨트롤 표식을 이름 대신 부모 보드에 실제로 적힌 문구로 맞춘다(손지정 우선).

`state.parent_board`가 자기 자신이면 부모가 없는 레일 주인이다 — 부모는 `null`로 두고
`rail_owner: true`를 적는다(`kind`는 그대로 `tab`). 탭 묶음의 첫 장이 제 레일을 이고
있는 자리라 되돌아갈 부모가 없다. 표식은 여전히 제 레일에 찍는다.

저작물 검사는 `scripts/validate_board_slots.py <board ...>`가 맡는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "backend" / "ref" / "card-surface-templates"
INDEX_PATH = TEMPLATE_ROOT / "index.json"

VOID_TAGS = frozenset(
    "area base br col embed hr img input link meta param source track wbr".split()
)

# JSX에서 kebab-case로 바꾸면 안 되는 SVG 속성(브라우저가 대소문자를 구분한다).
SVG_CAMEL_KEEP = frozenset(
    """viewBox preserveAspectRatio patternUnits patternContentUnits patternTransform
    gradientUnits gradientTransform spreadMethod clipPathUnits maskUnits
    maskContentUnits filterUnits primitiveUnits markerWidth markerHeight markerUnits
    refX refY stdDeviation baseFrequency numOctaves textLength lengthAdjust
    startOffset xChannelSelector yChannelSelector requiredExtensions systemLanguage
    attributeName repeatCount repeatDur keyTimes keySplines calcMode diffuseConstant
    specularConstant specularExponent surfaceScale kernelMatrix kernelUnitLength
    limitingConeAngle pointsAtX pointsAtY pointsAtZ tableValues targetX targetY
    edgeMode""".split()
)

ROLE_TOKEN = re.compile(r"^[a-z][a-z0-9-]*$")

RESPONSIVE_TRAIT_ORDER = (
    "atomic",
    "flow",
    "scroll",
    "paired-table",
    "scroll-table",
)
RESPONSIVE_TRAITS = frozenset(RESPONSIVE_TRAIT_ORDER)
RESPONSIVE_LAYOUT_TRAITS = frozenset(
    ("flow", "scroll", "paired-table", "scroll-table")
)
RESPONSIVE_SCROLL_TRAITS = frozenset(("scroll", "scroll-table"))

ATTR_RENAME = {"className": "class", "htmlFor": "for"}

# 값이 아니라 라벨임을 뒤집는 문자(숫자·부호·단위·날짜·시각 흔적).
_VALUE_MARK = re.compile(r"[0-9%+₩$]")

TREE_LINE = re.compile(
    r"^(?P<indent> *)(?P<component>[A-Za-z][A-Za-z0-9]*) "
    r'"(?P<name>.*)" '
    r"\((?P<id>[0-9A-Za-z]+-[0-9]+)\) "
    r"(?P<w>[0-9.]+)×(?P<h>[0-9.]+)"
    r'(?: "(?P<text>.*)")?\s*$'
)


FIELD_LEDGER = ROOT / "PAPER_FIELD_COVERAGE.json"


class ExtractError(RuntimeError):
    """추출 실패(fail-closed)."""


def _reject_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ExtractError(f"regions.json duplicate raw JSON key: {key!r}")
        value[key] = item
    return value


def load_regions_json(path: Path) -> dict[str, object]:
    try:
        data = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_json_keys
        )
    except json.JSONDecodeError as exc:
        raise ExtractError(f"regions.json is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ExtractError("regions.json root must be an object")
    return data


def load_regions(path: Path) -> tuple[dict[str, str], str | None]:
    """regions.json을 node_id→role 표로 읽는다.

    두 형태를 받는다: `{"roles": {node_id: role}}`와
    `{"root": id, "regions": [{"node_id", "role", ...}]}`(Paper 저장 레인 형식).
    """
    if not path.exists():
        return {}, None
    data = load_regions_json(path)
    if isinstance(data.get("roles"), dict):
        return dict(data["roles"]), data.get("root")
    roles: dict[str, str] = {}
    for entry in data.get("regions", []):
        node_id = entry.get("node_id")
        role = entry.get("role")
        if not node_id or not role:
            raise ExtractError(f"regions.json 항목에 node_id/role이 없다: {entry!r}")
        if node_id in roles and roles[node_id] != role:
            raise ExtractError(f"regions.json에 {node_id} role이 중복된다")
        roles[node_id] = role
    return roles, data.get("root")


def load_responsive(path: Path, known_node_ids: set[str]) -> list[dict]:
    """Read optional responsive traits without changing load_regions' public contract."""
    if not path.exists():
        return []
    data = load_regions_json(path)
    raw_entries = data.get("responsive", [])
    if raw_entries is None or not isinstance(raw_entries, list):
        raise ExtractError("regions.json responsive must be an array")

    entries: list[dict] = []
    seen_nodes: set[str] = set()
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise ExtractError(f"responsive entry must be an object: {raw!r}")
        node_id = raw.get("node_id")
        if not isinstance(node_id, str) or not node_id:
            raise ExtractError(f"responsive entry is missing node_id: {raw!r}")
        if node_id in seen_nodes:
            raise ExtractError(f"responsive node is duplicated: {node_id}")
        if node_id not in known_node_ids:
            raise ExtractError(f"responsive node does not exist: {node_id}")
        raw_traits = raw.get("traits")
        if not isinstance(raw_traits, list) or not raw_traits:
            raise ExtractError(f"responsive traits must be a nonempty array: {node_id}")
        if any(not isinstance(trait, str) or not trait for trait in raw_traits):
            raise ExtractError(f"responsive traits must be nonempty strings: {node_id}")
        if any(trait not in RESPONSIVE_TRAITS for trait in raw_traits):
            raise ExtractError(f"responsive traits are not allowlisted: {node_id}")
        if len(set(raw_traits)) != len(raw_traits):
            raise ExtractError(f"responsive traits are duplicated: {node_id}")
        traits = tuple(trait for trait in RESPONSIVE_TRAIT_ORDER if trait in raw_traits)
        if len(set(traits) & RESPONSIVE_LAYOUT_TRAITS) > 1:
            raise ExtractError(f"responsive has multiple layout traits: {node_id}")
        accessible_label = raw.get("accessible_label")
        if accessible_label is not None and (
            not isinstance(accessible_label, str) or not accessible_label.strip()
        ):
            raise ExtractError(f"responsive accessible_label must be nonempty: {node_id}")
        if set(traits) & RESPONSIVE_SCROLL_TRAITS and not accessible_label:
            raise ExtractError(f"responsive scroll requires accessible_label: {node_id}")
        entries.append(
            {
                "node_id": node_id,
                "traits": traits,
                "accessible_label": accessible_label,
            }
        )
        seen_nodes.add(node_id)
    return entries


_LEDGER_ROWS: list[dict] | None = None
_DETAIL_BY_FIELD: dict[tuple[str, str], list[str]] | None = None


def ledger_rows() -> list[dict]:
    """필드 원장(760KB)은 보드마다 다시 읽지 않는다."""
    global _LEDGER_ROWS
    if _LEDGER_ROWS is None:
        _LEDGER_ROWS = (
            json.loads(FIELD_LEDGER.read_text(encoding="utf-8")).get("rows", [])
            if FIELD_LEDGER.exists()
            else []
        )
    return _LEDGER_ROWS


def ledger_operation_refs(board_id: str) -> list[str]:
    """meta.json에 operation_refs가 없을 때 필드 원장에서 보드별 op을 모은다."""
    return sorted({r["mapping_id"] for r in ledger_rows() if r.get("board") == board_id})


def detail_ops_by_field() -> dict[tuple[str, str], list[str]]:
    """`(tr, f)` → 그 필드를 싣는 `detail:<tr>:*` mapping_id 목록."""
    global _DETAIL_BY_FIELD
    if _DETAIL_BY_FIELD is None:
        found: dict[tuple[str, str], set[str]] = {}
        for row in ledger_rows():
            mapping_id = row.get("mapping_id") or ""
            field = row.get("f")
            if not field or not mapping_id.startswith("detail:"):
                continue
            parts = mapping_id.split(":")
            if len(parts) < 3:
                continue
            found.setdefault((parts[1], field), set()).add(mapping_id)
        _DETAIL_BY_FIELD = {key: sorted(value) for key, value in found.items()}
    return _DETAIL_BY_FIELD


# --------------------------------------------------------------------------- #
# JSX 토크나이저
# --------------------------------------------------------------------------- #


class Element:
    """JSX 요소 하나. children은 Element 또는 정규화된 텍스트 str.

    `synthetic`은 추출기가 새로 만든 요소를 표시한다. `"wrap"`은 자식을 감싸는
    투명 래퍼(.bs-col), `"leaf"`는 덧붙인 사본(.bs-paired)이다. 둘 다 Paper 트리에
    대응 노드가 없으므로 `element_children`이 건너뛰거나 꿰뚫어 본다.
    """

    __slots__ = (
        "tag", "attrs", "children", "self_closing", "parent", "depth", "index", "synthetic"
    )

    def __init__(self, tag: str) -> None:
        self.tag = tag
        self.attrs: list[tuple[str, object]] = []
        self.children: list[object] = []
        self.self_closing = False
        self.parent: Element | None = None
        self.depth = 0
        self.index = -1
        self.synthetic = ""

    def __repr__(self) -> str:  # pragma: no cover - 디버깅용
        return f"<Element {self.tag} depth={self.depth} index={self.index}>"


class StyleObject:
    """`style={{ ... }}`의 속성 쌍 목록(원문 순서 보존)."""

    __slots__ = ("pairs",)

    def __init__(self, pairs: list[tuple[str, str]]) -> None:
        self.pairs = pairs

    def to_css(self) -> str:
        return "; ".join(f"{css_property_name(k)}: {v}" for k, v in self.pairs)

    def get(self, css_name: str) -> str | None:
        for key, value in self.pairs:
            if css_property_name(key) == css_name:
                return value
        return None


def _kebab(name: str) -> str:
    out: list[str] = []
    for ch in name:
        if ch.isupper():
            out.append("-")
            out.append(ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def css_property_name(key: str) -> str:
    """React 인라인 스타일 키 → CSS 속성 이름.

    `MozOsxFontSmoothing` → `-moz-osx-font-smoothing`,
    `WebkitFontSmoothing` → `-webkit-font-smoothing`,
    `msFlexAlign` → `-ms-flex-align`, `--custom` → `--custom`.
    """
    if key.startswith("--"):
        return key
    if key.startswith("ms") and len(key) > 2 and key[2].isupper():
        return "-ms" + _kebab(key[2:])
    return _kebab(key)


def html_attr_name(name: str) -> str:
    """JSX 속성 이름 → HTML 속성 이름."""
    if name in ATTR_RENAME:
        return ATTR_RENAME[name]
    if name in SVG_CAMEL_KEEP:
        return name
    if "-" in name or ":" in name or name.islower():
        return name
    return _kebab(name)


def _normalize_jsx_text(raw: str) -> str:
    """JSX 텍스트 노드 공백 규칙: 개행이 있으면 줄 단위 트림 후 공백 하나로 잇는다."""
    if "\n" not in raw:
        return raw
    kept = [line.strip(" \t\r") for line in raw.split("\n")]
    return " ".join(part for part in kept if part)


class _JsxParser:
    def __init__(self, src: str) -> None:
        self.s = src
        self.i = 0
        self.n = len(src)

    # -- 저수준 --------------------------------------------------------- #
    def _ws(self) -> None:
        while self.i < self.n and self.s[self.i] in " \t\r\n":
            self.i += 1

    def _fail(self, msg: str) -> None:
        line = self.s.count("\n", 0, self.i) + 1
        raise ExtractError(f"JSX 파싱 실패 {line}행: {msg}")

    def _name(self) -> str:
        start = self.i
        while self.i < self.n and (
            self.s[self.i].isalnum() or self.s[self.i] in "-_:."
        ):
            self.i += 1
        if start == self.i:
            self._fail("이름 토큰이 비었다")
        return self.s[start : self.i]

    def _quoted(self) -> str:
        quote = self.s[self.i]
        self.i += 1
        buf: list[str] = []
        while self.i < self.n:
            ch = self.s[self.i]
            if ch == "\\" and self.i + 1 < self.n:
                buf.append(self.s[self.i + 1])
                self.i += 2
                continue
            if ch == quote:
                self.i += 1
                return "".join(buf)
            buf.append(ch)
            self.i += 1
        self._fail("닫히지 않은 문자열")
        return ""

    def _braced(self) -> str:
        """`{`부터 짝이 맞는 `}`까지의 안쪽 문자열."""
        if self.s[self.i] != "{":
            self._fail("중괄호 시작 아님")
        depth = 0
        start = self.i
        while self.i < self.n:
            ch = self.s[self.i]
            if ch in "'\"":
                self._quoted()
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    self.i += 1
                    return self.s[start + 1 : self.i - 1]
            self.i += 1
        self._fail("닫히지 않은 중괄호")
        return ""

    # -- 요소 ----------------------------------------------------------- #
    def parse(self) -> Element:
        self._ws()
        if self.i < self.n and self.s[self.i] == "(":
            self.i += 1
        self._ws()
        root = self._element()
        self._ws()
        if self.i < self.n and self.s[self.i] == ")":
            self.i += 1
        self._ws()
        if self.i != self.n:
            self._fail(f"꼬리 토큰이 남았다: {self.s[self.i : self.i + 40]!r}")
        return root

    def _element(self) -> Element:
        if self.s[self.i] != "<":
            self._fail("요소 시작 `<` 아님")
        self.i += 1
        el = Element(self._name())
        while True:
            self._ws()
            if self.i >= self.n:
                self._fail("닫히지 않은 여는 태그")
            if self.s[self.i] == ">":
                self.i += 1
                break
            if self.s.startswith("/>", self.i):
                self.i += 2
                el.self_closing = True
                return el
            name = self._name()
            self._ws()
            if self.i < self.n and self.s[self.i] == "=":
                self.i += 1
                self._ws()
                ch = self.s[self.i]
                if ch in "'\"":
                    el.attrs.append((name, self._quoted()))
                elif ch == "{":
                    inner = self._braced().strip()
                    if name == "style" and inner.startswith("{"):
                        el.attrs.append((name, StyleObject(parse_style_object(inner))))
                    else:
                        el.attrs.append((name, ("expr", inner)))
                else:
                    self._fail(f"속성 {name}의 값을 읽지 못했다")
            else:
                el.attrs.append((name, True))
        self._children(el)
        return el

    def _children(self, el: Element) -> None:
        while True:
            if self.i >= self.n:
                self._fail(f"닫히지 않은 <{el.tag}>")
            if self.s.startswith("</", self.i):
                self.i += 2
                closing = self._name()
                self._ws()
                if self.i >= self.n or self.s[self.i] != ">":
                    self._fail("닫는 태그가 `>`로 끝나지 않는다")
                self.i += 1
                if closing != el.tag:
                    self._fail(f"태그 짝이 어긋난다: <{el.tag}> ↔ </{closing}>")
                return
            if self.s[self.i] == "<":
                child = self._element()
                child.parent = el
                el.children.append(child)
                continue
            start = self.i
            while self.i < self.n and self.s[self.i] != "<":
                self.i += 1
            text = _normalize_jsx_text(self.s[start : self.i])
            if text:
                el.children.append(text)


def parse_style_object(text: str) -> list[tuple[str, str]]:
    """`{ backgroundColor: 'x', fontSize: '12px' }` → [(key, value), ...]."""
    body = text.strip()
    if not (body.startswith("{") and body.endswith("}")):
        raise ExtractError(f"스타일 객체 형태가 아니다: {body[:40]!r}")
    body = body[1:-1]
    pairs: list[tuple[str, str]] = []
    i, n = 0, len(body)
    while i < n:
        while i < n and body[i] in " \t\r\n,":
            i += 1
        if i >= n:
            break
        if body[i] in "'\"":
            quote = body[i]
            j = i + 1
            while j < n and body[j] != quote:
                j += 1
            key = body[i + 1 : j]
            i = j + 1
        else:
            j = i
            while j < n and body[j] != ":":
                j += 1
            key = body[i:j].strip()
            i = j
        while i < n and body[i] in " \t\r\n":
            i += 1
        if i >= n or body[i] != ":":
            raise ExtractError(f"스타일 키 {key!r} 뒤에 `:`가 없다")
        i += 1
        while i < n and body[i] in " \t\r\n":
            i += 1
        if i < n and body[i] in "'\"":
            quote = body[i]
            j = i + 1
            buf: list[str] = []
            while j < n:
                if body[j] == "\\" and j + 1 < n:
                    buf.append(body[j + 1])
                    j += 2
                    continue
                if body[j] == quote:
                    break
                buf.append(body[j])
                j += 1
            value = "".join(buf)
            i = j + 1
        else:
            j = i
            depth = 0
            while j < n and (body[j] != "," or depth):
                if body[j] in "([":
                    depth += 1
                elif body[j] in ")]":
                    depth -= 1
                j += 1
            value = body[i:j].strip()
            i = j
        if not key:
            raise ExtractError("스타일 키가 비었다")
        pairs.append((key, value))
    return pairs


def parse_jsx(src: str) -> Element:
    root = _JsxParser(src).parse()
    _number(root, 0, [0])
    return root


def _number(el: Element, depth: int, counter: list[int]) -> None:
    el.depth = depth
    el.index = counter[0]
    counter[0] += 1
    for child in el.children:
        if isinstance(child, Element):
            _number(child, depth + 1, counter)


# --------------------------------------------------------------------------- #
# HTML 직렬화
# --------------------------------------------------------------------------- #


def escape_text(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def escape_attr(value: str) -> str:
    return escape_text(value).replace('"', "&quot;")


def serialize(el: Element) -> str:
    """요소 트리를 공백을 덧붙이지 않고 HTML로 쓴다(픽셀 동일 보장)."""
    out: list[str] = []
    _serialize(el, out)
    return "".join(out)


def _serialize(el: Element, out: list[str]) -> None:
    out.append("<" + el.tag)
    for name, value in el.attrs:
        if value is True:
            out.append(" " + html_attr_name(name))
            continue
        if isinstance(value, StyleObject):
            out.append(f' style="{escape_attr(value.to_css())}"')
            continue
        if isinstance(value, tuple):  # ("expr", "...")
            out.append(f' {html_attr_name(name)}="{escape_attr(value[1])}"')
            continue
        out.append(f' {html_attr_name(name)}="{escape_attr(str(value))}"')
    if el.self_closing and not el.children:
        if el.tag in VOID_TAGS:
            out.append(" />")
        else:
            out.append(f"></{el.tag}>")
        return
    out.append(">")
    for child in el.children:
        if isinstance(child, Element):
            _serialize(child, out)
        else:
            out.append(escape_text(child))
    out.append(f"</{el.tag}>")


# --------------------------------------------------------------------------- #
# 트리 요약 파싱
# --------------------------------------------------------------------------- #


class TreeNode:
    __slots__ = ("depth", "component", "name", "node_id", "width", "height", "text")

    def __init__(
        self,
        depth: int,
        component: str,
        name: str,
        node_id: str,
        width: float,
        height: float,
        text: str | None,
    ) -> None:
        self.depth = depth
        self.component = component
        self.name = name
        self.node_id = node_id
        self.width = width
        self.height = height
        self.text = text

    @property
    def resolved_name(self) -> str:
        """요약이 20자에서 잘라 `…`를 붙인 자동 이름은 실제 텍스트로 되돌린다."""
        if self.name.endswith("…") and self.text and self.text.startswith(self.name[:-1]):
            return self.text
        return self.name


_TREE_ESCAPE = re.compile(r"\\(.)")
_TREE_UNESCAPE = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}


def unescape_tree_text(text: str | None) -> str | None:
    """트리 요약은 줄바꿈을 `\\n`으로 적는다(`<br>`가 든 텍스트 노드)."""
    if text is None or "\\" not in text:
        return text
    return _TREE_ESCAPE.sub(lambda m: _TREE_UNESCAPE.get(m.group(1), m.group(0)), text)


def parse_tree(src: str) -> list[TreeNode]:
    nodes: list[TreeNode] = []
    for lineno, line in enumerate(src.splitlines(), start=1):
        if not line.strip():
            continue
        m = TREE_LINE.match(line)
        if not m:
            raise ExtractError(f"트리 {lineno}행을 해석하지 못했다: {line!r}")
        indent = len(m.group("indent"))
        if indent % 2:
            raise ExtractError(f"트리 {lineno}행 들여쓰기가 2의 배수가 아니다")
        nodes.append(
            TreeNode(
                depth=indent // 2,
                component=m.group("component"),
                name=unescape_tree_text(m.group("name")) or "",
                node_id=m.group("id"),
                width=float(m.group("w")),
                height=float(m.group("h")),
                text=unescape_tree_text(m.group("text")),
            )
        )
    if not nodes:
        raise ExtractError("트리가 비었다")
    return nodes


# --------------------------------------------------------------------------- #
# 정렬 · 주석
# --------------------------------------------------------------------------- #


def flatten(root: Element) -> list[Element]:
    """트리 요약과 맞출 요소만 DFS 선주회로 늘어놓는다.

    `paper.tree.txt`는 void 요소(`<br>`)를 노드로 내보내지 않으므로 정렬에서도 뺀다.
    """
    order: list[Element] = []

    def walk(el: Element) -> None:
        order.append(el)
        for child in el.children:
            if isinstance(child, Element) and child.tag not in VOID_TAGS:
                walk(child)

    walk(root)
    return order


def align(elements: list[Element], nodes: list[TreeNode]) -> None:
    """DFS 선주회 순서로 요소↔트리 노드를 맞추고 `data-node`/`data-name`을 붙인다."""
    if len(elements) != len(nodes):
        limit = min(len(elements), len(nodes))
        first = limit
        for i in range(limit):
            if elements[i].depth != nodes[i].depth:
                first = i
                break
        ctx_e = elements[first] if first < len(elements) else None
        ctx_n = nodes[first] if first < len(nodes) else None
        raise ExtractError(
            f"노드 수 불일치: JSX {len(elements)}개 ↔ 트리 {len(nodes)}개. "
            f"첫 어긋남 index={first} "
            f"jsx={'<%s depth=%d>' % (ctx_e.tag, ctx_e.depth) if ctx_e else '없음'} "
            f"tree={'%s %r (%s) depth=%d' % (ctx_n.component, ctx_n.name, ctx_n.node_id, ctx_n.depth) if ctx_n else '없음'}"
        )
    for i, (el, node) in enumerate(zip(elements, nodes)):
        if el.depth != node.depth:
            raise ExtractError(
                f"깊이 불일치 index={i}: JSX <{el.tag}> depth={el.depth} ↔ "
                f"트리 {node.component} {node.name!r} ({node.node_id}) depth={node.depth}"
            )
        el.attrs.append(("data-node", node.node_id))
        name = node.resolved_name
        if name and name != "Frame" and name != (node.text or ""):
            el.attrs.append(("data-name", name))


def add_class(el: Element, value: str) -> None:
    for idx, (name, current) in enumerate(el.attrs):
        if name in ("class", "className"):
            parts = str(current).split()
            if value not in parts:
                parts.append(value)
            el.attrs[idx] = ("class", " ".join(parts))
            return
    el.attrs.append(("class", value))


def set_attr(el: Element, name: str, value: object) -> None:
    for idx, (current_name, _) in enumerate(el.attrs):
        if current_name == name:
            el.attrs[idx] = (name, value)
            return
    el.attrs.append((name, value))


def apply_responsive(
    elements: list[Element], nodes: list[TreeNode], declarations: list[dict]
) -> None:
    """Emit deterministic responsive metadata without changing structural roles."""
    by_id = {node.node_id: el for el, node in zip(elements, nodes)}
    for declaration in declarations:
        node_id = declaration["node_id"]
        element = by_id[node_id]
        traits = tuple(
            trait for trait in RESPONSIVE_TRAIT_ORDER if trait in declaration["traits"]
        )
        is_scroll = bool(set(traits) & RESPONSIVE_SCROLL_TRAITS)
        if is_scroll:
            existing_role = next(
                (value for name, value in element.attrs if name == "role"), None
            )
            if existing_role is not None and existing_role != "region":
                raise ExtractError(
                    f"responsive scroll cannot overwrite existing role: {node_id}"
                )
        for trait in traits:
            add_class(element, f"bs-r-{trait}")
        if is_scroll:
            set_attr(element, "role", "region")
            set_attr(element, "tabindex", "0")
            set_attr(element, "aria-label", declaration["accessible_label"])


def apply_regions(
    elements: list[Element], nodes: list[TreeNode], roles: dict[str, str]
) -> dict[str, str]:
    """regions.json의 node_id→role을 `bs-<role>` 클래스로 얹는다."""
    by_id = {node.node_id: el for el, node in zip(elements, nodes)}
    assigned: dict[str, str] = {}
    unknown = sorted(set(roles) - set(by_id))
    if unknown:
        raise ExtractError(f"regions.json에 없는 노드: {unknown}")
    for node_id, role in roles.items():
        if not ROLE_TOKEN.match(role):
            raise ExtractError(f"영역 role 형식이 아니다: {role!r} ({node_id})")
        add_class(by_id[node_id], f"bs-{role}")
        assigned[node_id] = role
    return assigned


# --------------------------------------------------------------------------- #
# DOM 질의 헬퍼
# --------------------------------------------------------------------------- #


def element_children(el: Element) -> list[Element]:
    """Paper 노드에 대응하는 자식만 돌려준다.

    void 요소(`<br>`)와 병기 사본(`synthetic="leaf"`)·텍스트 잎 래퍼
    (`synthetic="text"`)는 빼고, 접기 래퍼(`synthetic="wrap"`)는 꿰뚫어 본다 —
    래퍼를 넣기 전후로 판정이 같아야 한다.
    """
    out: list[Element] = []
    for child in el.children:
        if not isinstance(child, Element) or child.tag in VOID_TAGS:
            continue
        if child.synthetic in ("leaf", "text"):
            continue
        if child.synthetic in ("wrap", "semantic"):
            out.extend(element_children(child))
            continue
        out.append(child)
    return out


def is_title_text(el: Element) -> bool:
    """제목 활자(`--font-strong`)로 그린 텍스트 잎인가."""
    style = style_of(el)
    return style is not None and style.get("font-family") == "var(--font-strong)"


def rail_blocks_of(rail: Element) -> list[list[Element]]:
    """레일의 블록 — 제목으로 시작하는 직계 자식 묶음.

    직계 자식을 그대로 세면 표 머리 행·본문 행까지 블록이 된다(호가 보드의
    체결 10행이 블록 10개가 됐다). Paper에서 블록을 가르는 것은 제목이므로
    첫 텍스트 잎이 제목 활자(`--font-strong`)인 자식에서 블록이 시작하고,
    다음 제목 앞까지가 그 블록이다. 제목 앞에 놓인 자식은 어느 블록도 아니다.
    """
    blocks: list[list[Element]] = []
    for child in element_children(rail):
        leaves = text_leaves(child)
        if leaves and is_title_text(leaves[0]):
            blocks.append([child])
        elif blocks:
            blocks[-1].append(child)
    return blocks


def rail_block_rows(block: list[Element]) -> int:
    """레일 블록의 행 수.

    제목이 내용을 감싼 프레임 하나면 그 프레임의 자식이 행이고, 제목과 내용이
    레일 직계에 나란히 놓였으면 제목 뒤에 딸린 자식이 행이다.
    """
    head, rest = block[0], block[1:]
    return len(rest) if rest else len(element_children(head))


def real_parent(el: Element) -> Element | None:
    """추출기가 끼운 래퍼를 건너뛴 실제 부모."""
    parent = el.parent
    while parent is not None and parent.synthetic:
        parent = parent.parent
    return parent


def direct_text(el: Element) -> str:
    """직계 텍스트. `<br>`은 트리 요약과 같게 줄바꿈으로 읽는다.

    텍스트 잎 래퍼(`synthetic="text"`)는 원문 텍스트를 그대로 옮겨 담은 상자라
    꿰뚫어 본다 — 래퍼를 넣기 전후로 잎 판정과 슬롯 텍스트가 같아야 한다.
    """
    parts: list[str] = []
    for child in el.children:
        if isinstance(child, str):
            parts.append(child)
        elif isinstance(child, Element):
            if child.tag == "br":
                parts.append("\n")
            elif child.synthetic == "text":
                parts.append(direct_text(child))
    return "".join(parts).strip()


def is_text_leaf(el: Element) -> bool:
    return not element_children(el) and direct_text(el) != ""


def style_of(el: Element) -> StyleObject | None:
    for name, value in el.attrs:
        if name == "style" and isinstance(value, StyleObject):
            return value
    return None


def _px(value: str | None) -> float | None:
    if not value or not value.endswith("px"):
        return None
    try:
        return float(value[:-2])
    except ValueError:
        return None


def font_size_px(el: Element) -> float | None:
    """자신부터 조상까지 올라가며 선언된 font-size(px)를 찾는다."""
    cur: Element | None = el
    while cur is not None:
        style = style_of(cur)
        if style is not None:
            size = _px(style.get("font-size"))
            if size is not None:
                return size
        cur = cur.parent
    return None


def color_of(el: Element) -> str | None:
    """자신부터 조상까지 올라가며 선언된 인라인 color를 찾는다."""
    cur: Element | None = el
    while cur is not None:
        style = style_of(cur)
        if style is not None:
            value = style.get("color")
            if value:
                return value
        cur = cur.parent
    return None


def text_leaves(el: Element) -> list[Element]:
    out: list[Element] = []

    def walk(node: Element) -> None:
        if is_text_leaf(node):
            out.append(node)
        for child in element_children(node):
            walk(child)

    walk(el)
    return out


def is_label_text(text: str) -> bool:
    """숫자·부호·단위·날짜·시각을 담지 않은 순수 라벨 문구인가."""
    return _VALUE_MARK.search(text) is None


# --------------------------------------------------------------------------- #
# 표 감지
# --------------------------------------------------------------------------- #

ROW_HEIGHT_MAX = 40.0
ROW_HEIGHT_MIN = 24.0


# 첫 칸이 이 문구뿐이면 본문 행이 아니라 표 바닥(합계·소계) 행이다.
FOOT_LABELS = frozenset("합계 소계 총계 전체".split())


def _is_foot_row(row: Element) -> bool:
    """첫 칸이 합계·소계 문구 하나뿐인 행인가 — 본문 행 수에서 뺀다."""
    cells = element_children(row)
    if not cells:
        return False
    leaves = text_leaves(cells[0])
    return len(leaves) == 1 and direct_text(leaves[0]) in FOOT_LABELS


def _is_header_row(row: Element) -> bool:
    """셀이 3개 이상이고 셀마다 라벨 텍스트 하나만 담은 행인가."""
    cells = element_children(row)
    if len(cells) < 3:
        return False
    for cell in cells:
        leaves = text_leaves(cell)
        if len(leaves) != 1 or not is_label_text(direct_text(leaves[0])):
            return False
    return True


def _explicit_table_shape(
    owner: Element, node_of: dict[int, TreeNode]
) -> tuple[Element, list[Element], list[Element]]:
    owner_node = node_of[id(owner)]
    rows = element_children(owner)
    candidates: list[tuple[int, Element]] = []
    for index, row in enumerate(rows):
        if _is_header_row(row):
            candidates.append((index, row))
        for nested in element_children(row):
            if _is_header_row(nested):
                candidates.append((index, nested))
    if not candidates:
        raise ExtractError(f"explicit table {owner_node.node_id}: missing header")
    if len(candidates) != 1:
        raise ExtractError(f"explicit table {owner_node.node_id}: ambiguous header")

    header_index, header = candidates[0]
    header_node = node_of[id(header)]
    if header_node.width != owner_node.width:
        raise ExtractError(
            f"explicit table {owner_node.node_id}: header width "
            f"{header_node.width:g} != owner width {owner_node.width:g}"
        )
    columns = len(element_children(header))
    body: list[Element] = []
    foot: list[Element] = []
    ended = False
    for row in rows[header_index + 1 :]:
        cells = element_children(row)
        if len(cells) < 3:
            ended = True
            continue
        if len(cells) != columns:
            raise ExtractError(
                f"explicit table {owner_node.node_id}: body column count "
                f"{len(cells)} != header column count {columns}"
            )
        row_node = node_of[id(row)]
        if row_node.width != header_node.width:
            raise ExtractError(
                f"explicit table {owner_node.node_id}: body width "
                f"{row_node.width:g} != header width {header_node.width:g}"
            )
        if ended:
            raise ExtractError(
                f"explicit table {owner_node.node_id}: ambiguous body after terminal content"
            )
        if _is_foot_row(row):
            foot.append(row)
            ended = True
        else:
            body.append(row)
    if len(body) < 3:
        raise ExtractError(
            f"explicit table {owner_node.node_id}: fewer than 3 body rows"
        )
    return header, body, foot


def _mark_table(
    owner: Element,
    header: Element,
    body: list[Element],
    foot: list[Element],
    node_of: dict[int, TreeNode],
    roles: dict[str, str],
    *,
    responsive_mode: str | None = None,
) -> dict:
    cells = element_children(header)
    add_class(owner, "bs-table")
    header.attrs.append(("data-row", "head"))
    for col, cell in enumerate(cells):
        cell.attrs.append(("data-col", str(col)))
    for row_index, row in enumerate(body):
        row.attrs.append(("data-row", str(row_index)))
        for col, cell in enumerate(element_children(row)):
            cell.attrs.append(("data-col", str(col)))
    for row in foot:
        row.attrs.append(("data-row", "foot"))
        for col, cell in enumerate(element_children(row)):
            cell.attrs.append(("data-col", str(col)))

    owner_node = node_of[id(owner)]
    table = {
        "node_id": owner_node.node_id,
        "node_name": owner_node.resolved_name,
        "columns": len(cells),
        "header_row": node_of[id(header)].node_id,
        "body_rows": [node_of[id(row)].node_id for row in body],
        "foot_rows": [node_of[id(row)].node_id for row in foot],
        "source": (
            "responsive"
            if responsive_mode
            else ("regions" if roles.get(owner_node.node_id) == "table" else "heuristic")
        ),
        "column_labels": [direct_text(cell) for cell in cells],
    }
    if responsive_mode:
        table["responsive_mode"] = responsive_mode
    return table


def _mark_scroll_table_semantics(
    owner: Element,
    header: Element,
    body: list[Element],
    foot: list[Element],
    accessible_label: str,
) -> None:
    rows = [header, *body, *foot]
    header_top = header
    while header_top.parent is not owner:
        if header_top.parent is None:
            raise ExtractError("scroll-table header is outside the scroll owner")
        header_top = header_top.parent
    top_nodes = [header_top, *body, *foot]
    if any(node.parent is not owner for node in top_nodes):
        raise ExtractError("scroll-table body rows must be direct children of the scroll owner")
    indexes = [owner.children.index(node) for node in top_nodes]
    if indexes != list(range(indexes[0], indexes[0] + len(rows))):
        raise ExtractError("scroll-table rows must be contiguous")

    columns = len(element_children(header))
    wrapper = _synthetic(
        "div",
        "semantic",
        [
            ("class", "bs-scroll-table-semantics"),
            ("role", "table"),
            ("aria-label", accessible_label),
            ("aria-rowcount", len(rows)),
            ("aria-colcount", columns),
        ],
        owner,
    )
    owner.children[indexes[0] : indexes[-1] + 1] = [wrapper]
    wrapper.children.extend(top_nodes)
    for node in top_nodes:
        node.parent = wrapper
    for row_index, row in enumerate(rows, start=1):
        set_attr(row, "role", "row")
        set_attr(row, "aria-rowindex", row_index)
        for col_index, cell in enumerate(element_children(row), start=1):
            role = "columnheader" if row is header else ("rowheader" if col_index == 1 else "cell")
            if row is header:
                # Header Paper nodes can also be the sole state controller (33WM).
                # Keep that original node role-free so the runtime can give it
                # button semantics; an identity-free real box owns table semantics.
                semantic_cell = _synthetic(
                    "div",
                    "semantic",
                    [
                        ("class", "bs-scroll-table-cell-semantics"),
                        ("role", role),
                        ("aria-colindex", col_index),
                    ],
                    row,
                )
                child_index = row.children.index(cell)
                row.children[child_index] = semantic_cell
                semantic_cell.children.append(cell)
                cell.parent = semantic_cell
            else:
                set_attr(cell, "role", role)
                set_attr(cell, "aria-colindex", col_index)


def detect_tables(
    elements: list[Element],
    nodes: list[TreeNode],
    roles: dict[str, str],
    explicit_tables: dict[str, dict] | None = None,
) -> list[dict]:
    """반복 행 구조(라벨 헤더 행 + 같은 폭 형제 행 3개 이상)를 표로 본다."""
    # G1 only carries the authoritative directive forward. G3 resolves explicit
    # table shapes; leaving this unused keeps existing table discovery unchanged.
    _ = explicit_tables
    node_of = {id(el): node for el, node in zip(elements, nodes)}
    explicit = explicit_tables or {}
    known = {node.node_id for node in nodes}
    missing = sorted(set(explicit) - known)
    if missing:
        raise ExtractError(f"explicit table node not found: {', '.join(missing)}")
    marked: set[int] = set()
    tables: list[dict] = []
    for el in elements:
        node_id = node_of[id(el)].node_id
        declaration = explicit.get(node_id)
        ancestor = el.parent
        nested = False
        while ancestor is not None:
            if id(ancestor) in marked:
                nested = True
                break
            ancestor = ancestor.parent
        if nested:
            if declaration:
                raise ExtractError(f"explicit table {node_id}: nested inside another table")
            continue
        if declaration:
            modes = [
                trait
                for trait in ("paired-table", "scroll-table")
                if trait in declaration.get("traits", ())
            ]
            if len(modes) != 1:
                raise ExtractError(f"explicit table {node_id}: exactly one table mode required")
            header, body, foot = _explicit_table_shape(el, node_of)
            marked.add(id(el))
            table = _mark_table(
                el,
                header,
                body,
                foot,
                node_of,
                roles,
                responsive_mode=modes[0],
            )
            if modes[0] == "scroll-table":
                label = str(declaration.get("accessible_label") or "").strip()
                if not label:
                    raise ExtractError(f"explicit table {node_id}: scroll-table label required")
                _mark_scroll_table_semantics(el, header, body, foot, label)
            tables.append(table)
            continue
        rows = element_children(el)
        if len(rows) < 4:
            continue
        header = next(
            (r for r in rows[:-3] if _is_header_row(r)),
            None,
        )
        if header is None:
            continue
        cells = element_children(header)
        cols = len(cells)
        width = node_of[id(header)].width
        body = [
            r
            for r in rows[rows.index(header) + 1 :]
            if cols - 1 <= len(element_children(r)) <= cols + 1
            and len(element_children(r)) >= 3
            and node_of[id(r)].width == width
        ]
        if len(body) < 3:
            continue
        # 합계·소계 행은 본문이 아니다 — `data-row="foot"`로 따로 세운다.
        foot = [r for r in body if _is_foot_row(r)]
        foot_ids = {id(r) for r in foot}
        body = [r for r in body if id(r) not in foot_ids]
        marked.add(id(el))
        tables.append(_mark_table(el, header, body, foot, node_of, roles))
    return tables


def table_position(elements: list[Element], tables: list[dict]) -> dict[int, dict]:
    """텍스트 리프 → {table, row, col} 색인(요소 id 기준)."""
    by_node = {}
    for el in elements:
        for name, value in el.attrs:
            if name == "data-node":
                by_node[value] = el
    position: dict[int, dict] = {}
    for table in tables:
        rows = (
            [("head", table["header_row"])]
            + [(str(i), node_id) for i, node_id in enumerate(table["body_rows"])]
            + [("foot", node_id) for node_id in table.get("foot_rows") or []]
        )
        for row_key, row_id in rows:
            row_el = by_node[row_id]
            for col, cell in enumerate(element_children(row_el)):
                for leaf in text_leaves(cell):
                    position[id(leaf)] = {
                        "table": table["node_id"],
                        "row": row_key,
                        "col": col,
                    }
    return position


# --------------------------------------------------------------------------- #
# 레인 C 계약 — 열 접기 래퍼 · 병기 사본 · KPI 셀
# --------------------------------------------------------------------------- #

# 0-based 열 번호. 첫 2열(이름·기준값)은 어느 폭에서도 접지 않으므로 래퍼가 없다.
COLLAPSE_FIRST_COL = 2


def _synthetic(tag: str, kind: str, attrs: list[tuple[str, object]], parent: Element) -> Element:
    el = Element(tag)
    el.synthetic = kind
    el.attrs.extend(attrs)
    el.parent = parent
    return el


def apply_column_collapse(
    tables: list[dict], by_node: dict[str, Element], node_of: dict[int, TreeNode]
) -> tuple[int, int]:
    """표 셀을 `.bs-col`로 감싸고, 접힐 때 쓸 `.bs-paired` 사본을 둘째 열에 붙인다.

    래퍼는 `display: contents` 전제라 XL에서 상자 트리에서 사라진다(픽셀 동일).
    사본은 인라인 스타일 없이 텍스트만 복제하고 원본 텍스트 노드를 `data-node`로 가리킨다.
    """
    wrapped = paired = 0
    for table in tables:
        mode = table.get("responsive_mode")
        if mode == "scroll-table":
            continue
        for row_id in [
            table["header_row"],
            *table["body_rows"],
            *(table.get("foot_rows") or []),
        ]:
            row = by_node[row_id]
            cells = element_children(row)
            if len(cells) <= COLLAPSE_FIRST_COL:
                continue
            second = cells[1]
            copies: list[Element] = []
            for col, cell in enumerate(cells):
                if col < COLLAPSE_FIRST_COL:
                    continue
                priority = str(col + 1)
                wrapper = _synthetic(
                    "span",
                    "wrap",
                    [("class", "bs-col"), ("data-col-priority", priority)],
                    row,
                )
                row.children[row.children.index(cell)] = wrapper
                wrapper.children.append(cell)
                cell.parent = wrapper
                wrapped += 1
                for leaf in text_leaves(cell):
                    text = direct_text(leaf)
                    node = node_of.get(id(leaf))
                    if not text or node is None:
                        continue
                    if mode == "paired-table":
                        if row_id == table["header_row"]:
                            continue
                        pair = _synthetic(
                            "span",
                            "leaf",
                            [
                                ("class", "bs-paired"),
                                ("data-paired-col", priority),
                            ],
                            second,
                        )
                        label = _synthetic(
                            "span",
                            "leaf",
                            [
                                ("class", "bs-paired-label"),
                                ("data-paired-label", True),
                            ],
                            pair,
                        )
                        label.children.append(table["column_labels"][col])
                        mirror = _synthetic(
                            "span",
                            "leaf",
                            [
                                ("class", "bs-paired-value"),
                                ("data-paired-source", node.node_id),
                            ],
                            pair,
                        )
                        mirror.children.append(text)
                        pair.children.extend((label, mirror))
                        copies.append(pair)
                        continue
                    copy = _synthetic(
                        "span",
                        "leaf",
                        [
                            ("class", "bs-paired"),
                            ("data-paired-col", priority),
                            ("data-node", node.node_id),
                        ],
                        second,
                    )
                    copy.children.append(text)
                    copies.append(copy)
            second.children.extend(copies)
            paired += len(copies)
    return wrapped, paired


def wrap_leaf_text(elements: list[Element], node_of: dict[int, TreeNode]) -> int:
    """DOM 자식이 붙은 텍스트 잎의 직계 텍스트를 `<span data-leaf>`로 감싼다.

    병기 사본(`.bs-paired`)이 붙으면 원래 잎이 DOM에서는 컨테이너가 된다 —
    마운트가 컨테이너에 textContent를 쓰면 사본이 통째로 날아가므로 값이 실릴
    자리를 항상 잎으로 되돌린다. 래퍼는 인라인 스타일 없이 상속만 받으므로
    픽셀은 그대로다. `<br>`은 텍스트의 일부라 래퍼 안으로 함께 들어간다.
    """
    wrapped = 0
    for el in elements:
        if not is_text_leaf(el):
            continue
        if any(isinstance(c, Element) and c.synthetic == "text" for c in el.children):
            continue  # 이미 감쌌다
        outsiders = [
            child
            for child in el.children
            if isinstance(child, Element) and child.tag not in VOID_TAGS
        ]
        node = node_of.get(id(el))
        if not outsiders or node is None:
            continue
        moved = [child for child in el.children if child not in outsiders]
        wrapper = _synthetic(
            "span", "text", [("data-node", node.node_id), ("data-leaf", True)], el
        )
        wrapper.children.extend(moved)
        for child in moved:
            if isinstance(child, Element):
                child.parent = wrapper
        el.children = [wrapper, *outsiders]
        wrapped += 1
    return wrapped


# --------------------------------------------------------------------------- #
# meta.json 이름 규약 → state
# --------------------------------------------------------------------------- #


def parse_board_name(name: str) -> tuple[str | None, str | None]:
    """`CC-05 / R03-T5 · 수급 — 종목 동향` → (`R03-T5`, `수급 — 종목 동향`)."""
    if "·" not in name:
        return None, None
    head, _, tail = name.partition("·")
    head = head.strip()
    if "/" in head:
        head = head.split("/", 1)[1].strip()
    tail = tail.strip()
    return (head or None), (tail or None)


def control_from_tail(tail: str | None) -> str | None:
    """이름 뒷부분이 control이다 — 긴 이름은 `A — B`의 B가 실제 컨트롤 문구다."""
    if not tail:
        return None
    if " — " in tail:
        tail = tail.rsplit(" — ", 1)[1]
    return tail.strip() or None


def board_ref_index() -> dict[tuple[str | None, str], str]:
    """`(card_id, 이름 R/T 번호)` → board_id."""
    index: dict[tuple[str | None, str], str] = {}
    for path in sorted(TEMPLATE_ROOT.iterdir()):
        meta_path = path / "meta.json"
        if not path.is_dir() or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        ref, _ = parse_board_name(meta.get("name") or "")
        board_id = meta.get("board_id")
        if ref and board_id:
            index.setdefault((meta.get("card_id"), ref), board_id)
    return index


def parent_from_ref(
    card_id: str | None, ref: str | None, board_id: str, index: dict[tuple[str | None, str], str]
) -> str | None:
    """`R01-T6-5-X` → `R01-T6-5` → `R01-T6` → `R01` 순으로 같은 카드의 기준 보드를 찾는다."""
    if not ref:
        return None
    parts = ref.split("-")
    while len(parts) > 1:
        parts = parts[:-1]
        candidate = index.get((card_id, "-".join(parts)))
        if candidate and candidate != board_id:
            return candidate
    return None


def resolve_state(meta: dict, board_id: str, index: dict[tuple[str | None, str], str]) -> dict:
    """meta.json의 state를 그대로 쓰되, 빈 parent_board/control만 이름 규약에서 채운다.

    `control_text`는 손지정 — 부모 보드에 실제로 적힌 문구다. 이름에서 뽑은
    `control`로는 잎을 못 맞출 때 저작이 직접 적고, 표식은 이 문구를 먼저 본다.
    """
    state = dict(meta.get("state") or {})
    state.setdefault("kind", "default")
    ref, tail = parse_board_name(meta.get("name") or "")
    # 제 레일을 스스로 이고 있는 보드(부모 없는 탭 주인)는 부모가 자기 자신으로
    # 적힌다. 부모는 없으므로 비우고 레일 주인이라고만 적는다 — kind는 그대로다.
    if state.get("parent_board") == board_id:
        state["parent_board"] = None
        state["rail_owner"] = True
    if state["kind"] != "default":
        if not state.get("parent_board") and not state.get("rail_owner"):
            state["parent_board"] = parent_from_ref(meta.get("card_id"), ref, board_id, index)
        if not state.get("control"):
            state["control"] = control_from_tail(tail)
    state.setdefault("parent_board", None)
    state.setdefault("control", None)
    state.setdefault("control_text", None)
    return state


_STATE_CHILDREN: dict[str, list[dict]] | None = None

# 펼침 컨트롤 표식 문자. `▲`·`▼`는 등락 부호라 여기 넣지 않는다.
EXPAND_MARKS = "▸▾◂"


def state_children_index(
    ref_index: dict[tuple[str | None, str], str] | None = None
) -> dict[str, list[dict]]:
    """`parent_board` → 그 보드를 부모로 삼은 상태 보드 목록(보드마다 다시 읽지 않는다)."""
    global _STATE_CHILDREN
    if _STATE_CHILDREN is not None:
        return _STATE_CHILDREN
    index = ref_index if ref_index is not None else board_ref_index()
    children: dict[str, list[dict]] = {}
    for path in sorted(TEMPLATE_ROOT.iterdir()):
        meta_path = path / "meta.json"
        if not path.is_dir() or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        state = resolve_state(meta, path.name, index)
        parent = state.get("parent_board")
        if not parent and state.get("rail_owner"):
            parent = path.name
        control = state.get("control")
        if state["kind"] == "default" or not parent or not control:
            continue
        children.setdefault(parent, []).append(
            {
                "board_id": path.name,
                "kind": state["kind"],
                "control": control,
                "control_text": state.get("control_text"),
            }
        )
    _STATE_CHILDREN = children
    return children


def state_orphans(
    ref_index: dict[tuple[str | None, str], str] | None = None
) -> list[dict]:
    """부모 보드나 컨트롤 문구를 못 채운 상태 보드 — 표식을 찍을 자리가 없다."""
    index = ref_index if ref_index is not None else board_ref_index()
    out: list[dict] = []
    for path in sorted(TEMPLATE_ROOT.iterdir()):
        meta_path = path / "meta.json"
        if not path.is_dir() or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        state = resolve_state(meta, path.name, index)
        if state["kind"] == "default":
            continue
        if state.get("rail_owner") and state.get("control"):
            continue
        if state.get("parent_board") and state.get("control"):
            continue
        out.append(
            {
                "board_id": path.name,
                "kind": state["kind"],
                "control": state.get("control"),
                "reason": "부모 보드 없음" if not state.get("parent_board") else "컨트롤 문구 없음",
            }
        )
    return out


CONTROL_TOKEN_SPLIT = re.compile(r"[\s·]+")


def control_tokens(text: str) -> set[str]:
    """컨트롤 문구를 공백·`·`로 끊은 토큰 — 한 글자는 흔해서 세지 않는다."""
    return {token for token in CONTROL_TOKEN_SPLIT.split(text) if len(token) >= 2}


def control_tier(candidate: str, control: str) -> int:
    """정확 일치 4 → `" · "` 마지막 조각 일치 3 → 부분 포함 2 → 토큰 겹침 1 → 0."""
    if candidate == control:
        return 4
    if " · " in control and candidate == control.rsplit(" · ", 1)[-1]:
        return 3
    if control in candidate or (len(candidate) >= 2 and candidate in control):
        return 2
    if control_tokens(candidate) & control_tokens(control):
        return 1
    return 0


def expand_tier(el: Element, region_of: dict[int, str], control: str) -> tuple[int, int]:
    """▸ 잎 자신과 그 잎을 감싼 블록을 가까운 것부터 훑어 (최고 tier, 거리)."""
    best = (control_tier(direct_text(el), control), 0)
    cur = el.parent
    distance = 1
    while cur is not None:
        for leaf in text_leaves(cur):
            tier = control_tier(direct_text(leaf), control)
            if tier > best[0]:
                best = (tier, distance)
        if id(cur) in region_of:
            break
        cur = cur.parent
        distance += 1
    return best


HOW_BY_TIER = {4: "exact", 3: "tail", 2: "partial", 1: "token"}


def mark_state_controls(
    elements: list[Element],
    node_of: dict[int, TreeNode],
    region_of: dict[int, str],
    children: list[dict],
) -> tuple[list[dict], list[dict]]:
    """자식 상태 보드의 컨트롤 문구를 이 보드의 잎에 맞춰 표식을 찍는다.

    탭·정렬은 잎 문구를 본다. 펼침은 손지정 `control_text`와 정확히 같은 일반 잎이
    있으면 그 잎을 먼저 쓰고, 없으면 기존처럼 `▸` 잎을 감싼 블록 문구를 본다. 펼침
    잎도 없는 보드에서는 손지정 문구를 일반 잎에 맞춘다. 한 잎은 컨트롤 하나만 받는다
    — 같은 문구를 쓰는 자식 보드들은 한 잎을 나눠 쓴다.

    `control_text`(손지정)를 적은 자식은 그 문구로 맞추고 잎을 먼저 가져간다.
    """
    leaves = [el for el in elements if is_text_leaf(el)]
    groups: dict[tuple[str, str, str | None], list[str]] = {}
    for child in children:
        key = (child["kind"], child["control"], child.get("control_text"))
        groups.setdefault(key, []).append(child["board_id"])

    expand_leaf_indices = {
        index
        for index, el in enumerate(leaves)
        if any(mark in direct_text(el) for mark in EXPAND_MARKS)
    }
    scored: dict[tuple[str, str, str | None], list[tuple[int, int, int]]] = {}
    for key in groups:
        kind, control, control_text = key
        wanted = control_text or control
        authored_leaf_indices = {
            index
            for index, el in enumerate(leaves)
            if control_text
            and index not in expand_leaf_indices
            and direct_text(el) == control_text
        }
        hits: list[tuple[int, int, int]] = []
        for index, el in enumerate(leaves):
            if kind == "expand":
                if authored_leaf_indices:
                    if index not in authored_leaf_indices:
                        continue
                    tier, distance = 4, 1
                    if nearest_region(el, region_of) in ("strip", "header"):
                        distance = 0
                elif expand_leaf_indices:
                    if index not in expand_leaf_indices:
                        continue
                    tier, distance = expand_tier(el, region_of, wanted)
                elif control_text:
                    tier, distance = control_tier(direct_text(el), wanted), 1
                    if nearest_region(el, region_of) in ("strip", "header"):
                        distance = 0
                else:
                    continue
            else:
                tier, distance = control_tier(direct_text(el), wanted), 1
                if nearest_region(el, region_of) in ("strip", "header"):
                    distance = 0  # 스트립·머리의 잎을 먼저 본다
            if tier:
                hits.append((tier, distance, index))
        scored[key] = sorted(hits, key=lambda hit: (-hit[0], hit[1], hit[2]))

    marks: list[dict] = []
    unresolved: list[dict] = []
    taken: set[int] = set()
    order = sorted(
        groups,
        key=lambda key: (
            key[2] is None,  # 손지정이 잎을 먼저 가져간다
            -(scored[key][0][0] if scored[key] else 0),
            key[1],
        ),
    )
    for key in order:
        kind, control, control_text = key
        boards = sorted(groups[key])
        hit = next((h for h in scored[key] if h[2] not in taken), None)
        if hit is None:
            reason = "후보 없음" if not scored[key] else "후보를 다른 컨트롤이 먼저 가져감"
            for board_id in boards:
                unresolved.append(
                    {"board_id": board_id, "kind": kind, "control": control, "reason": reason}
                )
            continue
        taken.add(hit[2])
        el = leaves[hit[2]]
        el.attrs.append(("data-state-control", control))
        el.attrs.append(("data-state-board", " ".join(boards)))
        marks.append(
            {
                "control": control,
                "kind": kind,
                "boards": boards,
                "node_id": node_of[id(el)].node_id,
                "how": "hand" if control_text else HOW_BY_TIER[hit[0]],
            }
        )
    marks.sort(key=lambda mark: mark["control"])
    unresolved.sort(key=lambda item: item["board_id"])
    return marks, unresolved


# --------------------------------------------------------------------------- #
# 포맷 추론
# --------------------------------------------------------------------------- #

# 앞선 숫자에 붙어야 단위다 — 라벨 속 "주문"·"건물"의 글자와 섞이지 않는다.
_NUM = r"[0-9][0-9,]*(?:\.[0-9]+)?"
_SCALE = r"(?:\s*[만억조])?"
UNIT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("percent", re.compile(r"%")),
    ("shares", re.compile(_NUM + _SCALE + r"\s*주")),
    ("count", re.compile(_NUM + _SCALE + r"\s*건")),
    ("krw_ko", re.compile(_NUM + _SCALE + r"\s*원|" + _NUM + r"\s*[만억조]")),
    ("time", re.compile(r"[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?")),
    ("date", re.compile(r"[0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2}|[0-9]{1,2}[-./][0-9]{1,2}")),
)
NUMBER_RE = re.compile(r"([0-9][0-9,]*)(?:\.([0-9]+))?")
SIGN_MARKS = "+-−▲▼"
CHANGE_COLORS = ("--color-up", "--color-down")


def infer_format(text: str, el: Element) -> dict:
    """값 슬롯의 표기 기본값 — paper_text 패턴과 인라인 색에서 읽는다.

    저작이 손으로 적은 format은 `merge_authored`가 그대로 살리므로 여기 값은
    어디까지나 출발점이다.
    """
    unit = "text"
    for name, pattern in UNIT_PATTERNS:
        if pattern.search(text):
            unit = name
            break
    number = NUMBER_RE.search(text)
    precision = len(number.group(2)) if number and number.group(2) else (0 if number else None)
    sign = False
    if number:
        head = text[: number.start()].rstrip()
        sign = bool(head) and head[-1] in SIGN_MARKS
    color = color_of(el) or ""
    tone = "change" if sign or any(token in color for token in CHANGE_COLORS) else "neutral"
    return {"unit": unit, "sign": sign, "precision": precision, "tone": tone}


# --------------------------------------------------------------------------- #
# 슬롯
# --------------------------------------------------------------------------- #

ANCHOR_RAW = re.compile(r"^raw\|([^|]+)\|([^|]+)\|(.+)$")
ANCHOR_MAPPING = re.compile(r"^mapping\|([^|]+)\|(.+)$")
ANCHOR_STRUCTURE = re.compile(r"^structure\|([^|]+)\|([^|]+)\|(.+)$")


def parse_anchor(
    node_name: str,
    operation_refs: set[str],
    details: dict[tuple[str, str], list[str]] | None = None,
) -> dict:
    """Paper 노드 이름 규약을 mapping_id/f로 푼다."""
    empty = {"anchor": None, "mapping_id": None, "f": None}
    m = ANCHOR_MAPPING.match(node_name)
    if m:
        return {
            "anchor": {"kind": "mapping", "mapping_id": m.group(1), "field": m.group(2)},
            "mapping_id": m.group(1),
            "f": m.group(2),
        }
    m = ANCHOR_RAW.match(node_name)
    if m:
        tr, section, field = m.group(1), m.group(2), m.group(3)
        # `raw|<tr>|body|<field>`는 op을 특정하지 못한다. 순서는 하나뿐이다 —
        # ① 보드 operation_refs에 `base:<tr>`가 있으면 base,
        # ② 아니면 원장이 그 필드를 싣는다고 적은 `detail:<tr>:*` 중 하나로 좁혀지면 그것,
        # ③ 좁혀지지 않으면 null로 두고 저작 단계로 넘긴다.
        base = f"base:{tr}"
        mapping_id = base if base in operation_refs else None
        if mapping_id is None and details is not None:
            candidates = details.get((tr, field)) or []
            scoped = [mid for mid in candidates if mid in operation_refs]
            pool = scoped or candidates
            if len(pool) == 1:
                mapping_id = pool[0]
        return {
            "anchor": {"kind": "raw", "tr": tr, "section": section, "field": field},
            "mapping_id": mapping_id,
            "f": field,
        }
    m = ANCHOR_STRUCTURE.match(node_name)
    if m:
        return {
            "anchor": {
                "kind": "structure",
                "tr": m.group(1),
                "array": m.group(2),
                "field": m.group(3),
            },
            "mapping_id": None,
            "f": None,
        }
    return empty


def nearest_region(el: Element, region_of: dict[int, str]) -> str | None:
    cur: Element | None = el
    while cur is not None:
        role = region_of.get(id(cur))
        if role is not None:
            return role
        cur = cur.parent
    return None


def estimate_layer(
    el: Element, height_of: dict[int, float], state_kind: str, kind: str
) -> str:
    """D6 판정 — 펼침 보드 / 32px 행의 작은 둘째 줄 / 그 외 직접."""
    if state_kind == "expand":
        return "펼침"
    if kind != "value":
        return "직접"
    size = font_size_px(el)
    if size is None or size > 11:
        return "직접"
    cur = el.parent
    while cur is not None:
        height = height_of.get(id(cur))
        if height is not None and ROW_HEIGHT_MIN <= height <= ROW_HEIGHT_MAX:
            leaves = text_leaves(cur)
            if len(leaves) >= 2 and leaves[0] is not el:
                lead = font_size_px(leaves[0])
                if lead is not None and lead > size:
                    return "병기"
            return "직접"
        cur = cur.parent
    return "직접"


def node_path(el: Element, root: Element) -> str:
    parts: list[str] = []
    cur = el
    while cur is not root:
        parent = real_parent(cur)
        if parent is None:
            break
        parts.append(str(element_children(parent).index(cur)))
        cur = parent
    return "/".join(reversed(parts))


def tree_subtree(nodes: list[TreeNode], root_id: str) -> list[TreeNode] | None:
    """트리에서 root_id 부분트리만 잘라 depth를 0 기준으로 다시 맞춘다."""
    start = next((i for i, n in enumerate(nodes) if n.node_id == root_id), None)
    if start is None:
        return None
    base = nodes[start].depth
    end = len(nodes)
    for i in range(start + 1, len(nodes)):
        if nodes[i].depth <= base:
            end = i
            break
    out = []
    for node in nodes[start:end]:
        out.append(
            TreeNode(
                node.depth - base,
                node.component,
                node.name,
                node.node_id,
                node.width,
                node.height,
                node.text,
            )
        )
    return out


def slice_subtree(
    elements: list[Element], nodes: list[TreeNode], root_id: str
) -> tuple[list[Element], list[TreeNode], Element]:
    """regions.json이 선언한 root 노드의 부분트리만 남긴다.

    Paper 원문에 아트보드 껍데기가 포함된 저장본과 벗겨진 저장본이 섞여 있어
    `board.html`의 루트는 항상 regions.json의 `root`가 정한다.
    """
    start = next((i for i, n in enumerate(nodes) if n.node_id == root_id), None)
    if start is None:
        raise ExtractError(f"regions.json root({root_id})가 트리에 없다")
    depth = nodes[start].depth
    end = len(nodes)
    for i in range(start + 1, len(nodes)):
        if nodes[i].depth <= depth:
            end = i
            break
    return elements[start:end], nodes[start:end], elements[start]


# --------------------------------------------------------------------------- #
# 보드 추출
# --------------------------------------------------------------------------- #

GENERATED_SLOT_KEYS = frozenset(
    """slot_id node_id node_name node_path paper_text region layer font_size_px
    anchor table""".split()
)
GENERATED_TOP_KEYS = frozenset(
    """board_id card_id name paper_source html_sha256 width_px height_px artboard_px
    operation_refs state state_controls regions tables counts text_multiset density slots
    column_bindings""".split()
)
# column_bindings 항목에서 매번 새로 만드는 열쇠(나머지는 저작물로 보고 옮겨 담는다).
GENERATED_COLUMN_KEYS = frozenset("col data_col header slot_ids".split())


def build_column_bindings(tables: list[dict], slots: list[dict]) -> list[dict]:
    """표 단위 열 묶음 — 열 하나에 mapping_id/f를 주면 그 열 전부에 퍼뜨릴 자리다.

    `col`은 `data-col-priority`와 같은 1부터의 열 번호, `data_col`은 `data-col`·
    `slots[].table.col`과 같은 0부터의 번호다. `slot_ids`는 머리 행을 뺀 본문 셀만 담는다.
    """
    out: list[dict] = []
    for table in tables:
        if table.get("responsive_mode") == "scroll-table":
            continue
        by_col: dict[int, list[str]] = {}
        for slot in slots:
            cell = slot.get("table")
            if not cell or cell["table"] != table["node_id"] or cell["row"] == "head":
                continue
            by_col.setdefault(cell["col"], []).append(slot["slot_id"])
        labels = table["column_labels"]
        out.append(
            {
                "table_id": table["node_id"],
                "columns": [
                    {
                        "col": col + 1,
                        "data_col": col,
                        "header": labels[col] if col < len(labels) else "",
                        "slot_ids": by_col[col],
                    }
                    for col in sorted(by_col)
                ],
            }
        )
    return out


def indexed_field(indexed: dict, row: int) -> str:
    """인덱스 열의 본문 행 `row`(0부터)가 받을 필드 이름.

    `{"f_pattern": "sel_bid_{i}", "start": 1, "step": 1, "direction": "down"}`
    → `f = f_pattern.format(i=start + row * step)`. `direction`은 화면 위에서
    아래로 갈 때 번호가 커지면 `down`, 작아지면 `up`이다(호가 매도 10→1은
    `direction: "up"` · `start: 10` · `step: -1`). 부호가 어긋나면 실패한다.
    """
    pattern = indexed.get("f_pattern")
    if not pattern:
        raise ExtractError(f"indexed에 f_pattern이 없다: {indexed!r}")
    start = indexed.get("start", 1)
    step = indexed.get("step", 1)
    direction = indexed.get("direction", "down")
    if direction not in ("down", "up"):
        raise ExtractError(f"indexed.direction은 down·up만 된다: {direction!r}")
    if (direction == "down") != (step > 0):
        raise ExtractError(f"indexed.direction={direction}과 step={step}의 부호가 어긋난다")
    try:
        return pattern.format(i=start + row * step)
    except (KeyError, IndexError) as exc:
        raise ExtractError(f"indexed.f_pattern은 {{i}}만 쓴다: {pattern!r}") from exc


def apply_columns(payload: dict) -> int:
    """열 하나에 저작된 mapping_id/f를 그 열의 셀 슬롯 전부에 퍼뜨린다.

    출처는 두 곳뿐이다 — `column_bindings` 열에 직접 적었거나, 그 열의 셀 슬롯 중
    하나에 적었거나. 이미 mapping_id가 있는 셀은 건드리지 않는다.

    `alt_mappings`(같은 자리를 나눠 쓰는 다른 op의 같은 뜻 필드)도 같이 퍼뜨린다.
    `indexed`를 적은 열은 행마다 다른 필드를 받는다 — `f` 대신 `indexed_field`가
    푼 이름을 쓴다.

    저작이 "여기는 필드가 아니다"라고 못박은 자리도 건드리지 않는다 —
    `kind: "static"` 열은 통째로 건너뛰고, `static: true` 셀은 채우지 않는다.
    (열 첫째 줄엔 대응 필드가 없고 둘째 줄만 필드인 스택 셀이 있다.)
    """
    slot_of = {slot["slot_id"]: slot for slot in payload["slots"]}
    applied = 0
    for table in payload.get("column_bindings") or []:
        for column in table.get("columns") or []:
            if column.get("kind") == "static":
                continue
            cells = [slot_of[sid] for sid in column.get("slot_ids", []) if sid in slot_of]
            mapping_id = column.get("mapping_id")
            field = column.get("f")
            indexed = column.get("indexed")
            alts = column.get("alt_mappings")
            if not alts:
                source = next((c for c in cells if c.get("alt_mappings")), None)
                alts = source["alt_mappings"] if source else None
                if alts:
                    column["alt_mappings"] = alts
            if not mapping_id:
                source = next((c for c in cells if c.get("mapping_id")), None)
                if source is None:
                    if not alts:
                        continue
                    mapping_id = None
                else:
                    mapping_id = source["mapping_id"]
                    field = field or source.get("f")
            if mapping_id:
                column["mapping_id"] = mapping_id
                if field:
                    column["f"] = field
            for cell in cells:
                if cell.get("static"):
                    continue
                touched = False
                if alts and not cell.get("alt_mappings"):
                    cell["alt_mappings"] = alts
                    touched = True
                if mapping_id and not cell.get("mapping_id"):
                    cell["mapping_id"] = mapping_id
                    row = (cell.get("table") or {}).get("row")
                    if indexed and row not in (None, "head", "foot"):
                        cell["f"] = indexed_field(indexed, int(row))
                    elif field:
                        cell["f"] = field
                    touched = True
                applied += 1 if touched else 0
    payload["counts"]["mapped_slots"] = sum(1 for s in payload["slots"] if s["mapping_id"])
    return applied


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def extract_board(
    board_dir: Path,
    ref_index: dict[tuple[str | None, str], str] | None = None,
    children: dict[str, list[dict]] | None = None,
) -> tuple[str, dict]:
    board_id = board_dir.name
    jsx_src = (board_dir / "paper.jsx").read_text(encoding="utf-8")
    tree_src = (board_dir / "paper.tree.txt").read_text(encoding="utf-8")
    meta = json.loads((board_dir / "meta.json").read_text(encoding="utf-8"))
    regions_path = board_dir / "regions.json"
    roles, declared_root = load_regions(regions_path)
    if meta.get("board_id") != board_id:
        raise ExtractError(
            f"meta.json board_id({meta.get('board_id')!r})가 디렉터리 이름과 다르다"
        )

    root = parse_jsx(jsx_src)
    nodes = parse_tree(tree_src)
    elements = flatten(root)
    if declared_root and declared_root != nodes[0].node_id:
        # 원문 저장본은 아트보드 껍데기를 담기도 하고 벗기기도 한다. JSX가 이미
        # 벗겨진 저장본이면 트리 쪽을 먼저 잘라 같은 기준으로 맞춘다.
        candidate = tree_subtree(nodes, declared_root)
        if candidate is not None and len(candidate) == len(elements):
            nodes = candidate
    align(elements, nodes)
    if declared_root and declared_root != nodes[0].node_id:
        elements, nodes, root = slice_subtree(elements, nodes, declared_root)
    responsive = load_responsive(regions_path, {node.node_id for node in nodes})
    assigned = apply_regions(elements, nodes, roles)
    apply_responsive(elements, nodes, responsive)
    explicit_tables = {
        declaration["node_id"]: declaration
        for declaration in responsive
        if set(declaration["traits"]) & {"paired-table", "scroll-table"}
    }
    tables = detect_tables(elements, nodes, roles, explicit_tables)
    cell_of = table_position(elements, tables)

    node_of = {id(el): node for el, node in zip(elements, nodes)}
    height_of = {id(el): node.height for el, node in zip(elements, nodes)}
    region_of = {
        id(el): assigned[node.node_id]
        for el, node in zip(elements, nodes)
        if node.node_id in assigned
    }
    for table in tables:
        for el, node in zip(elements, nodes):
            if node.node_id == table["node_id"]:
                region_of.setdefault(id(el), "table")

    # 레인 C 계약 — 컨테이너 쿼리 기준점 · KPI 셀 · 열 접기 래퍼와 병기 사본.
    add_class(root, "board-surface")
    by_node = {node.node_id: el for el, node in zip(elements, nodes)}
    rail_blocks: list[list[Element]] = []
    kpi_cells = 0
    for el, node in zip(elements, nodes):
        role = assigned.get(node.node_id)
        if role == "rail":
            rail_blocks.extend(rail_blocks_of(el))
        elif role == "kpi":
            for cell in element_children(el):
                add_class(cell, "bs-kpi-cell")
                kpi_cells += 1
    bs_col, bs_paired = apply_column_collapse(tables, by_node, node_of)
    bs_leaf = wrap_leaf_text(elements, node_of)

    index = ref_index if ref_index is not None else board_ref_index()
    kids = children if children is not None else state_children_index(index)
    marks, unresolved = mark_state_controls(
        elements, node_of, region_of, kids.get(board_id, [])
    )

    html = serialize(root) + "\n"
    operation_refs = list(meta.get("operation_refs") or ledger_operation_refs(board_id))
    ref_set = set(operation_refs)
    state = resolve_state(meta, board_id, index)
    state_kind = state.get("kind", "default")
    details = detail_ops_by_field()

    slots: list[dict] = []
    for el in elements:
        if not is_text_leaf(el):
            continue
        node = node_of[id(el)]
        text = direct_text(el)
        kind = "label" if is_label_text(text) else "value"
        anchor = parse_anchor(node.resolved_name, ref_set, details)
        slots.append(
            {
                "slot_id": f"s{len(slots) + 1:03d}",
                "node_id": node.node_id,
                "node_name": node.resolved_name,
                "node_path": node_path(el, root),
                "paper_text": text,
                "region": nearest_region(el, region_of),
                "kind": kind,
                "layer": estimate_layer(el, height_of, state_kind, kind),
                "font_size_px": font_size_px(el),
                "anchor": anchor["anchor"],
                "table": cell_of.get(id(el)),
                "mapping_id": anchor["mapping_id"],
                "f": anchor["f"],
                "alt_mappings": None,
                "kor": None,
                "format": infer_format(text, el) if kind == "value" else None,
                "paired_with": None,
                "collapse_group": None,
                "expanded_board": None,
            }
        )

    # 트리가 텍스트를 보고한 노드는 HTML 텍스트와 글자 단위로 같아야 한다.
    # (`SVGVisualElement`처럼 트리가 텍스트를 생략하는 컴포넌트가 있어 전체
    #  다중집합 비교 대신 노드 단위로 대조한다.)
    mismatched: list[str] = []
    truncated = 0
    for el, node in zip(elements, nodes):
        if node.text is None:
            continue
        actual = direct_text(el)
        if actual == node.text:
            continue
        # 트리 요약은 아주 긴 텍스트를 잘라 보여준다. 앞부분이 같으면 통과시킨다.
        if len(node.text) >= 40 and actual.startswith(node.text.rstrip()):
            truncated += 1
            continue
        mismatched.append(f"{node.node_id}: 트리 {node.text!r} ↔ HTML {actual!r}")
    if mismatched:
        raise ExtractError(
            f"텍스트 불일치 {len(mismatched)}건 — " + " / ".join(mismatched[:5])
        )

    html_texts = [s["paper_text"] for s in slots]
    multiset: dict[str, int] = {}
    for text in html_texts:
        multiset[text] = multiset.get(text, 0) + 1

    payload = {
        "board_id": board_id,
        "card_id": meta.get("card_id"),
        "name": meta.get("name"),
        "paper_source": {
            **(meta.get("paper_source") or {}),
            **({"saved_at": meta["saved_at"]} if meta.get("saved_at") else {}),
            "node_id": nodes[0].node_id,
            "jsx_sha256": sha256(jsx_src),
        },
        "html_sha256": sha256(html),
        # board.html 루트가 실제로 차지하는 크기(원문에서 아트보드 껍데기가 벗겨질 수 있다).
        "width_px": nodes[0].width,
        "height_px": nodes[0].height,
        "artboard_px": [meta.get("width"), meta.get("height")],
        "operation_refs": operation_refs,
        "state": state,
        "regions": assigned,
        "tables": tables,
        "counts": {
            "elements": len(elements),
            "text_nodes": len(slots),
            "slots": len(slots),
            "anchored_slots": sum(1 for s in slots if s["anchor"] is not None),
            "mapped_slots": sum(1 for s in slots if s["mapping_id"]),
            "labels": sum(1 for s in slots if s["kind"] == "label"),
            "values": sum(1 for s in slots if s["kind"] == "value"),
            "layer_직접": sum(1 for s in slots if s["layer"] == "직접"),
            "layer_병기": sum(1 for s in slots if s["layer"] == "병기"),
            "layer_펼침": sum(1 for s in slots if s["layer"] == "펼침"),
            "tables": len(tables),
            "tree_text_truncated": truncated,
            "bs_col": bs_col,
            "bs_paired": bs_paired,
            "bs_leaf": bs_leaf,
            "bs_kpi_cell": kpi_cells,
            "state_control_marks": len(marks),
        },
        "density": {
            "table_columns": max((t["columns"] for t in tables), default=0),
            "rows_max": max((len(t["body_rows"]) for t in tables), default=0),
            "kpi_cells": kpi_cells,
            "rail_blocks": len(rail_blocks),
            "rail_rows_max": max((rail_block_rows(b) for b in rail_blocks), default=0),
        },
        "state_controls": {"marks": marks, "unresolved": unresolved},
        "text_multiset": dict(sorted(multiset.items())),
        "column_priority": [],
        "column_bindings": build_column_bindings(tables, slots),
        "section_titles_ko": {},
        "primary": {"renderer": None, "mount_slot": None, "module": None, "props_from": None},
        "slots": slots,
    }
    return html, payload


def merge_authored(previous: dict, payload: dict) -> dict:
    """이전 slots.json의 저작 필드를 새 스켈레톤에 옮겨 담는다."""
    for key, value in previous.items():
        if key not in GENERATED_TOP_KEYS:
            payload[key] = value
    authored = {
        slot["node_id"]: slot
        for slot in previous.get("slots", [])
        if isinstance(slot, dict) and slot.get("node_id")
    }
    for slot in payload["slots"]:
        old = authored.get(slot["node_id"])
        if not old:
            continue
        for key, value in old.items():
            if key in GENERATED_SLOT_KEYS:
                continue
            if value not in (None, [], {}, ""):
                slot[key] = value
    columns = {
        (table.get("table_id"), column.get("col")): column
        for table in previous.get("column_bindings") or []
        for column in table.get("columns") or []
        if isinstance(column, dict)
    }
    for table in payload["column_bindings"]:
        for column in table["columns"]:
            old = columns.get((table["table_id"], column["col"]))
            if not old:
                continue
            for key, value in old.items():
                if key in GENERATED_COLUMN_KEYS:
                    continue
                if value not in (None, [], {}, ""):
                    column[key] = value
    if "counts" in payload:
        payload["counts"].update(
            {
                "mapped_slots": sum(1 for slot in payload["slots"] if slot.get("mapping_id")),
                "labels": sum(1 for slot in payload["slots"] if slot.get("kind") == "label"),
                "values": sum(1 for slot in payload["slots"] if slot.get("kind") == "value"),
            }
        )
    return payload


def dump_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def board_dirs(selected: list[str]) -> list[Path]:
    if selected:
        dirs = [TEMPLATE_ROOT / name for name in selected]
        for path in dirs:
            if not path.is_dir():
                raise ExtractError(f"보드 디렉터리가 없다: {path}")
        return dirs
    # 원문 저장이 진행 중인 디렉터리(4종이 다 차지 않은 곳)는 건너뛴다.
    return sorted(
        p
        for p in TEMPLATE_ROOT.iterdir()
        if p.is_dir()
        and all((p / f).exists() for f in ("paper.jsx", "paper.tree.txt", "meta.json"))
    )


EMPTY_STATE_CONTROLS = {"marks": [], "unresolved": []}


def build_index(entries: list[dict], orphans: list[dict]) -> dict:
    boards = sorted(entries, key=lambda e: e["board_id"])
    resolved = 0
    unresolved: list[dict] = list(orphans)
    for entry in boards:
        block = entry.get("state_controls") or EMPTY_STATE_CONTROLS
        resolved += sum(len(mark["boards"]) for mark in block["marks"])
        unresolved.extend(block["unresolved"])
    unresolved.sort(key=lambda item: item["board_id"])
    return {
        "boards": boards,
        "state_controls": {
            "resolved": resolved,
            "unresolved_count": len(unresolved),
            "unresolved": unresolved,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Paper 보드 원문 → board.html/slots.json")
    parser.add_argument("boards", nargs="*", help="추출할 보드 id(생략 시 전체)")
    parser.add_argument("--check", action="store_true", help="쓰지 않고 디스크와 대조")
    parser.add_argument(
        "--apply-columns",
        action="store_true",
        help="열 하나에 저작된 mapping_id/f를 그 열의 셀 슬롯 전부에 퍼뜨린다",
    )
    parser.add_argument("--no-index", action="store_true", help="index.json을 갱신하지 않는다")
    args = parser.parse_args(argv)

    drift: list[str] = []
    failed: list[str] = []
    entries: list[dict] = []
    ref_index = board_ref_index()
    children = state_children_index(ref_index)
    propagated = 0
    for board_dir in board_dirs(args.boards):
        try:
            html, payload = extract_board(board_dir, ref_index, children)
        except ExtractError as exc:
            if args.boards:
                raise
            failed.append(f"{board_dir.name}: {exc}")
            print(f"{board_dir.name}: 실패 — {exc}", file=sys.stderr)
            continue
        html_path = board_dir / "board.html"
        slots_path = board_dir / "slots.json"
        if slots_path.exists():
            previous = json.loads(slots_path.read_text(encoding="utf-8"))
            payload = merge_authored(previous, payload)
        if args.apply_columns:
            propagated += apply_columns(payload)
        slots_text = dump_json(payload)
        if args.check:
            if not html_path.exists() or html_path.read_text(encoding="utf-8") != html:
                drift.append(f"{board_dir.name}/board.html")
            if not slots_path.exists() or slots_path.read_text(encoding="utf-8") != slots_text:
                drift.append(f"{board_dir.name}/slots.json")
        else:
            html_path.write_text(html, encoding="utf-8")
            slots_path.write_text(slots_text, encoding="utf-8")
        entries.append(
            {
                "board_id": payload["board_id"],
                "card_id": payload["card_id"],
                "name": payload["name"],
                "state": payload["state"],
                "operation_refs": payload["operation_refs"],
                "counts": payload["counts"],
                "state_controls": payload["state_controls"],
                "html_sha256": payload["html_sha256"],
            }
        )
        print(
            f"{board_dir.name}: 요소 {payload['counts']['elements']} · "
            f"텍스트 {payload['counts']['text_nodes']} · "
            f"앵커 {payload['counts']['anchored_slots']} · 표 {payload['counts']['tables']}"
        )

    orphans = state_orphans(ref_index)
    if args.no_index:
        pass
    elif not args.boards:
        index_text = dump_json(build_index(entries, orphans))
        if args.check:
            if not INDEX_PATH.exists() or INDEX_PATH.read_text(encoding="utf-8") != index_text:
                drift.append("index.json")
        else:
            INDEX_PATH.write_text(index_text, encoding="utf-8")
    elif not args.check:
        existing = (
            json.loads(INDEX_PATH.read_text(encoding="utf-8")).get("boards", [])
            if INDEX_PATH.exists()
            else []
        )
        merged = {e["board_id"]: e for e in existing}
        merged.update({e["board_id"]: e for e in entries})
        INDEX_PATH.write_text(
            dump_json(build_index(list(merged.values()), orphans)), encoding="utf-8"
        )

    if args.apply_columns:
        print(f"열 전파: 셀 슬롯 {propagated}개")
    if drift:
        print("드리프트: " + ", ".join(drift), file=sys.stderr)
    if failed:
        print(f"실패 {len(failed)}보드", file=sys.stderr)
    return 1 if (drift or failed) else 0


if __name__ == "__main__":  # pragma: no cover
    try:
        raise SystemExit(main())
    except ExtractError as exc:
        print(f"추출 실패: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
