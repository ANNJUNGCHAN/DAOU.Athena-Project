export const meta = {
  name: 'athena-paper-cards-fix',
  description: 'Paper 카드 게이트(PAPER-CARDS) 실패 32장을 원인별 5묶음으로 parity 워크트리에서 구현→검토→푸시한다',
  phases: [
    { title: 'Implement', detail: '묶음별 원인 실측 + 템플릿·마운트·CSS 보정 + 카드 게이트 전수 초록 + 커밋' },
    { title: 'Review', detail: '독립 검토자가 Paper 이탈·가짜 통과·회귀를 잡는다; 수정 ≤2회' },
    { title: 'Push', detail: 'origin/main 병합 후 HEAD:main 푸시, 주 체크아웃 동기화' },
  ],
}

const WT = 'C:/Projects/DAOU.Athena-parity'
const MAIN = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const BATCHES = Array.isArray(args) ? args : []

const COMMON = `
## 공통 환경·규칙
- 작업 저장소(워크트리): ${WT} (브랜치 fix/paper-parity-2026-09-05, origin/main과 같은 선). 모든 파일 경로·git 명령은 이 워크트리 기준 절대경로로 쓴다. ${MAIN}(주 체크아웃)과 C:/Projects/DAOU.Athena-gates(다른 화면 트랙이 동시에 쓰는 워크트리)는 절대 수정·커밋하지 마라.
- 다른 트랙이 origin/main 에 계속 푸시한다. 작업 시작 전에 반드시 git -C ${WT} fetch origin && git -C ${WT} merge -X ignore-cr-at-eol --no-edit origin/main 으로 최신을 받는다(충돌 나면 강제 해결하지 말고 blocked 에 적는다).
- Node: Git Bash에서 export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH". 단위 전체: cd ${WT}/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js. Electron 게이트: cd ${WT}/app && npm run <verify:...> (node_modules는 정션, 백엔드 127.0.0.1:8010, 실주문 /api/v1/order/* 절대 금지, mockapi 하드락 유지). 백엔드 python: cd ${WT} && backend/.venv/Scripts/python … . 저장소 게이트: cd ${WT} && node scripts/gates/check-{orb,glass-ladder,window-model,harness-freshness,paper-routes}.mjs (반드시 저장소 루트에서).
- 카드 전수 게이트(설계서 ${SP}/plan-paper-gates.md §3): (정적) cd ${WT}/app && npm run verify:paper-cards-static (5초; S2 slots.json 텍스트 다중집합 == 원장 texts, S3 상태 링크, S4 원장 tree sha vs 템플릿 paper.tree.txt, S5 레지스트리) · (런타임) npm run verify:paper-cards-mount (25초; 96장 × 4폭[원본·2분할·4분할·최소] 마운트, overflow_x 0, 세로 overflow 0, DOM 가시 텍스트 다중집합 == slots.json, 상태 보드 전부 DOM 존재; 샤딩 ATHENA_VERIFY_BOARD_IDS=a,b,c). 리포트 app/captures/paper-gates/PAPER-CARDS.json (ignore 대상, 커밋 금지) — 실패 코드: text_multiset_drift(정적 S2)·paper_tree_drift(S4)·overflow_x·surface_geometry(세로)·text_multiset_dom_mismatch·state_board_missing_in_dom. 판정 규칙을 완화하지 마라 — 보드를 고쳐라.
- 카드 파이프라인: Paper JSX → backend/ref/card-surface-templates/<board>/{paper.jsx, paper.tree.txt, board.html, slots.json, regions.json, meta.json} → python scripts/build_board_registry.py → app/lib/board-templates.CC-0X.generated.js → app/lib/board-template-registry.js · board-mount.js(마운트·상태 링크·primary 마운트 지점) · integrated-card-surface.js · app/styles/board-surface.css(컨테이너 쿼리 XL/L/M/S/XS). 템플릿을 고치면 python scripts/paper_board_extract.py <board> --check 로 드리프트를 확인하고 build_board_registry.py 로 생성물을 다시 만든 뒤 함께 커밋한다. 원장: backend/ref/paper-ledger/5-1/<board>.json(+.tree.txt). Paper 원문이 필요하면 ToolSearch("select:mcp__paper__get_tree_summary,mcp__paper__get_node_info,mcp__paper__get_jsx,mcp__paper__find_nodes")로 로드하고 fileId="01M0VGPX92K1TER4ZV9PWGQJJZ" 를 넘겨라(open_file·get_screenshot 금지; 서버가 안 붙으면 그 사실을 blocked 에 적고 원장·템플릿으로만 작업).
- 사용자 지시: "카드는 Paper와 동일하게 그려야 한다" — 카드 표면은 Paper 보드가 정본이고 slots.json 의 paper_text 가 곧 계약이다. 런타임 포맷터·마운트가 Paper 문면(예: 47,957)을 다른 꼴(4만 7,957)로 바꾸면 그것이 결함이다 — 제품 문구 3원칙(설명문 금지 · M/K/B 대신 천·만·억·조 한국어 단위 · TR id 등 내부용어 금지)은 Paper 문면 자체에 이미 반영돼 있으니 Paper 문면을 따르면 된다. 앱이 Paper 와 다르면 잠긴 계약을 빼고 앱을 Paper 쪽으로 고친다.
- 잠긴 계약: 실주문 금지, mockapi 하드락, 3초 paint ack 계약(verify.js liveChartCard), 키우미 얼굴 1종, 에이전트 #chatModeHead 숨김, body에 word-break keep-all 금지, pre-push 60초 예산. OPERATION_RECIPE_OVERRIDES(backend/athena_api/view_recipe_registry.py) 는 건드리지 않는다.
- 최근 main 에 들어간 카드 트랙 커밋을 먼저 읽어라(원인이 거기 있을 수 있다): 525e9a3·88e0336(primary 계약 투사·마운트 지점), 94543e4 와 그 앞 커밋(137X-2 보드 안 AITS 차트 마운트), a41b863·6bfc829(1JPU-0·13BC-2 보드 안 호가 사다리 마운트), fb25723(좁은 창 사다리), 4d742be(하이드레이션), 6f06774(상태 링크), 860443f(initial_state_board), f860bb0(폰트 폴백: Daki 미설치 머신은 Noto Sans KR/Malgun Gothic 으로 잰다).
- 코드 규칙(CLAUDE.md): 단순성 우선, 수술적 변경(무관한 줄 건드리지 않기), 기존 스타일 유지. TODO/스텁/test.skip/.only 금지. 가짜 값·가짜 통과 금지(게이트 판정 완화·보드 제외·예외 목록 금지).
- 커밋 형식(저장소 관례): 제목 "type(scope): 한국어 한 문장", 빈 줄, 본문 2~5줄(무엇을 왜, 검증 수치), 빈 줄, 트레일러 "Constraint: …" "Rejected: …"(있으면) "Confidence: high|medium|low" "Scope-risk: narrow|moderate|broad", 빈 줄, "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>". git commit -F <파일> 로 쓰고, git add <경로> 로 변경한 것만 스테이징한다(app/captures 산출물·정션·스크래치 금지). 절대 push 하지 마라(푸시는 별도 단계가 한다).
`

const IMPL = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    base_sha: { type: 'string' },
    head_sha: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    tests: { type: 'string', description: '돌린 테스트·게이트와 결과 수치(카드 게이트 전수 pass/fail 수 포함)' },
    cards_pass: { type: 'integer', description: '작업 후 PAPER-CARDS totals.pass' },
    cards_fail: { type: 'integer', description: '작업 후 PAPER-CARDS totals.fail' },
    boards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          board: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'gap', 'fail'] },
          detail: { type: 'string', description: 'pass: 원인과 고친 것 / gap: 설계 판단이 필요해 못 고친 것 / fail: 왜 못 맞췄나' },
          gap_files: { type: 'array', items: { type: 'string' } },
          gap_size: { type: 'string', enum: ['S', 'M', 'L', ''] },
        },
        required: ['board', 'status', 'detail', 'gap_files', 'gap_size'],
      },
    },
    blocked: { type: 'string' },
    decisions: { type: 'string' },
  },
  required: ['committed', 'base_sha', 'head_sha', 'commits', 'summary', 'tests', 'cards_pass', 'cards_fail', 'boards', 'blocked', 'decisions'],
}
const REVIEW = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' }, detail: { type: 'string' } }, required: ['severity', 'file', 'detail'] } },
    tests: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['approved', 'issues', 'tests', 'notes'],
}
const PUSH = {
  type: 'object',
  properties: { pushed: { type: 'boolean' }, head: { type: 'string' }, main_synced: { type: 'boolean' }, detail: { type: 'string' } },
  required: ['pushed', 'head', 'main_synced', 'detail'],
}

function batchBlock(b) {
  return `## 작업 ${b.key} — ${b.title}
대상 보드 ${b.boards.length}장: ${b.boards.map((x) => `${x.id}(${x.codes})`).join(' · ')}
현재 판정(2026-09-06 15:50 main 001f454 기준 PAPER-CARDS.json): ${b.symptom}
목표: 대상 보드가 정적·런타임 카드 게이트에서 전부 pass 가 되고, 전수 fail 수가 줄기만 한다(다른 보드 회귀 0).
${b.note ? '묶음 메모: ' + b.note : ''}`
}

function implPrompt(b) {
  return COMMON + `
${batchBlock(b)}

당신은 이 작업의 구현자다. 절차:
1. 최신 병합(위 규칙) 후 git -C ${WT} status --short 가 비어 있는지 확인하고 base_sha = git rev-parse HEAD. cd ${WT}/app && npm run verify:paper-cards-static && npm run verify:paper-cards-mount 로 현재 리포트를 새로 만들고 대상 보드의 failures 를 읽는다(리포트 JSON 의 boards[].failures 에 노드 id·폭·px·added/removed 텍스트가 있다).
2. 보드마다 원인을 실측한다: 정적 드리프트는 slots.json 과 원장 texts 를 대조(어느 트랙이 언제 바꿨는지 git log -p 로), 마운트 실패는 ATHENA_VERIFY_BOARD_IDS 로 그 보드만 돌리며 DOM·CSS 를 본다(필요하면 app/probe-paper-cards-mount.js 가 남기는 캡처·리포트 nodes 정보로 어느 노드가 넘치는지 확인). 같은 원인이 여러 보드에 걸치면 한 번에 고친다.
3. 고친다 — Paper 가 정본이다. (a) 런타임(마운트·포맷터·CSS)이 Paper 문면·기하를 바꾸면 런타임을 고친다. (b) 템플릿(slots.json·regions.json·board.html)이 원장과 다르면 어느 쪽이 Paper 최신인지 판단한다: 원장(export 2026-09-05)과 템플릿 paper.jsx 의 시점을 비교하고, 가능하면 Paper MCP 로 현재 노드를 확인한다. 원장이 낡았으면 원장 JSON(+.tree.txt, tree_summary_sha256 갱신 — scripts/paper-ledger 추출 스크립트가 있으면 그것으로) 을, 템플릿이 낡았으면 python scripts/paper_board_extract.py <board> 로 재추출한다. (c) 설계 판단이 필요한 것(예: Paper 가 그린 검증 헤더가 카드 표면에 속하는지, 마운트된 라이브 모듈이 Paper 목업 텍스트를 대체해도 되는지)은 스텁·예외로 초록을 만들지 말고 status=gap 으로 남기되 근거를 detail 에 적는다.
4. 게이트: 단위 전체, npm run verify:paper-cards-static, npm run verify:paper-cards-mount(전수), 마운트·CSS·생성물을 고쳤으면 npm run verify:integrated-cards(최대 6분, timeout 넉넉히) 도 돌린다. 템플릿을 고쳤으면 python scripts/paper_board_extract.py <board> --check 와 build_board_registry.py 재생성, board-parity 단위 테스트. 전수 fail 수가 작업 전보다 커지면 안 된다.
5. 커밋은 원인 단위로 나눈다. git -C ${WT} status --short 가 비어 있어야 한다. boards[] 에 보드마다 pass/gap/fail 과 detail 을 적고 cards_pass/cards_fail 에 작업 후 전수 수치를 적는다.
반환은 스키마대로.`
}

function reviewPrompt(b, impl) {
  return COMMON + `
${batchBlock(b)}

당신은 독립 검토자다. 구현자가 남긴 커밋(${impl.base_sha}..${impl.head_sha}, 커밋 ${impl.commits.join(', ')})을 검토하라.
구현자 요약: ${impl.summary}
구현자 판단: ${impl.decisions}
구현자 테스트: ${impl.tests}
보드별 결과: ${JSON.stringify(impl.boards)}
구현자가 못 한 것: ${impl.blocked || '없음'}

절차: git -C ${WT} show --stat ${impl.base_sha}..${impl.head_sha} 와 git -C ${WT} diff ${impl.base_sha} ${impl.head_sha} 로 변경 전체를 읽는다. 검사 항목: (1) 가짜 통과 — 게이트 판정 완화, 보드 제외, 예외 목록, 원장·slots 를 앱에 맞춰 고쳐 초록을 만든 흔적(원장을 고쳤다면 Paper 최신이라는 근거가 있는가). (2) Paper 배신 — 런타임이 여전히 Paper 문면·기하와 다른데 게이트만 통과하는 자리. (3) 회귀 — 다른 보드·카드 종류(통합 카드·차트·사다리·주문 티켓)·3초 paint ack·실시간 리스, verify:integrated-cards. (4) 템플릿을 고쳤으면 extract --check 와 생성물 재생성이 커밋에 같이 있는가. (5) CLAUDE.md 규칙(단순성·수술적 변경), 잠긴 계약, 커밋 메시지 형식. (6) gap 판정이 타당한가. 직접 재실행: 단위 전체, npm run verify:paper-cards-static, npm run verify:paper-cards-mount(전수; 대상 보드 pass 와 전수 fail 수 확인), 마운트·CSS 변경이면 verify:integrated-cards. blocker/major 가 하나라도 있으면 approved=false. 파일을 수정하지 마라.`
}

function fixPrompt(b, impl, review) {
  return COMMON + `
${batchBlock(b)}

당신은 구현자다. 검토자가 승인하지 않았다. 아래 지적을 고치고 새 커밋(형식 준수)으로 남겨라. 지적이 틀렸다고 판단되면 고치지 말고 decisions 에 근거를 적어라.
검토 메모: ${review.notes}
지적:
${review.issues.map((i) => `- [${i.severity}] ${i.file}${i.line ? ':' + i.line : ''} — ${i.detail}`).join('\n')}
이전 구현 요약: ${impl.summary}
이전 보드별 결과: ${JSON.stringify(impl.boards)}
절차: base_sha = 현재 HEAD(${impl.head_sha}). 고친 뒤 단위 전체·카드 게이트 정적·런타임 전수를 다시 돌리고 커밋한다. 마지막에 status 가 비어 있어야 한다. 반환 스키마대로(head_sha 는 새 HEAD, boards 는 갱신된 전체).`
}

function pushPrompt(b, impl) {
  return `당신은 푸시 담당이다. 파일을 수정하지 마라. Node PATH: export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH" (pre-push 훅이 node 를 쓴다).
워크트리 ${WT}(브랜치 fix/paper-parity-2026-09-05)의 HEAD(${impl.head_sha}, 작업 ${b.key})를 origin/main 에 올린다.
절차: (1) git -C ${WT} status --short 가 비어 있는지 확인(비어 있지 않으면 pushed=false 로 보고). (2) git -C ${WT} fetch origin. (3) origin/main 이 HEAD 의 조상이 아니면 git -C ${WT} merge -X ignore-cr-at-eol --no-edit origin/main 으로 합치고(충돌이 나면 pushed=false 와 충돌 파일을 보고, 절대 강제 해결하지 마라) cd ${WT}/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js 로 초록을 확인한다 — 실패하면 pushed=false 와 실패 테스트 이름·원인(어느 쪽 변경과 부딪히는지)을 detail 에 적는다. (4) git -C ${WT} push origin HEAD:main — pre-push 훅(게이트 + 단위)이 돈다. 거부되면 원인(훅 실패 로그)을 detail 에 그대로 적는다. (5) 성공하면 git -C ${MAIN} pull --ff-only 로 주 체크아웃을 동기화한다(실패해도 pushed 는 true, main_synced=false 로 보고). 반환 스키마대로.`
}

const results = []
for (const b of BATCHES) {
  log(`▶ ${b.key} — ${b.title}`)
  let impl = await agent(implPrompt(b), { label: `impl:${b.key}`, phase: 'Implement', schema: IMPL, effort: 'high' })
  if (!impl) { results.push({ key: b.key, status: 'impl-failed' }); log(`✖ ${b.key}: 구현 에이전트 실패`); continue }
  if (!impl.committed) { results.push({ key: b.key, status: 'not-committed', blocked: impl.blocked, summary: impl.summary, boards: impl.boards }); log(`✖ ${b.key}: 커밋 없음 — ${impl.blocked}`); continue }
  let review = null
  for (let round = 0; round < 3; round++) {
    review = await agent(reviewPrompt(b, impl), { label: `review:${b.key}`, phase: 'Review', schema: REVIEW, effort: 'high' })
    if (!review) break
    if (review.approved) break
    log(`↺ ${b.key}: 검토 미승인 (${review.issues.length}건) — 수정 라운드 ${round + 1}`)
    if (round === 2) break
    const fixed = await agent(fixPrompt(b, impl, review), { label: `fix:${b.key}`, phase: 'Implement', schema: IMPL, effort: 'high' })
    if (!fixed) break
    impl = { ...fixed, base_sha: impl.base_sha, commits: [...impl.commits, ...fixed.commits], summary: fixed.summary || impl.summary }
  }
  const approved = !!(review && review.approved)
  const push = await agent(pushPrompt(b, impl), { label: `push:${b.key}`, phase: 'Push', schema: PUSH, effort: 'low' })
  const passed = (impl.boards || []).filter((x) => x.status === 'pass').length
  results.push({ key: b.key, status: push && push.pushed ? (approved ? 'pushed' : 'pushed-with-open-issues') : 'push-failed', approved, commits: impl.commits, head: impl.head_sha, summary: impl.summary, cards_pass: impl.cards_pass, cards_fail: impl.cards_fail, boards: impl.boards, blocked: impl.blocked, issues: review ? review.issues : [], push: push ? push.detail : 'push agent failed' })
  log(`${push && push.pushed ? '✔' : '✖'} ${b.key}: ${approved ? '승인' : '미승인'} · 통과 ${passed}/${(impl.boards || []).length} · 전수 ${impl.cards_pass}/${impl.cards_pass + impl.cards_fail}`)
}
const allBoards = results.flatMap((r) => r.boards || [])
return {
  done: results.filter((r) => r.status.startsWith('pushed')).length,
  total: BATCHES.length,
  boards_pass: allBoards.filter((x) => x.status === 'pass').length,
  boards_gap: allBoards.filter((x) => x.status === 'gap'),
  boards_fail: allBoards.filter((x) => x.status === 'fail'),
  results,
}