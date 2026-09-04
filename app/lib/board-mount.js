// IIFE 스코프 격리 — board-format.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

const isCjs = typeof module !== 'undefined' && !!module.exports;
const lib = (typeof window !== 'undefined' && window.AthenaLib) || {};
const boardFormat = isCjs ? require('./board-format') : lib.BoardFormat;
const registry = isCjs ? require('./board-template-registry') : lib.BoardTemplateRegistry;

const ROLLUP_MARK = '▸';

function slotList(contract) {
  return Array.isArray(contract && contract.slots) ? contract.slots : [];
}

// 값 슬롯 판정은 포맷터와 같은 어휘를 써야 한다 — 추출기는 `format.unit`을,
// 손으로 쓴 계약은 `format.kind`를 싣는다. 여기서만 kind를 직접 읽으면 실추출
// 보드의 금액·수량 슬롯이 전부 text로 보여 H1 영값 묶음이 조용히 꺼진다.
function isValueSlot(slot) {
  const kind = boardFormat.kindOf(slot.format || {});
  return kind === 'number' || kind === 'korean' || kind === 'percent';
}

// 앵커 이름. 추출기(scripts/paper_board_extract.py)는 Paper 노드 id를 `node_id`로
// 싣는다. 픽스처처럼 의미 있는 이름을 쓰는 계약은 `node`를 쓴다.
function anchorOf(slot) {
  return slot.node_id || slot.node || slot.slot_id;
}

// 라벨은 데이터가 아니라 디자인 문구다 — 값이 안 실려도 `미제공`으로 지우지 않고
// Paper 원문을 그대로 둔다. 값 슬롯은 반대로 값이 없으면 결측어를 쓴다(신념 5).
function staticTextOf(slot) {
  return slot.kind === 'label' && typeof slot.paper_text === 'string' ? slot.paper_text : null;
}

// H1 영값 묶음(헌장 §3.1) — 그룹 안 0·결측 항목이 3개 이상일 때만 접는다.
// 값이 있는 항목은 접지 않는다("값이 생기면 그 항목만 자동으로 행으로 올라온다").
function collapsePlan(contract, values) {
  const groups = new Map();
  for (const slot of slotList(contract)) {
    const group = slot.collapse_group;
    if (!group || !group.group_id) continue;
    if (!groups.has(group.group_id)) {
      groups.set(group.group_id, {
        groupId: group.group_id,
        rollupSlot: group.rollup_slot || null,
        zeroLabel: group.zero_label || '0원',
        items: new Map(),
      });
    }
    const entry = groups.get(group.group_id);
    const itemId = group.item || slot.slot_id;
    if (!entry.items.has(itemId)) entry.items.set(itemId, { itemId, label: null, zero: false, checked: false });
    const item = entry.items.get(itemId);
    if (group.label) item.label = group.label;
    if (isValueSlot(slot)) {
      item.checked = true;
      item.zero = boardFormat.isZeroLike(slot.format, values ? values[slot.slot_id] : undefined);
    }
  }

  const plans = [];
  for (const entry of groups.values()) {
    const items = [...entry.items.values()];
    const zeroItems = items.filter((item) => item.checked && item.zero);
    const collapsed = zeroItems.length >= boardFormat.ZERO_COLLAPSE_MIN;
    const labels = zeroItems.map((item) => item.label).filter(Boolean);
    plans.push({
      groupId: entry.groupId,
      rollupSlot: entry.rollupSlot,
      collapsed,
      hiddenItems: collapsed ? zeroItems.map((item) => item.itemId) : [],
      rollupText: collapsed
        ? `${labels.join('·')} — ${entry.zeroLabel} ${zeroItems.length}항목 ${ROLLUP_MARK}`
        : null,
    });
  }
  return plans;
}

// 순수 계획 — DOM 없이 검증 가능한 층. 텍스트·색·접힘 결정을 전부 여기서 내린다.
function mountPlan(contract, values) {
  const slots = slotList(contract);
  const collapse = collapsePlan(contract, values);
  const rollupText = new Map();
  for (const group of collapse) {
    if (group.rollupSlot && group.rollupText) rollupText.set(group.rollupSlot, group.rollupText);
  }

  const assignments = [];
  const missing = [];
  for (const slot of slots) {
    const node = anchorOf(slot);
    const override = rollupText.get(slot.slot_id);
    const bound = values ? values[slot.slot_id] : undefined;
    const staticText = bound === undefined || bound === null ? staticTextOf(slot) : null;
    const formatted = override
      ? { text: override, tone: null, missing: false }
      : (staticText !== null
        ? { text: staticText, tone: null, missing: false }
        : boardFormat.formatSlot(slot.format, bound));
    assignments.push({
      slotId: slot.slot_id,
      node,
      text: formatted.text,
      tone: formatted.tone,
      missing: formatted.missing,
      valueAtomic: slot.static !== true && slot.kind !== 'label'
        && slot.kind !== 'static' && isValueSlot(slot),
      pairedWith: slot.paired_with || null,
      expandedBoard: slot.expanded_board || null,
    });
    if (formatted.missing) missing.push(slot.slot_id);
  }
  return { assignments, collapse, missing };
}

// 병기(D4) — 주값과 보조값은 같은 프레임에서 함께 갱신된다. 계획 단계에서 이미
// 두 슬롯 모두 assignment를 가지므로 여기서는 짝만 돌려준다(호출부 검증용).
function pairedGroups(plan) {
  const byPrimary = new Map();
  for (const assignment of plan.assignments) {
    if (!assignment.pairedWith) continue;
    if (!byPrimary.has(assignment.pairedWith)) byPrimary.set(assignment.pairedWith, []);
    byPrimary.get(assignment.pairedWith).push(assignment.slotId);
  }
  return byPrimary;
}

function isLeafAnchor(el) {
  if (!el) return false;
  return el.dataset ? el.dataset.leaf !== undefined : el.getAttribute('data-leaf') !== null;
}

function nodeIndex(root) {
  const index = new Map();
  for (const el of root.querySelectorAll('[data-node]')) {
    const key = el.dataset ? el.dataset.node : el.getAttribute('data-node');
    if (!key) continue;
    // 추출기는 값 자리를 `<span data-node data-leaf>`로 감싸면서 바깥 원문 노드의
    // data-node를 그대로 둔다(영역·병기 묶음이 그 id를 쓴다). 같은 id가 둘이면
    // 문서 순서상 바깥이 먼저 잡히는데, 거기에 값을 쓰면 병기 줄까지 지워지므로
    // 마운트는 건너뛴다 — 값이 영영 안 나온다. 앵커는 늘 잎이다(추출기 계약).
    if (!index.has(key)) index.set(key, el);
    else if (isLeafAnchor(el) && !isLeafAnchor(index.get(key))) index.set(key, el);
  }
  return index;
}

// 인라인 display 원문을 지우지 않고 되돌릴 수 있게 보관한다(Paper 원문 보존).
function setHidden(el, hidden) {
  if (!el) return;
  if (el.__bsDisplay === undefined) el.__bsDisplay = el.style.display;
  el.style.display = hidden ? 'none' : el.__bsDisplay;
  el.hidden = hidden;
}

function setTone(el, tone) {
  const color = boardFormat.toneColorVar(tone);
  const hasOriginal = Object.prototype.hasOwnProperty.call(el, '__bsColor');
  if (!color && !hasOriginal) return;
  if (!hasOriginal) el.__bsColor = el.style.color || '';
  if (color || el.__bsColor) el.style.color = color || el.__bsColor;
  else if (typeof el.style.removeProperty === 'function') el.style.removeProperty('color');
  else delete el.style.color;
}

function pairedMirrorIndex(root) {
  const index = new Map();
  for (const mirror of root.querySelectorAll('[data-paired-source]')) {
    const source = mirror.dataset
      ? mirror.dataset.pairedSource : mirror.getAttribute('data-paired-source');
    if (!source) continue;
    if (!index.has(source)) index.set(source, []);
    index.get(source).push(mirror);
  }
  return index;
}

function syncPairedMirrors(source, mirrors) {
  for (const mirror of mirrors || []) {
    mirror.textContent = source.textContent;
    const color = source.style.color;
    if (color) mirror.style.color = color;
    else if (typeof mirror.style.removeProperty === 'function') mirror.style.removeProperty('color');
    else delete mirror.style.color;
    if (!mirror.dataset || !source.dataset) continue;
    if (source.dataset.missing !== undefined) mirror.dataset.missing = source.dataset.missing;
    else delete mirror.dataset.missing;
  }
}

// 자식 목록을 브라우저 DOM(HTMLCollection)과 테스트 스텁(배열) 양쪽에서 같은 모양으로
// 읽는다. 스텁은 텍스트도 children에 담으므로 여기서 걸러낸다.
function elementChildren(el) {
  if (Array.isArray(el.children)) return el.children.filter((child) => child && child.tag !== '#text');
  if (el.children && typeof el.children.length === 'number') return Array.from(el.children);
  return null;
}

function isLineBreak(child) {
  const tag = child && (child.tagName || child.tag);
  return typeof tag === 'string' && tag.toLowerCase() === 'br';
}

// 요소 자식 수. 추출기는 Paper 노드 id를 모든 노드에 남기므로 앵커가 컨테이너일 수
// 있다 — textContent를 쓰면 자식(병기 span 포함)을 통째로 날린다. 그래서 잎에만 쓴다.
// 잎(data-leaf) 안의 <br>만 예외로 세지 않는다. 글자를 나르지 않는 줄바꿈이고, 같은
// 자리를 paper_text가 "\n"으로 싣는다(부모가 white-space: pre-wrap — 실측 두 곳,
// 1JPU-0/1JT0-0·1JZW-0/3PQA-0). 자식으로 세면 그 슬롯이 통째로 마운트에서 빠진다.
function elementChildCount(el) {
  if (!el) return 0;
  const children = elementChildren(el);
  if (!children) return typeof el.childElementCount === 'number' ? el.childElementCount : 0;
  return isLeafAnchor(el) ? children.filter((child) => !isLineBreak(child)).length : children.length;
}

function hasTextContent(el) {
  return typeof el.textContent === 'string' && el.textContent.trim() !== '';
}

// DOM 쓰기 층 — 텍스트 노드만 건드린다. 구조·인라인 스타일 원문은 손대지 않는다(D1).
function applyPlan(root, plan, options = {}) {
  const index = nodeIndex(root);
  const mirrors = pairedMirrorIndex(root);
  const unbound = [];
  const containers = [];
  for (const assignment of plan.assignments) {
    const el = index.get(assignment.node);
    if (!el) { unbound.push(assignment.slotId); continue; }
    if (elementChildCount(el) > 0) { containers.push(assignment.slotId); continue; }
    el.textContent = assignment.text;
    setTone(el, assignment.tone);
    if (el.dataset) {
      el.dataset.slotId = assignment.slotId;
      if (assignment.valueAtomic) el.dataset.bsValueAtomic = 'true';
      else delete el.dataset.bsValueAtomic;
      if (assignment.missing) el.dataset.missing = 'true';
      else delete el.dataset.missing;
    }
    syncPairedMirrors(el, mirrors.get(assignment.node));
  }

  for (const group of plan.collapse) {
    const hidden = new Set(group.hiddenItems);
    for (const row of root.querySelectorAll(`[data-collapse-member="${group.groupId}"]`)) {
      const itemId = row.dataset ? row.dataset.collapseItem : row.getAttribute('data-collapse-item');
      setHidden(row, hidden.has(itemId));
    }
    for (const rollup of root.querySelectorAll(`[data-collapse-rollup="${group.groupId}"]`)) {
      setHidden(rollup, !group.collapsed);
      if (rollup.__bsExpandWired) continue;
      const boardId = rollup.dataset ? rollup.dataset.expandBoard : rollup.getAttribute('data-expand-board');
      if (typeof options.onExpand === 'function') {
        rollup.__bsExpandWired = true;
        rollup.addEventListener('click', () => options.onExpand(boardId, { groupId: group.groupId, root }));
      }
    }
  }

  // 계약이 모르는 채로 화면에 글자를 내는 노드만 잉여로 센다. 컨테이너 앵커는
  // 그 자체로 글자를 내지 않으므로(자식이 낸다) 잉여가 아니다.
  // 부분 갱신(실시간 프레임)은 계획에 슬롯 몇 개만 들어 있어 이 셈이 뜻을 잃는다.
  if (options.partial) return { unbound, unmapped: [], containers };
  const claimed = new Set(plan.assignments.map((assignment) => assignment.node));
  const unmapped = [];
  for (const [key, el] of index) {
    if (claimed.has(key)) continue;
    if (elementChildCount(el) === 0 && hasTextContent(el)) unmapped.push(key);
  }
  return { unbound, unmapped, containers };
}

// ---------- 실시간 슬롯 이음매 (봉투 계약 ↔ 보드 잎) ----------
//
// 실시간 프레임은 `binding_id`만 들고 온다(원시 FID·별칭은 신뢰 경계 밖으로 안 나온다).
// 봉투는 두 표를 함께 싣는다: `realtime_bindings`가 binding_id ↔ observation_id를,
// `surface_contract.slot_values`가 slot_id ↔ observation_id를(백엔드
// card_surface_contract.observation_id_for가 두 쪽의 단일 출처). 같은 관찰을
// 가리킬 때만 잇는다 — 추측으로 잇는 경로는 없다.
const OBSERVATION_ID = /^obs_[a-f0-9]{12,64}$/i;
const REALTIME_BINDING_ID = /^rtb_[a-f0-9]{12,64}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// slot_values는 {slot_id: value} 맵으로도, 목록으로도 온다. 이음매는 목록 형태에만
// 있다(관찰 식별자가 항목에 붙는다) — 맵 형태면 빈 표를 돌려 실시간이 조용히 꺼진다.
function slotValueEntries(surfaceContract) {
  const raw = surfaceContract && (surfaceContract.slot_values || surfaceContract.slotValues);
  return Array.isArray(raw) ? raw : [];
}

function realtimeSlotIndex(surfaceContract, realtimeBindings) {
  const slotsByObservation = new Map();
  for (const entry of slotValueEntries(surfaceContract)) {
    const slotId = text(entry && entry.slot_id);
    const observationId = text(entry && (entry.observation_id || entry.observationId));
    if (!slotId || !OBSERVATION_ID.test(observationId)) continue;
    if (!slotsByObservation.has(observationId)) slotsByObservation.set(observationId, []);
    const bucket = slotsByObservation.get(observationId);
    if (!bucket.includes(slotId)) bucket.push(slotId);
  }
  const index = new Map();
  for (const raw of Array.isArray(realtimeBindings) ? realtimeBindings : []) {
    const bindingId = text(raw && (raw.binding_id || raw.bindingId));
    const observationId = text(raw && (raw.observation_id || raw.observationId));
    if (!REALTIME_BINDING_ID.test(bindingId) || !OBSERVATION_ID.test(observationId)) continue;
    const slotIds = slotsByObservation.get(observationId);
    if (!slotIds) continue;
    if (!index.has(bindingId)) index.set(bindingId, []);
    const bucket = index.get(bindingId);
    for (const slotId of slotIds) if (!bucket.includes(slotId)) bucket.push(slotId);
  }
  return index;
}

// 프레임 하나가 건드리는 슬롯 집합. 병기(D4) 짝은 같은 프레임에서 함께 칠한다 —
// 주값만 새 값이고 병기가 이전 프레임 값이면 화면에 섞인 한 순간이 남는다.
function pairedClosure(contract, slotIds) {
  const targets = new Set(slotIds);
  const slots = slotList(contract);
  let grew = true;
  while (grew) {
    grew = false;
    for (const slot of slots) {
      if (!slot.paired_with) continue;
      if (targets.has(slot.paired_with) && !targets.has(slot.slot_id)) {
        targets.add(slot.slot_id);
        grew = true;
      }
      if (targets.has(slot.slot_id) && !targets.has(slot.paired_with)) {
        targets.add(slot.paired_with);
        grew = true;
      }
    }
  }
  return targets;
}

// 부분 계획 — 텍스트는 건드린 슬롯(과 그 병기 짝)만, 접힘은 보드 전체로 다시 센다.
// H1 영값 묶음은 "값이 생기면 그 항목만 행으로 올라온다"라서 갱신된 값 하나가
// 묶음 전체의 접힘 여부를 바꿀 수 있다.
function realtimePlan(contract, values, slotIds) {
  const targets = pairedClosure(contract, slotIds);
  const full = mountPlan(contract, values);
  return {
    ...full,
    assignments: full.assignments.filter((assignment) => targets.has(assignment.slotId)),
    touched: [...targets],
  };
}

// 실시간 프레임 적용. 마운트와 **같은** 포맷터·같은 쓰기 규칙을 쓴다(같은 값이
// 두 경로에서 다르게 보이면 안 된다). 값 표는 호출부가 갖고 있고 여기서 고치지
// 않는다 — 상태 보드 전환·재마운트가 그 표를 그대로 다시 쓴다.
function applyRealtimeSlots(surface, contract, values, slotIds, options = {}) {
  if (!surface || !slotIds || !slotIds.length) return { touched: [], plan: null };
  const plan = realtimePlan(contract, values, slotIds);
  const report = applyPlan(surface, plan, { ...options, partial: true });
  return { touched: plan.touched, plan, ...report };
}

// 상태 보드 링크의 pointer/keyboard 경로를 한 콜백으로 묶는다. 실제 button이나
// 기존 tab/button role은 브라우저·소유 위젯의 키보드 동작을 그대로 써야 하므로
// 추가 keydown을 달지 않는다. Paper에서 온 plain text leaf만 명시적으로 요청받았을
// 때 button 의미를 보강한다.
function stateLinksFromMarks(stateControls) {
  const marks = stateControls && Array.isArray(stateControls.marks)
    ? stateControls.marks : [];
  const links = [];
  for (const mark of marks) {
    const control = String((mark && mark.control) || '').trim();
    if (!control || !Array.isArray(mark.boards)) continue;
    for (const board of mark.boards) {
      const boardId = String(board || '').trim();
      if (boardId) links.push({ control, board_id: boardId });
    }
  }
  return links;
}

function stateControlActivationOwner(node) {
  if (!node || typeof node.closest !== 'function') return node || null;
  return node.closest('button, [role="button"], [role="tab"]') || node;
}

function wireStateControlActivation(node, activate, options = {}) {
  if (!node || typeof node.addEventListener !== 'function' || typeof activate !== 'function') return false;
  if (node.__athenaStateWired) return false;

  const tagName = String(node.tagName || '').toLowerCase();
  const role = typeof node.getAttribute === 'function'
    ? String(node.getAttribute('role') || '').toLowerCase()
    : '';
  const nativeSemantics = tagName === 'button' || role === 'button' || role === 'tab';
  if (options.keyboard && !nativeSemantics && !role && typeof node.setAttribute === 'function') {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('keydown', (event) => {
      if (!event || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      activate();
    });
  }
  node.addEventListener('click', () => activate());
  node.__athenaStateWired = true;
  return true;
}

// ---------- 반응형 훅 (인라인 원문 ↔ 컨테이너 쿼리) ----------
//
// 추출 원문은 영역 노드마다 인라인 `width`/`flex-*`를 갖는다(실측: 27장 전부).
// 인라인 선언은 어떤 CSS 규칙보다 세므로, 이걸 그대로 두면 컨테이너 쿼리가
// 레일 폭 하나 못 바꾼다. `!important`로 이기는 대신(계획 §3 금지) **딱 다섯 속성만**
// 같은 요소의 커스텀 속성으로 옮긴다. XL base 규칙이 그 값을 그대로 되돌려
// 계산값이 Paper와 같고, L 이하 컨테이너 규칙만 자유롭게 덮어쓴다.
// 색·패딩·글꼴·테두리·display는 손대지 않는다 — Paper의 레이아웃 모델은 그대로다.
// bs-kpi-cell은 영역이 아니라 영역 안에서 반복되는 칸이다. 칸마다 인라인 `width`가
// 박혀 있어(추출 원문 실측 138px) 그대로 두면 M 이하에서 3칸/2칸/1칸 흐름이 안 된다.
const RESPONSIVE_REGIONS = Object.freeze([
  'bs-workspace', 'bs-primary', 'bs-rail', 'bs-kpi', 'bs-kpi-cell', 'bs-table', 'bs-strip',
]);
// `height`도 함께 걷어낸다. 폭이 줄면 글자가 줄바꿈으로 내려가는데(한국어 원문은
// `overflow-wrap: anywhere`), Paper 원문은 영역마다 인라인 고정 높이를 싣는다
// (실측 2SKU-1 헤더 106px · KPI 줄 116px, 그리고 표 행마다). 폭만 걷어내면 좁은
// 창에서 늘어난 내용이 고정 높이 상자를 뚫고 나와 아래 영역과 **겹쳐** 읽힌다.
// 되돌리기 규칙이 XL에서 같은 값을 돌려주고, L 이하에서만 최소 높이로 바뀐다.
const HOISTED_PROPERTIES = Object.freeze([
  ['width', '--bs-width'],
  ['height', '--bs-height'],
  ['flex-basis', '--bs-flex-basis'],
  ['flex-grow', '--bs-flex-grow'],
  ['flex-shrink', '--bs-flex-shrink'],
]);

function markElasticKpiValue(el) {
  if (!el || !el.dataset || !el.style) return;
  const classes = String(el.className || '').split(/\s+/);
  if (!classes.includes('bs-kpi-cell')) return;
  if (el.style.getPropertyValue('flex-basis').trim() !== '0%') return;
  if (el.style.getPropertyValue('flex-grow').trim() !== '1') return;
  // 시세 스트립의 빈 spacer도 같은 flex 값을 쓴다. 그 칸에 최소 폭을 주면
  // 6~8칸 보드가 L 컨테이너보다 넓어지므로 실제 값이 있는 탄력 칸만 표시한다.
  if (!String(el.textContent || '').trim()) return;
  el.dataset.bsKpiElastic = 'true';
}

function markInsetAbsoluteBox(el) {
  if (!el || !el.dataset || !el.style) return;
  if (el.dataset.name !== 'Chart Context Actions') return;
  if (el.style.getPropertyValue('position').trim() !== 'absolute') return;
  const left = el.style.getPropertyValue('left').trim();
  if (!left || !el.style.getPropertyValue('width').trim()) return;
  if (el.style.getPropertyValue('right').trim()) return;
  // Paper의 하단 액션처럼 left+고정폭인 absolute 상자는 좁은 단계에서만 같은
  // inset을 right에도 써야 부모 패딩 상자 안으로 줄어든다. XL의 left/width는 보존한다.
  el.style.setProperty('--bs-inset-x', left);
  el.dataset.bsInsetX = 'true';
}

function hoistLayout(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return false;
  if (el.dataset && el.dataset.bsHoisted === 'true') return false;
  markElasticKpiValue(el);
  markInsetAbsoluteBox(el);
  for (const [property, token] of HOISTED_PROPERTIES) {
    const value = el.style.getPropertyValue(property);
    if (!value) continue;
    el.style.setProperty(token, value);
    el.style.removeProperty(property);
  }
  if (el.dataset) el.dataset.bsHoisted = 'true';
  return true;
}

// 영역 밖 고정 상자 — 표 열 폭·KPI 칸·헤더 블록. 실보드 6장 실측(px 폭 노드
// 2SKU-1 75 · 2R3M-1 106 · 13BC-2 116 · 2QFO-2 155 · 13K0-2 91 · 135M-2 16)에서
// 영역 노드는 2~7개뿐이고 나머지는 전부 class 없는 안쪽 상자다. 게다가 그 상자들은
// 인라인 `flex-shrink: 0`을 함께 싣는다(보드당 23~178건) — 영역만 걷어내면 안쪽
// 고정 폭이 그대로 버텨 컨테이너가 줄어도 열이 안 줄고 가로 넘침이 남는다
// (실측 overflow_x: 컨테이너 1171px에서 89~5,659px).
//
// 그래서 인라인 선언을 **실제로 들고 있는** 노드만 추가로 걷어낸다. 아무것도 안
// 옮긴 노드에는 표시를 남기지 않는다 — 표시가 곧 되돌리기 규칙의 적용 범위다
// (board-surface.css `[data-bs-hoisted]`가 다섯 속성을 그대로 되돌린다).
function hoistRigidBox(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return false;
  if (el.dataset && el.dataset.bsHoisted === 'true') return false;
  markInsetAbsoluteBox(el);
  let moved = false;
  for (const [property, token] of HOISTED_PROPERTIES) {
    const value = el.style.getPropertyValue(property);
    if (!value) continue;
    el.style.setProperty(token, value);
    el.style.removeProperty(property);
    moved = true;
  }
  if (moved && el.dataset) el.dataset.bsHoisted = 'true';
  return moved;
}

function applyResponsiveHooks(surface) {
  hoistLayout(surface);
  let hoisted = 1;
  for (const region of RESPONSIVE_REGIONS) {
    for (const el of surface.querySelectorAll(`.${region}`)) {
      if (hoistLayout(el)) hoisted += 1;
    }
  }
  // 표면 전체를 훑는다. `data-node`만 보면 손으로 쓴 계약의 구조 노드(픽스처
  // board.html의 `.bs-header` 등)를 놓친다 — 거기에도 고정 폭이 산다.
  // 인라인 선언이 없는 노드는 hoistRigidBox가 그대로 지나간다.
  for (const el of surface.querySelectorAll('*')) {
    if (hoistRigidBox(el)) hoisted += 1;
  }
  return hoisted;
}

// Paper 레이어 이름(data-name)에 박힌 원시 식별자 앵커를 걷어낸다. 카드 커버리지
// 증명 규약(`raw · <mapping_id> · <json path>`, PAPER_CARD_COVERAGE.md)이 추출 HTML에
// 그대로 남아 제품 DOM으로 흘러든다(2026-09-04 gold-market 실측:
// data-name="raw · base:ka50081 · $.gds_day_chart_qry[].acc_trde_prica" — 97장 중 20장,
// 157개). 런타임은 data-name을 markInsetAbsoluteBox의 'Chart Context Actions' 비교에만
// 쓰고 슬롯은 data-node로 찾으므로, 식별자 모양의 값만 지운다. 다른 레이어 이름
// (Rectangle·행·Instrument Header…)은 verify-integrated-cards 진단 리포트가 읽으므로 둔다.
// 패턴은 verify-semantic-workspaces의 원시 식별자 게이트와 같은 축이다.
const RAW_IDENTITY_NAME = /(?:\b(?:raw|alias|FID|REST)\b|(?:base|detail):[a-z0-9]|\bka\d{5}\b|\$\.|mapping[ _-]?id|operation[ _-]?ref)/i;

function scrubRawIdentityNames(surface) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return 0;
  let scrubbed = 0;
  for (const el of [surface, ...surface.querySelectorAll('*')]) {
    const name = el && el.dataset ? el.dataset.name : undefined;
    if (typeof name !== 'string' || !RAW_IDENTITY_NAME.test(name)) continue;
    if (typeof el.removeAttribute === 'function') el.removeAttribute('data-name');
    delete el.dataset.name;
    scrubbed += 1;
  }
  return scrubbed;
}

// 추출기가 보드 루트에 .board-surface를 붙이지 않은 경우 첫 요소를 표면으로 삼는다.
// 컨테이너 쿼리의 기준점이 없으면 반응형이 통째로 죽는다.
function surfaceRoot(root) {
  const marked = root.querySelector('.board-surface');
  if (marked) return marked;
  const first = root.firstElementChild
    || (Array.isArray(root.children) ? root.children.find((child) => child.tag !== '#text') : null);
  if (first && first.classList && typeof first.classList.add === 'function') first.classList.add('board-surface');
  else if (first) first.className = `${first.className || ''} board-surface`.trim();
  return first || null;
}

// 보드 1장을 root 안에 세운다. <template>은 registry가 보드당 1회만 파싱하고
// 여기서는 cloneNode만 한다 — 같은 보드를 다시 마운트하면 텍스트만 갈아끼운다.
function mountBoard(root, boardId, values, options = {}) {
  const doc = options.doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !doc) return null;
  // 마운트 계약은 정적이라 색인이 갖고 있다(값만 봉투가 나른다). 호출부가
  // 명시로 넘기면 그쪽을 쓴다 — 상태 보드 전환·테스트가 그 경로를 쓴다.
  const contract = options.contract || registry.contractFor(boardId);
  if (!contract || !Array.isArray(contract.slots)) throw new Error(`보드 슬롯 계약이 없다 — ${boardId}`);
  const template = registry.templateFor(boardId, doc);
  if (!template) throw new Error(`보드 템플릿이 없다 — ${boardId}`);

  const plan = mountPlan(contract, values);
  let surface = root.__bsSurface;
  if (!surface || root.__bsBoardId !== String(boardId) || !root.contains(surface)) {
    root.replaceChildren(template.content.cloneNode(true));
    surface = surfaceRoot(root);
    if (!surface) throw new Error(`board.html에 보드 루트가 없다 — ${boardId}`);
    applyResponsiveHooks(surface);
    scrubRawIdentityNames(surface);
    root.__bsSurface = surface;
    root.__bsBoardId = String(boardId);
  }
  const report = applyPlan(surface, plan, options);
  return { surface, plan, ...report };
}

// 청크를 먼저 실은 뒤 마운트한다. 셸은 색인(수 KB)만 동기로 싣고 원문 HTML은
// 카드 청크에 있으므로, 그 카드의 첫 보드는 여기서 한 번 기다린다. 값만 바뀌는
// 재마운트·상태 보드 교체는 이미 상주한 청크를 써서 같은 프레임에서 끝난다.
function mountBoardAsync(root, boardId, values, options = {}) {
  if (registry.isLoaded(boardId)) {
    try {
      return Promise.resolve(mountBoard(root, boardId, values, options));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return registry.loadBoard(boardId).then(() => mountBoard(root, boardId, values, options));
}

const __exports = {
  ROLLUP_MARK, RESPONSIVE_REGIONS, HOISTED_PROPERTIES,
  isValueSlot, anchorOf, staticTextOf, collapsePlan, mountPlan, pairedGroups,
  nodeIndex, elementChildCount, setHidden, applyPlan,
  hoistLayout, hoistRigidBox, applyResponsiveHooks, surfaceRoot, mountBoard, mountBoardAsync,
  RAW_IDENTITY_NAME, scrubRawIdentityNames,
  slotValueEntries, realtimeSlotIndex, pairedClosure, realtimePlan, applyRealtimeSlots,
  stateLinksFromMarks, stateControlActivationOwner, wireStateControlActivation,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardMount = __exports;
}

})();
