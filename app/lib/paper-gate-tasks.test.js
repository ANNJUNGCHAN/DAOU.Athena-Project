'use strict';

// 게이트 리포트 → 작업 명세 변환기(`scripts/paper-gate-tasks.mjs`)를 잰다.
//
// 변환기가 조용히 거짓말하는 길은 둘이다. (1) 실패를 흘려 작업이 안 만들어지는 것,
// (2) 있지도 않은 파일을 files에 적어 구현자가 없는 파일을 찾아 헤매는 것. 그래서
// 실패 수집·정렬·files 추론을 각각 못 박는다.
//
// 고정물의 보드 id·페이지·이름은 **실원장에서 그대로 가져왔다**. files 추론이
// 저장소 실경로를 만들어 내는 것이라 가짜 id를 쓰면 그 규칙을 잴 수 없다. 리포트는
// 손으로 줄인 최소형이다 — app/captures 는 ignore라 실리포트에 기대면 안 된다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const scriptPath = path.join(ROOT, 'scripts', 'paper-gate-tasks.mjs');
let mod;
const load = async () => {
  if (!mod) mod = await import(pathToFileURL(scriptPath).href);
  return mod;
};

const MANIFEST = {
  boards: [
    { id: '11D-0', page: '1-0', name: '24 · 주문 — 거래 기능 연결 안내', role: 'screen' },
    { id: '16OD-2', page: '1-0', name: '02 · 부팅 — READY · 0–240ms', role: 'screen' },
    { id: '137X-2', page: '5-1', name: 'CC-03 / R01 · 삼성전자 3개월 차트', role: 'card_template' },
    { id: '46AX-0', page: 'H-1', name: 'mini/CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중', role: 'mini_card' },
  ],
};

const SCREENS = {
  gate: 'verify:paper-screens',
  boards: [
    { board_id: '11D-0', page: '1-0', name: '24 · 주문 — 거래 기능 연결 안내', role: 'screen', status: 'fail', failures: [{ code: 'route_missing' }] },
    { board_id: '16OD-2', page: '1-0', name: '02 · 부팅 — READY · 0–240ms', role: 'screen', status: 'fail', failures: [{ code: 'route_missing' }] },
    { board_id: '164F-2', page: '1-0', name: '01 · 통과', role: 'screen', status: 'pass', failures: [] },
  ],
};

const CARDS = {
  gate: 'verify:paper-cards-all',
  boards: [
    {
      board_id: '137X-2',
      card_id: 'CC-03',
      name: 'CC-03 / R01 · 삼성전자 3개월 차트',
      status: 'fail',
      failures: [
        { code: 'overflow_x', layer: 'mount', preset: '2분할', overflow_x: 303, nodes: [{ node: '14PX-2', name: 'Chart', over: 334 }] },
        { code: 'text_multiset_drift', layer: 'static', added: [{ text: '710만', count: 1 }], removed: [], count_changed: [] },
      ],
    },
  ],
};

const MINI = {
  gate: 'verify:paper-mini',
  boards: [
    {
      paper_board: '46AX-0',
      kind: 'mini',
      name: 'mini/CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중',
      ledger_board: '2SCE-1',
      grammar: 'compound',
      status: 'divergent',
      failures: [{ code: 'ledger_stale', text: '000660', found_in: '2SCE-1', label: 'SK하이닉스', group: 'Position 2', layer: 'static' }],
    },
  ],
};

const build = async (reports, options = {}) => {
  const { buildTasks } = await load();
  return buildTasks({ reports, manifest: MANIFEST, ...options });
};

// ---------- 수집: 실패한 보드만, 보드 1장에 작업 1개 ----------

test('통과한 보드는 작업이 되지 않는다', async () => {
  const tasks = await build([SCREENS]);
  assert.deepEqual(tasks.map((task) => task.source.board).sort(), ['11D-0', '16OD-2']);
});

test('한 보드의 실패 여럿은 작업 하나로 합쳐지고 코드는 무게 순으로 적힌다', async () => {
  const tasks = await build([CARDS]);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].source.codes, ['text_multiset_drift', 'overflow_x']);
});

test('키는 PAPER-<페이지>-<보드>이고 제목은 역할 이름을 앞에 붙인다', async () => {
  const task = (await build([SCREENS])).find((item) => item.source.board === '11D-0');
  assert.equal(task.key, 'PAPER-1-0-11D-0');
  assert.equal(task.title, '화면 24 · 주문 — 거래 기능 연결 안내');
});

test('원장에 없는 보드도 흘리지 않고 페이지 미상으로 작업이 된다', async () => {
  const orphan = { gate: 'verify:paper-screens', boards: [{ board_id: 'XX-9', name: '유령', status: 'fail', failures: [{ code: 'route_missing' }] }] };
  const [task] = await build([orphan]);
  assert.equal(task.key, 'PAPER-unknown-XX-9');
  assert.equal(task.source.page, null);
});

// ---------- files 추론 ----------

test('route_missing 은 라우트표·원장·페이지 코드 지도를 files에 담는다', async () => {
  const task = (await build([SCREENS])).find((item) => item.source.board === '11D-0');
  assert.ok(task.files.includes('app/lib/paper-screen-routes.js'));
  assert.ok(task.files.includes('backend/ref/paper-ledger/1-0/11D-0.json'));
  assert.ok(task.files.includes('app/lib/settings-cards.js'), '1-0 화면 페이지 코드가 빠졌다');
});

test('카드미니 실패는 대장 보드(ledger_board)의 템플릿을 files에 담는다', async () => {
  const [task] = await build([MINI]);
  assert.ok(task.files.includes('backend/ref/kiumi/kiumi-ledger.jsonl'));
  assert.ok(
    task.files.some((file) => file.includes('card-surface-templates/2SCE-1/')),
    'Paper 보드가 아니라 대장 보드의 템플릿을 봐야 한다',
  );
});

test('files 는 저장소에 실재하는 경로만 남긴다', async () => {
  for (const report of [SCREENS, CARDS, MINI]) {
    for (const task of await build([report])) {
      assert.ok(task.files.length, `${task.key}: files가 비었다`);
      for (const file of task.files) {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `없는 경로를 적었다 — ${file}`);
      }
    }
  }
});

test('files 는 같은 경로를 두 번 적지 않는다', async () => {
  const [task] = await build([CARDS]);
  assert.equal(new Set(task.files).size, task.files.length);
});

// ---------- 정렬·상한 ----------

test('같은 페이지 보드가 많은 쪽이 먼저 온다', async () => {
  // 1-0 두 장 대 5-1 한 장 — 한 파일을 여는 김에 여러 장을 닫는다(§6.4 정렬 1키).
  const tasks = await build([CARDS, SCREENS]);
  assert.deepEqual(tasks.map((task) => task.source.board), ['16OD-2', '11D-0', '137X-2']);
});

test('같은 페이지 안에서는 보드명 선두 번호가 작은 쪽이 먼저 온다', async () => {
  const tasks = await build([SCREENS]);
  assert.deepEqual(tasks.map((task) => task.source.board), ['16OD-2', '11D-0']);
  assert.equal(tasks[0].title, '화면 02 · 부팅 — READY · 0–240ms');
});

test('무게가 큰 실패 코드가 같은 페이지 안에서 앞선다', async () => {
  const mixed = {
    gate: 'verify:paper-screens',
    boards: [
      { board_id: '11D-0', page: '1-0', name: '24 · 주문 — 거래 기능 연결 안내', status: 'fail', failures: [{ code: 'route_missing' }] },
      { board_id: '16OD-2', page: '1-0', name: '02 · 부팅 — READY · 0–240ms', status: 'fail', failures: [{ code: 'contract_undocumented', sentences: ['어떤 계약.'] }] },
    ],
  };
  // 선두 번호는 02 < 24 지만 route_missing 이 더 무겁다 — 무게가 번호보다 앞선다.
  assert.deepEqual((await build([mixed])).map((task) => task.source.board), ['11D-0', '16OD-2']);
});

test('--limit 은 정렬 뒤 앞에서 자른다', async () => {
  const tasks = await build([CARDS, SCREENS], { limit: 1 });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].source.page, '1-0');
});

// ---------- spec·gates ----------

test('spec 은 실패마다 한 줄을 적고 마지막에 판정 명령을 적는다', async () => {
  const task = (await build([SCREENS])).find((item) => item.source.board === '11D-0');
  assert.match(task.spec, /route_missing/);
  assert.match(task.spec, /npm run verify:paper-screens -- --only 11D-0/);
});

test('spec 은 실패의 증거를 한 줄 요약으로 남긴다', async () => {
  const [task] = await build([CARDS]);
  assert.match(task.spec, /2분할/, '오버플로 프리셋이 빠지면 어디를 고칠지 알 수 없다');
  assert.match(task.spec, /710만/, '늘어난 문구가 빠지면 무엇이 어긋났는지 알 수 없다');
});

test('카드 보드의 판정 명령은 보드 좁히기 환경변수를 쓴다', async () => {
  const [task] = await build([CARDS]);
  assert.match(task.spec, /ATHENA_VERIFY_BOARD_IDS=137X-2/);
});

test('gates 는 unit 과 그 보드를 판정한 게이트를 담는다', async () => {
  const [screen] = await build([SCREENS]);
  assert.equal(screen.source.report, 'PAPER-SCREENS');
  assert.deepEqual(screen.gates, ['unit', 'verify:paper-screens']);
  const [card] = await build([CARDS]);
  assert.deepEqual(card.gates, ['unit', 'verify:paper-cards-static', 'verify:paper-cards-mount']);
  const [mini] = await build([MINI]);
  assert.deepEqual(mini.gates, ['unit', 'verify:paper-mini-static']);
});

test('작업마다 크기가 붙는다', async () => {
  const [task] = await build([SCREENS]);
  assert.ok(['S', 'M', 'L'].includes(task.size));
});

// ---------- 인자 ----------

test('parseArgs 는 --report 를 여러 번 받는다', async () => {
  const { parseArgs } = await load();
  assert.deepEqual(
    parseArgs(['--report', 'a.json', '--report', 'b.json', '--limit', '20', '--out', 'o.json']),
    { reports: ['a.json', 'b.json'], limit: 20, out: 'o.json' },
  );
});

test('parseArgs 는 값 없는 플래그를 오류로 거절한다', async () => {
  const { parseArgs } = await load();
  assert.match(parseArgs(['--report']).error, /--report/);
  assert.match(parseArgs(['--report', 'a.json', '--limit', '--out']).error, /--limit/);
});

test('parseArgs 는 --limit 이 정수가 아니면 거절한다', async () => {
  const { parseArgs } = await load();
  assert.match(parseArgs(['--report', 'a.json', '--limit', '0']).error, /--limit/);
  assert.match(parseArgs(['--report', 'a.json', '--limit', '스물']).error, /--limit/);
});

test('parseArgs 는 오타난 인자를 조용히 무시하지 않는다', async () => {
  const { parseArgs } = await load();
  assert.match(parseArgs(['--report', 'a.json', '--repot', 'b.json']).error, /--repot/);
});

test('parseArgs 는 --report 가 하나도 없으면 거절한다', async () => {
  const { parseArgs } = await load();
  assert.match(parseArgs([]).error, /--report/);
});
