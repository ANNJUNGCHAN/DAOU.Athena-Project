process.env.ATHENA_NO_AUTOSTART = '1';

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, name), img.toPNG());
}

// 클릭 대상을 못 찾으면 'NOT FOUND: ...'를 돌려주는 executeJavaScript 결과들을
// 한곳에 모은다 — 예전에는 콘솔에 찍히기만 하고 exit code에는 반영되지 않아
// CI에서 조용히 초록으로 통과했다(실패가 로그에 묻힘).
const failures = [];
async function clickAndLog(win, label, script) {
  const result = await win.webContents.executeJavaScript(script);
  console.log(`[verify-settings] ${label}:`, result);
  if (typeof result === 'string' && result.startsWith('NOT FOUND')) {
    failures.push(`${label}: ${result}`);
  }
  return result;
}

// main 프로세스에서 ipcMain 핸들러를 스텁으로 갈아끼운다(2026-08-18 렌더러
// 격리 — 렌더러 쪽 window.athena는 contextBridge가 동결해 몽키패치 불가).
// main.js가 require 시점에 이미 등록해둔 원본 핸들러를 removeHandler로 걷어내고
// 같은 채널에 스텁을 건다. athena__render_canvas는 건드리지 않는다(이 스크립트가
// 부르지 않는다).
function installStubHandlers() {
  const accounts = [
    { id: 'a1', alias: '모의-주력', connected: true, active: true, orderApi: false, tokenState: 'ready', appKeyChars: 40, secretKeyChars: 64 },
    { id: 'a2', alias: '모의-테스트', connected: false, active: false, orderApi: false, tokenState: 'needed', appKeyChars: 40, secretKeyChars: 64 },
  ];
  const servers = [
    { alias: 'server-everything', command: 'npx', argsPreview: '-y @modelcontextprotocol/server-everything', approved: true, toolCount: 12, health: 'ok', warnings: [] },
    { alias: 'drfirst-korea-stock-mcp', command: 'npx', argsPreview: '-y @drfirst/korea-stock-mcp', approved: true, toolCount: 6, health: 'ok', warnings: ['인코딩 손상'] },
    { alias: 'pykrx', command: 'uvx', argsPreview: '--with mcp==1.28.* pykrx-mcp', approved: true, toolCount: 8, health: 'ok', warnings: [] },
    { alias: 'korean-dart-mcp', command: 'npx', argsPreview: '-y korean-dart-mcp', approved: false, toolCount: 0, health: 'unknown', warnings: [] },
    { alias: 'isnow890-naver-search-mcp', command: 'npx', argsPreview: '-y @isnow890/naver-search-mcp', approved: true, toolCount: 0, health: 'error', warnings: [] },
  ];
  const probeTools = [
    { name: 'get_stock_ohlcv', description: '일별 시세(OHLCV) 조회', allowed: true },
    { name: 'get_market_ticker_name', description: '종목 코드 → 종목명 조회', allowed: true },
    { name: 'get_market_ticker_list', description: '시장 전체 종목 코드 목록 조회', allowed: false },
    { name: 'get_market_fundamental_by_date', description: '일자별 PER·PBR·배당수익률 조회', allowed: false },
    { name: 'datalab_shopping_keyword_by_device_and_gender_breakdown', description: '네이버 데이터랩 쇼핑 키워드 성별·기기 세분화 조회', allowed: false },
  ];
  const stubs = {
    'athena:account-list': async () => ({ accounts }),
    'athena:account-register': async () => ({ ok: true, id: 'a3' }),
    'athena:account-set-active': async (e, arg) => { for (const a of accounts) a.active = (a.id === arg.id); return { ok: true }; },
    'athena:order-api-set': async (e, arg) => ({ ok: true, checklist: [ { key: 'orderApi', label: '주문 API 허용 (토글)', met: !!arg.enabled }, { key: 'token', label: '로컬 인증 토큰 설정', met: true } ] }),
    'athena:mcp-list': async () => ({ servers }),
    'athena:mcp-stage-snippet': async () => ({ ok: true, staged: [
      { alias: 'drfirst-korea-stock-mcp', originalName: '@drfirst/korea-stock-mcp', command: 'npx', args: ['-y', '@drfirst/korea-stock-mcp'], envKeys: ['NAVER_CLIENT_ID', 'NODE_OPTIONS'], risks: ['위험한 환경변수 키 사용 (NODE_OPTIONS) — 값은 표시하지 않지만 인터프리터가 암묵적으로 로드하는 코드 경로일 수 있다'] },
    ] }),
    'athena:mcp-register': async (e, arg) => ({ ok: true, alias: arg.staged.alias }),
    'athena:mcp-approve': async () => ({ ok: true }),
    'athena:mcp-probe': async () => ({ ok: true, protocolVersion: '2025-11-25', encodingCorrupt: false, tools: probeTools }),
    'athena:mcp-allow-tool': async (e, arg) => { const t = probeTools.find((x) => x.name === arg.tool); if (t) t.allowed = arg.allowed; return { ok: true }; },
  };
  for (const [channel, handler] of Object.entries(stubs)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
  return Object.keys(stubs);
}

// MCP 카드만 다시 그린다 — buildCardShell이 기존 .card.mcp를 제거하고 새로 붙인다.
// window.AthenaLib.SettingsCards는 shell.html이 <script> 태그로 미리 로드해둔
// 전역이다(require 없음, nodeIntegration:false).
async function rerenderMcpCard(win) {
  await win.webContents.executeJavaScript(
    "window.AthenaLib.SettingsCards.renderMcp(document.getElementById('settingsGrid'))"
  );
  await wait(300);
}

function clickByText(selector, text) {
  return `
  (() => {
    const els = Array.from(document.querySelectorAll('${selector}'));
    const el = els.find((e) => e.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return 'NOT FOUND: ${text}';
    el.click();
    return 'clicked';
  })();
  `;
}

// 사이드바 nav(2026-08-18, Paper 43쪽) — #settingsGrid에는 nav가 고른 카드
// 하나만 산다(renderNav의 onSelect가 grid.replaceChildren() 먼저 부른다).
// clickByText는 버튼 자신의 textContent 전체를 비교하는데, 계좌·MCP 서버 항목은
// 카운트 배지(예: "0개")가 같은 버튼 안에 붙어 있어 라벨 전체 일치가 깨질 수
// 있다 — 라벨 자식(.settings-nav-label)만 비교하는 전용 헬퍼를 쓴다.
function clickNavItem(label) {
  return `
  (() => {
    const nav = document.getElementById('settingsNav');
    const items = nav ? Array.from(nav.querySelectorAll('.settings-nav-item')) : [];
    const btn = items.find((b) => { const l = b.querySelector('.settings-nav-label'); return l && l.textContent.trim() === ${JSON.stringify(label)}; });
    if (!btn) return 'NOT FOUND: ${label}';
    btn.click();
    return 'clicked';
  })();
  `;
}

app.whenReady().then(async () => {
  const mainMod = require('./main.js');
  // ---------- main 프로세스의 ipcMain 핸들러를 스텁으로 갈아끼운다 ----------
  // 카드가 그려지기 *전에* 심어야 한다 — 설정 모드를 여는 순간 카드가 목록을
  // 부른다. createWindows() 전에 걸어도 무방하다(핸들러는 main.js require
  // 시점에 이미 등록됐고, 렌더러는 아직 아무것도 부르지 않았다).
  const stubbedChannels = installStubHandlers();
  console.log('[verify-settings] stub install:', stubbedChannels);

  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  await wait(600);

  // ---------- 설정 모드를 연다 — 새 창이 아니라 이 창이 변한다 ----------
  // 점은 더 이상 설정을 열지 않는다(보드 45 — 키우미 얼굴) — 진입은 커맨드바
  // ("설정" 입력, verify.js openSettingsViaCommandBar와 같은 경로)다. 기본
  // 선택은 '화면'이라 계좌 카드를 보려면 nav에서 '계좌'를 선택해야 한다
  // (chat.js openSettings/lib/settings-cards.js renderNav 참고).
  await shellWin.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('input');
    el.value = '설정';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })();`);
  await wait(500);
  await clickAndLog(shellWin, 'select nav 계좌', clickNavItem('계좌'));
  await wait(400);
  await shot(shellWin, 'SETTINGS-03-accounts-list.png');

  await clickAndLog(shellWin, 'open register sheet', clickByText('.card.accounts button', '+ 계좌 등록'));
  await wait(200);
  await shot(shellWin, 'SETTINGS-04-accounts-register-sheet.png');
  await clickAndLog(shellWin, 'close register sheet', clickByText('.card.accounts .uk-sheet button', '취소'));
  await wait(200);

  await clickAndLog(shellWin, 'open order-api sheet', clickByText('.card.accounts .uk-pill', 'OFF'));
  await wait(200);
  await shot(shellWin, 'SETTINGS-05-orderapi-sheet.png');
  await clickAndLog(shellWin, 'click activate', clickByText('.card.accounts .uk-sheet button', '활성화'));
  await wait(300);
  await shot(shellWin, 'SETTINGS-06-orderapi-after-activate.png');

  // MCP 카드로 전환 — nav '경유'다(직접 renderMcp() 호출이 아니다). 실제
  // 사용자 경로(renderNav onSelect)를 타야 grid.replaceChildren()이 먼저 불려
  // 계좌 카드가 정리된다 — 안 그러면 두 카드가 같은 grid에 함께 남는, 실제로는
  // 도달 불가능한 상태가 된다(사이드바는 한 번에 카드 하나만 보여준다).
  await clickAndLog(shellWin, 'select nav 플러그인', clickNavItem('플러그인'));
  await wait(1000); // mcp-list는 Python CLI 콜드 스폰이라 실측 ~850ms 걸린다(verify-settings.js 주석 참고)
  await shot(shellWin, 'SETTINGS-07-mcp-list.png');

  await clickAndLog(shellWin, 'open mcp register sheet', clickByText('.card.mcp button', '+ 서버 등록'));
  await wait(200);
  await shot(shellWin, 'SETTINGS-08-mcp-register-sheet-empty.png');

  await shellWin.webContents.executeJavaScript(`
    (() => {
      const ta = document.querySelector('.card.mcp .uk-sheet textarea');
      ta.value = '{\\n  "mcpServers": {\\n    "@drfirst/korea-stock-mcp": { "command": "npx", "args": ["-y", "@drfirst/korea-stock-mcp"] }\\n  }\\n}';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })();
  `);
  await clickAndLog(shellWin, 'analyze snippet', clickByText('.card.mcp .uk-sheet button', '분석'));
  await wait(300);
  await shot(shellWin, 'SETTINGS-09-mcp-register-sheet-staged.png');
  await clickAndLog(shellWin, 'approve staged server', clickByText('.card.mcp .uk-sheet button', '승인'));
  await wait(300);
  await shot(shellWin, 'SETTINGS-10-mcp-register-sheet-after-approve.png');

  await rerenderMcpCard(shellWin);
  await clickAndLog(shellWin, 'open probe sheet (pykrx row)', `
    (() => {
      const rows = Array.from(document.querySelectorAll('.card.mcp .uk-row.is-clickable'));
      const r = rows.find((row) => row.textContent.includes('pykrx'));
      if (!r) return 'NOT FOUND: pykrx row';
      r.click();
      return 'clicked';
    })();
  `);
  await wait(300);
  await shot(shellWin, 'SETTINGS-11-mcp-probe-sheet.png');

  await clickAndLog(shellWin, 'toggle a checkbox', `
    (() => {
      const cbs = Array.from(document.querySelectorAll('.card.mcp .uk-sheet .uk-check:not(.is-disabled)'));
      const target = cbs.find((c) => !c.classList.contains('is-checked'));
      if (!target) return 'NOT FOUND: unchecked checkbox';
      target.click();
      return 'clicked';
    })();
  `);
  await wait(150);
  await shot(shellWin, 'SETTINGS-12-mcp-probe-sheet-toggled.png');

  // 닫기 경고(D8, 2026-08-17 실사용 사고 재발 방지) — 체크박스를 건드린 뒤
  // "선택 허용"을 누르지 않은 채 닫으려 하면, 바로 닫지 말고 인라인으로
  // 경고해야 한다. 커밋 전에 이 갈래부터 확인한다.
  await clickAndLog(shellWin, 'close probe sheet with unsaved change (expect warning bar)', clickByText('.card.mcp .uk-sheet-close', '닫기'));
  await wait(150);
  await shot(shellWin, 'SETTINGS-12b-mcp-probe-sheet-close-warning-dirty.png');
  console.log('[verify-settings] warning bar present (dirty):', await shellWin.webContents.executeJavaScript(
    "!!document.querySelector('.card.mcp .uk-close-warn')"
  ));
  await clickAndLog(shellWin, 'dismiss warning (계속 편집)', clickByText('.card.mcp .uk-close-warn button', '계속 편집'));
  await wait(150);
  console.log('[verify-settings] sheet still open after 계속 편집:', await shellWin.webContents.executeJavaScript(
    "!!document.querySelector('.card.mcp .uk-sheet')"
  ));

  await clickAndLog(shellWin, 'commit 선택 허용', clickByText('.card.mcp .uk-sheet button', '선택 허용'));
  await wait(400);
  await shot(shellWin, 'SETTINGS-13-mcp-probe-sheet-committed.png');

  // 실제 사고 재현(2026-08-17 dart-mcp) — 커밋 후 남아있는 이 시트에서 허용된
  // 툴을 전부 해제한 채 닫으면 "허용된 툴 0개" 경고가 떠야 한다.
  console.log('[verify-settings] uncheck all allowed tools:', await shellWin.webContents.executeJavaScript(`
    (() => {
      const cbs = Array.from(document.querySelectorAll('.card.mcp .uk-sheet .uk-check.is-checked'));
      cbs.forEach((c) => c.click());
      return cbs.length + ' unchecked';
    })();
  `));
  await wait(150);
  await clickAndLog(shellWin, 'close probe sheet with 0 allowed (expect warning)', clickByText('.card.mcp .uk-sheet-close', '닫기'));
  await wait(150);
  await shot(shellWin, 'SETTINGS-14-mcp-probe-sheet-close-warning-zero.png');
  console.log('[verify-settings] warning bar text (zero-allowed):', await shellWin.webContents.executeJavaScript(
    "(document.querySelector('.card.mcp .uk-close-warn .uk-warnbox-body') || {}).textContent || 'NOT FOUND'"
  ));
  await clickAndLog(shellWin, 'force close anyway (그냥 닫기)', clickByText('.card.mcp .uk-close-warn button', '그냥 닫기'));
  await wait(150);
  console.log('[verify-settings] sheet closed after force-close:', await shellWin.webContents.executeJavaScript(
    "!document.querySelector('.card.mcp .uk-sheet')"
  ));

  console.log('[verify-settings] all captures written to app/captures/SETTINGS-*.png');
  await wait(200);

  if (failures.length) {
    console.error(`[verify-settings] 실패 ${failures.length}건 — 요소를 찾지 못했다:`);
    for (const f of failures) console.error(`  - ${f}`);
    app.exit(1);
    return;
  }
  app.quit();
});
