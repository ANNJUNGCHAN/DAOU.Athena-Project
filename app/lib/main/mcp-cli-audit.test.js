// mcp-cli.auditLog() 단위 테스트 — 파이썬을 부르지 않는 유일한 읽기 경로다
// (backend/athena_mcp/consent.py AuditLog가 남긴 jsonl을 그대로 읽는다).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mcpCli = require('./mcp-cli');

function makeState(servers, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-audit-'));
  fs.writeFileSync(path.join(dir, 'mcp_servers.json'), JSON.stringify({ servers, revision: 1 }), 'utf-8');
  const auditDir = path.join(dir, 'audit');
  fs.mkdirSync(auditDir);
  for (const [name, lines] of Object.entries(files)) {
    fs.writeFileSync(path.join(auditDir, name), lines.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf-8');
  }
  process.env.ATHENA_MCP_REGISTRY_PATH = path.join(dir, 'mcp_servers.json');
  return dir;
}

const ORIGINAL_REGISTRY_PATH = process.env.ATHENA_MCP_REGISTRY_PATH;

test.afterEach(() => {
  if (ORIGINAL_REGISTRY_PATH === undefined) delete process.env.ATHENA_MCP_REGISTRY_PATH;
  else process.env.ATHENA_MCP_REGISTRY_PATH = ORIGINAL_REGISTRY_PATH;
});

test('감사 로그는 등록된 별칭만 최신순으로 모으고 네 칸만 돌려준다', async () => {
  makeState(
    { fetch: { alias: 'fetch' }, time: { alias: 'time' } },
    {
      'fetch.jsonl': [
        { ts: '2026-09-03T01:00:00+00:00', alias: 'fetch', tool: 'fetch_url', success: true },
        { ts: '2026-09-03T03:00:00+00:00', alias: 'fetch', tool: 'fetch_url', success: false },
      ],
      'time.jsonl': [{ ts: '2026-09-03T02:00:00+00:00', alias: 'time', tool: 'convert_time', success: true }],
      // 게이트웨이 내장 툴 로그 — 플러그인이 아니라서 빠진다.
      'brain.jsonl': [{ ts: '2026-09-03T04:00:00+00:00', alias: 'brain', tool: 'brain_search', success: true }],
    },
  );

  const { entries } = await mcpCli.auditLog();
  assert.deepEqual(entries.map((e) => [e.alias, e.tool, e.success]), [
    ['fetch', 'fetch_url', false],
    ['time', 'convert_time', true],
    ['fetch', 'fetch_url', true],
  ]);
  assert.deepEqual(Object.keys(entries[0]).sort(), ['alias', 'success', 'tool', 'ts']);
});

test('깨진 줄과 audit 디렉터리 부재는 빈 목록으로 물러선다', async () => {
  const dir = makeState({ fetch: { alias: 'fetch' } }, {
    'fetch.jsonl': [{ ts: '2026-09-03T01:00:00+00:00', alias: 'fetch', tool: 'fetch_url', success: true }],
  });
  fs.appendFileSync(path.join(dir, 'audit', 'fetch.jsonl'), '{깨진 줄\n', 'utf-8');
  assert.equal((await mcpCli.auditLog()).entries.length, 1);

  fs.rmSync(path.join(dir, 'audit'), { recursive: true, force: true });
  assert.deepEqual(await mcpCli.auditLog(), { entries: [] });
});

test('상한을 넘으면 최신 것만 남는다', async () => {
  const rows = [];
  for (let i = 0; i < 25; i += 1) {
    rows.push({ ts: `2026-09-03T00:${String(i).padStart(2, '0')}:00+00:00`, alias: 'fetch', tool: `tool_${i}`, success: true });
  }
  makeState({ fetch: { alias: 'fetch' } }, { 'fetch.jsonl': rows });

  const { entries } = await mcpCli.auditLog();
  assert.equal(entries.length, 20);
  assert.equal(entries[0].tool, 'tool_24');
});

test('큰 파일은 끝에서만 읽고 잘린 첫 줄은 버린다', async () => {
  const rows = [];
  // 64KB를 훌쩍 넘겨 앞부분이 읽기 창 밖으로 밀려나게 만든다.
  for (let i = 0; i < 900; i += 1) {
    rows.push({ ts: `2026-09-03T00:00:${String(i % 60).padStart(2, '0')}+00:00`, alias: 'fetch', tool: 'x'.repeat(120) + i, success: true });
  }
  rows.push({ ts: '2026-09-04T00:00:00+00:00', alias: 'fetch', tool: 'last_tool', success: true });
  makeState({ fetch: { alias: 'fetch' } }, { 'fetch.jsonl': rows });

  const { entries } = await mcpCli.auditLog();
  assert.equal(entries[0].tool, 'last_tool');
  // 창 밖 줄은 안 보이고, 경계에 걸린 반토막 줄도 조용히 버려진다(파싱 오류 없음).
  assert.ok(entries.length <= 20);
});

test('등록 목록이 깨져 있으면 빈 목록으로 위장하지 않고 실패한다', async () => {
  const dir = makeState({ fetch: { alias: 'fetch' } }, {
    'fetch.jsonl': [{ ts: '2026-09-03T01:00:00+00:00', alias: 'fetch', tool: 'fetch_url', success: true }],
  });
  fs.writeFileSync(path.join(dir, 'mcp_servers.json'), '{{{깨짐', 'utf-8');
  await assert.rejects(() => mcpCli.auditLog(), /등록 목록을 읽지 못했다/);
});
