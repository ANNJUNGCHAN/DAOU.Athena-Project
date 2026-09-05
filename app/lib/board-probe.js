'use strict';

// 보드 프로브 — 어느 보드에도 같은 규칙으로 쓰이는 부분(마운트·기하 측정·상태
// 링크·오버플로 판정)을 verify-integrated-cards.js에서 뽑아낸 것이다. 전수 게이트가
// 같은 절차를 다시 적지 않게 하려는 것이고(설계서 §3.6), PNG 저장·리포트 형상처럼
// 6장 게이트 고유의 절차는 그대로 verify-integrated-cards.js에 남는다.

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');
const { visualRowCounts } = require('./board-layout-geometry');
const { stateLinksFromMarks } = require('./board-mount');
const {
  assertReadabilityManifest,
  compactAtomicTokenSpans,
  collectGlyphFindings,
  hasInlineAmbiguity,
  waitForStableLayout,
} = require('./board-glyph-geometry');

const BOARD_WINDOW_PRESETS = Object.freeze([
  { name: '원본', width: 1920, height: 1080 },
  { name: '2분할', width: 960, height: 1080 },
  { name: '4분할', width: 640, height: 540 },
  { name: '최소', width: 480, height: 420 },
]);

// 카드 6종의 kind — 봉투의 card_kind가 card_id와 안 맞으면 통합 카드 판정이
// 닫히고(integratedDefinition) 보드가 아예 안 선다.
const CARD_KIND = Object.freeze({
  'CC-01': 'account', 'CC-02': 'order', 'CC-03': 'instrument',
  'CC-04': 'orderbook', 'CC-05': 'flow', 'CC-06': 'explorer',
});

// view_instance_id는 normalizeIdentity를 거쳐 소문자가 된다 — DOM에서 찾을 때
// 쓰는 키도 같은 규칙으로 만든다(대문자 보드 id를 그대로 쓰면 못 찾는다).
function boardInstanceId(boardId) {
  return `board-${String(boardId).toLowerCase()}`;
}

function assertSurfaceGeometry(boardId, preset, probe) {
  if (probe.overflow_x > 1) {
    throw new Error(
      `board ${boardId} ${preset.name}: surface overflow ${probe.overflow_x}px — ${
        JSON.stringify(probe.overflow_nodes)}`,
    );
  }
  const responsiveHeight = preset.name !== 'XL 프로브';
  if (responsiveHeight && probe.vertical_overflow_nodes.length) {
    throw new Error(
      `board ${boardId} ${preset.name}: vertical content overflow — ${
        JSON.stringify(probe.vertical_overflow_nodes)}`,
    );
  }
  if (responsiveHeight && probe.vertical_overlap_nodes.length) {
    throw new Error(
      `board ${boardId} ${preset.name}: vertical sibling overlap — ${
        JSON.stringify(probe.vertical_overlap_nodes)}`,
    );
  }
  const scrollTables = probe.scroll_tables || [];
  const unfocusable = scrollTables.flatMap((record) => (
    record.scroll_state_controls || []
  )).filter((control) => !control.focusable);
  if (unfocusable.length) {
    throw new Error(
      `board ${boardId} ${preset.name}: scroll_control_not_focusable — ${
        JSON.stringify(unfocusable)}`,
    );
  }
  if (preset.name === '4분할' || preset.name === '최소') {
    const fixedTables = scrollTables.filter((record) => (
      record.scroll_width <= record.client_width + 1
    ));
    if (fixedTables.length) {
      throw new Error(
        `board ${boardId} ${preset.name}: scroll_not_scrollable — ${
          JSON.stringify(fixedTables)}`,
      );
    }
  }
}

async function sendBoardEnvelope(win, surface) {
  const instanceId = surface.instanceId;
  const correlation = {
    dataset_id: 'all-kiwoom-integrated-cards',
    item_id: instanceId,
    // ordinal은 1..6만 유효하다(rest-canvas-paint.isValidCorrelation) — 영수증은
    // item_id로 가려내므로 카드 서수와 겹쳐도 섞이지 않는다.
    ordinal: surface.ordinal || 3,
  };
  const receipt = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      reject(new Error(`board surface ${surface.boardId}: shell paint receipt timeout`));
    }, 15000);
    function onPainted(_event, painted) {
      if (!painted || painted.item_id !== correlation.item_id) return;
      clearTimeout(timer);
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      if (painted.render_state === 'error') {
        reject(new Error(`board surface ${surface.boardId}: ${painted.error}`));
        return;
      }
      resolve(painted);
    }
    ipcMain.on('athena:rest-canvas-painted', onPainted);
    win.webContents.send('athena:add-rest-canvas', {
      operationRef: surface.operationRef,
      operationArgs: { stk_cd: '005930' },
      canvasType: 'facts',
      envelope: {
        card_id: surface.contract.card_id,
        card_kind: CARD_KIND[surface.contract.card_id],
        capability: 'quote',
        mode: 'quote',
        section: 'board-surface',
        // 통합 카드 6장과 같은 탭을 뺏지 않게 자기 인스턴스로 연다.
        view_instance_id: instanceId,
        operation_ref: surface.operationRef,
        canvas_type: 'facts',
        card_title: surface.cardTitle,
        fell_back: false,
        correlation,
        surface_contract: surface.contract,
        realtime_bindings: surface.realtimeBindings || [],
        operation_refs: [surface.operationRef],
        // 프로브가 보드 위에 얹을 것(전문 렌더러 봉투 등)을 더 실을 때만 쓴다.
        ...(surface.envelopeExtra || {}),
      },
    });
  });
  return receipt;
}

// 보드 카드는 자기 탭에 산다 — 찍기 전에 그 탭을 켜고(다른 탭이 활성이면 패널이
// hidden이라 높이가 0으로 나온다) 보드가 실제로 설 때까지 기다린다. 원문 HTML은
// 카드 청크에 있어 첫 마운트가 비동기다.
async function activateBoardTab(win, instanceId) {
  const activated = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const panel = root && root.closest('.canvas-tab-panel');
    if (!panel) return false;
    const tab = document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"]');
    if (tab) tab.click();
    return Boolean(tab);
  })()`);
  if (!activated) throw new Error(`board surface ${instanceId}: canvas tab was not found`);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const root = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
      if (root && root.querySelector('.board-surface')) return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('board surface never mounted'));
      requestAnimationFrame(check);
    };
    check();
  })`);
}

// 창 크기를 바꾼 뒤 레이아웃이 멎을 때까지 기다린다. rAF 2번으로는 모자란다 —
// 창 리사이즈가 비동기라 아직 옛 폭에서 잰 값이 섞이고(실측: 같은 단계가
// 실행마다 377/537px로 흔들렸다), 컨테이너 쿼리는 그 폭으로 다시 돈다.
async function settleBoardLayout(win, instanceId) {
  return win.webContents.executeJavaScript(`(async () => {
    const waitForStableLayout = ${waitForStableLayout.toString()};
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const surface = root && root.querySelector('.board-surface');
    if (!surface) throw new Error('board surface is unavailable during layout settle');
    return waitForStableLayout({
      fontsReady: document.fonts && document.fonts.ready,
      readSignature: () => {
        const rect = surface.getBoundingClientRect();
        return [
          rect.left, rect.top, rect.width, rect.height,
          surface.scrollWidth, surface.scrollHeight,
        ].map(Math.round).join(':');
      },
      requestFrame: requestAnimationFrame,
      cancelFrame: cancelAnimationFrame,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      now: performance.now.bind(performance),
      deadlineMs: 10000,
      timerMs: 50,
      maxSamples: 180,
      requiredStableSamples: 4,
    });
  })()`);
}

// 한 단계의 측정.
//
// 두 가지를 센다.
//   1) 보드 DOM 전체의 텍스트 다중집합 — responsive가 노드를 지우지 않았다는 증거.
//   2) 슬롯별 (텍스트, 화면 도달 여부) 다중집합 — 값이 화면에서 사라지지 않았다는
//      증거. `도달`은 그 슬롯의 잎이 보이거나, 그 열을 대신 받는 병기 줄이 보이는
//      것이다(계획 §2 "접힌 열은 삭제가 아니라 셀 병기로 내려간다").
// 병기 줄(.bs-paired) 자체는 값의 1차 표현이 아니라 접힘의 착지점이라 도달 판정에서
// 뺀다 — XL에서 숨어 있는 것이 정상이다. 영값 묶음(H1)으로 접힌 레일 행도 열이
// 없어 도달 0이지만, 그 0이 네 단계 모두 같으므로 상등 검사가 그대로 성립한다.
const boardStepProbe = (instanceId) => `(async () => {
  const countVisualRows = ${visualRowCounts.toString()};
  const compactAtomicTokenSpans = ${compactAtomicTokenSpans.toString()};
  const collectGlyphFindings = ${collectGlyphFindings.toString()};
  const hasInlineAmbiguity = ${hasInlineAmbiguity.toString()};
  const root = document.querySelector(
    '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
  if (!root) return { error: 'board card not found' };
  const surface = root.querySelector('.board-surface');
  if (!surface) return { error: 'board surface not mounted' };
  const shown = (node) => node.getClientRects().length > 0;

  const domText = new Map();
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text) domText.set(text, (domText.get(text) || 0) + 1);
  }

  const pairedCols = new Set();
  for (const paired of surface.querySelectorAll('.bs-paired')) {
    if (!shown(paired)) continue;
    for (const token of String(paired.dataset.pairedCol || '').split(/\\s+/)) {
      if (token) pairedCols.add(token);
    }
  }
  const columnOf = (node) => {
    for (let el = node; el && el !== surface; el = el.parentElement) {
      if (el.dataset && el.dataset.colPriority) return el.dataset.colPriority;
    }
    return null;
  };

  const slots = [];
  let visibleSlotCount = 0;
  let reachableSlotCount = 0;
  for (const leaf of surface.querySelectorAll('[data-slot-id]')) {
    if (leaf.closest('.bs-paired')) continue;
    const column = columnOf(leaf);
    const visible = shown(leaf);
    const reachable = visible || Boolean(column && pairedCols.has(column));
    if (visible) visibleSlotCount += 1;
    if (reachable) reachableSlotCount += 1;
    slots.push([
      leaf.dataset.slotId, leaf.textContent.trim(), reachable ? '1' : '0',
    ].join('\\u0000'));
  }

  // 접힌 열은 래퍼의 계산된 display로 센다. .bs-col은 XL에서 \`display: contents\`라
  // 자기 상자가 없다 — 화면 사각형으로 재면 어느 단계에서도 "안 보임"이 나와
  // "전부 접혔다"는 빈 신호가 된다(실보드 6장에서 그렇게 나왔다). 게다가 실추출
  // 보드에서는 열 셀과 병기 span이 같은 Paper 노드 id를 나눠 써서 슬롯 텍스트가
  // 병기 쪽에 앉는다 — 열 안에 값 잎이 0개라, 잎으로도 접힘을 못 잰다.
  const allColumns = new Set();
  const foldedSet = new Set();
  for (const node of surface.querySelectorAll('[data-col-priority]')) {
    allColumns.add(node.dataset.colPriority);
    if (getComputedStyle(node).display === 'none') foldedSet.add(node.dataset.colPriority);
  }
  const foldedColumns = [...foldedSet].sort();

  const rectValue = (node) => {
    if (!node || !shown(node)) return null;
    const rect = node.getBoundingClientRect();
    return {
      left: Math.round(rect.left), top: Math.round(rect.top),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
  };
  const primaryRect = rectValue(surface.querySelector('.bs-primary'));
  const railRect = rectValue(surface.querySelector('.bs-rail'));
  const kpiRowCounts = [];
  for (const kpi of surface.querySelectorAll('.bs-kpi')) {
    const rects = [];
    for (const cell of kpi.querySelectorAll(':scope > .bs-kpi-cell')) {
      const rect = rectValue(cell);
      if (!rect) continue;
      rects.push(rect);
    }
    const rows = countVisualRows(rects);
    if (rows.length) kpiRowCounts.push(rows);
  }
  const kpiMaxColumns = Math.max(0, ...kpiRowCounts.flat());

  // height hoist가 좁은 단계에서 허용하는 것은 성장뿐이다. 원래 높이를 가진
  // visible-flow 상자가 다시 내용에 뚫리거나, column flex 형제가 겹치면 실패시킨다.
  const verticalOverflowNodes = [];
  for (const el of surface.querySelectorAll('[data-bs-hoisted]')) {
    if (!el.style.getPropertyValue('--bs-height') || !shown(el)) continue;
    if (!String(el.textContent || '').trim()) continue;
    const style = getComputedStyle(el);
    const over = el.scrollHeight - el.clientHeight;
    if (over > 1 && style.overflowY === 'visible') {
      verticalOverflowNodes.push({
        node: (el.dataset && el.dataset.node) || '',
        name: (el.dataset && el.dataset.name) || '',
        over, scroll_height: el.scrollHeight, client_height: el.clientHeight,
      });
    }
  }
  const verticalOverlapNodes = [];
  for (const parent of surface.querySelectorAll('[data-bs-hoisted]')) {
    const style = getComputedStyle(parent);
    if (style.display !== 'flex' || style.flexDirection !== 'column') continue;
    const children = [...parent.children].filter((child) => (
      shown(child) && getComputedStyle(child).position !== 'absolute'
    )).map((child) => ({ child, rect: child.getBoundingClientRect() }))
      .filter((item) => item.rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top);
    for (let index = 1; index < children.length; index += 1) {
      const prior = children[index - 1];
      const next = children[index];
      const overlap = Math.round(prior.rect.bottom - next.rect.top);
      if (overlap > 1) {
        verticalOverlapNodes.push({
          parent: (parent.dataset && parent.dataset.node) || '',
          prior: (prior.child.dataset && prior.child.dataset.node) || '',
          next: (next.child.dataset && next.child.dataset.node) || '',
          overlap,
        });
      }
    }
  }

  const anonymousGlyphIds = new WeakMap();
  let anonymousGlyphId = 0;
  const elementIdentity = (element) => {
    if (element.dataset && (element.dataset.node || element.dataset.slotId)) {
      return element.dataset.node || element.dataset.slotId;
    }
    if (!anonymousGlyphIds.has(element)) anonymousGlyphIds.set(element, 'glyph-' + anonymousGlyphId++);
    return anonymousGlyphIds.get(element);
  };
  const responsiveSelector = '.bs-r-flow, .bs-r-scroll, .bs-r-paired-table, .bs-r-scroll-table';
  const responsiveOwnerFor = (element) => element.closest(responsiveSelector);
  const renderedItemFor = (owner, element) => {
    let item = getComputedStyle(element).display === 'contents' ? null : element;
    for (let parent = element.parentElement; parent && parent !== owner; parent = parent.parentElement) {
      if (getComputedStyle(parent).display !== 'contents') item = parent;
    }
    return item || owner;
  };
  const textFragments = (element) => {
    if (!shown(element)) return [];
    const fragments = [];
    const textWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let text = textWalker.nextNode(); text; text = textWalker.nextNode()) {
      if (!text.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNode(text);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          fragments.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        }
      }
    }
    return fragments;
  };
  const textNodeFragments = (text) => {
    const range = document.createRange();
    range.selectNode(text);
    return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }));
  };
  const ancestorsFor = (element, until) => {
    const ancestorOwners = [];
    for (let parent = element.parentElement; parent && parent !== until; parent = parent.parentElement) {
      ancestorOwners.push(elementIdentity(parent));
    }
    return ancestorOwners;
  };
  const glyphCandidates = [];
  for (const responsiveOwner of surface.querySelectorAll(responsiveSelector)) {
    const textWalker = document.createTreeWalker(responsiveOwner, NodeFilter.SHOW_TEXT);
    for (let text = textWalker.nextNode(); text; text = textWalker.nextNode()) {
      if (!text.nodeValue.trim() || !text.parentElement || responsiveOwnerFor(text.parentElement) !== responsiveOwner) continue;
      const element = text.parentElement;
      const fragments = textNodeFragments(text);
      if (!fragments.length) continue;
      const item = renderedItemFor(responsiveOwner, element);
      const semanticOwner = element.closest('[data-node], [data-slot-id]') || element;
      glyphCandidates.push({
        node: elementIdentity(semanticOwner),
        name: semanticOwner.dataset.name || '',
        owner: elementIdentity(element),
        owner_name: element.dataset.name || semanticOwner.dataset.name || '',
        text: text.nodeValue.trim(),
        layout_owner: elementIdentity(responsiveOwner),
        layout_item: elementIdentity(item),
        ancestors: ancestorsFor(element, responsiveOwner),
        atomic: false,
        hidden: !shown(element),
        fragments,
      });
    }
  }
  const automaticWalker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  for (let text = automaticWalker.nextNode(); text; text = automaticWalker.nextNode()) {
    if (!text.parentElement || !shown(text.parentElement)) continue;
    const element = text.parentElement;
    if (element.closest('.bs-r-atomic, [data-bs-value-atomic="true"], [data-paired-source]')) continue;
    // Non-opted-in tables may wrap short labels (2SKU-1 deposit-trend 현금,
    // 13BC-2 control tables). Keep compact auto-tokens for chrome outside
    // tables; opted-in scroll/paired tables still stay gated.
    const table = element.closest('.bs-table');
    if (
      table
      && !table.classList.contains('bs-r-scroll-table')
      && !table.classList.contains('bs-r-paired-table')
    ) continue;
    // Primary deposit captions (2SKU-1 현재 예수금) may wrap at XS by layout.
    // Auto-tokens only gate strip/header chrome and money-like leaves.
    const inChrome = Boolean(element.closest('.bs-strip, .bs-header'));
    for (const token of compactAtomicTokenSpans(text.nodeValue)) {
      if (!inChrome && !/\d/.test(token.text) && !/[억원%]/.test(token.text)) continue;
      const range = document.createRange();
      range.setStart(text, token.start);
      range.setEnd(text, token.end);
      const fragments = [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }));
      if (!fragments.length) continue;
      const responsiveOwner = responsiveOwnerFor(element);
      const layoutOwner = responsiveOwner || surface;
      const item = renderedItemFor(layoutOwner, element);
      const semanticOwner = element.closest('[data-node], [data-slot-id]') || element;
      glyphCandidates.push({
        node: elementIdentity(semanticOwner),
        name: semanticOwner.dataset.name || '',
        owner: elementIdentity(element),
        owner_name: element.dataset.name || semanticOwner.dataset.name || '',
        text: token.text,
        layout_owner: elementIdentity(layoutOwner),
        layout_item: elementIdentity(item),
        ancestors: ancestorsFor(element, layoutOwner),
        atomic: true,
        overlap: false,
        hidden: false,
        fragments,
      });
    }
  }
  for (const element of surface.querySelectorAll(
    '.bs-r-atomic, [data-bs-value-atomic="true"], [data-paired-source]',
  )) {
    // value-atomic/paired-source without a declared owner may wrap
    // (2SKU-1 deposit-trend captions). Explicit .bs-r-atomic siblings still
    // measure against the surface so G5a chips outside a flow ancestor stay gated.
    const explicitAtomic = element.classList.contains('bs-r-atomic');
    const responsiveOwner = responsiveOwnerFor(element) || (explicitAtomic ? surface : null);
    if (!responsiveOwner) continue;
    const item = renderedItemFor(responsiveOwner, element);
    const owner = elementIdentity(element);
    glyphCandidates.push({
      node: owner,
      name: element.dataset.name || '',
      owner,
      owner_name: element.dataset.name || '',
      text: element.textContent.trim(),
      layout_owner: elementIdentity(responsiveOwner),
      layout_item: elementIdentity(item),
      ancestors: ancestorsFor(element, responsiveOwner),
      atomic: true,
      overlap: false,
      hidden: !shown(element),
      fragments: textFragments(element),
    });
  }
  const pairedRecords = [];
  const pairedSources = new Map();
  for (const element of surface.querySelectorAll('[data-node]')) {
    const source = element.dataset.node || '';
    if (!source) continue;
    if (!pairedSources.has(source)) pairedSources.set(source, []);
    pairedSources.get(source).push(element);
  }
  for (const mirror of surface.querySelectorAll('[data-paired-source]')) {
    const source = mirror.dataset.pairedSource || '';
    const candidates = pairedSources.get(source) || [];
    const leaves = candidates.filter((element) => element.dataset.leaf !== undefined);
    const canonicalSources = leaves.length ? leaves : candidates;
    const sourceElement = canonicalSources[0] || null;
    const parent = mirror.parentElement;
    const labels = parent
      ? [...parent.children].filter((element) => (
        element.dataset.pairedLabel !== undefined && element.textContent.trim()
      )) : [];
    pairedRecords.push({
      source,
      source_found: Boolean(sourceElement),
      source_count: canonicalSources.length,
      source_text: sourceElement ? sourceElement.textContent.trim() : '',
      mirror_text: mirror.textContent.trim(),
      source_tone: sourceElement ? sourceElement.style.color || '' : '',
      mirror_tone: mirror.style.color || '',
      source_missing: Boolean(sourceElement && sourceElement.dataset.missing !== undefined),
      mirror_missing: mirror.dataset.missing !== undefined,
      mirror_has_identity: Boolean(
        mirror.dataset.node !== undefined
        || mirror.dataset.slotId !== undefined
        || mirror.dataset.leaf !== undefined
        || mirror.dataset.bsValueAtomic !== undefined
      ),
      label_found: labels.length > 0,
      label_count: labels.length,
      hidden: !shown(mirror),
    });
  }
  for (const mirror of surface.querySelectorAll('.bs-r-paired-table .bs-paired')) {
    if (mirror.querySelector('[data-paired-source]')) continue;
    const parent = mirror.parentElement;
    const neighborFragments = [];
    if (parent) {
      const neighborWalker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
      for (let text = neighborWalker.nextNode(); text; text = neighborWalker.nextNode()) {
        const pair = text.parentElement && text.parentElement.closest('.bs-paired');
        if (!text.nodeValue.trim() || pair === mirror) continue;
        neighborFragments.push(...textNodeFragments(text));
      }
    }
    pairedRecords.push({
      kind: 'legacy_pair',
      source: elementIdentity(mirror),
      label_found: Boolean(mirror.querySelector('[data-paired-label]')),
      ambiguous_inline: hasInlineAmbiguity(textFragments(mirror), neighborFragments),
      hidden: !shown(mirror),
    });
  }
  const scrollTableRecords = [];
  for (const owner of surface.querySelectorAll('.bs-r-scroll-table')) {
    const violations = [];
    if (owner.getAttribute('role') !== 'region') violations.push('scroll_owner_role');
    if (owner.getAttribute('tabindex') !== '0') violations.push('scroll_owner_tabindex');
    if (!(owner.getAttribute('aria-label') || '').trim()) violations.push('scroll_owner_label');
    const tables = [...owner.children].filter((element) => (
      element.classList.contains('bs-scroll-table-semantics')
    ));
    if (tables.length !== 1) violations.push('scroll_missing_table');
    const table = tables[0] || null;
    if (table) {
      if (table.getAttribute('role') !== 'table') violations.push('scroll_table_role');
      if (!(table.getAttribute('aria-label') || '').trim()) violations.push('scroll_table_label');
      if (table.dataset.node !== undefined || table.dataset.slotId !== undefined
        || table.dataset.stateControl !== undefined || table.dataset.stateBoard !== undefined) {
        violations.push('scroll_table_identity');
      }
      if (table.hasAttribute('id') || table.hasAttribute('aria-owns')
        || table.hasAttribute('aria-labelledby')) violations.push('scroll_forbidden_reference');
      const rowCount = Number(table.getAttribute('aria-rowcount'));
      const colCount = Number(table.getAttribute('aria-colcount'));
      const rows = [...table.querySelectorAll('[role="row"]')]
        .filter((row) => row.closest('[role="table"]') === table);
      if (!Number.isInteger(rowCount) || rowCount !== rows.length
        || !rows.length || rows.some((row) => row.getAttribute('role') !== 'row'
          || !row.dataset.node)) violations.push('scroll_missing_row');
      let badColumnRole = !Number.isInteger(colCount) || colCount < 1;
      let badPosition = false;
      rows.forEach((row, rowIndex) => {
        if (row.getAttribute('aria-rowindex') !== String(rowIndex + 1)) badPosition = true;
        const cells = [...row.children];
        if (cells.length !== colCount) badColumnRole = true;
        cells.forEach((cell, colIndex) => {
          const expectedRole = rowIndex === 0
            ? 'columnheader' : (colIndex === 0 ? 'rowheader' : 'cell');
          const isSemanticHeaderCell = rowIndex === 0
            && cell.classList.contains('bs-scroll-table-cell-semantics');
          const headerSources = isSemanticHeaderCell
            ? [...cell.children].filter((child) => child.dataset.node !== undefined) : [];
          const headerCellHasIdentity = isSemanticHeaderCell && (
            cell.dataset.node !== undefined || cell.dataset.slotId !== undefined
            || cell.dataset.stateControl !== undefined || cell.dataset.stateBoard !== undefined
          );
          if (cell.getAttribute('role') !== expectedRole
              || (rowIndex === 0
                ? (!isSemanticHeaderCell || headerCellHasIdentity || headerSources.length !== 1)
                : !cell.dataset.node)) badColumnRole = true;
          if (cell.getAttribute('aria-colindex') !== String(colIndex + 1)) badPosition = true;
          if (cell.hasAttribute('aria-labelledby')) violations.push('scroll_forbidden_reference');
        });
      });
      if (badColumnRole) violations.push('scroll_bad_column_role');
      if (badPosition) violations.push('scroll_bad_position');
    }
    const scrollStateControls = [...owner.querySelectorAll('[data-state-board]')]
      .map((control) => {
        const activationOwner = control.closest('button, [role="button"], [role="tab"]') || control;
        const role = activationOwner.getAttribute('role') || '';
        const focusable = shown(control) && shown(activationOwner)
          && activationOwner.tabIndex >= 0
          && (activationOwner.tagName === 'BUTTON' || role === 'button' || role === 'tab');
        if (['columnheader', 'rowheader', 'cell'].includes(control.getAttribute('role'))) {
          violations.push('scroll_control_role_conflict');
        }
        if (!focusable) violations.push('scroll_control_not_focusable');
        return {
          node: elementIdentity(control),
          activation_node: elementIdentity(activationOwner),
          role,
          tabindex: activationOwner.getAttribute('tabindex'),
          visible: shown(control),
          focusable,
        };
      });
    const scrollRecord = {
      node: elementIdentity(owner),
      scroll_width: owner.scrollWidth,
      client_width: owner.clientWidth,
      scroll_state_controls: scrollStateControls,
      violations: [...new Set(violations)],
    };
    scrollTableRecords.push(scrollRecord);
    pairedRecords.push({
      kind: 'scroll_table',
      source: elementIdentity(owner),
      violations: scrollRecord.violations,
      hidden: !shown(owner),
    });
  }
  // 표 본문 셀이 자기 헤더 열의 가로 레인 밖에 그려지면 값이 다른 열로 읽힌다
  // (2QFO-2 960 실측: 매도값이 매수 레인에). 접혀서 숨은 칸은 대상이 아니다.
  const rowCells = (row) => [...row.querySelectorAll('[data-col]')].filter((cell) => (
    cell.closest('[data-row]') === row
    && (cell.parentElement === null || cell.parentElement.closest('[data-col]') === null)
  ));
  const columnLaneNodes = [];
  for (const table of surface.querySelectorAll('.bs-table')) {
    const head = table.querySelector('[data-row="head"]');
    if (!head) continue;
    const lanes = new Map();
    for (const cell of rowCells(head)) {
      if (!shown(cell)) continue;
      const rect = cell.getBoundingClientRect();
      if (rect.width > 0) lanes.set(cell.getAttribute('data-col'), rect);
    }
    if (!lanes.size) continue;
    for (const row of table.querySelectorAll('[data-row]')) {
      if (row === head) continue;
      for (const cell of rowCells(row)) {
        const lane = lanes.get(cell.getAttribute('data-col'));
        if (!lane || !shown(cell)) continue;
        const rect = cell.getBoundingClientRect();
        if (rect.width <= 0) continue;
        const center = rect.left + (rect.width / 2);
        if (center >= lane.left - 1 && center <= lane.right + 1) continue;
        columnLaneNodes.push({
          table: elementIdentity(table),
          row: row.getAttribute('data-row'),
          col: cell.getAttribute('data-col'),
          cell_center: Math.round(center),
          header_lane: [Math.round(lane.left), Math.round(lane.right)],
        });
      }
    }
  }

  const glyph = collectGlyphFindings(glyphCandidates, pairedRecords, { cap: 20, tolerance: 1 });

  return {
    dom_text: [...domText.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    slot_multiset: slots.sort(),
    all_columns: [...allColumns].sort(),
    visible_slot_count: visibleSlotCount,
    reachable_slot_count: reachableSlotCount,
    folded_columns: foldedColumns,
    paired_columns: [...pairedCols].sort(),
    primary_rect: primaryRect,
    rail_rect: railRect,
    kpi_row_counts: kpiRowCounts,
    kpi_max_columns: kpiMaxColumns,
    vertical_overflow_nodes: verticalOverflowNodes.slice(0, 20),
    vertical_overlap_nodes: verticalOverlapNodes.slice(0, 20),
    atomic_wrap_nodes: glyph.atomic_wrap_nodes.items,
    atomic_wrap_total: glyph.atomic_wrap_nodes.total,
    text_overlap_nodes: glyph.text_overlap_nodes.items,
    text_overlap_total: glyph.text_overlap_nodes.total,
    paired_semantics_violations: glyph.paired_semantics_violations.items,
    paired_semantics_total: glyph.paired_semantics_violations.total,
    column_lane_nodes: columnLaneNodes.slice(0, 20),
    column_lane_total: columnLaneNodes.length,
    scroll_tables: scrollTableRecords,
    container_width: Math.round(surface.getBoundingClientRect().width),
    // 보드가 자기 칸보다 넓으면 가로 스크롤이 생긴다 — 계획 §2는 세로 스크롤만
    // 허용한다. 아래 검증 단계가 1px 초과를 하드 실패시키며 여기에는 원시값을 남긴다.
    overflow_x: Math.max(0, surface.scrollWidth - Math.round(surface.getBoundingClientRect().width)),
    host_client_width: surface.parentElement ? surface.parentElement.clientWidth : null,
    // 넘침이 남으면 어느 상자가 냈는지 함께 남긴다 — 숫자만으로는 못 고친다.
    overflow_nodes: (() => {
      const nodes = [];
      const surfaceRect = surface.getBoundingClientRect();
      for (const el of surface.querySelectorAll('*')) {
        const over = el.scrollWidth - el.clientWidth;
        const rect = el.getBoundingClientRect();
        const insideScrollStrip = Boolean(el.closest('.bs-strip'));
        const outsideRight = insideScrollStrip ? 0 : Math.max(0, Math.round(rect.right - surfaceRect.right));
        if (over > 1 || outsideRight > 1) {
          const style = getComputedStyle(el);
          nodes.push({
            cls: el.className || '', node: (el.dataset && el.dataset.node) || '',
            name: (el.dataset && el.dataset.name) || '',
            over, outside_right: outsideRight,
            scroll_width: el.scrollWidth, client_width: el.clientWidth,
            width: style.width, min_width: style.minWidth, max_width: style.maxWidth,
            flex_basis: style.flexBasis, flex_shrink: style.flexShrink,
            overflow_x: style.overflowX,
            padding_inline: [style.paddingLeft, style.paddingRight],
          });
        }
      }
      return nodes.sort((a, b) => Math.max(b.over, b.outside_right)
        - Math.max(a.over, a.outside_right)).slice(0, 20);
    })(),
    card_rect: (() => {
      const box = root.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.max(1, Math.ceil(box.width)),
        height: Math.max(1, Math.ceil(box.height)),
      };
    })(),
  };
})()`;

function loadRealBoardContract(boardId, ordinal, templateRoot) {
  const templateDirectory = path.join(templateRoot, boardId);
  const slots = JSON.parse(fs.readFileSync(path.join(templateDirectory, 'slots.json'), 'utf8'));
  const regions = JSON.parse(fs.readFileSync(path.join(templateDirectory, 'regions.json'), 'utf8'));
  const boardHtml = fs.readFileSync(path.join(templateDirectory, 'board.html'), 'utf8');
  assertReadabilityManifest(regions, boardHtml);
  const slotValues = {};
  for (const slot of slots.slots) {
    if (typeof slot.paper_text === 'string' && slot.paper_text !== '') {
      slotValues[slot.slot_id] = slot.paper_text;
    }
  }
  return {
    boardId,
    instanceId: boardInstanceId(boardId),
    ordinal,
    cardTitle: `보드 표면 검수 · ${boardId}`,
    operationRef: 'base:board-surface',
    realtimeBindings: [],
    slotCount: slots.slots.length,
    boundCount: Object.keys(slotValues).length,
    contract: {
      surface_version: 'card-surface.v1',
      board_id: slots.board_id,
      card_id: slots.card_id,
      state_boards: stateLinksFromMarks(slots.state_controls),
      slot_values: slotValues,
      unbound_slots: [],
      column_priority: slots.column_priority || [],
      section_titles_ko: slots.section_titles_ko || {},
    },
  };
}

// 보드 카드에는 통합 카드 크롬이 없다 — 카드 머리(제목·기준 시각·×)도, 패널 탭
// 칩도, 개발자 원시 필드 시트도 만들지 않는다(카드 = 보드 그 자체). 실앱 DOM에서
// 그 셋이 0인지 세고, 대신 탭 스트립이 제목과 닫기를 이고 있는지 확인한다.
async function inspectBoardChrome(win, surface) {
  const dom = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${surface.instanceId}"]');
    if (!root) return { error: 'board card not found' };
    const panel = root.closest('.canvas-tab-panel');
    const tab = panel && document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"]');
    return {
      board_surface_mark: root.dataset.boardSurface || '',
      card_head_count: root.querySelectorAll(':scope > .card-head').length,
      card_title_count: root.querySelectorAll('.card-title').length,
      card_fresh_count: root.querySelectorAll('.card-fresh').length,
      card_close_count: root.querySelectorAll('.uk-card-close').length,
      panel_tab_strip_count: root.querySelectorAll('.integrated-card-tabs').length,
      panel_tab_chip_count: root.querySelectorAll('.integrated-card-tab').length,
      raw_field_sheet_count: root.querySelectorAll('.semantic-detail-sheet').length,
      board_surface_count: root.querySelectorAll('.board-surface').length,
      tab_label: tab ? tab.querySelector('.canvas-tab-label').textContent.trim() : null,
      tab_close: Boolean(tab && tab.querySelector('.canvas-tab-close')),
    };
  })()`);
  if (dom.error) throw new Error(`board ${surface.boardId}: ${dom.error}`);
  const chrome = [
    'card_head_count', 'card_title_count', 'card_fresh_count', 'card_close_count',
    'panel_tab_strip_count', 'panel_tab_chip_count', 'raw_field_sheet_count',
  ].filter((key) => dom[key] !== 0);
  if (chrome.length) {
    throw new Error(`board ${surface.boardId}: 카드 크롬이 남았다 — ${JSON.stringify(
      Object.fromEntries(chrome.map((key) => [key, dom[key]])))}`);
  }
  if (dom.board_surface_mark !== 'true' || dom.board_surface_count !== 1) {
    throw new Error(`board ${surface.boardId}: 보드 표면 표시가 없다 — ${JSON.stringify(dom)}`);
  }
  if (!dom.tab_label || !dom.tab_close) {
    throw new Error(`board ${surface.boardId}: 탭 스트립이 제목·닫기를 잇지 않았다 — ${JSON.stringify(dom)}`);
  }
  return dom;
}

module.exports = {
  BOARD_WINDOW_PRESETS,
  CARD_KIND,
  activateBoardTab,
  assertSurfaceGeometry,
  boardInstanceId,
  boardStepProbe,
  inspectBoardChrome,
  loadRealBoardContract,
  sendBoardEnvelope,
  settleBoardLayout,
};
