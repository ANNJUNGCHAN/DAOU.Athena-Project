// 검증 스크립트 — 설정 모드의 계좌·MCP 카드(lib/settings-cards.js) 전용.
// `npm run verify:settings-cards`.
//
// 렌더러 쪽 IPC 호출부를 그대로 둔 채(athena:account-register 등 호출부 코드는
// 수정하지 않음) `ipcRenderer.invoke` 응답만 렌더러 컨텍스트 안에서 임시로 스텁해,
// 목록·등록 시트·주문 API 게이트·probe 시트가 스펙대로 그려지는지 스크린샷으로
// 남긴다. 스텁 데이터는 이 스크립트에만 존재하고 앱 코드(lib/settings-cards.js)에는
// 목업이 전혀 없다.
//
// 대상 창은 **대화 창**이다. 설정은 새 창도 캔버스도 아니라 대화 창의 모드다
// (ui/DESIGN-SOUL.md:100, GLOSSARY.md §1). 2026-08-16 이전에는 캔버스 창을
// 겨냥했다 — 그때는 카드가 캔버스에 그려졌다.
//
// `npm run verify`(verify.js 검증 7·8)는 "창이 늘지 않는가 / 모드가 뜨고 닫히는가"
// 라는 계약을 본다. 이 스크립트는 그 안쪽의 **카드 상태들**을 본다. 역할이 다르다.
process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, name), img.toPNG());
}

const STUB_JS = `
(() => {
  const { ipcRenderer } = require('electron');
  if (ipcRenderer.__origInvoke) return 'already-stubbed';
  ipcRenderer.__origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
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
  ipcRenderer.invoke = async (channel, arg) => {
    if (channel === 'athena:account-list') return { accounts };
    if (channel === 'athena:account-register') return { ok: true, id: 'a3' };
    if (channel === 'athena:account-set-active') { for (const a of accounts) a.active = (a.id === arg.id); return { ok: true }; }
    if (channel === 'athena:order-api-set') return { ok: true, checklist: [ { key:'orderApi', label:'주문 API 허용 (토글)', met: !!arg.enabled }, { key:'token', label:'로컬 인증 토큰 설정', met: true } ] };
    if (channel === 'athena:mcp-list') return { servers };
    if (channel === 'athena:mcp-stage-snippet') return { ok: true, staged: [
      { alias: 'drfirst-korea-stock-mcp', originalName: '@drfirst/korea-stock-mcp', command: 'npx', args: ['-y', '@drfirst/korea-stock-mcp'], envKeys: ['NAVER_CLIENT_ID', 'NODE_OPTIONS'], risks: ['위험한 환경변수 키 사용 (NODE_OPTIONS) — 값은 표시하지 않지만 인터프리터가 암묵적으로 로드하는 코드 경로일 수 있다'] },
    ] };
    if (channel === 'athena:mcp-register') return { ok: true, alias: arg.staged.alias };
    if (channel === 'athena:mcp-approve') return { ok: true };
    if (channel === 'athena:mcp-probe') return { ok: true, protocolVersion: '2025-11-25', encodingCorrupt: false, tools: probeTools };
    if (channel === 'athena:mcp-allow-tool') { const t = probeTools.find((x) => x.name === arg.tool); if (t) t.allowed = arg.allowed; return { ok: true }; }
    if (channel === 'athena__render_canvas') return ipcRenderer.__origInvoke(channel, arg);
    return ipcRenderer.__origInvoke(channel, arg);
  };
  return 'stubbed';
})();
`;

// MCP 카드만 다시 그린다 — buildCardShell이 기존 .card.mcp를 제거하고 새로 붙인다.
async function rerenderMcpCard(win) {
  await win.webContents.executeJavaScript(
    "require('./lib/settings-cards').renderMcp(document.getElementById('settingsGrid'))"
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

app.whenReady().then(async () => {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { chatWin } = mainMod.getWins();
  await wait(600);

  // ---------- 렌더러 컨텍스트 안에서 ipcRenderer.invoke만 임시 스텁 ----------
  // 카드가 그려지기 *전에* 심어야 한다 — 설정 모드를 여는 순간 카드가 목록을 부른다.
  const stubResult = await chatWin.webContents.executeJavaScript(STUB_JS);
  console.log('[verify-settings] stub install:', stubResult);

  // ---------- 설정 모드를 연다 — 새 창이 아니라 이 창이 변한다 ----------
  // 점 클릭이 계좌·MCP 카드를 한 번에 그린다(chat.js openSettings).
  await chatWin.webContents.executeJavaScript("document.getElementById('dot').click()");
  await wait(500);
  await shot(chatWin, 'SETTINGS-03-accounts-list.png');

  console.log('[verify-settings] open register sheet:', await chatWin.webContents.executeJavaScript(clickByText('.card.accounts button', '+ 계좌 등록')));
  await wait(200);
  await shot(chatWin, 'SETTINGS-04-accounts-register-sheet.png');
  console.log('[verify-settings] close register sheet:', await chatWin.webContents.executeJavaScript(clickByText('.card.accounts .uk-sheet button', '취소')));
  await wait(200);

  console.log('[verify-settings] open order-api sheet:', await chatWin.webContents.executeJavaScript(clickByText('.card.accounts .uk-pill', 'OFF')));
  await wait(200);
  await shot(chatWin, 'SETTINGS-05-orderapi-sheet.png');
  console.log('[verify-settings] click activate:', await chatWin.webContents.executeJavaScript(clickByText('.card.accounts .uk-sheet button', '활성화')));
  await wait(300);
  await shot(chatWin, 'SETTINGS-06-orderapi-after-activate.png');

  await rerenderMcpCard(chatWin);
  await shot(chatWin, 'SETTINGS-07-mcp-list.png');

  console.log('[verify-settings] open mcp register sheet:', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp button', '+ 서버 등록')));
  await wait(200);
  await shot(chatWin, 'SETTINGS-08-mcp-register-sheet-empty.png');

  await chatWin.webContents.executeJavaScript(`
    (() => {
      const ta = document.querySelector('.card.mcp .uk-sheet textarea');
      ta.value = '{\\n  "mcpServers": {\\n    "@drfirst/korea-stock-mcp": { "command": "npx", "args": ["-y", "@drfirst/korea-stock-mcp"] }\\n  }\\n}';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })();
  `);
  console.log('[verify-settings] analyze snippet:', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-sheet button', '분석')));
  await wait(300);
  await shot(chatWin, 'SETTINGS-09-mcp-register-sheet-staged.png');
  console.log('[verify-settings] approve staged server:', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-sheet button', '승인')));
  await wait(300);
  await shot(chatWin, 'SETTINGS-10-mcp-register-sheet-after-approve.png');

  await rerenderMcpCard(chatWin);
  console.log('[verify-settings] open probe sheet (pykrx row):', await chatWin.webContents.executeJavaScript(`
    (() => {
      const rows = Array.from(document.querySelectorAll('.card.mcp .uk-row.is-clickable'));
      const r = rows.find((row) => row.textContent.includes('pykrx'));
      if (!r) return 'NOT FOUND: pykrx row';
      r.click();
      return 'clicked';
    })();
  `));
  await wait(300);
  await shot(chatWin, 'SETTINGS-11-mcp-probe-sheet.png');

  console.log('[verify-settings] toggle a checkbox:', await chatWin.webContents.executeJavaScript(`
    (() => {
      const cbs = Array.from(document.querySelectorAll('.card.mcp .uk-sheet .uk-check:not(.is-disabled)'));
      const target = cbs.find((c) => !c.classList.contains('is-checked'));
      if (!target) return 'NOT FOUND: unchecked checkbox';
      target.click();
      return 'clicked';
    })();
  `));
  await wait(150);
  await shot(chatWin, 'SETTINGS-12-mcp-probe-sheet-toggled.png');

  // 닫기 경고(D8, 2026-08-17 실사용 사고 재발 방지) — 체크박스를 건드린 뒤
  // "선택 허용"을 누르지 않은 채 닫으려 하면, 바로 닫지 말고 인라인으로
  // 경고해야 한다. 커밋 전에 이 갈래부터 확인한다.
  console.log('[verify-settings] close probe sheet with unsaved change (expect warning bar):', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-sheet-close', '닫기')));
  await wait(150);
  await shot(chatWin, 'SETTINGS-12b-mcp-probe-sheet-close-warning-dirty.png');
  console.log('[verify-settings] warning bar present (dirty):', await chatWin.webContents.executeJavaScript(
    "!!document.querySelector('.card.mcp .uk-close-warn')"
  ));
  console.log('[verify-settings] dismiss warning (계속 편집):', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-close-warn button', '계속 편집')));
  await wait(150);
  console.log('[verify-settings] sheet still open after 계속 편집:', await chatWin.webContents.executeJavaScript(
    "!!document.querySelector('.card.mcp .uk-sheet')"
  ));

  console.log('[verify-settings] commit 선택 허용:', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-sheet button', '선택 허용')));
  await wait(400);
  await shot(chatWin, 'SETTINGS-13-mcp-probe-sheet-committed.png');

  // 실제 사고 재현(2026-08-17 dart-mcp) — 커밋 후 남아있는 이 시트에서 허용된
  // 툴을 전부 해제한 채 닫으면 "허용된 툴 0개" 경고가 떠야 한다.
  console.log('[verify-settings] uncheck all allowed tools:', await chatWin.webContents.executeJavaScript(`
    (() => {
      const cbs = Array.from(document.querySelectorAll('.card.mcp .uk-sheet .uk-check.is-checked'));
      cbs.forEach((c) => c.click());
      return cbs.length + ' unchecked';
    })();
  `));
  await wait(150);
  console.log('[verify-settings] close probe sheet with 0 allowed (expect warning):', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-sheet-close', '닫기')));
  await wait(150);
  await shot(chatWin, 'SETTINGS-14-mcp-probe-sheet-close-warning-zero.png');
  console.log('[verify-settings] warning bar text (zero-allowed):', await chatWin.webContents.executeJavaScript(
    "(document.querySelector('.card.mcp .uk-close-warn .uk-warnbox-body') || {}).textContent || 'NOT FOUND'"
  ));
  console.log('[verify-settings] force close anyway (그냥 닫기):', await chatWin.webContents.executeJavaScript(clickByText('.card.mcp .uk-close-warn button', '그냥 닫기')));
  await wait(150);
  console.log('[verify-settings] sheet closed after force-close:', await chatWin.webContents.executeJavaScript(
    "!document.querySelector('.card.mcp .uk-sheet')"
  ));

  console.log('[verify-settings] all captures written to app/captures/SETTINGS-*.png');
  await wait(200);
  app.quit();
});
