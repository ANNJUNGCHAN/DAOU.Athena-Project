'use strict';

// 카드미니 전수 게이트(설계서 §5)의 판정 규칙. 파일을 안 읽고 리포트를 안 쓴다 —
// 여기 있는 것은 「Paper H-1이 말하는 카드미니」와 「backend/ref/kiumi/kiumi-ledger.jsonl이
// 말하는 카드미니」를 맞대는 순수 함수뿐이다.
//
// ── 정본 결정(설계서 §5.2)
// 사용자 지시는 「Paper가 정본」이지만 backend/ref/kiumi/README.md의 2026-09-04 실측은
// 대장 우위로 판단했다. 이 모듈은 어느 쪽도 고치지 않는다. 어긋남을 세어 네 부류로 가르고,
// `paper_cross_board`가 0이 되기 전에는 대장을 손대지 않는다는 README의 순서를 그대로 둔다.
//
// ── 왜 라벨이 아니라 값만 대조하나
// Paper의 라벨은 화면에 보이는 말(`총 평가금액`)이고 대장의 `label`은 필드 이름
// (`계좌평가잔고개별합산`)이다. 둘을 같은 것으로 놓고 재면 96장 전부가 라벨 때문에 빨개져
// 진짜 값 어긋남이 묻힌다. 그래서 판정은 **셀의 값 텍스트**로만 한다.

/** `scripts/build_kiumi_registry.py:20-31` GRAMMARS 10종. 늘리려면 그쪽도 같이 바꾼다. */
const MINI_GRAMMARS = Object.freeze([
  'auth', 'chart', 'compound', 'event', 'facts',
  'order_confirm', 'order_ticket', 'reader', 'stream', 'table',
]);

/** 리포트에 붙는 실패 코드 폐쇄집합(설계서 §5.2·§5.3.3). §6.4 변환기가 읽는 유일한 어휘다. */
const MINI_FAILURE_CODES = Object.freeze([
  'ledger_unmatched',
  'paper_cross_board',
  'paper_form_deviation',
  'ledger_stale',
  'unbacked',
  'missing_in_paper',
  'annotation_drift',
  'grammar_uncovered',
]);

/** 카드미니 한 장이 그리는 행 상한. 대장 96행의 실측 최대치가 5다. */
const MAX_TEMPLATE_ELEMENTS = 5;

const clean = (value) => String(value ?? '').trim();

// ---------------------------------------------------------------- 트리에서 행 뽑기

/** `records[i]`의 직속 자식 인덱스. */
function childIndexes(records, i) {
  const out = [];
  const depth = records[i].depth;
  for (let k = i + 1; k < records.length && records[k].depth > depth; k += 1) {
    if (records[k].depth === depth + 1) out.push(k);
  }
  return out;
}

/** `records[i]` 아래(자기 포함)의 텍스트를 문서 순서대로. 빈 텍스트는 버린다. */
function leafTexts(records, i) {
  const out = [];
  const depth = records[i].depth;
  const take = (k) => { if (records[k].kind === 'Text') { const t = clean(records[k].text); if (t) out.push(t); } };
  take(i);
  for (let k = i + 1; k < records.length && records[k].depth > depth; k += 1) take(k);
  return out;
}

/**
 * 카드미니 보드 한 장의 Body에서 행을 뽑는다.
 *
 * Body 직속 자식이 한 그룹이고, 그 그룹이 프레임 자식을 둘 이상 가지면(예 `KPI band`가
 * 칸 세 개를 안는다) 그 프레임 하나하나가 행이다. 아니면 그룹 자체가 한 행이다.
 * 행의 첫 텍스트가 라벨, 나머지가 값이다 — 텍스트가 하나뿐이면 라벨이 없는 값이다.
 *
 * `Table header`는 건너뛴다. 미니 카드 렌더러에는 표 머리글 개념이 없어서
 * (`app/lib/orb-mini-card.js`는 라벨·값 행만 만든다) 그것을 행으로 세면
 * Paper에만 있는 행이 96장 전부에 하나씩 늘어난다 — Paper 내용의 차이가 아니다.
 */
function paperMiniRows(records) {
  const bodyIndex = records.findIndex((record) => record.name === 'Body');
  if (bodyIndex < 0) return [];
  const rows = [];
  for (const group of childIndexes(records, bodyIndex)) {
    if (records[group].name === 'Table header') continue;
    const frames = childIndexes(records, group).filter((k) => records[k].kind !== 'Text');
    for (const cell of frames.length >= 2 ? frames : [group]) {
      const texts = leafTexts(records, cell);
      if (!texts.length) continue;
      rows.push({
        group: records[group].name,
        label: texts.length > 1 ? texts[0] : '',
        values: texts.length > 1 ? texts.slice(1) : texts,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- 역색인과 3분류

/**
 * 카드 표면 96장의 텍스트 역색인. 값 하나가 어느 보드에서 왔는지 되찾는 데 쓴다.
 * @param {{board_id:string, texts:Iterable<string>}[]} entries
 * @returns {Map<string, string[]>} 텍스트 → 그것을 가진 보드 id (정렬)
 */
function buildTextIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const raw of entry.texts) {
      const text = clean(raw);
      if (!text) continue;
      if (!index.has(text)) index.set(text, new Set());
      index.get(text).add(entry.board_id);
    }
  }
  return new Map([...index].map(([text, boards]) => [text, [...boards].sort()]));
}

/**
 * 값 텍스트 하나를 판정한다. 대장이 그 값을 그대로 들고 있으면 `null`(어긋남 없음)이고,
 * 아니면 설계서 §5.2의 부류 하나를 돌려준다.
 *
 * 순서에 뜻이 있다.
 *   1. 표기 차를 먼저 걷어낸다 — 같은 데이터가 다르게 적힌 것을 「다른 보드에서 왔다」고
 *      부르면 Paper 결함 수가 부풀어 §5.2의 판단 근거가 망가진다.
 *   2. 그 다음 자기 보드 표면에 있는가(대장이 다른 슬롯을 골랐다 = `ledger_stale`).
 *   3. 그 다음 남의 보드 표면에만 있는가(= `paper_cross_board`, Paper 결함).
 *   4. 어디에도 없으면 `unbacked`.
 *
 * 한 글자 값은 3번에서 제외한다. `8` 같은 값은 96장 어디에나 있어서 색인에 걸리기만 하면
 * 전부 Paper 결함이 되어 버린다 — 그건 측정이 아니라 잡음이다.
 */
function classifyValue(value, { ledgerValues, ownSlots, index, ledgerBoardId }) {
  const text = clean(value);
  if (!text || ledgerValues.has(text)) return null;
  for (const ledgerText of ledgerValues) {
    if (ledgerText.length >= 2 && (ledgerText.includes(text) || text.includes(ledgerText))) {
      return { code: 'paper_form_deviation', text, found_in: ledgerBoardId };
    }
  }
  if (ownSlots.has(text)) return { code: 'ledger_stale', text, found_in: ledgerBoardId };
  const boards = text.length >= 2 ? (index.get(text) || []) : [];
  const others = boards.filter((board) => board !== ledgerBoardId);
  if (others.length) return { code: 'paper_cross_board', text, found_in: others[0], boards: others };
  return { code: 'unbacked', text };
}

/**
 * `mini/` 보드 한 장을 대장 한 행과 맞댄다.
 * @returns {{status:string, paper_rows:number, rows:object[], missing_in_paper:object[]}}
 */
function compareMiniCard({ rows, record, ownSlots, index }) {
  const ledgerValues = new Set(record.elements.map((element) => clean(element.paper_text)).filter(Boolean));
  const context = { ledgerValues, ownSlots, index, ledgerBoardId: record.board_id };
  const divergent = [];
  for (const row of rows) {
    const found = row.values.map((value) => classifyValue(value, context)).filter(Boolean);
    if (!found.length) continue;
    // 한 행에 여러 값이 어긋나면 첫 값이 그 행의 부류다 — 행 하나는 작업 하나이기 때문이다.
    divergent.push({ ...found[0], label: row.label, value: row.values.join(' · '), group: row.group });
  }
  // 그려진 것으로 치는 범위는 정확 일치 + 표기 차다. 표기 차를 빼면 같은 데이터 하나가
  // 행 쪽에서 `paper_form_deviation`으로 한 번, 여기서 `missing_in_paper`로 또 한 번 세어져
  // 대장 쪽 결손이 실제보다 부풀어 오른다.
  const drawn = [...new Set(rows.flatMap((row) => [row.label, ...row.values]).map(clean).filter(Boolean))];
  const drawnSet = new Set(drawn);
  const isDrawn = (text) => drawnSet.has(text)
    || drawn.some((shown) => shown.length >= 2 && text.length >= 2 && (shown.includes(text) || text.includes(shown)));
  const missing = record.elements
    .filter((element) => !isDrawn(clean(element.paper_text)))
    .map((element) => ({ label: clean(element.label), paper_text: clean(element.paper_text) }));
  return {
    status: divergent.length || missing.length ? 'divergent' : 'matched',
    paper_rows: rows.length,
    rows: divergent,
    missing_in_paper: missing,
  };
}

// ---------------------------------------------------------------- 주석 보드

const NOTE_PREFIXES = Object.freeze([
  ['원본 보드: ', 'source_board'],
  ['가져온 요소: ', 'elements'],
  ['문법: ', 'grammar'],
  ['접은 개수: ', 'folded'],
]);

const FOLD = /(\d+)\s*개/;
const FOLD_UNIT = /(항목|행|계열|스칼라|문단|건)/;

function foldOf(text) {
  const count = FOLD.exec(text);
  const unit = FOLD_UNIT.exec(text);
  if (!count) return null;
  return { count: Number(count[1]), unit: unit ? unit[1] : null };
}

/** `note/` 보드의 네 줄(`원본 보드:` `가져온 요소:` `문법:` `접은 개수:`)을 읽는다. */
function parseNoteAnnotation(texts) {
  const parsed = { source_board: null, elements: null, grammar: null, folded: null, fold: null, unknown_lines: [] };
  for (const raw of texts) {
    const text = clean(raw);
    if (!text) continue;
    const hit = NOTE_PREFIXES.find(([prefix]) => text.startsWith(prefix));
    if (!hit) { parsed.unknown_lines.push(text); continue; }
    parsed[hit[1]] = text.slice(hit[0].length).trim();
  }
  if (parsed.folded) parsed.fold = foldOf(parsed.folded);
  return parsed;
}

/**
 * `note/` 보드를 대장 `annotation`과 맞댄다.
 *
 * `folded`는 문장 그대로 대조하지 않는다. Paper 주석은 「접은 개수: 항목 109개」로 세고
 * 대장은 사용자에게 보일 「외 109개 항목을 접었어요 · 원본에서 확인」을 담는다 — 둘은
 * 설계상 다른 문장이라 문자열로 재면 96장 전부가 표기 때문에 빨개진다. 대신 두 문장에서
 * 개수와 단위를 뽑아 그것만 맞댄다.
 */
function compareMiniNote({ texts, record }) {
  const paper = parseNoteAnnotation(texts);
  const annotation = record.annotation || {};
  const drift = [];
  const compare = (field, paperValue, ledgerValue) => {
    if (clean(paperValue) !== clean(ledgerValue)) {
      drift.push({ field, paper: clean(paperValue), ledger: clean(ledgerValue) });
    }
  };
  compare('source_board', paper.source_board, annotation.source_board);
  compare('elements', paper.elements, annotation.elements);
  compare('grammar', paper.grammar, annotation.grammar);
  const ledgerFold = foldOf(clean(annotation.folded));
  if (JSON.stringify(paper.fold) !== JSON.stringify(ledgerFold)) {
    drift.push({ field: 'fold', paper: paper.folded, ledger: clean(annotation.folded) });
  }
  for (const line of paper.unknown_lines) drift.push({ field: 'unknown_line', paper: line, ledger: null });
  return { status: drift.length ? 'divergent' : 'matched', annotation: paper, drift };
}

// ---------------------------------------------------------------- 견본 11장

/**
 * `template/<이름>` 보드명에서 문법을 정한다. 이름이 문법이면 그것이고, 아니면
 * 대장 보드 id로 보고 그 행의 문법을 쓴다(`template/2SCE-1` 대표 카드가 그 경우다).
 */
function templateGrammarOf(name, grammarByBoardId) {
  const suffix = clean(name).replace(/^template\//, '');
  if (MINI_GRAMMARS.includes(suffix)) return suffix;
  return grammarByBoardId.get(suffix) || null;
}

/** 견본 보드들이 문법 10종을 덮는가. 빠진 문법이 있으면 `grammar_uncovered`다. */
function grammarCoverage(templates) {
  const drawn = new Set(templates.map((template) => template.grammar).filter(Boolean));
  const covered = MINI_GRAMMARS.filter((grammar) => drawn.has(grammar));
  const uncovered = MINI_GRAMMARS.filter((grammar) => !drawn.has(grammar));
  return {
    ok: uncovered.length === 0,
    covered,
    uncovered,
    template_boards: templates.length,
    unresolved: templates.filter((template) => !template.grammar).map((template) => template.board_id),
  };
}

/**
 * 견본 행의 `role`. `app/orb.js`의 복합 문법만 role로 갈래를 튼다 —
 * `primary`·`secondary`는 KPI 칸으로, 나머지는 목록 행으로 간다. 그래서 KPI 밴드에
 * 실제로 들어 있는 칸만 그 두 role을 받고 다른 그룹은 행이다. 차트 문법은 머리줄의
 * 첫 값만 크게 그리므로 첫 행이 `primary`다.
 */
function templateRole(grammar, row, rows, i) {
  if (grammar === 'compound') {
    if (row.group !== 'KPI band') return 'row';
    return rows.findIndex((candidate) => candidate.group === 'KPI band') === i ? 'primary' : 'secondary';
  }
  if (grammar === 'chart') return i === 0 ? 'primary' : 'change';
  return 'fact';
}

/**
 * 견본 보드 한 장을 런타임 봉투의 `surface_contract`로 바꾼다.
 * 값은 Paper 원문 그대로 넣는다 — 견본은 「문법이 그려지는가」를 재는 자리라
 * 값을 지어내면 그리기 실패를 값 탓으로 오독하게 된다.
 *
 * 행 수는 5로 자른다. 대장 96행의 실측 최대가 5이고, 카드가 420px 고정이라
 * 그보다 많이 그리면 넘치는 것이 문법 결함이 아니라 이 봉투의 결함이 된다.
 */
function templateEnvelopeSpec({ boardId, grammar, records }) {
  const rows = paperMiniRows(records).slice(0, MAX_TEMPLATE_ELEMENTS);
  const header = records.find((record) => record.kind === 'Text' && record.name === 'Title');
  const asOf = records.find((record) => record.kind === 'Text' && record.name === 'As of');
  const foldIndex = records.findIndex((record) => record.name === 'Fold note');
  const foldNote = foldIndex >= 0 ? (leafTexts(records, foldIndex)[0] || null) : null;
  const elements = rows.map((row, i) => ({
    source_slot_id: `t${String(i + 1).padStart(3, '0')}`,
    label: row.label,
    role: templateRole(grammar, row, rows, i),
    band: 'scalar',
    format: { unit: 'text', sign: false, precision: 0, tone: 'neutral' },
    paper_text: row.values.join(' · '),
  }));
  return {
    caption: asOf ? clean(asOf.text) : null,
    kiumi: {
      version: 1,
      fixed: true,
      width_px: 360,
      height_px: 420,
      grammar,
      title: header ? clean(header.text) : '',
      eyebrow: boardId,
      source_board: `template/${grammar}`,
      elements,
      fold_note: foldNote,
    },
  };
}

module.exports = {
  MINI_GRAMMARS,
  MINI_FAILURE_CODES,
  MAX_TEMPLATE_ELEMENTS,
  paperMiniRows,
  buildTextIndex,
  classifyValue,
  compareMiniCard,
  parseNoteAnnotation,
  compareMiniNote,
  templateGrammarOf,
  grammarCoverage,
  templateEnvelopeSpec,
};
