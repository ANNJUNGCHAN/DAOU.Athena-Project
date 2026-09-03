// 렌더러 경계 봉인 — 단위 테스트로는 잴 수 없는 두 가지를 소스에서 잰다.
//
// ⑴ 플러그인을 바꾸는 IPC는 사람이 승인 카드를 누른 그 한 지점에서만 나간다.
//    GUI 버튼 핸들러가 athena:mcp-* 변이 채널을 직접 부르면 "채팅이 제안하고
//    캔버스가 승인한다"가 버튼 다섯 개에서 거짓이 된다 — 단위 테스트는 콜백만
//    보므로 이 위반을 못 본다.
// ⑵ 채팅 결과 턴은 모듈 스코프에서 마운트돼야 한다. 승인 클릭은 살아 있는 LLM
//    턴 밖에서 일어나므로, 턴 스코프 클로저에 두면 결과 턴이 영원히 안 뜬다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..');
const canvasSource = fs.readFileSync(path.join(appDir, 'canvas.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(appDir, 'lib', 'settings-cards.js'), 'utf8');

// 플러그인 6동작을 실제로 일으키는 채널들. probe·list는 읽기라 여기 없다.
const MUTATION_CHANNELS = [
  'athena:mcp-register',
  'athena:mcp-approve',
  'athena:mcp-revoke',
  'athena:mcp-allow-tool',
  'athena:mcp-remove',
  'athena:mcp-stage-snippet',
];

test('canvas.js는 플러그인 변이 채널을 직접 부르지 않는다 — 실행은 승인 하나뿐이다', () => {
  const offenders = MUTATION_CHANNELS.filter((channel) => canvasSource.includes(`'${channel}'`));
  assert.deepEqual(offenders, [], '변이는 athena:plugin-approve를 통해 메인이 실행한다');
});

// 설정에는 플러그인 표면 자체가 없다(2026-09-03 — 플러그인 모드 관리 뷰가 흡수).
// 카드가 돌아오면 변이 채널도 같이 돌아온다 — 소스에서 두 가지를 함께 막는다.
test('settings-cards.js에는 플러그인 카드도 변이 채널도 없다', () => {
  const offenders = MUTATION_CHANNELS.filter((channel) => settingsSource.includes(`'${channel}'`));
  assert.deepEqual(offenders, [], '설정은 플러그인을 바꾸지 않는다');
  assert.ok(!settingsSource.includes("'athena:mcp-list'"), '설정 nav에 플러그인 항목이 남아 있다');
  assert.ok(!settingsSource.includes('renderMcp'), '설정에 플러그인 카드가 남아 있다');
});

test('GUI 진입 6종은 onPropose로 합류한다', () => {
  assert.match(canvasSource, /onPropose:/, 'plugin-canvas에 onPropose를 넘기지 않는다');
  assert.match(canvasSource, /onApproveProposal:/);
  assert.match(canvasSource, /onRejectProposal:/);
  // 옛 직접 실행 deps가 남아 있으면 두 경로가 공존한다.
  for (const dead of ['onApproveInstall:', 'onSavePermissions:', 'onTogglePlugin:', 'onRemovePlugin:', 'onStageSnippet:', 'onApproveServer:']) {
    assert.ok(!canvasSource.includes(dead), `${dead} 직접 실행 배선이 남아 있다`);
  }
});

test('모델 제안 구독과 승인 결과 방출은 canvas.js의 모듈 스코프에 있다', () => {
  // 들여쓰기 0 = 어떤 함수 안도 아니다(턴 스코프 복제 금지 — 카드가 사라진다).
  assert.match(canvasSource, /^window\.athena\.on\('athena:plugin-proposed'/m);
  assert.match(canvasSource, /^async function pluginDecide\(/m);
  assert.match(canvasSource, /athena:plugin-result/);
  // 모드 밖 폐기는 pending 등록도 하지 않는다 — send가 게이트 뒤에 있어야 한다.
  const gate = canvasSource.indexOf("pluginModeAdapter.currentMode() !== 'plugin'");
  const noted = canvasSource.indexOf("window.athena.send('athena:plugin-noted'");
  assert.ok(gate >= 0, '모드 게이트가 없다');
  assert.ok(noted > gate, 'plugin-noted가 모드 게이트보다 앞에 있다');
});

test('모드 재진입 복원은 setView 래퍼가 맡는다(sidebar.js는 건드리지 않는다)', () => {
  assert.match(canvasSource, /window\.AthenaPluginCanvas = \{/);
  assert.match(canvasSource, /athena:plugin-pending/);
  const sidebar = fs.readFileSync(path.join(appDir, 'lib', 'sidebar.js'), 'utf8');
  assert.ok(!sidebar.includes('athena:plugin'), 'sidebar.js가 플러그인 제안을 알게 됐다');
});

test('chat.js의 athena:plugin-result 리스너는 모듈 스코프에서 _mountTurn을 부른다', () => {
  assert.match(chatSource, /^window\.addEventListener\('athena:plugin-result'/m);
  assert.match(chatSource, /^function pluginTurnCard\(/m);
  const card = chatSource.slice(chatSource.indexOf('function pluginTurnCard('));
  assert.match(card.slice(0, card.indexOf('\n}')), /_mountTurn\(line, card\);/);
});

test('chat.js의 턴 스코프 제안 턴은 모드 게이트를 먼저 지난다', () => {
  const handler = chatSource.slice(chatSource.indexOf('const onPluginProposed = '));
  const body = handler.slice(0, handler.indexOf('\r\n  };'));
  const gate = body.indexOf("pluginModeLib.currentMode() !== 'plugin'");
  const render = body.indexOf('renderPluginProposalTurn(');
  assert.ok(gate >= 0, '모드 게이트가 없다 — 모드 밖에서도 제안 턴이 뜬다');
  assert.ok(gate < render, '게이트가 렌더보다 뒤에 있다');
});

test('chat.js의 폐기 알림 억제는 턴마다 초기화된다', () => {
  assert.match(chatSource, /pluginOutOfMode\.reset\(\);/);
  // 턴 스코프 안(들여쓰기 2칸)에서 초기화돼야 다음 턴에 다시 알린다.
  assert.match(chatSource, /^ {2}pluginOutOfMode\.reset\(\);$/m);
});

// 응답 즉시 봉투를 빼면 plugin-canvas가 세우는 승인됨·실패·거부됨이 실앱에서
// 한 번도 그려지지 않는다 — 카드는 남고, 빼는 일은 복원·재등록·폐기가 맡는다.
test('canvas.js는 승인·거부 응답 뒤에도 봉투를 목록에 남긴다', () => {
  const decide = canvasSource.slice(canvasSource.indexOf('async function pluginDecide('));
  const body = decide.slice(0, decide.indexOf('\n}'));
  assert.ok(!body.includes('dropPluginProposal('), '응답 즉시 빼면 처리된 카드가 화면에 안 남는다');
  assert.match(body, /pluginCanvas\.setProposals\(/);
});

test('canvas.js는 같은 번호가 다시 등록되면 앞의 카드를 뺀다', () => {
  const mount = canvasSource.slice(canvasSource.indexOf('function mountPluginProposal('));
  const body = mount.slice(0, mount.indexOf('\n}'));
  assert.match(body, /dropPluginProposal\(envelope\);/);
});

test('canvas.js는 판번호가 움직일 때 남은 카드의 만료 판정을 갱신한다', () => {
  const calls = canvasSource.match(/pluginCanvas\.setProposals\(/g) || [];
  // 제안 등록 · 복원 · 승인 직후 · 목록 갱신 · 다시 시도 다섯 지점.
  assert.ok(calls.length >= 5, `setProposals 호출이 ${calls.length}건뿐이다`);
  const refresh = canvasSource.slice(canvasSource.indexOf('async function pluginRefresh('));
  assert.match(refresh.slice(0, refresh.indexOf('\n}')), /pluginCanvas\.setProposals\(/);
});

test('chat.js는 옛 모드 밖 문구를 쓰지 않는다', () => {
  assert.ok(!chatSource.includes('플러그인 모드에서 승인할 수 있습니다'));
  assert.match(chatSource, /^window\.addEventListener\('athena:plugin-out-of-mode'/m);
});
