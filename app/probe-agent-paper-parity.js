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
//   (5) 드릴인 [이력][설정] 세그먼트와 「설정 — 요약」 + [설정 편집]이 여는
//       소스별 편집 폼(저장 왕복·만료 미변경 보존) — 보드 03·06
//   (6) 접기 푸터가 실제로 나머지를 펼친다 — 보드 02·03
//   (7) 코드 알람(Step 7) — 보드 09~12. 목록 행 문법(◆·「코드 감시 · 장중 N분마다」),
//       노드 카드 문법(한국어 제목·영어명·들어감·나옴·「방금 바뀜」·「이번엔 안 쓰임」),
//       접힌 코드 줄, 「울린 기록」·「만료」·조건 폼 부재, 「고치기 — 말로」의 멈춤
//       확인, 초안의 「어제까지로 세었음 · 오늘은 진행 중」과 「검사」.
//       채팅 쪽 승인 카드(「이 알람 승인」)는 이 프로브가 채팅을 몰아 보지 않아
//       범위 밖이다 — lib/watch-check-card.test.js와 chat 계열 테스트가 잰다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
// Fixture IPC가 설치되기 전의 시작 요청도 사용자의 실행 중 백엔드로 보내지 않는다.
process.env.ATHENA_BACKEND_URL = 'http://127.0.0.1:0';

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

// 코드 알람 fixture(보드 10·11) — 노드 4칸 중 하나는 「방금 바뀜」, 하나는 이번에
// 안 불린 칸이다. 값은 전부 백엔드가 기록한 모양 그대로(숫자·참·없음)를 흉내낸다.
const WATCH_NODES = [
  {
    fn: 'load_bars', title_ko: '일봉 불러오기', title_en: 'load_bars',
    inputs: [{ name: '종목', value: '삼성전자' }, { name: '기간', value: 60 }],
    output: '봉 60개 + 오늘 봉', called: true, changed: false, warnings: [],
  },
  {
    fn: 'avg_volume', title_ko: '5일 거래량 평균', title_en: 'avg_volume',
    inputs: [{ name: '봉', value: 60 }, { name: '일수', value: 5 }],
    output: 13000000, called: true, changed: true, warnings: [],
  },
  {
    fn: 'volume_ratio', title_ko: '배수 비교', title_en: 'volume_ratio',
    inputs: [{ name: '오늘 거래량', value: 16500000 }, { name: '배수', value: 2 }],
    output: 1.27, called: true, changed: false, warnings: [],
  },
  {
    fn: 'fire', title_ko: '알림', title_en: 'fire',
    inputs: [{ name: '넘음', value: false }, { name: '쿨다운', value: 1 }],
    output: null, called: false, changed: false, warnings: [],
  },
];

const WATCH_BLOCK = {
  project_id: 'p1', path: 'watch/volume_spike.py', version_hash: 'ab12cd34ef',
  params: { 배수: 2 }, poll_interval_s: 60, lookback_days: 30, last_fired_at: null,
};

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
        {
          id: 'fx3', symbol: '005930', note: '거래량 급증 감시 · 삼성전자', status: 'active', mode: 'code-watch',
          source_label: '코드 감시', cooldown_s: 86400, created_at: ISO(6, 10, 0),
          expires_at: '2026-10-03T09:00:00', watch: WATCH_BLOCK,
        },
        {
          id: 'fx4', symbol: '005930', note: '외국인 순매수 3일 연속', status: 'draft', mode: 'code-watch',
          source_label: '코드 감시', cooldown_s: 86400, created_at: ISO(0, 9, 0),
          activation_blocker: '감시 코드 파일 없음 — 다시 만들기',
        },
      ],
      disclosure_ready: true,
      last_error: null,
      fired_today: 2,
    },
  }));
  // 코드 알람 상세(Step 7) — 목록에 없는 감시 블록·오늘 확인·노드 칸이 여기 있다.
  ipcMain.removeHandler('athena:routine-detail');
  ipcMain.handle('athena:routine-detail', async (_e, { id }) => {
    if (id === 'fx1') {
      // 설정 편집 폼(보드 06)이 읽는 조건 원문·소스 명세 — 목록에는 없는 값이다.
      return {
        ok: true,
        data: {
          id,
          symbol: '005930',
          status: 'active',
          mode: 'realtime-ws',
          source_label: '현재가',
          cooldown_s: 300,
          expires_at: '2026-09-10T09:00:00',
          note: '삼성전자 88,000 감시',
          briefing_model: 'opus',
          briefing_effort: 'high',
          condition: { source: 'price.current', op: '>=', value: 88000, consecutive_ticks: 1 },
          source_spec: {
            ops: ['<', '<=', '>', '>='], value_type: 'number', transport: 'ws', label: '현재가',
          },
        },
      };
    }
    if (id === 'fx3') {
      return {
        ok: true,
        data: {
          id, watch: WATCH_BLOCK, last_check: null,
          last_run: {
            checked_at: ISO(0, 15, 31), observed: 1.27, duration_ms: 820,
            nodes: WATCH_NODES, skip_reason: null,
          },
        },
      };
    }
    if (id === 'fx4') {
      return {
        ok: true,
        data: {
          id, watch: WATCH_BLOCK, last_run: null,
          activation_blocker: '감시 코드 파일 없음 — 다시 만들기',
          last_check: {
            count: 4, lookback_days: 30, last_fire: '2026-08-26',
            fires: [{ dt: '2026-08-26', close: 71000 }],
            nodes: WATCH_NODES, warnings: [], checked_at: ISO(0, 15, 31),
            counted_until: '2026-09-02', ok: true, reason: null,
          },
        },
      };
    }
    return { ok: true, data: { id } };
  });
  ipcMain.removeHandler('athena:routine-pause');
  ipcMain.handle('athena:routine-pause', async () => ({ ok: true, data: { status: 'paused' } }));
  // 설정 편집 [저장] — 백엔드 없이도 왕복이 끝나게 보낸 본문을 그대로 되비춘다
  // (실제 백엔드는 전량 재검증한 상세를 돌려준다).
  const updateBodies = [];
  ipcMain.removeHandler('athena:routine-update');
  ipcMain.handle('athena:routine-update', async (_e, { id, body } = {}) => {
    updateBodies.push(body);
    return {
      ok: true,
      data: {
        id,
        note: body.note,
        cooldown_s: body.cooldown_s,
        expires_at: '2026-09-10T09:00:00',
        briefing_model: body.briefing_model,
        briefing_effort: body.briefing_effort,
      },
    };
  });
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
      rulesCaption: rules && rules.querySelector('.agent-panel-caption')
        ? rules.querySelector('.agent-panel-caption').textContent : 'MISSING',
      ruleLines: Array.from(c.querySelectorAll('.agent-route-rule')).map((n) => n.textContent),
      timelineTimes: Array.from(c.querySelectorAll('.agent-live-timeline-time')).map((n) => n.textContent),
      timelineDotColors: Array.from(c.querySelectorAll('.agent-live-timeline-dot')).map((n) => n.style.color),
      statCount: c.querySelectorAll('.agent-stat-card').length,
      statsText: Array.from(c.querySelectorAll('.agent-stat-card')).map((n) => n.textContent).join(' '),
      subtitle: c.querySelector('.agent-subtitle').textContent,
    };
  })()`);

  check('에이전트 캔버스가 보인다', tasksProbe.agentVisible === true);
  check(
    '뷰 탭 4종(작업/알람/라이브/제안) — Paper 보드 02·04·05 통일안',
    JSON.stringify(tasksProbe.viewTabs) === JSON.stringify(['작업', '알람', '라이브', '제안']),
  );
  check('통계 카드 4장이 그대로다', tasksProbe.statCount === 4);
  check('진행 중 타일은 실제 활성 감시 수만 표시하고 데모 진행률을 만들지 않는다',
    tasksProbe.statsText.includes('2건 감시 중')
    && tasksProbe.subtitle.includes('감시 2 진행 중')
    && !tasksProbe.statsText.includes('시세 수집')
    && !tasksProbe.statsText.includes('12초 전'));
  check('이중 제어 규칙 패널이 작업 뷰에 있다 — Paper 보드 05 하단', tasksProbe.rulesPresent === true);
  check(
    '이중 제어 규칙 3줄이 Paper C6V-0~C6X-0 원문 그대로다',
    JSON.stringify(tasksProbe.ruleLines) === JSON.stringify([
      '① 새 작업 — 채팅 문장으로도, 시트로도.',
      '② 편집 — "이거 고쳐줘"로도, 폼으로도.',
      '③ 확정 — 채팅 칩으로도, 버튼으로도. 어느 입구든 같은 게이트.',
    ]),
  );
  check('이중 제어 규칙 캡션이 Paper C6U-0 원문이다', tasksProbe.rulesCaption === '이중 제어 규칙');
  check('이중 제어 규칙은 데이터가 아니라 화면 계약이라 data-source가 없다', tasksProbe.rulesSource === null);
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

  const settingsProbe = await shellWin.webContents.executeJavaScript(`(async () => {
    const c = document.getElementById('agentCanvas');
    Array.from(c.querySelectorAll('.agent-history-tab')).find((n) => n.textContent === '설정').click();
    const panel = c.querySelector('.agent-history-settings');
    const out = {
      settingsVisible: panel.hidden === false,
      historyHidden: c.querySelector('.agent-history-body').hidden,
      summaryCaption: (panel.querySelector('.agent-panel-caption') || {}).textContent,
      summaryTitle: (panel.querySelector('.agent-settings-summary-title') || {}).textContent,
      summaryMeta: (panel.querySelector('.agent-settings-summary-meta') || {}).textContent,
      summaryInputCount: panel.querySelectorAll('input, select, textarea').length,
      editLabel: (panel.querySelector('.agent-history-settings-edit') || {}).textContent,
    };
    panel.querySelector('.agent-history-settings-edit').click();
    await new Promise((r) => setTimeout(r, 600)); // 상세 1회 왕복
    out.formCaption = (panel.querySelector('.agent-settings-form .agent-panel-caption') || {}).textContent;
    out.fieldLabels = Array.from(panel.querySelectorAll('.agent-settings-field .agent-settings-label')).map((n) => n.textContent);
    out.readonlyLabels = Array.from(panel.querySelectorAll('.agent-settings-readonly .agent-settings-label')).map((n) => n.textContent);
    out.tag = (panel.querySelector('.agent-settings-tag') || {}).textContent;
    out.hints = Array.from(panel.querySelectorAll('.agent-settings-hint')).map((n) => n.textContent);
    out.saveLabel = (panel.querySelector('.agent-settings-save') || {}).textContent;
    const chatBtn = panel.querySelector('.agent-settings-chat');
    out.chatLabel = chatBtn ? chatBtn.textContent : null;
    let seeded = null;
    const prevSeed = window.AthenaShell && window.AthenaShell.seedChatInput;
    if (prevSeed) window.AthenaShell.seedChatInput = (t) => { seeded = t; };
    if (chatBtn) chatBtn.click();
    if (prevSeed) window.AthenaShell.seedChatInput = prevSeed;
    out.seeded = seeded;

    // 쿨다운만 바꾸고 저장한다 — 만료 칸은 비워 둔 채다(미변경 보존 규칙).
    const inputs = Array.from(panel.querySelectorAll('.agent-settings-input'));
    inputs[2].value = '600';
    panel.querySelector('.agent-settings-save').click();
    await new Promise((r) => setTimeout(r, 600));
    out.formGone = panel.querySelectorAll('.agent-settings-form').length === 0;
    out.summaryAfterSave = (panel.querySelector('.agent-settings-summary-meta') || {}).textContent;

    Array.from(c.querySelectorAll('.agent-history-tab')).find((n) => n.textContent === '이력').click();
    out.historyBackVisible = c.querySelector('.agent-history-body').hidden === false;
    c.querySelector('.agent-breadcrumb-back').click();
    out.segHiddenAfterBack = c.querySelector('.agent-history-tabs').hidden;
    return out;
  })()`);

  check('"설정"을 누르면 이력 본문이 숨고 「설정 — 요약」이 뜬다 — Paper 보드 06',
    settingsProbe.settingsVisible === true && settingsProbe.historyHidden === true
    && settingsProbe.summaryCaption === '설정 — 요약');
  check('요약은 그 작업의 실제 값 한 줄이다',
    settingsProbe.summaryTitle === '삼성전자 88,000 감시'
    && /^자동 · 쿨다운 300초 · 생성 /.test(settingsProbe.summaryMeta));
  check('요약만 있는 동안에는 값을 바꾸는 입력이 없다', settingsProbe.summaryInputCount === 0);
  check('편집으로 들어가는 문은 [설정 편집] 하나다', settingsProbe.editLabel === '설정 편집');
  check('[설정 편집]이 「상세 패널 — 설정 편집」 폼을 연다',
    settingsProbe.formCaption === '상세 패널 — 설정 편집');
  check('실시간 소스 폼은 Paper의 8필드 그대로다',
    JSON.stringify(settingsProbe.fieldLabels) === JSON.stringify(
      ['조건 비교', '조건 값', '연속 틱', '쿨다운(초)', '만료(일)', '설명', '브리핑 모델', '노력']));
  check('종목·모드·소스는 읽기 전용이고 소스에 「변경 불가」가 붙는다',
    JSON.stringify(settingsProbe.readonlyLabels) === JSON.stringify(['종목', '모드', '소스', '생성'])
    && settingsProbe.tag === '변경 불가');
  check('연속 틱·만료 안내가 Paper 문구 그대로다',
    settingsProbe.hints.includes('1~20 · 실시간 소스만')
    && settingsProbe.hints.includes('만료 2026-09-10 · 미변경 시 보존'));
  check('버튼 행은 [저장]과 「채팅에서 고치기 ↗」 둘이다',
    settingsProbe.saveLabel === '저장' && settingsProbe.chatLabel === '채팅에서 고치기 ↗');
  check('채팅 버튼은 시트가 아니라 채팅 입력에 문장을 심는다',
    settingsProbe.seeded === '"삼성전자 88,000 감시" 루틴을 고치고 싶어요 — ');
  check('[저장]은 만료를 안 실어 보낸다 — 미변경 시 보존',
    updateBodies.length === 1 && !('expires_days' in updateBodies[0])
    && updateBodies[0].cooldown_s === 600);
  check('저장 본문은 조건 술어도 함께 싣는다',
    JSON.stringify(updateBodies[0].condition) === JSON.stringify({ op: '>=', value: 88000, consecutive_ticks: 1 }));
  check('저장이 끝나면 폼이 닫히고 요약이 저장한 값으로 갱신된다',
    settingsProbe.formGone === true && /쿨다운 600초/.test(settingsProbe.summaryAfterSave));
  check('"이력"으로 되돌리면 이력 본문이 다시 보인다', settingsProbe.historyBackVisible === true);
  check('드릴인을 닫으면 세그먼트도 함께 숨는다', settingsProbe.segHiddenAfterBack === true);

  // ---------- (7) 코드 알람 — 보드 09~12 ----------
  await shellWin.webContents.executeJavaScript("window.AthenaAgentCanvas.selectRow('fx3')");
  await wait(500); // 상세 1회 조회 왕복

  const codeProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    const detail = c.querySelector('.agent-detail-col');
    const cards = Array.from(detail.querySelectorAll('.agent-node-card'));
    const row = Array.from(c.querySelectorAll('.agent-row')).find((n) => n.textContent.includes('거래량 급증 감시'));
    return {
      rowSub: row ? row.querySelector('.agent-row-sub').textContent : null,
      rowDot: row ? row.querySelector('.agent-row-dot').textContent : null,
      kindLabel: (detail.querySelector('.agent-code-kind') || {}).textContent,
      cardCount: cards.length,
      cardTitles: cards.map((n) => (n.querySelector('.agent-node-title') || {}).textContent),
      cardFns: cards.map((n) => (n.querySelector('.agent-node-fn') || {}).textContent),
      ioLabels: cards.map((n) => Array.from(n.querySelectorAll('.agent-node-io-label')).map((x) => x.textContent)),
      inCounts: cards.map((n) => n.querySelectorAll('.agent-node-in').length),
      outputs: cards.map((n) => (n.querySelector('.agent-node-out') || {}).textContent),
      changed: cards.map((n) => Array.from(n.querySelectorAll('.agent-node-badge')).map((x) => x.textContent)),
      unused: cards.map((n) => Array.from(n.querySelectorAll('.agent-node-unused')).map((x) => x.textContent)),
      codeToggle: (detail.querySelector('.agent-code-source-toggle') || {}).textContent,
      codePathShown: !!detail.querySelector('.agent-code-source-path'),
      historyOpen: (detail.querySelector('.agent-history-open') || {}).textContent,
      inputCount: detail.querySelectorAll('input, select, textarea').length,
      fieldPairs: Array.from(detail.querySelectorAll('.agent-detail-field')).map((r) => [
        r.querySelector('.agent-detail-field-label').textContent,
        r.querySelector('.agent-detail-field-value').textContent,
      ]),
      firesCaption: (detail.querySelector('.agent-panel-caption-row .agent-panel-caption') || {}).textContent,
      fireOpens: Array.from(detail.querySelectorAll('.agent-code-fire-open')).map((n) => n.textContent),
      fireNoDoors: Array.from(detail.querySelectorAll('.agent-code-fire-nodoor')).map((n) => n.textContent),
      hasEdit: detail.textContent.includes('고치기 — 말로'),
      hasTodayCaption: Array.from(detail.querySelectorAll('.agent-panel-caption')).some((n) => n.textContent.startsWith('오늘 확인')),
    };
  })()`);

  check('목록 행이 「코드 감시 · 장중 1분마다」로 갈린다 — 보드 12(「주기 확인」 폴백 금지)',
    codeProbe.rowSub === '코드 감시 · 장중 1분마다');
  check('코드 감시 행 아이콘은 ◆다 — 보드 12 범례', codeProbe.rowDot === '◆');
  check('상세 머리에 「코드 감시 · v해시」가 있다 — 보드 12', codeProbe.kindLabel === '코드 감시 · vab12cd');
  check('노드 카드가 함수 수만큼(4칸) 그려진다 — 보드 10·11', codeProbe.cardCount === 4);
  check('칸마다 한국어 제목과 영어 함수명이 함께 있다 — R7',
    JSON.stringify(codeProbe.cardTitles) === JSON.stringify(['일봉 불러오기', '5일 거래량 평균', '배수 비교', '알림'])
    && JSON.stringify(codeProbe.cardFns) === JSON.stringify(['load_bars', 'avg_volume', 'volume_ratio', 'fire']));
  check('칸마다 「들어감」 행과 「나옴」 값이 있다 — R7',
    codeProbe.ioLabels.every((l) => JSON.stringify(l) === JSON.stringify(['들어감', '나옴']))
    && codeProbe.inCounts.every((n) => n >= 1)
    && codeProbe.outputs.every((v) => !!v));
  check('숫자는 자릿수를 끊고 값이 없으면 「—」로 남는다',
    codeProbe.outputs[1] === '13,000,000' && codeProbe.outputs[3] === '—');
  check('「방금 바뀜」은 바뀐 칸에만 붙는다 — 보드 11',
    JSON.stringify(codeProbe.changed) === JSON.stringify([[], ['방금 바뀜'], [], []]));
  check('안 불린 칸은 「이번엔 안 쓰임」으로 남는다 — A-5',
    JSON.stringify(codeProbe.unused) === JSON.stringify([[], [], [], ['이번엔 안 쓰임']]));
  check('오늘 확인 패널 머리가 있다 — 보드 12', codeProbe.hasTodayCaption === true);
  check('코드는 접혀 있고 라벨이 「코드 · 참고 · 펼치기」다 — R7',
    codeProbe.codeToggle === '코드 · 참고 · 펼치기' && codeProbe.codePathShown === false);
  check('「울린 기록 · 최근」과 「전체 이력 보기 →」가 있다 — 보드 12',
    codeProbe.firesCaption === '울린 기록 · 최근' && codeProbe.historyOpen === '전체 이력 보기 →');
  check('울린 줄에만 「채팅에서 열기 ↗」가 있다 — 보드 12(억제된 줄은 「—」)',
    codeProbe.fireOpens.length === 2 && codeProbe.fireOpens.every((t) => t === '채팅에서 열기 ↗')
    && codeProbe.fireNoDoors.length === 1);
  check('설정 요약에 확인 주기·쿨다운·만료·데이터가 있고 쿨다운은 한국어 단위다',
    JSON.stringify(codeProbe.fieldPairs)
      === JSON.stringify([['확인 주기', '장중 1분'], ['쿨다운', '1일'], ['만료', '2026-10-03'], ['데이터', '일봉 + 오늘 현재가']]));
  check('코드 알람 상세에 조건 편집 폼이 없다 — A-5', codeProbe.inputCount === 0);

  // 칸 고르기 → 칩 2개(보드 11) → 채팅으로 넘어가는 문장
  const nodeChipProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    const pick = Array.from(c.querySelectorAll('.agent-node-card')).find((n) => n.textContent.includes('배수 비교'));
    pick.click();
    const detail = c.querySelector('.agent-detail-col');
    const selected = Array.from(detail.querySelectorAll('.agent-node-card')).filter((n) => n.className.includes('is-selected'));
    const chips = Array.from(detail.querySelectorAll('.agent-node-chip'));
    let seeded = null;
    const prevSeed = window.AthenaShell.seedChatInput;
    window.AthenaShell.seedChatInput = (t) => { seeded = t; };
    chips[0].click();
    window.AthenaShell.seedChatInput = prevSeed;
    return {
      selectedCount: selected.length,
      selectedTitle: selected.length ? selected[0].querySelector('.agent-node-title').textContent : null,
      selectedBorder: selected.length ? selected[0].style.border : '',
      chipLabels: chips.map((n) => n.textContent),
      seeded,
    };
  })()`);

  check('칸을 고르면 그 칸만 진한 테두리를 받는다 — 보드 11',
    nodeChipProbe.selectedCount === 1 && nodeChipProbe.selectedTitle === '배수 비교'
    && !!nodeChipProbe.selectedBorder);
  check('고른 칸에 「이상해요」·「물어볼게요」 칩이 붙는다 — R7',
    JSON.stringify(nodeChipProbe.chipLabels) === JSON.stringify(['이상해요', '물어볼게요']));
  check('그 칩이 시트가 아니라 채팅 입력에 그 칸을 지목한 문장을 심는다',
    nodeChipProbe.seeded === '"거래량 급증 감시 · 삼성전자" 알람의 「배수 비교」 칸이 이상해 — ');

  // 「고치기 — 말로」 — 켜진 알람은 먼저 멈춤을 묻는다(A-12·R10)
  const editGateProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    c.querySelector('.agent-code-edit').click();
    const detail = c.querySelector('.agent-detail-col');
    const chips = Array.from(detail.querySelectorAll('.agent-code-edit-chip'));
    window.__probeSeeded = null;
    window.__probePrevSeed = window.AthenaShell.seedChatInput;
    window.AthenaShell.seedChatInput = (t) => { window.__probeSeeded = t; };
    const out = {
      chipLabels: chips.map((n) => n.textContent),
      mentions409: detail.textContent.includes('409'),
    };
    chips[0].click();
    return out;
  })()`);
  await wait(400); // 멈춤 왕복 + refresh

  const editDoneProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    window.AthenaShell.seedChatInput = window.__probePrevSeed;
    return {
      seeded: window.__probeSeeded,
      confirmGone: c.querySelectorAll('.agent-code-edit-chip').length === 0,
    };
  })()`);

  check('켜진 알람의 「고치기 — 말로」는 먼저 멈춤을 묻는다 — A-12',
    JSON.stringify(editGateProbe.chipLabels) === JSON.stringify(['일시중지하고 고치기', '그대로 두기']));
  check('거절 사유(코드 번호)는 화면에 옮기지 않는다 — R10', editGateProbe.mentions409 === false);
  check('「일시중지하고 고치기」가 멈춤 뒤 채팅으로 넘긴다',
    editDoneProbe.seeded === '"거래량 급증 감시 · 삼성전자" 알람을 말로 고치고 싶어 — '
    && editDoneProbe.confirmGone === true);

  // 초안(보드 09·10) — 검사 요약과 「검사」
  await shellWin.webContents.executeJavaScript("window.AthenaAgentCanvas.selectRow('fx4')");
  await wait(500);
  const draftProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const detail = document.getElementById('agentCanvas').querySelector('.agent-detail-col');
    return {
      badge: (detail.querySelector('.agent-status-badge') || {}).textContent,
      summary: (detail.querySelector('.agent-code-check-summary') || {}).textContent,
      countedUntil: (detail.querySelector('.agent-code-counted-until') || {}).textContent,
      checkLabel: (detail.querySelector('.agent-code-check-btn') || {}).textContent,
      cardCount: detail.querySelectorAll('.agent-node-card').length,
      firesShown: !!detail.querySelector('.agent-code-fires'),
      approvalDisabled: detail.querySelector('.agent-code-approve-btn').disabled,
      blocker: (detail.querySelector('.agent-code-approve-blocker') || {}).textContent,
      repairLabel: (detail.querySelector('.agent-code-repair-btn') || {}).textContent,
    };
  })()`);

  check('코드 알람 초안은 「초안」 배지와 검사 요약을 낸다 — 보드 10',
    draftProbe.badge === '초안' && draftProbe.summary === '4번 울림');
  check('초안 상세의 검사 기준일이 실제 검사 응답과 일치한다',
    draftProbe.countedUntil === '2026-09-02');
  check('초안에 「검사」 버튼이 있고 검사 결과의 칸을 그대로 보여준다',
    draftProbe.checkLabel === '검사' && draftProbe.cardCount === 4);
  check('울린 적 없는 초안에 울린 기록을 지어내지 않는다', draftProbe.firesShown === false);
  check('검사 이력이 있어도 파일이 사라진 초안의 승인을 막고 복구 버튼을 낸다',
    draftProbe.approvalDisabled === true
    && draftProbe.blocker === '지금은 켤 수 없음: 감시 코드 파일 없음 — 다시 만들기'
    && draftProbe.repairLabel === '다시 만들기');
  shellWin.showInactive();
  await shellWin.webContents.executeJavaScript("document.querySelector('.agent-code-approve-btn').scrollIntoView({ block: 'center' })");
  await wait(350);
  const blockedDraftImage = await shellWin.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'agent-watch-blocked-approval.png'), blockedDraftImage.toPNG());
  const repairProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const original = window.AthenaShell.seedChatInput;
    let text = '';
    try {
      window.AthenaShell.seedChatInput = (value) => { text = value; };
      document.querySelector('.agent-code-repair-btn').click();
    } finally {
      window.AthenaShell.seedChatInput = original;
    }
    return { text, agentVisible: !document.getElementById('agentCanvas').hidden };
  })()`);
  check('복구 클릭은 오류와 대상 파일을 보존한 에이전트 입력을 준비한다',
    repairProbe.agentVisible && repairProbe.text.includes('fx4')
    && repairProbe.text.includes('감시 코드 파일 없음')
    && repairProbe.text.includes('watch/volume_spike.py')
    && repairProbe.text.includes('기존 조건과 설정은 바꾸지 말고'));

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

  ipcMain.removeHandler('athena:routines-list');
  ipcMain.handle('athena:routines-list', async () => ({ ok: false, error: '조회 실패' }));
  await shellWin.webContents.executeJavaScript("window.AthenaAgentCanvas.setActiveView('tasks'); window.AthenaAgentCanvas.refresh()");
  const unavailableProbe = await shellWin.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('agentCanvas');
    return {
      statsText: Array.from(c.querySelectorAll('.agent-stat-card')).map((n) => n.textContent).join(' '),
      rowCount: c.querySelectorAll('.agent-row').length,
    };
  })()`);
  check('실제 IPC 조회 실패도 감시 0건으로 표시하지 않고 마지막 목록을 보존한다',
    unavailableProbe.statsText.includes('확인할 수 없음')
    && !unavailableProbe.statsText.includes('활성 감시가 없습니다')
    && unavailableProbe.rowCount > 0);

  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);
  check('렌더러 콘솔 에러가 없다', consoleErrors.length === 0);

  const ok = failures.length === 0;
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-agent-paper-parity.json'),
    JSON.stringify({
      tasksProbe, alarmProbe, drillProbe, settingsProbe,
      codeProbe, nodeChipProbe, editGateProbe, editDoneProbe, draftProbe,
      proactiveProbe, repairProbe, unavailableProbe, consoleErrors, failures, ok,
    }, null, 1),
  );
  console.log(`[probe] 단언 실패 ${failures.length}건`);
  for (const f of failures) console.log('  -', f);
  console.log('[probe] 최종 판정:', ok);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
