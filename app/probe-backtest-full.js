// 백테스트 전수 프로브 — **실백엔드 + 실앱 UI**로 백테스트 기능 전체를 한 바퀴 돈다.
//
// 기존 세 프로브가 남긴 구멍을 메운다:
//   - probe-backtest-mode.js   : 백엔드 없이 5중 배타와 정직한 실패만 본다(5스텝)
//   - probe-backtest-e2e.js    : 행복 경로 한 줄기만 본다(13스텝)
//   - probe-backtest-chat-scenario.js : 실모델 대화 — 모델 흔들림이 곧 실패다(12스텝)
// 이 프로브는 모델을 루프에서 빼고, 사람이 누를 수 있는 표면과 IPC 계약을 전수로 잰다.
// 채팅 액션은 webContents.send로 직접 넣어 결정적으로 만든다.
//
// 준비(프로브가 하지 않는다 — 자격증명과 데이터는 사람이 준비한다):
//   1) 캔들이 시드된 백테스트 sqlite (ATHENA_BACKTEST_DB_PATH)
//   2) ATHENA_BACKTEST_ENABLED=true 로 백엔드 기동(127.0.0.1:8010)
//   3) 그 sqlite에 005930 일봉이 캐시돼 있어야 한다 — 없으면 00 단계에서 멈춘다
//   4) npx electron probe-backtest-full.js
//
// 환경변수:
//   ATHENA_PROBE_STK       종목(기본 005930)
//   ATHENA_PROBE_FROM/TO   실행 구간. 기본은 00 단계에서 GET /data/coverage를 읽어
//                          캐시 안쪽(마지막 봉 기준 3년)으로 잡는다 — 고정 날짜를 박으면
//                          커버리지가 바뀐 기계에서 모든 실행이 409가 된다.
//                          커버리지를 못 읽으면 20240401~20260801로 떨어진다.
//   ATHENA_PROBE_SECTIONS  돌릴 섹션만 골라 돈다(예: 'A,B,C') — 고치는 루프용
//
// 섹션:
//   A 부팅·모드 · B 설계 폼 · C 데이터 계획·승인 · D 실행·결과(폼) · E 코드 경로
//   F 오류·진단 · G 흐름 지도 · H 이력·비교 · I 최적화 · J 배포 · K 채팅 액션 · L 컨텍스트
//   M 출처→전략→등록→배포(바깥 자료 → 내 폴더의 파이썬 → 프리셋 자리 → 실전)
//   N 흐름 지도가 첫 표면(보드 11~14 — 대화로 지도를 고치고, 코드는 그 뒤에 있다)
//   O 시각 설계 왕복(보드 11→12→13→14 — 지도가 편집 표면, 오류는 질문 하나로, 적용은 비활성 버전 하나)
//   P 새 기법 만들기(보드 20·21 — 코드창·명령창·노드·흐름 창)
//   Q 기법 폴더 한 바퀴(보드 19~23 — 폴더·자동 수락·단계 카드·자동 백테스트·승인)
//
// 만드는 것은 되돌린다: 배포는 전부 중지하고, M·P·Q가 만든 등록·프로젝트는 등록에서 뺀다.
// 전략·버전·실행 행은 백엔드에 삭제 API가 없어(store에 delete가 없다) 남고, 그 세 섹션이
// 만든 폴더와 .py는 사용자 디스크의 물건이라 일부러 남긴다 — 보고서에 그 사실을 남긴다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-bt-full-'));
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const BACKEND = process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010';
const STK = process.env.ATHENA_PROBE_STK || '005930';
const ENV_FROM = process.env.ATHENA_PROBE_FROM || '';
const ENV_TO = process.env.ATHENA_PROBE_TO || '';
// 환경변수도 없고 커버리지도 못 읽었을 때의 최후 기본값(캐시된 범위에 맞춘 값).
const FALLBACK_FROM = '20240401';
const FALLBACK_TO = '20260801';

// 캐시 밖 구간 — TR을 태우지 않는다(계획만 계산된다). 승인 화면·부분 실행·422를 여기서 낸다.
const UNCACHED_FROM = '19900103';   // 캐시보다 앞 → 부분 겹침(보유 구간만 실행이 성립)
const EMPTY_FROM = '19900101';      // 캐시와 전혀 안 겹침 → allow_partial이 422
const EMPTY_TO = '19901231';

const ALL_SECTIONS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
  // 새 기법 만들기(보드 20·21, 2026-09-03) — 코드창·명령창·노드·흐름 창.
  'P',
  // 기법 폴더 한 바퀴(보드 19~23, 2026-09-03) — 폴더·자동 수락·단계 카드·자동 백테스트·승인.
  'Q',
];
const WANTED = new Set(
  (process.env.ATHENA_PROBE_SECTIONS || ALL_SECTIONS.join(','))
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
);
const on = (id) => WANTED.has(id);

// 실행 구간은 00 단계에서 커버리지를 보고 정한다(환경변수가 있으면 그것이 이긴다).
let FROM = ENV_FROM;
let TO = ENV_TO;

const R = '#backtestCanvas ';

const WAIT_UI = 10000;
const WAIT_PRESETS = 25000;
const WAIT_RUN = 90000;
const WAIT_VALIDATE = 30000;
const WAIT_OPTIMIZE = 180000;
// 가상환경 만들기는 `python -m venv` + `pip install pandas numpy`다 — 인덱스와 디스크
// 사정에 따라 분 단위로 갈린다. 이 예산 안에 안 끝나면 실패가 아니라 SKIP이다.
const WAIT_ENV = 240000;

// pip이 바깥 인덱스에 닿지 못한 실패는 제품 결함이 아니다 — 그 경우만 SKIP으로 가른다.
const OFFLINE_PIP = new RegExp([
  'Could not find a version', 'No matching distribution', 'Failed to establish a new connection',
  'Temporary failure in name resolution', 'Network is unreachable', 'getaddrinfo',
  'ProxyError', 'ReadTimeoutError', 'SSLError',
].join('|'), 'i');

// ---------- 리포트 ----------

const report = {
  startedAt: new Date().toISOString(), finishedAt: null, steps: [], summary: null, fatal: null,
};

// 한 번 죽으면 155개 검사의 결과를 통째로 잃는다 — 조기 종료 사유와 치명상은 값으로 들고 다니다가
// finish()의 finally에서 리포트에 함께 적는다.
const outcome = { abortReason: null, fatal: null, finished: false };

// 전제(백엔드·캐시)가 없어 나머지를 돌리지 않는 경우 — 치명상이 아니라 조기 종료다.
class PreconditionAbort extends Error {}

function record(id, name, ok, data) {
  report.steps.push({ id, name, ok: !!ok, data: data === undefined ? null : data });
  console.log(`[probe-backtest-full] ${ok ? 'OK  ' : 'FAIL'} — ${id} ${name}: ${safeJson(data)}`);
}

function skip(id, name, reason) {
  report.steps.push({ id, name, ok: true, skipped: true, data: { reason } });
  console.log(`[probe-backtest-full] SKIP — ${id} ${name}: ${reason}`);
}

// 검사 하나가 프로브 전체를 죽이지 못하게 감싼다 — fn이 던지면 그 검사만 FAIL로 남기고 다음으로 간다.
// fn은 { ok, data }를 돌려주고, 이 실행에 해당하지 않으면 { skip: '이유' }를 돌려준다.
// (분기마다 이름이 다른 검사는 { skip, name }으로 그 이름을 그대로 쓴다.)
async function step(id, name, fn) {
  try {
    const out = await fn();
    if (out && out.skip) { skip(id, out.name || name, out.skip); return out; }
    record(id, name, out && out.ok, out ? out.data : null);
    return out;
  } catch (err) {
    record(id, name, false, { error: String((err && err.message) || err) });
    return null;
  }
}

// 섹션 하나가 도중에 끊겨도 나머지 섹션은 돈다 — 끊긴 사실은 합성 FAIL 한 줄로 남긴다.
async function section(id, fn) {
  try {
    await fn();
  } catch (err) {
    record(`${id}-SECTION`, `${id} 섹션이 도중에 끊겼다`, false, {
      error: String((err && err.message) || err),
    });
  }
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text && text.length > 600 ? `${text.slice(0, 600)}…` : String(text);
  } catch { return '<직렬화 불가>'; }
}

// ---------- 렌더러 구동 헬퍼 ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 렌더러 호출 하나가 영영 안 돌아오는 경우를 막는다 — 무한 대기는 리포트를 통째로 잃는 길이다.
const WAIT_JS = 15000;

function withTimeout(promise, ms, label) {
  let timer = null;
  const capped = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __probeError: `${label} 시간 초과(${ms}ms)` }), ms);
  });
  return Promise.race([promise, capped]).finally(() => clearTimeout(timer));
}

// 렌더러에서 던진 예외를 값으로 바꿔 돌려준다 — 셀렉터 하나가 없다고 프로브 전체가
// 죽으면 나머지 150개 검사의 결과를 못 본다. `source`는 **식 하나**여야 한다.
// executeJavaScript 자체가 거절하는 경우("Script failed to execute…")도 같은 규칙으로 값이 된다.
function js(win, source) {
  if (!win || win.isDestroyed()) return Promise.resolve({ __probeError: '창이 이미 닫혔다' });
  const run = win.webContents.executeJavaScript(
    `(() => { try { return (\n${source}\n); } catch (e) {`
    + ' return { __probeError: String((e && e.message) || e) }; } })()',
  ).catch((err) => ({ __probeError: `executeJavaScript 실패: ${String((err && err.message) || err)}` }));
  return withTimeout(run, WAIT_JS, 'executeJavaScript');
}

// 조건이 참이 될 때까지 기다린다 — 고정 sleep은 느린 기계에서 깨지고 빠른 기계에서 낭비다.
// 렌더러 예외는 "아직 아님"으로 보고 계속 기다리되, 시간이 다하면 그 예외를 그대로 돌려준다.
// 마감이 있는 루프다 — 어떤 경우에도 timeoutMs(기본 WAIT_UI) 안에 돌아온다.
async function until(win, source, timeoutMs) {
  const budget = timeoutMs || WAIT_UI;
  const deadline = Date.now() + budget;
  let last = null;
  while (Date.now() < deadline) {
    last = await js(win, source);
    if (last && last.__probeError) { await wait(250); continue; }
    if (last) return last;
    await wait(250);
  }
  // 시간이 다했다는 사실 자체가 진단이다 — 반환값 계약(null 또는 마지막 예외)은 그대로 두고 로그로 남긴다.
  console.log(
    `[probe-backtest-full] WAIT — ${budget}ms 안에 조건이 참이 되지 않았다:`
    + ` ${String(source).replace(/\s+/g, ' ').slice(0, 100)} → ${safeJson(last)}`,
  );
  return last;
}

function ctx(win) {
  return js(win, '(() => { const a = window.AthenaBacktestCanvas; return a ? a.getContext() : null; })()');
}

function invoke(win, channel, payload) {
  const arg = payload === undefined ? '' : `, ${JSON.stringify(payload)}`;
  return js(win, `window.athena.invoke(${JSON.stringify(channel)}${arg})`);
}

// 렌더러 채널이 없는 백엔드 라우트를 직접 두드린다(출처 브리프·프로젝트 등록 해제).
// preload의 INVOKE_CHANNELS에 없는 것을 프로브가 지어내면, 프로브만 통과하고 사람은
// 못 하는 길이 생긴다 — 그래서 여기서는 IPC 봉투가 아니라 {status, body} 그대로 잰다.
async function backendJson(method, pathText, body) {
  try {
    const res = await fetch(`${BACKEND}${pathText}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed, error: null };
  } catch (err) {
    return { status: 0, body: null, error: String((err && err.message) || err) };
  }
}

function sendChat(win, action) {
  try {
    win.webContents.send('athena:backtest-chat-action', action);
    return true;
  } catch (err) {
    console.log(`[probe-backtest-full] WARN — 채팅 액션 전송 실패: ${String((err && err.message) || err)}`);
    return false;
  }
}

function click(win, selector) {
  return js(win, `(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    if (!n) return false;
    n.click();
    return true;
  })()`);
}

function clickNth(win, selector, index) {
  return js(win, `(() => {
    const list = document.querySelectorAll(${JSON.stringify(selector)});
    const n = list[${Number(index)}];
    if (!n) return false;
    n.click();
    return true;
  })()`);
}

function clickByText(win, selector, text) {
  return js(win, `(() => {
    const list = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const n = list.find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)});
    if (!n) return false;
    n.click();
    return true;
  })()`);
}

function setInput(win, selector, value) {
  return js(win, `(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    if (!n) return false;
    n.value = ${JSON.stringify(String(value))};
    n.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

function textOf(win, selector) {
  return js(win, `(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    return n ? n.textContent : null;
  })()`);
}

function countOf(win, selector) {
  return js(win, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

// ---------- 폼 조작(설계 화면) ----------

function goTab(win, index) {
  return clickNth(win, `${R}.backtest-tab`, index);
}

function goSubtab(win, index) {
  return clickNth(win, `${R}.backtest-subtab`, index);
}

async function goDesignForm(win) {
  await goTab(win, 0);
  await wait(200);
  // 하위 탭은 지도·폼·코드다 — 폼은 두 번째다(DESIGN_TABS, 2026-09-03).
  await goSubtab(win, 1);
  await wait(200);
}

function addSymbol(win, code) {
  return js(win, `(() => {
    const s = document.querySelector('${R}.backtest-symbol-add');
    if (!s) return false;
    s.value = ${JSON.stringify(code)};
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
}

// 칩은 지울 때마다 render()가 도므로 한 번에 하나씩 지운다.
async function clearSymbols(win) {
  for (let i = 0; i < 8; i += 1) {
    const removed = await click(win, `${R}.backtest-symbol-remove`);
    if (!removed) break;
    await wait(120);
  }
}

function setDates(win, from, to) {
  return js(win, `(() => {
    const inputs = Array.from(document.querySelectorAll('${R}.backtest-design .backtest-field-input'))
      .filter((i) => i.placeholder === 'YYYYMMDD');
    if (inputs.length < 2) return { ok: false, found: inputs.length };
    inputs[0].value = ${JSON.stringify(from)};
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = ${JSON.stringify(to)};
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, found: inputs.length };
  })()`);
}

// 설계 폼을 "지금 실행해도 되는" 출발점으로 되돌린다 — 섹션을 따로 돌려도, 앞 섹션이 깨진 채
// 끝나도 같은 자리에서 시작하게. 앞 섹션이 새게 두는 상태가 실제로 여럿 있다:
//   · E15가 진입 조건을 전부 지운다        → 프리셋 재선택으로 템플릿 조건이 돌아온다
//   · E/F가 실행경로를 'code'로 굳혀 둔다   → 갈래가 있으면 '폼'으로 되돌린다
//   · F가 진단·에러 화면에 멈춘다(탭이 없다) → 막다른 화면을 먼저 빠져나온다
//   · J가 배포 탭에 머문다                  → 설계/폼 탭으로 되돌린다
async function ensureRunnableForm(win, from, to) {
  // 1) 막다른 화면에서 먼저 빠져나온다 — 승인·진단·에러 화면에는 모드 탭이 아예 없다.
  //    없는 버튼은 click()이 false를 돌려줄 뿐이니 순서대로 눌러도 안전하다.
  await click(win, `${R}.backtest-approval-cancel`);
  await click(win, `${R}.backtest-diag-discard`);
  await click(win, `${R}.backtest-error-back`);
  await wait(250);

  // 2) 설계 탭 · 폼 하위탭.
  await goDesignForm(win);

  // 3) 코드가 남아 있으면 실행경로 갈래가 'code'에 머문다 — 폼 경로로 되돌린다.
  await clickByText(win, `${R}.backtest-runpath-item`, '폼');
  await wait(150);

  // 4) 프리셋을 다시 골라 지표·파라미터·조건을 템플릿 값으로 되돌린다(종목·기간·주기는 유지된다).
  await clickNth(win, `${R}.backtest-preset-item`, 0);
  await wait(250);

  // 4b) 프리셋을 고르면 화면은 지도로 간다(2026-09-03 — 전략이 서면 지도가 첫 화면이다).
  //     사람도 거기서 [폼]을 눌러 대상을 채운다. 이 클릭이 없으면 아래 5)의 종목·날짜
  //     입력은 화면에 없는 칸을 만지고 조용히 아무것도 안 한다 — 종목 없는 폼이 남아
  //     지도는 422를 받고 실행은 시작조차 하지 않는다(2026-09-03 실측 G01·N03).
  await goSubtab(win, 1);
  await wait(200);

  // 5) 종목·기간을 다시 채운다.
  const cur = await ctx(win);
  const symbols = cur && cur.spec ? cur.spec.symbols : null;
  if (!Array.isArray(symbols) || symbols.length !== 1 || symbols[0] !== STK) {
    await clearSymbols(win);
    await addSymbol(win, STK);
    await wait(250);
  }
  await setDates(win, from || FROM, to || TO);
  await wait(150);

  // 6) 복구가 실제로 됐는지 한 줄로 남긴다 — 다음 섹션의 실패가 앞 섹션 탓인지 가르는 근거다.
  const after = await ctx(win);
  const conditions = after && after.spec && after.spec.entry ? after.spec.entry.conditions : null;
  if (!Array.isArray(conditions) || conditions.length === 0 || (after && after.view !== 'design')) {
    console.log(
      '[probe-backtest-full] WARN — 폼 복구가 끝나지 않았다:'
      + ` ${safeJson({ view: after && after.view, conditions: Array.isArray(conditions) ? conditions.length : null })}`,
    );
  }
  return after;
}

// 호출부가 많아 이름은 그대로 둔다 — 실제 복구는 ensureRunnableForm이 한다.
function prepareForm(win, from, to) {
  return ensureRunnableForm(win, from, to);
}

// 실행 버튼을 누른 뒤 running을 벗어난 화면을 기다린다(result·error·diagnosis·approval).
// **설계 화면에서 누른 클릭에만** 쓴다 — 이미 끝난 화면에서 누르면 그 화면을 그대로 돌려준다.
function waitRunOutcome(win, timeoutMs) {
  return until(win, `(() => {
    const api = window.AthenaBacktestCanvas;
    if (!api) return null;
    const c = api.getContext();
    if (!c) return null;
    if (c.view === 'running' || c.view === 'design') return null;
    return { view: c.view, tab: c.tab };
  })()`, timeoutMs || WAIT_RUN);
}

// 이미 끝난 화면(진단·결과)에서 실행을 다시 걸 때 쓴다 — 새 실행이 **실제로 끝났는지**만 본다.
//
// 왜 따로 필요한가(2026-09-02 F09 실측). applyFix는 setState('running') 앞에서 addVersion을
// await한다 — 그 왕복 동안 화면은 아직 'diagnosis'다. waitRunOutcome은 "running도 design도
// 아니면 끝"이라 그 진단 화면을 새 결과로 착각하고 즉시 돌아왔다(applied:{view:'diagnosis'}).
// 실제로는 재실행이 성공하고 있었다.
//
// 새 실행의 표지는 lastResult.runId다 — 캔버스가 startRun에서 setState({runId: res.run_id})로
// 갈아끼우고, 성공(status:'done')이든 실패(status:'failed')든 lastResultContext가 그 값을 싣는다.
// prevRunId는 클릭 **직전에** 읽어 넘긴다.
// 실행이 아예 시작되지 않는 화면(승인)을 기다리는 자리에는 쓰지 않는다 — runId가 바뀌지 않는다.
function waitNewRunOutcome(win, prevRunId, timeoutMs) {
  const prev = JSON.stringify(prevRunId == null ? null : String(prevRunId));
  return until(win, `(() => {
    const api = window.AthenaBacktestCanvas;
    if (!api) return null;
    const c = api.getContext();
    if (!c) return null;
    if (c.view === 'running' || c.view === 'design') return null;
    const runId = c.lastResult ? c.lastResult.runId : null;
    if (!runId || String(runId) === ${prev}) return null;
    return { view: c.view, tab: c.tab, runId };
  })()`, timeoutMs || WAIT_RUN);
}

// 지금 화면이 물고 있는 runId — waitNewRunOutcome에 넘길 직전 값이다.
async function currentRunId(win) {
  const c = await ctx(win);
  return c && c.lastResult ? c.lastResult.runId : null;
}

function clickLastCardButton(win, label) {
  return js(win, `(() => {
    const cards = document.querySelectorAll('#history .backtest-change');
    if (!cards.length) return false;
    const card = cards[cards.length - 1];
    const btn = Array.from(card.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

// ---------- 전략 소스(코드 경로에서 쓰는 세 벌) ----------

const SRC_GOOD = [
  'PARAMS = {',
  '    "fast": {"default": 5, "min": 2, "max": 60, "step": 1, "type": "int"},',
  '    "slow": {"default": 20, "min": 3, "max": 240, "step": 1, "type": "int"},',
  '}',
  '',
  '',
  'def signals(df, p):',
  '    print("probe-code-path")',
  '    fast = df["close"].rolling(int(p["fast"])).mean()',
  '    slow = df["close"].rolling(int(p["slow"])).mean()',
  '    entry = (fast > slow) & (fast.shift(1) <= slow.shift(1))',
  '    exit = (fast < slow) & (fast.shift(1) >= slow.shift(1))',
  '    return df.assign(entry=entry, exit=exit)[["entry", "exit"]]',
  '',
].join('\n');

// 차단된 import — 샌드박스가 SandboxImportError를 던지고, diagnose가 "그 줄을 지운다"는
// 수정안을 낸다(_blocked_import_fix). 'os'는 _BLOCKED_HINT의 첫 항목이라 판정이 흔들리지 않는다.
const SRC_BROKEN_IMPORT = [
  'import os',
  '',
  'PARAMS = {"fast": {"default": 5, "min": 2, "max": 60, "step": 1, "type": "int"}}',
  '',
  '',
  'def signals(df, p):',
  '    print("probe-fix-path")',
  '    ma = df["close"].rolling(int(p["fast"])).mean()',
  '    entry = df["close"] > ma',
  '    exit = df["close"] < ma',
  '    return df.assign(entry=entry, exit=exit)[["entry", "exit"]]',
  '',
].join('\n');

// 흐름 지도의 4단계(준비·지표·조건·출력)가 또렷하게 갈리는 모양.
const SRC_FLOW = [
  'PARAMS = {"fast": {"default": 5, "min": 2, "max": 60, "step": 1, "type": "int"}}',
  '',
  '',
  'def signals(df, p):',
  '    n = int(p["fast"])',
  '    ma = df["close"].rolling(n).mean()',
  '    entry = df["close"] > ma',
  '    exit = df["close"] < ma',
  '    return df.assign(entry=entry, exit=exit)[["entry", "exit"]]',
  '',
].join('\n');

const SRC_NO_SIGNALS = 'x = 1\n';

// 정적 검증은 통과하고 **실행에서만** 터지는 코드(J08b) — evaluate가 사용자 코드의 예외를
// yaml 파싱 오류로 바꿔 말하지 않는지 잰다. 샌드박스가 error.type을 그대로 싣는다.
const SRC_RAISES = [
  'PARAMS = {"fast": {"default": 5, "min": 2, "max": 60, "step": 1, "type": "int"}}',
  '',
  '',
  'def signals(df, p):',
  '    raise ValueError("전략 로직이 터졌다")',
  '',
].join('\n');

// M 섹션이 내 폴더에 놓는 전략 — 하위 폴더째 만들어지는지도 같이 재려고 algos/ 아래다.
// PARAMS 두 개는 등록부가 읽어(flow.params_defaults) 슬라이더 두 개가 되고, print는
// 그 파이썬이 정말 돌았다는 증거로 stdout 패널에 남는다.
const USER_STRATEGY_PATH = 'algos/ma.py';

const SRC_USER_STRATEGY = [
  'PARAMS = {',
  '    "fast": {"default": 5, "min": 2, "max": 60, "step": 1, "type": "int"},',
  '    "slow": {"default": 20, "min": 3, "max": 240, "step": 1, "type": "int"},',
  '}',
  '',
  '',
  'def signals(df, p):',
  '    print("probe-user-strategy")',
  '    fast = df["close"].rolling(int(p["fast"])).mean()',
  '    slow = df["close"].rolling(int(p["slow"])).mean()',
  '    entry = (fast > slow) & (fast.shift(1) <= slow.shift(1))',
  '    exit = (fast < slow) & (fast.shift(1) >= slow.shift(1))',
  '    return df.assign(entry=entry, exit=exit)[["entry", "exit"]]',
  '',
].join('\n');

// ---------- 날짜 산출 ----------

function minusYears(yyyymmdd, years) {
  const y = Number(String(yyyymmdd).slice(0, 4)) - years;
  return `${y}${String(yyyymmdd).slice(4)}`;
}

// ---------- 정리 대상 ----------

const created = {
  strategyIds: [], deploymentIds: [],
  // M이 만든 것 — M14가 되돌리고 나면 비어 있다. 섹션이 도중에 끊긴 경우에만 남는다.
  userStrategyIds: [], projectIds: [],
};

// finish()는 main() 밖(finally·거절 처리기)에서도 불린다 — 창을 여기에 둔다.
let probeWin = null;

// ---------- 본체 ----------

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  probeWin = shellWin;
  shellWin.show();
  await wait(1800); // 렌더러 스크립트(canvas.js·chat.js) 로드 대기

  // ==================================================================
  // 00 전제 — 백엔드·백테스트 서브시스템·캐시가 실제로 있는가
  // ==================================================================

  let ready = false;
  const readyDeadline = Date.now() + 90000;
  while (Date.now() < readyDeadline) {
    try {
      const res = await fetch(`${BACKEND}/ready`);
      if (res.status === 200) { ready = true; break; }
    } catch { /* 아직 안 떴다 — 다시 묻는다 */ }
    await wait(1500);
  }
  await step('00A', '백엔드 /ready가 200을 준다', () => ({ ok: ready, data: { backend: BACKEND } }));
  if (!ready) throw new PreconditionAbort('백엔드가 없어 나머지를 돌리지 않았다');

  const presetsEnvelope = await invoke(shellWin, 'athena:backtest-presets');
  const presetCount = presetsEnvelope && presetsEnvelope.ok && presetsEnvelope.data
    ? (presetsEnvelope.data.presets || []).length : 0;
  await step('00B', '백테스트 서브시스템이 켜져 있다(presets 200)', () => ({
    ok: !!(presetsEnvelope && presetsEnvelope.ok) && presetCount === 10,
    data: {
            ok: presetsEnvelope && presetsEnvelope.ok,
            status: presetsEnvelope && presetsEnvelope.status,
            error: presetsEnvelope && presetsEnvelope.error,
            presets: presetCount,
          },
  }));
  if (!presetsEnvelope || !presetsEnvelope.ok) {
    throw new PreconditionAbort('presets IPC가 실패해 나머지를 돌리지 않았다');
  }

  const covEnvelope = await invoke(
    shellWin, 'athena:backtest-coverage', { stk_cd: STK, period: 'day', adjusted: true },
  );
  const coverage = covEnvelope && covEnvelope.ok ? covEnvelope.data : null;
  const rows = coverage ? Number(coverage.rows) || 0 : 0;
  await step('00C', `${STK} 일봉이 캐시에 있다`, () => ({
    ok: rows > 0 && !!coverage.first_dt && !!coverage.last_dt,
    data: { rows, first_dt: coverage && coverage.first_dt, last_dt: coverage && coverage.last_dt },
  }));
  if (!(rows > 0) || !coverage.first_dt || !coverage.last_dt) {
    throw new PreconditionAbort(
      `${STK} 일봉 캐시가 비어 있다 — ATHENA_BACKTEST_DB_PATH에 봉을 시드한 뒤 다시 돌리세요`,
    );
  }

  // 실행 구간은 커버리지 안쪽으로 잡는다 — 밖으로 나가면 모든 실행이 409가 된다.
  TO = ENV_TO || coverage.last_dt || FALLBACK_TO;
  const bounded = minusYears(TO, 3);
  FROM = ENV_FROM
    || (coverage.first_dt ? (bounded > coverage.first_dt ? bounded : coverage.first_dt) : FALLBACK_FROM);
  await step('00D', '실행 구간이 캐시 안쪽으로 정해졌다', () => ({
    ok: FROM < TO,
    data: { stk: STK, from: FROM, to: TO },
  }));

  // ==================================================================
  // A 부팅·모드
  // ==================================================================
  if (on('A')) await section('A', async () => {
    await js(shellWin, "(() => { document.getElementById('modeNavBacktest').click(); return true; })()");
    await wait(400);

    const surfaces = await js(shellWin, `(() => {
      const h = (id) => { const el = document.getElementById(id); return el ? el.hidden : null; };
      const nav = document.getElementById('modeNavBacktest');
      const region = document.getElementById('canvasRegion');
      return {
        backtest: h('backtestCanvas'),
        mosaic: h('mosaic'),
        summaryTable: h('graphSummaryTable'),
        graph: h('graphCanvas'),
        agent: h('agentCanvas'),
        plugin: h('pluginCanvas'),
        navActive: nav ? nav.className.includes('is-active') : null,
        mode: region && region.dataset ? region.dataset.mode : null,
      };
    })()`);
    await step('A01', '백테스트 모드 진입 — 5중 배타', () => ({
      ok: surfaces.backtest === false && surfaces.mosaic === true && surfaces.summaryTable === true
            && surfaces.graph === true && surfaces.agent === true && surfaces.plugin === true
            && surfaces.navActive === true && surfaces.mode === 'backtest',
      data: surfaces,
    }));

    const chatHead = await js(shellWin, `(() => {
      const head = document.getElementById('chatModeHead');
      if (!head) return null;
      const t = head.querySelector('.chat-mode-head-title');
      const s = head.querySelector('.chat-mode-head-sub');
      return {
        hidden: head.hidden,
        mode: head.dataset ? head.dataset.mode : null,
        title: t ? t.textContent : null,
        sub: s ? s.textContent : null,
      };
    })()`);
    await step('A02', '채팅 헤더가 백테스트 얼굴로 바뀐다', () => ({
      ok: !!chatHead && chatHead.hidden === false && chatHead.mode === 'backtest'
            && chatHead.title === '전략에게 묻기' && chatHead.sub === '답이 설정과 코드를 바꿉니다',
      data: chatHead,
    }));

    const shell = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas ? window.AthenaBacktestCanvas.getContext() : null;
      if (!c || c.view !== 'design') return null;
      return {
        view: c.view,
        head: root.querySelectorAll('.backtest-shell > .backtest-head').length,
        body: root.querySelectorAll('.backtest-shell > .backtest-body').length,
        empty: root.querySelectorAll('.backtest-canvas-empty').length,
        tabs: Array.from(root.querySelectorAll('.backtest-tab')).map((t) => t.textContent),
        runButton: root.querySelectorAll('.backtest-run-button').length,
      };
    })()`, WAIT_PRESETS);
    await step('A03', 'empty 뷰를 지나 design 뷰로 간다(shell 골격 head+body)', () => ({
      ok: !!shell && shell.head === 1 && shell.body === 1 && shell.empty === 0,
      data: shell,
    }));
    await step('A04', '모드 탭 5개가 계약 순서대로 있다', () => ({
      ok: !!shell && JSON.stringify(shell.tabs) === JSON.stringify(['설계', '결과', '이력', '최적화', '배포'])
            && shell.runButton === 1,
      data: shell ? { tabs: shell.tabs, runButton: shell.runButton } : null,
    }));

    const subtabs = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        labels: Array.from(root.querySelectorAll('.backtest-subtab')).map((t) => t.textContent),
        on: (root.querySelector('.backtest-subtab.is-on') || {}).textContent || null,
        designTab: c.designTab,
        mapVersion: c.map ? c.map.version : null,
      };
    })()`);
    await step('A08', '설계 하위 탭은 지도·폼·코드·노드·흐름이고 기본은 지도다(코드는 최후의 보루)', () => ({
      ok: !!subtabs
            && JSON.stringify(subtabs.labels) === JSON.stringify(
              ['지도', '폼', '코드 · 최후의 보루', '노드·흐름'],
            )
            && subtabs.designTab === 'flow' && subtabs.on === '지도'
            && subtabs.mapVersion === 1,
      data: subtabs,
    }));

    await goSubtab(shellWin, 1);
    await wait(300);
    // **계약이 바뀐 자리다**(2026-09-03 사용자 확정): 목록은 하나다. 처음 주어진 10개도
    // 그냥 '기법'이고 내가 만든 것과 같은 목록에 선다 — 제목도 하나이고 둘을 함께 센다.
    // 그래서 여기서는 백엔드가 준 10개가 다 그려졌는지와, 제목의 숫자가 화면에 실제로 선
    // 카드 수(기법 + 내가 만든 것)와 **같은지**를 잰다. 등록부에 남은 것이 있어도(다른
    // 섹션이 남겼을 수 있다) 검사는 느슨해지지 않는다.
    const presetView = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const first = root.querySelector('.backtest-preset-item');
      return {
        items: root.querySelectorAll('.backtest-preset-item').length,
        mine: root.querySelectorAll('.backtest-user-strategy-item').length,
        lists: root.querySelectorAll('.backtest-technique-list').length,
        newCard: root.querySelectorAll('.backtest-technique-new').length,
        title: (root.querySelector('.backtest-technique-wrap .backtest-card-title') || {}).textContent || null,
        firstName: first ? (first.querySelector('.backtest-preset-name') || {}).textContent : null,
        firstCategory: first ? (first.querySelector('.backtest-preset-category') || {}).textContent : null,
        firstDesc: first ? ((first.querySelector('.backtest-technique-desc') || {}).textContent || null) : null,
        saysPreset: root.textContent.indexOf('프리셋') !== -1,
      };
    })()`);
    await step('A05', '기법 10종이 백엔드에서 와 한 목록으로 그려진다 — 맨 위는 [+ 새 기법 만들기]', () => ({
      ok: presetView.items === 10 && presetView.lists === 1 && presetView.newCard === 1
            && presetView.title === `기법 — ${presetView.items + presetView.mine}개`
            && presetView.saysPreset === false,
      data: presetView,
    }));
    await step('A06', '기법 카드가 이름·분류 칩(한국어)·한 줄 설명을 갖는다', () => ({
      ok: !!presetView.firstName && presetView.firstName.length > 0
            && !!presetView.firstCategory
            && /^[가-힣]+$/.test(presetView.firstCategory)
            && !!presetView.firstDesc && presetView.firstDesc.length > 0,
      data: {
        name: presetView.firstName,
        category: presetView.firstCategory,
        desc: presetView.firstDesc,
      },
    }));

    const headTitle = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      return {
        name: (root.querySelector('.backtest-head-name') || {}).textContent || null,
        strategy: (root.querySelector('.backtest-head-strategy') || {}).textContent || null,
        version: root.querySelectorAll('.backtest-head-version').length,
      };
    })()`);
    await step('A07', '헤더가 전략 이름을 적고 저장 전에는 버전 배지가 없다', () => ({
      ok: headTitle.name === '백테스트' && !!headTitle.strategy && headTitle.version === 0,
      data: headTitle,
    }));
  });
  else {
    // 다른 섹션도 모드 안에서만 성립한다 — 진입만 조용히 해둔다.
    await js(shellWin, "(() => { document.getElementById('modeNavBacktest').click(); return true; })()");
    await until(shellWin, `(() => {
      const api = window.AthenaBacktestCanvas;
      const c = api ? api.getContext() : null;
      return c && Array.isArray(c.presets) && c.presets.length ? true : null;
    })()`, WAIT_PRESETS);
  }

  // ==================================================================
  // B 설계 폼
  // ==================================================================
  if (on('B')) await section('B', async () => {
    // **계약이 바뀐 자리다**(2026-09-03 · selectPreset의 designTab:'flow'). 프리셋을 고르면
    // 화면은 폼이 아니라 **지도**로 간다 — 사람도 거기서 [폼]을 눌러 대상을 채운다
    // (ensureRunnableForm 4b가 같은 사실을 같은 이유로 이미 하고 있다). 그 클릭이 없으면
    // 이 섹션의 검사들은 화면에 없는 칸을 만지고 조용히 전부 실패한다 — 실제로 그랬다
    // (2026-09-03 실측: B01~B27 23개가 한꺼번에 FAIL, 내 변경을 되돌려도 같았다).
    // 검사 내용은 하나도 바뀌지 않는다. 사람이 눌러야 하는 클릭 하나가 빠져 있었다.
    const pickPreset = async (index) => {
      await clickNth(shellWin, `${R}.backtest-preset-item`, index);
      await wait(300);
      await goSubtab(shellWin, 1);
      await wait(200);
    };
    await goDesignForm(shellWin);
    await pickPreset(0);
    await clearSymbols(shellWin);
    await wait(200);

    // --- 종목 칩 ---
    await addSymbol(shellWin, STK);
    await wait(250);
    const chip = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const chips = root.querySelectorAll('.backtest-symbol-chip');
      const add = root.querySelector('.backtest-symbol-add');
      return {
        chips: chips.length,
        code: chips.length ? (chips[0].querySelector('.backtest-symbol-code') || {}).textContent : null,
        addValue: add ? add.value : null,
      };
    })()`);
    await step('B01', '종목 칩 추가(Enter) — 칩이 생기고 입력칸이 비워진다', () => ({
      ok: chip.chips === 1 && chip.code === STK && chip.addValue === '',
      data: chip,
    }));

    // --- 기간 ---
    const dateSet = await setDates(shellWin, FROM, TO);
    await wait(150);
    const afterDates = await ctx(shellWin);
    await step('B02', '시작일·종료일 입력이 모델에 들어간다', () => ({
      ok: dateSet.ok === true && afterDates.spec.fromDt === FROM && afterDates.spec.toDt === TO,
      data: { found: dateSet.found, fromDt: afterDates.spec.fromDt, toDt: afterDates.spec.toDt },
    }));

    // --- 주기 세그먼트 ---
    await clickByText(shellWin, `${R}.backtest-design .backtest-segment-item`, '주');
    await wait(200);
    const weekCtx = await ctx(shellWin);
    const weekPressed = await js(shellWin, `(() => {
      const list = Array.from(document.querySelectorAll('${R}.backtest-design .backtest-segment-item'));
      return list.map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
    })()`);
    await step('B03', '주기 세그먼트(일/주/월) 전환', () => ({
      ok: weekCtx.spec.period === 'week'
            && JSON.stringify(weekPressed) === JSON.stringify([['일', 'false'], ['주', 'true'], ['월', 'false']]),
      data: { period: weekCtx.spec.period, pressed: weekPressed },
    }));
    await clickByText(shellWin, `${R}.backtest-design .backtest-segment-item`, '일');
    await wait(200);

    // --- 수정주가 ---
    const adjToggled = await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[0];
      if (!card) return false;
      const cb = card.querySelector('input[type=checkbox]');
      if (!cb) return false;
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const adjCtx = await ctx(shellWin);
    await step('B04', '수정주가 체크박스가 모델을 바꾼다', () => ({
      ok: adjToggled === true && adjCtx.spec.adjusted === false,
      data: { adjusted: adjCtx.spec.adjusted },
    }));
    await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[0];
      const cb = card.querySelector('input[type=checkbox]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(150);

    // --- 캐시 커버리지 한 줄 ---
    const covNote = await until(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[0];
      if (!card) return null;
      const note = card.querySelector('.backtest-card-note');
      return note && note.textContent.indexOf('캐시') === 0 ? { note: note.textContent } : null;
    })()`, WAIT_UI);
    await step('B05', '대상 카드에 캐시 커버리지 한 줄이 뜬다', () => ({
      ok: !!covNote && /^캐시 .+봉 · .+ → .+$/.test(covNote.note),
      data: covNote,
    }));

    // --- 프리셋 교체가 종목·기간을 지키는가 ---
    const beforeSwitch = await ctx(shellWin);
    await pickPreset(1);
    const afterSwitch = await ctx(shellWin);
    const selectedIndex = await js(shellWin, `(() => {
      const list = Array.from(document.querySelectorAll('${R}.backtest-preset-item'));
      return list.findIndex((b) => b.className.indexOf('is-selected') !== -1);
    })()`);
    await step('B06', '프리셋 교체 — 종목·기간·주기는 유지되고 전략만 갈린다', () => ({
      ok: JSON.stringify(afterSwitch.spec.symbols) === JSON.stringify(beforeSwitch.spec.symbols)
            && afterSwitch.spec.fromDt === beforeSwitch.spec.fromDt
            && afterSwitch.spec.toDt === beforeSwitch.spec.toDt
            && afterSwitch.spec.period === beforeSwitch.spec.period
            && afterSwitch.spec.presetId !== beforeSwitch.spec.presetId
            && selectedIndex === 1,
      data: {
              beforePreset: beforeSwitch.spec.presetId,
              afterPreset: afterSwitch.spec.presetId,
              symbols: afterSwitch.spec.symbols,
              selectedIndex,
            },
    }));
    await pickPreset(0);

    // --- 지표 카드 ---
    const indicators = await js(shellWin, `(() => {
      const rows = Array.from(document.querySelectorAll('${R}.backtest-indicator-row'));
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[1];
      return {
        rows: rows.map((r) => [
          (r.querySelector('.backtest-indicator-id') || {}).textContent,
          (r.querySelector('.backtest-indicator-alias') || {}).textContent,
        ]),
        note: card ? (card.querySelector('.backtest-card-note') || {}).textContent : null,
        buttons: document.querySelectorAll('${R}.backtest-indicator-row button').length,
      };
    })()`);
    await step('B07', '지표 카드가 별칭까지 그린다(SMA 골든크로스 = 2행)', () => ({
      ok: indicators.rows.length === 2 && indicators.rows[0][0] === 'SMA'
            && indicators.rows[0][1] === 'ma_fast' && indicators.rows[1][1] === 'ma_slow'
            && /2종 사용/.test(indicators.note || ''),
      data: indicators,
    }));
    await step('B08', '지표 추가/삭제 버튼은 화면에 없다(미구현 계약)', () => ({
      ok: indicators.buttons === 0,
      data: { buttons: indicators.buttons, note: 'renderIndicatorCard에는 button()이 하나도 없다 — 프리셋 교체나 채팅 patch만이 경로' },
    }));

    // --- 파라미터 슬라이더 ---
    const slider = await js(shellWin, `(() => {
      const s = document.querySelector('${R}.backtest-param-slider[aria-label="fast 값"]');
      if (!s) return null;
      const wrap = s.parentNode;
      return {
        min: s.getAttribute('min'), max: s.getAttribute('max'),
        step: s.getAttribute('step'), value: s.value,
        name: (wrap.querySelector('.backtest-param-name') || {}).textContent,
        shown: (wrap.querySelector('.backtest-param-value') || {}).textContent,
        range: (wrap.querySelector('.backtest-param-range') || {}).textContent,
      };
    })()`);
    await step('B09', 'fast 슬라이더가 프리셋의 min/max/step/기본값을 그대로 쓴다', () => ({
      ok: !!slider && slider.min === '5' && slider.max === '60' && slider.step === '1'
            && slider.value === '20' && slider.name === 'fast' && slider.range === '5 – 60',
      data: slider,
    }));

    const moved = await js(shellWin, `(() => {
      const s = document.querySelector('${R}.backtest-param-slider[aria-label="fast 값"]');
      s.value = '10';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return (s.parentNode.querySelector('.backtest-param-value') || {}).textContent;
    })()`);
    const movedCtx = await ctx(shellWin);
    await step('B10', '슬라이더 조작이 값 표시와 모델을 함께 바꾼다', () => ({
      ok: moved === '10' && movedCtx.spec.params.fast.default === 10,
      data: { shown: moved, model: movedCtx.spec.params.fast.default },
    }));

    const clampHigh = await js(shellWin, `(() => {
      const s = document.querySelector('${R}.backtest-param-slider[aria-label="fast 값"]');
      s.value = '999';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return (s.parentNode.querySelector('.backtest-param-value') || {}).textContent;
    })()`);
    const clampHighCtx = await ctx(shellWin);
    await step('B11', '범위 위쪽 값은 max로 잘린다', () => ({
      ok: clampHigh === '60' && clampHighCtx.spec.params.fast.default === 60,
      data: { shown: clampHigh, model: clampHighCtx.spec.params.fast.default },
    }));

    const clampLow = await js(shellWin, `(() => {
      const s = document.querySelector('${R}.backtest-param-slider[aria-label="fast 값"]');
      s.value = '1';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return (s.parentNode.querySelector('.backtest-param-value') || {}).textContent;
    })()`);
    const clampLowCtx = await ctx(shellWin);
    await step('B12', '범위 아래쪽 값은 min으로 잘린다', () => ({
      ok: clampLow === '5' && clampLowCtx.spec.params.fast.default === 5,
      data: { shown: clampLow, model: clampLowCtx.spec.params.fast.default },
    }));

    // --- 조건 카드 ---
    const condCards = await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('${R}.backtest-condition-card'));
      return cards.map((c) => (c.querySelector('.backtest-card-title') || {}).textContent);
    })()`);
    await step('B13', '진입·청산 조건 카드 2장', () => ({
      ok: JSON.stringify(condCards) === JSON.stringify(['진입 조건', '청산 조건']),
      data: { titles: condCards },
    }));

    const condRow = await js(shellWin, `(() => {
      const c = document.querySelector('${R}.backtest-condition');
      if (!c) return null;
      return {
        name: (c.querySelector('.backtest-condition-name') || {}).textContent,
        op: (c.querySelector('.backtest-condition-op') || {}).textContent,
        target: (c.querySelector('.backtest-condition-target') || {}).textContent,
      };
    })()`);
    await step('B14', '조건 행이 사람 문장으로 읽힌다', () => ({
      ok: !!condRow && condRow.name === 'ma_fast' && condRow.op === '가 상향 돌파'
            && condRow.target === 'ma_slow',
      data: condRow,
    }));

    await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-condition-card')[0];
      card.querySelector('.backtest-logic-badge').click();
      return true;
    })()`);
    await wait(200);
    const logic = await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-condition-card')[0];
      const b = card.querySelector('.backtest-logic-badge');
      return { cls: b.className, text: b.textContent };
    })()`);
    const logicCtx = await ctx(shellWin);
    await step('B15', 'AND/OR 뱃지 토글', () => ({
      ok: logic.cls.indexOf('is-or') !== -1 && logic.text === '하나라도 OR'
            && logicCtx.spec.entry.logic === 'OR',
      data: { badge: logic, logic: logicCtx.spec.entry.logic },
    }));
    await js(shellWin, `(() => {
      document.querySelectorAll('${R}.backtest-condition-card')[0]
        .querySelector('.backtest-logic-badge').click();
      return true;
    })()`);
    await wait(200);

    const adder = await js(shellWin, `(() => {
      const left = document.querySelector('select[aria-label="entry 조건 왼쪽"]');
      const op = document.querySelector('select[aria-label="entry 조건 연산자"]');
      const right = document.querySelector('input[aria-label="entry 조건 오른쪽"]');
      if (!left || !op || !right) return null;
      return {
        left: Array.from(left.children).map((o) => o.value),
        op: Array.from(op.children).map((o) => [o.value, o.textContent]),
        placeholder: right.placeholder,
      };
    })()`);
    await step('B16', '조건 추가 — 왼쪽 select가 별칭 + 원시 열 5종을 준다', () => ({
      ok: !!adder && JSON.stringify(adder.left)
            === JSON.stringify(['ma_fast', 'ma_slow', 'open', 'high', 'low', 'close', 'volume']),
      data: adder ? { left: adder.left } : null,
    }));
    await step('B17', '조건 추가 — 연산자 select가 7종을 준다', () => ({
      ok: !!adder && adder.op.length === 7 && adder.op[0][0] === 'cross_above'
            && adder.op[0][1] === '가 상향 돌파' && adder.placeholder === '이름 또는 숫자',
      data: adder ? { ops: adder.op.map((o) => o[0]), placeholder: adder.placeholder } : null,
    }));

    const beforeAdd = (await ctx(shellWin)).spec.entry.conditions.length;
    await js(shellWin, `(() => {
      document.querySelector('select[aria-label="entry 조건 왼쪽"]').value = 'ma_fast';
      document.querySelector('select[aria-label="entry 조건 연산자"]').value = 'greater_than';
      document.querySelector('input[aria-label="entry 조건 오른쪽"]').value = '30';
      document.querySelectorAll('${R}.backtest-condition-card')[0]
        .querySelector('.backtest-condition-add-button').click();
      return true;
    })()`);
    await wait(250);
    const afterAdd = (await ctx(shellWin)).spec.entry.conditions;
    await step('B18', '[조건 추가]가 조건을 늘리고 숫자 문자열을 숫자로 담는다', () => ({
      ok: afterAdd.length === beforeAdd + 1
            && afterAdd[afterAdd.length - 1].indicator === 'ma_fast'
            && afterAdd[afterAdd.length - 1].operator === 'greater_than'
            && afterAdd[afterAdd.length - 1].compare_to === 30,
      data: { before: beforeAdd, after: afterAdd.length, last: afterAdd[afterAdd.length - 1] },
    }));

    await js(shellWin, `(() => {
      document.querySelectorAll('${R}.backtest-condition-card')[0]
        .querySelector('.backtest-condition-add-button').click();
      return true;
    })()`);
    await wait(250);
    const afterEmptyAdd = (await ctx(shellWin)).spec.entry.conditions.length;
    await step('B19', '오른쪽이 비면 [조건 추가]는 아무 일도 하지 않는다', () => ({
      ok: afterEmptyAdd === afterAdd.length,
      data: { count: afterEmptyAdd },
    }));

    await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-condition-card')[0];
      const buttons = card.querySelectorAll('.backtest-condition-remove');
      buttons[buttons.length - 1].click();
      return true;
    })()`);
    await wait(250);
    const afterRemove = (await ctx(shellWin)).spec.entry.conditions.length;
    await step('B20', '조건 행 ×가 그 조건만 지운다', () => ({
      ok: afterRemove === beforeAdd,
      data: { before: afterAdd.length, after: afterRemove },
    }));

    // --- 리스크 · 비용 ---
    await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[2];
      const cbs = card.querySelectorAll('input[type=checkbox]');
      cbs[1].checked = true;
      cbs[1].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await setInput(shellWin, 'input[aria-label="익절 비율(%)"]', '25');
    await wait(150);
    const riskCtx = await ctx(shellWin);
    await step('B21', '손절·익절 토글과 비율이 모델에 들어간다', () => ({
      ok: riskCtx.spec.risk.take_profit.enabled === true
            && riskCtx.spec.risk.take_profit.percent === 25,
      data: riskCtx.spec.risk,
    }));
    await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[2];
      const cbs = card.querySelectorAll('input[type=checkbox]');
      cbs[1].checked = false;
      cbs[1].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(150);

    const costsBefore = await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[2];
      return Array.from(card.querySelectorAll('.backtest-field')).map((f) => {
        const label = (f.querySelector('.backtest-field-label') || {}).textContent;
        const input = f.querySelector('input');
        return [label, input ? input.value : null];
      });
    })()`);
    await step('B22', '비용 3칸이 화면 기본값을 그대로 보인다', () => ({
      ok: JSON.stringify(costsBefore.slice(2)) === JSON.stringify([
            ['수수료(bp)', '1.5'], ['매도세(bp)', '18'], ['슬리피지(bp)', '5'],
          ]),
      data: { fields: costsBefore },
    }));

    await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[2];
      const fields = Array.from(card.querySelectorAll('.backtest-field'));
      const fee = fields[2].querySelector('input');
      fee.value = '2.5';
      fee.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await wait(150);
    const costsCtx = await ctx(shellWin);
    await step('B23', '수수료 입력이 모델에 들어간다', () => ({
      ok: costsCtx.spec.costs.fee_bps === 2.5,
      data: costsCtx.spec.costs,
    }));

    const riskNote = await js(shellWin, `(() => {
      const card = document.querySelectorAll('${R}.backtest-design > .backtest-card')[2];
      return (card.querySelector('.backtest-card-note') || {}).textContent || null;
    })()`);
    await step('B24', '비용 카드가 "사실 주장이 아니다"를 적어둔다', () => ({
      ok: riskNote === '세율·수수료는 시점에 따라 다릅니다 — 기본값일 뿐 사실 주장이 아닙니다',
      data: { note: riskNote },
    }));

    // --- 체결 가정 ---
    const assumptions = await js(shellWin, `(() => {
      const wrap = document.querySelectorAll('${R}.backtest-assumptions');
      if (!wrap.length) return null;
      const t = wrap[0].querySelector('.backtest-assumptions-text');
      return { count: wrap.length, text: t ? t.textContent : '' };
    })()`);
    const phrases = ['종가 확정 후', '다음 봉 시가', '손절이 먼저', '생존 편향', '배당 재투자'];
    await step('B25', '설계 화면에 체결 가정이 상시로 붙어 있다', () => ({
      ok: !!assumptions && assumptions.count === 1
            && phrases.every((p) => assumptions.text.indexOf(p) !== -1),
      data: assumptions ? { count: assumptions.count, missing: phrases.filter((p) => assumptions.text.indexOf(p) === -1) } : null,
    }));

    // --- 폼 검증 오류가 뜨고, 지워진다 ---
    await clearSymbols(shellWin);
    await wait(200);
    await click(shellWin, `${R}.backtest-run-button`);
    await wait(600);
    const errLines = await js(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        view: c.view,
        lines: Array.from(document.querySelectorAll('${R}.backtest-design-error-line')).map((e) => e.textContent),
      };
    })()`);
    await step('B26', '검증 실패면 실행하지 않고 오류 줄을 세운다', () => ({
      ok: errLines.view === 'design'
            && errLines.lines.indexOf('종목을 하나 이상 고르세요') !== -1,
      data: errLines,
    }));

    await addSymbol(shellWin, STK);
    await wait(250);
    await pickPreset(0);
    const clearedErrors = await countOf(shellWin, `${R}.backtest-design-error-line`);
    await step('B27', '프리셋을 다시 고르면 오류 줄이 지워진다', () => ({
      ok: clearedErrors === 0,
      data: { lines: clearedErrors },
    }));
  });

  // ==================================================================
  // C 데이터 계획 · 수집 승인
  // ==================================================================
  if (on('C')) await section('C', async () => {
    const planCached = await invoke(shellWin, 'athena:backtest-plan', {
      stk_cd: STK, period: 'day', adjusted: true, from_dt: FROM, to_dt: TO,
    });
    await step('C01', 'POST /data/plan — 캐시된 구간은 계획 봉투를 그대로 준다', () => ({
      ok: !!planCached && planCached.ok === true && planCached.data
            && typeof planCached.data.needed_pages === 'number'
            && typeof planCached.data.est_seconds === 'number'
            && Array.isArray(planCached.data.segments)
            && Number(planCached.data.cached_rows) > 0,
      data: planCached && planCached.data ? planCached.data : planCached,
    }));

    const planGap = await invoke(shellWin, 'athena:backtest-plan', {
      stk_cd: STK, period: 'day', adjusted: true, from_dt: EMPTY_FROM, to_dt: EMPTY_TO,
    });
    await step('C02', 'POST /data/plan — 캐시 밖 구간은 페이지 수와 구간을 계산한다', () => ({
      ok: !!planGap && planGap.ok === true && planGap.data
            && planGap.data.needed_pages > 0 && planGap.data.segments.length > 0,
      data: planGap && planGap.data ? planGap.data : planGap,
    }));

    const planMissing = await invoke(shellWin, 'athena:backtest-plan', {
      stk_cd: STK, period: 'day', adjusted: true, from_dt: FROM,
    });
    await step('C03', 'POST /data/plan — 필수 키가 빠지면 422로 이름을 짚어준다', () => ({
      ok: !!planMissing && planMissing.ok === false && planMissing.status === 422
            && /to_dt/.test(String(planMissing.error)),
      data: planMissing,
    }));

    // --- 승인 화면 ---
    await prepareForm(shellWin, UNCACHED_FROM, TO);
    await click(shellWin, `${R}.backtest-run-button`);
    const approval = await waitRunOutcome(shellWin, WAIT_RUN);
    const approvalDom = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const badge = root.querySelector('.backtest-approval-badge');
      if (!badge) return null;
      const held = root.querySelector('.backtest-coverage-held');
      const missing = root.querySelector('.backtest-coverage-missing');
      const stats = Array.from(root.querySelectorAll('.backtest-approval-stat')).map((s) => s.textContent);
      return {
        badge: badge.textContent,
        title: (root.querySelector('.backtest-approval-title') || {}).textContent,
        held: held ? held.getAttribute('style') : null,
        missing: missing ? missing.getAttribute('style') : null,
        stats,
        note: (root.querySelector('.backtest-approval-note') || {}).textContent,
        buttons: Array.from(root.querySelectorAll('.backtest-approval-actions button')).map((b) => b.textContent),
      };
    })()`);
    await step('C04', '캐시가 모자란 실행은 409 → 수집 승인 화면으로 간다', () => ({
      ok: !!approval && approval.view === 'approval' && !!approvalDom
            && approvalDom.badge === '수집 필요'
            && approvalDom.title === '캐시에 없는 구간이 있습니다',
      data: { outcome: approval, badge: approvalDom && approvalDom.badge },
    }));

    const widths = approvalDom
      ? [approvalDom.held, approvalDom.missing].map((s) => Number(String(s || '').replace(/[^\d.]/g, '')))
      : [NaN, NaN];
    await step('C05', '승인 커버리지 막대 두 조각의 합이 100%다', () => ({
      ok: Number.isFinite(widths[0]) && Number.isFinite(widths[1])
            && Math.abs(widths[0] + widths[1] - 100) < 0.2,
      data: { held: approvalDom && approvalDom.held, missing: approvalDom && approvalDom.missing },
    }));

    await step('C06', '승인 화면이 TR 호출 횟수를 적는다', () => ({
      ok: !!approvalDom && /^TR 호출 · ka10081 × .+회$/.test(approvalDom.stats[0] || ''),
      data: { stat: approvalDom && approvalDom.stats[0] },
    }));
    await step('C07', '승인 화면이 예상 소요 초를 적는다', () => ({
      ok: !!approvalDom && /^예상 소요 · .+초$/.test(approvalDom.stats[1] || ''),
      data: { stat: approvalDom && approvalDom.stats[1] },
    }));
    await step('C08', '승인 화면이 권리락 재수집 방침을 적는다', () => ({
      ok: !!approvalDom && /권리락/.test(approvalDom.note || '') && /수정주가/.test(approvalDom.note || ''),
      data: { note: approvalDom && (approvalDom.note || '').slice(0, 60) },
    }));
    await step('C09', '승인 화면 버튼 3종', () => ({
      ok: !!approvalDom && JSON.stringify(approvalDom.buttons)
            === JSON.stringify(['수집하고 실행', '보유 구간만으로 실행', '취소']),
      data: approvalDom ? { buttons: approvalDom.buttons } : null,
    }));

    // --- 보유 구간만으로 실행 ---
    await click(shellWin, `${R}.backtest-approval-partial`);
    const partialOutcome = await waitRunOutcome(shellWin, WAIT_RUN);
    const partialCtx = await ctx(shellWin);
    const partialFlagLine = await textOf(shellWin, `${R}.backtest-assumptions-flags`);
    await step('C10', '[보유 구간만으로 실행]이 실제로 돌고 partial 플래그를 남긴다', () => ({
      ok: !!partialOutcome && partialOutcome.view === 'result'
            && Array.isArray(partialCtx.lastResult && partialCtx.lastResult.flags)
            && partialCtx.lastResult.flags.some((f) => String(f).indexOf('보유 구간만 실행') === 0),
      data: {
              view: partialOutcome && partialOutcome.view,
              flags: partialCtx.lastResult ? partialCtx.lastResult.flags : null,
              line: partialFlagLine,
            },
    }));
    await step('C11', 'partial 플래그가 결과 화면 "가정" 줄에도 적힌다', () => ({
      ok: typeof partialFlagLine === 'string' && partialFlagLine.indexOf('플래그 ·') === 0
            && partialFlagLine.indexOf('보유 구간만 실행') !== -1,
      data: { line: partialFlagLine },
    }));

    // --- 취소 ---
    await prepareForm(shellWin, UNCACHED_FROM, TO);
    await click(shellWin, `${R}.backtest-run-button`);
    const approvalAgain = await waitRunOutcome(shellWin, WAIT_RUN);
    await click(shellWin, `${R}.backtest-approval-cancel`);
    await wait(400);
    const cancelled = await js(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        view: c.view, tab: c.tab,
        presets: document.querySelectorAll('${R}.backtest-preset-item').length,
      };
    })()`);
    await step('C12', '승인 화면 [취소]가 설계로 돌려보낸다', () => ({
      ok: !!approvalAgain && approvalAgain.view === 'approval'
            && cancelled.view === 'design' && cancelled.tab === 'design' && cancelled.presets === 10,
      data: cancelled,
    }));

    skip(
      'C13', 'POST /data/backfill 성공 경로',
      '실제 수집은 키움 mock REST에 cont-yn 페이징으로 붙어 쿼터를 태운다 — 프로브가 자동으로 켜지 않는다'
      + ' (인벤토리 be-backfill-202: "Human-click-only by design, requires live Kiwoom credentials").'
      + ' 대신 409 승인 화면(C04~C09)과 allow_partial 경로(C10)로 그 앞뒤를 잰다.',
    );

    await prepareForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // D 실행 · 결과(폼 경로)
  // ==================================================================
  if (on('D')) await section('D', async () => {
    await prepareForm(shellWin, FROM, TO);
    await click(shellWin, `${R}.backtest-run-button`);
    const outcome = await waitRunOutcome(shellWin, WAIT_RUN);
    const resultCtx = await ctx(shellWin);
    await step('D01', '폼 경로 실행이 결과 화면까지 간다', () => ({
      ok: !!outcome && outcome.view === 'result' && outcome.tab === 'result'
            && resultCtx.lastResult && resultCtx.lastResult.status === 'done',
      data: { outcome, runId: resultCtx.lastResult && resultCtx.lastResult.runId },
    }));

    const tiles = await js(shellWin, `(() => {
      const list = Array.from(document.querySelectorAll('${R}.backtest-metric-tile'));
      return list.map((t) => ({
        label: (t.querySelector('.backtest-metric-label') || {}).textContent,
        value: (t.querySelector('.backtest-metric-value') || {}).textContent,
        sub: (t.querySelector('.backtest-metric-sub') || {}).textContent || '',
      }));
    })()`);
    await step('D02', '지표 타일 6장이 계약 순서로 뜬다', () => ({
      ok: tiles.length === 6 && JSON.stringify(tiles.map((t) => t.label))
            === JSON.stringify(['총수익률', 'CAGR', 'Sharpe', 'MDD', '승률', 'Profit Factor']),
      data: { labels: tiles.map((t) => t.label) },
    }));
    await step('D03', '타일 값이 전부 실제 숫자다(— 없음)', () => ({
      ok: tiles.length === 6 && tiles.every((t) => t.value && t.value !== '—'),
      data: { values: tiles.map((t) => t.value) },
    }));
    const subs = tiles.map((t) => t.sub).filter(Boolean);
    await step('D04', '타일 부제가 백엔드 값으로 채워진다', () => ({
      ok: subs.length >= 5,
      data: { subs },
    }));

    const equity = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const strategy = root.querySelector('.backtest-equity-strategy');
      return {
        svg: root.querySelectorAll('.backtest-equity-svg').length,
        strategy: root.querySelectorAll('.backtest-equity-strategy').length,
        d: strategy ? String(strategy.getAttribute('d')).slice(0, 1) : null,
        benchmark: root.querySelectorAll('.backtest-equity-benchmark').length,
        buys: root.querySelectorAll('.backtest-equity-marker.is-buy').length,
        sells: root.querySelectorAll('.backtest-equity-marker.is-sell').length,
        axis: Array.from(root.querySelectorAll('.backtest-equity-axis span')).map((s) => s.textContent),
        legend: [
          (root.querySelector('.backtest-legend-strategy') || {}).textContent,
          (root.querySelector('.backtest-legend-benchmark') || {}).textContent,
          (root.querySelector('.backtest-legend-entry') || {}).textContent,
          (root.querySelector('.backtest-legend-exit') || {}).textContent,
        ],
      };
    })()`);
    await step('D05', '자산곡선 SVG와 전략 path가 그려진다', () => ({
      ok: equity.svg === 1 && equity.strategy === 1 && equity.d === 'M',
      data: { svg: equity.svg, strategy: equity.strategy, dStart: equity.d },
    }));
    await step('D06', '매수보유(벤치마크) 곡선이 그려진다', () => ({
      ok: equity.benchmark >= 1,
      data: {
              benchmark: equity.benchmark,
              known_gap: 'state.closes에 대입하는 코드가 저장소에 없다(backtest-canvas.js:1605) — 범례 "매수보유"만 있고 선이 없다',
            },
    }));
    await step('D07', '진입·청산 마커가 체결 위에 찍힌다', () => ({
      ok: equity.buys > 0 && equity.sells > 0,
      data: { buys: equity.buys, sells: equity.sells },
    }));
    await step('D08', '자산곡선 x축이 처음·중간·마지막 3점을 적는다', () => ({
      ok: equity.axis.length === 3 && equity.axis.every((a) => /^\d{4}/.test(String(a || ''))),
      data: { axis: equity.axis },
    }));
    await step('D09', '자산곡선 범례 4개', () => ({
      ok: JSON.stringify(equity.legend) === JSON.stringify(['전략', '매수보유', '진입', '청산']),
      data: { legend: equity.legend },
    }));

    const runId = resultCtx.lastResult ? resultCtx.lastResult.runId : null;
    const tradesEnvelope = runId
      ? await invoke(shellWin, 'athena:backtest-trades', { run_id: runId })
      : null;
    const trades = tradesEnvelope && tradesEnvelope.ok && tradesEnvelope.data
      ? (tradesEnvelope.data.trades || []) : [];

    const tradeHead = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const head = root.querySelector('.backtest-trades-head');
      return {
        cols: head ? Array.from(head.querySelectorAll('.backtest-trades-cell')).map((c) => c.textContent) : [],
        rows: root.querySelectorAll('.backtest-trades-row').length,
        title: (root.querySelector('.backtest-trades-title') || {}).textContent,
      };
    })()`);
    await step('D10', '체결 표 머리 7열', () => ({
      ok: JSON.stringify(tradeHead.cols)
            === JSON.stringify(['일자', '방향', '체결가', '수량', '비용', '손익', '사유']),
      data: { cols: tradeHead.cols },
    }));
    await step('D11', '체결 표 행 수가 백엔드 체결 수와 같다(머리 1행 포함)', () => ({
      ok: trades.length > 0 && tradeHead.rows === trades.length + 1,
      data: { domRows: tradeHead.rows, backendTrades: trades.length, title: tradeHead.title },
    }));

    const costCell = await js(shellWin, `(() => {
      const F = window.AthenaLib.FactsCard;
      const trades = ${JSON.stringify(trades)};
      const rows = Array.from(document.querySelectorAll('${R}.backtest-trades-row')).slice(1);
      const idx = trades.findIndex((t) => t.side === 'sell');
      if (idx === -1) return { ok: false, reason: '매도 체결이 없다' };
      if (!rows[idx]) return { ok: false, reason: '해당 행이 화면에 없다' };
      const cells = rows[idx].querySelectorAll('.backtest-trades-cell');
      const fee = Number(trades[idx].fee) || 0;
      const tax = Number(trades[idx].tax) || 0;
      const expected = F.formatNumeric(fee + tax);
      return {
        ok: cells[4].textContent === expected && tax > 0,
        expected, actual: cells[4].textContent, fee, tax,
      };
    })()`);
    await step('D12', '비용 셀이 수수료 + 매도 거래세다(세금을 버리지 않는다)', () => ({
      ok: costCell.ok === true,
      data: costCell,
    }));

    const stdout = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const panel = root.querySelector('.backtest-stdout');
      if (!panel) return null;
      return {
        title: (panel.querySelector('.backtest-card-title') || {}).textContent,
        note: (panel.querySelector('.backtest-card-note') || {}).textContent,
        text: (panel.querySelector('.backtest-stdout-text') || {}).textContent,
      };
    })()`);
    await step('D13', '코드 출력 패널이 폼 경로에서도 자리를 지킨다', () => ({
      ok: !!stdout && stdout.title === '코드 출력' && stdout.note === 'print 그대로'
            && stdout.text === '출력이 없습니다',
      data: stdout,
    }));

    const resultAssumptions = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const wrap = root.querySelector('.backtest-result .backtest-assumptions');
      if (!wrap) return null;
      return {
        title: (wrap.querySelector('.backtest-assumptions-title') || {}).textContent,
        text: (wrap.querySelector('.backtest-assumptions-text') || {}).textContent,
        flags: (wrap.querySelector('.backtest-assumptions-flags') || {}).textContent || null,
      };
    })()`);
    await step('D14', '결과 화면에도 체결 가정이 붙는다', () => ({
      ok: !!resultAssumptions && resultAssumptions.title === '체결 가정'
            && resultAssumptions.text.indexOf('다음 봉 시가') !== -1,
      data: { title: resultAssumptions && resultAssumptions.title },
    }));

    const backendFlags = (resultCtx.lastResult && resultCtx.lastResult.flags) || [];
    await step('D15', '플래그 줄은 플래그가 있을 때만 뜨고, 있으면 그 문구를 그대로 적는다', () => ({
      ok: backendFlags.length
            ? (!!resultAssumptions && !!resultAssumptions.flags
                && backendFlags.every((f) => resultAssumptions.flags.indexOf(String(f)) !== -1))
            : (!!resultAssumptions && resultAssumptions.flags === null),
      data: { backendFlags, line: resultAssumptions && resultAssumptions.flags },
    }));

    const runPathBadge = await textOf(shellWin, `${R}.backtest-result-runpath`);
    await step('D16', '결과 배지가 "폼 경로"라고 적는다', () => ({
      ok: runPathBadge === '폼 경로',
      data: { badge: runPathBadge },
    }));
    await step('D17', '백엔드 metrics.run_path가 form이다', () => ({
      ok: !!resultCtx.lastResult && resultCtx.lastResult.metrics
            && resultCtx.lastResult.metrics.run_path === 'form'
            && Number(resultCtx.lastResult.metrics.bars) > 0,
      data: resultCtx.lastResult ? resultCtx.lastResult.metrics : null,
    }));
  });

  // ==================================================================
  // E 코드 경로
  // ==================================================================
  let deployBlockedObs = null;
  if (on('E')) await section('E', async () => {
    // 저장 전 배포 화면(J01)은 activeVersionId가 null인 지금만 볼 수 있다 — 여기서 재둔다.
    deployBlockedObs = await observeDeployBlocked(shellWin);

    await prepareForm(shellWin, FROM, TO);
    sendChat(shellWin, {
      kind: 'code_draft', source: SRC_GOOD, note: '프로브 코드', suggest_validate: true,
    });
    const codeIn = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const ta = root.querySelector('.backtest-code-host .backtest-code-textarea');
      if (!ta || ta.value.indexOf('probe-code-path') === -1) return null;
      const sub = root.querySelector('.backtest-subtab.is-on');
      return {
        subtab: sub ? sub.textContent : null,
        lines: ta.value.split('\\n').length,
        ariaLabel: ta.getAttribute('aria-label'),
        gutter: root.querySelectorAll('.backtest-code-gutter .backtest-code-line').length,
      };
    })()`, WAIT_UI);
    await step('E01', '코드가 편집기에 바로 들어가고 코드 탭으로 옮겨간다', () => ({
      ok: !!codeIn && codeIn.subtab === '코드 · 최후의 보루' && codeIn.ariaLabel === '전략 파이썬 코드'
            && codeIn.gutter === codeIn.lines,
      data: codeIn,
    }));

    const codeCtx = await ctx(shellWin);
    await step('E02', '코드가 들어오면 실행경로가 코드로 강제된다', () => ({
      ok: codeCtx.runPath === 'code',
      data: { runPath: codeCtx.runPath },
    }));

    const runPathItems = await js(shellWin, `(() => {
      const list = Array.from(document.querySelectorAll('${R}.backtest-runpath-item'));
      return list.map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
    })()`);
    await step('E03', '코드가 있어야만 실행경로 갈래(폼/코드)가 헤더에 생긴다', () => ({
      ok: JSON.stringify(runPathItems) === JSON.stringify([['폼', 'false'], ['코드', 'true']]),
      data: { items: runPathItems },
    }));

    // 검증이 실제로 백엔드를 도는지 — 나쁜 코드로 먼저 확인한다.
    await setInput(shellWin, `${R}.backtest-code-host .backtest-code-textarea`, SRC_NO_SIGNALS);
    await wait(200);
    await click(shellWin, `${R}.backtest-code-validate`);
    const badValidate = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return c.code.errors.length ? { errors: c.code.errors } : null;
    })()`, WAIT_VALIDATE);
    await step('E04', '코드 탭 [검증]이 계약 위반을 백엔드에서 잡아온다', () => ({
      ok: !!badValidate && badValidate.errors.some((e) => String(e).indexOf('def signals(df, p)') !== -1),
      data: badValidate,
    }));

    await setInput(shellWin, `${R}.backtest-code-host .backtest-code-textarea`, SRC_GOOD);
    await wait(200);
    await click(shellWin, `${R}.backtest-code-validate`);
    const goodValidate = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const lines = document.querySelectorAll('${R}.backtest-code-tab .backtest-design-error-line').length;
      if (c.code.errors.length) return null;
      return { errors: c.code.errors.length, lines };
    })()`, WAIT_VALIDATE);
    await step('E05', '검증을 통과한 코드는 오류 줄이 비워진다', () => ({
      ok: !!goodValidate && goodValidate.errors === 0 && goodValidate.lines === 0,
      data: goodValidate,
    }));

    const bounds = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      return {
        ok: (root.querySelector('.backtest-code-bounds-ok') || {}).textContent,
        no: (root.querySelector('.backtest-code-bounds-no') || {}).textContent,
        note: (root.querySelector('.backtest-code-bounds-note') || {}).textContent,
      };
    })()`);
    await step('E06', '코드 권한 경계 패널이 닿는 것과 안 닿는 것을 적는다', () => ({
      ok: bounds.ok === '건네받은 봉 데이터 · pandas · numpy · athena_bt'
            && bounds.no === '키움 자격증명 · 계좌 · DB · 네트워크 — 넘기지 않습니다'
            && String(bounds.note).indexOf('작정한 공격자') !== -1,
      data: bounds,
    }));

    // --- 저장 ---
    await click(shellWin, `${R}.backtest-code-save`);
    const saved = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      if (!c.code.strategyId || !c.code.activeVersionId) return null;
      return { strategyId: c.code.strategyId, activeVersionId: c.code.activeVersionId };
    })()`, WAIT_VALIDATE);
    await step('E07', '[이 코드로 저장]이 전략과 활성 버전을 만든다', () => ({
      ok: !!saved && !!saved.strategyId && !!saved.activeVersionId,
      data: saved,
    }));
    if (saved && saved.strategyId) created.strategyIds.push(saved.strategyId);

    const versionBadge = await textOf(shellWin, `${R}.backtest-head-version`);
    await step('E08', '저장 뒤 헤더에 "코드 버전 활성" 배지가 켜진다', () => ({
      ok: versionBadge === '코드 버전 활성',
      data: { badge: versionBadge },
    }));

    await step('E09', '저장된 버전이 origin=human · active=true로 남는다', async () => {
      if (!saved || !saved.strategyId) {
        return { skip: '저장이 실패해 strategy_id가 없다', name: '저장된 버전 조회' };
      }
      const versions = await invoke(shellWin, 'athena:backtest-versions', { strategy_id: saved.strategyId });
      const list = versions && versions.ok && versions.data ? (versions.data.versions || []) : [];
      return {
        ok: list.length === 1 && list[0].origin === 'human' && list[0].active === true
              && list[0].version === 1 && String(list[0].source).indexOf('probe-code-path') !== -1,
        data: list.map((v) => ({ version: v.version, origin: v.origin, active: v.active })),
      };
    });

    // --- 코드 경로 실행 ---
    await click(shellWin, `${R}.backtest-run-button`);
    const codeOutcome = await waitRunOutcome(shellWin, WAIT_RUN);
    const codeResultCtx = await ctx(shellWin);
    await step('E10', '코드 경로 실행이 결과까지 간다', () => ({
      ok: !!codeOutcome && codeOutcome.view === 'result'
            && codeResultCtx.lastResult && codeResultCtx.lastResult.status === 'done',
      data: { outcome: codeOutcome, runId: codeResultCtx.lastResult && codeResultCtx.lastResult.runId },
    }));

    const codeBadge = await textOf(shellWin, `${R}.backtest-result-runpath`);
    await step('E11', '결과 배지가 "코드 경로"라고 적는다', () => ({
      ok: codeBadge === '코드 경로',
      data: { badge: codeBadge },
    }));
    await step('E12', '백엔드 metrics.run_path가 code다', () => ({
      ok: !!codeResultCtx.lastResult && codeResultCtx.lastResult.metrics
            && codeResultCtx.lastResult.metrics.run_path === 'code',
      data: codeResultCtx.lastResult ? codeResultCtx.lastResult.metrics : null,
    }));

    const codeStdout = await textOf(shellWin, `${R}.backtest-stdout-text`);
    await step('E13', '코드의 print가 stdout 패널에 그대로 남는다', () => ({
      ok: typeof codeStdout === 'string' && codeStdout.indexOf('probe-code-path') !== -1,
      data: { stdout: String(codeStdout).slice(0, 80) },
    }));

    const codeFlags = (codeResultCtx.lastResult && codeResultCtx.lastResult.flags) || [];
    await step('E14', '코드 경로는 "워밍업 미산출" 플래그를 달고 온다', () => ({
      ok: codeFlags.some((f) => String(f).indexOf('코드 경로 · 워밍업 미산출') === 0),
      data: { flags: codeFlags },
    }));

    // --- 코드 경로는 폼 조건을 보지 않는다 ---
    await goDesignForm(shellWin);
    for (let i = 0; i < 8; i += 1) {
      const removed = await js(shellWin, `(() => {
        const card = document.querySelectorAll('${R}.backtest-condition-card')[0];
        if (!card) return false;
        const b = card.querySelector('.backtest-condition-remove');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      if (!removed) break;
      await wait(150);
    }
    const strippedCtx = await ctx(shellWin);
    await step('E15', '진입 조건을 다 지우면 컨텍스트 pending이 그것을 적는다', () => ({
      ok: strippedCtx.spec.entry.conditions.length === 0
            && strippedCtx.pending.indexOf('진입 조건이 하나도 없습니다') !== -1,
      data: { conditions: strippedCtx.spec.entry.conditions.length, pending: strippedCtx.pending },
    }));

    await click(shellWin, `${R}.backtest-run-button`);
    const noCondOutcome = await waitRunOutcome(shellWin, WAIT_RUN);
    const noCondErrors = await js(shellWin, `(() =>
      Array.from(document.querySelectorAll('${R}.backtest-design-error-line')).map((e) => e.textContent)
    )()`);
    await step('E16', '조건이 없어도 코드 경로는 실행된다(신호는 파이썬이 만든다)', () => ({
      ok: !!noCondOutcome && noCondOutcome.view === 'result'
            && !noCondErrors.some((e) => String(e).indexOf('진입 조건') !== -1),
      data: { outcome: noCondOutcome, errors: noCondErrors },
    }));

    await prepareForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // F 오류 · 진단
  // ==================================================================
  if (on('F')) await section('F', async () => {
    await prepareForm(shellWin, FROM, TO);
    sendChat(shellWin, { kind: 'code_draft', source: SRC_BROKEN_IMPORT, note: '차단 import' });
    await until(shellWin, `(() => {
      const ta = document.querySelector('${R}.backtest-code-host .backtest-code-textarea');
      return ta && ta.value.indexOf('import os') === 0 ? true : null;
    })()`, WAIT_UI);

    await click(shellWin, `${R}.backtest-run-button`);
    const failOutcome = await waitRunOutcome(shellWin, WAIT_RUN);
    await step('F01', '실패한 코드 실행은 에러 화면이 아니라 진단 화면으로 간다', () => ({
      ok: !!failOutcome && failOutcome.view === 'diagnosis',
      data: failOutcome,
    }));

    const diag = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      if (!root.querySelector('.backtest-diagnosis')) return null;
      return {
        title: (root.querySelector('.backtest-diag-title') || {}).textContent,
        detail: (root.querySelector('.backtest-diag-detail') || {}).textContent,
        whyTitle: (root.querySelector('.backtest-diag-section-title') || {}).textContent,
        why: (root.querySelector('.backtest-diag-why') || {}).textContent,
        rawHidden: (root.querySelector('.backtest-diag-raw') || {}).hidden,
        rawToggle: (root.querySelector('.backtest-diag-raw-toggle') || {}).textContent,
        stat: (root.querySelector('.backtest-diag-fix-stat') || {}).textContent || null,
        summary: (root.querySelector('.backtest-diag-fix-summary') || {}).textContent || null,
        adds: root.querySelectorAll('.backtest-diag-diff .backtest-diff-row.is-add').length,
        dels: root.querySelectorAll('.backtest-diag-diff .backtest-diff-row.is-del').length,
        buttons: Array.from(root.querySelectorAll('.backtest-diag-actions button')).map((b) => b.textContent),
      };
    })()`);
    await step('F02', '진단 배너가 제목과 설명을 적는다', () => ({
      ok: !!diag && String(diag.title).indexOf('os') !== -1 && String(diag.detail).length > 0,
      data: { title: diag && diag.title, detail: diag && diag.detail },
    }));
    await step('F03', '"왜 이렇게 됐나" 절이 백엔드 문장을 그대로 싣는다', () => ({
      ok: !!diag && diag.whyTitle === '왜 이렇게 됐나' && String(diag.why).length > 20,
      data: { whyTitle: diag && diag.whyTitle, why: diag && String(diag.why).slice(0, 60) },
    }));

    const diagCtx = await ctx(shellWin);
    await step('F04', '진단이 코드의 몇 번째 줄인지 짚는다', () => ({
      ok: !!diagCtx.diagnosis && Number.isInteger(diagCtx.diagnosis.line),
      data: diagCtx.diagnosis,
    }));

    await click(shellWin, `${R}.backtest-diag-raw-toggle`);
    await wait(250);
    const raw = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const r = root.querySelector('.backtest-diag-raw');
      const t = root.querySelector('.backtest-diag-raw-toggle');
      return { hidden: r.hidden, label: t.textContent, text: (r.textContent || '').slice(0, 120) };
    })()`);
    await step('F05', '[파이썬 원문 보기]가 원문을 펴고 라벨을 바꾼다', () => ({
      ok: diag && diag.rawHidden === true && raw.hidden === false
            && raw.label === '파이썬 원문 접기' && raw.text.length > 0,
      data: { before: diag && diag.rawHidden, after: raw.hidden, label: raw.label },
    }));

    await step('F06', '수정안 diff가 삭제/추가 줄 수와 함께 뜬다', () => ({
      ok: !!diag && /줄 삭제 · .*줄 추가/.test(String(diag.stat || '')) && diag.dels >= 1,
      data: { stat: diag && diag.stat, adds: diag && diag.adds, dels: diag && diag.dels, summary: diag && diag.summary },
    }));
    await step('F07', '진단 화면 버튼 3종', () => ({
      ok: !!diag && JSON.stringify(diag.buttons)
            === JSON.stringify(['적용하고 다시 실행', '지도만 고치기', '버리기']),
      data: diag ? { buttons: diag.buttons } : null,
    }));

    await click(shellWin, `${R}.backtest-diag-apply-only`);
    const appliedOnly = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.view !== 'design' || c.designTab !== 'code') return null;
      const ta = document.querySelector('${R}.backtest-code-host .backtest-code-textarea');
      if (!ta) return null;
      return {
        view: c.view, designTab: c.designTab,
        hasImport: ta.value.indexOf('import os') !== -1,
        hasSignals: ta.value.indexOf('def signals') !== -1,
      };
    })()`, WAIT_UI);
    await step('F08', '[지도만 고치기] — 코드만 고치고 실행하지 않는다', () => ({
      ok: !!appliedOnly && appliedOnly.view === 'design' && appliedOnly.designTab === 'code'
            && appliedOnly.hasImport === false && appliedOnly.hasSignals === true,
      data: appliedOnly,
    }));

    // 다시 깨뜨린 뒤 [적용하고 다시 실행]
    sendChat(shellWin, { kind: 'code_draft', source: SRC_BROKEN_IMPORT, note: '차단 import 재현' });
    await until(shellWin, `(() => {
      const ta = document.querySelector('${R}.backtest-code-host .backtest-code-textarea');
      return ta && ta.value.indexOf('import os') === 0 ? true : null;
    })()`, WAIT_UI);
    await click(shellWin, `${R}.backtest-run-button`);
    const secondDiag = await waitRunOutcome(shellWin, WAIT_RUN);
    let applyRunOutcome = null;
    if (secondDiag && secondDiag.view === 'diagnosis') {
      // 클릭을 **진단 화면에서** 낸다 — 여기서 waitRunOutcome을 쓰면 아직 시작도 안 한 그
      // 진단 화면이 곧바로 결과로 잡힌다. 새 runId가 붙은 화면만 새 실행이다.
      const prevRunId = await currentRunId(shellWin);
      await click(shellWin, `${R}.backtest-diag-apply`);
      applyRunOutcome = await waitNewRunOutcome(shellWin, prevRunId, WAIT_RUN);
    }
    const fixedCtx = await ctx(shellWin);
    await step('F09', '[적용하고 다시 실행]이 고친 코드로 성공까지 간다', () => ({
      ok: !!applyRunOutcome && applyRunOutcome.view === 'result'
            && fixedCtx.lastResult && fixedCtx.lastResult.status === 'done'
            && fixedCtx.code.source.indexOf('import os') === -1,
      data: { second: secondDiag, applied: applyRunOutcome, status: fixedCtx.lastResult && fixedCtx.lastResult.status },
    }));

    // --- 에러 화면과 [설계로 돌아가기] ---
    // 전제는 이 검사가 **스스로** 세운다. 앞 검사가 남긴 화면을 물려받으면(F09가 결과 화면에
    // 서 있으면) 여기의 setDates는 없는 입력칸을 만지고 실행 클릭은 없는 버튼으로 흘러,
    // 90초 뒤 에러 패널 대신 null을 본다(2026-09-02 실측).
    let emptyReady = null;
    for (let attempt = 0; attempt < 2 && !emptyReady; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ensureRunnableForm(shellWin, EMPTY_FROM, EMPTY_TO);
      // eslint-disable-next-line no-await-in-loop
      emptyReady = await until(shellWin, `(() => {
        const c = window.AthenaBacktestCanvas.getContext();
        if (c.view !== 'design') return null;
        if (c.spec.fromDt !== ${JSON.stringify(EMPTY_FROM)}) return null;
        if (c.spec.toDt !== ${JSON.stringify(EMPTY_TO)}) return null;
        if (!document.querySelector('${R}.backtest-run-button')) return null;
        return { view: c.view, fromDt: c.spec.fromDt, toDt: c.spec.toDt };
      })()`, WAIT_UI);
    }
    if (!emptyReady) {
      console.log('[probe-backtest-full] WARN — F10 전제(캐시 밖 구간 설계 화면)를 세우지 못했다');
    }
    await click(shellWin, `${R}.backtest-run-button`);
    const emptyApproval = await waitRunOutcome(shellWin, WAIT_RUN);
    if (emptyApproval && emptyApproval.view === 'approval') {
      await click(shellWin, `${R}.backtest-approval-partial`);
    }
    const errView = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const panel = root.querySelector('.backtest-canvas-error');
      if (!panel) return null;
      return {
        title: (panel.querySelector('.backtest-canvas-empty-title') || {}).textContent,
        sub: (panel.querySelector('.backtest-canvas-empty-sub') || {}).textContent,
        back: panel.querySelectorAll('.backtest-error-back').length,
        tabs: root.querySelectorAll('.backtest-tab').length,
      };
    })()`, WAIT_RUN);
    await step('F10', '캐시가 0봉인 구간의 부분 실행은 정직한 에러 화면이 된다', () => ({
      ok: !!errView && errView.title === '백테스트' && String(errView.sub).length > 12
            && errView.back === 1 && errView.tabs === 0,
      data: errView,
    }));

    // F10이 세운 에러 화면에서만 잴 수 있다 — 다른 화면에서 누른 [설계로 돌아가기]는
    // 이 검사가 재려는 것이 아니다. 앞 검사의 화면을 물려받아 판정하지 않는다.
    await step('F11', '[설계로 돌아가기]가 막다른 길을 없앤다', async () => {
      if (!errView) {
        return { skip: 'F10이 에러 화면을 세우지 못했다 — 없앨 막다른 길이 없다' };
      }
      await click(shellWin, `${R}.backtest-error-back`);
      const backFromError = await until(shellWin, `(() => {
        const c = window.AthenaBacktestCanvas.getContext();
        if (c.view !== 'design') return null;
        return {
          view: c.view, tab: c.tab, designTab: c.designTab,
          presets: document.querySelectorAll('${R}.backtest-preset-item').length,
        };
      })()`, WAIT_UI);
      return {
        ok: !!backFromError && backFromError.view === 'design' && backFromError.tab === 'design'
              && backFromError.designTab === 'form' && backFromError.presets === 10,
        data: backFromError,
      };
    });

    await prepareForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // G 흐름 지도
  // ==================================================================
  if (on('G')) await section('G', async () => {
    // F가 진단·에러 화면에서 끝나면 모드 탭이 아예 없다 — 먼저 설계로 돌려놓는다.
    await ensureRunnableForm(shellWin, FROM, TO);
    await goDesignForm(shellWin);
    await goSubtab(shellWin, 0);
    await wait(400);
    // **계약이 바뀐 자리다**(2026-09-03): 스펙 경로의 지도 탭에서 요약 지도를 없앴다.
    // 그래서 대상 한 줄은 요약 지도의 `.backtest-map-target-text`가 아니라 편집 가능한
    // 지도의 `.backtest-visual-target`이고, 판 번호는 그 머리줄에 적힌다. 칸 ①~④는
    // 여전히 만들어지고(대화가 그것으로 답한다) 컨텍스트에서 그대로 잰다 — 코드 경로의
    // 읽기 전용 지도는 아래 G02부터 그대로다.
    const formMap = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      const nodes = (c.map && c.map.nodes) || [];
      if (!nodes.length) return null;
      return {
        designTab: c.designTab,
        numerals: nodes.map((n) => n.numeral),
        target: (root.querySelector('.backtest-visual-target') || {}).textContent || null,
        head: (root.querySelector('.backtest-visual-head .backtest-card-title') || {}).textContent || null,
        editor: root.querySelectorAll('.backtest-vis').length,
        summaryNodes: root.querySelectorAll('.backtest-flow-node').length,
        empty: root.querySelectorAll('.backtest-flow-tab .backtest-card-empty').length,
      };
    })()`, WAIT_VALIDATE);
    await step('G01', '코드가 없어도 폼 경로의 지도가 편집 표면으로 서고 칸 ①~④가 만들어진다', () => ({
      ok: !!formMap && formMap.designTab === 'flow' && formMap.empty === 0
            && JSON.stringify(formMap.numerals) === JSON.stringify(['①', '②', '③', '④'])
            && !!formMap.target && formMap.target.indexOf(STK) === 0
            && formMap.editor === 1 && formMap.summaryNodes === 0
            && /^이 전략은 이렇게 흐릅니다 · 지도 v\d+$/.test(String(formMap.head || '')),
      data: formMap,
    }));

    sendChat(shellWin, { kind: 'code_draft', source: SRC_FLOW, note: '흐름용 코드' });
    await until(shellWin, `(() => {
      const ta = document.querySelector('${R}.backtest-code-host .backtest-code-textarea');
      return ta && ta.value.indexOf('n = int(p["fast"])') !== -1 ? true : null;
    })()`, WAIT_UI);
    sendChat(shellWin, { kind: 'navigate', tab: 'design', designTab: 'flow' });

    const flow = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const nodes = Array.from(root.querySelectorAll('button.backtest-flow-node.is-mine'));
      if (!nodes.length) return null;
      return {
        mine: nodes.length,
        titles: nodes.map((n) => (n.querySelector('.backtest-flow-title') || {}).textContent),
        details: nodes.map((n) => Array.from(n.querySelectorAll('.backtest-flow-detail'))
          .map((d) => d.textContent).join(' | ')),
        boundaries: Array.from(root.querySelectorAll('.backtest-flow-boundary-label'))
          .map((n) => n.textContent),
        appNodes: root.querySelectorAll('.backtest-flow-node.is-app').length,
        drawer: (root.querySelector('.backtest-map-drawer-text') || {}).textContent || null,
        error: root.querySelectorAll('.backtest-flow-error').length,
      };
    })()`, WAIT_VALIDATE);
    await step('G02', '코드 경로의 지도도 같은 ①~④ 네 칸이다', () => ({
      ok: !!flow && flow.mine === 4 && flow.error === 0,
      data: flow ? { mine: flow.mine, titles: flow.titles } : null,
    }));
    await step('G03', '경계 3줄 — 마지막 줄이 "두 열만 받습니다"를 함께 적는다', () => ({
      ok: !!flow && flow.boundaries.length === 3
            && flow.boundaries[1] === '여기부터 내 전략 — 대화로 고치는 칸들'
            && flow.boundaries[2].indexOf('entry·exit 두 열만 받습니다') !== -1,
      data: flow ? { boundaries: flow.boundaries } : null,
    }));
    await step('G04', '앱 구간 칸 4개(load + fill·cost·metrics)', () => ({
      ok: !!flow && flow.appNodes === 4,
      data: flow ? { appNodes: flow.appNodes } : null,
    }));
    // 지도는 줄 번호로 말하지 않는다 — 줄은 서랍(코드)에서만 뜻이 있다.
    await step('G05', '칸은 사람 말 문장을 적고 줄 번호를 적지 않는다', () => ({
      ok: !!flow && flow.details.some((d) => String(d).length > 0)
            && flow.details.every((d) => !/^\d+–\d+줄$/.test(String(d || '')))
            && !!flow.drawer && flow.drawer.indexOf('이 지도 뒤의 코드') === 0,
      data: flow ? { details: flow.details, drawer: flow.drawer } : null,
    }));

    const clicked = await js(shellWin, `(() => {
      const nodes = Array.from(document.querySelectorAll('button.backtest-flow-node.is-mine'));
      const target = nodes[1];
      if (!target) return null;
      const title = (target.querySelector('.backtest-flow-title') || {}).textContent || '';
      target.click();
      return { title };
    })()`);
    const lit = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'code') return null;
      const lines = Array.from(document.querySelectorAll('${R}.backtest-code-gutter .backtest-code-line.is-lit'));
      if (!lines.length) return null;
      return { lit: lines.map((l) => Number(l.textContent)) };
    })()`, WAIT_UI);
    await step('G06', '코드 경로의 칸을 누르면 코드 탭에서 그 줄이 켜진다', () => ({
      ok: !!lit && lit.lit.length > 0,
      data: { lit: lit && lit.lit, clicked: clicked && clicked.title },
    }));
  });

  // ==================================================================
  // H 이력 · 비교
  // ==================================================================
  if (on('H')) await section('H', async () => {
    // 이력 탭도 모드 탭을 눌러야 열린다 — 앞 섹션이 막다른 화면에 멈춰 있으면 못 누른다.
    await ensureRunnableForm(shellWin, FROM, TO);
    await goTab(shellWin, 2);
    const history = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const rows = Array.from(root.querySelectorAll('.backtest-history-row'));
      if (!rows.length) return null;
      return {
        rows: rows.length,
        title: (root.querySelector('.backtest-history .backtest-card-title') || {}).textContent,
        note: (root.querySelector('.backtest-history .backtest-card-note') || {}).textContent,
        first: {
          check: (rows[0].querySelector('.backtest-history-check') || {}).textContent,
          id: (rows[0].querySelector('.backtest-history-id') || {}).textContent,
          status: (rows[0].querySelector('.backtest-history-status') || {}).textContent,
          statusClass: (rows[0].querySelector('.backtest-history-status') || {}).className,
          ret: (rows[0].querySelector('.backtest-history-return') || {}).textContent,
        },
        failed: rows.filter((r) => {
          const s = r.querySelector('.backtest-history-status');
          return s && s.className.indexOf('is-failed') !== -1;
        }).map((r) => (r.querySelector('.backtest-history-return') || {}).textContent),
      };
    })()`, WAIT_VALIDATE);
    await step('H01', '이력 탭이 실행 목록을 백엔드에서 불러온다', () => ({
      ok: !!history && history.rows > 0 && /^실행 이력 .+건$/.test(history.title || ''),
      data: history ? { rows: history.rows, title: history.title, note: history.note } : null,
    }));
    await step('H02', '이력 행이 체크·id·상태·수익률 네 칸을 그린다', () => ({
      ok: !!history && history.first.check === '□' && String(history.first.id).length === 8
            && !!history.first.status && !!history.first.ret,
      data: history ? history.first : null,
    }));
    await step('H03', '실패한 실행 행은 failed 상태로 수익률 없이 그려진다', () => ({
      ok: !!history && history.failed.length > 0 && history.failed.every((r) => r === '—'),
      data: history ? { failedRows: history.failed.length, returns: history.failed } : null,
    }));

    // 겹쳐보기는 곡선이 있어야 성립한다 — 실패한 실행에는 equity가 없으므로 done만 고른다.
    const picked = await js(shellWin, `(() => {
      const rows = Array.from(document.querySelectorAll('${R}.backtest-history-row'))
        .filter((r) => {
          const s = r.querySelector('.backtest-history-status');
          return s && s.className.indexOf('is-done') !== -1;
        });
      if (rows.length < 2) return { ok: false, done: rows.length };
      rows[rows.length - 2].click();
      return { ok: true, done: rows.length };
    })()`);
    await wait(400);
    await js(shellWin, `(() => {
      const rows = Array.from(document.querySelectorAll('${R}.backtest-history-row'))
        .filter((r) => {
          const s = r.querySelector('.backtest-history-status');
          return s && s.className.indexOf('is-done') !== -1;
        });
      if (rows.length < 2) return false;
      rows[rows.length - 1].click();
      return true;
    })()`);
    const compare = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const rows = Array.from(root.querySelectorAll('.backtest-compare-row'));
      if (!rows.length) return null;
      return {
        title: (root.querySelector('.backtest-compare .backtest-card-title') || {}).textContent,
        labels: rows.map((r) => (r.querySelector('.backtest-compare-label') || {}).textContent),
        a: rows.map((r) => (r.querySelector('.backtest-compare-a') || {}).textContent),
        b: rows.map((r) => (r.querySelector('.backtest-compare-b') || {}).textContent),
        checked: root.querySelectorAll('.backtest-history-row.is-on').length,
      };
    })()`, WAIT_UI);
    await step('H04', '2건을 고르면 "무엇이 달랐나" 비교 표 4행이 뜬다', () => ({
      ok: picked.ok === true && !!compare && compare.title === '무엇이 달랐나'
            && JSON.stringify(compare.labels) === JSON.stringify(['총수익률', 'Sharpe', 'MDD', '승률'])
            && compare.checked === 2,
      data: compare ? { labels: compare.labels, checked: compare.checked, doneRows: picked.done } : picked,
    }));

    const overlay = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const paths = root.querySelectorAll('.backtest-compare-chart .backtest-equity-overlay');
      if (!paths.length) return null;
      return {
        p0: root.querySelectorAll('.backtest-equity-overlay.is-0').length,
        p1: root.querySelectorAll('.backtest-equity-overlay.is-1').length,
        legend: Array.from(root.querySelectorAll('.backtest-legend-overlay')).map((s) => s.textContent),
      };
    })()`, WAIT_VALIDATE);
    await step('H05', '두 실행의 자산곡선이 겹쳐 그려지고 범례가 붙는다', () => ({
      ok: !!overlay && overlay.p0 === 1 && overlay.p1 === 1 && overlay.legend.length === 2
            && overlay.legend.every((l) => String(l).length === 8),
      data: overlay,
    }));

    const compareDiff = await countOf(shellWin, `${R}.backtest-compare .backtest-diff`);
    await step('H06', '이력 비교에는 파라미터·코드 diff가 없다(미구현 계약)', () => ({
      ok: compareDiff === 0,
      data: {
              diffs: compareDiff,
              note: 'renderCompare(backtest-canvas.js:1717)는 지표 4행 + 곡선 겹치기까지다 — CodeEditor.renderDiff는 아무도 안 부른다',
            },
    }));
  });

  // ==================================================================
  // I 최적화
  // ==================================================================
  if (on('I')) await section('I', async () => {
    await prepareForm(shellWin, FROM, TO);
    await goTab(shellWin, 3);
    await wait(400);
    const setup = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      return {
        ranges: Array.from(root.querySelectorAll('.backtest-optimize-range')).map((r) => r.textContent),
        note: (root.querySelector('.backtest-optimize .backtest-card-note') || {}).textContent,
        methods: Array.from(root.querySelectorAll('.backtest-optimize .backtest-segment-item'))
          .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
        start: root.querySelectorAll('.backtest-optimize-start').length,
      };
    })()`);
    await step('I01', '최적화 탭이 전략 파라미터를 탐색 축으로 세운다', () => ({
      ok: setup.ranges.length === 2 && /^fast .+ step \d+$/.test(setup.ranges[0] || '')
            && setup.note === '캐시만 씁니다 — 추가 TR 호출 없음' && setup.start === 1,
      data: setup,
    }));
    await step('I02', '방식 세그먼트는 그리드가 기본이다', () => ({
      ok: JSON.stringify(setup.methods) === JSON.stringify([['그리드', 'true'], ['랜덤', 'false']]),
      data: { methods: setup.methods },
    }));

    await click(shellWin, `${R}.backtest-optimize-start`);
    const gridResult = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const best = root.querySelector('.backtest-optimize-best-title');
      if (!best) return null;
      return {
        best: best.textContent,
        params: (root.querySelector('.backtest-optimize-best-params') || {}).textContent,
        neighbour: (root.querySelector('.backtest-optimize-neighbour') || {}).textContent || null,
        plateau: (root.querySelector('.backtest-optimize-plateau') || {}).textContent || null,
        cells: root.querySelectorAll('.backtest-heatmap-cell').length,
        heatTitle: (root.querySelector('.backtest-heatmap .backtest-card-title') || {}).textContent,
        firstCell: (() => {
          const c = root.querySelector('.backtest-heatmap-cell');
          return c ? { title: c.getAttribute('title'), style: c.getAttribute('style') } : null;
        })(),
        warnings: Array.from(root.querySelectorAll('.backtest-optimize-warn')).map((w) => ({
          cls: w.className,
          badge: (w.querySelector('.backtest-optimize-warn-badge') || {}).textContent,
          text: (w.querySelector('.backtest-optimize-warn-text') || {}).textContent,
        })),
        apply: root.querySelectorAll('.backtest-optimize-apply').length,
      };
    })()`, WAIT_OPTIMIZE);
    await step('I03', '[탐색 시작](그리드)이 최고 조합 카드를 만든다', () => ({
      ok: !!gridResult && /^최고 Sharpe /.test(gridResult.best) && !!gridResult.params
            && gridResult.apply === 1,
      data: gridResult ? { best: gridResult.best, params: gridResult.params, neighbour: gridResult.neighbour } : null,
    }));
    await step('I04', 'Sharpe 히트맵 격자가 그려진다', () => ({
      ok: !!gridResult && gridResult.cells > 0
            && /^Sharpe 히트맵 — fast × slow$/.test(gridResult.heatTitle || ''),
      data: gridResult ? { cells: gridResult.cells, title: gridResult.heatTitle } : null,
    }));
    await step('I05', '히트맵 셀이 값과 농도를 함께 싣는다', () => ({
      ok: !!gridResult && !!gridResult.firstCell
            && /Sharpe/.test(gridResult.firstCell.title || '')
            && /^opacity:0\.\d\d$/.test(gridResult.firstCell.style || ''),
      data: gridResult ? gridResult.firstCell : null,
    }));

    const optCtx = await ctx(shellWin);
    const backendWarnings = optCtx.optimize.result ? optCtx.optimize.result.warnings : [];
    await step('I06', '과최적화 경고가 백엔드 개수 그대로 그려진다', () => ({
      ok: !!gridResult && gridResult.warnings.length === backendWarnings.length
            && gridResult.warnings.every((w) => w.badge === '과최적화 의심' && String(w.text).length > 0),
      data: { dom: gridResult && gridResult.warnings.length, backend: backendWarnings.length, warnings: backendWarnings },
    }));
    await step('I07', '컨텍스트 optimize가 best·warnings·cells를 싣는다', () => ({
      ok: optCtx.optimize.method === 'grid' && !!optCtx.optimize.result
            && !!optCtx.optimize.result.best && Number(optCtx.optimize.result.cells) > 0,
      data: optCtx.optimize,
    }));

    const bestParams = optCtx.optimize.result && optCtx.optimize.result.best
      ? optCtx.optimize.result.best.params : null;
    await click(shellWin, `${R}.backtest-optimize-apply`);
    await wait(500);
    const appliedCtx = await ctx(shellWin);
    const sliderValues = await js(shellWin, `(() => {
      const list = Array.from(document.querySelectorAll('${R}.backtest-param-slider'));
      const out = {};
      list.forEach((s) => { out[String(s.getAttribute('aria-label')).replace(' 값', '')] = Number(s.value); });
      return out;
    })()`);
    await step('I08', '[이 값을 설계에 넣기]가 최고 조합을 슬라이더에 옮긴다', () => ({
      ok: !!bestParams && appliedCtx.view === 'design' && appliedCtx.designTab === 'form'
            && Object.keys(bestParams).every((k) => sliderValues[k] === Number(bestParams[k])),
      data: { best: bestParams, sliders: sliderValues, view: appliedCtx.view },
    }));

    await goTab(shellWin, 3);
    await wait(300);
    await clickByText(shellWin, `${R}.backtest-optimize .backtest-segment-item`, '랜덤');
    await wait(300);
    const randomPressed = await js(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const list = Array.from(document.querySelectorAll('${R}.backtest-optimize .backtest-segment-item'));
      return { method: c.optimize.method, pressed: list.map((b) => [b.textContent, b.getAttribute('aria-pressed')]) };
    })()`);
    await step('I09', '방식 세그먼트가 랜덤으로 넘어간다', () => ({
      ok: randomPressed.method === 'random'
            && JSON.stringify(randomPressed.pressed) === JSON.stringify([['그리드', 'false'], ['랜덤', 'true']]),
      data: randomPressed,
    }));

    await click(shellWin, `${R}.backtest-optimize-start`);
    const randomResult = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const best = root.querySelector('.backtest-optimize-best-title');
      const err = root.querySelector('.backtest-optimize .backtest-design-error-line');
      if (err) return { error: err.textContent };
      if (!best) return null;
      return { best: best.textContent, cells: root.querySelectorAll('.backtest-heatmap-cell').length };
    })()`, WAIT_OPTIMIZE);
    await step('I10', '랜덤 서치도 같은 자리에서 결과를 낸다', () => ({
      ok: !!randomResult && !randomResult.error && /^최고 Sharpe /.test(randomResult.best || ''),
      data: randomResult,
    }));

    const planEnvelope = await invoke(shellWin, 'athena:backtest-optimize-plan', {
      ranges: [
        { name: 'fast', start: 5, stop: 30, step: 5 },
        { name: 'slow', start: 20, stop: 120, step: 10 },
      ],
    });
    await step('I11', 'IPC optimize-plan이 조합 수를 미리 센다(렌더러에 배선은 없다)', () => ({
      ok: !!planEnvelope && planEnvelope.ok === true && planEnvelope.data
            && planEnvelope.data.max_combinations === 1000
            && planEnvelope.data.values_per_param
            && planEnvelope.data.values_per_param.fast === 6
            && planEnvelope.data.values_per_param.slow === 11,
      data: planEnvelope && planEnvelope.data ? planEnvelope.data : planEnvelope,
    }));
  });

  // ==================================================================
  // J 배포
  // ==================================================================
  if (on('J')) await section('J', async () => {
    // I가 최적화 탭에 머물러 있어도, 앞 섹션이 넘어져 있어도 배포 탭부터 다시 시작한다.
    await ensureRunnableForm(shellWin, FROM, TO);
    const ctxNow = await ctx(shellWin);
    const activeVersionId = ctxNow.code.activeVersionId;

    await step('J01', '저장 전에는 배포를 막고 이유를 적는다', async () => {
      if (deployBlockedObs) {
        return {
          ok: deployBlockedObs.modes === 0 && deployBlockedObs.create === 0
                && String(deployBlockedObs.empty || '').indexOf('저장') !== -1,
          data: deployBlockedObs,
        };
      }
      if (activeVersionId) {
        return {
          skip: 'E 섹션이 이미 버전을 저장해 activeVersionId가 있다 — 저장 전 상태를 재현할 수 없다',
          name: '저장 전 배포 차단',
        };
      }
      const live = await observeDeployBlocked(shellWin);
      return {
        ok: !!live && live.modes === 0 && live.create === 0
              && String(live.empty || '').indexOf('저장') !== -1,
        data: live,
      };
    });

    await goTab(shellWin, 4);
    const deployHead = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const wrap = root.querySelector('.backtest-deploy');
      if (!wrap) return null;
      return {
        title: (wrap.querySelector('.backtest-card-title') || {}).textContent,
        note: (wrap.querySelector('.backtest-card-note') || {}).textContent,
        deployNote: (wrap.querySelector('.backtest-deploy-note') || {}).textContent,
      };
    })()`, WAIT_VALIDATE);
    await step('J02', '배포 화면 머리가 "신호까지만"이라고 적는다', () => ({
      ok: !!deployHead && deployHead.title === '전략 배포 · 실전 적용'
            && deployHead.note === '배포는 신호까지만 만듭니다 — 주문은 주문 게이트를 통과합니다',
      data: deployHead ? { title: deployHead.title, note: deployHead.note } : null,
    }));
    await step('J03', '배포 화면 하단이 백테스트와 실전의 차이를 고지한다', () => ({
      ok: !!deployHead && String(deployHead.deployNote).indexOf('다음 봉 시가에 원하는 수량이 전부 체결된다고 가정') !== -1,
      data: { note: deployHead && String(deployHead.deployNote).slice(0, 60) },
    }));

    if (!activeVersionId) {
      skip('J04', '배포 모드 3종', '저장된 버전이 없다 — E 섹션을 함께 돌려야 배포 폼이 열린다');
      skip('J05', '배포 한도 6칸', '저장된 버전이 없다');
      skip('J06', '배포 생성(observe)', '저장된 버전이 없다');
      skip('J07', '배포 신호 목록', '저장된 버전이 없다');
      skip('J08', 'evaluate — 파이썬 버전도 판정을 준다', '저장된 버전이 없다');
      skip('J08b', 'evaluate — 터지는 파이썬 배포는 그 예외로 422', '저장된 버전이 없다');
      skip('J09', 'evaluate — yaml 버전은 판정을 준다', '저장된 버전이 없다');
      skip('J10', '[배포 중지]', '저장된 버전이 없다');
    } else {
      const modes = await js(shellWin, `(() => {
        const list = Array.from(document.querySelectorAll('${R}.backtest-deploy-mode-item'));
        return list.map((m) => [
          (m.querySelector('.backtest-deploy-mode-label') || {}).textContent,
          m.getAttribute('aria-pressed'),
          !!(m.querySelector('.backtest-deploy-mode-detail') || {}).textContent,
        ]);
      })()`);
      await step('J04', '배포 모드 3종 — 기본은 승인(자동 주문이 기본이 아니다)', () => ({
        ok: JSON.stringify(modes) === JSON.stringify([
              ['기록만 합니다', 'false', true],
              ['승인을 받고 주문합니다', 'true', true],
              ['한도 안에서 자동으로 주문합니다', 'false', true],
            ]),
        data: { modes },
      }));

      const limits = await js(shellWin, `(() => {
        const wrap = document.querySelector('${R}.backtest-deploy .backtest-card .backtest-field-row');
        if (!wrap) return null;
        return Array.from(wrap.querySelectorAll('.backtest-field')).map((f) => [
          (f.querySelector('.backtest-field-label') || {}).textContent,
          (f.querySelector('input') || {}).value,
        ]);
      })()`);
      await step('J05', '배포 한도 6칸이 기본값과 함께 뜬다', () => ({
        ok: !!limits && limits.length === 6
              && JSON.stringify(limits.map((l) => l[0])) === JSON.stringify([
                '1회 최대 주문(원)', '하루 최대 주문 수', '유효 시작(YYYYMMDD)',
                '유효 종료(YYYYMMDD)', '자동 정지 낙폭(%)', '자동 정지 연속 손절(회)',
              ])
              && limits[0][1] === '2000000' && limits[1][1] === '2',
        data: { limits },
      }));

      // 유효 종료가 비면 백엔드가 valid_to로 ''를 받는다 — 만료 판정에 걸리지 않게 채운다.
      await js(shellWin, `(() => {
        const wrap = document.querySelector('${R}.backtest-deploy .backtest-card .backtest-field-row');
        const fields = Array.from(wrap.querySelectorAll('.backtest-field'));
        const setV = (i, v) => {
          const input = fields[i].querySelector('input');
          input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setV(2, '20000101');
        setV(3, '20991231');
        return true;
      })()`);
      // 배포 목록은 비어 있지 않다 — 백엔드에 배포 삭제가 없어(DELETE는 중지다) 앞선 실행과
      // 사람의 수동 시험이 남긴 행이 계속 쌓인다. 게다가 목록은 created_at DESC라 "마지막 행"은
      // 가장 **오래된** 배포다(2026-09-02 실측: J06이 먼저 있던 stopped 행을 읽고 넘어졌다).
      // 그래서 만든 id를 목록 차이로 집어내고, 그 id가 목록에서 차지한 자리로만 DOM 행을 고른다
      // — 행에는 id가 실리지 않고, 캔버스는 이 목록 순서 그대로 행을 그린다.
      const listDeployments = async () => {
        const res = await invoke(shellWin, 'athena:backtest-deployments');
        return res && res.ok && res.data ? (res.data.deployments || []) : [];
      };
      const beforeIds = (await listDeployments()).map((d) => d.id);

      await clickNth(shellWin, `${R}.backtest-deploy-mode-item`, 0);
      await wait(300);
      await click(shellWin, `${R}.backtest-deploy-create`);

      let deployments = [];
      let pyDeployId = null;
      const createDeadline = Date.now() + WAIT_VALIDATE;
      while (Date.now() < createDeadline && !pyDeployId) {
        // eslint-disable-next-line no-await-in-loop
        await wait(250);
        // eslint-disable-next-line no-await-in-loop
        deployments = await listDeployments();
        const fresh = deployments.filter((d) => beforeIds.indexOf(d.id) === -1);
        if (fresh.length) pyDeployId = fresh[0].id;
      }
      if (pyDeployId && created.deploymentIds.indexOf(pyDeployId) === -1) {
        created.deploymentIds.push(pyDeployId);
      }
      const myIndex = deployments.findIndex((d) => d.id === pyDeployId);

      // 행 수가 목록 길이와 같아질 때까지 기다린다 — 아직 안 그려진 DOM에서 자리를 세면
      // 남의 행을 내 행으로 읽는다.
      const deployRow = myIndex < 0 ? null : await until(shellWin, `(() => {
        const rows = Array.from(document.querySelectorAll('${R}.backtest-deploy-row'));
        if (rows.length !== ${deployments.length}) return null;
        const r = rows[${myIndex}];
        if (!r) return null;
        return {
          rows: rows.length,
          index: ${myIndex},
          cls: r.className,
          symbol: (r.querySelector('.backtest-deploy-symbol') || {}).textContent,
          mode: (r.querySelector('.backtest-deploy-mode') || {}).textContent,
          status: (r.querySelector('.backtest-deploy-status') || {}).textContent,
          stop: r.querySelectorAll('.backtest-deploy-stop').length,
        };
      })()`, WAIT_VALIDATE);
      await step('J06', '[이 전략을 실전에 겁니다](기록만)가 배포 행을 만든다', () => ({
        ok: !!deployRow && deployRow.symbol === STK && deployRow.mode === '기록만 합니다'
              && deployRow.status === 'active' && deployRow.stop === 1,
        data: { id: pyDeployId, row: deployRow },
      }));

      const signals = pyDeployId
        ? await invoke(shellWin, 'athena:backtest-signals', { deployment_id: pyDeployId })
        : null;
      await step('J07', '배포 신호 목록은 200 + 빈 배열로 시작한다', () => ({
        ok: !!signals && signals.ok === true && signals.data
              && Array.isArray(signals.data.signals) && signals.data.signals.length === 0,
        data: signals && signals.data ? signals.data : signals,
      }));

      const stages = ['signal', 'skipped', 'pending_approval', 'ordered', 'blocked'];

      // effa50e 이전에는 이 자리가 422였다 — 코드 전략을 yaml로 읽으려다 파싱 오류로 끝나서,
      // 만들 수는 있는데 영원히 판정할 수 없는 배포가 남았다. 지금은 코드 전략의 신호를
      // 실행 라우트와 **같은 샌드박스**가 만들고 판정·한도까지 같은 코드를 지난다.
      const evalPy = pyDeployId
        ? await invoke(shellWin, 'athena:backtest-evaluate', { deployment_id: pyDeployId, today: TO })
        : null;
      const evalPyData = evalPy && evalPy.ok === true && evalPy.data ? evalPy.data : null;
      await step('J08', 'evaluate — 파이썬 버전 배포도 오늘의 판정을 돌려준다', () => ({
        ok: !!evalPyData && typeof evalPyData.dt === 'string' && evalPyData.dt.length > 0
              && stages.indexOf(evalPyData.stage) !== -1
              && typeof evalPyData.reason === 'string' && evalPyData.reason.length > 0
              && (evalPyData.stage === 'skipped'
                ? evalPyData.side === null
                : (evalPyData.side === 'buy' || evalPyData.side === 'sell')),
        data: evalPy && evalPy.data ? evalPy.data : evalPy,
      }));

      // 같은 자리의 반대편 — 파이썬이 실행에서 터지면 **그 예외 이름 그대로** 422여야 한다.
      // 사용자 코드가 터진 사실을 yaml 파싱 오류로 바꿔 말하면 고칠 곳을 못 찾는다.
      const boomStrategy = await invoke(shellWin, 'athena:backtest-strategy-create', {
        name: 'probe-full-python-boom', kind: 'python', source: SRC_RAISES,
      });
      if (boomStrategy && boomStrategy.ok && boomStrategy.data && boomStrategy.data.strategy_id) {
        created.strategyIds.push(boomStrategy.data.strategy_id);
      }
      const boomVersionId = boomStrategy && boomStrategy.ok && boomStrategy.data
        ? boomStrategy.data.version_id : null;
      const boomDeploy = boomVersionId
        ? await invoke(shellWin, 'athena:backtest-deployment-create', {
          strategy_version_id: boomVersionId,
          stk_cd: STK, period: 'day', adjusted: true, mode: 'observe', params: {},
          limits: {
            max_order_amount: 1000000, max_orders_per_day: 1,
            valid_from: '20000101', valid_to: '20991231',
            stop_on_drawdown_pct: 90, stop_on_consecutive_losses: 99,
          },
        })
        : null;
      const boomDeployId = boomDeploy && boomDeploy.ok && boomDeploy.data
        ? boomDeploy.data.deployment_id : null;
      if (boomDeployId) created.deploymentIds.push(boomDeployId);
      const evalBoom = boomDeployId
        ? await invoke(shellWin, 'athena:backtest-evaluate', { deployment_id: boomDeployId, today: TO })
        : null;
      await step('J08b', 'evaluate — 터지는 파이썬 배포는 자식의 예외 이름을 그대로 싣는다', () => {
        if (!boomDeployId) {
          return {
            skip: '터지는 코드용 전략·배포를 만들지 못했다',
            name: 'evaluate — 터지는 파이썬 배포',
          };
        }
        const detail = String(evalBoom && evalBoom.error);
        return {
          ok: !!evalBoom && evalBoom.ok === false && evalBoom.status === 422
                && detail.indexOf('ValueError:') !== -1
                && detail.indexOf('전략 로직이 터졌다') !== -1
                && detail.indexOf('block mapping') === -1
                && detail.indexOf('스펙으로 읽지 못했다') === -1,
          data: {
            deploymentId: boomDeployId,
            status: evalBoom && evalBoom.status,
            detail: detail.slice(0, 160),
          },
        };
      });

      // yaml 버전을 따로 만들어 evaluate가 실제 판정을 내는지 본다.
      const yamlText = await js(shellWin, `(() => {
        const c = window.AthenaBacktestCanvas.getContext();
        return window.AthenaLib.BacktestSpec.toYaml(c.spec);
      })()`);
      const yamlStrategy = await invoke(shellWin, 'athena:backtest-strategy-create', {
        name: 'probe-full-yaml', kind: 'yaml', source: yamlText,
      });
      const yamlVersionId = yamlStrategy && yamlStrategy.ok && yamlStrategy.data
        ? yamlStrategy.data.version_id : null;
      if (yamlStrategy && yamlStrategy.ok && yamlStrategy.data && yamlStrategy.data.strategy_id) {
        created.strategyIds.push(yamlStrategy.data.strategy_id);
      }
      const yamlDeploy = yamlVersionId
        ? await invoke(shellWin, 'athena:backtest-deployment-create', {
          strategy_version_id: yamlVersionId,
          stk_cd: STK, period: 'day', adjusted: true, mode: 'observe', params: {},
          limits: {
            max_order_amount: 1000000, max_orders_per_day: 1,
            valid_from: '20000101', valid_to: '20991231',
            stop_on_drawdown_pct: 90, stop_on_consecutive_losses: 99,
          },
        })
        : null;
      const yamlDeployId = yamlDeploy && yamlDeploy.ok && yamlDeploy.data
        ? yamlDeploy.data.deployment_id : null;
      if (yamlDeployId) created.deploymentIds.push(yamlDeployId);

      const evalYaml = yamlDeployId
        ? await invoke(shellWin, 'athena:backtest-evaluate', {
          deployment_id: yamlDeployId, today: TO, holding: false,
          orders_today: 0, order_amount: 100000, consecutive_losses: 0, drawdown_pct: 0,
        })
        : null;
      await step('J09', 'evaluate — yaml 버전 배포는 오늘의 판정을 돌려준다(주문은 내지 않는다)', () => ({
        ok: !!evalYaml && evalYaml.ok === true && evalYaml.data
              && stages.indexOf(evalYaml.data.stage) !== -1
              && typeof evalYaml.data.reason === 'string',
        data: evalYaml && evalYaml.data ? evalYaml.data : evalYaml,
      }));

      // J06이 만든 **그 배포**만 중지한다 — 남의 배포도, 방금 IPC로 만든 yaml·boom 배포도
      // 건드리지 않는다. J08b·J09가 만든 배포가 목록 앞(created_at DESC)에 끼어들어 자리가
      // 밀렸으므로, 탭을 다시 눌러 캔버스를 새 목록으로 그리게 한 뒤 자리를 다시 잰다.
      await goTab(shellWin, 4);
      const afterList = await listDeployments();
      const stopIndex = afterList.findIndex((d) => d.id === pyDeployId);
      const domReady = stopIndex < 0 ? null : await until(shellWin, `(() => {
        const rows = document.querySelectorAll('${R}.backtest-deploy-row');
        return rows.length === ${afterList.length} ? { rows: rows.length } : null;
      })()`, WAIT_VALIDATE);
      const stopTarget = (stopIndex < 0 || !domReady) ? null : await js(shellWin, `(() => {
        const rows = Array.from(document.querySelectorAll('${R}.backtest-deploy-row'));
        const row = rows[${stopIndex}];
        if (!row) return null;
        const before = (row.querySelector('.backtest-deploy-status') || {}).textContent;
        const btn = row.querySelector('.backtest-deploy-stop');
        if (!btn) return { before, clicked: false, index: ${stopIndex} };
        btn.click();
        return { before, clicked: true, index: ${stopIndex} };
      })()`);
      const stopped = !stopTarget ? null : await until(shellWin, `(() => {
        const rows = Array.from(document.querySelectorAll('${R}.backtest-deploy-row'));
        const row = rows[${stopIndex}];
        if (!row) return null;
        const status = (row.querySelector('.backtest-deploy-status') || {}).textContent;
        return status === 'stopped' ? { status, cls: row.className } : null;
      })()`, WAIT_VALIDATE);
      await step('J10', '[배포 중지]가 그 배포를 stopped로 만든다', () => ({
        ok: !!stopTarget && stopTarget.clicked === true && stopTarget.before === 'active'
              && !!stopped && stopped.status === 'stopped',
        data: { id: pyDeployId, target: stopTarget, after: stopped },
      }));
    }
  });

  // ==================================================================
  // K 채팅 액션 계약
  // ==================================================================
  if (on('K')) await section('K', async () => {
    await prepareForm(shellWin, FROM, TO);

    const beforeSpec = await ctx(shellWin);
    const cardsBefore = await countOf(shellWin, '#history .backtest-change');
    sendChat(shellWin, {
      kind: 'spec_draft', patch: { params: { fast: 12 } }, note: '프로브 설정', suggest_run: false,
    });
    // 반영은 지도 탭에 먼저 선다(지도가 첫 표면) — 슬라이더는 폼 탭에 있으니 옮겨서 읽는다.
    await wait(300);
    await goSubtab(shellWin, 1);
    const specCard = await until(shellWin, `(() => {
      const s = document.querySelector('${R}.backtest-param-slider[aria-label="fast 값"]');
      const cards = document.querySelectorAll('#history .backtest-change');
      if (!s || cards.length <= ${cardsBefore}) return null;
      if (s.value !== '12') return null;
      const card = cards[cards.length - 1];
      return {
        fast: s.value,
        text: card.textContent,
        rows: Array.from(card.querySelectorAll('.backtest-change-row')).map((r) => r.textContent),
        buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent),
      };
    })()`, WAIT_UI);
    await step('K01', 'spec_draft가 폼에 바로 반영된다', () => ({
      ok: !!specCard && specCard.fast === '12',
      data: { before: beforeSpec.spec.params.fast.default, after: specCard && specCard.fast },
    }));
    await step('K02', '채팅 카드가 "지도 반영 · 반영됨"과 변경 행을 남긴다', () => ({
      ok: !!specCard && specCard.text.indexOf('지도 반영') !== -1
            && specCard.text.indexOf('반영됨') !== -1
            && specCard.rows.some((r) => r.indexOf('fast') !== -1),
      data: specCard ? { rows: specCard.rows, buttons: specCard.buttons } : null,
    }));

    await clickLastCardButton(shellWin, '되돌리기');
    const undone = await until(shellWin, `(() => {
      const s = document.querySelector('${R}.backtest-param-slider[aria-label="fast 값"]');
      const cards = document.querySelectorAll('#history .backtest-change');
      const card = cards[cards.length - 1];
      if (!s || card.textContent.indexOf('되돌렸습니다') === -1) return null;
      return { fast: s.value, lastChange: window.AthenaBacktestCanvas.getContext().lastChange };
    })()`, WAIT_UI);
    await step('K03', '[되돌리기]가 폼을 반영 직전으로 돌린다', () => ({
      ok: !!undone && Number(undone.fast) === Number(beforeSpec.spec.params.fast.default)
            && undone.lastChange === null,
      data: { restored: undone && undone.fast, expected: beforeSpec.spec.params.fast.default },
    }));

    sendChat(shellWin, { kind: 'spec_draft', patch: { symbols: [] }, note: '종목 비우기' });
    const pendingCard = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-change');
      const card = cards[cards.length - 1];
      const label = card.querySelector('.backtest-change-error-label');
      if (!label) return null;
      return {
        label: label.textContent,
        errors: Array.from(card.querySelectorAll('.backtest-change-error')).map((e) => e.textContent),
        applied: card.textContent.indexOf('반영됨') !== -1,
      };
    })()`, WAIT_UI);
    await step('K04', '검증에 걸려도 설정은 반영되고 오류는 "실행 전에 채울 것"으로 남는다', () => ({
      ok: !!pendingCard && pendingCard.applied === true
            && pendingCard.label === '실행 전에 채울 것'
            && pendingCard.errors.indexOf('종목을 하나 이상 고르세요') !== -1,
      data: pendingCard,
    }));
    await clickLastCardButton(shellWin, '되돌리기');
    await wait(400);

    sendChat(shellWin, { kind: 'spec_draft', patch: { preset: 'no_such_preset' }, note: '없는 프리셋' });
    const blockedCard = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-change');
      const card = cards[cards.length - 1];
      if (card.textContent.indexOf('반영 안 됨') === -1) return null;
      return {
        errors: Array.from(card.querySelectorAll('.backtest-change-error')).map((e) => e.textContent),
        buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent),
      };
    })()`, WAIT_UI);
    await step('K05', '모르는 프리셋은 반영하지 않고 그 사실을 적는다', () => ({
      ok: !!blockedCard
            && blockedCard.errors.indexOf('no_such_preset는 없는 프리셋입니다') !== -1
            && blockedCard.buttons.length === 0,
      data: blockedCard,
    }));

    sendChat(shellWin, {
      kind: 'code_draft', source: SRC_GOOD, note: '코드 계약', suggest_validate: true,
    });
    const codeCard = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const cards = document.querySelectorAll('#history .backtest-change');
      const card = cards[cards.length - 1];
      const ta = document.querySelector('${R}.backtest-code-host .backtest-code-textarea');
      if (!ta || ta.value.indexOf('probe-code-path') === -1) return null;
      if (card.textContent.indexOf('코드 반영') === -1) return null;
      return {
        runPath: c.runPath,
        designTab: c.designTab,
        rows: Array.from(card.querySelectorAll('.backtest-change-row')).map((r) => r.textContent),
        buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent),
      };
    })()`, WAIT_UI);
    await step('K06', 'code_draft가 편집기·실행경로·카드를 한 번에 움직인다', () => ({
      ok: !!codeCard && codeCard.runPath === 'code' && codeCard.designTab === 'code'
            && codeCard.rows.some((r) => r.indexOf('코드') === 0)
            && codeCard.buttons.indexOf('검증') !== -1,
      data: codeCard,
    }));

    const tabExpect = [['design', '설계'], ['result', '결과'], ['history', '이력'], ['optimize', '최적화'], ['deploy', '배포']];
    for (let i = 0; i < tabExpect.length; i += 1) {
      const [key, label] = tabExpect[i];
      sendChat(shellWin, { kind: 'navigate', tab: key, designTab: null });
      // eslint-disable-next-line no-await-in-loop
      const nav = await until(shellWin, `(() => {
        const on = document.querySelector('${R}.backtest-tab.is-on');
        const c = window.AthenaBacktestCanvas.getContext();
        if (!on || on.textContent !== ${JSON.stringify(label)}) return null;
        return { tab: c.tab, label: on.textContent };
      })()`, WAIT_VALIDATE);
      // eslint-disable-next-line no-await-in-loop
      await step(`K07${String.fromCharCode(97 + i)}`, `navigate — ${label} 탭이 열린다`, () => ({
        ok: !!nav && nav.tab === key,
        data: nav,
      }));
    }

    const subExpect = [
      ['flow', '지도'], ['form', '폼'], ['code', '코드 · 최후의 보루'], ['nodes', '노드·흐름'],
    ];
    for (let i = 0; i < subExpect.length; i += 1) {
      const [key, label] = subExpect[i];
      sendChat(shellWin, { kind: 'navigate', tab: 'design', designTab: key });
      // eslint-disable-next-line no-await-in-loop
      const nav = await until(shellWin, `(() => {
        const on = document.querySelector('${R}.backtest-subtab.is-on');
        const c = window.AthenaBacktestCanvas.getContext();
        if (!on || on.textContent !== ${JSON.stringify(label)}) return null;
        return { designTab: c.designTab, label: on.textContent };
      })()`, WAIT_VALIDATE);
      // eslint-disable-next-line no-await-in-loop
      await step(`K08${String.fromCharCode(97 + i)}`, `navigate — 설계 하위탭 ${label}이 열린다`, () => ({
        ok: !!nav && nav.designTab === key,
        data: nav,
      }));
    }

    sendChat(shellWin, { kind: 'optimize_request', method: 'random', note: '표본을 넓혀 볼까요' });
    const optCard = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const cards = document.querySelectorAll('#history .backtest-change');
      const card = cards[cards.length - 1];
      const start = document.querySelector('${R}.backtest-optimize-start');
      if (!start || start.className.indexOf('is-suggested') === -1) return null;
      if (card.textContent.indexOf('최적화 준비') === -1) return null;
      return {
        tab: c.tab,
        method: c.optimize.method,
        suggested: (document.querySelector('${R}.backtest-optimize-suggested') || {}).textContent,
        buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent),
      };
    })()`, WAIT_VALIDATE);
    await step('K09', 'optimize_request는 방식만 준비하고 탐색은 시작하지 않는다', () => ({
      ok: !!optCard && optCard.tab === 'optimize' && optCard.method === 'random'
            && optCard.suggested === '표본을 넓혀 볼까요'
            && optCard.buttons.indexOf('탐색 시작') !== -1,
      data: optCard,
    }));

    // 실행/승인 중 차단 — 승인 화면은 사람 클릭을 기다리므로 결정적으로 붙잡을 수 있다.
    await prepareForm(shellWin, UNCACHED_FROM, TO);
    await click(shellWin, `${R}.backtest-run-button`);
    const busyView = await waitRunOutcome(shellWin, WAIT_RUN);
    const busySpecBefore = await ctx(shellWin);
    sendChat(shellWin, { kind: 'spec_draft', patch: { params: { fast: 33 } }, note: '실행 중 변경' });
    const busyCard = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-change');
      const card = cards[cards.length - 1];
      if (card.textContent.indexOf('반영 안 됨') === -1) return null;
      return {
        errors: Array.from(card.querySelectorAll('.backtest-change-error')).map((e) => e.textContent),
        buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent),
      };
    })()`, WAIT_UI);
    const busySpecAfter = await ctx(shellWin);
    await step('K10', '승인·실행 중에는 채팅 액션을 거절한다', () => ({
      ok: !!busyView && busyView.view === 'approval' && !!busyCard
            && busyCard.errors.indexOf('실행 중에는 바꿀 수 없습니다') !== -1
            && busyCard.buttons.length === 0
            && busySpecAfter.spec.params.fast.default === busySpecBefore.spec.params.fast.default,
      data: { view: busyView && busyView.view, card: busyCard },
    }));

    const undoBusy = await js(shellWin, "window.AthenaBacktestCanvas.undoChatAction('bc-1')");
    await step('K11', '실행 중에는 되돌리기도 잠긴다', () => ({
      ok: !!undoBusy && undoBusy.ok === false && undoBusy.reason === '실행 중에는 되돌릴 수 없습니다',
      data: undoBusy,
    }));
    await click(shellWin, `${R}.backtest-approval-cancel`);
    await wait(400);

    const receipt = await js(shellWin, "window.AthenaBacktestCanvas.onChatAction({ kind: 'navigate', tab: 'result' })");
    const receiptKeys = receipt ? Object.keys(receipt) : [];
    await step('K12', '영수증 키 계약 15개', () => ({
      // canApply는 프로젝트 IDE(파일 초안 file_draft)가 더한 키다 — 적용 가능 여부를 카드가 읽는다.
      // nodes·version은 흐름 지도가 더한 키다(보드 14-B) — 어느 칸이 몇 판에서 바뀌었는가.
      ok: JSON.stringify(receiptKeys) === JSON.stringify([
            'id', 'kind', 'applied', 'note', 'rows', 'nodes', 'version', 'errors',
            'suggest_run', 'suggest_validate', 'tab', 'designTab', 'method', 'canUndo', 'canApply',
          ]) && /^bc-\d+$/.test(String(receipt.id)),
      data: { keys: receiptKeys, id: receipt && receipt.id },
    }));

    const unknownBefore = await countOf(shellWin, '#history .backtest-change');
    const unknownReceipt = await js(shellWin, "window.AthenaBacktestCanvas.onChatAction({ kind: 'nope' })");
    sendChat(shellWin, { kind: 'nope' });
    await wait(700);
    const unknownAfter = await countOf(shellWin, '#history .backtest-change');
    await step('K13', '모르는 kind는 null을 돌려주고 카드도 안 그린다', () => ({
      ok: unknownReceipt === null && unknownAfter === unknownBefore,
      data: { receipt: unknownReceipt, before: unknownBefore, after: unknownAfter },
    }));

    const undoMissing = await js(shellWin, "window.AthenaBacktestCanvas.undoChatAction('bc-99999')");
    await step('K14', '없는 변경은 되돌릴 수 없다고 말한다', () => ({
      ok: !!undoMissing && undoMissing.ok === false
            && undoMissing.reason === '되돌릴 내역이 남아 있지 않습니다',
      data: undoMissing,
    }));

    await prepareForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // L 컨텍스트
  // ==================================================================
  if (on('L')) await section('L', async () => {
    await prepareForm(shellWin, FROM, TO);
    const c = await ctx(shellWin);
    const expectedKeys = [
      'view', 'tab', 'designTab', 'runPath', 'spec', 'draft', 'pending', 'presets',
      // 새 기법 만들기(2026-09-03) — 만드는 중인가와 그 기법의 검사·노드·흐름.
      'techniqueDraft', 'technique',
      'map',
      'code', 'codeDraft', 'lastResult', 'diagnosis', 'optimize', 'runs', 'coverage', 'lastChange', 'project',
    ];
    await step('L01', 'getContext() 최상위 키 20개 계약', () => ({
      ok: JSON.stringify(Object.keys(c)) === JSON.stringify(expectedKeys),
      data: { keys: Object.keys(c) },
    }));
    await step('L02', 'draft·codeDraft는 계약용 잔존 키로 항상 null이다', () => ({
      ok: c.draft === null && c.codeDraft === null,
      data: { draft: c.draft, codeDraft: c.codeDraft },
    }));
    await step('L03', '폼이 채워져 있으면 pending이 비어 있다', () => ({
      ok: Array.isArray(c.pending) && c.pending.length === 0,
      data: { pending: c.pending, spec: { symbols: c.spec.symbols, from: c.spec.fromDt, to: c.spec.toDt } },
    }));

    await clearSymbols(shellWin);
    await wait(300);
    const emptied = await ctx(shellWin);
    await step('L04', '종목을 지우면 pending이 그것을 적고 coverage는 모름으로 돌아간다', () => ({
      ok: emptied.pending.indexOf('종목을 하나 이상 고르세요') !== -1 && emptied.coverage === null,
      data: { pending: emptied.pending, coverage: emptied.coverage },
    }));

    await addSymbol(shellWin, STK);
    const restored = await until(shellWin, `(() => {
      const x = window.AthenaBacktestCanvas.getContext();
      return x.coverage ? { coverage: x.coverage } : null;
    })()`, WAIT_VALIDATE);
    await step('L05', '종목이 하나면 coverage가 rows·first_dt·last_dt로 채워진다', () => ({
      ok: !!restored && Number(restored.coverage.rows) > 0
            && !!restored.coverage.first_dt && !!restored.coverage.last_dt,
      data: restored,
    }));

    await step('L06', 'code 컨텍스트가 원문·줄수·전략 id·오류를 싣는다', () => ({
      ok: typeof c.code.source === 'string' && typeof c.code.truncated === 'boolean'
            && typeof c.code.lines === 'number' && Array.isArray(c.code.errors)
            && c.code.lines === (c.code.source ? c.code.source.split('\n').length : 0),
      data: {
              lines: c.code.lines, truncated: c.code.truncated,
              strategyId: c.code.strategyId, activeVersionId: c.code.activeVersionId,
            },
    }));

    await step('L07', 'lastResult가 마지막 실행의 상태·지표·플래그를 싣는다', () => {
      if (c.lastResult === null) {
        return {
          skip: '이 실행에서 백테스트를 한 번도 돌리지 않았다 — D 또는 E 섹션이 필요하다',
          name: 'lastResult 계약',
        };
      }
      return {
        ok: ['done', 'failed'].indexOf(c.lastResult.status) !== -1
              && typeof c.lastResult.metrics === 'object' && Array.isArray(c.lastResult.flags)
              && typeof c.lastResult.tradesCount === 'number'
              && typeof c.lastResult.stdoutTail === 'string',
        data: { status: c.lastResult.status, trades: c.lastResult.tradesCount, flags: c.lastResult.flags },
      };
    });

    await step('L08', 'runs는 최대 10건까지만 싣는다', () => ({
      ok: Array.isArray(c.runs) && c.runs.length <= 10
            && c.runs.every((r) => typeof r.run_id === 'string' && 'status' in r),
      data: { runs: c.runs.length },
    }));

    await step('L09', 'optimize 컨텍스트가 method와 결과 요약을 싣는다', () => ({
      ok: !!c.optimize && ['grid', 'random'].indexOf(c.optimize.method) !== -1
            && (c.optimize.result === null
              || (Array.isArray(c.optimize.result.warnings) && typeof c.optimize.result.cells === 'number')),
      data: c.optimize,
    }));

    await step('L10', 'diagnosis는 null이거나 5키 요약이다(전체 diff는 안 싣는다)', () => ({
      ok: c.diagnosis === null
            || JSON.stringify(Object.keys(c.diagnosis)) === JSON.stringify(['title', 'why', 'line', 'hasFix', 'summary']),
      data: c.diagnosis,
    }));

    await step('L11', 'presets는 id·name만 싣는다', () => ({
      ok: Array.isArray(c.presets) && c.presets.length === 10
            && c.presets.every((p) => JSON.stringify(Object.keys(p)) === JSON.stringify(['id', 'name'])),
      data: { presets: c.presets.length },
    }));

    sendChat(shellWin, { kind: 'spec_draft', patch: { params: { fast: 9 } }, note: 'lastChange 확인' });
    const lastChange = await until(shellWin, `(() => {
      const x = window.AthenaBacktestCanvas.getContext();
      return x.lastChange ? { lastChange: x.lastChange } : null;
    })()`, WAIT_UI);
    await step('L12', 'lastChange가 마지막 영수증 요약을 싣는다', () => ({
      ok: !!lastChange && lastChange.lastChange.applied === true
            && lastChange.lastChange.kind === 'spec_draft'
            && Array.isArray(lastChange.lastChange.rows),
      data: lastChange,
    }));

    await clickLastCardButton(shellWin, '되돌리기');
    const clearedChange = await until(shellWin, `(() => {
      const x = window.AthenaBacktestCanvas.getContext();
      return x.lastChange === null ? { lastChange: null } : null;
    })()`, WAIT_UI);
    await step('L13', '되돌리면 lastChange는 사라진다(반영된 것으로 읽히지 않는다)', () => ({
      ok: !!clearedChange,
      data: clearedChange,
    }));
  });

  // ==================================================================
  // M 출처 → 전략 → 등록 → 배포
  //
  // 앞의 열두 섹션이 재는 것은 "이미 있는 전략을 돌리는 길"이다. 여기서 재는 것은 그
  // 앞에 있는 길이다: 바깥 자료 하나를 글로 옮기고(M01~M03), 내 폴더에 파이썬을 놓고
  // (M04~M05), 그 폴더의 가상환경을 만들고(M06~M07), 그 파일을 프리셋과 같은 자리에
  // 세우고(M08~M10), 그대로 돌려(M11) 실전에 걸고(M12), 흐름 지도까지 본다(M13).
  // 만든 것(등록·배포·프로젝트)은 M14가 되돌린다 — 파일만 디스크에 남는다.
  // ==================================================================
  if (on('M')) await section('M', async () => {
    const brief = (url) => backendJson('POST', '/api/v1/backtest/source/brief', { url });

    // --- 출처 브리프 --- 렌더러 채널이 없는 라우트다(preload INVOKE_CHANNELS에 없다) —
    // 없는 채널을 지어내지 않고 00A와 같은 자리에서 백엔드를 직접 두드린다.
    const htmlBrief = await brief('https://example.com/');
    const htmlBody = htmlBrief.body || {};
    // 바깥 네트워크가 아예 없는 기계인가 — M03의 SKIP 판정을 여기서 한 번만 정한다.
    const netOk = htmlBrief.status === 200;
    await step('M01', '일반 웹페이지 주소가 200 · html 갈래 · 본문으로 온다', () => ({
      ok: htmlBrief.status === 200 && htmlBody.source_kind === 'html'
            && typeof htmlBody.text === 'string' && htmlBody.text.trim().length > 0
            && typeof htmlBody.title === 'string' && htmlBody.title.length > 0,
      data: {
        status: htmlBrief.status, kind: htmlBody.source_kind, title: htmlBody.title,
        chars: typeof htmlBody.text === 'string' ? htmlBody.text.length : null,
        truncated: htmlBody.truncated,
        error: htmlBrief.error || (htmlBody.detail === undefined ? null : htmlBody.detail),
      },
    }));

    const deadBrief = await brief('https://athena-probe-no-such-host.invalid/x');
    const deadDetail = String((deadBrief.body && deadBrief.body.detail) || '');
    await step('M02', '닿지 않는 주소는 502 + 어느 단계가 실패했는지 한국어로 말한다', () => ({
      ok: deadBrief.status === 502 && deadDetail.indexOf('단계가 실패했다') !== -1,
      data: { status: deadBrief.status, detail: deadDetail.slice(0, 120) },
    }));

    // 유튜브는 실제 영상을 태우지 않는다 — 계정·자막 사정에 판정이 흔들린다. 대신 주소
    // 모양만으로 유튜브 갈래에 들어갔다는 사실을 잰다: 그 갈래에서만 나오는 말로 거절하면
    // 분기표(source_kind)가 살아 있다는 뜻이다.
    await step('M03', '유튜브 주소는 유튜브 갈래로 간다(유튜브 말로 거절한다)', async () => {
      if (!netOk) {
        return { skip: '이 기계에 바깥 네트워크가 없다(M01이 200을 못 받았다)', name: '유튜브 분기' };
      }
      const noId = await brief('https://www.youtube.com/watch?v=');
      const fake = await brief('https://www.youtube.com/watch?v=zzzzzzzzzzz');
      const noIdDetail = String((noId.body && noId.body.detail) || '');
      const fakeDetail = String((fake.body && fake.body.detail) || '');
      return {
        ok: noId.status === 422 && noIdDetail.indexOf('영상 id') !== -1
              && [422, 502].indexOf(fake.status) !== -1
              && /영상 id|자막|워치 페이지/.test(fakeDetail),
        data: {
          noId: { status: noId.status, detail: noIdDetail.slice(0, 80) },
          fakeId: { status: fake.status, detail: fakeDetail.slice(0, 80) },
        },
      };
    });

    // --- 내 폴더 --- 관리형 프로젝트 하나를 만들고 그 안에 전략 파일을 놓는다.
    const projectName = `probe-full-M-${Date.now()}`;
    const madeProject = await invoke(shellWin, 'athena:project-create', { name: projectName });
    const projectInfo = madeProject && madeProject.ok && madeProject.data
      ? madeProject.data.project : null;
    const projectId = projectInfo ? projectInfo.id : null;
    const projectPath = projectInfo ? projectInfo.path : null;
    if (projectId) created.projectIds.push(projectId);
    await step('M04', '관리형 프로젝트가 폴더와 씨앗 파일로 생긴다', () => ({
      ok: !!projectInfo && !!projectId && projectInfo.exists === true
            && projectInfo.kind === 'managed'
            && /\.py$/.test(String((madeProject.data || {}).seed || ''))
            && !!projectPath && fs.existsSync(projectPath),
      data: {
        id: projectId, name: projectInfo && projectInfo.name, path: projectPath,
        seed: madeProject && madeProject.data ? madeProject.data.seed : null,
        error: madeProject && madeProject.error,
      },
    }));
    if (!projectId) {
      throw new Error(`프로젝트를 못 만들어 M05 이후를 돌리지 않았다: ${safeJson(madeProject)}`);
    }

    const wrote = await invoke(shellWin, 'athena:project-file-write', {
      project_id: projectId, path: USER_STRATEGY_PATH, text: SRC_USER_STRATEGY,
    });
    const wroteData = wrote && wrote.ok ? wrote.data : null;
    await step('M05', '하위 폴더째 새 .py를 쓴다(algos/ma.py)', () => ({
      ok: !!wroteData && wroteData.path === USER_STRATEGY_PATH && Number(wroteData.size) > 0
            && fs.existsSync(path.join(projectPath, 'algos', 'ma.py')),
      data: { file: wroteData, error: wrote && wrote.error },
    }));

    // --- 가상환경 --- 만들기 전에는 "없음"이라고 말해야 한다(캐시가 아니라 지금 디스크다).
    const envBefore = await invoke(shellWin, 'athena:project-env-get', { project_id: projectId });
    const envBeforeData = envBefore && envBefore.ok ? envBefore.data : null;
    await step('M06', '환경을 만들기 전에는 exists=false · 패키지 0개다', () => ({
      ok: !!envBeforeData && envBeforeData.exists === false
            && Array.isArray(envBeforeData.packages) && envBeforeData.packages.length === 0
            && envBeforeData.base_ok === false && envBeforeData.python === null,
      data: envBeforeData || { error: envBefore && envBefore.error },
    }));

    // 202 + job_id로 시작해 기존 잡 라우트(athena:backtest-status)로 진행을 본다 —
    // 잡 표면을 둘로 만들지 않는다는 계약이 실제로 지켜지는지가 이 검사의 절반이다.
    const envStart = await invoke(shellWin, 'athena:project-env-create', {
      project_id: projectId, packages: [],
    });
    const envJobId = envStart && envStart.ok && envStart.data ? envStart.data.job_id : null;
    const envSteps = [];
    let envFinal = null;
    if (envJobId) {
      const envDeadline = Date.now() + WAIT_ENV;
      while (Date.now() < envDeadline && !envFinal) {
        // eslint-disable-next-line no-await-in-loop
        const res = await invoke(shellWin, 'athena:backtest-status', { job_id: envJobId });
        const job = res && res.ok ? res.data : null;
        if (job && job.progress && envSteps.indexOf(job.progress.step) === -1) {
          envSteps.push(job.progress.step);
        }
        if (job && ['done', 'failed', 'cancelled'].indexOf(job.status) !== -1) envFinal = job;
        // eslint-disable-next-line no-await-in-loop
        else await wait(2000);
      }
    }
    const envAfter = envFinal && envFinal.status === 'done'
      ? await invoke(shellWin, 'athena:project-env-get', { project_id: projectId })
      : null;
    const envAfterData = envAfter && envAfter.ok ? envAfter.data : null;
    await step('M07', '[환경 만들기]가 잡으로 돌고, 끝나면 base_ok가 참이 된다', () => {
      if (!envJobId) {
        return { skip: `환경 잡을 시작하지 못했다: ${safeJson(envStart)}`, name: '프로젝트 가상환경' };
      }
      if (!envFinal) {
        return {
          skip: `${WAIT_ENV}ms 안에 환경 잡이 끝나지 않았다(단계: ${envSteps.join(' → ') || '없음'})`,
          name: '프로젝트 가상환경',
        };
      }
      const err = String(envFinal.error || '');
      if (envFinal.status !== 'done' && OFFLINE_PIP.test(err)) {
        return { skip: `pip이 인덱스에 닿지 못했다 — ${err.slice(0, 160)}`, name: '프로젝트 가상환경' };
      }
      return {
        ok: envFinal.status === 'done'
              && envSteps.indexOf('venv') !== -1 && envSteps.indexOf('install') !== -1
              && !!envAfterData && envAfterData.exists === true && envAfterData.base_ok === true
              && typeof envAfterData.python === 'string' && envAfterData.python.length > 0,
        data: {
          jobId: envJobId, status: envFinal.status, steps: envSteps,
          error: err ? err.slice(0, 200) : null,
          env: envAfterData
            ? {
              exists: envAfterData.exists, base_ok: envAfterData.base_ok,
              packages: (envAfterData.packages || []).length, python: envAfterData.python,
            }
            : null,
        },
      };
    });

    // --- 등록 --- 모델의 MCP register_strategy가 지나는 그 라우트다(채널도 같다).
    const registered = await invoke(shellWin, 'athena:backtest-user-strategy-register', {
      project_id: projectId, path: USER_STRATEGY_PATH, name: projectName,
    });
    const registeredData = registered && registered.ok ? registered.data : null;
    const userStrategyId = registeredData ? registeredData.id : null;
    if (userStrategyId) created.userStrategyIds.push(userStrategyId);
    await step('M08', '내 폴더의 .py가 등록부에 오른다(소스는 복사하지 않는다)', () => ({
      ok: !!registeredData && !!userStrategyId
            && registeredData.project_id === projectId
            && registeredData.path === USER_STRATEGY_PATH
            && registeredData.name === projectName
            && registeredData.source === undefined,
      data: { entry: registeredData, error: registered && registered.error },
    }));
    if (!userStrategyId) {
      throw new Error(`등록이 실패해 M09 이후를 돌리지 않았다: ${safeJson(registered)}`);
    }

    // 사람이 할 수 있는 가장 센 새로고침 — 모드를 나갔다 들어온다(사이드바가
    // AthenaBacktestCanvas.refresh()를 부르는 유일한 자리다, lib/sidebar.js:64).
    await js(shellWin, "(() => { document.getElementById('modeNavSummary').click(); return true; })()");
    await wait(400);
    await js(shellWin, "(() => { document.getElementById('modeNavBacktest').click(); return true; })()");
    await until(shellWin, `(() => {
      const api = window.AthenaBacktestCanvas;
      const c = api ? api.getContext() : null;
      return c && Array.isArray(c.presets) && c.presets.length ? true : null;
    })()`, WAIT_PRESETS);
    await prepareForm(shellWin, FROM, TO);
    // **계약이 바뀐 자리다**(2026-09-03): 내가 만든 것을 따로 세우던 [내 전략] 묶음이
    // 사라지고 목록 하나로 합쳐졌다 — 같은 목록, 같은 카드. 그래서 재는 것도 "그 묶음이
    // 있는가"가 아니라 "그 목록에 내 이름이 있는가"가 된다(검사 강도는 그대로: 이름·경로·
    // [등록 해제]·처음 주어진 기법 수를 여전히 다 센다).
    const readPicker = () => js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const wrap = root.querySelector('.backtest-technique-wrap');
      if (!wrap) return { wrap: false, names: [], paths: [] };
      return {
        wrap: true,
        title: (wrap.querySelector('.backtest-card-title') || {}).textContent,
        names: Array.from(wrap.querySelectorAll('.backtest-user-strategy-name'))
          .map((n) => n.textContent),
        paths: Array.from(wrap.querySelectorAll('.backtest-user-strategy-path'))
          .map((n) => n.textContent),
        removes: wrap.querySelectorAll('.backtest-user-strategy-remove').length,
        presets: root.querySelectorAll('.backtest-preset-item').length,
      };
    })()`);
    const pickerLive = await readPicker();
    const inPicker = (seen) => !!(seen && Array.isArray(seen.names)
      && seen.names.indexOf(projectName) !== -1);

    // 목록에 없으면 화면이 등록부를 다시 읽지 않은 것이다. 그 사실을 검사로 남긴 뒤,
    // M10 이후를 살리려고 창을 다시 띄운다(= 앱을 다시 켠 것). 되살린 사실도 함께 남긴다.
    let reloaded = null;
    if (!inPicker(pickerLive)) {
      shellWin.webContents.reload();
      await wait(2500);
      await until(shellWin, '(window.AthenaBacktestCanvas ? true : null)', WAIT_UI);
      await js(shellWin, "(() => { document.getElementById('modeNavBacktest').click(); return true; })()");
      await until(shellWin, `(() => {
        const api = window.AthenaBacktestCanvas;
        const c = api ? api.getContext() : null;
        return c && Array.isArray(c.presets) && c.presets.length ? true : null;
      })()`, WAIT_PRESETS);
      await prepareForm(shellWin, FROM, TO);
      reloaded = await readPicker();
    }
    const pickerNow = reloaded || pickerLive;
    await step('M09', '설계 폼의 기법 목록에 방금 등록한 이름이 같은 카드로 선다', () => ({
      ok: inPicker(pickerLive) && pickerLive.wrap === true
            && String(pickerLive.title || '') === `기법 — ${pickerLive.presets + pickerLive.names.length}개`
            && pickerLive.removes === pickerLive.names.length
            && pickerLive.paths.indexOf(USER_STRATEGY_PATH) !== -1,
      data: {
        live: pickerLive,
        afterReload: reloaded,
        note: reloaded
          ? '모드를 나갔다 들어와도 목록이 그대로라 창을 다시 띄웠다(앱 재시작에 해당)'
          : null,
      },
    }));

    if (!inPicker(pickerNow)) {
      skip('M10', '내 전략 선택', '목록에 서지 않아 고를 수 없다');
      skip('M11', '내 전략 실행', '목록에 서지 않아 고를 수 없다');
      skip('M12', '배포 행 생성', '실행하지 못해 걸 버전이 없다');
      skip('M12b', 'evaluate 판정', '실행하지 못해 걸 버전이 없다');
      skip('M12c', '배포 중지', '실행하지 못해 걸 버전이 없다');
      skip('M13', '흐름 지도', '내 전략을 열지 못했다');
    } else {
      // --- 고르기 --- 프리셋을 고르는 것과 같은 동작이어야 한다. 다른 점은 신호를
      // 지표·조건이 아니라 그 파일의 파이썬이 만든다는 것뿐이다.
      await js(shellWin, `(() => {
        const items = Array.from(document.querySelectorAll('${R}.backtest-user-strategy-item'));
        const target = items.find((b) => {
          const n = b.querySelector('.backtest-user-strategy-name');
          return n && n.textContent === ${JSON.stringify(projectName)};
        });
        if (!target) return false;
        target.click();
        return true;
      })()`);
      const selected = await until(shellWin, `(() => {
        const c = window.AthenaBacktestCanvas.getContext();
        if (!c || c.runPath !== 'code') return null;
        if (!c.project || c.project.activeFile !== ${JSON.stringify(USER_STRATEGY_PATH)}) return null;
        return {
          runPath: c.runPath,
          project: c.project.name,
          activeFile: c.project.activeFile,
          dirty: c.project.dirty,
          params: Object.keys(c.spec.params),
          name: c.spec.name,
        };
      })()`, WAIT_VALIDATE);
      // 고른 직후의 자리는 지도다 — 파일이 열렸는지는 코드 탭(세 번째)에서 확인한다.
      await goSubtab(shellWin, 2);
      await wait(400);
      const editorSeen = await until(shellWin, `(() => {
        const ta = document.querySelector('${R}.project-ide-editor .backtest-code-textarea');
        if (!ta || !ta.value) return null;
        return {
          marker: ta.value.indexOf('probe-user-strategy') !== -1,
          chars: ta.value.length,
          headPath: (document.querySelector('${R}.project-ide-head-path') || {}).textContent,
          venvPanel: document.querySelectorAll('${R}.backtest-venv-panel').length,
          registerButton: document.querySelectorAll('${R}.backtest-register-strategy').length,
        };
      })()`, WAIT_UI);
      await step('M10', '고르면 그 파일이 코드 탭에 열리고 실행경로가 코드가 된다', () => ({
        ok: !!selected && selected.runPath === 'code'
              && selected.activeFile === USER_STRATEGY_PATH && selected.dirty === false
              && JSON.stringify(selected.params) === JSON.stringify(['fast', 'slow'])
              && !!editorSeen && editorSeen.marker === true
              && editorSeen.headPath === USER_STRATEGY_PATH
              && editorSeen.venvPanel === 1 && editorSeen.registerButton === 1,
        data: { selected, editor: editorSeen },
      }));

      // --- 실행 --- 파일이 진실이다(D2): 실행은 편집기 버퍼가 아니라 디스크를 다시 읽고,
      // 백엔드는 매 실행마다 전략+버전 한 쌍을 남긴다. 그 버전의 소스가 우리 파일이어야
      // "방금 그 실행이 어느 버전이었는가"라고 응답이 실어 준 두 값이 진짜다.
      const beforeRun = await ctx(shellWin);
      const prevRunId = beforeRun && beforeRun.lastResult ? beforeRun.lastResult.runId : null;
      const beforeVersionId = beforeRun ? beforeRun.code.activeVersionId : null;
      await click(shellWin, `${R}.backtest-run-button`);
      const runOutcome = await waitNewRunOutcome(shellWin, prevRunId, WAIT_RUN);
      const afterRun = await ctx(shellWin);
      const strategyIdNow = afterRun ? afterRun.code.strategyId : null;
      const versionIdNow = afterRun ? afterRun.code.activeVersionId : null;
      if (strategyIdNow) created.strategyIds.push(strategyIdNow);
      const versionsRes = strategyIdNow
        ? await invoke(shellWin, 'athena:backtest-versions', { strategy_id: strategyIdNow })
        : null;
      const versionList = versionsRes && versionsRes.ok && versionsRes.data
        ? (versionsRes.data.versions || []) : [];
      const ranVersion = versionList.find((v) => v.id === versionIdNow) || null;
      const stdout = await textOf(shellWin, `${R}.backtest-stdout-text`);
      await step('M11', '내 전략 실행이 코드 경로로 끝나고, 응답이 실은 버전이 그 파일이다', () => ({
        ok: !!runOutcome && runOutcome.view === 'result'
              && !!afterRun.lastResult && afterRun.lastResult.status === 'done'
              && !!afterRun.lastResult.metrics && afterRun.lastResult.metrics.run_path === 'code'
              && !!strategyIdNow && !!versionIdNow && versionIdNow !== beforeVersionId
              && !!ranVersion && String(ranVersion.source).indexOf('probe-user-strategy') !== -1
              && typeof stdout === 'string' && stdout.indexOf('probe-user-strategy') !== -1,
        data: {
          outcome: runOutcome,
          runPath: afterRun.lastResult && afterRun.lastResult.metrics
            ? afterRun.lastResult.metrics.run_path : null,
          strategyId: strategyIdNow,
          versionId: versionIdNow,
          changed: versionIdNow !== beforeVersionId,
          versionOrigin: ranVersion ? ranVersion.origin : null,
          stdout: String(stdout).slice(0, 60),
        },
      }));

      // --- 배포 --- J와 같은 규칙으로 내 배포만 집는다: 목록은 created_at DESC라
      // "마지막 행"이 가장 오래된 배포다. 만든 id를 목록 차이로 집고, 그 id가 목록에서
      // 차지한 자리로만 DOM 행을 고른다(행에는 id가 실리지 않는다).
      const listDeployments = async () => {
        const res = await invoke(shellWin, 'athena:backtest-deployments');
        return res && res.ok && res.data ? (res.data.deployments || []) : [];
      };
      await goTab(shellWin, 4);
      await until(
        shellWin,
        `(() => (document.querySelector('${R}.backtest-deploy-create') ? true : null))()`,
        WAIT_VALIDATE,
      );
      await clickNth(shellWin, `${R}.backtest-deploy-mode-item`, 0);
      await wait(300);
      // 유효 종료가 비면 백엔드가 valid_to로 ''를 받아 만료 판정에 걸린다(J06과 같다).
      await js(shellWin, `(() => {
        const wrap = document.querySelector('${R}.backtest-deploy .backtest-card .backtest-field-row');
        if (!wrap) return false;
        const fields = Array.from(wrap.querySelectorAll('.backtest-field'));
        const setV = (i, v) => {
          const input = fields[i].querySelector('input');
          input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setV(2, '20000101');
        setV(3, '20991231');
        return true;
      })()`);
      const beforeDeployIds = (await listDeployments()).map((d) => d.id);
      await click(shellWin, `${R}.backtest-deploy-create`);
      let deployments = [];
      let deployId = null;
      const deployDeadline = Date.now() + WAIT_VALIDATE;
      while (Date.now() < deployDeadline && !deployId) {
        // eslint-disable-next-line no-await-in-loop
        await wait(250);
        // eslint-disable-next-line no-await-in-loop
        deployments = await listDeployments();
        const fresh = deployments.filter((d) => beforeDeployIds.indexOf(d.id) === -1);
        if (fresh.length) deployId = fresh[0].id;
      }
      if (deployId) created.deploymentIds.push(deployId);
      const mine = deployments.find((d) => d.id === deployId) || null;
      const deployIndex = deployments.findIndex((d) => d.id === deployId);
      const deployRow = deployIndex < 0 ? null : await until(shellWin, `(() => {
        const rows = Array.from(document.querySelectorAll('${R}.backtest-deploy-row'));
        if (rows.length !== ${deployments.length}) return null;
        const r = rows[${deployIndex}];
        if (!r) return null;
        return {
          symbol: (r.querySelector('.backtest-deploy-symbol') || {}).textContent,
          mode: (r.querySelector('.backtest-deploy-mode') || {}).textContent,
          status: (r.querySelector('.backtest-deploy-status') || {}).textContent,
          stop: r.querySelectorAll('.backtest-deploy-stop').length,
        };
      })()`, WAIT_VALIDATE);
      await step('M12', '내 전략 버전을 기록만 모드로 실전에 건다(그 행이 목록에 선다)', () => ({
        ok: !!deployId && !!mine && mine.strategy_version_id === versionIdNow
              && mine.mode === 'observe' && mine.status === 'active'
              && !!deployRow && deployRow.symbol === STK
              && deployRow.mode === '기록만 합니다' && deployRow.status === 'active'
              && deployRow.stop === 1,
        data: { id: deployId, versionId: versionIdNow, listed: mine, row: deployRow },
      }));

      const stages = ['signal', 'skipped', 'pending_approval', 'ordered', 'blocked'];
      const evaluated = deployId
        ? await invoke(shellWin, 'athena:backtest-evaluate', { deployment_id: deployId, today: TO })
        : null;
      const evalData = evaluated && evaluated.ok === true ? evaluated.data : null;
      await step('M12b', 'evaluate가 그 배포의 오늘 판정을 돌려준다(주문은 내지 않는다)', () => {
        if (!deployId) return { skip: '배포를 만들지 못했다', name: 'evaluate 판정' };
        return {
          ok: !!evalData && typeof evalData.dt === 'string' && evalData.dt.length > 0
                && stages.indexOf(evalData.stage) !== -1
                && typeof evalData.reason === 'string' && evalData.reason.length > 0,
          data: evalData
            || { status: evaluated && evaluated.status, error: evaluated && evaluated.error },
        };
      });

      const stopIndex = deployId
        ? (await listDeployments()).findIndex((d) => d.id === deployId) : -1;
      const stopClick = stopIndex < 0 ? null : await js(shellWin, `(() => {
        const rows = Array.from(document.querySelectorAll('${R}.backtest-deploy-row'));
        const row = rows[${stopIndex}];
        if (!row) return null;
        const before = (row.querySelector('.backtest-deploy-status') || {}).textContent;
        const btn = row.querySelector('.backtest-deploy-stop');
        if (!btn) return { before, clicked: false };
        btn.click();
        return { before, clicked: true };
      })()`);
      const stoppedRow = !stopClick ? null : await until(shellWin, `(() => {
        const rows = Array.from(document.querySelectorAll('${R}.backtest-deploy-row'));
        const row = rows[${stopIndex}];
        if (!row) return null;
        const status = (row.querySelector('.backtest-deploy-status') || {}).textContent;
        return status === 'stopped' ? { status } : null;
      })()`, WAIT_VALIDATE);
      await step('M12c', '[배포 중지]가 그 배포를 stopped로 만든다', () => {
        if (!deployId) return { skip: '배포를 만들지 못했다', name: '배포 중지' };
        return {
          ok: !!stopClick && stopClick.clicked === true && stopClick.before === 'active'
                && !!stoppedRow && stoppedRow.status === 'stopped',
          data: { id: deployId, target: stopClick, after: stoppedRow },
        };
      });

      // --- 흐름 지도 --- 로딩 블록은 백엔드 왕복 동안만 서 있다. 폴링으로 잡으면 빠른
      // 기계에서 놓치므로, 탭을 누르기 전에 관찰자를 걸어 "뜬 적이 있는가"를 사실로 남긴다.
      await goTab(shellWin, 0);
      await goSubtab(shellWin, 1);
      await wait(300);
      await js(shellWin, `(() => {
        const root = document.getElementById('backtestCanvas');
        if (window.__probeFlowObs) window.__probeFlowObs.disconnect();
        window.__probeFlowLoading = null;
        window.__probeFlowObs = new MutationObserver(() => {
          const n = root.querySelector('.backtest-flow-loading');
          if (n && window.__probeFlowLoading === null) {
            const t = n.querySelector('.backtest-flow-loading-text');
            window.__probeFlowLoading = {
              text: t ? t.textContent : null,
              spinner: n.querySelectorAll('.backtest-flow-spinner').length,
              nodes: root.querySelectorAll('.backtest-flow-node.is-mine').length,
            };
          }
        });
        window.__probeFlowObs.observe(root, { childList: true, subtree: true });
        return true;
      })()`);
      await goSubtab(shellWin, 0);
      const flowMap = await until(shellWin, `(() => {
        const root = document.getElementById('backtestCanvas');
        const nodes = root.querySelectorAll('button.backtest-flow-node.is-mine');
        if (!nodes.length) return null;
        const loading = root.querySelectorAll('.backtest-flow-loading').length;
        // 앞 판이 그대로 서 있는 채 새 요청이 도는 순간이 있다(loadMap에는 요청 번호가
        // 없다) — 그 사이를 재면 "칸은 있는데 아직 만드는 중"이라는, 아무도 오래 보지
        // 않는 중간 화면을 판정하게 된다. 판정 내용은 그대로 두고 자리 잡은 화면만 잰다.
        if (loading) return null;
        return {
          mine: nodes.length,
          loading,
          error: root.querySelectorAll('.backtest-flow-error').length,
        };
      })()`, WAIT_VALIDATE);
      const flowWatch = await js(shellWin, `(() => {
        const seen = window.__probeFlowLoading;
        if (window.__probeFlowObs) window.__probeFlowObs.disconnect();
        window.__probeFlowObs = null;
        return { seen: seen || null };
      })()`);
      const loadingSeen = flowWatch ? flowWatch.seen : null;
      await step('M13', '지도 탭은 만드는 중임을 먼저 그리고, 그 자리에 지도를 세운다', () => ({
        ok: !!loadingSeen && loadingSeen.text === '흐름 지도를 만드는 중…'
              && loadingSeen.spinner === 1
              && !!flowMap && flowMap.mine > 0 && flowMap.loading === 0 && flowMap.error === 0,
        data: { loading: loadingSeen, map: flowMap },
      }));
    }

    // --- 되돌리기 --- 등록과 배포는 프로브가 켠 스위치라 끈다. 프로젝트는 목록에서만
    // 빼고 파일은 그대로 둔다 — 백엔드가 그렇게 답하는지, 디스크가 그런지까지 확인한다.
    const unregistered = await invoke(
      shellWin, 'athena:backtest-user-strategy-unregister', { strategy_id: userStrategyId },
    );
    if (unregistered && unregistered.ok) {
      const at = created.userStrategyIds.indexOf(userStrategyId);
      if (at !== -1) created.userStrategyIds.splice(at, 1);
    }
    const listAfter = await invoke(shellWin, 'athena:backtest-user-strategies');
    const stillRegistered = listAfter && listAfter.ok && listAfter.data
      ? (listAfter.data.strategies || []).some((s) => s.id === userStrategyId) : true;
    const dropped = await backendJson('DELETE', `/api/v1/projects/${encodeURIComponent(projectId)}`);
    const droppedBody = dropped.body || {};
    if (dropped.status === 200) {
      const at = created.projectIds.indexOf(projectId);
      if (at !== -1) created.projectIds.splice(at, 1);
    }
    const folderStill = !!projectPath && fs.existsSync(projectPath);
    const fileStill = !!projectPath && fs.existsSync(path.join(projectPath, 'algos', 'ma.py'));
    await step('M14', '등록과 프로젝트를 되돌린다 — 디스크의 파일은 그대로 남는다', () => ({
      ok: !!(unregistered && unregistered.ok) && stillRegistered === false
            && dropped.status === 200 && droppedBody.files_deleted === false
            && folderStill === true && fileStill === true,
      data: {
        unregister: unregistered && unregistered.data,
        stillRegistered,
        project: { status: dropped.status, files_deleted: droppedBody.files_deleted },
        disk: { folder: folderStill, file: fileStill, path: projectPath },
      },
    }));
  });

  // ==================================================================
  // N 흐름 지도가 첫 표면 (보드 11~14)
  //
  // 사용자 확정 2026-09-03: "코드는 최후의 보루야. 대화를 하면서 코드 플로우 지도를
  // 수정해 나가는거고, 그 코드 플로우 지도 뒤에 코드가 있는거야." 이 섹션이 재는 것은
  // 그 문장이 화면에서 참인가다 — 전략을 세우면 지도가 먼저 뜨는가, 대화 한 번이
  // 어느 칸을 바꿨다고 말하는가, 오른쪽 숫자가 **실제 실행**의 값인가.
  // ==================================================================
  if (on('N')) await section('N', async () => {
    // 프리셋을 고르는 순간이 지도 v1이다. 고른 뒤 종목·기간을 채워야 대상 한 줄이 서고
    // 실행이 승인 화면으로 새지 않는다 — ensureRunnableForm이 그 둘을 한 번에 한다.
    await clickNth(shellWin, `${R}.backtest-preset-item`, 0);
    await ensureRunnableForm(shellWin, FROM, TO);
    await goSubtab(shellWin, 0);
    const opened = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      const nodes = (c.map && c.map.nodes) || [];
      if (c.designTab !== 'flow' || !nodes.length) return null;
      return {
        designTab: c.designTab,
        version: c.map.version,
        numerals: nodes.map((n) => n.numeral),
        target: (root.querySelector('.backtest-visual-target') || {}).textContent || null,
        drawerFile: (root.querySelector('.backtest-visual-drawer-file') || {}).textContent || null,
        openCode: root.querySelectorAll('.backtest-visual-open-code').length,
        paletteGroups: root.querySelectorAll('.backtest-vis-palette-group').length,
        nodeButtons: root.querySelectorAll('.backtest-vis-node').length,
        // 요약 지도는 스펙 경로에서 사라졌다 — 그 자리가 비었다는 것도 함께 잰다.
        summaryNodes: root.querySelectorAll('.backtest-flow-node').length,
      };
    })()`, WAIT_VALIDATE);
    // **계약이 두 번 바뀐 자리다.**
    // ① US-007(커밋 5b746c9·3f35c1b): 스펙 경로의 지도 탭은 읽기 전용 요약 지도가 아니라
    //    **편집 가능한 시각 설계**다. 그래서 서랍도 `.backtest-map-drawer-*`가 아니라
    //    `.backtest-visual-drawer-*`다.
    // ② 2026-09-03 사용자 확정: 그 위에 서 있던 요약 지도(칸 ①~④)를 **없앴다**. 같은
    //    흐름을 두 번 말하지 않는다. 지도의 재료는 그대로 살아 있어(getContext().map)
    //    대화가 그것으로 답한다 — 그래서 칸 번호는 DOM이 아니라 컨텍스트에서 잰다.
    // 검사는 느슨해지지 않는다: 칸 ①~④가 실제로 만들어졌는지, 서랍이 '생성됨'을
    // 가리키는지(새 기법의 지도 뒤에는 아직 코드가 없다), 편집 표면이 섰는지를 다 재고,
    // 없앤 요약 지도가 정말 사라졌는지(summaryNodes === 0)를 하나 더 잰다.
    await step('N01', '기법을 고르면 지도가 첫 화면이다 — 대상 한 줄·편집기·코드 서랍(요약 지도는 없다)', () => ({
      ok: !!opened && opened.designTab === 'flow' && opened.version === 1
            && JSON.stringify(opened.numerals) === JSON.stringify(['①', '②', '③', '④'])
            && !!opened.target && opened.target.indexOf(STK) === 0
            && opened.drawerFile === '생성됨' && opened.openCode === 1
            && opened.paletteGroups >= 1 && opened.nodeButtons >= 7
            && opened.summaryNodes === 0,
      data: opened,
    }));

    // 대화 한 번 — 영수증은 사람이 읽는 카드의 재료다(chat.js가 그린다).
    const receipt = await js(
      shellWin,
      "window.AthenaBacktestCanvas.onChatAction({ kind: 'spec_draft', patch: { params: { fast: 9 } }, note: '빠른 이평을 9로' })",
    );
    // 요약 지도가 사라진 뒤로 '방금 바뀜' 알약이 설 자리는 없다 — 그래서 같은 사실을
    // 화면이 아니라 **화면이 다음 턴에 넘기는 것**에서 잰다(느슨해지지 않는다: 바뀐 칸이
    // 하나인지, 그 칸이 ①인지, 지도가 실제로 새 판으로 올라섰는지를 그대로 센다).
    // 새 판이 도착한 뒤를 재는 이유도 같다: 반영은 즉시고 지도는 백엔드 왕복 뒤라
    // 그 사이를 재면 "v1인데 방금 바뀜"이라는 중간 화면을 판정하게 된다.
    const changed = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const ids = (c.lastChange && c.lastChange.nodes) || [];
      if (!ids.length || c.map.version !== 2) return null;
      const nodes = (c.map && c.map.nodes) || [];
      const hit = nodes.filter((n) => ids.indexOf(n.id) !== -1);
      if (!hit.length) return null;
      return {
        ids,
        numerals: hit.map((n) => n.numeral),
        title: hit[0].title || null,
        version: c.map.version,
      };
    })()`, WAIT_VALIDATE);
    await step('N02', '대화 한 번이 어느 칸을 바꿨는지 영수증과 지도가 같이 말한다', () => ({
      ok: !!receipt && Array.isArray(receipt.nodes) && receipt.nodes.length === 1
            && receipt.nodes[0].numeral === '①'
            && String(receipt.nodes[0].text).indexOf('파라미터 fast') === 0
            && !!receipt.version && receipt.version.from === 1 && receipt.version.to === 2
            && !!changed && changed.ids.length === 1
            && JSON.stringify(changed.numerals) === JSON.stringify(['①'])
            && changed.version === 2,
      data: { receipt: receipt && { nodes: receipt.nodes, version: receipt.version }, changed },
    }));

    // 오른쪽 숫자는 지어낸 값이 아니라 **지난 실행**의 값이다 — 그래서 한 번 돌린다.
    await goDesignForm(shellWin);
    await setDates(shellWin, FROM, TO);
    await wait(200);
    await click(shellWin, `${R}.backtest-run-button`);
    const ran = await waitRunOutcome(shellWin, WAIT_RUN);
    await goTab(shellWin, 0);
    await goSubtab(shellWin, 0);
    // 요약 지도가 사라졌으니 오른쪽 사실도 화면에는 없다 — 그러나 사실 자체는 백엔드가
    // 지난 실행을 보고 만들어 준 것이고, 화면은 그것을 다음 턴 컨텍스트에 그대로 싣는다
    // (mapContext의 facts). 재는 값은 옛 단계와 같다: ②는 봉 수·워밍업, ③은 신호 수,
    // 그리고 그 숫자가 **어느 실행**의 것인지(lastResult.runId).
    const facts = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const nodes = (c.map && c.map.nodes) || [];
      if (!nodes.length) return null;
      const shapes = nodes.map((n) => (n.facts || []).join('\\n'));
      if (!shapes.some((t) => t.length)) return null;
      return {
        shapes,
        runId: c.lastResult ? c.lastResult.runId : null,
      };
    })()`, WAIT_VALIDATE);
    await step('N03', '②·③의 오른쪽 사실이 지난 실행이 만든 값이다', () => {
      if (!ran || ran.view !== 'result') {
        return { skip: `실행이 결과 화면까지 가지 않았다(${ran && ran.view})` };
      }
      return {
        ok: !!facts
              && /행 × 5열|워밍업/.test(String(facts.shapes[1] || ''))
              && /entry \d+개 · exit \d+개/.test(String(facts.shapes[2] || ''))
              && !!facts.runId,
        data: facts,
      };
    });

    // [코드 열기] — 폼 경로에서는 지도 뒤의 코드가 그때 만들어진다. 실행경로는 그대로다.
    // 버튼이 사는 자리는 N01과 같은 이유로 바뀌었다(편집 가능한 지도의 서랍) — 하는 일과
    // 재는 것은 그대로다. 두 자리 중 있는 쪽을 누른다: 코드 경로·내 전략의 지도는 여전히
    // 읽기 전용이라 `.backtest-map-open-code`가 그 자리에 남아 있다.
    await click(shellWin, `${R}.backtest-visual-open-code`);
    await click(shellWin, `${R}.backtest-map-open-code`);
    const drawerOpened = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'code' || !c.code.source) return null;
      return {
        runPath: c.runPath,
        lines: c.code.lines,
        hasSignals: c.code.source.indexOf('def signals(df, p):') !== -1,
        banner: (root.querySelector('.backtest-code-frommap') || {}).textContent || null,
      };
    })()`, WAIT_VALIDATE);
    await step('N04', '[코드 열기]는 지도 뒤의 코드를 만들되 실행경로를 바꾸지 않는다', () => ({
      ok: !!drawerOpened && drawerOpened.hasSignals === true && drawerOpened.runPath === 'form'
            && drawerOpened.lines > 0
            && drawerOpened.banner === '여기서 고치면 지도와 어긋날 수 있습니다 — 웬만하면 대화로',
      data: drawerOpened,
    }));

    // 멈춘 실행은 줄 번호가 아니라 칸에 붙는다(보드 12).
    const beforeRunId = await js(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return c.lastResult ? c.lastResult.runId : null;
    })()`);
    sendChat(shellWin, { kind: 'code_draft', source: SRC_RAISES, note: '터지는 코드' });
    await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return c.code.source.indexOf('전략 로직이 터졌다') !== -1 ? true : null;
    })()`, WAIT_UI);
    await click(shellWin, `${R}.backtest-run-button`);
    const failed = await waitNewRunOutcome(shellWin, beforeRunId, WAIT_RUN);
    const stopped = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (!c.diagnosis) return null;
      const hit = (c.map.nodes || []).filter((n) => n.status === 'error');
      return {
        view: c.view,
        errorNodes: hit.map((n) => n.numeral),
        title: (root.querySelector('.backtest-diag-title') || {}).textContent || null,
      };
    })()`, WAIT_VALIDATE);
    await step('N05', '실행이 멈추면 그 사실이 칸에 붙고 진단 제목이 칸 번호로 시작한다', () => {
      if (!failed || (failed.view !== 'diagnosis' && failed.view !== 'error')) {
        return { skip: `실행이 실패 화면까지 가지 않았다(${failed && failed.view})` };
      }
      if (!stopped || !stopped.errorNodes.length) {
        return { skip: '백엔드가 이 오류를 붙일 칸을 찾지 못했다 — 지도는 거짓말을 하지 않는다' };
      }
      return {
        ok: String(stopped.title || '').indexOf(stopped.errorNodes[0]) === 0,
        data: stopped,
      };
    });

    await ensureRunnableForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // O 시각 설계 왕복(보드 11→12→13→14)
  //
  // N까지가 "지도가 첫 표면"이었다면 여기는 **그 지도가 편집 표면**이라는 사실을 잰다:
  // 프리셋 하나가 그래프가 되고, 값을 고치면 폼이 따라오고, 연결을 끊으면 같은 진단
  // 코드가 네 곳(칸·포트·검사기·요약 바)에 함께 서고, 그 칸에서 코드로 내려가면 미실행
  // 미리보기의 그 줄이 켜진다. 고치는 길은 하나뿐이다 — 질문 하나 → 비활성 수정안 →
  // 사람이 [적용]. 적용이 남기는 것도 하나뿐이다: **비활성** 버전 한 개.
  //
  // 그래서 이 섹션은 매 단계 "일어나지 않은 일"도 같이 센다 — 실행 수·배포 수·활성
  // 버전 id. 저작 경로가 그 셋 중 하나라도 움직이면 그것이 이 기능의 실패다.
  // ==================================================================
  if (on('O')) await section('O', async () => {
    // 렌더러가 그리다 던지면 캔버스는 통째로 빈 화면이 된다 — 그 예외는 executeJavaScript로
    // 잡히지 않아(클릭 핸들러 안에서 터진다) 리포트에는 "아무것도 없다"만 남는다.
    // 그리기 실패는 이 섹션이 재는 것들의 가장 흔한 원인이라 여기서만 따로 모은다.
    await js(shellWin, `(() => {
      if (window.__probeRenderErrors) return true;
      window.__probeRenderErrors = [];
      window.addEventListener('error', (e) => {
        window.__probeRenderErrors.push(String((e && e.error && e.error.stack) || (e && e.message) || e));
      });
      return true;
    })()`);
    // 섹션만 골라 돌면(ATHENA_PROBE_SECTIONS=O) A가 돌지 않아 모드에 들어간 적이 없다.
    await js(shellWin, "(() => { const n = document.getElementById('modeNavBacktest'); if (n) n.click(); return true; })()");
    // 프리셋 목록은 **폼 하위탭에만** 있다(지도 탭은 지도를 그린다) — 여기서 지도 탭을
    // 보고 기다리면 25초를 버리고 아무 일도 안 일어난다(2026-09-03 실측).
    await goDesignForm(shellWin);
    await until(
      shellWin,
      `(document.querySelectorAll('${R}.backtest-preset-item').length ? true : null)`,
      WAIT_PRESETS,
    );
    await ensureRunnableForm(shellWin, FROM, TO);
    await goSubtab(shellWin, 0);

    // 화면 한 장을 통째로 읽는 식 — 단계마다 같은 자리를 재야 "무엇이 언제 움직였나"가
    // 로그에서 그대로 비교된다.
    const READ = `(() => {
      const root = document.getElementById('backtestCanvas');
      const api = window.AthenaBacktestCanvas;
      const c = api ? api.getContext() : null;
      if (!c) return null;
      const vis = root.querySelector('.backtest-visual');
      if (!vis) return null;
      const nodes = root.querySelectorAll('.backtest-vis-node');
      if (!nodes.length) return null;
      const graph = c.map.graph;
      return {
        designTab: c.designTab,
        state: c.map.validation_state,
        codeOnly: c.map.code_only,
        mapVersion: c.map.version,
        graphNodes: graph ? graph.nodes.length : 0,
        graphEdges: graph ? graph.edges.length : 0,
        graphHash: c.map.hashes ? c.map.hashes.graph_hash : null,
        diagnostics: c.map.diagnostics.map((d) => d.code),
        // 칸 ①~④는 화면에서 사라졌다(2026-09-03 요약 지도 제거) — 만들어졌다는 사실은
        // 컨텍스트에서 재고, 그 자리가 실제로 비었는지는 summaryNodes로 잰다.
        numerals: ((c.map && c.map.nodes) || []).map((n) => n.numeral),
        summaryNodes: root.querySelectorAll('.backtest-flow-node').length,
        target: (root.querySelector('.backtest-visual-target') || {}).textContent || null,
        paletteGroups: root.querySelectorAll('.backtest-vis-palette-group').length,
        nodeButtons: nodes.length,
        edges: root.querySelectorAll('.backtest-vis-edge').length,
        status: (root.querySelector('.backtest-visual-status-text') || {}).textContent || null,
        summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
        summaryDetail: (root.querySelector('.backtest-vis-summary-detail') || {}).textContent || null,
      };
    })()`;
    // 상태가 자리 잡을 때까지 기다리는 판본 — 중간 화면('validating')을 판정하지 않는다.
    const readWhen = (states) => `(() => {
      const v = ${READ};
      if (!v || ${JSON.stringify(states)}.indexOf(v.state) === -1) return null;
      return v;
    })()`;

    // 지금 남아 있는 것들 — 저작 경로가 건드리면 안 되는 값들이다.
    const countRuns = async () => {
      const res = await invoke(shellWin, 'athena:backtest-runs');
      return res && res.ok && res.data ? (res.data.runs || []).length : null;
    };
    const countDeployments = async () => {
      const res = await invoke(shellWin, 'athena:backtest-deployments');
      return res && res.ok && res.data ? (res.data.deployments || []).length : null;
    };
    const listVersions = async (id) => {
      if (!id) return [];
      const res = await invoke(shellWin, 'athena:backtest-versions', { strategy_id: id });
      return res && res.ok && res.data ? (res.data.versions || []) : [];
    };
    const headOf = (list) => list.reduce(
      (best, v) => (best && Number(best.version) >= Number(v.version) ? best : v), null,
    );

    // ── O01 · 편집 가능한 지도(보드 11) ──────────────────────────────────────
    // 편집 표면이 서지 않는 이유는 넷뿐이다(visualActive): 배선 없음 · 한 번 접힘 ·
    // 스펙 경로가 아님(내 전략·프로젝트 파일·코드 실행경로) · 그래프 없음. 그 넷을
    // 판정 전에 한 줄로 남긴다 — 전수 실행에서 앞 섹션이 남긴 상태 때문에 O가 통째로
    // 무너질 때, 리포트에 null만 남으면 어느 것이었는지 아무도 모른다.
    const entry = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        runPath: c.runPath,
        designTab: c.designTab,
        codeOnly: c.map.code_only,
        graphNodes: c.map.graph ? c.map.graph.nodes.length : null,
        codeLines: c.code.lines,
        openFile: c.project ? c.project.activeFile : null,
        notice: (root.querySelector('.backtest-flow-notice') || {}).textContent || null,
        readOnlyBadge: (root.querySelector('.backtest-flow-codeonly') || {}).textContent || null,
        shell: root.querySelectorAll('.backtest-shell').length,
        // 칸 ①~④가 비는 이유는 지도 요청이 실패했을 때다 — 그 문장이 진단이다.
        mapError: (root.querySelector('.backtest-flow-error') || {}).textContent || null,
        mapLoading: root.querySelectorAll('.backtest-flow-loading').length,
        renderErrors: (window.__probeRenderErrors || []).slice(-3),
      };
    })()`);
    const opened = await until(shellWin, READ, WAIT_VALIDATE);
    await click(shellWin, `${R}.backtest-visual-validate`);
    const validated = await until(shellWin, readWhen(['valid', 'synced']), WAIT_VALIDATE);
    await step('O01', '지도 탭이 편집 가능한 그래프를 세우고 서버 검증까지 간다(요약 지도는 없다)', () => ({
      ok: !!opened && opened.designTab === 'flow'
            && JSON.stringify(opened.numerals) === JSON.stringify(['①', '②', '③', '④'])
            && opened.summaryNodes === 0
            && !!opened.target && opened.target.indexOf(STK) === 0
            && opened.paletteGroups >= 1 && opened.nodeButtons >= 7 && opened.edges >= 1
            && opened.state === 'unvalidated' && opened.status === null
            && opened.summaryTitle === '아직 검증하지 않았습니다'
            && opened.summaryDetail === '서버 검증을 거쳐야 실행할 수 있습니다'
            && !!validated && validated.state === 'synced'
            && validated.status === '그래프·코드 검증 완료'
            && validated.summaryTitle === '그래프와 코드가 같은 버전입니다'
            && validated.diagnostics.every((code) => code === 'BTG-DATA-001'),
      data: { entry, opened, validated },
    }));

    // ── O02 · 편집기에서 고친 값이 폼으로 흐른다 ────────────────────────────
    const beforeParam = validated || opened;
    const paramEdit = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const card = root.querySelector('.backtest-vis-node[data-node-id="param-fast"]');
      if (!card) return { ok: false, why: 'param-fast 칸이 없다' };
      card.click();
      const field = root.querySelector(
        '.backtest-vis-inspector .backtest-vis-field[data-param="default"] .backtest-vis-number',
      );
      if (!field) return { ok: false, why: '검사기에 기본값 칸이 없다' };
      const before = field.value;
      field.value = '12';
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, before };
    })()`);
    const paramSynced = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.map.validation_state !== 'synced') return null;
      const graph = c.map.graph;
      const node = graph ? graph.nodes.filter((n) => n.id === 'param-fast')[0] : null;
      if (!node || Number(node.params.default) !== 12) return null;
      return {
        state: c.map.validation_state,
        graphDefault: node.params.default,
        specFast: c.spec && c.spec.params ? c.spec.params.fast : null,
        // 이름표는 편집기가 그리지 않는 값이라 조용히 사라지기 쉽다 — 값 하나를 고친 뒤에도
        // 전략 이름과 프리셋 id가 그대로인지 같이 잰다.
        specName: c.spec ? c.spec.name : null,
        presetId: c.spec ? c.spec.presetId : null,
        graphHash: c.map.hashes ? c.map.hashes.graph_hash : null,
        mapVersion: c.map.version,
      };
    })()`, WAIT_VALIDATE);
    await step('O02', '검사기에서 고친 값이 디바운스 뒤 그래프·폼 스펙에 같이 들어간다', () => ({
      ok: !!paramEdit && paramEdit.ok === true
            && !!paramSynced && Number(paramSynced.graphDefault) === 12
            && !!paramSynced.specFast && Number(paramSynced.specFast.default) === 12
            && !!paramSynced.graphHash && !!beforeParam
            && paramSynced.graphHash !== beforeParam.graphHash
            && paramSynced.specName === 'SMA 골든크로스' && paramSynced.presetId === 'sma_crossover',
      data: {
        edited: paramEdit,
        specFast: paramSynced && paramSynced.specFast,
        specName: paramSynced && paramSynced.specName,
        presetId: paramSynced && paramSynced.presetId,
        hashBefore: beforeParam && beforeParam.graphHash,
        hashAfter: paramSynced && paramSynced.graphHash,
        // 지도 판 번호는 대화 반영이 세는 숫자다 — 편집기의 직접 편집은 세지 않는다.
        mapVersion: paramSynced && paramSynced.mapVersion,
      },
    }));

    // ── O0B · 왕복의 base가 될 버전 하나를 사람 손으로 남긴다 ────────────────
    // 적용(O07)은 "그 사이 다른 수정이 먼저 저장됐는가"를 base 버전으로 판정한다 —
    // 비교할 머리가 없으면 무엇을 재는지 알 수 없는 성공/실패가 된다.
    await click(shellWin, `${R}.backtest-visual-open-code`);
    await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return (c.designTab === 'code' && c.code.source.indexOf('def signals(df, p):') !== -1) ? true : null;
    })()`, WAIT_VALIDATE);
    // 앞 섹션이 이미 전략을 만들어 뒀으면 strategyId·activeVersionId가 저장 **전에도**
    // 차 있다 — 그 둘이 있는지만 기다리면 저장이 끝나기 전 값을 읽고 지나간다
    // (2026-09-03 실측: O0B가 앞 버전 id를 base로 물고 O07의 활성 버전 비교가 어긋났다).
    // 활성 버전이 **바뀐 것**을 기다린다.
    const beforeSaveVersionId = await js(shellWin, '(window.AthenaBacktestCanvas.getContext().code.activeVersionId)');
    await click(shellWin, `${R}.backtest-code-save`);
    const baseSaved = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      if (!c.code.strategyId || !c.code.activeVersionId) return null;
      if (c.code.activeVersionId === ${JSON.stringify(beforeSaveVersionId)}) return null;
      return { strategyId: c.code.strategyId, activeVersionId: c.code.activeVersionId, lines: c.code.lines };
    })()`, WAIT_VALIDATE);
    if (baseSaved && baseSaved.strategyId
      && created.strategyIds.indexOf(baseSaved.strategyId) === -1) {
      created.strategyIds.push(baseSaved.strategyId);
    }
    const baseVersions = await listVersions(baseSaved && baseSaved.strategyId);
    const baseHead = headOf(baseVersions);
    await step('O0B', '지도 뒤의 코드를 [이 코드로 저장]하면 왕복의 base가 되는 활성 버전이 선다', () => ({
      ok: !!baseSaved && !!baseHead && baseHead.id === baseSaved.activeVersionId
            && baseHead.active === true,
      data: {
        strategyId: baseSaved && baseSaved.strategyId,
        versions: baseVersions.map((v) => ({ v: v.version, origin: v.origin, active: v.active })),
      },
    }));
    await goSubtab(shellWin, 0);

    // ── O03 · 연결 오류(보드 12) — 같은 코드가 네 곳에 함께 선다 ────────────
    const cut = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const card = root.querySelector('.backtest-vis-node[data-node-id="cond-exit-1"]');
      if (!card) return { ok: false, why: 'cond-exit-1 칸이 없다' };
      card.click();
      const sel = root.querySelector(
        '.backtest-vis-inspector select.backtest-vis-select[data-node-id="cond-exit-1"][data-port="right"]',
      );
      if (!sel) return { ok: false, why: '검사기에 오른쪽 입력 칸이 없다' };
      const had = sel.value;
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, had };
    })()`);
    const broken = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.map.validation_state !== 'invalid') return null;
      const run = root.querySelector('.backtest-run-button');
      const n = (sel) => root.querySelectorAll(sel).length;
      const graph = c.map.graph;
      return {
        state: c.map.validation_state,
        diagnostics: c.map.diagnostics,
        graphHash: c.map.hashes ? c.map.hashes.graph_hash : null,
        graphEdges: graph ? graph.edges.length : 0,
        node: n('.backtest-vis-node.is-error[data-node-id="cond-exit-1"][data-diag-code="BTG-PORT-002"]'),
        port: n('.backtest-vis-port[data-node-id="cond-exit-1"][data-port="right"][data-diag-code="BTG-PORT-002"]'),
        inspector: n('.backtest-vis-inspector-error[data-diag-code="BTG-PORT-002"]'),
        summary: n('.backtest-vis-summary[data-diag-code="BTG-PORT-002"]'),
        errorCode: (root.querySelector('.backtest-vis-error-code') || {}).textContent || null,
        runText: run ? (run.textContent || '').trim() : null,
        runDisabled: run ? !!run.disabled : null,
      };
    })()`, WAIT_VALIDATE);
    const portDiag = broken
      ? broken.diagnostics.filter((d) => d.code === 'BTG-PORT-002')[0] || null
      : null;
    await step('O03', '청산 조건의 오른쪽 입력을 끊으면 BTG-PORT-002가 칸·포트·검사기·요약 바에 함께 선다', () => ({
      ok: !!cut && cut.ok === true && !!broken && broken.state === 'invalid'
            && !!portDiag && portDiag.node_id === 'cond-exit-1' && portDiag.port === 'right'
            && broken.node === 1 && broken.port === 1 && broken.inspector === 1 && broken.summary === 1
            && broken.errorCode === 'BTG-PORT-002'
            && broken.runText === '오류 검토' && broken.runDisabled === true,
      data: { cut, broken },
    }));

    // ── O04 · 오류 칸에서 코드로(보드 13) — 미실행 미리보기의 그 줄 ─────────
    await js(shellWin, `(() => {
      const card = document.querySelector('${R}.backtest-vis-node[data-node-id="cond-exit-1"]');
      if (!card) return false;
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    const preview = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'code') return null;
      const ta = root.querySelector('.backtest-code-textarea');
      const lit = Array.from(root.querySelectorAll('.backtest-code-gutter .backtest-code-line.is-lit'))
        .map((l) => Number(l.textContent));
      if (!ta || !lit.length) return null;
      const lines = String(ta.value).split('\\n');
      const graph = c.map.graph;
      const node = graph ? graph.nodes.filter((n) => n.id === 'cond-exit-1')[0] : null;
      const banner = root.querySelector('.backtest-code-preview-banner');
      const ribbon = root.querySelector('.backtest-code-ribbon');
      return {
        designTab: c.designTab,
        label: node ? node.label : null,
        ribbonHidden: ribbon ? !!ribbon.hidden : null,
        ribbonLabel: (root.querySelector('.backtest-code-ribbon-label') || {}).textContent || null,
        ribbonKind: (root.querySelector('.backtest-code-ribbon-kind') || {}).textContent || null,
        ribbonCode: (root.querySelector('.backtest-code-ribbon-code') || {}).textContent || null,
        bannerHidden: banner ? !!banner.hidden : null,
        bannerText: banner ? banner.textContent : null,
        readOnly: !!ta.readOnly,
        lit,
        litText: lit.map((k) => lines[k - 1] || ''),
      };
    })()`, WAIT_VALIDATE);
    await click(shellWin, `${R}.backtest-code-ribbon-back`);
    const backOnNode = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'flow') return null;
      const sel = root.querySelector('.backtest-vis-node.is-selected');
      if (!sel) return null;
      return { designTab: c.designTab, selected: sel.getAttribute('data-node-id') };
    })()`, WAIT_UI);
    await step('O04', '오류 칸에서 Enter를 누르면 미실행 미리보기의 __MISSING__ 줄이 켜지고, 리본이 그 칸으로 되돌린다', () => ({
      ok: !!preview && preview.ribbonHidden === false
            && preview.ribbonLabel === `연결된 노드 · ${preview.label}`
            && preview.ribbonKind === '미실행 미리보기'
            && preview.ribbonCode === 'BTG-PORT-002'
            && preview.bannerHidden === false && preview.readOnly === true
            && preview.litText.some((t) => String(t).indexOf('__MISSING__') !== -1)
            && !!backOnNode && backOnNode.selected === 'cond-exit-1',
      data: { preview, backOnNode },
    }));

    // ── O05 · 질문 카드(한 번에 하나) ────────────────────────────────────────
    // 모델이 내는 액션과 **같은 봉투**로 넣는다: athena_backtest가 백엔드에서 받은
    // question을 {kind:'visual_question', payload}로 실어 보낸다(backtest_tools
    // _canvas_envelope). 질문 자체는 지금 화면의 그래프로 서버가 만든 진짜 값이다.
    const graphForAsk = await js(shellWin, '(() => { const c = window.AthenaBacktestCanvas.getContext(); return c.map.graph; })()');
    const asked = await backendJson('POST', '/api/v1/backtest/visual/question', { graph: graphForAsk });
    const question = asked && asked.body ? asked.body.question : null;
    const historyBefore = await countOf(shellWin, '#history .backtest-visual');
    const runsBefore = await countRuns();
    const deploysBefore = await countDeployments();
    sendChat(shellWin, { kind: 'visual_question', payload: question });
    const questionCard = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      if (!cards.length) return null;
      const card = cards[cards.length - 1];
      const pill = card.querySelector('.routine-draft-pill.is-filled');
      if (!pill || pill.textContent !== '한 가지만 확인할게요') return null;
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        cards: cards.length,
        title: pill.textContent,
        body: (card.querySelector('.agent-body') || {}).textContent || null,
        choices: Array.from(card.querySelectorAll('.backtest-visual-choice'))
          .map((b) => ({
            label: (b.querySelector('.backtest-visual-choice-label') || {}).textContent || null,
            recommended: Array.from(b.querySelectorAll('.routine-draft-pill'))
              .filter((p) => p.textContent === '권장').length > 0,
            changes: (b.querySelector('.backtest-visual-choice-changes') || {}).textContent || null,
          })),
        makeDisabled: Array.from(card.querySelectorAll('button'))
          .filter((b) => (b.textContent || '').trim() === '수정안 만들기')
          .map((b) => !!b.disabled)[0],
        pendingQuestion: c.map.pendingQuestion,
        graphHash: c.map.hashes ? c.map.hashes.graph_hash : null,
        state: c.map.validation_state,
      };
    })()`, WAIT_VALIDATE);
    await step('O05', '질문 카드가 한 장 뜨고 그래프는 그대로다 — 고르기 전에는 [수정안 만들기]가 잠겨 있다', () => ({
      ok: asked.status === 200 && !!question && question.code === 'BTG-PORT-002'
            && !!questionCard && questionCard.title === '한 가지만 확인할게요'
            && questionCard.cards === historyBefore + 1
            && questionCard.choices.length >= 2
            && questionCard.choices.filter((c) => c.recommended).length === 1
            && questionCard.makeDisabled === true
            && !!questionCard.pendingQuestion
            && questionCard.pendingQuestion.code === 'BTG-PORT-002'
            && !!broken && questionCard.graphHash === broken.graphHash
            && questionCard.state === 'invalid',
      data: {
        status: asked.status,
        question: question && {
          code: question.code, choices: (question.choices || []).length, remaining: question.remaining,
        },
        card: questionCard,
      },
    }));

    // ── O06 · 비활성 수정안(만들기만 한다) ──────────────────────────────────
    const versionsBefore = await listVersions(baseSaved && baseSaved.strategyId);
    await js(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      const card = cards[cards.length - 1];
      if (!card) return false;
      const pick = Array.from(card.querySelectorAll('.backtest-visual-choice'))
        .filter((b) => Array.from(b.querySelectorAll('.routine-draft-pill'))
          .some((p) => p.textContent === '권장'))[0];
      if (!pick) return false;
      pick.click();
      return true;
    })()`);
    await clickLastCardButton(shellWin, '수정안 만들기');
    const patchCard = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      if (!cards.length) return null;
      const card = cards[cards.length - 1];
      const pill = card.querySelector('.routine-draft-pill.is-filled');
      if (!pill || pill.textContent !== '그래프 + 코드 패치') return null;
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        cards: cards.length,
        title: pill.textContent,
        diffRows: card.querySelectorAll('.backtest-diff-row').length,
        addedRows: card.querySelectorAll('.backtest-diff-row.is-add').length,
        summary: (card.querySelector('.backtest-change-row') || {}).textContent || null,
        buttons: Array.from(card.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
        pendingPatch: c.map.pendingPatch,
        pendingQuestion: c.map.pendingQuestion,
        graphHash: c.map.hashes ? c.map.hashes.graph_hash : null,
        state: c.map.validation_state,
      };
    })()`, WAIT_VALIDATE);
    const versionsAfterPatch = await listVersions(baseSaved && baseSaved.strategyId);
    const runsAfterPatch = await countRuns();
    await step('O06', '[수정안 만들기]는 수정안 카드 한 장만 만든다 — 그래프도 버전도 실행도 그대로다', () => ({
      ok: !!patchCard && patchCard.title === '그래프 + 코드 패치'
            && patchCard.cards === historyBefore + 2
            && patchCard.diffRows > 0 && patchCard.addedRows > 0
            && !!patchCard.summary && patchCard.summary.length > 0
            && patchCard.buttons.indexOf('적용하고 시각 설계로 돌아가기') !== -1
            && !!patchCard.pendingPatch && !!patchCard.pendingPatch.patch_id
            && patchCard.pendingPatch.graph_compatible === true
            && patchCard.pendingQuestion === null
            && !!broken && patchCard.graphHash === broken.graphHash
            && patchCard.state === 'invalid'
            && versionsAfterPatch.length === versionsBefore.length
            && runsAfterPatch === runsBefore,
      data: {
        card: patchCard && {
          cards: patchCard.cards, diffRows: patchCard.diffRows, summary: patchCard.summary,
          buttons: patchCard.buttons, pendingPatch: patchCard.pendingPatch,
        },
        versions: { before: versionsBefore.length, after: versionsAfterPatch.length },
        runs: { before: runsBefore, after: runsAfterPatch },
      },
    }));

    // ── O07 · 사람이 [적용] — 비활성 버전 한 개, 그 이상은 아무것도 ──────────
    const activeBefore = baseSaved ? baseSaved.activeVersionId : null;
    // 카드의 알약은 두 개의 다른 숫자를 잇는다: 왼쪽은 **지도 판 번호**(프리셋을 고르면
    // 1), 오른쪽은 서버가 지은 **전략 버전 번호**다. 앞 섹션이 같은 전략에 버전을
    // 남겼으면 그 둘은 같지 않다 — 그래서 둘 다 실측값으로 재고, 지어낸 숫자가
    // 아니라는 것만 확인한다.
    const mapVersionBefore = await js(shellWin, '(window.AthenaBacktestCanvas.getContext().map.version)');
    await clickLastCardButton(shellWin, '적용하고 시각 설계로 돌아가기');
    // 무슨 카드가 오든 **그 카드를** 잰다 — 여기서 '동기화 완료'만 기다리면 409(다시 검토)가
    // 왔을 때 리포트에 null만 남아 원인을 못 댄다.
    const syncedCard = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      if (cards.length <= ${Number(historyBefore) + 2}) return null;
      const card = cards[cards.length - 1];
      const pills = Array.from(card.querySelectorAll('.routine-draft-pill'))
        .map((p) => (p.textContent || '').trim());
      const c = window.AthenaBacktestCanvas.getContext();
      const root = document.getElementById('backtestCanvas');
      return {
        cards: cards.length,
        pills,
        body: Array.from(card.querySelectorAll('.agent-body')).map((b) => b.textContent),
        // 409면 카드는 "다시 검토"만 말한다 — 서버가 준 이유는 마지막 영수증에만 있다.
        lastChange: c.lastChange,
        state: c.map.validation_state,
        designTab: c.designTab,
        pendingPatch: c.map.pendingPatch,
        activeVersionId: c.code.activeVersionId,
        status: (root.querySelector('.backtest-visual-status-text') || {}).textContent || null,
        summaryTitle: (root.querySelector('.backtest-vis-summary-title') || {}).textContent || null,
        graphHash: c.map.hashes ? c.map.hashes.graph_hash : null,
      };
    })()`, WAIT_VALIDATE);
    const versionsAfterApply = await listVersions(baseSaved && baseSaved.strategyId);
    const runsAfterApply = await countRuns();
    const deploysAfterApply = await countDeployments();
    const appliedHead = headOf(versionsAfterApply);
    // 서버가 **자기 산출물을** 거절하면 그것은 이 화면의 실패가 아니다 — 그때만 그 사실을
    // 그대로 적고 넘어간다(문구가 정확히 그것일 때만 — 다른 이유의 409/422는 여전히 FAIL).
    // 백엔드가 고쳐지면 이 갈래는 저절로 안 타고 아래 판정이 다시 산다.
    const BUNDLE_HASH_422 = 'bundle hash가 본문에서 다시 계산한 값과 다르다';
    const conflictReason = syncedCard && syncedCard.lastChange
      ? String((syncedCard.lastChange.errors || [])[0] || '') : '';
    await step('O07', '[적용]은 origin=visual 비활성 버전 하나만 남긴다 — 활성 버전·실행·배포는 그대로다', () => {
      if (conflictReason.indexOf(BUNDLE_HASH_422) === 0) {
        return {
          skip: `백엔드가 자기 컴파일 결과를 되받고 거절한다(${conflictReason}). raw HTTP로 재현한 원인 둘:`
            + ' ① spec_hash — /visual/compile은 StrategySpec **모델**의 정본 JSON을 해싱하는데'
            + '(visual_schema.spec_hash) 버전 저장은 같은 이름으로 **spec_yaml 문자열**을 해싱한다'
            + '(store.hash_bundle) — 값이 같아질 수 없다.'
            + ' ② graph_hash — store.canonical_graph_json은 클라이언트가 보낸 **원본 JSON**을 해싱하는데,'
            + ' scenario.costs·risk의 8.0·18.0·20.0·5.0이 JS를 한 번 왕복하면 8·18·20·5가 된다'
            + '(JS Number는 8.0을 적을 수 없다) — 어떤 브라우저 클라이언트도 이 hash를 재현할 수 없다.'
            + ' 고칠 자리는 backend/athena_api/backtest/store.py·api/backtest.py이고 이 작업의 소유 범위 밖이다.',
        };
      }
      return {
        ok: !!syncedCard && syncedCard.pills[0] === '동기화 완료'
              && syncedCard.state === 'synced' && syncedCard.designTab === 'flow'
              && syncedCard.pendingPatch === null
              && syncedCard.status === '그래프·코드 검증 완료'
              && syncedCard.summaryTitle === '그래프와 코드가 같은 버전입니다'
              && !!broken && syncedCard.graphHash !== broken.graphHash
              && versionsAfterApply.length === versionsBefore.length + 1
              && !!appliedHead && appliedHead.origin === 'visual' && appliedHead.active === false
              && syncedCard.pills.indexOf(`v${mapVersionBefore} → v${appliedHead.version}`) !== -1
              && syncedCard.activeVersionId === activeBefore
              && runsAfterApply === runsBefore && deploysAfterApply === deploysBefore,
        data: {
          card: syncedCard,
          versions: versionsAfterApply.map((v) => ({ v: v.version, origin: v.origin, active: v.active })),
          activeVersionId: { before: activeBefore, after: syncedCard && syncedCard.activeVersionId },
          runs: { before: runsBefore, after: runsAfterApply },
          deployments: { before: deploysBefore, after: deploysAfterApply },
        },
      };
    });

    // ── O08 · 이제 코드는 authoritative다 — 손으로 고치면 갈래를 묻는다 ──────
    // 고르기와 Enter는 **두 번 나눠** 보낸다: select()가 편집기를 다시 그려 방금 잡은
    // 노드 엘리먼트가 문서에서 떨어져 나가고, 떨어진 엘리먼트에 던진 keydown은 편집기
    // 루트까지 올라가지 못한다(2026-09-03 실측 — O08이 조용히 아무 일도 안 했다).
    await js(shellWin, `(() => {
      const card = document.querySelector('${R}.backtest-vis-node[data-node-id="cond-exit-1"]');
      if (!card) return false;
      card.click();
      return true;
    })()`);
    await js(shellWin, `(() => {
      const card = document.querySelector('${R}.backtest-vis-node[data-node-id="cond-exit-1"]');
      if (!card) return false;
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    const authoritative = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'code') return null;
      const ta = root.querySelector('.backtest-code-textarea');
      const ribbon = root.querySelector('.backtest-code-ribbon');
      const banner = root.querySelector('.backtest-code-preview-banner');
      if (!ta || !ribbon || ribbon.hidden) return null;
      return {
        ribbonKind: (root.querySelector('.backtest-code-ribbon-kind') || {}).textContent || null,
        ribbonLabel: (root.querySelector('.backtest-code-ribbon-label') || {}).textContent || null,
        bannerHidden: banner ? !!banner.hidden : null,
        readOnly: !!ta.readOnly,
        missing: String(ta.value).indexOf('__MISSING__') !== -1,
      };
    })()`, WAIT_VALIDATE);
    const edited = await js(shellWin, `(() => {
      const ta = document.querySelector('${R}.backtest-code-textarea');
      if (!ta) return { ok: false, why: '편집기가 없다' };
      ta.value = ta.value + '\\n# probe-hand-edit';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    })()`);
    const ahead = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const box = root.querySelector('.backtest-code-ahead');
      if (!box) return null;
      return {
        text: (box.querySelector('.backtest-code-ahead-text') || {}).textContent || null,
        buttons: Array.from(box.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
      };
    })()`, WAIT_UI);
    await click(shellWin, `${R}.backtest-code-ahead-regraph`);
    const regraphed = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'flow') return null;
      return {
        designTab: c.designTab,
        state: c.map.validation_state,
        codeOnly: c.map.code_only,
        ahead: root.querySelectorAll('.backtest-code-ahead').length,
      };
    })()`, WAIT_VALIDATE);
    await step('O08', '동기화 뒤의 코드는 [연결됨]이고, 손으로 고치면 두 갈래가 서고, [그래프에서 다시 만들기]가 되돌린다', () => ({
      ok: !!authoritative && authoritative.ribbonKind === '연결됨'
            && authoritative.bannerHidden === true && authoritative.readOnly === false
            && authoritative.missing === false
            && !!edited && edited.ok === true
            && !!ahead && ahead.text === '코드가 지도보다 앞섬'
            && ahead.buttons.indexOf('그래프에서 다시 만들기') !== -1
            && ahead.buttons.indexOf('코드 전용으로 분기') !== -1
            && !!regraphed && regraphed.designTab === 'flow' && regraphed.ahead === 0
            && regraphed.codeOnly === false,
      data: { authoritative, ahead, regraphed },
    }));

    // ── O09 · 코드 전용 분기 — 지도는 마지막 호환 snapshot으로 물러난다 ──────
    const beforeFork = await listVersions(baseSaved && baseSaved.strategyId);
    await click(shellWin, `${R}.backtest-visual-open-code`);
    await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return (c.designTab === 'code' && c.code.source) ? true : null;
    })()`, WAIT_VALIDATE);
    await js(shellWin, `(() => {
      const ta = document.querySelector('${R}.backtest-code-textarea');
      if (!ta) return false;
      ta.value = ta.value + '\\n# probe-code-only';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await until(shellWin, `(document.querySelectorAll('${R}.backtest-code-ahead').length ? true : null)`, WAIT_UI);
    await click(shellWin, `${R}.backtest-code-ahead-fork`);
    const forked = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      return c.map.code_only === true ? { codeOnly: true, mapVersion: c.map.version } : null;
    })()`, WAIT_VALIDATE);
    await goSubtab(shellWin, 0);
    const snapshot = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'flow') return null;
      const wrap = root.querySelector('.backtest-visual.is-snapshot');
      if (!wrap) return null;
      return {
        badge: (wrap.querySelector('.backtest-snapshot-badge') || {}).textContent || null,
        readOnlyHost: root.querySelectorAll('.backtest-visual-host.is-snapshot').length,
        ports: root.querySelectorAll('.backtest-vis-port').length,
        disabledPorts: root.querySelectorAll('.backtest-vis-port[disabled]').length,
        palette: root.querySelectorAll('.backtest-vis-palette').length,
      };
    })()`, WAIT_VALIDATE);
    const afterFork = await listVersions(baseSaved && baseSaved.strategyId);
    const forkHead = headOf(afterFork);
    await step('O09', '[코드 전용으로 분기]는 origin=code_only 비활성 버전을 남기고 지도를 읽기 전용 snapshot으로 물린다', () => ({
      ok: !!forked && forked.codeOnly === true
            && afterFork.length === beforeFork.length + 1
            && !!forkHead && forkHead.origin === 'code_only' && forkHead.active === false
            && !!snapshot && snapshot.badge === '동기화되지 않음 · 코드 전용'
            && snapshot.readOnlyHost === 1 && snapshot.palette === 0
            && snapshot.ports > 0 && snapshot.disabledPorts === snapshot.ports,
      data: {
        forked,
        snapshot,
        versions: afterFork.map((v) => ({ v: v.version, origin: v.origin, active: v.active })),
      },
    }));

    // 뒤 섹션이 이어 돌 수 있게 폼을 되돌린다 — 분기 상태를 남기면 지도가 계속
    // 읽기 전용이다(프리셋을 다시 고르는 것이 사람이 하는 되돌리기다).
    await ensureRunnableForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // P 새 기법 만들기 — 코드창 · 명령창 · 노드·흐름 창 (보드 20·21)
  // ==================================================================
  //
  // 사용자 확정 구도: [+ 새 기법 만들기]를 누르면 코드창 + 대화창 + 명령창이 서고,
  // AI가 질문 카드로 알고리즘을 정하며 코드를 직접 쓴다. 검사는 전부 자동이고,
  // 통과하면 노드·흐름 창이 열린다. 노드는 그 기법 파이썬의 함수 한 단위다.
  //
  // 라우트 2종(/technique/nodes·/technique/check)이 아직 없는 백엔드에서는 404를
  // 그대로 재고 그 뒤 검사·노드 검사는 SKIP한다 — 화면만 도는 검사는 그대로 돈다.
  if (on('P')) await section('P', async () => {
    await ensureRunnableForm(shellWin, FROM, TO);

    const probeSource = [
      'import athena_bt as bt',
      '',
      'PARAMS = {"lookback": {"default": 20, "min": 5, "max": 60, "step": 1, "type": "int"}}',
      '',
      '',
      'def compute_sma(df, lookback):',
      '    return df["close"].rolling(lookback).mean()',
      '',
      '',
      'def signals(df, p):',
      '    ma = compute_sma(df, p["lookback"])',
      '    df["entry"] = df["close"] > ma',
      '    df["exit"] = df["close"] < ma',
      '    return df[["entry", "exit"]]',
      '',
    ].join('\n');

    // 라우트가 살아 있는가 — 없으면 404를 그대로 적고 뒤 검사들은 SKIP한다.
    const checkRoute = await backendJson('POST', '/api/v1/backtest/technique/check', { source: probeSource });
    const nodesRoute = await backendJson('POST', '/api/v1/backtest/technique/nodes', { source: probeSource });
    const routesLive = checkRoute.status !== 404 && nodesRoute.status !== 404
      && checkRoute.status !== 0 && nodesRoute.status !== 0;
    const routeSkip = `백엔드에 라우트가 없다 — check ${checkRoute.status} · nodes ${nodesRoute.status}`;
    await step('P01', '기법 라우트 2종이 살아 있다(/technique/check · /technique/nodes)', () => ({
      ok: routesLive,
      data: { check: checkRoute.status, nodes: nodesRoute.status },
    }));

    // 채팅으로 나간 문장을 붙잡는다 — 캔버스가 던지는 문서 이벤트가 유일한 통로다.
    await js(shellWin, `(() => {
      if (!window.__probeTechniqueChat) {
        window.__probeTechniqueChat = [];
        document.addEventListener('athena:chat-submit', (e) => {
          window.__probeTechniqueChat.push(String((e && e.detail && e.detail.text) || ''));
        });
      }
      window.__probeTechniqueChat.length = 0;
      return true;
    })()`);

    await goDesignForm(shellWin);
    await click(shellWin, `${R}.backtest-technique-new`);
    // 폴더가 서는 데 왕복이 넷 든다(만들기 · 파일 둘 · 열기). 그 전에 재면 코드 탭이 아직
    // 어느 쪽도 아닌 중간 화면이라 편집기를 0개로 센다(2026-09-03 실측).
    const pMade = await until(shellWin, `(() => {
      const t = window.AthenaBacktestCanvas.getContext().technique;
      return t && t.projectId ? { projectId: t.projectId } : null;
    })()`, WAIT_VALIDATE);
    // 이 섹션도 폴더를 만든다 — 안 적어두면 프로브가 켠 등록이 그대로 남는다.
    if (pMade && pMade.projectId) created.projectIds.push(pMade.projectId);
    await wait(400);
    const started = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const band = root.querySelector('.backtest-technique-band');
      return {
        subtabs: Array.from(root.querySelectorAll('.backtest-subtab')).map((t) => t.textContent),
        on: (root.querySelector('.backtest-subtab.is-on') || {}).textContent || null,
        // 폴더가 서면 IDE가 코드 탭을 쥐고, 못 서면 지금까지의 단일 버퍼다 — 어느 쪽이든
        // 코드를 치는 자리는 하나여야 한다.
        editors: root.querySelectorAll('.backtest-code-host, .project-ide-editor .backtest-code-textarea').length,
        project: ${JSON.stringify(pMade ? 'made' : 'none')},
        band: band ? band.textContent : null,
        terminal: root.querySelectorAll('.backtest-terminal').length,
        progress: (root.querySelector('.backtest-technique-progress') || {}).textContent || null,
        submitted: (window.__probeTechniqueChat || []).slice(),
      };
    })()`);
    await step('P02', '[+ 새 기법 만들기]가 코드창·띠·명령창을 세우고 대화를 시작한다', () => ({
      ok: JSON.stringify(started.subtabs) === JSON.stringify(['코드', '노드·흐름'])
            && started.on === '코드' && started.editors === 1 && started.terminal === 1
            && /AI가 제어하는 중/.test(String(started.band))
            && /검사 0\/5/.test(String(started.progress))
            && started.submitted.length === 1
            && started.submitted[0] === '새 기법을 만들고 싶어요. 어떤 전략인지 하나씩 물어봐 주세요.',
      data: started,
    }));

    // AI가 코드를 쓴 자리 — propose_code와 같은 봉투다.
    sendChat(shellWin, { kind: 'code_draft', source: probeSource });
    const checked = routesLive
      ? await until(shellWin, `(() => {
        const t = window.AthenaBacktestCanvas.getContext().technique;
        return t.lastCheckAt ? t : null;
      })()`, WAIT_VALIDATE)
      : null;
    await step('P03', '코드가 바뀌면 자동 검사 7개(차단 5·경고 2)가 돌고 통과 여부는 차단만 본다', () => {
      if (!routesLive) return { skip: routeSkip };
      // 차단 5개(syntax·contract·dryrun·lookahead·warmup)가 전부 ok여야 passed다. 경고(magic·
      // structure)는 통과를 막지 않는다 — signals 하나짜리 프로브 코드는 structure 경고가 정상이다.
      const ids = checked && Array.isArray(checked.checks) ? checked.checks.map((c) => c.id) : [];
      const blocks = checked ? checked.checks.filter((c) => c.severity !== 'warn') : [];
      return {
        ok: !!checked && ids.length === 7
              && JSON.stringify(ids) === JSON.stringify(['syntax', 'contract', 'dryrun', 'lookahead', 'warmup', 'magic', 'structure'])
              && blocks.length === 5 && blocks.every((c) => c.ok === true)
              && checked.passed === true && !!checked.stats,
        data: checked && {
          passed: checked.passed,
          checks: checked.checks.map((c) => `${c.id}:${c.ok}`),
          stats: checked.stats,
        },
      };
    });

    const opened = routesLive
      ? await until(shellWin, `(() => {
        const root = document.getElementById('backtestCanvas');
        const c = window.AthenaBacktestCanvas.getContext();
        if (c.designTab !== 'nodes') return null;
        return {
          designTab: c.designTab,
          granularity: c.technique.granularity,
          nodes: c.technique.nodes.map((n) => n.id),
          flows: c.technique.flows,
          cards: root.querySelectorAll('.backtest-tnodes-card').length,
          host: root.querySelectorAll('.backtest-technique-nodes-host').length,
        };
      })()`, WAIT_VALIDATE)
      : null;
    await step('P04', '검사를 넘기면 노드·흐름 창이 자동으로 열린다 — 노드는 이 코드의 함수다', () => {
      if (!routesLive) return { skip: routeSkip };
      return {
        ok: !!opened && opened.host === 1 && opened.nodes.length >= 2
              && opened.nodes.indexOf('compute_sma') !== -1
              && opened.nodes.indexOf('signals') !== -1
              && opened.granularity === 'function',
        data: opened,
      };
    });

    // 노드를 눌러도 **메시지는 나가지 않는다**(사용자 확정, 2026-09-03) — 입력창에 그
    // 함수의 참조가 꽂힐 뿐이고, 무엇을 물을지는 사람이 이어서 쓴다.
    const asked = routesLive
      ? await (async () => {
        await js(shellWin, `(() => {
          window.__probeTechniqueChat.length = 0;
          const box = document.getElementById('input');
          if (box) box.value = '';
          return true;
        })()`);
        const turnsBefore = await countOf(shellWin, '#history .turn-q');
        await click(shellWin, `${R}.backtest-tnodes-card`);
        await wait(600);
        const seen = await js(shellWin, `(() => ({
          submitted: (window.__probeTechniqueChat || []).slice(),
          input: (document.getElementById('input') || {}).value || '',
          turns: document.querySelectorAll('#history .turn-q').length,
          selected: window.AthenaBacktestCanvas.getContext().technique.selectedNode,
        }))()`);
        return Object.assign({ turnsBefore }, seen);
      })()
      : null;
    await step('P05', '노드를 눌러도 메시지는 안 나가고 입력창에 @참조가 꽂힌다', () => {
      if (!routesLive) return { skip: routeSkip };
      // 카드 클릭 한 번 = 참조 한 번(onSelect는 선택만 적는다). 나간 문장은 0이어야 한다.
      const ref = asked && asked.selected ? `@${asked.selected} ` : null;
      return {
        ok: !!ref && asked.submitted.length === 0 && asked.input === ref
              && asked.turns === asked.turnsBefore,
        data: asked,
      };
    });

    // AI의 질문 카드 — MCP technique_question이 오는 길과 같은 봉투다.
    const cardsBefore = await countOf(shellWin, `#history .backtest-technique`);
    sendChat(shellWin, {
      kind: 'technique_question',
      payload: {
        question_ko: '무엇을 보고 사겠습니까?',
        choices: [
          { id: 'breakout', label_ko: '20일 최고가 돌파', detail_ko: '추세를 따라간다', recommended: true },
          { id: 'reversion', label_ko: '5일 저가 이탈', detail_ko: '되돌림을 노린다' },
        ],
        why_ko: '진입 규칙이 정해져야 나머지가 따라옵니다',
      },
    });
    const question = await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-technique');
      if (cards.length <= ${cardsBefore}) return null;
      const card = cards[cards.length - 1];
      return {
        text: card.textContent,
        choices: Array.from(card.querySelectorAll('.backtest-technique-choice')).map((b) => b.textContent),
      };
    })()`, WAIT_UI);
    await step('P06', 'technique_question이 질문·이유·선택지(권장 알약) 카드로 선다', () => ({
      ok: !!question && question.choices.length === 2
            && /무엇을 보고 사겠습니까/.test(question.text)
            && /진입 규칙이 정해져야/.test(question.text)
            && /권장/.test(question.choices[0]),
      data: question,
    }));

    await js(shellWin, `(() => { window.__probeTechniqueChat.length = 0; return true; })()`);
    await clickNth(shellWin, `#history .backtest-technique-choice`, 0);
    await wait(600);
    const answered = await js(shellWin, `(() => ({
      submitted: (window.__probeTechniqueChat || []).slice(),
      turns: Array.from(document.querySelectorAll('#history .turn-q')).map((n) => n.textContent),
      disabled: document.querySelectorAll('#history .backtest-technique-choice[disabled]').length,
    }))()`);
    await step('P07', '선택지를 누르면 그 문장이 사용자 메시지로 나간다 — AI가 대신 고르지 않는다', () => ({
      ok: answered.submitted.length === 1 && answered.submitted[0] === '20일 최고가 돌파'
            && answered.turns.indexOf('20일 최고가 돌파') !== -1
            && answered.disabled >= 2,
      data: answered,
    }));

    const tech = await js(shellWin, `window.AthenaBacktestCanvas.getContext().technique`);
    const techKeys = tech ? Object.keys(tech) : [];
    await step('P08', 'getContext().technique 계약 키 13개', () => ({
      ok: JSON.stringify(techKeys) === JSON.stringify([
            'projectId', 'name', 'path', 'checks', 'passed', 'stats', 'nodes', 'flows', 'granularity',
            'selectedNode', 'lastCheckAt', 'steps', 'autoRun',
          ]),
      data: { keys: techKeys },
    }));

    // 뒤에 무엇이 돌든 초안 상태를 남기지 않는다 — [기법 목록]으로 나간 뒤 폼을 되돌린다
    // (초안에는 폼 탭이 없어 그냥 부르면 하위 탭 1번이 노드·흐름이다).
    await click(shellWin, `${R}.backtest-technique-back`);
    await wait(300);
    await ensureRunnableForm(shellWin, FROM, TO);
  });

  // ==================================================================
  // Q 기법 폴더 한 바퀴 — 폴더·자동 수락·단계 카드·자동 백테스트·승인 (보드 19~23)
  // ==================================================================
  //
  // 사용자 확정 구도: 기법 하나 = 폴더 하나 = 대화 하나. [+ 새 기법 만들기]를 누르면 앱이
  // 폴더를 만들고 strategy.py·tests/test_strategy.py 뼈대를 쓴다. 그 폴더 안에서는 AI의
  // 편집·검사·백테스트를 묻지 않고 그냥 한다(자동 수락) — 사람이 누르는 것은 [이 기법
  // 승인]과 실매매 적용뿐이고, AI가 한 일은 전부 대화에 단계 카드로 쌓인다.
  //
  // P가 화면 표면(코드창·띠·명령창·질문 카드)을 잰다면 Q는 **디스크와 백엔드**를 잰다:
  // 폴더가 정말 생겼는가(GET /projects), 파일이 정말 그 내용인가(GET file), 실행 이력이
  // 정말 하나 늘었는가(GET runs), 등록부에 정말 올랐는가(GET user-strategies). 화면이
  // 그렇게 말한다는 것만으로는 통과시키지 않는다.
  if (on('Q')) await section('Q', async () => {
    await ensureRunnableForm(shellWin, FROM, TO);

    // 대화가 정한 규칙을 AI가 코드로 옮긴 모양. 원칙 3(계산 하나에 함수 하나)을 지켜
    // 함수가 넷이라 노드도 넷이 나온다 — 노드가 함수 단위라는 계약이 여기서 눈에 보인다.
    const techniqueSource = [
      'PARAMS = {',
      '    "lookback": {"default": 20, "min": 5, "max": 120, "step": 1, "type": "int"},',
      '}',
      '',
      '',
      'def compute_sma(df, lookback):',
      '    """종가 이동평균 — 추세의 기준선."""',
      '    return df["close"].rolling(int(lookback)).mean()',
      '',
      '',
      'def should_enter(df, ma):',
      '    """종가가 기준선 위에 있으면 산다."""',
      '    return df["close"] > ma',
      '',
      '',
      'def should_exit(df, ma):',
      '    """종가가 기준선 아래로 내려가면 판다."""',
      '    return df["close"] < ma',
      '',
      '',
      'def signals(df, p):',
      '    """진입·청산 두 열을 봉 수만큼 돌려준다."""',
      '    ma = compute_sma(df, p["lookback"])',
      '    df["entry"] = should_enter(df, ma)',
      '    df["exit"] = should_exit(df, ma)',
      '    return df[["entry", "exit"]]',
      '',
    ].join('\n');

    const fileUrl = (id, p) => `/api/v1/projects/${encodeURIComponent(id)}/file?path=${encodeURIComponent(p)}`;
    const runsCount = async () => {
      const env = await invoke(shellWin, 'athena:backtest-runs');
      return env && env.ok && env.data ? (env.data.runs || []).length : null;
    };
    // 단계 카드는 P도 남긴다(같은 대화 창이다) — 이 섹션이 쌓은 것만 세려고 시작점을 적어 둔다.
    const stepCardsBefore = await countOf(shellWin, '#history .backtest-step-card');
    const screenListBefore = await countOf(shellWin, `${R}.backtest-user-strategy-item`);
    const registryBefore = await backendJson('GET', '/api/v1/backtest/user-strategies');
    const registeredBefore = ((registryBefore.body || {}).strategies || []).length;
    const projectsBefore = await backendJson('GET', '/api/v1/projects');
    const idsBefore = ((projectsBefore.body || {}).projects || []).map((p) => p.id);
    const runsBefore = await runsCount();

    // 나간 문장과 입력창에 꽂힌 참조를 따로 잡는다 — 이 화면의 규칙이 "카드는 쌓이되
    // 메시지는 사람만 보낸다"라, 둘을 한 통에 담으면 그 규칙을 잴 수 없다.
    await js(shellWin, `(() => {
      if (!window.__probeQ) {
        window.__probeQ = { submitted: [] };
        document.addEventListener('athena:chat-submit', (e) => {
          window.__probeQ.submitted.push(String((e && e.detail && e.detail.text) || ''));
        });
      }
      window.__probeQ.submitted.length = 0;
      const box = document.getElementById('input');
      if (box) box.value = '';
      return true;
    })()`);

    await goDesignForm(shellWin);
    await click(shellWin, `${R}.backtest-technique-new`);
    // 폴더가 서는 데 왕복이 넷 든다(만들기 · 파일 둘 · 열기). 그 전에 재면 아직 아무것도
    // 안 만들어진 중간 화면을 판정하게 된다.
    const made = await until(shellWin, `(() => {
      const t = window.AthenaBacktestCanvas.getContext().technique;
      return t && t.projectId ? { projectId: t.projectId, path: t.path } : null;
    })()`, WAIT_VALIDATE);
    const projectId = made ? made.projectId : null;
    if (projectId) created.projectIds.push(projectId);

    const projectsAfter = await backendJson('GET', '/api/v1/projects');
    const rowsAfter = (projectsAfter.body || {}).projects || [];
    const mine = rowsAfter.find((p) => p.id === projectId) || null;
    const seedStrategy = projectId
      ? await backendJson('GET', fileUrl(projectId, 'strategy.py')) : { status: 0, body: null };
    const seedTest = projectId
      ? await backendJson('GET', fileUrl(projectId, 'tests/test_strategy.py')) : { status: 0, body: null };
    // 폴더를 못 만들면 화면은 경고 카드로 그 사실을 말한다 — 그 문장이 실패의 진짜 이유다.
    const folderCard = await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-file'));
      const last = cards[cards.length - 1];
      if (!last) return { cards: 0, title: null, meta: null, tone: null };
      return {
        cards: cards.length,
        title: (last.querySelector('.backtest-step-title') || {}).textContent,
        meta: (last.querySelector('.backtest-step-meta') || {}).textContent || null,
        tone: last.classList.contains('is-warn') ? 'warn' : (last.classList.contains('is-fail') ? 'fail' : 'ok'),
      };
    })()`);
    await step('Q01', '[+ 새 기법 만들기]가 폴더 하나와 뼈대 두 파일을 실제로 만든다', () => ({
      ok: !!projectId && !!mine && /^새-기법-\d{6}-\d{4}(-[23])?$/.test(String(mine.name))
            && mine.kind === 'managed' && idsBefore.indexOf(projectId) === -1
            && rowsAfter.length === idsBefore.length + 1
            && seedStrategy.status === 200
            && /원칙 3 — 계산은 함수 하나에/.test(String((seedStrategy.body || {}).text))
            && seedTest.status === 200
            && /def test_signals_returns_entry_exit/.test(String((seedTest.body || {}).text))
            && folderCard.tone === 'ok'
            && folderCard.title === `폴더 만듦 · ${mine.name}`
            && folderCard.meta === 'strategy.py · tests/test_strategy.py',
      data: {
        projectId, name: mine && mine.name, path: mine && mine.path,
        projects: { before: idsBefore.length, after: rowsAfter.length },
        strategy: { status: seedStrategy.status, size: (seedStrategy.body || {}).size },
        test: { status: seedTest.status, size: (seedTest.body || {}).size },
        card: folderCard,
      },
    }));
    if (!projectId) {
      throw new Error(`폴더를 못 만들어 Q02 이후를 돌리지 않았다: ${safeJson(folderCard)}`);
    }

    const stood = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const band = root.querySelector('.backtest-technique-band');
      return {
        subtabs: Array.from(root.querySelectorAll('.backtest-subtab')).map((t) => t.textContent),
        on: (root.querySelector('.backtest-subtab.is-on') || {}).textContent || null,
        tree: root.querySelectorAll('.project-ide-tree').length,
        files: Array.from(root.querySelectorAll('.project-ide-file')).map((f) => f.textContent),
        dirs: Array.from(root.querySelectorAll('.project-ide-dir')).map((f) => f.textContent),
        editors: root.querySelectorAll('.project-ide-editor .backtest-code-textarea').length,
        headPath: (root.querySelector('.project-ide-head-path') || {}).textContent || null,
        band: band ? band.textContent : null,
        terminal: root.querySelectorAll('.backtest-terminal').length,
        progress: (root.querySelector('.backtest-technique-progress') || {}).textContent || null,
        submitted: window.__probeQ.submitted.slice(),
      };
    })()`);
    await step('Q02', '코드 탭이 파일 트리·편집기·명령창·띠로 서고 대화가 첫 문장으로 시작된다', () => ({
      ok: JSON.stringify(stood.subtabs) === JSON.stringify(['코드', '노드·흐름'])
            && stood.on === '코드' && stood.tree === 1 && stood.editors === 1
            && stood.headPath === 'strategy.py'
            && stood.files.indexOf('strategy.py') !== -1
            && stood.files.indexOf('test_strategy.py') !== -1
            && stood.dirs.some((d) => /tests$/.test(String(d)))
            && stood.terminal === 1
            && /AI가 제어하는 중/.test(String(stood.band))
            && /검사 0\/5/.test(String(stood.progress))
            && stood.submitted.length === 1
            && stood.submitted[0] === '새 기법을 만들고 싶어요. 어떤 전략인지 하나씩 물어봐 주세요.',
      data: stood,
    }));

    // --- 자동 수락 --- AI가 낸 파일 초안은 [적용]을 기다리지 않는다. 이 폴더는 이 대화가
    // 만든 것이라, 묻는 자리 대신 "무엇이 몇 줄 바뀌었는지"가 카드로 남는다.
    const editsBefore = await countOf(shellWin, '#history .backtest-step-card.is-icon-edit');
    sendChat(shellWin, {
      kind: 'file_draft', project_id: projectId, path: 'strategy.py',
      source: techniqueSource, note: '대화에서 정한 규칙을 코드로 옮겼습니다',
    });
    const editCard = await until(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-edit'));
      if (cards.length <= ${editsBefore}) return null;
      const last = cards[cards.length - 1];
      const changes = Array.from(document.querySelectorAll('#history .backtest-change'));
      const receipt = changes[changes.length - 1];
      return {
        title: (last.querySelector('.backtest-step-title') || {}).textContent,
        meta: (last.querySelector('.backtest-step-meta') || {}).textContent || null,
        action: (last.querySelector('.backtest-step-action') || {}).textContent || null,
        clickable: last.classList.contains('is-clickable'),
        receiptButtons: receipt
          ? Array.from(receipt.querySelectorAll('button')).map((b) => (b.textContent || '').trim())
          : null,
      };
    })()`, WAIT_UI);
    const onDisk = await backendJson('GET', fileUrl(projectId, 'strategy.py'));
    const buffer = await js(shellWin, `(() => {
      const ta = document.querySelector('${R}.project-ide-editor .backtest-code-textarea');
      const c = window.AthenaBacktestCanvas.getContext();
      return {
        chars: ta ? ta.value.length : 0,
        hasExitFn: !!ta && ta.value.indexOf('def should_exit') !== -1,
        dirty: c.project ? c.project.dirty : null,
      };
    })()`);
    await step('Q03', 'AI가 낸 파일은 묻지 않고 디스크에 쓰이고, 그 사실이 단계 카드로 남는다', () => ({
      ok: !!editCard && /^strategy\.py 수정 \+\d+ −\d+$/.test(String(editCard.title))
            && editCard.action === 'diff 보기' && editCard.clickable === true
            && editCard.meta === '대화에서 정한 규칙을 코드로 옮겼습니다'
            && Array.isArray(editCard.receiptButtons)
            && editCard.receiptButtons.indexOf('적용') === -1
            && editCard.receiptButtons.indexOf('되돌리기') === -1
            && onDisk.status === 200 && (onDisk.body || {}).text === techniqueSource
            && buffer.hasExitFn === true && buffer.dirty === false,
      data: { card: editCard, disk: { status: onDisk.status, size: (onDisk.body || {}).size }, buffer },
    }));

    const checked = await until(shellWin, `(() => {
      const t = window.AthenaBacktestCanvas.getContext().technique;
      return t && t.passed === true && t.checks.length ? t : null;
    })()`, WAIT_VALIDATE);
    const checkCard = await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-check'));
      const last = cards[cards.length - 1];
      if (!last) return null;
      return {
        title: (last.querySelector('.backtest-step-title') || {}).textContent,
        action: (last.querySelector('.backtest-step-action') || {}).textContent || null,
        tone: last.classList.contains('is-warn') ? 'warn' : (last.classList.contains('is-fail') ? 'fail' : 'ok'),
        glyph: (last.querySelector('.backtest-step-icon') || {}).textContent,
      };
    })()`);
    await step('Q04', '검사가 저절로 돌고 통과 한 줄이 카드로 선다', () => {
      const ids = checked && Array.isArray(checked.checks) ? checked.checks.map((c) => c.id) : [];
      const blocks = checked ? checked.checks.filter((c) => c.severity !== 'warn') : [];
      return {
        ok: !!checked && ids.length === 7 && blocks.length === 5
              && blocks.every((c) => c.ok === true) && checked.passed === true
              && !!checked.stats && Number(checked.stats.rows) > 0
              && !!checkCard && checkCard.title === '검사 5/5 통과'
              && checkCard.tone === 'ok' && checkCard.action === '출력 보기'
              && checkCard.glyph === '✓',
        data: { checks: ids, stats: checked && checked.stats, card: checkCard },
      };
    });

    const nodesOpen = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const c = window.AthenaBacktestCanvas.getContext();
      if (c.designTab !== 'nodes' || !c.technique.nodes.length) return null;
      return {
        designTab: c.designTab,
        granularity: c.technique.granularity,
        nodes: c.technique.nodes.map((n) => n.id),
        flows: c.technique.flows,
        host: root.querySelectorAll('.backtest-technique-nodes-host').length,
        cards: root.querySelectorAll('.backtest-tnodes-card').length,
      };
    })()`, WAIT_VALIDATE);
    const nodeCard = await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-nodes'));
      const last = cards[cards.length - 1];
      return last ? {
        title: (last.querySelector('.backtest-step-title') || {}).textContent,
        action: (last.querySelector('.backtest-step-action') || {}).textContent || null,
      } : null;
    })()`);
    await step('Q05', '통과하면 노드·흐름 창이 저절로 열린다 — 노드는 이 파일의 함수 넷이다', () => ({
      ok: !!nodesOpen && nodesOpen.granularity === 'function' && nodesOpen.host === 1
            && JSON.stringify(nodesOpen.nodes)
              === JSON.stringify(['compute_sma', 'should_enter', 'should_exit', 'signals'])
            && JSON.stringify(nodesOpen.flows && nodesOpen.flows.entry)
              === JSON.stringify(['compute_sma', 'should_enter'])
            && JSON.stringify(nodesOpen.flows && nodesOpen.flows.exit)
              === JSON.stringify(['compute_sma', 'should_exit'])
            && !!nodeCard && nodeCard.title === '노드 다시 그림 · 0 → 4'
            && nodeCard.action === '노드 보기',
      data: { view: nodesOpen, card: nodeCard },
    }));

    // --- 자동 백테스트 --- 사람에게 [실행]을 누르라고 하지 않는다. 그러면서도 방금 열린
    // 노드 창을 뺏지 않는다(결과는 담아만 두고 카드의 [결과 보기]가 그 탭을 연다).
    const ran = await until(shellWin, `(() => {
      const c = window.AthenaBacktestCanvas.getContext();
      const t = c.technique;
      if (!t.autoRun || t.autoRun.status !== 'done') return null;
      return { autoRun: t.autoRun, designTab: c.designTab, view: c.view };
    })()`, WAIT_RUN);
    const runsAfter = await runsCount();
    const runCard = await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-run'));
      const last = cards[cards.length - 1];
      return last ? {
        title: (last.querySelector('.backtest-step-title') || {}).textContent,
        meta: (last.querySelector('.backtest-step-meta') || {}).textContent || null,
        action: (last.querySelector('.backtest-step-action') || {}).textContent || null,
      } : null;
    })()`);
    // 카드의 [결과 보기]가 여는 자리 — 지표 타일이 실제로 서야 "결과가 있다"는 말이 참이다.
    await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-run'));
      const last = cards[cards.length - 1];
      const btn = last ? last.querySelector('.backtest-step-action') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    const tiles = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const list = Array.from(root.querySelectorAll('.backtest-metric-tile'));
      if (!list.length) return null;
      return {
        labels: list.map((t) => (t.querySelector('.backtest-metric-label') || {}).textContent),
        values: list.map((t) => (t.querySelector('.backtest-metric-value') || {}).textContent),
        tab: window.AthenaBacktestCanvas.getContext().tab,
      };
    })()`, WAIT_VALIDATE);
    await step('Q06', '노드까지 받으면 백테스트도 저절로 돌고, 카드가 그 결과 탭을 연다', () => ({
      ok: !!ran && ran.autoRun.status === 'done' && !!ran.autoRun.metrics
            && Number.isFinite(Number(ran.autoRun.metrics.total_return))
            && ran.designTab === 'nodes' && ran.view === 'design'
            && runsBefore != null && runsAfter === runsBefore + 1
            && !!runCard && /^백테스트 #.{1,8} 실행 · 총수익률 /.test(String(runCard.title))
            && runCard.action === '결과 보기'
            && !!tiles && tiles.tab === 'result' && tiles.labels.length === 6
            && tiles.values.every((v) => v && v !== '—'),
      data: {
        autoRun: ran && ran.autoRun,
        screen: ran && { designTab: ran.designTab, view: ran.view },
        runs: { before: runsBefore, after: runsAfter },
        card: runCard, tiles: tiles && { labels: tiles.labels, values: tiles.values },
      },
    }));

    // 결과 탭에서 노드 창으로 되돌아온다 — 초안의 하위 탭은 [코드][노드·흐름] 둘뿐이다.
    await goTab(shellWin, 0);
    await wait(250);
    await goSubtab(shellWin, 1);
    await wait(300);

    await js(shellWin, `(() => {
      window.__probeQ.submitted.length = 0;
      const box = document.getElementById('input');
      if (box) box.value = '';
      return true;
    })()`);
    const turnsBefore = await countOf(shellWin, '#history .turn-q');
    await click(shellWin, `${R}.backtest-tnodes-card`);
    await wait(400);
    const inserted = await js(shellWin, `(() => {
      const box = document.getElementById('input');
      return {
        value: box ? box.value : null,
        // 포커스가 어디로 갔는지도 적는다 — 계약(chat.js)은 입력창에 준다고 말하는데
        // 노드 창이 곧바로 카드로 되찾아 간다. 판정에는 넣지 않는다(사용자 확정 문장은
        // '참조가 들어간다'까지다) — 대신 그 사실이 리포트에 그대로 남게 한다.
        focusInput: !!box && document.activeElement === box,
        focusOn: (document.activeElement && document.activeElement.className) || null,
        submitted: window.__probeQ.submitted.slice(),
        turns: document.querySelectorAll('#history .turn-q').length,
        selected: window.AthenaBacktestCanvas.getContext().technique.selectedNode,
      };
    })()`);
    await step('Q07', '노드를 누르면 메시지가 안 나가고 입력창에 @참조만 꽂힌다', () => ({
      ok: !!inserted && !!inserted.selected
            && ['compute_sma', 'should_enter', 'should_exit', 'signals']
              .indexOf(inserted.selected) !== -1
            && inserted.value === `@${inserted.selected} `
            && inserted.submitted.length === 0
            && inserted.turns === turnsBefore,
      data: {
        inserted,
        turnsBefore,
        known_gap: inserted && inserted.focusInput === false
          ? '입력창이 포커스를 못 받는다 — 카드 click 핸들러가 select() 뒤에 focusEl(card)로 되찾아 간다(backtest-technique-nodes.js:484). [설명] 버튼 경로는 되찾지 않아 입력창이 포커스를 유지한다.'
          : null,
      },
    }));

    // --- 카드가 여는 자리 --- [diff 보기]는 코드 탭 위에 그 변경을 세운다. 카드가 말한
    // "+N −M"과 패널이 세는 숫자가 같아야 한 변경에 두 셈이 생기지 않는다.
    await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-edit'));
      const last = cards[cards.length - 1];
      const btn = last ? last.querySelector('.backtest-step-action') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    const diffPanel = await until(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const panel = root.querySelector('.backtest-technique-diff');
      if (!panel) return null;
      return {
        path: (panel.querySelector('.backtest-diag-section-title') || {}).textContent,
        stat: (panel.querySelector('.backtest-diag-fix-stat') || {}).textContent,
        added: panel.querySelectorAll('.backtest-diff-row.is-add').length,
        removed: panel.querySelectorAll('.backtest-diff-row.is-del').length,
        close: panel.querySelectorAll('.backtest-technique-diff-close').length,
        designTab: window.AthenaBacktestCanvas.getContext().designTab,
      };
    })()`, WAIT_UI);
    const cardStat = String((editCard && editCard.title) || '').replace('strategy.py 수정 ', '');
    await click(shellWin, `${R}.backtest-technique-diff-close`);
    await wait(250);
    const diffClosed = await countOf(shellWin, `${R}.backtest-technique-diff`);
    await step('Q08', '단계 카드의 [diff 보기]가 코드 탭 위에 그 변경을 세운다', () => ({
      ok: !!diffPanel && diffPanel.designTab === 'code' && diffPanel.path === 'strategy.py'
            && diffPanel.stat === cardStat && diffPanel.added > 0 && diffPanel.removed > 0
            && diffPanel.close === 1 && diffClosed === 0,
      data: { panel: diffPanel, cardStat, closed: diffClosed },
    }));

    // --- 승인 --- 폴더 안에서 사람이 누르는 유일한 버튼(실매매 적용은 배포 화면의 것이다).
    const approveBefore = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      const btn = root.querySelector('.backtest-technique-approve');
      return { button: !!btn, label: btn ? btn.textContent : null };
    })()`);
    await click(shellWin, `${R}.backtest-technique-approve`);
    const approved = await until(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card.is-icon-check'));
      const last = cards[cards.length - 1];
      const title = last ? (last.querySelector('.backtest-step-title') || {}).textContent : null;
      if (!title || String(title).indexOf('기법 목록에 추가됨') !== 0) return null;
      return { title, draft: window.AthenaBacktestCanvas.getContext().techniqueDraft };
    })()`, WAIT_VALIDATE);
    const registry = await backendJson('GET', '/api/v1/backtest/user-strategies');
    const registered = (registry.body || {}).strategies || [];
    const entry = registered.find((s) => s.project_id === projectId) || null;
    if (entry && entry.id) created.userStrategyIds.push(entry.id);
    // 초안이 끝났으니 하위 탭은 다시 넷이다 — 목록은 폼(두 번째)에 있다.
    await goSubtab(shellWin, 1);
    await wait(400);
    const listNow = await js(shellWin, `(() => {
      const root = document.getElementById('backtestCanvas');
      return {
        items: root.querySelectorAll('.backtest-user-strategy-item').length,
        names: Array.from(root.querySelectorAll('.backtest-user-strategy-name')).map((n) => n.textContent),
        paths: Array.from(root.querySelectorAll('.backtest-user-strategy-path')).map((n) => n.textContent),
      };
    })()`);
    await step('Q09', '[이 기법 승인]이 등록부에 올리고 목록 카드가 하나 는다', () => ({
      ok: approveBefore.button === true && approveBefore.label === '이 기법 승인'
            && !!approved && approved.title === '기법 목록에 추가됨 · 새 기법'
            && approved.draft === false
            && !!entry && entry.path === 'strategy.py' && entry.name === '새 기법'
            && entry.exists === true
            && registered.length === registeredBefore + 1
            && listNow.items === registeredBefore + 1
            && listNow.names.indexOf('새 기법') !== -1,
      data: {
        approveBefore, card: approved, entry,
        registry: { before: registeredBefore, after: registered.length },
        list: { screenBefore: screenListBefore, now: listNow },
      },
    }));

    // --- 영수증 --- AI가 한 일이 대화에 순서대로 남았는가. 이것이 "묻지 않고 한다"의
    // 대가다 — 묻지 않은 만큼 전부 보여야 한다.
    const ledger = await js(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('#history .backtest-step-card'))
        .slice(${stepCardsBefore});
      return cards.map((c) => ({
        icon: (Array.from(c.classList).find((k) => k.indexOf('is-icon-') === 0) || '').slice(8),
        tone: (Array.from(c.classList).find((k) => /^is-(ok|warn|fail)$/.test(k)) || '').slice(3),
        glyph: (c.querySelector('.backtest-step-icon') || {}).textContent,
        title: (c.querySelector('.backtest-step-title') || {}).textContent,
      }));
    })()`);
    await step('Q10', 'AI가 한 일이 대화에 순서대로 쌓인다 — 폴더·수정·검사·노드·실행·승인', () => ({
      ok: Array.isArray(ledger) && ledger.length === 6
            && JSON.stringify(ledger.map((c) => c.icon))
              === JSON.stringify(['file', 'edit', 'check', 'nodes', 'run', 'check'])
            && ledger.every((c) => c.tone === 'ok')
            && JSON.stringify(ledger.map((c) => c.glyph))
              === JSON.stringify(['▤', '✎', '✓', '◈', '▶', '✓']),
      data: { cards: ledger },
    }));

    // 다음 섹션이 초안 화면을 물려받지 않게 폼을 되돌린다(승인으로 초안은 이미 끝났다).
    await ensureRunnableForm(shellWin, FROM, TO);
  });

  // 리포트 쓰기와 종료는 whenReady의 finally가 한 번만 한다 — 여기서는 돌아가기만 한다.
}

// 저장 전 배포 화면을 잰다(activeVersionId가 null일 때만 의미가 있다).
async function observeDeployBlocked(win) {
  await clickNth(win, `${R}.backtest-tab`, 4);
  const seen = await until(win, `(() => {
    const root = document.getElementById('backtestCanvas');
    const wrap = root.querySelector('.backtest-deploy');
    if (!wrap) return null;
    const card = wrap.querySelector('.backtest-card');
    if (!card) return null;
    return {
      modes: root.querySelectorAll('.backtest-deploy-mode-item').length,
      create: root.querySelectorAll('.backtest-deploy-create').length,
      empty: (card.querySelector('.backtest-card-empty') || {}).textContent || null,
      listEmpty: (wrap.querySelector(':scope > .backtest-card-empty') || {}).textContent || null,
    };
  })()`, WAIT_VALIDATE);
  await clickNth(win, `${R}.backtest-tab`, 0);
  await wait(300);
  return seen;
}

// ---------- 마무리 ----------

// 리포트는 **어떤 경우에도** 쓴다 — 치명상·조기 종료·섹션 중단 전부.
// 두 번 불려도 한 번만 돈다(거절 처리기와 finally가 겹칠 수 있다).
async function finish() {
  if (outcome.finished) return;
  outcome.finished = true;

  // 만든 배포는 전부 중지한다 — 프로브가 켜둔 스위치를 남기지 않는다.
  const cleanup = { stopped: [], failed: [] };
  for (let i = 0; i < created.deploymentIds.length; i += 1) {
    const id = created.deploymentIds[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await invoke(probeWin, 'athena:backtest-deployment-stop', { deployment_id: id });
      if (res && res.ok) cleanup.stopped.push(id);
      else cleanup.failed.push({ id, res });
    } catch (err) {
      cleanup.failed.push({ id, error: String((err && err.message) || err) });
    }
  }
  if (created.deploymentIds.length) {
    await step('Z01', '만든 배포를 전부 중지했다', () => ({
      ok: cleanup.failed.length === 0,
      data: cleanup,
    }));
  }
  // M·P·Q가 남긴 등록·프로젝트도 되돌린다 — M14가 돌았으면 M의 몫은 여기 남지 않는다.
  const swept = { strategies: [], projects: [], failed: [] };
  for (let i = 0; i < created.userStrategyIds.length; i += 1) {
    const id = created.userStrategyIds[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await invoke(probeWin, 'athena:backtest-user-strategy-unregister', { strategy_id: id });
      if (res && res.ok) swept.strategies.push(id);
      else swept.failed.push({ id, res });
    } catch (err) {
      swept.failed.push({ id, error: String((err && err.message) || err) });
    }
  }
  for (let i = 0; i < created.projectIds.length; i += 1) {
    const id = created.projectIds[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await backendJson('DELETE', `/api/v1/projects/${encodeURIComponent(id)}`);
      if (res.status === 200) swept.projects.push(id);
      else swept.failed.push({ id, status: res.status });
    } catch (err) {
      swept.failed.push({ id, error: String((err && err.message) || err) });
    }
  }
  if (swept.strategies.length || swept.projects.length || swept.failed.length) {
    await step('Z03', 'M·P·Q가 남긴 등록·프로젝트를 되돌렸다(파일은 그대로 둔다)', () => ({
      ok: swept.failed.length === 0,
      data: swept,
    }));
  }

  if (created.strategyIds.length) {
    skip(
      'Z02', '만든 전략·버전 정리',
      `백엔드에 삭제 API가 없다(store에 delete가 없다) — 남는 전략 id: ${created.strategyIds.join(', ')}`,
    );
  }

  if (outcome.abortReason) {
    record('ZZ', '전제 미충족으로 조기 종료', false, { reason: outcome.abortReason });
  }

  report.finishedAt = new Date().toISOString();
  report.fatal = outcome.fatal
    || (outcome.abortReason ? `조기 종료: ${outcome.abortReason}` : null);
  const passed = report.steps.filter((s) => s.ok && !s.skipped).length;
  const failed = report.steps.filter((s) => !s.ok);
  const skipped = report.steps.filter((s) => s.skipped).length;
  report.summary = { total: report.steps.length, passed, failed: failed.length, skipped };

  const outPath = path.join(__dirname, '..', 'artifacts', 'backtest-tour', 'full-probe.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
  } catch (err) {
    console.error('[probe-backtest-full] 리포트 저장 실패:', String((err && err.message) || err));
  }

  if (report.fatal) {
    console.log(`[probe-backtest-full] FATAL — ${String(report.fatal).split('\n')[0]}`);
  }
  if (failed.length === 0 && !report.fatal) {
    console.log(`[probe-backtest-full] ALL OK (${passed}/${report.steps.length})`);
  } else {
    console.log(
      `[probe-backtest-full] FAIL (${passed}/${report.steps.length})`
      + ` — failing ids: ${failed.map((s) => s.id).join(', ')}`,
    );
  }

  try { fs.rmSync(PROFILE, { recursive: true, force: true }); }
  catch { /* 다음 실행은 새 디렉터리다 */ }
  app.exit(failed.length === 0 && !report.fatal ? 0 : 1);
}

// 프로세스가 통째로 넘어져도 리포트는 남긴다 — 여기서 안 잡으면 155개 결과가 전부 증발한다.
process.on('unhandledRejection', (reason) => {
  const text = String((reason && reason.stack) || (reason && reason.message) || reason);
  console.error('[probe-backtest-full] 처리되지 않은 거절:', text);
  outcome.fatal = outcome.fatal || `unhandledRejection: ${text}`;
  record('ZR', '처리되지 않은 거절이 프로브를 끊었다', false, { error: text });
  void finish();
});

process.on('uncaughtException', (err) => {
  const text = String((err && err.stack) || err);
  console.error('[probe-backtest-full] 잡히지 않은 예외:', text);
  outcome.fatal = outcome.fatal || `uncaughtException: ${text}`;
  record('ZE', '잡히지 않은 예외가 프로브를 끊었다', false, { error: text });
  void finish();
});

app.whenReady().then(async () => {
  try {
    await main();
  } catch (err) {
    if (err instanceof PreconditionAbort) {
      outcome.abortReason = err.message;
    } else {
      const text = String((err && err.stack) || err);
      console.error('[probe-backtest-full] 프로브 자체 오류:', text);
      outcome.fatal = text;
    }
  } finally {
    await finish();
  }
});
