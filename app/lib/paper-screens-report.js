'use strict';

// 화면계 전수 게이트(`verify:paper-screens`)의 판정·래칫·리포트 조립.
// 창을 몰고 DOM을 재는 것은 probe-paper-screens.js가 하고, **무엇이 실패인가**와
// **무엇이 푸시를 막는가**는 여기서 정한다 — electron 없이 도는 순수 부분이라
// 단위 테스트가 붙는 자리다(카드 게이트의 paper-cards-mount-report.js와 같은 관례).
//
// 판정의 뼈대는 설계서 §4다. 매니페스트가 화면(role=="screen")이라 부른 보드는
// **라우트가 없으면 실패**다 — 그것이 이 게이트의 존재 이유고(§9 「미구현 보드」행),
// 그래서 리포트가 곧 남은 작업 목록이 된다. 계약 보드(role=="contract") 12장은
// 화면이 아니라 문서라 DOM 대신 문서 문자열과 대조한다(§4.6).
//
// 래칫(§4.5)이 그 실패 목록을 무해하게 만든다: 잠긴 보드가 깨지면 exit 1(회귀),
// 아직 안 잠근 보드가 실패하면 exit 0(미구현). 잠금 단위는 개수가 아니라 **보드 id
// 집합**이다 — 개수로 잡으면 A가 깨지고 B가 새로 붙을 때 회귀를 놓친다.

/**
 * 실패 코드 폐쇄집합. §6.4 변환기가 읽는 유일한 어휘라 늘리면 그쪽도 같이 늘어야 한다.
 *
 * 설계서 §6.4 표의 셋(route_missing · phrase_missing · structure_mismatch)에 넷을 더했다.
 *   reach_failed        도달 절차가 도중에 멈췄다(누를 것이 없다·eval이 던졌다). phrase_missing으로
 *                       뭉치면 「문구를 넣어라」라는 틀린 작업이 나온다 — 고칠 곳은 절차다.
 *   root_not_visible    절차는 다 돌았는데 root가 안 그려졌다. 절차가 만든다고 주장한 상태가
 *                       실제로는 안 만들어진 것이라, 문구 하나하나를 세는 것은 의미가 없다.
 *   contract_undocumented   §4.6이 이름까지 정한 코드.
 *   contract_no_sentence    계약 보드에서 대조할 문장을 한 줄도 못 뽑았다. 이걸 통과로 두면
 *                       그 보드는 아무것도 안 재면서 초록이 된다 — §4.2가 경계하는 공허 통과다.
 */
const SCREEN_FAILURE_CODES = Object.freeze([
  'route_missing',
  'reach_failed',
  'root_not_visible',
  'phrase_missing',
  'structure_mismatch',
  'contract_undocumented',
  'contract_no_sentence',
]);

/**
 * 문구 대조의 정규형. 가시 텍스트 노드를 이어 붙일 때 생기는 개행·중복 공백을 접어
 * 한 줄로 만든다 — Paper가 한 낱말로 그린 「＋ 새 작업」을 앱이 `<span>＋</span> 새 작업`
 * 두 노드로 그려도 같은 문자열이 되게 하려는 것이다. 반대 방향의 대가는 인접한 두
 * 문구가 붙어 없던 문자열이 생기는 것인데, phrases가 3~7개짜리 라벨이라 그 확률이
 * 작고, 놓치는 쪽(공허 통과)보다 이쪽이 안전하다.
 */
function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 라우트 하나의 측정 결과를 실패 목록으로 바꾼다.
 * @param {object} route  라우트표 항목
 * @param {object} measured 렌더러가 잰 것
 *   {reach_error, root_found, root_visible, visible_text, structure: [{index, actual}]}
 */
function routeFailures(route, measured) {
  if (measured.reach_error) {
    return [{
      code: 'reach_failed',
      step: measured.reach_error.step ?? null,
      verb: measured.reach_error.verb ?? null,
      error: String(measured.reach_error.message || measured.reach_error),
    }];
  }
  if (!measured.root_found || !measured.root_visible) {
    return [{
      code: 'root_not_visible',
      root: route.root,
      found: !!measured.root_found,
    }];
  }

  const failures = [];
  const visible = normalizeText(measured.visible_text);
  const missing = route.phrases.filter((phrase) => !visible.includes(normalizeText(phrase)));
  if (missing.length) failures.push({ code: 'phrase_missing', root: route.root, phrases: missing });

  for (const [index, check] of route.structure.entries()) {
    const actual = measured.structure[index]?.actual;
    const expected = check.what === 'absent' ? 0 : check.equals;
    const same = check.what === 'order'
      ? JSON.stringify((actual ?? []).map(normalizeText)) === JSON.stringify((expected ?? []).map(normalizeText))
      : actual === expected;
    if (!same) {
      failures.push({
        code: 'structure_mismatch',
        what: check.what,
        selector: check.selector,
        expected,
        actual: actual ?? null,
      });
    }
  }
  return failures;
}

/** 라우트가 아직 없는 화면 보드. 설계의 핵심이라 skip이 아니라 실패다. */
function routeMissingRecord(board) {
  return {
    board_id: board.id,
    page: board.page,
    name: board.name,
    role: 'screen',
    status: 'fail',
    failures: [{ code: 'route_missing' }],
  };
}

/**
 * 계약 보드에서 대조할 「계약 문장」을 뽑는다(§4.6).
 *
 * 계약 보드의 texts[]는 대부분 표 셀(필드명·TR id·숫자)이고, 그 사이에 한두 줄씩
 * 계약 문장이 섞여 있다. 그래서 둘을 가르는 규칙을 닫아 둔다: **마침표로 끝나고**,
 * 12자 이상이며, 대표 문구 생성기의 하드 제외(E1~E7)에 안 걸리는 줄. 마침표를 쓰는
 * 이유는 이 원장에서 서술문만 마침표를 달기 때문이다 — 「10행 표시 · 더보기 시 …」
 * 같은 나열 줄은 안 단다. 규칙을 넓히면 필드명 수백 개가 계약 문장이 되어 12장이
 * 전부 영원한 빨강이 된다.
 *
 * @param {Array<{text: string}>} texts 원장 texts[]
 * @param {(text: string) => boolean} isHardExcluded E1~E7 판정(주입 — 생성기가 ESM이다)
 */
function contractSentences(texts, isHardExcluded) {
  const seen = new Set();
  for (const node of texts ?? []) {
    const text = String(node.text ?? '').trim();
    if (text.length < 12 || !text.endsWith('.')) continue;
    if (isHardExcluded(text)) continue;
    seen.add(text);
  }
  return [...seen];
}

/**
 * 계약 보드 하나를 문서와 대조한다. Paper에만 있고 문서에 없으면
 * `contract_undocumented` — 「Paper가 새 계약을 그렸는데 아무도 문서에 안 옮겼다」다.
 */
function contractRecord(board, sentences, docs) {
  const record = {
    board_id: board.id,
    page: board.page,
    name: board.name,
    role: 'contract',
    status: 'pass',
    failures: [],
  };
  if (!sentences.length) {
    record.status = 'fail';
    record.failures.push({ code: 'contract_no_sentence' });
    return record;
  }
  const undocumented = sentences.filter((sentence) => !docs.includes(sentence));
  if (undocumented.length) {
    record.status = 'fail';
    record.failures.push({ code: 'contract_undocumented', sentences: undocumented });
  } else {
    record.measured = { sentences: sentences.length };
  }
  return record;
}

/**
 * 래칫 판정(§4.5). 잠긴 보드가 깨진 것만 exit 1이다.
 * @param {object} ratchet 래칫 파일 내용
 * @param {Array<object>} boards 이번 실행의 보드 기록
 * @param {{canonical: boolean}} selection 전수 실행인가(--only면 아니다)
 */
function judgeRatchet(ratchet, boards, selection) {
  const status = new Map(boards.map((board) => [board.board_id, board.status]));
  const locked = new Set(ratchet.passing);
  const regressions = ratchet.passing.filter((id) => status.get(id) === 'fail');
  const newlyPassing = boards
    .filter((board) => board.status === 'pass' && !locked.has(board.board_id))
    .map((board) => board.board_id);
  // 전수 실행에서 잠긴 보드가 결과에 아예 없으면 래칫이 원장과 어긋난 것이다 —
  // 조용히 넘기면 잠금이 사라진 줄 아무도 모른다.
  const missing = selection.canonical ? ratchet.passing.filter((id) => !status.has(id)) : [];
  return {
    regressions,
    newly_passing: newlyPassing,
    missing,
    locked_count: ratchet.passing.length,
    exitCode: regressions.length || missing.length ? 1 : 0,
  };
}

/**
 * `--bless`. `passing`을 키우기만 한다 — 줄이려면 `--allow-shrink --why "<사유>"`가
 * 필요하고 그 축소는 `shrink_log[]`에 남는다. 사유 없는 축소는 거절이다.
 * @returns {{error: string}|{next: object, added: string[], removed: string[]}}
 */
function blessRatchet(ratchet, boards, options) {
  const { allowShrink = false, why = '', at = new Date().toISOString(), targetBoards } = options;
  const passing = boards.filter((board) => board.status === 'pass').map((board) => board.board_id).sort();
  const previous = new Set(ratchet.passing);
  const removed = ratchet.passing.filter((id) => !passing.includes(id));
  const added = passing.filter((id) => !previous.has(id));
  if (removed.length && !allowShrink) {
    return { error: `잠긴 보드 ${removed.length}장이 빠진다 — 축소는 --allow-shrink --why "<사유>"가 필요하다: ${removed.join(', ')}` };
  }
  if (removed.length && !String(why).trim()) {
    return { error: '--allow-shrink 에는 --why "<사유>"가 함께 있어야 한다' };
  }
  return {
    added,
    removed,
    next: {
      ...ratchet,
      blessed_at: at,
      blessed_by: 'verify:paper-screens --bless',
      target_boards: targetBoards ?? ratchet.target_boards,
      passing,
      passing_count: passing.length,
      shrink_log: removed.length
        ? [...(ratchet.shrink_log ?? []), { at, removed, why: String(why).trim() }]
        : (ratchet.shrink_log ?? []),
    },
  };
}

/** CLI 출력과 종료코드. 실패 경로를 테스트가 부를 수 있게 순수 함수로 뽑았다. */
function formatScreensCliReport(runtime, verdict, reportPathLabel) {
  const { totals } = runtime;
  const lines = [
    `[paper-screens] 보드 ${totals.boards}장 · 통과 ${totals.pass} · 실패 ${totals.fail}`
      + `${runtime.selection.canonical ? '' : ' (부분 실행)'}`,
    `  라우트 없음 ${totals.route_missing} · 계약 ${totals.contract_fail}/${totals.contract} 실패 · ${Math.round(runtime.elapsed_ms / 1000)}초`,
  ];
  for (const board of runtime.boards.filter((b) => b.status === 'fail' && b.failures[0].code !== 'route_missing')) {
    const codes = [...new Set(board.failures.map((failure) => failure.code))].join(', ');
    lines.push(`  FAIL ${board.board_id} (${board.page}) — ${codes}`);
  }
  lines.push(`  리포트 ${reportPathLabel}`);
  if (verdict.newly_passing.length) {
    lines.push(`[ratchet] 새로 통과: ${verdict.newly_passing.join(', ')} — --bless로 잠그시오`);
  }
  for (const id of verdict.missing) lines.push(`[ratchet] 잠긴 보드 ${id}가 이번 실행에 없다 — 래칫이 원장과 어긋났다`);
  for (const id of verdict.regressions) lines.push(`[ratchet] 회귀: ${id} — 잠긴 보드가 깨졌다`);
  // 성공 표지는 **아무 보드도 안 빨간** 때만 찍는다. 래칫이 통과시킨 실행은 통과가
  // 아니라 「아직 안 막는다」라서, 빨간 보드를 세어 두고 초록 도장을 찍으면 그 리포트를
  // 아무도 안 본다 — 빨간 목록을 남기는 것이 이 게이트의 산출물이다.
  if (!verdict.exitCode) {
    lines.push(totals.fail
      ? `[ratchet] 잠긴 ${verdict.locked_count}장 유지 — 미구현 ${totals.fail}장은 아직 안 막는다`
      : 'paper screens verification passed');
  }
  return { exitCode: verdict.exitCode, lines };
}

module.exports = {
  SCREEN_FAILURE_CODES,
  blessRatchet,
  contractRecord,
  contractSentences,
  formatScreensCliReport,
  judgeRatchet,
  normalizeText,
  routeFailures,
  routeMissingRecord,
};
