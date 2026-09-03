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
  assert.deepEqual(required, []);
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
