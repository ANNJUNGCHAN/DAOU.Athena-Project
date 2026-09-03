// plugin-mode-adapter.js 단위 테스트 — 모드 읽기 한 함수와, 그 모듈이 셸에
// 실제로 실려 있는지(로드 등록 봉인)를 함께 잰다.
//
// 로드 등록을 여기서 재는 이유: node --test는 파일을 직접 require하므로
// shell.html에 <script>를 빠뜨려도 단위 테스트는 전부 통과한다. 그런데 canvas.js는
// 최상단에서 window.AthenaLib.*를 구조분해하므로, 태그가 없거나 canvas.js 뒤에
// 있으면 플러그인 모드가 아니라 렌더러 전체가 첫 페인트에서 죽는다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { currentMode } = require('./plugin-mode-adapter');

function stubRegion(dataset) {
  global.document = {
    getElementById: (id) => (id === 'canvasRegion' ? { dataset } : null),
  };
}

test.afterEach(() => { delete global.document; });

test('currentMode: 플러그인 모드 라벨을 그대로 돌려준다', () => {
  stubRegion({ mode: 'plugin' });
  assert.equal(currentMode(), 'plugin');
});

test('currentMode: 다른 모드 라벨도 그대로 돌려준다(플러그인으로 뭉뚱그리지 않는다)', () => {
  stubRegion({ mode: 'graph' });
  assert.equal(currentMode(), 'graph');
  stubRegion({ mode: 'chat' });
  assert.equal(currentMode(), 'chat');
});

test('currentMode: 첫 페인트 전(라벨 없음)에는 undefined다 — 플러그인 모드가 아니다', () => {
  stubRegion({});
  assert.equal(currentMode(), undefined);
  assert.notEqual(currentMode(), 'plugin');
});

test('currentMode: 캔버스 영역이 아직 없으면 undefined다', () => {
  global.document = { getElementById: () => null };
  assert.equal(currentMode(), undefined);
});

test('currentMode: document 자체가 없는 환경(메인 프로세스·테스트)에서도 던지지 않는다', () => {
  delete global.document;
  assert.equal(currentMode(), undefined);
});

// --- 로드 등록 봉인 -----------------------------------------------------------

test('shell.html이 두 순수 모듈을 canvas.js·chat.js보다 앞에서 싣는다', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  const adapterTag = shell.indexOf('<script src="lib/plugin-mode-adapter.js"></script>');
  const proposalTag = shell.indexOf('<script src="lib/plugin-proposal.js"></script>');
  const canvasTag = shell.indexOf('<script src="canvas.js"></script>');
  const chatTag = shell.indexOf('<script src="chat.js"></script>');

  assert.ok(adapterTag >= 0, 'lib/plugin-mode-adapter.js 스크립트 태그가 없다');
  assert.ok(proposalTag >= 0, 'lib/plugin-proposal.js 스크립트 태그가 없다');
  assert.ok(canvasTag >= 0, 'canvas.js 스크립트 태그를 찾지 못했다');
  assert.ok(chatTag >= 0, 'chat.js 스크립트 태그를 찾지 못했다');

  assert.ok(adapterTag < canvasTag, 'plugin-mode-adapter.js가 canvas.js보다 뒤에 있다');
  assert.ok(adapterTag < chatTag, 'plugin-mode-adapter.js가 chat.js보다 뒤에 있다');
  assert.ok(proposalTag < canvasTag, 'plugin-proposal.js가 canvas.js보다 뒤에 있다');
  assert.ok(proposalTag < chatTag, 'plugin-proposal.js가 chat.js보다 뒤에 있다');
});
