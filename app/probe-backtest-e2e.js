// 백테스트 종단 프로브 — **실백엔드를 띄운 상태에서** 실앱 UI로 한 바퀴 돈다.
//
// probe-backtest-mode.js는 백엔드가 없을 때의 정직한 실패만 본다. 이 프로브는 그 반대편 —
// 백엔드가 있을 때 사람이 실제로 하는 동작(전략 고르기 → 종목·기간 채우기 → 실행 →
// 결과 읽기 → 최적화 → 배포 화면)이 진짜 DOM에서 성립하는지를 잰다. 단위 테스트는
// 가짜 deps 위라 IPC 왕복·yaml 직렬화·백엔드 계약 불일치를 못 잡는다.
//
// 준비(프로브가 하지 않는다 — 자격증명과 데이터는 사람이 준비한다):
//   1) 캔들이 시드된 sqlite를 가리키도록 ATHENA_BACKTEST_DB_PATH 설정
//   2) ATHENA_BACKTEST_ENABLED=true 로 백엔드 기동(127.0.0.1:8010)
//   3) npx electron probe-backtest-e2e.js
//
// 종목·기간은 환경변수로 바꾼다(기본은 시드 스크립트와 같은 값):
//   ATHENA_PROBE_STK=005930 ATHENA_PROBE_FROM=20240102 ATHENA_PROBE_TO=20250204

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-bt-e2e-'));
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const STK = process.env.ATHENA_PROBE_STK || '005930';
const FROM = process.env.ATHENA_PROBE_FROM || '20240102';
const TO = process.env.ATHENA_PROBE_TO || '20250204';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-backtest-e2e] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

function js(win, source) {
  return win.webContents.executeJavaScript(source);
}

// 조건이 참이 될 때까지 기다린다 — 고정 sleep은 느린 기계에서 깨지고 빠른 기계에서 낭비다.
async function until(win, source, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  let last = null;
  while (Date.now() < deadline) {
    last = await js(win, source);
    if (last) return last;
    await wait(250);
  }
  return last;
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  await wait(1800);

  // ---------- (1) 백테스트 모드 진입 → 프리셋이 실제로 온다 ----------
  await js(shellWin, "document.getElementById('modeNavBacktest').click(); true");
  const presets = await until(
    shellWin,
    "(() => { const n = document.querySelectorAll('#backtestCanvas .backtest-preset-item').length;"
    + ' return n > 0 ? n : null; })()',
    20000,
  );
  record('01-프리셋 목록이 백엔드에서 온다', presets === 10, { presets });

  // ---------- (2) 설계 폼이 Paper 보드 01의 네 덩어리를 다 그린다 ----------
  const form = await js(shellWin, `(() => {
    const q = (s) => document.querySelectorAll('#backtestCanvas ' + s).length;
    return {
      indicators: q('.backtest-indicator-row'),
      sliders: q('.backtest-param-slider'),
      conditionCards: q('.backtest-condition-card'),
      conditions: q('.backtest-condition'),
      risk: !!document.querySelector('#backtestCanvas .backtest-field-pct'),
      assumptions: q('.backtest-assumptions'),
      tabs: q('.backtest-tab'),
    };
  })()`);
  record(
    '02-설계 폼 네 덩어리(지표·조건·리스크·가정)',
    form.indicators >= 2 && form.sliders >= 2 && form.conditionCards === 2
      && form.conditions >= 2 && form.risk && form.assumptions === 1 && form.tabs === 5,
    form,
  );

  // ---------- (3) 종목·기간을 채우고 실행 ----------
  const filled = await js(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const sym = root.querySelector('.backtest-symbol-add');
    sym.value = ${JSON.stringify(STK)};
    sym.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const dates = Array.from(root.querySelectorAll('.backtest-field-input'))
      .filter((i) => i.placeholder === 'YYYYMMDD');
    if (dates.length < 2) return { ok: false, dates: dates.length };
    dates[0].value = ${JSON.stringify(FROM)};
    dates[0].dispatchEvent(new Event('input', { bubbles: true }));
    dates[1].value = ${JSON.stringify(TO)};
    dates[1].dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, chips: root.querySelectorAll('.backtest-symbol-chip').length };
  })()`);
  record('03-종목 칩 추가 + 기간 입력', filled.ok === true && filled.chips === 1, filled);

  await js(shellWin, "document.querySelector('#backtestCanvas .backtest-run-button').click(); true");

  // ---------- (4) 결과가 실제로 렌더된다 ----------
  const result = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const tiles = root.querySelectorAll('.backtest-metric-tile');
    if (!tiles.length) return null;
    const values = Array.from(tiles).map((t) => {
      const v = t.querySelector('.backtest-metric-value');
      const s = t.querySelector('.backtest-metric-sub');
      return { value: v ? v.textContent : null, sub: s ? s.textContent : '' };
    });
    return {
      tiles: tiles.length,
      values,
      equitySvg: root.querySelectorAll('.backtest-equity-svg').length,
      strategyPath: root.querySelectorAll('.backtest-equity-strategy').length,
      markers: root.querySelectorAll('.backtest-equity-marker').length,
      tradeRows: root.querySelectorAll('.backtest-trades-row').length,
      assumptions: root.querySelectorAll('.backtest-assumptions').length,
      stdout: root.querySelectorAll('.backtest-stdout-text').length,
    };
  })()`, 40000);
  const ok4 = !!result && result.tiles === 6 && result.equitySvg === 1
    && result.strategyPath === 1 && result.tradeRows > 1
    && result.assumptions === 1 && result.stdout === 1
    && result.values.every((v) => v.value && v.value !== '—');
  record('04-결과: 타일 6장·자산곡선·체결 표·가정', ok4, result);

  // 타일 부제가 실제 숫자로 채워졌는지 — "지어내지 않는다"의 반대편(비어 있지도 않다).
  const subs = result ? result.values.map((v) => v.sub).filter(Boolean) : [];
  record('05-타일 부제가 백엔드 값으로 채워진다', subs.length >= 5, { subs });

  // ---------- (6) 결과 → 설계로 돌아갈 수 있다(갇히지 않는다) ----------
  const backToDesign = await js(shellWin, `(() => {
    const tabs = document.querySelectorAll('#backtestCanvas .backtest-tab');
    tabs[0].click();
    return document.querySelectorAll('#backtestCanvas .backtest-preset-item').length;
  })()`);
  record('06-결과에서 설계로 복귀', backToDesign === 10, { presets: backToDesign });

  // ---------- (7) 최적화 탭 — 실제로 조합을 훑는다 ----------
  await js(shellWin, `(() => {
    const tabs = document.querySelectorAll('#backtestCanvas .backtest-tab');
    tabs[3].click();
    return true;
  })()`);
  await wait(300);
  await js(shellWin, `(() => {
    const btn = document.querySelector('#backtestCanvas .backtest-optimize-start');
    if (btn) btn.click();
    return !!btn;
  })()`);
  const optimize = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const best = root.querySelector('.backtest-optimize-best-title');
    if (!best) return null;
    return {
      best: best.textContent,
      params: (root.querySelector('.backtest-optimize-best-params') || {}).textContent || '',
      cells: root.querySelectorAll('.backtest-heatmap-cell').length,
      warnings: root.querySelectorAll('.backtest-optimize-warn').length,
    };
  })()`, 60000);
  record(
    '07-최적화: 최고 조합과 히트맵',
    !!optimize && optimize.cells > 0 && /Sharpe/.test(optimize.best),
    optimize,
  );

  // ---------- (8) 배포 탭 — 저장된 버전이 없으면 정직하게 막는다 ----------
  await js(shellWin, `(() => {
    document.querySelectorAll('#backtestCanvas .backtest-tab')[4].click();
    return true;
  })()`);
  const deploy = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const text = root.textContent || '';
    return text.includes('전략 배포') ? { text: text.slice(0, 160) } : null;
  })()`, 15000);
  record(
    '08-배포 화면: 저장 전에는 배포할 수 없다고 말한다',
    !!deploy && deploy.text.includes('저장'),
    deploy,
  );

  // ---------- (9) 채팅 액션이 폼에 **바로** 반영되고, 채팅에 변경 내역이 남는다 ----------
  // 5단계 계약: 캔버스 초안 카드는 없어졌다. 액션이 오면 폼이 즉시 바뀌고, 무엇이 바뀌었는지와
  // [되돌리기]는 채팅 카드에 남는다. 여기서는 그 두 쪽이 같은 한 번의 send로 함께 움직이는지를 본다.
  const fastBefore = await js(shellWin, `(() => {
    document.querySelectorAll('#backtestCanvas .backtest-tab')[0].click();
    const s = document.querySelector('#backtestCanvas .backtest-param-slider[aria-label="fast 값"]');
    return s ? s.value : null;
  })()`);
  shellWin.webContents.send('athena:backtest-chat-action', {
    kind: 'spec_draft', patch: { params: { fast: 10 } }, note: '테스트', suggest_run: false,
  });
  const chatApplied = await until(shellWin, `(() => {
    const s = document.querySelector('#backtestCanvas .backtest-param-slider[aria-label="fast 값"]');
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!s || !cards.length) return null;
    if (s.value !== '10') return null;
    const card = cards[cards.length - 1];
    return {
      fast: s.value,
      head: card.textContent.includes('설정 반영'),
      applied: card.textContent.includes('반영됨'),
      rows: Array.from(card.querySelectorAll('.backtest-change-row')).map((r) => r.textContent),
    };
  })()`, 10000);
  record(
    '09-채팅 설정 액션이 폼에 바로 반영되고 채팅에 변경 내역이 남는다',
    !!chatApplied && chatApplied.fast === '10' && chatApplied.head === true
      && chatApplied.applied === true && chatApplied.rows.some((t) => t.includes('fast')),
    { fastBefore, card: chatApplied },
  );

  // ---------- (10) 그 카드의 [되돌리기]가 실제로 폼을 되돌린다 ----------
  const undoClicked = await js(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!cards.length) return { ok: false, reason: 'no-card' };
    const card = cards[cards.length - 1];
    const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '되돌리기');
    if (!btn) return { ok: false, reason: 'no-undo-button' };
    btn.click();
    return { ok: true };
  })()`);
  const undone = await until(shellWin, `(() => {
    const s = document.querySelector('#backtestCanvas .backtest-param-slider[aria-label="fast 값"]');
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!s || !cards.length) return null;
    const card = cards[cards.length - 1];
    if (!card.textContent.includes('되돌렸습니다')) return null;
    return { fast: s.value };
  })()`, 10000);
  record(
    '10-[되돌리기]로 원래 값으로 돌아간다',
    undoClicked.ok === true && !!undone && undone.fast === fastBefore,
    { undoClicked, undone, fastBefore },
  );

  // ---------- (11) 코드 액션이 편집기에 바로 들어가고, 카드의 [검증]이 백엔드를 부른다 ----------
  shellWin.webContents.send('athena:backtest-chat-action', {
    kind: 'code_draft',
    source: 'PARAMS = {}\n\ndef signals(df, p):\n    return df.assign(entry=False, exit=False)[["entry", "exit"]]\n',
    note: '코드',
    suggest_run: false,
    suggest_validate: true,
  });
  const codeApplied = await until(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const sub = root.querySelector('.backtest-subtab.is-on');
    const ta = root.querySelector('.backtest-code-host .backtest-code-textarea');
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!sub || !ta || !cards.length) return null;
    if (!ta.value.includes('def signals')) return null;
    const card = cards[cards.length - 1];
    const validate = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '검증');
    if (!validate) return null;
    return {
      subtab: sub.textContent,
      head: card.textContent.includes('코드 반영'),
      code: ta.value.slice(0, 40),
    };
  })()`, 10000);
  record(
    '11-코드 액션이 편집기에 바로 들어간다',
    !!codeApplied && codeApplied.subtab === '코드' && codeApplied.head === true,
    codeApplied,
  );

  await js(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-change');
    const card = cards[cards.length - 1];
    const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '검증');
    if (btn) btn.click();
    return !!btn;
  })()`);
  const validated = await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!cards.length) return null;
    const card = cards[cards.length - 1];
    const text = card.textContent || '';
    if (text.includes('검증 통과')) return { pass: true, text: '검증 통과' };
    if (text.includes('검증 실패')) {
      const errs = Array.from(card.querySelectorAll('.backtest-change-error')).map((e) => e.textContent);
      return { pass: false, errors: errs };
    }
    return null;
  })()`, 30000);
  record('11b-카드의 [검증]이 백엔드 검증을 돌린다', !!validated && validated.pass === true, validated);

  // ---------- (12) 화면 전환 액션 ----------
  shellWin.webContents.send('athena:backtest-chat-action', {
    kind: 'navigate', tab: 'history', designTab: null,
  });
  const navigated = await until(shellWin, `(() => {
    const on = document.querySelector('#backtestCanvas .backtest-tab.is-on');
    return on && on.textContent === '이력' ? { tab: on.textContent } : null;
  })()`, 15000);
  record('12-채팅 화면 전환 액션이 이력 탭을 연다', !!navigated, navigated);

  const okAll = report.steps.every((s) => s.ok);
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'backtest-e2e-probe.json'),
    JSON.stringify(report, null, 1),
  );
  console.log(
    `[probe-backtest-e2e] ${okAll ? 'ALL OK' : 'FAIL'} `
    + `(${report.steps.filter((s) => s.ok).length}/${report.steps.length})`,
  );
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 다음 실행은 새 디렉터리다 */ }
  app.exit(okAll ? 0 : 1);
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe-backtest-e2e] 프로브 자체 오류:', err);
  app.exit(1);
}));
