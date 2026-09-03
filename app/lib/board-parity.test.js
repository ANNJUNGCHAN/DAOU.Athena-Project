'use strict';

// P1 파리티 하네스 — 픽스처 보드의 Paper 원문 텍스트 다중집합과 마운트 결과
// 텍스트 다중집합이 상등인지 고정한다(카드 표면 구현 계획 §5).
//
// jsdom을 쓰지 않는다. board.html은 추출기가 만든 정적 HTML이고 스크립트도
// 커스텀 엘리먼트도 없으므로, 태그·속성·텍스트만 읽는 최소 파서로 충분하다.
// board-mount의 applyPlan은 querySelectorAll/dataset/textContent/style/hidden만
// 쓰므로 이 트리 위에서 실코드 그대로 돈다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  mountPlan, applyPlan, applyResponsiveHooks, RESPONSIVE_REGIONS, HOISTED_PROPERTIES,
} = require('./board-mount');
const registry = require('./board-template-registry');

const BOARD_ID = 'fixture-quote';
const TEMPLATE_DIR = path.join(
  __dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', BOARD_ID,
);
const HTML = fs.readFileSync(path.join(TEMPLATE_DIR, 'board.html'), 'utf8');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'slots.json'), 'utf8'));
const CANON = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'values.canon.json'), 'utf8')).values;

// ---------- 최소 HTML 파서 + DOM 어댑터 ----------

// 추출기는 값 자리 잎 래퍼에 값 없는 속성(`data-leaf`)을 단다 — 브라우저 파서는
// 그대로 읽지만 값 있는 속성만 아는 정규식은 여는 태그를 통째로 놓치고, 뒤따르는
// 닫는 태그가 부모를 먼저 닫아 트리가 어긋난다. 값 없는 속성도 받는다.
const TAG = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTR = /([\w:-]+)(?:="([^"]*)")?/g;
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

function datasetKey(name) {
  return name.slice('data-'.length).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

// 인라인 style 속성을 CSSOM처럼 읽고 쓰는 최소 스텁. board-mount의 hoistLayout이
// getPropertyValue/setProperty/removeProperty만 쓰므로 이걸로 실코드가 그대로 돈다.
function makeStyle(cssText) {
  const map = new Map();
  for (const declaration of String(cssText || '').split(';')) {
    const at = declaration.indexOf(':');
    if (at < 0) continue;
    map.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
  }
  const style = {
    map,
    getPropertyValue: (name) => map.get(name) || '',
    setProperty: (name, value) => { map.set(name, value); if (name === 'display') style.display = value; },
    removeProperty: (name) => { map.delete(name); if (name === 'display') style.display = ''; },
  };
  style.display = map.get('display') || '';
  return style;
}

function makeElement(tag, attrs) {
  const node = {
    tag,
    attrs,
    dataset: {},
    style: makeStyle(attrs.style),
    hidden: false,
    children: [],
    listeners: [],
    className: attrs.class || '',
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    addEventListener(type, handler) { this.listeners.push({ type, handler }); },
    click() { this.listeners.filter((l) => l.type === 'click').forEach((l) => l.handler({})); },
    querySelectorAll(selector) {
      const match = selectorMatcher(selector);
      const found = [];
      const walk = (current) => {
        for (const child of current.children) {
          if (child.tag === '#text') continue;
          if (match(child)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('data-')) node.dataset[datasetKey(name)] = value;
  }
  Object.defineProperty(node, 'textContent', {
    get() {
      let text = '';
      const walk = (current) => {
        for (const child of current.children) {
          if (child.tag === '#text') text += child.text;
          else walk(child);
        }
      };
      walk(this);
      return text;
    },
    set(value) { this.children = [{ tag: '#text', text: String(value) }]; },
  });
  return node;
}

function selectorMatcher(selector) {
  // 전체 선택자 — board-mount의 폭 hoist 훑기가 쓴다. 태그 이름으로 잘못 읽으면
  // 아무것도 안 맞아 훑기가 조용히 빈손이 되고, 이 하네스가 그걸 못 잡는다.
  if (selector === '*') return () => true;
  const attrEq = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector);
  if (attrEq) return (node) => node.attrs[attrEq[1]] === attrEq[2];
  const attrHas = /^\[([\w-]+)\]$/.exec(selector);
  if (attrHas) return (node) => node.attrs[attrHas[1]] !== undefined;
  const klass = /^\.([\w-]+)$/.exec(selector);
  if (klass) return (node) => String(node.className).split(/\s+/).includes(klass[1]);
  return (node) => node.tag === selector;
}

function parse(html) {
  const root = makeElement('#root', {});
  const stack = [root];
  let cursor = 0;
  let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(html)) !== null) {
    const between = html.slice(cursor, match.index);
    if (between.trim()) stack[stack.length - 1].children.push({ tag: '#text', text: between });
    cursor = TAG.lastIndex;
    if (match[0].startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    let attrMatch;
    ATTR.lastIndex = 0;
    while ((attrMatch = ATTR.exec(match[2] || '')) !== null) {
      attrs[attrMatch[1]] = attrMatch[2] === undefined ? '' : attrMatch[2];
    }
    const element = makeElement(match[1], attrs);
    stack[stack.length - 1].children.push(element);
    // 닫는 태그가 없는 요소(<br>·<img> 등)를 스택에 올리면 그 뒤 형제가 전부 자식으로
    // 붙어 "컨테이너 앵커" 오판이 난다 — 실추출 보드에 <br>이 있다(1JPU-0 실측).
    if (!match[0].endsWith('/>') && !VOID_TAGS.has(match[1].toLowerCase())) stack.push(element);
  }
  return root;
}

function textMultiset(node) {
  const counts = new Map();
  const walk = (current) => {
    for (const child of current.children) {
      if (child.tag === '#text') {
        const text = child.text.trim();
        if (text) counts.set(text, (counts.get(text) || 0) + 1);
      } else walk(child);
    }
  };
  walk(node);
  return counts;
}

function sortedEntries(counts) {
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ---------- P1 ----------

test('P1 — 정본 값으로 마운트한 결과의 텍스트 다중집합이 Paper 원문과 상등이다', () => {
  const tree = parse(HTML);
  const before = textMultiset(tree);
  const surface = tree.querySelector('.board-surface');
  assert.ok(surface, 'board.html 루트에 .board-surface가 있어야 한다');

  const plan = mountPlan(CONTRACT, CANON);
  const report = applyPlan(surface, plan);
  assert.deepEqual(report.unbound, [], '계약에만 있고 보드에 없는 슬롯');
  assert.deepEqual(report.unmapped, [], '보드에만 있고 계약에 없는 노드');

  const after = textMultiset(tree);
  assert.deepEqual(sortedEntries(after), sortedEntries(before));
});

test('glyph readability probe keeps raw geometry evidence and hard-enforces every selected board', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /document\.fonts && document\.fonts\.ready/);
  assert.match(verify, /requiredStableSamples: 4/);
  assert.match(verify, /Range\(\)/);
  assert.match(verify, /compactAtomicTokenSpans/);
  assert.match(verify, /range\.setStart\(text, token\.start\)/);
  assert.match(verify, /range\.setEnd\(text, token\.end\)/);
  assert.match(verify, /getClientRects\(\)/);
  assert.match(verify, /display !== 'contents'/);
  assert.match(verify, /data-bs-value-atomic/);
  assert.match(verify, /bs-r-flow, \.bs-r-scroll, \.bs-r-paired-table, \.bs-r-scroll-table/);
  assert.match(verify, /atomic_wrap_total/);
  assert.match(verify, /text_overlap_total/);
  assert.match(verify, /paired_semantics_total/);
  assert.match(verify, /owner_name/);
  assert.match(verify, /text: text\.nodeValue\.trim\(\)/);
  assert.match(verify, /text: element\.textContent\.trim\(\)/);
  assert.match(verify, /atomic_wrap_nodes/);
  assert.match(verify, /text_overlap_nodes/);
  assert.match(verify, /paired_semantics_violations/);
  assert.equal(
    [...verify.matchAll(/assertReadability\(surface\.boardId, preset, probe, \{ enforce: true \}\)/g)]
      .length,
    2,
  );
  assert.doesNotMatch(verify, /assertReadability\([^\n]+\{ enforce: false \}\)/);
  assert.match(verify, /canonical:\s*CANONICAL_CAPTURE_RUN/);
});

test('paired semantic probe scopes legacy ambiguity to opted-in paired tables', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /surface\.querySelectorAll\('\[data-paired-source\]'\)/);
  assert.match(verify, /surface\.querySelectorAll\('\.bs-r-paired-table \.bs-paired'\)/);
  assert.doesNotMatch(verify,
    /for \(const mirror of surface\.querySelectorAll\('\.bs-paired'\)\) \{/);
  assert.match(verify, /kind:\s*'legacy_pair'/);
  assert.match(verify, /ambiguous_inline/);
  for (const field of [
    'source_count', 'label_count', 'source_tone', 'mirror_tone',
    'source_missing', 'mirror_missing',
  ]) assert.match(verify, new RegExp(field));
  assert.match(verify, /dataset\.leaf/);
  assert.match(verify, /dataset\.bsValueAtomic/);
  assert.match(verify, /hidden: !shown\(mirror\)/);
  assert.match(verify, /\.bs-r-scroll-table/);
  assert.match(verify, /scroll_bad_column_role/);
  assert.match(verify, /scroll_missing_row/);
  assert.match(verify, /table\.querySelectorAll\('\[role="row"\]'\)/);
  assert.match(verify, /row\.closest\('\[role="table"\]'\) === table/);
  assert.doesNotMatch(verify, /const rows = \[\.\.\.table\.children\]/);
  assert.match(verify, /bs-scroll-table-cell-semantics/);
  assert.match(verify, /scroll_control_role_conflict/);
  assert.match(verify, /scroll_not_scrollable/);
  assert.match(verify, /scroll_width/);
  assert.match(verify, /client_width/);
  assert.match(verify, /scroll_state_controls/);
  assert.match(verify, /scroll_control_not_focusable/);
});

test('real-board verifier fixtures preserve authored state-board links for runtime wiring', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /stateLinksFromMarks/);
  assert.match(
    verify,
    /function loadRealBoardContract[\s\S]*?state_boards:\s*stateLinksFromMarks\(slots\.state_controls\)/,
  );
  const realBoardFactory = verify.match(
    /function loadRealBoardContract[\s\S]*?\n}\n\n\/\/ 보드 1장/,
  )[0];
  assert.doesNotMatch(realBoardFactory, /state_boards:\s*\[\]/);
});

test('canonical glyph verifier has no alternate diagnostic success path', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /waitForStableLayout/);
  assert.doesNotMatch(verify, /ATHENA_GLYPH_DIAGNOSTIC|GLYPH_DIAGNOSTIC|glyph-performance-diagnostic/);
});

test('the integrated verifier takes its exact default readability board order from the frozen contract', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /DEFAULT_REAL_BOARDS = DEFAULT_READABILITY_BOARD_IDS/);
  assert.match(verify, /resolveBoardSelection\(BOARD_SELECTION_OVERRIDE, DEFAULT_REAL_BOARDS\)/);
});

test('canonical capture hygiene is exact-set guarded while overrides write to diagnostics', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /ensureCaptureOutputDirectory\(CAPTURE_DIR, CANONICAL_CAPTURE_RUN\)/);
  assert.match(verify, /expectedBoardCaptureNames\(DEFAULT_REAL_BOARDS, BOARD_WINDOW_PRESETS\)/);
  assert.match(verify, /CANONICAL_CAPTURE_RUN\s*\?\s*pruneUnexpectedBoardCaptures/);
  assert.match(verify, /if \(CANONICAL_CAPTURE_RUN\)[\s\S]*?assertReadabilityMatrix/);
  assert.match(verify, /if \(CANONICAL_CAPTURE_RUN\)[\s\S]*?assertBoardCaptureArtifacts/);
  assert.match(verify, /CAPTURE_OUTPUT_DIR, 'VERIFY-INTEGRATED-CARDS\.json'/);
  assert.doesNotMatch(verify, /rmSync\(CAPTURE_DIR|rmdirSync\(CAPTURE_DIR/);
  assert.match(verify, /assertReadabilityManifest\(regions, boardHtml\)/);
});

test('P1 슬롯 단위 — 계산된 표기가 slots.json의 paper_text와 한 글자도 다르지 않다', () => {
  const plan = mountPlan(CONTRACT, CANON);
  const byId = new Map(plan.assignments.map((a) => [a.slotId, a.text]));
  const mismatched = CONTRACT.slots
    .filter((slot) => byId.get(slot.slot_id) !== slot.paper_text)
    .map((slot) => `${slot.slot_id}: ${JSON.stringify(byId.get(slot.slot_id))} ≠ ${JSON.stringify(slot.paper_text)}`);
  assert.deepEqual(mismatched, []);
  assert.equal(byId.size, CONTRACT.slots.length);
});

test('P1 — 값이 바뀌면 그 슬롯의 텍스트만 바뀐다(구조·정적 문구 불변)', () => {
  const tree = parse(HTML);
  const surface = tree.querySelector('.board-surface');
  applyPlan(surface, mountPlan(CONTRACT, CANON));
  const before = textMultiset(tree);

  applyPlan(surface, mountPlan(CONTRACT, { ...CANON, 'header.price': 151000 }));
  const after = textMultiset(tree);
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((text) => (before.get(text) || 0) !== (after.get(text) || 0));
  assert.deepEqual(changed.sort(), ['150,850', '151,000']);
});

// ---------- 밀도 예산 (헌장 §2.3) ----------

test('밀도 예산 — 표 8열 · KPI 6칸 · 레일 블록 5개 이하', () => {
  const tree = parse(HTML);
  const surface = tree.querySelector('.board-surface');
  const priorities = new Set(surface.querySelectorAll('[data-col-priority]').map((node) => node.dataset.colPriority));
  assert.equal(priorities.size, CONTRACT.density.table_columns);
  assert.ok(priorities.size <= 8, `표 기본 열 ${priorities.size} > 8`);
  assert.deepEqual([...priorities].sort(), ['1', '2', '3', '4', '5', '6', '7', '8']);

  const kpi = surface.querySelector('.bs-kpi');
  const kpiCells = kpi.children.filter((child) => child.tag !== '#text').length;
  assert.equal(kpiCells, CONTRACT.density.kpi_cells);
  assert.ok(kpiCells <= 6, `KPI ${kpiCells}칸 > 6`);

  const rail = surface.querySelector('.bs-rail');
  const railBlocks = rail.children.filter((child) => child.tag !== '#text').length;
  assert.ok(railBlocks <= 5, `레일 블록 ${railBlocks} > 5`);
  assert.equal(railBlocks, CONTRACT.density.rail_blocks);
});

// ---------- P5 접힘은 이동이지 삭제가 아님 ----------

test('P5 — 접히는 열마다 같은 값을 받는 병기 줄이 있다(삭제 0)', () => {
  const tree = parse(HTML);
  const surface = tree.querySelector('.board-surface');
  const folded = ['4', '5', '6', '7', '8'];
  const pairedTargets = new Set();
  for (const node of surface.querySelectorAll('.bs-paired')) {
    for (const token of String(node.dataset.pairedCol || '').split(/\s+/)) {
      if (token) pairedTargets.add(token);
    }
  }
  assert.deepEqual(folded.filter((p) => !pairedTargets.has(p)), [], '병기 줄 없이 사라지는 열');
  // 병기 줄이 살아 있는 열은 XL에서 접히지 않는 열(1~3)을 host로 삼아야 한다.
  for (const node of surface.querySelectorAll('.bs-paired')) {
    const host = hostPriority(surface, node);
    assert.ok(host !== null && Number(host) <= 3, `병기 줄 host 열 ${host}는 XS에서 함께 사라진다`);
  }
});

function hostPriority(surface, target) {
  let found = null;
  const walk = (node, currentPriority) => {
    const priority = node.dataset && node.dataset.colPriority !== undefined
      ? node.dataset.colPriority : currentPriority;
    if (node === target) { found = priority; return; }
    for (const child of node.children) {
      if (child.tag === '#text') continue;
      walk(child, priority);
    }
  };
  walk(surface, null);
  return found;
}

// ---------- 반응형 CSS 계약 ----------

test('board-surface.css는 5단이고 !important를 쓰지 않는다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /!important/, '인라인 원문과 싸우는 !important는 금지다');
  const breakpoints = [...rules.matchAll(/@container board \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
  // XL(≥1280)은 규칙 없음 + L·M·S·XS 네 블록 = 5단.
  assert.deepEqual(breakpoints, [1279, 959, 719, 479]);
  assert.match(rules, /\.board-surface\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(rules, /\.board-surface\s*\{[^}]*max-width:\s*min\(100%, 1440px\)/);
  // 접기·병기 활성은 추출기가 새로 넣는 요소에만 건다(인라인 스타일 충돌 0).
  assert.match(rules, /\.bs-col\s*\{\s*display:\s*contents;\s*\}/);
  assert.match(rules, /\.bs-paired\s*\{\s*display:\s*none;/);
  // 인라인에서 걷어낸 네 속성을 base가 그대로 되돌린다(XL 픽셀 파리티의 근거).
  for (const token of ['--bs-width', '--bs-flex-basis', '--bs-flex-grow', '--bs-flex-shrink']) {
    assert.ok(rules.includes(`var(${token},`), `${token} 되돌리기 규칙이 없다`);
  }
  // Paper 영역 노드의 display는 어느 단계에서도 바꾸지 않는다 — 인라인이 이기므로
  // 싸움이 되고, 이기려면 !important가 필요해진다. display를 건드려도 되는 것은
  // 추출기가 새로 넣어 인라인 스타일이 없는 .bs-col / .bs-paired뿐이다.
  const containerBlocks = rules.split('@container').slice(1).join('');
  const displayChunks = containerBlocks.split('}').filter((chunk) => /display\s*:/.test(chunk));
  const illegal = displayChunks
    .filter((chunk) => !chunk.includes('.bs-col') && !chunk.includes('.bs-paired'))
    .map((chunk) => chunk.trim());
  assert.deepEqual(illegal, [], '컨테이너 규칙이 Paper 영역 노드의 display를 바꾼다');
  // 4단(L·M·S·XS) x (열 숨김 + 기존 병기 켜기 + paired-table grid) = 12 규칙.
  assert.equal(displayChunks.length, 12);
  for (const priority of [4, 5, 6, 7, 8]) {
    assert.match(css, new RegExp(`\\.bs-col\\[data-col-priority="${priority}"\\]`));
    assert.match(css, new RegExp(`\\.bs-paired\\[data-paired-col~="${priority}"\\]`));
  }
});

test('paired-table labels form scoped label-value grids while scroll-table keeps its native grid reachable', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(rules,
    /\.bs-r-paired-table \.bs-paired\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) max-content/);
  assert.match(rules,
    /\.bs-r-paired-table \.bs-paired-label\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
  assert.match(rules,
    /\.bs-r-paired-table \[data-paired-source\]\s*\{[^}]*white-space:\s*nowrap[^}]*overflow-wrap:\s*normal/);
  assert.match(rules,
    /\.bs-r-paired-table \[data-bs-value-atomic="true"\]\s*\{[^}]*white-space:\s*nowrap[^}]*overflow-wrap:\s*normal/);
  for (const priority of [4, 5, 6, 7]) {
    assert.match(rules, new RegExp(
      `\\.bs-r-paired-table \\.bs-paired\\[data-paired-col~="${priority}"\\]\\s*\\{\\s*display:\\s*grid`,
    ));
  }

  assert.match(rules,
    /\.bs-r-scroll-table\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/);
  assert.match(rules, /\.bs-r-scroll-table:focus-visible\s*\{[^}]*outline:/);
  assert.match(rules,
    /\.bs-scroll-table-semantics\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-width:\s*max-content/);
  assert.doesNotMatch(rules, /\.bs-scroll-table-semantics\s*\{[^}]*display:\s*contents/);
  assert.match(rules,
    /\.bs-scroll-table-cell-semantics\s*\{[^}]*display:\s*flex[^}]*flex-shrink:\s*0/);
  assert.doesNotMatch(rules, /\.bs-scroll-table-cell-semantics\s*\{[^}]*display:\s*contents/);
  assert.doesNotMatch(rules, /#(?:39SW|33WD)|\[data-node(?:=|\])/,
    'table behavior must never depend on Paper node ids');
});

// ---------- 생성 색인 드리프트 ----------

test('카드 청크가 board.html 원문과 같은 해시를 들고 있다', () => {
  const digest = crypto.createHash('sha256').update(HTML, 'utf8').digest('hex');
  assert.equal(registry.boardSha256(BOARD_ID), digest,
    'scripts/build_board_registry.py를 다시 돌려라');
  assert.equal(registry.boardHtml(BOARD_ID), HTML);
  assert.equal(registry.cardIdFor(BOARD_ID), CONTRACT.card_id);
  // 색인은 레인 A가 추출한 실보드와 함께 자란다 — 개수를 고정하지 않고, 이 레인이
  // 소유한 픽스처가 색인에 살아 있는지만 고정한다.
  assert.ok(registry.boardIds().includes(BOARD_ID));
  assert.ok(registry.hasBoard(BOARD_ID));
});

test('색인은 보드 id → 카드 id만 싣고, 원문은 카드 청크에만 있다', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, 'board-templates.index.generated.js'), 'utf8',
  );
  // 색인이 원문을 물면 셸 부팅마다 수 MB를 파싱하게 된다 — 청크로 쪼갠 이유가 없어진다.
  assert.doesNotMatch(indexSource, /data-node=/, '색인에 board.html 원문이 섞였다');
  assert.ok(indexSource.length < 200 * 1024, `색인이 ${indexSource.length}B — 색인은 작아야 한다`);
  assert.match(indexSource, /window\.AthenaLib\.BoardTemplatesIndex = __exports;/);

  const cardIds = registry.cardIds();
  assert.ok(cardIds.includes(CONTRACT.card_id));
  for (const cardId of cardIds) {
    const chunk = path.join(__dirname, registry.chunkFileName(cardId));
    assert.ok(fs.existsSync(chunk), `${cardId} 청크 파일이 없다 — ${chunk}`);
  }
  // 색인이 아는 보드는 전부 어느 카드 청크엔가 속한다.
  for (const boardId of registry.boardIds()) {
    assert.ok(cardIds.includes(registry.cardIdFor(boardId)), `${boardId}: 청크 없는 카드`);
  }
});

test('loadBoard는 필요한 카드 청크 하나만 실어 Promise로 해석한다', async () => {
  const entry = await registry.loadBoard(BOARD_ID);
  assert.equal(entry.html, HTML);
  assert.equal(registry.isLoaded(BOARD_ID), true);
  // 청크 URL은 레지스트리 자신이 앉은 폴더 기준이다(file:// 문서 어디서 열든 같다).
  assert.equal(registry.chunkUrl(CONTRACT.card_id), `lib/board-templates.${CONTRACT.card_id}.generated.js`);
  await assert.rejects(registry.loadBoard('없는보드'), /색인에 없는 보드/);
});

// ---------- 반응형: 인라인 폭 hoist 후 컨테이너 쿼리가 이긴다 ----------

test('semantic flow and atomic behavior starts below XL and remains owner-scoped', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const xl = css.slice(0, css.indexOf('@container board'));
  const l = /@container board \(max-width: 1279px\)\s*\{([\s\S]*?)\n\}/.exec(css)[1];

  assert.doesNotMatch(xl, /bs-r-(?:flow|scroll)[^{]*\{[^}]*?(?:white-space|flex-wrap|overflow-x)/,
    'XL must retain Paper layout');
  assert.match(l, /\.bs-r-flow\s*\{\s*flex-wrap:\s*wrap;/);
  assert.match(l, /\.bs-r-flow\s*>\s*\*\s*\{\s*flex-shrink:\s*0;/);
  assert.match(l,
    /:is\(\.bs-r-flow, \.bs-r-scroll\)\s+:is\(\.bs-r-atomic, \[data-bs-value-atomic="true"\]\)\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow-wrap:\s*normal;/);
  assert.doesNotMatch(l,
    /:is\(\.bs-r-flow, \.bs-r-scroll, \.bs-r-(?:paired|scroll)-table\)/,
    'generic atomic behavior must not leak into either table contract');
});

test('semantic scroll behavior is bounded, nonshrinking, and visibly focusable from M down', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /@container board \(max-width: 959px\)\s*\{([\s\S]*?)\n\}/.exec(css)[1];

  assert.match(m, /\.bs-r-scroll\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/);
  assert.match(m, /\.bs-r-scroll\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0;[^}]*min-width:\s*max-content;/);
  assert.match(css, /\.bs-r-scroll:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-k-text\);[^}]*outline-offset:\s*-2px;/);
  assert.match(css,
    /:is\(\.bs-r-flow, \.bs-r-scroll, \.bs-r-scroll-table\)\s+\[data-state-board\]\[role="button"\]:focus-visible\s*\{[^}]*outline:/);
  assert.doesNotMatch(css,
    /(?:^|\n)\[data-state-board\]\[role="button"\]:focus-visible/,
    'outside-group state controls must not inherit the responsive focus contract');
});

test('responsive behavior CSS never names a board or Paper node', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?:2SKU-1|2R3M-1|13BC-2|2QFO-2|13K0-2|135M-2)/);
  assert.doesNotMatch(css, /\[data-node(?:=|\])/);
});

test('마운트 시 인라인 폭이 커스텀 속성으로 내려가고 나머지 원문은 그대로다', () => {
  const tree = parse(HTML);
  const surface = tree.querySelector('.board-surface');
  const rail = surface.querySelector('.bs-rail');
  const railBackground = rail.style.getPropertyValue('background-color');
  const railDisplay = rail.style.getPropertyValue('display');

  // 훅 전: 인라인 width가 살아 있어 컨테이너 쿼리가 못 이긴다.
  assert.equal(rail.style.getPropertyValue('width'), '460px');

  // 훅이 훑는 노드 = 보드 루트 1 + 반응형 영역 전부(bs-kpi-cell은 여러 칸이다)
  // + 영역 밖 고정 상자(표 열 폭·KPI 칸·헤더 블록). 실보드 6장 실측에서 px 폭
  // 노드의 대부분이 영역 밖에 있다(2SKU-1 75개 중 68 · 2QFO-2 155개 중 153) —
  // 영역만 걷어내면 안쪽 고정 폭이 그대로 남아 컨테이너 쿼리가 못 줄인다.
  const regionNodes = new Set();
  for (const region of RESPONSIVE_REGIONS) {
    for (const node of surface.querySelectorAll(`.${region}`)) regionNodes.add(node);
  }
  const rigidOutside = surface.querySelectorAll('*').filter((node) => (
    !regionNodes.has(node)
    && HOISTED_PROPERTIES.some(([property]) => node.style.getPropertyValue(property))
  ));
  assert.ok(rigidOutside.length > 0, '영역 밖 고정 상자가 없으면 이 검사는 빈 상등이다');
  assert.equal(applyResponsiveHooks(surface), 1 + regionNodes.size + rigidOutside.length);
  for (const node of rigidOutside) {
    assert.equal(node.dataset.bsHoisted, 'true');
    // 인라인은 비고, 되돌리기 값이 그 자리를 대신한다(XL 계산값은 Paper와 같다).
    const restored = HOISTED_PROPERTIES.filter(([property, token]) => {
      assert.equal(node.style.getPropertyValue(property), '', `${property} 인라인이 남았다`);
      return node.style.getPropertyValue(token);
    });
    assert.ok(restored.length > 0, `${node.dataset.node}: 되돌리기 값이 하나도 없다`);
  }
  assert.equal(surface.querySelectorAll('.bs-kpi-cell').length, 6, 'KPI 칸이 추출 계약대로 표시돼 있어야 한다');
  assert.equal(surface.style.getPropertyValue('--bs-width'), '1440px');
  assert.equal(surface.style.getPropertyValue('width'), '');
  for (const region of RESPONSIVE_REGIONS) {
    const node = surface.querySelector(`.${region}`);
    assert.ok(node, `${region} 영역이 보드에 있어야 한다`);
    assert.equal(node.style.getPropertyValue('width'), '', `${region} 인라인 width가 남았다`);
    assert.ok(node.style.getPropertyValue('--bs-width'), `${region} 되돌리기 값이 없다`);
  }
  // Paper 레이아웃 모델(display)과 시각 원문은 손대지 않는다.
  assert.equal(rail.style.getPropertyValue('display'), railDisplay);
  assert.equal(rail.style.getPropertyValue('background-color'), railBackground);
  // 헤더도 고정 폭을 들고 있다(픽스처 1440px) — 걷어내지 않으면 컨테이너가
  // 1440px 아래로 내려가는 순간 그만큼이 그대로 가로 넘침이 된다.
  const header = surface.querySelector('.bs-header');
  assert.equal(header.style.getPropertyValue('width'), '');
  assert.equal(header.style.getPropertyValue('--bs-width'), '1440px');
});

// ---------- shell.html 로드 계약 ----------

test('shell 실제 순서로 새 모듈을 로드하면 AthenaLib에 전부 등록된다', () => {
  const vm = require('node:vm');
  const appDir = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
  const wanted = [
    'lib/facts-card.js',
    'lib/board-templates.index.generated.js',
    'lib/board-template-registry.js',
    'lib/board-format.js',
    'lib/board-mount.js',
    'lib/canvas-tabs.js',
  ];
  const sources = Array.from(shell.matchAll(/<script src="(lib\/[^"]+\.js)"><\/script>/g), (m) => m[1])
    .filter((source) => wanted.includes(source));
  // 로드 순서가 어긋나면 board-mount가 BoardFormat을 undefined로 잡는다.
  assert.deepEqual(sources, wanted);

  const context = vm.createContext({ window: { AthenaLib: {} }, console });
  for (const source of sources) {
    const filename = path.join(appDir, source);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  const lib = context.window.AthenaLib;
  for (const name of ['BoardTemplatesIndex', 'BoardTemplateRegistry', 'BoardFormat', 'BoardMount', 'CanvasTabs']) {
    assert.equal(typeof lib[name], 'object', `${name} 미등록`);
  }
  assert.equal(typeof lib.BoardMount.mountBoard, 'function');
  assert.equal(typeof lib.BoardMount.mountBoardAsync, 'function');
  assert.equal(typeof lib.CanvasTabs.createDeck, 'function');
  assert.equal(lib.BoardFormat.formatKoreanUnit(12840000), '1,284만');
  // 셸이 싣는 것은 색인뿐이다 — 원문은 아직 없고, 그래서 동기 조회가 비어 있다.
  assert.equal(lib.BoardTemplateRegistry.cardIdFor(BOARD_ID), 'CC-03');
  assert.equal(lib.BoardTemplateRegistry.isLoaded(BOARD_ID), false);
  assert.equal(lib.BoardTemplateRegistry.boardHtml(BOARD_ID), null);

  // 그 카드 청크를 셸과 같은 방식(자기 등록)으로 실으면 그때 원문이 붙는다.
  const chunkFile = path.join(appDir, 'lib', lib.BoardTemplateRegistry.chunkFileName('CC-03'));
  vm.runInContext(fs.readFileSync(chunkFile, 'utf8'), context, { filename: chunkFile });
  assert.equal(lib.BoardTemplateRegistry.isLoaded(BOARD_ID), true);
  assert.equal(lib.BoardTemplateRegistry.boardSha256(BOARD_ID).length, 64);
});

test('shell.html이 탭·보드 스타일시트를 싣는다', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  assert.match(shell, /<link rel="stylesheet" href="styles\/canvas-tabs\.css" \/>/);
  assert.match(shell, /<link rel="stylesheet" href="styles\/board-surface\.css" \/>/);
});

// ---------- 색인이 마운트 계약까지 갖는다 ----------

test('색인이 board.html과 마운트 계약을 함께 싣는다 — 봉투는 값만 나른다', () => {
  const contract = registry.contractFor(BOARD_ID);
  assert.equal(contract.board_id, BOARD_ID);
  assert.equal(contract.slots.length, CONTRACT.slots.length);
  const anchors = new Set(contract.slots.map((slot) => slot.node));
  for (const slot of CONTRACT.slots) assert.ok(anchors.has(slot.node), `${slot.slot_id} 앵커 누락`);
  // 값은 색인에 없다 — 정적 계약만 있다.
  for (const slot of contract.slots) {
    assert.equal(slot.value, undefined);
    assert.equal(typeof slot.slot_id, 'string');
  }
  // 계약을 넘기지 않아도 색인에서 찾아 같은 계획을 세운다.
  const fromRegistry = mountPlan(contract, CANON);
  const fromFile = mountPlan(CONTRACT, CANON);
  assert.deepEqual(
    fromRegistry.assignments.map((a) => [a.slotId, a.text]),
    fromFile.assignments.map((a) => [a.slotId, a.text]),
  );
  assert.equal(registry.contractFor('없는보드'), null);
});

test('레인 A 실추출 보드도 마운트 계약을 갖고, 앵커가 board.html에 실재한다', () => {
  const realBoards = registry.boardIds().filter((id) => id !== BOARD_ID);
  if (!realBoards.length) return; // 추출물이 아직 없으면 통과(픽스처만 있는 상태)
  for (const boardId of realBoards) {
    const contract = registry.contractFor(boardId);
    assert.ok(contract.slots.length > 0, `${boardId}: 마운트 계약이 비었다`);
    const html = registry.boardHtml(boardId);
    const anchors = new Set(Array.from(html.matchAll(/data-node="([^"]+)"/g), (m) => m[1]));
    const missing = contract.slots.map((slot) => slot.node).filter((node) => !anchors.has(node));
    assert.deepEqual(missing.slice(0, 3), [], `${boardId}: 앵커 누락`);
  }
});

// ---------- 추출기 계약 소비: 컨테이너에는 절대 쓰지 않는다 ----------
//
// 추출기는 Paper 노드 id를 모든 노드에 남기므로 슬롯 앵커가 컨테이너일 수 있다.
// 컨테이너에 textContent를 쓰면 그 안의 병기 줄·자식 노드가 통째로 사라진다.
// board-mount는 그런 앵커를 건너뛰고 `containers[]`에 담는다 — 이 배열이 비어야
// "계약이 가리키는 앵커가 전부 잎"이라는 뜻이고, 그게 통과 조건이다.

test('실추출 보드 전수 — 값이 실리는 슬롯은 컨테이너에 앉지 않는다', () => {
  const boardIds = registry.boardIds();
  assert.ok(boardIds.length > 0);
  const offenders = [];
  for (const boardId of boardIds) {
    const contract = registry.contractFor(boardId);
    if (!contract.slots.length) continue;
    const tree = parse(registry.boardHtml(boardId));
    const surface = tree.querySelector('.board-surface') || tree.children.find((c) => c.tag !== '#text');
    const report = applyPlan(surface, mountPlan(contract, {}));
    const byId = new Map(contract.slots.map((slot) => [slot.slot_id, slot]));
    for (const slotId of report.containers) {
      // 픽스처는 이 레인이 저작을 끝낸 보드다 — containers[]가 통째로 비어야 한다.
      // 레인 A 추출물은 아직 저작(format 부여) 전이라, 값이 실릴 슬롯(format 있음)이
      // 컨테이너에 앉은 경우만 잡는다. 그런 슬롯은 마운트가 건너뛰므로 값이 영영
      // 화면에 못 나온다 — 조용한 누락이라 여기서 크게 터뜨린다.
      const slot = byId.get(slotId);
      if (boardId === BOARD_ID || (slot && slot.format)) {
        offenders.push(`${boardId}/${slotId}: 앵커가 컨테이너다`);
      }
    }
    if (report.unbound.length) {
      offenders.push(`${boardId}: 앵커 없는 슬롯 ${report.unbound.slice(0, 3).join(', ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------- 추출기 계약 소비: 접기 임계 ----------

function foldRules() {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const steps = [];
  const blocks = /@container board \(max-width: (\d+)px\)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = blocks.exec(css)) !== null) {
    const body = match[2];
    const hidden = new Set(Array.from(
      body.matchAll(/\.bs-col\[data-col-priority="(\d)"\][^{]*\{\s*display:\s*none/g), (m) => m[1],
    ));
    // 한 규칙에 셀렉터가 여러 개면 위 정규식은 마지막 것만 잡는다 — 규칙 본문에서
    // 다시 훑어 전부 모은다.
    for (const rule of body.split('}')) {
      if (!/display:\s*none/.test(rule)) continue;
      for (const m of rule.matchAll(/\.bs-col\[data-col-priority="(\d)"\]/g)) hidden.add(m[1]);
    }
    const paired = new Set();
    for (const rule of body.split('}')) {
      if (!/display:\s*block/.test(rule)) continue;
      for (const m of rule.matchAll(/\.bs-paired\[data-paired-col~="(\d)"\]/g)) paired.add(m[1]);
    }
    steps.push({ maxWidth: Number(match[1]), hidden, paired });
  }
  return steps;
}

test('접기 임계 — L은 7열 이상, M은 6 이상, S는 5 이상, XS는 4 이상을 접는다', () => {
  const steps = foldRules();
  assert.deepEqual(steps.map((step) => step.maxWidth), [1279, 959, 719, 479]);
  // max-width 규칙이라 단계는 겹쳐 쌓인다 — 좁아질수록 접히는 열이 누적된다.
  const cumulative = new Set();
  const expected = [['7', '8'], ['6', '7', '8'], ['5', '6', '7', '8'], ['4', '5', '6', '7', '8']];
  steps.forEach((step, at) => {
    for (const priority of step.hidden) cumulative.add(priority);
    assert.deepEqual([...cumulative].sort(), expected[at], `${step.maxWidth}px 단계 접기 집합`);
    // 접히는 열은 반드시 같은 단계에서 병기 줄로 내려온다(삭제 0).
    assert.deepEqual([...step.hidden].sort(), [...step.paired].sort(),
      `${step.maxWidth}px 단계: 접는 열과 병기로 켜는 열이 다르다`);
  });
});

test('KPI 칸은 M 이하에서만 3칸/2칸/1칸 흐름으로 바뀐다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // XL·L base — 인라인에서 걷어낸 폭을 그대로 되돌린다(픽셀 파리티).
  assert.match(css, /\.bs-kpi-cell,?[\s\S]{0,80}\{\s*width: var\(--bs-width, auto\)/);
  const steps = [...css.matchAll(/@container board \(max-width: (\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
    .map(([, width, body]) => [Number(width), (/\.bs-kpi-cell\s*\{([^}]*)\}/.exec(body) || [, ''])[1]]);
  const flow = new Map(steps);
  // L에서 KPI 칸 폭은 Paper 원문 그대로다 — 모든 칸을 바꾸지 않는다. 값이 있는
  // 탄력 칸만 별도 표식을 받아 160px 바닥을 갖는다. 빈 spacer나 고정 칸까지
  // 160px로 만들면 6~8칸 시세 스트립이 L 컨테이너보다 넓어진다.
  assert.equal(flow.get(1279).trim(), '');
  const lBody = [...css.matchAll(/@container board \(max-width: 1279px\)\s*\{([\s\S]*?)\n\}/g)][0][1];
  assert.match(lBody, /\[data-bs-hoisted\]\s*\{[\s\S]*?min-width: 0;/,
    'flex item의 min-content 바닥을 놓지 않으면 XS에서 surface overflow가 난다');
  assert.match(lBody,
    /\[data-bs-inset-x="true"\]\s*\{\s*right: var\(--bs-inset-x\);\s*width: auto;\s*\}/,
    'absolute 하단 액션은 left+고정폭 대신 양쪽 inset으로 좁아져야 한다');
  assert.match(lBody,
    /\.bs-kpi-cell\[data-bs-kpi-elastic="true"\]\s*\{\s*min-width: 160px;\s*\}/);
  assert.doesNotMatch(flow.get(1279), /(?:^|[^-])width: (?!var\()|flex-basis|flex-grow/);
  assert.match(flow.get(959), /width: auto/);
  assert.match(flow.get(959), /flex-basis: calc\(33\.3333% - 24px\)/);
  assert.match(flow.get(719), /flex-basis: calc\(50% - 24px\)/);
  assert.match(flow.get(479), /flex-basis: 100%/);
});

test('실보드 검증은 strip 내부 스크롤과 달리 surface 가로 넘침을 실패시킨다', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /if \(probe\.overflow_x > 1\)/);
  assert.match(verify, /surface overflow/);
});

test('실보드 검증은 24개 사용자 캡처와 별도로 XL·M 컨테이너를 기하 프로브한다', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /BOARD_BREAKPOINT_PROBE_PRESETS/);
  assert.match(verify, /name: 'XL 프로브'[\s\S]*minContainer: 1280[\s\S]*maxContainer: 1440/);
  assert.match(verify, /name: 'M 프로브'[\s\S]*minContainer: 720[\s\S]*maxContainer: 959/);
  assert.match(verify, /breakpoint_probes/);
  assert.match(verify, /function assertBreakpointContract/);
  assert.match(verify, /expectedFolded/);
  assert.match(verify, /primary_rect/);
  assert.match(verify, /rail_rect/);
  assert.match(verify, /kpi_max_columns/);
  assert.match(verify, /vertical_overflow_nodes/);
  assert.match(verify, /vertical_overlap_nodes/);
});

test('실보드 검증의 선택 필터는 빈 집합과 중복 보드를 거부한다', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'verify-integrated-cards.js'), 'utf8');
  assert.match(verify, /if \(!REAL_BOARDS\.length\)/);
  assert.match(verify, /new Set\(REAL_BOARDS\)\.size !== REAL_BOARDS\.length/);
  assert.match(verify, /ATHENA_VERIFY_BOARD_IDS contains unknown board/);
});
