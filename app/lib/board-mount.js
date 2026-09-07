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

// 병기 사본(`.bs-paired`)은 접힌 열이 내려앉을 자리라 원본과 같은 Paper 노드 id를
// 이고 있고, 문서 순서상 원본보다 먼저 나올 수 있다(1JPU-0/`1JT3-0` 실측 — 머리
// 사본이 표 머리 원본보다 위에 있다). 사본에 값을 쓰면 원본은 board.html 원문 그대로
// 남아 Paper 문면과 어긋난다.
function isPairedCopy(el) {
  const className = el.className
    || (typeof el.getAttribute === 'function' ? el.getAttribute('class') : '') || '';
  return String(className).split(/\s+/).includes('bs-paired');
}

// 앵커 우선순위 — 원본이 사본을 이기고, 같은 자리면 잎이 컨테이너를 이긴다.
function anchorRank(el) {
  return (isPairedCopy(el) ? 0 : 2) + (isLeafAnchor(el) ? 1 : 0);
}

function nodeIndex(root) {
  const index = new Map();
  for (const el of root.querySelectorAll('[data-node]')) {
    const key = el.dataset ? el.dataset.node : el.getAttribute('data-node');
    if (!key) continue;
    // 추출기는 값 자리를 `<span data-node data-leaf>`로 감싸면서 바깥 원문 노드의
    // data-node를 그대로 둔다(영역·병기 묶음이 그 id를 쓴다). 같은 id가 둘이면
    // 문서 순서상 바깥이 먼저 잡히는데, 거기에 값을 쓰면 병기 줄까지 지워지므로
    // 마운트는 건너뛴다 — 값이 영영 안 나온다.
    const current = index.get(key);
    if (!current || anchorRank(el) > anchorRank(current)) index.set(key, el);
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
  const add = (key, mirror) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(mirror);
  };
  for (const mirror of root.querySelectorAll('[data-paired-source]')) {
    add(mirror.dataset
      ? mirror.dataset.pairedSource : mirror.getAttribute('data-paired-source'), mirror);
  }
  // 구형 사본 — paired-table이 아닌 표에서는 추출기가 접힌 열의 사본을
  // `<span class="bs-paired" data-paired-col data-node="<원본 id>">`로 만든다
  // (data-paired-source가 없다). 앵커는 원본 쪽이라 값 쓰기가 사본까지 가지 않는데,
  // 좁은 단계(S/XS)에서 원본 열은 접히고 화면에 서는 쪽은 이 사본이다 — 함께 칠하지
  // 않으면 실데이터가 실린 뒤에도 추출 당시 Paper 목업 숫자가 그대로 남는다.
  for (const mirror of root.querySelectorAll('.bs-paired')) {
    if (mirror.dataset && mirror.dataset.pairedSource !== undefined) continue;
    add(mirror.dataset ? mirror.dataset.node : mirror.getAttribute('data-node'), mirror);
  }
  return index;
}

function syncPairedMirrors(source, mirrors) {
  for (const mirror of mirrors || []) {
    // 원본이 없어 사본이 앵커로 뽑힌 자리는 이미 값이 실렸다.
    if (mirror === source) continue;
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
// <br>만 예외로 세지 않는다. 글자를 나르지 않는 줄바꿈이고, 같은 자리를 paper_text가
// "\n"으로 싣는다(부모가 white-space: pre-wrap — 실측 네 곳, 1JPU-0/1JT0-0·1JT3-0·
// 1JZW-0/3PQA-0·3PQ7-0). 추출기는 병기 사본이 붙은 잎만 <span data-leaf>로 감싸므로
// 사본이 없는 두 줄 머리글은 잎 표시 없이 <br>를 직계로 이고 있다 — 자식으로 세면
// 그 슬롯이 마운트에서 빠지고 머리글이 Paper 문면과 어긋난 두 조각으로 남는다.
function elementChildCount(el) {
  if (!el) return 0;
  const children = elementChildren(el);
  if (!children) return typeof el.childElementCount === 'number' ? el.childElementCount : 0;
  return children.filter((child) => !isLineBreak(child)).length;
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

function observationIdsOfSlotEntry(entry) {
  const ids = [];
  const direct = text(entry && (entry.observation_id || entry.observationId));
  if (OBSERVATION_ID.test(direct)) ids.push(direct);
  const composite = boardFormat.compositeSpecOf(entry && entry.value);
  for (const part of (composite && Array.isArray(composite.parts)) ? composite.parts : []) {
    const observationId = text(part && (part.observation_id || part.observationId));
    if (OBSERVATION_ID.test(observationId) && !ids.includes(observationId)) ids.push(observationId);
  }
  return ids;
}

function realtimeSlotIndex(surfaceContract, realtimeBindings) {
  const slotsByObservation = new Map();
  for (const entry of slotValueEntries(surfaceContract)) {
    const slotId = text(entry && entry.slot_id);
    if (!slotId) continue;
    for (const observationId of observationIdsOfSlotEntry(entry)) {
      if (!slotsByObservation.has(observationId)) slotsByObservation.set(observationId, []);
      const bucket = slotsByObservation.get(observationId);
      if (!bucket.includes(slotId)) bucket.push(slotId);
    }
  }
  const index = new Map();
  // 기존 호출부의 binding_id → [slot_id] Map 계약은 유지한다. composite 갱신만
  // 어느 part를 바꿀지 알아야 하므로 같은 색인에 binding의 관찰 식별자를 덧붙인다.
  index.observationByBinding = new Map();
  for (const raw of Array.isArray(realtimeBindings) ? realtimeBindings : []) {
    const bindingId = text(raw && (raw.binding_id || raw.bindingId));
    const observationId = text(raw && (raw.observation_id || raw.observationId));
    if (!REALTIME_BINDING_ID.test(bindingId) || !OBSERVATION_ID.test(observationId)) continue;
    index.observationByBinding.set(bindingId, observationId);
    const slotIds = slotsByObservation.get(observationId);
    if (!slotIds) continue;
    if (!index.has(bindingId)) index.set(bindingId, []);
    const bucket = index.get(bindingId);
    for (const slotId of slotIds) if (!bucket.includes(slotId)) bucket.push(slotId);
  }
  return index;
}

function updateRealtimeValue(current, observationId, nextValue) {
  const composite = boardFormat.compositeSpecOf(current);
  if (!composite) return { value: nextValue, updated: true };
  // composite 전체를 scalar tick으로 덮지 않는다. 정확히 같은 observation_id인
  // part만 바꾸고 나머지 값·포맷·구분자는 그대로 보존한다.
  if (!OBSERVATION_ID.test(text(observationId)) || !Array.isArray(composite.parts)) {
    return { value: current, updated: false };
  }
  let updated = false;
  const parts = composite.parts.map((part) => {
    const partObservation = text(part && (part.observation_id || part.observationId));
    if (partObservation !== observationId) return part;
    updated = true;
    return { ...part, value: nextValue };
  });
  return updated
    ? { value: { ...current, composite: { ...composite, parts } }, updated: true }
    : { value: current, updated: false };
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

// 레일 칩을 찾는 세 갈래. 추출 원문에서 칩은 그냥 텍스트 잎이라 표식이 없으면
// 문구로 찾을 수밖에 없다.
//
//   1) 표식      — `data-state-control`. 그 링크를 소유한 보드에만 찍힌다.
//   2) 같은 문구  — 스트립·내비 안에서 계약의 control과 정확히 같은 글자를 내는 잎.
//   3) 별칭 문구  — 같은 표식이 **다른 보드에서** 낸 문구(색인 CONTROL_LABELS).
//                  자식 보드의 레일은 부모 레일의 복제본인데 표식이 없어서,
//                  문구가 표식 이름과 다른 칩(「관심종목 시세 보드」 → 「관심」)은
//                  2)로는 절대 안 잡힌다 — 실측 44장 98링크가 그 상태였다.
//
// 3)은 두 겹으로 막는다: 그 문구를 내는 잎이 이 보드에 **하나**여야 하고, 다른 링크가
// 같은 문구를 노리지 않아야 한다. 엉뚱한 칩에 다른 보드를 매다는 것이 안 눌리는
// 것보다 나쁘다.
const STATE_CONTROL_SCOPES = '.bs-strip, nav, [role="tablist"]';

function stateControlScopeLeaves(surface) {
  const leaves = [];
  for (const scope of surface.querySelectorAll(STATE_CONTROL_SCOPES)) {
    for (const node of scope.querySelectorAll('*')) {
      if (node.childElementCount === 0) leaves.push(node);
    }
  }
  return leaves;
}

function labelsOf(control, options) {
  const source = options && typeof options.labelsFor === 'function'
    ? options.labelsFor
    : (registry && registry.controlLabels);
  return typeof source === 'function' ? source(control) || [] : [];
}

function findStateControlNode(surface, control, options = {}) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return null;
  const wanted = String(control || '').trim();
  if (!wanted) return null;
  for (const node of surface.querySelectorAll('[data-state-control]')) {
    if (node.dataset.stateControl === wanted) return stateControlActivationOwner(node);
  }
  const leaves = stateControlScopeLeaves(surface);
  const textOf = (node) => String(node.textContent || '').trim();
  const exact = leaves.find((node) => textOf(node) === wanted);
  if (exact) return stateControlActivationOwner(exact);
  const links = Array.isArray(options.links) ? options.links : [];
  for (const label of labelsOf(wanted, options)) {
    const matches = leaves.filter((node) => textOf(node) === label);
    if (matches.length !== 1) continue;
    // 같은 문구를 노리는 다른 링크가 있으면 어느 쪽인지 알 수 없다 — 건너뛴다.
    const rivals = links.filter((link) => {
      const rival = String((link && link.control) || '').trim();
      return rival && rival !== wanted && labelsOf(rival, options).includes(label);
    });
    if (rivals.length) continue;
    return stateControlActivationOwner(matches[0]);
  }
  return null;
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
  if (el.style.getPropertyValue('position').trim() !== 'absolute') return;
  const left = el.style.getPropertyValue('left').trim();
  if (!left || !el.style.getPropertyValue('width').trim()) return;
  if (el.style.getPropertyValue('right').trim()) return;
  // left+고정폭인 absolute 상자(Paper 하단 액션·차트 툴팁 라벨)는 부모가 좁아져도
  // 자기 left에 그대로 서서 부모 패딩 상자 밖으로 나간다 — 실측 137X-2 33FX-0
  // (left 748px · width 148px)이 2·4분할·최소에서 303~547px 가로 넘침의 유일한 뿌리다.
  // 다른 다섯 속성과 같은 방식으로 걷어낸다: 인라인 `left`를 지워야 컨테이너 규칙이
  // 겨룰 수 있고(인라인은 !important 없이 못 이긴다), base 규칙이 XL에서 같은 값을
  // 그대로 되돌려 Paper 자리는 안 바뀐다.
  el.style.setProperty('--bs-inset-x', left);
  el.style.removeProperty('left');
  el.dataset.bsInsetX = 'true';
}

// primary가 **세로로 쌓아 놓은** 줄인가. Paper는 필터·칩 줄을 primary 바로 아래에
// 두기도 하고(137X-2 Chart Toolbar) 세로 래퍼 한 겹을 끼우기도 한다(실측 30O1-0
// Quote Detail Mount > Frame > Mode Row). 둘은 같은 줄이므로 같은 규약을 받는다.
// 가로로 나뉜 칸 안(표 행의 셀 등)은 아니다: 위로 올라가다 세로 래퍼가 아닌 것을
// 만나면 멈추고, 표(열 폭이 계약이다)는 이름으로도 막는다.
function inPrimaryColumnStack(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!node.classList) return false;
    // primary가 스스로 표인 보드도 있다(실측 2SYW-1 Order Ledger `bs-primary bs-table`).
    // 그 경계에서 멈추는 것이 먼저다 — primary 직속 요약 줄은 표 행이 아니다.
    if (node.classList.contains('bs-primary')) return true;
    if (node.classList.contains('bs-table')) return false;
    if (!node.style) return false;
    if (node.style.getPropertyValue('flex-direction').trim() !== 'column') return false;
  }
  return false;
}

// primary가 이고 있는 줄 — Paper가 양끝으로 벌린(`space-between`) 가로 줄이다.
// 좁아지면 양쪽 묶음의 min-content 합이 그대로 가로 넘침이 된다: 표면 머리
// (.bs-header)가 M에서 접히는 것과 같은 이유이고, 실측 137X-2 Chart Toolbar가
// 최소 폭에서 149px을 냈다. 세로 줄(`flex-direction: column`)은 뺀다 — 세로 줄에
// flex-wrap을 주면 넘친 것이 오른쪽 새 열로 가서 오히려 가로 넘침이 된다.
function markSplitRow(el) {
  if (!el || !el.dataset || !el.style) return;
  if (el.style.getPropertyValue('display').trim() !== 'flex') return;
  if (el.style.getPropertyValue('justify-content').trim() !== 'space-between') return;
  if (el.style.getPropertyValue('flex-direction').trim() === 'column') return;
  if (!inPrimaryColumnStack(el)) return;
  el.dataset.bsSplitRow = 'true';
}

// 세로로 쌓는 부모 아래 놓인 상자. flex-shrink는 **주축** 속성이라 부모가 column이면
// 폭이 아니라 높이를 줄인다: 좁은 단계에서 원문의 `flex-shrink: 0`을 놓아주면
// (board-surface.css L 단계) 고정 높이가 바닥이라는 계약이 세로로만 뒤집혀, 늘어난
// 내용이 상자를 그대로 뚫는다(실측 1WOB-1 목록 본문 520px 안 행 20개: 내용 48px가
// 36px 행으로 눌려 13px 넘침). 부모가 세로면 원문 flex-shrink를 그대로 지킨다 —
// 폭은 `--bs-width`와 `max-width: 100%`가 맡으므로 가로 계약은 그대로다.
function markColumnStackItem(el) {
  if (!el || !el.dataset) return;
  const parent = el.parentElement;
  if (!parent || !parent.style) return;
  if (parent.style.getPropertyValue('display').trim() !== 'flex') return;
  if (parent.style.getPropertyValue('flex-direction').trim() !== 'column') return;
  el.dataset.bsColItem = 'true';
}

function hoistLayout(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return false;
  if (el.dataset && el.dataset.bsHoisted === 'true') return false;
  markElasticKpiValue(el);
  markInsetAbsoluteBox(el);
  markSplitRow(el);
  markColumnStackItem(el);
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
  markSplitRow(el);
  markColumnStackItem(el);
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

// 병기 줄이 앉는 칸 — 추출기는 접힌 열의 사본(`.bs-paired`)을 행의 **둘째 칸**에
// 넣는다(paper_board_extract.apply_column_collapse). 그 칸이 세로로 쌓는 칸이면
// 사본은 그대로 아랫줄이 되지만, 가로 칸이면 옆으로 늘어서서 칸을 밀어낸다
// (실측 2TZN-1 업종 행 둘째 칸 58px 안에 병기 4줄 — 최소 폭에서 표면 66px 넘침).
// 가로 칸만 표시해 두고, 좁은 단계에서 사본을 아랫줄로 내린다.
function markPairedHost(surface) {
  let marked = 0;
  for (const pair of surface.querySelectorAll('.bs-paired')) {
    const host = pair.parentElement;
    if (!host || !host.dataset || !host.style) continue;
    if (host.dataset.bsPairedHost === 'true') continue;
    if (host.style.getPropertyValue('display').trim() !== 'flex') continue;
    if (host.style.getPropertyValue('flex-direction').trim() === 'column') continue;
    host.dataset.bsPairedHost = 'true';
    marked += 1;
  }
  return marked;
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
  markPairedHost(surface);
  return hoisted;
}

// Paper 레이어 이름(data-name)에 박힌 원시 식별자 앵커를 걷어낸다. 카드 커버리지
// 증명 규약(`raw · <mapping_id> · <json path>`, PAPER_CARD_COVERAGE.md)이 추출 HTML에
// 그대로 남아 제품 DOM으로 흘러든다(2026-09-04 gold-market 실측:
// data-name="raw · base:ka50081 · $.gds_day_chart_qry[].acc_trde_prica" — 97장 중 20장,
// 157개). 런타임은 슬롯을 data-node로 찾고 data-name으로는 아무 판정도 하지 않으므로,
// 식별자 모양의 값만 지운다. 다른 레이어 이름
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

// 전문 렌더러가 앉을 자리 하나를 찾아 돌려준다. 계약이 `mount_slot`을 주면 그
// data-node를, 없거나 못 찾으면 표면의 `.bs-primary`로 떨어진다. 둘 다 없으면 null이다.
// 여기서 렌더러를 부르지는 않는다 — DOM 텍스트 층은 차트·호가에 의존하지 않는다(D1).
function primaryMountPoint(surface, contract) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return null;
  const slot = String((contract && contract.primary && contract.primary.mount_slot) || '');
  if (slot) {
    const [node] = surface.querySelectorAll(`[data-node="${slot}"]`);
    if (node) return node;
  }
  const [fallback] = surface.querySelectorAll('.bs-primary');
  return fallback || null;
}

// 앱 렌더러가 앉을 자리를 비운다 — Paper 목업 자식(툴바·프리뷰)을 지우지 않고
// 접는다(D1: 추출 원문 삭제 금지). 접은 목록을 돌려주므로 마운트가 실패하면
// 그대로 되돌릴 수 있다. 이미 접혀 있던 자식(병합·접기 계획이 접은 것)은 건드리지
// 않는다 — 되돌릴 때 그것까지 펴면 보드가 계획과 달라진다.
function collapsePrimaryMockup(mountPoint) {
  if (!mountPoint || !mountPoint.children) return [];
  const collapsed = [];
  for (const child of Array.from(mountPoint.children)) {
    if (child.hidden) continue;
    setHidden(child, true);
    collapsed.push(child);
  }
  return collapsed;
}

function restorePrimaryMockup(collapsed) {
  for (const child of collapsed || []) setHidden(child, false);
  return (collapsed || []).length;
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
  // 렌더러가 저작된 보드에서만 자리를 딸려 보낸다 — 그 자리에 앱 렌더러를 얹는 것은
  // 호출부(canvas) 몫이고, 여기는 자리를 찾아 주기만 한다.
  const primary = contract.primary && contract.primary.renderer
    ? {
      renderer: String(contract.primary.renderer),
      mountPoint: primaryMountPoint(surface, contract),
      propsFrom: contract.primary.props_from || [],
    }
    : null;
  return { surface, plan, primary, ...report };
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

// 같은 보드 자리에서 겹쳐 달리는 비동기 로드 중 마지막 요청만 DOM 소유권을 갖는다.
// 카드 닫기·상태 보드 전환 뒤에 먼저 시작한 hydrate가 늦게 끝나도 이전 보드를
// 되살리지 않도록 호출자에게 current 판정 함수를 건넨다.
function createLatestBoardLoad() {
  let revision = 0;
  let disposed = false;

  function invalidate() {
    revision += 1;
  }

  function dispose() {
    disposed = true;
    invalidate();
  }

  async function run(task, handlers = {}) {
    const ticket = ++revision;
    const isCurrent = () => !disposed && revision === ticket;
    if (typeof handlers.onLoading === 'function') handlers.onLoading();
    try {
      const value = await task(isCurrent);
      if (!isCurrent()) return { status: 'stale' };
      if (typeof handlers.onReady === 'function') handlers.onReady(value);
      return { status: 'ready', value };
    } catch (error) {
      if (!isCurrent()) return { status: 'stale' };
      const retry = () => run(task, handlers);
      if (typeof handlers.onError === 'function') handlers.onError(error, retry);
      return { status: 'error', error };
    }
  }

  return { run, invalidate, dispose };
}

function nextHydrationSlots(pending, filled, surfaceContract) {
  const authoritative = surfaceContract && surfaceContract.hydration_slot_ids;
  if (Array.isArray(authoritative)) return authoritative.slice();
  const values = filled && typeof filled === 'object' && !Array.isArray(filled) ? filled : {};
  return (Array.isArray(pending) ? pending : [])
    .filter((slotId) => !Object.prototype.hasOwnProperty.call(values, slotId));
}

const __exports = {
  ROLLUP_MARK, RESPONSIVE_REGIONS, HOISTED_PROPERTIES,
  isValueSlot, anchorOf, staticTextOf, collapsePlan, mountPlan, pairedGroups,
  nodeIndex, elementChildCount, setHidden, applyPlan,
  hoistLayout, hoistRigidBox, applyResponsiveHooks, surfaceRoot,
  primaryMountPoint, collapsePrimaryMockup, restorePrimaryMockup, mountBoard, mountBoardAsync,
  createLatestBoardLoad, nextHydrationSlots,
  RAW_IDENTITY_NAME, scrubRawIdentityNames,
  slotValueEntries, observationIdsOfSlotEntry, realtimeSlotIndex, updateRealtimeValue,
  pairedClosure, realtimePlan, applyRealtimeSlots,
  stateLinksFromMarks, stateControlActivationOwner, wireStateControlActivation,
  findStateControlNode, STATE_CONTROL_SCOPES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardMount = __exports;
}

})();
