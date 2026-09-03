'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(APP_ROOT, 'orb.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
const styles = fs.readFileSync(path.join(APP_ROOT, 'orb.css'), 'utf8');
const html = fs.readFileSync(path.join(APP_ROOT, 'orb.html'), 'utf8');

test('카드미니는 board-format을 로드한 뒤 고정 kiumi 계약으로 렌더한다', () => {
  assert.ok(html.indexOf('lib/board-format.js') < html.indexOf('lib/orb-mini-card.js'));
  assert.match(source, /function buildOrbKiumiCard\(envelope\)/);
  assert.match(source, /orbMiniCard\.buildKiumiPlan\(surfaceContract\)/);

  const kiumiGate = source.indexOf('const kiumiCard = buildOrbKiumiCard(envelope)');
  const genericSwitch = source.indexOf('switch (envelope.canvas_type)', kiumiGate);
  assert.ok(kiumiGate >= 0 && genericSwitch > kiumiGate, 'kiumi 계약이 generic canvas fallback보다 먼저여야 한다');
});

test('주문 티켓 kiumi 문법은 기존 실행 가능한 주문 경로를 보존한다', () => {
  assert.match(source, /plan\.grammar === 'order_ticket'/);
  assert.match(source, /const ticket = renderOrbTicket\(envelope\)/);
  assert.match(source, /return ticket/);
  assert.match(source, /athena:order-execute/);
});

test('카드미니 표면은 420px 고정이고 내부 스크롤이나 말줄임으로 내용을 숨기지 않는다', () => {
  const block = styles.match(/\.orb-kiumi-card\s*\{([\s\S]*?)\}/);
  assert.ok(block, '.orb-kiumi-card 스타일이 필요하다');
  assert.match(block[1], /height:\s*420px/);
  assert.match(block[1], /overflow:\s*hidden/);
  assert.doesNotMatch(block[1], /overflow-y:\s*(?:auto|scroll)/);

  assert.match(styles, /\.orb-kiumi-label[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.orb-kiumi-value[\s\S]*white-space:\s*normal/);
});

test('백엔드가 먼저 push한 카드도 orb 기원 질의면 같은 오브 창으로 전달한다', () => {
  const persistentPushed = mainSource.match(/if \(result\.status === 'pushed'\) \{([\s\S]*?)\n  \}/);
  assert.ok(persistentPushed);
  assert.match(persistentPushed[1], /context\.origin === 'orb'/);
  assert.match(persistentPushed[1], /athena:orb-canvas-result/);

  const coldPushed = mainSource.match(/if \(r\.status === 'pushed'\) \{([\s\S]*?)\n      \}/);
  assert.ok(coldPushed);
  assert.match(coldPushed[1], /origin === 'orb'/);
  assert.match(coldPushed[1], /athena:orb-canvas-result/);
});

test('오브는 main이 보낸 카드 개수를 모두 받을 때까지 canvas 구독을 유지한다', () => {
  assert.match(mainSource, /canvasResultCount:\s*canvasTypesSeen\.length/);
  assert.match(source, /await waitForOrbCanvasDrain\(/);
  assert.ok(source.indexOf('await waitForOrbCanvasDrain(') < source.indexOf('unsubCanvas();'));
});

test('오브 기원 REST·Selector 빠른 경로도 같은 카드 봉투를 오브에 전달한다', () => {
  assert.match(mainSource, /function emitRestCanvasForOrigin\(\s*payload,[\s\S]*?origin === 'orb'/);
  assert.match(mainSource, /athena:orb-canvas-result/);
  assert.match(mainSource, /origin,\s*\n\s*timeoutMs:/);
  assert.match(mainSource, /result\.canvasResultCount\s*=\s*Number\(result\.renderedCount\)/);
});
