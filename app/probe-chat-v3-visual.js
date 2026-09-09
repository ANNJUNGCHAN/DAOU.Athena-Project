// 채팅창 v3(Paper 44·45, 2026-09-05) 시각 프로브 — 실제 셸 창에 합성 턴을 흘려 넣고 대화 열을
// PNG로 남긴다. Paper 보드 44(진행 중 · 활동 줄 · 에이전트 카드 · 상태 줄 · 결과물 바 · 툴바)와
// 눈으로 대조하기 위한 캡처 전용이다. claude -p는 스폰하지 않는다 — probe-turn-abort-record.js와
// 같은 기법으로 athena__render_canvas만 영원히 pending으로 묶고, main→renderer 실경로 IPC
// (live-tool-step · live-subagent-step · live-text-delta)로 단계를 보낸다.
//
// 캡처: captures/chat-v3-{running,aborted,final,narrow}.png (대화 열만 잘라 저장)

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { captureRoot } = require('./lib/probe-captures');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

// 캡처 전용이라 GPU가 필요 없다 — 이 머신에서는 GPU 경로가 warmup 창 ready-to-show를 5초 안에 못
// 넘겨 프로브가 시작도 못 한다(probe-chat-input-width.js와 같은 조치).
app.disableHardwareAcceleration();

const PROFILE = path.join(__dirname, '.probe-chat-v3-visual-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = captureRoot(__dirname);

async function captureChat(shellWin, name) {
  const rect = await shellWin.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('chatRegion').getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  })()`);
  const img = await shellWin.webContents.capturePage(rect);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `chat-v3-${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  console.log('[probe] 캡처:', file, JSON.stringify(rect));
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  const consoleErrors = [];
  shellWin.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });
  for (let i = 0; i < 100; i += 1) {
    const hidden = await shellWin.webContents.executeJavaScript("document.getElementById('app').hidden");
    if (hidden === false) break;
    await wait(100);
  }
  // 질의를 영원히 pending으로 묶는다 — 렌더러의 window.athena는 contextBridge 객체라 갈아끼울 수
  // 없으므로(대입이 조용히 무시된다) main 쪽 핸들러를 바꾼다.
  ipcMain.removeHandler('athena__render_canvas');
  ipcMain.handle('athena__render_canvas', () => new Promise(() => {}));
  await shellWin.webContents.executeJavaScript(`(() => {
    try { localStorage.setItem('athena-coachmark-settings-v3', '1'); } catch {}
    document.querySelector('.coachmark')?.remove();
  })()`);

  // ---------- 완료 턴 하나를 먼저 심는다(실패 알림 줄 + 결과물 바 포함) ----------
  await shellWin.webContents.executeJavaScript(`(() => {
    const q = document.createElement('div'); q.className = 'turn';
    const qt = document.createElement('div'); qt.className = 'turn-q'; qt.textContent = '삼성전자 흐름이랑 재무 같이 보여줘';
    q.appendChild(qt); document.getElementById('history').appendChild(q);
    const a = document.createElement('div'); a.className = 'turn';
    const at = document.createElement('div'); at.className = 'turn-a';
    window.AthenaLib.Markdown.render(at, '일봉 60개를 폈습니다. 5월 하순부터 20일선이 60일선을 위로 뚫고 그대로 벌어졌고, 종가 **88,100원**은 20일선 위에 있습니다.');
    a.appendChild(at);
    const meta = document.createElement('div'); meta.className = 'turn-meta';
    for (const t of ['표', '차트']) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = t; meta.appendChild(c); }
    a.appendChild(meta);
    document.getElementById('history').appendChild(a);
    const f = document.createElement('div'); f.className = 'turn';
    window.renderFailureBubble(f, '네트워크 연결을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    document.getElementById('history').appendChild(f);
    window.updateResultDock(2, ['table', 'chart'], ['삼성전자 일봉', 'DART 재무제표']);
  })()`);

  // ---------- 진행 중 턴 — 도구 행 · 하위 에이전트 카드 · 스트리밍 답변 ----------
  shellWin.webContents.executeJavaScript("window.runQueryLive('재무 쪽은 하위 에이전트한테 맡겨서 정리해줘')");
  await wait(300);
  shellWin.webContents.send('athena:live-tool-step', { id: 's1', label: '현재가 조회', done: false });
  await wait(120);
  shellWin.webContents.send('athena:live-tool-step', { id: 's1', label: '현재가 조회', done: true, elapsedMs: 420 });
  shellWin.webContents.send('athena:live-tool-step', { id: 's2', label: '현재가 조회', done: true, elapsedMs: 310 });
  shellWin.webContents.send('athena:live-tool-step', { id: 's3', label: '재무제표 조회', done: true, elapsedMs: 1240, error: true });
  shellWin.webContents.send('athena:live-tool-step', { id: 's4', label: '일봉 차트', done: false });
  await wait(120);
  shellWin.webContents.send('athena:live-subagent-step', { taskId: 't1', subtype: 'task_started', description: '재무 해석 — 2025 연결 재무상태표' });
  shellWin.webContents.send('athena:live-subagent-step', { taskId: 't2', subtype: 'task_started', description: '수급 정리 — 외국인·기관 20일' });
  shellWin.webContents.send('athena:live-subagent-step', { taskId: 't3', subtype: 'task_started', description: '뉴스 요약' });
  await wait(120);
  shellWin.webContents.send('athena:live-subagent-step', { taskId: 't2', subtype: 'task_updated', status: 'completed' });
  await wait(120);
  shellWin.webContents.send('athena:live-text-delta', { text: '재무 해석은 읽기 전용 하위 에이전트에게 맡기겠습니다. 2025 연결 재무상태표에서 유동비율·현금성자산 비중을 먼저 봅니다.' });
  await wait(3200); // 텍스트 방출 사다리(최대 2.5s)
  const running = await shellWin.webContents.executeJavaScript(`(() => ({
    statusVisible: !document.getElementById('lockHint').hidden,
    statusText: document.getElementById('lockText').textContent,
    stopVisible: !document.getElementById('stopBtn').hidden,
    stepRows: document.querySelectorAll('.progress-tool-step').length,
    agentCards: document.querySelectorAll('.agent-card').length,
    agentCells: document.querySelectorAll('.agent-card-grid .agent-card-cell').length,
    agentDone: document.querySelectorAll('.agent-card-grid .agent-card-cell.is-done').length,
    agentTitle: document.querySelector('.agent-card-title')?.textContent,
    agentCount: document.querySelector('.agent-card-count')?.textContent,
    dockVisible: !document.querySelector('.result-dock').hidden,
    dockCount: document.querySelector('.result-dock-count')?.textContent,
    dockSources: document.querySelector('.result-dock-sources')?.textContent,
    modelBtn: document.getElementById('modelBtn').textContent,
    effortBtn: document.getElementById('effortBtn').textContent,
    streamed: !!document.querySelector('.turn-a .md-p'),
  }))()`);
  console.log('[probe] 진행 중:', JSON.stringify(running));
  await captureChat(shellWin, 'running');

  // ---------- Esc 중단 → 접힌 활동 줄(중단) · 카드는 남는다 ----------
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await wait(300);
  const aborted = await shellWin.webContents.executeJavaScript(`(() => {
    const h = document.querySelector('.turn-exec-header.is-aborted');
    return {
      header: h ? h.querySelector('.turn-exec-header-label').textContent : null,
      folded: h ? h.closest('.turn-exec-record').querySelector('.progress-tool-steps').hidden : null,
      agentCardsKept: document.querySelectorAll('.agent-card').length,
      statusHidden: document.getElementById('lockHint').hidden,
      stopHidden: document.getElementById('stopBtn').hidden,
      inputEnabled: !document.getElementById('input').disabled,
    };
  })()`);
  console.log('[probe] 중단 후:', JSON.stringify(aborted));
  await captureChat(shellWin, 'aborted');

  // ---------- 펼침 · 출처 펼침 ----------
  await shellWin.webContents.executeJavaScript(`(() => {
    document.querySelector('.turn-exec-header.is-aborted').click();
    document.querySelector('.agent-card-head').click();
    document.querySelector('.result-dock-sources').click();
  })()`);
  await wait(200);
  await captureChat(shellWin, 'expanded');

  // ---------- 좁은 창(1279 이하) 트레이 ----------
  const bounds = shellWin.getBounds();
  shellWin.setBounds({ ...bounds, width: 1000 });
  await wait(500);
  const narrow = await shellWin.webContents.executeJavaScript(`(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      chat: r(document.getElementById('chatRegion')),
      stack: r(document.getElementById('inputStack')),
      row: r(document.querySelector('.input-row')),
      bar: r(document.querySelector('.composer-bar')),
      dock: r(document.querySelector('.result-dock')),
    };
  })()`);
  console.log('[probe] 좁은 창:', JSON.stringify(narrow));
  await captureChat(shellWin, 'narrow');
  shellWin.setBounds(bounds);

  // 스피너 항은 빼 둔다 — 툴바의 [+][@][스피너]는 `2df6b103`에서 **설계상 제거**됐고
  // 그 커밋이 프로브의 수집도 같이 지웠다. 그런데 판정식에만 남아 `undefined`가 되어
  // 이 게이트는 그 뒤로 늘 떨어졌다(다른 항은 전부 참인데도).
  const ok = running.statusVisible && running.stopVisible
    && running.stepRows === 4 && running.agentCards === 1 && running.agentCells === 3 && running.agentDone === 1
    && running.agentCount === '3개' && running.dockVisible && running.dockCount === '+2 카드'
    && aborted.folded === true && aborted.agentCardsKept === 1 && aborted.statusHidden && aborted.stopHidden
    && aborted.inputEnabled && consoleErrors.length === 0;
  fs.writeFileSync(path.join(OUT, 'probe-chat-v3-visual.json'), JSON.stringify({ running, aborted, narrow, consoleErrors, ok }, null, 1));
  console.log('[probe] 콘솔 에러:', consoleErrors);
  console.log('[probe] 최종 판정:', ok);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
