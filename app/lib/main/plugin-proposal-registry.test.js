'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createPluginProposalRegistry } = require('./plugin-proposal-registry');

const CATALOG = [
  { id: 'time', command: 'uvx', args: ['mcp-server-time'] },
  { id: 'fetch', command: 'uvx', args: ['mcp-server-fetch'] },
];

function spy(installed = ['fetch'], overrides = {}) {
  const calls = [];
  const executor = {
    list() { calls.push(['list']); return { servers: installed.map((alias) => ({ alias })), revision: 7 }; },
    async stageSnippet(snippet) {
      calls.push(['stageSnippet', snippet]);
      const alias = Object.keys(JSON.parse(snippet).mcpServers)[0];
      return { ok: true, staged: [{ alias }] };
    },
    async register(staged) { calls.push(['register', staged.alias]); return { ok: true }; },
    async updateSnippet(alias, snippet) { calls.push(['updateSnippet', alias, snippet]); return { ok: true }; },
    async approve(alias) { calls.push(['approve', alias]); return { ok: true }; },
    async revoke(alias) { calls.push(['revoke', alias]); return { ok: true }; },
    async remove(alias) { calls.push(['remove', alias]); return { ok: true }; },
    async allowTool(alias, tool, allowed) { calls.push(['allowTool', alias, tool, allowed]); return { ok: true }; },
    async probe(alias) { calls.push(['probe', alias]); return { ok: true, tools: [{ name: 'a' }, { name: 'b' }] }; },
    ...overrides,
  };
  return { calls, executor, registry: createPluginProposalRegistry({ executor, catalog: CATALOG }) };
}

function envelope(actions, id = 'p1') {
  return { proposal_id: id, source: 'model', revision: 7, actions, reason: '' };
}

// --- 순수성 -----------------------------------------------------------------

test('electron도 main.js도 require하지 않는다', () => {
  const source = fs.readFileSync(path.join(__dirname, 'plugin-proposal-registry.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['node:crypto']);
});

// --- 1회용 소비 -------------------------------------------------------------

test('같은 제안을 두 번 승인할 수 없다', () => {
  const { registry } = spy();
  const proposal = envelope([{ action: 'remove', target: 'fetch' }]);
  assert.equal(registry.consume(proposal).ok, true);
  const again = registry.consume(proposal);
  assert.equal(again.ok, false);
  assert.equal(again.error, '이미 처리한 요청입니다');
});

// 실행이 실패했으면 되돌린다 — 그래야 결과 턴의 다시 시도 칩이 같은 봉투로 동작한다.
test('되돌린 제안은 다시 승인할 수 있다', () => {
  const { registry } = spy();
  const proposal = envelope([{ action: 'remove', target: 'fetch' }]);
  registry.consume(proposal);
  assert.equal(registry.release(proposal), true);
  assert.equal(registry.consume(proposal).ok, true);
  assert.equal(registry.release({ proposal_id: '' }), false);
});

test('소비 기록과 대기 목록은 스무 개에서 오래된 것부터 버린다', () => {
  const { registry } = spy();
  for (let i = 0; i < 25; i += 1) {
    const proposal = envelope([{ action: 'remove', target: 'fetch' }], `p${i}`);
    registry.note(proposal);
    registry.consume(proposal);
  }
  assert.equal(registry.pending().proposals.length, 0);
  // 오래된 다섯은 기록에서 밀려나 다시 승인할 수 있고, 최근 스무 개는 여전히 막힌다.
  assert.equal(registry.consume(envelope([{ action: 'remove', target: 'fetch' }], 'p0')).ok, true);
  assert.equal(registry.consume(envelope([{ action: 'remove', target: 'fetch' }], 'p24')).ok, false);
  for (let i = 0; i < 25; i += 1) registry.note(envelope([{ action: 'remove', target: 'fetch' }], `q${i}`));
  assert.equal(registry.pending().proposals.length, 20);
  assert.deepEqual(registry.pending().proposals[0].proposal_id, 'q5');
});

// --- 실행 순서 --------------------------------------------------------------

test('설치는 등록 → 재확인 → 승인 순으로 돈다', async () => {
  const { calls, registry } = spy();
  const result = await registry.apply(envelope([{ action: 'install', target: 'time' }]));
  assert.deepEqual(calls.map(([name]) => name), ['stageSnippet', 'register', 'approve']);
  assert.deepEqual(result.results, [{ action: 'install', target: 'time', ok: true, error: null, detail: null }]);
  assert.deepEqual(result.probeAliases, ['time']);
});

// 직접 등록은 승인하지 않은 채 끝난다 — 승인 전 서버는 뜨지 않으므로 연결
// 확인 대상에 넣으면 반드시 실패한다.
test('직접 등록은 연결 확인 대상에 들어가지 않는다', async () => {
  const { calls, registry } = spy();
  const snippet = '{"mcpServers":{"weather":{"command":"uvx","args":[]}}}';
  const result = await registry.apply(envelope([{ action: 'stage_snippet', target: null, snippet }]));
  assert.deepEqual(calls.map(([name]) => name), ['stageSnippet']);
  assert.equal(result.results[0].ok, true);
  assert.deepEqual(result.probeAliases, []);
});

test('스니펫 수정은 기존 서버에만 적용하고 승인된 서버만 다시 확인한다', async () => {
  const snippet = JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch@latest'] } } });
  for (const approved of [false, true]) {
    const { calls, registry } = spy(['fetch'], {
      list: () => ({ servers: [{ alias: 'fetch', approved }], revision: 7 }),
    });
    const proposal = envelope([{ action: 'update_snippet', target: 'fetch', snippet }]);
    assert.equal(registry.gate(proposal).ok, true);
    const result = await registry.decide(proposal, { revisionNow: 7 });
    assert.equal(result.kind, 'success');
    assert.deepEqual(calls.map(([name]) => name), approved ? ['updateSnippet', 'probe'] : ['updateSnippet']);
    assert.equal(result.results[0].target, 'fetch');
  }
});

test('스니펫 수정은 이름 변경, 다중 서버, 잘못된 설정과 낡은 제안을 실행하지 않는다', async () => {
  const cases = [
    'not json',
    JSON.stringify({ mcpServers: { another: { command: 'uvx' } } }),
    JSON.stringify({ mcpServers: { fetch: { command: 'uvx' }, another: { command: 'uvx' } } }),
    JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: 'wrong' } } }),
    JSON.stringify({ mcpServers: { fetch: { command: 'uvx', env: { TOKEN: 123 } } } }),
    JSON.stringify({ mcpServers: { fetch: { command: 'uvx', url: 'https://example.test' } } }),
  ];
  for (const snippet of cases) {
    const { calls, registry } = spy();
    const result = await registry.decide(envelope([{ action: 'update_snippet', target: 'fetch', snippet }]));
    assert.equal(result.kind, 'failed');
    assert.equal(calls.some(([name]) => name === 'updateSnippet'), false);
  }
  const { calls, registry } = spy();
  const snippet = JSON.stringify({ mcpServers: { fetch: { command: 'uvx' } } });
  const result = await registry.decide(envelope([{ action: 'update_snippet', target: 'fetch', snippet }]), { revisionNow: 8 });
  assert.equal(result.kind, 'stale');
  assert.equal(calls.some(([name]) => name === 'updateSnippet'), false);
});

test('스니펫 수정 실패는 재시도할 수 있고 삭제나 승인 변경을 하지 않는다', async () => {
  const { calls, registry } = spy(['fetch'], {
    async updateSnippet() { calls.push(['updateSnippet']); return { ok: false, error: '저장 실패' }; },
  });
  const snippet = JSON.stringify({ mcpServers: { fetch: { command: 'uvx' } } });
  const proposal = envelope([{ action: 'update_snippet', target: 'fetch', snippet }]);
  for (let i = 0; i < 2; i += 1) {
    const result = await registry.decide(proposal, { revisionNow: 7 });
    assert.equal(result.kind, 'failed');
    assert.equal(result.results[0].error, '스니펫을 수정하지 못했습니다');
  }
  assert.deepEqual(calls.filter(([name]) => name !== 'list'), [['updateSnippet'], ['updateSnippet']]);
});

test('묶음은 배열 순서대로 돌고 첫 실패에서 멈춘다', async () => {
  const { calls, registry } = spy(['fetch'], {
    async allowTool(alias, tool) { calls.push(['allowTool', alias, tool]); return { ok: false, error: '허용하지 못했습니다' }; },
  });
  const result = await registry.apply(envelope([
    { action: 'install', target: 'time' },
    { action: 'allow_tools', target: 'time', features: ['x', 'y'] },
    { action: 'remove', target: 'fetch' },
  ]));
  assert.deepEqual(calls.map(([name]) => name), ['stageSnippet', 'register', 'approve', 'allowTool']);
  assert.deepEqual(result.results.map((r) => [r.action, r.ok]), [['install', true], ['allow_tools', false]]);
  // 사람이 보는 문구는 이 모듈이 정하고, CLI 원문은 detail로만 옮긴다.
  assert.equal(result.results[1].error, '기능을 바꾸지 못했습니다');
  assert.equal(result.results[1].detail, '허용하지 못했습니다');
  assert.equal(result.ok, true);
});

test('설치 서브사슬은 승인 실패를 보상한다', async () => {
  const { calls, registry } = spy(['fetch'], {
    async approve(alias) { calls.push(['approve', alias]); return { ok: false, error: '승인하지 못했습니다' }; },
  });
  const result = await registry.apply(envelope([{ action: 'install', target: 'time' }]));
  assert.deepEqual(calls.map(([name]) => name), ['stageSnippet', 'register', 'approve', 'remove']);
  assert.equal(result.results[0].ok, false);
  assert.deepEqual(result.probeAliases, []);
});

test('켜기·끄기·기능 철회가 각각의 실행으로 간다', async () => {
  const { calls, registry } = spy();
  await registry.apply(envelope([
    { action: 'set_enabled', target: 'fetch', enabled: false },
    { action: 'set_enabled', target: 'fetch', enabled: true },
    { action: 'revoke_tools', target: 'fetch', features: ['fetch'] },
  ]));
  assert.deepEqual(calls, [['revoke', 'fetch'], ['approve', 'fetch'], ['allowTool', 'fetch', 'fetch', false]]);
});

test('probe는 apply 밖에서 돈다', async () => {
  const { calls, registry } = spy();
  const applied = await registry.apply(envelope([{ action: 'install', target: 'time' }]));
  assert.equal(calls.some(([name]) => name === 'probe'), false);
  const reports = await registry.probe(applied.probeAliases);
  assert.deepEqual(reports, [{ alias: 'time', ok: true, toolCount: 2, error: null, detail: null }]);
});

test('연결 확인 실패도 사람이 읽는 문구로 돌려준다', async () => {
  const { registry } = spy(['fetch'], {
    async probe() { return { ok: false, error: 'probe에 실패했다' }; },
  });
  assert.deepEqual(await registry.probe(['time']), [
    { alias: 'time', ok: false, toolCount: 0, error: '연결을 확인하지 못했습니다', detail: 'probe에 실패했다' },
  ]);
});

// --- 별칭 게이트 4종 --------------------------------------------------------

test('차단 별칭 봉투는 executor를 한 번도 부르지 않는다', () => {
  for (const target of ['kiwoom', 'kiwoom-selector', 'brain', 'KIWOOM-MCP', 'athena']) {
    const { calls, registry } = spy([target]);
    const gated = registry.gate(envelope([{ action: 'remove', target }]));
    assert.equal(gated.ok, false, target);
    assert.equal(gated.error, '아테나 기본 기능이라 여기서 다룰 수 없습니다');
    assert.equal(calls.length, 0, target);
  }
});

test('설치는 추천 목록 안에서만, 나머지는 이미 설치된 것만 통과한다', () => {
  const { registry } = spy(['fetch']);
  assert.equal(registry.gate(envelope([{ action: 'install', target: 'time' }])).ok, true);
  assert.equal(registry.gate(envelope([{ action: 'install', target: 'weather' }])).error, '추천 목록에 없어 설치할 수 없습니다');
  assert.equal(registry.gate(envelope([{ action: 'set_enabled', target: 'fetch', enabled: true }])).ok, true);
  assert.equal(registry.gate(envelope([{ action: 'set_enabled', target: 'time', enabled: true }])).error, '설치돼 있지 않습니다');
  assert.equal(registry.gate(envelope([{ action: 'install', target: 'fetch' }])).error, '이미 설치돼 있습니다');
});

test('추천 설치도 기존 별칭의 대소문자만 바꿔 중복 등록할 수 없다', () => {
  const { registry } = spy(['TIME']);
  const gated = registry.gate(envelope([{ action: 'install', target: 'time' }]));
  assert.equal(gated.ok, false);
  assert.equal(gated.error, '이미 설치돼 있습니다');
});

test('스니펫은 파싱한 뒤 별칭을 검사한다', () => {
  const { registry } = spy();
  const snippetOf = (raw) => envelope([{ action: 'stage_snippet', target: null, snippet: raw }]);
  assert.equal(registry.gate(snippetOf('{"mcpServers":{"weather":{"command":"uvx","args":[]}}}')).ok, true);
  assert.equal(registry.gate(snippetOf('{"mcpServers":{"kiwoom-x":{}}}')).error, '아테나 기본 기능이라 여기서 다룰 수 없습니다');
  assert.equal(registry.gate(snippetOf('{ 이건 JSON이 아니다')).error, '설정을 읽을 수 없습니다 — 형식을 확인해 주세요');
  assert.equal(registry.gate(snippetOf('{"mcpServers":{}}')).error, '설정에 등록할 내용이 없습니다');
  assert.equal(registry.gate(snippetOf('{"mcpServers":{"a":{},"b":{}}}')).error, '한 번에 하나만 등록합니다');
  assert.equal(registry.gate(snippetOf('   ')).error, '설정 내용이 비어 있습니다');
  assert.equal(
    registry.gate(envelope([{ action: 'stage_snippet', target: 'weather', snippet: '{"mcpServers":{"weather":{}}}' }])).error,
    '직접 등록에는 대상을 보내지 않습니다',
  );
});

test('스니펫 별칭은 정규화한 결과가 기존 등록과 겹치면 실행 전에 막는다', () => {
  const { calls, registry } = spy(['dart-mcp', 'opendart-mcp']);
  const duplicate = registry.gate(envelope([{ action: 'stage_snippet', target: null,
    snippet: '{"mcpServers":{"DART MCP":{"command":"uvx","args":[]}}}' }]));
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /dart-mcp.*이미 등록된 플러그인/);
  assert.match(duplicate.error, /기존 연결 설정과 권한을 확인/);

  const fallback = registry.gate(envelope([{ action: 'stage_snippet', target: null,
    snippet: '{"mcpServers":{"공시":{"command":"npx","args":["-y","opendart-mcp"]}}}' }]));
  assert.equal(fallback.ok, false);
  assert.match(fallback.error, /opendart-mcp.*이미 등록된 플러그인/);
  assert.equal(calls.every(([name]) => name === 'list'), true);
});

test('한 봉투에서 같은 별칭으로 정규화되는 직접 등록은 하나도 실행하지 않는다', async () => {
  const { calls, registry } = spy([]);
  const proposal = envelope([
    { action: 'stage_snippet', target: null, snippet: '{"mcpServers":{"dart mcp":{"command":"uvx","args":[]}}}' },
    { action: 'stage_snippet', target: null, snippet: '{"mcpServers":{"dart@mcp":{"command":"uvx","args":[]}}}' },
  ]);
  const result = await registry.decide(proposal, { revisionNow: 7 });
  assert.equal(result.kind, 'failed');
  assert.match(result.reason, /같은 요청에 중복/);
  assert.equal(calls.some(([name]) => name === 'stageSnippet'), false);
});

test('추천 설치와 직접 등록이 같은 별칭을 추가하는 혼합 봉투도 실행 전에 막는다', async () => {
  for (const actions of [
    [
      { action: 'install', target: 'time' },
      { action: 'stage_snippet', target: null, snippet: '{"mcpServers":{"time":{"command":"uvx","args":[]}}}' },
    ],
    [
      { action: 'stage_snippet', target: null, snippet: '{"mcpServers":{"time":{"command":"uvx","args":[]}}}' },
      { action: 'install', target: 'time' },
    ],
  ]) {
    const { calls, registry } = spy([]);
    const result = await registry.decide(envelope(actions), { revisionNow: 7 });
    assert.equal(result.kind, 'failed');
    assert.match(result.reason, /같은 요청에 중복/);
    assert.equal(calls.some(([name]) => name === 'stageSnippet'), false);
  }
});

test('기존 플러그인의 명시적 변경 액션은 계속 통과한다', () => {
  const { registry } = spy(['dart-mcp']);
  assert.equal(registry.gate(envelope([
    { action: 'set_enabled', target: 'dart-mcp', enabled: true },
  ])).ok, true);
});

test('빈 봉투와 enum 밖 액션은 게이트에서 막힌다', () => {
  const { calls, registry } = spy();
  assert.equal(registry.gate(envelope([])).error, '승인할 내용이 없습니다');
  assert.equal(registry.gate(envelope([{ action: 'call_tool', target: 'fetch' }])).error, '다룰 수 없는 요청입니다');
  assert.equal(calls.length, 0);
});

// --- 대기 목록 왕복 ---------------------------------------------------------

test('대기 목록은 등록 → 조회 → 승인으로 사라진다', () => {
  const { registry } = spy();
  const proposal = envelope([{ action: 'remove', target: 'fetch' }]);
  assert.deepEqual(registry.pending(), { proposals: [], revision: 7 });
  assert.equal(registry.note(proposal), true);
  assert.equal(registry.note(proposal), false);
  assert.deepEqual(registry.pending(), { proposals: [proposal], revision: 7 });
  registry.consume(proposal);
  assert.deepEqual(registry.pending(), { proposals: [], revision: 7 });
  assert.equal(registry.note(proposal), false);
});

// --- 승인 한 번의 순서(decide) ------------------------------------------------
// main.js도 verify-plugins.js도 이 함수 하나만 부른다 — 순서는 소스 스캔이 아니라
// 실제 호출 기록으로 잠근다.

test('decide: 게이트 → 소비 → 실행 → 연결 확인 순서로 부르고 실행을 조정자로 감싼다', async () => {
  const { calls, registry } = spy();
  const order = [];
  const proposal = envelope([{ action: 'set_enabled', target: 'fetch', enabled: true }]);
  const decided = await registry.decide(proposal, {
    revisionNow: 7,
    runMutation: async (run) => { order.push('mutation:before'); const out = await run(); order.push('mutation:after'); return out; },
  });
  assert.equal(decided.kind, 'success');
  assert.deepEqual(order, ['mutation:before', 'mutation:after']);
  const names = calls.map((row) => row[0]);
  // list는 게이트가 부른 것이다 — approve(실행)보다 앞이고, probe는 조정자 밖에서 마지막이다.
  assert.ok(names.indexOf('list') < names.indexOf('approve'), '게이트가 실행보다 뒤에 있다');
  assert.equal(names[names.length - 1], 'probe');
  assert.deepEqual(decided.probes, [{ alias: 'fetch', ok: true, toolCount: 2, error: null, detail: null }]);
  // 두 번째 승인은 소비에서 막힌다.
  assert.equal((await registry.decide(proposal, { revisionNow: 7 })).reason, '이미 처리한 요청입니다');
});

test('decide: 게이트에서 막히면 실행기를 한 번도 부르지 않고 소비도 하지 않는다', async () => {
  const { calls, registry } = spy();
  const proposal = envelope([{ action: 'remove', target: 'kiwoom' }]);
  const decided = await registry.decide(proposal, { revisionNow: 7 });
  assert.equal(decided.kind, 'failed');
  assert.equal(decided.reason, '아테나 기본 기능이라 여기서 다룰 수 없습니다');
  assert.deepEqual(decided.results, []);
  assert.deepEqual(calls, [], '차단 별칭은 목록 조회조차 하지 않는다');
  // 소비되지 않았으므로 같은 봉투가 다시 게이트까지 간다.
  assert.equal((await registry.decide(proposal, { revisionNow: 7 })).reason, '아테나 기본 기능이라 여기서 다룰 수 없습니다');
});

// 만료는 실행하지 않지만 소비는 되돌리지 않는다 — 다시 보내도 같은 자리에서 막힌다.
test('decide: 판번호가 어긋나면 실행 없이 만료이고 소비는 되돌리지 않는다', async () => {
  const { calls, registry } = spy();
  const proposal = envelope([{ action: 'remove', target: 'fetch' }]);
  const decided = await registry.decide(proposal, { revisionNow: 9 });
  assert.equal(decided.kind, 'stale');
  assert.equal(decided.reason, '목록이 바뀌어 다시 확인이 필요합니다');
  assert.ok(!calls.some((row) => row[0] === 'remove'), '만료인데 실행이 돌았다');
  assert.equal((await registry.decide(proposal, { revisionNow: 7 })).reason, '이미 처리한 요청입니다');
});

test('decide: 실행이 실패하면 소비를 되돌려 같은 봉투를 다시 보낼 수 있다', async () => {
  const { registry } = spy(['fetch'], { async remove() { return { ok: false, error: 'cli: boom' }; } });
  const proposal = envelope([{ action: 'remove', target: 'fetch' }]);
  const decided = await registry.decide(proposal, { revisionNow: 7 });
  assert.equal(decided.kind, 'failed');
  assert.equal(decided.reason, '삭제하지 못했습니다');
  assert.equal(decided.results[0].detail, 'cli: boom');
  assert.equal(decided.mutationError, null);
  assert.equal((await registry.decide(proposal, { revisionNow: 7 })).reason, '삭제하지 못했습니다');
});

// 판번호를 모르는 봉투(GUI 경로)는 만료 판정을 건너뛴다.
test('decide: revision이 null이면 만료로 몰지 않는다', async () => {
  const { registry } = spy();
  const proposal = { ...envelope([{ action: 'remove', target: 'fetch' }]), revision: null };
  assert.equal((await registry.decide(proposal, { revisionNow: 9 })).kind, 'success');
});

test('세션 정리 실패로 실행 전 중단되면 설정을 저장했다고 표시하지 않는다', async () => {
  const { calls, registry } = spy();
  const proposal = envelope([{ action: 'update_snippet', target: 'fetch', snippet: '{"mcpServers":{"fetch":{"command":"uvx"}}}' }]);
  const blocked = await registry.decide(proposal, {
    revisionNow: 7,
    runMutation: async () => ({ ok: false, persisted: false, error: 'legacy child termination failed' }),
  });
  assert.equal(blocked.kind, 'failed');
  assert.match(blocked.reason, /설정을 저장하지 않았습니다/);
  assert.ok(!calls.some(([name]) => name === 'updateSnippet'));
  assert.equal((await registry.decide(proposal, { revisionNow: 7 })).kind, 'success');
});
