'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const generatorPath = path.join(__dirname, '..', 'scripts', 'paper-phrases.mjs');

let mod;
const load = async () => {
  if (!mod) mod = await import(require('node:url').pathToFileURL(generatorPath).href);
  return mod;
};

// ---------- E1~E7: 데이터 값은 대표 문구가 될 수 없다(하드 제외) ----------

test('E1 drops bare numbers, currency and change readings', async () => {
  const { excludeReason } = await load();
  for (const text of ['1,850', '+1.24%', '−320', '28,940,000원', '3건', '12종목', '2배', '▲450']) {
    assert.equal(excludeReason(text).code, 'E1', text);
  }
});

test('E1 keeps a label that merely contains digits inside a word', async () => {
  const { excludeReason } = await load();
  assert.equal(excludeReason('토큰 준비됨'), null);
  assert.equal(excludeReason('지금 재발급'), null);
});

test('E2 drops clock times, dates and compact date stamps', async () => {
  const { excludeReason } = await load();
  for (const text of ['05:42:18', '09:42', '2026-08-25 21:12:04 만료', '20260825']) {
    assert.equal(excludeReason(text).code, 'E2', text);
  }
  // `n/m`은 날짜(8/25)와 진행 카운터(3 / 3) 사이에서 모호하다 — 규칙 자체의 성질이라
  // 이름은 E4로 굳히고, 어느 쪽이든 하드 제외라는 결론만 잠근다.
  assert.equal(excludeReason('08/25').hard, true);
});

test('E3 drops ticker codes, account numbers and version hashes', async () => {
  const { excludeReason } = await load();
  for (const text of ['005930', '12345678901', 'vab12cd', 'ab12cd34ef']) {
    assert.equal(excludeReason(text).code, 'E3', text);
  }
});

test('E4 drops progress counters', async () => {
  const { excludeReason } = await load();
  assert.equal(excludeReason('3 / 3').code, 'E4');
  assert.equal(excludeReason('1/5').code, 'E4');
});

test('E5 drops a composite data line carrying two or more numeric tokens', async () => {
  const { excludeReason } = await load();
  assert.equal(excludeReason('+1,850 · +1.24%').code, 'E5');
  assert.equal(excludeReason('41,483,750 · +9.04%').code, 'E5');
});

test('E6 drops a text that some card slot binds as a data value', async () => {
  const { excludeReason } = await load();
  const valueTexts = new Set(['삼성전자']);
  assert.equal(excludeReason('삼성전자', valueTexts).code, 'E6');
  assert.equal(excludeReason('삼성전자'), null, 'E6는 값 집합을 줄 때만 선다');
});

test('E7 drops single-glyph marks, including the ones the design list missed', async () => {
  const { excludeReason } = await load();
  for (const text of ['●', '◆', '◐', '○', '▸', '·', '—', '↗', '×', '◌', '✓', '⚠', '▾', '≥', '❚❚']) {
    assert.equal(excludeReason(text).code, 'E7', text);
  }
  assert.equal(excludeReason('원'), null, '한 글자여도 낱말이면 라벨이다');
});

// ---------- E8: 사람이 판정할 것이라 버리지 않고 미룬다 ----------

test('E8 defers a label welded to a data token instead of dropping it', async () => {
  const { excludeReason } = await load();
  const reason = excludeReason('지난 알람 3건 더');
  assert.equal(reason.code, 'E8');
  assert.equal(reason.hard, false, '§4.4 규칙 5가 E1~E7만 금지하므로 E8은 연성이다');
});

test('E5 and E8 count clock times and dates as data tokens too', async () => {
  const { excludeReason } = await load();
  // 6보드 수동 대조에서 새어 나온 줄들 — 시각·날짜를 안 세면 전부 온전한 후보로 남는다.
  assert.equal(excludeReason('오늘 07:30').code, 'E8');
  assert.equal(excludeReason('8/22 금').code, 'E8');
  assert.equal(excludeReason('평일 아침 브리핑 — 07:30 놓침').code, 'E8');
  assert.equal(excludeReason('어제 07:42 발화 — 캔버스 2').code, 'E5');
});

test('E1~E7 are hard so the route table lint can reject them outright', async () => {
  const { excludeReason } = await load();
  for (const text of ['1,850', '05:42:18', '005930', '3 / 3', '+1,850 · +1.24%', '●']) {
    assert.equal(excludeReason(text).hard, true, text);
  }
});

test('a numeric token with an unlisted unit stays a full candidate', async () => {
  const { excludeReason } = await load();
  // 「다음 24시간」은 라이브 관제 보드의 열 제목이라 fixture가 바뀌어도 안 변한다.
  assert.equal(excludeReason('다음 24시간'), null);
});

// ---------- 가점: Paper 프레임 이름이 곧 CSS 클래스다 ----------

test('promotedFrame recognises the label-bearing frame names', async () => {
  const { promotedFrame } = await load();
  for (const name of ['onb-head', 'auth-title', 'card-kicker', 'row-sub', 'uk-hint',
    'agent-view-tab', 'nav-item is-selected', 'uk-btn-primary · 계속', 'chart-caption', 'uk-empty-msg']) {
    assert.equal(promotedFrame(name), true, name);
  }
  assert.equal(promotedFrame('Frame'), false);
  assert.equal(promotedFrame('uk-tr-row'), false);
});

// ---------- 보드 단위 추출 ----------

const board = Object.freeze({
  board_id: 'TEST-0',
  name: '19 · 인증 — OAuth 토큰 ready',
  texts: [
    { id: 't1', text: '재발급까지 남은 시간', path: ['보드', 'auth-timer-card'] },
    { id: 't2', text: '05:42:18', path: ['보드', 'auth-timer-row'] },
    { id: 't3', text: '지금 재발급', path: ['보드', 'uk-btn-primary'] },
    { id: 't4', text: '지금 재발급', path: ['보드', 'uk-btn-primary'] },
    { id: 't5', text: '3 / 3', path: ['보드', 'onb-head'] },
    { id: 't6', text: '지난 알람 3건 더', path: ['보드', 'agent-list-more'] },
  ],
});

test('boardPhrases keeps user-facing labels, dedupes them and counts repeats', async () => {
  const { boardPhrases } = await load();
  const out = boardPhrases(board, { page: '1-0' });
  assert.deepEqual(out.phrases.map((p) => p.text), ['지금 재발급', '재발급까지 남은 시간']);
  assert.equal(out.phrases[0].count, 2);
  assert.equal(out.phrases[0].promoted, true);
});

test('boardPhrases ranks promoted frames first and keeps Paper order within a tier', async () => {
  const { boardPhrases } = await load();
  const out = boardPhrases(board, { page: '1-0' });
  assert.equal(out.phrases[0].promoted, true);
  assert.equal(out.phrases[1].promoted, false);
});

test('boardPhrases parks E8 hits in deferred and counts the hard drops by rule', async () => {
  const { boardPhrases } = await load();
  const out = boardPhrases(board, { page: '1-0' });
  assert.deepEqual(out.deferred.map((p) => p.text), ['지난 알람 3건 더']);
  assert.deepEqual(out.excluded, { E2: 1, E4: 1 });
});

// ---------- 생성물 신선도 ----------

test('the committed generated file is what the generator produces right now', async () => {
  const { buildPhraseIndex, renderGenerated, GENERATED_PATH } = await load();
  const committed = fs.readFileSync(GENERATED_PATH, 'utf8');
  assert.equal(renderGenerated(buildPhraseIndex()), committed,
    'node scripts/paper-phrases.mjs 로 다시 생성하라');
});

test('the generated index covers every screen board the manifest declares', async () => {
  const manifest = require(path.join(__dirname, '..', '..', 'backend', 'ref', 'paper-ledger', 'manifest.json'));
  const { PHRASES } = require('./paper-screen-phrases.generated.js');
  const screens = manifest.boards.filter((b) => b.role === 'screen').map((b) => b.id).sort();
  assert.deepEqual(Object.keys(PHRASES).sort(), screens);
});

test('no generated candidate breaks a hard rule', async () => {
  const { excludeReason, loadValueSlotTexts } = await load();
  const { PHRASES } = require('./paper-screen-phrases.generated.js');
  const valueTexts = loadValueSlotTexts();
  const offenders = [];
  for (const [boardId, entry] of Object.entries(PHRASES)) {
    for (const phrase of entry.phrases) {
      const reason = excludeReason(phrase, valueTexts);
      if (reason && reason.hard) offenders.push(`${boardId} ${phrase} ${reason.code}`);
    }
  }
  assert.deepEqual(offenders, []);
});
