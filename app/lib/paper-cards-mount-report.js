'use strict';

// 카드 96장 런타임 마운트 게이트(`verify:paper-cards-mount`)의 판정과 리포트 조립.
// 창을 몰고 DOM을 재는 것은 probe-paper-cards-mount.js가 하고, **무엇이 실패인가**는
// 여기서 정한다 — electron 없이 도는 순수 부분이라 단위 테스트가 붙는 자리다.
//
// 재는 것은 셋뿐이다(설계서 §3.1 구간 C): 마운트가 섰는가 · 4폭에서 가로로 넘치지
// 않는가 · DOM 텍스트 다중집합이 slots.json과 같은가. 글리프 가독성과 PNG는
// 6장 정본 게이트(verify:integrated-cards)의 몫으로 남긴다 — 96장에 걸면 판정이
// 「Paper에 있는 것이 구현됐나」에서 「예쁜가」로 미끄러진다(설계서 §3.3).

/**
 * 보드에 붙는 런타임 실패 코드. 설계서 §3.7 폐쇄집합의 마운트 층 어휘에
 * `surface_geometry` 하나를 더한다 — `assertSurfaceGeometry`(board-probe.js)는 가로
 * 넘침 말고도 세로 넘침·형제 겹침·스크롤 표 계약을 함께 판정하는데, §3.7에는 그
 * 셋을 받을 코드가 없다. 없는 코드를 `overflow_x`로 뭉뚱그리면 §6.4 변환기가
 * 「가로 넘침을 고쳐라」라는 틀린 작업을 낳는다. 정적 층이 `state_link_unresolved`를
 * 같은 이유로 더한 선례를 따른다.
 */
const MOUNT_FAILURE_CODES = Object.freeze([
  'mount_failed',
  'overflow_x',
  'surface_geometry',
  'state_board_missing_in_dom',
  'slot_unreachable',
  'text_multiset_dom_mismatch',
]);

/**
 * 보드를 카드(청크) 단위로 묶는다. 96장을 한꺼번에 마운트하면 DOM이 3만 노드가
 * 되므로 카드마다 끊어 넣고 비운다(설계서 §3.4). 순서는 카드가 처음 나온 순서다 —
 * `board-template-registry`의 `loadChunk`가 카드당 한 번만 주입하므로 같은 카드를
 * 붙여 두면 청크 주입도 카드 수만큼으로 끝난다.
 * @param {string[]} boardIds
 * @param {(boardId: string) => string|null} cardIdOf
 * @returns {{card_id: string, board_ids: string[]}[]}
 */
function groupBoardsByCard(boardIds, cardIdOf) {
  const chunks = new Map();
  for (const boardId of boardIds) {
    const cardId = cardIdOf(boardId);
    if (!cardId) throw new Error(`board ${boardId}: 카드 색인에 없는 보드다`);
    if (!chunks.has(cardId)) chunks.set(cardId, []);
    chunks.get(cardId).push(boardId);
  }
  return [...chunks.entries()].map(([cardId, ids]) => ({ card_id: cardId, board_ids: ids }));
}

/**
 * 다중집합 둘을 `added`/`removed`/`count_changed` 3분류로 가른다(설계서 §3.7).
 * `added`는 DOM에만, `removed`는 slots.json에만 있는 텍스트다.
 * @param {Record<string, number>} slotsMultiset
 * @param {Record<string, number>} domMultiset
 */
function diffTextMultiset(slotsMultiset, domMultiset) {
  const added = [];
  const removed = [];
  const countChanged = [];
  for (const text of new Set([...Object.keys(slotsMultiset), ...Object.keys(domMultiset)])) {
    const slotsCount = slotsMultiset[text] || 0;
    const domCount = domMultiset[text] || 0;
    if (slotsCount === domCount) continue;
    if (!slotsCount) added.push({ text, count: domCount });
    else if (!domCount) removed.push({ text, count: slotsCount });
    else countChanged.push({ text, slots: slotsCount, dom: domCount });
  }
  const byText = (a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
  return { added: added.sort(byText), removed: removed.sort(byText), count_changed: countChanged.sort(byText) };
}

/** 정렬된 [텍스트, 개수] 쌍을 다중집합 객체로 되돌린다. */
function domTextMultiset(pairs) {
  const multiset = {};
  for (const [text, count] of pairs || []) multiset[text] = count;
  return multiset;
}

// 한 조작 문구가 보드 둘을 가리켜도 DOM 노드는 하나다. 링크 수로 세면
// 137X-2 「순위」처럼 6칸에 7기대를 심어 가짜 누락이 된다.
function uniqueStateControls(links) {
  return new Set((Array.isArray(links) ? links : [])
    .map((link) => String((link && link.control) || '').trim())
    .filter(Boolean)).size;
}

/**
 * 한 보드를 한 폭에서 잰 결과를 실패 목록으로 바꾼다.
 * @param {{preset: string, probe: object, geometryError?: string|null,
 *          expectedTextMultiset: Record<string, number>, expectedStateBoards: number}} step
 */
function mountFailures(step) {
  const { preset, probe, geometryError = null, expectedTextMultiset, expectedStateBoards } = step;
  const failures = [];
  if (geometryError) {
    // 가로 넘침이 실제로 있으면 그것이 원인이다. 아니면 세로/스크롤 계약이 깨진 것이라
    // 코드를 갈라 준다 — 둘을 뭉치면 고칠 곳이 안 보인다.
    failures.push(probe.overflow_x > 1
      ? {
        code: 'overflow_x',
        layer: 'mount',
        preset,
        overflow_x: probe.overflow_x,
        nodes: probe.overflow_nodes || [],
      }
      : {
        code: 'surface_geometry',
        layer: 'mount',
        preset,
        error: geometryError,
        vertical_overflow_nodes: probe.vertical_overflow_nodes || [],
        vertical_overlap_nodes: probe.vertical_overlap_nodes || [],
      });
  }
  const slotCount = (probe.slot_multiset || []).length;
  if (probe.reachable_slot_count < slotCount) {
    failures.push({
      code: 'slot_unreachable',
      layer: 'mount',
      preset,
      slot_count: slotCount,
      reachable_slot_count: probe.reachable_slot_count,
    });
  }
  if (probe.state_boards_in_dom < expectedStateBoards) {
    failures.push({
      code: 'state_board_missing_in_dom',
      layer: 'mount',
      preset,
      expected: expectedStateBoards,
      in_dom: probe.state_boards_in_dom,
    });
  }
  // 병기 줄(`.bs-paired`)은 세어 넣지 않는다. 그 줄은 Paper 노드가 아니라 **접힘의
  // 착지점**이다 — 추출기가 좁은 폭에서 열이 접힐 때 값이 갈 자리를 만들려고 같은
  // 노드 id를 셀과 병기 줄 두 곳에 적는다(13BC-2 실측: `3IO7-0`이 board.html에 두 번).
  // 그대로 세면 표가 있는 보드가 전부 「개수 2배」로 빨개져 진짜 드리프트가 묻힌다.
  // 접어 없앤 것은 코드가 만든 표기뿐이고 Paper 텍스트는 하나도 안 버린다(설계서
  // §3.2가 S4에서 같은 판단을 한 자리다). 값이 병기 줄로만 내려가 사라졌는지는
  // `slot_unreachable`이 따로 잡는다.
  const drift = diffTextMultiset(expectedTextMultiset, domTextMultiset(probe.dom_text_primary));
  if (drift.added.length || drift.removed.length || drift.count_changed.length) {
    failures.push({ code: 'text_multiset_dom_mismatch', layer: 'mount', preset, ...drift });
  }
  return failures;
}

/**
 * 보드 하나의 리포트 항목(설계서 §3.7 `boards[]` 형상). 통과면 잰 값을, 실패면
 * 실패 목록을 남긴다 — 같은 코드가 여러 폭에서 나면 폭마다 한 줄이다.
 * @param {{board_id: string, card_id: string, steps: object[], failures: object[]}} board
 */
function boardMountRecord(board) {
  const { board_id: boardId, card_id: cardId, steps, failures } = board;
  if (failures.length) {
    return { board_id: boardId, card_id: cardId, status: 'fail', failures };
  }
  const base = steps[0];
  return {
    board_id: boardId,
    card_id: cardId,
    status: 'pass',
    mount: {
      distinct_text_count: base.distinct_text_count,
      slot_count: base.slot_count,
      reachable_slot_count: base.reachable_slot_count,
      max_overflow_x: Math.max(...steps.map((step) => step.overflow_x)),
      state_boards_in_dom: base.state_boards_in_dom,
    },
  };
}

/** CLI 출력과 종료코드. 실패 경로를 테스트가 부를 수 있게 순수 함수로 뽑았다. */
function formatMountCliReport(runtime, reportPathLabel) {
  const failed = runtime.boards.filter((board) => board.status === 'fail');
  const lines = [
    `[paper-cards-mount] 보드 ${runtime.totals.boards}장 · 통과 ${runtime.totals.pass} · 실패 ${runtime.totals.fail}`
      + `${runtime.selection.canonical ? '' : ' (샤드 실행)'}`,
    `  폭 ${runtime.presets.join(' · ')} · 청크 ${runtime.chunks.length} · ${Math.round(runtime.elapsed_ms / 1000)}초`,
  ];
  for (const board of failed) {
    const codes = [...new Set(board.failures.map((failure) => failure.code))].join(', ');
    lines.push(`  FAIL ${board.board_id} (${board.card_id}) — ${codes}`);
  }
  lines.push(`  리포트 ${reportPathLabel}`);
  if (!failed.length) return { exitCode: 0, lines: [...lines, 'paper cards mount verification passed'] };
  return { exitCode: 1, lines };
}

module.exports = {
  MOUNT_FAILURE_CODES,
  boardMountRecord,
  diffTextMultiset,
  domTextMultiset,
  formatMountCliReport,
  groupBoardsByCard,
  mountFailures,
  uniqueStateControls,
};
