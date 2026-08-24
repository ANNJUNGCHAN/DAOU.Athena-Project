// 검증 스크립트 — 설정·온보딩 IPC 핸들러(lib/main/*.js)의 실제 반환 모양을
// 확인한다. `npm run verify:settings` (= electron verify-settings.js).
//
// verify.js와 같은 패턴: main.js를 라이브러리로 불러오고, 자동 기동은 끈 채
// createWindows()를 직접 호출해 실제 창이 뜨는지도 함께 확인한다. 그 위에
// settingsHandlers(=main.js가 노출한, 실제 ipcMain.handle에 연결된 그 함수들)를
// 렌더러를 거치지 않고 직접 호출해 반환 값을 콘솔에 출력한다.
//
// 격리:
//   - userData를 임시 디렉터리로 바꿔 이 컴퓨터의 실제 CLI 계정 감지 파일
//     (~/.claude.json 등)은 "읽기"는 실제로 하되(그게 감지 로직이 맞는지
//     확인하는 유일한 방법이다), 이 스크립트가 만드는 계좌/온보딩/CLI 계정
//     상태 파일은 실제 사용자 데이터를 건드리지 않는다.
//   - ATHENA_MCP_REGISTRY_PATH를 임시 경로로 돌려 이 컴퓨터의 진짜
//     ~/.athena/mcp_servers.json을 건드리지 않는다.
//   - 계좌 등록 "성공" 경로는 실제 키움 모의투자 서버에 유효한 앱키가 없어
//     끝까지 재현할 수 없다 — https.request를 이 스크립트 안에서만 최소
//     스텁으로 바꿔 성공 응답을 시뮬레이션한다(accounts.js 자체는 손대지
//     않는다, 실제 코드는 항상 진짜 https 모듈을 쓴다). "실패(auth)" 경로는
//     스텁 없이 진짜 네트워크로 검증한다 — 요청 모양이 실제로 맞다는 증거는
//     이쪽에서 나온다.

process.env.ATHENA_NO_AUTOSTART = '1';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-verify-'));
const MCP_STATE_DIR = path.join(TMP_ROOT, 'mcp-state');
fs.mkdirSync(MCP_STATE_DIR, { recursive: true });
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(MCP_STATE_DIR, 'mcp_servers.json');

const { app, ipcMain } = require('electron');
app.setPath('userData', path.join(TMP_ROOT, 'userData'));

// ---- https 스텁 (계좌 등록 "성공" 경로 전용, appkey==='VERIFY_OK_KEY'일 때만) ----
const https = require('https');
const realRequest = https.request.bind(https);
https.request = function stubbedRequest(options, callback) {
  if (options && options.hostname === 'mockapi.kiwoom.com') {
    const req = new EventEmitter();
    let written = '';
    req.write = (chunk) => { written += chunk; return true; };
    req.end = () => {
      let body = {};
      try { body = JSON.parse(written); } catch { /* ignore */ }
      if (body.appkey !== 'VERIFY_OK_KEY') {
        return realRequestThrough(options, callback, written);
      }
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        callback(res);
        process.nextTick(() => {
          res.emit('data', Buffer.from(JSON.stringify({
            return_code: 0,
            token: 'verify-fake-token',
            expires_dt: '20991231235959',
          })));
          res.emit('end');
        });
      });
    };
    req.destroy = () => {};
    return req;
  }
  return realRequest(options, callback);
};
function realRequestThrough(options, callback, writtenBody) {
  const req = realRequest(options, callback);
  req.write(writtenBody);
  req.end();
  return req;
}

const main = require('./main.js');
const h = main.settingsHandlers;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

const report = {};
function log(section, value) {
  report[section] = value;
  console.log(`\n[${section}]`);
  console.log(JSON.stringify(value, null, 2));
}

async function run() {
  console.log(`[verify-settings] TMP_ROOT=${TMP_ROOT}`);
  await app.whenReady();
  await main.createWindows();
  const wins = main.getWins();
  console.log(`[verify-settings] windows created: chat=${!!wins.shellWin} canvas=${!!wins.shellWin}`);
  await wait(400);

  // ---------------- 온보딩 ----------------
  log('onboarding.state.initial', h.onboardingState());
  const layoutBefore = main.getLayout();
  // 실제 렌더러가 온보딩 확장 때 쓰는 것과 같은 경로(ipcMain.on 핸들러)로
  // 창을 최대 높이까지 넓힌다 — main.js의 내부 chatHeight 변수도 이 경로를
  // 통해야 같이 갱신된다(창 bounds를 직접 조작하면 내부 상태와 어긋난다).
  ipcMain.emit('athena:set-chat-height', {}, { height: layoutBefore.chatMaxH });
  await wait(50);
  log('onboarding.advance.step2', h.onboardingAdvance(null, { step: 2 }));
  log('onboarding.state.afterStep2', h.onboardingState());
  const heightBeforeStep3Done = main.getWins().shellWin.getBounds().height;
  const advanceStep3 = h.onboardingAdvance(null, { step: 3 });
  log('onboarding.advance.step3', advanceStep3);
  await wait(50);
  const heightAfterStep3Done = main.getWins().shellWin.getBounds().height;
  // README.md 검증3이 이미 문서화한 ±1~2px DPI 반올림 편차(acrylic 창의
  // setBounds() 요청값과 getBounds() 실측값 차이, 기능적 결함 아님)를 그대로
  // 허용 오차로 쓴다.
  log('onboarding.chatHeight.selfReturnedToBase', {
    heightBeforeStep3Done,
    heightAfterStep3Done,
    baseH: layoutBefore.chatBaseH,
    shrunkBackToBase: Math.abs(heightAfterStep3Done - layoutBefore.chatBaseH) <= 2,
  });

  // ---------------- CLI 계정 ----------------
  log('cli.list', h.cliList());
  log('cli.login.unknownProvider', await h.cliLogin(null, { providerId: 'nope' }));
  // gemini/grok은 LOGIN_COMMANDS에 없다(D6 — cli-accounts.js 주석 참고) — 설치
  // 여부와 무관하게 unknownProvider 경로("알 수 없는 CLI다")를 탄다. 라벨이
  // "(notInstalled)"였던 건 실제 코드 경로와 달랐다(정정, 2026-08-18).
  log('cli.login.gemini(unknownProvider)', await h.cliLogin(null, { providerId: 'gemini' }));
  log('cli.login.grok(unknownProvider)', await h.cliLogin(null, { providerId: 'grok' }));
  const cliAccounts = require('./lib/main/cli-accounts');
  log('cli.probeBinaryExists', {
    claude: await cliAccounts.probeBinaryExists('claude'),
    codex: await cliAccounts.probeBinaryExists('codex'),
    gemini: await cliAccounts.probeBinaryExists('gemini'),
    grok: await cliAccounts.probeBinaryExists('grok'),
  });
  console.log('[verify-settings] NOTE: claude/codex 실제 login() 스폰(대화형 콘솔 창 오픈, codex는 기존 세션 로그아웃 위험 실측됨)은');
  console.log('  이 자동 검증에서 의도적으로 실행하지 않았다 — probeBinaryExists()로 설치 감지만 확인했다.');

  // ---------------- 계좌 ----------------
  log('account.list.empty', h.accountList());
  log('account.register.invalid(emptyAlias)', await h.accountRegister(null, { alias: '', appKey: 'x', secretKey: 'y' }));
  log('account.register.auth(realNetworkCall)', await h.accountRegister(null, { alias: '검증-실패계좌', appKey: 'not-a-real-key', secretKey: 'not-a-real-secret' }));
  const okReg = await h.accountRegister(null, { alias: '검증-성공계좌', appKey: 'VERIFY_OK_KEY', secretKey: 'VERIFY_OK_SECRET_0123456789' });
  log('account.register.ok(stubbedNetwork)', okReg);
  log('account.list.afterRegister', h.accountList());

  if (okReg.ok) {
    log('order-api-set.enable.ok(tokenReady)', h.orderApiSet(null, { id: okReg.id, enabled: true }));
    log('account.list.afterOrderApiOn', h.accountList());
    log('order-api-set.disable', h.orderApiSet(null, { id: okReg.id, enabled: false }));
    log('auth-token-status', h.authTokenStatus(null, { id: okReg.id }));
    log('auth-token-refresh', await h.authTokenRefresh(null, { id: okReg.id }));
    // "연결 해제" 버튼(auth-screen.js) 결선 — au10002(접근토큰폐기) 계약을 같은
    // 스텁 네트워크로 확인한다. 폐기 후 상태는 항상 needed로 돌아가야 한다.
    log('auth-token-revoke.ok(stubbedNetwork)', await h.authTokenRevoke(null, { id: okReg.id }));
    log('auth-token-status.afterRevoke', h.authTokenStatus(null, { id: okReg.id }));
    // 두 번째 폐기 — 이미 로컬 토큰이 없는 상태(needed)에서는 upstream 호출 없이
    // 바로 ok:true를 돌려줘야 한다(revoke_token()의 "토큰 없으면 즉시 반환"과 동일).
    log('auth-token-revoke.alreadyNeeded(noUpstreamCall)', await h.authTokenRevoke(null, { id: okReg.id }));
    log('account.setActive.self', h.accountSetActive(null, { id: okReg.id }));
    log('account.remove', h.accountRemove(null, { id: okReg.id }));
    log('account.list.afterRemove', h.accountList());
  }

  // ---------------- MCP ----------------
  // mcpList()는 mcp-env.js의 마이그레이션(비동기)을 먼저 시도하고 나서 목록을
  // 돌려주므로 이제 async다 — await 없이 부르면 Promise 객체가 그대로
  // 로깅된다(SECURITY.md §6 배선 이후).
  log('mcp.list.empty', await h.mcpList());

  const pythonExe = '.venv/Scripts/python.exe';
  const fixture = 'tests/mcp/fixtures/fake_server.py';
  // env에 평문 시크릿을 심는다 — SECURITY.md §6 마이그레이션 실검증이 이 값의
  // 왕복(등록 시 평문 -> mcpList() 마이그레이션 -> 센티널 -> buildEnvOverrides()
  // 복호화 -> 실제 spawn 전달)을 추적한다.
  const PLAINTEXT_SECRET = 'plaintext-verify-value-0123456789';
  const snippet = JSON.stringify({
    mcpServers: {
      '검증용 테스트 서버': { command: pythonExe, args: [fixture], env: { MY_TEST_SECRET: PLAINTEXT_SECRET } },
    },
  });
  const staged = await h.mcpStageSnippet(null, { snippet });
  log('mcp.stageSnippet', staged);

  if (staged.ok && staged.staged.length) {
    const one = staged.staged[0];
    const reg = h.mcpRegister(null, { staged: one });
    log('mcp.register', reg);
    const approve = await h.mcpApprove(null, { alias: one.alias });
    log('mcp.approve', approve);
    const probe1 = await h.mcpProbe(null, { alias: one.alias });
    log('mcp.probe.beforeAllow', {
      ok: probe1.ok,
      protocolVersion: probe1.protocolVersion,
      encodingCorrupt: probe1.encodingCorrupt,
      toolCount: (probe1.tools || []).length,
      echoAllowed: (probe1.tools || []).find((t) => t.name === 'echo'),
    });
    const allowOn = await h.mcpAllowTool(null, { alias: one.alias, tool: 'echo', allowed: true });
    log('mcp.allowTool.on(realCli)', allowOn);
    const probe2 = await h.mcpProbe(null, { alias: one.alias });
    log('mcp.probe.afterAllowOn.echoAllowed', (probe2.tools || []).find((t) => t.name === 'echo'));
    const allowOff = await h.mcpAllowTool(null, { alias: one.alias, tool: 'echo', allowed: false });
    log('mcp.allowTool.off(consentJsonMutation)', allowOff);
    const probe3 = await h.mcpProbe(null, { alias: one.alias });
    log('mcp.probe.afterAllowOff.echoAllowed', (probe3.tools || []).find((t) => t.name === 'echo'));
    log('mcp.list.afterProbe', await h.mcpList());

    // ---- SECURITY.md §6 실검증 — MCP env 암호화 왕복 + fail-closed ----
    // 위 mcpList() 호출이 이미 이번 프로세스의 실제 safeStorage로 마이그레이션을
    // 한 번 거쳤다 — 그 결과를 여기서 확인한다.
    {
      const mcpEnv = require('./lib/main/mcp-env');
      const { PYTHON_EXE, BACKEND_DIR } = require('./lib/main/mcp-config');
      const { spawnSync } = require('child_process');

      const registryRaw = fs.readFileSync(mcpEnv.registryPath(), 'utf-8');
      const registryJson = JSON.parse(registryRaw);
      const redactedValue = registryJson.servers[one.alias].env.MY_TEST_SECRET;
      log('mcp-env.afterMigrate.isSentinel', redactedValue === mcpEnv.SENTINEL);
      log('mcp-env.afterMigrate.noPlaintextOnDisk', !registryRaw.includes(PLAINTEXT_SECRET));

      const overrides = mcpEnv.buildEnvOverrides(one.alias);
      const varName = mcpEnv.envVarName(one.alias, 'MY_TEST_SECRET');
      log('mcp-env.buildEnvOverrides.decryptRoundTripMatches', overrides[varName] === PLAINTEXT_SECRET);

      // 앱 경유 없이 이 서버를 직접 probe — 주입 환경변수가 없으므로 센티널을
      // 못 풀어 spawn이 명확히 실패해야 한다(fail-closed, registry.py의
      // MissingSecretEnvError).
      const directNoEnv = spawnSync(
        PYTHON_EXE, ['-m', 'athena_mcp', 'probe', one.alias, '--json'],
        { cwd: BACKEND_DIR, env: { ...process.env, PYTHONPATH: BACKEND_DIR }, encoding: 'utf-8' }
      );
      let directNoEnvReport = null;
      try {
        const idx = directNoEnv.stdout.indexOf('{');
        if (idx >= 0) directNoEnvReport = JSON.parse(directNoEnv.stdout.slice(idx));
      } catch { /* 파싱 실패해도 아래 exitCode/ok로 판단 가능 */ }
      log('mcp-env.directSpawn.withoutAppInjection', {
        exitCode: directNoEnv.status,
        ok: directNoEnvReport ? directNoEnvReport.ok : null,
        errorMentionsInjectionVar: !!(directNoEnvReport && directNoEnvReport.error && directNoEnvReport.error.includes(varName)),
      });

      // 앱 spawn 경로 시뮬레이션 — 복호화된 값을 환경변수로 주입하면 성공해야 한다.
      const directWithEnv = spawnSync(
        PYTHON_EXE, ['-m', 'athena_mcp', 'probe', one.alias, '--json'],
        { cwd: BACKEND_DIR, env: { ...process.env, PYTHONPATH: BACKEND_DIR, ...overrides }, encoding: 'utf-8' }
      );
      let directWithEnvReport = null;
      try {
        const idx = directWithEnv.stdout.indexOf('{');
        if (idx >= 0) directWithEnvReport = JSON.parse(directWithEnv.stdout.slice(idx));
      } catch { /* ignore */ }
      log('mcp-env.directSpawn.withAppSimulatedInjection', {
        exitCode: directWithEnv.status,
        ok: directWithEnvReport ? directWithEnvReport.ok : null,
        toolCount: directWithEnvReport ? (directWithEnvReport.tools || []).length : null,
      });
    }

    const removed = await h.mcpRemove(null, { alias: one.alias });
    log('mcp.remove', removed);
    log('mcp.list.afterRemove', await h.mcpList());
  }

  fs.writeFileSync(path.join(__dirname, 'captures', 'VERIFY-SETTINGS-REPORT.json'), JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n[verify-settings] 리포트 저장: app/captures/VERIFY-SETTINGS-REPORT.json');
  console.log(`[verify-settings] 임시 디렉터리(수동 정리 필요 없음, OS temp): ${TMP_ROOT}`);

  app.quit();
}

run().catch((err) => {
  console.error('[verify-settings] FAILED', err);
  app.quit();
  process.exitCode = 1;
});
