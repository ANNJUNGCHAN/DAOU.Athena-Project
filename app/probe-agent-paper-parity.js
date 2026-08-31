// 에이전트모드 ↔ Paper `에이전트` 페이지 대조 프로브(2026-09-01).
//
// 왜 verify.js가 아니라 별도 프로브인가: `npm run verify`의 검증3b(반응형/Snap)
// 는 창을 여러 폭으로 바꿔가며 requestAnimationFrame 두 프레임을 기다린다
// (verify.js responsiveSettle). 창이 가려지거나 최소화된 세션에서는 Chromium이
// rAF를 스로틀해 그 대기가 끝나지 않아 그 지점에서 멈춘다 — 이 저장소의 에이전트
// 변경과 무관한 환경 의존 행업이라, 에이전트 계약만 실렌더러에서 재는 좁은
// 프로브를 따로 둔다(probe-subagent-dock.js가 세운 관례와 같은 자리).
//
// 재는 것은 전부 "Paper에 있으니 화면에도 있어야 한다"는 계약이다:
//   (1) 뷰 탭 4종(작업/알람/라이브/제안) — 보드 02·04·05 통일안
//   (2) 동선 규칙 3줄 원문 + data-source 없음 — 보드 05 하단
//   (3) 라이브 "다음 24시간" 시각 열 4개 — 보드 02
//   (4) 알람 갈래 아이콘 2종(mode로 갈림) — 보드 02
//   (5) 드릴인 [이력][설정] 세그먼트와 보기 전용 설정 패널 — 보드 03·06
//   (6) 접기 푸터가 실제로 나머지를 펼친다 — 보드 02·03
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-agent-paper-parity-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(label, ok) {
  if (!ok) failures.push(label);
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}`);
}

// 드릴인이 열리는 것은 감시(watch)뿐이라 fx1을 그 자리에 둔다. 실행 이력은
// 같은 날 2건 + 다른 날 6건으로 만들어 그룹 머리 병합과 접기 푸터를 동시에 잰다.
const ISO = (daysAgo, hour, minute) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const RUNS = [
  { ts: ISO(0, 7, 30), verdict: 'fired', reason: '브리핑 생성 — 핵심 3건', observed: 3, threshold: 1, duration_ms: 8200 },
  { ts: ISO(0, 15, 30), verdict: 'fired', reason: '이어진 발화 — 조건 도달', observed: 88100, threshold: 88000, duration_ms: 7100 },
  { ts: ISO(1, 7, 30), verdict: 'near', reason: '근접 — 임계 미달', observed: 87400, threshold: 88000, duration_ms: 5100 },
  { ts: ISO(2, 7, 30), verdict: 'suppressed', reason: '억제 — 쿨다운 중', observed: null, threshold: null, duration_ms: 900 },
  { ts: ISO(3, 7, 30), verdict: 'fired', reason: '브리핑 생성 — 핵심 4건', observed: 4, threshold: 1, duration_ms: 6800 },
  { ts: ISO(4, 7, 30), verdict: 'fired', reason: '브리핑 생성 — 핵심 2건', observed: 2, threshold: 1, duration_ms: 6200 },
  { ts: ISO(5, 7, 30), verdict: 'near', reason: '근접 — 임계 미달', observed: 87000, threshold: 88000, duration_ms: 5000 },
  { ts: ISO(6, 7, 30), verdict: 'fired', reason: '브리핑 생성 — 핵심 5건', observed: 5, threshold: 1, duration_ms: 7000 },
];

// 알람 방 9개 — 접기(6행)와 "지난 알람 3건 더"를 함께 잰다. mode를 섞어
// 갈래 아이콘 2종이 실제로 갈리는지도 같은 화면에서 본다.
const ALERTS = Array.from({ length: 9 }, (_, i) => ({
  id: `al${i}`,
  title: i === 0 ? '아침 브리핑 완료' : `조건 도달 ${i}`,
  sub: '',
  mode: i === 0 ? 'scheduled' : 'realtime-ws',
  firedAt: Date.now() - i * 60000,
  read: true,
}));

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

  // 백엔드가 없는 하네스라 라우틴·실행 이력만 fixture IPC로 갈아끼운다
  // (verify.js의 에이전트 블록과 같은 방식·같은 채널).
  ipcMain.removeHandler('athena:routines-list');
  ipcMain.handle('athena:routines-list', async () => ({
    ok: true,
    data: {
      routines: [
        {
          id: 'fx1', symbol: '005930', note: '삼성전자 88,000 감시', status: 'active', mode: 'realtime-ws',
          source_label: '키움 시세', cooldown_s: 300, created_at: ISO(12, 10, 0),
        },
        {
          id: 'fx2', symbol: '069500', note: '평일 아침 브리핑', status: 'active', mode: 'scheduled',
          source_label: '뉴스·공시', cooldown_s: 600, created_at: ISO(20, 9, 0),
          next_fire_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      ],
      disclosure_ready: true,
      last_error: null,
      fired_today: 2,
    },
  }));
  ipcMain.removeHandler('athena:routine-runs');
  ipcMain.handle('athena:routine-runs', async () => ({
    ok: true,
    data: { runs: RUNS.slice().reverse(), avg_duration_ms: 6540, opened_rate: 0.71, replied_count: 9 },
  }));

  // 알람 피드는 sidebar.js가 소유한 세션 메모리다 — 백엔드가 없으므로
  // AthenaNotify 다리만 이 프로브용 목록으로 바꾼다(캔버스는 그 다리로만 읽는다).
  await shellWin.webContents.executeJavaScript(`(() => {
    window.__probeAlerts = ${JSON.stringify(ALERTS)};
    const prev = window.AthenaNotify || {};
    window.AthenaNotify = Object.assign({}, prev, { list: () => window.__probeAlerts });
  })()`);

  await shellWin.webContents.executeJavaScript("document.getElementById('modeNavAgent').click()");
  await wait(700); // IPC 왕복 + refresh()

  // ---------- (1)(2)(3) 작업 뷰 + 동선 규칙 + 타임라인 ----------
  const tasksProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    const rules = c.querySelector('.agent-route-rules');
    return {
      agentVisible: !c.hidden,
      viewTabs: Array.from(c.querySelectorAll('.agent-view-tab')).map((n) => n.textContent.split(' ')[0]),
      rulesPresent: !!rules,
      rulesSource: rules ? rules.getAttribute('data-source') : 'MISSING',
      ruleLines: Array.from(c.querySelectorAll('.agent-route-rule')).map((n) => n.textContent),
      timelineTimes: Array.from(c.querySelectorAll('.agent-live-timeline-time')).map((n) => n.textContent),
      timelineDotColors: Array.from(c.querySelectorAll('.agent-live-timeline-dot')).map((n) => n.style.color),
      statCount: c.querySelectorAll('.agent-stat-card').length,
    };
  })()`);

  check('에이전트 캔버스가 보인다', tasksProbe.agentVisible === true);
  check(
    '뷰 탭 4종(작업/알람/라이브/제안) — Paper 보드 02·04·05 통일안',
    JSON.stringify(tasksProbe.viewTabs) === JSON.stringify(['작업', '알람', '라이브', '제안']),
  );
  check('통계 카드 4장이 그대로다', tasksProbe.statCount === 4);
  check('동선 규칙 패널이 작업 뷰에 있다 — Paper 보드 05 하단', tasksProbe.rulesPresent === true);
  check(
    '동선 규칙 3줄이 Paper 원문 그대로다',
    JSON.stringify(tasksProbe.ruleLines) === JSON.stringify([
      '① ＋ 새 작업 버튼은 시트를 열지 않는다 — 채팅 입력창에 시작 문장을 넣고 커서를 옮긴다.',
      '② 편집도 채팅으로 — 행을 고르고 "이거 고쳐줘". 상세 패널은 보기 전용.',
      '③ 확정(미리보기·활성화)은 채팅 카드의 칩 — 캔버스는 결과가 비치는 곳.',
    ]),
  );
  check('동선 규칙은 데이터가 아니라 화면 계약이라 data-source가 없다', tasksProbe.rulesSource === null);
  check(
    '라이브 타임라인 4행이 시각 열을 갖는다 — Paper 보드 02',
    JSON.stringify(tasksProbe.timelineTimes) === JSON.stringify(['07:30', '08:55', '15:30', '16:00']),
  );
  check(
    '타임라인 점 색이 갈래별로 갈린다(예약·프로액티브·감시)',
    JSON.stringify(tasksProbe.timelineDotColors)
      === JSON.stringify(['var(--color-ok)', 'var(--color-brand)', 'var(--color-info)', 'var(--color-brand)']),
  );

  // ---------- (4)(6) 알람 뷰 — 갈래 아이콘 2종 + 접기 푸터 ----------
  const alarmProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    const alertsTab = Array.from(c.querySelectorAll('.agent-view-tab')).find((n) => n.textContent.startsWith('알람'));
    alertsTab.click();
    const collapsedRows = c.querySelectorAll('.agent-alarm-row').length;
    const icons = Array.from(c.querySelectorAll('.agent-alarm-icon')).map((n) => n.textContent);
    const iconColors = Array.from(c.querySelectorAll('.agent-alarm-icon')).map((n) => n.style.color);
    const more = Array.from(c.querySelectorAll('.agent-list-more')).find((n) => n.textContent.startsWith('지난 알람'));
    const moreText = more ? more.textContent : null;
    if (more) more.click();
    const expandedRows = c.querySelectorAll('.agent-alarm-row').length;
    const moreGone = Array.from(c.querySelectorAll('.agent-list-more')).filter((n) => n.textContent.startsWith('지난 알람')).length === 0;
    return { collapsedRows, icons, iconColors, moreText, expandedRows, moreGone };
  })()`);

  check('알람 피드가 6행으로 접혀 있다 — Paper 보드 02 실측', alarmProbe.collapsedRows === 6);
  check('접힘 푸터가 남은 수를 정확히 센다', alarmProbe.moreText === '지난 알람 3건 더');
  check('푸터를 누르면 나머지가 펼쳐진다(죽은 글자가 아니다)', alarmProbe.expandedRows === 9);
  check('다 펼치면 푸터가 사라진다', alarmProbe.moreGone === true);
  check(
    '알람 갈래 아이콘이 mode로 갈린다(scheduled=● · 그 외=◆)',
    alarmProbe.icons[0] === '●' && alarmProbe.icons.slice(1).every((g) => g === '◆'),
  );
  check(
    '갈래 아이콘 색도 함께 갈린다(ok / brand)',
    alarmProbe.iconColors[0] === 'var(--color-ok)'
      && alarmProbe.iconColors.slice(1).every((c) => c === 'var(--color-brand)'),
  );

  // ---------- (5)(6) 드릴인 — 세그먼트 · 날짜 그룹 · 설정 패널 ----------
  await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    Array.from(c.querySelectorAll('.agent-view-tab')).find((n) => n.textContent.startsWith('작업')).click();
    window.AthenaAgentCanvas.selectRow('fx1');
  })()`);
  await wait(200);
  await shellWin.webContents.executeJavaScript("document.querySelector('.agent-history-open').click()");
  await wait(400);

  const drillProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    const segLabels = Array.from(c.querySelectorAll('.agent-history-tab')).map((n) => n.textContent);
    const segVisible = !c.querySelector('.agent-history-tabs').hidden;
    const groups = Array.from(c.querySelectorAll('.agent-history-run-group')).map((n) => n.textContent);
    const times = Array.from(c.querySelectorAll('.agent-history-run-time')).map((n) => n.textContent);
    const marks = Array.from(c.querySelectorAll('.agent-history-run-mark')).map((n) => n.textContent);
    const more = Array.from(c.querySelectorAll('.agent-list-more')).find((n) => n.textContent.startsWith('지난 실행'));
    const moreText = more ? more.textContent : null;
    if (more) more.click();
    const expandedRows = c.querySelectorAll('.agent-history-run').length;
    const expandedGroups = Array.from(c.querySelectorAll('.agent-history-run-group')).map((n) => n.textContent);
    return { segVisible, segLabels, groups, times, marks, moreText, expandedRows, expandedGroups };
  })()`);

  check('드릴인에서 [이력][설정] 세그먼트가 보인다 — Paper 보드 03 우상단',
    drillProbe.segVisible === true && JSON.stringify(drillProbe.segLabels) === JSON.stringify(['이력', '설정']));
  check('접힘 상태에서 실행 6행 + 푸터', drillProbe.times.length === 6 && drillProbe.moreText === '지난 실행 2건 더');
  check('펼치면 8행 전부 보인다', drillProbe.expandedRows === 8);
  check('행 시각은 날짜 없이 HH:MM만 남는다', drillProbe.times.every((t) => /^\d{2}:\d{2}$/.test(t)));
  check('같은 날 실행 2건은 그룹 머리를 한 번만 만든다',
    drillProbe.groups.length === 5 && new Set(drillProbe.groups).size === drillProbe.groups.length);
  check('오늘·어제 그룹은 이름이 붙는다',
    drillProbe.groups[0].startsWith('오늘 — ') && drillProbe.groups[1].startsWith('어제 — '));
  check('그 이전 그룹은 날짜+요일만 쓴다', /^\d+\/\d+ [일월화수목금토]$/.test(drillProbe.groups[2]));
  check('상태 아이콘이 ledger 실제 verdict 3종만 쓴다(●·◐·○)',
    drillProbe.marks.every((m) => ['●', '◐', '○'].includes(m)));
  check('펼친 뒤에도 그룹 머리가 중복되지 않는다',
    new Set(drillProbe.expandedGroups).size === drillProbe.expandedGroups.length);

  const settingsProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    Array.from(c.querySelectorAll('.agent-history-tab')).find((n) => n.textContent === '설정').click();
    const panel = c.querySelector('.agent-history-settings');
    const labels = Array.from(panel.querySelectorAll('.agent-detail-field-label')).map((n) => n.textContent);
    const editBtn = panel.querySelector('.agent-history-settings-edit');
    let seeded = null;
    const prevSeed = window.AthenaShell && window.AthenaShell.seedChatInput;
    if (prevSeed) window.AthenaShell.seedChatInput = (t) => { seeded = t; };
    editBtn.click();
    if (prevSeed) window.AthenaShell.seedChatInput = prevSeed;
    const out = {
      settingsVisible: panel.hidden === false,
      historyHidden: c.querySelector('.agent-history-body').hidden,
      labels,
      inputCount: panel.querySelectorAll('input, select, textarea').length,
      editLabel: editBtn.textContent,
      seeded,
    };
    Array.from(c.querySelectorAll('.agent-history-tab')).find((n) => n.textContent === '이력').click();
    out.historyBackVisible = c.querySelector('.agent-history-body').hidden === false;
    c.querySelector('.agent-breadcrumb-back').click();
    out.segHiddenAfterBack = c.querySelector('.agent-history-tabs').hidden;
    return out;
  })()`);

  check('"설정"을 누르면 이력 본문이 숨고 보기 전용 명세가 뜬다 — Paper 보드 06',
    settingsProbe.settingsVisible === true && settingsProbe.historyHidden === true);
  check('설정 패널은 백엔드가 실제로 준 필드만 낸다',
    settingsProbe.labels.length > 0
    && settingsProbe.labels.every((l) => ['조건', '모드', '소스', '종목', '쿨다운', '브리핑 모델', '다음 실행', '만료', '생성'].includes(l)));
  check('설정 패널에 값을 바꾸는 입력이 없다 — 동선 규칙②', settingsProbe.inputCount === 0);
  check('고치는 경로는 "채팅에서 고치기 ↗" 하나뿐이다', settingsProbe.editLabel === '채팅에서 고치기 ↗');
  check('그 버튼이 시트가 아니라 채팅 입력에 문장을 심는다',
    settingsProbe.seeded === '"삼성전자 88,000 감시" 루틴을 고치고 싶어요 — ');
  check('"이력"으로 되돌리면 이력 본문이 다시 보인다', settingsProbe.historyBackVisible === true);
  check('드릴인을 닫으면 세그먼트도 함께 숨는다', settingsProbe.segHiddenAfterBack === true);

  // ---------- 제안 뷰 — 스트립 메타 · 카드 2줄 ----------
  const proactiveProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    Array.from(c.querySelectorAll('.agent-view-tab')).find((n) => n.textContent.startsWith('제안')).click();
    return {
      stripSub: (c.querySelector('.agent-proactive-strip-sub') || {}).textContent,
      graphLinkVisible: !c.querySelector('.agent-graph-link').hidden,
      guardPresent: !!c.querySelector('.agent-nudge-guard'),
    };
  })()`);

  check('제안 뷰에서 "그래프 모드에서 근거 보기 →"가 보인다', proactiveProbe.graphLinkVisible === true);
  check('말걸기 가드 패널이 있다', proactiveProbe.guardPresent === true);
  check(
    '스트립 메타는 신호가 없으면 신선도를 지어내지 않는다(빈 문자열)',
    proactiveProbe.stripSub === '',
  );

  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);
  check('렌더러 콘솔 에러가 없다', consoleErrors.length === 0);

  const ok = failures.length === 0;
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-agent-paper-parity.json'),
    JSON.stringify({ tasksProbe, alarmProbe, drillProbe, settingsProbe, proactiveProbe, consoleErrors, failures, ok }, null, 1),
  );
  console.log(`[probe] 단언 실패 ${failures.length}건`);
  for (const f of failures) console.log('  -', f);
  console.log('[probe] 최종 판정:', ok);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
