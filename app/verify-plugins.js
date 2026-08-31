// 플러그인 런타임 전수 검증 — `npm run verify:plugins` (= node verify-plugins.js).
//
// verify.js의 플러그인 블록은 **렌더 계약**만 잰다(호스트가 넘긴 목록을 화면이
// 어떻게 그리는가). 이 스크립트는 그 반대편, **실제 왕복**을 잰다: 카탈로그
// 항목을 실제로 등록하고, 승인하고, upstream 서버를 띄워 도구 목록을 받아오고,
// 도구를 허용했다 풀고, 승인을 철회했다 되살리고, 지운다.
//
// 앱이 쓰는 바로 그 모듈(lib/main/mcp-cli.js)을 부른다 — IPC 핸들러는 이 함수들을
// 그대로 감싸기만 하므로(main.js handleMcp*), 여기서 통과하면 앱 경로도 통과한다.
//
// 레지스트리는 매 실행 새 임시 디렉토리다. 이 머신의 진짜 ~/.athena를 절대
// 건드리지 않는다 — 검증이 사용자의 설치 목록을 지우면 안 된다.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-verify-plugins-'));
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(REGISTRY_DIR, 'mcp_servers.json');

// mcp-cli.js는 모듈 로드 시점이 아니라 호출 시점에 환경변수를 읽는다(registryPath()).
// 그래도 순서를 지켜 require한다 — 나중에 캐시가 생겨도 안전하도록.
const mcpCli = require('./lib/main/mcp-cli');
const { CATALOG } = require('./lib/plugin-catalog');

const REPORT_PATH = path.join(__dirname, 'captures', 'VERIFY-PLUGINS-REPORT.json');
const results = [];
let failures = 0;

function assertOk(label, condition, detail) {
  const ok = !!condition;
  if (!ok) failures += 1;
  results.push({ label, ok, detail: detail == null ? undefined : detail });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail == null ? '' : ` — ${JSON.stringify(detail)}`}`);
  return ok;
}

function snippetFor(entry) {
  return JSON.stringify({
    mcpServers: { [entry.id]: { command: entry.command, args: [...entry.args] } },
  });
}

function serverIn(list, alias) {
  return (list.servers || []).find((s) => s.alias === alias) || null;
}

async function verifyEntry(entry) {
  console.log(`\n[${entry.id}] ${entry.name} — ${entry.command} ${entry.args.join(' ')}`);

  // 1. 등록 (앱의 "설치" 승인이 부르는 그 경로: 스니펫 → stage)
  const staged = await mcpCli.stageSnippet(snippetFor(entry));
  if (!assertOk(`${entry.id}: 스니펫 등록`, staged.ok && staged.staged && staged.staged.length === 1, staged.error)) return;
  const stagedServer = staged.staged[0];
  assertOk(`${entry.id}: 별칭이 카탈로그 id 그대로다`, stagedServer.alias === entry.id, stagedServer.alias);
  assertOk(`${entry.id}: 실행 명령이 카탈로그와 같다`,
    stagedServer.command === entry.command && stagedServer.args.join(' ') === entry.args.join(' '),
    `${stagedServer.command} ${stagedServer.args.join(' ')}`);
  assertOk(`${entry.id}: 비밀값을 요구하지 않는다`, stagedServer.envKeys.length === 0, stagedServer.envKeys);

  // 2. 승인 전에는 미승인 상태여야 한다 (consent 게이트가 spawn을 막는 자리)
  const beforeApprove = serverIn(mcpCli.list(), entry.id);
  assertOk(`${entry.id}: 승인 전에는 미승인`, beforeApprove && beforeApprove.approved === false);

  // 3. 등록 재확인 + 승인
  const registered = mcpCli.register(stagedServer);
  assertOk(`${entry.id}: 등록 재확인`, registered.ok, registered.error);
  const approved = await mcpCli.approve(entry.id);
  if (!assertOk(`${entry.id}: 승인`, approved.ok, approved.error)) return;

  // 4. probe — 실제로 upstream 서버를 띄워 도구 목록을 받는다
  const probed = await mcpCli.probe(entry.id, {});
  if (!assertOk(`${entry.id}: probe 연결`, probed.ok, probed.error)) return;
  const toolNames = probed.tools.map((t) => t.name).sort();
  assertOk(`${entry.id}: 노출 도구가 카탈로그 표기와 일치`,
    JSON.stringify(toolNames) === JSON.stringify([...entry.toolNames].sort()),
    { probed: toolNames, catalog: [...entry.toolNames].sort() });
  assertOk(`${entry.id}: 인코딩 손상 없음`, probed.encodingCorrupt === false);
  assertOk(`${entry.id}: 승인 직후 허용 도구는 0개`,
    probed.tools.every((t) => t.allowed === false));

  // 5. 도구 허용 → 해제 (기능 허용 화면의 저장이 부르는 경로)
  const first = probed.tools[0].name;
  const allowed = await mcpCli.allowTool(entry.id, first, true);
  assertOk(`${entry.id}: 도구 허용 (${first})`, allowed.ok, allowed.error);
  let listed = serverIn(mcpCli.list(), entry.id);
  assertOk(`${entry.id}: 허용 수가 1로 반영`, listed && listed.toolCount === 1, listed && listed.toolCount);
  assertOk(`${entry.id}: probe 뒤 health가 ok`, listed && listed.health === 'ok', listed && listed.health);

  const disallowed = await mcpCli.allowTool(entry.id, first, false);
  assertOk(`${entry.id}: 도구 허용 해제`, disallowed.ok, disallowed.error);
  listed = serverIn(mcpCli.list(), entry.id);
  assertOk(`${entry.id}: 허용 수가 0으로 되돌아옴`, listed && listed.toolCount === 0, listed && listed.toolCount);

  // 6. 관리 화면의 끄기 = revoke, 켜기 = approve
  await mcpCli.allowTool(entry.id, first, true);
  const revoked = await mcpCli.revoke(entry.id);
  assertOk(`${entry.id}: 승인 철회`, revoked.ok, revoked.error);
  listed = serverIn(mcpCli.list(), entry.id);
  assertOk(`${entry.id}: 철회하면 미승인 + 허용 목록이 비워진다`,
    listed && listed.approved === false && listed.toolCount === 0,
    listed && { approved: listed.approved, toolCount: listed.toolCount });

  const reapproved = await mcpCli.approve(entry.id);
  assertOk(`${entry.id}: 다시 켜기`, reapproved.ok, reapproved.error);
  listed = serverIn(mcpCli.list(), entry.id);
  assertOk(`${entry.id}: 다시 켜면 승인 상태로 돌아온다`, listed && listed.approved === true);

  // 7. 삭제
  const removed = await mcpCli.remove(entry.id);
  assertOk(`${entry.id}: 삭제`, removed.ok);
  assertOk(`${entry.id}: 삭제 뒤 목록에서 사라진다`, serverIn(mcpCli.list(), entry.id) === null);
}

async function main() {
  console.log(`[verify:plugins] 레지스트리: ${process.env.ATHENA_MCP_REGISTRY_PATH}`);
  console.log(`[verify:plugins] 카탈로그 ${CATALOG.length}종을 전수 왕복한다`);

  assertOk('시작 상태의 레지스트리는 비어 있다', mcpCli.list().servers.length === 0);

  for (const entry of CATALOG) {
    // 한 항목이 실패해도 나머지를 계속 잰다 — 어떤 서버가 문제인지 한 번에 본다.
    try {
      await verifyEntry(entry);
    } catch (err) {
      assertOk(`${entry.id}: 예외 없이 완료`, false, String((err && err.message) || err));
    }
  }

  assertOk('끝난 뒤 레지스트리는 다시 비어 있다', mcpCli.list().servers.length === 0);

  // 없는 서버에 대한 연산은 조용히 성공하지 않는다.
  const ghostApprove = await mcpCli.approve('없는-서버');
  assertOk('없는 별칭 승인은 실패로 돌아온다', ghostApprove.ok === false, ghostApprove.error);
  const ghostProbe = await mcpCli.probe('없는-서버', {});
  assertOk('없는 별칭 probe는 실패로 돌아온다', ghostProbe.ok === false, ghostProbe.error);
  const badSnippet = await mcpCli.stageSnippet('{ "이건": "mcpServers가 없다" }');
  assertOk('형식이 틀린 스니펫은 이유와 함께 거절된다', badSnippet.ok === false, badSnippet.error);
  const emptySnippet = await mcpCli.stageSnippet('   ');
  assertOk('빈 스니펫은 등록을 시도하지 않는다', emptySnippet.ok === false, emptySnippet.error);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    registry: process.env.ATHENA_MCP_REGISTRY_PATH,
    catalog: CATALOG.map((e) => ({ id: e.id, command: e.command, args: e.args })),
    assertions: results,
    failures,
  }, null, 2), 'utf-8');

  console.log(`\n[verify:plugins] 단언 ${results.length}건 중 실패 ${failures}건`);
  console.log(`[verify:plugins] 리포트: ${REPORT_PATH}`);
  try {
    fs.rmSync(REGISTRY_DIR, { recursive: true, force: true });
  } catch { /* 임시 디렉토리 정리 실패는 검증 결과를 바꾸지 않는다 */ }
  process.exit(failures ? 1 : 0);
}

void main();
