// 오브 대화 실패 찡그림 프로브(board-30⑩, 2026-08-27 갭 클로징 Step 4a) —
// athena:orb-chat-submit이 실패({ok:false})를 돌려줄 때 data-face="frown"이
// 서고, DONE_HOLD(2000ms) 뒤 앰비언트로 복귀하는지, 발화(fired) 중에는
// 찡그림이 끼어들지 못하는지 확인한다. probe-orb-chat.js 관례(셸 숨김 →
// 오브 대화 모드 → #orbInput 제출)를 그대로 쓰되, main.js가 등록한 진짜
// orb-chat-submit 핸들러(runLiveQuery, 실제 LLM/백엔드 호출)는 이 프로브
// 환경에 없으므로 항상 실패를 돌려주는 모킹으로 갈아끼운다.

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = path.join(__dirname, '.probe-orb-frown-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-frown] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face, alert: root.dataset.alert };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  // 실제 orb-chat-submit(runLiveQuery, 백엔드/LLM 호출)을 프로브 전용 실패
  // 모킹으로 갈아끼운다 — 찡그림 표정은 오브 렌더러 쪽 로직이라 백엔드 없이도
  // 검증할 수 있어야 한다.
  ipcMain.removeHandler('athena:orb-chat-submit');
  ipcMain.handle('athena:orb-chat-submit', async () => ({ ok: false, error: 'probe-mock-failure' }));

  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  await wait(1500);

  // 셸 숨김 → 오브 대화 모드 전이(probe-orb-chat.js 관례)
  await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  await wait(500);
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(400);

  // ---------- (1) 실패 질의 제출 → frown ----------
  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = '테스트 질의';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

  // 답변 턴(실패 텍스트)이 나타날 때까지 폴링
  let turnResult = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    turnResult = await orbWin.webContents.executeJavaScript(`(() => {
      const answers = document.querySelectorAll('.orb-turn-a');
      return { count: answers.length, lastText: answers.length ? answers[answers.length - 1].textContent : null };
    })()`);
    if (turnResult.lastText) break;
    await wait(150);
  }
  record('01-실패 질의 제출→답변 턴 렌더', !!(turnResult && turnResult.lastText), turnResult);

  const s1 = await faceState(orbWin);
  record('02-실패 응답 후 data-face=frown', s1.face === 'frown', s1);

  // ---------- (2) DONE_HOLD 경과 후 앰비언트 복귀(자기참조 교착 없음) ----------
  await wait(2300);
  const s2 = await faceState(orbWin);
  record('03-DONE_HOLD 경과 후 frown에서 벗어남', s2.face !== 'frown', s2);

  // ---------- (3) 발화(fired) 중에는 찡그림이 끼어들지 못한다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'TEST', observed: 1, threshold: 1, mode: 'poll', note: 'probe',
  });
  await wait(200);
  const s3 = await faceState(orbWin);
  record('04-발화 이벤트 → data-face=fired', s3.face === 'fired' && s3.alert === 'fired', s3);

  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = '테스트 질의 2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  await wait(1000);
  const s4 = await faceState(orbWin);
  record('05-발화 중 실패 응답은 frown으로 못 덮는다(여전히 fired)', s4.face === 'fired', s4);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-frown-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-frown] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-frown] 치명적 실패:', err);
  app.exit(1);
});
