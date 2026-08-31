'use strict';

// 입력 스트립 키우미 얼굴 계약 (Paper 키우미 보드 08 · 2026-09-01 전수검사).
//
// 얼굴은 지금 어느 모드인지를 말하는 유일한 표시다. 다섯 모드가 각자 얼굴을
// 가져야 하며, CSS가 없어 기본(대화) 얼굴로 떨어지면 화면이 "지금 대화 중"이라고
// 거짓말하는 셈이다(보드 08 FALLBACK 금지). data-mode의 소유자는
// graph-mode/controller.js applyVisibility() 하나이고, 그 계약은
// controller.test.js가 따로 고정한다 — 여기서는 마크업·스타일 쪽만 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shellHtml = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
const chatCss = fs.readFileSync(path.join(__dirname, '..', 'chat.css'), 'utf8');
const orbCss = fs.readFileSync(path.join(__dirname, '..', 'orb.css'), 'utf8');

const MODES = ['chat', 'graph', 'agent', 'plugin', 'backtest'];
const NON_DEFAULT_MODES = ['graph', 'agent', 'plugin', 'backtest'];

test('보드 08: 다섯 모드가 각자 얼굴 SVG를 가진다', () => {
  for (const mode of MODES) {
    assert.ok(
      shellHtml.includes(`class="kiumi-face kiumi-face-${mode}"`),
      `${mode} 얼굴 SVG가 shell.html에 있어야 한다`,
    );
  }
  const faceCount = (shellHtml.match(/class="kiumi-face kiumi-face-/g) || []).length;
  assert.equal(faceCount, MODES.length, '얼굴은 정확히 다섯 개다 — 남는 얼굴도 모자란 얼굴도 없다');
});

test('보드 08: 얼굴 도형은 이모지가 아니고 바이저색을 상속한다', () => {
  const start = shellHtml.indexOf('<span class="kiumi-visor"');
  const end = shellHtml.indexOf('</span>', shellHtml.indexOf('kiumi-face-backtest'));
  assert.ok(start !== -1 && end > start, '바이저 마크업 구간을 찾을 수 있어야 한다');
  const visor = shellHtml.slice(start, end);
  assert.ok(visor.includes('currentColor'), '도형은 currentColor로 바이저색을 상속한다');
  assert.doesNotMatch(visor, /[\u{1F300}-\u{1FAFF}]/u, '이모지 아이콘은 쓰지 않는다');
  assert.ok(chatCss.includes('color: #2F3BA8;'), '바이저색은 #2F3BA8이다');
});

test('보드 08: 네 모드는 각자 규칙으로만 보이고 기본 얼굴을 상속하지 않는다', () => {
  assert.ok(chatCss.includes('.kiumi-face { display: none; }'), '얼굴의 기본값은 숨김이다');
  for (const mode of NON_DEFAULT_MODES) {
    assert.ok(
      chatCss.includes(`.dot[data-mode="${mode}"] .kiumi-face-${mode} { display: block; }`),
      `${mode} 모드는 자기 얼굴만 보여준다`,
    );
  }
});

test('보드 08: 대화 얼굴은 알 수 없는 값에서만 남는 마지막 그물이다', () => {
  // 얼굴 0개인 프레임을 막는 그물이지 네 모드의 폴백이 아니다 — 그래서 네 모드가
  // 전부 선택자에서 빠져 있어야 한다. 하나라도 빠지면 그 모드는 대화 얼굴로 샌다.
  const line = chatCss
    .split('\n')
    .find((l) => l.includes('.kiumi-face-chat { display: block; }'));
  assert.ok(line, '대화 얼굴 그물 규칙이 있어야 한다');
  for (const mode of NON_DEFAULT_MODES) {
    assert.ok(line.includes(`:not([data-mode="${mode}"])`), `${mode}는 그물에서 제외된다`);
  }
});

test('보드 08 A11Y: 모션 감소에서는 움직임만 멈추고 도형은 남는다', () => {
  const start = chatCss.indexOf('@media (prefers-reduced-motion: reduce)', chatCss.indexOf('kiumi-rewind'));
  assert.notEqual(start, -1, '키우미 얼굴용 모션 감소 블록이 있어야 한다');
  const block = chatCss.slice(start, chatCss.indexOf('}', chatCss.indexOf('animation: none', start)) + 1);
  assert.ok(block.includes('animation: none'), '애니메이션만 끈다');
  assert.ok(!block.includes('display: none'), '모션 감소가 얼굴을 지우면 모드 표시 자체가 사라진다');
  for (const selector of [
    '.kiumi-face-chat rect',
    '.kiumi-face-plugin circle',
    '.kiumi-face-graph circle',
    '.kiumi-face-agent circle',
    '.kiumi-face-backtest path',
  ]) {
    assert.ok(block.includes(selector), `${selector}의 모션도 함께 멈춘다`);
  }
});

test('보드 02/03: 오브에는 배선되지 않은 표정 선택자가 남아 있지 않다', () => {
  // 옛 '딴생각'(drift)은 장 마감을 drowsy와 나눠 갖던 유령 얼굴이었다.
  // 선택자로 남아 있으면 다음 사람이 "있는 상태"로 읽는다.
  assert.ok(!orbCss.includes('#orbRoot[data-face="drift"]'), 'drift 선택자는 삭제됐다');
});
