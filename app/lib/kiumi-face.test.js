'use strict';

// 입력 스트립 키우미 얼굴 계약 (2026-09-01 사용자 결정 — 얼굴은 하나다).
//
// 이전에는 다섯 모드가 각자 추상 아이콘 얼굴(막대·별자리·궤도점·소켓·되감기)을
// 가졌다. 사용자 결정으로 그 구조를 걷어내고 **키우미 얼굴 하나**만 쓴다.
// 중립 얼굴이라 어느 모드에서도 "지금 대화 중"이라고 잘못 말하지 않는다 —
// 모드를 얼굴로 표시하지 않는 것이지, 잘못 표시하는 것이 아니다.
// data-mode 자체의 소유자는 graph-mode/controller.js applyVisibility() 하나이고
// 그 계약은 controller.test.js가 따로 고정한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shellHtml = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
const chatCss = fs.readFileSync(path.join(__dirname, '..', 'chat.css'), 'utf8');
const orbCss = fs.readFileSync(path.join(__dirname, '..', 'orb.css'), 'utf8');

const RETIRED_MODE_FACES = ['chat', 'graph', 'agent', 'plugin', 'backtest'];

test('키우미 얼굴은 정확히 하나다 — 모드별 얼굴은 없다', () => {
  const faceCount = (shellHtml.match(/class="kiumi-face"/g) || []).length;
  assert.equal(faceCount, 1, '얼굴 SVG는 하나뿐이다');
  for (const mode of RETIRED_MODE_FACES) {
    assert.ok(
      !shellHtml.includes(`kiumi-face-${mode}`),
      `${mode} 전용 얼굴은 걷어냈다 — 마크업에 남아 있으면 안 된다`,
    );
    assert.ok(
      !chatCss.includes(`kiumi-face-${mode}`),
      `${mode} 전용 얼굴 CSS도 함께 걷어냈다`,
    );
  }
});

test('얼굴 도형은 이모지가 아니고 바이저색을 상속한다', () => {
  const start = shellHtml.indexOf('<span class="kiumi-visor"');
  const end = shellHtml.indexOf('</span>', start);
  assert.ok(start !== -1 && end > start, '바이저 마크업 구간을 찾을 수 있어야 한다');
  const visor = shellHtml.slice(start, end);
  assert.ok(visor.includes('currentColor'), '도형은 currentColor로 바이저색을 상속한다');
  assert.doesNotMatch(visor, /[\u{1F300}-\u{1FAFF}]/u, '이모지 아이콘은 쓰지 않는다');
  assert.ok(chatCss.includes('color: #2F3BA8;'), '바이저색은 #2F3BA8이다');
});

test('얼굴은 모드와 무관하게 항상 보인다', () => {
  assert.ok(chatCss.includes('.kiumi-face { display: block; }'), '얼굴은 항상 표시된다');
  assert.ok(
    !chatCss.includes('.dot[data-mode='),
    'data-mode로 얼굴을 갈아끼우는 규칙은 남아 있지 않다',
  );
});

test('키우미는 산다 — 눈 깜빡임이 배선돼 있다', () => {
  assert.ok(chatCss.includes('animation: kiumi-blink'), '눈 깜빡임 애니메이션이 걸려 있다');
  assert.ok(chatCss.includes('@keyframes kiumi-blink'), '깜빡임 키프레임이 정의돼 있다');
});

test('A11Y: 모션 감소에서는 움직임만 멈추고 도형은 남는다', () => {
  const start = chatCss.indexOf('@media (prefers-reduced-motion: reduce)', chatCss.indexOf('kiumi-blink'));
  assert.notEqual(start, -1, '키우미 얼굴용 모션 감소 블록이 있어야 한다');
  const block = chatCss.slice(start, chatCss.indexOf('}', chatCss.indexOf('animation: none', start)) + 1);
  assert.ok(block.includes('animation: none'), '애니메이션만 끈다');
  assert.ok(!block.includes('display: none'), '모션 감소가 얼굴을 지우면 키우미가 사라진다');
  assert.ok(block.includes('.kiumi-face rect'), '눈의 모션이 멈춘다');
});

test('보드 02/03: 오브에는 배선되지 않은 표정 선택자가 남아 있지 않다', () => {
  // 옛 '딴생각'(drift)은 장 마감을 drowsy와 나눠 갖던 유령 얼굴이었다.
  // 선택자로 남아 있으면 다음 사람이 "있는 상태"로 읽는다.
  assert.ok(!orbCss.includes('#orbRoot[data-face="drift"]'), 'drift 선택자는 삭제됐다');
});
