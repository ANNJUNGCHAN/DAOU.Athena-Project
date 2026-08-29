'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CARD_TITLES = [
  '종목발굴', '시세', '수급', '거래원', '계좌', '주문내역', '보유주식', '관심종목',
  '차트', '호가', '주문', '프로그램매매', '종목정보', '신용거래', '대차거래', '공매도',
];

test('Paper 공통 카드 v3의 16종 렌더러 파일과 shell 로드 계약이 모두 존재한다', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  for (const title of CARD_TITLES) {
    const filename = `card-kind-${title}.js`;
    assert.equal(fs.existsSync(path.join(__dirname, filename)), true, `${filename} missing`);
    assert.match(shell, new RegExp(`<script src="lib/${filename.replace('.', '\\.')}"></script>`));
  }
});

test('shell 실제 순서로 카드 스크립트를 로드하면 16종 모두 런타임에 등록된다', () => {
  const appDir = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
  const sources = Array.from(shell.matchAll(/<script src="(lib\/[^"]+\.js)"><\/script>/g), (match) => match[1])
    .filter((source) => source === 'lib/facts-card.js'
      || source === 'lib/card-primitives.js'
      || source === 'lib/card-kinds.js'
      || source.startsWith('lib/card-kind-'));
  const context = vm.createContext({ window: { AthenaLib: {} }, console });

  for (const source of sources) {
    const filename = path.join(appDir, source);
    assert.doesNotThrow(
      () => vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename }),
      `${source} failed during browser-order registration`,
    );
  }

  for (const title of CARD_TITLES) {
    assert.equal(typeof context.window.AthenaLib.CardKinds.resolve(title), 'function', `${title} renderer missing`);
  }
});

test('action/event 카드도 CardKinds를 통해 주문·실시간 화면군을 호출한다', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const eventBody = canvas.slice(canvas.indexOf('function renderEventCard'), canvas.indexOf('function renderActionCard'));
  const actionBody = canvas.slice(canvas.indexOf('function renderActionCard'), canvas.indexOf('function renderStatusCard'));
  assert.match(eventBody, /CardKinds\.resolve\(title\)/);
  assert.match(actionBody, /CardKinds\.resolve\(title\)/);
  assert.match(eventBody, /cardTitleAndSubtitle\(envelope/);
  assert.match(actionBody, /cardTitleAndSubtitle\(envelope/);
});
