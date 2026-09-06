// 제어 결과 턴의 경계 봉인(Paper 보드 08 · 4330-1) — 단위 테스트로는 잴 수 없는
// 두 가지를 소스에서 잰다(plugin-proposal-boundary.test.js와 같은 자리·같은 이유).
//
// ⑴ 결과 턴은 모듈 스코프에서 마운트돼야 한다. 제어 클릭은 캔버스에서, 살아 있는
//    LLM 턴 밖에서 일어나므로 턴 스코프 클로저에 두면 영원히 안 뜬다.
// ⑵ 그 구독은 **이벤트가 와야만** 그린다. 부팅 직후 #history는 자식이 0개여야
//    한다(verify.js emptyHistory 계약) — 구독이 부팅 시 턴을 그리면 그 계약이 깨진다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
const canvasSource = fs.readFileSync(path.join(appDir, 'canvas.js'), 'utf8');
const shellHtml = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');

const CHANNEL = 'athena:routine-control-result';

test('chat.js의 제어 결과 구독은 모듈 스코프의 addEventListener 하나다', () => {
  assert.match(chatSource, new RegExp(`^window\\.addEventListener\\('${CHANNEL}'`, 'm'));
  // 그리는 곳은 하나뿐이다 — 두 곳이 들으면 결과 턴이 두 번 붙는다.
  const listeners = chatSource.match(new RegExp(`addEventListener\\('${CHANNEL}'`, 'g')) || [];
  assert.equal(listeners.length, 1);
});

test('제어 결과 턴은 이벤트가 와야만 그린다 — 부팅 계약(emptyHistory)을 깨지 않는다', () => {
  const start = chatSource.indexOf(`window.addEventListener('${CHANNEL}'`);
  assert.ok(start > 0);
  const body = chatSource.slice(start, start + 400);
  // 핸들러 안에서만 renderControlResultTurn을 부른다.
  assert.match(body, /renderControlResultTurn\(turn[,)]/);
  // 모듈 최상위에서 그리기를 한 번 부르는 코드가 없다(구독 밖 직접 호출 금지).
  const calls = chatSource.match(/renderControlResultTurn\(/g) || [];
  assert.equal(calls.length, 2); // 정의 1 + 구독 안 호출 1
});

test('canvas.js가 그 채널의 유일한 발신자다 — 캔버스 클릭이 채팅으로 오는 길', () => {
  assert.match(canvasSource, new RegExp(`CustomEvent\\('${CHANNEL}'`));
  const dispatches = canvasSource.match(new RegExp(`CustomEvent\\('${CHANNEL}'`, 'g')) || [];
  assert.equal(dispatches.length, 1);
});

test('shell.html이 순수 모델을 watch-nodes 뒤에 싣는다 — 로드 순서가 계약이다', () => {
  const nodes = shellHtml.indexOf('lib/watch-nodes.js');
  const control = shellHtml.indexOf('lib/routine-control-turn.js');
  assert.ok(nodes > 0 && control > 0);
  assert.ok(control > nodes, 'routine-control-turn.js는 watch-nodes.js보다 뒤에 와야 한다');
});

test('다시 부를 손잡이가 채널을 함께 탄다 — 「다시 시도」가 막다른 길이 되지 않는다', () => {
  // 캔버스는 turn 옆에 retry를 싣고, 채팅은 그것을 결과 턴에 넘긴다.
  assert.match(canvasSource, /detail: \{ turn, retry \}/);
  assert.match(chatSource, /renderControlResultTurn\(turn, typeof detail\.retry === 'function'/);
});
