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
  const stubs = {
    'athena:account-list': async () => ({ accounts }),
    'athena:account-register': async () => ({ ok: true, id: 'a3' }),
    'athena:account-set-active': async (e, arg) => { for (const a of accounts) a.active = (a.id === arg.id); return { ok: true }; },
    'athena:order-api-set': async (e, arg) => ({ ok: true, checklist: [ { key: 'orderApi', label: '주문 API 허용 (토글)', met: !!arg.enabled }, { key: 'token', label: '로컬 인증 토큰 설정', met: true } ] }),
  };
  for (const [channel, handler] of Object.entries(stubs)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
  return Object.keys(stubs);
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
// clickByText는 버튼 자신의 textContent 전체를 비교하는데, 계좌 항목은
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

  // 설정에는 플러그인 표면이 없다(2026-09-03 — 플러그인 모드 관리 뷰가 가져갔다).
  // nav 항목도 카드도 남아 있으면 안 된다.
  const pluginSurface = await shellWin.webContents.executeJavaScript(`
    (() => ({
      navLabels: Array.from(document.querySelectorAll('#settingsNav .settings-nav-label')).map((n) => n.textContent.trim()),
      cardCount: document.querySelectorAll('#settingsGrid .card.mcp').length,
    }))();
  `);
  console.log('[verify-settings] 설정 플러그인 표면:', JSON.stringify(pluginSurface));
  if (pluginSurface.navLabels.includes('플러그인') || pluginSurface.cardCount !== 0) {
    failures.push('설정에 플러그인 표면이 남아 있다');
  }

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
