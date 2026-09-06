// 자동 검사 진행 패널의 경계 봉인(Paper 보드 09 · 43WD-1) — 순수 모델만으로는
// "그 문구가 실제로 화면에 오르는가"를 잴 수 없어 소스에서 잰다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
const shellHtml = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
const { SANDBOX_NOTICE } = require('./watch-progress-card');

test('검사 카드와 도는 중 카드가 같은 진행 패널을 쓴다 — 문법이 둘로 갈리지 않는다', () => {
  const calls = chatSource.match(/appendWatchProgress\(/g) || [];
  assert.equal(calls.length, 3); // 정의 1 + 검사 카드 1 + 도는 중 카드 1
  assert.match(chatSource, /appendWatchProgress\(card, watchProgressLib\.buildProgress\(check\)\)/);
});

test('격리 실행 고지 문구는 순수 모델에만 산다 — chat.js가 따로 적지 않는다', () => {
  assert.equal(SANDBOX_NOTICE, '격리 실행 · 계좌·주문 접근 없음 · 30초 제한');
  assert.doesNotMatch(chatSource, /격리 실행 · 계좌/);
});

test('shell.html이 진행 패널 모델을 싣는다', () => {
  assert.match(shellHtml, /lib\/watch-progress-card\.js/);
});
