// 카드 v3 종별 실렌더 데모 프로브(2026-08-26, 팀리드 지시) — phase4-traversal.js
// (남겨두는 스크립트, 실패를 우회하지 않고 report.json에 그대로 적는다) +
// probe-chart-fastpath.js/probe-card-landing.js(main.js를 라이브러리로 불러와
// createWindows() 직접 호출, 실제 렌더 파이프라인을 태운다 — API 응답을 손으로
// 조립해 그린 척하지 않는다) 패턴을 합친다.
//
// 대상 11종(.omc/state/card-v3-plan.md §3 Wave 1-4 레인 테이블과 동일) 각각에
// 대해 "실제 렌더 파이프라인"을 두 갈래로 태운다:
//   1) REST 직행 fast-path(시세·차트만, main.js runDirectRestDataset) — 이
//      두 종만 자연어 그레마(buildQuoteDataset/buildChartDataset,
//      app/lib/main/rest-dataset-runner.js)가 이미 있다고 팀리드가 지목했다.
//      ATHENA_NO_AUTOSTART=1(아래)이 종목명 인덱스 워밍업을 건너뛰므로
//      그레마 자연어 매칭 대신 그 그레마가 만드는 것과 정확히 같은 모양의
//      dataset(operationRef+args)을 직접 조립해 athena__render_canvas의
//      {source:'rest-dataset'} 경로(main.js runDirectRestDataset)로 넣는다 —
//      이 경로 자체는 자연어 파싱과 무관하고 실제 백엔드 호출·실제 캔버스
//      페인트를 그대로 탄다(2026-08-26 실측: probe-chart-fastpath.js가 이미
//      증명한 경로, 여기서는 자연어 단계만 건너뛴다).
//   2) 백엔드 셀렉터 직행(나머지 9종) — POST /api/v1/llm/tools/search →
//      /api/v1/llm/tools/resolve(question=카탈로그 어휘, preferred_ref로
//      family 단정) → /api/v1/canvas/render-plan(plan_token,
//      delivery=side_channel). search는 실제로 그 오퍼레이션이 discoverable한지
//      감사 로그로 남기는 목적, resolve/render-plan이 진짜 실행 경로다 —
//      render-plan은 selector.call()로 진짜 Kiwoom을 호출한다(canvas_push.py
//      실측, 손으로 만든 data를 안 받는다). side_channel 배달은
//      app.state.canvas_events 큐(FastAPI asyncio.Queue) → main.js
//      startCanvasFeed()의 WS 구독(단일 소비자) → athena:add-canvas-live IPC로
//      온다 — 그래서 이 프로브가 도는 동안 다른 앱 인스턴스가 같은 큐를
//      나눠 먹으면 안 된다(팀리드 지시: 실행 전 electron 전부 죽인다).
//
// ATHENA_NO_AUTOSTART=1 — probe-card-landing.js와 같은 이유(주석 그대로):
// main.js는 이 플래그가 없으면 require 시점에 자기 자신의
// app.whenReady().then(createWindows)를 스스로도 돈다. 이 프로브가 그 뒤에
// 또 createWindows()를 명시로 부르면 같은 프로세스 안에서 두 번 실행돼
// shellWin이 두 개 생기고, startCanvasFeed()의 카드 도착이 레이스로 엉뚱한
// shellWin에 붙을 수 있다. side_channel 카드 판정은 백엔드
// InstrumentIdentityIndex(포트 8010, 부팅 때 자체 완비)만 쓰고 REST 직행
// dataset도 손으로 조립하므로(자연어 그레마 안 씀) app-side stockEntityIndex
// 워밍업 자체가 필요 없다 — 그래서 autostart를 꺼도 안전하다.
//
// 전제: 백엔드가 이미 127.0.0.1:8010에 떠 있다(팀리드가 기동). 계좌가 필요한
// 3종(계좌/보유주식/주문내역)은 이 배포에 실제 Kiwoom 계좌가 안 물려 있으면
// resolve/render-plan이 그대로 실패한다 — 그 실패 사유를 report.json에
// 있는 그대로 적고 스킵한다(지어낸 카드로 덮지 않는다).
//
// 라운드 2(팀리드 지시, e9bad09 이후): 호가/수급/거래원/프로그램매매도 이제
// REST 직행 그레마(buildOrderBookDataset/buildInvestorFlowDataset/
// buildTradingSourceDataset/buildProgramTradeDataset)가 있다. 자연어 입력
// (예: "삼성전자 호가")으로 실제 태우는 대신 여전히 rest-dataset 직접 조립을
// 쓴다 — 이유: 그 4개 함수는 StockEntityIndex.resolveQuery()로 종목명을
// 좁히는데, 그 인덱스는 main.js의 app.whenReady 자동 블록(ATHENA_NO_AUTOSTART로
// 막아둔 바로 그 블록)에서만 채워진다. 그 블록을 살리려면 이 프로브도
// createWindows()를 두 번(자동+명시) 태우게 되고, 그건 probe-card-landing.js가
// 이미 실측으로 겪은 "shellWin 두 개 경합" 버그로 이어진다(카드가 엉뚱한 창에
// 붙는다). rest-dataset 경로는 그 자연어→종목코드 변환 단계만 건너뛸 뿐 —
// operationRef+args는 새 그레마 함수가 실제로 만드는 것과 완전히 동일하고,
// 그 뒤(백엔드 호출·변환·캔버스 페인트)는 100% 같은 실경로다. 자연어 인식
// 자체는 이미 rest-dataset-runner.test.js 35/35(신규 5문법 포함)가 결정론적으로
// 검증했다 — 이 프로브가 다시 증명할 필요가 없는 부분이다.

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const OUT_DIR = path.join(__dirname, 'captures', 'card-demo');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-card-demo-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const BACKEND = process.env.ATHENA_BACKEND_URL || 'http://127.0.0.1:8010';
const STOCK = '005930'; // 삼성전자 — 팀리드 지시

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// KST 날짜(YYYYMMDD) — app/lib/main/rest-dataset-runner.js kstToday()와 같은 계산
// (import 대신 재계산하는 이유: 이 프로브는 그 파일의 자연어 그레마 함수를
// 의도적으로 안 쓴다 — 동시에 다른 워커가 그 파일을 확장 중이라 결합을 늘리지
// 않는다).
function kstYmd(daysAgo = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() - daysAgo * 86400000));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}${v.month}${v.day}`;
}

async function backendPost(urlPath, body) {
  try {
    const res = await fetch(`${BACKEND}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: String((err && err.message) || err) };
  }
}

// 대상 11종 — .omc/state/card-v3-plan.md §3 Wave 1-4 레인 테이블과 같은 순서.
// mode:'rest-dataset'는 buildQuoteDataset/buildChartDataset이 만드는 것과 정확히
// 같은 모양(operationRef+args)을 직접 조립한다(위 주석 참고). mode:'selector'는
// search→resolve→render-plan 3단.
const TARGETS = [
  {
    // detail:ka10001:current_trading은 처음에 썼다가 틀렸다고 실측으로 확인했다 —
    // Wave 0-BE가 이미 그 ref를 "종목정보"로 명시 확정해뒀다(canvas_transform.py
    // _CARD_TITLE_OVERRIDES 주석: "ka10001 자기 소유 detail이라 종목정보가 맞다").
    // "시세"로 실제 라우팅되는 건 base:ka10005/06/46/47/50010/50012/50087,
    // base:ka10003/10055/10084, detail:ka10002:market_snapshot뿐 — 그 중
    // ka10055(당일전일체결량요청)가 card-kind-시세.js가 찾는 4열(체결가·체결량·
    // 등락률·거래량)과 정확히 맞는 유일한 TR이라 Lane 1 구현 당시 근거로 삼은
    // 바로 그 TR을 쓴다.
    kind: '시세',
    mode: 'rest-dataset',
    question: '삼성전자 당일 체결 추이',
    dataset: () => ({
      datasetId: `demo-sise-${Date.now()}`,
      question: '삼성전자 당일 체결 추이',
      items: [{
        itemId: 'primary', ordinal: 1,
        operationRef: 'base:ka10055',
        args: { stk_cd: STOCK, tdy_pred: '1' },
        caption: null,
      }],
    }),
  },
  {
    kind: '차트',
    mode: 'rest-dataset',
    question: '삼성전자 일봉 차트',
    dataset: () => ({
      datasetId: `demo-chart-${Date.now()}`,
      question: '삼성전자 일봉 차트',
      items: [{
        itemId: 'primary', ordinal: 1,
        operationRef: 'base:ka10081',
        args: { stk_cd: STOCK, base_dt: kstYmd(), upd_stkpc_tp: '1' },
        caption: null,
      }],
    }),
  },
  {
    // ka10001은 selector_detail_required(7분할, describe 실측) — daily_price_band는
    // card-kind-종목정보.js의 "1일 범위" RangeBar 분기(low_pric/high_pric)와 맞는다.
    kind: '종목정보',
    mode: 'selector',
    question: '삼성전자 1일 가격 범위 상한가 하한가', // search 감사 로그용 자연어(discoverability 확인)
    operationRef: 'detail:ka10001:daily_price_band', // resolve는 이 exact ref로 확정한다(아래 설명)
    arguments: { stk_cd: STOCK },
  },
  {
    // 라운드 2 — buildOrderBookDataset(rest-dataset-runner.js)가 실제로 만드는 것과
    // 정확히 같은 operationRef+args(detail:ka10004:aggregate_totals). 라운드 1에서는
    // sell_bid_quantities(래더 분기)로 시도했는데, 이번엔 새 그레마가 실제로 고르는
    // aggregate_totals(ProportionalBar 총잔량 분기, card-kind-호가.js detectTotals())로
    // 바꿔 "그레마가 진짜로 만드는 조회"를 그대로 재현한다. 라운드 1에서 확인한
    // card_title 라우팅 갭(ka10004 계열 전체가 screen_definitions.json에 항목이 없어
    // title=None)은 detail_group과 무관하게 여전히 적용될 것으로 예상 — 실측으로 재확인.
    kind: '호가',
    mode: 'rest-dataset',
    question: '삼성전자 호가',
    dataset: () => ({
      datasetId: `demo-hoga-${Date.now()}`,
      question: '삼성전자 호가',
      items: [{
        itemId: 'primary', ordinal: 1,
        operationRef: 'detail:ka10004:aggregate_totals',
        args: { stk_cd: STOCK },
        caption: null,
      }],
    }),
  },
  {
    // buildInvestorFlowDataset과 완전히 같은 args(unit_tp:'1000' — 라운드 1의 '1'과
    // 다르다, 그레마 원문 그대로 맞춘다).
    kind: '수급',
    mode: 'rest-dataset',
    question: '삼성전자 수급',
    dataset: () => ({
      datasetId: `demo-sugub-${Date.now()}`,
      question: '삼성전자 수급',
      items: [{
        itemId: 'primary', ordinal: 1,
        operationRef: 'base:ka10061',
        args: {
          stk_cd: STOCK, strt_dt: kstYmd(), end_dt: kstYmd(), amt_qty_tp: '1', trde_tp: '0', unit_tp: '1000',
        },
        caption: null,
      }],
    }),
  },
  {
    // buildTradingSourceDataset과 같은 operationRef(base:ka10038, 라운드 1의 ka10040과
    // 다른 TR — 새 그레마가 실제로 고르는 것). Ka10038Response 실측: rank_1~3+
    // stk_sec_rank(list, mmcm_nm/buy_qty/sell_qty)라 layout=table이고, 필드명이
    // card-kind-거래원.js의 NAME_QTY_PATTERNS(buy_trde_ori_N 등, facts 전제)와
    // 안 맞는다 — fell-back-generic이 예상된다(그레마 TR과 카드종 렌더러가 서로
    // 다른 TR을 향해 만들어진 실제 통합 갭, 추측 아니라 모델 필드 대조로 확인).
    kind: '거래원',
    mode: 'rest-dataset',
    question: '삼성전자 거래원',
    dataset: () => ({
      datasetId: `demo-georaewon-${Date.now()}`,
      question: '삼성전자 거래원',
      items: [{
        itemId: 'primary', ordinal: 1,
        operationRef: 'base:ka10038',
        args: { stk_cd: STOCK, qry_tp: '2' },
        caption: null,
      }],
    }),
  },
  {
    // buildProgramTradeDataset과 완전히 같은 operationRef+args — 라운드 1(selector
    // 경로)과 동일한 TR이라 결과도 동일할 것으로 예상, rest-dataset 경로로만 바꿔
    // "시세/차트와 같은 실행 메커니즘"이라는 팀리드 지시를 문자 그대로 맞춘다.
    kind: '프로그램매매',
    mode: 'rest-dataset',
    question: '프로그램매매 동향',
    dataset: () => ({
      datasetId: `demo-program-${Date.now()}`,
      question: '프로그램매매 동향',
      items: [{
        itemId: 'primary', ordinal: 1,
        operationRef: 'base:ka90005',
        args: { date: kstYmd(), amt_qty_tp: '1', mrkt_tp: 'P00101', min_tic_tp: '1', stex_tp: '1' },
        caption: null,
      }],
    }),
  },
  {
    // kt00004는 selector_detail_required(4분할) — card-kind-계좌.js는 정확히
    // profit_and_loss(lspft/lspft2/tdy_lspft) 그룹의 손익 필드만 다룬다(파일 상단 주석).
    kind: '계좌',
    mode: 'selector',
    question: '계좌평가현황요청 손익',
    operationRef: 'detail:kt00004:profit_and_loss',
    arguments: { qry_tp: '0', dmst_stex_tp: 'KRX' },
  },
  {
    // kt00018은 selector_detail_required(3분할) — holdings는
    // Kt00018ResponseAcntEvltRemnIndvTotItem(stk_nm 포함)과 맞는다(card-kind-보유주식.js
    // 상단 주석의 "kt00018:holdings" 표기 그대로).
    kind: '보유주식',
    mode: 'selector',
    question: '계좌평가잔고내역요청',
    operationRef: 'detail:kt00018:holdings',
    arguments: { qry_tp: '2', dmst_stex_tp: 'KRX' },
  },
  {
    // 라운드 1은 render-plan 자체가 CANVAS_TRANSFORM_FAILED(응답에서 행 배열을
    // 못 찾음)로 실패했다 — 이 계좌에 미체결 주문이 실제로 없어서다(데이터 부재,
    // resolve 실패 아님). 팀리드 지시대로 bare tr_id("ka10075")로 재시도하지만
    // 근본 원인(빈 계좌)은 question 형태와 무관해 같은 결과가 예상된다 — 실측 확인.
    kind: '주문내역',
    mode: 'selector',
    question: '미체결요청',
    operationRef: 'ka10075',
    arguments: { all_stk_tp: '0', trde_tp: '0', stex_tp: '0' },
  },
  {
    kind: '관심종목',
    mode: 'selector',
    question: '관심종목정보요청',
    operationRef: 'base:ka10095',
    arguments: { stk_cd: STOCK },
  },
];

async function runRestDataset(shellWin, target) {
  const dataset = target.dataset();
  const startedAt = Date.now();
  const result = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'rest-dataset', dataset, expand: true })})`,
  );
  return { path: 'rest-direct-fastpath', elapsedMs: Date.now() - startedAt, dataset, result };
}

async function runSelectorPlan(target) {
  // search는 자연어 질문으로 discoverability를 감사 로그에 남기는 목적(팀리드 지시
  // "search→resolve"의 1단) — 결과가 어떻든 실행에 영향은 없다(2단인 resolve가
  // 진짜 실행 경로다, 아래 참고).
  const search = await backendPost('/api/v1/llm/tools/search', { query: target.question, limit: 5 });
  // resolve의 question은 자연어가 아니라 operationRef 문자열 그대로 준다 — 이렇게
  // 하면 selector가 EXACT_OPERATION_REF로 결정론적으로 해당 오퍼레이션을 고른다
  // (backend/tests/unit/test_selector_core.py가 쓰는 것과 같은 패턴, 실측 확인).
  // 자연어 question은 typed 호환성 판정(NO_COMPATIBLE_PROFILE/AMBIGUOUS_OPERATION)에
  // 계속 걸렸다(1차 실행 실측, captures/card-demo/report.json 이전 버전) — 지어낸
  // 데이터가 아니라 "어느 조회를 실행할지" 자체가 모호했던 것이라, exact ref로
  // 완전히 실측 가능한 실행 경로를 보장한다(preferred_ref는 힌트일 뿐 강제가
  // 아니라서 부족했다).
  const resolve = await backendPost('/api/v1/llm/tools/resolve', {
    question: target.operationRef,
    arguments: target.arguments || {},
  });
  const planToken = resolve.ok && resolve.body && resolve.body.plan_token;
  if (!planToken) {
    return {
      path: 'selector', search, resolve, renderPlan: null,
      error: `resolve 실패(HTTP ${resolve.status}) — ${JSON.stringify(resolve.body || resolve.error)}`,
    };
  }
  const renderPlan = await backendPost('/api/v1/canvas/render-plan', {
    plan_token: planToken,
    delivery: 'side_channel',
  });
  if (!renderPlan.ok) {
    return {
      path: 'selector', search, resolve, renderPlan,
      error: `render-plan 실패(HTTP ${renderPlan.status}) — ${JSON.stringify(renderPlan.body || renderPlan.error)}`,
    };
  }
  return { path: 'selector', search, resolve, renderPlan };
}

const CARD_PROBE_SCRIPT = `(() => {
  const card = document.querySelector('#grid .card');
  if (!card) return { present: false };
  const rect = card.getBoundingClientRect();
  const body = card.querySelector('.card-body');
  const kindMarkers = body ? Array.from(body.querySelectorAll('[class*="card-kit-"]')) : [];
  const CANVAS_TYPES = ['facts', 'mcp-table', 'compound', 'chart', 'event', 'action', 'status', 'free', 'notice'];
  return {
    present: true,
    cardTitle: card.querySelector('.card-title') ? card.querySelector('.card-title').textContent : null,
    cardSubtitle: card.querySelector('.card-subtitle') ? card.querySelector('.card-subtitle').textContent : null,
    canvasType: Array.from(card.classList).find((c) => CANVAS_TYPES.includes(c)) || null,
    renderState: card.dataset.renderState || null,
    kindMarkerCount: kindMarkers.length,
    kindMarkerClasses: [...new Set(kindMarkers.map((el) => el.className))].slice(0, 10),
    bodyTextLength: body ? body.textContent.trim().length : 0,
    hasErrorNote: !!card.querySelector('.uk-error, [role="alert"]'),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
})()`;

async function waitForCard(shellWin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await shellWin.webContents.executeJavaScript(CARD_PROBE_SCRIPT);
    if (last && last.present && last.rect.width > 0 && last.rect.height > 0) return last;
    await wait(300);
  }
  return last;
}

async function captureCard(shellWin, cardProbe, kind) {
  if (!cardProbe || !cardProbe.present || cardProbe.rect.width <= 0 || cardProbe.rect.height <= 0) return null;
  // capturePage()가 아직 커밋 안 된 프레임을 돌려주는 문제(phase4-traversal.js/verify.js
  // 관행) — rAF 2회로 최신 프레임을 강제한다.
  await shellWin.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const img = await shellWin.webContents.capturePage({
    x: Math.max(0, Math.round(cardProbe.rect.x)),
    y: Math.max(0, Math.round(cardProbe.rect.y)),
    width: Math.max(1, Math.round(cardProbe.rect.width)),
    height: Math.max(1, Math.round(cardProbe.rect.height)),
  });
  const file = path.join(OUT_DIR, `${kind}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

// CLI 인자로 대상 이름을 주면 그 카드종만 재실행한다(예: 실패한 카드종만
// 질문 문구를 고쳐 다시 돌릴 때 — 11종 전체를 매번 다시 태워 백엔드/Kiwoom
// 호출을 낭비하지 않는다). 인자가 없으면 11종 전부.
const REQUESTED = process.argv.slice(2);
const RUN_TARGETS = REQUESTED.length ? TARGETS.filter((t) => REQUESTED.includes(t.kind)) : TARGETS;

const REPORT_FILE = path.join(OUT_DIR, 'report.json');
function loadPriorReport() {
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다');
  shellWin.show();
  shellWin.focus();
  await wait(1500); // 창 안정화

  // 부팅 직후, 어떤 질의도 나가기 전 상태 캡처(팀리드 지시) — 사용자가 신고한
  // "부팅 시 그래프/답변 모드 요소가 섞인다" 결함의 사전(before) 증거. worker-cards가
  // 고치는 대상이고, 이 캡처는 그 수정 전 상태를 남겨두는 목적이라 재실행 때마다
  // (부분 재실행 포함) 항상 새로 찍는다.
  await shellWin.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const bootImg = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'boot-state.png'), bootImg.toPNG());
  console.log(`[card-demo] boot-state.png 캡처 완료 → ${path.join(OUT_DIR, 'boot-state.png')}`);

  // 부분 재실행이면 이전 리포트에서 이번에 안 돌리는 카드종 결과를 그대로
  // 들고 온다 — 성공한 카드까지 매번 다시 태우지 않는다.
  const priorReport = loadPriorReport();
  const report = priorReport.filter((r) => !RUN_TARGETS.some((t) => t.kind === r.kind));
  for (const target of RUN_TARGETS) {
    console.log(`[card-demo] ${target.kind} 시작 (${target.mode})...`);
    await shellWin.webContents.executeJavaScript("window.AthenaShell.clearCanvases()");
    await wait(200);
    await shellWin.webContents.executeJavaScript(`
      window.__cardDemoEvents = [];
      window.__cardDemoUnsub = window.athena.on('athena:add-canvas-live', (r) => window.__cardDemoEvents.push({
        status: r && r.status,
        canvasType: r && r.envelope && r.envelope.canvas_type,
        cardTitle: r && r.envelope && r.envelope.card_title,
        fellBack: r && r.envelope && r.envelope.fell_back,
      }));
      undefined;
    `);

    let outcome;
    try {
      outcome = target.mode === 'rest-dataset'
        ? await runRestDataset(shellWin, target)
        : await runSelectorPlan(target);
    } catch (err) {
      outcome = { path: target.mode, error: `예외: ${String((err && err.message) || err)}` };
    }

    const cardProbe = await waitForCard(shellWin, 20000);
    await shellWin.webContents.executeJavaScript("window.__cardDemoUnsub && window.__cardDemoUnsub(); undefined");
    const ipcEvents = await shellWin.webContents.executeJavaScript('window.__cardDemoEvents');

    let screenshot = null;
    try {
      screenshot = await captureCard(shellWin, cardProbe, target.kind);
    } catch (err) {
      outcome.captureError = `캡처 실패: ${String((err && err.message) || err)}`;
    }

    let classification;
    if (!cardProbe || !cardProbe.present) {
      classification = `skipped(${outcome && outcome.error ? outcome.error : '카드 도착 타임아웃 — 20초 안에 #grid .card가 안 뜸'})`;
    } else if (cardProbe.hasErrorNote) {
      classification = `skipped(카드는 떴으나 에러 노트 표시 — ${JSON.stringify(cardProbe.kindMarkerClasses)})`;
    } else if (cardProbe.kindMarkerCount > 0) {
      classification = 'rendered-special';
    } else {
      classification = 'fell-back-generic';
    }

    report.push({
      kind: target.kind, mode: target.mode, question: target.question,
      classification, screenshot, cardProbe, outcome, ipcEvents,
    });
    console.log(`[card-demo] ${target.kind}: ${classification}${screenshot ? ` → ${screenshot}` : ''}`);
    await wait(500);
  }

  // TARGETS 원래 순서(§3 레인 테이블 순서)로 다시 정렬 — 부분 재실행이면 report.push
  // 순서가 뒤섞인다.
  report.sort((a, b) => TARGETS.findIndex((t) => t.kind === a.kind) - TARGETS.findIndex((t) => t.kind === b.kind));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  const lines = report.map((r) => `  ${r.kind.padEnd(6, '　')} — ${r.classification}`);
  console.log(`[card-demo] 완료 (${report.length}종)\n${lines.join('\n')}`);
  console.log(`[card-demo] 리포트: ${path.join(OUT_DIR, 'report.json')}`);
  app.exit(0);
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[card-demo] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'fatal-error.log'), String((err && err.stack) || err));
  app.exit(1);
}));
