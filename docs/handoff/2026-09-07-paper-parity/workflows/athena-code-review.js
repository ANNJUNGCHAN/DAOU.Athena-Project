export const meta = {
  name: 'athena-code-review',
  description: 'Review the 18 commits on main since 7aab063 (2026-09-04): 10 dimension finders, 3-lens adversarial verify per finding, completeness critic loop until dry',
  phases: [
    { title: 'Find', detail: '10 dimension finders over diff + source' },
    { title: 'Verify', detail: '3 lenses per finding: reproduce / context / impact' },
    { title: 'Critic', detail: 'completeness critic proposes uncovered areas for next round' },
  ],
}

const REPO = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const RANGE = '7aab063..HEAD'

const CONTEXT = `
## 검수 컨텍스트 (모든 에이전트 공통)
- 저장소: ${REPO} (Electron 셸 앱은 app/, Python 백엔드는 backend/). 브랜치 main, 작업트리 clean.
- 검수 범위: git 범위 ${RANGE} — 2026-09-04 마지막 통합 머지(7aab063) 이후 main에 쌓인 18개 커밋, 41개 파일(+1646/-142).
- 전체 diff 파일: ${SP}/review-diff.patch (2758줄). 커밋 메시지+본문(Constraint/Rejected/Confidence/Scope-risk 줄 포함): ${SP}/review-commits.txt
- 개별 커밋 diff: git -C ${REPO} show <sha> ; 특정 파일 이력: git -C ${REPO} log -p ${RANGE} -- <path>
- Node는 PATH에 없다. Git Bash에서: export PATH="/c/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"
  단위 테스트: cd /c/Projects/DAOU.Athena/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js  (기준선: 2759 pass / 0 fail, 이미 확인됨). 개별 파일: node --test lib/paper-card-routing.test.js 처럼 돌릴 수 있다.
  Electron 프로브(verify:*, probe-*.js)는 실행하지 마라 — 실 계좌/백엔드가 필요하다. 코드로만 판단한다.
- 프로젝트 규칙(CLAUDE.md/AGENTS.md): 단순성 우선(추측성 추상화·설정 금지), 수술적 변경(요청과 무관한 줄 변경 금지, 자기 변경이 만든 고아 import/변수만 정리), 변경마다 검증 가능한 성공 기준.
- 제품 문구 3원칙(카드/셸 사용자 노출 문구): 설명문 금지(짧은 명사구/명령형), 한국어 단위(원·주·초 등, 영문 단위·영문 UI 라벨 금지), 내부 용어 금지(recipe_id, AITS, fixture, pydantic 같은 개발자 용어를 사용자에게 보이지 않기).
- 안전 제약(커밋 본문에 반복 명시): 프로브와 코드는 실주문 /api/v1/order/* 를 절대 호출하면 안 된다. 키우미 다섯 얼굴(오브 메뉴) 클릭 금지. 계좌 변경/플러그인 설치 확정 금지.
- 이 리뷰는 읽기 전용이다. 파일을 수정하거나 커밋하지 마라. 스크래치가 필요하면 ${SP} 아래에만 써라.
- 발견 항목은 한국어로 쓴다. 각 항목은 file(저장소 상대경로, 예: app/lib/chart-card.js), line(HEAD 기준 실제 줄 번호 — diff의 줄이 아니라 파일을 열어 확인한 번호), severity(P0 사용자 핵심경로 파괴/안전 위반, P1 명확한 버그·회귀·플레이키, P2 유지보수·규칙 위반·약한 테스트, P3 사소), category, title(한 문장), detail(무엇이 왜 잘못인지), evidence(코드 인용 또는 재현 경로 — 추측 금지), fix(제안), commit(관련 sha)로 보고한다.
- 추측성·취향성 지적은 내지 마라. 근거가 코드에서 확인되는 것만 보고한다. 발견이 없으면 빈 배열을 돌려라.
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          category: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
          commit: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'category', 'title', 'detail', 'evidence'],
      },
    },
    coverage_notes: { type: 'string', description: '무엇을 읽었고 무엇을 못 봤는지 한 문단' },
  },
  required: ['findings', 'coverage_notes'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
    reasoning: { type: 'string' },
    correction: { type: 'string', description: '지적이 부분적으로만 맞다면 정정된 서술' },
  },
  required: ['refuted', 'confidence', 'severity', 'reasoning'],
}

const GAPS = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          focus: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' },
        },
        required: ['focus', 'why'],
      },
    },
  },
  required: ['gaps'],
}

const DIMENSIONS = [
  {
    key: 'correctness-main',
    prompt: `당신은 Electron 메인 프로세스 전문 리뷰어다. 범위 안의 메인 프로세스 코드를 정확성 관점에서 검수하라.
대상: app/main.js, app/lib/main/rest-dataset-runner.js, app/lib/main/backtest-bridge.js, app/lib/main/live-prompt.js (그리고 이 파일들이 호출하는 기존 코드).
집중점: createWindows 진행 중 promise 재사용(e792a7a)이 실패/거부 시 영구 고착되는지, 재사용 promise가 두 번째 호출자에게 같은 창 객체를 주는지; 시세+호가 REST 직행(7225375)의 오류 경로(한쪽만 실패, 타임아웃, 종목 미해석), 차트 재조회 8초 한도의 이중 한도와 타이머 누수·clearTimeout 여부; 비동기 경쟁(동시 질의 2건), 예외가 삼켜지는 곳, 반환 형태가 호출자 기대와 다른 곳. diff만 보지 말고 파일 전체와 호출자를 읽어 흐름을 추적하라.`,
  },
  {
    key: 'correctness-renderer',
    prompt: `당신은 렌더러/캔버스 코드 전문 리뷰어다. 범위 안의 렌더러 코드를 정확성 관점에서 검수하라.
대상: app/canvas.js, app/lib/chart-card.js, app/lib/paper-card-routing.js, app/lib/agent-canvas.js, app/lib/backtest-canvas.js, app/lib/graph-mode/controller.js, app/lib/settings-cards.js (그리고 호출자/피호출자).
집중점: recipe_id 없는 차트 봉투를 primary로 보는 판정(8ef070d, bf87dbd)이 canvas.js와 paper-card-routing.js 두 곳에서 일치하는지, fell_back 차트가 여전히 보드로 가는지; mountAitsChartPanel을 await하지 않게 바꾼 것(2bcffea)이 미처리 거부(unhandledrejection), 카드 제거 후 늦은 마운트, 순서 역전, 이중 마운트를 만드는지; 백테스트 첫 화면(fe24b6e, 81b5c3e) 상태 전이에서 프리셋 자동 선택 제거가 남긴 죽은 분기나 null 참조; 에이전트 데모 표기(a2fa584)가 데이터 소스 속성과 모순되는지. 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'probes-and-verify',
    prompt: `당신은 E2E 프로브/검증 스크립트 전문 리뷰어다. 범위 안의 프로브와 검증 러너를 검수하라.
대상: app/probe-live-full.js(신규 374줄), app/scripts/run-verify-suite.js(신규), app/lib/live-full-catalog.js(신규), app/verify.js, app/probe-live-chart.js, app/probe-backtest-*.js, app/probe-orderbook-realtime.js, app/package.json.
집중점: 안전 — 실주문 /api/v1/order/* 호출 가능성, 주문 잠금 정규식(과매수/과매도 제외)이 실제로 위험 문구를 놓치는지 또는 안전 문구를 잠그는지; 타임아웃 값(카드 20초/LLM 20초/샷 12초)과 카드 8회 재조회의 종료 조건·총 대기시간; 프로세스 정리(app.quit, 좀비 창, 실 userData 프로필 오염); exit code가 실패를 정확히 전하는지; run-verify-suite.js의 spawn('npm', shell:true)와 --only 인자 처리, 타임아웃 후 kill이 자식 트리를 죽이는지(Windows), VERIFY_SUITE 목록과 package.json scripts의 정합(c33ef0a가 잠근다고 주장); 플레이키 원인(고정 sleep, 경쟁). 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'tests-quality',
    prompt: `당신은 테스트 품질 전문 리뷰어다. 범위 안에서 추가·변경된 모든 *.test.js를 검수하라.
대상: app/lib/agent-canvas.test.js, aits-chart-panel.test.js, backtest-canvas.test.js, board-parity.test.js, graph-mode/controller.test.js, live-full-catalog.test.js, main/rest-dataset-runner.test.js, main/startup-readiness.test.js, paper-card-routing.test.js, settings-surface-layout.test.js.
집중점: 각 테스트가 커밋 메시지가 주장하는 동작을 실제로 단언하는지(동어반복 테스트, 구현 세부를 그대로 베낀 단언, 항상 참인 단언); test.skip/.only/todo/스텁; 변경된 분기 중 테스트가 없는 것(예: fell_back 차트 경로, createWindows 재사용 시 거부 경로, quote+orderbook 직행의 한쪽 실패, 8초 재조회 한도 만료, 프리셋 자동 선택 제거 후 빈 상태); CSS/레이아웃 테스트가 문자열 grep에 의존해 깨지기 쉬운지; 테스트가 실제로 돌아가는지 node --test로 개별 파일을 돌려 확인하라. 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'css-ui',
    prompt: `당신은 CSS/레이아웃 전문 리뷰어다. 범위 안의 스타일 변경을 검수하라.
대상: app/shell.css(+133), app/styles/tokens.css, app/styles/board-surface.css, app/styles/canvas-tabs.css, app/orb.css, app/chat.css, 그리고 이 선택자들을 쓰는 HTML/JS(app/orb.html, app/canvas.js, app/chat.js 등에서 grep).
집중점: min-width:0 추가(cdedb5a)가 다른 flex 자식의 잘림/스크롤을 새로 만드는지; @font-face local() 폴백과 font-display: swap(0443cbd)이 실제 폰트 패밀리명·로컬 폰트명과 맞는지, FOUT로 레이아웃 점프가 생기는 곳; word-break: keep-all이 긴 영숫자 문자열(종목코드, URL)을 오버플로시키는지; tokens.css 토큰 변경이 다른 표면(설정, 백테스트, 키우미 미니)에 미치는 파급; 선택자 특이성 충돌·중복 규칙·죽은 선택자; Paper 계약 픽셀(1360, 720–959 M 구간, XL --bs-width)이 주석/테스트/CSS에서 일치하는지. 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'intent-vs-implementation',
    prompt: `당신은 커밋 의도 대조 리뷰어다. ${SP}/review-commits.txt의 18개 커밋 각각에 대해 git -C ${REPO} show <sha> 로 실제 diff를 열고, 메시지(제목·본문·Constraint·Rejected 줄)와 구현을 대조하라.
보고할 것: (1) 메시지가 주장하지만 diff에 없는 것, (2) 명시된 Constraint를 diff가 어기는 것(예: 'createChartCard 직접 호출 금지', '대화 모드 .history:empty 새 대화 문구 유지', 'verify.js emptyHistory 계약 파괴 금지', 'LIFE-003 창 정책 유지', '8초 이중 한도 유지'), (3) 제목 범위를 넘는 변경(scope creep — 특히 chore(comments) 5957776이 기능 코드를 건드렸는지, test 커밋이 제품 코드를 바꿨는지), (4) 커밋 타입 오표기, (5) Rejected로 명시한 대안을 사실상 채택한 곳, (6) 같은 문제를 두 커밋이 서로 다른 값으로 고쳐 최종 상태가 메시지와 어긋나는 곳(예: 타임아웃 12초→20초). 각 항목은 해당 파일의 HEAD 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'simplicity-hygiene',
    prompt: `당신은 코드 위생/단순성 리뷰어다. CLAUDE.md의 '단순성 우선'과 '수술적 변경' 규칙으로 범위 전체 diff(${SP}/review-diff.patch)를 검수하라.
집중점: 이 범위에서 새로 생긴 죽은 코드·고아 import·미사용 변수/함수/매개변수; 한 번만 쓰는 추상화나 요청에 없는 설정 옵션; 흩어진 매직 넘버(3000/8000/12000/20000ms, 재조회 8회 등)가 서로 모순되거나 주석과 다른 곳; 같은 헬퍼의 중복(예: pad2, 종목 해석, 타임아웃 래퍼); 코드와 어긋나는 주석(5957776가 고쳤다고 주장하는 '검사 5개·탭 4종·계약 키 13개'가 실제 코드 개수와 맞는지 세어 확인); 남은 디버그 로그/console 소음; 한 커밋이 무관한 줄을 건드린 곳; 200줄이 50줄이면 되는 곳(probe-live-full.js 374줄, rest-dataset-runner.js +80줄 점검). 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'security-safety',
    prompt: `당신은 보안/안전 리뷰어다. 범위 전체 diff(${SP}/review-diff.patch)와 관련 파일을 검수하라.
집중점: (1) 커밋된 문서·코드에 실 계좌번호·토큰·경로·개인정보가 들어갔는지(docs/handoff/beta-test-live/ATHENA-BETA-FEEDBACK.md에 계좌 번호가 적혀 있다 — 실계좌인지, 저장소 공개 여부(github ANNJUNGCHAN/DAOU.Athena)와 함께 위험도 판단; prd.json/progress.txt도 확인); (2) 프로브가 실주문 /api/v1/order/* 나 계좌 변경 API에 닿을 수 있는 경로(문구 잠금 정규식 우회, LLM이 도구를 고르는 경로에서 주문 도구 차단 여부); (3) spawn(..., {shell:true})에 사용자 인자가 섞이는지; (4) 실 userData 프로필을 프로브가 쓰면서 설정/토큰 파일을 덮어쓰는지; (5) Electron 보안 설정(nodeIntegration, contextIsolation, webSecurity) 변경; (6) 로그에 토큰/응답 본문 전체를 남기는지; (7) fetch 목이 실제 네트워크로 새는 경로. 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'cross-commit-regression',
    prompt: `당신은 회귀/상호작용 분석가다. 범위의 커밋들이 서로, 그리고 기존 코드와 어떻게 상호작용하는지 추적해 회귀 위험을 찾아라.
집중 시나리오: (a) 차트 5개 커밋(2bcffea, 8ef070d, bf87dbd, 7225375, dc81f82)이 합쳐진 최종 상태에서 '시세 질의 → REST 직행 → 차트 봉투(recipe_id 없음) → canvas 라우팅 → 껍질 먼저 → 패널 뒤에서 마운트' 경로를 실제 코드로 끝까지 따라가며, 3초 paint ack 계약이 어디서 측정되고 어느 단계가 이를 넘길 수 있는지, 껍질만 뜨고 패널이 영원히 안 오는 경우가 있는지; (b) canvas.js와 paper-card-routing.js가 primary 판정을 각각 하는데 두 곳의 조건이 다르면 어떤 카드가 어긋나는지; (c) e792a7a의 createWindows 재사용이 프로브(probe-live-full.js)의 부팅 대기, LIFE-003 창 정책, 두 번째 창 요청(설정/주문 티켓)과 충돌하는지; (d) 시세+호가 직행이 기존 단독 quote 직행·호가 직행 문법과 겹쳐 잘못된 문법이 먼저 잡히는지(live-prompt.js/rest-dataset-runner.js의 정규식 순서); (e) 백테스트 첫 화면 변경이 verify.js/probe-backtest-*.js의 기존 계약(emptyHistory, 탭 이름)과 맞는지. 파일을 열어 실제 줄 번호로 보고하라.`,
  },
  {
    key: 'product-copy',
    prompt: `당신은 제품 문구/Paper 정합 리뷰어다. 범위 diff(${SP}/review-diff.patch)에서 사용자에게 노출되는 한국어/영문 문자열(캔버스 카드, 채팅 안내, 빈 상태, 설정 네비, 에이전트 타일, 탭 라벨, 데모 표기)을 모두 뽑아 제품 문구 3원칙(설명문 금지·한국어 단위·내부 용어 금지)과 Paper 계약으로 검수하라.
집중점: 백테스트 빈 채팅 '아직 고른 기법이 없습니다'(Paper 40MQ-1)와 설정 4번째 네비 '성향・이력'(Paper 13)이 docs/ui/*.md 인벤토리나 PAPER_*_COVERAGE 문서와 글자 단위로 일치하는지(가운뎃점 문자 종류 포함); 에이전트 '데모' 표기 문구가 데이터 소스 속성·헤더 카운트(감시 0)와 모순을 남기는지; 채팅 타임아웃/지연 문구('조회가 지연되어 표시하지 못했습니다' 등)가 설명문 규칙과 톤을 지키는지; 영문 pydantic 배너 제거 뒤 남은 영문 문구; 탭 이름(기법/결과/이력)이 코드·테스트·문서에서 일치하는지; 내부 용어(AITS, recipe, fixture, REST)가 사용자 표면 문자열에 새는 곳. 파일을 열어 실제 줄 번호로 보고하라.`,
  },
]

const key = (f) => `${String(f.file || '').toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '')}:${Math.floor((f.line || 0) / 6)}`

const seen = new Map()
const confirmed = []
const refutedLog = []

function verifyPrompts(f) {
  const desc = `파일 ${f.file} 줄 ${f.line} (커밋 ${f.commit || '?'}), 심각도 ${f.severity}, 분류 ${f.category}
제목: ${f.title}
설명: ${f.detail}
근거: ${f.evidence}
제안: ${f.fix || '-'}`
  return [
    `당신은 회의적인 검증자(렌즈: 재현/정확성)다. 아래 코드 리뷰 지적을 반박하려고 최선을 다하라.
${desc}

할 일: 해당 파일과 호출 경로를 직접 열어 지적된 결함이 실제로 그 코드에서 일어나는지 추적하라. 줄 번호가 틀렸으면 올바른 위치를 찾아 correction에 적어라. 코드가 지적과 다르게 동작함을 보일 수 있으면 refuted=true. 확인할 수 없으면 기본값은 refuted=true(불확실=반박). 지적이 실제로 맞으면 refuted=false와 함께 근거 줄을 인용하라. severity는 당신이 보는 실제 심각도.`,
    `당신은 회의적인 검증자(렌즈: 맥락/완화)다. 아래 지적이 서술된 코드 자체는 맞다고 가정하고, 그 문제가 이미 다른 곳에서 처리되거나 의도된 것인지 확인해 반박하라.
${desc}

할 일: 호출자, 상위 가드, 기존 테스트, 다른 파일의 처리, 커밋 본문(${SP}/review-commits.txt의 Constraint/Rejected 줄)을 읽어라. 이미 완화되어 있거나 커밋이 명시적으로 그 대안을 기각/수용했거나, 이 범위 이전부터 있던 문제를 이 커밋 탓으로 돌린 것이면 refuted=true(단, 이전부터 있던 문제라도 이 범위의 변경이 그것을 악화시키거나 새 경로로 노출했으면 refuted=false). 완화가 없으면 refuted=false. severity는 완화 정도를 반영한 실제 심각도.`,
    `당신은 회의적인 검증자(렌즈: 영향/행동가능성)다. 아래 지적이 기술적으로 맞다고 가정하고, 이 제품(Electron 기반 증권 보조 셸, 라이브 베타 중, 실주문 금지)에서 실제로 중요한지 판단하라.
${desc}

할 일: 사용자 가시 결함·안전·플레이키·유지보수 비용 중 무엇에 해당하는지 판단하고 severity(P0 핵심경로/안전, P1 명확한 버그·회귀, P2 규칙 위반·약한 테스트·유지보수, P3 사소)를 매겨라. 근거 규칙 없는 취향 지적, 실행 불가능한 제안, 해당 코드에 실질 영향이 없는 것은 refuted=true. 프로젝트 규칙(CLAUDE.md 단순성/수술적 변경, 제품 문구 3원칙, 실주문 금지)에 근거하거나 실제 동작에 영향이 있으면 refuted=false. 필요하면 파일을 열어 확인하라.`,
  ]
}

async function verifyOne(f) {
  const prompts = verifyPrompts(f)
  const lenses = ['repro', 'context', 'impact']
  const votes = await parallel(prompts.map((p, i) => () =>
    agent(CONTEXT + '\n' + p, { label: `verify:${lenses[i]}:${f.file.split('/').pop()}:${f.line}`, phase: 'Verify', schema: VERDICT, effort: 'high' })))
  const valid = votes.filter(Boolean)
  const notRefuted = valid.filter((v) => !v.refuted).length
  const survives = valid.length >= 2 && notRefuted >= 2
  const impact = votes[2]
  const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 }
  const sevs = valid.filter((v) => !v.refuted).map((v) => v.severity).sort((a, b) => sevRank[a] - sevRank[b])
  const finalSeverity = impact && !impact.refuted ? impact.severity : (sevs[Math.floor(sevs.length / 2)] || f.severity)
  return { ...f, survives, finalSeverity, votes: valid.map((v, i) => ({ lens: lenses[i], refuted: v.refuted, confidence: v.confidence, severity: v.severity, reasoning: v.reasoning, correction: v.correction || '' })) }
}

function absorb(result, dimKey) {
  if (!result || !Array.isArray(result.findings)) return []
  const fresh = []
  for (const f of result.findings) {
    const k = key(f)
    if (seen.has(k)) { seen.get(k).reportedBy.push(dimKey); continue }
    const entry = { ...f, reportedBy: [dimKey] }
    seen.set(k, entry)
    fresh.push(entry)
  }
  return fresh
}

const coverage = []
let round = 0
let focusAreas = []
while (round < 3) {
  round += 1
  const finders = round === 1
    ? DIMENSIONS
    : focusAreas.map((g, i) => ({
        key: `r${round}-gap${i + 1}`,
        prompt: `당신은 2차 탐색자다. 1차 검수가 놓쳤다고 비평가가 지목한 영역을 집중 검수하라.
집중 영역: ${g.focus}
관련 파일: ${(g.files || []).join(', ') || '(비평가 미지정 — 직접 찾아라)'}
이유: ${g.why}

이미 보고된 항목(중복 보고 금지 — 같은 파일·같은 근처 줄의 같은 문제는 내지 마라):
${Array.from(seen.values()).map((s) => `- ${s.file}:${s.line} ${s.title}`).join('\n')}

새 문제만 보고하라. 파일을 열어 실제 줄 번호로 보고하라.`,
      }))
  if (!finders.length) break
  log(`라운드 ${round}: 탐색자 ${finders.length}개`)

  const roundResults = await pipeline(
    finders,
    (d) => agent(CONTEXT + '\n' + d.prompt, { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS }),
    (res, d) => {
      if (res && res.coverage_notes) coverage.push({ finder: d.key, notes: res.coverage_notes })
      const fresh = absorb(res, d.key)
      log(`find:${d.key} → ${res ? res.findings.length : 0}건 보고, 새 항목 ${fresh.length}건`)
      return fresh
    },
    (fresh) => parallel(fresh.map((f) => () => verifyOne(f))),
  )

  const verified = roundResults.filter(Boolean).flat().filter(Boolean)
  const kept = verified.filter((v) => v.survives)
  const dropped = verified.filter((v) => !v.survives)
  confirmed.push(...kept)
  refutedLog.push(...dropped.map((v) => ({ file: v.file, line: v.line, title: v.title, votes: v.votes })))
  log(`라운드 ${round}: 신규 ${verified.length}건 중 확정 ${kept.length}건, 반박 ${dropped.length}건 (누적 확정 ${confirmed.length})`)

  if (round >= 3) break
  if (round > 1 && verified.length === 0) { log('새 발견 없음 — 종료'); break }

  const critic = await agent(CONTEXT + `
당신은 완결성 비평가다. 지금까지의 리뷰가 무엇을 놓쳤는지 찾아라. 범위 diff(${SP}/review-diff.patch)의 41개 파일 목록과 18개 커밋을 아래 보고와 대조하라.

탐색자 커버리지 메모:
${coverage.map((c) => `- [${c.finder}] ${c.notes}`).join('\n')}

지금까지 보고된 항목(확정+반박 포함):
${Array.from(seen.values()).map((s) => `- ${s.file}:${s.line} [${s.severity}] ${s.title} (by ${s.reportedBy.join(',')})`).join('\n')}

할 일: (1) 변경 파일 중 어떤 탐색자도 언급하지 않은 파일, (2) 커밋 본문의 Constraint 중 아무도 검증하지 않은 것, (3) 보고는 됐지만 다른 각도(예: Windows 경로, 동시성, 재시작 후 상태)로 다시 봐야 할 것, (4) 실제로 테스트를 돌려보지 않은 주장을 찾아 최대 5개의 집중 영역(gaps)으로 돌려라. 이미 충분히 덮인 영역은 내지 마라. 덮을 게 없으면 빈 배열.`,
    { label: `critic:r${round}`, phase: 'Critic', schema: GAPS, effort: 'high' })
  focusAreas = critic && Array.isArray(critic.gaps) ? critic.gaps.slice(0, 5) : []
  if (!focusAreas.length) { log('비평가: 누락 영역 없음 — 종료'); break }
  log(`비평가가 지목한 누락 영역 ${focusAreas.length}개: ${focusAreas.map((g) => g.focus).join(' | ')}`)
}

const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 }
confirmed.sort((a, b) => sevRank[a.finalSeverity] - sevRank[b.finalSeverity] || a.file.localeCompare(b.file) || a.line - b.line)
return {
  range: RANGE,
  rounds: round,
  totalReported: seen.size,
  confirmed: confirmed.map((c) => ({ file: c.file, line: c.line, severity: c.finalSeverity, originalSeverity: c.severity, category: c.category, title: c.title, detail: c.detail, evidence: c.evidence, fix: c.fix || '', commit: c.commit || '', reportedBy: c.reportedBy, votes: c.votes })),
  refuted: refutedLog,
  coverage,
}