'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTreeRecords } = require('./paper-tree');
const {
  MINI_GRAMMARS,
  MINI_FAILURE_CODES,
  paperMiniRows,
  buildTextIndex,
  classifyValue,
  compareMiniCard,
  parseNoteAnnotation,
  compareMiniNote,
  templateGrammarOf,
  grammarCoverage,
  templateEnvelopeSpec,
} = require('./paper-mini-compare');

// 카드미니 게이트가 판정을 짓는 순수 규칙만 여기서 잠근다. 파일 I/O와 리포트 병합은
// 각각 scripts/paper-mini-static.mjs 와 paper-mini-report.js 의 몫이다.

const CARD_TREE = [
  'Frame "mini/CC-01 / R10 · 내 계좌" (AA-0) 360×420',
  '  Frame "Header" (AB-0) 0×0',
  '    Frame "Meta row" (AC-0) 0×0',
  '      Text "Eyebrow" (AD-0) 0×0 "복합형"',
  '      Text "As of" (AE-0) 0×0 "기준 09:42"',
  '    Text "Title" (AF-0) 0×0 "내 계좌"',
  '  Frame "Body" (AG-0) 0×0',
  '    Frame "KPI band" (AH-0) 0×0',
  '      Frame "Frame" (AI-0) 0×0',
  '        Text "총 평가금액" (AJ-0) 0×0 "총 평가금액"',
  '        Text "값" (AK-0) 0×0 "124,580,240원"',
  '      Frame "Frame" (AL-0) 0×0',
  '        Text "평가손익" (AM-0) 0×0 "평가손익"',
  '        Text "값" (AN-0) 0×0 "+4.96%"',
  '    Frame "Table header" (AO-0) 0×0',
  '      Text "종목" (AP-0) 0×0 "종목"',
  '      Text "평가금액" (AQ-0) 0×0 "평가금액"',
  '    Frame "Position 1" (AR-0) 0×0',
  '      Frame "Frame" (AS-0) 0×0',
  '        Text "삼성전자" (AT-0) 0×0 "삼성전자"',
  '        Text "005930" (AU-0) 0×0 "005930"',
  '      Text "평가금액" (AV-0) 0×0 "41,483,750"',
  '  Frame "Fold note" (AW-0) 0×0',
  '    Text "접힘" (AX-0) 0×0 "외 6건 접힘 · 원본에서 확인"',
].join('\n');

// ---------------------------------------------------------------- 행 뽑기

test('paperMiniRows takes Body cells and reads the first text as the label', () => {
  const rows = paperMiniRows(parseTreeRecords(CARD_TREE));
  assert.deepEqual(rows, [
    { group: 'KPI band', label: '총 평가금액', values: ['124,580,240원'] },
    { group: 'KPI band', label: '평가손익', values: ['+4.96%'] },
    { group: 'Position 1', label: '삼성전자', values: ['005930', '41,483,750'] },
  ]);
});

test('paperMiniRows skips the table header — 미니 카드에는 표 머리글 개념이 없다', () => {
  const groups = paperMiniRows(parseTreeRecords(CARD_TREE)).map((row) => row.group);
  assert.ok(!groups.includes('Table header'));
});

test('paperMiniRows keeps a single-text cell as a value with no label', () => {
  const rows = paperMiniRows(parseTreeRecords([
    'Frame "mini/x" (AA-0) 360×420',
    '  Frame "Body" (AB-0) 0×0',
    '    Frame "Auth status" (AC-0) 0×0',
    '      Text "상태" (AD-0) 0×0 "인증됨"',
  ].join('\n')));
  assert.deepEqual(rows, [{ group: 'Auth status', label: '', values: ['인증됨'] }]);
});

test('paperMiniRows returns nothing when the board has no Body frame', () => {
  assert.deepEqual(paperMiniRows(parseTreeRecords('Frame "mini/x" (AA-0) 360×420')), []);
});

// ---------------------------------------------------------------- 3분류

const INDEX = buildTextIndex([
  { board_id: '2SCE-1', texts: ['124,580,240원', '+4.96%', '8종목', '005930', '41,483,750'] },
  { board_id: '3UTA-0', texts: ['21,824,000', '+3.17%'] },
]);

const context = (over = {}) => ({
  ledgerBoardId: '2SCE-1',
  ledgerValues: new Set(['124,580,240원', '수익률 +4.96%', '8종목']),
  ownSlots: new Set(['124,580,240원', '+4.96%', '8종목', '005930', '41,483,750']),
  index: INDEX,
  ...over,
});

test('classifyValue calls an exact ledger value backed', () => {
  assert.equal(classifyValue('124,580,240원', context()), null);
});

test('classifyValue calls a containment pair a form deviation — 같은 데이터의 표기 차', () => {
  // 대장은 "수익률 +4.96%", Paper는 접두어를 라벨로 올리고 "+4.96%"만 그린다.
  assert.equal(classifyValue('+4.96%', context()).code, 'paper_form_deviation');
  // "8"은 대장 "8종목"이 단위를 값에 안고 있는 같은 데이터다.
  assert.equal(classifyValue('8', context()).code, 'paper_form_deviation');
});

test('classifyValue calls a value backed by the same board slot ledger_stale', () => {
  const found = classifyValue('41,483,750', context({ ledgerValues: new Set(['8종목']) }));
  assert.equal(found.code, 'ledger_stale');
  assert.equal(found.found_in, '2SCE-1');
});

test('classifyValue calls a value that only another board carries paper_cross_board', () => {
  const found = classifyValue('21,824,000', context({ ledgerValues: new Set(['8종목']) }));
  assert.equal(found.code, 'paper_cross_board');
  assert.equal(found.found_in, '3UTA-0');
});

test('classifyValue calls a value no board carries unbacked', () => {
  assert.equal(classifyValue('99,999원', context({ ledgerValues: new Set(['8종목']) })).code, 'unbacked');
});

test('classifyValue never calls a one-character value cross-board — 한 글자는 어디에나 있다', () => {
  const index = buildTextIndex([{ board_id: '3UTA-0', texts: ['8'] }]);
  const found = classifyValue('8', context({ ledgerValues: new Set(['없음']), ownSlots: new Set(), index }));
  assert.equal(found.code, 'unbacked');
});

// ---------------------------------------------------------------- 보드 판정

const record = (over = {}) => ({
  board_id: '2SCE-1',
  grammar: 'compound',
  title: '내 계좌',
  source_board: 'CC-01 / R10 · 내 계좌',
  elements: [
    { label: '총 평가금액', paper_text: '124,580,240원' },
    { label: '총수익률(%)', paper_text: '수익률 +4.96%' },
    { label: '계좌평가잔고개별합산', paper_text: '보유종목 8종목' },
  ],
  annotation: {},
  ...over,
});

test('compareMiniCard reports the divergent rows and the ledger elements Paper never draws', () => {
  const result = compareMiniCard({
    rows: paperMiniRows(parseTreeRecords(CARD_TREE)),
    record: record(),
    ownSlots: new Set(['124,580,240원', '+4.96%', '8종목', '005930', '41,483,750']),
    index: INDEX,
  });
  assert.equal(result.status, 'divergent');
  assert.equal(result.paper_rows, 3);
  assert.deepEqual(result.rows.map((row) => row.code), ['paper_form_deviation', 'ledger_stale']);
  assert.deepEqual(result.missing_in_paper, [
    { label: '계좌평가잔고개별합산', paper_text: '보유종목 8종목' },
  ]);
});

test('compareMiniCard calls a board matched only when nothing is left over on either side', () => {
  const result = compareMiniCard({
    rows: [{ group: 'Fact 1', label: '총 평가금액', values: ['124,580,240원'] }],
    record: record({ elements: [{ label: '총 평가금액', paper_text: '124,580,240원' }] }),
    ownSlots: new Set(),
    index: INDEX,
  });
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.missing_in_paper, []);
});

// ---------------------------------------------------------------- 주석 보드

const NOTE_TEXTS = [
  '원본 보드: CC-01 / R10 · 내 계좌',
  '가져온 요소: 총 평가금액 · 총수익률(%)',
  '문법: compound',
  '접은 개수: 항목 109개',
];

test('parseNoteAnnotation reads the four labelled lines and keeps the fold count with its unit', () => {
  assert.deepEqual(parseNoteAnnotation(NOTE_TEXTS), {
    source_board: 'CC-01 / R10 · 내 계좌',
    elements: '총 평가금액 · 총수익률(%)',
    grammar: 'compound',
    folded: '항목 109개',
    fold: { count: 109, unit: '항목' },
    unknown_lines: [],
  });
});

test('compareMiniNote passes when the annotation says what the ledger says', () => {
  const result = compareMiniNote({
    texts: NOTE_TEXTS,
    record: record({
      annotation: {
        source_board: 'CC-01 / R10 · 내 계좌',
        elements: '총 평가금액 · 총수익률(%)',
        grammar: 'compound',
        folded: '외 109개 항목을 접었어요 · 원본에서 확인',
      },
    }),
  });
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.drift, []);
});

test('compareMiniNote reports each field that drifted, fold count and unit included', () => {
  const result = compareMiniNote({
    texts: NOTE_TEXTS,
    record: record({
      annotation: {
        source_board: 'CC-01 / R10 · 내 계좌',
        elements: '계좌명 · 수익률',
        grammar: 'facts',
        folded: '외 7개 행을 접었어요 · 원본에서 확인',
      },
    }),
  });
  assert.equal(result.status, 'divergent');
  assert.deepEqual(result.drift.map((entry) => entry.field), ['elements', 'grammar', 'fold']);
});

// ---------------------------------------------------------------- 문법 커버리지

test('templateGrammarOf reads the grammar out of the board name', () => {
  assert.equal(templateGrammarOf('template/stream', new Map()), 'stream');
});

test('templateGrammarOf resolves an exemplar board name through the ledger', () => {
  assert.equal(templateGrammarOf('template/2SCE-1', new Map([['2SCE-1', 'compound']])), 'compound');
  assert.equal(templateGrammarOf('template/2SCE-1', new Map()), null);
});

test('grammarCoverage names the grammars no template board draws', () => {
  const covered = grammarCoverage([
    { board_id: '45S7-0', grammar: 'compound' },
    { board_id: '45SH-0', grammar: 'compound' },
  ]);
  assert.deepEqual(covered.covered, ['compound']);
  assert.deepEqual(covered.uncovered, MINI_GRAMMARS.filter((g) => g !== 'compound'));
  assert.equal(covered.ok, false);
});

test('grammarCoverage is ok exactly when all ten grammars are drawn', () => {
  const all = grammarCoverage(MINI_GRAMMARS.map((grammar, i) => ({ board_id: `B${i}-0`, grammar })));
  assert.equal(all.ok, true);
  assert.deepEqual(all.uncovered, []);
});

test('MINI_GRAMMARS matches build_kiumi_registry.py GRAMMARS and MINI_FAILURE_CODES is closed', () => {
  assert.equal(MINI_GRAMMARS.length, 10);
  assert.ok(MINI_GRAMMARS.includes('order_ticket') && MINI_GRAMMARS.includes('reader'));
  assert.ok(MINI_FAILURE_CODES.includes('grammar_uncovered'));
  assert.ok(Object.isFrozen(MINI_GRAMMARS) && Object.isFrozen(MINI_FAILURE_CODES));
});

// ---------------------------------------------------------------- 견본 봉투

test('templateEnvelopeSpec turns a template board into a fixed kiumi spec the runtime accepts', () => {
  const spec = templateEnvelopeSpec({
    boardId: '45S7-0',
    grammar: 'compound',
    records: parseTreeRecords(CARD_TREE),
  });
  assert.equal(spec.kiumi.version, 1);
  assert.equal(spec.kiumi.fixed, true);
  assert.equal(spec.kiumi.width_px, 360);
  assert.equal(spec.kiumi.height_px, 420);
  assert.equal(spec.kiumi.grammar, 'compound');
  assert.equal(spec.kiumi.title, '내 계좌');
  assert.equal(spec.caption, '기준 09:42');
  assert.equal(spec.kiumi.fold_note, '외 6건 접힘 · 원본에서 확인');
  assert.deepEqual(spec.kiumi.elements.map((e) => [e.label, e.paper_text, e.role]), [
    ['총 평가금액', '124,580,240원', 'primary'],
    ['평가손익', '+4.96%', 'secondary'],
    ['삼성전자', '005930 · 41,483,750', 'row'],
  ]);
});

test('templateEnvelopeSpec caps elements at the five the ledger never exceeds', () => {
  const rows = Array.from({ length: 9 }, (_, i) => `    Frame "Fact ${i}" (F${i}-0) 0×0\n      Text "l" (L${i}-0) 0×0 "라벨${i}"\n      Text "v" (V${i}-0) 0×0 "값${i}"`);
  const spec = templateEnvelopeSpec({
    boardId: '45S9-0',
    grammar: 'facts',
    records: parseTreeRecords(['Frame "template/facts" (AA-0) 360×420', '  Frame "Body" (AB-0) 0×0', ...rows].join('\n')),
  });
  assert.equal(spec.kiumi.elements.length, 5);
  assert.deepEqual(spec.kiumi.elements.map((e) => e.role), ['fact', 'fact', 'fact', 'fact', 'fact']);
});
