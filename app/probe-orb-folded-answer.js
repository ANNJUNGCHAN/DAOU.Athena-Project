// 오브 "접힌 채 도착" 프로브(board-33⑥, 2026-08-27 갭 클로징 Step 7) —
// 질의해놓고 오브를 접으면(!expanded) 답이 도착했을 때 done/frown 같은
// 일시 표정 대신 기존 미확인 메커니즘(renderPresence — data-alert/#orbCount)
// 으로 배지가 뜨는지, 대화 모드로 다시 펼치는 순간 확인 처리되는지 확인한다.
// probe-orb-frown.js 관례(athena:orb-chat-submit을 모킹으로 갈아끼운다)를
// 따르되, 접은 뒤에 응답이 도착하는 타이밍을 만들려고 핸들러에 지연을 둔다.

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-folded-answer-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-folded-answer] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function orbState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    const count = document.getElementById('orbCount');
    return { face: root.dataset.face, alert: root.dataset.alert, state: root.dataset.state, count: count.textContent };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  // 실제 orb-chat-submit(runLiveQuery)을 프로브 전용 모킹으로 갈아끼운다 —
  // 800ms 지연 뒤 성공 응답을 준다. 이 지연 동안 오브를 접어서 "질의해놓고
  // 접었을 때"를 재현한다. require를 먼저 해야 한다 — main.js가 등록한 진짜
  // 핸들러가 있어야 removeHandler가 의미 있다(probe-orb-frown.js 관례).
  ipcMain.removeHandler('athena:orb-chat-submit');
  ipcMain.handle('athena:orb-chat-submit', async () => {
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, answerText: '테스트 답변입니다' };
  });

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
  const s0 = await orbState(orbWin);
  record('00-대화 모드로 펼침', s0.state === 'expanded', s0);

  // ---------- (1) 질의 제출 직후 — 응답이 오기 전에 접는다 ----------
  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = '테스트 질의';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  await wait(150); // 핸들러 800ms 지연보다 훨씬 먼저 접는다
  await orbWin.webContents.executeJavaScript("document.getElementById('orbClose').click()");
  await wait(100);
  const s1 = await orbState(orbWin);
  record('01-응답 전 접음 → collapsed, 아직 배지 없음', s1.state === 'collapsed' && s1.alert === 'none', s1);

  // ---------- (2) 접힌 채로 응답 도착 → 기존 미확인 메커니즘(배지)이 뜬다 ----------
  await wait(900); // 800ms 지연 + 여유
  const s2 = await orbState(orbWin);
  record('02-접힌 채 응답 도착 → data-alert=fired, count=1, face=fired(일시 표정 아님)',
    s2.alert === 'fired' && s2.count === '1' && s2.face === 'fired', s2);

  // ---------- (3) 다시 대화 모드로 펼치면 그 순간 확인 처리된다 ----------
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(300);
  const s3 = await orbState(orbWin);
  record('03-재펼침(대화 모드) → 배지 소거(alert=none, count 빔)',
    s3.state === 'expanded' && s3.alert === 'none' && s3.count === '', s3);

  // 턴 내용이 실제로 남아 있는지(같은 문법 — 새 경로 0개 확인)
  const turns = await orbWin.webContents.executeJavaScript(`(() => {
    const answers = document.querySelectorAll('.orb-turn-a');
    return { count: answers.length, lastText: answers.length ? answers[answers.length - 1].textContent : null };
  })()`);
  record('03b-접힌 동안의 턴이 그대로 남아 있다(새 경로 0개)', turns.lastText === '테스트 답변입니다', turns);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-folded-answer-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-folded-answer] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-folded-answer] 치명적 실패:', err);
  app.exit(1);
});
