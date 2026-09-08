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
  assert.equal(
    findByClass(container, 'plugin-canvas-add-guide')[0].textContent,
    '추천 목록에 없으면 [+ 서버 추가]에서 배포 문서의 Claude Desktop 설정 JSON을 붙여넣습니다.',
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

test('선택 저장은 바뀐 것만 제안으로 만든다(켤 것·끌 것)', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: (spec) => proposed.push(spec) });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  const toggles = findByClass(container, 'plugin-canvas-toggle');
  await toggles[0].dispatchEvent({ type: 'click' }); // get_current_time 끄기
  await toggles[1].dispatchEvent({ type: 'click' }); // convert_time 켜기
  const confirm = buttonWithClass(container, 'is-sheet-confirm');
  assert.equal(confirm.textContent, '선택 저장');
  await confirm.dispatchEvent({ type: 'click' });

  assert.deepEqual(proposed, [[
    { action: 'allow_tools', target: 'time', features: ['convert_time'] },
    { action: 'revoke_tools', target: 'time', features: ['get_current_time'] },
  ]]);
});

test('바뀐 것이 없으면 저장은 제안을 만들지 않는다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: (spec) => proposed.push(spec) });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });

  assert.deepEqual(proposed, []);
  assert.equal(findByClass(container, 'plugin-canvas-permissions-view').length, 0);
});

test('권한 화면은 목록을 권한 초안이라 부르고 확정 지점을 밝힌다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: () => {} });
  canvas.mount();
  await buttonWithClass(container, 'is-primary').dispatchEvent({ type: 'click' });

  assert.deepEqual(texts(container, 'plugin-canvas-section-title'), ['권한 초안']);
  assert.equal(findByClass(container, 'plugin-canvas-draft-note')[0].textContent, '승인 카드로 확정합니다');
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
    onPropose: (spec) => approvals.push(spec),
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
  // 부제 없음 — "한 번에 하나씩 승인합니다"는 묶음 승인과 어긋나 폐기했다(2026-09-03 검수).
  assert.equal(findByClass(container, 'plugin-canvas-sheet-subtitle').length, 0);
  assert.equal(buttonWithClass(container, 'is-sheet-cancel').textContent, '거부');
  assert.equal(buttonWithClass(container, 'is-sheet-confirm').textContent, '승인');

  await buttonWithClass(container, 'is-sheet-cancel').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0);
  assert.equal(canvas.getState().recommended.length, 3);
  assert.deepEqual(approvals, []);
});

test('설치 시트의 승인은 제안을 만들 뿐 목록을 건드리지 않는다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: (spec) => proposed.push(spec) });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0, '시트는 닫힌다');
  assert.equal(canvas.getState().recommended.length, 3, '승인 전에는 추천에서 빠지지 않는다');
  assert.equal(canvas.getState().installed.length, 2, '설치 목록은 호스트의 setData가 채운다');
  assert.deepEqual(proposed, [{
    action: 'install',
    target: 'sequential-thinking',
    features: ['sequentialthinking — 생각 단계를 기록·수정하고 되돌립니다'],
  }]);
});

test('제안 경로가 연결되지 않은 호스트에서도 설치 시트는 아무것도 설치하지 않는다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(canvas.getState().recommended.length, 3);
  assert.equal(canvas.getState().installed.length, 2);
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

test('플러그인 토글은 제안만 만들고 행은 승인 전까지 움직이지 않는다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onPropose: (spec) => proposed.push(spec),
  });
  canvas.mount();
  const toggles = findByClass(container, 'plugin-canvas-toggle');
  await toggles[1].dispatchEvent({ type: 'click' });

  assert.equal(toggles[1].getAttribute('aria-checked'), 'false', '누른 즉시 켜지지 않는다');
  assert.equal(toggles[1].getAttribute('aria-label'), '시간·시간대 켜기');
  assert.equal(canvas.getState().installed[1].enabled, false);
  assert.deepEqual(proposed, [{ action: 'set_enabled', target: 'time', enabled: true }]);
});

test('마켓플레이스 토글은 호스트가 성공을 돌려준 뒤에 움직이고 실패는 같은 행에 붙는다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onToggleMarketplace: (marketplace, enabled) => { calls.push([marketplace.id, enabled]); return { ok: true }; },
  });
  canvas.mount();
  const toggle = findByClass(container, 'plugin-canvas-toggle')[2];
  await toggle.dispatchEvent({ type: 'click' });
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.deepEqual(calls, [['athena-official', false]]);

  const container2 = fakeNode('div');
  const failing = createPluginCanvas({
    container: container2,
    initialView: 'manage',
    onToggleMarketplace: () => Promise.resolve({ ok: false, error: '설정을 저장하지 못했습니다' }),
  });
  failing.mount();
  const failingToggle = findByClass(container2, 'plugin-canvas-toggle')[2];
  await failingToggle.dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(failingToggle.getAttribute('aria-checked'), 'true', '실패하면 켜진 상태 그대로다');
  assert.deepEqual(texts(container2, 'plugin-canvas-manage-error'), ['설정을 저장하지 못했습니다']);
});

test('관리 화면의 감사 로그는 시각·플러그인·기능·성공 여부만 보여준다', async () => {
  const container = fakeNode('div');
  const at = new Date(2026, 8, 3, 14, 5);
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onAuditLog: () => ({ entries: [
      { ts: at.toISOString(), alias: 'fetch', tool: 'fetch_url', success: true },
      { ts: at.toISOString(), alias: 'time', tool: 'convert_time', success: false },
    ] }),
  });
  canvas.mount();
  assert.deepEqual(texts(container, 'plugin-canvas-empty'), ['실행 기록을 읽는 중입니다']);

  await flush();
  assert.deepEqual(
    findByClass(container, 'plugin-canvas-audit-head')[0].children.map((cell) => cell.textContent),
    ['시각', '별칭', '도구', '결과'],
  );
  const rows = findByClass(container, 'plugin-canvas-audit-row');
  assert.equal(rows.length, 2);
  assert.deepEqual(texts(rows[0], 'plugin-canvas-audit-time'), ['2026-09-03 14:05']);
  assert.deepEqual(texts(rows[0], 'plugin-canvas-audit-plugin'), ['fetch']);
  assert.deepEqual(texts(rows[0], 'plugin-canvas-audit-feature'), ['fetch_url']);
  assert.deepEqual(texts(container, 'plugin-canvas-audit-result'), ['성공', '실패']);
  assert.equal(findByClass(container, 'is-failure').length, 1);
  // 인자 본문은 애초에 기록되지 않는다 — 행에는 네 칸뿐이다.
  assert.equal(rows[0].children.length, 4);
});

test('감사 로그를 읽지 못하면 이유와 다시 확인을 남기고, 누르면 다시 읽는다', async () => {
  const container = fakeNode('div');
  let attempt = 0;
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onAuditLog: () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('등록 목록을 확인하지 못했습니다'));
      return { entries: [{ ts: '2026-09-03T05:00:00+00:00', alias: 'fetch', tool: 'fetch_url', success: true }] };
    },
  });
  canvas.mount();
  await flush();
  assert.deepEqual(
    texts(container, 'plugin-canvas-error-text'),
    ['실행 기록을 읽지 못했습니다 — 등록 목록을 확인하지 못했습니다'],
  );
  assert.equal(findByClass(container, 'plugin-canvas-audit-row').length, 0);

  await buttonWithClass(container, 'is-retry').dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(attempt, 2);
  assert.equal(findByClass(container, 'plugin-canvas-error-text').length, 0);
  assert.equal(findByClass(container, 'plugin-canvas-audit-row').length, 1);
});

test('감사 로그 조회는 한 번에 하나만 나가고 관리 뷰로 다시 들어오면 새로 읽는다', async () => {
  const container = fakeNode('div');
  let calls = 0;
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onAuditLog: () => { calls += 1; return { entries: [] }; },
  });
  canvas.mount();
  // 읽는 중에 관리 뷰가 다시 그려져도 조회가 겹치지 않는다.
  canvas.setView('hub');
  canvas.setView('manage');
  await flush();
  assert.equal(calls, 1, '진행 중인 읽기에 업혀 탄다');

  canvas.setView('hub');
  canvas.setView('manage');
  await flush();
  assert.equal(calls, 2, '읽기가 끝난 뒤 재진입하면 다시 읽는다');
  assert.deepEqual(texts(container, 'plugin-canvas-empty'), ['실행 기록이 없습니다']);
});

test('관리 화면의 직접 등록은 허브와 같은 서버 추가 시트를 재사용한다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onPropose: (spec) => proposed.push(spec),
  });
  canvas.mount();
  await buttonWithClass(container, 'is-add').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-add-sheet').length, 1);

  const field = findByClass(container, 'plugin-canvas-snippet-input')[0];
  assert.match(field.placeholder, /"mcpServers"/);
  assert.match(field.placeholder, /"command": "npx"/);
  field.value = '{"mcpServers":{"x":{"command":"npx"}}}';
  await field.dispatchEvent({ type: 'input', target: field });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });

  assert.deepEqual(proposed, [{
    action: 'stage_snippet',
    target: null,
    snippet: '{"mcpServers":{"x":{"command":"npx"}}}',
  }]);
});

test('관리 행은 스위치·삭제 옆에 승인이 확정 지점임을 적는다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, initialView: 'manage', onPropose: () => {} });
  canvas.mount();
  const row = findByClass(container, 'plugin-canvas-manage-row')[0];
  assert.deepEqual(texts(row, 'plugin-canvas-manage-hint'), ['승인 후 지웁니다', '승인 후 반영됩니다']);
});

test('삭제는 제안 경로가 있을 때만 나오고 확인 시트가 제안을 만든다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const withoutPropose = createPluginCanvas({ container, initialView: 'manage' });
  withoutPropose.mount();
  assert.equal(findByClass(container, 'is-danger').length, 0);

  const container2 = fakeNode('div');
  const canvas = createPluginCanvas({
    container: container2,
    initialView: 'manage',
    onPropose: (spec) => proposed.push(spec),
  });
  canvas.mount();
  assert.equal(findByClass(container2, 'is-danger').length, 2, '플러그인 행에만 붙는다');

  await buttonWithClass(container2, 'is-danger').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container2, 'plugin-canvas-remove-sheet').length, 1);
  assert.equal(findByClass(container2, 'plugin-canvas-sheet-title')[0].textContent, '웹 문서 읽기 삭제');
  await buttonWithClass(container2, 'is-sheet-danger').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(proposed, [{ action: 'remove', target: 'fetch' }]);
  assert.equal(findByClass(container2, 'plugin-canvas-sheet').length, 0);
  assert.equal(canvas.getState().installed.length, 2, '승인 전에는 목록에서 사라지지 않는다');
});

test('서버 직접 등록은 붙여넣은 스니펫을 그대로 제안으로 만든다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: (spec) => proposed.push(spec) });
  canvas.mount();
  await buttonWithClass(container, 'is-add').dispatchEvent({ type: 'click' });
  assert.deepEqual(texts(container, 'plugin-canvas-add-step'), [
    '1. 플러그인 배포 문서에서 Claude Desktop용 설정 JSON을 복사합니다.',
    '2. mcpServers 아래 서버 한 개만 남겨 붙여넣습니다.',
    '3. [등록 제안]을 승인한 뒤 [관리]에서 해당 플러그인을 켜고 승인합니다.',
    '4. 설치됨 목록의 [권한]에서 연결을 확인하고 사용할 기능을 허용합니다.',
  ]);
  assert.deepEqual(texts(container, 'plugin-canvas-sheet-warning'), [
    '등록만으로는 실행되지 않습니다',
    '승인 카드로 확정합니다',
    '켜기와 권한 변경도 승인 카드에서 확정하며, 적용 시점은 결과 카드에서 확인합니다',
  ]);
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, '설정 JSON을 붙여넣어 주세요');
  assert.deepEqual(proposed, []);

  const field = findByClass(container, 'plugin-canvas-snippet-input')[0];
  field.value = '{"mcpServers":{"x":{"command":"npx"}}}';
  await field.dispatchEvent({ type: 'input', target: field });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });

  assert.deepEqual(proposed, [{
    action: 'stage_snippet',
    target: null,
    snippet: '{"mcpServers":{"x":{"command":"npx"}}}',
  }]);
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0);
});

test('서버 직접 등록은 잘못된 JSON과 여러 서버를 승인 제안 전에 막는다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: (spec) => proposed.push(spec) });
  canvas.mount();
  await buttonWithClass(container, 'is-add').dispatchEvent({ type: 'click' });

  const field = findByClass(container, 'plugin-canvas-snippet-input')[0];
  field.value = '{broken';
  await field.dispatchEvent({ type: 'input', target: field });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, '설정 JSON 형식을 확인해 주세요');

  field.value = '[]';
  await field.dispatchEvent({ type: 'input', target: field });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, 'mcpServers 아래에 서버 한 개를 넣어 주세요');

  field.value = '{"mcpServers":[]}';
  await field.dispatchEvent({ type: 'input', target: field });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, 'mcpServers 아래에 서버 한 개를 넣어 주세요');

  field.value = '{"mcpServers":{"a":{},"b":{}}}';
  await field.dispatchEvent({ type: 'input', target: field });
  await buttonWithClass(container, 'is-sheet-confirm').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet-error')[0].textContent, '서버는 한 번에 하나만 추가할 수 있습니다');
  assert.deepEqual(proposed, []);
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

// --- 승인 카드 -----------------------------------------------------------------
// 카드는 호스트가 setProposals로 넣은 봉투만 그린다. 이 모듈은 IPC도, 제안을
// 만들 권한도 없다 — 사람의 승인·거부 의도만 콜백으로 돌려준다.

function envelope(overrides) {
  return {
    proposal_id: 'p-1',
    source: 'model',
    revision: 7,
    actions: [{ action: 'install', target: 'fetch', features: ['fetch'] }],
    reason: '공시를 읽으려면 필요합니다',
    ...overrides,
  };
}

function mountedCanvas(deps) {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, installed: [], recommended: [], marketplaces: [], ...deps });
  canvas.mount();
  return { container, canvas };
}

test('모델 제안은 출처 라벨 아테나 제안으로, GUI 제안은 내 요청으로 그린다', () => {
  const { container, canvas } = mountedCanvas();
  canvas.setProposals([envelope(), envelope({ proposal_id: 'p-2', source: 'gui' })], { revision: 7 });

  assert.deepEqual(texts(container, 'plugin-canvas-proposal-source'), ['아테나 제안', '내 요청']);
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-title'), ['웹 문서 읽기 설치', '웹 문서 읽기 설치']);
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-reason'), [
    '공시를 읽으려면 필요합니다',
    '허브에서 [설치]를 눌렀습니다',
  ]);
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-note'), [
    '허브의 설치 버튼도 이 카드로 들어옵니다',
    '허브의 설치 버튼도 이 카드로 들어옵니다',
  ]);
});

test('승인 카드 구역은 앱 재시작 경계 문구를 한 번만 단다', () => {
  const { container, canvas } = mountedCanvas();
  canvas.setProposals([envelope(), envelope({ proposal_id: 'p-2', source: 'gui' })], { revision: 7 });

  // Paper 09의 경계 문구를 화면에도 낸다(2026-09-03 검수 확정). 카드마다가 아니라
  // 구역에 한 번이다 — 대기 목록 전체가 같은 운명을 진다.
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-boundary'), [
    '앱을 완전히 껐다 켜면 대기 중인 제안은 사라집니다',
  ]);
});

test('카드는 제안 대기 → 처리됨 3상태를 가진다', async () => {
  const { container, canvas } = mountedCanvas({
    onApproveProposal: () => Promise.resolve({ kind: 'success' }),
  });
  canvas.setProposals([envelope()], { revision: 7 });
  assert.equal(findByClass(container, 'plugin-canvas-proposal')[0].getAttribute('data-proposal-state'), 'pending');
  assert.deepEqual(texts(container, 'agent-mode'), ['제안 대기']);

  await buttonWithClass(container, 'is-proposal-approve').dispatchEvent({ type: 'click' });
  await flush();

  assert.equal(findByClass(container, 'plugin-canvas-proposal')[0].getAttribute('data-proposal-state'), 'done');
  assert.deepEqual(texts(container, 'agent-mode'), ['승인됨']);
  assert.equal(buttonWithClass(container, 'is-proposal-approve').disabled, true);
  assert.equal(buttonWithClass(container, 'is-proposal-reject').disabled, true);
});

test('거부는 카드를 잠그고 승인 경로를 부르지 않는다', async () => {
  const calls = [];
  const { container, canvas } = mountedCanvas({
    onApproveProposal: () => { calls.push('approve'); return { kind: 'success' }; },
    onRejectProposal: (env) => { calls.push(['reject', env.proposal_id]); return { kind: 'rejected' }; },
  });
  canvas.setProposals([envelope()], { revision: 7 });
  await buttonWithClass(container, 'is-proposal-reject').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(calls, [['reject', 'p-1']]);
  assert.deepEqual(texts(container, 'agent-mode'), ['거부됨']);
  // 카드는 남는다 — 응답 즉시 지우면 사람이 처리 결과를 못 본다.
  assert.equal(findByClass(container, 'plugin-canvas-proposal').length, 1);
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-line'), ['그대로 뒀습니다']);
});

test('처리된 카드는 제안 문구 대신 결과 문구를 쓴다', async () => {
  const { container, canvas } = mountedCanvas({
    onApproveProposal: () => Promise.resolve({
      kind: 'success', probes: [{ alias: 'fetch', ok: true, toolCount: 1 }],
    }),
  });
  canvas.setProposals([envelope()], { revision: 7 });
  await buttonWithClass(container, 'is-proposal-approve').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(texts(container, 'plugin-canvas-proposal-line'), [
    '등록했습니다', '연결을 확인했습니다', '기능 1개를 찾았습니다',
  ]);
  // 실패 사유는 한 줄로만 나온다 — 제안 이유 줄은 결과 카드에 남기지 않는다.
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-reason'), []);
});

test('실패한 카드는 사유 한 줄을 쓴다', async () => {
  const { container, canvas } = mountedCanvas({
    onApproveProposal: () => Promise.resolve({ kind: 'failed', reason: '명령을 찾지 못했습니다' }),
  });
  canvas.setProposals([envelope()], { revision: 7 });
  await buttonWithClass(container, 'is-proposal-approve').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(texts(container, 'agent-mode'), ['실패']);
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-line'), ['명령을 찾지 못했습니다']);
});

test('판번호가 어긋난 카드는 만료됨이고 승인이 비활성이며 다시 제안받기를 준다', async () => {
  const dismissed = [];
  const { container, canvas } = mountedCanvas({
    onDismissProposal: (env) => dismissed.push(env.proposal_id),
  });
  canvas.setProposals([envelope()], { revision: 9 });

  assert.equal(findByClass(container, 'plugin-canvas-proposal')[0].getAttribute('data-proposal-state'), 'stale');
  assert.deepEqual(texts(container, 'agent-mode'), ['만료됨']);
  assert.equal(buttonWithClass(container, 'is-proposal-approve').disabled, true);
  assert.equal(buttonWithClass(container, 'is-proposal-again').textContent, '다시 제안받기');

  await buttonWithClass(container, 'is-proposal-again').dispatchEvent({ type: 'click' });
  assert.deepEqual(dismissed, ['p-1']);
  assert.equal(findByClass(container, 'plugin-canvas-proposal').length, 0);
});

test('승인 직전에 만료로 밝혀진 카드도 다시 제안받기를 준다', async () => {
  const dismissed = [];
  const { container, canvas } = mountedCanvas({
    // 메인이 승인 시점에 판번호를 다시 재고 kind=stale로 돌려주는 경로.
    onApproveProposal: () => Promise.resolve({ kind: 'stale', reason: '목록이 바뀌어 다시 확인이 필요합니다' }),
    onDismissProposal: (env) => dismissed.push(env.proposal_id),
  });
  canvas.setProposals([envelope()], { revision: 7 });
  await buttonWithClass(container, 'is-proposal-approve').dispatchEvent({ type: 'click' });
  await flush();

  assert.deepEqual(texts(container, 'agent-mode'), ['만료됨']);
  assert.equal(buttonWithClass(container, 'is-proposal-approve').disabled, true);
  assert.equal(buttonWithClass(container, 'is-proposal-reject').disabled, true);
  assert.equal(buttonWithClass(container, 'is-proposal-again').textContent, '다시 제안받기');

  await buttonWithClass(container, 'is-proposal-again').dispatchEvent({ type: 'click' });
  assert.deepEqual(dismissed, ['p-1']);
});

test('판번호를 모르는 봉투는 만료로 몰지 않는다', () => {
  const { container, canvas } = mountedCanvas();
  canvas.setProposals([envelope({ revision: null })], { revision: 9 });
  assert.equal(findByClass(container, 'plugin-canvas-proposal')[0].getAttribute('data-proposal-state'), 'pending');
});

test('사람이 치운 제안은 복원으로 되살아나지 않는다', async () => {
  const { container, canvas } = mountedCanvas({ onDismissProposal: () => {} });
  canvas.setProposals([envelope()], { revision: 9 });
  await buttonWithClass(container, 'is-proposal-again').dispatchEvent({ type: 'click' });

  canvas.setProposals([envelope()], { revision: 9 });
  assert.equal(findByClass(container, 'plugin-canvas-proposal').length, 0, '치운 카드는 다시 그려지지 않는다');
  assert.deepEqual(canvas.getState().proposals, []);
});

test('같은 봉투를 그대로 다시 넣으면 처리된 카드가 그대로 남는다', async () => {
  const { container, canvas } = mountedCanvas({
    onRejectProposal: () => ({ kind: 'rejected' }),
  });
  const envelopes = [envelope()];
  canvas.setProposals(envelopes, { revision: 7 });
  await buttonWithClass(container, 'is-proposal-reject').dispatchEvent({ type: 'click' });
  await flush();

  canvas.setProposals(envelopes, { revision: 7 });
  assert.deepEqual(canvas.getState().proposals, [{ id: 'p-1', state: 'done', kind: 'rejected' }]);
  assert.deepEqual(texts(container, 'agent-mode'), ['거부됨']);
});

test('실패한 카드는 같은 번호가 다시 등록되면 대기로 돌아간다', async () => {
  const { container, canvas } = mountedCanvas({
    onApproveProposal: () => Promise.resolve({ kind: 'failed', reason: '명령을 찾지 못했습니다' }),
  });
  canvas.setProposals([envelope()], { revision: 7 });
  await buttonWithClass(container, 'is-proposal-approve').dispatchEvent({ type: 'click' });
  await flush();
  assert.deepEqual(texts(container, 'agent-mode'), ['실패']);

  // 호스트가 같은 번호로 새 봉투를 넣는다(채팅의 다시 시도·모델 재제안).
  canvas.setProposals([envelope()], { revision: 7 });
  assert.deepEqual(canvas.getState().proposals, [{ id: 'p-1', state: 'pending', kind: null }]);
  assert.deepEqual(texts(container, 'agent-mode'), ['제안 대기']);
  assert.notEqual(buttonWithClass(container, 'is-proposal-approve').disabled, true);
});

test('승인 카드의 버튼은 전부 키보드로 닿는 실제 버튼이다', () => {
  const { container, canvas } = mountedCanvas();
  canvas.setProposals([envelope({ revision: 9 })], { revision: 7 });
  const buttons = findByClass(container, 'plugin-canvas-proposal-action');
  assert.equal(buttons.length, 3);
  buttons.forEach((button) => {
    assert.equal(button.tag, 'button');
    assert.equal(button.type, 'button');
    assert.ok(String(button.className).includes('plugin-canvas-action'), '클릭 영역 32px은 이 클래스가 준다');
  });
});

test('이 모듈은 스스로 제안을 만들지 않는다 — 넣지 않으면 카드가 없다', () => {
  const { container, canvas } = mountedCanvas({ onPropose: () => {} });
  assert.equal(findByClass(container, 'plugin-canvas-proposal').length, 0);
  canvas.setProposals([], { revision: 7 });
  assert.equal(findByClass(container, 'plugin-canvas-proposal').length, 0);
  assert.equal(canvas.getState().revision, 7);
});

test('plugin-canvas.js는 window.athena를 한 번도 부르지 않는다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'plugin-canvas.js'), 'utf8');
  const calls = source.split('\n').filter((line) => /window\.athena\./.test(line));
  assert.deepEqual(calls, [], 'IPC는 호스트(canvas.js)의 몫이다');
});

// --- 권한 초안 보존(H4) · 발산(PM-4) -------------------------------------------

test('모드를 나갔다 와도 저장 전 토글이 남는다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: () => {} });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  await findByClass(container, 'plugin-canvas-toggle')[1].dispatchEvent({ type: 'click' });

  canvas.setView('hub'); // 사이드바가 모드 진입마다 부르는 그 호출
  assert.deepEqual(canvas.getState().permissionDraft, {
    pluginId: 'time',
    draft: { get_current_time: true, convert_time: true },
  });

  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(
    findByClass(findByClass(container, 'plugin-canvas-permissions-view')[0], 'plugin-canvas-toggle')
      .map((toggle) => toggle.getAttribute('aria-checked')),
    ['true', 'true'],
  );
});

test('초안과 실제가 갈리면 무엇이 달라졌는지 알리고 두 갈래를 준다', async () => {
  const proposed = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: (spec) => proposed.push(spec) });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  await findByClass(container, 'plugin-canvas-toggle')[1].dispatchEvent({ type: 'click' });
  canvas.setView('hub');

  // 그 사이 다른 경로가 get_current_time 허용을 끊었다.
  canvas.setData({
    installed: [{
      id: 'time',
      name: '시간·시간대',
      enabled: true,
      featureCount: 2,
      features: [
        { id: 'get_current_time', name: 'get_current_time', allowed: false },
        { id: 'convert_time', name: 'convert_time', allowed: false },
      ],
    }],
    recommended: [],
    marketplaces: [],
  });
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[0].dispatchEvent({ type: 'click' });

  assert.equal(
    findByClass(container, 'plugin-canvas-draft-divergence-text')[0].textContent,
    '그 사이 바뀐 기능: get_current_time',
  );
  assert.deepEqual(canvas.getState().divergence, ['get_current_time']);

  await buttonWithClass(container, 'is-draft-reset').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-draft-divergence').length, 0);
  assert.deepEqual(
    findByClass(container, 'plugin-canvas-toggle').map((toggle) => toggle.getAttribute('aria-checked')),
    ['false', 'false'],
    '현재 값으로 초기화하면 실제 허용만 남는다',
  );
  assert.deepEqual(proposed, []);
});

test('목록 갱신이 도착해도 열려 있는 권한 초안은 살아남는다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: () => {} });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });
  await findByClass(container, 'plugin-canvas-toggle')[1].dispatchEvent({ type: 'click' });

  canvas.setData({
    installed: [{
      id: 'time',
      name: '시간·시간대',
      enabled: true,
      featureCount: 2,
      features: [
        { id: 'get_current_time', name: 'get_current_time', allowed: true },
        { id: 'convert_time', name: 'convert_time', allowed: false },
      ],
    }],
    recommended: [],
    marketplaces: [],
  });

  assert.deepEqual(
    findByClass(container, 'plugin-canvas-toggle').map((toggle) => toggle.getAttribute('aria-checked')),
    ['true', 'true'],
  );
});

test('토글하지 않은 권한 화면은 늦게 온 probe 허용 상태를 그대로 반영한다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: () => {} });
  canvas.mount();
  await findByClass(container, 'is-primary').filter((n) => n.tag === 'button')[1].dispatchEvent({ type: 'click' });

  canvas.setData({
    installed: [{
      id: 'time',
      name: '시간·시간대',
      enabled: true,
      featureCount: 2,
      features: [
        { id: 'get_current_time', name: 'get_current_time', allowed: true },
        { id: 'convert_time', name: 'convert_time', allowed: true },
      ],
    }],
    recommended: [],
    marketplaces: [],
  });

  assert.deepEqual(
    findByClass(container, 'plugin-canvas-toggle').map((toggle) => toggle.getAttribute('aria-checked')),
    ['true', 'true'],
  );
  assert.equal(canvas.getState().permissionDraft, null);
});

test('제안 구역은 카드가 있을 때만 비영속 한 줄을 남긴다', () => {
  // 같은 검수 회신을 두 트랙이 따로 구현해 이름이 갈렸다(proposal-boundary vs
  // proposals-note). main에 먼저 들어온 Paper 09 이름 하나로 합친다(2026-09-04 병합).
  const { container, canvas } = mountedCanvas();
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-boundary'), []);

  canvas.setProposals([envelope()], { revision: 7 });
  assert.deepEqual(
    texts(container, 'plugin-canvas-proposal-boundary'),
    ['앱을 완전히 껐다 켜면 대기 중인 제안은 사라집니다'],
  );

  canvas.setProposals([], { revision: 7 });
  assert.deepEqual(texts(container, 'plugin-canvas-proposal-boundary'), []);
});

test('설치 시트는 부제를 달지 않는다 — 묶음 승인이 가능해 개수를 말할 수 없다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onPropose: () => {} });
  canvas.mount();
  await buttonWithClass(container, 'is-secondary').dispatchEvent({ type: 'click' });

  assert.equal(findByClass(container, 'plugin-canvas-install-sheet').length, 1);
  assert.deepEqual(texts(container, 'plugin-canvas-sheet-subtitle'), []);
});
