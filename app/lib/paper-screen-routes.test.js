'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROUTES, STEP_KINDS, STRUCTURE_KINDS } = require('./paper-screen-routes.js');
const { MODES } = require('./live-full-catalog.js');
const { PHRASES } = require('./paper-screen-phrases.generated.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LEDGER_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'paper-ledger');
const manifest = require(path.join(LEDGER_DIR, 'manifest.json'));

const screenBoards = new Map(manifest.boards.filter((b) => b.role === 'screen').map((b) => [b.id, b]));
const ledger = (boardId) => JSON.parse(fs.readFileSync(
  path.join(LEDGER_DIR, screenBoards.get(boardId).page, `${boardId}.json`), 'utf8'));

const shellHtml = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
const orbHtml = fs.readFileSync(path.join(__dirname, '..', 'orb.html'), 'utf8');

// ---------- 표의 모양 ----------

test('every route targets a distinct board the manifest calls a screen', () => {
  const seen = new Set();
  for (const route of ROUTES) {
    assert.ok(screenBoards.has(route.board), `${route.board}는 role==="screen"이 아니다`);
    assert.equal(seen.has(route.board), false, `${route.board}가 두 번 있다`);
    seen.add(route.board);
  }
});

test('every route renders in a window the app actually has', () => {
  // boot은 부팅 단계 보드가 사는 창이다(main.js createWindows의 bootWin) — 부팅이
  // 끝나면 셸로 넘어가며 사라지므로, 그 창을 쓰는 라우트는 boot-hold로 세워 둔다.
  for (const route of ROUTES) assert.ok(['boot', 'shell', 'orb'].includes(route.window), route.board);
});

test('a route that lives in the boot window holds the sequence at one stage', () => {
  for (const route of ROUTES.filter((r) => r.window === 'boot')) {
    const hold = route.reach.filter((step) => step.do === 'boot-hold');
    assert.equal(hold.length, 1, `${route.board}: 부팅 창은 단계를 세워야 잰다`);
    assert.ok(Number.isInteger(hold[0].chars) && hold[0].chars >= 0 && hold[0].chars <= 6,
      `${route.board}: 세울 글자 수는 0~6이다 ('ATHENA')`);
  }
  // 세우는 통로는 라우트표만의 발명이 아니라 앱이 실제로 읽는 파라미터다.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8'),
    /bootHoldChars=\(\[0-6\]\)/);
});

// ---------- reach 어휘가 닫혀 있다 ----------

test('every reach step uses a declared verb and carries exactly its declared arguments', () => {
  for (const route of ROUTES) {
    assert.ok(Array.isArray(route.reach) && route.reach.length > 0, `${route.board} reach 없음`);
    for (const step of route.reach) {
      const required = STEP_KINDS[step.do];
      assert.ok(required, `${route.board}: 어휘 밖 스텝 ${step.do}`);
      const given = Object.keys(step).filter((k) => k !== 'do').sort();
      assert.deepEqual(given, [...required].sort(), `${route.board} ${step.do}`);
    }
  }
});

// 탈출구를 쓰는 보드는 이 여섯뿐이고 전부 온보딩 안이다. 온보딩은 부팅이 딱 한 번
// 읽는 상태라(chat.js athena:onboarding-state → startOnboarding) 도달한 뒤에 그
// 화면을 여는 클릭이 앱 어디에도 없다. 인증 셋(19·20·21)은 한 겹 더 깊다: 계좌
// 단계에서 인증 화면으로 넘어가는 클릭은 앱키·시크릿 검증이 성공해야 생긴다
// (onboarding.js onRegistered) — 검사에서 만들 수 없는 자극이다. 목록을 여기서
// 잠가 eval이 다른 보드로 번지지 않게 한다.
const EVAL_ROUTES = new Set(['1DX-0', '1FN-0', '2V0K-1', '1I0-0', '1KK-0', '1M3-0']);

test('the only eval escape hatches are the onboarding ones, and each says why', () => {
  assert.deepEqual(STEP_KINDS.eval, ['js', 'why']);
  const used = ROUTES.filter((r) => r.reach.some((s) => s.do === 'eval')).map((r) => r.board);
  assert.deepEqual(used.filter((board) => !EVAL_ROUTES.has(board)), [],
    '온보딩 밖에서 eval을 쓰려면 그 보드가 왜 클릭으로 못 가는지부터 적어야 한다');
  for (const route of ROUTES) {
    for (const step of route.reach.filter((s) => s.do === 'eval')) {
      assert.ok(String(step.why || '').trim(), `${route.board}: eval에 why가 없다`);
    }
  }
});

test('every mode step names a mode the shell can actually switch to', () => {
  const views = new Set(MODES.map((m) => m.view));
  for (const route of ROUTES) {
    for (const step of route.reach.filter((s) => s.do === 'mode')) {
      assert.ok(views.has(step.view), `${route.board}: 모드 ${step.view}가 없다`);
    }
  }
});

// ---------- 셀렉터가 실재한다 (§4.4 규칙 1의 축소판) ----------

test('every DOM id literal in a route exists in shell.html or orb.html', () => {
  const html = shellHtml + orbHtml;
  const selectors = [];
  for (const route of ROUTES) {
    selectors.push(route.root);
    for (const step of route.reach) if (step.selector) selectors.push(step.selector);
    for (const check of route.structure) selectors.push(check.selector);
  }
  for (const selector of selectors) {
    for (const id of selector.match(/#[A-Za-z][\w-]*/g) ?? []) {
      assert.ok(html.includes(`id="${id.slice(1)}"`), `${selector}: ${id}가 마크업에 없다`);
    }
  }
});

test('the data attributes the reach steps click are the ones the app writes', () => {
  // 값이 아니라 키로 집는 관례(shell.html data-view)를 캔버스·설정도 따르는지 잠근다.
  assert.match(fs.readFileSync(path.join(__dirname, 'agent-canvas.js'), 'utf8'), /btn\.setAttribute\('data-view', view\.key\);/);
  // 드릴인 세그먼트도 같은 관례를 따른다 — 보드 06이 [설정] 탭을 키로 집는다.
  assert.match(fs.readFileSync(path.join(__dirname, 'agent-canvas.js'), 'utf8'), /btn\.setAttribute\('data-key', tab\.key\);/);
  assert.match(fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8'), /b\.setAttribute\('data-key', item\.key\);/);
});

test('the in-progress shell route hangs the real query IPC before submitting through the composer', () => {
  const route = ROUTES.find((item) => item.board === '3KM-0');
  assert.ok(route, '3KM-0 route missing');
  const hang = route.reach.findIndex((step) => step.do === 'ipc-hang');
  assert.deepEqual(route.reach.slice(hang, hang + 2), [
      { do: 'ipc-hang', channel: 'athena__render_canvas' },
      { do: 'command-bar', text: '백엔드 API 개수 확인' },
    ]);
  assert.deepEqual(route.reach[hang + 2], {
    do: 'wait-for', selector: '.progress-line', count: 1, timeout: 2000,
  });
  assert.deepEqual(route.structure, [
    { what: 'count', selector: '.turn-q', equals: 1 },
    { what: 'count', selector: '.progress-line', equals: 1 },
    { what: 'absent', selector: '.turn-a' },
  ]);
  assert.ok(route.phrases.includes('백엔드 API 개수 확인'));
});

test('the disabled backtest route reaches the real 503 mapping without starting a run', () => {
  const route = ROUTES.find((item) => item.board === '2GZM-2');
  assert.ok(route, '2GZM-2 route missing');
  assert.deepEqual(route.reach.slice(0, 2), [
    {
      do: 'ipc-fixture',
      channel: 'athena:backtest-presets',
      data: { ok: false, status: 503, error: 'ATHENA_BACKTEST_ENABLED=0' },
    },
    { do: 'mode', view: 'backtest' },
  ]);
  assert.equal(route.reach.some((step) => /run|backfill|deploy/.test(String(step.channel || ''))), false);
  assert.deepEqual(route.reach[2], {
    do: 'wait-for', selector: '.backtest-canvas-error', count: 1, timeout: 2000,
  });
  assert.deepEqual(route.structure, [
    { what: 'count', selector: '.backtest-canvas-error', equals: 1 },
    { what: 'count', selector: '.backtest-error-badge', equals: 1 },
    { what: 'count', selector: '.backtest-error-back', equals: 1 },
  ]);
});

test('the responsive fixture clears restored history through the existing new-conversation path', () => {
  const route = ROUTES.find((item) => item.board === 'G5B-0');
  assert.deepEqual(route.reach.slice(0, 2), [
    {
      do: 'ipc-fixture',
      channel: 'athena:conversations-new',
      data: { conversations: [], projects: [], currentProjectId: null, activeId: 'fx-new' },
    },
    { do: 'click', selector: '#sidebarNewChat' },
  ]);
  assert.deepEqual(route.reach[2], {
    do: 'wait-for', selector: '#history > *', count: 0, timeout: 2000,
  });
  assert.deepEqual(route.structure.slice(1, 3), [
    { what: 'count', selector: '#history', equals: 1 },
    { what: 'count', selector: '#history > *', equals: 0 },
  ]);
});

test('the fired-orb fixture waits for the asynchronous routine count refresh', () => {
  const route = ROUTES.find((item) => item.board === 'DO-0');
  const fired = route.reach.findIndex((step) => step.do === 'send' && step.channel === 'athena:routine-event');
  assert.ok(fired >= 0);
  const fixture = route.reach[0];
  assert.equal(fixture.do, 'ipc-fixture');
  assert.equal(fixture.channel, 'athena:routines-list');
  assert.equal(fixture.data.data.routines.filter((routine) => routine.status === 'active').length, 3);
  assert.ok(route.reach.indexOf(fixture) < fired, 'routines-list fixture가 routine event보다 먼저여야 한다');
  assert.deepEqual(route.reach[fired + 1], {
    do: 'wait-for', selector: '.orb-ring-dot', count: 3, timeout: 2000,
  });
  assert.deepEqual(route.structure[0], { what: 'count', selector: '.orb-ring-dot', equals: 3 });
  const orb = fs.readFileSync(path.join(__dirname, '..', 'orb.js'), 'utf8');
  assert.match(orb, /refreshSatelliteRing[\s\S]+invoke\('athena:routines-list'\)/);
  assert.match(orb, /on\('athena:routine-event'[\s\S]+refreshSatelliteRing\(\)/);
});

// ---------- phrases (§4.4 규칙 4·5) ----------

test('every phrase is a text Paper really draws on that board', () => {
  for (const route of ROUTES) {
    const texts = new Set(ledger(route.board).texts.map((t) => String(t.text).trim()));
    for (const phrase of route.phrases) {
      assert.ok(texts.has(phrase), `${route.board}: 원장에 없는 문구 ${JSON.stringify(phrase)}`);
    }
  }
});

test('every phrase survived the generator, so none of them is a data value', () => {
  for (const route of ROUTES) {
    const candidates = new Set(PHRASES[route.board].phrases);
    for (const phrase of route.phrases) {
      assert.ok(candidates.has(phrase),
        `${route.board}: ${JSON.stringify(phrase)}는 E1~E7에 걸린 값이거나 생성물에 없다`);
    }
  }
});

// 3개 하한의 예외. 사유는 네 갈래뿐이고, 어느 쪽이든 대가로 structure를 2개 이상
// 실어 공허 통과를 막는다(아래 마지막 단언).
//   ledger-two  원장이 그 보드에 그린 텍스트가 애초에 둘뿐이다 — 부팅 02·05는
//               'ATHENA'(폭 guide)와 커서 '|'가 전부라, 3개를 채우려면 없는 문구를
//               지어내는 수밖에 없다. 이 갈래는 원장 크기로 참·거짓을 잰다.
//   state-two   원장에는 더 있지만 **한 번에 보이는 상태**가 두 줄뿐이다. 보드 26은
//               세 모드의 빈 화면을 나란히 그렸는데 앱은 그중 하나만 그린다 —
//               그 사실 자체를 아래 별도 테스트가 canvas.css·canvas.js·summary-table.js에서 잰다.
//               보드 10의 비활성 하위 상태도 앱과 Paper가 함께 쓰는 문구가 둘뿐이며,
//               실제 오류 컨테이너·배지·출구 셋을 구조 단언으로 함께 잰다.
//   values-only 원장에는 더 있지만 값이 아닌 줄이 둘뿐이다. 보드 05가 그린 문장은 거의
//               전부 실행 번호·버전·수익률을 품고 있어(「#41 vs #38 — 무엇이 달랐나」)
//               fixture를 바꾸면 같이 바뀐다 — 그 사실도 아래 별도 테스트가 잰다.
//   annotation-only 남는 줄이 전부 보드가 붙인 주석층이다. 보드 10은 값이 아닌 줄로
//               「action=entity」·「entity = 이름 또는 entity_id」와 발치의 정직성 규칙
//               네 줄을 그렸는데, 셋 다 도구 인자·상태 코드를 품은 계약 서술이라 앱
//               화면에 낼 수 없다 — 그 사실도 아래 별도 테스트가 잰다.
const PHRASE_FLOOR_EXCEPTIONS = new Map([
  ['16OD-2', { kind: 'ledger-two', why: '원장 texts가 ATHENA·| 둘뿐이다 (02 · 부팅 — READY)' }],
  ['16OX-2', { kind: 'ledger-two', why: '원장 texts가 ATHENA·| 둘뿐이다 (05 · 부팅 — COMPLETE)' }],
  ['COS-0', { kind: 'state-two', why: '대화 빈 화면이 제목·부제 둘뿐이다 (26 · 빈 작업공간)' }],
  ['2GZM-2', { kind: 'state-two', why: '비활성 하위 상태에서 Paper와 앱이 함께 쓰는 문구가 둘뿐이다 (10 · 백테스트)' }],
  ['1WSI-1', { kind: 'values-only', why: '값이 아닌 줄이 두 diff 칸 이름뿐이다 (05 · 백테스트 — 이력·비교)' }],
  ['3ZAA-1', { kind: 'annotation-only', why: '값이 아닌 줄이 두 절 제목뿐이다 (10 · 그래프 — 이 노드 설명해줘)' }],
]);

test('every route under three phrases has a documented two-phrase exception', () => {
  for (const [board, exception] of PHRASE_FLOOR_EXCEPTIONS) {
    if (exception.kind === 'ledger-two') {
      const texts = new Set(ledger(board).texts.map((t) => String(t.text).trim()));
      assert.ok(texts.size < 3,
        `${board}: 원장에 문구가 ${texts.size}개나 있다 — ${exception.why}가 거짓이다`);
    }
    const route = ROUTES.find((r) => r.board === board);
    if (route) {
      assert.ok(route.structure.length >= 2,
        `${board}: 문구를 깎았으면 structure가 최소 2개는 져야 한다`);
      assert.ok(route.phrases.length >= 2, `${board}: 문구가 둘은 있어야 예외가 성립한다`);
    }
  }
});

// COS-0의 예외가 기대는 사실 — 보드 26이 나란히 그린 대화·그래프 빈 화면을 앱은
// 한 번에 하나만 그린다. 대화 변형은 #gridEmpty(#mosaic 안)에 살고 그래프 모드에서는
// canvas.css가 숨기며, 그래프 변형(성향 축적 히어로)은 #gridEmpty에 없고 요약 표가
// 0건일 때 summary-table.js가 표 자리에 세운다(ec8c701). 어느 쪽이 무너져도 두 변형이
// 함께 보이므로 예외도 거짓이 된다.
test('the empty canvas draws one mode variant at a time', () => {
  const app = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(app, 'canvas.css'), 'utf8');
  assert.match(css, /#canvasRegion\[data-mode="graph"\] \.canvas-empty-chat \{ display: none; \}/);
  const canvas = fs.readFileSync(path.join(app, 'canvas.js'), 'utf8');
  assert.ok(!canvas.includes('canvas-empty-graphmode'),
    '그래프 변형이 #gridEmpty로 돌아왔다 — 대화 변형과 나란히 그려진다');
  const summary = fs.readFileSync(path.join(app, 'lib', 'graph-mode', 'summary-table.js'), 'utf8');
  assert.match(summary, /function renderGrowthHero\(/);
  assert.ok(summary.includes("'canvas-empty canvas-empty-graphmode'"),
    '성향 축적 히어로가 요약 표 자리에서 사라졌다');
});

// 1WSI-1의 예외가 기대는 사실 — 보드 05의 목록 머리와 비교 제목은 전략 이름과 실행
// 번호를 품고 있는데(「실행 이력 — 20-60 골든크로스」·「#41 vs #38 — 무엇이 달랐나」),
// 앱은 그 자리에 이름도 번호도 안 적는다. 상태 칸도 백엔드가 준 영어를 그대로 적어
// Paper의 「실패 — 캐시 부족 (수집 미승인)」과 맞을 길이 없다. 어느 하나라도 Paper 쪽으로
// 고쳐지면 이 테스트가 깨져 예외를 다시 보게 된다.
test('the history board names runs in a way the app never writes', () => {
  const canvas = fs.readFileSync(path.join(__dirname, 'backtest-canvas.js'), 'utf8');
  assert.ok(canvas.includes("el('div', 'backtest-card-title', '무엇이 달랐나')"),
    '비교 패널 제목이 실행 번호를 품게 됐다 — 1WSI-1의 문구 예외가 거짓이 된다');
  assert.ok(canvas.includes('`실행 이력 ${formatNumeric(runs.length)}건`'),
    '실행 목록 머리가 전략 이름을 적게 됐다 — 1WSI-1의 문구 예외가 거짓이 된다');
  assert.match(canvas, /backtest-history-status is-\$\{run\.status\}`, run\.status\)/);
});

// 3ZAA-1의 예외가 기대는 사실 — 보드 10에서 값이 아닌 줄은 두 절 제목과 주석층뿐이고,
// 앱은 그 주석층을 안 그린다. 다시 그리면 문구를 셋 이상 적을 수 있게 되므로 예외도
// 거짓이 된다 — 그때 이 테스트가 먼저 깨진다.
test('the entity board writes its annotations in a way the app never draws', () => {
  const controller = fs.readFileSync(path.join(__dirname, 'graph-mode', 'controller.js'), 'utf8');
  assert.ok(!controller.includes('이 답이 지켜야 하는 것'),
    '정직성 규칙이 패널로 돌아왔다 — 3ZAA-1의 문구 예외가 거짓이 된다');
  assert.ok(!/textContent = 'action=entity'/.test(controller),
    '도구 인자 이름을 패널에 적게 됐다 — 3ZAA-1의 문구 예외가 거짓이 된다');
});

test('each route carries 3 to 7 phrases', () => {
  for (const route of ROUTES) {
    const floor = PHRASE_FLOOR_EXCEPTIONS.has(route.board) ? 2 : 3;
    assert.ok(route.phrases.length >= floor, `${route.board}: ${route.phrases.length}개는 공허 통과한다`);
    assert.ok(route.phrases.length <= 7, `${route.board}: ${route.phrases.length}개는 너무 잘 깨진다`);
    assert.equal(new Set(route.phrases).size, route.phrases.length, `${route.board}: 중복 문구`);
  }
});

// ---------- structure (§4.3) ----------

test('every structure check uses one of the three allowed shapes', () => {
  for (const route of ROUTES) {
    assert.ok(Array.isArray(route.structure), route.board);
    for (const check of route.structure) {
      assert.ok(STRUCTURE_KINDS.includes(check.what), `${route.board}: ${check.what}`);
      assert.equal(typeof check.selector, 'string');
      if (check.what === 'count') assert.equal(typeof check.equals, 'number');
      if (check.what === 'order') assert.ok(Array.isArray(check.equals));
      if (check.what === 'absent') assert.equal('equals' in check, false);
    }
  }
});
