export const meta = {
  name: 'athena-paper-parity-audit',
  description: 'Judge whether the app implements the Paper design as intended: 30 board-group lanes read Paper (JSX/tree) vs app code/captures, every divergence is adversarially verified on the Paper side and the code side, then gate evidence is folded in',
  phases: [
    { title: 'Audit', detail: '30 lanes: Paper boards vs app code + captures' },
    { title: 'Verify', detail: 'each divergence: Paper-side refuter + code-side refuter' },
    { title: 'Evidence', detail: 'fresh gate logs + captures folded in' },
  ],
}

const REPO = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const FILE = '01M0VGPX92K1TER4ZV9PWGQJJZ'

const CONTEXT = `
## 공통 컨텍스트 — Paper 디자인 의도 대비 구현 정합 판정
- 질문: "Paper 디자인에서 의도한 대로 모든 코딩이 잘 되었는가". 당신은 배정된 Paper 보드 묶음에 대해 보드마다 판정한다.
- 저장소: ${REPO} (Electron 셸 앱 app/, Python 백엔드 backend/). HEAD = main c33ef0a (2026-09-04). 작업트리 clean. 읽기 전용 — 파일 수정·커밋 금지. 스크래치는 ${SP} 아래에만.
- Paper 파일 ID: ${FILE} (이름 "Athena"). 페이지: 화면=1-0, 그래프=D-2, 카드=5-1, 증명=F-1, 에이전트=A-2, 플러그인=B-2, 카드미니=H-1, 키우미=C-2, 백테스트=8-1, 백테스트 구현 현황(2026-09-03)=G-1.
- Paper MCP 도구는 ToolSearch로 로드한다: ToolSearch("select:mcp__paper__get_tree_summary,mcp__paper__get_jsx,mcp__paper__get_node_info,mcp__paper__get_children,mcp__paper__get_computed_styles,mcp__paper__find_nodes"). 모든 호출에 fileId="${FILE}"를 넘겨라.
  * 노드 도구(get_tree_summary/get_jsx/get_node_info/get_children/get_computed_styles)는 페이지를 열지 않아도 어느 페이지의 노드든 읽힌다(확인됨). find_nodes는 nodeId로 보드 범위를 한정해 써라.
  * open_file(페이지 전환)과 get_screenshot은 금지 — Paper 데스크톱의 활성 페이지는 병렬 레인이 공유하는 전역 상태라 서로 망친다. 시각 확인은 앱 캡처 PNG(Read 도구로 이미지 열람)로 한다. 노드 도구가 "not found"를 내면 그때만 open_file(fileId, pageId)로 한 번 열고 재시도하라.
  * 큰 보드(1440×1000급)는 get_jsx가 수십 KB다. 먼저 get_tree_summary(depth 3~4)와 get_node_info(텍스트)로 구조·문구를 잡고, 정확한 값(px, 색, 문구, 열 구성)이 필요한 서브트리만 get_jsx/get_computed_styles로 읽어라.
- 앱 쪽 정본 문서: ${REPO}/PAPER_APP_PARITY.md (Paper→앱 대응표, 2026-08-29 기준에 09-01~09-04 증분. 화면 표는 옛 번호 체계라 현재 Paper 보드명과 다를 수 있다 — 내용으로 대응시켜라), PAPER_DESIGN_AUDIT.md(결정 로그), KIUMI_AUDIT_STATUS.md, CARD_SURFACE_COVERAGE.md, PAPER_CARD_COVERAGE.md, docs/ui/*.md(인벤토리·헌장), docs/architecture/*.md, docs/handoff/*.md, artifacts/qa/jangjung-20260904/paper-parity-remaining.md(2026-09-04 남은 정합 목록 + "Locked — never fix" 목록).
- 런타임 증거(코드만 읽지 말고 열어 봐라): artifacts/qa/jangjung-20260904/captures/*.png (5모드·설정·폰트 첫 페인트, 2026-09-04 HEAD 근처 · 지금 재캡처 중이라 갱신될 수 있음), app/captures/live-full-*.png, app/captures/LIVE-FULL-REPORT.json, app/captures/integrated-cards/board-<보드ID>-*.png(카드 보드별 XL/M/S 캡처), app/captures/kiumi-*.png, app/captures/probe-orb-*-report.json, app/captures/probe-agent-paper-parity.json, artifacts/qa/jangjung-20260904/*.json. 자동 게이트 재실행 로그는 ${SP}/gates/*.log 와 ${SP}/gates/SUMMARY.txt 에 쌓이는 중이다(있으면 읽어라, 없으면 무시).
- Node는 PATH에 없다: Git Bash에서 export PATH="/c/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH". 단위 테스트 개별 실행 가능: cd /c/Projects/DAOU.Athena/app && node --test lib/<파일>.test.js. Electron 프로브(verify:*, probe-*.js)는 직접 실행하지 마라(이미 별도 프로세스가 순차 실행 중이며 병렬 실행이 서로 망친다).
- 판정 어휘(보드마다 하나): match(Paper 의도대로 구현됨) / partial(핵심은 있으나 일부 요소·문구·수치·상태가 다름) / mismatch(구현은 있으나 Paper와 다른 방향) / missing(앱에 없음) / deprecated(Paper가 폐기·참고·초기안으로 표시했거나 사용자 결정으로 앱에 만들지 않기로 한 것 — 근거 문서 명시) / paper-stale(앱이 앞서고 Paper가 낡음 — 근거 명시) / n-a(설명·명세 보드라 구현 대상이 아님).
- 판정 근거 규칙: (1) Paper 보드의 실제 노드·문구·수치를 인용하고, (2) 앱 코드의 file:line(HEAD 실제 줄 번호)이나 캡처 파일명을 인용한다. 추측·기억으로 판정하지 마라. "문서가 적용이라 한다"는 근거가 아니다 — 코드나 캡처로 확인하라. 문서와 코드가 어긋나면 그 자체가 발견이다.
- 의도적 이탈은 발견이 아니다: paper-parity-remaining.md의 Locked 목록(키우미 얼굴 1종 유지, 에이전트 채팅 헤더 숨김, 2QFO-2 960 6열 레인은 알려진 잔여, body keep-all 금지, 기법 카드 가짜 카운트 금지), PAPER_APP_PARITY.md의 "의도적으로 만들지 않은 중복 화면"·"Paper와 다르게 한 것", PAPER_DESIGN_AUDIT.md 결정 로그에 사용자 결정으로 기록된 것은 deprecated/documented로 분류하고 findings에는 넣지 마라(보드 판정 note에만 적어라).
- 발견(findings)은 한국어로, 보드ID·종류(kind: missing|mismatch|paper-stale|doc-stale)·심각도(P0 사용자 핵심 경로/안전이 Paper 의도와 반대, P1 눈에 띄는 화면·문구·상태 불일치, P2 세부 수치·간격·부차 요소, P3 사소)·Paper가 말하는 것·앱이 하는 것·양쪽 근거·수정 제안을 담는다. 발견이 없으면 빈 배열.
`

const LANE_SCHEMA = {
  type: 'object',
  properties: {
    boards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          board_name: { type: 'string' },
          verdict: { type: 'string', enum: ['match', 'partial', 'mismatch', 'missing', 'deprecated', 'paper-stale', 'n-a'] },
          app_surface: { type: 'string', description: '앱 소유 표면 file 또는 컴포넌트' },
          note: { type: 'string' },
        },
        required: ['board_id', 'board_name', 'verdict', 'note'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          board_name: { type: 'string' },
          kind: { type: 'string', enum: ['missing', 'mismatch', 'paper-stale', 'doc-stale'] },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          title: { type: 'string' },
          paper_says: { type: 'string' },
          app_does: { type: 'string' },
          evidence_paper: { type: 'string', description: 'Paper 노드 ID·문구·수치' },
          evidence_app: { type: 'string', description: 'file:line 또는 캡처 파일명' },
          fix: { type: 'string' },
        },
        required: ['board_id', 'board_name', 'kind', 'severity', 'title', 'paper_says', 'app_does', 'evidence_paper', 'evidence_app'],
      },
    },
    coverage_notes: { type: 'string', description: '무엇을 읽었고 무엇을 확인하지 못했는지' },
  },
  required: ['boards', 'findings', 'coverage_notes'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
    kind: { type: 'string', enum: ['missing', 'mismatch', 'paper-stale', 'doc-stale', 'documented-deviation'] },
    reasoning: { type: 'string' },
    correction: { type: 'string' },
  },
  required: ['refuted', 'confidence', 'severity', 'kind', 'reasoning'],
}

const LANES = [
  { key: 'screen-boot', page: '1-0', boards: '164F-2 "01 · 화면 정본 — 최신 흐름과 상태 지도", 16OD-2 "02 · 부팅 — READY · 0–240ms", 16OJ-2 "03 · 부팅 — TYPE A→AT · 240–560ms", 16OQ-2 "04 · 부팅 — TYPE ATH→ATHE · 560–880ms", 16OX-2 "05 · 부팅 — COMPLETE · 880–1440ms", 16P3-2 "06 · 부팅 — DIRECT SHELL EXPAND · 1440–1920ms"', hint: '앱: app/shell.html, app/boot.css, app/boot.js(부팅 4단계 타이핑·확장 타이밍 240/960/240/480ms), prefers-reduced-motion 경로, app/styles/tokens.css(Daki 폰트). 01 정본 지도는 상태 지도 보드라 흐름·상태 목록이 앱 모드/상태와 맞는지 본다. 캡처: artifacts/qa/jangjung-20260904/captures/00-boot-or-chat.png, font-first-paint.png, app/captures/live-full-boot.png' },
  { key: 'screen-onboarding-settings', page: '1-0', boards: '1DX-0 "07 · 온보딩 — CLI 연결", 2V0K-1 "33 · 온보딩 — CLI 연결 실패", 1FN-0 "08 · 온보딩 — 계좌 연결", 3JL-0 "12 · 계정 메뉴 — 설정 진입", AJ-0 "13 · 설정 — 셸 오버레이", 2UWT-1 "32 · 설정 — 성향·이력", 2USX-1 "31 · 설정 — 플러그인 (스니펫 등록·감사 로그)", F9-0 "14 · 설정 — 계좌", OJ-0 "18 · 설정 — 모델 선택"', hint: '앱: app/onboarding.js, app/lib/settings-cards.js, app/lib/settings-surface-layout*.js, app/lib/sidebar.js(계정 메뉴), app/shell.html 설정 오버레이, app/lib/live-full-catalog.js SETTINGS_NAV(화면·계좌·모델·성향・이력). 31 플러그인 설정은 2026-09-03 폐기(플러그인 모드로 흡수) — Paper 보드가 폐기 표시를 달았는지와 앱에 잔재가 없는지 본다. 캡처: artifacts/qa/jangjung-20260904/captures/settings-overlay.png, app/captures/live-full-settings.png' },
  { key: 'screen-shell-chat', page: '1-0', boards: '25Q-0 "09 · 셸 — 질문 입력 · Task Canvas", 3KM-0 "10 · 셸 — 답변 중 · Task Canvas", 1Y3-0 "11 · 대화 — 모델 팝오버 · 루틴 승인", 3ZPB-0 "55 · 캔버스 탭 스트립 — 카드 1개 뷰포트 · 승인 대기", DH2-0 "30 · 대화 턴 — 복원 실패", 2V27-1 "34 · 사이드바 검색 — 결과·빈 결과"', hint: '앱: app/shell.html, app/shell.css(268px 이력 + 캔버스 + 400px 대화), app/chat.js/chat.css(입력·처리 중·모델 팝오버·승인 카드·복원 실패 턴), app/canvas.js + app/styles/canvas-tabs.css + docs/architecture/canvas-tabs-responsive-plan.md(탭 스트립·뷰포트 1개), app/lib/sidebar.js(검색 토글·결과·빈 결과). 캡처: artifacts/qa/jangjung-20260904/captures/mode-summary.png, live-query-samsung.png, app/captures/live-full-query-*.png' },
  { key: 'screen-account-auth', page: '1-0', boards: 'XI-0 "15 · 계좌 등록 — 인증 확인 중", FLM-0 "16 · 계좌 등록 — 인증 실패", FPE-0 "17 · 계좌 등록 — 확인 완료", 1I0-0 "19 · 인증 — OAuth 토큰 ready", 1KK-0 "20 · 인증 — 토큰 4상태", 1M3-0 "21 · 인증 — 계좌 전환"', hint: '앱: app/onboarding.js 계좌 연결 pending/failed/ready, 설정 계좌 패널(app/lib/settings-cards.js), 인증 상태 카드(status 카드 렌더러 app/lib/card-kind-*.js 중 인증/status), 토큰 4상태 needed·ready·refreshing·expired, 계좌 전환. 백엔드 인증 API는 backend/athena_api(auth). 캡처가 없으면 코드·테스트로 판정하고 그렇게 적어라.' },
  { key: 'screen-order', page: '1-0', boards: '1OP-0 "22 · 주문 — 검토·영향·확인", 9GJ-0 "23 · 주문 — 완료·보류·재시도", 11D-0 "24 · 주문 — 거래 기능 연결 안내"', hint: '앱: 셸 내부 #order 티켓(app/shell.html, app/lib/order-ticket*.js 또는 app/canvas.js의 주문 티켓), 실행 게이트(확인·보류·실패 분리), 주문 API 활성화 게이트/승인 시트, 카드 페이지 CC-02 보드와의 관계. 실주문은 mock 도메인 하드락 — Paper가 요구하는 상태 3종(완료·보류·재시도)과 안내 화면이 앱에 있는지 본다.' },
  { key: 'screen-mode-empty-a11y-responsive', page: '1-0', boards: 'AMZ-0 "25 · 모드 전환 — 대화 유지·작업공간 교체", COS-0 "26 · 빈 작업공간 — 대화·그래프·백테스트", 9GI-0 "27 · 접근성 — 투명도·모션 감소", G5B-0 "28 · Windows 반응형 창 · Snap", GCF-0 "29 · 프로젝트·최근·새 채팅", 3VHD-1 "08 · 그래프 — 되물을 것들 카드 · 지난 대화 읽기 전용"', hint: '앱: app/lib/graph-mode/controller.js(모드 배타성·채팅 지속·PAPER_CHROME 헤더 문구), app/canvas.js 빈 상태(#gridEmpty 문구 "무엇이든 물어보세요"/"질문하면 답변 카드가 이 자리에 쌓입니다" vs Paper 26 빈 작업공간 문구 — 모드별로 대조), app/styles/*.css의 prefers-reduced-transparency/motion, app/shell.css 반응형 3열/2열/레일(1280+/700–1279/330–699) + LIFE-002/003 창 정책(app/lib/main/window-*.js), app/lib/sidebar.js 프로젝트·최근·hover 메뉴, 되물을 것들 카드(그래프 모드 카드). 캡처: artifacts/qa/jangjung-20260904/captures/mode-*.png, probe-jangjung-modes.json(빈 상태 문구 실측 포함)' },
  { key: 'screen-sessions', page: '1-0', boards: '3VIQ-1 "35 · 대화 이력 — 모드 5구역 · 세션 목록", 3VS6-1 "36 · 프로젝트 추가 — 폴더 점유", 3VV8-1 "37 · 프로젝트 ⋯ — 고정·탐색기·제거", 3VV9-1 "38 · 펜 — 새 대화창 모드 선택", 3W9B-1 "39 · 동시 실행 — 상태 4종 · 스피너", 3VVU-1 "40 · 모드 전환 — 조용한 전환 · 새 대화", 3WBZ-1 "41 · 세션 복원 — 다시 누르면 그대로", 3WOP-1 "42 · 스냅샷 명세 — 모드별 저장 항목", 3WXE-1 "43 · 세션 저장 모델 — Open WebUI·Orca 참조"', hint: '이 9장은 2026-09-03~04에 추가된 최신 보드다. PAPER_APP_PARITY.md에 대응 행이 없을 수 있다. 앱: app/lib/sidebar.js(이력 5구역·세션 목록·프로젝트 추가/⋯ 메뉴·펜 새 대화 모드 선택·동시 실행 상태 점), app/lib/main/agent-session.js·claude-chat-session.js(세션·--resume 이음), app/probe-session-restore.js(41번 보드 계약 프로브 — 읽고 무엇을 재는지 확인), 스냅샷 저장(app/lib/main/*session*·*snapshot*·userData JSON). 43은 참조 보드(n-a 가능). 각 보드가 명세하는 상태·문구·항목이 코드에 있는지 grep으로 하나씩 확인하라.' },
  { key: 'graph-01-07', page: 'D-2', boards: '3NE-0 "01 · 셸 — 그래프 모드 · 요약 뷰", 4AN-0 "02 · 셸 — 그래프 요약 · 행 선택", 4IA-0 "03 · 그래프 — 기본 군집 지도", 31H-0 "04 · 그래프 — 노드 선택 · 공통 패널", 2FIA-2 "05 · 그래프 — 수집·노출·브레인 제어", 2QA3-2 "06 · 그래프 — 헤더 필터 (기간·정렬·연결 수)", 2QCN-2 "07 · 그래프 — 정직성 상태 (이름·인코딩·빈 값)"', hint: '앱: app/lib/graph-mode/*.js(controller·summary table·군집 지도 vis-network·노드 패널·헤더 필터), app/canvas.js graphSummaryTable, 설정 그래프 패널(수집·노출), 브레인 제어. 캡처: artifacts/qa/jangjung-20260904/captures/mode-graph.png, app/captures/live-full-mode-graph.png — 베타 피드백은 그래프 요약 탭이 "완전 백지"였다고 적었다(docs/handoff/beta-test-live/ATHENA-BETA-FEEDBACK.md). 빈 데이터일 때 Paper 07 정직성 상태(빈 값 표기)대로 그리는지 본다.' },
  { key: 'graph-09-11', page: '8-1', boards: '3Z8U-1 "09 · 그래프 — 채팅이 화면을 몬다 (navigate · select · filter)", 3ZAA-1 "10 · 그래프 — 「이 노드 설명해줘」 (관계·근거·이력·대화 원문)", 3ZC2-1 "11 · 그래프 — 편집은 제안까지 · 도구 계약"', hint: '이 3장은 백테스트 페이지(8-1)에 놓인 그래프 보드다. 앱: app/lib/graph-mode/controller.js와 main 쪽 그래프 도구(navigate/select/filter 도구 계약, backend/athena_api 또는 app/lib/main/*graph* 도구 정의), 노드 설명 카드, 편집 제안 카드(승인 전 적용 금지). 도구 이름·인자·상태 4종이 Paper 표와 코드 정의에서 일치하는지 대조하라.' },
  { key: 'agent-01-08', page: 'A-2', boards: '56X-0 "01 · 셸 — 알림 파생 방", ARM-0 "02 · 에이전트 — 알람 센터 · 라이브 관제", B57-0 "03 · 에이전트 — 실행 이력·결과", BIM-0 "04 · 에이전트 — 프로액티브", BV0-0 "05 · 에이전트 — 작업", 2IJN-2 "06 · 에이전트 — 작업 설정", 432Z-1 "07 · 에이전트 대화 — 제어 제안 턴 A~E", 4330-1 "08 · 에이전트 대화 — 결과 턴"', hint: '앱: app/lib/agent-canvas.js(작업·알람·라이브·제안 4탭, 드릴인 이력/설정, 규칙 3줄), app/chat.js 에이전트 제안/결과 턴, app/probe-agent-paper-parity.js + app/captures/probe-agent-paper-parity.json(실측), PAPER_APP_PARITY.md "에이전트 페이지 전수 대조 — 2026-09-01" 절과 "Paper와 다르게 한 것". a2fa584(2026-09-04)가 샘플 시세 수집을 "데모"로 표기했다 — 라이브 컬럼 fixture와 감시 0 헤더의 모순이 Paper 02 의도와 맞는지 본다. 캡처: app/captures/live-full-mode-agent.png, artifacts/qa/jangjung-20260904/captures/mode-agent.png' },
  { key: 'agent-09-12-code-alarm', page: 'A-2', boards: '43WD-1 "09 · 에이전트 — 새 알람 · 말로 설명하면 AI가 감시 함수를 만든다", 446V-1 "10 · 에이전트 — 알람 노드·흐름 · 검사 결과 · 승인", 44HD-1 "11 · 에이전트 — 노드에서 ‘이상해요’ → AI가 고치고 다시 검사", 44RV-1 "12 · 에이전트 — 활성 코드 알람 · 상세·발화 이력"', hint: '앱: 코드 감시 트랙(feat/agent-dual-control, 2026-09-04 main 병합) — app/lib/agent-canvas.js 코드 알람 카드(함수 단위 노드·이상해요 칩·검사 버튼), backend/athena_api watch/code·watch/check, PAPER_APP_PARITY.md "에이전트 페이지 — 코드 알람 보드 09~12 대조 (2026-09-04)" 절(판정 요약·Paper와 다르게 한 것·검증 증거). 문서 주장을 코드로 재확인하라.' },
  { key: 'plugin', page: 'B-2', boards: 'FT6-0 "01 · 플러그인 — 기능 허용", 15J-0 "02 · 플러그인 — 직접 등록·감사 로그 (관리 뷰)", CU0-0 "03 · 플러그인 — 허브·설치", CVY-0 "04 · 플러그인 — 관리·마켓플레이스", 2NW8-2 "05 · 플러그인 — 설치 승인 (캔버스 카드)", 2NXS-2 "06 · 플러그인 — 상태 모음 (6상태)", 3ZJD-0 "07 · 플러그인 대화 — 제안 턴 5동작", 3ZLW-0 "08 · 플러그인 대화 — 결과 턴", 3ZNO-0 "09 · 플러그인 창 복원"', hint: '앱: app/lib/plugin-canvas.js, app/lib/plugin-catalog.js(내장 5종), app/chat.js renderPluginProposalTurn/athena:plugin-result, app/lib/main/plugin-proposal-registry.js, app/verify-plugins.js(154 단언 — ${SP}/gates/verify:plugins.log 있으면 결과 확인). PAPER_APP_PARITY.md 플러그인 9/9 절. 캡처: app/captures/live-full-mode-plugin.png, artifacts/qa/jangjung-20260904/captures/mode-plugin.png. 채팅 헤더 문구 "아테나 · 플러그인 대화"/"설치와 권한을 여기서 정합니다"를 Paper 03과 대조.' },
  { key: 'kiumi', page: 'C-2', boards: 'DO-0 "01 · 키우미 — 상황별 표현·크기 매핑", 2TJ-0 "02 · 키우미 — 표정 10종", 5H3-0 "03 · 키우미 — 시선·시간 루프", 4TY-0 "04 · 키우미 — 대화·콘텐츠 전개", 5EU-0 "05 · 키우미 — 셸 숨김·표시", CLE-0 "06 · 키우미 메뉴 — 두 진입점과 항목", C8G-0 "07 · 키우미 메뉴 — 셸 오버레이", 2I7Z-2 "08 · 키우미 — 입력 스트립 모드별 얼굴", 2LFW-2 "09 · 키우미 — 미니 카드 10종"', hint: '앱: app/orb.html, app/orb.js, app/orb.css, app/lib/orb-*.js(표정·시선·크기 360×400~640·메뉴·미니 카드 orb-mini-card.js), app/lib/kiumi-face*.js + kiumi-face.test.js, app/verify-kiumi.js, app/probe-orb-*.js 리포트(app/captures/probe-orb-*-report.json, VERIFY-KIUMI.json, kiumi-01-menu.png, kiumi-02-orb-chat.png). KIUMI_AUDIT_STATUS.md. Locked: 얼굴은 1종 유지(Paper 08 다섯 얼굴 복원 금지 — 사용자 결정) → 08은 deprecated로 분류하고 근거를 적어라. 메뉴 항목·크기(380px 굴절형·8개 SVG 액션·행 36px·여백 14px)·표정 10종 이름을 코드 상수와 대조.' },
  { key: 'card-mini', page: 'H-1', boards: '45S7-0 "template/compound", 45S8-0 "template/table", 45S9-0 "template/facts", 45SA-0 "template/order_confirm", 45SB-0 "template/order_ticket", 45SC-0 "template/chart", 45SD-0 "template/event", 45SE-0 "template/auth", 45SF-0 "template/reader", 45SG-0 "template/stream", 45SH-0 "template/2SCE-1" + mini/* 보드 ~192장(예: 46KI-0 mini/CC-01 R10, 46FL-0 mini/CC-04 R02, 46IV-0 mini/CC-06 R04, 46QP-0 mini/CC-05 R03-T1, 47AX-0 mini/CC-03 R01-T4, 4744-0 mini/CC-04 R02-T4, 46TZ-0 mini/CC-03 R01-T1)', hint: '카드미니 = 키우미 창 360×420 미니 카드. 앱: app/lib/orb-mini-card.js(순수 결정 로직), app/orb.js DOM, app/probe-orb-kiumi-96.js(verify:kiumi-cards — 96 보드 프로브; ${SP}/gates/verify:kiumi-cards.log 있으면 결과), app/captures/PROBE-ORB-MINI-CARDS.json, docs/handoff/2026-09-03-kiumi-mini-cards-runtime.md(구현 계약·검증 수치), 카드미니 원장(grep -rl "카드미니\\|kiumi-mini\\|mini-card" app/lib backend/ref docs). 알려진 메모: "Paper 카드미니가 원장과 어긋남 — 84/96에 다른 보드 값이 섞였고 Paper를 검사하는 게이트가 없다"(2026-09-03) — 지금도 그런지 템플릿 10종 + mini 보드 표본 8장 이상을 원장/코드와 글자 단위로 대조해 확인하라. Paper 보드 수(203)와 앱이 아는 보드 수(96?)의 차이도 설명하라.' },
  { key: 'cards-cc01', page: '5-1', boards: '133H-2 "CC-01 / R10 · 내 계좌", 2SYW-1 "R10-T4 주문·체결", 2SRV-1 "R10-T3 손익·성과", 3K7K-0 "R10-T3-X1 이달 기초·기말", 3ODO-0 "R10-B-X1 금현물 잔고", 3OIM-0 "R10-B-X2 금현물 주문·체결", 2SKU-1 "R10-T2 예수금·결제", 3UTA-0 "R10-T2-X6 부채·미수·연체", 3NVG-0 "R10-T2-X5 예수금 통화별", 3MTJ-0 "R10-T2-X4 D+2 정산 후", 3LGC-0 "R10-T2-X3 거래내역 상세", 3GRO-0 "R10-T2-X1 증거금 구간별", 3IGR-0 "R10-T2-X2 증거금 재원·담보", 2SCE-1 "R10-T1 보유종목"', hint: CARD_HINT('CC-01') },
  { key: 'cards-cc02', page: '5-1', boards: '135M-2 "CC-02 / R11 · 삼성전자 10주 시장가 매수", 2TNJ-1 "R11-T5 금현물 매수", 2TJ6-1 "R11-T4 신용 매수", 2TET-1 "R11-T3 취소", 2TAG-1 "R11-T2 정정", 2T63-1 "R11-T1 현금 매도"', hint: CARD_HINT('CC-02') + ' 주문 카드는 실주문 금지(mock 하드락) — Paper의 실행 게이트·확인 단계가 앱 주문 티켓과 일치하는지, 버튼 상태 전수(PAPER_APP_PARITY "카드 스트립 버튼 상태 전수")를 대조.' },
  { key: 'cards-cc03-core', page: '5-1', boards: '137X-2 "CC-03 / R01 · 삼성전자 3개월 차트", 3DI2-0 "R01-X 투자자 12주체", 2RJ7-1 "R01-T3 금현물 차트·시세", 2RBO-1 "R01-T2 기업정보", 2R3M-1 "R01-T1 현재시세", 3FR6-0 "R01-T1-X 분봉 시세", 32S7-0 "R01-T7 업종 지수 차트", 32XM-0 "R01-T8 신주인수권", 15N5-2 "R07 KODEX 200 ETF", 15P5-2 "R08 ELW 위험·만기", 3DZ1-0 "R08-X ELW 바스켓"', hint: CARD_HINT('CC-03') + ' 차트 카드는 AITS 차트 패널(app/lib/aits-chart-panel.js, chart-card.js, chart-toolbar.js)이 전문 렌더러다 — Paper 137X-2의 주기·지표·드로잉·매물대 패널 구성과 대조. 2026-09-04 커밋들이 차트 첫 페인트(껍질 먼저, 패널 뒤에서)와 REST 일봉 라우팅을 바꿨다 — 최종 렌더가 Paper 보드와 같은 표면(AITS primary)인지 app/captures/live-full-query-QA-CHART.png, live-chart-day.png로 확인.' },
  { key: 'cards-cc03-rank', page: '5-1', boards: '2VDA-0 "R01-T4 순위 — 주식 신호·순위", 31UD-0 "T4-10 당일·전일 체결량", 31II-0 "T4-9 VI 발동", 3TCO-0 "T4-9-X VI 전체 12건", 316O-0 "T4-8 시가대비 등락", 30ZW-0 "T4-7 고저 PER", 30O1-0 "T4-6 매물대집중", 30C1-0 "T4-5 거래량갱신", 2ZZ7-0 "T4-4 가격급등락", 2ZHC-0 "T4-3 고저가근접", 2YXS-0 "T4-2 상하한가", 2VIN-0 "R01-T5 ETF 전체시세", 2WZK-0 "T5-2 ETF 기간 수익률", 2VO0-0 "R01-T6 ELW 순위", 2ZN9-0 "T6-6 ELW 조건검색", 2Z49-0 "T6-5 ELW 거래원별", 3TOM-0 "T6-5-X ELW 10창구", 2Y47-0 "T6-4 ELW 가격급등락", 2XY6-0 "T6-3 ELW 근접율", 2XA5-0 "T6-2 ELW 등락률"', hint: CARD_HINT('CC-03') + ' 순위 모드(PAPER_APP_PARITY "2026-09-01 4차 — 순위 모드 신설", 증명 페이지 RX-1 순위·정렬 상태 ↔ TR 사양)와 대조. 보드 20장 전부를 열 필요는 없다 — 템플릿 디렉터리 존재·regions/slots 구성·generated.js 등록을 전수로 확인하고, 표본 6장 이상은 JSX 열 구성·문구까지 대조하라.' },
  { key: 'cards-cc04-hoga', page: '5-1', boards: '13BC-2 "CC-04 / R02 · 삼성전자 실시간 호가·체결", 3JZ3-0 "R02-X 호가 단계별 낱값·거래소별", 2TRW-1 "R02-T4 정규장 5단", 1JPU-0 "A04 · 호가 정본 — 실시간 통합 호가", 3N4O-0 "A04-X 호가 정본 — 단계별 낱값", 1JZW-0 "A02×A04 · 호가 주문 정본 — 시장가 매수"', hint: CARD_HINT('CC-04') + ' 호가 사다리는 전문 렌더러(app/lib/card-kind-호가.js, 실시간 WS REG/REMOVE, app/verify-hoga-live.js rows 20 / card true — ${SP}/gates/verify:hoga-live.log). 캡처 app/captures/live-full-query-QA-ORDERBOOK.png, app/hoga-live-fixture.html.' },
  { key: 'cards-cc05', page: '5-1', boards: '2QFO-2 "CC-05 / R03-T1 · 수급 — 투자자별", 2V71-0 "R03-T6 수급 순위", 31OF-0 "T6-9 신용융자 가능", 31CL-0 "T6-8 동일순매매", 30TY-0 "T6-7 증권사별", 30HY-0 "T6-6 외국인·기관", 3063-0 "T6-5 장중 투자자", 2ZTA-0 "T6-4 한도소진율", 2ZBB-0 "T6-3 대차 상위", 2YS8-0 "T6-2 신용비율", 2S4E-1 "R03-T5 종목 동향", 2RWK-1 "R03-T4 신용·대차", 2ROJ-1 "R03-T3 프로그램"', hint: CARD_HINT('CC-05') + ' 2QFO-2 960px 6열 레인은 알려진 잔여(Locked — 재보고 금지, note에만). artifacts/qa/jangjung-20260904/g5b-2qfo2.md 참고. R03-T2 거래원 보드는 카드 페이지 목록에 안 보이는데 카드미니에는 mini/CC-05 R03-T2가 있다 — 카드 페이지 104장 중 잘린 4장에 있는지 get_children(root_node_5-1)로 확인하라.' },
  { key: 'cards-cc06-core', page: '5-1', boards: '13K0-2 "CC-06 / R04 · 거래대금 상위 저평가 탐색", 2UN6-1 "R04-T5 조건검색", 2UHM-1 "R04-T4 시장·VI", 2UBO-1 "R04-T3 테마", 2U5L-1 "R04-T2 관심종목", 3D4I-0 "R04-T2-X 삼성전자 행 펼침", 3EWN-0 "R04-T2-X2 ELW 행 펼침", 2TZN-1 "R04-T1 업종", 3BQB-0 "R04-T1-X 업종 목록 펼침", 15J9-2 "R05 반도체 업종·AI 테마", 15L8-2 "R06 관심종목·조건 신호", 15R0-2 "R09 시장 체온·VI"', hint: CARD_HINT('CC-06') },
  { key: 'cards-cc06-finder', page: '5-1', boards: '2X5N-0 "R04-S2 종목찾기 당일 거래량", 2XG6-0 "S3 전일 거래량", 2XKO-0 "S4 등락률", 2XP6-0 "S5 예상체결 등락률", 2XTO-0 "S6 호가잔량 상위", 2YA8-0 "S7 호가잔량 급증", 2YEQ-0 "S8 잔량률 급증", 2YJ8-0 "S9 거래량 급증", 2YNQ-0 "S10 시간외 등락률"', hint: CARD_HINT('CC-06') + ' S1이 없다 — 의도인지(원장·문서) 확인.' },
  { key: 'cards-common-states-narrow', page: '5-1', boards: '161Q-2 "S00 · 공통 상태·재시도", 1IG3-0 "S01 · 시간 초과·취소·인증 만료·장 마감", 15XT-2 "C01 · 좁은 데스크톱 — 차트", 15Y5-2 "C02 · 좁은 데스크톱 — 실시간 호가", 15YH-2 "C03 · 좁은 데스크톱 — 주문 확인", 1IG2-0 "C04–C07 · 좁은 데스크톱 — 계좌·수급·탐색·상품", 1745-2 "D01 · 문맥형 상세·이어보기 정본", 1UO5-1 "A02×A04 · 목록 펼침 검증 — 최근 체결 20건", 1WOB-1 "A05 · 목록 펼침 검증 — 외국인 기간별 매매 상위"', hint: CARD_HINT('공통') + ' 공통 상태(로딩·오류·재시도·시간 초과·인증 만료·장 마감)는 app/canvas.js·app/lib/integrated-card-surface.js·카드 상태 렌더러에서, 좁은 데스크톱(390px XS 단계)은 app/styles/board-surface.css 컨테이너 쿼리(XL/L/M/S/XS)와 docs/architecture/canvas-tabs-responsive-plan.md에서, 펼침(문법 F)은 board-surface·slots.json에서 확인. 알려진 빨감: verify:integrated-cards의 2SKU-1 M 프로브(720–959) — cdedb5a(09-04)가 min-width:0로 고쳤다고 주장 → ${SP}/gates/verify:integrated-cards.log 로 현재 상태 확인.' },
  { key: 'proof-page', page: 'F-1', boards: '24GR-0 "CC-04 R02-X1 정규·통합 호가 공식 원문 ka10004·ka10007", 24GS-0 "R02-X2 실시간 KRX·NXT·LP 0C·0D", 24GT-0 "R02-X3 시간외·금현물·프로토콜 0E·ka10087·ka50101", 1XA2-0 "CC-03 R01-B 차트 전체 항목·행 상세", 177W-2 "CC-04 R02-B 시간외·통합·금현물 호가", 17F8-2 "CC-01 R10-B 증거금·담보·금현물 잔고", 17IH-2 "CC-02 R11-B 신용·금현물·정정·취소 주문", 17MB-2 "CC-06 R06-B 조건검색·이어보기·실시간 해제", 1XGW-0 "DV-1 종목 탐색 결과 공식 128개 필드", 2DZE-0 "DV-2 기업·가치 프로필 39개 필드", 2E4E-0 "DV-3 거래·가격 이력 189개 필드", 322V-0 "RX-1 순위·정렬 상태 ↔ TR 사양"', hint: '증명 페이지는 공식 API 필드 원문·계약 보드다. 앱: backend/ref/*.json(kiwoom-tr-inventory, kiwoom-screen-definitions, response-projections, selector-routing, aits-chart-contracts, ws-ladder-regex-calibration), PAPER_CARD_COVERAGE.json/PAPER_FIELD_COVERAGE.json 원장, CARD_SURFACE_COVERAGE.md 미도달 150 occurrence(17F8-2 68건이 트리 밖 보드 귀속). 판정: 보드가 열거한 필드 수(128/39/189)·TR 코드·순위 정렬 상태가 원장·코드 계약과 수로 일치하는지 세어 확인하라. 이 보드들은 대개 n-a 또는 계약 보드다 — 계약 수치가 어긋나는 것만 발견으로.' },
  { key: 'backtest-01-10', page: '8-1', boards: '1SW0-0 "01 · 설계 (폼)", 1T5K-0 "02 · 설계 (코드)", 1TGA-1 "03 · 결과", 1TPF-1 "04 · 데이터 수집 승인", 1WSI-1 "05 · 이력·비교", 1WZJ-1 "06 · 최적화", 2FMM-2 "07 · 전략 배포 · 실전 적용", 2FR9-2 "08 · 코드 플로우 지도", 2FY9-2 "09 · 오류 진단 · 자동 수정 승인", 2GZM-2 "10 · 전략 고르기 · 실패·비활성 상태"', hint: '앱: app/lib/backtest-canvas.js(+test), app/lib/backtest-*.js, app/lib/project-ide.js, backend/athena_api/backtest/*, docs/architecture/backtest-parity-audit.md, PAPER_APP_PARITY.md BT-01~BT-10 행(02·08·09는 "초기 안" 표시). 2026-09-04 fe24b6e/81b5c3e가 첫 화면을 Paper 19(기법 목록)로 바꿨고 프리셋 자동 선택·pydantic 배너를 없앴다 — 01~10 보드 중 지금도 유효한 것과 19~23으로 대체된 것을 가려라(Paper 15·16은 폐기 표시됨 — 01~10엔 폐기 표시가 있는지 확인). 캡처: artifacts/qa/jangjung-20260904/captures/mode-backtest-after-bt19.png, app/captures/live-full-mode-backtest.png, backtest-mode-probe.json.' },
  { key: 'backtest-11-18-visual', page: '8-1', boards: '3Y38-1 "11 · 시각 전략 설계 · 편집 가능", 3YFV-1 "12 · 시각 전략 검증 · 연결 오류", 3YQ0-1 "13 · 오류 노드에서 코드로 · 줄 연결", 3Z0X-1 "14 · 그래프·코드 동기화 완료 · 실행 전", 3X7M-1 "15 · 설계 (흐름 지도) — 폐기", 3XE7-1 "16 · 지도 실행 → 멈춤 → 대화로 고침 — 폐기", 3XL4-1 "17 · 출처에서 지도로 · 만드는 중(로딩)", 3XV1-1 "18 · 흐름 지도 강화 명세"', hint: '앱: 시각 전략 왕복(docs/handoff/2026-09-03-visual-strategy-roundtrip.md, app/lib/backtest-visual-*.js 또는 VisualStrategyGraph, backend mapmodel/codegen), 15·16 폐기 → 앱에서 요약 지도가 실제로 제거됐는지(grep 지도 탭·요약 지도 코드) 확인, 17은 "설계 완료·구현 전", 18은 규칙 보드(A~H 중 F·H 부분). PAPER_APP_PARITY.md BT-11~18 행과 대조하고, "구현 중(ralph US-00x)" 표시가 현재 코드 상태와 맞는지 확인.' },
  { key: 'backtest-19-23-technique', page: '8-1', boards: '40EV-1 "19 · 기법 목록 · 새 기법", 43DP-1 "20 · 새 기법 만들기 · 폴더·편집기·터미널·단계 카드", 43O1-1 "21 · 노드·흐름 창 · 노드를 누르면 @칩이 입력창에 들어간다", 452D-1 "22 · 고치기 순환 · 단계 카드를 누르면 diff와 터미널이 열린다", 42FW-1 "23 · 승인 → 기법 목록에 추가 → 실매매 적용"', hint: '앱: app/lib/backtest-canvas.js renderTechniqueList/TECHNIQUE_NEW_LABEL(2열·탭 기법/결과/이력·[+ 새 기법 만들기]·대화로 시작 칩), app/lib/project-ide.js createProjectIde, app/lib/backtest-technique-nodes.js(+test: 이상해요 버튼 부재 잠금), backtest-technique-cards.css, technique_check.py run_checks(차단 5·경고 2), technique_nodes.py build_nodes, approveTechnique/registerUserStrategy, DEPLOY_MODES·arm(deploy_orders.py is_armed_for_auto). docs/technique-code-rules.md. artifacts/qa/jangjung-20260904/paper-parity-remaining.md "Closed" 항목(탭·2열·배너·pydantic·빈 채팅 문구)을 코드·캡처로 재확인. 40EV-1의 정확한 문구(타이틀·부제·배너·칩)를 get_node_info로 뽑아 코드 상수와 글자 단위 대조.' },
  { key: 'backtest-status-page', page: 'G-1', boards: '402S-1 "00 · 지금 구현된 것 · 요약과 의도 편차", 405P-1 "00b · 의도 대비 구현 상태 표", 40AA-1 "01 · 모드 진입 — 프리셋 10종", 40AL-1 "02 · 지도 탭 — 요약 지도", 40AW-1 "03 · 지도 탭 — 시각 편집기", 40B7-1 "04 · 노드 검사기", 40BI-1 "05 · 폼 탭", 40BT-1 "06 · 코드 탭", 40C4-1 "07 · 연결을 끊은 지도", 40CF-1 "08 · 오류 칸 → 코드 미리보기", 40CQ-1 "09 · 질문 카드", 40D1-1 "10 · 수정안 카드", 40DC-1 "11 · 적용 — 동기화 완료", 40DN-1 "12 · 실행 결과 탭", 40DY-1 "13 · 이력 탭", 40E9-1 "14 · 코드가 지도보다 앞섬", 40EK-1 "15 · 창 폭 860px — 지도 탭"', hint: '이 페이지는 2026-09-03 시점 "의도 대비 구현 상태"를 Paper에 적어 둔 것이다. 00b 표(405P-1)의 행 전부를 get_node_info/get_jsx로 뽑아 각 행의 "의도"·"구현 상태"·"편차"를 현재 코드(2026-09-04 HEAD)로 재판정하라: 그때 미구현/구현 중이던 것이 지금 됐는지, 그때 "구현됨"이 09-04 첫 화면 개편(프리셋 10종 진입 → 기법 목록)으로 뒤집혔는지. 01 프리셋 10종 진입 보드는 09-04 이후 Paper 19와 충돌한다 — paper-stale 후보. 판정은 보드 단위 + 표 행 단위 findings.' },
  { key: 'parity-doc-audit', page: '1-0', boards: '(보드 대신 문서) PAPER_APP_PARITY.md 전체 vs 현재 Paper 페이지·보드 목록', hint: `현재 Paper 보드 목록(페이지별 ID·이름)은 이 프롬프트 하단에 있다. 할 일: (1) PAPER_APP_PARITY.md의 각 표 행을 현재 Paper 보드에 대응시켜, Paper에 있는데 대응표에 행이 없는 보드(예: 화면 33~43·55·08 되물을 것들, 백테스트 그래프 09~11, 에이전트 07·08, 구현 현황 페이지)와 대응표에 있는데 Paper에서 사라진/이동한 보드를 목록화하라. (2) 대응표가 "적용"이라며 인용한 파일·함수(예: renderTechniqueList, createProjectIde, referenceTechniqueNode, approveTechnique, DEPLOY_MODES, is_armed_for_auto, plugin-proposal-registry.js, AthenaPluginCanvas.setView)가 실제로 존재하는지 grep으로 전수 확인하고 없는 것을 doc-stale로 보고하라. (3) 대응표 수치(화면 60/60, 카드 31/31, 키우미 9/9, 그래프 7/7, 플러그인 9/9, 에이전트 대조)가 현재 Paper 보드 수와 맞는지. boards 배열에는 페이지 단위 요약(page:화면 등)을 넣고, findings에 doc-stale 항목을 넣어라.

현재 Paper 보드 목록:
화면(1-0, 45): 164F-2 01 화면 정본 / 16OD-2 02 부팅 READY / 16OJ-2 03 / 16OQ-2 04 / 16OX-2 05 / 16P3-2 06 DIRECT SHELL EXPAND / 1DX-0 07 온보딩 CLI / 2V0K-1 33 온보딩 CLI 실패 / 1FN-0 08 온보딩 계좌 / 25Q-0 09 셸 질문 입력 / 3ZPB-0 55 캔버스 탭 스트립 / 3KM-0 10 셸 답변 중 / 1Y3-0 11 모델 팝오버·루틴 승인 / 3JL-0 12 계정 메뉴 / 2V27-1 34 사이드바 검색 / AJ-0 13 설정 오버레이 / 2UWT-1 32 설정 성향·이력 / 2USX-1 31 설정 플러그인 / F9-0 14 설정 계좌 / XI-0 15 / FLM-0 16 / FPE-0 17 / OJ-0 18 설정 모델 / 1I0-0 19 OAuth ready / 1KK-0 20 토큰 4상태 / 1M3-0 21 계좌 전환 / 1OP-0 22 주문 검토 / 9GJ-0 23 주문 완료·보류·재시도 / 11D-0 24 거래 기능 연결 안내 / AMZ-0 25 모드 전환 / COS-0 26 빈 작업공간 / 9GI-0 27 접근성 / G5B-0 28 Windows 반응형 / GCF-0 29 프로젝트·최근·새 채팅 / DH2-0 30 복원 실패 / 3VHD-1 08 그래프 되물을 것들 / 3VIQ-1 35 대화 이력 5구역 / 3VS6-1 36 프로젝트 추가 / 3VV8-1 37 프로젝트 ⋯ / 3VV9-1 38 펜 새 대화창 / 3VVU-1 40 조용한 전환 / 3W9B-1 39 동시 실행 / 3WBZ-1 41 세션 복원 / 3WOP-1 42 스냅샷 명세 / 3WXE-1 43 세션 저장 모델
그래프(D-2, 7): 3NE-0 01 / 4AN-0 02 / 4IA-0 03 / 31H-0 04 / 2FIA-2 05 / 2QA3-2 06 / 2QCN-2 07
에이전트(A-2, 12): 56X-0 01 / ARM-0 02 / B57-0 03 / BIM-0 04 / BV0-0 05 / 2IJN-2 06 / 432Z-1 07 / 4330-1 08 / 43WD-1 09 / 446V-1 10 / 44HD-1 11 / 44RV-1 12
플러그인(B-2, 9): FT6-0 01 / 15J-0 02 / CU0-0 03 / CVY-0 04 / 2NW8-2 05 / 2NXS-2 06 / 3ZJD-0 07 / 3ZLW-0 08 / 3ZNO-0 09
키우미(C-2, 9): DO-0 01 / 2TJ-0 02 / 5H3-0 03 / 4TY-0 04 / 5EU-0 05 / CLE-0 06 / C8G-0 07 / 2I7Z-2 08 / 2LFW-2 09
백테스트(8-1, 26): 1SW0-0 01 / 1T5K-0 02 / 1TGA-1 03 / 1TPF-1 04 / 1WSI-1 05 / 1WZJ-1 06 / 2FMM-2 07 / 2FR9-2 08 / 2FY9-2 09 / 2GZM-2 10 / 3Y38-1 11 / 3YFV-1 12 / 3YQ0-1 13 / 3Z0X-1 14 / 3X7M-1 15(폐기) / 3XE7-1 16(폐기) / 3XL4-1 17 / 3XV1-1 18 / 40EV-1 19 / 43DP-1 20 / 43O1-1 21 / 452D-1 22 / 42FW-1 23 / 3Z8U-1 그래프 09 / 3ZAA-1 그래프 10 / 3ZC2-1 그래프 11
카드(5-1, 104 — CC-01 14장, CC-02 6장, CC-03 31장, CC-04 3장+A04 3장, CC-05 13장, CC-06 21장, 공통·좁은·펼침 9장), 증명(F-1, 12), 카드미니(H-1, 203: template 11 + mini/* 192), 백테스트 구현 현황(G-1, 17)` },
]

function CARD_HINT(cc) {
  return `카드 페이지 보드는 Paper→코드 추출 파이프라인으로 앱에 들어간다: backend/ref/card-surface-templates/<보드ID>/{paper.jsx(추출 시점 Paper JSX 원문), paper.tree.txt, board.html, regions.json, slots.json} → app/lib/board-templates.${cc}.generated.js → app/lib/integrated-card-surface.js·app/styles/board-surface.css(컨테이너 쿼리 XL/L/M/S/XS) → app/verify-integrated-cards.js(자동 게이트 G4·G5a)와 app/captures/integrated-cards/board-<보드ID>-<폭>x<높이>.png(육안 G5b). 문서: docs/ui/paper-card-surface-charter.md(헌장), docs/handoff/2026-09-03-card-surface-paper-to-code.md, CARD_SURFACE_COVERAGE.md(occurrence 도달 95.8%, 미도달 150), PAPER_CARD_COVERAGE.md(299/299), docs/handoff/card-surface/progress.txt. 판정 절차: (a) 배정 보드마다 템플릿 디렉터리 존재 여부와 generated.js 등록 여부, (b) 현재 Paper JSX(get_jsx 또는 get_tree_summary+find_nodes)가 저장소의 paper.jsx 추출본과 같은지(문구·열·수치 표본 — Paper가 추출 뒤 바뀌었으면 paper-stale이 아니라 "추출본 낡음" mismatch), (c) 캡처 PNG(XL·M·S)에서 Paper 의도(열 구성·KPI·레일·펼침)가 보이는지 Read로 열어 확인, (d) CARD_SURFACE_COVERAGE.md의 미도달 occurrence 중 이 카드 몫. 카드 20장 전부 JSX를 읽을 필요는 없다 — (a)(d)는 전수, (b)(c)는 표본 5장 이상.`
}

const key = (f) => `${f.board_id}:${String(f.title || '').replace(/\s+/g, '').slice(0, 24)}`
const seen = new Map()
const boards = []
const confirmed = []
const refuted = []
const coverage = []

function verifyPrompts(f) {
  const desc = `Paper 보드 ${f.board_id} "${f.board_name}", 종류 ${f.kind}, 심각도 ${f.severity}
제목: ${f.title}
Paper가 말하는 것: ${f.paper_says}
앱이 하는 것: ${f.app_does}
Paper 근거: ${f.evidence_paper}
앱 근거: ${f.evidence_app}
제안: ${f.fix || '-'}`
  return [
    `당신은 Paper 쪽 회의적 검증자다. 아래 정합 지적을 Paper 의도 관점에서 반박하려고 최선을 다하라.
${desc}

할 일: 해당 Paper 보드를 노드 도구(get_tree_summary/get_node_info/get_jsx/find_nodes, fileId 필수, open_file·get_screenshot 금지)로 직접 읽어 (1) Paper가 정말 그렇게 명세하는지(문구·수치·상태를 인용), (2) 보드 제목·캡션에 폐기·참고·초기 안·구현 전 표시가 있는지, (3) 같은 주제를 다루는 더 최신 보드(예: 백테스트 19~23이 01~10을 대체, 화면 33~43 신규)가 이를 뒤집는지, (4) PAPER_DESIGN_AUDIT.md 결정 로그·PAPER_APP_PARITY.md "Paper와 다르게 한 것"·paper-parity-remaining.md Locked 목록에 사용자 결정으로 기록된 의도적 이탈인지 확인하라. (2)(3)(4)에 해당하거나 Paper가 그렇게 말하지 않으면 refuted=true (kind=documented-deviation이면 그렇게 표시). 확인이 안 되면 기본값 refuted=true. Paper가 실제로 그렇게 요구하고 뒤집는 결정이 없으면 refuted=false.`,
    `당신은 코드 쪽 회의적 검증자다. 아래 정합 지적이 Paper 의도를 옳게 읽었다고 가정하고, 앱이 실제로 그것을 구현하지 않았거나 다르게 했다는 주장을 반박하려고 최선을 다하라.
${desc}

할 일: 인용된 file:line과 그 주변, 다른 후보 파일(grep으로 문구·상수·id 검색), 단위 테스트, 캡처 PNG(Read로 열람), ${SP}/gates/*.log(있으면)를 직접 확인하라. 이미 구현돼 있거나(다른 파일이라도), 지적이 코드를 잘못 읽었거나, 캡처가 Paper대로 보이면 refuted=true. 앱이 실제로 빠졌거나 다르게 동작하면 refuted=false와 함께 정확한 file:line·캡처 근거를 인용하고 severity(P0 핵심 경로/안전이 의도와 반대, P1 눈에 띄는 불일치, P2 세부, P3 사소)를 매겨라. 확인이 안 되면 기본값 refuted=true.`,
  ]
}

async function verifyOne(f) {
  if (f.severity === 'P2' || f.severity === 'P3') {
    return { ...f, survives: false, unverified: true, finalSeverity: f.severity, finalKind: f.kind, votes: [] }
  }
  const prompts = verifyPrompts(f)
  const lenses = ['paper', 'code']
  const votes = await parallel(prompts.map((p, i) => () =>
    agent(CONTEXT + '\n' + p, { label: `verify:${lenses[i]}:${f.board_id}`, phase: 'Verify', schema: VERDICT, effort: 'high' })))
  const valid = votes.filter(Boolean)
  const survives = valid.length === 2 && valid.every((v) => !v.refuted)
  const code = votes[1]
  const finalSeverity = code && !code.refuted ? code.severity : f.severity
  const paperVote = votes[0]
  const finalKind = paperVote && paperVote.kind === 'documented-deviation' ? 'documented-deviation' : (code && code.kind ? code.kind : f.kind)
  return { ...f, survives, finalSeverity, finalKind, votes: valid.map((v, i) => ({ lens: lenses[i], refuted: v.refuted, confidence: v.confidence, severity: v.severity, kind: v.kind, reasoning: v.reasoning, correction: v.correction || '' })) }
}

phase('Audit')
const laneResults = await pipeline(
  LANES,
  (lane) => agent(CONTEXT + `
## 당신의 레인: ${lane.key} (Paper 페이지 ${lane.page})
배정 보드: ${lane.boards}
힌트(출발점일 뿐 — 실제로 열어 확인하라): ${lane.hint}

절차: (1) 보드마다 Paper 노드 트리·문구·수치를 읽는다(fileId="${FILE}"). (2) 앱의 소유 표면을 코드·테스트·캡처로 찾는다. (3) 보드마다 verdict를 내리고 note에 근거(Paper 노드/문구 ↔ file:line/캡처)를 적는다. (4) partial/mismatch/missing/paper-stale 중 발견으로 남길 것을 findings에 넣는다(의도적 이탈은 제외, note에만). (5) coverage_notes에 못 본 것을 솔직히 적는다.`, { label: `audit:${lane.key}`, phase: 'Audit', schema: LANE_SCHEMA }),
  (res, lane) => {
    if (!res) { log(`audit:${lane.key} → 결과 없음`); return [] }
    coverage.push({ lane: lane.key, notes: res.coverage_notes })
    for (const b of res.boards || []) boards.push({ lane: lane.key, page: lane.page, ...b })
    const fresh = []
    for (const f of res.findings || []) {
      const k = key(f)
      if (seen.has(k)) continue
      const entry = { ...f, lane: lane.key, page: lane.page }
      seen.set(k, entry)
      fresh.push(entry)
    }
    const counts = {}
    for (const b of res.boards || []) counts[b.verdict] = (counts[b.verdict] || 0) + 1
    log(`audit:${lane.key} → 보드 ${(res.boards || []).length}장 ${JSON.stringify(counts)}, 발견 ${fresh.length}건`)
    return fresh
  },
  (fresh) => parallel(fresh.map((f) => () => verifyOne(f))),
)

const observations = []
for (const arr of laneResults.filter(Boolean)) {
  for (const v of arr.filter(Boolean)) {
    if (v.unverified) observations.push({ page: v.page, lane: v.lane, board_id: v.board_id, board_name: v.board_name, kind: v.kind, severity: v.severity, title: v.title, paper_says: v.paper_says, app_does: v.app_does, evidence_paper: v.evidence_paper, evidence_app: v.evidence_app, fix: v.fix || '' })
    else if (v.survives) confirmed.push(v)
    else refuted.push({ board_id: v.board_id, board_name: v.board_name, title: v.title, severity: v.severity, kind: v.kind, finalKind: v.finalKind, votes: v.votes })
  }
}
log(`검증 완료: 보고 ${seen.size}건 중 P0/P1 확정 ${confirmed.length}건, 반박/의도적 이탈 ${refuted.length}건, P2/P3 미검증 관찰 ${observations.length}건`)

phase('Evidence')
const evidence = await agent(CONTEXT + `
## 증거 수집자
지금까지의 정합 판정에 실행 증거를 붙여라. 읽을 것: ${SP}/gates/SUMMARY.txt 와 ${SP}/gates/*.log (게이트 4종 + verify:* 11종 + probe-session-restore + probe-backtest-mode — 일부는 아직 실행 중이거나 없을 수 있다; 있는 것만), artifacts/qa/jangjung-20260904/probe-jangjung-modes.rerun.log 와 probe-jangjung-modes.json(재실행분), artifacts/qa/jangjung-20260904/captures/*.png(Read로 열람: 5모드·설정·부팅 — 각 화면이 Paper 의도(3열 셸·모드 레일 5종·빈 상태 문구·채팅 헤더)대로 보이는지 한 줄씩), app/captures/LIVE-FULL-REPORT.json.
반환: 게이트별 {name, ok, 핵심 수치/실패 메시지}, 캡처별 한 줄 관찰, 그리고 아래 확정 발견 목록 중 게이트 로그·캡처가 뒷받침하거나 반박하는 항목을 명시하라.

확정 발견:
${confirmed.map((c) => `- [${c.finalSeverity}/${c.finalKind}] ${c.board_id} ${c.board_name}: ${c.title}`).join('\n')}`,
  { label: 'evidence:gates-captures', phase: 'Evidence', schema: {
    type: 'object',
    properties: {
      gates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'ok', 'detail'] } },
      captures: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, observation: { type: 'string' } }, required: ['file', 'observation'] } },
      cross_refs: { type: 'array', items: { type: 'object', properties: { board_id: { type: 'string' }, supports: { type: 'boolean' }, detail: { type: 'string' } }, required: ['board_id', 'supports', 'detail'] } },
      notes: { type: 'string' },
    },
    required: ['gates', 'captures', 'cross_refs', 'notes'],
  } })

const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 }
confirmed.sort((a, b) => sevRank[a.finalSeverity] - sevRank[b.finalSeverity] || a.page.localeCompare(b.page) || a.board_id.localeCompare(b.board_id))
const verdictCounts = {}
for (const b of boards) verdictCounts[b.verdict] = (verdictCounts[b.verdict] || 0) + 1
return {
  boardCount: boards.length,
  verdictCounts,
  boards,
  confirmed: confirmed.map((c) => ({ page: c.page, lane: c.lane, board_id: c.board_id, board_name: c.board_name, kind: c.finalKind, severity: c.finalSeverity, title: c.title, paper_says: c.paper_says, app_does: c.app_does, evidence_paper: c.evidence_paper, evidence_app: c.evidence_app, fix: c.fix || '', votes: c.votes })),
  refuted,
  observations,
  evidence,
  coverage,
}