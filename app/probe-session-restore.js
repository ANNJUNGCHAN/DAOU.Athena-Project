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
    // 폴더가 있는 고정 프로젝트 하나 — ⋯ 메뉴의 제거·탐색기가 살아 있고 고정 표시가 붙는지 본다.
    projects: [{ id: 'default', label: '기본 프로젝트' }, { id: 'proj-athena', label: '아테나', path: root, pinned: true }],
    conversations: [
      { id: 'conv-chat', title: '삼성전자 수급 확인', projectId: 'default', mode: 'chat',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', resumeSessionId: null },
      { id: 'conv-bt', title: '추세추종 v3', projectId: 'default', mode: 'backtest',
        createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', resumeSessionId: 'claude-sess-bt-42' },
      { id: 'conv-graph', title: '성향 지도', projectId: 'default', mode: 'graph',
        createdAt: '2026-09-02T01:00:00.000Z', updatedAt: '2026-09-02T01:00:00.000Z', resumeSessionId: null },
    ],
  }, null, 2), 'utf8');

  // 지난 프로세스가 답변 도중 죽은 흔적을 세션 스토어에 미리 심는다(39번 보드 부팅 정리).
  const sessionsDbPath = path.join(root, 'athena-sessions.sqlite3');
  {
    const { createSessionStore } = require(path.join(APP_DIR, 'lib', 'main', 'session-store.js'));
    const seed = createSessionStore({ dbPath: sessionsDbPath });
    seed.createSession({ id: 'conv-chat', mode: 'chat', projectId: 'default', title: '삼성전자 수급 확인' });
    seed.attachJob('conv-chat', { id: 'turn-stale', kind: 'chat.turn', status: 'running' });
    seed.close();
  }

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'live',
    ATHENA_CONVERSATIONS_PATH: conversationsPath,
    ATHENA_SESSIONS_DB_PATH: sessionsDbPath,
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
    return { summary: read('modeNavSummaryCount'), backtest: read('modeNavBacktestCount'), graph: read('modeNavGraphCount'), agent: read('modeNavAgentCount') };
  })()`);
  check('사이드바: 대화 1 · 백테스트 1 · 그래프 1 · 에이전트는 숨김', counts.summary && counts.summary.text === '1' && !counts.summary.hidden
    && counts.backtest && counts.backtest.text === '1' && !counts.backtest.hidden
    && counts.graph && counts.graph.text === '1' && !counts.graph.hidden
    && counts.agent && counts.agent.hidden, counts);

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

  // 7) 카드 스택이 세션에 남고, 돌아오면 같은 채널로 다시 그려진다(42번 보드)
  const bridge = typeof mainMod.getSessionBridge === 'function' ? mainMod.getSessionBridge() : null;
  check('세션 스토어: 브리지가 열린다', Boolean(bridge));
  if (bridge) {
    // conv-bt가 기록 대상인 상태에서 fixture 카드 하나를 흘린다 → 렌더러가 스택을 보고한다.
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-bt', title: '추세추종 v3' })`);
    shellWin.webContents.send('athena:add-canvas', { type: 'table' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const gridState = await wc.executeJavaScript(`(() => {
      const cards = Array.from(document.querySelectorAll('#grid .card'));
      return { cards: cards.length, tagged: cards.filter((c) => c.__athenaSessionCard).length, ids: cards.map((c) => c.dataset.sessionCardId || null) };
    })()`);
    check('카드: fixture table이 그리드에 그려지고 세션 태그가 붙는다', gridState.cards === 1 && gridState.tagged === 1, gridState);
    bridge.flush('conv-bt');
    const stored = bridge.load('conv-bt');
    const storedCards = stored && Array.isArray(stored.canvasCards) ? stored.canvasCards : [];
    check('카드: 렌더러 보고가 세션 스토어에 적힌다(fixture table 1장)',
      storedCards.length === 1 && storedCards[0].channel === 'fixture' && storedCards[0].kind === 'table',
      storedCards.map((c) => `${c.channel}:${c.kind}`));

    // 다른 대화로 갔다가 돌아오면 카드가 다시 그려진다.
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-chat', title: '삼성전자 수급 확인' })`);
    const afterLeave = await wc.executeJavaScript(`document.querySelectorAll('#grid .card').length`);
    check('카드: 다른 대화로 가면 캔버스가 비워진다', afterLeave === 0, afterLeave);
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-bt', title: '추세추종 v3' })`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const afterReturn = await wc.executeJavaScript(`document.querySelectorAll('#grid .card').length`);
    check('카드: 돌아오면 저장된 봉투로 같은 카드가 다시 그려진다', afterReturn === 1, afterReturn);
    bridge.flush('conv-bt');
    const restored = bridge.load('conv-bt');
    check('카드: 다시 그려진 스택이 같은 모양으로 다시 저장된다', restored && restored.canvasCards.length === 1, restored && restored.canvasCards.length);

    // 8) 입력 초안·스크롤이 세션에 남고, 돌아오면 그대로 돌아온다(42번 보드 "폼 값·입력 초안", "스크롤")
    await wc.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      input.value = '손절 -3%로 바꿔서';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 700));
    bridge.flush('conv-bt');
    const withDraft = bridge.load('conv-bt');
    check('초안: 입력 중인 글이 세션 워크스페이스에 적히고 kind는 그 대화의 모드다',
      withDraft && withDraft.workspace && withDraft.workspace.draft && withDraft.workspace.draft.text === '손절 -3%로 바꿔서'
      && withDraft.workspace.kind === 'backtest', withDraft && withDraft.workspace);
    // 다른 대화로 갔다가(입력이 비워진 채) 돌아오면 초안이 다시 채워진다.
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-chat', title: '삼성전자 수급 확인' })`);
    await wc.executeJavaScript(`(() => { document.getElementById('input').value = ''; return true; })()`);
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-bt', title: '추세추종 v3' })`);
    const draftBack = await wc.executeJavaScript(`document.getElementById('input').value`);
    check('초안: 돌아오면 입력창에 그 글이 다시 들어온다', draftBack === '손절 -3%로 바꿔서', draftBack);

    // 9) 실행 상태(39번 보드) — 부팅 정리, 행의 스피너·점, 모드 옆 스피너, 머리 알약, 목록의 runState
    await mainMod.reconcileSessionJobs();
    const staleJob = bridge.store.getJob('turn-stale');
    check('부팅 정리: 지난 프로세스의 답변 턴은 interrupted가 된다', staleJob && staleJob.status === 'interrupted', staleJob && staleJob.status);
    const readSidebarRun = () => wc.executeJavaScript(`(() => {
      const rowOf = (id) => document.querySelector('.sidebar-item[data-conversation-id="' + id + '"]');
      const runOf = (id) => { const row = rowOf(id); const run = row && row.querySelector('.sidebar-item-run'); return run ? run.className : null; };
      const nav = document.getElementById('modeNavBacktest');
      const pill = document.getElementById('sidebarRunSummary');
      return { bt: runOf('conv-bt'), chat: runOf('conv-chat'),
        navRunning: nav ? nav.classList.contains('has-running') : null,
        pill: pill && !pill.hidden ? pill.textContent : null };
    })()`);
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-bt', title: '추세추종 v3' })`);
    const listedStale = await wc.executeJavaScript(`window.athena.invoke('athena:conversations-list')`);
    const chatRow = listedStale.conversations.find((c) => c.id === 'conv-chat');
    check('목록: 중단된 턴이 있는 대화는 runState=failed로 얹혀 나온다', chatRow && chatRow.runState === 'failed', chatRow && chatRow.runState);

    bridge.attachJob({ sessionId: 'conv-bt', job: { id: 'run-probe-1', kind: 'backtest.run', status: 'running' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const running = await readSidebarRun();
    check('실행: 붙는 즉시 그 행에 스피너, 모드 옆에도 스피너, 머리에 "실행 중 1"',
      /sidebar-item-run-running/.test(running.bt || '') && running.navRunning === true && running.pill === '실행 중 1', running);
    check('실행: 실패한 대화 행은 빨간 점(failed)', /sidebar-item-run-failed/.test(running.chat || ''), running.chat);
    const listedRunning = await wc.executeJavaScript(`window.athena.invoke('athena:conversations-list')`);
    const btRow = listedRunning.conversations.find((c) => c.id === 'conv-bt');
    check('목록: 실행 중인 대화는 runState=running', btRow && btRow.runState === 'running', btRow && btRow.runState);
    // 눈으로 보는 확인 — ATHENA_PROBE_SHOT=경로 면 이 순간(실행 중 + 실패)의 셸을 PNG로 남긴다.
    if (process.env.ATHENA_PROBE_SHOT) {
      const shot = async (suffix) => {
        const target = process.env.ATHENA_PROBE_SHOT.replace(/\.png$/i, `${suffix}.png`);
        fs.writeFileSync(target, (await shellWin.capturePage()).toPNG());
        console.log(`shot ${target}`);
      };
      await shot('');
      // 펜 → 모드 고르기(37번 보드), ⋯ → 삭제 → 확인 패널(38번 보드)도 눈으로 본다.
      await wc.executeJavaScript(`(() => { const pen = document.querySelector('.sidebar-project-new-chat'); if (pen) pen.click(); return Boolean(pen); })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await shot('-picker');
      await wc.executeJavaScript(`(() => {
        for (const node of document.querySelectorAll('.sidebar-mode-picker')) node.remove();
        // 폴더가 있는 마지막 프로젝트(아테나)의 ⋯ — 기본 프로젝트는 폴더가 없어 제거가 잠겨 있다.
        const triggers = document.querySelectorAll('.sidebar-project-menu-trigger');
        const trigger = triggers[triggers.length - 1]; if (trigger) trigger.click();
        const danger = document.querySelector('.sidebar-project-menu-item.is-danger:not(:disabled)'); if (danger) danger.click();
        return Boolean(trigger && danger);
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await shot('-remove');
    }

    bridge.updateJob({ jobId: 'run-probe-1', patch: { status: 'done' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const finished = await readSidebarRun();
    check('완료: 스피너가 회색 점이 되고 모드 옆 스피너·머리 알약이 사라진다',
      /sidebar-item-run-done/.test(finished.bt || '') && finished.navRunning === false && finished.pill === null, finished);

    // 10) 그래프 워크스페이스(42번 보드) — 서브뷰(지도)가 세션에 남고, 돌아오면 그대로 지도다.
    //     브레인 백엔드가 없어 지도 그리기는 실패하지만 서브뷰 상태 자체는 남아야 한다.
    const graphOpened = await wc.executeJavaScript(`(async () => {
      const ok = await window.AthenaShell.openConversation({ id: 'conv-graph', title: '성향 지도' });
      const mode = window.AthenaCanvasMode;
      try { await mode.setSurface('map'); } catch { /* 브레인 없음 — 서브뷰 전환은 됐다 */ }
      return { ok, view: mode.state.view, surface: mode.state.surface, registered: window.AthenaSessionWorkspace.has('graph') };
    })()`);
    check('그래프: 대화를 열면 graph 화면, 지도 서브뷰로 바꿀 수 있고 핸들러가 등록돼 있다',
      graphOpened.ok === true && graphOpened.view === 'graph' && graphOpened.surface === 'map' && graphOpened.registered === true, graphOpened);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // 1초 폴링 + 300ms 디바운스
    bridge.flush('conv-graph');
    const graphStored = bridge.load('conv-graph');
    check('그래프: 서브뷰가 세션 워크스페이스에 kind=graph로 적힌다',
      graphStored && graphStored.workspace && graphStored.workspace.kind === 'graph'
      && graphStored.workspace.graph && graphStored.workspace.graph.surface === 'map', graphStored && graphStored.workspace);
    await wc.executeJavaScript(`window.AthenaShell.openConversation({ id: 'conv-chat', title: '삼성전자 수급 확인' })`);
    const graphBack = await wc.executeJavaScript(`(async () => {
      await window.AthenaShell.openConversation({ id: 'conv-graph', title: '성향 지도' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { view: window.AthenaCanvasMode.state.view, surface: window.AthenaCanvasMode.state.surface };
    })()`);
    check('그래프: 다른 대화에 갔다 돌아오면 지도 서브뷰가 그대로다', graphBack.view === 'graph' && graphBack.surface === 'map', graphBack);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 통과${failed.length ? ` — 실패 ${failed.length}` : ''}`);
  app.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('프로브 실패:', error && error.stack ? error.stack : error);
  app.exit(1);
});
