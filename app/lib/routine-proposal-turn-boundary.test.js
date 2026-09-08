// 제어 제안 턴의 경계 봉인(Paper 보드 07 · 432Z-1) — 단위 테스트로는 잴 수 없는
// 것을 소스에서 잰다(routine-control-turn-boundary.test.js와 같은 자리·같은 이유).
//
// ⑴ 제안 턴은 모델이 낸 신호 하나로만 선다. main.js가 유일한 발신자이고
//    chat.js의 모듈 스코프 구독이 유일한 수신자다(이전 회차의 「발신 1·수신 0」).
// ⑵ 그 구독은 **이벤트가 와야만** 그린다 — 부팅 직후 #history는 자식이 0개여야
//    한다(verify.js emptyHistory 계약).
// ⑶ 사람 칩은 실재하는 게이트를 부른다 — 눌러도 아무 일 없는 칩을 만들지 않는다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
const shellHtml = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');

const CHANNEL = 'athena:routine-proposed';
const occurrences = (source, needle) => source.split(needle).length - 1;

test('제안 봉투는 main.js가 한 번 쏘고 chat.js가 한 번 받는다', () => {
  assert.equal(occurrences(mainSource, `send('${CHANNEL}'`), 1);
  assert.equal(
    occurrences(chatSource, `window.athena.on('${CHANNEL}'`), 1,
    '수신자가 0이면 Paper 보드 07이 영영 안 뜬다',
  );
  // 모듈 스코프여야 한다 — 턴 스코프 클로저에 두면 살아 있는 턴 밖에서 못 뜬다.
  assert.ok(chatSource.includes(`\nwindow.athena.on('${CHANNEL}'`));
});

test('제안 턴은 이벤트가 와야만 그린다 — 부팅 계약(emptyHistory)을 깨지 않는다', () => {
  const start = chatSource.indexOf(`window.athena.on('${CHANNEL}'`);
  assert.ok(start > 0);
  const body = chatSource.slice(start, start + 400);
  assert.ok(body.includes('renderControlProposalTurn(turn, (meta && meta.conversationId)'));
  // 정의 1 + 구독 안 호출 1 — 모듈 최상위에서 한 번 그리는 코드가 없다.
  assert.equal(occurrences(chatSource, 'renderControlProposalTurn('), 2);
});

test('칩이 부르는 게이트는 main.js에 실재한다', () => {
  for (const channel of ['athena:routine-update', 'athena:routine-missed-confirm', 'athena:routine-missed-skip']) {
    assert.ok(chatSource.includes(`'${channel}'`), `chat.js가 ${channel}을 부르지 않는다`);
    assert.ok(mainSource.includes(`ipcMain.handle('${channel}'`), `main.js에 ${channel} 핸들러가 없다`);
  }
});

test('D 뷰 이동은 캔버스 뷰 전환을 실제로 부른다 — 채팅에서 에이전트 뷰로 가는 길', () => {
  assert.ok(chatSource.includes('canvas.setActiveView(view.tab)'));
  assert.ok(chatSource.includes('canvas.setActiveTab(view.filter)'));
});

test('결과 턴은 기존 채널을 그대로 탄다 — 마운트 지점을 늘리지 않는다', () => {
  assert.equal(occurrences(chatSource, "CustomEvent('athena:routine-control-result'"), 1);
  assert.match(chatSource, /detail: \{ turn, retry: retry \|\| null, conversationId \}/);
});

test('shell.html이 순수 모델을 결과 턴 모델 뒤에 싣는다 — 로드 순서가 계약이다', () => {
  const control = shellHtml.indexOf('lib/routine-control-turn.js');
  const proposal = shellHtml.indexOf('lib/routine-proposal-turn.js');
  const chat = shellHtml.indexOf('<script src="chat.js">');
  assert.ok(control > 0 && proposal > 0 && chat > 0);
  assert.ok(proposal > control, 'routine-proposal-turn.js는 routine-control-turn.js보다 뒤에 와야 한다');
  assert.ok(chat > proposal, 'chat.js는 두 순수 모델보다 뒤에 와야 한다');
});
