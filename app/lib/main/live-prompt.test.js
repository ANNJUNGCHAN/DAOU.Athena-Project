'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBacktestModePrefix, buildGraphModePrefix, buildLivePrompt, buildLiveSystemPrompt,
  buildLiveTurnPrompt,
} = require('./live-prompt');

test('persistent prompt split keeps generation rules static and turn text isolated', () => {
  const system = buildLiveSystemPrompt();
  const turn = buildLiveTurnPrompt({ userText: '삼성전자 시세' });
  assert.match(system, /athena__render_canvas/);
  assert.doesNotMatch(system, /삼성전자 시세/);
  assert.equal(turn, '사용자 질문:\n삼성전자 시세');
  assert.equal(buildLivePrompt('삼성전자 시세'), `${system}\n\n${turn}`);
});

test('buildLivePrompt: 사용자 질문이 원문 그대로 마지막에 들어간다', () => {
  const p = buildLivePrompt('삼성전자 최근 공시에 대해서 알려줘');
  assert.ok(p.endsWith('사용자 질문:\n삼성전자 최근 공시에 대해서 알려줘'));
});

test('buildLivePrompt: 캔버스 렌더 지시와 table 스키마 힌트를 담는다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena__render_canvas'));
  assert.ok(p.includes('"columns"'));
  assert.ok(p.includes('"rows"'));
  // 조회 없는 질문의 탈출구가 있어야 잡담에 빈 캔버스를 강제하지 않는다.
  assert.ok(p.includes('캔버스 없이 짧게'));
});

test('buildLivePrompt: stream 스키마 힌트가 canvas.py STREAM_SCHEMA 필드명 그대로 들어간다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"stream"'));
  assert.ok(p.includes('"records"'));
  assert.ok(p.includes('"ts_precision"'));
  assert.ok(p.includes('"source"'));
});

test('buildLivePrompt: reader 스키마 힌트가 canvas.py READER_SCHEMA 필드명 그대로 들어간다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"reader"'));
  assert.ok(p.includes('"body_markdown"'));
  assert.ok(p.includes('"highlights"'));
});

test('buildLivePrompt: 키움 라우팅 규칙 — selector 후 manifest render, 외부 MCP 대체 금지', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_search'));
  assert.ok(p.includes('athena_describe'));
  assert.ok(p.includes('athena_resolve'));
  assert.ok(p.includes('athena_call'));
  assert.ok(p.includes('athena_search → athena_describe → athena_resolve 순서로 선택'));
  assert.ok(!p.includes('athena_resolve → athena_call(키움 REST)'));
  assert.ok(p.includes('외부 MCP나 웹으로 대체하지 마라'));
  assert.ok(p.includes('키움 백엔드가 미기동'));
});

test('buildLivePrompt: detail_group 선택과 plan_token 1회용 안내를 담는다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('detail_groups'));
  assert.ok(p.includes('detail_group'));
  assert.ok(p.includes('typed local detail이 하나뿐일 때만'));
  assert.ok(p.includes('DETAIL_GROUP_REQUIRED'));
  assert.ok(p.includes('전체 응답이 된다고 가정하지 마라'));
  assert.ok(!p.includes('생략하면 전체 응답 — 항상 안전'));
  assert.ok(p.includes('1회용'));
});

test('buildLivePrompt: candidate는 soft hint, preferred는 describe 확인 canonical assertion으로 구분한다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('candidate_refs'));
  assert.ok(p.includes('soft hint'));
  assert.ok(p.includes('preferred_ref'));
  assert.ok(p.includes('canonical operation/family assertion'));
  assert.ok(p.includes('suggested_operation_ref'));
  assert.ok(p.includes('suggested_detail_group'));
  assert.ok(p.includes('실제로 소유하는지 확인'));
  assert.ok(p.includes('ambiguous'));
  assert.ok(p.includes('억지 resolve하지 말고'));
});

test('buildLivePrompt: W3 번복 — describe 생략 금지(인자 목록이 describe에만 있음, 실측 턴 18→31 악화)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_describe를 건너뛰지 마라'));
  assert.ok(p.includes('인자 추측')); // 생략 시 실패 루프의 원인 명시
  assert.ok(!p.includes('athena_describe를 생략하라')); // 옛 규칙 부활 방지
});

test('buildLivePrompt: W3 첫 카드 우선 — 첫 데이터 확보 즉시 render_canvas를 먼저 호출', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('먼저 render_canvas를 호출'));
  assert.ok(p.includes('첫 카드를 기다리고'));
});

test('buildLivePrompt: US-006 카드 우선 — render_canvas 전에는 답변 문장(프리앰블 포함) 금지', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('render_canvas를 호출하기 전까지 답변 문장을 한'));
  assert.ok(p.includes('글자도 쓰지 마라'));
  assert.ok(p.includes('프리앰블이다'));
  assert.ok(p.includes('카드가 먼저 뜨고'));
});

test('buildLivePrompt: W3 작업 규율 — 초반 툴 로드 권고 + 재조회 금지 (run3~5 반복 사이클 실측의 수정)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('초반에 필요한 툴'));
  assert.ok(p.includes('athena__render_canvas')); // 로드 목록에 렌더 툴 포함 — 중간 사냥 방지
  assert.ok(p.includes('call을 반복하거나'));
});

test('buildLivePrompt: chart 스키마 힌트 — AITS data.symbol + data.chart.candles 형상만 노출', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"chart"'));
  assert.ok(p.includes('"symbol"'));
  assert.ok(p.includes('"period"'));
  assert.ok(p.includes('"target"'));
  assert.ok(p.includes('"trId"'));
  assert.ok(p.includes('"chart"'));
  assert.ok(p.includes('"candles"'));
  assert.ok(p.includes('"open"'));
  assert.ok(p.includes('"volume"'));
  assert.ok(!p.includes('bars'));
  assert.ok(!p.includes('"initial"'));
});

test('buildLivePrompt: chart 힌트 — 키움 ka10081 응답 필드 매핑과 오름차순 정렬 지시가 있다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('dt(YYYYMMDD)→time(YYYY-MM-DD)'));
  assert.ok(p.includes('open_pric→open'));
  assert.ok(p.includes('trde_qty→volume'));
  assert.ok(p.includes('오름차순'));
});

test('buildLivePrompt: 사용자 노출 언어 규율 — TR 코드·툴 이름·내부 오류 코드 노출 금지, 투자자 언어로 되묻기 (2026-08-26 사용자 신고)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('사용자 노출 언어 규율'));
  assert.ok(p.includes('TR 코드'));
  assert.ok(p.includes('ka10008'));
  assert.ok(p.includes('athena_search·athena_describe·athena_resolve·athena_call'));
  assert.ok(p.includes('confidence'));
  assert.ok(p.includes('AMBIGUOUS_OPERATION'));
  assert.ok(p.includes('DETAIL_GROUP_REQUIRED'));
  assert.ok(p.includes('카탈로그'));
  assert.ok(p.includes('셀렉터'));
  assert.ok(p.includes('외국인 단독 순매수 추이'));
  assert.ok(p.includes('투자자 언어로 번역'));
});

test('buildLivePrompt: 조회 규율 — 명시 출처·상대 날짜·원문 확인·교차 출처 (2026-08-19 QA)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('조회 규율'));
  assert.ok(p.includes('조용한 대체 금지'));
  assert.ok(p.includes('날짜 확인 툴'));
  assert.ok(p.includes('원문 조회 툴로 본문을 확인'));
  assert.ok(p.includes('인용한 출처를 답변에 남긴다'));
});

test('buildLivePrompt: 주문·자동화 정책 v3b — 실행 툴 없음·루틴은 제안만 (P3)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('주문·자동화 정책'));
  assert.ok(p.includes('주문(매수·매도·정정·취소)을 실행하는 툴이'));
  assert.ok(p.includes('athena_routine'));
  assert.ok(p.includes('승인 카드'));
  assert.ok(p.includes('등록됐다·예약됐다고'));
  assert.ok(p.includes('감시 방식'));
});

test('buildLivePrompt: 실행 환경 제약 v3c — Bash 없음·승인 절차 없음·잘린 결과 대응 (2026-08-19 실사용 결함)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('실행 환경 제약'));
  assert.ok(p.includes('Bash'));
  assert.ok(p.includes('승인해 주시면'));       // 금지 표현을 명시적으로 지목
  // 병합 정정(2026-08-27): Read·Glob(첨부)가 세션에 있어 "접근할 수단은 없다"가
  // 거짓이 됐다 — 능력 서술 대신 지시형 문구를 단언한다.
  assert.ok(p.includes('읽으러 가지 마라'));
  assert.ok(p.includes('받은 부분만으로 즉시 카드를'));
  // 첨부 경로 읽기 용도 명시 — 키우미 첨부(B4)와 #33 차단의 병합 교집합.
  assert.ok(p.includes('첨부한 파일·폴더 경로를 읽는 용도'));
});

test('buildLivePrompt: manifest-backed read 전체가 plan_token만으로 render_canvas 직행한다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_call로 데이터를 읽어오지 마라'));
  assert.ok(p.includes('facts/table/compound/chart 전부'));
  assert.ok(p.includes('{plan_token:"..."}'));
  assert.ok(p.includes('canvas_type과 data는 보내지'));
  assert.ok(p.includes('manifest-unsupported'));
  assert.ok(p.includes('no-card fallback'));
  assert.ok(p.includes('정상 facts/compound/table/chart 조회에는 athena_call을 쓰지 않는다'));
  assert.ok(p.includes('summary'));
  assert.ok(p.includes('최근 N봉 기준'));
  assert.ok(!p.includes('chart/table 카드를 그릴 때는'));
  assert.ok(!p.includes('chart/table 외 카드를 직접 구성할 때만'));
});

test('buildLivePrompt: flagship 현재가도 backend manifest가 facts 카드를 고르는 plan 경로다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('삼성전자 오늘 주가'));
  assert.ok(p.includes('resolve plan_token만 렌더'));
  assert.ok(p.includes('current-price facts 카드'));
  assert.ok(p.includes('모델이 facts나 compound payload를 직접 만들지 마라'));
});

test('buildLivePrompt: timeline 스키마 힌트 — 부분 데이터 허용 (2026-08-19 QA LIV-046)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"timeline"'));
  assert.ok(p.includes('"price_series"'));
  assert.ok(p.includes('"events"'));
});

test('buildLivePrompt: 감시 방식 이분법 고지 — WS만 실시간, 공시·뉴스는 주기 (실행계획 §8)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('웹소켓 시세 계열'));
  assert.ok(p.includes('주기 확인 대상'));
  assert.ok(p.includes('실시간 공시 감시'));
});

test('buildLivePrompt: resolve question 어휘 규율 — 대화체 대신 카탈로그 어휘로 재구성 (2026-08-26 카드 랜딩 0건 실측)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('question 어휘 규율'));
  // 실패 재현 질의(probe-card-landing.js)의 대화체 표현을 금지 예시로 명시한다.
  assert.ok(p.includes('지금 추이가 어때'));
  assert.ok(p.includes('그대로 옮기지 마라'));
  // 재구성 재료는 search/describe 응답 필드 그대로 — 모델이 새 어휘를 지어내지 않게.
  assert.ok(p.includes('athena_describe 결과의 name'));
  assert.ok(p.includes('detail_groups[].title_ko'));
  assert.ok(p.includes('현재 시세 및 거래량'));
  assert.ok(p.includes('카탈로그 어휘를 우선한다'));
});

// ---- 백테스트 모드 접두(2026-09-02, 채팅이 캔버스를 제어하는 계약 [E]) ----
// main.js가 chat.js의 canvasMode·backtestContext와 today(YYYYMMDD)를 턴 객체에
// 실어 보낸다. 백테스트 모드에서만 접두가 붙고, 나머지 경로는 바이트 동일해야 한다.

// phase-1 형상 — code/lastResult/diagnosis/optimize/runs/coverage 키가 아예 없다.
const BT_CONTEXT = {
  view: 'backtest',
  tab: 'design',
  designTab: 'form',
  spec: {
    presetId: 'sma_crossover',
    name: 'SMA 골든크로스',
    symbols: ['005930'],
    period: 'day',
    adjusted: true,
    fromDt: '20250101',
    toDt: '20250831',
    params: { fast: 20, slow: 60 },
  },
  draft: null,
  presets: [{ id: 'sma_crossover', name: 'SMA 골든크로스' }],
};

// phase-2 형상 — getContext()가 채우는 키가 전부 실린 컨텍스트.
const BT_FULL_CONTEXT = {
  view: 'design',
  tab: 'design',
  designTab: 'code',
  runPath: 'code',
  spec: BT_CONTEXT.spec,
  draft: null,
  presets: BT_CONTEXT.presets,
  code: {
    source: 'import athena_bt as bt\n\nPARAMS = {"fast": {"default": 20}}\n',
    truncated: false,
    lines: 4,
    strategyId: 'stg_1',
    activeVersionId: 'ver_3',
    errors: [],
  },
  codeDraft: {
    note: '진입 조건을 고쳤다', suggest_run: true, suggest_validate: false, lines: 12,
  },
  lastResult: {
    runId: 'run_9',
    status: 'done',
    metrics: { total_return: 0.12, sharpe: 1.1, run_path: 'code' },
    flags: [],
    tradesCount: 7,
    stdoutTail: '',
    error: null,
  },
  diagnosis: {
    title: 'NameError', why: '변수가 정의되지 않았다', line: 12, hasFix: true, summary: 'p["fast"]로 바꾼다',
  },
  optimize: { method: 'grid', result: null },
  runs: [{
    run_id: 'run_9', status: 'done', total_return: 0.12, sharpe: 1.1,
  }],
  coverage: {
    symbol: '005930', fromDt: '20250101', toDt: '20250831', bars: 160,
  },
};

test('buildLiveTurnPrompt: 문자열 입력은 접두 없이 이전과 바이트 동일', () => {
  assert.equal(buildLiveTurnPrompt('삼성전자 시세'), '사용자 질문:\n삼성전자 시세');
});

test('buildLiveTurnPrompt: canvasMode 없는 객체는 문자열 입력과 동일', () => {
  assert.equal(
    buildLiveTurnPrompt({ userText: '삼성전자 시세' }),
    buildLiveTurnPrompt('삼성전자 시세'),
  );
});

test('buildLiveTurnPrompt: canvasMode summary는 문자열 입력과 동일 — 백테스트 컨텍스트가 실려도 무시', () => {
  assert.equal(
    buildLiveTurnPrompt({
      userText: '삼성전자 시세', canvasMode: 'summary', backtestContext: BT_CONTEXT, today: '20260902',
    }),
    buildLiveTurnPrompt('삼성전자 시세'),
  );
});

test('buildLiveTurnPrompt: canvasMode backtest — 접두 규율 + 현재 폼 JSON + 프리셋, 마지막은 사용자 질문', () => {
  const p = buildLiveTurnPrompt({
    userText: '삼성전자로 해줘', canvasMode: 'backtest', backtestContext: BT_CONTEXT, today: '20260902',
  });
  assert.ok(p.startsWith('[모드: 백테스트] 오늘: 20260902'));
  assert.ok(p.includes('캔버스는 채팅이 제어한다'));
  assert.ok(p.includes('propose_spec'));
  assert.ok(p.includes('propose_code'));
  assert.ok(p.includes('entry·exit 불리언 열을 가진 DataFrame 하나를 반환한다'));
  assert.ok(p.includes('한 턴에 한 항목'));
  assert.ok(p.includes('run·optimize·backfill 액션을 직접 부르지 않는다'));
  assert.ok(p.includes('athena__render_canvas를 호출하지 않는다'));
  assert.ok(p.includes('실행·검증·수집·저장·활성화·배포·탐색 시작은 사람이 카드 버튼을 누른다'));
  assert.ok(p.includes('suggest_run:true'));
  assert.ok(p.includes(`현재 폼(JSON): ${JSON.stringify(BT_CONTEXT.spec)}`));
  assert.ok(p.includes('실행 전 확인: 없음'));
  assert.ok(p.includes('프리셋: sma_crossover(SMA 골든크로스)'));
  assert.ok(p.endsWith('\n\n사용자 질문:\n삼성전자로 해줘'));
});

test('buildLiveTurnPrompt: backtest — 실행 전 확인은 pending 배열을 JSON으로 싣는다', () => {
  const ctx = Object.assign({}, BT_CONTEXT, { pending: ['종목을 하나 이상 고르세요', '기간을 입력하세요'] });
  const p = buildLiveTurnPrompt({ userText: 'x', canvasMode: 'backtest', backtestContext: ctx, today: '20260902' });
  assert.ok(p.includes('실행 전 확인: ["종목을 하나 이상 고르세요","기간을 입력하세요"]'));
  assert.ok(!p.includes('대기 중 초안'));
});

test('buildLiveTurnPrompt: backtest — backtestContext null이면 폼 없음으로 접두를 낸다', () => {
  const p = buildLiveTurnPrompt({ userText: 'x', canvasMode: 'backtest', backtestContext: null, today: '20260902' });
  assert.ok(p.startsWith('[모드: 백테스트] 오늘: 20260902'));
  assert.ok(p.includes('현재 폼(JSON): 없음'));
  assert.ok(p.includes('실행 전 확인: 없음'));
  assert.ok(p.includes('프리셋: 목록 없음'));
  assert.ok(p.endsWith('사용자 질문:\nx'));
});

test('buildBacktestModePrefix: today가 없으면 미상으로 찍는다 (Date 미사용)', () => {
  const p = buildBacktestModePrefix(null, undefined);
  assert.ok(p.startsWith('[모드: 백테스트] 오늘: 미상'));
});

test('buildLivePrompt: 객체 입력 — 시스템 규칙 + 백테스트 접두 + 질문이 한 문자열에 들어간다', () => {
  const input = {
    userText: '삼성전자로 해줘', canvasMode: 'backtest', backtestContext: BT_CONTEXT, today: '20260902',
  };
  const p = buildLivePrompt(input);
  assert.ok(p.startsWith(buildLiveSystemPrompt()));
  assert.ok(p.includes('사용자 노출 언어 규율'));
  assert.ok(p.includes('[모드: 백테스트]'));
  assert.equal(p, `${buildLiveSystemPrompt()}\n\n${buildLiveTurnPrompt(input)}`);
});

// ---- phase-2 계약 [E] — 채팅이 캔버스 전체를 모는 일반화 접두 ----

test('buildBacktestModePrefix: 전체 컨텍스트는 모든 구역 머리줄을 낸다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  const lines = p.split('\n');
  assert.equal(lines[0], '[모드: 백테스트] 오늘: 20260902');
  assert.equal(lines[1], '사용자는 백테스트 캔버스에 있고, 캔버스는 채팅이 제어한다. 이 턴의 규칙:');
  assert.ok(p.includes('현재 화면: tab=design · designTab=code · 실행경로=code'));
  assert.ok(p.includes(`현재 폼(JSON): ${JSON.stringify(BT_FULL_CONTEXT.spec)}`));
  assert.ok(p.includes('실행 전 확인: 없음'));
  assert.ok(p.includes('코드 초안 대기: {"note":"진입 조건을 고쳤다","lines":12}'));
  assert.ok(p.includes('코드(strategy.py · 4줄):'));
  assert.ok(p.includes(`마지막 실행: ${JSON.stringify(BT_FULL_CONTEXT.lastResult)}`));
  assert.ok(p.includes(`진단: ${JSON.stringify(BT_FULL_CONTEXT.diagnosis)}`));
  assert.ok(p.includes('최적화: {"method":"grid","result":null}'));
  assert.ok(p.includes('프리셋: sma_crossover(SMA 골든크로스)'));
});

test('buildBacktestModePrefix: 요청별 경로 규칙이 액션 이름을 그대로 담는다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  assert.ok(p.includes('navigate(history) + list_runs'));
  assert.ok(p.includes('propose_optimize(method)'));
  assert.ok(p.includes('navigate(design, flow)'));
  assert.ok(p.includes('navigate(deploy)'));
  assert.ok(p.includes('데이터 필요량: plan'));
  assert.ok(p.includes('def signals(df, p)'));
  assert.ok(p.includes('아직 실행 결과가 없다'));
});

test('buildBacktestModePrefix: 코드는 python 펜스 블록으로 싣는다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  const fence = '```';
  assert.ok(p.includes(`코드(strategy.py · 4줄):\n${fence}python\n${BT_FULL_CONTEXT.code.source}\n${fence}`));
});

test('buildBacktestModePrefix: truncated면 앞 6000자만 표시를 괄호 안에 붙인다', () => {
  const ctx = Object.assign({}, BT_FULL_CONTEXT, {
    code: Object.assign({}, BT_FULL_CONTEXT.code, { truncated: true, lines: 320 }),
  });
  const p = buildBacktestModePrefix(ctx, '20260902');
  assert.ok(p.includes('코드(strategy.py · 320줄, 앞 6000자만):'));
});

test('buildBacktestModePrefix: 실행 이력과 캐시는 JSON 그대로 싣는다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  assert.ok(p.includes(`실행 이력(최근): ${JSON.stringify(BT_FULL_CONTEXT.runs)}`));
  assert.ok(p.includes(`캐시: ${JSON.stringify(BT_FULL_CONTEXT.coverage)}`));
});

test('buildBacktestModePrefix: phase-1 컨텍스트는 새 구역이 없음/모름으로 내려앉고 던지지 않는다', () => {
  const p = buildBacktestModePrefix(BT_CONTEXT, '20260902');
  assert.ok(p.includes('현재 화면: tab=design · designTab=form · 실행경로=모름'));
  assert.ok(p.includes('코드 초안 대기: 없음'));
  assert.ok(p.includes('코드(strategy.py · 0줄): 없음'));
  assert.ok(p.includes('마지막 실행: 없음'));
  assert.ok(p.includes('진단: 없음'));
  assert.ok(p.includes('최적화: 없음'));
  assert.ok(p.includes('실행 이력(최근): 없음'));
  assert.ok(p.includes('캐시: 모름'));
  assert.ok(!p.includes('```'));
});

test('buildBacktestModePrefix: 컨텍스트 없이도 모든 구역이 없음/모름으로 나온다', () => {
  const p = buildBacktestModePrefix(null, '20260902');
  assert.ok(p.includes('현재 화면: tab=모름 · designTab=모름 · 실행경로=모름'));
  assert.ok(p.includes('현재 폼(JSON): 없음 — 아직 프리셋을 고르지 않았다'));
  assert.ok(p.includes('코드(strategy.py · 0줄): 없음'));
  assert.ok(p.includes('캐시: 모름'));
  assert.ok(p.includes('프리셋: 목록 없음'));
});

// ---- phase-3 계약 [P] — 초안 카드가 사라지고 캔버스에 바로 반영된다 ----
// 사용자 결정(2026-09-02): "바로 반영 + 채팅에 변경 내역·되돌리기". 접두는
// [적용]·초안 카드 문구를 더 이상 쓰지 않고, 검증 오류 때만 대기 초안이 남는다.

test('buildBacktestModePrefix: 설정·코드는 바로 반영, 검증 오류는 실행 전 확인에 실린다고 알린다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  assert.ok(p.includes('설정은 athena_backtest action=propose_spec 으로 patch를 보내면 폼에 바로 반영된다'));
  assert.ok(p.includes('검증에 걸리는 값이 있어도 반영되고, 그 항목은 아래 "실행 전 확인"에 실린다(다음 턴에 마저 채운다)'));
  assert.ok(p.includes('코드는 propose_code로 보내면 편집기에 바로 들어간다'));
  assert.ok(p.includes('채팅에는 변경 내역과 [되돌리기]가 뜬다'));
});

test('buildBacktestModePrefix: 실행은 suggest_run으로 채팅 [실행] 버튼만 띄운다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  assert.ok(p.includes('실행은 propose_spec/propose_code에 suggest_run:true를 넣으면 채팅에 [실행] 버튼이 뜬다 — 사람이 누른다.'));
  assert.ok(p.includes('run·optimize·backfill 액션을 직접 부르지 않는다'));
  assert.ok(p.includes('실행·검증·수집·저장·활성화·배포·탐색 시작은 사람이 카드 버튼을 누른다'));
});

test('buildBacktestModePrefix: 알아서·한 번에 요청이면 한 턴에 다 채우고, 답은 변경 한 줄 + 질문 한 줄', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  assert.ok(p.includes('한 턴에 한 항목'));
  assert.ok(p.includes('사용자가 "알아서"·"한 번에"·"전부" 해달라고 하면 한 턴에 필요한 항목을 모두 채운다'));
  assert.ok(p.includes('답은 두세 문장 — 무엇을 바꿨는지 한 줄과 다음 질문 한 줄.'));
});

test('buildBacktestModePrefix: 초안 카드·[적용] 문구는 접두에서 사라졌다', () => {
  const p = buildBacktestModePrefix(BT_FULL_CONTEXT, '20260902');
  assert.ok(!p.includes('초안 카드'));
  assert.ok(!p.includes('[적용]'));
  assert.ok(!p.includes('적용하고 실행'));
  assert.ok(p.includes('실행 전 확인: 없음'));
});

// ── 그래프 모드 접두(2026-09-02) ─────────────────────────────────────────────
// 이 접두가 없던 동안 모델은 그래프의 존재조차 몰랐다: "확인이 필요한 것 3건이
// 뭐야?"에 "종목 시세·일봉 차트·공시 중 어느 쪽인가"라고 되물었다(실측 제보).
// 아래 테스트가 고정하는 것은 그 재발 조건이다 — 그래프 모드임을 말하는가,
// athena_brain을 알려주는가, 화면 숫자를 그대로 싣는가, 없는 것을 지어내지 말라고
// 하는가.

const GRAPH_CONTEXT = {
  available: true,
  surface: 'summary',
  revision: 34,
  filters: { windowDays: 90, minDegree: 0, summarySort: 'reinforcement' },
  counts: {
    entities: 40, relations: 34, clusters: 7, unassigned: 7,
    signals: 48, hiddenLinks: 5, uncertain: 3,
  },
  clusters: [{ cluster: 0, size: 7, cohesion: 0.29, title: '미국 지수 ETF', estimated: true }],
  topSignals: [{
    name: '분산 투자', kind: 'preference', relation: '선호',
    rationale: '동일 산업 중복을 피한다', reinforcement: 5,
    confidence: 'INFERRED', tier: 'conversational',
  }],
  hiddenLinks: [{ source: '배당·인컴', target: 'ACE 미국배당다우존스', score: 0.82, kinds: ['소속'] }],
  selected: {
    entityId: 'e:a', name: '배당·인컴', kind: 'theme', cluster: 2,
    clusterTitle: '배당·인컴', degree: 7, confidence: 'EXTRACTED', tier: 'brokerage',
    relations: [{ label: '노출', name: '배당형 자산 비중 34%', count: 2, hidden: false }],
  },
};

test('buildGraphModePrefix: 그래프 모드임과 "모든 질문은 그래프 질문"을 못박는다', () => {
  const p = buildGraphModePrefix(GRAPH_CONTEXT, '20260902');
  assert.ok(p.startsWith('[모드: 그래프] 오늘: 20260902'));
  assert.ok(p.includes('이 모드의 모든 질문은 이 그래프에 대한 질문이다'));
  assert.ok(p.includes('종목 시세·차트·공시 질문으로 해석하지 마라'));
});

test('buildGraphModePrefix: athena_brain 5개 액션을 알려준다(모델이 조회할 길)', () => {
  const p = buildGraphModePrefix(GRAPH_CONTEXT, '20260902');
  for (const action of ['profile', 'god_nodes', 'surprising', 'questions', 'diff']) {
    assert.ok(p.includes(action), `${action} 액션이 접두에 없다`);
  }
  assert.ok(p.includes('노출이 꺼져 있다'), '503(토글 꺼짐)을 지어내지 말라는 지시가 없다');
});

test('buildGraphModePrefix: 카드·시세 도구를 닫는다', () => {
  const p = buildGraphModePrefix(GRAPH_CONTEXT, '20260902');
  assert.ok(p.includes('athena__render_canvas를 호출하지 않는다'));
  assert.ok(p.includes('시세·차트 도구'));
});

test('buildGraphModePrefix: 화면 숫자를 그대로 싣는다(채팅과 배너가 다른 말을 하지 않게)', () => {
  const p = buildGraphModePrefix(GRAPH_CONTEXT, '20260902');
  assert.ok(p.includes('엔티티 40 · 관계 34 · 군집 7 · 미분류 7 · 성향 신호 48 · 숨은 연관 5 · 확인 필요 3'));
  assert.ok(p.includes('요약 표'), 'surface를 사람 말로 찍지 않는다');
  assert.ok(p.includes('"windowDays":90'));
});

test('buildGraphModePrefix: 사실/추론 구분과 지어내기 금지를 지시한다', () => {
  const p = buildGraphModePrefix(GRAPH_CONTEXT, '20260902');
  assert.ok(p.includes('사실과 추론을 섞지 마라'));
  assert.ok(p.includes('EXTRACTED'));
  assert.ok(p.includes('AMBIGUOUS'));
  assert.ok(p.includes('없는 것은 없다고 말한다'));
  assert.ok(p.includes('투자 판단·매수·매도를 권하지 않는다'));
});

test('buildGraphModePrefix: 선택된 노드가 실려 온다', () => {
  const p = buildGraphModePrefix(GRAPH_CONTEXT, '20260902');
  assert.ok(p.includes('지금 선택된 노드:'));
  assert.ok(p.includes('배당·인컴'));
  assert.ok(p.includes('"degree":7'));
});

test('buildGraphModePrefix: 컨텍스트가 비어도 던지지 않고 정직하게 찍는다', () => {
  for (const ctx of [null, undefined, {}, { counts: null }]) {
    const p = buildGraphModePrefix(ctx, null);
    assert.ok(p.includes('[모드: 그래프] 오늘: 미상'));
    assert.ok(p.includes('지금 선택된 노드: 없음'));
    assert.ok(p.includes('모름'));
  }
});

test('buildLiveTurnPrompt: canvasMode=graph면 그래프 접두가 붙는다', () => {
  const out = buildLiveTurnPrompt({
    userText: '확인이 필요한 것 3건이 뭐야?',
    canvasMode: 'graph',
    graphContext: GRAPH_CONTEXT,
    today: '20260902',
  });
  assert.ok(out.startsWith('[모드: 그래프]'));
  assert.ok(out.endsWith('사용자 질문:\n확인이 필요한 것 3건이 뭐야?'));
});

test('buildLiveTurnPrompt: 그래프가 아닌 모드는 문자열 호출과 바이트 동일하다', () => {
  const plain = buildLiveTurnPrompt('무엇이든');
  assert.equal(buildLiveTurnPrompt({ userText: '무엇이든', canvasMode: 'summary' }), plain);
  assert.equal(buildLiveTurnPrompt({ userText: '무엇이든' }), plain);
});
