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
const { captureRoot } = require('./lib/probe-captures');

const REGISTRY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-verify-plugins-'));
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(REGISTRY_DIR, 'mcp_servers.json');

// mcp-cli.js는 모듈 로드 시점이 아니라 호출 시점에 환경변수를 읽는다(registryPath()).
// 그래도 순서를 지켜 require한다 — 나중에 캐시가 생겨도 안전하도록.
const mcpCli = require('./lib/main/mcp-cli');
const { CATALOG } = require('./lib/plugin-catalog');

const REPORT_PATH = path.join(captureRoot(__dirname), 'VERIFY-PLUGINS-REPORT.json');
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

// ---------- 5동작 사슬 (계획 W5-1) ----------
// 위 verifyEntry가 재는 것은 mcp-cli 왕복이다. 아래는 그 위에 얹힌 **승인 경로**를
// 잰다: 봉투를 만들고 → 게이트를 지나 → 1회용으로 소비하고 → 주입한 실행기 8종이
// 레지스트리를 실제로 바꾼다. plugin-proposal-registry.js가 executor를 주입받기
// 때문에 UI도 main.js도 없이 이 사슬 전체를 잴 수 있다.
const { createPluginProposalRegistry } = require('./lib/main/plugin-proposal-registry');
const { buildProposal } = require('./lib/plugin-proposal');

const CONSENT_PATH = path.join(REGISTRY_DIR, 'consent.json');

// 파일 바이트 지문. 없는 파일은 null — "없다"와 "비었다"를 구분한다.
function fileFingerprint(target) {
  try {
    return fs.readFileSync(target).toString('hex');
  } catch {
    return null;
  }
}

function stateFingerprint() {
  return {
    registry: fileFingerprint(process.env.ATHENA_MCP_REGISTRY_PATH),
    consent: fileFingerprint(CONSENT_PATH),
  };
}

// 실행기 호출을 세는 껍데기. 차단 별칭 봉투가 CLI를 한 번도 부르지 않는다는
// 단언(5)과 재사용 봉투가 두 번 부르지 않는다는 단언(3)이 이 계수기를 읽는다.
function countingExecutor(base, overrides) {
  const calls = [];
  const wrapped = { __calls: calls };
  for (const name of Object.keys(base)) {
    if (typeof base[name] !== 'function') continue;
    const impl = (overrides && overrides[name]) || base[name];
    wrapped[name] = (...args) => {
      calls.push(name);
      return impl(...args);
    };
  }
  return wrapped;
}

// 순서는 레지스트리의 decide가 소유한다 — main.js handlePluginApprove가 부르는
// 것과 같은 함수다. 여기서 순서를 다시 적으면 앱과 다른 것을 재게 된다.
function approveEnvelope(registry, envelope, revisionNow) {
  return registry.decide(envelope, { revisionNow });
}

// 거부는 어떤 CLI도 부르지 않는다 — 소비 표시뿐이다(main.js handlePluginReject).
function rejectEnvelope(registry, envelope) {
  const claimed = registry.consume(envelope);
  if (!claimed.ok) return { kind: 'failed', reason: claimed.error };
  return { kind: 'rejected', reason: null };
}

// 판번호 조회는 계수기를 지나지 않는다 — 앱에서도 승인 핸들러가 직접 읽는다.
function currentRevision() {
  return mcpCli.list().revision;
}

async function verifyProposalChain(entry) {
  console.log(`\n[사슬] ${entry.name} — 제안 → 승인 카드 → 승인 → 설치됨`);

  // (5) 차단 별칭 봉투는 실행기를 한 번도 부르지 않는다 — 게이트가 모듈 안에 있다.
  const blockedExec = countingExecutor(mcpCli);
  const blockedRegistry = createPluginProposalRegistry({ executor: blockedExec, catalog: CATALOG });
  const blockedEnvelope = buildProposal({ action: 'remove', target: 'kiwoom' }, '내장 기능을 지운다', currentRevision(), 'model');
  const blockedOut = await approveEnvelope(blockedRegistry, blockedEnvelope, currentRevision());
  assertOk('사슬5: 차단 별칭 봉투는 승인되지 않는다',
    blockedOut.kind === 'failed' && blockedOut.reason === '아테나 기본 기능이라 여기서 다룰 수 없습니다',
    { kind: blockedOut.kind, reason: blockedOut.reason });
  assertOk('사슬5: 차단 별칭 봉투는 실행기를 한 번도 부르지 않는다',
    blockedExec.__calls.length === 0, blockedExec.__calls);

  // (2) 거부하면 레지스트리·consent 두 파일이 바이트 단위로 불변이다.
  const rejectExec = countingExecutor(mcpCli);
  const rejectRegistry = createPluginProposalRegistry({ executor: rejectExec, catalog: CATALOG });
  const toReject = buildProposal({ action: 'install', target: entry.id }, '설치를 제안한다', currentRevision(), 'model');
  const beforeReject = stateFingerprint();
  const rejected = rejectEnvelope(rejectRegistry, toReject);
  const afterReject = stateFingerprint();
  assertOk('사슬2: 거부는 rejected로 끝난다', rejected.kind === 'rejected', rejected);
  assertOk('사슬2: 거부해도 mcp_servers.json이 바이트 단위로 불변',
    beforeReject.registry === afterReject.registry);
  assertOk('사슬2: 거부해도 consent.json이 바이트 단위로 불변',
    beforeReject.consent === afterReject.consent);
  assertOk('사슬2: 거부는 실행기를 한 번도 부르지 않는다',
    rejectExec.__calls.length === 0, rejectExec.__calls);
  assertOk('사슬2: 거부한 봉투는 설치 목록에 남지 않는다',
    serverIn(mcpCli.list(), entry.id) === null);

  // (4) install 서브사슬 보상 — 승인 단계가 실패하면 미승인 행이 남지 않는다.
  const failingExec = countingExecutor(mcpCli, {
    approve: async () => ({ ok: false, error: 'verify: approve를 일부러 실패시킨다' }),
  });
  const failingRegistry = createPluginProposalRegistry({ executor: failingExec, catalog: CATALOG });
  const failingEnvelope = buildProposal({ action: 'install', target: entry.id }, '승인 단계가 실패하는 설치', currentRevision(), 'model');
  const failedInstall = await approveEnvelope(failingRegistry, failingEnvelope, currentRevision());
  assertOk('사슬4: 승인 단계가 실패하면 설치가 실패로 끝난다',
    failedInstall.kind === 'failed' && failedInstall.reason === '설치하지 못했습니다',
    { kind: failedInstall.kind, reason: failedInstall.reason });
  assertOk('사슬4: 설치 실패 뒤 레지스트리에 미승인 행이 남지 않는다',
    serverIn(mcpCli.list(), entry.id) === null, mcpCli.list().servers.map((s) => s.alias));
  assertOk('사슬4: 보상으로 remove가 불렸다',
    failingExec.__calls.includes('remove'), failingExec.__calls);

  // 여기부터가 사람이 보는 5동작이다. 하나의 실행기·레지스트리로 이어 붙인다 —
  // 앱에서도 레지스트리는 프로세스 하나에 하나뿐이라 소비 기록이 이어진다.
  const exec = countingExecutor(mcpCli);
  const registry = createPluginProposalRegistry({ executor: exec, catalog: CATALOG });

  // 동작 1 — 설치 제안 → 승인 카드 → 승인 → 설치됨
  const installEnvelope = buildProposal({ action: 'install', target: entry.id }, `${entry.name}를 설치할까요`, currentRevision(), 'model');
  const installed = await approveEnvelope(registry, installEnvelope, currentRevision());
  if (!assertOk(`사슬1-1: 설치 승인이 성공한다 (${entry.id})`, installed.kind === 'success',
    { reason: installed.reason, results: installed.results })) return;
  const afterInstall = serverIn(mcpCli.list(), entry.id);
  assertOk('사슬1-1: 승인 뒤 설치됨 목록에 승인 상태로 나타난다',
    afterInstall !== null && afterInstall.approved === true,
    afterInstall && { alias: afterInstall.alias, approved: afterInstall.approved });
  assertOk('사슬1-1: 승인 결과가 기능 개수를 함께 돌려준다',
    installed.probes.length === 1 && installed.probes[0].ok === true && installed.probes[0].toolCount > 0,
    installed.probes);

  // 동작 2 — 기능 허용 / 회수
  const probedTools = await mcpCli.probe(entry.id, {});
  if (!assertOk('사슬1-2: 허용 대상 기능을 확인한다', probedTools.ok && probedTools.tools.length > 0, probedTools.error)) return;
  const featureName = probedTools.tools[0].name;
  const allowEnvelope = buildProposal(
    { action: 'allow_tools', target: entry.id, features: [featureName] },
    '이 기능만 허용할까요', currentRevision(), 'model');
  const allowed = await approveEnvelope(registry, allowEnvelope, currentRevision());
  assertOk(`사슬1-2: 기능 허용 승인이 성공한다 (${featureName})`, allowed.kind === 'success', allowed.reason);
  let listed = serverIn(mcpCli.list(), entry.id);
  assertOk('사슬1-2: 허용 수가 1로 반영된다', listed && listed.toolCount === 1, listed && listed.toolCount);

  const revokeEnvelope = buildProposal(
    { action: 'revoke_tools', target: entry.id, features: [featureName] },
    '이 기능을 회수할까요', currentRevision(), 'model');
  const revokedTools = await approveEnvelope(registry, revokeEnvelope, currentRevision());
  assertOk('사슬1-2: 기능 회수 승인이 성공한다', revokedTools.kind === 'success', revokedTools.reason);
  listed = serverIn(mcpCli.list(), entry.id);
  assertOk('사슬1-2: 허용 수가 0으로 되돌아온다', listed && listed.toolCount === 0, listed && listed.toolCount);

  // 동작 3 — 끄기 / 켜기 (관리 화면 토글)
  const offEnvelope = buildProposal({ action: 'set_enabled', target: entry.id, enabled: false }, '끌까요', currentRevision(), 'gui');
  const turnedOff = await approveEnvelope(registry, offEnvelope, currentRevision());
  assertOk('사슬1-3: 끄기 승인이 성공한다', turnedOff.kind === 'success', turnedOff.reason);
  listed = serverIn(mcpCli.list(), entry.id);
  assertOk('사슬1-3: 끄면 미승인이 된다', listed && listed.approved === false, listed && listed.approved);
  assertOk('사슬1-3: 끄기는 연결 확인을 돌리지 않는다', turnedOff.probes.length === 0, turnedOff.probes);

  const onEnvelope = buildProposal({ action: 'set_enabled', target: entry.id, enabled: true }, '켤까요', currentRevision(), 'gui');
  const turnedOn = await approveEnvelope(registry, onEnvelope, currentRevision());
  assertOk('사슬1-3: 켜기 승인이 성공한다', turnedOn.kind === 'success', turnedOn.reason);
  listed = serverIn(mcpCli.list(), entry.id);
  assertOk('사슬1-3: 켜면 다시 승인 상태가 된다', listed && listed.approved === true, listed && listed.approved);

  // (3) 같은 proposal_id 재사용은 거부되고 CLI가 두 번 불리지 않는다. 여기서 재는
  // 것은 1회용 소비다 — install 봉투로 재생하면 "이미 설치돼 있습니다" 게이트가
  // 먼저 걸려 소비 기록이 아니라 게이트를 재게 된다. 게이트를 통과하는 봉투로 잰다.
  const callsBeforeReplay = exec.__calls.length;
  const replayed = await approveEnvelope(registry, onEnvelope, currentRevision());
  assertOk('사슬3: 같은 봉투를 다시 승인하면 거부된다',
    replayed.kind === 'failed' && replayed.reason === '이미 처리한 요청입니다',
    { kind: replayed.kind, reason: replayed.reason });
  assertOk('사슬3: 재사용 봉투는 실행기의 변경 함수를 두 번 부르지 않는다',
    exec.__calls.slice(callsBeforeReplay).every((name) => name === 'list'),
    exec.__calls.slice(callsBeforeReplay));

  // 동작 4 — 직접 등록(스니펫). 등록만 하고 승인하지 않는다.
  const directAlias = 'verify-direct-register';
  const directSnippet = JSON.stringify({
    mcpServers: { [directAlias]: { command: entry.command, args: [...entry.args] } },
  });
  const snippetEnvelope = buildProposal(
    { action: 'stage_snippet', target: null, snippet: directSnippet },
    '이 설정을 등록할까요', currentRevision(), 'gui');
  const staged = await approveEnvelope(registry, snippetEnvelope, currentRevision());
  assertOk('사슬1-4: 직접 등록 승인이 성공한다', staged.kind === 'success', staged.reason);
  const directRow = serverIn(mcpCli.list(), directAlias);
  assertOk('사슬1-4: 직접 등록한 별칭이 목록에 나타난다', directRow !== null, directRow && directRow.alias);
  assertOk('사슬1-4: 직접 등록은 승인하지 않는다 — 등록만으로는 실행되지 않는다',
    directRow && directRow.approved === false, directRow && directRow.approved);
  assertOk('사슬1-4: 직접 등록은 연결 확인을 돌리지 않는다', staged.probes.length === 0, staged.probes);

  // 동작 5 — 삭제
  for (const alias of [directAlias, entry.id]) {
    const removeEnvelope = buildProposal({ action: 'remove', target: alias }, '지울까요', currentRevision(), 'gui');
    const removedByProposal = await approveEnvelope(registry, removeEnvelope, currentRevision());
    assertOk(`사슬1-5: 삭제 승인이 성공한다 (${alias})`, removedByProposal.kind === 'success', removedByProposal.reason);
    assertOk(`사슬1-5: 삭제 뒤 목록에서 사라진다 (${alias})`, serverIn(mcpCli.list(), alias) === null);
  }

  // 설치돼 있지 않은 별칭에 대한 봉투는 게이트에서 막힌다(사슬이 끝난 뒤 확인).
  const ghostEnvelope = buildProposal({ action: 'set_enabled', target: entry.id, enabled: true }, '없는 것을 켠다', currentRevision(), 'model');
  const ghostOut = await approveEnvelope(registry, ghostEnvelope, currentRevision());
  assertOk('사슬: 설치돼 있지 않은 별칭 봉투는 게이트에서 막힌다',
    ghostOut.kind === 'failed' && ghostOut.reason === '설치돼 있지 않습니다',
    { kind: ghostOut.kind, reason: ghostOut.reason });

  // 대기 목록(창 복원용)은 소비된 봉투를 되살리지 않는다.
  const pendingEnvelope = buildProposal({ action: 'install', target: entry.id }, '복원 확인', currentRevision(), 'model');
  registry.note(pendingEnvelope);
  const held = registry.pending();
  assertOk('사슬: 대기 목록이 미해결 봉투를 그대로 돌려준다',
    held.proposals.length === 1 && held.proposals[0].proposal_id === pendingEnvelope.proposal_id,
    held.proposals.map((row) => row.proposal_id));
  registry.consume(pendingEnvelope);
  assertOk('사슬: 소비한 봉투는 대기 목록에서 사라진다', registry.pending().proposals.length === 0);
  assertOk('사슬: 소비한 봉투는 대기 목록에 다시 등록되지 않는다', registry.note(pendingEnvelope) === false);
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

  // 5동작 사슬은 카탈로그 왕복이 끝난 뒤 한 항목으로만 돈다 — 재는 것이 mcp-cli가
  // 아니라 그 위의 승인 경로라서, 다섯 항목을 다시 내려받을 이유가 없다.
  const chainEntry = CATALOG.find((e) => e.id === 'fetch') || CATALOG[0];
  try {
    await verifyProposalChain(chainEntry);
  } catch (err) {
    assertOk('사슬: 예외 없이 완료', false, String((err && err.message) || err));
  }
  assertOk('사슬이 끝난 뒤 레지스트리는 다시 비어 있다', mcpCli.list().servers.length === 0,
    mcpCli.list().servers.map((s) => s.alias));

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
