'use strict';

/**
 * 다중 대화 동시 진행 프로브(2026-09-08) — 실제 Electron main.js + 실제 셸 렌더러로
 * "한 대화가 답하는 동안 다른 대화에서 질문한다"의 앱 층 계약을 잰다. 모델·백엔드는
 * 띄우지 않는다: athena__render_canvas 핸들러를 프로브 전용 모킹으로 갈아끼워
 * (probe-orb-frown.js 관례) 왕복을 보류하고, 스트림 조각을 대화 id와 함께 흘린다.
 *
 * 재는 것: 답변 중 전환 허용 · 다른 대화의 입력 열림 · 조각이 자기 대화에만 붙음 ·
 * 돌아왔을 때 진행 중 말풍선·잠금이 그대로 · 완료된 배경 턴의 답이 돌아온 화면에 있음 ·
 * Esc가 보고 있는 대화만 끊음. (오브 병렬 진입은 main-live-admission.test.js)
 *
 * 실행: cd app && npx electron probe-multi-chat.js
 */

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const APP_DIR = __dirname;
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-multichat-probe-'));
  const userDataDir = path.join(root, 'user-data');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2), 'utf8');
writeProbeModelPrefs(userDataDir);
  const conversationsPath = path.join(userDataDir, 'athena-conversations.json');
  const stamp = (iso) => ({ createdAt: iso, updatedAt: iso, resumeSessionId: null });
  fs.writeFileSync(conversationsPath, JSON.stringify({
    version: 2, activeId: null, currentProjectId: 'default',
    projects: [{ id: 'default', label: '기본 프로젝트' }],
    conversations: [
      { id: 'conv-a', title: 'A 대화', projectId: 'default', mode: 'chat', ...stamp('2026-09-01T00:00:00.000Z') },
      { id: 'conv-b', title: 'B 대화', projectId: 'default', mode: 'chat', ...stamp('2026-09-02T00:00:00.000Z') },
    ],
  }, null, 2), 'utf8');
  const sessionsDbPath = path.join(root, 'athena-sessions.sqlite3');

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_CONVERSATIONS_PATH: conversationsPath,
    ATHENA_SESSIONS_DB_PATH: sessionsDbPath,
    ATHENA_BACKEND_URL: 'http://127.0.0.1:9',
    ATHENA_LOCAL_BEARER_TOKEN: 'probe',
    ATHENA_ROUTINES_ENABLED: 'false',
    ATHENA_CHAT_HISTORY_DB_PATH: path.join(root, 'chat-outbox.sqlite3'),
  });

  app.setPath('userData', userDataDir);
  await app.whenReady();
  const mainMod = require(path.join(APP_DIR, 'main.js'));
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
  mainMod.revealShell({ focus: false, force: true });
  const wc = shellWin.webContents;
  await wc.executeJavaScript(`(() => {
    for (const id of ['boot', 'onboard', 'settings', 'order']) { const el = document.getElementById(id); if (el) el.hidden = true; }
    const app = document.getElementById('app'); if (app) app.hidden = false; return true;
  })()`);

  // 모델 왕복을 프로브가 쥔다 — 대화 id별로 보류하고, 조각은 conversationId를 실어 셸로 보낸다.
  const turns = new Map(); // conversationId -> { resolve, payload }
  ipcMain.removeHandler('athena__render_canvas');
  ipcMain.handle('athena__render_canvas', (_e, payload = {}) => new Promise((resolve) => {
    turns.set(payload.conversationId || '(none)', { resolve, payload });
  }));
  const delta = (conversationId, text) => shellWin.webContents.send('athena:live-text-delta', { text, conversationId, turnId: `t-${conversationId}`, sequence: 1 });
  const finish = (conversationId, answerText) => {
    const turn = turns.get(conversationId);
    turn.resolve({ ok: true, source: 'live', answerText, canvasTypes: [], canvasCaptions: [] });
    turns.delete(conversationId);
  };

  const open = (id, title) => wc.executeJavaScript(`window.AthenaShell.openConversation({ id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)} })`);
  const submit = (text) => wc.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    if (input.disabled) return { submitted: false, reason: 'disabled' };
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return { submitted: true };
  })()`);
  const view = () => wc.executeJavaScript(`(() => {
    const history = document.getElementById('history');
    const input = document.getElementById('input');
    const turns = [...history.querySelectorAll('.turn-q, .turn-a')].map((el) => el.className.includes('turn-q') ? 'Q:' + el.textContent : 'A:' + el.textContent);
    const progress = Boolean(history.querySelector('.progress-line'));
    const lockText = document.getElementById('lockText');
    return { turns, progress, inputDisabled: input.disabled, lock: lockText && !document.getElementById('lockHint').hidden ? lockText.textContent : null };
  })()`);

  // 1) A에서 질문 — 왕복이 보류된다
  check('A 열기', await open('conv-a', 'A 대화') === true);
  const subA = await submit('A 질문입니다');
  await sleep(150);
  check('A 제출: 왕복이 conv-a로 들어가고 입력이 잠긴다', subA.submitted && turns.has('conv-a') && (await view()).inputDisabled === true,
    { subA, turn: [...turns.keys()] });
  delta('conv-a', 'A 답변 조각 1');
  await sleep(2700); // 텍스트 방출 사다리(최대 2.5s 유예) 뒤에 보인다
  const a1 = await view();
  check('A 스트림: 조각이 A 화면에 붙는다', a1.turns.some((t) => t.startsWith('A:') && t.includes('A 답변 조각 1')), a1.turns);

  // 2) 답변 중 B로 전환 — 허용되고, 입력이 열리고, A의 말풍선은 없다
  const switchedB = await open('conv-b', 'B 대화');
  await sleep(200);
  const b0 = await view();
  check('전환: 답변 중에도 B로 갈아탄다', switchedB === true, switchedB);
  check('B 화면: 입력이 열려 있고 A의 말풍선·진행 라인이 없다',
    b0.inputDisabled === false && !b0.progress && !b0.turns.some((t) => t.includes('A 답변') || t.includes('A 질문')), b0);

  // 3) A가 계속 스트리밍해도 B 화면에 새지 않는다
  delta('conv-a', ' 조각 2');
  await sleep(200);
  const b1 = await view();
  check('격리: A의 늦은 조각이 B 화면에 나타나지 않는다', !b1.turns.some((t) => t.includes('조각 2')), b1.turns);

  // 4) B에서 질문 — 두 대화가 동시에 돈다
  const subB = await submit('B 질문입니다');
  await sleep(150);
  check('B 제출: 두 왕복이 함께 살아 있다(conv-a, conv-b)', subB.submitted && turns.has('conv-a') && turns.has('conv-b'), { subB, turns: [...turns.keys()] });
  delta('conv-b', 'B 답변 조각');
  await sleep(2700);
  const b2 = await view();
  check('B 스트림: B 조각만 B 화면에 붙는다', b2.turns.some((t) => t.includes('B 답변 조각')) && !b2.turns.some((t) => t.includes('A 답변')), b2.turns);

  // 5) A가 배경에서 완료 — B 화면은 여전히 잠겨 있다(B는 진행 중)
  finish('conv-a', 'A 최종 답변');
  await sleep(300);
  const b3 = await view();
  check('배경 완료: A가 끝나도 B 화면은 B 턴으로 잠겨 있고 A 답이 섞이지 않는다',
    b3.inputDisabled === true && !b3.turns.some((t) => t.includes('A 최종 답변')), b3);

  // 6) A로 돌아오면 완료된 답과 열린 입력이 있다
  check('A로 복귀', await open('conv-a', 'A 대화') === true);
  await sleep(200);
  const a2 = await view();
  check('A 복귀: 배경에서 끝난 답변이 화면에 있고 입력이 열려 있다',
    a2.turns.some((t) => t.includes('A 최종 답변')) && a2.turns.some((t) => t.includes('A 질문입니다')) && a2.inputDisabled === false && !a2.progress, a2);

  // 7) B로 돌아오면 진행 중 잠금·진행 라인이 그대로다
  check('B로 복귀', await open('conv-b', 'B 대화') === true);
  await sleep(200);
  const b4 = await view();
  check('B 복귀: 진행 중 턴의 진행 라인과 잠금이 그대로다', b4.progress && b4.inputDisabled === true && b4.turns.some((t) => t.includes('B 답변 조각')), b4);

  // 8) Esc는 보고 있는 대화(B)만 끊는다 — main의 중단이 conv-b로 온다
  const abortedIds = [];
  const origAbort = ipcMain.listeners('athena:abort-live-query');
  ipcMain.on('athena:abort-live-query', (_e, payload) => abortedIds.push(payload && payload.conversationId));
  await wc.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(200);
  const b5 = await view();
  check('Esc: 보고 있는 B만 중단 요청이 가고 입력이 열린다', abortedIds.length === 1 && abortedIds[0] === 'conv-b' && b5.inputDisabled === false, { abortedIds, b5 });
  void origAbort;
  // 끊긴 B 왕복을 늦게 settle해도 화면은 이미 유휴다(stale 토큰)
  if (turns.has('conv-b')) finish('conv-b', '늦은 B 답');
  await sleep(200);
  const b6 = await view();
  check('Esc 뒤 늦은 결과: 중단된 턴의 답은 그리지 않는다', !b6.turns.some((t) => t.includes('늦은 B 답')), b6.turns);

  // 오브(키우미)의 병렬 진입은 실제 모델 왕복을 타므로(athena:orb-chat-submit → runLiveQuery) 여기서
  // 부르지 않는다 — lib/main/main-live-admission.test.js가 main의 실제 핸들러로 그 계약을 잰다.

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 통과${failed.length ? ` — 실패 ${failed.length}` : ''}`);
  app.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('프로브 실패:', error && error.stack ? error.stack : error);
  app.exit(1);
});
