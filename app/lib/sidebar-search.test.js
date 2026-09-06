'use strict';

// 순수 모듈만 검증한다(sidebar-mode-nav.test.js와 같은 규율) — 패널 DOM은
// lib/sidebar.js가 조립하고 document가 필요해 node --test 경로에서는 못 돈다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSearchResults, relativeWhen, HINT } = require('./sidebar-search');

const NOW = new Date(2026, 8, 5, 14, 30, 0).getTime(); // 2026-09-05 14:30 로컬
const iso = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0).toISOString();

const CONVERSATIONS = [
  { id: 'c1', title: '삼성전자 3개월 차트 보여줘', updatedAt: iso(2026, 9, 5, 9, 41) },
  { id: 'c2', title: '삼성전자 수급 누가 사는지 알려줘', updatedAt: iso(2026, 9, 4, 21, 5) },
  { id: 'c3', title: 'SK하이닉스 실적', updatedAt: iso(2026, 9, 1, 10, 0) },
];
const CARDS = [{ id: 'k1', title: '차트 · 삼성전자 일봉' }];

test('그룹 머리는 Paper 문구와 건수 형식을 지킨다', () => {
  const out = buildSearchResults({ conversations: CONVERSATIONS, cards: CARDS, query: '삼성전자', now: NOW });
  assert.equal(out.groups[0].label, '대화 2건');
  assert.equal(out.groups[1].label, '캔버스 카드 1건');
});

test('결과가 없는 그룹은 만들지 않는다 — 0건을 지어내지 않는다', () => {
  const out = buildSearchResults({ conversations: CONVERSATIONS, cards: [], query: '삼성전자', now: NOW });
  assert.equal(out.groups.length, 1);
  assert.ok(!out.groups.some((group) => group.kind === 'card'));
  // 질의가 비면 아무 그룹도 없다.
  assert.deepEqual(buildSearchResults({ conversations: CONVERSATIONS, cards: CARDS, query: '   ', now: NOW }).groups, []);
});

test('총 건수는 모든 그룹 행 수의 합이다', () => {
  const out = buildSearchResults({ conversations: CONVERSATIONS, cards: CARDS, query: '삼성전자', now: NOW });
  assert.equal(out.total, 3);
  assert.equal(buildSearchResults({ conversations: CONVERSATIONS, cards: CARDS, query: '없는말', now: NOW }).total, 0);
});

test('상대시각은 오늘 HH:MM · 어제 · 이 대화 세 형태를 쓴다', () => {
  const out = buildSearchResults({ conversations: CONVERSATIONS, cards: CARDS, query: '삼성전자', now: NOW });
  assert.deepEqual(out.groups[0].rows.map((row) => row.when), ['오늘 09:41', '어제']);
  assert.equal(out.groups[1].rows[0].when, '이 대화');
  // 어제보다 오래된 것은 상대시각으로 말하지 않고 실제 날짜를 낸다.
  assert.equal(relativeWhen(iso(2026, 9, 1, 10, 0), NOW), '9월 1일');
  assert.equal(relativeWhen('망가진 값', NOW), null);
});

test('키보드 안내 문구는 Paper 원문 고정이다', () => {
  assert.equal(HINT, '↑↓ 이동 · Enter 열기 · Esc 닫기');
  assert.equal(buildSearchResults({ query: '삼성전자' }).hint, HINT);
});

test('검색은 대소문자를 가리지 않고 행에 대화 id를 남긴다', () => {
  const out = buildSearchResults({
    conversations: [{ id: 'c9', title: 'SK하이닉스 실적', updatedAt: iso(2026, 9, 5, 8, 0) }],
    cards: [], query: 'sk하이닉스', now: NOW,
  });
  assert.equal(out.groups[0].rows[0].id, 'c9');
});
