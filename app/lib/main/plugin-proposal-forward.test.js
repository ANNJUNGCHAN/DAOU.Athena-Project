'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const forward = require('./plugin-proposal-forward');

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'backend', 'tests', 'fixtures', 'plugin-proposal');

function fixtures() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, data: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) }));
}

test('백엔드 픽스처 6종의 호출 입력을 모두 제안으로 판정한다', () => {
  const all = fixtures();
  assert.equal(all.length, 6);
  for (const { name, data } of all) {
    const step = { name: 'athena_plugin', input: data.tool_input };
    assert.equal(forward.isPluginProposalCall(step), true, name);
    assert.deepEqual(forward.extractProposal(step, JSON.stringify(data.envelope)), data.envelope, name);
  }
});

test('mcp__ 접두가 붙은 이름도 마지막 조각으로 판정한다', () => {
  const { data } = fixtures()[0];
  assert.equal(forward.isPluginProposalCall({ name: 'mcp__athena__athena_plugin', input: data.tool_input }), true);
});

test('다른 툴과 enum 밖 액션은 무시한다', () => {
  const { data } = fixtures()[0];
  assert.equal(forward.isPluginProposalCall({ name: 'athena_backtest', input: data.tool_input }), false);
  assert.equal(forward.isPluginProposalCall({ name: 'athena_plugin', input: { action: 'propose' } }), false);
  assert.equal(forward.isPluginProposalCall({ name: 'athena_plugin', input: { actions: [] } }), false);
  assert.equal(forward.isPluginProposalCall({ name: 'athena_plugin', input: { actions: [{ action: 'call_tool' }] } }), false);
  assert.equal(forward.isPluginProposalCall({ name: 'athena_plugin' }), false);
});

test('봉투 모양이 어긋난 결과는 버린다', () => {
  const { data } = fixtures()[0];
  const step = { name: 'athena_plugin', input: data.tool_input };
  assert.equal(forward.extractProposal(step, '설명 문장'), null);
  assert.equal(forward.extractProposal(step, JSON.stringify({ actions: data.envelope.actions })), null);
  assert.equal(forward.extractProposal(step, JSON.stringify({ proposal_id: 'x', actions: [] })), null);
  assert.equal(forward.extractProposal(step, JSON.stringify({ proposal_id: 'x', actions: [{ action: 'call_tool' }] })), null);
});
