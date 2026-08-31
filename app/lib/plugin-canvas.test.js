// plugin-canvas.js 단위 테스트 — Electron/jsdom 없이 기존 agent-canvas 관례의
// 최소 DOM 스텁으로 허브·관리·기능 허용·설치 승인·삭제의 왕복을 검증한다.
//
// 이 파일이 지키는 계약은 Paper 플러그인 페이지 01~04다:
//   01 기능 허용 · 02 설치 승인 · 03 허브 · 04 관리·마켓플레이스
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginCanvas } = require('./plugin-canvas');

function fakeNode(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    type: '',
    placeholder: '',
    value: '',
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); return child; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; },
    addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((handler) => handler(event)));
    },
  };
}

function findByClass(node, className) {
  const found = [];
  const walk = (current) => {
    if (String(current.className || '').split(/\s+/).includes(className)) found.push(current);
    (current.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

function buttonWithClass(container, className) {
  return findByClass(container, className).find((node) => node.tag === 'button');
}

function texts(container, className) {
  return findByClass(container, className).map((node) => node.textContent);
}

// 클릭 핸들러는 프라미스를 돌려주지 않는다(실 DOM 계약 그대로). 설치·저장·삭제
// 처럼 호스트 응답을 기다리는 흐름은 dispatchEvent만 await하면 아직 안 끝났다.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test.beforeEach(() => {
  global.document = {
    createElement: (tag) => fakeNode(tag),
    createElementNS: (_namespace, tag) => fakeNode(tag),
  };
});

test.afterEach(() => { delete global.document; });

// --- 03 허브 -----------------------------------------------------------------

test('허브는 설치됨·추천 두 구역과 검색을 Paper 03대로 렌더한다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();

  assert.equal(findByClass(container, 'plugin-canvas-title')[0].textContent, '플러그인');
  assert.equal(findByClass(container, 'plugin-canvas-search')[0].placeholder, '플러그인 검색');
  assert.deepEqual(texts(container, 'plugin-canvas-section-title'), ['설치됨', '추천']);
  assert.equal(findByClass(container, 'plugin-canvas-installed')[0].children.length, 2);
  assert.equal(findByClass(container, 'plugin-canvas-recommended')[0].children.length, 3);
  assert.deepEqual(texts(container, 'plugin-canvas-card-name').slice(0, 2), ['웹 문서 읽기', '시간·시간대']);
  assert.equal(
    findByClass(container, 'plugin-canvas-description')[0].textContent,
    '플러그인은 설치 후 기능별로 허용합니다. Kiwoom·brain은 Athena 내장 API라 이 목록에 표시하지 않습니다.',
  );
});

test('설치됨 카드는 권한, 추천 카드는 설치 버튼을 쓴다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();

  const installedCard = findByClass(container, 'plugin-canvas-installed')[0].children[0];
  const recommendedCard = findByClass(container, 'plugin-canvas-recommended')[0].children[0];
  assert.equal(findByClass(installedCard, 'plugin-canvas-action')[0].textContent, '권한');
  assert.equal(findByClass(recommendedCard, 'plugin-canvas-action')[0].textContent, '설치');
});

test('검색은 설치·추천 카드의 이름/설명을 함께 필터링한다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();
  const input = findByClass(container, 'plugin-canvas-search')[0];
  input.value = '한국';
  await input.dispatchEvent({ type: 'input', target: input });

  assert.equal(findByClass(container, 'plugin-canvas-installed')[0].children.length, 1, '설치 목록은 빈 상태 한 장');
  assert.equal(findByClass(container, 'plugin-canvas-recommended')[0].children.length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-card-name')[0].textContent, '한국 주식 시세');
});

test('빈 상태 문구는 검색 결과 없음과 아직 없음을 구분한다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, installed: [], recommended: [], marketplaces: [] });
  canvas.mount();
  assert.deepEqual(texts(container, 'plugin-canvas-empty'), [
    '설치한 플러그인이 없습니다 · 아래 추천에서 설치합니다',
    '추천할 플러그인이 없습니다 · 마켓플레이스를 켜거나 서버를 직접 추가합니다',
  ]);

  const input = findByClass(container, 'plugin-canvas-search')[0];
  input.value = '없는이름';
  await input.dispatchEvent({ type: 'input', target: input });
  assert.deepEqual(texts(container, 'plugin-canvas-empty'), [
    '검색과 일치하는 설치 플러그인이 없습니다',
    '검색과 일치하는 추천 플러그인이 없습니다',
  ]);
});

// --- 01 기능 허용 -------------------------------------------------------------

test('권한 버튼은 의도 콜백을 알리고 Paper 01 기능 허용 화면을 연다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onPermission: (plugin) => calls.push(['permission', plugin.id]),
  });
  canvas.mount();
  await buttonWithClass(container, 'is-primary').dispatchEvent({ type: 'click' });

  assert.deepEqual(calls, [['permission', 'fetch']]);
  assert.equal(findByClass(container, 'plugin-canvas-permissions-view').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0, '기능 허용은 모달이 아니다');
  assert.deepEqual(texts(container, 'plugin-canvas-count'), ['설치됨', '기능 1', '허용 1', '연결 확인됨']);
  assert.equal(
    findByClass(container, 'plugin-canvas-description')[0].textContent,
    '기능 허용은 웹 문서 읽기 플러그인에만 적용됩니다. Athena 내장 API는 이 목록에 나타나지 않습니다.',
  );
  assert.equal(
    findByClass(container, 'plugin-canvas-boundary-note')[0].textContent,
    'Kiwoom 시세·주문·계좌와 brain은 Athena 내장 API이므로 플러그인 권한 목록에 표시하지 않습니다.',
  );
});

test('기능 허용 화면 토글은 저장 전 초안이며 돌아가면 기존 허용 상태를 보존한다', async () => {
  const saves = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onSavePermissions: (plugin, features) => saves.push([plugin.id, features]),
  });
  canvas.mount();
  // 두 번째 설치 항목(시간·시간대)은 기능 2개 중 1개만 허용된 상태다.
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  const view = findByClass(container, 'plugin-canvas-permissions-view')[0];
  const toggles = findByClass(view, 'plugin-canvas-toggle');
  assert.deepEqual(toggles.map((toggle) => toggle.getAttribute('aria-checked')), ['true', 'false']);

  await toggles[1].dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet-count')[0].textContent, '허용 2 / 2');

  await buttonWithClass(container, 'is-sheet-cancel').dispatchEvent({ type: 'click' });
  assert.deepEqual(saves, [], '돌아가기는 저장하지 않는다');
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(
    findByClass(container, 'plugin-canvas-permissions-view')[0]
      && findByClass(findByClass(container, 'plugin-canvas-permissions-view')[0], 'plugin-canvas-toggle')
        .map((toggle) => toggle.getAttribute('aria-checked')),
    ['true', 'false'],
  );
});

test('선택 저장은 허용한 기능만 콜백으로 돌려준다', async () => {
  const saves = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onSavePermissions: (plugin, features) => saves.push([plugin.id, features.map((f) => f.name)]),
  });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  const confirm = buttonWithClass(container, 'is-sheet-confirm');
  assert.equal(confirm.textContent, '선택 저장');
  await confirm.dispatchEvent({ type: 'click' });

  assert.deepEqual(saves, [['time', ['get_current_time']]]);
});

test('허용 저장이 실패하면 화면을 닫지 않고 이유를 보여준다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onSavePermissions: () => Promise.resolve({ ok: false, error: 'convert_time 허용 변경에 실패했습니다' }),
  });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-permissions-view').length, 1, '실패하면 상세 화면에 남는다');
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, 'convert_time 허용 변경에 실패했습니다');
});

test('아무것도 돌려주지 않는 호스트에서도 저장은 조용한 실패가 되지 않는다', async () => {
  const saves = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onSavePermissions: (plugin) => { saves.push(plugin.id); },
  });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(saves, ['time']);
  assert.equal(findByClass(container, 'plugin-canvas-permissions-view').length, 0, '성공이면 허브로 돌아간다');
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error').length, 0);
});

test('probe 실패는 기능 허용 화면에 이유와 다시 확인을 띄운다', async () => {
  const retries = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    installed: [{ id: 'broken', name: '끊긴 서버', description: 'npx -y nope', source: '연결 미확인', enabled: true, featureCount: 0, features: [], error: 'spawn ENOENT' }],
    recommended: [],
    marketplaces: [],
    onPermission: (plugin) => retries.push(plugin.id),
  });
  canvas.mount();
  await buttonWithClass(container, 'is-primary').dispatchEvent({ type: 'click' });

  assert.equal(findByClass(container, 'plugin-canvas-error-text')[0].textContent, '연결 실패 — spawn ENOENT');
  assert.deepEqual(texts(container, 'plugin-canvas-empty'), ['노출 기능을 아직 확인하지 못했습니다 · 다시 확인을 누릅니다']);
  await buttonWithClass(container, 'is-retry').dispatchEvent({ type: 'click' });
  assert.deepEqual(retries, ['broken', 'broken']);
});

// --- 02 설치 승인 -------------------------------------------------------------

test('추천 설치는 Paper 02 승인 시트를 열고 거부하면 아무 일도 하지 않는다', async () => {
  const approvals = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onApproveInstall: (plugin, features) => { approvals.push([plugin.id, features]); return { ok: true }; },
  });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });

  assert.equal(findByClass(container, 'plugin-canvas-install-sheet').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-sheet-title')[0].textContent, '단계적 사고 설치');
  assert.equal(findByClass(container, 'plugin-canvas-sheet-plugin-name')[0].textContent, '단계적 사고');
  assert.equal(
    findByClass(container, 'plugin-canvas-sheet-source')[0].textContent,
    '제공: Model Context Protocol · server-sequential-thinking',
  );
  assert.equal(
    findByClass(container, 'plugin-canvas-sheet-command')[0].textContent,
    '실행 명령: npx -y @modelcontextprotocol/server-sequential-thinking',
  );
  assert.equal(
    findByClass(container, 'plugin-canvas-sheet-location')[0].textContent,
    '설치 위치 · 플러그인 모드 > 단계적 사고',
  );
  assert.equal(findByClass(container, 'plugin-canvas-sheet-feature').length, 1);
  assert.equal(buttonWithClass(container, 'is-sheet-cancel').textContent, '거부');
  assert.equal(buttonWithClass(container, 'is-sheet-confirm').textContent, '승인');

  await buttonWithClass(container, 'is-sheet-cancel').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0);
  assert.equal(canvas.getState().recommended.length, 3);
  assert.deepEqual(approvals, []);
});

test('승인은 호스트가 성공을 돌려준 뒤에만 시트를 닫고 추천에서 뺀다', async () => {
  const approvals = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onApproveInstall: (plugin, features) => {
      approvals.push([plugin.id, features.map((feature) => feature.name)]);
      return Promise.resolve({ ok: true });
    },
  });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0);
  assert.equal(canvas.getState().recommended.length, 2, '설치한 항목은 추천에서 빠진다');
  assert.equal(canvas.getState().installed.length, 2, '설치 목록은 호스트의 setData가 채운다');
  assert.deepEqual(approvals, [[
    'sequential-thinking',
    ['sequentialthinking — 생각 단계를 기록·수정하고 되돌립니다'],
  ]]);
});

test('설치가 실패하면 시트를 닫지 않고 이유를 보여준다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onApproveInstall: () => Promise.resolve({ ok: false, error: 'npx를 찾지 못했습니다' }),
  });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-install-sheet').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, 'npx를 찾지 못했습니다');
  assert.equal(canvas.getState().recommended.length, 3, '실패한 설치는 추천에서 빠지지 않는다');
});

test('설치 경로가 연결되지 않은 호스트에서는 승인이 조용히 성공하지 않는다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, '설치 경로가 연결되지 않았습니다');
  assert.equal(canvas.getState().recommended.length, 3);
});

// --- 04 관리·마켓플레이스 ------------------------------------------------------

test('관리 버튼은 콜백 후 Paper 04 관리 화면으로 전환한다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onManage: (view) => calls.push(view) });
  canvas.mount();
  await buttonWithClass(container, 'is-manage').dispatchEvent({ type: 'click' });

  assert.deepEqual(calls, ['manage']);
  assert.equal(findByClass(container, 'plugin-canvas-title')[0].textContent, '플러그인 관리');
  assert.equal(canvas.getState().view, 'manage');
  assert.equal(
    findByClass(container, 'plugin-canvas-description')[0].textContent,
    '플러그인만 설치·활성화합니다. 제공 기능은 상세 화면에서 허용하며 Athena 내장 API는 표시하지 않습니다.',
  );
});

test('관리 화면은 플러그인·기능·마켓플레이스 집계와 토글 상태를 표시한다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, initialView: 'manage' });
  canvas.mount();

  assert.deepEqual(texts(container, 'plugin-canvas-count'), ['플러그인 2', '기능 3', '마켓플레이스 1']);
  assert.deepEqual(
    findByClass(container, 'plugin-canvas-toggle').map((node) => node.getAttribute('aria-checked')),
    ['true', 'false', 'true'],
  );
});

test('토글은 각각의 콜백을 부르고 aria-label에 UI 초안 표현을 쓰지 않는다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onTogglePlugin: (plugin, enabled) => { calls.push(['plugin', plugin.id, enabled]); return { ok: true }; },
    onToggleMarketplace: (marketplace, enabled) => { calls.push(['marketplace', marketplace.id, enabled]); return { ok: true }; },
  });
  canvas.mount();
  const toggles = findByClass(container, 'plugin-canvas-toggle');
  await toggles[1].dispatchEvent({ type: 'click' });
  await toggles[2].dispatchEvent({ type: 'click' });

  assert.equal(toggles[1].getAttribute('aria-checked'), 'true');
  assert.equal(toggles[1].getAttribute('aria-label'), '시간·시간대 끄기');
  assert.equal(toggles[2].getAttribute('aria-checked'), 'false');
  assert.deepEqual(calls, [
    ['plugin', 'time', true],
    ['marketplace', 'athena-official', false],
  ]);
});

test('토글이 실패하면 원래 상태로 되돌리고 같은 행에 이유를 붙인다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onTogglePlugin: () => Promise.resolve({ ok: false, error: '승인 철회에 실패했습니다' }),
  });
  canvas.mount();
  const toggle = findByClass(container, 'plugin-canvas-toggle')[0];
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  await toggle.dispatchEvent({ type: 'click' });

  assert.equal(toggle.getAttribute('aria-checked'), 'true', '실패하면 켜진 상태로 되돌아온다');
  assert.deepEqual(texts(container, 'plugin-canvas-manage-error'), ['승인 철회에 실패했습니다']);
});

test('삭제는 호스트가 경로를 넘겼을 때만 나오고 확인 시트를 거친다', async () => {
  const removed = [];
  const container = fakeNode('div');
  const withoutRemove = createPluginCanvas({ container, initialView: 'manage' });
  withoutRemove.mount();
  assert.equal(findByClass(container, 'is-danger').length, 0);

  const container2 = fakeNode('div');
  const canvas = createPluginCanvas({
    container: container2,
    initialView: 'manage',
    onRemovePlugin: (plugin) => { removed.push(plugin.id); return { ok: true }; },
  });
  canvas.mount();
  assert.equal(findByClass(container2, 'is-danger').length, 2, '플러그인 행에만 붙는다');

  await buttonWithClass(container2, 'is-danger').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container2, 'plugin-canvas-remove-sheet').length, 1);
  assert.equal(findByClass(container2, 'plugin-canvas-sheet-title')[0].textContent, '웹 문서 읽기 삭제');
  await buttonWithClass(container2, 'is-sheet-danger').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(removed, ['fetch']);
  assert.equal(findByClass(container2, 'plugin-canvas-sheet').length, 0);
});

test('삭제 실패는 시트를 닫지 않고 이유를 보여준다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onRemovePlugin: () => Promise.resolve({ ok: false, error: '레지스트리를 쓰지 못했습니다' }),
  });
  canvas.mount();
  await buttonWithClass(container, 'is-danger').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-danger').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-remove-sheet').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, '레지스트리를 쓰지 못했습니다');
});

// --- 호스트 계약 ---------------------------------------------------------------

test('호출자가 전달한 목록과 집계값을 그대로 사용하며 원본 객체는 변경하지 않는다', async () => {
  const installed = [{ id: 'custom', name: '사내 플러그인', description: '내부 확장', enabled: false, featureCount: 1 }];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    installed,
    recommended: [],
    marketplaces: [],
    initialView: 'manage',
    counts: { plugins: 7, features: 11, marketplaces: 3 },
  });
  canvas.mount();
  assert.deepEqual(texts(container, 'plugin-canvas-count'), ['플러그인 7', '기능 11', '마켓플레이스 3']);
  await findByClass(container, 'plugin-canvas-toggle')[0].dispatchEvent({ type: 'click' });
  assert.equal(installed[0].enabled, false, '표시 상태는 호출자 소유 객체를 직접 바꾸지 않는다');
});

test('서버 추가 시트가 열려 있는 동안 목록 갱신이 와도 터지지 않는다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, installed: [], recommended: [], marketplaces: [] });
  canvas.mount();
  buttonWithClass(container, 'is-add').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-add-sheet').length, 1);

  canvas.setData({ installed: [{ id: 'fetch', name: 'fetch', enabled: true, featureCount: 1, features: [] }] });
  assert.equal(findByClass(container, 'plugin-canvas-add-sheet').length, 1, '시트는 그대로 열려 있다');
  assert.equal(canvas.getState().installed.length, 1);
});

test('설치는 단일 모달이고 기능 허용은 배경을 막지 않는 단일 상세 화면이다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();

  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });
  const panel = findByClass(container, 'plugin-canvas-panel')[0];
  assert.equal(panel.getAttribute('inert'), '');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  const dialog = findByClass(container, 'plugin-canvas-sheet')[0];
  assert.equal(dialog.getAttribute('aria-modal'), 'true');

  await buttonWithClass(container, 'is-sheet-cancel').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-primary').dispatchEvent({ type: 'click' });
  const view = findByClass(container, 'plugin-canvas-permissions-view')[0];
  assert.equal(view.getAttribute('inert'), null);
  assert.equal(findByClass(container, 'plugin-canvas-sheet-overlay').length, 0);
});
