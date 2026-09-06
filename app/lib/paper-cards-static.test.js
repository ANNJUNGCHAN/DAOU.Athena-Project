'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const checkerPath = path.join(__dirname, '..', 'scripts', 'paper-cards-static.mjs');

let mod;
const load = async () => {
  if (!mod) mod = await import(require('node:url').pathToFileURL(checkerPath).href);
  return mod;
};

const fs = require('node:fs');
const os = require('node:os');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'backend', 'ref', 'card-surface-templates');
const LEDGER_DIR = path.join(__dirname, '..', '..', 'backend', 'ref', 'paper-ledger');

/** 템플릿 한 장만 임시 디렉터리로 베껴 slots.json을 어긋내고, 그 한 장짜리 색인을 함께 낸다. */
function copyTemplateWithDrift(boardId, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-cards-static-'));
  fs.mkdirSync(path.join(dir, boardId));
  for (const file of ['slots.json', 'regions.json', 'paper.tree.txt']) {
    fs.copyFileSync(path.join(TEMPLATES_DIR, boardId, file), path.join(dir, boardId, file));
  }
  const slotsPath = path.join(dir, boardId, 'slots.json');
  const slots = JSON.parse(fs.readFileSync(slotsPath, 'utf8'));
  mutate(slots);
  fs.writeFileSync(slotsPath, JSON.stringify(slots));
  const index = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'index.json'), 'utf8'));
  const cardIndexPath = path.join(dir, 'index.json');
  fs.writeFileSync(cardIndexPath, JSON.stringify({
    ...index,
    boards: index.boards.filter((board) => board.board_id === boardId),
  }));
  return { templatesDir: dir, cardIndexPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ---------- 트리 정규형: 두 추출기의 표기 차이를 접고 내용 차이만 남긴다 ----------

test('parseTreeRecords drops geometry and keeps depth, kind, node id and text', async () => {
  const { parseTreeRecords } = await load();
  const records = parseTreeRecords('Frame "루트" (AA-0) 100×50\n  Text "값" (BB-0) 10×5 "값"\n');
  assert.deepEqual(records, [
    { depth: 0, kind: 'Frame', name: '루트', id: 'AA-0', text: '' },
    { depth: 1, kind: 'Text', name: '값', id: 'BB-0', text: '값' },
  ]);
});

test('parseTreeRecords folds a text that the ledger extractor spread over several lines', async () => {
  const { parseTreeRecords } = await load();
  // 원장은 텍스트 안 개행을 실제 개행으로 적어 한 노드가 두 줄을 차지한다.
  const ledger = parseTreeRecords('Text "매도 잔량 직전대비" (AA-0) 85×32 "매도 잔량\n직전대비"');
  // 템플릿 추출기는 같은 자리를 두 글자 `\n`으로 적는다.
  const template = parseTreeRecords('Text "매도 잔량 직전대비" (AA-0) 85×32 "매도 잔량\\n직전대비"');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].text, '매도 잔량\\n직전대비');
  assert.equal(template[0].text, ledger[0].text);
});

test('parseTreeRecords does not let a trailing newline leak into the last record', async () => {
  const { parseTreeRecords } = await load();
  const withNewline = parseTreeRecords('Text "값" (AA-0) 10×5 "값"\n');
  const without = parseTreeRecords('Text "값" (AA-0) 10×5 "값"');
  assert.deepEqual(withNewline, without);
});

test('subtreeAt re-roots the ledger tree at the node the template tree starts from', async () => {
  const { parseTreeRecords, subtreeAt } = await load();
  const records = parseTreeRecords([
    'Frame "보드" (BOARD-0) 100×50',
    '  Frame "표면" (SURF-0) 90×40',
    '    Text "값" (VAL-0) 10×5 "값"',
    '  Frame "옆" (SIDE-0) 10×10',
  ].join('\n'));
  assert.deepEqual(subtreeAt(records, 'SURF-0').map((r) => [r.depth, r.id]), [[0, 'SURF-0'], [1, 'VAL-0']]);
  assert.equal(subtreeAt(records, 'NOPE-0'), null);
});

test('nameMatches tolerates the ellipsis truncation but not a real rename', async () => {
  const { nameMatches } = await load();
  assert.ok(nameMatches('● 증거금 재원·담보 실시간 반영 …', '● 증거금 재원·담보 실시간 반영 중'));
  assert.ok(nameMatches('같은 이름', '같은 이름'));
  assert.ok(!nameMatches('증거금 재원', '담보 실시간'));
  assert.ok(!nameMatches('증거금 …', '담보 실시간 반영 중'));
});

test('diffTreeRecords reports a recreated Paper node instead of passing it', async () => {
  const { parseTreeRecords, diffTreeRecords } = await load();
  const template = parseTreeRecords('Text "035720" (3EON-0) 10×5 "035720"');
  const ledger = parseTreeRecords('Text "035720" (3EOP-0) 10×5 "035720"');
  assert.deepEqual(diffTreeRecords(template, ledger).map((d) => [d.at, d.reason]), [[0, 'node_id']]);
});

test('diffTreeRecords reports text that Paper changed under an unchanged node', async () => {
  const { parseTreeRecords, diffTreeRecords } = await load();
  const template = parseTreeRecords('Text "합계" (AA-0) 10×5 "매도 유입 35,809,090원 "');
  const ledger = parseTreeRecords('Text "합계" (AA-0) 10×5 "매도 유입 35,809,090원 · 입금 5,054,300원"');
  assert.deepEqual(diffTreeRecords(template, ledger).map((d) => [d.at, d.reason]), [[0, 'text']]);
});

test('diffTreeRecords reports a node the other side does not have at all', async () => {
  const { parseTreeRecords, diffTreeRecords } = await load();
  const template = parseTreeRecords('Frame "루트" (AA-0) 10×5\n  Text "값" (BB-0) 10×5 "값"');
  const ledger = parseTreeRecords('Frame "루트" (AA-0) 10×5');
  assert.deepEqual(diffTreeRecords(template, ledger).map((d) => [d.at, d.reason]), [[1, 'ledger_shorter']]);
});

test('diffTreeRecords ignores geometry — a fit-content collapse to 0×0 is not drift', async () => {
  const { parseTreeRecords, diffTreeRecords } = await load();
  const template = parseTreeRecords('Frame "머리" (AA-0) 1358×106');
  const ledger = parseTreeRecords('Frame "머리" (AA-0) 0×0');
  assert.deepEqual(diffTreeRecords(template, ledger), []);
});

// ---------- 텍스트 다중집합 ----------

test('diffTextMultiset splits drift into added, removed and count_changed', async () => {
  const { diffTextMultiset } = await load();
  assert.deepEqual(diffTextMultiset({ 같음: 2, 원장만: 1, 셈: 1 }, { 같음: 2, slots만: 1, 셈: 3 }), {
    added: [{ text: 'slots만', count: 1 }],
    removed: [{ text: '원장만', count: 1 }],
    count_changed: [{ text: '셈', ledger: 1, slots: 3 }],
  });
});

test('diffTextMultiset stays exact — one extra occurrence is drift, not noise', async () => {
  const { diffTextMultiset } = await load();
  const drift = diffTextMultiset({ 거래량: 1 }, { 거래량: 2 });
  assert.deepEqual(drift.count_changed, [{ text: '거래량', ledger: 1, slots: 2 }]);
});

test('narrowMultisetToCardRoot drops only the text that sits outside the card root', async () => {
  const { parseTreeRecords, narrowMultisetToCardRoot } = await load();
  const records = parseTreeRecords([
    'Frame "보드" (BOARD-0) 100×50',
    '  Frame "검증 헤더" (NOTE-0) 90×10',
    '    Text "검증 주석" (NOTE1-0) 10×5 "검증 주석"',
    '  Frame "표면" (SURF-0) 90×40',
    '    Text "값" (VAL-0) 10×5 "값"',
  ].join('\n'));
  const narrowed = narrowMultisetToCardRoot({ '검증 주석': 1, 값: 1 }, records, 'SURF-0');
  assert.deepEqual(narrowed.multiset, { 값: 1 });
  assert.deepEqual(narrowed.excluded, [{ node_id: 'NOTE1-0', text: '검증 주석' }]);
});

test('narrowMultisetToCardRoot is the identity when every text sits under the card root', async () => {
  const { parseTreeRecords, narrowMultisetToCardRoot } = await load();
  const records = parseTreeRecords('Frame "표면" (SURF-0) 90×40\n  Text "값" (VAL-0) 10×5 "값"');
  const ledger = { 값: 1 };
  assert.deepEqual(narrowMultisetToCardRoot(ledger, records, 'SURF-0').multiset, ledger);
  // 루트가 원장 트리에 없으면 좁히지 않는다 — 호출자가 원장 다중집합을 그대로 잰다.
  assert.equal(narrowMultisetToCardRoot(ledger, records, 'NOPE-0'), null);
});

test('the card root narrowing changes exactly one board of the 96', async () => {
  const { parseTreeRecords, narrowMultisetToCardRoot, checkPaperCardsStatic } = await load();
  const manifest = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, 'manifest.json'), 'utf8'));
  const pageOf = new Map(manifest.boards.map((board) => [board.id, String(board.page)]));
  const index = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'index.json'), 'utf8'));

  // 좁힌 다중집합과 안 좁힌 원장 다중집합을 보드마다 직접 대서 달라지는 보드를 센다 —
  // 전수 초록만 보면 나중에 다른 보드가 카드 루트 밖 텍스트를 갖게 돼도 초록으로 남는다.
  const narrowedBoards = [];
  const unrooted = [];
  for (const entry of index.boards) {
    const boardId = entry.board_id;
    const page = pageOf.get(boardId);
    const ledger = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, page, `${boardId}.json`), 'utf8'));
    const records = parseTreeRecords(fs.readFileSync(path.join(LEDGER_DIR, page, `${boardId}.tree.txt`), 'utf8'));
    const regions = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, boardId, 'regions.json'), 'utf8'));
    const raw = ledger.text_multiset ?? {};
    const narrowed = narrowMultisetToCardRoot(raw, records, regions.root);
    if (!narrowed) {
      unrooted.push(boardId);
      continue;
    }
    try {
      assert.deepEqual(narrowed.multiset, raw);
    } catch {
      narrowedBoards.push(boardId);
    }
  }
  assert.deepEqual(unrooted, [], '카드 루트가 원장 트리에 없으면 좁히기가 조용히 꺼진다');
  assert.deepEqual(narrowedBoards, ['1WOB-1']);

  // 그리고 그 한 장에서 좁히기가 덜어내는 것은 카드 루트 밖 검증 주석이다.
  const report = checkPaperCardsStatic({ runPython: false });
  assert.deepEqual(report.static.S2_text_multiset.failed_boards, []);
  assert.equal(report.boards.find((board) => board.board_id === '1WOB-1').status, 'pass');
});

// ---------- 전수 판정 ----------

test('the static gate runs all 96 card templates and names every red board', async () => {
  const { checkPaperCardsStatic, STATIC_FAILURE_CODES } = await load();
  const report = checkPaperCardsStatic({ runPython: false });

  assert.equal(report.totals.boards, 96);
  assert.equal(report.boards.length, 96);
  assert.equal(report.totals.pass + report.totals.fail, 96);
  assert.equal(report.totals.mount_fail, null, '마운트 층은 이 스크립트가 재지 않는다');

  // S1·S6은 이 전제가 서 있어야 나머지 판정이 뜻을 갖는다.
  assert.deepEqual(report.static.S1_manifest.failures, []);
  assert.ok(report.static.S6_index_symmetry.ok, JSON.stringify(report.static.S6_index_symmetry));

  // 실패 보드는 반드시 폐쇄집합 코드로 이름 붙어야 §6.4 변환기가 읽는다.
  for (const board of report.boards) {
    assert.ok(board.status === 'pass' || board.status === 'fail');
    assert.equal(board.status === 'fail', board.failures.length > 0, board.board_id);
    for (const failure of board.failures) {
      assert.ok(STATIC_FAILURE_CODES.includes(failure.code), `${board.board_id}: ${failure.code}`);
      assert.equal(failure.layer, 'static');
    }
  }
  const named = report.boards.filter((board) => board.status === 'fail').map((board) => board.board_id);
  assert.deepEqual(
    named.slice().sort(),
    [...new Set([...report.static.S2_text_multiset.failed_boards, ...report.static.S4_paper_tree.failed_boards])].sort(),
  );
});

test('the state link closure over the 96 index stays shut', async () => {
  const { checkPaperCardsStatic } = await load();
  const { static: checks } = checkPaperCardsStatic({ runPython: false });
  assert.deepEqual(checks.S3_state_links.unresolved, []);
  assert.equal(checks.S3_state_links.targets, 83);
});

test('a drifting board reports which slot and which ledger node the text came from', async () => {
  const { checkPaperCardsStatic } = await load();
  // 96장은 전부 초록이라 이 리포트 경로를 실물로 밟으려면 어긋남을 하나 만들어야 한다.
  // 원장은 실물 그대로 두고 템플릿 한 장만 임시로 베껴 slots 다중집합을 어긋내 본다.
  const drifted = copyTemplateWithDrift('1WOB-1', (slots) => {
    slots.text_multiset = { ...slots.text_multiset, '외국인 기간별 매매 상위': 99 };
  });
  const report = checkPaperCardsStatic({
    templatesDir: drifted.templatesDir,
    cardIndexPath: drifted.cardIndexPath,
    runPython: false,
  });
  const record = report.boards.find((entry) => entry.board_id === '1WOB-1');
  const failure = record.failures.find((f) => f.code === 'text_multiset_drift');
  assert.ok(failure, JSON.stringify(record));
  const sample = [...failure.added, ...failure.removed, ...failure.count_changed][0];
  assert.ok(sample.where, '어긋난 텍스트마다 출처가 붙어야 한다');
  assert.ok(Array.isArray(sample.where.slots) && Array.isArray(sample.where.ledger_nodes));
  assert.ok(sample.where.slots.length + sample.where.ledger_nodes.length > 0, sample.text);
  drifted.cleanup();
});

// ---------- CLI ----------

test('the CLI exits nonzero when a board is red and zero only when nothing is', async () => {
  const { formatCliReport } = await load();
  const base = {
    totals: { boards: 96, pass: 96, fail: 0, static_fail: 0, mount_fail: null },
    gate_failures: [],
    static: {
      S1_manifest: { ok: true, failures: [] },
      S2_text_multiset: { ok: true, failed_boards: [] },
      S3_state_links: { ok: true, marks: 80, targets: 83, unresolved: [] },
      S4_paper_tree: { ok: true, failed_boards: [] },
      S5_registry_drift: { ok: true, skipped: true },
      S6_index_symmetry: { ok: true, generated: 97, extra: [], absent: [] },
    },
  };
  const passed = formatCliReport(base);
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.lines.at(-1), 'paper cards static verification passed');

  const red = JSON.parse(JSON.stringify(base));
  red.totals = { boards: 96, pass: 94, fail: 2, static_fail: 2, mount_fail: null };
  red.static.S2_text_multiset = { ok: false, failed_boards: ['2QM7-2'] };
  const failed = formatCliReport(red);
  assert.equal(failed.exitCode, 1);
  assert.ok(failed.lines.some((line) => line.includes('2QM7-2')));
  assert.ok(!failed.lines.includes('paper cards static verification passed'));
});

test('a broken precondition fails the gate even when no board is red', async () => {
  const { formatCliReport } = await load();
  const report = {
    totals: { boards: 96, pass: 96, fail: 0, static_fail: 0, mount_fail: null },
    gate_failures: [{ code: 'registry_stale', layer: 'static', exit_code: 1 }],
    static: {
      S1_manifest: { ok: true, failures: [] },
      S2_text_multiset: { ok: true, failed_boards: [] },
      S3_state_links: { ok: true, marks: 80, targets: 83, unresolved: [] },
      S4_paper_tree: { ok: true, failed_boards: [] },
      S5_registry_drift: { ok: false, skipped: false, exit_code: 1 },
      S6_index_symmetry: { ok: true, generated: 97, extra: [], absent: [] },
    },
  };
  assert.equal(formatCliReport(report).exitCode, 1);
});
