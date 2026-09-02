'use strict';

/**
 * 세션 복원 프로브 — 실제 Electron main.js + 실제 셸 렌더러로 "이력 행을 다시 누르면
 * 그대로"(41번 보드)의 앱 층 계약을 잰다. 백엔드·Claude CLI는 띄우지 않는다:
 * 여기서 재는 것은 main의 기록 대상 전환, Claude 커서(--resume) 이음, 렌더러의
 * 모드 화면 전환과 메시지 재그리기까지다. 메시지 조회는 백엔드가 없어 0건이 되고,
 * 그 경우에도 "저장된 메시지가 없습니다"로 정직하게 그리는지 함께 본다.
 *
 * 실행: cd app && npx electron probe-session-restore.js
 */

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = __dirname;
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

async function main() {
  // 프로필은 매번 새로 — 고정 프로필은 이전 인스턴스 잠금에 걸려 조용히 매달린다(실측).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-session-probe-'));
  const userDataDir = path.join(root, 'user-data');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
    'utf8',
  );
  // 이력을 씨앗한다 — 대화 행은 첫 사용자 입력에만 생기므로 프로브는 파일로 넣는다.
  const conversationsPath = path.join(userDataDir, 'athena-conversations.json');
  fs.writeFileSync(conversationsPath, JSON.stringify({
    version: 2,
    activeId: null,
    currentProjectId: 'default',
    projects: [{ id: 'default', label: '기본 프로젝트' }],
    conversations: [
      { id: 'conv-chat', title: '삼성전자 수급 확인', projectId: 'default', mode: 'chat',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', resumeSessionId: null },
      { id: 'conv-bt', title: '추세추종 v3', projectId: 'default', mode: 'backtest',
        createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', resumeSessionId: 'claude-sess-bt-42' },
    ],
  }, null, 2), 'utf8');

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_CONVERSATIONS_PATH: conversationsPath,
    ATHENA_BACKEND_URL: 'http://127.0.0.1:9',   // 닫힌 포트 — 백엔드 없음이 곧 조건이다
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
    for (const id of ['boot', 'onboard', 'settings', 'order']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    const app = document.getElementById('app');
    if (app) app.hidden = false;
    return true;
  })()`);

  // 1) 목록에 모드가 실린다
  const listed = await wc.executeJavaScript(`window.athena.invoke('athena:conversations-list')`);
  check('목록: 대화마다 mode가 실린다', Array.isArray(listed.conversations)
    && listed.conversations.every((c) => c.mode), listed.conversations.map((c) => `${c.id}:${c.mode}`));

  // 2) 사이드바 모드 머리에 대화 수가 달린다
  const counts = await wc.executeJavaScript(`(() => {
    const read = (id) => { const el = document.getElementById(id); return el ? { hidden: el.hidden, text: el.textContent } : null; };
    return { summary: read('modeNavSummaryCount'), backtest: read('modeNavBacktestCount'), graph: read('modeNavGraphCount') };
  })()`);
  check('사이드바: 대화 1 · 백테스트 1 · 그래프는 숨김', counts.summary && counts.summary.text === '1' && !counts.summary.hidden
    && counts.backtest && counts.backtest.text === '1' && !counts.backtest.hidden
    && counts.graph && counts.graph.hidden, counts);

  // 3) 새 대화가 mode를 살린다
  const begun = await wc.executeJavaScript(`window.athena.invoke('athena:conversations-new', { mode: 'graph' })`);
  check('새 대화: 보낸 view(graph)가 activeMode로 남는다', begun && begun.activeMode === 'graph', begun && begun.activeMode);

  // 4) 이력 행을 누르면 실제로 돌아간다 — 기록 대상·커서·모드 화면
  const beforeSwitch = mainMod.getLiveSessionId();
  const switched = await wc.executeJavaScript(`window.athena.invoke('athena:conversations-set-active', { id: 'conv-bt' })`);
  check('전환: restorable=true · activeId=conv-bt · activeMode=backtest · resumed=true',
    switched && switched.restorable === true && switched.activeId === 'conv-bt'
    && switched.activeMode === 'backtest' && switched.resumed === true, {
      restorable: switched && switched.restorable, activeId: switched && switched.activeId,
      activeMode: switched && switched.activeMode, resumed: switched && switched.resumed,
    });
  check('전환: main의 Claude 커서가 그 대화의 것으로 바뀐다', mainMod.getLiveSessionId() === 'claude-sess-bt-42',
    { before: beforeSwitch, after: mainMod.getLiveSessionId() });

  // 5) 렌더러 경로 — openConversation이 화면을 백테스트 모드로 옮기고 입력을 연다
  const opened = await wc.executeJavaScript(`(async () => {
    const ok = await window.AthenaShell.openConversation({ id: 'conv-chat', title: '삼성전자 수급 확인' });
    const view = window.AthenaCanvasMode && window.AthenaCanvasMode.state && window.AthenaCanvasMode.state.view;
    const banner = document.querySelector('.past-banner-title');
    const note = document.querySelector('.past-banner-note');
    const empty = document.querySelector('.past-empty');
    const input = document.getElementById('input');
    return { ok, view, banner: banner && banner.textContent, note: note && note.textContent,
      empty: empty && empty.textContent, inputDisabled: input ? input.disabled : null };
  })()`);
  check('렌더러: chat 대화를 열면 화면이 summary(대화) 모드로 간다', opened.ok === true && opened.view === 'summary', opened);
  check('렌더러: 복원 배너가 뜨고 입력은 잠기지 않는다', /복원됨/.test(opened.banner || '') && opened.inputDisabled === false, opened);
  check('렌더러: 커서가 없던 대화는 "문맥 없이 새로 시작"이라고 말한다', /문맥 없이/.test(opened.note || ''), opened.note);
  check('렌더러: 백엔드가 없어 메시지 0건이면 그 사실을 적는다', /저장된 메시지가 없습니다/.test(opened.empty || ''), opened.empty);
  check('전환(chat): 커서가 없는 대화로 돌아오면 main 커서가 비워진다', mainMod.getLiveSessionId() === null, mainMod.getLiveSessionId());

  const openedBt = await wc.executeJavaScript(`(async () => {
    const ok = await window.AthenaShell.openConversation({ id: 'conv-bt', title: '추세추종 v3' });
    const view = window.AthenaCanvasMode && window.AthenaCanvasMode.state && window.AthenaCanvasMode.state.view;
    const nav = document.getElementById('modeNavBacktest');
    const note = document.querySelector('.past-banner-note');
    return { ok, view, navActive: nav ? nav.classList.contains('is-active') : null, note: note && note.textContent };
  })()`);
  check('렌더러: backtest 대화를 열면 화면과 모드 네비가 backtest로 간다', openedBt.ok === true && openedBt.view === 'backtest' && openedBt.navActive === true, openedBt);
  check('렌더러: 커서가 있던 대화는 "문맥까지 이어진다"고 말한다', /문맥까지/.test(openedBt.note || ''), openedBt.note);

  // 6) 모르는 id는 복원 불가로 정직하게 거절한다
  const unknown = await wc.executeJavaScript(`window.athena.invoke('athena:conversations-set-active', { id: 'no-such' })`);
  check('모르는 id: restorable=false · 기록 대상은 그대로', unknown && unknown.restorable === false && unknown.activeId === 'conv-bt', { restorable: unknown && unknown.restorable, activeId: unknown && unknown.activeId });

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 통과${failed.length ? ` — 실패 ${failed.length}` : ''}`);
  app.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('프로브 실패:', error && error.stack ? error.stack : error);
  app.exit(1);
});
