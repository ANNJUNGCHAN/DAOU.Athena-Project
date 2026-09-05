'use strict';

// 제품 문구 3원칙 중 **내부용어 금지**의 회귀 가드(화면 P1 항목 13 · 17-A).
//
// chat.js와 canvas.js는 렌더러 전역이라 require로 부를 수 있는 순수 모듈이 없다 —
// raw-ui-boundary.test.js와 같은 방식으로 소스를 읽어 사용자에게 보이는 문자열만
// 잰다. 화면에 실제로 그려지는지는 Electron 게이트가 따로 본다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readApp(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

// kiumiItem(아이콘, 제목, 설명, 동작) — 셋째 인자가 화면의 .km-desc다.
function kiumiDescriptions(source) {
  const found = [];
  const re = /kiumiItem\(\s*'[^']*',\s*'[^']*',\s*'([^']*)'/g;
  let m = re.exec(source);
  while (m) {
    found.push(m[1]);
    m = re.exec(source);
  }
  return found;
}

test('키우미 메뉴 설명에 Paper 보드 번호가 없다', () => {
  const descs = kiumiDescriptions(readApp('chat.js'));
  assert.ok(descs.length >= 5, '설명 인자를 하나도 못 읽었다면 정규식이 낡은 것이다');
  for (const desc of descs) assert.doesNotMatch(desc, /보드 \d+/);
});

test('내부 컴포넌트 이름(팝오버)이 키우미 메뉴 설명에 없다', () => {
  for (const desc of kiumiDescriptions(readApp('chat.js'))) {
    assert.doesNotMatch(desc, /팝오버/);
  }
});

test('모델 설정 설명은 Paper 문구다', () => {
  assert.match(readApp('chat.js'), /kiumiItem\('model', '모델 설정', '모델 · 사고 강도'/);
});

// ---- 항목 17-A (Paper 161Q-2) — 빈·거부 상태 문구 ----
function noticeStrings(source) {
  const found = [];
  const re = /(?:renderLiveNotice|errorNote)\(\s*(['`])((?:\.|(?!\1)[\s\S])*?)\1/g;
  let m = re.exec(source);
  while (m) {
    found.push(m[2]);
    m = re.exec(source);
  }
  return found;
}

test('빈 상태 문구에 내부 필드명이 없다 — candles·records·--allowedTools가 사용자에게 안 보인다', () => {
  const notices = noticeStrings(readApp('canvas.js'));
  assert.ok(notices.length >= 4, '알림 문자열을 못 읽었다면 정규식이 낡은 것이다');
  for (const notice of notices) {
    assert.doesNotMatch(notice, /candles|records|allowedTools/);
  }
});

test('빈·거부 상태 문구가 다음 행동을 말한다', () => {
  const canvas = readApp('canvas.js');
  assert.match(canvas, /'이 조회를 실행할 권한이 없습니다 — 설정에서 권한을 확인해 주세요\.'/);
  assert.match(canvas, /'응답을 읽지 못했습니다 — 같은 질문으로 다시 시도할 수 있습니다\.'/);
  assert.match(canvas, /'표시할 소식이 없습니다 — 기간이나 종목을 바꿔 다시 조회할 수 있습니다\.'/);
  assert.match(canvas, /'표시할 봉이 없습니다 — 기간을 넓혀 다시 조회할 수 있습니다\.'/);
});
