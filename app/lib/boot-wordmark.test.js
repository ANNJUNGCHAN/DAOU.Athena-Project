'use strict';

// 부팅 워드마크의 3색 계약(Paper 보드 02·03·04) — 비활성 자리표시자 회색 위로
// 파란 글자를 다시 입력하고 캐럿은 핑크다. chat.css를 직접 읽는 이유: 이 세 색은
// 렌더러 전역 코드가 아니라 스타일시트에만 있고, Electron 부팅 게이트
// (verify.js baseIsInactiveGray·overlayIsBlue·cursorIsPink)가 실측하는 값과 같은 원장이다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'chat.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// 셀렉터가 정확히 하나인 첫 규칙 — `.boot-base, .boot-name`처럼 조판만 공유하는
// 묶음 규칙에는 색이 없고, 뒤따르는 reduced-motion 재정의는 색을 건드리지 않는다.
function ruleBody(selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (selectors.length === 1 && selectors[0] === selector) return match[2];
  }
  return '';
}

test('부팅 워드마크는 Paper DakiL(Light)을 탄다 — Daki Title이 아니다', () => {
  const match = css.match(/\.boot-base,\s*\.boot-name\s*\{([^}]*)\}/);
  assert.ok(match, '.boot-base, .boot-name 조판 규칙이 있어야 한다');
  const block = match[1];
  assert.match(block, /font-family:\s*'Daki'/);
  assert.match(block, /font-weight:\s*300/);
  assert.doesNotMatch(block, /var\(--font-display\)/);
  assert.doesNotMatch(block, /Daki Title/);
});

test('부팅 자리표시자는 Paper 16OD-2 회색이다 — 투명이 아니다', () => {
  const base = ruleBody('.boot-base');
  assert.ok(base, '.boot-base 규칙이 있어야 한다');
  assert.match(base, /color:\s*#9aa2ae\s*;/i);
  assert.doesNotMatch(base, /color:\s*transparent/i);
});

test('타이핑된 글자는 Paper 파랑(#0e20b2)이다', () => {
  assert.match(ruleBody('.boot-name'), /color:\s*#0e20b2\s*;/i);
});

test('캐럿은 Paper 핑크(#ee137b)다', () => {
  assert.match(ruleBody('.boot-cursor'), /color:\s*#ee137b\s*;/i);
});
